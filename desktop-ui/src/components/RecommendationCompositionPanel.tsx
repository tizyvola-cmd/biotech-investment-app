import {
  PPLAN_SETUP_WEIGHTS,
  PPLAN_TRACK_WEIGHTS,
  RECOMMENDATION_ACTION_GUIDES,
  type CompositionWeightRow,
  type RecommendationActionGuide,
} from "../sheet/recommendationCompositionGuide";
import { ZONE_WEIGHTS, type IndexId, type ScoringZone } from "../lib/scoring/zoneWeights";

const INDEX_LABELS: Record<IndexId, { it: string; en: string }> = {
  pplan: { it: "P(plan)", en: "P(plan)" },
  top2: { it: "Top2", en: "Top2" },
  precat: { it: "Precat", en: "Precat" },
  slope: { it: "Pendenza", en: "Slope" },
  timing: { it: "Timing CD", en: "CD timing" },
  conf: { it: "Confidenza", en: "Confidence" },
  sds: { it: "SDS", en: "SDS" },
  eis: { it: "EIS", en: "EIS" },
};

const ZONE_LABELS: Record<ScoringZone, { it: string; en: string }> = {
  hot: { it: "Hot", en: "Hot" },
  watch: { it: "Watch", en: "Watch" },
  early: { it: "Early", en: "Early" },
  loss: { it: "Loss", en: "Loss" },
};

function WeightBar({ row, lang }: { row: CompositionWeightRow; lang: "it" | "en" }) {
  const it = lang === "it";
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between gap-2 text-[9px]">
        <span className="font-medium text-ink truncate">
          {it ? row.labelIt : row.labelEn}
        </span>
        <span className="tabular-nums font-semibold text-ink-muted shrink-0">{row.weightPct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
        <div
          className="h-full rounded-full bg-indigo-400/85"
          style={{ width: `${Math.min(100, row.weightPct)}%` }}
        />
      </div>
      <p className="text-[8px] text-ink-muted leading-snug">
        {it ? row.detailIt : row.detailEn}
      </p>
    </div>
  );
}

function ActionCard({ guide, lang }: { guide: RecommendationActionGuide; lang: "it" | "en" }) {
  const it = lang === "it";
  const gates = it ? guide.gatesIt : guide.gatesEn;
  const showPplanSub = guide.scoreBlocks.some(
    (b) => b.id === "p_track" || b.id === "p_setup" || b.id === "p_recovery",
  );

  return (
    <div
      className="rounded-xl border p-3 flex flex-col gap-2 min-w-0"
      style={{ borderColor: `${guide.accent}44`, backgroundColor: `${guide.accent}08` }}
    >
      <p className="text-[11px] font-bold" style={{ color: guide.accent }}>
        {it ? guide.titleIt : guide.titleEn}
      </p>

      <div>
        <p className="text-[9px] font-semibold uppercase tracking-wide text-ink-muted mb-1">
          {it ? "Condizioni (gate)" : "Conditions (gates)"}
        </p>
        <ul className="space-y-1 text-[9px] text-ink-muted leading-snug list-disc list-inside">
          {gates.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      </div>

      <div>
        <p className="text-[9px] font-semibold uppercase tracking-wide text-ink-muted mb-1.5">
          {it ? "Score e pesi" : "Scores & weights"}
        </p>
        <div className="space-y-2">
          {guide.scoreBlocks.map((row) => (
            <WeightBar key={row.id} row={row} lang={lang} />
          ))}
        </div>
      </div>

      {showPplanSub ? (
        <div className="rounded-lg border border-slate-200/60 dark:border-slate-700/50 bg-white/50 dark:bg-slate-900/30 p-2 space-y-2">
          <p className="text-[9px] font-semibold text-ink">
            {it ? "P(plan) — dettaglio sotto-blocchi" : "P(plan) — sub-block detail"}
          </p>
          <p className="text-[8px] text-ink-muted">
            {it
              ? "pTrack e pSetup si combinano con finestra CD, EIS, forward e momentum (media geometrica)."
              : "pTrack and pSetup combine with CD window, EIS, forward and momentum (geometric mean)."}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[8px] font-semibold text-indigo-700 dark:text-indigo-300 mb-1">pTrack</p>
              {PPLAN_TRACK_WEIGHTS.map((r) => (
                <WeightBar key={r.id} row={r} lang={lang} />
              ))}
            </div>
            <div>
              <p className="text-[8px] font-semibold text-indigo-700 dark:text-indigo-300 mb-1">pSetup</p>
              {PPLAN_SETUP_WEIGHTS.map((r) => (
                <WeightBar key={r.id} row={r} lang={lang} />
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {guide.footnoteIt ? (
        <p className="text-[8px] text-ink-muted leading-snug border-t border-slate-200/50 pt-1.5 mt-auto">
          {it ? guide.footnoteIt : guide.footnoteEn}
        </p>
      ) : null}
    </div>
  );
}

export function RecommendationCompositionPanel({ lang }: { lang: "it" | "en" }) {
  const it = lang === "it";

  return (
    <div className="space-y-3">
      <div className="tester-monitor-panel rounded-xl px-4 py-3">
        <p className="text-[11px] font-semibold text-ink">
          {it
            ? "Composizione raccomandazioni — score e pesi %"
            : "Recommendation composition — scores & weight %"}
        </p>
        <p className="text-[9px] text-ink-muted mt-1 leading-relaxed max-w-[900px]">
          {it
            ? "Ogni azione deriva da gate Soft BUY / Soft·Urgent·continuation SELL + score. P(plan) alimenta HOLD e parte dei gate Soft; 10d % / pct Own·Pop / edge alimentano i SELL continuation. Composite (0–100) modula INCERTO. I pesi % sono quelli del codice sorgente."
            : "Each action comes from Soft BUY / Soft·Urgent·continuation SELL gates + scores. P(plan) feeds HOLD and some Soft gates; 10d % / pct Own·Pop / edge feed continuation SELLs. Composite (0–100) modulates UNCERTAIN. Weight % match source code."}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {RECOMMENDATION_ACTION_GUIDES.map((guide) => (
          <ActionCard key={guide.action} guide={guide} lang={lang} />
        ))}
      </div>

      <div className="tester-monitor-panel rounded-xl p-3 overflow-x-auto">
        <p className="text-[11px] font-semibold text-ink mb-1">
          {it ? "Composite score — pesi % per fascia CD" : "Composite score — weight % by CD zone"}
        </p>
        <p className="text-[9px] text-ink-muted mb-2">
          {it
            ? "Usato per INCERTO e tie-break. Ogni indice è normalizzato 0–1 poi moltiplicato per il peso zona."
            : "Used for UNCERTAIN and tie-break. Each index is normalized 0–1 then multiplied by zone weight."}
        </p>
        <table className="w-full text-[10px]">
          <thead>
            <tr className="text-ink-muted uppercase text-[9px]">
              <th className="text-left py-1 pr-2">{it ? "Indice" : "Index"}</th>
              {(Object.keys(ZONE_WEIGHTS) as ScoringZone[]).map((z) => (
                <th key={z} className="text-center py-1 px-1">
                  {ZONE_LABELS[z][lang]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(Object.keys(INDEX_LABELS) as IndexId[]).map((id) => (
              <tr key={id} className="border-t border-slate-100/80">
                <td className="py-1 pr-2 font-medium text-ink">{INDEX_LABELS[id][lang]}</td>
                {(Object.keys(ZONE_WEIGHTS) as ScoringZone[]).map((z) => {
                  const w = ZONE_WEIGHTS[z][id];
                  return (
                    <td key={z} className="py-1 px-1 text-center tabular-nums font-semibold">
                      {w}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
