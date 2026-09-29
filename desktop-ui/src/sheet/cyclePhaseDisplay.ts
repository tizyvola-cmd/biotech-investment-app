import type { CatalystCyclePhase } from "../api/catalystPatterns";

/**
 * Chart overlay labels — narrative: Catalyst (volume) → Drop → Rise → At High (multi-horizon peak).
 * Internal API ids unchanged for backend compatibility.
 *
 * CONTRATTO VISIVO: questi marker sono descrittivi/geometrici, MAI un'azione consigliata.
 * Non usare fill pieno né i colori verde/rosso riservati a Soft BUY/SELL.
 * Vedi handoff "Cycle overlay" + schema "Due Livelli, Due Segni" per il razionale.
 * (Già successo: exhaustion_exit era "Sell", poi "Buy" sullo stesso calcolo di picco.)
 */
export type CyclePhaseDisplay = {
  labelEn: string;
  labelIt: string;
  compactEn: string;
  compactIt: string;
  tipEn: string;
  tipIt: string;
};

export const CYCLE_PHASE_DISPLAY: Record<CatalystCyclePhase, CyclePhaseDisplay> = {
  pre_volume_watch: {
    labelEn: "Catalyst",
    labelIt: "Catalyst",
    compactEn: "Catalyst",
    compactIt: "Catalyst",
    tipEn:
      "Volume catalyst — sharp volume spike vs recent baseline; often anticipates the next price leg.",
    tipIt:
      "Catalyst volume — picco di volume vs baseline recente; spesso anticipa la prossima gamba di prezzo.",
  },
  dump_entry: {
    labelEn: "Drop",
    labelIt: "Drop",
    compactEn: "Drop",
    compactIt: "Drop",
    tipEn: "Drop — trough / shake-out zone on the visible price curve.",
    tipIt: "Drop — minimo / zona shake-out sulla curva visibile.",
  },
  exhaustion_exit: {
    labelEn: "At High",
    labelIt: "At High",
    compactEn: "At High",
    compactIt: "At High",
    tipEn:
      "At High — live price at/near the high vs 1W · 1M · 3M · 6M (tier = how many horizons). Geometric state, not Soft BUY.",
    tipIt:
      "At High — prezzo live al/near massimo vs 1 sett. · 1 mese · 3 mesi · 6 mesi (tier = quanti orizzonti). Stato geometrico, non Soft BUY.",
  },
};

export const RISE_PHASE_DISPLAY: CyclePhaseDisplay = {
  labelEn: "Rise",
  labelIt: "Rise",
  compactEn: "Rise",
  compactIt: "Rise",
  tipEn: "Rise — mid recovery between Drop trough and current peak (geometry only).",
  tipIt: "Rise — recupero intermedio tra il minimo Drop e il picco attuale (solo geometria).",
};

/** Unconfirmed drawdown — legacy dip hint. */
export const CYCLE_DUMP_UNCONFIRMED: CyclePhaseDisplay = {
  labelEn: "Drop (weak)",
  labelIt: "Drop (debole)",
  compactEn: "Drop?",
  compactIt: "Drop?",
  tipEn: "Price drawdown — possible dip, pattern not confirmed yet.",
  tipIt: "Drawdown — possibile dip, pattern non ancora confermato.",
};

export function cyclePhaseFullLabel(phase: CatalystCyclePhase, it: boolean): string {
  const d = CYCLE_PHASE_DISPLAY[phase];
  return it ? d.labelIt : d.labelEn;
}

export function cyclePhaseCompactLabel(phase: CatalystCyclePhase, it: boolean): string {
  const d = CYCLE_PHASE_DISPLAY[phase];
  return it ? d.compactIt : d.compactEn;
}

export function cyclePhaseTip(phase: CatalystCyclePhase, it: boolean): string {
  const d = CYCLE_PHASE_DISPLAY[phase];
  return it ? d.tipIt : d.tipEn;
}

export function overlayPhaseCompactLabel(
  phase: CatalystCyclePhase | "rise",
  it: boolean,
): string {
  if (phase === "rise") return it ? RISE_PHASE_DISPLAY.compactIt : RISE_PHASE_DISPLAY.compactEn;
  return cyclePhaseCompactLabel(phase, it);
}

export function overlayPhaseTip(phase: CatalystCyclePhase | "rise", it: boolean): string {
  if (phase === "rise") return it ? RISE_PHASE_DISPLAY.tipIt : RISE_PHASE_DISPLAY.tipEn;
  return cyclePhaseTip(phase, it);
}

export function cyclePhaseLabelsForApi(phase: CatalystCyclePhase): { label_en: string; label_it: string } {
  const d = CYCLE_PHASE_DISPLAY[phase];
  return { label_en: d.labelEn, label_it: d.labelIt };
}

export function buyPeakHorizonsTip(
  horizons: string[],
  tier: number,
  it: boolean,
): string {
  if (!horizons.length) return "";
  const list = horizons.join(" · ").toUpperCase();
  return it
    ? ` Picco multi-orizzonte (${tier}/4): ${list}.`
    : ` Multi-horizon peak (${tier}/4): ${list}.`;
}

export function catalystVolumeCoincidentTip(it: boolean): string {
  return it
    ? " Catalyst volume sullo stesso bar."
    : " Volume catalyst on the same bar.";
}
