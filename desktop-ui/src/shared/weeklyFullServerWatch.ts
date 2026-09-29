/**
 * WeeklyFull automatico sul server (sabato mattina): polling + popup desktop al termine.
 * Una notifica per ``finished_at`` (localStorage ack).
 */

import type { WeeklyFullServerStatus } from "../api/refresh";
import type { SundayRefreshResult } from "./refreshStatusStore";
import { formatOrchestratorSummaryMessage } from "../sheet/orchestratorSummaryMessage";

const ACK_KEY = "supernova_weekly_full_ack_finished_at";
/** Multi-id ack — last_run and summary often disagree by ~1–2 minutes. */
const ACK_SET_KEY = "supernova_weekly_full_ack_ids";
/** Auto-popup only for recent finishes (stale Saturday runs must not stick for a week). */
const MAX_AGE_HOURS = 36;

/** In-memory fallback when localStorage is missing (tests) or throws. */
const memoryAckIds = new Set<string>();

function parseFinishedAt(iso: string | null | undefined): Date | null {
  const v = iso?.trim();
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isRecentWeeklyFullCompletion(finishedAt: string | null | undefined): boolean {
  const d = parseFinishedAt(finishedAt);
  if (!d) return false;
  const ageHours = (Date.now() - d.getTime()) / 3_600_000;
  return ageHours <= MAX_AGE_HOURS;
}

/** Normalize finish stamps so `…T03:42:32` and `… 03:42:32Z` ack as the same run. */
export function normalizeWeeklyFullFinishId(iso: string | null | undefined): string | null {
  const raw = iso?.trim();
  if (!raw) return null;
  const d = parseFinishedAt(raw.includes(" ") && !raw.includes("T") ? raw.replace(" ", "T") : raw);
  if (!d) return raw;
  // Minute precision — last_run vs summary often differ by ~30–60s.
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

function readAckSet(): Set<string> {
  const out = new Set<string>(memoryAckIds);
  if (typeof window === "undefined" || typeof localStorage === "undefined") return out;
  try {
    const legacy = localStorage.getItem(ACK_KEY)?.trim();
    if (legacy) out.add(legacy);
    const raw = localStorage.getItem(ACK_SET_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        for (const v of parsed) {
          if (typeof v === "string" && v.trim()) out.add(v.trim());
        }
      }
    }
  } catch {
    /* quota / parse */
  }
  return out;
}

function writeAckSet(ids: Set<string>): void {
  memoryAckIds.clear();
  for (const id of ids) memoryAckIds.add(id);
  if (typeof window === "undefined" || typeof localStorage === "undefined") return;
  try {
    const list = [...ids].slice(-12);
    localStorage.setItem(ACK_SET_KEY, JSON.stringify(list));
    if (list.length > 0) localStorage.setItem(ACK_KEY, list[list.length - 1]!);
  } catch {
    /* quota — memory set still holds */
  }
}

/** All finish timestamps that identify the same WeeklyFull cycle. */
export function weeklyFullCompletionCandidates(
  status: WeeklyFullServerStatus,
): string[] {
  const out: string[] = [];
  const push = (v: string | null | undefined) => {
    const t = v?.trim();
    if (t && !out.includes(t)) out.push(t);
    const norm = normalizeWeeklyFullFinishId(t);
    if (norm && !out.includes(norm)) out.push(norm);
  };
  push(status.last_run?.finished_at);
  push(status.summary?.finished_at);
  push(status.summary?.finished_at_display);
  push(status.summary?.finished_at_display?.replace(" ", "T"));
  return out;
}

export function getWeeklyFullAckFinishedAt(): string | null {
  const set = readAckSet();
  if (set.size === 0) return null;
  return [...set].at(-1) ?? null;
}

export function acknowledgeWeeklyFullServerRun(
  finishedAt: string | null | undefined,
  ...extra: Array<string | null | undefined>
): void {
  acknowledgeWeeklyFullServerIds([finishedAt, ...extra]);
}

function acknowledgeWeeklyFullServerIds(
  ids: Array<string | null | undefined>,
): void {
  const set = readAckSet();
  let changed = false;
  for (const v of ids) {
    const t = v?.trim();
    if (!t) continue;
    if (!set.has(t)) {
      set.add(t);
      changed = true;
    }
    const norm = normalizeWeeklyFullFinishId(t);
    if (norm && !set.has(norm)) {
      set.add(norm);
      changed = true;
    }
  }
  if (changed) writeAckSet(set);
}

/** Dismiss popup + permanently ack this finish so the poll cannot reopen it. */
export function dismissWeeklyFullCompletion(
  statusOrResult?:
    | WeeklyFullServerStatus
    | {
        summary?: {
          finished_at?: string | null;
          finished_at_display?: string | null;
        } | null;
      }
    | null,
): void {
  if (statusOrResult && "last_run" in (statusOrResult as object)) {
    acknowledgeWeeklyFullServerStatus(statusOrResult as WeeklyFullServerStatus);
    return;
  }
  const summary = statusOrResult?.summary;
  acknowledgeWeeklyFullServerIds([
    summary?.finished_at,
    summary?.finished_at_display,
    summary?.finished_at_display?.replace(" ", "T"),
  ]);
}

export function acknowledgeWeeklyFullServerStatus(status: WeeklyFullServerStatus): void {
  acknowledgeWeeklyFullServerIds(weeklyFullCompletionCandidates(status));
}

export function weeklyFullCompletionId(status: WeeklyFullServerStatus): string | null {
  const candidates = weeklyFullCompletionCandidates(status);
  return candidates[0] ?? null;
}

/**
 * Trust ``running`` only when it is not contradicted by a completed last_run.
 * VPS bug (2026-07-19 / 2026-07-25): API returned running:true after WeeklyFull already finished
 * (stale lock / orphan pgrep).
 */
export function isWeeklyFullActuallyRunning(status: WeeklyFullServerStatus): boolean {
  if (!status.running) return false;
  const finishedAt =
    status.last_run?.finished_at?.trim() || status.summary?.finished_at?.trim() || "";
  const ok = status.last_run?.ok ?? status.summary?.ok;
  if (!finishedAt || ok !== true) return true;
  const fin = Date.parse(finishedAt);
  if (!Number.isFinite(fin)) return true;
  // Completed more than 10 minutes ago → treat as idle (stale lock / orphan pgrep).
  return Date.now() - fin < 10 * 60_000;
}

export function isWeeklyFullCompletionNew(status: WeeklyFullServerStatus): boolean {
  const id = weeklyFullCompletionId(status);
  if (!id) return false;
  if (isWeeklyFullActuallyRunning(status)) return false;
  if (!isRecentWeeklyFullCompletion(id)) return false;
  const acked = readAckSet();
  const candidates = weeklyFullCompletionCandidates(status);
  for (const c of candidates) {
    if (acked.has(c)) return false;
    const norm = normalizeWeeklyFullFinishId(c);
    if (norm && acked.has(norm)) return false;
  }
  return true;
}

/** True when VPS last_run finished on the same local calendar day. */
export function weeklyFullCompletedToday(
  status: WeeklyFullServerStatus,
  now = new Date(),
): boolean {
  const id = weeklyFullCompletionId(status);
  const d = parseFinishedAt(id);
  if (!d) return false;
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate() &&
    (status.last_run?.ok ?? status.summary?.ok) === true
  );
}

export function buildSundayResultFromServerStatus(
  status: WeeklyFullServerStatus,
  lang: "en" | "it" = "en",
): SundayRefreshResult | null {
  const id = weeklyFullCompletionId(status);
  if (!id) return null;
  const summary = status.summary && Object.keys(status.summary).length > 0 ? status.summary : null;
  const last = status.last_run;
  const ok = last?.ok ?? summary?.ok ?? false;
  const elapsedSec = last?.duration_sec ?? summary?.elapsed_sec ?? 0;
  const message =
    formatOrchestratorSummaryMessage(summary, lang) ||
    (ok
      ? lang === "it"
        ? "WeeklyFull completato sul server."
        : "WeeklyFull completed on server."
      : lang === "it"
        ? "WeeklyFull terminato con errori sul server."
        : "WeeklyFull ended with errors on server.");
  return {
    success: ok,
    elapsedSec: Math.max(0, Math.round(elapsedSec)),
    message,
    exitCode: summary?.exit_code ?? (ok ? 0 : 1),
    summary,
  };
}

export function playWeeklyFullDoneBeep(success: boolean): void {
  try {
    type WindowWithAudio = Window & {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const w = window as WindowWithAudio;
    const Ctx = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const playTone = (freq: number, when: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + when);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + when);
      gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + when + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + when + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + when);
      osc.stop(ctx.currentTime + when + dur + 0.05);
    };
    if (success) {
      playTone(523, 0, 0.18);
      playTone(659, 0.18, 0.18);
      playTone(784, 0.36, 0.3);
    } else {
      playTone(440, 0, 0.25);
      playTone(330, 0.27, 0.4);
    }
    setTimeout(() => {
      void ctx.close();
    }, 1500);
  } catch {
    /* audio unavailable */
  }
}
