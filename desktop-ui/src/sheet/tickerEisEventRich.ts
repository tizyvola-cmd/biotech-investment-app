import type { ClinicalStudyIndicator } from "../api/supernova";
import {
  localizeClinicalIndicatorLabel,
  localizeClinicalIndicatorValue,
  prepareClinicalIndicators,
} from "./clinicalIndicators";
import { formatEisIntrinsicShort } from "./eventImpactScore";
import type { TickerEisEventDetail } from "./tickerEisSummary";

const SEC_8K_ITEM_LABELS: Record<string, { en: string; it: string }> = {
  "1.01": { en: "Material definitive agreement", it: "Accordo definitivo materiale" },
  "1.02": { en: "Termination of material agreement", it: "Risoluzione accordo materiale" },
  "2.01": { en: "Acquisition / disposal of assets", it: "Acquisizione / cessione asset" },
  "2.02": { en: "Results of operations (earnings)", it: "Risultati operativi (utili)" },
  "2.03": { en: "Creation of direct financial obligation", it: "Obbligo finanziario diretto" },
  "3.01": { en: "Notice of delisting", it: "Avviso di esclusione dalla quotazione" },
  "4.01": { en: "Change of auditor", it: "Cambio revisore" },
  "5.01": { en: "Change in control", it: "Cambio di controllo" },
  "5.02": { en: "Officer/director departure or appointment", it: "Uscita/nomina dirigente" },
  "5.03": { en: "Amendment to articles", it: "Modifica statuto" },
  "7.01": { en: "Regulation FD disclosure", it: "Informativa Regulation FD" },
  "8.01": { en: "Other material events (press release)", it: "Altri eventi materiali (comunicato stampa)" },
};

function parseSec8kItemCodes(itemsRaw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of itemsRaw.matchAll(/\d+\.\d+/g)) {
    const code = m[0]!;
    if (!seen.has(code)) {
      seen.add(code);
      out.push(code);
    }
  }
  return out;
}

export function formatSec8kItemsLine(itemsRaw: string, lang: "it" | "en"): string | null {
  const codes = parseSec8kItemCodes(itemsRaw);
  if (!codes.length) return null;
  const labels = codes.map((c) => SEC_8K_ITEM_LABELS[c]?.[lang] ?? `Item ${c}`);
  return (lang === "it" ? "Voci 8-K: " : "8-K items: ") + labels.join(" · ");
}

function normText(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function summaryAddsContext(title: string, summary: string | null | undefined): boolean {
  if (!summary?.trim()) return false;
  const t = normText(title);
  const s = normText(summary);
  if (s === t) return false;
  if (t.includes(s) || s.includes(t)) return false;
  if (s.length < 12) return false;
  return true;
}

function formatIndicatorLine(indicators: ClinicalStudyIndicator[], lang: "it" | "en"): string | null {
  const prepared = prepareClinicalIndicators(indicators).slice(0, 4);
  if (!prepared.length) return null;
  const parts = prepared.map((ind) => {
    const it = lang === "it";
    const label =
      localizeClinicalIndicatorLabel((ind.label ?? "").trim(), it) || "KPI";
    const value = localizeClinicalIndicatorValue((ind.value ?? "").trim(), it);
    const unit = (ind.unit ?? "").trim();
    const vs = localizeClinicalIndicatorValue(
      (ind.vs_soc ?? ind.vs_prior_update ?? "").trim(),
      it,
    );
    const tail = vs ? ` (${vs})` : unit && !value.includes(unit) ? ` ${unit}` : "";
    return `${label}: ${value}${tail}`;
  });
  return parts.join(" · ");
}

export type TickerEisEventRichContext = {
  itemsLine: string | null;
  summaryLine: string | null;
  reactionLine: string | null;
  kpiLine: string | null;
  assetLine: string | null;
};

/** Extra lines for SEC 8-K / press rows — earnings figures, 8-K items, market reaction. */
export function formatTickerEisEventRichContext(
  ev: TickerEisEventDetail,
  lang: "it" | "en",
): TickerEisEventRichContext {
  const it = lang === "it";
  const itemsLine =
    ev.itemsRaw?.trim() && ev.sourceType.toLowerCase() === "sec_8k"
      ? formatSec8kItemsLine(ev.itemsRaw, lang)
      : null;

  const summaryLine = summaryAddsContext(ev.title, ev.summary) ? ev.summary!.trim() : null;

  const reactionParts: string[] = [];
  const b = ev.breakdown;
  if (b.delta_p_1d != null && Number.isFinite(b.delta_p_1d)) {
    reactionParts.push(
      `${it ? "ΔP 1g" : "ΔP 1d"} ${b.delta_p_1d >= 0 ? "+" : ""}${b.delta_p_1d.toFixed(1)}%`,
    );
  }
  if (b.delta_p_3d != null && Number.isFinite(b.delta_p_3d)) {
    reactionParts.push(
      `${it ? "ΔP 3g" : "ΔP 3d"} ${b.delta_p_3d >= 0 ? "+" : ""}${b.delta_p_3d.toFixed(1)}%`,
    );
  }
  if (b.vol_term != null && Math.abs(b.vol_term) > 0.05) {
    reactionParts.push(
      `${it ? "Volume" : "Volume"} ${b.vol_term >= 0 ? "+" : ""}${b.vol_term.toFixed(1)}`,
    );
  }
  if (b.kpi_score != null && Math.abs(b.kpi_score) > 0.01) {
    reactionParts.push(`KPI ${b.kpi_score >= 0 ? "+" : ""}${b.kpi_score.toFixed(2)}`);
  } else if (Math.abs(b.sent_term) > 0.01) {
    reactionParts.push(`${it ? "Sentiment" : "Sentiment"} ${b.sent_term >= 0 ? "+" : ""}${b.sent_term.toFixed(1)}`);
  }
  const intLabel = formatEisIntrinsicShort(b.eis_intrinsic);
  if (intLabel) reactionParts.push(intLabel);

  let reactionLine = reactionParts.length ? reactionParts.join(" · ") : null;
  if (
    ev.impactNote?.trim() &&
    ev.impactNote.trim() !== "8-K SEC" &&
    (!reactionLine || !reactionLine.includes(ev.impactNote.trim()))
  ) {
    reactionLine = reactionLine
      ? `${reactionLine} · ${ev.impactNote.trim()}`
      : ev.impactNote.trim();
  }

  const kpiLine = formatIndicatorLine(ev.indicators, lang);
  const assetLine = ev.asset?.trim() ? ev.asset.trim() : null;

  return { itemsLine, summaryLine, reactionLine, kpiLine, assetLine };
}

export function tickerEisEventHasRichContext(ctx: TickerEisEventRichContext): boolean {
  return Boolean(
    ctx.itemsLine || ctx.summaryLine || ctx.reactionLine || ctx.kpiLine || ctx.assetLine,
  );
}
