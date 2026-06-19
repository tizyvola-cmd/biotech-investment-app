/**
 * Popup raccomandazioni BUY/SELL / synth trim — rileva cambi rispetto all'ultima visione.
 */
import type { SheetTable } from "../types";
import { simulationRowSeriesKey } from "../data/simulationCharts";
import { buildSimRowByKeyMap } from "./investSimKeys";
import {
  buildSuggestionMonitorRows,
  isAlertableRecommendation,
  type SuggestionMonitorContext,
  type SuggestionMonitorRow,
} from "./suggestionMonitor";
import { isSynthExposureUrgentAlert } from "./synthExposureBridge";

/** Popup raccomandazioni — P(plan) minimo (esclusi synth trim/sell urgenti). */
export const RECOMMENDATION_ALERT_MIN_PROB_PCT = 60;

const SEEN_KEY = "supernova_recommendation_alerts_seen_v1";
const ACTION_SEEN_KEY = "supernova_recommendation_alerts_action_seen_v1";
const BOOTSTRAP_KEY = "supernova_recommendation_alerts_bootstrapped_v1";

export type RecommendationAlertKind = "standard" | "synth_trim" | "synth_sell";

export type RecommendationAlertPayload = {
  key: string;
  ticker: string;
  completionDate: string;
  seriesKey: string | null;
  suggestedAction: "buy" | "sell" | "hold" | "review";
  signature: string;
  alertKind: RecommendationAlertKind;
  synthTargetCapEur: number | null;
};

export function recommendationSignature(
  row: Pick<
    SuggestionMonitorRow,
    | "suggestedAction"
    | "exitDecision"
    | "investVerdict"
    | "probPct"
    | "planReturnPct"
    | "readings"
    | "synthExposureKind"
    | "synthTargetCapEur"
  >,
): string {
  const prob = row.probPct != null && Number.isFinite(row.probPct) ? Math.round(row.probPct) : "n";
  const plan =
    row.planReturnPct != null && Number.isFinite(row.planReturnPct)
      ? row.planReturnPct.toFixed(1)
      : "n";
  const precat = row.readings.precatKind;
  const synth =
    row.synthExposureKind && row.synthExposureKind !== "none" && row.synthTargetCapEur != null
      ? `|synth:${Math.round(row.synthTargetCapEur)}|${row.synthExposureKind}`
      : "";
  return `${row.suggestedAction}|${row.exitDecision}|${row.investVerdict}|${prob}|${precat}|${plan}${synth}`;
}

/** Stable action key — one popup per action flip (buy/sell/hold/review), not exit/prob drift. */
export function recommendationActionSignature(
  row: Pick<
    SuggestionMonitorRow,
    "suggestedAction" | "exitDecision" | "synthExposureKind" | "synthTargetCapEur"
  >,
): string {
  if (row.synthExposureKind === "trim_review") {
    const cap =
      row.synthTargetCapEur != null && Number.isFinite(row.synthTargetCapEur)
        ? Math.round(row.synthTargetCapEur)
        : "n";
    return `review|synth_trim|${cap}`;
  }
  if (row.synthExposureKind === "trim_sell" || row.synthExposureKind === "sell_confirm") {
    const cap =
      row.synthTargetCapEur != null && Number.isFinite(row.synthTargetCapEur)
        ? Math.round(row.synthTargetCapEur)
        : "n";
    return `sell|synth_exposure|${cap}`;
  }
  return row.suggestedAction;
}

export function recommendationActionSignatureFromFull(full: string): string {
  if (full.includes("|synth:")) {
    const action = full.split("|")[0] ?? "";
    const synthPart = full.match(/\|synth:(\d+)/);
    const cap = synthPart?.[1] ?? "n";
    if (action === "review") return `review|synth_trim|${cap}`;
    if (action === "sell") return `sell|synth_exposure|${cap}`;
  }
  return full.split("|")[0] ?? "";
}

/** Standard BUY/SELL/HOLD alerts require P(plan) ≥ threshold; synth exposure bypasses. */
export function meetsRecommendationAlertConfidence(
  row: Pick<
    SuggestionMonitorRow,
    "probPct" | "synthExposureKind" | "hasPosition" | "inPaperPortfolio" | "profile"
  >,
): boolean {
  if (isSynthExposureUrgentAlert(row)) return true;
  const p = row.probPct;
  if (p == null || !Number.isFinite(p)) return false;
  return p >= RECOMMENDATION_ALERT_MIN_PROB_PCT;
}

function loadSeenMap(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveSeenMap(map: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(map));
  } catch {
    /* quota */
  }
}

function loadActionSeenMap(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(ACTION_SEEN_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveActionSeenMap(map: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ACTION_SEEN_KEY, JSON.stringify(map));
  } catch {
    /* quota */
  }
}

export function isRecommendationAlertsBootstrapped(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(BOOTSTRAP_KEY) === "1";
}

function markRecommendationAlertsBootstrapped(): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(BOOTSTRAP_KEY, "1");
}

/** Primo avvio: salva lo stato corrente senza popup. */
export function bootstrapRecommendationSignatures(rows: SuggestionMonitorRow[]): void {
  const map = loadSeenMap();
  const actionMap = loadActionSeenMap();
  for (const row of rows) {
    if (!isAlertableRecommendation(row)) continue;
    if (!meetsRecommendationAlertConfidence(row)) continue;
    const sig = recommendationSignature(row);
    map[row.key] = sig;
    actionMap[row.key] = recommendationActionSignature(row);
  }
  saveSeenMap(map);
  saveActionSeenMap(actionMap);
  markRecommendationAlertsBootstrapped();
}

export function ackRecommendationAlert(key: string, signature: string): void {
  const map = loadSeenMap();
  map[key] = signature;
  saveSeenMap(map);
  const actionMap = loadActionSeenMap();
  actionMap[key] = recommendationActionSignatureFromFull(signature);
  saveActionSeenMap(actionMap);
}

export function ackRecommendationAlerts(alerts: RecommendationAlertPayload[]): void {
  if (!alerts.length) return;
  const map = loadSeenMap();
  const actionMap = loadActionSeenMap();
  for (const a of alerts) {
    map[a.key] = a.signature;
    actionMap[a.key] = recommendationActionSignatureFromFull(a.signature);
  }
  saveSeenMap(map);
  saveActionSeenMap(actionMap);
}

export function recommendationAlertKeySig(alerts: RecommendationAlertPayload[]): string {
  return alerts
    .map((a) => `${a.key}:${a.signature}`)
    .sort()
    .join("|");
}

function alertKindFromRow(row: SuggestionMonitorRow): RecommendationAlertKind {
  if (row.synthExposureKind === "trim_sell" || row.synthExposureKind === "sell_confirm") {
    return "synth_sell";
  }
  if (row.synthExposureKind === "trim_review") return "synth_trim";
  return "standard";
}

function payloadFromRow(
  row: SuggestionMonitorRow,
  simTable: SheetTable,
): RecommendationAlertPayload | null {
  if (!isAlertableRecommendation(row)) return null;
  if (!meetsRecommendationAlertConfidence(row)) return null;
  const simRow = buildSimRowByKeyMap(simTable.rows).get(row.key);
  const cd = String(simRow?.["Completion Date"] ?? simRow?.CD ?? "").trim();
  const uiAction = row.suggestedAction;
  const suggestedAction =
    uiAction === "review" && isSynthExposureUrgentAlert(row)
      ? "review"
      : uiAction === "sell"
        ? "sell"
        : uiAction === "hold"
          ? "hold"
          : uiAction === "buy"
            ? "buy"
            : null;
  if (!suggestedAction) return null;

  return {
    key: row.key,
    ticker: row.ticker,
    completionDate: cd,
    seriesKey: simRow ? simulationRowSeriesKey(simRow) : null,
    suggestedAction,
    signature: recommendationSignature(row),
    alertKind: alertKindFromRow(row),
    synthTargetCapEur: row.synthTargetCapEur,
  };
}

export function detectNewRecommendationAlerts(
  ctx: SuggestionMonitorContext,
): RecommendationAlertPayload[] {
  if (!ctx.simTable?.rows?.length) return [];
  const rows = buildSuggestionMonitorRows(ctx);
  if (!isRecommendationAlertsBootstrapped()) {
    bootstrapRecommendationSignatures(rows);
    return [];
  }
  const seen = loadSeenMap();
  const actionSeen = loadActionSeenMap();
  const out: RecommendationAlertPayload[] = [];
  for (const row of rows) {
    if (!isAlertableRecommendation(row)) continue;
    if (!meetsRecommendationAlertConfidence(row)) continue;
    const sig = recommendationSignature(row);
    const actionSig = recommendationActionSignature(row);
    if (actionSeen[row.key] === actionSig) continue;
    if (seen[row.key] === sig) continue;
    const payload = payloadFromRow(row, ctx.simTable);
    if (payload) out.push(payload);
  }
  return out.sort((a, b) => {
    const rank = (x: RecommendationAlertPayload) => {
      if (x.alertKind === "synth_sell") return 0;
      if (x.alertKind === "synth_trim") return 1;
      if (x.suggestedAction === "sell") return 2;
      if (x.suggestedAction === "hold") return 3;
      return 4;
    };
    const rd = rank(a) - rank(b);
    if (rd !== 0) return rd;
    return a.ticker.localeCompare(b.ticker);
  });
}

export function suggestionRowForAlert(
  ctx: SuggestionMonitorContext,
  alertKey: string,
): SuggestionMonitorRow | null {
  if (!ctx.simTable?.rows?.length) return null;
  return buildSuggestionMonitorRows(ctx).find((r) => r.key === alertKey) ?? null;
}
