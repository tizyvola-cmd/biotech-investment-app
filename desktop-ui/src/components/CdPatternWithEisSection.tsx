import type { CdPatternTickerRecommendation } from "../sheet/cdPatternRecommendation";
import { computeCdPatternPriorityIndex } from "../sheet/cdPatternPortfolioPriority";
import { useLang, useT } from "../shared/i18n";
import { CdPatternArcPanel } from "./CdPatternArcPanel";
import { CdPatternEisPanel } from "./CdPatternEisPanel";

function verdictClass(v: CdPatternTickerRecommendation["verdict"]): string {
  switch (v) {
    case "strong":
      return "text-emerald-600 dark:text-emerald-400";
    case "watch":
      return "text-amber-600 dark:text-amber-400";
    case "weak":
      return "text-orange-600 dark:text-orange-400";
    default:
      return "text-rose-600 dark:text-rose-400";
  }
}

function fmtRoi(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

export function CdPatternWithEisSection({
  rec,
  inPortfolio = false,
  sheetClinicalKpi,
  onOpenEisDetail,
  onOpenClinicalFeed,
}: {
  rec: CdPatternTickerRecommendation;
  inPortfolio?: boolean;
  sheetClinicalKpi?: number | null;
  onOpenEisDetail?: () => void;
  onOpenClinicalFeed?: (ticker: string) => void;
}) {
  const t = useT();
  const { lang } = useLang();
  const ppi = computeCdPatternPriorityIndex({ rec, inPortfolio });

  const verdictLabel = (v: CdPatternTickerRecommendation["verdict"]) => {
    switch (v) {
      case "strong":
        return t("decisionLab.pattern.verdict.strong");
      case "watch":
        return t("decisionLab.pattern.verdict.watch");
      case "weak":
        return t("decisionLab.pattern.verdict.weak");
      default:
        return t("decisionLab.pattern.verdict.blocked");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-[11px] font-semibold ${verdictClass(rec.verdict)}`}>
              {verdictLabel(rec.verdict)} · {rec.matchPct}%
            </span>
            <span
              className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded border border-[rgb(var(--border))]/50 text-ink"
              title={t("decisionLab.pattern.colPriorityTip")}
            >
              PPI {ppi}
            </span>
          </div>
          <p className="text-[11px] text-ink-muted mt-1 tabular-nums">{rec.arcPositionLabel}</p>
          <p className="text-[10px] text-ink-muted">{rec.window.arcLabel}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] text-ink-muted">{t("decisionLab.pattern.segmentRoi")}</p>
          <p
            className={`text-xl font-bold tabular-nums ${
              (rec.segmentRoiPct ?? 0) >= 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400"
            }`}
          >
            {fmtRoi(rec.segmentRoiPct)}
          </p>
          <p className="text-[9px] text-ink-muted max-w-[180px]">{rec.window.label}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <CdPatternArcPanel rec={rec} />
        <CdPatternEisPanel
          rec={rec}
          sheetClinicalKpi={sheetClinicalKpi}
          lang={lang === "it" ? "it" : "en"}
          onOpenFeed={onOpenClinicalFeed}
          onOpenDetail={onOpenEisDetail ?? (() => {})}
        />
      </div>
    </div>
  );
}
