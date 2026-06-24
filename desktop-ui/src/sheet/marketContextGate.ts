/**
 * Market context gate — sector regime (XBI/TLT/VIX) applied after buildPrecatEntry.
 */
import { fetchProjectJson } from "../data/projectData";
import type { PrecatEntryKind, PrecatEntrySignal } from "./precatCurve";

export type MarketRegime = "RISK_ON" | "NEUTRAL" | "RISK_OFF" | "CRISIS";

export type GatedPrecatKind = PrecatEntryKind | "hold";

export type MarketContextDoc = {
  version?: number;
  updated_at?: string;
  regime?: MarketRegime;
  signals?: {
    xbi_5d_return?: number | null;
    xbi_20d_return?: number | null;
    tlt_5d_return?: number | null;
    vix_level?: number | null;
    fallback?: boolean;
  };
  gate_reason?: string;
  history_7d?: Array<{ ts?: string; regime?: MarketRegime }>;
};

export type MarketGatePayload = {
  market_regime: MarketRegime;
  regime_gate_fired: boolean;
  original_signal: string;
  gated_signal: GatedPrecatKind;
  gate_reason: string;
  entry_allowed: boolean;
  watch_allowed: boolean;
};

const ENTRY_KINDS = new Set<PrecatEntryKind>(["enter", "accumulate"]);
const WATCH_LIKE = new Set<PrecatEntryKind>(["too_early"]);

export const MARKET_GATE_BYPASS_KEY = "supernova_market_gate_bypass";

const THRESHOLDS = {
  vix_crisis: 35,
  xbi_5d_crisis_pct: -8,
  xbi_5d_risk_off_pct: -3,
  xbi_20d_risk_off_pct: -6,
  tlt_5d_risk_off_pct: 1,
  xbi_5d_risk_on_pct: 2,
  xbi_20d_risk_on_pct: 3,
} as const;

let cachedContext: MarketContextDoc | null = null;

export function loadMarketGateBypass(): boolean {
  try {
    return localStorage.getItem(MARKET_GATE_BYPASS_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveMarketGateBypass(on: boolean): void {
  try {
    if (on) localStorage.setItem(MARKET_GATE_BYPASS_KEY, "1");
    else localStorage.removeItem(MARKET_GATE_BYPASS_KEY);
  } catch {
    /* ignore */
  }
}

export function classifyRegime(signals: MarketContextDoc["signals"]): MarketRegime {
  const vix = signals?.vix_level;
  const x5 = signals?.xbi_5d_return;
  const x20 = signals?.xbi_20d_return;
  const t5 = signals?.tlt_5d_return;

  if (vix != null && vix > THRESHOLDS.vix_crisis) return "CRISIS";
  if (x5 != null && x5 < THRESHOLDS.xbi_5d_crisis_pct) return "CRISIS";

  if (x5 != null && x5 < THRESHOLDS.xbi_5d_risk_off_pct) return "RISK_OFF";
  if (
    x20 != null &&
    x20 < THRESHOLDS.xbi_20d_risk_off_pct &&
    t5 != null &&
    t5 > THRESHOLDS.tlt_5d_risk_off_pct
  ) {
    return "RISK_OFF";
  }

  if (
    x5 != null &&
    x5 > THRESHOLDS.xbi_5d_risk_on_pct &&
    x20 != null &&
    x20 > THRESHOLDS.xbi_20d_risk_on_pct
  ) {
    return "RISK_ON";
  }

  return "NEUTRAL";
}

export function regimeGateReason(regime: MarketRegime, signals: MarketContextDoc["signals"]): string {
  const x5 = signals?.xbi_5d_return;
  const vix = signals?.vix_level;
  if (regime === "CRISIS") {
    if (vix != null && vix > THRESHOLDS.vix_crisis) return `VIX ${vix.toFixed(1)} — crisis volatility`;
    if (x5 != null) return `XBI ${x5 >= 0 ? "+" : ""}${x5.toFixed(1)}% over 5d — sector crash`;
    return "Sector crisis conditions";
  }
  if (regime === "RISK_OFF") {
    if (x5 != null) return `XBI ${x5 >= 0 ? "+" : ""}${x5.toFixed(1)}% over 5d — sector risk-off`;
    return "Sector risk-off (rates + biotech weakness)";
  }
  if (regime === "RISK_ON") return "Sector risk-on — biotech momentum supportive";
  return "Sector neutral — no macro gate";
}

export function applyRegimeToPrecatKind(
  originalKind: PrecatEntryKind,
  regime: MarketRegime,
): { gated: GatedPrecatKind; fired: boolean; suffix: string | null } {
  if (regime === "RISK_ON" || regime === "NEUTRAL") {
    return { gated: originalKind, fired: false, suffix: null };
  }

  if (regime === "RISK_OFF") {
    if (ENTRY_KINDS.has(originalKind)) {
      return { gated: "hold", fired: true, suffix: "entries paused (risk-off)" };
    }
    return { gated: originalKind, fired: false, suffix: null };
  }

  // CRISIS
  if (originalKind === "sell") return { gated: originalKind, fired: false, suffix: null };
  if (ENTRY_KINDS.has(originalKind) || WATCH_LIKE.has(originalKind) || originalKind === "late") {
    return { gated: "avoid", fired: true, suffix: "all signals suspended (crisis)" };
  }
  if (originalKind === "avoid") return { gated: originalKind, fired: false, suffix: null };
  return { gated: "hold", fired: true, suffix: "watch suspended (crisis)" };
}

export function buildGatePayload(
  originalKind: PrecatEntryKind,
  regime: MarketRegime,
  signals: MarketContextDoc["signals"],
): MarketGatePayload {
  const { gated, fired, suffix } = applyRegimeToPrecatKind(originalKind, regime);
  const baseReason = regimeGateReason(regime, signals);
  const reason = suffix ? `${baseReason} — ${suffix}` : baseReason;
  return {
    market_regime: regime,
    regime_gate_fired: fired,
    original_signal: originalKind,
    gated_signal: gated,
    gate_reason: reason,
    entry_allowed: (regime === "RISK_ON" || regime === "NEUTRAL") && ENTRY_KINDS.has(originalKind),
    watch_allowed: regime !== "CRISIS",
  };
}

export function getCachedMarketContext(): MarketContextDoc | null {
  return cachedContext;
}

export function setCachedMarketContext(doc: MarketContextDoc | null): void {
  cachedContext = doc;
}

export async function loadMarketContextDoc(): Promise<MarketContextDoc> {
  const res = await fetchProjectJson<MarketContextDoc>("market_context.json");
  const doc = res.data ?? { regime: "NEUTRAL", signals: {} };
  cachedContext = doc;
  return doc;
}

export function effectiveRegime(doc: MarketContextDoc | null | undefined): MarketRegime {
  if (!doc) return "NEUTRAL";
  if (doc.regime) return doc.regime;
  return classifyRegime(doc.signals);
}

/** Apply gate to precat entry; respects manual bypass in settings. */
export function applyMarketContextGate(
  precat: PrecatEntrySignal,
  ctx?: MarketContextDoc | null,
  opts?: { bypass?: boolean },
): { precat: PrecatEntrySignal; gate: MarketGatePayload | null } {
  const bypass = opts?.bypass ?? loadMarketGateBypass();
  if (bypass) {
    return { precat, gate: null };
  }

  const doc = ctx ?? cachedContext;
  const regime = effectiveRegime(doc);
  const signals = doc?.signals;
  const gate = buildGatePayload(precat.kind, regime, signals);
  return { precat, gate };
}

/** Kind used by strict top-pick filters (hold blocks entry). */
export function effectivePrecatKindForPick(
  originalKind: PrecatEntryKind | string | undefined,
  gate: MarketGatePayload | null | undefined,
): GatedPrecatKind {
  if (gate?.gated_signal) return gate.gated_signal;
  return (originalKind as GatedPrecatKind) ?? "avoid";
}

export function regimePillClass(regime: MarketRegime): string {
  switch (regime) {
    case "RISK_ON":
      return "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
    case "RISK_OFF":
      return "bg-amber-500/20 text-amber-300 border-amber-500/40";
    case "CRISIS":
      return "bg-red-500/25 text-red-300 border-red-500/50";
    default:
      return "bg-surface text-ink-muted border-[rgb(var(--border))]/60";
  }
}
