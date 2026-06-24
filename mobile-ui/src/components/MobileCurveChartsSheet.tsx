import { Component, type ErrorInfo, type ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMobileLang } from "../hooks/useMobileLang";
import type { MobileCurveChartsPayload } from "../dashboardTypes";
import {
  hasCurveChartContent,
  marketSlopeChartVisible,
  normalizeCurveChartsPayload,
  resolveCurveChartsForRow,
  simRowForKey,
  slopeChartIsRedundant,
} from "../mobileCurveChartsBuild";
import type { InvestSimInputs, SheetTable } from "../types";
import {
  MobileGainPlanChart,
  MobileMarketModelSlopesChart,
  MobileMarketSlopeTrajectoryChart,
  MobilePredBlendChart,
} from "./mobileCurveChartSvgs";
import { MobileCdPatternRadarChart } from "./MobileCdPatternRadarChart";

type Props = {
  open: boolean;
  ticker: string | null;
  companyName: string | null;
  rowKey: string | null;
  charts: MobileCurveChartsPayload | null | undefined;
  sheet: SheetTable | null;
  inputs: InvestSimInputs;
  daysToCd: number | null;
  planReturnPct: number | null;
  hasPosition: boolean;
  completionDate: string | null;
  onClose: () => void;
};

function ChartSheetErrorBoundary({
  children,
  onClose,
  fallbackLabel,
}: {
  children: ReactNode;
  onClose: () => void;
  fallbackLabel: string;
}) {
  return (
    <ChartSheetErrorBoundaryInner onClose={onClose} fallbackLabel={fallbackLabel}>
      {children}
    </ChartSheetErrorBoundaryInner>
  );
}

class ChartSheetErrorBoundaryInner extends Component<
  { children: ReactNode; onClose: () => void; fallbackLabel: string },
  { err: string | null }
> {
  state = { err: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { err: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("[MobileCurveChartsSheet]", error, info);
  }

  render() {
    if (this.state.err) {
      return (
        <div className="curve-sheet-error">
          <p className="msg err">{this.props.fallbackLabel}</p>
          <p className="hint">{this.state.err}</p>
          <button type="button" className="btn primary" onClick={this.props.onClose}>
            OK
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

type ChartSlide = {
  id: string;
  tabLabel: string;
  title: string;
  caption?: string | null;
  content: ReactNode;
};

function ChartTile({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string | null;
  children: ReactNode;
}) {
  return (
    <section className="curve-chart-tile">
      <h4 className="curve-chart-tile-title">{title}</h4>
      {caption ? <p className="curve-chart-tile-caption">{caption}</p> : null}
      <div className="curve-chart-tile-body">{children}</div>
    </section>
  );
}

export function MobileCurveChartsSheet({
  open,
  ticker,
  companyName,
  rowKey,
  charts: chartsProp,
  sheet,
  inputs,
  daysToCd,
  planReturnPct,
  hasPosition,
  completionDate,
  onClose,
}: Props) {
  const { t } = useMobileLang();
  const [charts, setCharts] = useState<MobileCurveChartsPayload | null>(chartsProp ?? null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const carouselRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !rowKey) return;
    let cancelled = false;
    const row = simRowForKey(sheet, rowKey);
    const normalizedProp = normalizeCurveChartsPayload(chartsProp);
    if (normalizedProp && hasCurveChartContent(normalizedProp)) {
      setCharts(normalizedProp);
      setErr(null);
      if (row) {
        void resolveCurveChartsForRow({
          key: rowKey,
          row,
          snapshotCharts: chartsProp ?? null,
          inputs,
          daysToCd,
          planReturnPct,
          hasPosition,
          completionDate,
        }).then((data) => {
          if (cancelled) return;
          const normalized = normalizeCurveChartsPayload(data);
          if (normalized && hasCurveChartContent(normalized)) setCharts(normalized);
        });
      }
      return () => {
        cancelled = true;
      };
    }
    if (!row) {
      setCharts(null);
      setErr(null);
      return;
    }
    setLoading(true);
    setErr(null);
    void resolveCurveChartsForRow({
      key: rowKey,
      row,
      snapshotCharts: chartsProp ?? null,
      inputs,
      daysToCd,
      planReturnPct,
      hasPosition,
      completionDate,
    })
      .then((data) => {
        if (cancelled) return;
        const normalized = normalizeCurveChartsPayload(data);
        setCharts(normalized);
        if (!hasCurveChartContent(normalized)) {
          setErr(t("curve.noData"));
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
        setCharts(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    open,
    rowKey,
    chartsProp,
    sheet,
    inputs,
    daysToCd,
    planReturnPct,
    hasPosition,
    completionDate,
    t,
  ]);

  const slides = useMemo((): ChartSlide[] => {
    const safe = normalizeCurveChartsPayload(charts);
    if (!safe) return [];
    const out: ChartSlide[] = [];
    const polygon = safe.polygon;

    if (polygon?.labels?.length) {
      out.push({
        id: "polygon",
        tabLabel: t("curve.tabPolygon"),
        title: t("curve.polygonTitle"),
        caption: `${polygon.verdictLabel} · ${polygon.matchPct}% · ${polygon.segmentLabel} · ${polygon.arcPositionLabel}`,
        content: (
          <>
            <MobileCdPatternRadarChart polygon={polygon} />
            {(polygon.axes ?? []).length > 0 ? (
              <div className="curve-polygon-grid">
                {(polygon.axes ?? []).map((ax) => (
                  <div
                    key={ax.label}
                    className={`curve-polygon-axis${!ax.currentText || ax.currentText === "—" ? " curve-polygon-axis--missing" : ""}`}
                  >
                    <span
                      className="curve-polygon-axis-label"
                      title={
                        ax.label === "RA score"
                          ? t("curve.raScoreTip")
                          : ax.label === "MII °"
                            ? t("curve.miiTip")
                            : undefined
                      }
                    >
                      {ax.label}
                    </span>
                    <span className="curve-polygon-axis-val">
                      {ax.currentText} / {ax.targetText}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ),
      });
    }

    const slopeRedundant = slopeChartIsRedundant(safe.predBlend, safe.slopeTrajectory);

    if (safe.predBlend?.length) {
      const slopeCaption =
        safe.slope5d != null || safe.slope20d != null
          ? t("curve.slopeCaption", {
              s5: safe.slope5d?.toFixed(2) ?? "—",
              s20: safe.slope20d?.toFixed(2) ?? "—",
            })
          : null;
      out.push({
        id: "pred",
        tabLabel: t("curve.tabPred"),
        title: t("curve.predBlendTitle"),
        caption: [safe.predCaption, slopeRedundant ? slopeCaption : null].filter(Boolean).join(" · ") || null,
        content: (
          <MobilePredBlendChart points={safe.predBlend} todayOffset={safe.todayOffset} />
        ),
      });
    }

    if (marketSlopeChartVisible(safe.slopeTrajectory, safe.marketModel)) {
      const mm = safe.marketModel;
      const miiTxt =
        mm?.miiDeg != null ? `MII ${mm.miiDeg >= 0 ? "+" : ""}${mm.miiDeg.toFixed(1)}°` : null;
      const modelTxt =
        mm?.modelDeg != null ? `model ${mm.modelDeg >= 0 ? "+" : ""}${mm.modelDeg.toFixed(1)}°` : null;
      out.push({
        id: "marketSlope",
        tabLabel: t("curve.tabMarketPrediction"),
        title: t("curve.marketPredictionTitle"),
        caption: [miiTxt, modelTxt].filter(Boolean).join(" · ") || t("curve.marketPredictionCaption"),
        content: (
          <MobileMarketSlopeTrajectoryChart
            points={safe.slopeTrajectory!}
            todayOffset={safe.todayOffset}
          />
        ),
      });
    }

    if (safe.gainPlan?.length) {
      out.push({
        id: "gain",
        tabLabel: t("curve.tabGain"),
        title: t("curve.gainPlanTitle"),
        caption: safe.gainPlanHypothetical ? t("curve.gainPlanHypo") : t("curve.gainPlanLive"),
        content: (
          <MobileGainPlanChart
            points={safe.gainPlan}
            hypothetical={safe.gainPlanHypothetical}
          />
        ),
      });
    }

    if (safe.marketModel) {
      out.push({
        id: "market",
        tabLabel: t("curve.tabMarket"),
        title: t("curve.marketModelTitle"),
        caption: t("curve.marketModelCaption"),
        content: <MobileMarketModelSlopesChart marketModel={safe.marketModel} />,
      });
    }

    return out;
  }, [charts, t]);

  useEffect(() => {
    if (open) {
      setActiveIndex(0);
      carouselRef.current?.scrollTo({ left: 0, behavior: "auto" });
    }
  }, [open, rowKey]);

  useEffect(() => {
    if (slides.length > 0 && activeIndex >= slides.length) setActiveIndex(0);
  }, [activeIndex, slides.length]);

  const scrollToSlide = (index: number) => {
    const el = carouselRef.current;
    if (!el) return;
    const w = el.clientWidth;
    el.scrollTo({ left: index * w, behavior: "smooth" });
    setActiveIndex(index);
  };

  const onCarouselScroll = () => {
    const el = carouselRef.current;
    if (!el || el.clientWidth <= 0) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    if (idx !== activeIndex && idx >= 0 && idx < slides.length) {
      setActiveIndex(idx);
    }
  };

  if (!open || !ticker || typeof document === "undefined") return null;

  const hasContent = hasCurveChartContent(charts);

  return createPortal(
    <div
      className="sheet-root curve-sheet-root"
      role="dialog"
      aria-modal="true"
      aria-label={t("curve.sheetTitle", { ticker })}
    >
      <button type="button" className="sheet-backdrop" aria-label={t("common.close")} onClick={onClose} />
      <div className="sheet-panel curve-sheet-panel">
        <div className="sheet-handle" aria-hidden />
        <div className="sheet-header">
          <div>
            <h2>{t("curve.sheetTitle", { ticker: ticker.toUpperCase() })}</h2>
            {companyName ? <p className="hint curve-sheet-sub">{companyName}</p> : null}
          </div>
          <button type="button" className="sheet-close" onClick={onClose} aria-label={t("common.close")}>
            ✕
          </button>
        </div>
        <div className="sheet-body curve-sheet-body">
          <ChartSheetErrorBoundary onClose={onClose} fallbackLabel={t("curve.renderError")}>
            {loading ? <p className="hint">{t("common.loading")}</p> : null}
            {err && !loading ? <p className="msg err">{err}</p> : null}
            {!loading && hasContent && slides.length > 0 ? (
            <div className="curve-carousel-wrap">
              <div className="curve-carousel-tabs" role="tablist" aria-label={t("curve.tabsLabel")}>
                {slides.map((slide, index) => (
                  <button
                    key={slide.id}
                    type="button"
                    role="tab"
                    className={`curve-carousel-tab${index === activeIndex ? " active" : ""}`}
                    aria-selected={index === activeIndex}
                    onClick={() => scrollToSlide(index)}
                  >
                    {slide.tabLabel}
                  </button>
                ))}
              </div>
              <p className="curve-carousel-hint">{t("curve.swipeHint")}</p>
              <div
                ref={carouselRef}
                className="curve-carousel"
                onScroll={onCarouselScroll}
                aria-live="polite"
              >
                {slides.map((slide) => (
                  <div key={slide.id} className="curve-carousel-slide">
                    <ChartTile title={slide.title} caption={slide.caption}>
                      {slide.content}
                    </ChartTile>
                  </div>
                ))}
              </div>
              <div className="curve-carousel-dots" aria-hidden>
                {slides.map((slide, index) => (
                  <span
                    key={slide.id}
                    className={`curve-carousel-dot${index === activeIndex ? " active" : ""}`}
                  />
                ))}
              </div>
            </div>
            ) : null}
            {!loading && !hasContent && !err ? <p className="hint">{t("curve.noData")}</p> : null}
          </ChartSheetErrorBoundary>
        </div>
      </div>
    </div>,
    document.body,
  );
}
