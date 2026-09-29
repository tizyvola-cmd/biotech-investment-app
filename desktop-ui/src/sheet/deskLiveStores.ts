/**
 * Catalyst Days live column stores — per-key subscribe so one ticker update
 * does not re-render sibling rows.
 *
 * Stores stay warm in memory; UI notifications can be paused while the user
 * scrolls and re-enabled only on an explicit data recall (Refresh).
 */
import type {
  CatalystAccumulationRow,
  CatalystShortInterestRow,
  CatalystVsXbiRow,
  EventVolIndexRow,
  PreMktConvictionRow,
  SearchInterestRow,
  VolumeVsPrevSessionRow,
} from "../api/supernova";
import { createKeyedMapStore, type KeyedMapStore } from "./keyedMapStore";

export type DeskLiveStores = {
  vol: KeyedMapStore<VolumeVsPrevSessionRow>;
  trend: KeyedMapStore<SearchInterestRow>;
  eventVol: KeyedMapStore<EventVolIndexRow>;
  shortInterest: KeyedMapStore<CatalystShortInterestRow>;
  accum: KeyedMapStore<CatalystAccumulationRow>;
  vsXbi: KeyedMapStore<CatalystVsXbiRow>;
  preMkt: KeyedMapStore<PreMktConvictionRow>;
};

export function createDeskLiveStores(): DeskLiveStores {
  return {
    vol: createKeyedMapStore(),
    trend: createKeyedMapStore(),
    eventVol: createKeyedMapStore(),
    shortInterest: createKeyedMapStore(),
    accum: createKeyedMapStore(),
    vsXbi: createKeyedMapStore(),
    preMkt: createKeyedMapStore(),
  };
}

export function setDeskLiveUiBridge(stores: DeskLiveStores, enabled: boolean): void {
  for (const store of Object.values(stores)) {
    store.setNotifyEnabled(enabled);
  }
}

/** After re-enabling the bridge, flush dirty keys so rows pick up recall data once. */
export function flushDeskLiveUiBridge(stores: DeskLiveStores): number {
  let n = 0;
  for (const store of Object.values(stores)) {
    n += store.flushPending();
  }
  return n;
}
