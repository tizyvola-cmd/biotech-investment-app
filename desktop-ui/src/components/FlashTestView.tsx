import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartBundle, SheetTable } from "../types";
import { chartPointsMapFromBundle } from "../data/simulationCharts";
import { useLang, useT } from "../shared/i18n";
import {
  FLASH_TEST_CHANGED_EVENT,
  isFlashTestRunExpired,
  loadFlashTestState,
  resetFlashTestRun,
  startFlashTestRun,
  stopFlashTestRun,
} from "../sheet/flashTestStorage";
import {
  markFlashTestBooks,
  normalizeFlashTestCapitals,
  runFlashTestTick,
} from "../sheet/flashTestEngine";
import {
  FLASH_TEST_AUTO_TICK_MS,
  tryRunFlashTestAutoTick,
} from "../sheet/flashTestAutoTick";
import {
  FLASH_TEST_GENS,
  FLASH_TEST_MARK_MS,
  type FlashTestState,
  type SoftLogicGenId,
} from "../sheet/flashTestTypes";
import { resolvePaperPositionMarks } from "../sheet/investDecisionSimLoop";
import { buildSimRowByKeyMap } from "../sheet/investSimKeys";
import {
  SOFT_LOGIC_ERAS,
  softLogicEraHex,
} from "../sheet/softLogicChronology";
import { loadInvestSimHistory, loadInvestSimInputs } from "../sheet/investSimStorage";
import type { LossAnalysisProbOptions } from "../sheet/portfolioLossAnalysis";
import { buildMigSolidityByKey } from "../sheet/entrySolidityMig";
import type { LossRiskCatalog } from "../hooks/useLossRiskCatalog";
import type { LossRiskEntry } from "./LossRiskPoopCell";
import {
  fetchIntraday1h,
  fetchRegulatoryRiskSnapshot,
  readLocalSdsSnapshot,
  type RegulatoryRiskSnapshot,
  type SdsRow,
} from "../api/supernova";
import { loadEisSuperScoreState } from "../api/eisSuperScore";
import { buildPriorSessionPctByTicker } from "../sheet/softBuyRisingStreak";
import { sanitizeIntradayTickers } from "../sheet/simulationPosition";
import { SelectionChip, SelectionChipGroup } from "./SelectionChip";

type CurveUnit = "usd" | "pct";

function eraForGen(gen: SoftLogicGenId) {
  return SOFT_LOGIC_ERAS.find((e) => e.gen === gen) ?? SOFT_LOGIC_ERAS[0]!;
}

function fmtEur(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}€${Math.round(n).toLocaleString("en-US")}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function fmtTs(iso: string, lang: "it" | "en"): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso.slice(0, 16);
  return d.toLocaleString(lang === "it" ? "it-IT" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function FlashTestView({
  simTable,
  chartsBundle = null,
  probOptions = null,
  lossRiskCatalog = null,
  catalogByRowKey = null,
  autoRegSnap = null,
  onBack,
}: {
  simTable: SheetTable | null;
  chartsBundle?: ChartBundle | null;
  probOptions?: LossAnalysisProbOptions | null;
  lossRiskCatalog?: LossRiskCatalog | null;
  catalogByRowKey?: Map<string, LossRiskEntry> | null;
  autoRegSnap?: RegulatoryRiskSnapshot | null;
  onBack?: () => void;
}) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";
  const [state, setState] = useState<FlashTestState>(() => loadFlashTestState());
  const [gen, setGen] = useState<SoftLogicGenId>(4);
  const [curveUnit, setCurveUnit] = useState<CurveUnit>("usd");
  /** Breakeven chart: one Gen at a time, or all for compare. */
  const [chartGen, setChartGen] = useState<SoftLogicGenId | "all">("all");
  const [busy, setBusy] = useState(false);
  const [localSdsRows, setLocalSdsRows] = useState<SdsRow[] | null>(null);
  const [localEisState, setLocalEisState] = useState<
    Awaited<ReturnType<typeof loadEisSuperScoreState>> | null
  >(null);
  const [localRegSnap, setLocalRegSnap] = useState<RegulatoryRiskSnapshot | null>(null);
  const [priorSessionPctByTicker, setPriorSessionPctByTicker] = useState<Map<string, number>>(
    () => new Map(),
  );

  useEffect(() => {
    const sync = () => setState(loadFlashTestState());
    window.addEventListener(FLASH_TEST_CHANGED_EVENT, sync);
    return () => window.removeEventListener(FLASH_TEST_CHANGED_EVENT, sync);
  }, []);

  /** Rewrite legacy Gen 4 gate-sized tickets → € capitalPerTrade as soon as Flash opens. */
  useEffect(() => {
    setState(normalizeFlashTestCapitals(loadFlashTestState()));
  }, []);

  /** Soft BUY needs SDS/P — Flash Test must load the same enrichment as Home. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [sdsDoc, eis, reg] = await Promise.all([
        readLocalSdsSnapshot(),
        loadEisSuperScoreState(),
        fetchRegulatoryRiskSnapshot().catch(() => null),
      ]);
      if (cancelled) return;
      setLocalSdsRows(sdsDoc?.rows ?? null);
      setLocalEisState(eis);
      if (reg) setLocalRegSnap(reg);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Same Yahoo prior-session % as Home Soft BUY ↑≥2d gate. */
  useEffect(() => {
    if (!simTable?.rows?.length) {
      setPriorSessionPctByTicker(new Map());
      return;
    }
    const tickers = sanitizeIntradayTickers(
      simTable.rows.map((r) => String(r.Ticker ?? "")),
      40,
    );
    let cancelled = false;
    void (async () => {
      try {
        const payload = await fetchIntraday1h(tickers);
        if (cancelled) return;
        setPriorSessionPctByTicker(buildPriorSessionPctByTicker(payload));
      } catch {
        if (!cancelled) setPriorSessionPctByTicker(new Map());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [simTable]);

  const pointsBySeriesKey = useMemo(
    () => chartPointsMapFromBundle(chartsBundle ?? ({ series: {} } as ChartBundle)),
    [chartsBundle],
  );

  const effectiveProbOptions = useMemo((): LossAnalysisProbOptions | null => {
    if (!simTable?.rows?.length) return null;
    const sdsRows = probOptions?.sdsRows ?? localSdsRows;
    return {
      ...probOptions,
      sdsRows,
      migSolidityByKey:
        probOptions?.migSolidityByKey ??
        buildMigSolidityByKey(simTable, chartsBundle, sdsRows),
      eisSuperScoreState: probOptions?.eisSuperScoreState ?? localEisState,
      lightweightPolygon: probOptions?.lightweightPolygon ?? true,
      mergedInputs: probOptions?.mergedInputs ?? loadInvestSimInputs(),
    };
  }, [simTable, chartsBundle, probOptions, localSdsRows, localEisState]);

  const sdsReady = Boolean(
    (effectiveProbOptions?.sdsRows?.length ?? 0) > 0,
  );

  const tickCtx = useMemo(
    () => ({
      simTable: simTable!,
      pointsBySeriesKey,
      lang: lang as "it" | "en",
      probOptions: effectiveProbOptions,
      history: loadInvestSimHistory(),
      lossRiskCatalog,
      catalogByRowKey,
      autoRegSnap: autoRegSnap ?? localRegSnap,
      priorSessionPctByTicker,
      inputs: loadInvestSimInputs(),
    }),
    [
      simTable,
      pointsBySeriesKey,
      lang,
      effectiveProbOptions,
      lossRiskCatalog,
      catalogByRowKey,
      autoRegSnap,
      localRegSnap,
      priorSessionPctByTicker,
    ],
  );

  const runTick = useCallback(() => {
    if (!simTable?.rows?.length) return;
    setBusy(true);
    try {
      const fresh = loadFlashTestState();
      if (!fresh.enabled) return;
      if (isFlashTestRunExpired(fresh)) {
        setState(stopFlashTestRun(fresh));
        return;
      }
      setState(runFlashTestTick(fresh, tickCtx));
    } finally {
      setBusy(false);
    }
  }, [simTable, tickCtx]);

  const startAndTick = useCallback(() => {
    const started = startFlashTestRun(loadFlashTestState());
    if (!simTable?.rows?.length || !sdsReady) {
      setState(started);
      return;
    }
    setBusy(true);
    try {
      // First tick immediately; then auto-loop every FLASH_TEST_AUTO_TICK_MS.
      setState(runFlashTestTick(started, tickCtx));
    } finally {
      setBusy(false);
    }
  }, [simTable, tickCtx, sdsReady]);

  /** Hands-off loop: while Running + SDS ready, re-evaluate Soft BUY/SELL lists. */
  useEffect(() => {
    if (!state.enabled || !sdsReady || !simTable?.rows?.length) return;
    const ctx = {
      simTable,
      pointsBySeriesKey: tickCtx.pointsBySeriesKey,
      lang: tickCtx.lang,
      probOptions: tickCtx.probOptions,
      lossRiskCatalog: tickCtx.lossRiskCatalog,
      catalogByRowKey: tickCtx.catalogByRowKey,
      autoRegSnap: tickCtx.autoRegSnap,
      priorSessionPctByTicker: tickCtx.priorSessionPctByTicker,
      inputs: tickCtx.inputs,
    };
    const kick = () => {
      if (document.visibilityState === "hidden") return;
      tryRunFlashTestAutoTick(ctx);
    };
    kick();
    const id = window.setInterval(kick, Math.min(30_000, FLASH_TEST_AUTO_TICK_MS));
    return () => window.clearInterval(id);
  }, [state.enabled, sdsReady, simTable, tickCtx]);

  const tickCtxRef = useRef(tickCtx);
  tickCtxRef.current = tickCtx;

  /**
   * Mark-only pass: refresh lastMarkPct + equity points from Simulation tape
   * without opening new trades. Without this, Breakeven stays flat at €0 between
   * the slower Soft BUY/SELL ticks (and when spot is stuck at entry).
   */
  useEffect(() => {
    if (!state.enabled || !simTable?.rows?.length) return;
    const mark = () => {
      if (document.visibilityState === "hidden") return;
      const fresh = loadFlashTestState();
      if (!fresh.enabled) return;
      setState(markFlashTestBooks(fresh, tickCtxRef.current));
    };
    mark();
    const id = window.setInterval(mark, FLASH_TEST_MARK_MS);
    return () => window.clearInterval(id);
  }, [state.enabled, simTable]);

  const simRowByKey = useMemo(
    () => buildSimRowByKeyMap(simTable?.rows ?? []),
    [simTable],
  );

  const arm = state.arms[gen]!;
  const era = eraForGen(gen);
  const activity24h = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recent = arm.trades.filter((tr) => {
      const t = Date.parse(tr.at);
      return Number.isFinite(t) && t >= cutoff;
    });
    const buys = recent.filter((tr) => tr.side === "buy");
    const sells = recent.filter((tr) => tr.side === "sell");
    return { buys, sells, recent };
  }, [arm.trades]);

  const compareRows = useMemo(() => {
    const byTs = new Map<string, Record<string, number | string>>();
    for (const g of FLASH_TEST_GENS) {
      const keyUsd = `g${g}_usd`;
      const keyPct = `g${g}_pct`;
      for (const p of state.arms[g]!.equity) {
        const row = byTs.get(p.ts) ?? { ts: p.ts };
        row[keyUsd] = p.totalPnlEur;
        row[keyPct] = p.pnlPctOnBankroll;
        byTs.set(p.ts, row);
      }
    }
    return [...byTs.values()].sort((a, b) =>
      String(a.ts).localeCompare(String(b.ts)),
    );
  }, [state.arms]);

  const armSummary = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return FLASH_TEST_GENS.map((g) => {
      const a = state.arms[g]!;
      const last = a.equity[a.equity.length - 1];
      const recent = a.trades.filter((tr) => {
        const ts = Date.parse(tr.at);
        return Number.isFinite(ts) && ts >= cutoff;
      });
      return {
        gen: g,
        era: eraForGen(g),
        open: a.portfolio.length,
        totalPnl: last?.totalPnlEur ?? a.cumulativeClosedPnlEur,
        pct: last?.pnlPctOnBankroll ?? 0,
        buys24: recent.filter((tr) => tr.side === "buy").length,
        sells24: recent.filter((tr) => tr.side === "sell").length,
      };
    });
  }, [state.arms]);

  return (
    <div className="flex flex-col flex-1 gap-3 min-h-0">
      {onBack ? (
        <button
          type="button"
          className="self-start shrink-0 rounded-md border border-[rgb(var(--border))]/60 bg-surface/40 px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface/70 transition"
          onClick={onBack}
        >
          ← {t("modelLab.performance.backToDashboard")}
        </button>
      ) : null}

      <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-gradient-to-br from-white via-emerald-50/40 to-sky-50/30 p-4 space-y-3 shrink-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-ink">
              {t("flashTest.title")}
            </h3>
            <p className="text-[11px] text-ink-muted mt-0.5 max-w-2xl">
              {t("flashTest.lead")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!state.enabled ? (
              <button
                type="button"
                className="rounded-lg bg-[rgb(var(--accent))] px-3 py-2 text-xs font-semibold text-white hover:opacity-90 transition disabled:opacity-50"
                disabled={!simTable?.rows?.length || !sdsReady}
                onClick={startAndTick}
                title={!sdsReady ? t("flashTest.sdsWait") : undefined}
              >
                {t("flashTest.startWeek")}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="rounded-lg border border-[rgb(var(--border))]/60 bg-white/90 px-3 py-2 text-xs font-medium text-ink hover:bg-surface/70 transition disabled:opacity-50"
                  disabled={busy || !simTable?.rows?.length || !sdsReady}
                  onClick={runTick}
                  title={!sdsReady ? t("flashTest.sdsWait") : undefined}
                >
                  {busy ? t("flashTest.ticking") : t("flashTest.runTick")}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-rose-300/60 bg-white/90 px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50 transition"
                  onClick={() => setState(stopFlashTestRun(state))}
                >
                  {t("flashTest.stop")}
                </button>
              </>
            )}
            <button
              type="button"
              className="rounded-lg border border-[rgb(var(--border))]/60 bg-white/90 px-3 py-2 text-xs font-medium text-ink-muted hover:text-ink transition"
              onClick={() => setState(resetFlashTestRun(state))}
            >
              {t("flashTest.reset")}
            </button>
          </div>
        </div>
        <div
          className={`rounded-lg border px-3 py-2 text-[12px] font-semibold ${
            sdsReady
              ? "border-emerald-300/70 bg-emerald-50 text-emerald-800"
              : "border-amber-300/70 bg-amber-50 text-amber-900"
          }`}
        >
          {sdsReady
            ? t("flashTest.sdsReady", {
                n: String(effectiveProbOptions?.sdsRows?.length ?? 0),
              })
            : t("flashTest.sdsWait")}
          {state.enabled && sdsReady ? (
            <span className="ml-2 font-medium opacity-80">
              · {t("flashTest.autoLoopHint")}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-3 text-[11px] text-ink-muted">
          <span>
            {state.enabled ? t("flashTest.statusOn") : t("flashTest.statusOff")}
          </span>
          {state.startedAt ? (
            <span>
              {t("flashTest.started")}: {fmtTs(state.startedAt, lang)}
            </span>
          ) : null}
          {state.endsAt ? (
            <span>
              {t("flashTest.ends")}: {fmtTs(state.endsAt, lang)}
            </span>
          ) : null}
          {state.lastTickAt ? (
            <span>
              {t("flashTest.lastTick")}: {fmtTs(state.lastTickAt, lang)}
            </span>
          ) : null}
          <span>
            {t("flashTest.bankroll")}: €
            {state.bankrollEur.toLocaleString("en-US")} ·{" "}
            {t("flashTest.perTrade")}: €
            {state.capitalPerTrade.toLocaleString("en-US")} · max{" "}
            {Number.isFinite(state.maxOpenPositions)
              ? state.maxOpenPositions
              : "∞"}{" "}
            open
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {armSummary.map((s) => (
            <button
              key={s.gen}
              type="button"
              onClick={() => setGen(s.gen)}
              className={`rounded-lg border px-2 py-2 text-left transition ${
                gen === s.gen
                  ? "border-[rgb(var(--accent))] bg-[rgb(var(--accent))]/8"
                  : "border-[rgb(var(--border))]/50 bg-white/80 hover:bg-white"
              }`}
            >
              <p className="text-[11px] font-semibold" style={{ color: softLogicEraHex(s.era) }}>
                {s.era.shortLabel}
              </p>
              <p className="text-sm font-semibold tabular-nums text-ink">
                {fmtEur(s.totalPnl)}
              </p>
              <p className="text-[10px] text-ink-muted tabular-nums">
                {fmtPct(s.pct)} · {s.open} open
              </p>
              <p className="text-[10px] text-ink-muted tabular-nums mt-0.5">
                {t("flashTest.activity24hSummary", {
                  buy: String(s.buys24),
                  sell: String(s.sells24),
                })}
              </p>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-white/95 p-3 flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-semibold text-ink">
              {t("flashTest.portfolioTitle")} — {era.shortLabel}
            </h4>
            <p className="text-[10px] text-ink-muted">
              {it ? era.summaryIt : era.summaryEn}
            </p>
          </div>
          <SelectionChipGroup>
            {FLASH_TEST_GENS.map((g) => (
              <SelectionChip
                key={g}
                active={gen === g}
                onClick={() => setGen(g)}
              >
                {eraForGen(g).shortLabel}
              </SelectionChip>
            ))}
          </SelectionChipGroup>
        </div>

        <div
          className={`rounded-lg border px-3 py-2 text-[11px] ${
            activity24h.recent.length === 0
              ? "border-[rgb(var(--border))]/50 bg-slate-50/80 text-ink-muted"
              : "border-sky-300/60 bg-sky-50/70 text-ink"
          }`}
        >
          <p className="font-semibold text-ink mb-1">
            {t("flashTest.activity24hTitle")}
          </p>
          {activity24h.recent.length === 0 ? (
            <p className="text-[10px] text-ink-muted">{t("flashTest.activity24hEmpty")}</p>
          ) : (
            <div className="flex flex-col gap-1">
              <p className="tabular-nums">
                <span className="font-semibold text-emerald-700">
                  BUY {activity24h.buys.length}
                </span>
                {activity24h.buys.length > 0 ? (
                  <span className="text-ink-muted">
                    {" "}
                    ·{" "}
                    {[...new Set(activity24h.buys.map((tr) => tr.ticker))].join(
                      ", ",
                    )}
                  </span>
                ) : null}
              </p>
              <p className="tabular-nums">
                <span className="font-semibold text-rose-700">
                  SELL {activity24h.sells.length}
                </span>
                {activity24h.sells.length > 0 ? (
                  <span className="text-ink-muted">
                    {" "}
                    ·{" "}
                    {activity24h.sells
                      .map(
                        (tr) =>
                          `${tr.ticker}${
                            tr.pnlEurSimulated != null
                              ? ` (${fmtEur(tr.pnlEurSimulated)})`
                              : ""
                          }`,
                      )
                      .join(", ")}
                  </span>
                ) : (
                  <span className="text-ink-muted">
                    {" "}
                    · {t("flashTest.activity24hNoSells")}
                  </span>
                )}
              </p>
            </div>
          )}
        </div>

        <div className="border border-[rgb(var(--border))]/40 rounded-lg">
          <table className="w-full text-[11px]">
            <thead className="bg-slate-50 text-ink-muted">
              <tr>
                <th className="text-left px-2 py-1.5 font-medium">{t("flashTest.col.ticker")}</th>
                <th className="text-right px-2 py-1.5 font-medium">{t("flashTest.col.capital")}</th>
                <th className="text-right px-2 py-1.5 font-medium">{t("flashTest.col.mtm")}</th>
                <th className="text-left px-2 py-1.5 font-medium">{t("flashTest.col.entry")}</th>
                <th className="text-left px-2 py-1.5 font-medium">{t("flashTest.col.reason")}</th>
              </tr>
            </thead>
            <tbody>
              {arm.portfolio.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-2 py-4 text-center text-ink-muted">
                    {t("flashTest.portfolioEmpty")}
                  </td>
                </tr>
              ) : (
                arm.portfolio.map((p) => {
                  const live = resolvePaperPositionMarks(
                    p,
                    simRowByKey.get(p.key) ?? null,
                  );
                  const markPct =
                    live.totalPnlPct ??
                    (p.lastMarkPct != null && Number.isFinite(p.lastMarkPct)
                      ? p.lastMarkPct
                      : null);
                  const mtm =
                    markPct != null ? (p.capital * markPct) / 100 : null;
                  return (
                    <tr key={p.key} className="border-t border-[rgb(var(--border))]/30">
                      <td className="px-2 py-1.5 font-semibold text-ink">{p.ticker}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        €{Math.round(p.capital).toLocaleString("en-US")}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {fmtEur(mtm)}
                        {markPct != null ? (
                          <span className="text-ink-muted ml-1">
                            ({fmtPct(markPct)})
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-1.5 text-ink-muted whitespace-nowrap">
                        {fmtTs(p.entryAt, lang)}
                      </td>
                      <td className="px-2 py-1.5 text-ink-muted truncate max-w-[220px]">
                        {p.entryReason}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-white/95 p-3 flex flex-col gap-2 min-h-[320px]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-semibold text-ink">
              {t("flashTest.chartTitle")}
            </h4>
            <p className="text-[10px] text-ink-muted">{t("flashTest.chartLead")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SelectionChipGroup>
              <SelectionChip
                active={chartGen === "all"}
                onClick={() => setChartGen("all")}
                title={t("flashTest.chartGenAllTip")}
              >
                {t("flashTest.chartGenAll")}
              </SelectionChip>
              {FLASH_TEST_GENS.map((g) => (
                <SelectionChip
                  key={g}
                  active={chartGen === g}
                  onClick={() => setChartGen(g)}
                  title={it ? eraForGen(g).summaryIt : eraForGen(g).summaryEn}
                >
                  <span className="inline-flex items-center gap-1">
                    <span
                      className="inline-block h-2 w-2 rounded-sm"
                      style={{ background: softLogicEraHex(eraForGen(g)) }}
                    />
                    {eraForGen(g).shortLabel}
                  </span>
                </SelectionChip>
              ))}
            </SelectionChipGroup>
            <SelectionChipGroup>
              <SelectionChip
                active={curveUnit === "usd"}
                onClick={() => setCurveUnit("usd")}
              >
                $ / €
              </SelectionChip>
              <SelectionChip
                active={curveUnit === "pct"}
                onClick={() => setCurveUnit("pct")}
              >
                %
              </SelectionChip>
            </SelectionChipGroup>
          </div>
        </div>
        {compareRows.length < 2 ? (
          <p className="text-[11px] text-ink-muted py-8 text-center">
            {t("flashTest.chartEmpty")}
          </p>
        ) : (
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={compareRows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.35)" />
                <XAxis
                  dataKey="ts"
                  tickFormatter={(v) => fmtTs(String(v), lang)}
                  tick={{ fontSize: 10 }}
                  minTickGap={40}
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) =>
                    curveUnit === "pct" ? `${v}%` : `€${Math.round(Number(v))}`
                  }
                />
                <Tooltip
                  labelFormatter={(v) => fmtTs(String(v), lang)}
                  formatter={(value: number, name: string) => {
                    const g = Number(String(name).replace(/\D/g, ""));
                    const label = eraForGen(g as SoftLogicGenId).shortLabel;
                    return [
                      curveUnit === "pct" ? fmtPct(value) : fmtEur(value),
                      label,
                    ];
                  }}
                />
                {chartGen === "all" ? (
                  <Legend
                    formatter={(value) => {
                      const g = Number(String(value).replace(/\D/g, ""));
                      return eraForGen(g as SoftLogicGenId).shortLabel;
                    }}
                  />
                ) : null}
                {(chartGen === "all" ? FLASH_TEST_GENS : [chartGen]).map((g) => (
                  <Line
                    key={g}
                    type="monotone"
                    dataKey={curveUnit === "usd" ? `g${g}_usd` : `g${g}_pct`}
                    name={`g${g}`}
                    stroke={softLogicEraHex(eraForGen(g))}
                    strokeWidth={chartGen === g || gen === g ? 2.6 : 1.5}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
