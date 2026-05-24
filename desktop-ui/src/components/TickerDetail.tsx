import { modelCurvePoints } from "../data/predictions";
import type { CatalystRow } from "../types";
import { ModelCurveChart } from "./ModelCurveChart";

function MetricBox({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl bg-surface p-3 space-y-0.5">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${color ?? ""}`}>{value}</p>
      {sub && <p className="text-xs text-ink-muted">{sub}</p>}
    </div>
  );
}

function fmtPct(v: number | null, sign = false): string {
  if (v === null || v === undefined) return "—";
  const s = sign && v > 0 ? "+" : "";
  return `${s}${v.toFixed(1)}%`;
}

function dirColor(dir: string): string {
  if (dir.includes("↑")) return "text-positive";
  if (dir.includes("↓")) return "text-negative";
  return "";
}

export function TickerDetail({
  row,
  onBack,
}: {
  row: CatalystRow | null;
  onBack?: () => void;
}) {
  if (!row) {
    return (
      <section className="card p-8 text-center text-ink-muted text-sm">
        Seleziona un ticker dalla tabella per vedere direzione, curva modello e dettagli predizione.
      </section>
    );
  }

  const curve = modelCurvePoints(row.raw);
  const flags: string[] = [];
  if (row.datiScarsi) flags.push("Dati scarsi");
  if (row.predIncomplete) flags.push("Dataset predizione incompleto");
  if (row.sponsorMatch) flags.push(`Sponsor: ${row.sponsorMatch}`);

  const d7Color = row.modelD7Pct === null ? "" : row.modelD7Pct > 0 ? "text-positive" : "text-negative";

  const hasV5 = row.v5Q05Pct !== null || row.v5Q95Pct !== null;

  return (
    <section className="card p-5 space-y-5">
      {onBack && (
        <button type="button" className="btn-ghost text-xs -mt-1 mb-1" onClick={onBack}>
          ← Indietro
        </button>
      )}
      {/* Header */}
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-2xl font-bold tracking-tight">{row.ticker}</h2>
        <span className="text-ink-muted">{row.completionDate}</span>
        {row.phase && (
          <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-medium text-accent">
            {row.phase}
          </span>
        )}
        {row.stars && <span className="text-sm">{row.stars}</span>}
      </div>

      {/* Metriche principali */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricBox
          label="Direzione"
          value={row.direction}
          color={dirColor(row.direction)}
        />
        <MetricBox
          label="Δ% predetto D+7 (v4)"
          value={fmtPct(row.modelD7Pct, true)}
          color={d7Color}
        />
        <MetricBox
          label="Run-up 30g pre-CD"
          value={fmtPct(row.runUp30d, true)}
          sub="indicatore bias sell-the-news"
        />
        <MetricBox
          label="Confidenza / Qualità dati"
          value={row.confidence !== null ? `${(row.confidence * 100).toFixed(0)}%` : "—"}
          sub={row.dataQualityScore !== null ? `DQ: ${(row.dataQualityScore * 100).toFixed(0)}%` : undefined}
        />
      </div>

      {/* Bande v5 (se disponibili) */}
      {hasV5 && (
        <div className="rounded-xl bg-surface px-4 py-3 flex flex-wrap gap-6 text-sm">
          <div>
            <span className="text-xs text-ink-muted block mb-0.5">v5 q05 (pessimistico)</span>
            <span className="font-semibold tabular-nums text-negative">{fmtPct(row.v5Q05Pct, true)}</span>
          </div>
          <div>
            <span className="text-xs text-ink-muted block mb-0.5">v5 q50 (mediana)</span>
            <span className="font-semibold tabular-nums">{fmtPct(row.modelD7Pct, true)}</span>
          </div>
          <div>
            <span className="text-xs text-ink-muted block mb-0.5">v5 q95 (ottimistico)</span>
            <span className="font-semibold tabular-nums text-positive">{fmtPct(row.v5Q95Pct, true)}</span>
          </div>
        </div>
      )}

      {/* Flag */}
      {flags.length > 0 && (
        <ul className="flex flex-wrap gap-2 text-xs">
          {flags.map((f) => (
            <li key={f} className="rounded-md border border-[rgb(var(--border))] px-2.5 py-1 text-ink-muted">
              {f}
            </li>
          ))}
        </ul>
      )}

      {/* Curva modello */}
      <div>
        <h3 className="mb-3 text-sm font-medium text-ink-muted">Curva modello v4 (%)</h3>
        <ModelCurveChart points={curve} ticker={row.ticker} />
      </div>
    </section>
  );
}
