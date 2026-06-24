/**
 * RA Component Attribution — visual audit of how much of the RA Score is
 * novel information vs simply reshuffling signals already used by the
 * recommendation engine (deriveSuggestedAction).
 *
 * Renders in the RA Score Calibration tab.
 */
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  RA_COMPONENT_ATTRIBUTION,
  summarizeRaAttribution,
  CATEGORY_COLOR,
  CATEGORY_LABEL_IT,
  CATEGORY_LABEL_EN,
  type AttributionCategory,
  type AttributionEntry,
} from "../sheet/raComponentAttribution";
import { useLang } from "../shared/i18n";

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

function fmtRho(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "n/d";
  const s = v >= 0 ? "+" : "";
  return `${s}${v.toFixed(2)}`;
}

function rhoStars(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "";
  const abs = Math.abs(v);
  if (abs >= 0.4) return "★★★";
  if (abs >= 0.25) return "★★";
  if (abs >= 0.1) return "★";
  return "";
}

function CategoryChip({ cat, it }: { cat: AttributionCategory; it: boolean }) {
  const label = (it ? CATEGORY_LABEL_IT : CATEGORY_LABEL_EN)[cat];
  const bg = `${CATEGORY_COLOR[cat]}1f`; // ~12% opacity hex
  const border = `${CATEGORY_COLOR[cat]}55`;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold whitespace-nowrap"
      style={{
        backgroundColor: bg,
        color: CATEGORY_COLOR[cat],
        border: `1px solid ${border}`,
      }}
    >
      {label}
    </span>
  );
}

function KpiCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: AttributionCategory | "neutral";
}) {
  const color = tone === "neutral" ? "#475569" : CATEGORY_COLOR[tone];
  return (
    <div
      className="rounded-xl border p-3"
      style={{
        backgroundColor: `${color}10`,
        borderColor: `${color}55`,
      }}
    >
      <p className="text-[10px] uppercase tracking-wider font-bold text-ink-muted">
        {label}
      </p>
      <p className="text-2xl font-bold tabular-nums mt-0.5" style={{ color }}>
        {value}
      </p>
      {sub ? <p className="text-[10px] text-ink-muted mt-0.5">{sub}</p> : null}
    </div>
  );
}

export function RaComponentAttributionPanel() {
  const { lang } = useLang();
  const it = lang === "it";

  const summary = useMemo(() => summarizeRaAttribution(), []);

  // Bar chart data — sort by weight desc
  const barData = useMemo(
    () =>
      RA_COMPONENT_ATTRIBUTION.filter((e) => e.weightPt > 0)
        .slice()
        .sort((a, b) => b.weightPt - a.weightPt)
        .map((e) => ({
          label: e.label,
          weight: e.weightPt,
          category: e.category,
          rho: e.rhoWithPrice,
        })),
    [],
  );

  // Pie / stacked composition data
  const compositionData = useMemo(
    () => [
      {
        category: "duplicate_hard" as AttributionCategory,
        label: it
          ? "Hard duplicate"
          : "Hard duplicate",
        pt: summary.duplicateHardPt,
        pct: summary.duplicateHardPct,
      },
      {
        category: "duplicate_soft" as AttributionCategory,
        label: it ? "Soft duplicate" : "Soft duplicate",
        pt: summary.duplicateSoftPt,
        pct: summary.duplicateSoftPct,
      },
      {
        category: "novel" as AttributionCategory,
        label: it ? "Segnale nuovo" : "Novel",
        pt: summary.novelPt,
        pct: summary.novelPct,
      },
      {
        category: "dead" as AttributionCategory,
        label: it ? "Eliminato" : "Dead",
        pt: summary.deadPt,
        pct: summary.deadPct,
      },
    ],
    [summary, it],
  );

  const novelEntries = RA_COMPONENT_ATTRIBUTION.filter((e) => e.category === "novel");

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="invest-trend-chart-panel rounded-xl border p-4">
        <div className="flex items-start gap-3">
          <div className="text-2xl shrink-0">🧬</div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-ink">
              {it
                ? "Attribuzione segnali RA Score → motore raccomandazione"
                : "RA Score → recommendation engine attribution"}
            </h3>
            <p className="text-[11px] text-ink-muted leading-relaxed mt-1">
              {it
                ? "Per ogni componente dell'RA Score v2 mostriamo la sorgente del segnale e se quel segnale è già consumato direttamente da deriveSuggestedAction. Categorie: Hard duplicate = stesso campo usato come gate/override; Soft duplicate = usato indirettamente come peso composite; Novel = informazione veramente nuova; Dead = peso 0."
                : "For every RA Score v2 component we show the underlying signal source and whether that signal is already consumed by deriveSuggestedAction. Categories: Hard duplicate = same field used as gate/override; Soft duplicate = used indirectly as composite weight; Novel = truly new information; Dead = zero weight."}
            </p>
          </div>
        </div>
      </div>

      {/* KPI Cards: composition by category */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label={it ? "Hard duplicate" : "Hard duplicate"}
          value={`${summary.duplicateHardPt}pt`}
          sub={`${fmtPct(summary.duplicateHardPct)} ${it ? "del totale" : "of total"}`}
          tone="duplicate_hard"
        />
        <KpiCard
          label={it ? "Soft duplicate" : "Soft duplicate"}
          value={`${summary.duplicateSoftPt}pt`}
          sub={`${fmtPct(summary.duplicateSoftPct)} ${it ? "del totale" : "of total"}`}
          tone="duplicate_soft"
        />
        <KpiCard
          label={it ? "Segnale nuovo" : "Novel signal"}
          value={`${summary.novelPt}pt`}
          sub={`${fmtPct(summary.novelPct)} ${it ? "del totale" : "of total"}`}
          tone="novel"
        />
        <KpiCard
          label={it ? "Eliminato (v2)" : "Dead weight (v2)"}
          value={`${summary.deadPt}pt`}
          sub={`${fmtPct(summary.deadPct)} ${it ? "del totale" : "of total"}`}
          tone="dead"
        />
      </div>

      {/* Bar chart: weight by component, colored by category */}
      <div className="invest-trend-chart-panel rounded-xl border p-4">
        <h4 className="text-sm font-bold text-ink mb-1">
          {it
            ? "Peso (pt) per componente, colorato per categoria"
            : "Weight (pt) per component, colored by category"}
        </h4>
        <p className="text-[11px] text-ink-muted leading-snug mb-3">
          {it
            ? "Rosso = stesso segnale già attivo come gate nel motore. Ambra = duplicato indiretto via composite weights. Verde = informazione veramente nuova. Grigio = peso 0."
            : "Red = same signal already active as a gate in the engine. Amber = indirect duplicate via composite weights. Green = truly novel information. Gray = zero weight."}
        </p>
        <div className="w-full h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={barData}
              layout="vertical"
              margin={{ top: 10, right: 24, left: 60, bottom: 10 }}
            >
              <XAxis type="number" tick={{ fontSize: 10, fill: "#475569" }} domain={[0, 22]} />
              <YAxis
                type="category"
                dataKey="label"
                tick={{ fontSize: 11, fill: "#1e293b" }}
                width={140}
              />
              <Tooltip
                contentStyle={{ fontSize: 11 }}
                formatter={(v: number, _name: string, props: { payload?: typeof barData[number] }) => {
                  const cat = props.payload?.category;
                  const catLabel = cat
                    ? (it ? CATEGORY_LABEL_IT : CATEGORY_LABEL_EN)[cat]
                    : "";
                  const rho = props.payload?.rho;
                  return [
                    `${v}pt · ${catLabel}${rho != null ? ` · ρ=${fmtRho(rho)}` : ""}`,
                    it ? "Peso" : "Weight",
                  ];
                }}
              />
              <Bar dataKey="weight" radius={[0, 4, 4, 0]}>
                {barData.map((d, i) => (
                  <Cell key={i} fill={CATEGORY_COLOR[d.category]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Composition pie (stacked horizontal bar — simpler) */}
      <div className="invest-trend-chart-panel rounded-xl border p-4">
        <h4 className="text-sm font-bold text-ink mb-1">
          {it
            ? "Composizione totale (100 pt = RA Score completo)"
            : "Total composition (100 pt = full RA Score)"}
        </h4>
        <p className="text-[11px] text-ink-muted leading-snug mb-3">
          {it
            ? `${fmtPct(summary.duplicateHardPct + summary.duplicateSoftPct)} del peso RA replica segnali già usati dal motore. Solo ${fmtPct(summary.novelPct)} aggiunge informazione nuova.`
            : `${fmtPct(summary.duplicateHardPct + summary.duplicateSoftPct)} of RA weight replicates signals already used by the engine. Only ${fmtPct(summary.novelPct)} adds new information.`}
        </p>
        <div className="flex h-12 rounded-lg overflow-hidden border border-[rgb(var(--border))]/50">
          {compositionData
            .filter((c) => c.pt > 0)
            .map((c) => (
              <div
                key={c.category}
                className="flex items-center justify-center text-white text-[11px] font-bold"
                style={{
                  width: `${c.pct}%`,
                  backgroundColor: CATEGORY_COLOR[c.category],
                  minWidth: 0,
                }}
                title={`${c.label}: ${c.pt}pt (${fmtPct(c.pct)})`}
              >
                {c.pct >= 8 ? `${c.label} ${c.pt}pt` : c.pt}
              </div>
            ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
          {compositionData.map((c) => (
            <div
              key={c.category}
              className="flex items-center gap-2 text-[10px] text-ink-muted"
            >
              <span
                className="inline-block w-3 h-3 rounded-sm"
                style={{ backgroundColor: CATEGORY_COLOR[c.category] }}
              />
              <span>
                <strong className="text-ink">{c.label}</strong> · {c.pt}pt · {fmtPct(c.pct)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Detailed attribution table */}
      <div className="invest-trend-chart-panel rounded-xl border p-4">
        <h4 className="text-sm font-bold text-ink mb-1">
          {it
            ? "Tabella di attribuzione (sorgente → destinazione)"
            : "Attribution table (source → destination)"}
        </h4>
        <p className="text-[11px] text-ink-muted leading-snug mb-3">
          {it
            ? "Per ogni componente: sorgente del segnale, dove (e come) lo consuma il motore, correlazione con prezzo storica."
            : "For each component: signal source, where (and how) the engine consumes it, historical price correlation."}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-[rgb(var(--border))]/60 text-ink-muted">
                <th className="text-left font-semibold pb-2 pr-2">{it ? "Componente" : "Component"}</th>
                <th className="text-right font-semibold pb-2 px-2">pt</th>
                <th className="text-left font-semibold pb-2 px-2">{it ? "Sorgente" : "Source"}</th>
                <th className="text-left font-semibold pb-2 px-2">
                  {it ? "Consumato dal motore come" : "Consumed by engine as"}
                </th>
                <th className="text-center font-semibold pb-2 px-2">{it ? "Categoria" : "Category"}</th>
                <th className="text-right font-semibold pb-2 pl-2">ρ prezzo</th>
              </tr>
            </thead>
            <tbody>
              {RA_COMPONENT_ATTRIBUTION.map((e: AttributionEntry) => (
                <tr key={e.id} className="border-b border-[rgb(var(--border))]/30 align-top">
                  <td className="py-2 pr-2 font-medium text-ink">{e.label}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-ink">
                    {e.weightPt}
                  </td>
                  <td className="py-2 px-2 text-ink-muted leading-snug">
                    <span className="font-mono text-[10px]">{e.sourceSignal}</span>
                    <br />
                    <span className="text-[9px] opacity-70">{e.sourceFile}</span>
                  </td>
                  <td className="py-2 px-2 text-ink-muted leading-snug">
                    {e.consumedFile ? (
                      <>
                        <span>{e.consumedAs}</span>
                        <br />
                        <span className="text-[9px] opacity-70">{e.consumedFile}</span>
                      </>
                    ) : (
                      <span className="italic text-rose-600/80">
                        {it ? "❌ Non consumato dal motore" : "❌ Not consumed by engine"}
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-center">
                    <CategoryChip cat={e.category} it={it} />
                  </td>
                  <td className="py-2 pl-2 text-right tabular-nums">
                    {e.rhoWithPrice != null ? (
                      <span
                        className={
                          Math.abs(e.rhoWithPrice) >= 0.3
                            ? "font-bold text-emerald-700"
                            : Math.abs(e.rhoWithPrice) >= 0.1
                              ? "text-amber-700"
                              : "text-ink-muted"
                        }
                      >
                        {fmtRho(e.rhoWithPrice)} {rhoStars(e.rhoWithPrice)}
                      </span>
                    ) : (
                      <span className="text-ink-muted">n/d</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 text-[10px] text-ink-muted leading-relaxed">
          <p>
            <strong>ρ prezzo</strong>: {it ? "correlazione storica tra il valore del componente e il successivo movimento di prezzo (ρ Pearson)." : "historical correlation between component value and subsequent price move (Pearson ρ)."}
            ρ ≥ 0.30 = forte (★★★); 0.15-0.30 = medio (★★); 0.05-0.15 = debole (★); &lt; 0.05 = nessuna correlazione utile.
          </p>
        </div>
      </div>

      {/* Conclusion box */}
      <div className="rounded-xl border border-rose-300/60 bg-rose-50/50 p-4">
        <h4 className="text-sm font-bold text-rose-900 mb-2">
          {it ? "🎯 Cosa significa nella pratica" : "🎯 Practical implications"}
        </h4>
        <ul className="text-[12px] text-rose-900/90 leading-relaxed space-y-1.5 list-disc list-inside">
          <li>
            {it
              ? `Il `
              : `Roughly `}
            <strong>
              {fmtPct(summary.duplicateHardPct + summary.duplicateSoftPct)}
            </strong>
            {it
              ? ` del peso RA Score (${summary.duplicateHardPt + summary.duplicateSoftPt}pt su 100) replica segnali già letti direttamente da deriveSuggestedAction. Spostare il punteggio RA non sposta la raccomandazione: sta lavorando in parallelo sugli stessi input.`
              : ` of RA Score weight (${summary.duplicateHardPt + summary.duplicateSoftPt}pt out of 100) replicates signals already read by deriveSuggestedAction. Moving the RA score does not move the recommendation — it works in parallel on the same inputs.`}
          </li>
          <li>
            {it ? "I tre componenti " : "The three "}
            <strong>{novelEntries.map((e) => e.label).join(" / ")}</strong>
            {it
              ? ` sono gli unici 'nuovi' (${summary.novelPt}pt totali, ${fmtPct(summary.novelPct)}). Ma la loro correlazione media pesata con il prezzo è `
              : ` are the only "novel" ones (${summary.novelPt}pt total, ${fmtPct(summary.novelPct)}). Their weighted average correlation with price is `}
            <strong>ρ ≈ {fmtRho(summary.novelWeightedRho)}</strong>
            {it
              ? ` — debolissima. Anche dove l'RA Score aggiunge informazione, quella informazione predice poco.`
              : ` — very weak. Even where RA Score adds information, that information predicts little.`}
          </li>
          <li>
            {it
              ? `Il peso totale "morto" (timing v2) è ${summary.deadPt}pt — ${fmtPct(summary.deadPct)}, già azzerato in v2 dopo l'audit ρ=0.00.`
              : `Total "dead" weight (timing in v2) is ${summary.deadPt}pt — ${fmtPct(summary.deadPct)}, already zeroed after the ρ=0.00 audit.`}
          </li>
          <li>
            {it
              ? "Conclusione: l'RA Score sui dati attuali non sta aggiungendo informazione. È principalmente una ri-ponderazione di segnali già usati nel motore, con tre componenti 'novel' che hanno tracking record troppo debole per spostare le raccomandazioni."
              : "Conclusion: on current data, RA Score is not adding information. It is mainly a re-weighting of signals already used by the engine, with three 'novel' components whose track record is too weak to move recommendations."}
          </li>
        </ul>
      </div>
    </div>
  );
}
