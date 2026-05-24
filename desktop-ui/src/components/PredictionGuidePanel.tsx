import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SheetTable } from "../types";
import { loadSimulationChartsBundle } from "../data/simulationCharts";
import {
  buildPredictionGuideFromAccuracy,
  guideToChartRows,
  MACRO_GROUP_COLORS,
  MACRO_GROUP_LABELS,
  mergeGuideWithRefs,
  persistWeeklyGuide,
  POST_CD_EPS_PP,
  PRE_CD_FALL_PP,
  PRE_CD_RALLY_PP,
  refCurvesFromChartBundle,
  type MacroGroupId,
  type PredictionGuideSnapshot,
  type WeeklyGuideState,
} from "../sheet/predictionGuide";

const POST_GROUPS: MacroGroupId[] = [
  "globale",
  "post_rialzo",
  "post_ribasso",
  "post_neutro",
];

const PRE_GROUPS: MacroGroupId[] = ["pre_rally", "pre_fall", "pre_flat"];

type CompareMode = "this" | "last" | "overlay";

function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/60 bg-surface-elevated/40 px-3 py-2 min-w-[7rem]">
      <p className="text-[10px] text-ink-muted uppercase tracking-wide">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-[10px] text-ink-muted mt-0.5">{hint}</p>}
    </div>
  );
}

function GuideChart({
  title,
  groupIds,
  snapshot,
  weekly,
  compareMode,
  dashedIds,
}: {
  title: string;
  groupIds: MacroGroupId[];
  snapshot: PredictionGuideSnapshot;
  weekly: WeeklyGuideState;
  compareMode: CompareMode;
  dashedIds?: Set<string>;
}) {
  const activeCurves = useMemo(() => {
    const pick = (src: Partial<Record<MacroGroupId, import("../sheet/predictionGuide").GuideCurvePoint[]>>) =>
      guideToChartRows(src, groupIds);

    if (compareMode === "last" && weekly.lastWeek?.curves) {
      return pick(weekly.lastWeek.curves);
    }
    const merged: Partial<Record<MacroGroupId, import("../sheet/predictionGuide").GuideCurvePoint[]>> =
      {};
    for (const id of groupIds) {
      merged[id] = snapshot.refCurves[id] ?? snapshot.curves[id];
    }
    const thisRows = pick(merged);
    if (compareMode !== "overlay" || !weekly.lastWeek?.curves) {
      return thisRows;
    }
    const lastRows = pick(weekly.lastWeek.curves);
    const byOff = new Map<number, Record<string, string | number>>();
    for (const r of thisRows) {
      byOff.set(Number(r.offset), { ...r });
    }
    for (const r of lastRows) {
      const off = Number(r.offset);
      let rec = byOff.get(off);
      if (!rec) {
        rec = { offset: r.offset, xLabel: r.xLabel };
        byOff.set(off, rec);
      }
      for (const id of groupIds) {
        if (r[id] != null) rec[`${id}_prev`] = r[id];
      }
    }
    return [...byOff.values()].sort((a, b) => Number(a.offset) - Number(b.offset));
  }, [snapshot, weekly, compareMode, groupIds]);

  const lineIds = useMemo(() => {
    const ids: { key: string; gid: MacroGroupId; dashed: boolean }[] = [];
    for (const gid of groupIds) {
      ids.push({ key: gid, gid, dashed: Boolean(dashedIds?.has(gid)) });
      if (compareMode === "overlay" && weekly.lastWeek) {
        ids.push({ key: `${gid}_prev`, gid, dashed: true });
      }
    }
    return ids;
  }, [groupIds, compareMode, weekly.lastWeek, dashedIds]);

  if (activeCurves.length < 2) {
    return (
      <div className="rounded-lg border border-[rgb(var(--border))]/60 p-4">
        <h3 className="text-sm font-semibold mb-2">{title}</h3>
        <p className="text-xs text-ink-muted py-4 text-center">
          Dati insufficienti — servono eventi con CD passata e % storiche su più nodi.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/60 p-3">
      <h3 className="text-sm font-semibold mb-2">{title}</h3>
      <div className="h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={activeCurves} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-25" />
            <XAxis dataKey="xLabel" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} unit="%" />
            <Tooltip
              formatter={(v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`}
              labelFormatter={(l) => `Nodo ${l}`}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {lineIds.map(({ key, gid, dashed }) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                name={
                  key.endsWith("_prev")
                    ? `${MACRO_GROUP_LABELS[gid]} (sett. scorsa)`
                    : MACRO_GROUP_LABELS[gid]
                }
                stroke={MACRO_GROUP_COLORS[gid]}
                strokeWidth={dashed ? 1.25 : 2}
                strokeDasharray={dashed ? "6 4" : undefined}
                dot={{ r: dashed ? 2 : 3 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function PredictionGuidePanel({
  accTable,
  sheetLoading,
  accuracyDataStale,
  manifestUpdatedAt,
  onReloadAccuracy,
}: {
  accTable: SheetTable | null;
  sheetLoading: boolean;
  accuracyDataStale?: boolean;
  manifestUpdatedAt?: string | null;
  onReloadAccuracy?: () => void;
}) {
  const [snapshot, setSnapshot] = useState<PredictionGuideSnapshot | null>(null);
  const [weekly, setWeekly] = useState<WeeklyGuideState>({
    thisWeek: null,
    lastWeek: null,
    newThisWeek: 0,
    deltaVsLastWeek: null,
  });
  const [chartsSource, setChartsSource] = useState("");
  const [compareMode, setCompareMode] = useState<CompareMode>("this");
  const [showPreCd, setShowPreCd] = useState(false);

  const accRowCount = accTable?.rows?.length ?? 0;

  const recompute = useCallback(async () => {
    const rows = (accTable?.rows ?? []) as Record<string, unknown>[];
    let guide = buildPredictionGuideFromAccuracy(
      rows,
      accTable ? `Accuracy (${rows.length} righe)` : "Accuracy"
    );

    const chartRes = await loadSimulationChartsBundle();
    const { curves: refCurves, source } = refCurvesFromChartBundle(chartRes.bundle);
    if (source) setChartsSource(source);
    guide = mergeGuideWithRefs(guide, refCurves, source);

    setSnapshot(guide);
    setWeekly(persistWeeklyGuide(guide));
  }, [accTable, accRowCount]);

  useEffect(() => {
    if (sheetLoading) return;
    void recompute();
  }, [recompute, sheetLoading]);

  const refOverrides = useMemo(() => {
    const ids = new Set<string>();
    if (!snapshot) return ids;
    for (const id of POST_GROUPS) {
      if (snapshot.refCurves[id]?.some((p) => p.meanPct != null)) ids.add(id);
    }
    return ids;
  }, [snapshot]);

  if (sheetLoading) {
    return <p className="text-sm text-ink-muted">Caricamento foglio Accuracy…</p>;
  }

  if (!snapshot) {
    return <p className="text-sm text-ink-muted">Calcolo curve…</p>;
  }

  const lastUpdatedLabel = snapshot.computedAt
    ? new Date(snapshot.computedAt).toLocaleString("it-IT")
    : "—";

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4 overflow-y-auto">
      <p className="text-xs text-ink-muted shrink-0">
        Distribuzione empirica % vs T−60 attorno al CD — stesse soglie del foglio{" "}
        <strong>Predizione — guida</strong> e curve μ dei grafici Catalyst/Simulation. Post-CD: media
        pre (T−7,−5,−3) vs post (T+4,+7); soglia ±{POST_CD_EPS_PP} pp. Pre-CD (~2 mesi): T−10 vs
        T−60, soglia {PRE_CD_RALLY_PP}/{PRE_CD_FALL_PP} pp.
      </p>

      {accuracyDataStale && (
        <p className="text-xs text-amber-600 dark:text-amber-400 shrink-0 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
          Dati Accuracy in memoria non allineati allo snapshot su disco
          {manifestUpdatedAt
            ? ` (export ${new Date(manifestUpdatedAt).toLocaleString("it-IT")})`
            : ""}
          .{" "}
          {onReloadAccuracy ? (
            <button
              type="button"
              className="underline text-accent"
              onClick={() => onReloadAccuracy()}
            >
              Ricarica Accuracy
            </button>
          ) : (
            "Premi Ricarica Accuracy in alto."
          )}
        </p>
      )}

      <div className="flex flex-wrap gap-2 shrink-0">
        <SummaryCard
          label="Ultimo ricalcolo"
          value={lastUpdatedLabel}
          hint="curve da foglio Accuracy corrente"
        />
        <SummaryCard
          label="N dati (coorte)"
          value={String(snapshot.nEligible)}
          hint="CD passata · Exact/Partial"
        />
        <SummaryCard
          label="+N questa settimana"
          value={`+${weekly.newThisWeek}`}
          hint={weekly.thisWeek?.weekKey ?? isoWeekLabel()}
        />
        <SummaryCard
          label="Δ vs sett. scorsa"
          value={
            weekly.deltaVsLastWeek != null
              ? `${weekly.deltaVsLastWeek >= 0 ? "+" : ""}${weekly.deltaVsLastWeek}`
              : "—"
          }
          hint={
            weekly.lastWeek
              ? `prec.: ${weekly.lastWeek.nSamples} · ${weekly.lastWeek.weekKey}`
              : "prima settimana"
          }
        />
        <SummaryCard
          label="Classificati Post-CD"
          value={String(snapshot.nClassifiedPost)}
          hint={`su ${snapshot.nEligible}`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <span className="text-xs text-ink-muted">Confronto settimane:</span>
        {(
          [
            ["this", "Questa settimana"],
            ["last", "Settimana scorsa"],
            ["overlay", "Sovrapposto"],
          ] as const
        ).map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            className={`rounded-md px-2 py-1 text-xs transition ${
              compareMode === mode
                ? "bg-accent text-white"
                : "text-ink-muted hover:text-ink border border-[rgb(var(--border))]/60"
            }`}
            onClick={() => setCompareMode(mode)}
            disabled={mode !== "this" && !weekly.lastWeek}
          >
            {label}
          </button>
        ))}
        <label className="flex items-center gap-1.5 text-xs ml-auto cursor-pointer">
          <input
            type="checkbox"
            checked={showPreCd}
            onChange={(e) => setShowPreCd(e.target.checked)}
          />
          Mostra comportamenti pre-CD
        </label>
        <button type="button" className="btn-ghost text-xs" onClick={() => void recompute()}>
          Ricalcola
        </button>
      </div>

      {snapshot.refSource && (
        <p className="text-[10px] text-ink-muted shrink-0">
          μ riferimento: {snapshot.refSource}
          {chartsSource && ` · ${chartsSource}`}
          {refOverrides.size > 0 && " — linea continua = μ JSON; tratteggio = solo Accuracy"}
        </p>
      )}

      {!snapshot.refSource && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400 shrink-0">
          μ riferimento assenti in simulation_charts_snapshot.json — curve da sola aggregazione
          Accuracy. Rigenera snapshot grafici per allineare μ Post-CD.
        </p>
      )}

      {snapshot.nEligible < 4 && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400 shrink-0">
          Coorte piccola (N={snapshot.nEligible}): curve instabili — servono più CD passate con
          Exact/Partial e storico % su almeno 4 nodi.
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 shrink-0 text-xs">
        {POST_GROUPS.map((id) => (
          <div key={id} className="flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: MACRO_GROUP_COLORS[id] }}
            />
            <span>
              {MACRO_GROUP_LABELS[id]}:{" "}
              <strong className="tabular-nums">{snapshot.groupCounts[id] ?? 0}</strong>
            </span>
          </div>
        ))}
      </div>

      <GuideChart
        title="Macro-gruppi Post-CD (% storico medio vs T−60)"
        groupIds={POST_GROUPS}
        snapshot={snapshot}
        weekly={weekly}
        compareMode={compareMode}
        dashedIds={refOverrides}
      />

      {showPreCd && (
        <>
          <div className="grid grid-cols-3 gap-2 shrink-0 text-xs">
            {PRE_GROUPS.map((id) => (
              <div key={id} className="flex items-center gap-1.5">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: MACRO_GROUP_COLORS[id] }}
                />
                <span>
                  {MACRO_GROUP_LABELS[id]}:{" "}
                  <strong>{snapshot.groupCounts[id] ?? 0}</strong>
                </span>
              </div>
            ))}
          </div>
          <GuideChart
            title="Comportamenti ~2 mesi prima del CD"
            groupIds={PRE_GROUPS}
            snapshot={snapshot}
            weekly={weekly}
            compareMode={compareMode}
          />
        </>
      )}

      <p className="text-[10px] text-ink-muted shrink-0 pb-2">
        Fonte aggregazione: {snapshot.dataSource}
        {chartsSource ? ` · μ JSON: ${chartsSource}` : " · μ JSON: assente"}
        . Storico settimanale in localStorage (max 2 settimane). Percentuali normalizzate da
        frazione Excel (×100 se |v|≤1.5).
      </p>
    </div>
  );
}

function isoWeekLabel(): string {
  const d = new Date();
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
