/**
 * Top KPI live column stores — per-key subscribe so one ticker update
 * does not re-render sibling rows.
 */
import type {
  CatalystAccumulationRow,
  CatalystVsXbiRow,
  EventVolIndexRow,
  SearchInterestRow,
  VolumeAccelRow,
  VolumeVsPrevSessionRow,
} from "../api/supernova";
import type { VolumeCharacterResult } from "./volumeCharacter";
import { createKeyedMapStore, type KeyedMapStore } from "./keyedMapStore";

export type KpiLiveStores = {
  vol: KeyedMapStore<VolumeVsPrevSessionRow>;
  trend: KeyedMapStore<SearchInterestRow>;
  accel: KeyedMapStore<VolumeAccelRow>;
  character: KeyedMapStore<VolumeCharacterResult>;
  /** Momentum inputs (same as Catalyst Days Bias column). */
  eventVol: KeyedMapStore<EventVolIndexRow>;
  accum: KeyedMapStore<CatalystAccumulationRow>;
  vsXbi: KeyedMapStore<CatalystVsXbiRow>;
};

export function createKpiLiveStores(): KpiLiveStores {
  return {
    vol: createKeyedMapStore(),
    trend: createKeyedMapStore(),
    accel: createKeyedMapStore(),
    character: createKeyedMapStore(),
    eventVol: createKeyedMapStore(),
    accum: createKeyedMapStore(),
    vsXbi: createKeyedMapStore(),
  };
}
