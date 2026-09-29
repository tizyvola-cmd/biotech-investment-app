/**
 * Badge shown next to Var. 24h when the backend flagged the ticker as
 * low-liquidity noise (sub-dime warrant / thin volume + |Δ| > 15%).
 *
 * Behavior downstream: `decisionChartLogic.traceRecommendation` forces
 * REVIEW so the ticker is never classified as BUY/SELL on a movement
 * dominated by bid-ask bounce or fade-off-peak.
 *
 * Reference case: ERNAW on 2026-07-15 — closed −22.64% on 50,312 shares
 * (~$0.08 sub-dime warrant) while the correlated common ERNA closed
 * +11.06% on the same positive preclinical readout. The warrant number
 * is arithmetically correct (matches Yahoo bit-per-bit) but not
 * information-bearing about the issuer.
 */
export function LowLiqNoiseBadge({
  active,
  reason,
  lang = "it",
  size = "sm",
}: {
  active: boolean;
  /** Backend-provided context, e.g. "price=$0.0851<$1; ADV20=42,105<100k; |Δ|=22.6%". */
  reason?: string | null;
  lang?: "it" | "en";
  size?: "xs" | "sm";
}) {
  if (!active) return null;
  const it = lang === "it";
  const title = it
    ? `Segnale a bassa liquidità — probabile rumore di microstruttura (bid-ask bounce, fade dal picco intraday, warrant sub-dime). La raccomandazione è forzata a REVIEW.${
        reason ? `\nMotivo: ${reason}` : ""
      }`
    : `Low-liquidity signal — likely microstructure noise (bid-ask bounce, fade off intraday peak, sub-dime warrant). Recommendation forced to REVIEW.${
        reason ? `\nReason: ${reason}` : ""
      }`;
  const textCls = size === "xs" ? "text-[8px]" : "text-[9px]";
  return (
    <span
      className={`ml-1 inline-flex items-center rounded-sm border border-amber-400/60 bg-amber-50 px-1 py-[1px] font-semibold uppercase tracking-tight text-amber-800 dark:border-amber-500/50 dark:bg-amber-900/25 dark:text-amber-200 ${textCls}`}
      title={title}
      aria-label={title}
    >
      lo-liq
    </span>
  );
}
