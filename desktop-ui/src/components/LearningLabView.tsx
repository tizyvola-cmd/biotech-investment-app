import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  applyLearningCycle,
  exportLearningLabReport,
  fetchLearningLabOverview,
  previewLearningCycle,
  resetLearningLab,
  type LearningLabOverview,
} from "../api/supernova";
import { useLang, useT } from "../shared/i18n";
import { ViewErrorBoundary } from "./ViewErrorBoundary";
import type { SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import { fetchLearningPipelineOverview, fetchLearningAuditLog, type LearningAuditLog, type LearningPipelineOverview } from "../api/learningBus";
import { LearningLabAuditLogPanel } from "./LearningLabAuditLogPanel";
import { LearningLabUnifiedView } from "./LearningLabUnifiedView";
import { LearningEffectivenessStrip } from "./LearningEffectivenessStrip";
import { ChannelImpactPanels } from "./ChannelImpactPanels";
import { ValidationFeedbackSection } from "./ValidationFeedbackSection";
import { SignalCalibrationLearningSection } from "./SignalCalibrationLearningSection";
import { CurveImpactLearningSection } from "./CurveImpactLearningSection";
import { ExpectedMoveSection } from "./ExpectedMoveSection";
import { GlobalCalFactorReadOnly, LearningPipelinePanel } from "./LearningPipelinePanel";
import { LearningLabPortfolioTab } from "./LearningLabPortfolioTab";
import { seedCdPatternPolygonOverviewFromLab } from "../sheet/useCdPatternPolygonOverview";

const REFRESH_MS = 5 * 60_000;
const OVERVIEW_SESSION_KEY = "learningLab.overview.v1";

function readSessionOverview(): LearningLabOverview | null {
  try {
    const raw = sessionStorage.getItem(OVERVIEW_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LearningLabOverview;
  } catch {
    return null;
  }
}

function saveSessionOverview(doc: LearningLabOverview): void {
  try {
    sessionStorage.setItem(OVERVIEW_SESSION_KEY, JSON.stringify(doc));
  } catch {
    /* quota / private mode */
  }
}

function formatLearningLabLoadError(raw: string, it: boolean): string {
  if (/aborted|timeout/i.test(raw)) {
    return it
      ? "Timeout caricamento Learning Lab — l'API impiega troppo tempo o è bloccata da un refresh. Riavvia l'app o attendi la fine del refresh su :8765."
      : "Learning Lab load timed out — the API is too slow or blocked by a refresh. Restart the app or wait for refresh to finish on :8765.";
  }
  if (/failed to fetch|networkerror|load failed|connessione|connection refused|enotfound/i.test(raw)) {
    return it
      ? "API non raggiungibile su :8765 — avvia SuperNova desktop (Avvia_Biotech_Desktop.bat) e riprova."
      : "API not reachable on :8765 — start SuperNova desktop (Avvia_Biotech_Desktop.bat) and retry.";
  }
  return raw;
}

type LabTopTab = "model" | "signals" | "portfolio" | "monitor";
type WeekRow = Record<string, unknown>;

const MIN_LEARNING_WEEK_N = 15;

function reliableLearningWeeks(weeks: WeekRow[]): WeekRow[] {
  return weeks.filter((w) => Number(w.n_outcomes ?? 0) >= MIN_LEARNING_WEEK_N);
}

const CLUSTER_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16", "#64748b"];
const REGIME_COLORS = { RISK_ON: "#22c55e", NEUTRAL: "#6366f1", RISK_OFF: "#ef4444" } as const;

/** Allineato a prediction/cluster_cal_factor.py TICKER_CLUSTERS — non SDS A/B/C/D/E. */
const LEARNING_CLUSTERS: { id: string; it: string; en: string }[] = [
  { id: "phase2_oncology", it: "Fase 2 · oncologia", en: "Phase 2 · oncology" },
  { id: "phase3_oncology", it: "Fase 3 · oncologia", en: "Phase 3 · oncology" },
  { id: "phase2_rare", it: "Fase 2 · rare/orphan", en: "Phase 2 · rare/orphan" },
  { id: "phase3_rare", it: "Fase 3 · rare/orphan", en: "Phase 3 · rare/orphan" },
  { id: "phase3_metabolic", it: "Fase 3 · metabolico/NASH/diabete", en: "Phase 3 · metabolic/NASH/diabetes" },
  { id: "phase2_immuno", it: "Fase 2 · immunologia/autoimmune", en: "Phase 2 · immunology/autoimmune" },
  { id: "phase3_immuno", it: "Fase 3 · immunologia", en: "Phase 3 · immunology" },
  { id: "pdufa_regulatory", it: "PDUFA · NDA/BLA/regolatorio", en: "PDUFA · NDA/BLA/regulatory" },
  { id: "phase1_2_early", it: "Fase 1 / 1b / 1-2 early", en: "Phase 1 / 1b / early 1-2" },
  { id: "other", it: "Altro (non classificato)", en: "Other (unclassified)" },
];

function shortClusterName(name: string): string {
  return name
    .replace(/^phase(\d)/i, "Ph$1 ")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .slice(0, 16);
}

function parseWeeks(history: { weeks?: WeekRow[] } | undefined): WeekRow[] {
  return (history?.weeks ?? []) as WeekRow[];
}

function weekLabel(week: unknown): string {
  return String(week ?? "").slice(5);
}

/** Direction accuracy stored as 0–1 fraction; null when missing (never coerce to 0). */
function weekDirPct(week: WeekRow, key: string, fallbacks: string[] = []): number | null {
  for (const k of [key, ...fallbacks]) {
    const raw = week[k];
    if (raw == null || raw === "") continue;
    const n = Number(raw);
    if (Number.isFinite(n)) return n * 100;
  }
  return null;
}

function LowSampleWeeksBanner({ count, it }: { count: number; it: boolean }) {
  if (count <= 0) return null;
  return (
    <p className="text-[10px] text-[rgb(var(--warn))] bg-[rgb(var(--warn))]/10 border border-[rgb(var(--warn))]/25 rounded-md px-2.5 py-1.5">
      {it
        ? `${count} settimana/e esclusa/e dal grafico (campione troppo piccolo, n<${MIN_LEARNING_WEEK_N}).`
        : `${count} week(s) hidden from chart (sample too small, n<${MIN_LEARNING_WEEK_N}).`}
    </p>
  );
}

function LearningDataMissingBanner({
  data,
  it,
}: {
  data: LearningLabOverview;
  it: boolean;
}) {
  if (data.data_available !== false && !data.cluster_data_missing && !data.regime_data_missing) {
    return null;
  }
  return (
    <div className="rounded-lg border border-[rgb(var(--warn))]/35 bg-[rgb(var(--warn))]/8 px-3 py-2.5 space-y-1">
      <p className="text-[11px] font-semibold text-ink">
        {it ? "Dati calibrazione non disponibili" : "Calibration data unavailable"}
      </p>
      <p className="text-[11px] text-ink-muted leading-relaxed">
        {it
          ? "Cluster/regime JSON assenti o mock disabilitato. Esegui refresh orchestrator o primo ciclo learning per popolare i file."
          : "Cluster/regime JSON missing or mock disabled. Run orchestrator refresh or first learning cycle to populate files."}
      </p>
    </div>
  );
}

function LearningLivePoolBanner({
  data,
  it,
}: {
  data: LearningLabOverview;
  it: boolean;
}) {
  const live = data.live_pool;
  const n = live?.n_outcomes ?? data.total_outcomes ?? 0;
  const mae = live?.mae_with_all;
  const dir = live?.dir_with_all;
  if (n < MIN_LEARNING_WEEK_N || mae == null) return null;

  return (
    <div className="rounded-lg border border-[rgb(var(--accent))]/35 bg-[rgb(var(--accent))]/8 px-3 py-2.5 space-y-1">
      <p className="text-[11px] font-semibold text-ink">
        {it ? "Pool live PastCatalyst (oggi)" : "Live PastCatalyst pool (today)"}
      </p>
      <p className="text-[11px] text-ink-muted leading-relaxed">
        {it
          ? `MAE ${mae.toFixed(2)}% · dir ${dir != null ? `${(dir * 100).toFixed(1)}%` : "—"} · n=${n.toLocaleString()} coppie pred/actual.`
          : `MAE ${mae.toFixed(2)}% · dir ${dir != null ? `${(dir * 100).toFixed(1)}%` : "—"} · n=${n.toLocaleString()} pred/actual pairs.`}
        {data.demo_history
          ? it
            ? " Il trend settimanale fino a maggio è storico demo (~2.6% MAE); l'ultimo punto live è la misura reale."
            : " Weekly trend through May is demo seed history (~2.6% MAE); the latest live point is the real measurement."
          : null}
      </p>
    </div>
  );
}

function SectionNote({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/60 bg-surface/40 px-3 py-2.5 space-y-1">
      <p className="text-[11px] font-medium text-ink">{title}</p>
      <p className="text-[11px] leading-relaxed text-ink-muted">{children}</p>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  hint,
  height = 220,
  note,
  children,
}: {
  title: string;
  subtitle?: string;
  hint?: React.ReactNode;
  height?: number;
  note?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-surface/20 p-3 space-y-2">
      <div>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {subtitle ? <p className="text-[10px] text-ink-muted">{subtitle}</p> : null}
        {hint}
      </div>
      {note}
      <div style={{ height }} className="w-full min-h-0">
        {children}
      </div>
    </div>
  );
}

function MaeTrendHint() {
  const t = useT();
  return (
    <div className="mt-1 space-y-0.5">
      <p className="text-[10px] text-ink-muted leading-snug">{t("learningLab.caption.mae.intro")}</p>
      <p className="text-[10px] font-medium text-positive flex items-center gap-1">
        <span aria-hidden className="text-xs leading-none">
          ↓
        </span>
        {t("learningLab.caption.mae.trend")}
      </p>
    </div>
  );
}

function DirTrendHint() {
  const t = useT();
  return (
    <div className="mt-1 space-y-0.5">
      <p className="text-[10px] text-ink-muted leading-snug">{t("learningLab.caption.dir.intro")}</p>
      <p className="text-[10px] font-medium text-positive flex items-center gap-1">
        <span aria-hidden className="text-xs leading-none">
          ↑
        </span>
        {t("learningLab.caption.dir.trend")}
      </p>
      <p className="text-[10px] text-ink-muted/90 leading-snug">{t("learningLab.caption.dir.axis")}</p>
    </div>
  );
}

function DidascaliaBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/60 bg-surface/40 px-3 py-2.5 space-y-2">
      <p className="text-[11px] font-medium text-ink">{title}</p>
      {children}
    </div>
  );
}

function ClusterTaxonomyCaption({ activeIds }: { activeIds?: string[] }) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";
  const activeSet = activeIds ? new Set(activeIds) : null;
  return (
    <DidascaliaBox title={t("learningLab.caption.cluster.title")}>
      <p className="text-[11px] leading-relaxed text-ink-muted">{t("learningLab.caption.cluster.intro")}</p>
      <div>
        <p className="text-[10px] font-medium text-ink mb-1">{t("learningLab.caption.cluster.listTitle")}</p>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-ink-muted">
          {LEARNING_CLUSTERS.map((c) => {
            const isActive = activeSet ? activeSet.has(c.id) : true;
            return (
              <li key={c.id} className={isActive ? "" : "opacity-50"}>
                <span className="font-mono text-[9px] text-ink/70">{c.id}</span>
                {" · "}
                {it ? c.it : c.en}
                {activeSet && !isActive ? t("learningLab.caption.cluster.collecting") : ""}
              </li>
            );
          })}
        </ul>
      </div>
    </DidascaliaBox>
  );
}

function RegimeTaxonomyCaption({ currentRegime }: { currentRegime: string }) {
  const t = useT();
  return (
    <DidascaliaBox title={t("learningLab.caption.regime.title")}>
      <p className="text-[11px] leading-relaxed text-ink-muted">
        {t("learningLab.caption.regime.intro", { regime: currentRegime })}
      </p>
      <ul className="text-[10px] text-ink-muted list-disc pl-4 space-y-0.5">
        <li>
          <strong className="text-ink">RISK_ON</strong>
          {t("learningLab.caption.regime.riskOn")}
        </li>
        <li>
          <strong className="text-ink">NEUTRAL</strong>
          {t("learningLab.caption.regime.neutral")}
        </li>
        <li>
          <strong className="text-ink">RISK_OFF</strong>
          {t("learningLab.caption.regime.riskOff")}
        </li>
      </ul>
      <p className="text-[10px] text-ink-muted leading-snug">{t("learningLab.caption.regime.charts")}</p>
    </DidascaliaBox>
  );
}

function ClusterCfHint() {
  const t = useT();
  return (
    <div className="mt-1 space-y-0.5">
      <p className="text-[10px] text-ink-muted leading-snug">{t("learningLab.caption.clusterCf.intro")}</p>
      <p className="text-[10px] font-medium text-positive flex items-center gap-1">
        <span aria-hidden className="text-xs leading-none">
          →
        </span>
        {t("learningLab.caption.clusterCf.trend")}
      </p>
    </div>
  );
}

function ClusterMaeHint() {
  const t = useT();
  return (
    <div className="mt-1 space-y-0.5">
      <p className="text-[10px] text-ink-muted leading-snug">{t("learningLab.caption.clusterMae.intro")}</p>
      <MaeTrendHint />
    </div>
  );
}

function trendChartWeeks(weeks: WeekRow[], demoHistory?: boolean): WeekRow[] {
  const reliable = reliableLearningWeeks(weeks);
  if (!demoHistory) return reliable;
  const liveOnly = reliable.filter((w) => Boolean(w.live_snapshot));
  return liveOnly.length > 0 ? liveOnly : reliable;
}

function DemoHistoryBanner({ it }: { it: boolean }) {
  return (
    <p className="text-[10px] text-[rgb(var(--accent))] bg-[rgb(var(--accent))]/10 border border-[rgb(var(--accent))]/25 rounded-md px-2.5 py-1.5">
      {it
        ? "Storico demo (mar–mag) nascosto: mostriamo solo snapshot live PastCatalyst. Il trend settimanale si popolerà dopo i cicli domenicali."
        : "Demo seed history (Mar–May) hidden: showing live PastCatalyst snapshots only. Weekly trend fills in after Sunday learning cycles."}
    </p>
  );
}

function EmptyTimeline({ it, demoHistory }: { it: boolean; demoHistory?: boolean }) {
  return (
    <p className="text-sm text-ink-muted text-center py-10">
      {demoHistory
        ? it
          ? "Un solo punto live disponibile — il trend comparirà dal prossimo ciclo settimanale."
          : "Only one live data point so far — trend chart appears after the next weekly cycle."
        : it
          ? "Servono almeno 2 settimane di storico per il trend."
          : "Need at least 2 weeks of history for trends."}
    </p>
  );
}

function TrendLineChart({
  data,
  lines,
  yUnit = "%",
  yDomain,
  yAxisName,
  rightYDomain,
  rightYAxisName,
  refLineY,
  refLineLabel,
  height = 220,
}: {
  data: Record<string, unknown>[];
  lines: { key: string; name: string; color: string; dashed?: boolean; yAxisId?: string }[];
  yUnit?: string;
  yDomain?: [number | string, number | string];
  yAxisName?: string;
  rightYDomain?: [number | string, number | string];
  rightYAxisName?: string;
  refLineY?: number;
  refLineLabel?: string;
  height?: number;
}) {
  const hasDual = lines.some((l) => l.yAxisId === "right");
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: hasDual ? 8 : 8, left: yAxisName ? 4 : 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
        <XAxis dataKey="week" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
        <YAxis
          yAxisId="left"
          tick={{ fontSize: 10 }}
          unit={yUnit}
          domain={yDomain ?? ["auto", "auto"]}
          width={yAxisName ? 44 : undefined}
          label={
            yAxisName
              ? { value: yAxisName, angle: -90, position: "insideLeft", style: { fontSize: 9, fill: "#64748b" } }
              : undefined
          }
        />
        {hasDual ? (
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 10 }}
            domain={rightYDomain ?? ["auto", "auto"]}
            width={rightYAxisName ? 36 : undefined}
            label={
              rightYAxisName
                ? { value: rightYAxisName, angle: 90, position: "insideRight", style: { fontSize: 9, fill: "#64748b" } }
                : undefined
            }
          />
        ) : null}
        {refLineY != null ? (
          <ReferenceLine
            yAxisId="left"
            y={refLineY}
            stroke="#94a3b8"
            strokeDasharray="4 4"
            label={
              refLineLabel
                ? { value: refLineLabel, fontSize: 9, fill: "#64748b", position: "insideTopRight" }
                : undefined
            }
          />
        ) : null}
        <Tooltip formatter={(v: number) => (Number.isFinite(v) ? [typeof v === "number" && v < 2 && v > 0.5 ? v.toFixed(3) : `${v.toFixed(2)}${yUnit === "%" ? "%" : ""}`, ""] : ["—", ""])} />
        <Legend wrapperStyle={{ fontSize: 10 }} />
        {lines.map((l) => (
          <Line
            key={l.key}
            yAxisId={l.yAxisId ?? "left"}
            type="monotone"
            dataKey={l.key}
            name={l.name}
            stroke={l.color}
            strokeWidth={l.dashed ? 1.5 : 2}
            strokeDasharray={l.dashed ? "4 4" : undefined}
            dot={{ r: 2 }}
            connectNulls
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function EffectivenessCharts({
  weeks,
  it,
  demoHistory,
}: {
  weeks: WeekRow[];
  it: boolean;
  demoHistory?: boolean;
}) {
  const chartWeeks = trendChartWeeks(weeks, demoHistory);
  const lowSampleCount = weeks.length - reliableLearningWeeks(weeks).length;

  const maeTrend = chartWeeks.map((w) => ({
    week: weekLabel(w.week),
    baseline: Number(w.mae_baseline ?? 0),
    withAll: Number(w.mae_with_all ?? 0),
    afterCluster: Number(w.mae_after_cluster ?? 0),
    afterRegime: w.mae_after_regime != null ? Number(w.mae_after_regime) : null,
  }));

  const dirTrend = chartWeeks.map((w) => ({
    week: weekLabel(w.week),
    withAll: weekDirPct(w, "dir_with_all", ["dir_global_before"]),
    afterCluster: weekDirPct(w, "dir_after_cluster", ["dir_before_regime"]),
    afterRegime: weekDirPct(w, "dir_after_regime"),
  }));

  const hasTrend = maeTrend.length >= 2;

  return (
    <div className="space-y-2.5 min-h-0">
      {demoHistory ? <DemoHistoryBanner it={it} /> : null}
      <LowSampleWeeksBanner count={lowSampleCount} it={it} />
      {hasTrend ? (
        <>
          <ChartCard
            title={it ? "Learning effectiveness — MAE" : "Learning effectiveness — MAE"}
            subtitle={it ? "Baseline vs learning attivo" : "Baseline vs active learning"}
            hint={<MaeTrendHint />}
            height={220}
          >
            <TrendLineChart
              data={maeTrend}
              yUnit="%"
              yAxisName={it ? "MAE %" : "MAE %"}
              lines={[
                { key: "baseline", name: "Baseline", color: "#94a3b8", dashed: true },
                { key: "withAll", name: it ? "Con tutti i meccanismi" : "All mechanisms", color: "#6366f1" },
                { key: "afterCluster", name: it ? "Dopo cluster CF" : "After cluster CF", color: "#22c55e" },
                { key: "afterRegime", name: it ? "Dopo regime ×" : "After regime ×", color: "#f59e0b" },
              ]}
            />
          </ChartCard>

          <ChartCard
            title={it ? "Direction accuracy" : "Direction accuracy"}
            subtitle={it ? "Segno su/giù · soglia 50% = caso" : "Up/down sign · 50% = random"}
            hint={<DirTrendHint />}
            height={220}
          >
            <TrendLineChart
              data={dirTrend}
              yUnit="%"
              yAxisName={it ? "Acc. dir." : "Dir acc."}
              yDomain={[40, 75]}
              refLineY={50}
              refLineLabel={it ? "50% = caso" : "50% = random"}
              lines={[
                { key: "withAll", name: it ? "Con tutti i meccanismi" : "All mechanisms", color: "#6366f1" },
                { key: "afterCluster", name: it ? "Dopo cluster CF" : "After cluster CF", color: "#22c55e", dashed: true },
                { key: "afterRegime", name: it ? "Dopo regime ×" : "After regime ×", color: "#f59e0b" },
              ]}
            />
          </ChartCard>
        </>
      ) : (
        <EmptyTimeline it={it} demoHistory={demoHistory} />
      )}
    </div>
  );
}

function ClusterSection({ data, weeks, it }: { data: LearningLabOverview; weeks: WeekRow[]; it: boolean }) {
  const cfSynthetic = Boolean(data.history?.cluster_cf_history_synthetic);
  const demoHistory = Boolean(data.demo_history);
  const chartWeeks = trendChartWeeks(weeks, demoHistory);
  const clusterDoc = (data.cluster_doc?.clusters ?? {}) as Record<string, Record<string, unknown>>;
  const activeClusterIds = Object.entries(clusterDoc)
    .filter(([, c]) => c.status === "active")
    .map(([id]) => id);

  const lowSampleCount = weeks.length - reliableLearningWeeks(weeks).length;

  const cfTrend = chartWeeks.map((w) => {
    const cfs = (w.cluster_cal_factors ?? {}) as Record<string, number>;
    const row: Record<string, string | number | null> = { week: weekLabel(w.week) };
    for (const [name, val] of Object.entries(cfs)) {
      if (val != null && Number.isFinite(Number(val))) row[name] = Number(val);
    }
    return row;
  });

  const clusterNames = useMemo(() => {
    const names = new Set<string>();
    for (const row of cfTrend) {
      for (const key of Object.keys(row)) {
        if (key !== "week" && row[key] != null) names.add(key);
      }
    }
    return [...names].sort();
  }, [cfTrend]);

  const cfTrendFiltered = cfTrend.map((row) => {
    const out: Record<string, string | number | null> = { week: row.week };
    for (const name of clusterNames) {
      out[name] = row[name] ?? null;
    }
    return out;
  });

  const maeTrend = chartWeeks.map((w) => ({
    week: weekLabel(w.week),
    before: Number(w.mae_before_cluster ?? 0),
    after: Number(w.mae_after_cluster ?? 0),
  }));

  const noteText = it ? (
    <>
      I grafici sotto mostrano l&apos;effetto della correzione <strong>per cluster di learning</strong>: MAE
      aggregato prima/dopo cluster CF, e l&apos;evoluzione del moltiplicatore nel tempo. Una curva che converge
      verso <strong>1.0</strong> indica calibrazione stabilizzata per quella cohort.
    </>
  ) : (
    <>
      Charts below show <strong>learning cluster</strong> correction impact: aggregate MAE before/after cluster CF,
      and multiplier evolution over time. A curve converging toward <strong>1.0</strong> means stabilized
      calibration for that cohort.
    </>
  );

  return (
    <div className="space-y-3">
      <ClusterTaxonomyCaption activeIds={activeClusterIds.length ? activeClusterIds : clusterNames} />
      <LowSampleWeeksBanner count={lowSampleCount} it={it} />
      <SectionNote title={it ? "Come leggerlo" : "How to read"}>{noteText}</SectionNote>

      {reliableLearningWeeks(chartWeeks).length >= 2 ? (
        <>
          <ChartCard
            title={it ? "MAE cluster — prima vs dopo correzione" : "Cluster MAE — before vs after correction"}
            hint={<ClusterMaeHint />}
            height={200}
          >
            <TrendLineChart
              data={maeTrend}
              lines={[
                { key: "before", name: it ? "Prima cluster CF" : "Before cluster CF", color: "#94a3b8", dashed: true },
                { key: "after", name: it ? "Dopo cluster CF" : "After cluster CF", color: "#6366f1" },
              ]}
            />
          </ChartCard>

          {clusterNames.length > 0 ? (
            <ChartCard
              title={it ? "cal_factor per cluster nel tempo" : "cal_factor per cluster over time"}
              hint={<ClusterCfHint />}
              height={240}
            >
              {cfSynthetic ? (
                <p className="text-[10px] text-warn mb-1">
                  {it
                    ? "Storico CF sintetico (1.0 → valore attuale) — si popolerà con snapshot reali ogni ciclo domenicale."
                    : "Synthetic CF history (1.0 → current value) — real weekly snapshots will fill in after Sunday cycles."}
                </p>
              ) : null}
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={cfTrendFiltered} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                  <XAxis dataKey="week" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} domain={[0.85, 1.15]} />
                  <ReferenceLine y={1} stroke="#64748b" strokeDasharray="4 4" />
                  <Tooltip formatter={(v: number) => [Number.isFinite(v) ? v.toFixed(3) : "—", ""]} />
                  <Legend wrapperStyle={{ fontSize: 9 }} />
                  {clusterNames.map((name, i) => (
                    <Line
                      key={name}
                      type="monotone"
                      dataKey={name}
                      name={shortClusterName(name)}
                      stroke={CLUSTER_COLORS[i % CLUSTER_COLORS.length]}
                      strokeWidth={1.5}
                      dot={false}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          ) : (
            <p className="text-[11px] text-ink-muted text-center py-4">
              {it
                ? "Nessun cal_factor cluster nello storico — attivo solo dopo il primo ciclo learning con cluster calibrati."
                : "No cluster cal_factor in history — appears after the first learning cycle with calibrated clusters."}
            </p>
          )}
        </>
      ) : (
        <EmptyTimeline it={it} demoHistory={demoHistory} />
      )}
    </div>
  );
}

function RegimeSection({ data, weeks, it }: { data: LearningLabOverview; weeks: WeekRow[]; it: boolean }) {
  const regimeSynthetic = Boolean(data.history?.regime_history_synthetic);
  const demoHistory = Boolean(data.demo_history);
  const chartWeeks = trendChartWeeks(weeks, demoHistory);
  const lowSampleCount = weeks.length - reliableLearningWeeks(weeks).length;

  const multTrend = chartWeeks.map((w) => {
    const mults = (w.regime_multipliers ?? {}) as Record<string, number>;
    return {
      week: weekLabel(w.week),
      RISK_ON: mults.RISK_ON ?? null,
      NEUTRAL: mults.NEUTRAL ?? null,
      RISK_OFF: mults.RISK_OFF ?? null,
    };
  });

  const maeTrend = chartWeeks.map((w) => ({
    week: weekLabel(w.week),
    withLearning: Number(w.mae_with_all ?? 0),
    baseline: Number(w.mae_baseline ?? 0),
    afterRegime: w.mae_after_regime != null ? Number(w.mae_after_regime) : null,
    beforeRegime: w.mae_before_regime != null ? Number(w.mae_before_regime) : null,
  }));

  const noteText = it ? (
    <>
      Il <strong>regime di mercato</strong> modula le previsioni con moltiplicatori calibrati su outcome
      storici. Le curve dei moltiplicatori mostrano come RISK_ON / NEUTRAL / RISK_OFF evolvono; il grafico MAE
      verifica se la correzione regime riduce l&apos;errore nel tempo rispetto alla baseline.
    </>
  ) : (
    <>
      <strong>Market regime</strong> scales predictions via multipliers calibrated on historical outcomes.
      Multiplier curves show how RISK_ON / NEUTRAL / RISK_OFF evolve; the MAE chart verifies whether regime
      correction reduces error over time vs baseline.
    </>
  );

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-warn/30 bg-warn/8 px-3 py-2 text-xs">
        <span className="font-semibold">{data.current_regime}</span>
        {" · "}
        {it ? "Moltiplicatore attuale" : "Current multiplier"}: {Number(data.current_regime_multiplier).toFixed(2)}
      </div>

      <RegimeTaxonomyCaption currentRegime={data.current_regime} />
      <LowSampleWeeksBanner count={lowSampleCount} it={it} />
      <SectionNote title={it ? "Come leggerlo" : "How to read"}>{noteText}</SectionNote>

      {reliableLearningWeeks(chartWeeks).length >= 2 ? (
        <>
          <ChartCard title={it ? "Moltiplicatori regime nel tempo" : "Regime multipliers over time"} height={200}>
            {regimeSynthetic ? (
              <p className="text-[10px] text-warn mb-1">
                {it
                  ? "Storico regime sintetico (1.0 → valore attuale) — si popolerà con snapshot reali ogni ciclo domenicale."
                  : "Synthetic regime history (1.0 → current value) — real weekly snapshots will fill in after Sunday cycles."}
              </p>
            ) : null}
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={multTrend} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                <XAxis dataKey="week" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} domain={[0.85, 1.15]} />
                <ReferenceLine y={1} stroke="#64748b" strokeDasharray="4 4" />
                <Tooltip formatter={(v: number) => [Number.isFinite(v) ? `×${v.toFixed(3)}` : "—", ""]} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                {(["RISK_ON", "NEUTRAL", "RISK_OFF"] as const).map((rk) => (
                  <Line
                    key={rk}
                    type="monotone"
                    dataKey={rk}
                    name={rk}
                    stroke={REGIME_COLORS[rk]}
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title={it ? "MAE — impatto regime nel tempo" : "MAE — regime impact over time"}
            hint={<MaeTrendHint />}
            height={220}
          >
            <TrendLineChart
              data={maeTrend}
              lines={[
                { key: "baseline", name: "Baseline", color: "#94a3b8", dashed: true },
                { key: "beforeRegime", name: it ? "Prima regime ×" : "Before regime ×", color: "#cbd5e1", dashed: true },
                { key: "afterRegime", name: it ? "Dopo regime ×" : "After regime ×", color: "#f59e0b" },
                { key: "withLearning", name: it ? "Con tutti i meccanismi" : "All mechanisms", color: "#6366f1" },
              ]}
            />
          </ChartCard>
        </>
      ) : (
        <EmptyTimeline it={it} demoHistory={demoHistory} />
      )}
    </div>
  );
}

export function LearningLabView({
  reloadToken = 0,
  simTable,
  sdsRows,
}: {
  reloadToken?: number;
  simTable?: SheetTable | null;
  sdsRows?: SdsRow[] | null;
}) {
  const { lang } = useLang();
  const it = lang === "it";
  const [data, setData] = useState<LearningLabOverview | null>(null);
  const [pipeline, setPipeline] = useState<LearningPipelineOverview | null>(null);
  const [auditLog, setAuditLog] = useState<LearningAuditLog | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [topTab, setTopTab] = useState<LabTopTab>("model");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewLearningCycle>> | null>(null);
  const [busy, setBusy] = useState(false);
  const hasDataRef = useRef(false);
  hasDataRef.current = data != null;

  const weeks = useMemo(() => parseWeeks(data?.history), [data?.history]);

  const globalCfFromPipeline = useMemo(() => {
    const step = pipeline?.steps?.find((s) => s.id === "global_cal_factor");
    const v = step?.summary?.value;
    return typeof v === "number" ? v : data?.global_cal_factor ?? null;
  }, [pipeline, data?.global_cal_factor]);

  const globalCfUpdatedAt = useMemo(() => {
    const step = pipeline?.steps?.find((s) => s.id === "global_cal_factor");
    const u = step?.summary?.updated_at;
    return typeof u === "string" ? u : null;
  }, [pipeline]);

  const load = useCallback(async () => {
    if (!hasDataRef.current) setLoading(true);
    setError(null);
    try {
      const [doc, pipe] = await Promise.all([
        fetchLearningLabOverview(),
        fetchLearningPipelineOverview().catch(() => null),
      ]);
      setData(doc);
      setPipeline(pipe);
      saveSessionOverview(doc);
      seedCdPatternPolygonOverviewFromLab(doc);
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const stale = readSessionOverview();
      if (stale) {
        setData(stale);
        seedCdPatternPolygonOverviewFromLab(stale);
        setError(
          it
            ? `Mostro ultimo snapshot locale — aggiornamento fallito: ${formatLearningLabLoadError(raw, it)}`
            : `Showing last local snapshot — refresh failed: ${formatLearningLabLoadError(raw, it)}`,
        );
      } else {
        setError(formatLearningLabLoadError(raw, it));
      }
    } finally {
      setLoading(false);
    }
  }, [it]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  useEffect(() => {
    const id = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const loadAudit = useCallback(async () => {
    setAuditLoading(true);
    setAuditError(null);
    try {
      const doc = await fetchLearningAuditLog(200);
      setAuditLog(doc);
    } catch (e) {
      setAuditError(e instanceof Error ? e.message : String(e));
    } finally {
      setAuditLoading(false);
    }
  }, []);

  useEffect(() => {
    if (topTab !== "monitor") return;
    void loadAudit();
  }, [topTab, loadAudit, reloadToken]);

  const lastRun = useMemo(() => {
    if (!data?.generated_at) return "—";
    return new Date(data.generated_at).toLocaleString();
  }, [data?.generated_at]);

  const runPreview = async () => {
    setBusy(true);
    try {
      const p = await previewLearningCycle();
      setPreview(p);
      setPreviewOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmApply = async () => {
    setBusy(true);
    setError(null);
    try {
      await applyLearningCycle();
      setPreviewOpen(false);
      await fetchLearningLabOverview({ force: true }).then(async (doc) => {
        setData(doc);
        saveSessionOverview(doc);
        seedCdPatternPolygonOverviewFromLab(doc);
        const pipe = await fetchLearningPipelineOverview().catch(() => null);
        setPipeline(pipe);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async () => {
    setBusy(true);
    try {
      const report = await exportLearningLabReport();
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `learning_lab_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    const msg = it
      ? "Reset completo learning (cluster, regime, EIS, feedback)? Doppia conferma."
      : "Full learning reset (cluster, regime, EIS, feedback)? Double confirm.";
    if (!window.confirm(msg)) return;
    if (!window.confirm(it ? "Confermi definitivamente?" : "Confirm permanently?")) return;
    setBusy(true);
    setError(null);
    try {
      await resetLearningLab(true);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const topTabBtn = (id: LabTopTab, label: string) => (
    <button
      type="button"
      className={`rounded-md px-2.5 py-1 text-[11px] ${topTab === id ? "bg-accent text-white" : "text-ink-muted hover:text-ink"}`}
      onClick={() => setTopTab(id)}
    >
      {label}
    </button>
  );

  if (loading && !data) {
    return <p className="text-sm text-ink-muted py-8 text-center">{it ? "Caricamento Learning Lab…" : "Loading Learning Lab…"}</p>;
  }

  return (
    <ViewErrorBoundary label="Learning Lab">
      <div className="flex flex-col flex-1 gap-3 pr-1">
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold">Learning Lab</h3>
            <p className="text-[10px] text-ink-muted">
              {it ? "Ultimo aggiornamento" : "Last run"}: {lastRun}
            </p>
          </div>
          <button type="button" className="btn-ghost text-xs" disabled={busy} onClick={() => void runPreview()}>
            {it ? "Esegui ciclo" : "Run cycle"}
          </button>
          <button type="button" className="btn-ghost text-xs" disabled={busy} onClick={() => void handleExport()}>
            Export
          </button>
          <button type="button" className="btn-ghost text-xs text-negative" disabled={busy} onClick={() => void handleReset()}>
            Reset
          </button>
        </div>

        {error ? <p className="text-xs text-negative">{error}</p> : null}

        <div className="flex gap-1 flex-wrap shrink-0">
          {topTabBtn("model", it ? "Calibrazione modello" : "Model calibration")}
          {topTabBtn("signals", it ? "Segnali e pattern" : "Signals & patterns")}
          {topTabBtn("portfolio", it ? "Portfolio e advice" : "Portfolio & advice")}
          {topTabBtn("monitor", it ? "Monitor loop" : "Loop monitor")}
        </div>

        {data && topTab === "model" ? (
          <div className="space-y-4">
            <LearningDataMissingBanner data={data} it={it} />
            <LearningLivePoolBanner data={data} it={it} />
            <ChannelImpactPanels data={data.channel_impact} it={it} />
            <ExpectedMoveSection data={data.expected_move} it={it} />
            <details className="rounded-xl border border-[rgb(var(--border))]/40 bg-surface/10">
              <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-medium text-ink-muted hover:text-ink">
                {it
                  ? "Loop di magnitudo (guardrail · impatto ≈0) — dettaglio cluster/regime"
                  : "Magnitude loops (guardrail · ≈0 impact) — cluster/regime detail"}
              </summary>
              <div className="space-y-4 p-3 pt-1">
                <LearningEffectivenessStrip rows={data.effectiveness ?? []} />
                <EffectivenessCharts weeks={weeks} it={it} demoHistory={data.demo_history} />
                <ClusterSection data={data} weeks={weeks} it={it} />
                <RegimeSection data={data} weeks={weeks} it={it} />
              </div>
            </details>
            <LearningPipelinePanel pipeline={pipeline} it={it} />
            <GlobalCalFactorReadOnly value={globalCfFromPipeline} updatedAt={globalCfUpdatedAt} it={it} />
          </div>
        ) : null}

        {data && topTab === "signals" ? (
          <div className="space-y-4">
            <ValidationFeedbackSection
              data={data.validation_feedback}
              active={topTab === "signals"}
              onReload={load}
            />
            <SignalCalibrationLearningSection
              data={data.signal_calibration}
              active={topTab === "signals"}
              onReload={load}
            />
            <CurveImpactLearningSection data={data.curve_impact} />
          </div>
        ) : null}

        {topTab === "portfolio" ? (
          <LearningLabPortfolioTab simTable={simTable} sdsRows={sdsRows} reloadToken={reloadToken} />
        ) : null}

        {topTab === "monitor" ? (
          <div className="space-y-4">
            <LearningLabUnifiedView reloadToken={reloadToken} weeklyMetrics={auditLog?.weekly_metrics ?? []} />
            <LearningLabAuditLogPanel data={auditLog} loading={auditLoading} error={auditError} />
          </div>
        ) : null}

        {previewOpen && preview ? (
          <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 p-4">
            <div className="bg-surface rounded-xl border border-[rgb(var(--border))] shadow-xl max-w-lg w-full p-4 space-y-3">
              <h4 className="text-sm font-semibold">{it ? "Anteprima ciclo learning" : "Learning cycle preview"}</h4>
              <p className="text-[10px] text-ink-muted">
                {it
                  ? "Conferma per scrivere su disco. Il global cal_factor (v4) non viene modificato da questo ciclo."
                  : "Confirm to write to disk. Global cal_factor (v4) is NOT changed by this cycle."}
              </p>
              <ul className="text-[11px] space-y-1 max-h-48 overflow-y-auto font-mono">
                {preview.diff.cluster_changes.map((c) => (
                  <li key={String(c.cluster)}>
                    {String(c.cluster)}: {String(c.from)} → {String(c.to)}
                  </li>
                ))}
                {preview.diff.regime_changes.map((c) => (
                  <li key={String(c.regime)}>
                    {String(c.regime)}: {String(c.from)} → {String(c.to)}
                  </li>
                ))}
                {!preview.diff.cluster_changes.length && !preview.diff.regime_changes.length ? (
                  <li>{it ? "Nessuna modifica proposta." : "No proposed changes."}</li>
                ) : null}
              </ul>
              <div className="flex gap-2 justify-end">
                <button type="button" className="btn-ghost text-xs" onClick={() => setPreviewOpen(false)}>
                  {it ? "Annulla" : "Cancel"}
                </button>
                <button type="button" className="btn-primary text-xs" disabled={busy} onClick={() => void confirmApply()}>
                  {it ? "Applica" : "Apply"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </ViewErrorBoundary>
  );
}
