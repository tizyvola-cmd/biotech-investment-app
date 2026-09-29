import { useEffect, useMemo, useState, type ReactNode } from "react";

import { invertRiskAxis, regRiskDisplayBarColor } from "../decisionChartLogic";

import type { ClinicalPreCdRecord } from "../api";

import type { MobileCurveChartsPayload, MobileDashboardSnapshot } from "../dashboardTypes";

import { TickerGainAndManualMarks } from "../gainStarDisplay";

import { marketSlopeChartVisible } from "../mobileCurveChartsBuild";

import { MobileEisRegulatoryPanel } from "./MobileEisRegulatoryPanel";
import { OpportunityTradePanel } from "./OpportunityTradePanel";

import { MobilePriceVariationChart } from "./MobilePriceVariationChart";

import { MobileSimRowBetaLiquidityBadges } from "./MobileSimRowBetaLiquidityBadges";

import {

  MobileMarketModelSlopesChart,

} from "./mobileCurveChartSvgs";

import { useMobileLang } from "../hooks/useMobileLang";



const OPP_CHART_H = 168;
const OPP_CHART_W = 296;



export type OpportunityDetailSection = "slopes" | "curves" | "decisionLab" | "eis" | "regulatory" | "mii";

export type OpportunityChartAnchor = "price" | "slope" | "gain" | "mii";



export const OPP_CHART_DOM_IDS: Record<OpportunityChartAnchor, string> = {

  price: "mob-chart-price",

  slope: "mob-chart-slope",

  gain: "mob-chart-gain",

  mii: "mob-chart-mii",

};



export interface MobileOpportunityCardProps {

  ticker: string;

  companyName: string;

  phase: string;

  daysToCD: number;

  cdDate: string;

  recommendation: "buy" | "hold" | "review" | "sell";

  pnlPct: number | null;

  isRescue: boolean;

  rescueNote?: string | null;

  scores: {

    pplan: number | null;

    sds: number | null;

    eis: number | null;

    riskV2: number | null;

    regRisk: number | null;

    mcs: number | null;

    liquidity: number | null;

  };

  alertMessage: string | null;

  diagnostic?: string | null;

  priceWindows: Array<{

    window: "1D" | "7D" | "1M" | "3M" | "6M";

    tickerChange: number | null;

    marketChange: number | null;

  }>;

  clinicalIndicators: Array<{

    label: string;

    value: string;

    badge: "EFF" | "CTX" | null;

    count?: number;

  }>;

  extraClinicalCount?: number;

  simRow: Record<string, unknown>;

  curveCharts: MobileCurveChartsPayload | null;

  hasPosition: boolean;

  eisRaw: number | null;

  regSignedScore: number | null;

  clinicalRecords: ClinicalPreCdRecord[];

  dashSnapshot?: MobileDashboardSnapshot | null;

  onOpenDetail: (section: OpportunityDetailSection, chartSlide?: string | null) => void;

  focusCurvesToken?: number;

  /** Inline sim buy/sell (replaces score profile). */
  tradePriceUsd?: number | null;
  tradeSuggestedCapitalEur?: number | null;
  tradeOpenCapitalEur?: number | null;
  tradeBusy?: boolean;
  tradeErr?: string | null;
  onTradeBuy?: (capitalEur: number) => void;
  onTradeSell?: () => void;

}



const REC_CLS: Record<MobileOpportunityCardProps["recommendation"], string> = {

  buy: "mob-opp-rec-buy",

  hold: "mob-opp-rec-hold",

  review: "mob-opp-rec-review",

  sell: "mob-opp-rec-sell",

};



const REC_LABEL: Record<MobileOpportunityCardProps["recommendation"], string> = {

  buy: "BUY",

  hold: "HOLD",

  review: "Review",

  sell: "SELL",

};



function fmtPct(v: number | null, suffix = ""): string {

  if (v == null || !Number.isFinite(v)) return "—";

  return `${Math.round(v)}${suffix}`;

}



function fmtLiq(v: number | null): string {

  if (v == null || !Number.isFinite(v)) return "—";

  return v.toFixed(2);

}



function fmtReg(v: number | null): string {

  if (v == null || !Number.isFinite(v)) return "—";

  const signed = Math.round(v * 2 - 100);

  return signed >= 0 ? `+${signed}` : String(signed);

}



function pplanColor(v: number | null): string {

  if (v == null) return "muted";

  if (v >= 65) return "up";

  if (v >= 50) return "warn";

  return "down";

}



function fmtEisPill(raw: number | null, display: number | null): string {
  if (raw != null && Number.isFinite(raw)) {
    return `${raw >= 0 ? "+" : ""}${raw.toFixed(0)}`;
  }
  return fmtPct(display);
}

function eisColor(v: number | null): string {
  if (v == null) return "muted";
  if (v > 20) return "up";
  if (v <= 10) return "down";
  return "warn";
}

function eisPillTone(raw: number | null, display: number | null): string {
  if (raw != null && Number.isFinite(raw)) {
    if (raw >= 3) return "up";
    if (raw <= -3) return "down";
    return "warn";
  }
  return eisColor(display);
}



function riskColor(v: number | null): string {

  if (v == null) return "muted";

  if (v <= 35) return "up";

  if (v <= 55) return "warn";

  return "down";

}



function regColor(v: number | null): string {

  if (v == null) return "muted";

  const signed = v * 2 - 100;

  if (signed <= 0) return "up";

  if (signed < 50) return "warn";

  return "down";

}



function mcsColor(v: number | null): string {

  if (v == null) return "muted";

  if (v > 55) return "up";

  if (v >= 35) return "warn";

  return "down";

}



function liqColor(v: number | null): string {

  if (v == null) return "muted";

  if (v >= 0.8) return "up";

  if (v >= 0.5) return "warn";

  return "down";

}



function scrollToCurvesSection() {
  document.getElementById("mob-opp-curves-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function scrollToChart(anchor: OpportunityChartAnchor) {
  document.getElementById(OPP_CHART_DOM_IDS[anchor])?.scrollIntoView({ behavior: "smooth", block: "start" });
}



function AccordionSection({

  title,

  open,

  onToggle,

  children,

}: {

  title: string;

  open: boolean;

  onToggle: () => void;

  children: ReactNode;

}) {

  return (

    <section className="mob-opp-accordion">

      <button type="button" className="mob-opp-accordion-head" onClick={onToggle} aria-expanded={open}>

        <span className="mob-opp-accordion-title">{title}</span>

        <span className="mob-opp-chevron" aria-hidden>

          {open ? "▴" : "▾"}

        </span>

      </button>

      {open ? <div className="mob-opp-accordion-body">{children}</div> : null}

    </section>

  );

}



const SCORE_AXES = [

  { id: "pplan", label: "P(plan)", color: "#2a78d6", invert: false },

  { id: "sds", label: "SDS", color: "#1baf7a", invert: false },

  { id: "eis", label: "EIS", color: "#eda100", invert: false },

  { id: "riskV2", label: "Risk", color: "#4a3aa7", invert: true },

  { id: "regRisk", label: "Reg.", color: "#64748b", invert: true },

  { id: "mcs", label: "MCS", color: "#e11d48", invert: false },

] as const;



type AxisId = (typeof SCORE_AXES)[number]["id"];



function radarVal(scores: MobileOpportunityCardProps["scores"], id: AxisId): number | null {

  switch (id) {

    case "pplan":

      return scores.pplan;

    case "sds":

      return scores.sds;

    case "eis":

      return scores.eis;

    case "riskV2":

      return invertRiskAxis(scores.riskV2);

    case "regRisk":

      return invertRiskAxis(scores.regRisk);

    case "mcs":

      return scores.mcs;

    default:

      return null;

  }

}



function barVal(scores: MobileOpportunityCardProps["scores"], id: AxisId): number | null {

  switch (id) {

    case "pplan":

      return scores.pplan;

    case "sds":

      return scores.sds;

    case "eis":

      return scores.eis;

    case "riskV2":

      return scores.riskV2;

    case "regRisk":

      return scores.regRisk;

    case "mcs":

      return scores.mcs;

    default:

      return null;

  }

}



function radarLabelStyle(angle: number): {
  textAnchor: "start" | "middle" | "end";
  dominantBaseline: "auto" | "middle" | "hanging";
  dx: number;
  dy: number;
} {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  if (s < -0.45) return { textAnchor: "middle", dominantBaseline: "auto", dx: 0, dy: -1 };
  if (s > 0.45) return { textAnchor: "middle", dominantBaseline: "hanging", dx: 0, dy: 1 };
  if (c < -0.25) return { textAnchor: "end", dominantBaseline: "middle", dx: -2, dy: 0 };
  if (c > 0.25) return { textAnchor: "start", dominantBaseline: "middle", dx: 2, dy: 0 };
  return { textAnchor: "middle", dominantBaseline: "middle", dx: 0, dy: 0 };
}

function ScoreRadar({ scores, size = 84 }: { scores: MobileOpportunityCardProps["scores"]; size?: number }) {
  const PAD = 20;
  const vb = size + PAD * 2;
  const cx = vb / 2;
  const cy = vb / 2;
  const rMax = size * 0.3;
  const labelR = rMax + 12;
  const n = SCORE_AXES.length;

  const points = useMemo(() => {
    return SCORE_AXES.map((ax, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const raw = radarVal(scores, ax.id);
      const has = raw != null;
      const r = has ? (raw! / 100) * rMax : rMax * 0.12;
      return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r, has, label: ax.label };
    });
  }, [scores, cx, cy, rMax, n]);

  const poly = points
    .filter((p) => p.has)
    .map((p) => `${p.x},${p.y}`)
    .join(" ");

  return (
    <div className="mob-opp-score-radar-wrap" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${vb} ${vb}`}
        preserveAspectRatio="xMidYMid meet"
        className="mob-opp-radar"
        aria-hidden
        overflow="visible"
      >
        {[0.33, 0.66, 1].map((f) => (
          <circle key={f} cx={cx} cy={cy} r={rMax * f} className="mob-opp-radar-ring" />
        ))}
        {SCORE_AXES.map((_, i) => {
          const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={cx + Math.cos(angle) * rMax}
              y2={cy + Math.sin(angle) * rMax}
              className="mob-opp-radar-spoke"
            />
          );
        })}
        {poly ? <polygon points={poly} className="mob-opp-radar-fill" /> : null}
        {points.map((p, i) =>
          p.has ? <circle key={i} cx={p.x} cy={p.y} r={2.5} className="mob-opp-radar-dot" /> : null,
        )}
        {SCORE_AXES.map((ax, i) => {
          const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
          const lx = cx + Math.cos(angle) * labelR;
          const ly = cy + Math.sin(angle) * labelR;
          const labelStyle = radarLabelStyle(angle);
          return (
            <text
              key={ax.id}
              x={lx}
              y={ly}
              textAnchor={labelStyle.textAnchor}
              dominantBaseline={labelStyle.dominantBaseline}
              dx={labelStyle.dx}
              dy={labelStyle.dy}
              className="mob-opp-radar-label"
            >
              {ax.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}



function barFillWidth(value: number | null): number | null {

  if (value == null || !Number.isFinite(value)) return null;

  const clamped = Math.max(0, Math.min(100, value));

  return clamped === 0 ? 3 : Math.max(4, clamped);

}



function ScoreBars({ scores }: { scores: MobileOpportunityCardProps["scores"] }) {

  return (

    <div className="mob-opp-bars">

      {SCORE_AXES.map((ax) => {

        const bar = barVal(scores, ax.id);

        const fillPct = barFillWidth(ax.invert && bar != null ? invertRiskAxis(bar) : bar);

        const color = ax.id === "regRisk" ? regRiskDisplayBarColor(scores.regRisk) : ax.color;

        const label = ax.invert ? `${ax.label} (inv.)` : ax.label;

        return (

          <div key={ax.id} className="mob-opp-bar-row">

            <span className="mob-opp-bar-label">{label}</span>

            <div className="mob-opp-bar-track">

              {fillPct != null ? (

                <div className="mob-opp-bar-fill" style={{ width: `${fillPct}%`, background: color }} />

              ) : null}

            </div>

            <span className="mob-opp-bar-val">{bar != null ? Math.round(bar) : "—"}</span>

          </div>

        );

      })}

    </div>

  );

}



function ChartBlock({

  id,

  title,

  subtitle,

  children,

}: {

  id: string;

  title: string;

  subtitle?: string | null;

  children: ReactNode;

}) {

  return (

    <section id={id} className="mob-opp-chart-block">

      <p className="mob-opp-chart-block-title">{title}</p>

      {subtitle ? <p className="hint mob-opp-chart-block-sub">{subtitle}</p> : null}

      {children}

    </section>

  );

}



function CurvesSection({ children }: { children: ReactNode }) {
  return (
    <section id="mob-opp-curves-section" className="mob-opp-curves-section">
      <div className="mob-opp-charts-stack">{children}</div>
    </section>
  );
}



function FooterIcon({ kind }: { kind: OpportunityDetailSection }) {

  const common = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.75 };

  switch (kind) {

    case "slopes":

      return (

        <svg {...common}>

          <path d="M4 19 L8 13 L12 15 L20 5" />

        </svg>

      );

    case "curves":

      return (

        <svg {...common}>

          <path d="M4 16 C8 8 12 20 16 10 C18 6 20 8 20 8" />

        </svg>

      );

    case "decisionLab":

      return (

        <svg {...common}>

          <path d="M10 2 v6 l-4 8 h8 l-4-8 v-6" />

          <path d="M6 18 h12" />

        </svg>

      );

    case "eis":

      return (

        <svg {...common}>

          <path d="M12 3 C8 8 16 8 12 13 C8 18 16 18 12 21" />

        </svg>

      );

    case "mii":

      return (

        <svg {...common}>

          <path d="M4 18 L10 10 L14 14 L20 6" />

          <path d="M18 6 h2 v2" />

        </svg>

      );

    default:

      return null;

  }

}



export function MobileOpportunityCard(props: MobileOpportunityCardProps) {

  const { t } = useMobileLang();

  const [clinicalOpen, setClinicalOpen] = useState(false);



  const {

    ticker,

    phase,

    daysToCD,

    cdDate,

    recommendation,

    pnlPct,

    rescueNote,

    scores,

    alertMessage,

    priceWindows,

    clinicalIndicators,

    extraClinicalCount = 0,

    simRow,

    curveCharts,

    hasPosition,

    eisRaw,

    regSignedScore,

    clinicalRecords,

    dashSnapshot,

    onOpenDetail,

    focusCurvesToken = 0,

    tradePriceUsd = null,

    tradeSuggestedCapitalEur = null,

    tradeOpenCapitalEur = null,

    tradeBusy = false,

    tradeErr = null,

    onTradeBuy,

    onTradeSell,

  } = props;



  useEffect(() => {
    if (focusCurvesToken > 0) {
      requestAnimationFrame(() => scrollToCurvesSection());
    }
  }, [focusCurvesToken]);



  const charts = curveCharts;

  const hasMii = marketSlopeChartVisible(charts?.slopeTrajectory ?? null, charts?.marketModel ?? null);



  const pills = [

    { label: "P(plan)", value: fmtPct(scores.pplan, "%"), tone: pplanColor(scores.pplan) },

    { label: "EIS", value: fmtEisPill(eisRaw, scores.eis), tone: eisPillTone(eisRaw, scores.eis) },

    { label: "Risk v2", value: fmtPct(scores.riskV2), tone: riskColor(scores.riskV2) },

    { label: "Reg", value: fmtReg(scores.regRisk), tone: regColor(scores.regRisk) },

    { label: "MCS", value: fmtPct(scores.mcs), tone: mcsColor(scores.mcs) },

    { label: "Liq", value: fmtLiq(scores.liquidity), tone: liqColor(scores.liquidity) },

  ];



  const tMinus = daysToCD >= 0 ? `T−${daysToCD}` : `T+${Math.abs(daysToCD)}`;



  return (

    <article className="mob-opp-card">

      <header className="mob-opp-l1">

        <div className="mob-opp-ticker-row">

          <div className="mob-opp-ticker-left">

            <strong className="mob-opp-ticker">{ticker}</strong>
            <TickerGainAndManualMarks ticker={ticker} dashSnapshot={dashSnapshot} className="mob-opp-gain-stars" />
            <span className="mob-opp-phase">{phase}</span>

          </div>

          <span className="mob-opp-cd-meta">

            {tMinus} · CD {cdDate}

          </span>

        </div>



        <div className="mob-opp-rec-row">

          <div className="mob-opp-rec-left">

            <span className={`mob-opp-rec-badge ${REC_CLS[recommendation]}`}>{REC_LABEL[recommendation]}</span>

            {rescueNote ? <span className="mob-opp-rescue-note">{rescueNote}</span> : null}

          </div>

          <span className={`mob-opp-pnl ${pnlPct == null ? "tone-muted" : pnlPct >= 0 ? "tone-up" : "tone-down"}`}>

            {pnlPct == null ? "—" : `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%`}

          </span>

        </div>



        <div className="mob-opp-pills-wrap">

          {pills.map((p) => (

            <span key={p.label} className={`mob-opp-pill mob-opp-pill--${p.tone}`}>

              <span className="mob-opp-pill-label">{p.label}</span>

              <span className="mob-opp-pill-val">{p.value}</span>

            </span>

          ))}

        </div>



        {alertMessage ? (

          <div className="mob-opp-alert" role="alert">

            <span aria-hidden>⚠</span>

            <span>{alertMessage}</span>

          </div>

        ) : null}

      </header>



      <div className="mob-opp-l2">

        <MobileSimRowBetaLiquidityBadges simRow={simRow} />



        <MobileEisRegulatoryPanel

          ticker={ticker}

          eisScore={eisRaw}

          manualEisByTicker={dashSnapshot?.manualEisByTicker}

          regSignedScore={regSignedScore}

          clinicalRecords={clinicalRecords}

          onOpenEis={() => onOpenDetail("eis")}

          onOpenRegulatory={() => onOpenDetail("regulatory")}

        />



        {onTradeBuy && onTradeSell ? (

          <OpportunityTradePanel

            ticker={ticker}

            priceUsd={tradePriceUsd}

            suggestedCapitalEur={tradeSuggestedCapitalEur}

            openCapitalEur={tradeOpenCapitalEur}

            hasPosition={hasPosition}

            busy={tradeBusy}

            err={tradeErr}

            onBuy={onTradeBuy}

            onSell={onTradeSell}

          />

        ) : null}



        <CurvesSection>

          <ChartBlock id={OPP_CHART_DOM_IDS.price} title={t("opportunity.section.priceVsMarket")}>

            <MobilePriceVariationChart ticker={ticker} windows={priceWindows} compact />

          </ChartBlock>




          {hasMii && charts?.marketModel ? (

            <ChartBlock id={OPP_CHART_DOM_IDS.mii} title={t("curve.marketModelTitle")}>

              <MobileMarketModelSlopesChart marketModel={charts.marketModel} width={OPP_CHART_W} height={OPP_CHART_H} />

            </ChartBlock>

          ) : (

            <ChartBlock id={OPP_CHART_DOM_IDS.mii} title={t("curve.marketModelTitle")}>

              <p className="hint">{t("opportunity.modelMissing")}</p>

            </ChartBlock>

          )}




        </CurvesSection>



        <AccordionSection

          title={t("opportunity.section.clinical")}

          open={clinicalOpen}

          onToggle={() => setClinicalOpen((v) => !v)}

        >

          {clinicalIndicators.length ? (

            <ul className="mob-opp-clinical-list">

              {clinicalIndicators.map((row, i) => (

                <li key={`${row.label}-${i}`} className="mob-opp-clinical-row">

                  <span className="mob-opp-clinical-label">{row.label}</span>

                  <span className="mob-opp-clinical-value">{row.value}</span>

                  {row.badge ? <span className={`mob-opp-kpi mob-opp-kpi-${row.badge.toLowerCase()}`}>{row.badge}</span> : null}

                </li>

              ))}

            </ul>

          ) : (

            <p className="hint">{t("opportunity.clinicalEmpty")}</p>

          )}

          {extraClinicalCount > 0 ? (

            <button type="button" className="mob-opp-clinical-more" onClick={() => onOpenDetail("eis")}>

              + {extraClinicalCount} {t("opportunity.clinicalMore")}

            </button>

          ) : null}

        </AccordionSection>

      </div>



      <footer className="mob-opp-footer">
        <button
          type="button"
          className="mob-opp-footer-eis"
          onClick={() => onOpenDetail("eis")}
        >
          <FooterIcon kind="eis" />
          <span>{t("opportunity.footer.eis")}</span>
        </button>
      </footer>

    </article>

  );

}


