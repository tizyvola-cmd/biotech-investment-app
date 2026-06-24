/**
 * useSignalAlerts — detects actionable signals from simTable and generates notifications.
 *
 * - Checks when simTable changes + every 5 minutes
 * - Dedup via localStorage (does not re-notify the same signal)
 * - Uses Web Notifications API (works natively in Electron)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SheetTable } from "../types";
import { extractCurveInputs } from "../sheet/precatCurve";
import {
  classifySlopeEventKind,
  slopeDeltaPpPerDay,
} from "../sheet/slopeThresholds";
import { isMaterialSlopePriceGap } from "../sheet/slopeStockPrices";
import { currentPriceFromRow } from "../sheet/simulationPosition";
import {
  addSlopeEvent,
  confirmPendingSlopeEvents,
  type SlopeEventKind,
} from "../sheet/slopeEventLog";
import {
  addContrarianEvent,
  confirmPendingContrarianEvents,
} from "../sheet/contrarianLog";
import { useInvestSimInputs } from "./useInvestSimInputs";
import { loadInvestSimHistory } from "../sheet/investSimStorage";
import {
  positionPnlForOpenRow,
  rowHasActivePortfolio,
} from "../sheet/simulationPosition";

// ── audio ─────────────────────────────────────────────────────────────────────

/**
 * Alert sound via Web Audio API.
 *  "critical" → descending double beep (slope_rev, reversal)
 *  "warning"  → single descending tone (slope_dec, deceleration)
 */
function playAlertSound(kind: "critical" | "warning"): void {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx  = new AC();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";

    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.22, t + 0.02);

    if (kind === "critical") {
      // Double beep 880→660→880 Hz — slope reversal
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.setValueAtTime(660, t + 0.13);
      osc.frequency.setValueAtTime(880, t + 0.26);
      gain.gain.setValueAtTime(0.22, t + 0.38);
      gain.gain.linearRampToValueAtTime(0, t + 0.52);
      osc.start(t);
      osc.stop(t + 0.52);
    } else {
      // Single descending tone 660→420 Hz — deceleration
      osc.frequency.setValueAtTime(660, t);
      osc.frequency.linearRampToValueAtTime(420, t + 0.38);
      gain.gain.setValueAtTime(0.18, t + 0.30);
      gain.gain.linearRampToValueAtTime(0, t + 0.48);
      osc.start(t);
      osc.stop(t + 0.48);
    }

    // Release the context after playback to avoid resource saturation
    osc.onended = () => void ctx.close();
  } catch { /* browser/Electron doesn't support AudioContext in this context */ }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function findCol(cols: string[], kw: string): string | undefined {
  const lo = kw.toLowerCase();
  return cols.find((c) => c.toLowerCase().includes(lo));
}

function toNum(v: unknown): number | null {
  if (v == null || v === "" || v === "—" || v === "-" || v === "N/D") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseDMY(s: string): Date | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

function daysFromToday(s: string): number | null {
  const d = parseDMY(s);
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

function computeScore(
  affid: number | null,
  r2: number | null,
  pred5: number | null,
  days: number | null,
): number {
  const a = affid != null ? Math.min(1, affid) * 35 : 0;
  const r = r2    != null ? Math.min(1, Math.max(0, r2)) * 20 : 0;
  let d = 0;
  if (pred5 != null) {
    const abs = Math.abs(pred5);
    if (abs >= 10) d = 25;
    else if (abs >= 5) d = 18;
    else if (abs >= 2) d = 10;
    else d = 3;
  }
  let t = 0;
  if (days != null && days >= 0) {
    if (days <= 7) t = 20;
    else if (days <= 14) t = 17;
    else if (days <= 30) t = 12;
    else if (days <= 60) t = 6;
    else t = 2;
  }
  return Math.round(a + r + d + t);
}

function fmtPct(v: number | null): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

// ── types ────────────────────────────────────────────────────────────────────

export type AlertKind = "forte" | "watch" | "exit" | "short" | "stop" | "slope_dec" | "slope_rev";

export type SignalAlert = {
  id: string;
  kind: AlertKind;
  ticker: string;
  cd: string;
  days: number | null;
  score: number;
  pred5: number | null;
  pnlPct: number | null;
  message: string;
  timestamp: number;
  read: boolean;
};

// ── persistence ──────────────────────────────────────────────────────────────

const STORAGE_KEY = "supernova_alerts_v1";
const MAX_ALERTS  = 50;
const RECHECK_MS  = 5 * 60 * 1000; // 5 min

type PersistedState = { seenIds: string[]; alerts: SignalAlert[] };

function loadPersisted(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { seenIds: [], alerts: [] };
    return JSON.parse(raw) as PersistedState;
  } catch {
    return { seenIds: [], alerts: [] };
  }
}

function savePersisted(state: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore quota */ }
}

// ── hook ─────────────────────────────────────────────────────────────────────

export function useSignalAlerts(simTable: SheetTable | null) {
  const inputs = useInvestSimInputs(simTable);
  const [alerts, setAlerts] = useState<SignalAlert[]>(() => loadPersisted().alerts);
  const seenIdsRef = useRef<Set<string>>(new Set(loadPersisted().seenIds));

  // Request permission once on mount
  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  }, []);

  const fireNotification = useCallback((title: string, body: string) => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    try { new Notification(title, { body }); } catch { /* unsupported */ }
  }, []);

  const checkSignals = useCallback(() => {
    if (!simTable) return;

    const cols       = simTable.columns;
    const colTicker  = findCol(cols, "Ticker") ?? "Ticker";
    const colCD      = findCol(cols, "Completion Date") ?? "Completion Date";
    const colAffid   = findCol(cols, "Affidabilit") ?? "";
    const colR2      = findCol(cols, "R²") ?? findCol(cols, "R2") ?? "";
    const colPred5   = findCol(cols, "Pred empirica") ?? "";
    const colPnl     = findCol(cols, "P&L (%)") ?? "";

    const newAlerts: SignalAlert[] = [];

    for (const row of simTable.rows) {
      const ticker = String(row[colTicker] ?? "").trim();
      const cd     = String(row[colCD]     ?? "").trim();
      if (!ticker || !cd) continue;

      const days = daysFromToday(cd);
      if (days == null || days < -1 || days > 60) continue;

      let affid = toNum(row[colAffid]);
      if (affid != null && affid > 1) affid /= 100;
      const r2 = toNum(row[colR2]);
      let pred5 = toNum(row[colPred5]);
      if (pred5 != null && Math.abs(pred5) <= 1.5 && !String(row[colPred5] ?? "").includes("%"))
        pred5 *= 100;
      const hasPosition = rowHasActivePortfolio(row, inputs);
      let pnlPct: number | null = null;
      if (hasPosition) {
        const m = positionPnlForOpenRow(row, inputs, loadInvestSimHistory());
        if (m.pnlPct != null) pnlPct = m.pnlPct;
      } else {
        pnlPct = toNum(row[colPnl]);
        if (pnlPct != null && Math.abs(pnlPct) <= 1.5) pnlPct *= 100;
      }

      const score   = computeScore(affid, r2, pred5, days);
      const isLong  = pred5 != null && pred5 >= 0.5;
      const isShort = pred5 != null && pred5 <= -0.5;

      let kind: AlertKind | null = null;
      let message = "";

      if (hasPosition && pnlPct != null && pnlPct < -8) {
        kind    = "stop";
        message = `P&L ${fmtPct(pnlPct)} — below stop loss, consider immediate exit`;
      } else if (hasPosition && ((days != null && days <= 3) || (pnlPct != null && pnlPct > 8))) {
        kind = "exit";
        const why = pnlPct != null && pnlPct > 8
          ? `P&L ${fmtPct(pnlPct)} near target`
          : `CD in ${days ?? 0} ${days === 1 ? "day" : "days"}`;
        message = `Consider exit · ${why}`;
      } else if (score >= 60 && isLong && days != null && days >= 0 && days <= 14) {
        kind = "forte";
        const urgency = days <= 3 ? "⚠ urgent" : days <= 7 ? "this week" : "within 2 wk";
        message = `Score ${score} · Pred ${fmtPct(pred5)} · CD in ${days} d · ${urgency}`;
      } else if (score >= 48 && isShort && days != null && days >= 0 && days <= 14) {
        kind    = "short";
        message = `Score ${score} · Pred ${fmtPct(pred5)} · CD in ${days} d`;
      } else if (score >= 40 && isLong && days != null && days >= 0 && days <= 30) {
        kind    = "watch";
        message = `Score ${score} · Pred ${fmtPct(pred5)} · CD in ${days} days`;
      }

      // ── Main signal ──────────────────────────────────────────────────────
      if (kind) {
        const id = `${ticker}-${cd}-${kind}`;
        if (!seenIdsRef.current.has(id)) {
          newAlerts.push({
            id, kind, ticker, cd, days, score, pred5, pnlPct,
            message, timestamp: Date.now(), read: false,
          });
        }
      }

      // ── Slope/pred divergence log (contrarian — all tickers with valid CD) ──
      {
        const { slope5d, runUp30d } = extractCurveInputs(row);
        if (
          slope5d != null &&
          pred5   != null &&
          Math.abs(pred5) >= 1 &&
          days    != null &&
          days    >= 0    &&
          days    <= 60   &&
          (slope5d > 0) !== (pred5 > 0)          // directional divergence
        ) {
          const regime =
            runUp30d == null  ? "flat"     :
            runUp30d >= 25    ? "btr"      :
            runUp30d >= 10    ? "moderate" :
            runUp30d < -10    ? "ctr"      : "flat";

          const spot = currentPriceFromRow(row);
          const modelT5 =
            spot != null && pred5 != null && Number.isFinite(pred5)
              ? spot * (1 + pred5 / 100)
              : null;
          if (isMaterialSlopePriceGap(spot, modelT5)) {
          addContrarianEvent({
            ticker, cd,
            detected_at:            Date.now(),
            days_to_cd_at_detection: days,
            slope5d,
            pred5,
            divergence_type: pred5 > 0 ? "model_up" : "model_down",
            regime,
            had_open_position: hasPosition,
          });
          }
        }
      }

      // ── Slope change event log ─────────────────────────────────────────────
      // Previously we only logged events for OPEN positions, which left the
      // log empty for users who haven't invested yet — making it useless as a
      // calibration dataset. We now record events on every ticker with a valid
      // CD: ``had_open_position`` distinguishes "live" vs "passive" events,
      // and the audio alert + push notification still fires only when the
      // user actually has skin in the game.
      {
        const { slope5d, slope20d, runUp30d } = extractCurveInputs(row);
        if (slope5d != null && slope20d != null) {
          const delta = slopeDeltaPpPerDay(slope5d, slope20d);
          const fmt   = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;

          // Capture current price (used for the proxy P&L confirmation later).
          const colPriceCur = findCol(cols, "current price") ?? findCol(cols, "prezzo attuale") ?? "";
          const colPriceLast = findCol(cols, "last close") ?? findCol(cols, "previous close") ?? "";
          const priceCandidate = toNum(row[colPriceCur]) ?? toNum(row[colPriceLast]) ?? null;

          const classified = classifySlopeEventKind(slope5d, slope20d);
          let slopeKind: SlopeEventKind | null = classified;
          let slopeMsg = "";
          let soundKind: "critical" | "warning" = "warning";

          if (classified === "slope_rev") {
            slopeMsg  = `Reversal: trend5d ${fmt(slope5d)} vs trend20d ${fmt(slope20d)} pp/d — consider exit`;
            soundKind = "critical";
          } else if (classified === "slope_dec") {
            slopeMsg  = `Deceleration ${fmt(delta)} pp/d (slope5d ${fmt(slope5d)} vs slope20d ${fmt(slope20d)}) — monitor position`;
            soundKind = "warning";
          } else if (classified === "slope_acc") {
            slopeMsg  = `Acceleration ${fmt(delta)} pp/d (slope5d ${fmt(slope5d)} vs slope20d ${fmt(slope20d)})`;
          }

          const spotForGap = currentPriceFromRow(row) ?? priceCandidate;
          const modelT5 =
            spotForGap != null && pred5 != null && Number.isFinite(pred5)
              ? spotForGap * (1 + pred5 / 100)
              : null;
          if (slopeKind && !isMaterialSlopePriceGap(spotForGap, modelT5)) {
            slopeKind = null;
          }

          if (slopeKind) {
            const slopeId = `${ticker}-${cd}-${slopeKind}`;
            const newToUser = !seenIdsRef.current.has(slopeId);

            // ── Record in the permanent JSON log (always) ─────────────────
            addSlopeEvent({
              ticker, cd,
              detected_at: Date.now(),
              kind: slopeKind,
              days_to_cd_at_detection: days ?? 0,
              slope5d, slope20d,
              delta_pp_per_day: delta,
              run_up_30d: runUp30d,
              regime: (() => {
                if (runUp30d == null) return "flat";
                if (runUp30d >= 25)   return "btr";
                if (runUp30d >= 10)   return "moderate";
                if (runUp30d < -10)   return "ctr";
                return "flat";
              })(),
              pred_pct_median: slope20d != null && days != null ? slope20d * days : null,
              had_open_position: hasPosition,
              price_at_detection: priceCandidate,
            });

            // Alert UI + sound only for OPEN positions (avoid noise on
            // passive observation events). Accelerations don't trigger an
            // alert: they're recorded silently for calibration purposes.
            if (hasPosition && newToUser && (slopeKind === "slope_dec" || slopeKind === "slope_rev")) {
              newAlerts.push({
                id: slopeId, kind: slopeKind, ticker, cd, days,
                score: 0, pred5: null, pnlPct,
                message: slopeMsg, timestamp: Date.now(), read: false,
              });
              playAlertSound(soundKind);
            }
          }
        }
      }
    }

    // ── Confirm pending events (CD already past) ──────────────────────────────
    {
      const colPriceCur = findCol(cols, "current price") ?? findCol(cols, "prezzo attuale") ?? "";
      const colPriceLast = findCol(cols, "last close") ?? findCol(cols, "previous close") ?? "";
      const tickerMap = new Map<
        string,
        { pnlPct: number | null; slope5d: number | null; days: number | null; priceNow?: number | null }
      >();
      for (const row of simTable.rows) {
        const ticker = String(row[colTicker] ?? "").trim();
        const cd     = String(row[colCD]     ?? "").trim();
        if (!ticker || !cd) continue;
        const days   = daysFromToday(cd);
        let pnlPct   = toNum(row[colPnl]);
        if (pnlPct != null && Math.abs(pnlPct) <= 1.5) pnlPct *= 100;
        const { slope5d } = extractCurveInputs(row);
        const priceNow = toNum(row[colPriceCur]) ?? toNum(row[colPriceLast]) ?? null;
        tickerMap.set(`${ticker}::${cd}`, { pnlPct, slope5d, days, priceNow });
      }
      confirmPendingSlopeEvents(tickerMap);
      confirmPendingContrarianEvents(tickerMap);
    }

    if (!newAlerts.length) return;

    // Native OS notifications
    for (const a of newAlerts) {
      const kindLabel: Record<AlertKind, string> = {
        forte:     "⚡ Strong signal — Invest",
        watch:     "▲ Watch long",
        short:     "▼ Watch short",
        exit:      "↩ Consider exit",
        stop:      "🛑 Stop loss",
        slope_dec: "🟠 Slope declining",
        slope_rev: "🔴 Slope reversal",
      };
      fireNotification(`SuperNova · ${a.ticker} — ${kindLabel[a.kind]}`, a.message);
      seenIdsRef.current.add(a.id);
    }

    setAlerts((prev) => {
      const merged = [...newAlerts, ...prev].slice(0, MAX_ALERTS);
      savePersisted({ seenIds: [...seenIdsRef.current], alerts: merged });
      return merged;
    });
  }, [simTable, inputs, fireNotification]);

  // Check on simTable load
  useEffect(() => { checkSignals(); }, [checkSignals]);

  // Re-check every 5 min
  useEffect(() => {
    const id = setInterval(checkSignals, RECHECK_MS);
    return () => clearInterval(id);
  }, [checkSignals]);

  const unreadCount = useMemo(() => alerts.filter((a) => !a.read).length, [alerts]);

  const markAllRead = useCallback(() => {
    setAlerts((prev) => {
      const next = prev.map((a) => ({ ...a, read: true }));
      const p = loadPersisted();
      savePersisted({ ...p, alerts: next });
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setAlerts([]);
    seenIdsRef.current.clear();
    savePersisted({ seenIds: [], alerts: [] });
  }, []);

  const dismissAlert = useCallback((id: string) => {
    setAlerts((prev) => {
      const next = prev.filter((a) => a.id !== id);
      const p = loadPersisted();
      savePersisted({ ...p, alerts: next });
      return next;
    });
  }, []);

  return { alerts, unreadCount, markAllRead, clearAll, dismissAlert, checkSignals };
}
