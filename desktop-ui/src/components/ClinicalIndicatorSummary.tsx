import { useState, type CSSProperties } from "react";
import type { ClinicalStudyIndicator, DiseaseSocContext, SocCompareFlag } from "../api/supernova";
import {
  CLINICAL_KPI_TYPE_LABEL,
  clinicalKpiBadgeClass,
  describeClinicalIndicator,
  directionColor,
  directionGlyph,
  indicatorIsContextOnly,
  indicatorIsEfficacy,
  indicatorIsOutcome,
  localizeClinicalIndicatorLabel,
  localizeClinicalIndicatorValue,
  localizeClinicalKpiType,
  normalizeIndicatorDate,
  prepareClinicalIndicators,
  resolveClinicalIndicatorHref,
  summarizeClinicalEfficacySafety,
} from "../sheet/clinicalIndicators";
import {
  resolveEfficacySocCompareWithDisease,
  socFlagLabel,
  socNoneLabel,
  type EfficacySocCompare,
} from "../sheet/clinicalSocCompare";
import {
  formatKpiUnitScoreBadge,
  kpiIndicatorUnitScore,
} from "../sheet/eventImpactScore";
import { openExternalUrl } from "../sheet/k8ChartLinks";

function fmtIndicatorDate(iso: string | null | undefined, it: boolean): string | null {
  const d = normalizeIndicatorDate(iso);
  if (!d) return null;
  const dt = new Date(`${d}T12:00:00`);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString(it ? "it-IT" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function readoutDateRangeLabel(
  indicators: ClinicalStudyIndicator[],
  it: boolean,
): string | null {
  const dates = indicators
    .map((i) => normalizeIndicatorDate(i.indicator_date))
    .filter((d): d is string => Boolean(d))
    .sort();
  if (!dates.length) return null;
  const lo = fmtIndicatorDate(dates[0], it);
  const hi = fmtIndicatorDate(dates[dates.length - 1], it);
  if (!lo) return null;
  if (lo === hi || dates.length === 1) {
    return it ? `Pubblicazione: ${lo}` : `Readout: ${lo}`;
  }
  return it ? `Pubblicazione: ${lo} → ${hi}` : `Readout: ${lo} → ${hi}`;
}

type ChipVariant = "default" | "table" | "summary" | "studyCard";

function chipSizing(variant: ChipVariant) {
  if (variant === "studyCard") {
    return {
      card: "px-2.5 py-2 text-[11px] leading-snug bg-[rgb(var(--surface))] shadow-sm",
      label: "text-[11px] font-semibold text-ink leading-snug break-words",
      value: "font-bold text-ink text-[13px] leading-snug",
      desc: "text-[10px] text-ink leading-snug",
      kpi: "text-[10px] font-bold px-1.5 py-0.5 rounded",
      ctx: "text-[10px] font-bold px-1.5 py-0.5 rounded border border-dashed border-[rgb(var(--border))] text-ink-muted bg-[rgb(var(--surface-2))]",
      meta: "text-[10px] font-mono text-ink-muted",
      ep: "text-[10px] font-semibold",
      footer: "text-[10px] text-ink-muted",
      grid: "flex flex-col gap-2",
      labelMax: 220,
      showDesc: true,
    };
  }
  if (variant === "table") {
    return {
      card: "px-2.5 py-2 text-[11px] leading-snug bg-[rgb(var(--surface))] shadow-sm",
      label: "text-[11px] font-semibold text-ink leading-snug break-words",
      value: "font-bold text-ink text-[12px] leading-snug",
      desc: "text-[10px] text-ink leading-snug",
      kpi: "text-[10px] font-bold px-1.5 py-0.5 rounded",
      ctx: "text-[10px] font-bold px-1.5 py-0.5 rounded border border-dashed border-[rgb(var(--border))] text-ink-muted bg-[rgb(var(--surface-2))]",
      meta: "text-[10px] font-mono text-ink-muted",
      ep: "text-[10px] font-semibold",
      footer: "text-[10px] text-ink-muted",
      grid: "flex flex-col gap-2",
      labelMax: 160,
      showDesc: false,
    };
  }
  if (variant === "summary") {
    return {
      card: "px-2.5 py-2 text-[11px] leading-snug bg-[rgb(var(--surface))]/90 shadow-sm",
      label: "text-[11px] font-semibold text-ink leading-snug break-words",
      value: "font-bold text-ink text-[12px] leading-snug",
      desc: "text-[10px] text-ink/90 leading-snug",
      kpi: "text-[9px] font-bold px-1.5 py-0.5 rounded",
      ctx: "text-[9px] font-bold px-1.5 py-0.5 rounded border border-dashed border-[rgb(var(--border))] text-ink-muted",
      meta: "text-[10px] font-mono text-ink-muted",
      ep: "text-[9px] font-semibold",
      footer: "text-[10px] text-ink-muted",
      grid: "grid grid-cols-1 sm:grid-cols-2 gap-2",
      labelMax: 220,
      showDesc: true,
    };
  }
  return {
    card: "px-2 py-1.5 text-[10px] leading-tight bg-[rgb(var(--surface))]/90 shadow-sm",
    label: "text-[10px] font-semibold text-ink leading-snug break-words",
    value: "font-bold text-ink text-[11px] leading-snug",
    desc: "text-[9px] text-ink-muted leading-snug",
    kpi: "text-[9px] font-bold px-1.5 py-0.5 rounded",
    ctx: "text-[9px] font-bold px-1.5 py-0.5 rounded border border-dashed border-[rgb(var(--border))] text-ink-muted",
    meta: "text-[9px] font-mono text-ink-muted",
    ep: "text-[9px] font-semibold",
    footer: "text-[9px] text-ink-muted",
    grid: "grid grid-cols-1 sm:grid-cols-2 gap-1.5",
    labelMax: 48,
    showDesc: false,
  };
}

function socFlagClass(flag: SocCompareFlag): string {
  if (flag === "beat") return "text-emerald-800 bg-emerald-50 border-emerald-400/70";
  if (flag === "match") return "text-amber-800 bg-amber-50 border-amber-400/70";
  if (flag === "miss") return "text-rose-800 bg-rose-50 border-rose-400/70";
  return "text-ink-muted bg-[rgb(var(--surface-2))] border-[rgb(var(--border))]/50";
}

function SocFlagBadge({
  flag,
  it,
  dense,
}: {
  flag: SocCompareFlag;
  it: boolean;
  dense?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded border font-bold tabular-nums ${
        dense ? "text-[9px] px-1 py-px" : "text-[10px] px-1.5 py-0.5"
      } ${socFlagClass(flag)}`}
      title={
        it
          ? "Confronto vs SoC di malattia (non è una linea guida certificata)"
          : "Vs disease SoC (not a certified guideline)"
      }
    >
      <span aria-hidden>⚑</span>
      {socFlagLabel(flag, it)}
    </span>
  );
}

function SocCompareRow({
  cmp,
  it,
  dense,
}: {
  cmp: EfficacySocCompare;
  it: boolean;
  dense?: boolean;
}) {
  const name =
    cmp.socIsNone || cmp.socName === "none"
      ? socNoneLabel(it)
      : cmp.socName || (it ? "SoC non nominato" : "SoC unnamed");
  return (
    <div
      className={`mt-1.5 rounded-md border border-[rgb(var(--border))]/40 bg-[rgb(var(--surface-2))]/70 ${
        dense ? "px-1.5 py-1" : "px-2 py-1.5"
      }`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <SocFlagBadge flag={cmp.flag} it={it} dense={dense} />
        <span className={`${dense ? "text-[9px]" : "text-[10px]"} font-semibold text-ink`}>
          {it ? "SoC" : "SoC"}: {name}
        </span>
      </div>
      {cmp.socBenchmark ? (
        <p className={`${dense ? "text-[9px]" : "text-[10px]"} text-ink-muted leading-snug mt-0.5`}>
          {it ? "Benchmark" : "Benchmark"}: {cmp.socBenchmark}
        </p>
      ) : cmp.flag !== "unknown" ? (
        <p className={`${dense ? "text-[9px]" : "text-[10px]"} text-ink-muted leading-snug mt-0.5`}>
          {it
            ? "Benchmark numerico SoC non estratto — solo giudizio."
            : "Numeric SoC benchmark not extracted — judgement only."}
        </p>
      ) : null}
    </div>
  );
}

export function DiseaseSocBanner({
  ctx,
  it = false,
}: {
  ctx: DiseaseSocContext | null | undefined;
  it?: boolean;
}) {
  if (!ctx) return null;
  const hasBody =
    ctx.disease ||
    ctx.usa_prevalence ||
    ctx.five_year_survival ||
    ctx.soc_name ||
    ctx.soc_is_none ||
    ctx.soc_efficacy_benchmark ||
    ctx.life_expectancy ||
    ctx.symptoms;
  if (!hasBody) return null;
  const socName =
    ctx.soc_is_none || ctx.soc_name === "none"
      ? socNoneLabel(it)
      : ctx.soc_name?.trim() || (it ? "non definito per questa malattia" : "not defined for this disease");
  return (
    <div className="rounded-md border border-[rgb(var(--accent))]/25 bg-[rgb(var(--accent))]/6 px-2.5 py-2 space-y-1">
      <p className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted">
        {it ? "Standard of care (malattia)" : "Standard of care (disease)"}
      </p>
      {ctx.disease ? (
        <p className="text-[11px] text-ink leading-snug">
          <span className="font-semibold">{it ? "Malattia" : "Disease"}:</span> {ctx.disease}
        </p>
      ) : null}
      {ctx.usa_prevalence ? (
        <p className="text-[11px] text-ink leading-snug">
          <span className="font-semibold">{it ? "Prevalenza USA" : "USA prevalence"}:</span>{" "}
          {ctx.usa_prevalence}
        </p>
      ) : (
        <p className="text-[10px] text-ink-muted leading-snug">
          {it
            ? "Prevalenza USA: non ancora estratta — aggiorna il feed clinico."
            : "USA prevalence: not extracted yet — refresh the clinical feed."}
        </p>
      )}
      {ctx.five_year_survival ? (
        <p className="text-[11px] text-ink leading-snug">
          <span className="font-semibold">
            {it ? "Sopravvivenza a 5 anni" : "5-year survival"}:
          </span>{" "}
          {ctx.five_year_survival}
        </p>
      ) : null}
      <p className="text-[11px] text-ink leading-snug">
        <span className="font-semibold">SoC:</span> {socName}
      </p>
      {ctx.soc_efficacy_benchmark ? (
        <p className="text-[11px] text-ink leading-snug">
          <span className="font-semibold">{it ? "Benchmark efficacia" : "Efficacy benchmark"}:</span>{" "}
          {ctx.soc_efficacy_benchmark}
        </p>
      ) : (
        <p className="text-[10px] text-ink-muted leading-snug">
          {it
            ? "Benchmark efficacia SoC: non ancora estratto — aggiorna il feed clinico (Deep)."
            : "SoC efficacy benchmark: not extracted yet — refresh the clinical feed (Deep)."}
        </p>
      )}
      {ctx.source_note ? (
        <p className="text-[10px] text-ink-muted leading-snug">
          <span className="font-semibold">{it ? "Nota" : "Note"}:</span> {ctx.source_note}
        </p>
      ) : null}
      {ctx.life_expectancy ? (
        <p className="text-[11px] text-ink leading-snug">
          <span className="font-semibold">{it ? "Aspettativa di vita" : "Life expectancy"}:</span>{" "}
          {ctx.life_expectancy}
        </p>
      ) : (
        <p className="text-[10px] text-ink-muted leading-snug">
          {it
            ? "Aspettativa di vita: non ancora estratta — aggiorna il feed clinico."
            : "Life expectancy: not extracted yet — refresh the clinical feed."}
        </p>
      )}
      {ctx.symptoms ? (
        <p className="text-[11px] text-ink leading-snug">
          <span className="font-semibold">{it ? "Sintomi" : "Symptoms"}:</span> {ctx.symptoms}
        </p>
      ) : (
        <p className="text-[10px] text-ink-muted leading-snug">
          {it
            ? "Sintomi tipici: non ancora estratti — aggiorna il feed clinico."
            : "Typical symptoms: not extracted yet — refresh the clinical feed."}
        </p>
      )}
      <p className="text-[9px] text-ink-muted leading-snug">
        {it
          ? "Estratto da studio / SoC pubblicato — non sostituisce NCCN o scheda tecnica."
          : "From trial / published SoC — not a substitute for NCCN or the label."}
      </p>
    </div>
  );
}

export function ClinicalIndicatorChips({
  indicators,
  it = false,
  maxShown = 3,
  className = "",
  variant = "default",
  onExpand,
  diseaseSoc,
  nctId,
}: {
  indicators?: ClinicalStudyIndicator[] | null;
  it?: boolean;
  maxShown?: number;
  className?: string;
  /** `table` = single-column, larger type for feed grid columns */
  variant?: ChipVariant;
  /**
   * Optional external expand handler. If omitted, "+N more" toggles the full list inline
   * so deep-dive / summary blocks never leave a dead “+17 more” label.
   */
  onExpand?: () => void;
  /** Disease-level SoC — used to infer beat/match/miss when KPI lacks vs_soc */
  diseaseSoc?: DiseaseSocContext | null;
  /** Study NCT — fallback CT.gov link when source is ctgov and KPI has no own URL */
  nctId?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const valid = prepareClinicalIndicators(indicators ?? []);
  const sz = chipSizing(variant);

  if (!valid.length) {
    return (
      <span className={`text-[11px] text-ink-muted ${className}`.trim()}>
        {it ? "Nessun KPI clinico quantificabile" : "No quantifiable clinical KPIs"}
      </span>
    );
  }

  // External onExpand = parent handles expand (keep preview). Else toggle full list inline.
  const shown = onExpand
    ? valid.slice(0, maxShown)
    : valid.slice(0, expanded ? valid.length : maxShown);
  const hiddenCount = Math.max(0, valid.length - shown.length);
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
          const railColor = contextOnly
            ? "rgb(var(--panel-feed-border-soft))"
            : up
              ? "#0B8F62"
              : down
                ? "#BE123C"
                : "rgb(var(--panel-feed-border-soft))";
          const cardTone: CSSProperties | undefined = contextOnly
            ? undefined
            : up
              ? {
                  background: "rgb(var(--positive) / 0.22)",
                  borderColor: "rgb(var(--positive) / 0.38)",
                }
              : down
                ? {
                    background: "rgb(var(--negative) / 0.16)",
                    borderColor: "rgb(var(--negative) / 0.38)",
                  }
                : undefined;
          const rawLabel = (ind.label ?? "").trim();
          const displayLabel = localizeClinicalIndicatorLabel(rawLabel, it);
          const labelShort =
            displayLabel.length > sz.labelMax
              ? `${displayLabel.slice(0, sz.labelMax - 1)}…`
              : displayLabel;
          const displayValue = localizeClinicalIndicatorValue(ind.value ?? "", it);
          const displayVsSoc = localizeClinicalIndicatorValue(ind.vs_soc ?? "", it);
          const socCmp = indicatorIsEfficacy(ind)
            ? resolveEfficacySocCompareWithDisease(ind, diseaseSoc)
            : null;
          const glyph = directionGlyph(ind.direction);
          const glyphColor = directionColor(ind.direction);
          const epBadge =
            ind.endpoint_met === true
              ? { text: it ? "✓ endpoint raggiunto" : "✓ endpoint met", cls: "text-[rgb(var(--positive))]" }
              : ind.endpoint_met === false
                ? { text: it ? "✗ endpoint mancato" : "✗ endpoint missed", cls: "text-[rgb(var(--negative))]" }
                : null;
          const kpiTag = ind.kpi_type ? CLINICAL_KPI_TYPE_LABEL[ind.kpi_type] ?? "" : "";
          const unitScore = contextOnly ? 0 : kpiIndicatorUnitScore(ind);
          const scoreBadge = formatKpiUnitScoreBadge(unitScore);
          const scoreCls =
            unitScore > 0.05
              ? "text-emerald-800 dark:text-emerald-300 bg-emerald-50/90 border-emerald-300/70"
              : unitScore < -0.05
                ? "text-rose-800 dark:text-rose-300 bg-rose-50/90 border-rose-300/70"
                : "text-ink-muted bg-[rgb(var(--surface-2))] border-[rgb(var(--border))]/50";
          const pubDate = fmtIndicatorDate(ind.indicator_date, it);
          const sourceBit = [ind.publication_venue, ind.source].filter(Boolean).join(" · ");
          const sourceHref = resolveClinicalIndicatorHref(ind, { nctId });
          const desc = describeClinicalIndicator(ind, it);
          const tooltip = [
            displayLabel,
            desc,
            displayValue,
            pubDate
              ? it
                ? `pubblicato ${pubDate}`
                : `published ${pubDate}`
              : null,
            sourceBit || null,
            sourceHref || null,
            socCmp
              ? `${socFlagLabel(socCmp.flag, it)} · ${
                  socCmp.socIsNone || socCmp.socName === "none"
                    ? socNoneLabel(it)
                    : socCmp.socName || "SoC"
                }${socCmp.socBenchmark ? ` · ${socCmp.socBenchmark}` : ""}`
              : displayVsSoc,
            ind.p_value,
            scoreBadge
              ? it
                ? `${scoreBadge} (punteggio sintetico EIS — non sostituisce la descrizione)`
                : `${scoreBadge} (EIS summary score — does not replace the description)`
              : null,
          ]
            .filter(Boolean)
            .join(" · ");

          return (
            <div
              key={`${ind.label}-${ind.value}-${i}`}
              className={`rounded-md border-l-[4px] border ${sz.card} ${
                contextOnly ? "border-dashed opacity-90" : ""
              }`}
              style={{ borderLeftColor: railColor, ...cardTone }}
              title={tooltip || undefined}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className={`${sz.label} flex-1 min-w-0`}>
                  {labelShort || (it ? "Indicatore clinico" : "Clinical indicator")}
                </span>
                <span className="flex items-center gap-1 shrink-0">
                  {pubDate ? (
                    <span
                      className={`${sz.meta} tabular-nums`}
                      title={it ? "Data di pubblicazione dei risultati" : "Publication / readout date"}
                    >
                      {pubDate}
                    </span>
                  ) : null}
                  {contextOnly ? (
                    <span className={`${sz.ctx}`}>CTX</span>
                  ) : kpiTag ? (
                    <span
                      className={`${sz.kpi} ${clinicalKpiBadgeClass(ind.kpi_type)}`}
                      title={localizeClinicalKpiType(ind.kpi_type, it) || undefined}
                    >
                      {kpiTag}
                    </span>
                  ) : null}
                </span>
              </div>
              <div className="flex items-start gap-1.5">
                <span className={`${sz.value} flex-1 break-words`}>{displayValue || ind.value}</span>
                {glyph ? (
                  <span style={{ color: glyphColor }} className="font-bold shrink-0 text-sm mt-0.5">
                    {glyph}
                  </span>
                ) : null}
              </div>
              {sz.showDesc && desc ? (
                <p className={`mt-1.5 ${sz.desc}`}>{desc}</p>
              ) : null}
              {sz.showDesc && (sourceBit || sourceHref) ? (
                <p className={`mt-1 ${sz.meta}`}>
                  {sourceHref ? (
                    <a
                      href={sourceHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-[rgb(var(--accent))] hover:underline underline-offset-2"
                      onClick={(e) => openExternalUrl(sourceHref, e)}
                    >
                      {sourceBit || (it ? "Apri fonte →" : "Open source →")}
                    </a>
                  ) : (
                    sourceBit
                  )}
                </p>
              ) : null}
              {socCmp && sz.showDesc ? (
                <SocCompareRow cmp={socCmp} it={it} dense={variant === "default"} />
              ) : null}
              {(ind.p_value || ind.confidence_interval) && (
                <div className={`mt-1 ${sz.meta} flex flex-col gap-0.5`}>
                  {ind.p_value ? <span>p = {ind.p_value}</span> : null}
                  {ind.confidence_interval ? <span>{ind.confidence_interval}</span> : null}
                </div>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {socCmp && !sz.showDesc ? <SocFlagBadge flag={socCmp.flag} it={it} dense /> : null}
                {epBadge ? (
                  <span className={`${sz.ep} ${epBadge.cls}`}>{epBadge.text}</span>
                ) : null}
                {scoreBadge ? (
                  <span
                    className={`${sz.ep} inline-flex items-center rounded border px-1 py-0.5 tabular-nums font-bold ${scoreCls}`}
                    title={
                      it
                        ? "Punteggio qualità KPI (stessa scala del contributo EIS)"
                        : "KPI quality score (same scale as EIS contribution)"
                    }
                  >
                    {scoreBadge}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {hiddenCount > 0 ? (
        onExpand ? (
          <button
            type="button"
            className={`${sz.footer} pl-0.5 font-medium text-[rgb(var(--accent))] hover:underline`}
            onClick={onExpand}
          >
            +{hiddenCount} {it ? "altri indicatori" : "more indicators"} ↗
          </button>
        ) : (
          <button
            type="button"
            className={`${sz.footer} pl-0.5 font-semibold text-[rgb(var(--accent))] hover:underline`}
            onClick={() => setExpanded(true)}
            aria-expanded={false}
          >
            +{hiddenCount} {it ? "altri indicatori — mostra tutti" : "more indicators — show all"}
          </button>
        )
      ) : null}
      {!onExpand && expanded && valid.length > maxShown ? (
        <button
          type="button"
          className={`${sz.footer} pl-0.5 font-medium text-ink-muted hover:underline`}
          onClick={() => setExpanded(false)}
          aria-expanded={true}
        >
          {it ? "Mostra meno" : "Show less"}
        </button>
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

/** Two-line EFF / SAF recap — replaces the endpoint card dump on the study strip. */
export function ClinicalEfficacySafetySummary({
  indicators,
  it = false,
  onExpand,
}: {
  indicators?: ClinicalStudyIndicator[] | null;
  it?: boolean;
  onExpand?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const summary = summarizeClinicalEfficacySafety(indicators, it);
  if (!summary.efficacy && !summary.safety) return null;
  const extra = summary.extraEfficacy + summary.extraSafety;
  return (
    <div className="space-y-0.5 min-w-0">
      {summary.efficacy ? (
        <p className="text-[10px] leading-snug text-ink flex items-start gap-1.5 min-w-0">
          <span
            className={`shrink-0 text-[9px] font-bold px-1 py-0.5 rounded ${clinicalKpiBadgeClass("efficacy")}`}
          >
            EFF
          </span>
          <span className="min-w-0">
            <span className="font-semibold tabular-nums">{summary.efficacy.value}</span>
            <span className="text-ink-muted"> · {summary.efficacy.label}</span>
          </span>
        </p>
      ) : null}
      {summary.safety ? (
        <p className="text-[10px] leading-snug text-ink flex items-start gap-1.5 min-w-0">
          <span
            className={`shrink-0 text-[9px] font-bold px-1 py-0.5 rounded ${clinicalKpiBadgeClass("safety")}`}
          >
            SAF
          </span>
          <span className="min-w-0">
            <span className="font-semibold tabular-nums">{summary.safety.value}</span>
            <span className="text-ink-muted"> · {summary.safety.label}</span>
          </span>
        </p>
      ) : null}
      {onExpand ? (
        <button
          type="button"
          className="text-[10px] font-medium text-[rgb(var(--accent))] hover:underline"
          onClick={onExpand}
        >
          {extra > 0 ? `+${extra} ↗` : "↗"}
        </button>
      ) : extra > 0 ? (
        <button
          type="button"
          className="text-[10px] font-semibold text-[rgb(var(--accent))] hover:underline"
          onClick={() => setExpanded(true)}
        >
          +{extra} {it ? "altri — mostra tutti" : "more — show all"}
        </button>
      ) : null}
      {!onExpand && expanded ? (
        <div className="pt-1 space-y-1">
          <ClinicalIndicatorChips
            indicators={prepareClinicalIndicators(indicators ?? [])}
            it={it}
            maxShown={99}
          />
          <button
            type="button"
            className="text-[10px] font-medium text-ink-muted hover:underline"
            onClick={() => setExpanded(false)}
          >
            {it ? "Mostra meno" : "Show less"}
          </button>
        </div>
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
  diseaseSoc,
  nctId,
}: {
  title: string;
  indicators?: ClinicalStudyIndicator[] | null;
  it?: boolean;
  maxShown?: number;
  note?: string;
  diseaseSoc?: DiseaseSocContext | null;
  nctId?: string | null;
}) {
  const valid = prepareClinicalIndicators(indicators ?? []);
  const readoutRange = readoutDateRangeLabel(valid, it);
  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/45 bg-surface/50 p-3 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <p className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted/90">{title}</p>
        {readoutRange ? (
          <p className="text-[10px] tabular-nums font-medium text-ink-muted">{readoutRange}</p>
        ) : null}
      </div>
      <DiseaseSocBanner ctx={diseaseSoc} it={it} />
      <ClinicalIndicatorChips
        indicators={valid}
        it={it}
        maxShown={maxShown}
        variant="summary"
        diseaseSoc={diseaseSoc}
        nctId={nctId}
      />
      {note ? (
        <p className="text-[10px] text-ink-muted leading-snug border-t border-[rgb(var(--border))]/30 pt-2">
          {note}
        </p>
      ) : null}
    </div>
  );
}
