/** Gain ★ snapshot — one active star per ticker (today only). */

export type GainStarSnapshot = {
  date: string;
  source: "manual";
  eisScore: number;
  colorIndex: number;
  color: string;
  context: "loss" | "gain";
};

export function gainStarsForTicker(
  byTicker: Record<string, GainStarSnapshot[]> | null | undefined,
  ticker: string,
): GainStarSnapshot[] {
  const stars = byTicker?.[ticker.trim().toUpperCase()] ?? [];
  return stars.length ? [stars[stars.length - 1]!] : [];
}

export function manualEisForTicker(
  byTicker: Record<string, import("./manualFeedStore").MobileManualEisRow> | null | undefined,
  ticker: string,
): import("./manualFeedStore").MobileManualEisRow | null {
  return byTicker?.[ticker.trim().toUpperCase()] ?? null;
}

export function GainStarMarks({
  stars,
  className = "",
}: {
  stars: GainStarSnapshot[];
  max?: number;
  className?: string;
}) {
  const star = stars.length ? stars[stars.length - 1] : null;
  if (!star) return null;
  return (
    <span className={`gain-star-marks ${className}`.trim()} aria-hidden>
      <span
        className="gain-star-mark"
        style={{ color: star.color }}
        title={`${star.date} · EIS ${star.eisScore >= 0 ? "+" : ""}${star.eisScore.toFixed(1)} · 24h ${star.context}`}
      >
        ★
      </span>
    </span>
  );
}

/** Gold ★ before ledger confirmation — manual EIS gain thesis not yet starred. */
export function ProvisionalGainStar({ className = "" }: { className?: string }) {
  return (
    <span
      className={`gain-star-mark gain-star-mark--provisional ${className}`.trim()}
      title="EIS manuale positivo — conferma capitale in attesa"
      aria-hidden
    >
      ★
    </span>
  );
}

export function ManualEisBadge({
  row,
  className = "",
}: {
  row: import("./manualFeedStore").MobileManualEisRow | null | undefined;
  className?: string;
}) {
  if (!row) return null;
  const tone = row.polarity === "positive" ? "positive" : "negative";
  return (
    <span
      className={`manual-eis-badge manual-eis-badge--${tone} ${className}`.trim()}
      title={row.title}
    >
      EIS {row.score >= 0 ? "+" : ""}
      {row.score.toFixed(0)}
      {row.showProvisionalStar ? <ProvisionalGainStar className="manual-eis-provisional-star" /> : null}
    </span>
  );
}

export function TickerGainAndManualMarks({
  ticker,
  dashSnapshot,
  className = "",
}: {
  ticker: string;
  dashSnapshot: import("./dashboardTypes").MobileDashboardSnapshot | null | undefined;
  className?: string;
}) {
  const stars = gainStarsForTicker(dashSnapshot?.gainStarsByTicker, ticker);
  const manual = manualEisForTicker(dashSnapshot?.manualEisByTicker, ticker);
  if (!stars.length && !manual) return null;
  return (
    <span className={`ticker-gain-manual-marks ${className}`.trim()}>
      {stars.length ? <GainStarMarks stars={stars} className="ticker-confirmed-stars" /> : null}
      {!stars.length && manual?.showProvisionalStar ? (
        <ProvisionalGainStar className="ticker-provisional-star" />
      ) : null}
      {manual ? <ManualEisBadge row={manual} className="ticker-manual-eis" /> : null}
    </span>
  );
}
