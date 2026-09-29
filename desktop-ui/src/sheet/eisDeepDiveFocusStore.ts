/**
 * Focus payload for EIS inside Evaluation Lab deep-dive.
 * Callers set focus + dispatch OPEN event; App opens Simulation → Evaluation,
 * and PortfolioLossAnalysisView switches to the EIS sub-tab.
 */

export type EisDeepDiveFocus = {
  ticker: string;
  clinicalKpi: number | null;
  simRow: Record<string, unknown> | null;
  openedAt: number;
};

const CHANGE_EVENT = "supernova-eis-deep-dive-focus";
export const EIS_DEEP_DIVE_OPEN_EVENT = "supernova-open-eis-deep-dive";

let focus: EisDeepDiveFocus | null = null;

function emitChange(): void {
  try {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch {
    /* ignore */
  }
}

export function getEisDeepDiveFocus(): EisDeepDiveFocus | null {
  return focus;
}

export function setEisDeepDiveFocus(next: {
  ticker: string;
  clinicalKpi?: number | null;
  simRow?: Record<string, unknown> | null;
}): EisDeepDiveFocus {
  const ticker = String(next.ticker ?? "").trim().toUpperCase();
  focus = {
    ticker,
    clinicalKpi: next.clinicalKpi ?? null,
    simRow: next.simRow ?? null,
    openedAt: Date.now(),
  };
  emitChange();
  return focus;
}

export function clearEisDeepDiveFocus(): void {
  focus = null;
  emitChange();
}

export function subscribeEisDeepDiveFocus(cb: () => void): () => void {
  const handler = () => cb();
  try {
    window.addEventListener(CHANGE_EVENT, handler);
  } catch {
    /* ignore */
  }
  return () => {
    try {
      window.removeEventListener(CHANGE_EVENT, handler);
    } catch {
      /* ignore */
    }
  };
}

/** Open EIS inside Evaluation Lab deep-dive (App listens and navigates to Simulation). */
export function openEisDeepDive(opts: {
  ticker: string;
  clinicalKpi?: number | null;
  simRow?: Record<string, unknown> | null;
}): void {
  const tk = String(opts.ticker ?? "").trim();
  if (!tk) return;
  setEisDeepDiveFocus(opts);
  try {
    window.dispatchEvent(new CustomEvent(EIS_DEEP_DIVE_OPEN_EVENT));
  } catch {
    /* ignore */
  }
}
