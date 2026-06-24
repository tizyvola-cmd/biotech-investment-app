import { useCallback, useEffect, useMemo, useState } from "react";
import { readLocalSdsSnapshot, type SdsRow } from "../api/supernova";
import type { ChartPoint, SheetTable } from "../types";
import { useLang, useT } from "../shared/i18n";
import {
  buildCdPatternRecommendations,
  buildCdPatternNearestEis,
  type CdPatternTickerRecommendation,
} from "../sheet/cdPatternRecommendation";
import { loadEisSuperScoreState, type EisSuperScoreState } from "../api/eisSuperScore";
import { CD_PATTERN_WINDOWS } from "../sheet/cdPatternHorizons";
import type { InvestSimInputs } from "../sheet/investSimStorage";
import { normalizedRowKey } from "../sheet/investSimKeys";
import {
  computeCdPatternPriorityIndex,
  portfolioPriorityRank,
  sortCdPatternByPortfolioPriority,
  sortCdPatternByMatchScore,
} from "../sheet/cdPatternPortfolioPriority";
import { rowHasActivePortfolio } from "../sheet/simulationPosition";
import { EisDetailDrawer } from "./EisDetailDrawer";
import { CdPatternArcPanel } from "./CdPatternArcPanel";
import { CdPatternEisPanel } from "./CdPatternEisPanel";
import { PortfolioTickerMark } from "./PortfolioScopeToggle";
import { SelectionChip, SelectionChipGroup } from "./SelectionChip";

type PatternListSort = "ppi" | "match";

export type CdPatternRecommendationViewProps = {
  simTable: SheetTable | null | undefined;
  chartsBySeriesKey: Map<string, ChartPoint[]>;
  chartsBundle: import("../types").ChartBundle | null | undefined;
  investInputs: InvestSimInputs;
  focusTicker?: string | null;
  onFocusTickerConsumed?: () => void;
  onOpenClinicalFeed?: (ticker: string) => void;
  onNavigateToSimulation?: (ticker: string, action: "buy" | "sell", cd?: string) => void;
  /** @deprecated prefer onNavigateToSimulation */
  onOpenSimulationRow?: (focus: {
    ticker: string;
    cd?: string;
    action?: "buy" | "sell";
  }) => void;
  /** Parent page refresh — rilegge snapshot SDS/EIS. */
  parentReloadToken?: number;
};

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

export function CdPatternRecommendationView({
  simTable,
  chartsBySeriesKey,
  chartsBundle,
  investInputs,
  focusTicker,
  onFocusTickerConsumed,
  onOpenClinicalFeed,
  onNavigateToSimulation,
  onOpenSimulationRow,
  parentReloadToken = 0,
}: CdPatternRecommendationViewProps) {
  const t = useT();
  const { lang } = useLang();
  const [sdsRows, setSdsRows] = useState<SdsRow[] | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [eisDrawerTicker, setEisDrawerTicker] = useState<string | null>(null);
  const [eisSuperState, setEisSuperState] = useState<EisSuperScoreState | null>(null);
  const [recommendations, setRecommendations] = useState<CdPatternTickerRecommendation[]>([]);
  const [listBusy, setListBusy] = useState(true);
  const [portfolioOnly, setPortfolioOnly] = useState(false);
  const [listSort, setListSort] = useState<PatternListSort>("ppi");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const local = await readLocalSdsSnapshot();
      if (!cancelled && local?.rows?.length) setSdsRows(local.rows);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadEisSuperScoreState().then((st) => {
      if (!cancelled) setEisSuperState(st);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!parentReloadToken) return;
    let cancelled = false;
    void (async () => {
      const local = await readLocalSdsSnapshot();
      if (!cancelled && local?.rows?.length) setSdsRows(local.rows);
    })();
    void loadEisSuperScoreState().then((st) => {
      if (!cancelled) setEisSuperState(st);
    });
    return () => {
      cancelled = true;
    };
  }, [parentReloadToken]);

  useEffect(() => {
    if (!simTable?.rows?.length) {
      setRecommendations([]);
      setListBusy(false);
      return;
    }
    setListBusy(true);
    let cancelled = false;
    const id = window.setTimeout(() => {
      if (cancelled) return;
      setRecommendations(
        buildCdPatternRecommendations({
          simTable,
          chartsBySeriesKey,
          investInputs,
          sdsRows,
          chartsBundle,
          lang,
          includeEis: false,
        }),
      );
      setListBusy(false);
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [simTable, chartsBySeriesKey, investInputs, sdsRows, chartsBundle, lang]);

  useEffect(() => {
    const tk = focusTicker?.trim().toUpperCase();
    if (!tk) return;
    const hit = recommendations.find((r) => r.ticker === tk);
    if (hit) setSelectedKey(hit.key);
    onFocusTickerConsumed?.();
  }, [focusTicker, recommendations, onFocusTickerConsumed]);

  const listReady = simTable?.rows?.length && !listBusy;

  const portfolioByKey = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const row of simTable?.rows ?? []) {
      const tk = String(row.Ticker ?? row.ticker ?? "")
        .trim()
        .toUpperCase();
      if (!tk) continue;
      const cd = String(row["Completion Date"] ?? "").trim();
      m.set(normalizedRowKey(tk, cd), rowHasActivePortfolio(row, investInputs));
    }
    return m;
  }, [simTable?.rows, investInputs]);

  const portfolioCount = useMemo(
    () => recommendations.filter((r) => portfolioByKey.get(r.key)).length,
    [recommendations, portfolioByKey],
  );

  const displayRecommendations = useMemo(() => {
    let rows = recommendations;
    if (portfolioOnly) {
      rows = rows.filter((r) => portfolioByKey.get(r.key));
    }
    if (listSort === "match") {
      return sortCdPatternByMatchScore(rows);
    }
    return sortCdPatternByPortfolioPriority(rows, portfolioByKey);
  }, [recommendations, portfolioByKey, portfolioOnly, listSort]);

  const portfolioRankList = useMemo(
    () => displayRecommendations.filter((r) => portfolioByKey.get(r.key)),
    [displayRecommendations, portfolioByKey],
  );

  useEffect(() => {
    if (!displayRecommendations.length) {
      setSelectedKey(null);
      return;
    }
    if (!selectedKey || !displayRecommendations.some((r) => r.key === selectedKey)) {
      setSelectedKey(displayRecommendations[0]!.key);
    }
  }, [displayRecommendations, selectedKey]);

  const selectedBase = useMemo(
    () => recommendations.find((r) => r.key === selectedKey) ?? displayRecommendations[0] ?? null,
    [recommendations, selectedKey, displayRecommendations],
  );

  const selected = useMemo(() => {
    if (!selectedBase) return null;
    const nearestEis = buildCdPatternNearestEis(
      selectedBase.ticker,
      selectedBase.completionDate,
      lang,
      eisSuperState,
    );
    return { ...selectedBase, nearestEis };
  }, [selectedBase, lang, eisSuperState]);

  const verdictLabel = useCallback(
    (v: CdPatternTickerRecommendation["verdict"]) => {
      const keys = {
        strong: "decisionLab.pattern.verdict.strong",
        watch: "decisionLab.pattern.verdict.watch",
        weak: "decisionLab.pattern.verdict.weak",
        blocked: "decisionLab.pattern.verdict.blocked",
      } as const;
      return t(keys[v]);
    },
    [t],
  );

  const openSimulationForRec = useCallback(
    (rec: CdPatternTickerRecommendation) => {
      const inPortfolio = portfolioByKey.get(rec.key) ?? false;
      const action = inPortfolio ? "sell" : "buy";
      const cd = rec.completionDate ?? undefined;
      if (onNavigateToSimulation) {
        onNavigateToSimulation(rec.ticker, action, cd);
        return;
      }
      onOpenSimulationRow?.({ ticker: rec.ticker, cd, action });
    },
    [onNavigateToSimulation, onOpenSimulationRow, portfolioByKey],
  );

  const canOpenSimulationRow = Boolean(onNavigateToSimulation || onOpenSimulationRow);

  return (
    <div className="flex flex-col flex-1 min-w-0">
      <div className="px-4 py-3 border-b border-[rgb(var(--border))]/40 shrink-0">
        <h3 className="text-[15px] font-semibold">{t("decisionLab.pattern.title")}</h3>
        <p className="text-[11px] text-ink-muted mt-1 max-w-3xl leading-relaxed">{t("decisionLab.pattern.lead")}</p>
        <div className="flex flex-wrap gap-2 mt-2">
          {CD_PATTERN_WINDOWS.map((w) => (
            <span
              key={w.id}
              className="text-[9px] px-2 py-0.5 rounded-full border border-[rgb(var(--border))]/50 text-ink-muted tabular-nums"
              title={w.arcLabel}
            >
              {w.label}: RA≥{w.raMin} · SDS≥{w.sdsMin}
            </span>
          ))}
        </div>
        <p className="text-[10px] text-ink-muted mt-2">
          {portfolioOnly && listSort === "match"
            ? t("decisionLab.pattern.listHint.portfolioMatch")
            : portfolioOnly
              ? t("decisionLab.pattern.listHint.portfolioPpi")
              : listSort === "match"
                ? t("decisionLab.pattern.listHint.allMatch")
                : t("decisionLab.pattern.priorityHint")}
        </p>
      </div>

      {!listReady ? (
        <p className="px-4 py-6 text-sm text-ink-muted">{t("decisionLab.pattern.loading")}</p>
      ) : recommendations.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-muted">{t("decisionLab.pattern.empty")}</p>
      ) : (
        <div className="flex flex-1 min-w-0 flex-col">
          <div className="w-full border-b border-[rgb(var(--border))]/40 flex flex-col">
            <div className="shrink-0 px-3 py-2 border-b border-[rgb(var(--border))]/30 bg-[rgb(var(--panel-lab-shell-bg))] space-y-1.5">
              <SelectionChipGroup>
                <SelectionChip
                  active={!portfolioOnly}
                  onClick={() => setPortfolioOnly(false)}
                  title={t("decisionLab.pattern.filterAllTip")}
                >
                  {t("decisionLab.pattern.filterAll", { n: recommendations.length })}
                </SelectionChip>
                <SelectionChip
                  active={portfolioOnly}
                  onClick={() => setPortfolioOnly(true)}
                  title={t("decisionLab.pattern.filterPortfolioTip")}
                  disabled={portfolioCount === 0}
                >
                  <span className="mr-0.5" aria-hidden>
                    💼
                  </span>
                  {t("decisionLab.pattern.filterPortfolio", { n: portfolioCount })}
                </SelectionChip>
              </SelectionChipGroup>
              <SelectionChipGroup>
                <SelectionChip
                  active={listSort === "ppi"}
                  onClick={() => setListSort("ppi")}
                  title={t("decisionLab.pattern.sortPpiTip")}
                >
                  {t("decisionLab.pattern.sortPpi")}
                </SelectionChip>
                <SelectionChip
                  active={listSort === "match"}
                  onClick={() => setListSort("match")}
                  title={t("decisionLab.pattern.sortMatchTip")}
                >
                  {t("decisionLab.pattern.sortMatch")}
                </SelectionChip>
              </SelectionChipGroup>
            </div>
            <div className="flex-1 w-full">
            {displayRecommendations.length === 0 ? (
              <p className="px-3 py-4 text-[11px] text-ink-muted">{t("decisionLab.pattern.emptyPortfolio")}</p>
            ) : (
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-[rgb(var(--panel-lab-shell-bg))] z-[1]">
                <tr className="text-ink-muted border-b border-[rgb(var(--border))]/30">
                  <th className="text-left font-medium px-3 py-2">{t("decisionLab.pattern.colTicker")}</th>
                  <th
                    className="text-right font-medium px-2 py-2"
                    title={t("decisionLab.pattern.colPriorityTip")}
                  >
                    {t("decisionLab.pattern.colPriority")}
                  </th>
                  <th className="text-right font-medium px-2 py-2">{t("decisionLab.pattern.colDays")}</th>
                  <th className="text-right font-medium px-2 py-2">{t("decisionLab.pattern.colMatch")}</th>
                </tr>
              </thead>
              <tbody>
                {displayRecommendations.map((rec) => {
                  const active = selectedBase?.key === rec.key;
                  const inPortfolio = portfolioByKey.get(rec.key) ?? false;
                  const ppi = computeCdPatternPriorityIndex({ rec, inPortfolio });
                  const pfRank = inPortfolio ? portfolioPriorityRank(rec, portfolioRankList) : null;
                  return (
                    <tr
                      key={rec.key}
                      className={`cursor-pointer border-b border-[rgb(var(--border))]/20 transition ${
                        active ? "bg-[rgb(var(--accent))]/10" : "hover:bg-[rgb(var(--surface-3))]/40"
                      } ${inPortfolio ? "bg-[rgb(var(--accent))]/[0.04]" : ""}`}
                      onClick={() => setSelectedKey(rec.key)}
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          {pfRank != null ? (
                            <span
                              className="text-[9px] font-bold tabular-nums text-[rgb(var(--accent))] shrink-0"
                              title={t("decisionLab.pattern.portfolioRank", { rank: pfRank })}
                            >
                              #{pfRank}
                            </span>
                          ) : null}
                          <PortfolioTickerMark
                            ticker={rec.ticker}
                            inPortfolio={inPortfolio}
                            className="text-[11px]"
                          />
                        </div>
                        <p className="text-[9px] text-ink-muted truncate max-w-[140px]">{rec.window.label}</p>
                      </td>
                      <td
                        className={`text-right px-2 py-2 tabular-nums font-semibold ${
                          ppi >= 75
                            ? "text-emerald-600 dark:text-emerald-400"
                            : ppi >= 50
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-ink-muted"
                        }`}
                        title={t("decisionLab.pattern.colPriorityTip")}
                      >
                        {ppi}
                      </td>
                      <td className="text-right px-2 py-2 tabular-nums text-ink-muted">
                        {rec.daysToCd != null ? `${rec.daysToCd}d` : "—"}
                      </td>
                      <td className={`text-right px-2 py-2 tabular-nums font-semibold ${verdictClass(rec.verdict)}`}>
                        {rec.matchPct}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            )}
            </div>
          </div>

          {selected ? (
            <div className="flex-1 min-w-0 p-4 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <PortfolioTickerMark
                      ticker={selected.ticker}
                      inPortfolio={portfolioByKey.get(selected.key) ?? false}
                      className="text-lg"
                    />
                    <span className={`text-[11px] font-semibold ${verdictClass(selected.verdict)}`}>
                      {verdictLabel(selected.verdict)} · {selected.matchPct}%
                    </span>
                    <span
                      className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded border border-[rgb(var(--border))]/50 text-ink"
                      title={t("decisionLab.pattern.colPriorityTip")}
                    >
                      PPI{" "}
                      {computeCdPatternPriorityIndex({
                        rec: selected,
                        inPortfolio: portfolioByKey.get(selected.key) ?? false,
                      })}
                    </span>
                  </div>
                  {selected.company ? (
                    <p className="text-[11px] text-ink-muted">{selected.company}</p>
                  ) : null}
                  <p className="text-[11px] text-ink-muted mt-1 tabular-nums">{selected.arcPositionLabel}</p>
                  <p className="text-[10px] text-ink-muted">{selected.window.arcLabel}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[10px] text-ink-muted">{t("decisionLab.pattern.segmentRoi")}</p>
                  <p
                    className={`text-xl font-bold tabular-nums ${
                      (selected.segmentRoiPct ?? 0) >= 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-rose-600 dark:text-rose-400"
                    }`}
                  >
                    {fmtRoi(selected.segmentRoiPct)}
                  </p>
                  <p className="text-[9px] text-ink-muted max-w-[180px]">{selected.window.label}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <CdPatternArcPanel rec={selected} />

                <CdPatternEisPanel
                  rec={selected}
                  onOpenFeed={onOpenClinicalFeed}
                  onOpenDetail={() => setEisDrawerTicker(selected.ticker)}
                />
              </div>

              {canOpenSimulationRow ? (
                <button
                  type="button"
                  className="btn-ghost text-[11px] font-semibold border border-[rgb(var(--border))]/50"
                  onClick={() => openSimulationForRec(selected)}
                >
                  {portfolioByKey.get(selected.key)
                    ? t("decisionLab.pattern.openSimulationRowSell", { ticker: selected.ticker })
                    : t("decisionLab.pattern.openSimulationRowBuy", { ticker: selected.ticker })}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      <EisDetailDrawer
        open={!!eisDrawerTicker}
        onClose={() => setEisDrawerTicker(null)}
        ticker={eisDrawerTicker}
        it={lang === "it"}
      />
    </div>
  );
}
