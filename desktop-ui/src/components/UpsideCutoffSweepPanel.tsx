/**
 * Home — Soft BUY/SELL suggestions + prior-day bought/sold in one panel
 * so you can judge signals against what the book just did.
 */
import { useMemo } from "react";
import type { SheetTable, ChartBundle } from "../types";
import type { SdsRow } from "../api/supernova";
import type { InvestSimInputs, InvestSimHistoryPoint } from "../sheet/investSimStorage";
import { buildMigSolidityByKey } from "../sheet/entrySolidityMig";
import { buildLossAnalysisItems } from "../sheet/portfolioLossAnalysis";
import {
  buildUpsideCutoffLiveSummary,
  type UpsideCutoffLiveSummary,
} from "../sheet/upsideCutoffLive";
import { chartPointsMapFromBundle } from "../data/simulationCharts";
import { normalizedRowKey } from "../sheet/investSimKeys";
import { useLang } from "../shared/i18n";
import {
  buildOperationalRecResult,
  type OperationalBuyNearMiss,
  type OperationalBuyNearMissFail,
  type OperationalRecResult,
  type OperationalSellTag,
} from "../sheet/operationalRecommendation";
import type { LossRiskCatalog } from "../hooks/useLossRiskCatalog";
import type { LossRiskEntry } from "./LossRiskPoopCell";
import { SOFT_BUY_RISING_DAYS_MIN } from "../sheet/softBuyRisingStreak";
import {
  SOFT_BUY_G1_PPLAN_MIN,
  SOFT_BUY_G1_SDS_MIN,
  SOFT_SELL_G1_DEEP_PNL_PCT,
  SOFT_SELL_G1_MIN_HOLD_SESSIONS,
  SOFT_SELL_G1_PNL_PCT,
  URGENT_SELL_G2_MAX_LOSS_OF_WINS,
} from "../sheet/softSignalGrades";
import { P_CONT_SELL_MIN_G10, SOFT_BUY_MIN_PCONT } from "../sheet/continuationScore";
import {
  softBuyGateChipClass,
  type SoftBuyGateStrength,
} from "../sheet/softBuyGateStrength";
import { SoftBuyGateStrengthMarks } from "./SoftBuyGateStrengthMarks";
import {
  buildPriorDayBookActivity,
  priorDayActivityHasRows,
  type PriorDayBookActivityItem,
} from "../sheet/priorDayBookActivity";
import { portfolioPnlAccentClass } from "../sheet/portfolioGainLossStyle";
import { formatBuyMinPriceUsd } from "../sheet/earlyPeakBuyMinTarget";

export type CutoffTopKpiFocus = {
  ticker: string;
  cd?: string;
  rowKey?: string;
};

function fmtEur(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}€${Math.round(n).toLocaleString("en-US")}`;
}

function fmtCapital(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `€${Math.round(n).toLocaleString("en-US")}`;
}

function sellTagLabel(tag: OperationalSellTag): string {
  if (tag === "G2") return "G2";
  if (tag === "giveback") return "gb";
  if (tag === "soft_g1") return "G1";
  if (tag === "cont_exh") return "exh";
  return "hard";
}

function buyNearMissFailLabel(fail: OperationalBuyNearMissFail, it: boolean): string {
  switch (fail) {
    case "top2_no":
      return "Top2 NO";
    case "rising_streak":
      return it ? "↑<2d" : "↑<2d";
    case "precat_sell":
      return it ? "precat sell" : "precat sell";
    case "tape":
      return "tape";
    case "cooldown":
      return "cooldown";
    case "pcont":
      return it ? "P(cont)/edge" : "P(cont)/edge";
    default:
      return it ? "gate" : "gate";
  }
}

function cdFromRowKey(rowKey: string | undefined): string | undefined {
  if (!rowKey?.includes("|")) return undefined;
  const cd = rowKey.split("|").slice(1).join("|").trim();
  return cd && cd !== "—" ? cd : undefined;
}

function fmtBookPnl(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}€${Math.round(n).toLocaleString("en-US")}`;
}

function BookFlowRow({
  item,
  investedLabel,
  onOpen,
}: {
  item: PriorDayBookActivityItem;
  investedLabel: string;
  onOpen?: (focus: CutoffTopKpiFocus) => void;
}) {
  const body = (
    <>
      <span className="font-semibold tabular-nums">{item.ticker}</span>
      <span className="text-ink-muted tabular-nums">
        {investedLabel} {fmtCapital(item.capitalEur)}
        {item.pnlEur != null ? (
          <span className={`ml-1 font-semibold${portfolioPnlAccentClass(item.pnlEur)}`}>
            ({fmtBookPnl(item.pnlEur)})
          </span>
        ) : null}
      </span>
    </>
  );
  if (!onOpen) {
    return <li className="flex items-baseline justify-between gap-2 text-[11px]">{body}</li>;
  }
  return (
    <li>
      <button
        type="button"
        className="flex w-full items-baseline justify-between gap-2 text-[11px] text-left hover:underline underline-offset-2"
        onClick={() =>
          onOpen({
            ticker: item.ticker,
            rowKey: item.key,
            cd: cdFromRowKey(item.key),
          })
        }
        title={`${item.ticker} → Top KPI`}
      >
        {body}
      </button>
    </li>
  );
}

function TickerJumpChip({
  ticker,
  rowKey,
  suffix,
  onOpen,
  title,
  tone = "buy",
  capitalEur = null,
  pnlEur = null,
  investedLabel = "invested",
  gateStrength = null,
}: {
  ticker: string;
  rowKey?: string;
  suffix?: string;
  onOpen?: (focus: CutoffTopKpiFocus) => void;
  title: string;
  tone?: "buy" | "sell";
  capitalEur?: number | null;
  pnlEur?: number | null;
  investedLabel?: string;
  gateStrength?: SoftBuyGateStrength | null;
}) {
  const base =
    tone === "sell"
      ? "inline-flex items-center gap-1 rounded-md bg-rose-500/15 px-2 py-0.5 text-[11px] font-semibold text-rose-800 dark:text-rose-300 tabular-nums"
      : gateStrength
        ? softBuyGateChipClass(gateStrength.tier, Boolean(onOpen))
        : "inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 tabular-nums";
  const showMoney = tone === "sell" && (capitalEur != null || pnlEur != null);
  const tip = title;
  const body = (
    <>
      {tone === "buy" && gateStrength ? (
        <SoftBuyGateStrengthMarks strength={gateStrength} dense />
      ) : null}
      <span>
        {ticker}
        {suffix ? (
          <span className="ml-0.5 opacity-80 font-medium">({suffix})</span>
        ) : null}
      </span>
      {showMoney ? (
        <span className="font-medium opacity-90">
          {investedLabel} {fmtCapital(capitalEur)}
          {pnlEur != null ? (
            <span className={`ml-1${portfolioPnlAccentClass(pnlEur)}`}>
              ({fmtEur(pnlEur)})
            </span>
          ) : null}
        </span>
      ) : null}
    </>
  );
  if (!onOpen) {
    return (
      <span className={base} title={tip}>
        {body}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={
        tone === "buy" && gateStrength
          ? base
          : `${base} hover:brightness-95 transition`
      }
      title={tip}
      onClick={() =>
        onOpen({
          ticker,
          rowKey,
          cd: cdFromRowKey(rowKey),
        })
      }
    >
      {body}
    </button>
  );
}

function MetricCard({
  label,
  value,
  highlight,
  tone = "muted",
}: {
  label: string;
  value: string;
  highlight?: boolean;
  tone?: "up" | "warn" | "muted";
}) {
  const valueCls =
    tone === "up"
      ? "text-emerald-700 dark:text-emerald-300"
      : tone === "warn"
        ? "text-rose-700 dark:text-rose-300"
        : "text-ink";
  return (
    <div
      className={`min-w-[7.5rem] flex-1 rounded-lg border px-2.5 py-2 ${
        highlight
          ? "border-emerald-500/35 bg-emerald-500/8"
          : "border-[rgb(var(--border))]/50 bg-white/80 dark:bg-[rgb(var(--surface-2))]/40"
      }`}
    >
      <p className={`text-xl font-bold tabular-nums leading-none ${valueCls}`}>{value}</p>
      <p className="text-[10px] text-ink-muted mt-1 leading-snug">{label}</p>
    </div>
  );
}

const G2_PCT = Math.round(URGENT_SELL_G2_MAX_LOSS_OF_WINS * 100);

export function UpsideCutoffSweepPanel({
  simTable,
  inputs,
  sdsRows = [],
  chartBundle = null,
  history = [],
  lossRiskCatalog = null,
  catalogByRowKey = null,
  operationalRec = null,
  priorSessionPctByTicker = null,
  onOpenSimulation,
  onOpenEvaluationTopKpi,
}: {
  simTable: SheetTable | null;
  inputs: InvestSimInputs;
  sdsRows?: SdsRow[];
  chartBundle?: ChartBundle | null;
  history?: InvestSimHistoryPoint[];
  lossRiskCatalog?: LossRiskCatalog | null;
  catalogByRowKey?: Map<string, LossRiskEntry> | null;
  operationalRec?: OperationalRecResult | null;
  priorSessionPctByTicker?: Map<string, number> | null;
  onOpenSimulation?: (focus?: {
    ticker?: string;
    action?: "buy" | "sell";
    cd?: string;
  }) => void;
  onOpenEvaluationTopKpi?: (focus: CutoffTopKpiFocus) => void;
}) {
  const { lang } = useLang();
  const it = lang === "it";
  const investedLabel = it ? "investito" : "invested";

  const bookFlow = useMemo(
    () =>
      buildPriorDayBookActivity(
        inputs,
        undefined,
        history,
        simTable?.rows ?? null,
      ),
    [inputs, history, simTable],
  );
  const showBookFlow = priorDayActivityHasRows(bookFlow);

  const summary: UpsideCutoffLiveSummary | null = useMemo(() => {
    if (!simTable?.rows?.length) return null;
    const charts = chartBundle ?? ({ series: {} } as ChartBundle);
    const pointsBySeriesKey = chartPointsMapFromBundle(charts);
    const migSolidityByKey = buildMigSolidityByKey(simTable, charts, sdsRows);
    const oppItems = buildLossAnalysisItems(
      "opportunities",
      simTable,
      inputs,
      pointsBySeriesKey,
      it ? "it" : "en",
      null,
      { migSolidityByKey, sdsRows },
      "all",
    );
    const scores = new Map(
      oppItems.map((item) => [
        item.key,
        {
          key: item.key,
          sds: item.sdsScore ?? null,
          pplan: item.recoveryProbabilityPct ?? null,
        },
      ]),
    );
    for (const r of simTable.rows) {
      const ticker = String(r.Ticker ?? "").trim().toUpperCase();
      if (!ticker) continue;
      const key = normalizedRowKey(ticker, r["Completion Date"]);
      const sds = sdsRows.find((s) => s.ticker?.toUpperCase() === ticker)?.sds;
      if (sds == null) continue;
      const sc = scores.get(key);
      if (sc && sc.sds == null) scores.set(key, { ...sc, sds });
      else if (!sc) scores.set(key, { key, sds, pplan: null });
    }
    return buildUpsideCutoffLiveSummary(
      simTable,
      inputs,
      scores,
      pointsBySeriesKey,
      priorSessionPctByTicker,
    );
  }, [simTable, inputs, sdsRows, chartBundle, priorSessionPctByTicker, it]);

  const ops = useMemo((): Pick<
    OperationalRecResult,
    "buys" | "sells" | "buyNearMisses" | "gateStrengthByKey"
  > => {
    if (operationalRec) {
      return {
        buys: operationalRec.buys,
        sells: operationalRec.sells,
        buyNearMisses: operationalRec.buyNearMisses,
        gateStrengthByKey: operationalRec.gateStrengthByKey,
      };
    }
    if (!simTable?.rows?.length) {
      return {
        buys: [],
        sells: [],
        buyNearMisses: [],
        gateStrengthByKey: new Map(),
      };
    }
    return buildOperationalRecResult({
      simTable,
      inputs,
      chartBundle,
      history,
      lang: it ? "it" : "en",
      sdsRows,
      lossRiskCatalog,
      catalogByRowKey,
      priorSessionPctByTicker,
    });
  }, [
    operationalRec,
    simTable,
    inputs,
    chartBundle,
    history,
    lossRiskCatalog,
    catalogByRowKey,
    priorSessionPctByTicker,
    it,
  ]);

  if (!summary) return null;

  const rule = summary.bestSignificant ?? summary.growthStreak;
  const pfCapt = summary.pfCapturePct;
  const suggestedBuys = ops.buys;
  const buyKeySet = new Set(suggestedBuys.map((b) => b.key));
  let buyWinEur = 0;
  let buyLossEur = 0;
  let buyNWin = 0;
  let buyNLoss = 0;
  let buySelectedUpside = 0;
  for (const r of summary.whatIf.rows) {
    if (!buyKeySet.has(r.key) || r.inPortfolio) continue;
    const pnl = r.pnlEur;
    if (pnl == null || !Number.isFinite(pnl)) continue;
    if (pnl > 0) {
      buyWinEur += pnl;
      buySelectedUpside += pnl;
      buyNWin += 1;
    } else if (pnl < 0) {
      buyLossEur += pnl;
      buyNLoss += 1;
    }
  }
  buyWinEur = Math.round(buyWinEur);
  buyLossEur = Math.round(buyLossEur);
  const buyNetEur = buyWinEur + buyLossEur;
  const buyCaptureWithPf =
    summary.universeUpsideEur > 0
      ? Math.round(
          (((summary.pfUpsideEur + buySelectedUpside) / summary.universeUpsideEur) * 1000),
        ) / 10
      : null;
  const withPf = buyCaptureWithPf ?? rule.captureWithPfPct;
  const riseDays = SOFT_BUY_RISING_DAYS_MIN;
  const nBuy = suggestedBuys.length;
  const nSell = ops.sells.length;

  const buyChecklist = it
    ? [
        `Soft BUY G1: SDS ≥ ${SOFT_BUY_G1_SDS_MIN} · P(plan) ≥ ${SOFT_BUY_G1_PPLAN_MIN}`,
        `G1w vento: 10d % ≥ +${P_CONT_SELL_MIN_G10}% · P(cont) ≥ ${SOFT_BUY_MIN_PCONT}% · edge ≤ 0 · giorno ≥ 0 → Suggested BUY`,
        "High Vol: VOL vs prev ≥150% + T_double ≤30 min (RVOL 5m confermato) → Soft BUY High Vol + ricerca EIS",
        `Top2 ≠ NO · ↑≥${riseDays}d · cooldown: alzano la priorità (non bloccano se G1w)`,
        "Ancora hard: warrant · precat sell · tape crash",
        "Tu entri — nessun auto-buy sul libro reale",
      ]
    : [
        `Soft BUY G1: SDS ≥ ${SOFT_BUY_G1_SDS_MIN} · P(plan) ≥ ${SOFT_BUY_G1_PPLAN_MIN}`,
        `G1w wind: 10d % ≥ +${P_CONT_SELL_MIN_G10}% · P(cont) ≥ ${SOFT_BUY_MIN_PCONT}% · edge ≤ 0 · day ≥ 0 → Suggested BUY`,
        "High Vol: VOL vs prev ≥150% + T_double ≤30 min (confirmed 5m RVOL) → Soft BUY High Vol + EIS search",
        `Top2 ≠ NO · rising ≥${riseDays}d · cooldown: raise priority (do not block if G1w)`,
        "Still hard: warrants · precat sell · crash tape",
        "You enter — no auto-buy on the real book",
      ];

  const sellChecklist = it
    ? [
        `Urgent G2 (auto): perdite day book > ${G2_PCT}% di (acquistato + guadagnato)`,
        `Soft G1: MTM ≤ ${SOFT_SELL_G1_PNL_PCT}% + rischio/piano o segnale 10d % · hold ≥${SOFT_SELL_G1_MIN_HOLD_SESSIONS} sessioni · deep ≤ ${SOFT_SELL_G1_DEEP_PNL_PCT}% immediato`,
        `Continuation take-profit: MTM > 0 · 10d % ≥ +${P_CONT_SELL_MIN_G10}% · edge > 0`,
        "Ordine: G2 → G1 → cont_exh → hard · mai SELL su verde salvo continuation",
      ]
    : [
        `Urgent G2 (auto): book day losses > ${G2_PCT}% of (purchased + gains)`,
        `Soft G1: MTM ≤ ${SOFT_SELL_G1_PNL_PCT}% + risk/plan or 10d % signal · hold ≥${SOFT_SELL_G1_MIN_HOLD_SESSIONS} sessions · deep ≤ ${SOFT_SELL_G1_DEEP_PNL_PCT}% immediate`,
        `Continuation take-profit: MTM > 0 · 10d % ≥ +${P_CONT_SELL_MIN_G10}% · edge > 0`,
        "Order: G2 → G1 → cont_exh → hard · never SELL on green except continuation",
      ];

  return (
    <section
      className="shrink-0 rounded-xl border-2 border-[rgb(var(--accent))]/40 bg-[rgb(var(--surface))] px-3 py-3 shadow-sm"
      aria-label={it ? "Raccomandazioni BUY e SELL" : "BUY and SELL recommendations"}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wide text-[rgb(var(--accent))]">
            {it ? "Segnali & book" : "Signals & book"}
          </p>
          <h3 className="text-sm font-bold text-ink tracking-tight mt-0.5">
            {it
              ? "Soft BUY/SELL · acquistati e venduti (ieri)"
              : "Soft BUY/SELL · bought & sold (prior day)"}
          </h3>
          <p className="text-[10px] text-ink-muted leading-snug mt-0.5">
            {it
              ? `Suggerimenti a sinistra/destra · sotto cosa hai già fatto · what-if $${summary.capitalPerTicker.toLocaleString("en-US")} solo contesto`
              : `Suggestions left/right · below what the book already did · what-if $${summary.capitalPerTicker.toLocaleString("en-US")} context only`}
          </p>
        </div>
        {onOpenSimulation ? (
          <button
            type="button"
            className="text-[10px] font-semibold text-[rgb(var(--accent))] hover:underline"
            onClick={() => onOpenSimulation()}
          >
            {it ? "Apri Simulation →" : "Open Simulation →"}
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <MetricCard
          label={it ? "Catturato oggi (portafoglio)" : "Captured today (portfolio)"}
          value={pfCapt != null ? `${pfCapt.toFixed(1)}%` : "—"}
          tone={pfCapt != null && pfCapt < 25 ? "warn" : "muted"}
        />
        <MetricCard
          label={it ? "Catturato se prendi i Soft BUY" : "Captured if you take Soft BUYs"}
          value={withPf != null ? `${withPf.toFixed(1)}%` : "—"}
          highlight
          tone="up"
        />
        <MetricCard
          label={it ? "Soft BUY · win / loss (what-if)" : "Soft BUY · win / loss (what-if)"}
          value={`${buyNWin} / ${buyNLoss}`}
          tone={buyNLoss === 0 && buyNWin > 0 ? "up" : buyNLoss > buyNWin ? "warn" : "muted"}
        />
        <MetricCard
          label={it ? "Netto what-if Soft BUY" : "Soft BUY what-if net"}
          value={fmtEur(buyNetEur)}
          tone={buyNetEur >= 0 ? "up" : "warn"}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
        {/* BUY column: suggestions + what you bought */}
        <div className="rounded-lg border border-emerald-500/30 bg-gradient-to-b from-emerald-500/[0.07] to-transparent px-2.5 py-2 flex flex-col gap-2 min-h-[7.5rem]">
          <div>
            <p className="text-[10px] font-semibold text-emerald-800 dark:text-emerald-300">
              {it
                ? `BUY consigliati — decidi tu${nBuy ? ` (${nBuy})` : ""}`
                : `Suggested BUY — you decide${nBuy ? ` (${nBuy})` : ""}`}
            </p>
            <p className="text-[9px] text-ink-muted mt-0.5 leading-snug">
              {it
                ? "Soft BUY · tacchette = gate · shade = forza · click → Top KPI"
                : "Soft BUY · ticks = gates · shade = strength · click → Top KPI"}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {suggestedBuys.length ? (
                suggestedBuys.map((b) => {
                  const minLabel =
                    b.isEarlyPeak && b.buyAtMinTargetUsd != null
                      ? formatBuyMinPriceUsd(b.buyAtMinTargetUsd)
                      : null;
                  const highVolLabel = b.isHighVol
                    ? b.volDoublingMinutes != null && Number.isFinite(b.volDoublingMinutes)
                      ? `High Vol ×2/${Math.round(b.volDoublingMinutes)}m`
                      : "High Vol"
                    : null;
                  return (
                  <TickerJumpChip
                    key={b.key}
                    ticker={b.ticker}
                    rowKey={b.key}
                    tone="buy"
                    gateStrength={b.gateStrength ?? null}
                    suffix={highVolLabel ?? (minLabel ? `@ ${minLabel} min` : undefined)}
                    onOpen={onOpenEvaluationTopKpi}
                    title={
                      it
                        ? `${b.ticker} → Evaluation · Top KPI${
                            highVolLabel ? `\nSoft BUY High Vol · ${highVolLabel}` : ""
                          }${
                            b.isEarlyPeak && minLabel
                              ? `\nPicco nascente · BUY al min 7g: ${minLabel}`
                              : ""
                          }${
                            b.gateStrength ? `\n${b.gateStrength.summaryIt}` : ""
                          }${
                            b.suggestedCapitalEur != null
                              ? `\nSize €${b.suggestedCapitalEur.toLocaleString("en-US")} (${b.gateStrength?.tier ?? "—"})`
                              : ""
                          }`
                        : `${b.ticker} → Evaluation · Top KPI${
                            highVolLabel ? `\nSoft BUY High Vol · ${highVolLabel}` : ""
                          }${
                            b.isEarlyPeak && minLabel
                              ? `\nEarly peak · BUY at 7d min: ${minLabel}`
                              : ""
                          }${
                            b.gateStrength ? `\n${b.gateStrength.summaryEn}` : ""
                          }${
                            b.suggestedCapitalEur != null
                              ? `\nSize €${b.suggestedCapitalEur.toLocaleString("en-US")} (${b.gateStrength?.tier ?? "—"})`
                              : ""
                          }`
                    }
                  />
                  );
                })
              ) : (
                <div className="w-full space-y-1">
                  <span className="text-[10px] text-ink-muted">
                    {it ? "Nessuno ora" : "None now"}
                  </span>
                  {ops.buyNearMisses.length > 0 ? (
                    <p className="text-[9px] text-ink-muted leading-snug">
                      {it ? "Vicini (SDS/P ok, bloccati): " : "Near-miss (SDS/P ok, blocked): "}
                      {ops.buyNearMisses.slice(0, 6).map((m: OperationalBuyNearMiss, i) => (
                        <span key={m.key}>
                          {i > 0 ? " · " : ""}
                          <button
                            type="button"
                            className="font-semibold text-ink/80 hover:underline underline-offset-2"
                            onClick={() =>
                              onOpenEvaluationTopKpi?.({
                                ticker: m.ticker,
                                rowKey: m.key,
                                cd: cdFromRowKey(m.key),
                              })
                            }
                            title={
                              it
                                ? `${m.ticker}: Soft G1 ok ma ${buyNearMissFailLabel(m.fail, true)}`
                                : `${m.ticker}: Soft G1 ok but ${buyNearMissFailLabel(m.fail, false)}`
                            }
                          >
                            {m.ticker}
                          </button>
                          <span className="opacity-70">
                            {" "}
                            ({buyNearMissFailLabel(m.fail, it)})
                          </span>
                        </span>
                      ))}
                      {ops.buyNearMisses.length > 6
                        ? ` · +${ops.buyNearMisses.length - 6}`
                        : null}
                    </p>
                  ) : (
                    <p className="text-[9px] text-ink-muted leading-snug">
                      {it
                        ? `Nessun nome off-book con SDS≥${SOFT_BUY_G1_SDS_MIN} e P(plan)≥${SOFT_BUY_G1_PPLAN_MIN}.`
                        : `No off-book name with SDS≥${SOFT_BUY_G1_SDS_MIN} and P(plan)≥${SOFT_BUY_G1_PPLAN_MIN}.`}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="mt-auto -mx-2.5 -mb-2 px-2.5 pt-2 pb-2 border-t border-sky-500/30 bg-sky-500/[0.08] rounded-b-lg">
            <p className="text-[10px] font-semibold text-sky-800 dark:text-sky-300">
              {it
                ? `Acquistati ieri (${bookFlow.buys.length}) · ${bookFlow.dayKey}`
                : `Bought yesterday (${bookFlow.buys.length}) · ${bookFlow.dayKey}`}
            </p>
            {showBookFlow && bookFlow.buys.length ? (
              <ul className="mt-1 space-y-0.5 max-h-28 overflow-y-auto pr-0.5">
                {bookFlow.buys.map((b) => (
                  <BookFlowRow
                    key={b.key}
                    item={b}
                    investedLabel={investedLabel}
                    onOpen={onOpenEvaluationTopKpi}
                  />
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[10px] text-ink-muted">
                {it ? "Nessun acquisto ieri" : "No buys yesterday"}
              </p>
            )}
          </div>
        </div>

        {/* SELL column: suggestions + what you sold */}
        <div className="rounded-lg border border-rose-500/30 bg-gradient-to-b from-rose-500/[0.07] to-transparent px-2.5 py-2 flex flex-col gap-2 min-h-[7.5rem]">
          <div>
            <p className="text-[10px] font-semibold text-rose-800 dark:text-rose-300">
              {it
                ? `SELL consigliati${nSell ? ` (${nSell})` : ""}`
                : `Suggested SELL${nSell ? ` (${nSell})` : ""}`}
            </p>
            <p className="text-[9px] text-ink-muted mt-0.5 leading-snug">
              {it
                ? `G2 auto (budget ${G2_PCT}% acquistato+guadagnato) · Soft / continuation = tu · click → Top KPI`
                : `G2 auto (${G2_PCT}% of purchased+gains) · Soft / continuation = you · click → Top KPI`}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {ops.sells.length ? (
                ops.sells.map((s) => (
                  <TickerJumpChip
                    key={s.key}
                    ticker={s.ticker}
                    rowKey={s.key}
                    tone="sell"
                    suffix={sellTagLabel(s.tag)}
                    capitalEur={s.capitalEur}
                    pnlEur={s.pnlEur}
                    investedLabel={investedLabel}
                    onOpen={onOpenEvaluationTopKpi}
                    title={
                      s.tag === "G2"
                        ? it
                          ? `${s.ticker} · SELL G2 automatico → Top KPI`
                          : `${s.ticker} · auto SELL G2 → Top KPI`
                        : it
                          ? `${s.ticker} (${sellTagLabel(s.tag)}) → Top KPI`
                          : `${s.ticker} (${sellTagLabel(s.tag)}) → Top KPI`
                    }
                  />
                ))
              ) : (
                <div className="w-full space-y-1">
                  <span className="text-[10px] text-ink-muted">
                    {it ? "Nessuno ora" : "None now"}
                  </span>
                  <p className="text-[9px] text-ink-muted leading-snug">
                    {it
                      ? "Nessun open book in Soft SELL / G2 / exhaustion (stessa logica della colonna Rec. su Pulse)."
                      : "No open book Soft SELL / G2 / exhaustion (same arbiter as Pulse Rec.)."}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="mt-auto -mx-2.5 -mb-2 px-2.5 pt-2 pb-2 border-t border-amber-400/40 bg-amber-300/[0.14] rounded-b-lg">
            <p className="text-[10px] font-semibold text-amber-900 dark:text-amber-200">
              {it
                ? `Venduti ieri/oggi (${bookFlow.sells.length})`
                : `Sold yesterday/today (${bookFlow.sells.length})`}
            </p>
            {showBookFlow && bookFlow.sells.length ? (
              <ul className="mt-1 space-y-0.5 max-h-28 overflow-y-auto pr-0.5">
                {bookFlow.sells.map((s) => (
                  <BookFlowRow
                    key={s.key}
                    item={s}
                    investedLabel={investedLabel}
                    onOpen={onOpenEvaluationTopKpi}
                  />
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[10px] text-ink-muted">
                {it ? "Nessuna vendita ieri/oggi" : "No sells yesterday/today"}
              </p>
            )}
          </div>
        </div>
      </div>

      <details className="rounded-lg border border-[rgb(var(--border))]/55 bg-[rgb(var(--surface-2))]/35 group">
        <summary className="cursor-pointer select-none list-none px-3 py-2 text-[11px] font-semibold text-ink hover:bg-[rgb(var(--accent))]/6 transition-colors [&::-webkit-details-marker]:hidden flex items-center justify-between gap-2">
          <span>{it ? "Regole Soft BUY / Soft SELL" : "Soft BUY / Soft SELL rules"}</span>
          <span
            className="text-[10px] font-normal text-ink-muted shrink-0 transition-transform group-open:rotate-90"
            aria-hidden
          >
            ▶
          </span>
        </summary>
        <div className="px-3 pb-2.5 border-t border-[rgb(var(--border))]/35 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] font-semibold text-emerald-800 dark:text-emerald-300 mt-1.5 mb-1">
              BUY
            </p>
            <ul className="space-y-1">
              {buyChecklist.map((line) => (
                <li key={line} className="flex items-start gap-1.5 text-[11px] text-ink leading-snug">
                  <span
                    className="mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-[9px] font-bold text-emerald-700"
                    aria-hidden
                  >
                    ✓
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-rose-800 dark:text-rose-300 mt-1.5 mb-1">
              SELL
            </p>
            <ul className="space-y-1">
              {sellChecklist.map((line) => (
                <li key={line} className="flex items-start gap-1.5 text-[11px] text-ink leading-snug">
                  <span
                    className="mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-rose-500/20 text-[9px] font-bold text-rose-700"
                    aria-hidden
                  >
                    ✓
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </details>
    </section>
  );
}
