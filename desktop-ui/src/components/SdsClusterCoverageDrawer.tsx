import { useEffect, useMemo, useState } from "react";
import {
  buildSdsClusterCoverageView,
  type SdsClusterLetter,
  type SdsClusterPopulationSummary,
  type SdsClusterCoverageView,
} from "../sheet/sdsClusterCoverage";
import type { SdsSnapshotDoc } from "../sheet/sdsRoiForecast";
import type { SimulationSheetSnapshotDoc } from "../sheet/sdsRoiSimConvergence";
import { useT } from "../shared/i18n";

function fillTone(pct: number): "green" | "amber" | "red" {
  if (pct >= 80) return "green";
  if (pct >= 50) return "amber";
  return "red";
}

function clusterChipClass(tone: "green" | "amber" | "red", active: boolean): string {
  const border =
    tone === "green"
      ? "border-emerald-300/70"
      : tone === "amber"
        ? "border-amber-300/70"
        : "border-rose-300/70";
  const bg = active
    ? tone === "green"
      ? "bg-emerald-50"
      : tone === "amber"
        ? "bg-amber-50"
        : "bg-rose-50"
    : "bg-white/90";
  return `${border} ${bg}`;
}

function worstClusterLetter(clusters: SdsClusterPopulationSummary[]): SdsClusterLetter {
  if (!clusters.length) return "A";
  return clusters.reduce((worst, c) =>
    c.minComponentFillPct < worst.minComponentFillPct ? c : worst,
  ).letter;
}

function ClusterCoveragePanel({
  cluster,
  it,
  t,
}: {
  cluster: SdsClusterPopulationSummary;
  it: boolean;
  t: ReturnType<typeof useT>;
}) {
  return (
    <div className="rounded-lg border border-slate-200/70 invest-trend-chart-panel p-3 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold text-ink">
          {t(cluster.titleKey)}
          <span className="ml-1.5 text-[10px] font-normal text-ink-muted">
            · {cluster.nWithClusterScore}/{cluster.nCohort}{" "}
            {it ? "con score cluster" : "with cluster score"}
          </span>
        </p>
        <p className="text-[10px] text-ink-muted tabular-nums">
          {t("modelLab.qc.sdsRoi.clusterCoverage.fillPct", { pct: String(cluster.avgComponentFillPct) })}
        </p>
      </div>
      <div className="space-y-2">
        {cluster.components.map((comp) => {
          const tone = fillTone(comp.pctPresent);
          const barColor =
            tone === "green" ? "bg-emerald-500/75" : tone === "amber" ? "bg-amber-500/75" : "bg-rose-500/75";
          return (
            <div key={comp.key}>
              <div className="flex justify-between gap-2 text-[10px] mb-0.5">
                <span className="text-ink-muted truncate">
                  {t(comp.labelKey)}
                  {comp.weakest && cluster.nCohort > 0 ? (
                    <span className="ml-1 text-amber-700" title={it ? "Indice più debole nel cluster" : "Weakest index in cluster"}>
                      ↓
                    </span>
                  ) : null}
                </span>
                <span className="tabular-nums shrink-0 text-ink">
                  {t("modelLab.qc.sdsRoi.clusterCoverage.componentRow", {
                    present: String(comp.nPresent),
                    total: String(cluster.nCohort),
                  })}
                  <span className="text-ink-muted ml-1">({comp.pctPresent}%)</span>
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div className={`h-full rounded-full ${barColor}`} style={{ width: `${comp.pctPresent}%` }} />
              </div>
              {(comp.nMissing > 0 || comp.nInsufficient > 0 || comp.nNa > 0) && (
                <p className="text-[9px] text-ink-muted mt-0.5">
                  {comp.nMissing > 0 ? `${comp.nMissing} ${t("modelLab.qc.sdsRoi.clusterCoverage.status.missing")}` : null}
                  {comp.nMissing > 0 && (comp.nInsufficient > 0 || comp.nNa > 0) ? " · " : null}
                  {comp.nInsufficient > 0
                    ? `${comp.nInsufficient} ${t("modelLab.qc.sdsRoi.clusterCoverage.status.insufficient")}`
                    : null}
                  {comp.nInsufficient > 0 && comp.nNa > 0 ? " · " : null}
                  {comp.nNa > 0 ? `${comp.nNa} ${t("modelLab.qc.sdsRoi.clusterCoverage.status.na")}` : null}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ClusterCoverageBody({
  coverage,
  it,
}: {
  coverage: SdsClusterCoverageView;
  it: boolean;
}) {
  const t = useT();
  const [selected, setSelected] = useState<SdsClusterLetter>(() => worstClusterLetter(coverage.clusters));

  const selectedCluster = coverage.clusters.find((c) => c.letter === selected) ?? coverage.clusters[0];

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[10px] text-ink-muted leading-snug">{t("modelLab.qc.sdsRoi.clusterCoverage.lead")}</p>
        {coverage.nSimCohort > 0 ? (
          <p className="text-[10px] text-ink mt-1 tabular-nums">
            {t("modelLab.qc.sdsRoi.clusterCoverage.cohortGap", {
              inSnap: String(coverage.nInSdsSnapshot),
              sim: String(coverage.nSimCohort),
              missing: String(coverage.nMissingFromSnapshot),
            })}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {coverage.clusters.map((cluster) => {
          const tone = fillTone(cluster.minComponentFillPct);
          const active = selectedCluster?.letter === cluster.letter;
          return (
            <button
              key={cluster.letter}
              type="button"
              onClick={() => setSelected(cluster.letter)}
              className={`rounded-lg border px-2.5 py-1.5 text-left transition-colors ${clusterChipClass(tone, active)} ${active ? "ring-1 ring-slate-300/60" : "hover:bg-white"}`}
            >
              <span className="text-xs font-bold text-ink">{cluster.letter}</span>
              <span className="block text-[9px] text-ink-muted truncate max-w-[120px]">{t(cluster.titleKey)}</span>
              <span className="block text-[10px] tabular-nums font-medium mt-0.5">{cluster.minComponentFillPct}% min</span>
            </button>
          );
        })}
      </div>

      {selectedCluster ? <ClusterCoveragePanel cluster={selectedCluster} it={it} t={t} /> : null}

      {coverage.missingTickers.length > 0 ? (
        <div className="rounded border border-amber-200/80 bg-amber-50/60 px-2.5 py-2">
          <p className="text-[10px] font-medium text-amber-900">
            {t("modelLab.qc.sdsRoi.clusterCoverage.missingTickers")}
          </p>
          <div className="flex flex-wrap gap-1 mt-1">
            {coverage.missingTickers.map((tk) => (
              <span key={tk} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/80 border border-amber-200/60">
                {tk}
              </span>
            ))}
          </div>
        </div>
      ) : coverage.sparseComponents.length > 0 ? (
        <p className="text-[10px] text-amber-800 rounded border border-amber-200/70 bg-amber-50/50 px-2.5 py-2">
          {t("modelLab.qc.sdsRoi.clusterCoverage.sparseWarning")}{" "}
          {coverage.sparseComponents
            .slice(0, 6)
            .map((s) => `${s.clusterLetter}:${t(s.labelKey)} (${s.pctPresent}%)`)
            .join(" · ")}
        </p>
      ) : coverage.nSimCohort > 0 ? (
        <p className="text-[10px] text-emerald-800 rounded border border-emerald-200/70 bg-emerald-50/50 px-2.5 py-2">
          {t("modelLab.qc.sdsRoi.clusterCoverage.allOk")}
        </p>
      ) : null}
    </div>
  );
}

export function SdsClusterCoverageDrawer({
  open,
  onClose,
  coverage,
  it,
}: {
  open: boolean;
  onClose: () => void;
  coverage: SdsClusterCoverageView;
  it: boolean;
}) {
  const t = useT();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={t("modelLab.qc.sdsRoi.clusterCoverage.title")}
    >
      <div className="absolute inset-0 bg-black/35" onClick={onClose} aria-hidden="true" />

      <div className="relative z-10 flex h-full w-full max-w-xl flex-col overflow-hidden border-l border-slate-200/80 bg-white shadow-2xl">
        <div className="flex shrink-0 items-center gap-3 border-b border-slate-200/70 invest-trend-chart-panel px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">{t("modelLab.qc.sdsRoi.clusterCoverage.title")}</p>
            <p className="text-[11px] text-ink-muted leading-snug">{t("modelLab.qc.sdsRoi.clusterCoverage.drawerSubtitle")}</p>
          </div>
          <button
            type="button"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-slate-100 hover:text-ink"
            onClick={onClose}
            aria-label={t("modelLab.qc.sdsRoi.clusterCoverage.close")}
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <ClusterCoverageBody coverage={coverage} it={it} />
        </div>
      </div>
    </div>
  );
}

/** Compact trigger bar + slide-over drawer for SDS cluster fill analysis. */
export function SdsClusterCoverageSection({
  sdsSnap,
  simSnap,
  it,
}: {
  sdsSnap: SdsSnapshotDoc | null;
  simSnap: SimulationSheetSnapshotDoc | null;
  it: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const coverage = useMemo(() => buildSdsClusterCoverageView(sdsSnap, simSnap), [sdsSnap, simSnap]);

  if (!sdsSnap?.rows?.length) {
    return (
      <p className="text-[11px] text-ink-muted rounded-lg border border-dashed border-[rgb(var(--border))]/50 px-3 py-3">
        {t("modelLab.qc.sdsRoi.clusterCoverage.noSnapshot")}
      </p>
    );
  }

  const hasSparse = coverage.sparseComponents.length > 0;
  const hasMissing = coverage.missingTickers.length > 0;
  const minFill = coverage.clusters.length
    ? Math.min(...coverage.clusters.map((c) => c.minComponentFillPct))
    : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-lg border border-slate-200/70 invest-trend-chart-panel px-3 py-2.5 text-left transition hover:border-sky-300/70 hover:shadow-sm group"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <div className="flex flex-wrap items-center gap-2 gap-y-1">
          <p className="text-[10px] font-bold uppercase tracking-wide text-ink shrink-0">
            {t("modelLab.qc.sdsRoi.clusterCoverage.title")}
          </p>
          {coverage.nSimCohort > 0 ? (
            <p className="text-[10px] text-ink-muted tabular-nums">
              {t("modelLab.qc.sdsRoi.clusterCoverage.cohortGap", {
                inSnap: String(coverage.nInSdsSnapshot),
                sim: String(coverage.nSimCohort),
                missing: String(coverage.nMissingFromSnapshot),
              })}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-1 ml-auto">
            {coverage.clusters.map((cluster) => {
              const tone = fillTone(cluster.minComponentFillPct);
              const dot =
                tone === "green" ? "bg-emerald-500" : tone === "amber" ? "bg-amber-500" : "bg-rose-500";
              return (
                <span
                  key={cluster.letter}
                  className="inline-flex items-center gap-0.5 rounded border border-slate-200/80 bg-white/90 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-ink"
                  title={t(cluster.titleKey)}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
                  {cluster.letter}
                  <span className="font-normal text-ink-muted">{cluster.minComponentFillPct}%</span>
                </span>
              );
            })}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-1.5">
          {hasMissing ? (
            <span className="text-[9px] font-medium text-amber-800 rounded-full border border-amber-200/80 bg-amber-50/80 px-2 py-0.5">
              {coverage.missingTickers.length} {t("modelLab.qc.sdsRoi.clusterCoverage.status.missing")}
            </span>
          ) : hasSparse ? (
            <span className="text-[9px] font-medium text-amber-800 rounded-full border border-amber-200/80 bg-amber-50/80 px-2 py-0.5">
              {coverage.sparseComponents.length} {it ? "sotto-indici scarsi" : "sparse sub-indices"}
            </span>
          ) : coverage.nSimCohort > 0 ? (
            <span className="text-[9px] font-medium text-emerald-800 rounded-full border border-emerald-200/70 bg-emerald-50/70 px-2 py-0.5">
              {t("modelLab.qc.sdsRoi.clusterCoverage.allOk")}
            </span>
          ) : null}
          {minFill != null ? (
            <span className="text-[9px] text-ink-muted tabular-nums">
              {it ? "Fill min" : "Min fill"} {minFill}%
            </span>
          ) : null}
          <span className="ml-auto text-[10px] font-semibold text-[rgb(var(--accent))] group-hover:underline">
            {t("modelLab.qc.sdsRoi.clusterCoverage.openPanel")} →
          </span>
        </div>
      </button>

      <SdsClusterCoverageDrawer open={open} onClose={() => setOpen(false)} coverage={coverage} it={it} />
    </>
  );
}
