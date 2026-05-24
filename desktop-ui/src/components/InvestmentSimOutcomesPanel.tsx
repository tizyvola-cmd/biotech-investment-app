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
import {
  loadInvestmentSimOutcomes,
  type SimAffQuintile,
  type SimOutcomesDoc,
  type SimOutcomeRow,
  type SimSegment,
  type SimSegmentGroup,
} from "../data/investmentSimOutcomesData";

function fmtUsd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}%`;
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

const SIM_QUINTILE_HINT: Record<string, string> = {
  Q1: "≈ 20% posizioni con Affidabilità più bassa",
  Q2: "≈ 20% · fascia basso-media",
  Q3: "≈ 20% · fascia media",
  Q4: "≈ 20% · fascia alto-media",
  Q5: "≈ 20% posizioni con Affidabilità più alta",
};

function SimQuintileTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: { name: string; pnl: number; aff: string; hint: string; n: number; win: number | null } }>;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/60 bg-[rgb(var(--surface-elevated))] px-3 py-2 text-xs shadow-lg max-w-[220px]">
      <p className="font-semibold">
        {p.name} — {p.hint}
      </p>
      <p className="mt-1 tabular-nums">
        P&L medio: <span className="font-semibold">{fmtUsd(p.pnl)}</span>
      </p>
      <p className="text-ink-muted tabular-nums">
        Affid. {p.aff} · n={p.n} · win {p.win != null ? `${p.win}%` : "—"}
      </p>
    </div>
  );
}

function SimQuintileChart({ quintiles }: { quintiles: SimAffQuintile[] }) {
  const data = quintiles.map((q) => ({
    name: q.label,
    pnl: q.mean_pnl_eur ?? 0,
    aff: `${q.aff_min}–${q.aff_max}%`,
    hint: SIM_QUINTILE_HINT[q.label] ?? "",
    n: q.n,
    win: q.win_rate_pct,
  }));
  if (!data.length) {
    return <p className="text-xs text-ink-muted py-4 text-center">Servono ≥5 posizioni con Affidabilità.</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" className="opacity-25" />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip content={<SimQuintileTooltip />} />
        <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
          {data.map((d) => (
            <Cell
              key={d.name}
              fill={d.pnl >= 0 ? "rgb(var(--signal-up))" : "rgb(var(--signal-down))"}
              opacity={0.85}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function SegmentMetricsTable({ segments }: { segments: SimSegment[] }) {
  return (
    <table className="w-full min-w-[20rem] text-xs">
      <thead>
        <tr className="text-[10px] uppercase text-ink-muted">
          <th className="text-left py-1 pl-1">Segmento</th>
          <th className="text-right px-1">n</th>
          <th className="text-right px-1">Win%</th>
          <th className="text-right px-1">P&L medio</th>
          <th className="text-right pr-1">Hit pred</th>
        </tr>
      </thead>
      <tbody>
        {segments.map((s) => (
          <tr key={s.label} className="border-t border-[rgb(var(--border))]/25">
            <td className="py-1 pl-1">{s.label}</td>
            <td className="py-1 text-right tabular-nums">{s.n_positions}</td>
            <td className="py-1 text-right tabular-nums">{s.win_rate_pct != null ? `${s.win_rate_pct}%` : "—"}</td>
            <td className="py-1 text-right tabular-nums">{fmtUsd(s.mean_pnl_eur)}</td>
            <td className="py-1 text-right tabular-nums pr-1">
              {s.hit_pred_pct != null ? `${s.hit_pred_pct}%` : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PositionsTable({ rows }: { rows: SimOutcomeRow[] }) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => (b.pnl_eur ?? -1e9) - (a.pnl_eur ?? -1e9)),
    [rows]
  );
  return (
    <div className="overflow-auto max-h-[320px]">
      <table className="w-full text-xs border-collapse min-w-[36rem]">
        <thead className="sticky top-0 bg-surface-elevated">
          <tr className="text-[10px] uppercase text-ink-muted">
            <th className="text-left px-2 py-1.5">Ticker</th>
            <th className="text-left px-1 py-1.5">CD</th>
            <th className="text-right px-1 py-1.5">Quando</th>
            <th className="text-right px-1 py-1.5">Capitale</th>
            <th className="text-right px-1 py-1.5">P&L</th>
            <th className="text-right px-1 py-1.5">Affid.</th>
            <th className="text-right px-1 py-1.5">Pred+7</th>
            <th className="text-center px-2 py-1.5">Esito</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const pnlColor =
              r.pnl_eur == null
                ? "text-ink-muted"
                : r.pnl_eur >= 0
                  ? "text-[rgb(var(--signal-up))]"
                  : "text-[rgb(var(--signal-down))]";
            return (
              <tr key={r.row_key} className="border-t border-[rgb(var(--border))]/30">
                <td className="px-2 py-1 font-semibold">{r.ticker}</td>
                <td className="px-1 py-1 text-ink-muted">{r.completion_date}</td>
                <td className="px-1 py-1 text-right text-ink-muted">{r.timing_label}</td>
                <td className="px-1 py-1 text-right tabular-nums">{fmtUsd(r.capital_eur)}</td>
                <td className={`px-1 py-1 text-right tabular-nums font-medium ${pnlColor}`}>
                  {fmtUsd(r.pnl_eur)}
                  {r.pnl_pct != null && (
                    <span className="block text-[10px] opacity-80">{fmtPct(r.pnl_pct)}</span>
                  )}
                </td>
                <td className="px-1 py-1 text-right tabular-nums">
                  {r.affidabilita_pct != null ? `${Math.round(r.affidabilita_pct)}%` : "—"}
                </td>
                <td className="px-1 py-1 text-right tabular-nums">{fmtPct(r.pred7_pp)}</td>
                <td className="px-2 py-1 text-center text-[10px]">
                  {r.outcome_label}
                  {r.pred_direction_hit != null && (
                    <span className="block">{r.pred_direction_hit ? "✓ pred" : "✗ pred"}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function InvestmentSimOutcomesPanel({ reloadToken = 0 }: { reloadToken?: number }) {
  const [doc, setDoc] = useState<SimOutcomesDoc | null>(null);
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await loadInvestmentSimOutcomes({ rebuild: true });
    setDoc(res.doc);
    setSource(res.source);
    setError(res.error ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, reloadToken]);

  const summary = doc?.summary;
  const rows = doc?.rows ?? [];
  const groups = doc?.segment_groups ?? [];
  const quintiles = doc?.aff_quintiles ?? [];

  const winAccent =
    summary?.win_rate_pct == null
      ? undefined
      : summary.win_rate_pct >= 55
        ? "up"
        : summary.win_rate_pct < 45
          ? "down"
          : "warn";
  const pnlAccent =
    summary?.total_pnl_eur == null
      ? undefined
      : summary.total_pnl_eur > 0
        ? "up"
        : summary.total_pnl_eur < 0
          ? "down"
          : undefined;

  if (loading) {
    return <p className="text-sm text-ink-muted">Caricamento simulazioni…</p>;
  }

  if (error) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-negative">{error}</p>
        <p className="text-xs text-ink-muted">
          Imposta <strong>Capitale</strong> e <strong>Acquisto €</strong> in Investimento → Foglio prediction;
          i dati si sincronizzano da <code className="text-[10px]">invest_sim_inputs.json</code>.
          Usa <strong>Ricarica</strong> in alto per rigenerare l&apos;analisi.
        </p>
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="space-y-2 text-sm text-ink-muted">
        <p>Nessuna posizione simulata trovata nello snapshot Simulation.</p>
        <p className="text-xs">
          Le righe con capitale &gt; 0 compaiono qui. Verifica il foglio Excel e rigenera lo snapshot.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-muted">
        Analisi delle <strong>tue</strong> simulazioni (non tutta la coorte storica). Base per il futuro
        motore di suggerimento investimento. {source ? `· ${source}` : ""}
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
        <KpiCard label="Posizioni" value={String(summary?.n_positions ?? 0)} sub={`${summary?.n_open ?? 0} aperte · ${summary?.n_closed ?? 0} chiuse`} />
        <KpiCard label="Win rate" value={summary?.win_rate_pct != null ? `${summary.win_rate_pct}%` : "—"} accent={winAccent} />
        <KpiCard label="P&L totale" value={fmtUsd(summary?.total_pnl_eur)} accent={pnlAccent} />
        <KpiCard label="Capitale" value={fmtUsd(summary?.total_capital_eur)} />
        <KpiCard label="Hit pred +7" value={summary?.hit_pred_direction_pct != null ? `${summary.hit_pred_direction_pct}%` : "—"} sub="segno pred = segno P&L" />
        <KpiCard
          label="Win (chiuse)"
          value={summary?.win_rate_closed_pct != null ? `${summary.win_rate_closed_pct}%` : "—"}
          sub="solo CD passate"
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-lg border border-[rgb(var(--border))]/50 p-3">
          <h4 className="text-sm font-semibold mb-1">Affidabilità → P&L medio</h4>
          <p className="text-[10px] text-ink-muted mb-2">Quintili sulle tue posizioni (verde = gain medio).</p>
          <SimQuintileChart quintiles={quintiles} />
        </div>
        <div className="rounded-lg border border-[rgb(var(--border))]/50 p-3 overflow-x-auto">
          <h4 className="text-sm font-semibold mb-2">Per quando avviene (vs CD)</h4>
          <SegmentMetricsTable
            segments={groups.find((g) => g.id === "timing")?.segments ?? []}
          />
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        {groups
          .filter((g) => g.id !== "timing")
          .map((g: SimSegmentGroup) => (
            <div
              key={g.id}
              className="rounded-lg border border-[rgb(var(--border))]/50 p-3 overflow-x-auto"
            >
              <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-muted mb-2">
                {g.title}
              </h4>
              <SegmentMetricsTable segments={g.segments} />
            </div>
          ))}
      </div>

      <div className="rounded-lg border border-[rgb(var(--border))]/50 p-3">
        <h4 className="text-sm font-semibold mb-2">Dettaglio posizioni ({rows.length})</h4>
        <PositionsTable rows={rows} />
      </div>
    </div>
  );
}
