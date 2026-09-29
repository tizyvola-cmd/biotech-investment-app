import { useMemo, useRef } from "react";
import type { AdviceActionKind } from "../sheet/investDecisionSimAdviceCalibration";
import {
  buildRecommendationEngineOverview,
  RECO_ACTION_COLORS,
  RECO_ACTION_ORDER,
  type RecommendationEngineOverview,
} from "../sheet/recommendationEngineOverview";
import { recommendationOverviewSignature } from "../sheet/adviceCalibrationStability";
import type {
  AdviceActionPrecisionRow,
  AdviceCalibrationBucketRow,
  AdviceCalibrationPoint,
} from "../sheet/investDecisionSimAdviceCalibration";
import { useT } from "../shared/i18n";

function AccuracyRing({
  pct,
  color,
  size = 76,
}: {
  pct: number | null;
  color: string;
  size?: number;
}) {
  const r = size / 2 - 7;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  const fill = pct != null ? Math.min(1, Math.max(0, pct / 100)) : 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden>
        <circle cx={c} cy={c} r={r} fill="none" stroke="#e2e8f0" strokeWidth="7" />
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeDasharray={`${circ * fill} ${circ}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${c} ${c})`}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[15px] font-bold tabular-nums text-ink leading-none">
        {pct != null ? `${Math.round(pct)}%` : "—"}
      </span>
    </div>
  );
}

function SummaryKpi({
  label,
  value,
  sub,
  valueClassName,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClassName?: string;
}) {
  return (
    <div className="tester-monitor-panel rounded-xl px-4 py-3 min-w-[140px] flex-1">
      <p className="tester-monitor-kpi-label text-[10px] uppercase tracking-wide font-semibold">
        {label}
      </p>
      <p
        className={`tester-monitor-kpi-value text-2xl font-bold tabular-nums mt-0.5 leading-none min-h-[1.75rem] flex items-center ${valueClassName ?? "text-ink"}`}
      >
        {value}
      </p>
      {sub ? (
        <p className="tester-monitor-muted text-[10px] mt-0.5 tabular-nums">{sub}</p>
      ) : (
        <span className="block min-h-[14px]" aria-hidden />
      )}
    </div>
  );
}

function actionLabel(action: AdviceActionKind): string {
  return action.toUpperCase();
}

function formatTickerList(tickers: string[], max = 5): string {
  if (!tickers.length) return "—";
  if (tickers.length <= max) return tickers.join(", ");
  return `${tickers.slice(0, max).join(", ")}, +${tickers.length - max}`;
}

function ZoneCard({
  card,
  it,
  pendingLabel,
}: {
  card: RecommendationEngineOverview["zoneCards"][number];
  it: boolean;
  pendingLabel: (n: number) => string;
}) {
  const color = RECO_ACTION_COLORS[card.action];
  const borderTint =
    card.action === "buy"
      ? "border-emerald-200/80"
      : card.action === "sell"
        ? "border-rose-200/80"
        : card.action === "hold"
          ? "border-sky-200/80"
          : "border-amber-200/80";

  return (
    <div
      className={`tester-monitor-panel rounded-xl p-3 flex flex-col gap-2 border ${borderTint}`}
      style={{ borderTopWidth: 3, borderTopColor: color }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold" style={{ color }}>
            {actionLabel(card.action)}
          </p>
          <p className="text-[10px] text-ink-muted tabular-nums">
            n={card.scored}
            {card.pending > 0 ? (
              <span className="text-amber-700 dark:text-amber-400">
                {" "}
                · {pendingLabel(card.pending)}
              </span>
            ) : null}
          </p>
        </div>
        <AccuracyRing pct={card.successRatePct} color={color} />
      </div>
      <p className="text-[10px] text-ink-muted leading-snug min-h-[28px]">
        {formatTickerList(card.tickers)}
      </p>
      {card.smallSample ? (
        <p className="text-[9px] text-amber-700 dark:text-amber-400 leading-snug">
          {it ? "n piccolo — risultato provvisorio" : "Small n — provisional result"}
        </p>
      ) : (
        <span className="block min-h-[14px]" aria-hidden />
      )}
    </div>
  );
}

function DealDistributionBar({
  distribution,
  it,
}: {
  distribution: RecommendationEngineOverview["distribution"];
  it: boolean;
}) {
  const total = distribution.reduce((s, d) => s + d.count, 0);
  if (!total) {
    return (
      <div className="h-8 rounded-lg bg-slate-100/80 flex items-center justify-center text-[10px] text-ink-muted">
        —
      </div>
    );
  }
  return (
    <div className="h-8 rounded-lg overflow-hidden flex w-full">
      {distribution.map((seg) => (
        <div
          key={seg.action}
          className="h-full"
          style={{
            width: `${(seg.count / total) * 100}%`,
            backgroundColor: seg.color,
            minWidth: seg.count > 0 ? 4 : 0,
          }}
          title={`${seg.action.toUpperCase()} · n=${seg.count}${seg.pending > 0 ? ` (+${seg.pending} ${it ? "attesa" : "pending"})` : ""}`}
        />
      ))}
    </div>
  );
}

function PplanBucketCard({ bucket }: { bucket: AdviceCalibrationBucketRow }) {
  const scored = bucket.goodCount + bucket.badCount;
  const rate = bucket.successRatePct;
  const underline =
    rate == null
      ? "bg-slate-300"
      : rate >= 70
        ? "bg-emerald-500"
        : rate >= 50
          ? "bg-sky-500"
          : "bg-rose-500";

  return (
    <div className="tester-monitor-panel rounded-lg px-3 py-2 min-w-[88px] flex-1 text-center">
      <p className="text-[10px] font-semibold text-ink-muted">{bucket.bucketLabel}</p>
      <p className="text-lg font-bold tabular-nums text-ink mt-0.5 leading-none min-h-[1.35rem] flex items-center justify-center">
        {rate != null ? `${Math.round(rate)}%` : "—"}
        {scored === 1 ? <span className="ml-0.5 text-amber-500 text-xs">⚠</span> : null}
      </p>
      <p className="text-[9px] text-ink-muted tabular-nums">n={scored || bucket.count}</p>
      <div className={`h-1 rounded-full mt-1.5 ${underline}`} />
    </div>
  );
}

function useStableRecommendationOverview(
  overview: RecommendationEngineOverview,
): RecommendationEngineOverview {
  const stableRef = useRef(overview);
  const sig = useMemo(() => recommendationOverviewSignature(overview), [overview]);
  const sigRef = useRef(sig);
  if (sigRef.current !== sig) {
    sigRef.current = sig;
    stableRef.current = overview;
  }
  return stableRef.current;
}

export function RecommendationEngineZoneDashboard({
  points,
  byAction,
  pplanBuckets,
  lang,
}: {
  points: AdviceCalibrationPoint[];
  byAction: AdviceActionPrecisionRow[];
  pplanBuckets: AdviceCalibrationBucketRow[];
  lang: "it" | "en";
}) {
  const t = useT();
  const it = lang === "it";
  const overview = useStableRecommendationOverview(
    useMemo(
      () => buildRecommendationEngineOverview(points, byAction, pplanBuckets),
      [points, byAction, pplanBuckets],
    ),
  );

  const best = overview.bestZone;
  const review = overview.reviewZone;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <SummaryKpi
          label={t("testerMonitor.recoEngine.totalDeals")}
          value={String(overview.totalDeals)}
          sub={
            overview.totalPending > 0
              ? `${t("testerMonitor.recoEngine.totalDealsSub", {
                  sim: overview.simDeals,
                  portfolio: overview.portfolioDeals,
                })} · ${t("testerMonitor.recoEngine.totalPendingSub", {
                  pending: overview.totalPending,
                })}`
              : t("testerMonitor.recoEngine.totalDealsSub", {
                  sim: overview.simDeals,
                  portfolio: overview.portfolioDeals,
                })
          }
        />
        <SummaryKpi
          label={t("testerMonitor.recoEngine.avgAccuracy")}
          value={
            overview.weightedAccuracyPct != null
              ? `${overview.weightedAccuracyPct}%`
              : "—"
          }
          sub={t("testerMonitor.recoEngine.avgAccuracySub")}
          valueClassName="text-emerald-600"
        />
        <SummaryKpi
          label={t("testerMonitor.recoEngine.bestZone")}
          value={best ? best.action.toUpperCase() : "—"}
          sub={
            best && best.successRatePct != null
              ? `${best.successRatePct}% · n=${best.good + best.bad}`
              : undefined
          }
          valueClassName="text-emerald-600"
        />
        <SummaryKpi
          label={t("testerMonitor.recoEngine.reviewZone")}
          value={review ? review.action.toUpperCase() : "—"}
          sub={
            review && review.successRatePct != null
              ? `${review.successRatePct}% · n=${review.good + review.bad}`
              : undefined
          }
          valueClassName="text-rose-600"
        />
      </div>

      <div>
        <p className="text-[11px] font-semibold text-ink mb-2">
          {t("testerMonitor.recoEngine.zoneAccuracyTitle")}
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {RECO_ACTION_ORDER.map((action) => {
            const card = overview.zoneCards.find((z) => z.action === action);
            if (!card) return null;
            return <ZoneCard key={action} card={card} it={it} pendingLabel={(n) => t("testerMonitor.recoEngine.zonePending", { pending: n })} />;
          })}
        </div>
      </div>

      <div className="tester-monitor-panel rounded-xl p-3 space-y-2">
        <p className="text-[11px] font-semibold text-ink">
          {t("testerMonitor.recoEngine.distributionTitle")}
        </p>
        <p className="text-[9px] text-ink-muted leading-snug">
          {t("testerMonitor.recoEngine.distributionCaption")}
        </p>
        <DealDistributionBar distribution={overview.distribution} it={it} />
        <div className="flex flex-wrap gap-3 text-[9px] text-ink-muted">
          {overview.distribution.map((seg) => (
            <span key={seg.action} className="inline-flex items-center gap-1">
              <span
                className="inline-block w-2 h-2 rounded-sm"
                style={{ backgroundColor: seg.color }}
              />
              {seg.action.toUpperCase()} ({seg.count}
              {seg.pending > 0
                ? ` +${seg.pending} ${it ? "att." : "pend."}`
                : ""}
              )
            </span>
          ))}
        </div>
        <p className="text-[9px] text-ink-muted leading-snug pt-0.5">
          {t("testerMonitor.recoEngine.scoredFootnote")}
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-[11px] font-semibold text-ink">
          {t("testerMonitor.recoEngine.pplanCalibTitle")}
        </p>
        <div className="flex flex-wrap gap-2">
          {overview.pplanBuckets.map((bucket) => (
            <PplanBucketCard key={bucket.bucketId} bucket={bucket} />
          ))}
        </div>
      </div>

      {overview.bucketAnomaly ? (
        <div className="rounded-xl border border-amber-300/80 bg-amber-50/90 dark:bg-amber-950/30 px-3 py-2.5 text-[11px] leading-relaxed text-amber-950 dark:text-amber-100">
          <p className="font-semibold">⚠ {t("testerMonitor.recoEngine.bucketAnomalyTitle")}</p>
          <p className="mt-0.5">
            {t("testerMonitor.recoEngine.bucketAnomalyBody", {
              bucket: overview.bucketAnomaly.bucketLabel,
              rate: `${overview.bucketAnomaly.successRatePct}%`,
              prevBucket: overview.bucketAnomaly.prevBucketLabel,
              prevRate: `${overview.bucketAnomaly.prevSuccessRatePct}%`,
            })}
          </p>
        </div>
      ) : (
        <div className="min-h-[3.25rem]" aria-hidden />
      )}
    </div>
  );
}
