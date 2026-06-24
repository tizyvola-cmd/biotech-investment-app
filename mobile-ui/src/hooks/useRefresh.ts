import { useCallback, useState } from "react";
import {
  checkHealth,
  fetchMobileDashboardSnapshot,
  fetchSimInputs,
  fetchSimulationChartsBundle,
  fetchSimulationSheet,
  formatNetworkError,
  getApiBase,
} from "../api";
import { t } from "../i18n";
import { getMobileLang } from "../langStorage";
import type { MobileDashboardSnapshot } from "../dashboardTypes";
import type { ChartBundle, InvestSimInputs, SheetTable } from "../types";

export type RefreshResult = {
  sheet: SheetTable;
  inputs: InvestSimInputs;
  inputsUpdatedAt: string | null;
  dashSnapshot: MobileDashboardSnapshot | null;
  chartBundle: ChartBundle | null;
  apiOk: boolean;
  workbookNote?: string;
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

    const [sheetRes, inputsRes, snapRes, bundleRes] = await Promise.allSettled([
      fetchSimulationSheet(),
      fetchSimInputs(testerId ?? undefined),
      fetchMobileDashboardSnapshot(),
      fetchSimulationChartsBundle(),
    ]);

    const tbl =
      sheetRes.status === "fulfilled"
        ? sheetRes.value
        : { ...EMPTY_SHEET, error: sheetRes.reason instanceof Error ? sheetRes.reason.message : String(sheetRes.reason) };

    const persisted =
      inputsRes.status === "fulfilled"
        ? inputsRes.value
        : { version: 1 as const, updated_at: null, inputs: {} as InvestSimInputs };

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

    return {
      sheet: tbl,
      inputs: persisted.inputs ?? {},
      inputsUpdatedAt: persisted.updated_at ?? null,
      dashSnapshot: snap?.updated_at ? snap : null,
      chartBundle: bundle,
      apiOk,
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
