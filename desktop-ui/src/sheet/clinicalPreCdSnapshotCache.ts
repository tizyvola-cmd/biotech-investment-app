import type { ClinicalPreCdRecord, ClinicalPreCdSnapshot } from "../api/supernova";
import { mergeManualEventsIntoRecords } from "./manualFeedEvents";

const STORAGE_KEY = "biotech.clinical_pre_cd_snapshot.v1";

type CachedPayload = {
  savedAt: string;
  snapshot: ClinicalPreCdSnapshot;
};

/** Ultimo snapshot enrichment in cache locale (sopravvive a cambio tab / riavvio UI). */
export function readClinicalPreCdSnapshotCache(): ClinicalPreCdSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedPayload;
    if (!parsed?.snapshot || !Array.isArray(parsed.snapshot.records)) return null;
    return parsed.snapshot;
  } catch {
    return null;
  }
}

export function writeClinicalPreCdSnapshotCache(snapshot: ClinicalPreCdSnapshot): void {
  try {
    const serverUpdatedAt = snapshot.updated_at?.trim();
    const payload: CachedPayload = {
      // Prefer server snapshot time so a VPS enrichment invalidates stale browser cache.
      savedAt: serverUpdatedAt || new Date().toISOString(),
      snapshot,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}

/** Snapshot rows only — no user manual feed overlay. */
export function readBaseClinicalPreCdRecords(): ClinicalPreCdRecord[] {
  const snap = readClinicalPreCdSnapshotCache();
  return Array.isArray(snap?.records) ? snap.records : [];
}

/** Cached snapshot + user manual news merged for EIS / 24h / decision chart. */
export function hydrateClinicalPreCdRecords(): ClinicalPreCdRecord[] {
  return mergeManualEventsIntoRecords(readBaseClinicalPreCdRecords());
}

export function readClinicalPreCdSnapshotSavedAt(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedPayload;
    return parsed?.savedAt ?? parsed?.snapshot?.updated_at ?? null;
  } catch {
    return null;
  }
}
