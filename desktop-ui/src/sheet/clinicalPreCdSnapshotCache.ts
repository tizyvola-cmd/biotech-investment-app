import type { ClinicalPreCdRecord, ClinicalPreCdSnapshot } from "../api/supernova";

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
    const payload: CachedPayload = {
      savedAt: new Date().toISOString(),
      snapshot,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}

export function hydrateClinicalPreCdRecords(): ClinicalPreCdRecord[] {
  const snap = readClinicalPreCdSnapshotCache();
  return Array.isArray(snap?.records) ? snap.records : [];
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
