/** Portfolio mark-to-market: maialini 👑🐷 / 🐔 peggiore (stesso tier del Piggy Bank). */



import { dealRankVisual, dealRankVisualFromGainPct } from "../sheet/dealRankIcon";

import {

  portfolioPnlTone,

  resolvePortfolioDisplayTone,

} from "../sheet/portfolioGainLossStyle";

import { RankAnimalIcon } from "./DealRankBadge";

import { getLang } from "../shared/i18n";



export type PortfolioPnlTrend = "up" | "down" | "flat" | "unknown";



export function portfolioPnlTrend(

  pnlPct: number | null | undefined,

  pnlUnavailable?: boolean,

  pnlEur?: number | null,

  pnlEur24h?: number | null,

  pnlPct24h?: number | null,

): PortfolioPnlTrend {

  if (pnlUnavailable) return "unknown";

  const tone = resolvePortfolioDisplayTone(pnlEur, pnlPct, pnlEur24h, pnlPct24h);

  if (tone === "gain") return "up";

  if (tone === "loss") return "down";

  if (pnlPct != null && Number.isFinite(pnlPct)) return "flat";

  if (pnlEur != null && Number.isFinite(pnlEur)) return "flat";

  return "unknown";

}



/** % usato per il tier maialino (totale, o 24h se il totale è pari). */

function portfolioGainPctForIcon(

  pnlPct: number | null | undefined,

  pnlEur: number | null | undefined,

  pnlPct24h: number | null | undefined,

): number {

  const totalTone = portfolioPnlTone(pnlEur, pnlPct);

  if (totalTone !== "flat" && pnlPct != null && Number.isFinite(pnlPct)) {

    return pnlPct;

  }

  if (pnlPct24h != null && Number.isFinite(pnlPct24h)) return pnlPct24h;

  if (pnlPct != null && Number.isFinite(pnlPct)) return pnlPct;

  return 0;

}



export function PortfolioPnlTrendIcon({

  pnlPct,

  pnlEur,

  pnlEur24h,

  pnlPct24h,

  pnlUnavailable,

  size = "md",

  className = "",

}: {

  pnlPct?: number | null;

  pnlEur?: number | null;

  pnlEur24h?: number | null;

  pnlPct24h?: number | null;

  pnlUnavailable?: boolean;

  size?: "sm" | "md";

  className?: string;

}) {

  const lang = getLang();

  const trend = portfolioPnlTrend(

    pnlPct,

    pnlUnavailable,

    pnlEur,

    pnlEur24h,

    pnlPct24h,

  );

  if (trend === "unknown") return null;



  const basePx = size === "sm" ? 14 : 17;

  const gainPct = portfolioGainPctForIcon(pnlPct, pnlEur, pnlPct24h);

  const visual =

    trend === "flat"

      ? dealRankVisual(1, 4)

      : dealRankVisualFromGainPct(gainPct);

  const title = lang === "it" ? visual.titleIt : visual.titleEn;



  return (

    <span

      className={`inline-flex items-end shrink-0 leading-none ${className}`}

      title={title}

      aria-label={title}

      role="img"

    >

      <RankAnimalIcon visual={visual} basePx={basePx} />

    </span>

  );

}



export function PortfolioTrendLegend({

  className = "",

  it = false,

}: {

  className?: string;

  it?: boolean;

}) {

  return (

    <p className={`text-[10px] text-ink-muted flex flex-wrap items-center gap-x-3 gap-y-0.5 ${className}`}>

      <span className="inline-flex items-center gap-1">

        <span className="portfolio-legend-swatch portfolio-legend-swatch-gain" aria-hidden />

        <RankAnimalIcon visual={dealRankVisualFromGainPct(14)} basePx={13} />

        <span>{it ? "Gain" : "Gaining"}</span>

      </span>

      <span className="inline-flex items-center gap-1">

        <span className="portfolio-legend-swatch portfolio-legend-swatch-loss" aria-hidden />

        <RankAnimalIcon visual={dealRankVisualFromGainPct(-6)} basePx={13} />

        <span>{it ? "Loss" : "Losing"}</span>

      </span>

      <span className="inline-flex items-center gap-1">

        <span className="portfolio-legend-swatch portfolio-legend-swatch-flat" aria-hidden />

        <RankAnimalIcon visual={dealRankVisual(1, 4)} basePx={12} />

        <span>{it ? "Pari (≈0)" : "Flat (~0)"}</span>

      </span>

    </p>

  );

}


