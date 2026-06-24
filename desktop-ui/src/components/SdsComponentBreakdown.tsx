import { useState } from "react";
import type {
  SdsClusterAComponentDetail,
  SdsClusterADetail,
  SdsClusterBDetail,
  SdsClusterCDetail,
  SdsClusterDDetail,
  SdsClusterEDetail,
  SdsRow,
} from "../api/supernova";
import { useT, type TranslationKey } from "../shared/i18n";

type ComponentSpec = {
  key: string;
  labelKey: TranslationKey;
  max: number;
  /** coverage_fields key — when false and score 0, show missing badge */
  coverageKey?: keyof NonNullable<SdsRow["coverage_fields"]>;
  /** always show as not-yet-implemented when score is 0 */
  notImplemented?: boolean;
};

type ClusterSpec = {
  titleKey: TranslationKey;
  clusterKey: keyof NonNullable<SdsRow["cluster_scores"]>;
  clusterMax: number;
  components: ComponentSpec[];
};

const CLUSTER_SPECS: ClusterSpec[] = [
  {
    titleKey: "decisionLab.sds.clusterA.title",
    clusterKey: "catalyst_quality",
    clusterMax: 30,
    components: [
      { key: "phase_credibility", labelKey: "decisionLab.sds.comp.phaseCred", max: 14 },
      { key: "endpoint_credibility", labelKey: "decisionLab.sds.comp.endpointCred", max: 10 },
      { key: "unmet_need", labelKey: "decisionLab.sds.comp.unmetNeed", max: 13 },
      { key: "market_size", labelKey: "decisionLab.sds.comp.marketSize", max: 10 },
    ],
  },
  {
    titleKey: "decisionLab.sds.clusterB.title",
    clusterKey: "institutional_signal",
    clusterMax: 25,
    components: [
      {
        key: "institutional_delta",
        labelKey: "decisionLab.sds.comp.instDelta",
        max: 8,
      },
      {
        key: "short_interest",
        labelKey: "decisionLab.sds.comp.shortInterest",
        max: 10,
        coverageKey: "short_interest",
      },
      { key: "analyst_upgrade", labelKey: "decisionLab.sds.comp.analystUpgrade", max: 8 },
    ],
  },
  {
    titleKey: "decisionLab.sds.clusterC.title",
    clusterKey: "price_structure",
    clusterMax: 20,
    components: [
      { key: "bb_squeeze", labelKey: "decisionLab.sds.comp.bbSqueeze", max: 10, coverageKey: "price" },
      { key: "obv_accumulation", labelKey: "decisionLab.sds.comp.obv", max: 8, coverageKey: "volume" },
      { key: "xbi_rs_90d", labelKey: "decisionLab.sds.comp.xbiRs", max: 5, coverageKey: "xbi" },
      { key: "volume_ratio", labelKey: "decisionLab.sds.comp.volRatio", max: 5, coverageKey: "volume" },
    ],
  },
  {
    titleKey: "decisionLab.sds.clusterD.title",
    clusterKey: "fundamentals",
    clusterMax: 15,
    components: [
      { key: "cash_runway", labelKey: "decisionLab.sds.comp.cashRunway", max: 8, coverageKey: "cash_runway" },
      { key: "mc_pipeline_ratio", labelKey: "decisionLab.sds.comp.mcPipeline", max: 8 },
      { key: "ma_attractiveness", labelKey: "decisionLab.sds.comp.maAttr", max: 7 },
    ],
  },
  {
    titleKey: "decisionLab.sds.clusterE.title",
    clusterKey: "timing",
    clusterMax: 10,
    components: [
      { key: "catalyst_window", labelKey: "decisionLab.sds.comp.catWindow", max: 6, coverageKey: "days_to_cd" },
      { key: "sequential_catalyst", labelKey: "decisionLab.sds.comp.seqCat", max: 4 },
    ],
  },
];

function ClusterADetailPanel({ detail }: { detail: SdsClusterADetail }) {
  const t = useT();

  const renderBlock = (
    label: string,
    block: SdsClusterAComponentDetail | undefined,
    extras: Array<{ label: string; value: string | number | boolean | null | undefined }>,
  ) => {
    if (!block) return null;
    return (
      <div className="rounded border border-[rgb(var(--border))]/35 bg-surface/40 p-2 space-y-1">
        <div className="font-medium text-ink text-[10px]">{label}</div>
        <div className="text-[9px] text-ink-muted tabular-nums">
          {block.score != null ? `${Number(block.score).toFixed(1)} / ${block.max ?? "?"}` : "—"}
        </div>
        {extras.map((ex) =>
          ex.value != null && ex.value !== "" ? (
            <div key={ex.label} className="text-[9px] text-ink-muted">
              <span className="text-ink/80">{ex.label}:</span> {String(ex.value)}
            </div>
          ) : null,
        )}
        {block.flags && block.flags.length > 0 ? (
          <div className="text-[9px] text-amber-700 dark:text-amber-300">{block.flags.join(", ")}</div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
      {renderBlock(t("decisionLab.sds.comp.phaseCred"), detail.phase_credibility, [
        { label: t("decisionLab.sds.clusterA.phaseDetected"), value: detail.phase_credibility?.phase_detected },
        {
          label: t("decisionLab.sds.clusterA.bonuses"),
          value: detail.phase_credibility?.bonuses?.length
            ? detail.phase_credibility.bonuses.join(", ")
            : null,
        },
      ])}
      {renderBlock(t("decisionLab.sds.comp.endpointCred"), detail.endpoint_credibility, [
        { label: t("decisionLab.sds.clusterA.endpointType"), value: detail.endpoint_credibility?.endpoint_type },
        { label: t("decisionLab.sds.clusterA.keyword"), value: detail.endpoint_credibility?.keyword_matched },
        { label: t("decisionLab.sds.clusterA.source"), value: detail.endpoint_credibility?.source },
      ])}
      {renderBlock(t("decisionLab.sds.comp.unmetNeed"), detail.unmet_need, [
        {
          label: t("decisionLab.sds.clusterA.approvedDrugs"),
          value: detail.unmet_need?.approved_drugs_count,
        },
        {
          label: t("decisionLab.sds.clusterA.firstInClass"),
          value:
            detail.unmet_need?.first_in_class == null
              ? null
              : detail.unmet_need.first_in_class
                ? `yes (${detail.unmet_need.confidence ?? "?"})`
                : "no",
        },
      ])}
      {renderBlock(t("decisionLab.sds.comp.marketSize"), detail.market_size, [
        { label: t("decisionLab.sds.clusterA.tamBn"), value: detail.market_size?.tam_estimate_bn },
        { label: t("decisionLab.sds.clusterA.source"), value: detail.market_size?.source },
      ])}
    </div>
  );
}

function ClusterBDetailPanel({ detail }: { detail: SdsClusterBDetail }) {
  const t = useT();
  const short = detail.short_interest;
  const analyst = detail.analyst_upgrades;
  const inst = detail.institutional_delta;

  return (
    <div className="mt-2 space-y-2">
      {short ? (
        <div className="rounded border border-[rgb(var(--border))]/35 bg-surface/40 p-2 text-[9px] space-y-1">
          <div className="font-medium text-ink">{t("decisionLab.sds.comp.shortInterest")}</div>
          {short.short_pct != null ? (
            <div className="text-ink-muted">
              {t("decisionLab.sds.clusterB.shortLabel", {
                pct: short.short_pct.toFixed(1),
                dtc: short.days_to_cover != null ? short.days_to_cover.toFixed(1) : "—",
              })}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-1">
            {short.squeeze_setup ? (
              <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                {t("decisionLab.sds.clusterB.squeezeSetup")}
              </span>
            ) : null}
            {short.structural_bearish ? (
              <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-700 dark:text-red-300">
                {t("decisionLab.sds.clusterB.bearishSignal")}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
      {analyst ? (
        <div className="rounded border border-[rgb(var(--border))]/35 bg-surface/40 p-2 text-[9px] space-y-1">
          <div className="font-medium text-ink">{t("decisionLab.sds.comp.analystUpgrade")}</div>
          {analyst.tier1_coverage ? (
            <span className="inline-block px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
              {t("decisionLab.sds.clusterB.tier1Coverage")}
            </span>
          ) : null}
          {(analyst.downgrades_60d ?? 0) >= 2 ? (
            <span className="inline-block px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-800 dark:text-amber-200 ml-1">
              {t("decisionLab.sds.clusterB.multipleDowngrades")}
            </span>
          ) : null}
          {analyst.latest && typeof analyst.latest === "object" ? (
            <div className="text-ink-muted">
              {(analyst.latest as { firm?: string }).firm} · {(analyst.latest as { action?: string }).action} ·{" "}
              {(analyst.latest as { date?: string }).date}
            </div>
          ) : analyst.status === "no_recent_coverage" ? (
            <div className="text-ink-muted/70">{t("decisionLab.sds.clusterB.noRecentCoverage")}</div>
          ) : null}
        </div>
      ) : null}
      {inst ? (
        <div className="rounded border border-[rgb(var(--border))]/35 bg-surface/40 p-2 text-[9px] space-y-1">
          <div className="font-medium text-ink">{t("decisionLab.sds.comp.instDelta")}</div>
          {inst.latest_quarter ? (
            <div className="text-ink-muted">
              Q{inst.latest_quarter.slice(0, 7)} · {inst.staleness_days ?? "—"}d {t("decisionLab.sds.clusterB.ago")}
            </div>
          ) : null}
          {inst.premium_fund_present ? (
            <span className="inline-block px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
              {t("decisionLab.sds.clusterB.premiumFund")}
            </span>
          ) : null}
          {inst.data_age_warning ? (
            <span className="inline-block px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-800 dark:text-amber-200 ml-1">
              {t("decisionLab.sds.clusterB.stale13f")}
            </span>
          ) : null}
          {(inst.score ?? 0) < 0 ? (
            <span className="inline-block px-1.5 py-0.5 rounded bg-red-500/20 text-red-700 dark:text-red-300 ml-1">
              {t("decisionLab.sds.clusterB.instExit")}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ClusterCDetailPanel({ detail }: { detail: SdsClusterCDetail }) {
  const t = useT();
  const bb = detail.bollinger_squeeze;
  const obv = detail.obv_accumulation;
  const rs = detail.xbi_relative_strength;
  const vol = detail.volume_ratio;

  return (
    <div className="mt-2 space-y-2">
      {bb ? (
        <div
          className="rounded border border-[rgb(var(--border))]/35 bg-surface/40 p-2 text-[9px] text-ink-muted"
          title={
            bb.bb_percentile != null
              ? t("decisionLab.sds.clusterC.bbTooltip", {
                  pct: bb.bb_percentile.toFixed(0),
                  interp: bb.interpretation ?? "normal",
                })
              : undefined
          }
        >
          <div className="font-medium text-ink">{t("decisionLab.sds.comp.bbSqueeze")}</div>
          {bb.bb_percentile != null ? (
            <div>
              {bb.bb_percentile.toFixed(0)}th pct · {bb.interpretation ?? "—"}
            </div>
          ) : null}
        </div>
      ) : null}
      {obv ? (
        <div
          className="rounded border border-[rgb(var(--border))]/35 bg-surface/40 p-2 text-[9px] text-ink-muted"
          title={t("decisionLab.sds.clusterC.obvTooltip", {
            pattern: obv.pattern ?? "—",
            slope: obv.price_slope_pct_day != null ? obv.price_slope_pct_day.toFixed(3) : "—",
            obvDir: (obv.obv_slope ?? 0) > 0 ? "rising" : "falling",
          })}
        >
          <div className="font-medium text-ink">{t("decisionLab.sds.comp.obv")}</div>
          <div>{obv.pattern ?? "—"}</div>
        </div>
      ) : null}
      {rs ? (
        <div
          className="rounded border border-[rgb(var(--border))]/35 bg-surface/40 p-2 text-[9px] text-ink-muted"
          title={t("decisionLab.sds.clusterC.xbiTooltip", {
            tkRet: rs.ticker_return_90d != null ? rs.ticker_return_90d.toFixed(1) : "—",
            xbiRet: rs.xbi_return_90d != null ? rs.xbi_return_90d.toFixed(1) : "—",
            alpha: rs.rs_90d != null ? rs.rs_90d.toFixed(1) : "—",
          })}
        >
          <div className="font-medium text-ink">{t("decisionLab.sds.comp.xbiRs")}</div>
          <div>{rs.interpretation ?? "—"}</div>
        </div>
      ) : null}
      {vol ? (
        <div
          className="rounded border border-[rgb(var(--border))]/35 bg-surface/40 p-2 text-[9px] text-ink-muted"
          title={t("decisionLab.sds.clusterC.volTooltip", {
            ratio5: vol.ratio_5d_vs_20d != null ? vol.ratio_5d_vs_20d.toFixed(2) : "—",
            ratioToday: vol.ratio_today_vs_20d != null ? vol.ratio_today_vs_20d.toFixed(2) : "—",
          })}
        >
          <div className="font-medium text-ink">{t("decisionLab.sds.comp.volRatio")}</div>
          <div>{vol.interpretation ?? "—"}</div>
        </div>
      ) : null}
    </div>
  );
}

function ClusterDDetailPanel({ detail }: { detail: SdsClusterDDetail }) {
  const t = useT();
  const cash = detail.cash_runway;
  const mc = detail.mc_pipeline_ratio;
  const ma = detail.ma_attractiveness;

  return (
    <div className="mt-2 space-y-2">
      {detail.cash_veto ? (
        <div className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[9px] text-red-700 dark:text-red-300 font-medium">
          {t("decisionLab.sds.clusterD.cashCrisisBanner")}
        </div>
      ) : null}
      {cash ? (
        <div
          className="rounded border border-[rgb(var(--border))]/35 bg-surface/40 p-2 text-[9px] space-y-1"
          title={
            cash.runway_months != null
              ? t("decisionLab.sds.clusterD.runwayLabel", {
                  mo: cash.runway_months >= 999 ? "999+" : String(cash.runway_months),
                  burn: cash.monthly_burn_mm != null ? String(cash.monthly_burn_mm) : "—",
                })
              : undefined
          }
        >
          <div className="font-medium text-ink">{t("decisionLab.sds.comp.cashRunway")}</div>
          {cash.runway_months != null ? (
            <div
              className={
                cash.status === "safe"
                  ? "text-emerald-700 dark:text-emerald-300"
                  : cash.status === "caution"
                    ? "text-amber-800 dark:text-amber-200"
                    : cash.status === "danger"
                      ? "text-red-700 dark:text-red-300"
                      : "text-ink-muted"
              }
            >
              {t("decisionLab.sds.clusterD.runwayLabel", {
                mo: cash.runway_months >= 999 ? "999+" : String(cash.runway_months),
                burn: cash.monthly_burn_mm != null ? String(cash.monthly_burn_mm) : "—",
              })}
            </div>
          ) : null}
          {cash.status === "caution" ? (
            <span className="inline-block px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-800 dark:text-amber-200">
              {t("decisionLab.sds.clusterD.caution")}
            </span>
          ) : null}
          {cash.status === "danger" ? (
            <span className="inline-block px-1.5 py-0.5 rounded bg-red-500/20 text-red-700 dark:text-red-300">
              {t("decisionLab.sds.clusterD.dilutionRisk")}
            </span>
          ) : null}
        </div>
      ) : null}
      {mc ? (
        <div
          className="rounded border border-[rgb(var(--border))]/35 bg-surface/40 p-2 text-[9px] text-ink-muted"
          title={t("decisionLab.sds.clusterD.mcTooltip", {
            mcap: mc.market_cap_bn != null ? mc.market_cap_bn.toFixed(2) : "—",
            npv: mc.pipeline_npv_estimate_bn != null ? mc.pipeline_npv_estimate_bn.toFixed(2) : "—",
            prob: mc.prob_approval_used != null ? (mc.prob_approval_used * 100).toFixed(0) : "—",
            peak: mc.peak_sales_bn != null ? mc.peak_sales_bn.toFixed(2) : "—",
          })}
        >
          <div className="font-medium text-ink">{t("decisionLab.sds.comp.mcPipeline")}</div>
          <div>{mc.interpretation ?? "—"}</div>
          {mc.ratio != null && mc.ratio < 0.4 ? (
            <span className="inline-block mt-1 px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
              {t("decisionLab.sds.clusterD.undervalued")}
            </span>
          ) : null}
          {mc.ratio != null && mc.ratio > 1.5 ? (
            <span className="inline-block mt-1 px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-800 dark:text-amber-200 ml-1">
              {t("decisionLab.sds.clusterD.stretched")}
            </span>
          ) : null}
        </div>
      ) : null}
      {ma ? (
        <div
          className="rounded border border-[rgb(var(--border))]/35 bg-surface/40 p-2 text-[9px] text-ink-muted"
          title={
            ma.rules_fired?.length
              ? `${ma.rules_fired.join(", ")} · ${(ma.potential_acquirers ?? []).join(", ")}`
              : t("decisionLab.sds.clusterD.maDisclaimer")
          }
        >
          <div className="font-medium text-ink">{t("decisionLab.sds.comp.maAttr")}</div>
          {(ma.score ?? 0) >= 5 ? (
            <span className="inline-block px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
              {t("decisionLab.sds.clusterD.maTarget")}
            </span>
          ) : null}
          <div className="mt-1 text-[8px] opacity-70">{t("decisionLab.sds.clusterD.maDisclaimer")}</div>
        </div>
      ) : null}
    </div>
  );
}

function cdCountdownClass(days: number | null | undefined): string {
  if (days == null) return "text-ink-muted/70";
  if (days <= 7) return "text-red-700 dark:text-red-300";
  if (days <= 14) return "text-amber-800 dark:text-amber-200";
  if (days <= 45) return "text-emerald-700 dark:text-emerald-300";
  return "text-ink-muted/70";
}

function ClusterEDetailPanel({ detail }: { detail: SdsClusterEDetail }) {
  const t = useT();
  const win = detail.catalyst_window;
  const seq = detail.sequential_catalysts;
  const flags = detail.flags;

  return (
    <div className="mt-2 space-y-2">
      {flags?.binary_event_lock ? (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[9px] text-amber-800 dark:text-amber-200 font-medium">
          {t("decisionLab.sds.clusterE.binaryBanner")}
        </div>
      ) : null}
      {seq?.catalyst_types && seq.catalyst_types.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {seq.catalyst_types.map((ct) => (
            <span
              key={ct}
              className="px-1.5 py-0.5 rounded bg-[rgb(var(--surface-3))]/80 text-[8px] text-ink-muted font-mono"
            >
              {ct}
            </span>
          ))}
        </div>
      ) : null}
      {win?.quality_modifier != null && win.quality_modifier !== 0 ? (
        <div className="text-[8px] text-ink-muted">
          {t("decisionLab.sds.clusterE.qualityModifier", {
            mod: win.quality_modifier > 0 ? `+${win.quality_modifier}` : String(win.quality_modifier),
          })}
        </div>
      ) : null}
    </div>
  );
}

function ComponentRow({
  spec,
  value,
  coverage,
  missingReason,
  clusterADetail,
  clusterBDetail,
  clusterCDetail,
  clusterDDetail,
  clusterEDetail,
  clusterBKey,
  clusterCKey,
  clusterDKey,
  clusterEKey,
}: {
  spec: ComponentSpec;
  value: number | null | undefined;
  coverage?: SdsRow["coverage_fields"];
  missingReason?: string;
  clusterADetail?: SdsClusterADetail;
  clusterBDetail?: SdsClusterBDetail;
  clusterCDetail?: SdsClusterCDetail;
  clusterDDetail?: SdsClusterDDetail;
  clusterEDetail?: SdsClusterEDetail;
  clusterBKey?: keyof SdsClusterBDetail;
  clusterCKey?: keyof SdsClusterCDetail;
  clusterDKey?: keyof SdsClusterDDetail;
  clusterEKey?: keyof SdsClusterEDetail;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const v = value ?? 0;
  const pct = Math.min(100, Math.max(0, (v / spec.max) * 100));
  const covExplicitlyMissing =
    spec.coverageKey != null && coverage != null && coverage[spec.coverageKey] === false;
  const eWin = clusterEKey === "catalyst_window" ? clusterEDetail?.catalyst_window : undefined;
  const eSeq = clusterEKey === "sequential_catalysts" ? clusterEDetail?.sequential_catalysts : undefined;
  const isClusterA =
    spec.key === "phase_credibility" ||
    spec.key === "endpoint_credibility" ||
    spec.key === "unmet_need" ||
    spec.key === "market_size";
  const bBlock = clusterBKey && clusterBDetail ? clusterBDetail[clusterBKey] : undefined;
  const unavailable =
    value == null &&
    bBlock &&
    typeof bBlock === "object" &&
    "status" in bBlock &&
    (bBlock as { status?: string }).status === "unavailable";
  const missing =
    missingReason === "insufficient_history"
      ? "insufficientHistory"
      : missingReason === "no_price_data"
        ? "insufficientHistory"
      : missingReason === "cash_data_unavailable"
        ? null
      : unavailable
        ? "na"
        : value == null && spec.key === "institutional_delta"
          ? "na"
          : spec.notImplemented && v === 0
            ? "notImplemented"
            : v === 0 && covExplicitlyMissing
              ? "missing"
              : null;

  return (
    <div className="text-[10px]">
      <div className="flex justify-between gap-2 mb-0.5">
        <span className="text-ink-muted truncate">{t(spec.labelKey)}</span>
        <span className="tabular-nums shrink-0 flex items-center gap-1">
          {isClusterA && clusterADetail ? (
            <button
              type="button"
              className="text-[9px] text-[#8bc34a] hover:underline"
              onClick={() => setOpen((o) => !o)}
              title={open ? t("decisionLab.sds.clusterA.detailHide") : t("decisionLab.sds.clusterA.detailToggle")}
            >
              {open ? "▾" : "▸"}
            </button>
          ) : null}
          {clusterBDetail && clusterBKey ? (
            <button
              type="button"
              className="text-[9px] text-[#8bc34a] hover:underline"
              onClick={() => setOpen((o) => !o)}
              title={open ? t("decisionLab.sds.clusterA.detailHide") : t("decisionLab.sds.clusterA.detailToggle")}
            >
              {open ? "▾" : "▸"}
            </button>
          ) : null}
          {clusterCDetail && clusterCKey ? (
            <button
              type="button"
              className="text-[9px] text-[#8bc34a] hover:underline"
              onClick={() => setOpen((o) => !o)}
              title={open ? t("decisionLab.sds.clusterA.detailHide") : t("decisionLab.sds.clusterA.detailToggle")}
            >
              {open ? "▾" : "▸"}
            </button>
          ) : null}
          {clusterDDetail && clusterDKey ? (
            <button
              type="button"
              className="text-[9px] text-[#8bc34a] hover:underline"
              onClick={() => setOpen((o) => !o)}
              title={open ? t("decisionLab.sds.clusterA.detailHide") : t("decisionLab.sds.clusterA.detailToggle")}
            >
              {open ? "▾" : "▸"}
            </button>
          ) : null}
          {clusterEDetail && clusterEKey ? (
            <button
              type="button"
              className="text-[9px] text-[#8bc34a] hover:underline"
              onClick={() => setOpen((o) => !o)}
              title={open ? t("decisionLab.sds.clusterA.detailHide") : t("decisionLab.sds.clusterA.detailToggle")}
            >
              {open ? "▾" : "▸"}
            </button>
          ) : null}
          {missing === "missing" ? (
            <span className="text-amber-700 dark:text-amber-300">{t("decisionLab.sds.comp.missing")}</span>
          ) : missing === "insufficientHistory" ? (
            <span className="text-amber-700 dark:text-amber-300">{t("decisionLab.sds.comp.insufficientHistory")}</span>
          ) : missing === "na" ? (
            <span className="text-ink-muted/70">{t("decisionLab.sds.comp.na")}</span>
          ) : missing === "notImplemented" ? (
            <span className="text-ink-muted/70">{t("decisionLab.sds.comp.notImplemented")}</span>
          ) : (
            <>
              {v.toFixed(1)} / {spec.max}
            </>
          )}
        </span>
      </div>
      <div className="h-1 rounded-full bg-[rgb(var(--surface-3))]/50 overflow-hidden">
        <div className="h-full rounded-full bg-[#8bc34a]/70" style={{ width: `${pct}%` }} />
      </div>
      {spec.key === "catalyst_window" && eWin?.label ? (
        <div className="text-[8px] text-ink-muted/80 mt-0.5">{eWin.label}</div>
      ) : null}
      {spec.key === "sequential_catalyst" && eSeq?.label ? (
        <div
          className="text-[8px] text-ink-muted/80 mt-0.5"
          title={(eSeq.catalyst_types ?? []).join(", ")}
        >
          {eSeq.label}
        </div>
      ) : null}
      {open && isClusterA && clusterADetail ? <ClusterADetailPanel detail={clusterADetail} /> : null}
      {open && clusterBDetail ? <ClusterBDetailPanel detail={clusterBDetail} /> : null}
      {open && clusterCDetail ? <ClusterCDetailPanel detail={clusterCDetail} /> : null}
      {open && clusterDDetail ? <ClusterDDetailPanel detail={clusterDDetail} /> : null}
      {open && clusterEDetail ? <ClusterEDetailPanel detail={clusterEDetail} /> : null}
    </div>
  );
}

export function SdsComponentBreakdown({ row }: { row: SdsRow }) {
  const t = useT();
  const raw = row.component_raw ?? {};
  const coverage = row.coverage_fields;
  const missingData = row.missing_data ?? {};
  const clusterADetail = row.cluster_a;
  const clusterBDetail = row.cluster_b;
  const clusterCDetail = row.cluster_c;
  const clusterDDetail = row.cluster_d;
  const clusterEDetail = row.cluster_e;

  const clusterBKeyMap: Record<string, keyof SdsClusterBDetail> = {
    short_interest: "short_interest",
    analyst_upgrade: "analyst_upgrades",
    institutional_delta: "institutional_delta",
  };
  const clusterCKeyMap: Record<string, keyof SdsClusterCDetail> = {
    bb_squeeze: "bollinger_squeeze",
    obv_accumulation: "obv_accumulation",
    xbi_rs_90d: "xbi_relative_strength",
    volume_ratio: "volume_ratio",
  };
  const clusterDKeyMap: Record<string, keyof SdsClusterDDetail> = {
    cash_runway: "cash_runway",
    mc_pipeline_ratio: "mc_pipeline_ratio",
    ma_attractiveness: "ma_attractiveness",
  };
  const clusterEKeyMap: Record<string, keyof SdsClusterEDetail> = {
    catalyst_window: "catalyst_window",
    sequential_catalyst: "sequential_catalysts",
  };

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-ink">{t("decisionLab.sds.comp.title")}</p>
      {CLUSTER_SPECS.map((cluster) => (
        <section
          key={cluster.clusterKey}
          className="rounded-lg border border-[rgb(var(--border))]/45 bg-surface/25 p-2.5 space-y-2"
        >
          <div className="flex justify-between items-start gap-2 text-[11px] font-medium">
            <span className="text-ink flex items-center gap-2 flex-wrap">
              {t(cluster.titleKey)}
              {cluster.clusterKey === "timing" && clusterEDetail?.catalyst_window?.days_to_cd != null ? (
                <span
                  className={`text-[9px] font-normal tabular-nums px-1.5 py-0.5 rounded border border-[rgb(var(--border))]/40 ${cdCountdownClass(clusterEDetail.catalyst_window.days_to_cd)}`}
                >
                  {clusterEDetail.catalyst_window.days_to_cd < 0
                    ? t("decisionLab.sds.clusterE.cdPassed")
                    : t("decisionLab.sds.clusterE.countdown", {
                        days: String(clusterEDetail.catalyst_window.days_to_cd),
                      })}
                </span>
              ) : null}
            </span>
            <span className="tabular-nums text-ink-muted">
              {(row.cluster_scores?.[cluster.clusterKey] ?? 0).toFixed(1)} / {cluster.clusterMax}
              {cluster.clusterKey === "catalyst_quality" && clusterADetail?.raw_total != null ? (
                <span className="ml-1 text-[9px]">({clusterADetail.raw_total}/{clusterADetail.raw_max ?? 47})</span>
              ) : null}
              {cluster.clusterKey === "institutional_signal" && clusterBDetail?.raw_total != null ? (
                <span className="ml-1 text-[9px]">({clusterBDetail.raw_total}/{clusterBDetail.raw_max ?? 26})</span>
              ) : null}
              {cluster.clusterKey === "price_structure" && clusterCDetail?.raw_total != null ? (
                <span className="ml-1 text-[9px]">({clusterCDetail.raw_total}/{clusterCDetail.raw_max ?? 28})</span>
              ) : null}
              {cluster.clusterKey === "fundamentals" && clusterDDetail?.raw_total != null ? (
                <span className="ml-1 text-[9px]">({clusterDDetail.raw_total}/{clusterDDetail.raw_max ?? 23})</span>
              ) : null}
              {cluster.clusterKey === "timing" && clusterEDetail?.raw_total != null ? (
                <span className="ml-1 text-[9px]">({clusterEDetail.raw_total}/{clusterEDetail.raw_max ?? 10})</span>
              ) : null}
            </span>
          </div>
          <div className="space-y-1.5">
            {cluster.components.map((spec) => (
              <ComponentRow
                key={spec.key}
                spec={spec}
                value={raw[spec.key] as number | undefined}
                coverage={coverage}
                missingReason={missingData[spec.key]}
                clusterADetail={cluster.clusterKey === "catalyst_quality" ? clusterADetail : undefined}
                clusterBDetail={cluster.clusterKey === "institutional_signal" ? clusterBDetail : undefined}
                clusterCDetail={cluster.clusterKey === "price_structure" ? clusterCDetail : undefined}
                clusterDDetail={cluster.clusterKey === "fundamentals" ? clusterDDetail : undefined}
                clusterEDetail={cluster.clusterKey === "timing" ? clusterEDetail : undefined}
                clusterBKey={clusterBKeyMap[spec.key]}
                clusterCKey={clusterCKeyMap[spec.key]}
                clusterDKey={clusterDKeyMap[spec.key]}
                clusterEKey={clusterEKeyMap[spec.key]}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
