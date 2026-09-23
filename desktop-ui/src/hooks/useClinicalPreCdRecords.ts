import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchClinicalPreCdSnapshot, type ClinicalPreCdRecord } from "../api/supernova";
import {
  readBaseClinicalPreCdRecords,
  readClinicalPreCdSnapshotCache,
  readClinicalPreCdSnapshotSavedAt,
  writeClinicalPreCdSnapshotCache,
} from "../sheet/clinicalPreCdSnapshotCache";
import { isDashboardPanelStale } from "../sheet/dashboardPanelDailyRefresh";
import {
  MANUAL_FEED_EVENTS_CHANGED_EVENT,
  mergeManualEventsIntoRecords,
} from "../sheet/manualFeedEvents";

const DAILY_CHECK_MS = 60 * 60 * 1000;
export const CLINICAL_PRE_CD_CHANGED_EVENT = "supernova:clinical-pre-cd-changed";

/** Loads clinical_pre_cd_enrichment_snapshot.json and keeps localStorage cache warm. */
export function useClinicalPreCdRecords() {
  const [baseRecords, setBaseRecords] = useState<ClinicalPreCdRecord[]>(() =>
    readBaseClinicalPreCdRecords(),
  );
  const baseLenRef = useRef(baseRecords.length);
  baseLenRef.current = baseRecords.length;
  const [manualVersion, setManualVersion] = useState(0);
  const [loading, setLoading] = useState(() => baseRecords.length === 0);
  const [updatedAt, setUpdatedAt] = useState<string | null>(() =>
    readClinicalPreCdSnapshotSavedAt(),
  );

  const records = useMemo(
    () => mergeManualEventsIntoRecords(baseRecords),
    [baseRecords, manualVersion],
  );

  const load = useCallback(async (opts?: { force?: boolean }) => {
    const showSpinner = baseLenRef.current === 0;
    if (showSpinner) setLoading(true);
    try {
      const snap = await fetchClinicalPreCdSnapshot({ preferApi: opts?.force });
      const rows = Array.isArray(snap.records) ? snap.records : [];
      const serverAt = snap.updated_at?.trim() ?? null;
      const cachedSnap = readClinicalPreCdSnapshotCache();
      const cachedServerAt = cachedSnap?.updated_at?.trim() ?? null;
      if (
        !opts?.force &&
        serverAt &&
        cachedServerAt &&
        serverAt === cachedServerAt &&
        rows.length === (cachedSnap?.records?.length ?? 0)
      ) {
        setUpdatedAt(readClinicalPreCdSnapshotSavedAt());
        return;
      }
      setBaseRecords(rows);
      writeClinicalPreCdSnapshotCache(snap);
      setUpdatedAt(readClinicalPreCdSnapshotSavedAt());
    } catch {
      setBaseRecords(readBaseClinicalPreCdRecords());
      setUpdatedAt(readClinicalPreCdSnapshotSavedAt());
    } finally {
      setLoading(false);
    }
  }, []);

  /** Fresh daily: fetch at least once per day, re-check hourly + when tab visible. */
  useEffect(() => {
    const maybeRefresh = () => {
      const stale = isDashboardPanelStale(readClinicalPreCdSnapshotSavedAt());
      void load({ force: stale });
    };
    maybeRefresh();
    const intervalId = window.setInterval(maybeRefresh, DAILY_CHECK_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") maybeRefresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  useEffect(() => {
    const onManualChanged = () => setManualVersion((v) => v + 1);
    window.addEventListener(MANUAL_FEED_EVENTS_CHANGED_EVENT, onManualChanged);
    return () =>
      window.removeEventListener(MANUAL_FEED_EVENTS_CHANGED_EVENT, onManualChanged);
  }, []);

  useEffect(() => {
    const onClinicalChanged = () => {
      void load({ force: true });
    };
    window.addEventListener(CLINICAL_PRE_CD_CHANGED_EVENT, onClinicalChanged);
    return () =>
      window.removeEventListener(CLINICAL_PRE_CD_CHANGED_EVENT, onClinicalChanged);
  }, [load]);

  return {
    records,
    loading,
    updatedAt,
    reload: () => load({ force: true }),
  };
}
