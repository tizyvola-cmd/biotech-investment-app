/** Altezza grafico quando P(plan) e paper portfolio sono affiancati (dashboard + Invest/disinvest). */
export const DECISION_SIM_PAIR_CHART_HEIGHT = 208;

/** Compact chart height — legacy 3-across strip row. */
export const DECISION_SIM_STRIP_CHART_HEIGHT = 140;

/** Enlarged chart height — top error row + bottom experiment row. */
export const DECISION_SIM_EXPERIMENT_CHART_HEIGHT = 200;

/** Chart height for advice-error pair in the top row. */
export const DECISION_SIM_TOP_ERROR_CHART_HEIGHT = 200;

/** Total card row height for the 2 experiment charts (title + chart + footer). */
export const DECISION_SIM_EXPERIMENT_ROW_PX = 268;

/** Min height for the top row (advice calibration + error charts). */
export const DECISION_SIM_TOP_ROW_MIN_PX = 320;

/** Fallback pre-chart block height before ResizeObserver sync (px). */
export const DECISION_SIM_PAIR_PRECHART_FALLBACK_PX = 184;

/** Min height for the advice error timeline block (filter + caption + 2 charts + footers). */
export function adviceErrorTimelineBlockMinHeight(chartHeight: number): number {
  const filterRow = 26;
  const caption = 28;
  const title = 18;
  const footer = 14;
  const gaps = 16;
  return filterRow + caption + title + chartHeight + footer + gaps;
}
