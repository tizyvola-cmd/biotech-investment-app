import type { ClinicalStudyIndicator } from "../api/supernova";
import {
  CLINICAL_KPI_TYPE_LABEL,
  clinicalKpiBadgeClass,
  directionColor,
  directionGlyph,
  indicatorIsContextOnly,
  indicatorIsOutcome,
  prepareClinicalIndicators,
} from "../sheet/clinicalIndicators";

type ChipVariant = "default" | "table";

function chipSizing(variant: ChipVariant) {
  if (variant === "table") {
    return {
      card: "px-2.5 py-2 text-[11px] leading-snug bg-[rgb(var(--surface))] shadow-sm",
      label: "text-[11px] font-semibold text-ink leading-snug break-words",
      value: "font-bold text-ink text-[12px] leading-snug",
      kpi: "text-[10px] font-bold px-1.5 py-0.5 rounded",
      ctx: "text-[10px] font-bold px-1.5 py-0.5 rounded border border-dashed border-[rgb(var(--border))] text-ink-muted bg-[rgb(var(--surface-2))]",
      meta: "text-[10px] font-mono text-ink-muted",
      ep: "text-[10px] font-semibold",
      footer: "text-[10px] text-ink-muted",
      grid: "flex flex-col gap-2",
      labelMax: 120,
    };
  }
  return {
    card: "px-2 py-1.5 text-[10px] leading-tight bg-[rgb(var(--surface))]/90 shadow-sm",
    label: "text-[10px] font-semibold text-ink leading-snug break-words",
    value: "font-bold text-ink text-[11px] leading-snug",
    kpi: "text-[9px] font-bold px-1.5 py-0.5 rounded",
    ctx: "text-[9px] font-bold px-1.5 py-0.5 rounded border border-dashed border-[rgb(var(--border))] text-ink-muted",
    meta: "text-[9px] font-mono text-ink-muted",
    ep: "text-[9px] font-semibold",
    footer: "text-[9px] text-ink-muted",
    grid: "grid grid-cols-1 sm:grid-cols-2 gap-1.5",
    labelMax: 48,
  };
}

export function ClinicalIndicatorChips({
  indicators,
  it = false,
  maxShown = 3,
  className = "",
  variant = "default",
}: {
  indicators?: ClinicalStudyIndicator[] | null;
  it?: boolean;
  maxShown?: number;
  className?: string;
  /** `table` = single-column, larger type for feed grid columns */
  variant?: ChipVariant;
}) {
  const valid = prepareClinicalIndicators(indicators ?? []);
  const sz = chipSizing(variant);

  if (!valid.length) {
    return (
      <span className={`text-[11px] text-ink-muted ${className}`.trim()}>
        {it ? "Nessun KPI clinico quantificabile" : "No quantifiable clinical KPIs"}
      </span>
    );
  }

  const shown = valid.slice(0, maxShown);
  const extra = valid.length - shown.length;
  const hasOutcome = valid.some(indicatorIsOutcome);

  return (
    <div
      className={`flex flex-col gap-2 min-w-0 ${variant === "table" ? "min-w-[220px] max-w-[320px]" : ""} ${className}`.trim()}
    >
      <div className={sz.grid}>
        {shown.map((ind, i) => {
          const contextOnly = indicatorIsContextOnly(ind);
          const up = ind.direction === "up" || ind.endpoint_met === true;
          const down = ind.direction === "down" || ind.endpoint_met === false;
          const borderColor = contextOnly
            ? "rgb(var(--panel-feed-border-soft))"
            : up
              ? "rgb(var(--panel-mint-border))"
              : down
                ? "rgb(var(--signal-down) / 0.45)"
                : "rgb(var(--panel-feed-border-soft))";
          const rawLabel = (ind.label ?? "").trim();
          const labelShort =
            rawLabel.length > sz.labelMax
              ? `${rawLabel.slice(0, sz.labelMax - 1)}…`
              : rawLabel;
          const glyph = directionGlyph(ind.direction);
          const glyphColor = directionColor(ind.direction);
          const epBadge =
            ind.endpoint_met === true
              ? { text: it ? "✓ endpoint raggiunto" : "✓ endpoint met", cls: "text-green-700 dark:text-green-400" }
              : ind.endpoint_met === false
                ? { text: it ? "✗ endpoint mancato" : "✗ endpoint missed", cls: "text-red-600 dark:text-red-400" }
                : null;
          const kpiTag = ind.kpi_type ? CLINICAL_KPI_TYPE_LABEL[ind.kpi_type] ?? "" : "";
          const tooltip = [ind.label, ind.value, ind.vs_soc, ind.trend_note, ind.p_value]
            .filter(Boolean)
            .join(" · ");

          return (
            <div
              key={`${ind.label}-${ind.value}-${i}`}
              className={`rounded-md border-l-[3px] border border-[rgb(var(--border))]/50 ${sz.card} ${
                contextOnly ? "border-dashed opacity-90" : ""
              }`}
              style={{ borderLeftColor: borderColor }}
              title={tooltip || undefined}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className={`${sz.label} flex-1 min-w-0`}>
                  {labelShort || (it ? "Indicatore clinico" : "Clinical indicator")}
                </span>
                {contextOnly ? (
                  <span className={`${sz.ctx} shrink-0`}>CTX</span>
                ) : kpiTag ? (
                  <span
                    className={`${sz.kpi} shrink-0 ${clinicalKpiBadgeClass(ind.kpi_type)}`}
                    title={ind.kpi_type ?? undefined}
                  >
                    {kpiTag}
                  </span>
                ) : null}
              </div>
              <div className="flex items-start gap-1.5">
                <span className={`${sz.value} flex-1 break-words`}>{ind.value}</span>
                {glyph ? (
                  <span style={{ color: glyphColor }} className="font-bold shrink-0 text-sm mt-0.5">
                    {glyph}
                  </span>
                ) : null}
              </div>
              {(ind.p_value || ind.confidence_interval || ind.vs_soc) && (
                <div className={`mt-1 ${sz.meta} flex flex-col gap-0.5`}>
                  {ind.p_value ? <span>p = {ind.p_value}</span> : null}
                  {ind.confidence_interval ? <span>{ind.confidence_interval}</span> : null}
                  {ind.vs_soc ? <span>{ind.vs_soc}</span> : null}
                </div>
              )}
              {epBadge ? (
                <span className={`${sz.ep} mt-1 block ${epBadge.cls}`}>{epBadge.text}</span>
              ) : null}
            </div>
          );
        })}
      </div>
      {extra > 0 ? (
        <span className={`${sz.footer} pl-0.5 font-medium`}>
          +{extra} {it ? "altri indicatori" : "more indicators"}
        </span>
      ) : null}
      {!hasOutcome ? (
        <span className={`${sz.footer} leading-snug`}>
          {it
            ? "Solo contesto CT.gov — nessun KPI di esito pubblicato"
            : "Registry context only — no published outcome KPI"}
        </span>
      ) : null}
    </div>
  );
}

/** Blocco riepilogo indici clinici per EIS / feed. */
export function ClinicalIndicatorSummaryBlock({
  title,
  indicators,
  it = false,
  maxShown = 6,
  note,
}: {
  title: string;
  indicators?: ClinicalStudyIndicator[] | null;
  it?: boolean;
  maxShown?: number;
  note?: string;
}) {
  const valid = prepareClinicalIndicators(indicators ?? []);
  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/45 bg-surface/50 p-3 space-y-2">
      <p className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted/90">{title}</p>
      <ClinicalIndicatorChips indicators={valid} it={it} maxShown={maxShown} />
      {note ? (
        <p className="text-[10px] text-ink-muted leading-snug border-t border-[rgb(var(--border))]/30 pt-2">
          {note}
        </p>
      ) : null}
    </div>
  );
}
