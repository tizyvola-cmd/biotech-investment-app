import { useCallback, useState } from "react";
import {
  checkHealth,
  fetchClinicalPreCdSnapshot,
  fetchMarketContextMcsSnapshot,
  fetchMobileDashboardSnapshot,
  refreshMobileDashboardSnapshot,
  fetchRegulatoryRiskSnapshot,
  fetchSdsByTicker,
  fetchCompanionSimInputs,
  fetchSimulationChartsBundle,
  fetchSimulationSheet,
  formatNetworkError,
  getApiBase,
  saveSimInputs,
  type RegulatoryRiskSnapshot,
} from "../api";
import type { MarketContextSnapshotDoc } from "../mobileMarketContext";
import { resolveMobileDashboardSnapshot } from "../buildLocalMobileDashboardSnapshot";
import { snapshotHasDecisionChartData } from "../decisionChartSnapshot";
import { isSnapshotStale } from "../mobileDashboard";
import { enrichSnapshotFromManualStore, fetchManualFeedStore, type ManualFeedStoreFile } from "../manualFeedStore";
import { mergeManualStoreIntoClinicalRecords } from "../manualFeedClinicalMerge";
import { hydrateMedtechSymbolsFromApi, medtechTickersForSnapshot } from "../medtechSymbols";
import { t } from "../i18n";
import { getMobileLang } from "../langStorage";
import type { ClinicalPreCdRecord } from "../api";
import type { MobileDashboardSnapshot } from "../dashboardTypes";
import type { ChartBundle, InvestSimInputs, SheetTable } from "../types";
import {
  alignOpenBookToDesktopPulse,
  openBookCapital,
  openKeysFromPositions,
  restoreOpensFromPulseAuthority,
  unionOpenBooks,
} from "../mobileTradeBook";

/** Prefer desktop-published book in snapshot over lagging VPS sim-inputs file. */
export function resolveInputsFromDesktopSnapshot(
  serverSnap: MobileDashboardSnapshot | null,
  persisted: {
    inputs: InvestSimInputs;
    updated_at: string | null;
    source?: string;
  },
): {
  inputs: InvestSimInputs;
  updatedAt: string | null;
  source: "desktop-snap" | "shared" | "tester" | "empty";
  /** True when Pulse openPositions closed stale VPS ghost opens. */
  alignedToPulse?: boolean;
} {
  const snapInputs = serverSnap?.investSimInputs;
  // Prefer book-specific stamp — never treat a fresh Soft-list publish as a
  // newer invest book (that used to win over a just-saved mobile BUY).
  const snapAt = serverSnap?.investSimInputsUpdatedAt ?? null;
  const snapCap = openBookCapital(snapInputs);
  const fileCap = openBookCapital(persisted.inputs);
  const fileAt = persisted.updated_at;
  const snapMs = snapAt ? Date.parse(snapAt) : 0;
  const fileMs = fileAt ? Date.parse(fileAt) : 0;
  const persistedSource =
    persisted.source === "shared" || persisted.source === "tester"
      ? persisted.source
      : fileCap > 0
        ? "shared"
        : "empty";

  const pulseKeys = openKeysFromPositions(serverSnap?.openPositions);
  const finish = (
    inputs: InvestSimInputs,
    updatedAt: string | null,
    source: "desktop-snap" | "shared" | "tester" | "empty",
  ) => {
    if (pulseKeys.size === 0) {
      return { inputs, updatedAt, source };
    }
    const authority = serverSnap?.investSimInputs ?? inputs;
    const restored = restoreOpensFromPulseAuthority(inputs, authority, pulseKeys);
    const aligned = alignOpenBookToDesktopPulse(restored, pulseKeys);
    const final = restoreOpensFromPulseAuthority(aligned, authority, pulseKeys);
    return {
      inputs: final,
      updatedAt,
      source,
      alignedToPulse: openBookCapital(final) !== openBookCapital(inputs),
    };
  };

  // Mobile BUY/SELL writes sim-inputs with a fresh updated_at. File wins whenever
  // it is at least as new as the snapshot book stamp (tie → keep file + union).
  if (fileMs > 0 && fileCap > 0 && (snapMs <= 0 || fileMs >= snapMs)) {
    return finish(
      unionOpenBooks(persisted.inputs ?? {}, snapInputs),
      fileAt,
      persistedSource === "empty" ? "shared" : persistedSource,
    );
  }

  if (snapCap > 0 && snapInputs) {
    // Snapshot book stamp fresher — still keep mobile-only opens / sells.
    return finish(
      unionOpenBooks(snapInputs, persisted.inputs),
      snapAt,
      "desktop-snap",
    );
  }

  return finish(
    unionOpenBooks(persisted.inputs ?? {}, snapInputs),
    fileAt ?? null,
    persistedSource,
  );
}

export type MobileScoreEnrichment = {
  sdsByTicker: Map<string, number>;
  regSnap: RegulatoryRiskSnapshot | null;
  mcsDoc: MarketContextSnapshotDoc | null;
};

export type RefreshResult = {
  sheet: SheetTable;
  inputs: InvestSimInputs;
  inputsUpdatedAt: string | null;
  dashSnapshot: MobileDashboardSnapshot | null;
  chartBundle: ChartBundle | null;
  scoreEnrichment: MobileScoreEnrichment;
  clinicalRecordsMerged: ClinicalPreCdRecord[];
  manualFeedStore: ManualFeedStoreFile | null;
  apiOk: boolean;
  workbookNote?: string;
  /** Set when stale snapshot rebuild on VPS failed (e.g. missing API token). */
  snapshotSyncWarning?: string | null;
  /** Which sim-inputs book was loaded (desktop shared vs tester sandbox). */
  bookSource?: "shared" | "tester" | "empty";
};

const EMPTY_SHEET: SheetTable = { sheet: "simulation", columns: [], rows: [] };

export function useRefresh(testerId?: string | null) {
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const reloadData = useCallback(async (): Promise<RefreshResult> => {
    try {
      await checkHealth({ timeoutMs: 25_000 });
    } catch (e) {
      throw new Error(formatNetworkError(e, getApiBase() || undefined));
    }

    const [sheetRes, inputsRes, snapRes, bundleRes, clinicalRes, sdsRes, regRes, mcsRes] =
      await Promise.allSettled([
        fetchSimulationSheet(),
        fetchCompanionSimInputs(testerId ?? undefined),
        fetchMobileDashboardSnapshot(),
        fetchSimulationChartsBundle(),
        fetchClinicalPreCdSnapshot(),
        fetchSdsByTicker(),
        fetchRegulatoryRiskSnapshot(),
        fetchMarketContextMcsSnapshot(),
      ]);

    const tbl =
      sheetRes.status === "fulfilled"
        ? sheetRes.value
        : { ...EMPTY_SHEET, error: sheetRes.reason instanceof Error ? sheetRes.reason.message : String(sheetRes.reason) };

    const persisted =
      inputsRes.status === "fulfilled"
        ? inputsRes.value
        : {
            version: 1 as const,
            updated_at: null,
            inputs: {} as InvestSimInputs,
            source: "empty" as const,
          };

    const snap =
      snapRes.status === "fulfilled"
        ? snapRes.value
        : ({ version: 1, updated_at: null, source: "error" } as MobileDashboardSnapshot);

    const sheetFailed = sheetRes.status === "rejected" && !(tbl.rows?.length);
    if (sheetFailed) {
      const lang = getMobileLang();
      const reason =
        sheetRes.status === "rejected"
          ? sheetRes.reason instanceof Error
            ? sheetRes.reason.message
            : String(sheetRes.reason)
          : t("error.apiOfflineDev", lang);
      throw new Error(reason);
    }

    const apiOk = true;

    const bundle =
      bundleRes.status === "fulfilled" && bundleRes.value?.series ? bundleRes.value : null;

    const clinicalRecords =
      clinicalRes.status === "fulfilled" ? clinicalRes.value?.records ?? [] : [];

    let serverSnap =
      snap?.updated_at ? (snap as MobileDashboardSnapshot) : null;

    let snapshotSyncWarning: string | null = null;
    // Rebuild when stale / missing charts — even if desktop left openPositions behind.
    // Mobile must stay usable with desktop closed (VPS data/ + invest_sim_inputs).
    const needsDecisionCharts = !snapshotHasDecisionChartData(serverSnap);
    const snapStale = isSnapshotStale(serverSnap?.updated_at);
    if (needsDecisionCharts || snapStale || !serverSnap) {
      try {
        const prevOpen = serverSnap?.openPositions;
        const prevAlloc = serverSnap?.allocation;
        const prevInputs = serverSnap?.investSimInputs;
        const prevSoftBuys = serverSnap?.softBuys;
        const prevSoftSells = serverSnap?.softSells;
        const prevPriorDay = serverSnap?.priorDayBook;
        await refreshMobileDashboardSnapshot();
        const refreshed = await fetchMobileDashboardSnapshot();
        if (refreshed?.updated_at) {
          serverSnap = refreshed;
          // Preserve Pulse book if the server rebuild omitted/collapsed opens.
          if (
            prevOpen &&
            prevOpen.length > 0 &&
            (!(serverSnap.openPositions?.length) ||
              serverSnap.openPositions.length !== prevOpen.length)
          ) {
            serverSnap = {
              ...serverSnap,
              openPositions: prevOpen,
              allocation: prevAlloc ?? serverSnap.allocation,
              investSimInputs: prevInputs ?? serverSnap.investSimInputs,
            };
          }
          // Soft BUY/SELL: empty array = Home "None now" (authoritative).
          // Only backfill when the rebuild omitted the field entirely — never
          // resurrect stale softSells after Suggested SELL cleared (false push).
          {
            const softBuys =
              Array.isArray(serverSnap.softBuys)
                ? serverSnap.softBuys
                : Array.isArray(prevSoftBuys)
                  ? prevSoftBuys
                  : serverSnap.softBuys;
            const softSells =
              Array.isArray(serverSnap.softSells)
                ? serverSnap.softSells
                : Array.isArray(prevSoftSells)
                  ? prevSoftSells
                  : serverSnap.softSells;
            if (
              softBuys !== serverSnap.softBuys ||
              softSells !== serverSnap.softSells
            ) {
              serverSnap = { ...serverSnap, softBuys, softSells };
            }
          }
          if (!serverSnap.priorDayBook && prevPriorDay) {
            serverSnap = { ...serverSnap, priorDayBook: prevPriorDay };
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        snapshotSyncWarning =
          /401|token|Missing or invalid/i.test(msg)
            ? t("sync.tokenRequired", getMobileLang())
            : t("sync.rebuildFailed", getMobileLang(), { detail: msg.slice(0, 100) });
      }
    }

    const scoreEnrichment: MobileScoreEnrichment = {
      sdsByTicker: sdsRes.status === "fulfilled" ? sdsRes.value : new Map(),
      regSnap: regRes.status === "fulfilled" ? regRes.value : null,
      mcsDoc: mcsRes.status === "fulfilled" ? mcsRes.value : null,
    };

    // Per-email tester book: never merge operator Pulse opens into the account.
    const snapBook =
      persisted.source === "tester" || Boolean(testerId)
        ? {
            inputs: persisted.inputs ?? {},
            updatedAt: persisted.updated_at,
            source: (persisted.source === "tester" || openBookCapital(persisted.inputs) > 0
              ? "tester"
              : "empty") as "tester" | "empty",
          }
        : resolveInputsFromDesktopSnapshot(serverSnap, persisted);

    // Heal shared VPS book when Pulse openPositions closed ghost opens.
    if (
      snapBook.alignedToPulse &&
      snapBook.source !== "tester" &&
      persisted.source !== "tester" &&
      openBookCapital(snapBook.inputs) >= 0
    ) {
      void saveSimInputs(snapBook.inputs, null).catch(() => {
        /* best-effort — desktop sync also prunes */
      });
    }

    const dashSnapshot = resolveMobileDashboardSnapshot({
      server: serverSnap,
      sheet: tbl,
      inputs: snapBook.inputs,
      chartBundle: bundle,
      clinicalRecords,
      lang: getMobileLang(),
      sdsByTicker: scoreEnrichment.sdsByTicker,
    });

    const apiBase = getApiBase();
    await hydrateMedtechSymbolsFromApi(apiBase);
    const manualStore = await fetchManualFeedStore(apiBase);
    const scopeTickers = new Set<string>();
    for (const r of tbl.rows ?? []) {
      const tk = String(r.Ticker ?? "").trim().toUpperCase();
      if (tk && !tk.includes("TOTALE")) scopeTickers.add(tk);
    }
    for (const draft of manualStore?.events ?? []) {
      const tk = String(draft.ticker ?? "").trim().toUpperCase();
      if (tk) scopeTickers.add(tk);
    }
    const enrichedDashSnapshot = {
      ...enrichSnapshotFromManualStore(dashSnapshot, manualStore, scopeTickers),
      medtechTickers: medtechTickersForSnapshot(),
    };
    const clinicalRecordsMerged = mergeManualStoreIntoClinicalRecords(clinicalRecords, manualStore);

    const bookSource = snapBook.source;
    const emptyBookHint =
      bookSource === "empty" && !testerId
        ? getMobileLang() === "it"
          ? "Portafoglio vuoto — apri la Home desktop (sincronizza il book), poi ↻ Aggiorna qui."
          : "Empty book — open desktop Home (syncs the book), then ↻ Refresh here."
        : bookSource === "empty" && testerId
          ? getMobileLang() === "it"
            ? "Portafoglio vuoto — stesso account email del desktop. Apri posizioni dal desktop o dalla simulazione."
            : "Empty book — same email account as desktop. Open positions from desktop or Simulation."
          : undefined;

    return {
      sheet: tbl,
      inputs: snapBook.inputs,
      inputsUpdatedAt: snapBook.updatedAt,
      dashSnapshot: enrichedDashSnapshot,
      chartBundle: bundle,
      scoreEnrichment,
      clinicalRecordsMerged,
      manualFeedStore: manualStore,
      apiOk,
      bookSource:
        testerId
          ? "tester"
          : bookSource === "desktop-snap" || bookSource === "shared" || bookSource === "tester"
            ? bookSource === "desktop-snap"
              ? "shared"
              : bookSource
            : "empty",
      snapshotSyncWarning: snapshotSyncWarning ?? emptyBookHint ?? null,
      workbookNote:
        tbl.error && tbl.rows?.length
          ? String(tbl.workbook_note || tbl.error)
          : sheetRes.status === "rejected"
            ? sheetRes.reason instanceof Error
              ? sheetRes.reason.message
              : String(sheetRes.reason)
            : undefined,
    };
  }, [testerId]);

  const applyReload = useCallback(
    async (apply: (r: RefreshResult) => void, onError: (msg: string) => void) => {
      setLoading(true);
      try {
        const result = await reloadData();
        apply(result);
        setLastUpdate(new Date());
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [reloadData],
  );

  /** ↻ Aggiorna = ricarica snapshot/simulation dal server (no pipeline refresh). */
  const refresh = applyReload;
  const reloadOnly = applyReload;

  return { refresh, reloadOnly, reloadData, loading, lastUpdate };
}
