import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { InvestmentSimOutcomesPanel } from "./InvestmentSimOutcomesPanel";
import { InvestmentSignalsPanel } from "./InvestmentSignalsPanel";
import type { SheetTable } from "../types";
import {
  loadInvestmentDecisionCohort,
  type DecisionCohortComparison,
  type DecisionCohortDoc,
  type DecisionCohortRow,
  type DecisionHistorySnapshot,
  type DecisionQuintile,
  type DecisionSegment,
  type DecisionSegmentDelta,
  type DecisionSegmentGroup,
} from "../data/investmentDecisionData";

type LabTab = "cohort" | "portfolio" | "signals";

function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}%`;
}

function fmtIc(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(3);
}

function KpiCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "up" | "down" | "warn";
}) {
  const color =
    accent === "up"
      ? "text-[rgb(var(--signal-up))]"
      : accent === "down"
        ? "text-[rgb(var(--signal-down))]"
        : accent === "warn"
          ? "text-[rgb(var(--warn))]"
          : "";
  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-surface/50 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-ink-muted">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-ink-muted mt-0.5">{sub}</p>}
    </div>
  );
}

function ProtocolPanel({ protocol }: { protocol: DecisionCohortDoc["protocol"] }) {
  if (!protocol) return null;
  return (
    <section className="rounded-lg border border-[rgb(var(--border))]/50 bg-surface/40 p-4 text-sm space-y-3">
      <div>
        <h3 className="font-semibold text-base">{protocol.title ?? "Protocollo"}</h3>
        <p className="text-xs text-ink-muted mt-1">
          <strong>Decisione:</strong> {protocol.decision_point} · <strong>Outcome:</strong>{" "}
          {protocol.outcome_window}
        </p>
        <p className="text-xs text-ink-muted">
          <strong>Segnale:</strong> {protocol.prediction_signal}
        </p>
      </div>
      {protocol.inclusion?.length ? (
        <div>
          <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">
            Inclusione cohort
          </p>
          <ul className="text-xs text-ink-muted list-disc pl-4 space-y-0.5">
            {protocol.inclusion.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {protocol.metrics?.length ? (
        <div>
          <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">
            Metriche (Fase A)
          </p>
          <ul className="text-xs text-ink-muted list-disc pl-4 space-y-0.5">
            {protocol.metrics.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {protocol.limitations?.length ? (
        <div>
          <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1">
            Limiti
          </p>
          <ul className="text-xs text-ink-muted list-disc pl-4 space-y-0.5">
            {protocol.limitations.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function fmtDelta(v: number | null | undefined, digits = 3, suffix = ""): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}${suffix}`;
}

function deltaAccent(v: number | null | undefined, invert = false): "up" | "down" | undefined {
  if (v == null || !Number.isFinite(v) || v === 0) return undefined;
  const positive = invert ? v < 0 : v > 0;
  return positive ? "up" : "down";
}

function fmtTs(iso: string | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("it-IT", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso.slice(0, 16);
  }
}

function ComparisonPanel({
  comparison,
  historyTail,
}: {
  comparison?: DecisionCohortComparison;
  historyTail?: DecisionHistorySnapshot[];
}) {
  if (!comparison) {
    return (
      <p className="text-xs text-ink-muted">
        Nessun confronto disponibile — alla prossima rigenerazione del cohort (dopo refresh con
        parametri env diversi) verrà salvato il delta vs questo run in{" "}
        <code className="text-[10px]">investment_decision_cohort_history.json</code>.
      </p>
    );
  }

  const sd = comparison.summary_delta;
  const segDeltaRows = comparison.segment_delta ?? [];

  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-muted">
        Run precedente: <strong>{fmtTs(comparison.previous_at)}</strong>
        {comparison.env_changed ? (
          <span className="ml-2 text-[rgb(var(--warn))]">· parametri env modificati</span>
        ) : (
          <span className="ml-2">· stessi parametri env (solo dati aggiornati)</span>
        )}
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <KpiCard
          label="Δ IC"
          value={fmtDelta(sd?.ic_spearman, 3)}
          accent={deltaAccent(sd?.ic_spearman ?? null)}
          sub={`${fmtIc(comparison.summary_before?.ic_spearman)} → ${fmtIc(comparison.summary_after?.ic_spearman)}`}
        />
        <KpiCard
          label="Δ Hit"
          value={fmtDelta(sd?.hit_rate_pct, 1, " pp")}
          accent={deltaAccent(sd?.hit_rate_pct ?? null)}
          sub={`${comparison.summary_before?.hit_rate_pct ?? "—"}% → ${comparison.summary_after?.hit_rate_pct ?? "—"}%`}
        />
        <KpiCard
          label="Δ R medio"
          value={fmtDelta(sd?.mean_r_hold_pp, 2, " pp")}
          accent={deltaAccent(sd?.mean_r_hold_pp ?? null)}
        />
        <KpiCard
          label="Δ Eventi"
          value={fmtDelta(sd?.n_events, 0)}
        />
      </div>

      {comparison.env_diff?.length ? (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-2">
            Parametri env cambiati
          </h4>
          <div className="overflow-auto max-h-[160px]">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase text-ink-muted">
                  <th className="text-left py-1 pr-2">Variabile</th>
                  <th className="text-left py-1 px-1">Prima</th>
                  <th className="text-left py-1 pl-1">Dopo</th>
                </tr>
              </thead>
              <tbody>
                {comparison.env_diff.map((d) => (
                  <tr key={d.key} className="border-t border-[rgb(var(--border))]/30">
                    <td className="py-1 pr-2 font-mono text-[10px]">{d.key}</td>
                    <td className="py-1 px-1 text-ink-muted">{String(d.before ?? "—")}</td>
                    <td className="py-1 pl-1 font-medium">{String(d.after ?? "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {segDeltaRows.length ? (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-2">
            Δ IC per segmento (migliori in alto)
          </h4>
          <SegmentDeltaTable rows={segDeltaRows} />
        </div>
      ) : null}

      {historyTail && historyTail.length > 1 ? (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-2">
            Cronologia run ({historyTail.length})
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {historyTail.map((h, i) => (
              <span
                key={`${h.generated_at}-${i}`}
                className="text-[10px] px-2 py-1 rounded-md border border-[rgb(var(--border))]/40 bg-surface/40 tabular-nums"
                title={h.env_fingerprint}
              >
                {fmtTs(h.generated_at)} · IC {fmtIc(h.summary?.ic_spearman)}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function icAccentLevel(ic: number | null | undefined): "up" | "down" | "warn" | undefined {
  if (ic == null || !Number.isFinite(ic)) return undefined;
  if (ic > 0.05) return "up";
  if (ic < -0.05) return "down";
  return "warn";
}

function SegmentDeltaTable({ rows }: { rows: DecisionSegmentDelta[] }) {
  if (!rows.length) return null;
  return (
    <div className="overflow-x-auto overflow-y-auto max-h-[300px] rounded-md border border-[rgb(var(--border))]/30 bg-[rgb(var(--surface))]/30">
      <table className="w-full min-w-[36rem] text-xs border-collapse">
        <colgroup>
          <col className="w-[46%]" />
          <col className="w-[9%]" />
          <col className="w-[15%]" />
          <col className="w-[15%]" />
          <col className="w-[15%]" />
        </colgroup>
        <thead className="sticky top-0 z-[1] bg-[rgb(var(--surface-elevated))] shadow-[0_1px_0_rgb(var(--border)/0.4)]">
          <tr className="text-[10px] uppercase tracking-wide text-ink-muted">
            <th className="text-left py-2 pl-3 pr-2 font-medium">Segmento</th>
            <th className="text-right py-2 px-2 font-medium">n</th>
            <th className="text-right py-2 px-2 font-medium whitespace-nowrap">IC prima</th>
            <th className="text-right py-2 px-2 font-medium whitespace-nowrap">IC dopo</th>
            <th className="text-right py-2 pr-3 pl-2 font-medium whitespace-nowrap">Δ IC</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const accent = deltaAccent(s.delta_ic ?? null);
            const color =
              accent === "up"
                ? "text-[rgb(var(--signal-up))]"
                : accent === "down"
                  ? "text-[rgb(var(--signal-down))]"
                  : "";
            return (
              <tr
                key={`${s.group_id}-${s.label}`}
                className="border-t border-[rgb(var(--border))]/25 hover:bg-[rgb(var(--surface-3))]/25"
              >
                <td className="py-2 pl-3 pr-2 align-top">
                  <span className="block text-[10px] leading-tight text-ink-muted">
                    {s.group_title ?? s.group_id}
                  </span>
                  <span className="block font-medium text-ink leading-snug break-words">
                    {s.label}
                  </span>
                </td>
                <td className="py-2 px-2 text-right tabular-nums align-middle whitespace-nowrap">
                  {s.n_ic_pairs ?? "—"}
                </td>
                <td className="py-2 px-2 text-right tabular-nums align-middle whitespace-nowrap">
                  {fmtIc(s.ic_before)}
                </td>
                <td className="py-2 px-2 text-right tabular-nums align-middle whitespace-nowrap">
                  {fmtIc(s.ic_after)}
                </td>
                <td
                  className={`py-2 pr-3 pl-2 text-right tabular-nums font-semibold align-middle whitespace-nowrap ${color}`}
                >
                  {fmtDelta(s.delta_ic, 3)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SegmentTable({
  segments,
  globalIc,
}: {
  segments: DecisionSegment[];
  globalIc?: number | null;
}) {
  if (!segments.length) {
    return <p className="text-xs text-ink-muted py-2">Nessun dato</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[28rem] text-xs border-collapse">
        <colgroup>
          <col className="w-[38%]" />
          <col className="w-[10%]" />
          <col className="w-[13%]" />
          <col className="w-[13%]" />
          <col className="w-[13%]" />
          <col className="w-[13%]" />
        </colgroup>
        <thead>
          <tr className="text-ink-muted text-[10px] uppercase tracking-wide">
            <th className="text-left py-1.5 pl-1 pr-2 font-medium">Segmento</th>
            <th className="text-right py-1.5 px-2 font-medium">n</th>
            <th className="text-right py-1.5 px-2 font-medium whitespace-nowrap">IC</th>
            <th className="text-right py-1.5 px-2 font-medium whitespace-nowrap">Hit</th>
            <th className="text-right py-1.5 px-2 font-medium whitespace-nowrap">R medio</th>
            <th className="text-right py-1.5 pr-1 pl-2 font-medium whitespace-nowrap">Bias pred</th>
          </tr>
        </thead>
        <tbody>
        {segments.map((s) => {
          const accent = icAccentLevel(s.ic_spearman);
          const icClass =
            accent === "up"
              ? "text-[rgb(var(--signal-up))]"
              : accent === "down"
                ? "text-[rgb(var(--signal-down))]"
                : accent === "warn"
                  ? "text-[rgb(var(--warn))]"
                  : "";
          const beatsGlobal =
            globalIc != null &&
            s.ic_spearman != null &&
            s.n_ic_pairs >= 10 &&
            s.ic_spearman > globalIc + 0.05;
          return (
            <tr key={s.label} className="border-t border-[rgb(var(--border))]/30">
              <td className="py-1.5 pl-1 pr-2 align-top break-words">
                {beatsGlobal ? (
                  <span title="IC migliore del globale (n≥10)">★ </span>
                ) : null}
                {s.label}
              </td>
              <td className="py-1.5 text-right tabular-nums px-2 whitespace-nowrap">{s.n_ic_pairs}</td>
              <td className={`py-1.5 text-right tabular-nums font-medium px-2 whitespace-nowrap ${icClass}`}>
                {fmtIc(s.ic_spearman)}
              </td>
              <td className="py-1.5 text-right tabular-nums px-2 whitespace-nowrap">
                {s.hit_rate_pct != null ? `${s.hit_rate_pct}%` : "—"}
              </td>
              <td className="py-1.5 text-right tabular-nums px-2 whitespace-nowrap">
                {fmtPct(s.mean_r_hold_pp)}
              </td>
              <td className="py-1.5 text-right tabular-nums pr-1 pl-2 text-ink-muted whitespace-nowrap">
                {fmtPct(s.mean_pred_bias_pp)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}

function SegmentDiagnosticsPanel({
  groups,
  globalIc,
}: {
  groups: DecisionSegmentGroup[];
  globalIc?: number | null;
}) {
  if (!groups.length) {
    return (
      <p className="text-sm text-ink-muted py-4 text-center">
        Diagnostica segmenti non disponibile — rigenera il cohort JSON.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-muted">
        IC Spearman e hit per sotto-cohort. <strong>Bias pred</strong> = media (pred − R reale):
        positivo = sovrastima. ★ = IC &gt; globale + 0.05 con n ≥ 10.
      </p>
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
        {groups.map((g) => (
          <div
            key={g.id}
            className="rounded-lg border border-[rgb(var(--border))]/50 bg-surface/30 p-3"
          >
            <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-2">
              {g.title}
            </h4>
            <SegmentTable segments={g.segments} globalIc={globalIc} />
          </div>
        ))}
      </div>
    </div>
  );
}

const QUINTILE_HINT: Record<string, string> = {
  Q1: "≈ 20% eventi con Affidabilità più bassa",
  Q2: "≈ 20% eventi · fascia basso-media",
  Q3: "≈ 20% eventi · fascia media",
  Q4: "≈ 20% eventi · fascia alto-media",
  Q5: "≈ 20% eventi con Affidabilità più alta",
};

type QuintileBarRow = {
  name: string;
  r: number;
  hit: number | null;
  n: number;
  aff: string;
  hint: string;
};

function QuintileTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: QuintileBarRow }>;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/60 bg-[rgb(var(--surface-elevated))] px-3 py-2 text-xs shadow-lg max-w-[240px]">
      <p className="font-semibold text-ink">
        {p.name} — {p.hint}
      </p>
      <p className="text-[10px] text-ink-muted mt-1 leading-snug">
        Quintile = 5 bucket uguali ordinati per punteggio Affidabilità del modello (non un flag
        «non affidabile»).
      </p>
      <p className="mt-1.5 tabular-nums">
        Affidabilità: <span className="text-ink-muted">{p.aff}</span>
      </p>
      <p className="tabular-nums">
        R medio T−7→T+7:{" "}
        <span className="font-semibold">{`${p.r >= 0 ? "+" : ""}${p.r.toFixed(2)}%`}</span>
      </p>
      <p className="tabular-nums text-ink-muted">
        n = {p.n} · hit direzionale {p.hit != null ? `${p.hit}%` : "—"}
      </p>
    </div>
  );
}

function QuintileChart({ quintiles }: { quintiles: DecisionQuintile[] }) {
  const data: QuintileBarRow[] = quintiles.map((q) => ({
    name: q.label,
    r: q.mean_r_hold_pp ?? 0,
    hit: q.hit_rate_pct,
    n: q.n,
    aff: `${q.aff_min}–${q.aff_max}%`,
    hint: QUINTILE_HINT[q.label] ?? "≈ 20% degli eventi in cohort",
  }));
  if (!data.length) {
    return (
      <p className="text-sm text-ink-muted py-6 text-center">
        Servono almeno 5 eventi con Affidabilità per i quintili.
      </p>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" className="opacity-25" />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} unit="%" />
        <Tooltip content={<QuintileTooltip />} />
        <Bar dataKey="r" name="R medio" radius={[4, 4, 0, 0]}>
          {data.map((d) => (
            <Cell
              key={d.name}
              fill={d.r >= 0 ? "rgb(var(--signal-up))" : "rgb(var(--signal-down))"}
              opacity={0.85}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function CohortTable({ rows }: { rows: DecisionCohortRow[] }) {
  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const da = a.realized_forward_pp ?? -999;
        const db = b.realized_forward_pp ?? -999;
        return db - da;
      }),
    [rows]
  );
  if (!sorted.length) {
    return (
      <p className="text-sm text-ink-muted py-4 text-center">
        Nessun evento in cohort — servono CD passate in past_catalyst_predictions.json
      </p>
    );
  }
  return (
    <div className="overflow-auto max-h-[360px]">
      <table className="w-full text-xs border-collapse">
        <thead className="sticky top-0 bg-surface-elevated">
          <tr className="text-[10px] uppercase tracking-wide text-ink-muted">
            <th className="text-left px-2 py-1.5">Ticker</th>
            <th className="text-left px-2 py-1.5">CD</th>
            <th className="text-right px-2 py-1.5">Affid.</th>
            <th className="text-right px-2 py-1.5">Pred fwd</th>
            <th className="text-right px-2 py-1.5">R real</th>
            <th className="text-center px-2 py-1.5">Hit</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const rColor =
              r.realized_forward_pp == null
                ? "text-ink-muted"
                : r.realized_forward_pp >= 0
                  ? "text-[rgb(var(--signal-up))]"
                  : "text-[rgb(var(--signal-down))]";
            return (
              <tr key={r.row_key} className="border-t border-[rgb(var(--border))]/30">
                <td className="px-2 py-1 font-semibold">{r.ticker}</td>
                <td className="px-2 py-1 text-ink-muted">{r.completion_date}</td>
                <td className="px-2 py-1 text-right tabular-nums">
                  {r.affidabilita_pct != null ? `${Math.round(r.affidabilita_pct)}%` : "—"}
                </td>
                <td className="px-2 py-1 text-right tabular-nums">{fmtPct(r.pred_forward_pp)}</td>
                <td className={`px-2 py-1 text-right tabular-nums font-medium ${rColor}`}>
                  {fmtPct(r.realized_forward_pp)}
                </td>
                <td className="px-2 py-1 text-center">
                  {r.direction_hit == null ? "—" : r.direction_hit ? "✓" : "✗"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function InvestmentDecisionLabView({
  simTable,
  simLoading,
}: {
  simTable: SheetTable | null;
  simLoading: boolean;
}) {
  const [labTab, setLabTab] = useState<LabTab>("signals");
  const [portfolioReload, setPortfolioReload] = useState(0);
  const [doc, setDoc] = useState<DecisionCohortDoc | null>(null);
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await loadInvestmentDecisionCohort();
    setDoc(res.doc);
    setSource(res.source);
    setError(res.error ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const summary = doc?.summary;
  const quintiles = doc?.quintiles ?? [];
  const segmentGroups = doc?.segment_groups ?? [];
  const rows = doc?.rows ?? [];
  const comparison = doc?.comparison;
  const historyTail = doc?.history_tail;
  const ic = summary?.ic_spearman;
  const globalIcAccent = icAccentLevel(ic);

  return (
    <section className="card flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-[rgb(var(--border))] px-4 py-3 shrink-0">
        <div>
          <h2 className="text-lg font-semibold">Investment Decision Lab</h2>
          <p className="text-xs text-ink-muted">
            Fase A — cohort storica + analisi delle tue simulazioni
            {source && labTab === "cohort" ? ` · ${source}` : ""}
          </p>
        </div>
        <div className="flex gap-0.5 p-0.5 rounded-md bg-[rgb(var(--surface-3))]/30">
          {(
            [
              ["signals",   "⚡ Segnali Attivi"],
              ["cohort",    "Cohort storica"],
              ["portfolio", "Tuo portafoglio"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`rounded px-2.5 py-1 text-[10px] font-medium transition ${
                labTab === id ? "bg-accent/20 text-accent" : "text-ink-muted hover:text-ink"
              }`}
              onClick={() => setLabTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn-ghost text-xs ml-auto"
          onClick={() => {
            void reload();
            setPortfolioReload((n) => n + 1);
          }}
        >
          Ricarica
        </button>
      </div>

      {error && (
        <p className="px-4 py-2 text-sm text-negative shrink-0">{error}</p>
      )}

      <div className="flex-1 min-h-0 overflow-auto p-4 space-y-4">
        {labTab === "signals" ? (
          <InvestmentSignalsPanel simTable={simTable} simLoading={simLoading} />
        ) : labTab === "portfolio" ? (
          <InvestmentSimOutcomesPanel reloadToken={portfolioReload} />
        ) : (
          <>
        <ProtocolPanel protocol={doc?.protocol} />

        {loading ? (
          <p className="text-sm text-ink-muted">Caricamento cohort…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <KpiCard label="Eventi cohort" value={String(summary?.n_events ?? 0)} />
              <KpiCard label="Coppie IC" value={String(summary?.n_ic_pairs ?? 0)} />
              <KpiCard label="IC Spearman" value={fmtIc(ic)} accent={globalIcAccent} sub="pred ↔ R real" />
              <KpiCard
                label="Hit rate"
                value={summary?.hit_rate_pct != null ? `${summary.hit_rate_pct}%` : "—"}
              />
              <KpiCard label="R medio" value={fmtPct(summary?.mean_r_hold_pp)} sub="T−7 → T+7" />
            </div>

            <div className="rounded-lg border border-[rgb(var(--border))]/50 p-4">
              <h3 className="text-sm font-semibold mb-3">Confronto before / after</h3>
              <ComparisonPanel comparison={comparison} historyTail={historyTail} />
            </div>

            <div className="rounded-lg border border-[rgb(var(--border))]/50 p-4">
              <h3 className="text-sm font-semibold mb-3">Diagnostica per segmento</h3>
              <SegmentDiagnosticsPanel groups={segmentGroups} globalIc={ic} />
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
              <div className="rounded-lg border border-[rgb(var(--border))]/50 p-3">
                <h3 className="text-sm font-semibold mb-1">Quintili Affidabilità → R medio</h3>
                <p className="text-[10px] text-ink-muted mb-2">
                  Q1 = 20% eventi con Affidabilità più bassa · Q5 = 20% con Affidabilità più alta
                  (barre = rendimento reale medio T−7→T+7).
                </p>
                <QuintileChart quintiles={quintiles} />
              </div>
              <div className="rounded-lg border border-[rgb(var(--border))]/50 p-3 flex flex-col min-h-[260px]">
                <h3 className="text-sm font-semibold mb-2">Tabella quintili</h3>
                <div className="overflow-auto flex-1">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-ink-muted text-[10px] uppercase">
                        <th className="text-left py-1">Q</th>
                        <th className="text-right py-1">Affid.</th>
                        <th className="text-right py-1">n</th>
                        <th className="text-right py-1">R medio</th>
                        <th className="text-right py-1">Hit %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quintiles.map((q) => (
                        <tr key={q.quintile} className="border-t border-[rgb(var(--border))]/30">
                          <td className="py-1">{q.label}</td>
                          <td className="py-1 text-right tabular-nums text-ink-muted">
                            {q.aff_min}–{q.aff_max}%
                          </td>
                          <td className="py-1 text-right tabular-nums">{q.n}</td>
                          <td className="py-1 text-right tabular-nums">{fmtPct(q.mean_r_hold_pp)}</td>
                          <td className="py-1 text-right tabular-nums">
                            {q.hit_rate_pct != null ? `${q.hit_rate_pct}%` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!quintiles.length && (
                    <p className="text-xs text-ink-muted py-4 text-center">Quintili non disponibili</p>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-[rgb(var(--border))]/50 p-3">
              <h3 className="text-sm font-semibold mb-2">Eventi cohort ({rows.length})</h3>
              <CohortTable rows={rows} />
            </div>
          </>
        )}
          </>
        )}
      </div>
    </section>
  );
}
