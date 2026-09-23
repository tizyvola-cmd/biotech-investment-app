import type { RegulatoryRiskIndex } from "../sheet/regulatoryRiskIndex";
import {
  buildRegulatoryScoreBreakdown,
  formatRegulatoryScoreDisplay,
  regulatoryScoreBarColor,
  regulatoryScoreBarWidthPct,
  regulatoryScoreColorClass,
  regulatoryScoreSummaryLabel,
  type RegulatoryScoreBreakdownItemId,
} from "../sheet/regulatoryRiskIndex";
import { isMedtechTicker } from "../sheet/medtechSymbols";
import { useT, type TranslationKey } from "../shared/i18n";

function fmtContribution(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

export function RegulatoryRiskIndexSummary({
  score,
  index,
  it,
  compact = false,
  ticker,
  clinicalPhase,
  cleanScan,
}: {
  score: number;
  index: RegulatoryRiskIndex;
  it: boolean;
  compact?: boolean;
  ticker?: string | null;
  /** Must match options used in `computeRegulatoryRiskScore` / bundle. */
  clinicalPhase?: string | null;
  cleanScan?: boolean;
}) {
  const t = useT();
  const lang = it ? "it" : "en";
  const medtech = isMedtechTicker(ticker);
  const barW = regulatoryScoreBarWidthPct(score);
  const barColor = regulatoryScoreBarColor(score);

  const breakdown = buildRegulatoryScoreBreakdown(index, {
    clinicalPhase,
    cleanScan,
    isMedtech: medtech,
  });

  const itemLabel = (id: RegulatoryScoreBreakdownItemId): string =>
    t(`regulatoryScore.breakdown.item.${id}`);

  const detailLine = (id: RegulatoryScoreBreakdownItemId, raw: string): string => {
    const key = `regulatoryScore.breakdown.detail.${id}.${raw}` as TranslationKey;
    const translated = t(key);
    return translated !== key ? translated : raw;
  };

  return (
    <div
      className={`rounded-lg border border-[rgb(var(--border))]/45 bg-surface/60 space-y-2 ${
        compact ? "p-2.5" : "p-3"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted">
            {it ? "Indice regolatorio" : "Regulatory score"}
          </p>
          <p className="text-[10px] text-ink-muted/90 leading-snug mt-0.5">
            {it
              ? "Da K-8, Catalyst Hub e scan automatico · −100 favorevole · +100 rischio"
              : "From K-8, Catalyst Hub and auto scan · −100 favorable · +100 risk"}
          </p>
        </div>
        <div className="text-right shrink-0">
          <span
            className={`tabular-nums leading-none ${compact ? "text-xl font-black" : "text-2xl font-black"} ${regulatoryScoreColorClass(score)}`}
          >
            {formatRegulatoryScoreDisplay(score)}
          </span>
          <p className="text-[10px] text-ink-muted mt-1 max-w-[11rem] leading-snug">
            {regulatoryScoreSummaryLabel(score, lang)}
          </p>
        </div>
      </div>

      <div className="h-1.5 w-full bg-slate-200/80 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${barW}%`, background: barColor }}
        />
      </div>

      <div className={`space-y-1.5 text-[11px]${compact ? "" : " pt-0.5"}`}>
        {breakdown.items.length > 0 ? (
          breakdown.items.map((item) => {
            const favorable = item.contribution < 0;
            const risk = item.contribution > 0;
            return (
              <div
                key={item.id}
                className="flex items-start gap-2 p-2 rounded-lg bg-[rgb(var(--surface-alt))]/50"
              >
                <span
                  className={`font-bold mt-0.5 shrink-0 ${
                    risk
                      ? "text-rose-600"
                      : favorable
                        ? "text-[rgb(var(--signal-up))]"
                        : "text-ink-muted"
                  }`}
                >
                  ●
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-ink">{itemLabel(item.id)}</p>
                    <span
                      className={`shrink-0 font-bold tabular-nums ${
                        risk
                          ? "text-[rgb(var(--signal-down))]"
                          : favorable
                            ? "text-[rgb(var(--signal-up))]"
                            : "text-ink-muted"
                      }`}
                    >
                      {fmtContribution(item.contribution)}
                    </span>
                  </div>
                  {item.details.length > 0 ? (
                    <ul className="text-ink-muted space-y-0.5 mt-0.5">
                      {item.details.slice(0, 3).map((d, i) => (
                        <li key={i} className="line-clamp-2">
                          {detailLine(item.id, d)}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
            );
          })
        ) : (
          <p className="text-ink-muted/80 px-1 py-1">
            {it
              ? "Nessun componente attivo — score neutro."
              : "No active components — neutral score."}
          </p>
        )}

        {breakdown.path === "favorable" && breakdown.items.length > 0 ? (
          <p className="text-[10px] text-ink-muted/80 px-1 leading-snug">
            {it
              ? "Nessun rischio attivo (CRL / PDUFA / CMC / 510(k))."
              : "No active risk (CRL / PDUFA / CMC / 510(k))."}
          </p>
        ) : null}
      </div>
    </div>
  );
}
