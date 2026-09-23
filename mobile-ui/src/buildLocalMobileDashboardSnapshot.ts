/**
 * Build dashboard snapshot on-device from VPS API data (simulation sheet, charts,
 * clinical feed) — no desktop Home tab required.
 */
import type {
  MobileDashboardRecRow,
  MobileDashboardSnapshot,
} from "./dashboardTypes";
import type { ClinicalPreCdRecord } from "./api";
import { buildMobileAiFeedFromClinical } from "./mobileAiFeedBuild";
import { computeMobileGainIdea, formatMobileGainIdeaShort } from "./mobileCurvePeakOutlook";
import {
  buildLocalUpcoming,
  scopeRowsForListMode,
} from "./mobileDashboard";
import { buildLocalPortfolioCheckSnapshot } from "./mobilePortfolioTable";
import { daysFromCompletionDate } from "./opportunityLogic";
import type { ChartBundle, InvestSimInputs, SheetTable } from "./types";
import {
  computeSimulationPosition,
  currentPriceFromRow,
  normalizedRowKey,
  parseNum,
  parseRaScoreFromRow,
  pred5FromRow,
  rowHasActivePortfolio,
} from "./simLogic";
import { buildTickerEisDetail } from "./eis/tickerEisSummary";
import {
  buildMobileSoftRecommendations,
  mergeSoftRecommendations,
} from "./mobileSoftSignals";

type SuggestedKind = "buy" | "sell" | "hold" | "review";

function findCol(row: Record<string, unknown>, ...keywords: string[]): unknown {
  for (const kw of keywords) {
    const lo = kw.toLowerCase();
    const key = Object.keys(row).find((k) => k.toLowerCase().includes(lo));
    if (key) return row[key];
  }
  return undefined;
}

function planReturnFromRow(r: Record<string, unknown>): number | null {
  for (const kw of ["roi target", "target roi", "gain target", "roi plan", "roi→cd"]) {
    const raw = findCol(r, kw);
    const v = parseNum(raw);
    if (v != null) return Math.abs(v) <= 1.5 ? v * 100 : v;
  }
  const slope =
    parseNum(r["Slope 20d (%)"]) ??
    parseNum(r["Pendenza 20g (%)"]) ??
    parseNum(r["Slope 20d"]);
  if (slope != null && slope > 0) return slope;
  return null;
}

function probFromRow(r: Record<string, unknown>, pnlPct: number): number | null {
  const explicit = parseNum(findCol(r, "recovery", "p(rec", "prob rec", "p(plan"));
  if (explicit != null) {
    const v = explicit;
    return v <= 1.5 ? Math.round(v * 100) : Math.round(v);
  }
  const aff = parseRaScoreFromRow(r) ?? parseNum(findCol(r, "affidabilit"));
  if (aff == null) return null;
  if (pnlPct < -0.5) {
    const plan = planReturnFromRow(r);
    if (plan != null && plan > 0) {
      return Math.round(Math.min(95, Math.max(15, aff * 0.55 + Math.min(plan, 30))));
    }
    return Math.round(Math.max(10, aff * 0.72));
  }
  return Math.round(aff);
}

function actionLabel(kind: SuggestedKind, lang: "it" | "en"): string {
  const map: Record<SuggestedKind, { it: string; en: string }> = {
    buy: { it: "BUY", en: "BUY" },
    sell: { it: "SELL", en: "SELL" },
    hold: { it: "HOLD", en: "HOLD" },
    review: { it: "INCERTO", en: "UNCERTAIN" },
  };
  return lang === "it" ? map[kind].it : map[kind].en;
}

function reasonForAction(
  kind: SuggestedKind,
  lang: "it" | "en",
  ctx: { pnlPct?: number | null; pred5?: number | null; days?: number | null },
): string {
  const it = lang === "it";
  switch (kind) {
    case "buy":
      return it
        ? `Opportunità pre-CD${ctx.days != null ? ` (T−${ctx.days}g)` : ""}${ctx.pred5 != null ? ` · Pred+5 ${ctx.pred5 >= 0 ? "+" : ""}${ctx.pred5.toFixed(1)}%` : ""}`
        : `Pre-CD opportunity${ctx.days != null ? ` (T−${ctx.days}d)` : ""}${ctx.pred5 != null ? ` · Pred+5 ${ctx.pred5 >= 0 ? "+" : ""}${ctx.pred5.toFixed(1)}%` : ""}`;
    case "sell":
      return it
        ? `Take profit / uscita${ctx.pnlPct != null ? ` · P&L ${ctx.pnlPct >= 0 ? "+" : ""}${ctx.pnlPct.toFixed(1)}%` : ""}`
        : `Take profit / exit${ctx.pnlPct != null ? ` · P&L ${ctx.pnlPct >= 0 ? "+" : ""}${ctx.pnlPct.toFixed(1)}%` : ""}`;
    case "review":
      return it
        ? `Monitoraggio — recupero incerto${ctx.pnlPct != null ? ` (${ctx.pnlPct.toFixed(1)}%)` : ""}`
        : `Review — uncertain recovery${ctx.pnlPct != null ? ` (${ctx.pnlPct.toFixed(1)}%)` : ""}`;
    case "hold":
    default:
      return it ? "Mantieni posizione aperta" : "Hold open position";
  }
}

function readSheetSuggestedAction(row: Record<string, unknown>): SuggestedKind | null {
  const raw = row.suggestedAction ?? row["Suggested Action"] ?? findCol(row, "raccomand", "suggested");
  if (raw == null || raw === "" || raw === "—") return null;
  const s = String(raw).trim().toLowerCase();
  if (s === "buy" || s === "sell" || s === "hold" || s === "review") return s;
  if (s.includes("buy") || s.includes("compra")) return "buy";
  if (s.includes("sell") || s.includes("vendi")) return "sell";
  if (s.includes("review") || s.includes("rivedi")) return "review";
  if (s.includes("hold") || s.includes("mantien")) return "hold";
  return null;
}

function inferSuggestedAction(
  row: Record<string, unknown>,
  inputs: InvestSimInputs,
): SuggestedKind | null {
  const fromSheet = readSheetSuggestedAction(row);
  if (fromSheet) return fromSheet;

  const inPortfolio = rowHasActivePortfolio(row, inputs);
  const pos = computeSimulationPosition(row, inputs);
  const days = daysFromCompletionDate(String(row["Completion Date"] ?? ""));
  const pred5 = pred5FromRow(row);
  const affid = parseRaScoreFromRow(row) ?? parseNum(findCol(row, "affidabilit"));

  if (inPortfolio && pos && pos.capital > 0) {
    if (pos.pnlPct <= -10) return "review";
    if (pos.pnlPct >= 18) return "sell";
    if (Math.abs(pos.pnlPct) > 0.5) return "hold";
    return "hold";
  }

  if (!inPortfolio && days != null && days >= 0 && days <= 60) {
    if ((pred5 ?? 0) >= 0.8 && (affid ?? 0) >= 35) return "buy";
  }
  if (!inPortfolio && days != null && days >= 0 && days <= 120) {
    if ((pred5 ?? 0) >= 1.2 && (affid ?? 0) >= 40) return "buy";
  }
  return null;
}

function isPendingAction(kind: SuggestedKind, inPortfolio: boolean): boolean {
  if (kind === "buy") return !inPortfolio;
  if (kind === "sell" || kind === "hold" || kind === "review") return inPortfolio;
  return false;
}

function nextCdDays(rows: Record<string, unknown>[]): number | null {
  return rows.reduce<number | null>((best, r) => {
    const days = daysFromCompletionDate(String(r["Completion Date"] ?? ""));
    if (days == null || days < 0) return best;
    return best == null || days < best ? days : best;
  }, null);
}

function clinicalKpiFromRow(row: Record<string, unknown>): number | null {
  return parseNum(row["Clinical KPI"]);
}

function buildRecommendations(
  sheet: SheetTable,
  inputs: InvestSimInputs,
  clinicalRecords: ClinicalPreCdRecord[],
  lang: "it" | "en",
): MobileDashboardRecRow[] {
  const out: MobileDashboardRecRow[] = [];
  for (const row of sheet.rows ?? []) {
    const ticker = String(row.Ticker ?? "")
      .trim()
      .toUpperCase();
    if (!ticker || ticker.includes("TOTALE")) continue;

    const key = normalizedRowKey(ticker, row["Completion Date"]);
    const inPortfolio = rowHasActivePortfolio(row, inputs);
    const kind = inferSuggestedAction(row, inputs);
    if (!kind || !isPendingAction(kind, inPortfolio)) continue;

    const pos = computeSimulationPosition(row, inputs);
    const days = daysFromCompletionDate(String(row["Completion Date"] ?? ""));
    const pred5 = pred5FromRow(row);
    const planReturnPct = planReturnFromRow(row);
    const probPct = probFromRow(row, pos?.pnlPct ?? 0);
    const clinicalKpi = clinicalKpiFromRow(row);
    const eisDetail = buildTickerEisDetail(ticker, clinicalRecords, lang, clinicalKpi);
    const gainIdea = computeMobileGainIdea({
      row,
      capitalEur: pos?.capital && pos.capital > 0 ? pos.capital : undefined,
      planReturnPct,
      daysToTarget: days,
    });

    out.push({
      key,
      ticker,
      action: actionLabel(kind, lang),
      probPct,
      reason: reasonForAction(kind, lang, {
        pnlPct: pos?.pnlPct ?? null,
        pred5,
        days,
      }),
      readingPct: parseNum(row["Var. Giorn. %"]) ?? parseNum(row["Var. Giorn.%"]),
      planReturnPct,
      profile: inPortfolio ? "portfolio" : "opportunity",
      daysToCd: days,
      companyName:
        String(row.Nome ?? row.Company ?? row.Società ?? row["Company Name"] ?? "").trim() ||
        null,
      currPriceUsd: currentPriceFromRow(row),
      scorePct: probPct,
      eisScore: eisDetail.score,
      eisHint: eisDetail.breakdownHint || null,
      daysToTarget: days,
      gainIdeaText: formatMobileGainIdeaShort(gainIdea, lang),
    });
  }

  const rank = (a: MobileDashboardRecRow) => {
    const act = a.action.toUpperCase();
    if (act === "SELL") return 0;
    if (act === "REVIEW") return 1;
    if (act === "BUY") return 2;
    return 3;
  };

  return out.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    const sa = a.scorePct ?? -1;
    const sb = b.scorePct ?? -1;
    if (sb !== sa) return sb - sa;
    return a.ticker.localeCompare(b.ticker);
  });
}

export function buildLocalMobileDashboardSnapshot(opts: {
  sheet: SheetTable;
  inputs: InvestSimInputs;
  chartBundle?: ChartBundle | null;
  clinicalRecords?: ClinicalPreCdRecord[];
  lang?: "it" | "en";
}): MobileDashboardSnapshot {
  const lang = opts.lang ?? "it";
  const portfolioRows = scopeRowsForListMode(opts.sheet, opts.inputs, "portfolio");
  const opportunityRows = scopeRowsForListMode(opts.sheet, opts.inputs, "topOpps");
  const recommendations = buildRecommendations(opts.sheet, opts.inputs, opts.clinicalRecords ?? [], lang);
  const portfolioCheck = buildLocalPortfolioCheckSnapshot(opts.sheet, opts.inputs, recommendations);
  const { feed, recentCount } = buildMobileAiFeedFromClinical(
    opts.clinicalRecords ?? [],
    opts.sheet,
    opts.inputs,
  );

  let totalCapital = 0;
  for (const r of portfolioRows) {
    const key = normalizedRowKey(String(r.Ticker ?? ""), r["Completion Date"]);
    const cap = opts.inputs[key]?.capital ?? parseNum(r["Capitale Investito ($)"]) ?? 0;
    if (cap > 0) totalCapital += cap;
  }

  return {
    version: 1,
    updated_at: new Date().toISOString(),
    source: "local",
    hero: {
      portfolioCount: portfolioRows.length,
      opportunityCount: opportunityRows.length,
      totalCapital: Math.round(totalCapital),
      nextCdDaysPortfolio: nextCdDays(portfolioRows),
      nextCdDaysOpportunities: nextCdDays(opportunityRows),
      aiFeedRecentCount: recentCount,
    },
    recommendations,
    portfolioCheck,
    upcoming: {
      portfolio: buildLocalUpcoming(portfolioRows),
      topOpps: buildLocalUpcoming(opportunityRows),
    },
    aiFeed: feed,
  };
}

function actionLabelFromRec(
  rec: "buy" | "sell" | "hold" | "review",
  lang: "it" | "en",
): string {
  return actionLabel(rec, lang);
}

/** When Actions list is empty, surface Soft BUY/SELL from Decision chart views. */
function recommendationsFromDecisionViews(
  snap: MobileDashboardSnapshot,
  lang: "it" | "en",
): MobileDashboardRecRow[] {
  const views = snap.decisionChartViews;
  if (!views) return [];
  const seen = new Set<string>();
  const out: MobileDashboardRecRow[] = [];
  for (const list of [views.oppHot, views.oppWatch, views.portfolio]) {
    for (const row of list) {
      if (seen.has(row.key)) continue;
      if (row.rec !== "buy" && row.rec !== "sell") continue;
      // BUY only for opportunities; SELL only for open book.
      if (row.rec === "buy" && row.hasPortfolio) continue;
      if (row.rec === "sell" && !row.hasPortfolio) continue;
      seen.add(row.key);
      out.push({
        key: row.key,
        ticker: row.ticker,
        action: actionLabelFromRec(row.rec, lang),
        probPct: row.scores.pplan,
        reason: row.diagnostic || null,
        readingPct: row.pnlPct24h ?? null,
        planReturnPct: null,
        profile: row.hasPortfolio ? "portfolio" : "opportunity",
        daysToCd: null,
        companyName: row.company,
        scorePct: row.scores.pplan,
        isNew: false,
      });
    }
  }
  return out;
}

/**
 * Prefer server snapshot when published.
 * Never invent Soft BUY/SELL locally when a desktop/VPS snapshot exists —
 * that caused false Soft SELL chips (CERS/CHRS/VIR) vs Home "None now".
 * Soft lists come from `softBuys`/`softSells` (Home Recommendations arbiter)
 * or from recommendation actions already published by desktop.
 */
export function resolveMobileDashboardSnapshot(opts: {
  server: MobileDashboardSnapshot | null | undefined;
  sheet: SheetTable;
  inputs: InvestSimInputs;
  chartBundle?: ChartBundle | null;
  clinicalRecords?: ClinicalPreCdRecord[];
  lang?: "it" | "en";
  sdsByTicker?: Map<string, number> | null;
}): MobileDashboardSnapshot {
  const lang = opts.lang ?? "it";

  if (opts.server?.updated_at) {
    const server = opts.server;
    let recommendations = server.recommendations ?? [];
    if (recommendations.length === 0) {
      recommendations = recommendationsFromDecisionViews(server, lang);
    }
    // Refresh portfolio hero from live shared book (not a stale desktop publish).
    const local = buildLocalMobileDashboardSnapshot({
      sheet: opts.sheet,
      inputs: opts.inputs,
      chartBundle: opts.chartBundle,
      clinicalRecords: opts.clinicalRecords,
      lang,
    });
    const localHero = local.hero!;
    return {
      ...server,
      recommendations,
      hero: {
        portfolioCount: localHero.portfolioCount,
        opportunityCount: localHero.opportunityCount,
        totalCapital: localHero.totalCapital,
        nextCdDaysPortfolio: localHero.nextCdDaysPortfolio,
        nextCdDaysOpportunities: localHero.nextCdDaysOpportunities,
        aiFeedRecentCount:
          server.hero?.aiFeedRecentCount ?? localHero.aiFeedRecentCount,
      },
      source: server.source ?? "server",
    };
  }

  // Offline / no snapshot — local Soft Soft fallback only.
  const softRecs = buildMobileSoftRecommendations({
    sheet: opts.sheet,
    inputs: opts.inputs,
    lang,
    sdsByTicker: opts.sdsByTicker,
  });
  const local = buildLocalMobileDashboardSnapshot(opts);
  return {
    ...local,
    recommendations: mergeSoftRecommendations(local.recommendations, softRecs),
  };
}
