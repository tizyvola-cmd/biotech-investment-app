import { useMemo, useState, useEffect, type ReactNode } from "react";
import { useMobileLang } from "../hooks/useMobileLang";
import {
  type DecisionChartTickerRow,
  type DecisionRec,
  invertRiskAxis,
  regRiskDisplayBarColor,
} from "../decisionChartLogic";
import { DECISION_CHART_AXES, type DecisionChartAxisId } from "../decisionChartIndices";
import {
  applyOppPnl24Filter,
  loadDecisionChartScope,
  saveDecisionChartScope,
  type DecisionChartViewId,
  type DecisionChartViews,
  type OppPnl24Filter,
} from "../decisionChartScope";
import { DecisionZoneCard, type ZoneTickerChip } from "./DecisionZoneCard";
import { MobileDecisionIndicesGuideSheet } from "./MobileDecisionIndicesGuideSheet";
import { decisionChartThemeStyle } from "../decisionChartTokens";
import type { MobileTheme } from "../hooks/useTheme";
import { GainStarMarks, ProvisionalGainStar } from "../gainStarDisplay";

const REC_ORDER: DecisionRec[] = ["buy", "hold", "review", "sell"];

const REC_ZONE: Record<
  DecisionRec,
  { label: string; zoneCls: string; badgeCls: string }
> = {
  buy: { label: "Buy", zoneCls: "decision-zone--buy", badgeCls: "rec-buy" },
  hold: { label: "Hold", zoneCls: "decision-zone--hold", badgeCls: "rec-hold" },
  review: { label: "Review", zoneCls: "decision-zone--review", badgeCls: "rec-review" },
  sell: { label: "Sell", zoneCls: "decision-zone--sell", badgeCls: "rec-sell" },
};

const AXES = DECISION_CHART_AXES;
type AxisId = DecisionChartAxisId;

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function fmtEisRaw(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${Math.round(n)}`;
}

function radarVal(row: DecisionChartTickerRow, id: AxisId): number | null {
  const s = row.scores;
  switch (id) {
    case "pplan":
      return s.pplan;
    case "sds":
      return s.sds;
    case "eis":
      return s.eis;
    case "riskV2":
      return invertRiskAxis(s.riskV2);
    case "regRisk":
      return invertRiskAxis(s.regRisk);
    case "mcs":
      return s.mcs;
    default:
      return null;
  }
}

function barVal(row: DecisionChartTickerRow, id: AxisId): number | null {
  const s = row.scores;
  switch (id) {
    case "pplan":
      return s.pplan;
    case "sds":
      return s.sds;
    case "eis":
      return s.eis;
    case "riskV2":
      return s.riskV2;
    case "regRisk":
      return s.regRisk;
    case "mcs":
      return s.mcs;
    default:
      return null;
  }
}

function axisColor(id: AxisId, row: DecisionChartTickerRow, fallback: string): string {
  if (id === "regRisk") return regRiskDisplayBarColor(row.scores.regRisk);
  return fallback;
}

function barFillWidth(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const clamped = Math.max(0, Math.min(100, value));
  return clamped === 0 ? 3 : Math.max(4, clamped);
}

function DecisionRadar({ row, size = 168 }: { row: DecisionChartTickerRow; size?: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const rMax = size * 0.34;
  const n = AXES.length;
  const points = useMemo(() => {
    return AXES.map((ax, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const raw = radarVal(row, ax.id);
      const has = raw != null && Number.isFinite(raw);
      const r = has ? (Math.max(0, Math.min(100, raw!)) / 100) * rMax : 0;
      return {
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r,
        has,
        color: axisColor(ax.id, row, ax.color),
        angle,
        label: ax.label,
      };
    });
  }, [row, cx, cy, rMax, n]);

  const poly = points
    .filter((p) => p.has)
    .map((p) => `${p.x},${p.y}`)
    .join(" ");

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="decision-radar-svg" aria-hidden>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <circle key={f} cx={cx} cy={cy} r={rMax * f} className="decision-radar-ring" />
      ))}
      {points.map((p, i) => (
        <g key={i}>
          <line
            x1={cx}
            y1={cy}
            x2={cx + Math.cos(p.angle) * rMax}
            y2={cy + Math.sin(p.angle) * rMax}
            className="decision-radar-spoke"
          />
          <text
            x={cx + Math.cos(p.angle) * (rMax + 13)}
            y={cy + Math.sin(p.angle) * (rMax + 13)}
            textAnchor="middle"
            dominantBaseline="middle"
            className="decision-radar-label"
          >
            {p.label}
          </text>
        </g>
      ))}
      {poly ? <polygon points={poly} className="decision-radar-fill" /> : null}
      {points.map((p, i) =>
        p.has ? <circle key={`pt-${i}`} cx={p.x} cy={p.y} r={4} fill={p.color} stroke="#fff" strokeWidth={1} /> : null,
      )}
    </svg>
  );
}

function TickerBubble({
  row,
  selected,
  onSelect,
}: {
  row: DecisionChartTickerRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const pnl = row.pnlPct;
  const pnlCls =
    pnl != null && pnl > 0.05 ? "decision-bubble-pnl--up" : pnl != null && pnl < -0.05 ? "decision-bubble-pnl--down" : "";

  return (
    <button
      type="button"
      className={`decision-bubble${selected ? " decision-bubble--selected" : ""}${row.scores.isRescue ? " decision-bubble--rescue" : ""}`}
      onClick={onSelect}
      title={row.diagnostic}
    >
      <span className="decision-bubble-ticker">{row.ticker}</span>
      {row.hasPortfolio || (row.gainStars?.length ?? 0) > 0 || row.manualGainStar ? (
        <span className="decision-bubble-marks" aria-hidden>
          {row.hasPortfolio ? <span className="decision-bubble-portfolio">💼</span> : null}
          {row.gainStars?.length ? (
            <GainStarMarks stars={row.gainStars} max={3} className="decision-bubble-stars" />
          ) : row.manualGainStar ? (
            <ProvisionalGainStar className="decision-bubble-stars" />
          ) : null}
        </span>
      ) : null}
      <span className={`decision-bubble-pnl ${pnlCls}`}>{fmtPct(pnl)}</span>
      {row.insufficientScores ? <span className="decision-bubble-warn">?</span> : null}
    </button>
  );
}

function DetailPanel({
  row,
  onClose,
}: {
  row: DecisionChartTickerRow;
  onClose: () => void;
}) {
  const { t } = useMobileLang();
  const zone = REC_ZONE[row.rec];

  return (
    <div className="decision-detail">
      <div className="decision-detail-head">
        <div className="decision-detail-title">
          <strong>{row.ticker}</strong>
          {row.hasPortfolio || (row.gainStars?.length ?? 0) > 0 || row.manualGainStar ? (
            <span className="decision-detail-marks" aria-hidden>
              {row.hasPortfolio ? <span title="Portfolio">💼</span> : null}
              {row.gainStars?.length ? (
                <GainStarMarks stars={row.gainStars} max={4} className="decision-detail-stars" />
              ) : row.manualGainStar ? (
                <ProvisionalGainStar className="decision-detail-stars" />
              ) : null}
            </span>
          ) : null}
          {row.company ? <span className="hint decision-detail-company">{row.company}</span> : null}
          <div className="decision-detail-meta">
            {row.phaseLabel ? <span className="hint">{row.phaseLabel}</span> : null}
            <span className="decision-detail-pnl">{fmtPct(row.pnlPct)}</span>
            <span className={`decision-rec-badge ${zone.badgeCls}`}>{zone.label.toUpperCase()}</span>
          </div>
        </div>
        <button type="button" className="decision-detail-close" onClick={onClose} aria-label={t("common.close")}>
          ×
        </button>
      </div>
      <div className="decision-detail-body">
        <DecisionRadar row={row} />
        <div className="decision-bars">
          {AXES.map((ax) => {
            const bar = ax.id === "eis" ? row.scores.eis : barVal(row, ax.id);
            const fillPct = barFillWidth(bar);
            const color = axisColor(ax.id, row, ax.color);
            const label =
              ax.id === "eis"
                ? fmtEisRaw(row.scores.eisRaw)
                : bar != null
                  ? String(Math.round(bar))
                  : "—";
            const axisTitle = `${ax.label}${ax.invert ? " (inv.)" : ""}`;
            return (
              <div key={ax.id} className="decision-bar-row">
                <span
                  className={`decision-bar-label${ax.longLabel ? " decision-bar-label--long" : ""}`}
                  title={axisTitle}
                >
                  {axisTitle}
                </span>
                <div className="decision-bar-track">
                  {fillPct != null ? (
                    <div className="decision-bar-fill" style={{ width: `${fillPct}%`, background: color }} />
                  ) : null}
                </div>
                <span className="decision-bar-val" style={ax.id === "regRisk" && bar != null ? { color } : undefined}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      {row.scores.eisRaw == null ? <p className="hint decision-eis-missing">{t("decision.eisMissing")}</p> : null}
      <p className="hint decision-diag">{row.diagnostic}</p>
      {row.insufficientScores ? <p className="hint warn-text">{t("decision.insufficient")}</p> : null}
    </div>
  );
}

type Props = {
  views: DecisionChartViews;
  selectedKey?: string | null;
  onSelectKey?: (key: string | null) => void;
  /** Navigate to opportunity detail (tap on zone chip). */
  onTickerPress?: (key: string) => void;
  /** When desktop republishes snapshot — align CD window tab. */
  syncScope?: DecisionChartViewId | null;
  onScopeChange?: (scope: DecisionChartViewId) => void;
  theme?: MobileTheme;
};

function countWindowRows(
  views: DecisionChartViews,
  window: DecisionChartViewId,
  filter: OppPnl24Filter,
): number {
  return applyOppPnl24Filter(views[window], filter).length;
}

function FilterTab({
  active,
  onClick,
  disabled,
  tone,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  tone?: "gain" | "loss";
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`dc-filter-tab${active ? " dc-filter-tab--active" : ""}${tone ? ` dc-filter-tab--${tone}` : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function MobileDecisionChart({
  views,
  selectedKey: highlightKey,
  onSelectKey,
  onTickerPress,
  syncScope,
  onScopeChange,
  theme = "light",
}: Props) {
  const { t } = useMobileLang();
  const [guideOpen, setGuideOpen] = useState(false);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [scope, setScope] = useState<DecisionChartViewId>(() => loadDecisionChartScope(syncScope));
  const [oppFilter, setOppFilter] = useState<OppPnl24Filter>("all");

  useEffect(() => {
    if (!syncScope) return;
    setScope((prev) => (prev === syncScope ? prev : syncScope));
    saveDecisionChartScope(syncScope);
  }, [syncScope]);

  const scopeRows = views[scope] ?? [];
  const rows = useMemo(() => applyOppPnl24Filter(scopeRows, oppFilter), [scopeRows, oppFilter]);

  const setScopeAndPersist = (next: DecisionChartViewId) => {
    setScope(next);
    saveDecisionChartScope(next);
    onScopeChange?.(next);
    setDetailKey(null);
  };

  useEffect(() => {
    onScopeChange?.(scope);
  }, [scope, onScopeChange]);

  const byRec = useMemo(() => {
    const map: Record<DecisionRec, DecisionChartTickerRow[]> = {
      buy: [],
      hold: [],
      review: [],
      sell: [],
    };
    for (const r of rows) map[r.rec].push(r);
    return map;
  }, [rows]);

  const oppFilterCounts = useMemo(
    () => ({
      all: countWindowRows(views, scope, "all"),
      gain24h: countWindowRows(views, scope, "gain24h"),
      loss24h: countWindowRows(views, scope, "loss24h"),
    }),
    [views, scope],
  );

  const windowCounts = useMemo(
    () => ({
      portfolio: countWindowRows(views, "portfolio", oppFilter),
      oppHot: countWindowRows(views, "oppHot", oppFilter),
      oppWatch: countWindowRows(views, "oppWatch", oppFilter),
    }),
    [views, oppFilter],
  );

  const detailRow = rows.find((r) => r.key === detailKey) ?? null;

  const onBubbleSelect = (key: string) => {
    const next = detailKey === key ? null : key;
    setDetailKey(next);
    onSelectKey?.(next ?? key);
  };

  const hasAnyRows =
    views.portfolio.length > 0 || views.oppHot.length > 0 || views.oppWatch.length > 0;

  if (!hasAnyRows) {
    return <p className="hint">{t("decision.empty")}</p>;
  }

  const onChipPress = (key: string) => {
    if (onTickerPress) {
      onTickerPress(key);
      onSelectKey?.(key);
      return;
    }
    onBubbleSelect(key);
  };

  const sectionLabel =
    scope === "portfolio"
      ? t("decision.sectionPortfolio")
      : scope === "oppHot"
        ? t("decision.sectionOppHot")
        : t("decision.sectionOppWatch");

  const themeStyle = decisionChartThemeStyle(theme);

  return (
    <>
      <div className="decision-chart-v2" style={themeStyle}>
        <div className="dc-filters">
          <div className="dc-filter-row">
            <span className="dc-filter-label">{t("decision.cdWindow")}</span>
            <div className="dc-filter-tabs">
              <FilterTab active={scope === "portfolio"} onClick={() => setScopeAndPersist("portfolio")}>
                {t("decision.scopePortfolio")} ({windowCounts.portfolio})
              </FilterTab>
              <FilterTab active={scope === "oppHot"} onClick={() => setScopeAndPersist("oppHot")}>
                {t("decision.scopeOppHot")} ({windowCounts.oppHot})
              </FilterTab>
              <FilterTab
                active={scope === "oppWatch"}
                onClick={() => setScopeAndPersist("oppWatch")}
                disabled={views.oppWatch.length === 0}
              >
                {t("decision.scopeOppWatch")} ({windowCounts.oppWatch})
              </FilterTab>
            </div>
          </div>

          <div className="dc-filter-row">
            <span className="dc-filter-label">{t("decision.cdFilter")}</span>
            <div className="dc-filter-tabs">
              <FilterTab active={oppFilter === "all"} onClick={() => setOppFilter("all")}>
                {t("decision.filterAll")} ({oppFilterCounts.all})
              </FilterTab>
              <FilterTab active={oppFilter === "gain24h"} onClick={() => setOppFilter("gain24h")} tone="gain">
                {t("decision.filterGain24")} ({oppFilterCounts.gain24h})
              </FilterTab>
              <FilterTab active={oppFilter === "loss24h"} onClick={() => setOppFilter("loss24h")} tone="loss">
                {t("decision.filterLoss24")} ({oppFilterCounts.loss24h})
              </FilterTab>
            </div>
          </div>
        </div>

        <div className="dc-section-head">
          <p className="dc-section-label">{sectionLabel}</p>
          <button type="button" className="dc-guide-link" onClick={() => setGuideOpen(true)}>
            {t("decision.guideLink")}
          </button>
        </div>

        {rows.length === 0 ? (
          <p className="dc-view-empty">
            {scope === "portfolio"
              ? t("decision.emptyPortfolio")
              : scope === "oppHot"
                ? t("decision.emptyOppHot")
                : oppFilter !== "all"
                  ? t("decision.emptyOppFilter")
                  : t("decision.emptyOppWatch")}
          </p>
        ) : (
          <div className="dc-zones-stack">
            {REC_ORDER.map((rec) => {
              const zoneRows: ZoneTickerChip[] = byRec[rec].map((r) => ({
                key: r.key,
                ticker: r.ticker,
                change24h: r.pnlPct24h ?? null,
                isRescue: r.scores.isRescue,
                hasPortfolio: r.hasPortfolio,
                gainStars: r.gainStars,
                showProvisionalStar: Boolean(r.manualGainStar && !(r.gainStars?.length ?? 0)),
              }));
              return (
                <DecisionZoneCard key={rec} zone={rec} tickers={zoneRows} onTickerPress={onChipPress} />
              );
            })}
          </div>
        )}

        {!onTickerPress && detailRow ? (
          <DetailPanel row={detailRow} onClose={() => setDetailKey(null)} />
        ) : null}
      </div>
      <MobileDecisionIndicesGuideSheet open={guideOpen} onClose={() => setGuideOpen(false)} />
    </>
  );
}
