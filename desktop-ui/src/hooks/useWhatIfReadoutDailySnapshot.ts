import { useEffect, useState } from "react";
import {
  WHATIF_READOUT_DAILY_CHANGED_EVENT,
  hydrateWhatIfReadoutDailySnapshot,
  loadWhatIfReadoutDailySnapshotLocal,
  type WhatIfReadoutDailySnapshotStore,
} from "../sheet/whatIfReadoutDailySnapshot";

/** Live view of the append-only daily readout snapshot store (local + hydrated from data/). */
export function useWhatIfReadoutDailySnapshot(): WhatIfReadoutDailySnapshotStore {
  const [store, setStore] = useState(loadWhatIfReadoutDailySnapshotLocal);

  useEffect(() => {
    let cancelled = false;
    void hydrateWhatIfReadoutDailySnapshot().then((hydrated) => {
      if (!cancelled) setStore(hydrated);
    });
    const onChange = () => setStore(loadWhatIfReadoutDailySnapshotLocal());
    window.addEventListener(WHATIF_READOUT_DAILY_CHANGED_EVENT, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(WHATIF_READOUT_DAILY_CHANGED_EVENT, onChange);
    };
  }, []);

  return store;
}
