import { useEffect, useMemo, useState } from "react";
import type { SheetTable } from "../types";
import { useInvestSimInputs } from "../hooks/useInvestSimInputs";
import { buildCrossTabCoherenceReport } from "../sheet/crossTabCoherence";
import {
  assessCrossTabCoherenceHealth,
  type CoherenceHealthLevel,
  type CoherenceMetricId,
} from "../sheet/crossTabCoherenceHealth";
import { subscribeTopOpps } from "../sheet/topOppsStore";
import { useLang, useT } from "../shared/i18n";

const LEVEL_CLASS: Record<CoherenceHealthLevel, string> = {
  ok: "coherence-metric-ok",
  warn: "coherence-metric-warn",
  error: "coherence-metric-error",
};

const OVERALL_BANNER: Record<CoherenceHealthLevel, { cls: string; key: import("../shared/i18n").TranslationKey }> = {
  ok: { cls: "coherence-banner-ok", key: "system.coherence.banner.ok" },
  warn: { cls: "coherence-banner-warn", key: "system.coherence.banner.warn" },
  error: { cls: "coherence-banner-error", key: "system.coherence.banner.error" },
};

function Metric({
  label,
  value,
  hint,
  level,
}: {
  label: string;
  value: string | number;
  hint?: string;
  level: CoherenceHealthLevel;
}) {
  return (
    <div className={`coherence-metric rounded-xl border px-3 py-2.5 ${LEVEL_CLASS[level]}`}>
      <div className="coherence-metric-label text-[10px] uppercase tracking-wide font-semibold">
        {label}
      </div>
      <div className="text-lg font-bold tabular-nums mt-0.5">{value}</div>
      {hint ? <div className="text-[10px] mt-1 opacity-80 leading-snug">{hint}</div> : null}
    </div>
  );
}

function useCoherenceBundle(simTable: SheetTable | null) {
  const inputs = useInvestSimInputs(simTable);
  const [tick, setTick] = useState(0);

  useEffect(() => subscribeTopOpps(() => setTick((n) => n + 1)), []);

  return useMemo(() => {
    if (!simTable?.rows?.length) return null;
    void tick;
    const report = buildCrossTabCoherenceReport(simTable, inputs);
    const health = assessCrossTabCoherenceHealth(report);
    return { report, health };
  }, [simTable, inputs, tick]);
}

export function CrossTabCoherencePanel({ simTable }: { simTable: SheetTable | null }) {
  const t = useT();
  const { lang } = useLang();
  const bundle = useCoherenceBundle(simTable);

  if (!simTable?.rows?.length) {
    return (
      <div className="coherence-panel rounded-xl border p-6">
        <p className="text-sm coherence-panel-muted">{t("system.coherence.noSim")}</p>
      </div>
    );
  }

  if (!bundle) return null;

  const { report, health } = bundle;
  const m = health.metricLevels;
  const banner = OVERALL_BANNER[health.overall];

  const pubLabel =
    report.store.publishedBy == null
      ? "—"
      : report.store.publishedBy === "decision-lab"
        ? t("system.coherence.pubDecisionLab")
        : report.store.publishedBy === "dashboard-strict"
          ? t("system.coherence.pubDashboardStrict")
          : t("system.coherence.pubDashboardPreview");

  const locale = lang === "it" ? "it-IT" : "en-US";

  const metrics: {
    id: CoherenceMetricId;
    label: string;
    value: string | number;
    hint?: string;
  }[] = [
    {
      id: "strictHot",
      label: t("system.coherence.strictHot"),
      value: report.strictHot,
      hint: `${t("system.coherence.watch")}: ${report.strictWatch}`,
    },
    {
      id: "relaxedHot",
      label: t("system.coherence.relaxedHot"),
      value: report.relaxedHot,
      hint: t("system.coherence.relaxedHint"),
    },
    {
      id: "storeHot",
      label: t("system.coherence.storeHot"),
      value: report.store.hotKeys.length,
      hint: pubLabel,
    },
    {
      id: "upsidePct",
      label: t("system.coherence.upsidePct"),
      value: `${report.upsideThresholdPct.toFixed(1)}%`,
    },
    {
      id: "minAff",
      label: t("system.coherence.minAff"),
      value: `${Math.round(report.minAffidabilitaPct)}%`,
    },
    {
      id: "slopeFeed",
      label: t("system.coherence.slopeFeed"),
      value: report.slopeFeedPortfolioRows,
    },
    {
      id: "openPos",
      label: t("system.coherence.openPos"),
      value: report.openPositions,
    },
    {
      id: "storeAge",
      label: t("system.coherence.storeAge"),
      value: report.storeAgeMinutes != null ? `${report.storeAgeMinutes} min` : "—",
    },
    {
      id: "buyWarn",
      label: t("system.coherence.buyWarn"),
      value: report.buyPriceWarningTickers.length,
    },
  ];

  return (
    <div className="coherence-panel rounded-xl border flex flex-col gap-4 max-w-3xl p-5">
      <div>
        <h3 className="text-base font-bold coherence-panel-title">{t("system.coherence.title")}</h3>
        <p className="text-xs coherence-panel-muted mt-1">{t("system.coherence.subtitle")}</p>
      </div>

      <div className={`rounded-lg px-3 py-2 text-xs font-medium ${banner.cls}`}>
        {t(banner.key)}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {metrics.map(({ id, label, value, hint }) => (
          <Metric key={id} label={label} value={value} hint={hint} level={m[id]} />
        ))}
      </div>

      {health.warningIssues.length > 0 && (
        <div className="coherence-note-warn rounded-lg px-3 py-2.5">
          <div className="text-xs font-semibold">{t("system.coherence.warningsTitle")}</div>
          <ul className="mt-2 space-y-1.5">
            {health.warningIssues.map((issue) => (
              <li key={issue.id} className="text-[11px] leading-snug">
                <span className="font-medium">{t(issue.titleKey, issue.detailVars)}</span>
                {issue.tickers?.length ? (
                  <span className="font-mono ml-1 opacity-90">({issue.tickers.join(", ")})</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.divergentTickers.length > 0 && m.relaxedDrift !== "error" && (
        <div className="coherence-note-warn rounded-lg px-3 py-2.5">
          <div className="text-xs font-semibold">{t("system.coherence.divergentTitle")}</div>
          <p className="text-[11px] mt-1 opacity-90">{t("system.coherence.divergentBody")}</p>
          <p className="text-xs font-mono mt-2 break-all">{report.divergentTickers.join(", ")}</p>
        </div>
      )}

      {report.buyPriceWarningTickers.length > 0 && (
        <div className="coherence-note-error rounded-lg px-3 py-2.5">
          <div className="text-xs font-semibold">{t("system.coherence.buyWarnTitle")}</div>
          <p className="text-xs font-mono mt-1 break-all">{report.buyPriceWarningTickers.join(", ")}</p>
        </div>
      )}

      <details className="text-xs coherence-panel-muted">
        <summary className="cursor-pointer hover:text-[rgb(var(--panel-feed-accent-strong))]">
          {t("system.coherence.rawStore")}
        </summary>
        <pre className="mt-2 p-2 rounded-lg coherence-panel-code overflow-x-auto text-[10px]">
          {JSON.stringify(report.store, null, 2)}
        </pre>
      </details>

      <p className="text-[10px] coherence-panel-muted">
        {t("system.coherence.footer")} · {new Date().toLocaleString(locale)}
      </p>
    </div>
  );
}
