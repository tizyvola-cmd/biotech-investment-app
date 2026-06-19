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
import { SelectionChip, SelectionChipGroup } from "./SelectionChip";
import {
  buildPredictionGuideFromAccuracy,
  filterVisibleGuideGroups,
  GUIDE_POST_MACRO_GROUPS,
  GUIDE_PRE_MACRO_GROUPS,
  GUIDE_REF_ONLY_MACRO_GROUPS,
  guideToChartRows,
  loadGuideCurveVisibility,
  loadPredictionGuideRefCurves,
  MACRO_GROUP_COLORS,
  MACRO_GROUP_LABELS,
  mergeGuideWithRefs,
  persistWeeklyGuide,
  POST_CD_EPS_PP,
  PRE_CD_FALL_PP,
  PRE_CD_RALLY_PP,
  saveGuideCurveVisibility,
  visibilityForGuidePreset,
  type GuideBuildDiagnostics,
  type GuideCurveVisibilityPrefs,
  type GuideVisibilityPreset,
  type MacroGroupId,
  type PredictionGuideSnapshot,
  type WeeklyGuideState,
} from "../sheet/predictionGuide";
import type { GuideCurvePoint } from "../sheet/predictionGuide";
import { fmtAxisPctTick } from "../sheet/chartAxisFormat";

type CompareMode = "this" | "last" | "overlay";

function groupHasAnyData(id: MacroGroupId, snapshot: PredictionGuideSnapshot): boolean {
  return (
    hasCurveData(snapshot.curves[id]) || hasCurveData(snapshot.refCurves[id])
  );
}

function yDomainForChartRows(
  rows: Record<string, string | number>[],
  dataKeys: string[]
): [number, number] | undefined {
  const vals: number[] = [];
  for (const row of rows) {
    for (const key of dataKeys) {
      const v = row[key];
      if (typeof v === "number" && Number.isFinite(v)) vals.push(v);
    }
  }
  if (vals.length < 2) return undefined;
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo;
  const pad = Math.max(0.75, span * 0.1);
  return [lo - pad, hi + pad];
}

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

function hasCurveData(curve?: GuideCurvePoint[]): boolean {
  return Boolean(curve?.some((p) => p.meanPct != null && Number.isFinite(p.meanPct)));
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
    const pick = (src: Partial<Record<MacroGroupId, GuideCurvePoint[]>>) =>
      guideToChartRows(src, groupIds);

    if (compareMode === "last" && weekly.lastWeek?.curves) {
      return pick(weekly.lastWeek.curves);
    }

    const merged: Partial<Record<MacroGroupId, GuideCurvePoint[]>> = {};
    const refOverlay: Partial<Record<MacroGroupId, GuideCurvePoint[]>> = {};
    for (const id of groupIds) {
      const emp = snapshot.curves[id];
      const ref = snapshot.refCurves[id];
      if (hasCurveData(emp)) merged[id] = emp;
      else if (hasCurveData(ref)) merged[id] = ref;
      if (hasCurveData(ref) && hasCurveData(emp)) refOverlay[id] = ref;
    }

    const thisRows = pick(merged);
    if (compareMode !== "overlay" || !weekly.lastWeek?.curves) {
      if (thisRows.length >= 2) return thisRows;
      // Reference μ only
      const refOnly: Partial<Record<MacroGroupId, GuideCurvePoint[]>> = {};
      for (const id of groupIds) {
        if (hasCurveData(snapshot.refCurves[id])) refOnly[id] = snapshot.refCurves[id];
      }
      const refRows = pick(refOnly);
      if (refRows.length >= 2) return refRows;
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
    // Overlay μ JSON (dashed) when Accuracy aggregation coexists
    for (const [off, rec] of byOff) {
      for (const id of groupIds) {
        const refPt = refOverlay[id]?.find((p) => p.offset === off);
        if (refPt?.meanPct != null) rec[`${id}_ref`] = refPt.meanPct;
      }
    }
    return [...byOff.values()].sort((a, b) => Number(a.offset) - Number(b.offset));
  }, [snapshot, weekly, compareMode, groupIds]);

  const lineIds = useMemo(() => {
    const ids: { key: string; gid: MacroGroupId; dashed: boolean }[] = [];
    for (const gid of groupIds) {
      ids.push({
        key: gid,
        gid,
        dashed: Boolean(dashedIds?.has(gid) && hasCurveData(snapshot.curves[gid])),
      });
      if (hasCurveData(snapshot.refCurves[gid]) && hasCurveData(snapshot.curves[gid])) {
        ids.push({ key: `${gid}_ref`, gid, dashed: true });
      }
      if (compareMode === "overlay" && weekly.lastWeek) {
        ids.push({ key: `${gid}_prev`, gid, dashed: true });
      }
    }
    return ids;
  }, [groupIds, compareMode, weekly.lastWeek, dashedIds, snapshot.curves, snapshot.refCurves]);

  const yDomain = useMemo(
    () => yDomainForChartRows(activeCurves, lineIds.map((l) => l.key)),
    [activeCurves, lineIds]
  );

  if (groupIds.length === 0) {
    return (
      <div className="rounded-lg border border-[rgb(var(--border))]/60 p-4">
        <h3 className="text-sm font-semibold mb-2">{title}</h3>
        <p className="text-xs text-ink-muted py-4 text-center">
          No curve selected — enable at least one macro-group below.
        </p>
      </div>
    );
  }

  if (activeCurves.length < 2) {
    return (
      <div className="rounded-lg border border-[rgb(var(--border))]/60 p-4">
        <h3 className="text-sm font-semibold mb-2">{title}</h3>
        <p className="text-xs text-ink-muted py-4 text-center">
          Not enough data to plot the curve — at least 2 nodes with a % value are required.
          {snapshot.refSource
            ? " The reference μ curves do not cover enough nodes for this chart."
            : " Regenerate chart snapshots (Export_Desktop_Snapshots) or run refresh_predizione_guida.py."}
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
            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${fmtAxisPctTick(v)}%`} domain={yDomain} />
            <Tooltip
              formatter={(v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`}
              labelFormatter={(l) => `Node ${l}`}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {lineIds.map(({ key, gid, dashed }) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                name={
                  key.endsWith("_prev")
                    ? `${MACRO_GROUP_LABELS[gid]} (last week)`
                    : key.endsWith("_ref")
                      ? `${MACRO_GROUP_LABELS[gid]} (reference μ)`
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
  sheetError,
  accuracyDataStale,
  manifestUpdatedAt,
  onReloadAccuracy,
}: {
  accTable: SheetTable | null;
  sheetLoading: boolean;
  sheetError?: string | null;
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
  const [visPrefs, setVisPrefs] = useState<GuideCurveVisibilityPrefs>(loadGuideCurveVisibility);
  const [diag, setDiag] = useState<GuideBuildDiagnostics | null>(null);

  const persistVis = useCallback((next: GuideCurveVisibilityPrefs) => {
    setVisPrefs(next);
    saveGuideCurveVisibility(next);
  }, []);

  const toggleVis = useCallback(
    (chart: "post" | "pre", id: MacroGroupId, checked: boolean) => {
      persistVis({
        ...visPrefs,
        [chart]: { ...visPrefs[chart], [id]: checked },
      });
    },
    [visPrefs, persistVis]
  );

  const applyVisPreset = useCallback(
    (preset: GuideVisibilityPreset, chart: "post" | "pre") => {
      persistVis({
        ...visPrefs,
        [chart]: visibilityForGuidePreset(preset, chart),
      });
    },
    [visPrefs, persistVis]
  );

  const visiblePostGroups = useMemo(
    () => filterVisibleGuideGroups(GUIDE_POST_MACRO_GROUPS, visPrefs.post),
    [visPrefs.post]
  );

  const visiblePreGroups = useMemo(
    () => filterVisibleGuideGroups(GUIDE_PRE_MACRO_GROUPS, visPrefs.pre),
    [visPrefs.pre]
  );

  const accRowCount = accTable?.rows?.length ?? 0;
  const accColumns = accTable?.columns;

  const recompute = useCallback(async () => {
    const rows = (accTable?.rows ?? []) as Record<string, unknown>[];
    const guide = buildPredictionGuideFromAccuracy(
      rows,
      accTable ? `Accuracy (${rows.length} rows)` : "Accuracy",
      accColumns
    );
    setDiag(guide.diagnostics);
    const { diagnostics: _diagDrop, ...snapBase } = guide;
    void _diagDrop;
    const { curves: refCurves, source } = await loadPredictionGuideRefCurves();
    if (source) setChartsSource(source);
    const merged = mergeGuideWithRefs(snapBase, refCurves, source);

    setSnapshot(merged);
    setWeekly(persistWeeklyGuide(merged));
  }, [accTable, accRowCount, accColumns]);

  useEffect(() => {
    if (sheetLoading) return;
    void recompute();
  }, [recompute, sheetLoading]);

  const refOverrides = useMemo(() => {
    const ids = new Set<string>();
    if (!snapshot) return ids;
    for (const id of GUIDE_POST_MACRO_GROUPS) {
      if (hasCurveData(snapshot.refCurves[id]) && hasCurveData(snapshot.curves[id])) {
        ids.add(id);
      }
    }
    return ids;
  }, [snapshot]);

  if (sheetLoading) {
    return <p className="text-sm text-ink-muted">Loading Accuracy sheet…</p>;
  }

  const accRows = accTable?.rows?.length ?? 0;
  if (sheetError || accRows === 0) {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p className="text-negative">
          {sheetError ?? "Accuracy sheet empty or missing — export data/accuracy_sheet_snapshot.json."}
        </p>
        {onReloadAccuracy ? (
          <button type="button" className="btn text-xs py-1.5 self-start" onClick={onReloadAccuracy}>
            Reload Accuracy
          </button>
        ) : null}
      </div>
    );
  }

  if (!snapshot) {
    return <p className="text-sm text-ink-muted">Computing curves…</p>;
  }

  const lastUpdatedLabel = snapshot.computedAt
    ? new Date(snapshot.computedAt).toLocaleString("en-US", { hour12: false })
    : "—";

  return (
    <div className="flex flex-col flex-1 gap-4">
      <p className="text-xs text-ink-muted shrink-0">
        Empirical % distribution vs T−60 around the CD — same thresholds as the{" "}
        <strong>Prediction Guide</strong> sheet and μ curves (Global, Cluster 0, SuperNova cl.1, Post-CD).
        Post-CD: pre (T−7,−5,−3) vs post (T+4,+7) mean; threshold ±{POST_CD_EPS_PP} pp. Pre-CD (~2 months):
        T−10 vs T−60, threshold {PRE_CD_RALLY_PP}/{PRE_CD_FALL_PP} pp.
      </p>

      {accuracyDataStale && (
        <p className="text-xs text-amber-600 dark:text-amber-400 shrink-0 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
          In-memory Accuracy data not aligned with the snapshot on disk
          {manifestUpdatedAt
            ? ` (export ${new Date(manifestUpdatedAt).toLocaleString("en-US", { hour12: false })})`
            : ""}
          .{" "}
          {onReloadAccuracy ? (
            <button
              type="button"
              className="underline text-accent"
              onClick={() => onReloadAccuracy()}
            >
              Reload Accuracy
            </button>
          ) : (
            "Press Reload Accuracy at the top."
          )}
        </p>
      )}

      <div className="flex flex-wrap gap-2 shrink-0">
        <SummaryCard
          label="Last recompute"
          value={lastUpdatedLabel}
          hint="curves from current Accuracy sheet"
        />
        <SummaryCard
          label="N data (cohort)"
          value={String(snapshot.nEligible)}
          hint="past CD · Exact/Partial"
        />
        <SummaryCard
          label="+N this week"
          value={`+${weekly.newThisWeek}`}
          hint={weekly.thisWeek?.weekKey ?? isoWeekLabel()}
        />
        <SummaryCard
          label="Δ vs last week"
          value={
            weekly.deltaVsLastWeek != null
              ? `${weekly.deltaVsLastWeek >= 0 ? "+" : ""}${weekly.deltaVsLastWeek}`
              : "—"
          }
          hint={
            weekly.lastWeek
              ? `prev.: ${weekly.lastWeek.nSamples} · ${weekly.lastWeek.weekKey}`
              : "first week"
          }
        />
        <SummaryCard
          label="Classified Post-CD"
          value={String(snapshot.nClassifiedPost)}
          hint={`of ${snapshot.nEligible}`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <span className="text-xs text-ink-muted">Week comparison:</span>
        <SelectionChipGroup>
          {(
            [
              ["this", "This week"],
              ["last", "Last week"],
              ["overlay", "Overlay"],
            ] as const
          ).map(([mode, label]) => (
            <SelectionChip
              key={mode}
              active={compareMode === mode}
              disabled={mode !== "this" && !weekly.lastWeek}
              onClick={() => setCompareMode(mode)}
            >
              {label}
            </SelectionChip>
          ))}
        </SelectionChipGroup>
        <SelectionChip
          className="ml-auto"
          active={showPreCd}
          onClick={() => setShowPreCd((v) => !v)}
        >
          Show pre-CD behaviors
        </SelectionChip>
        <SelectionChip onClick={() => void recompute()}>Recompute</SelectionChip>
      </div>

      {snapshot.refSource && (
        <p className="text-[10px] text-ink-muted shrink-0">
          Reference μ: {snapshot.refSource}
          {chartsSource && ` · ${chartsSource}`}
          {refOverrides.size > 0 && " — solid line = μ JSON; dashed = Accuracy only"}
        </p>
      )}

      {!snapshot.refSource && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400 shrink-0">
          Reference μ missing in simulation_charts_snapshot.json — curves from Accuracy
          aggregation only. Regenerate chart snapshots to align Post-CD μ.
        </p>
      )}

      {snapshot.nEligible < 4 && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400 shrink-0">
          Small cohort (N={snapshot.nEligible}): unstable curves — more past CDs with
          Exact/Partial and historical % over at least 4 nodes are needed.
          {diag && snapshot.nEligible === 0 ? (
            <span className="block mt-0.5 text-ink-muted">
              Diagnostics: {diag.nRows} rows · {diag.nPastCd} past CD · {diag.nSponsorOk} sponsor
              ok · {diag.nWithTrajectory} with ≥4 Historical % nodes.
              {snapshot.refSource
                ? " Showing reference μ curves (historical cohort interpolation)."
                : " Regenerate snapshot: Export_Desktop_Snapshots.bat or refresh_predizione_guida.py."}
            </span>
          ) : null}
        </p>
      )}

      <div className="rounded-lg border border-[rgb(var(--border))]/60 p-3 shrink-0 space-y-2">
        <p className="text-xs font-medium text-accent">Visible curves (Post-CD)</p>
        <p className="text-[10px] text-ink-muted leading-snug">
          Disable a curve to shrink the Y axis and see the others better (e.g. hide
          SuperNova).
        </p>
        <SelectionChipGroup>
          {(
            [
              ["noSupernova", "Without SuperNova"],
              ["postCdOnly", "Only Post-CD"],
              ["noCluster", "Without Cluster"],
              ["empiricalOnly", "Empirical only"],
              ["all", "All"],
              ["none", "None"],
            ] as const
          ).map(([preset, label]) => (
            <SelectionChip key={preset} onClick={() => applyVisPreset(preset, "post")}>
              {label}
            </SelectionChip>
          ))}
        </SelectionChipGroup>
        <SelectionChipGroup className="mt-1">
          {GUIDE_POST_MACRO_GROUPS.map((id) => {
            const hasData = groupHasAnyData(id, snapshot);
            const on = visPrefs.post[id] !== false;
            const countLabel = GUIDE_REF_ONLY_MACRO_GROUPS.has(id)
              ? hasCurveData(snapshot.refCurves[id])
                ? "μ"
                : "—"
              : String(snapshot.groupCounts[id] ?? 0);
            return (
              <SelectionChip
                key={id}
                active={on}
                disabled={!hasData}
                className={hasData ? "" : "opacity-50"}
                onClick={() => toggleVis("post", id, !on)}
              >
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: MACRO_GROUP_COLORS[id] }}
                  />
                  <span className="truncate">
                    {MACRO_GROUP_LABELS[id]}: <strong className="tabular-nums">{countLabel}</strong>
                  </span>
                </span>
              </SelectionChip>
            );
          })}
        </SelectionChipGroup>
      </div>

      <GuideChart
        title="Post-CD macro-groups (mean historical % vs T−60)"
        groupIds={visiblePostGroups}
        snapshot={snapshot}
        weekly={weekly}
        compareMode={compareMode}
        dashedIds={refOverrides}
      />

      {showPreCd && (
        <>
          <div className="rounded-lg border border-[rgb(var(--border))]/60 p-3 shrink-0 space-y-2">
            <p className="text-xs font-medium text-accent">Visible curves (Pre-CD)</p>
            <SelectionChipGroup>
              {(
                [
                  ["all", "All"],
                  ["none", "None"],
                ] as const
              ).map(([preset, label]) => (
                <SelectionChip key={preset} onClick={() => applyVisPreset(preset, "pre")}>
                  {label}
                </SelectionChip>
              ))}
            </SelectionChipGroup>
            <SelectionChipGroup className="mt-1">
              {GUIDE_PRE_MACRO_GROUPS.map((id) => {
                const hasData = groupHasAnyData(id, snapshot);
                const on = visPrefs.pre[id] !== false;
                return (
                  <SelectionChip
                    key={id}
                    active={on}
                    disabled={!hasData}
                    className={hasData ? "" : "opacity-50"}
                    onClick={() => toggleVis("pre", id, !on)}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: MACRO_GROUP_COLORS[id] }}
                      />
                      <span>
                        {MACRO_GROUP_LABELS[id]}:{" "}
                        <strong className="tabular-nums">{snapshot.groupCounts[id] ?? 0}</strong>
                      </span>
                    </span>
                  </SelectionChip>
                );
              })}
            </SelectionChipGroup>
          </div>
          <GuideChart
            title="Behaviors ~2 months before CD"
            groupIds={visiblePreGroups}
            snapshot={snapshot}
            weekly={weekly}
            compareMode={compareMode}
          />
        </>
      )}

      <p className="text-[10px] text-ink-muted shrink-0 pb-2">
        Aggregation source: {snapshot.dataSource}
        {chartsSource ? ` · μ JSON: ${chartsSource}` : " · μ JSON: missing"}
        . Weekly history in localStorage (max 2 weeks). Percentages normalized from
        Excel fraction (×100 if |v|≤1.5).
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
