import { fetchProjectJson } from "./projectData";
import type { EisMagnitudeAnalysisDoc } from "./signalCalibrationData";
import { mergeEisMagnitudeAnalysis, isSynthesizedEisScatter } from "../sheet/eisSignalImpactView";

const SNAPSHOT_FILE = "eis_magnitude_analysis.json";
const LS_KEY = "sn_eis_magnitude_v3";

function scatterPointCount(doc: EisMagnitudeAnalysisDoc | null | undefined): number {
  return (
    (doc?.scatter?.delta_p_1d?.points?.length ?? 0) +
    (doc?.scatter?.delta_p_7d?.points?.length ?? 0)
  );
}

function shouldPersistLocalCache(doc: EisMagnitudeAnalysisDoc): boolean {
  if ((doc.n_events_scored ?? 0) <= 0) return false;
  if ((doc.temporal_regression?.length ?? 0) > 0) return true;
  const pts = scatterPointCount(doc);
  if (pts <= 0) return false;
  const n1 = doc.n_with_price_1d ?? doc.correlation?.n_1d ?? 0;
  if (pts <= 4 && n1 > pts + 5) return false;
  return true;
}

function readLocalCache(): EisMagnitudeAnalysisDoc | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const doc = JSON.parse(raw) as EisMagnitudeAnalysisDoc;
    return (doc?.n_events_scored ?? 0) > 0 ? doc : null;
  } catch {
    return null;
  }
}

export function writeEisMagnitudeLocalCache(doc: EisMagnitudeAnalysisDoc | null | undefined): void {
  if (typeof localStorage === "undefined" || !doc) return;
  if (!shouldPersistLocalCache(doc)) return;
  if (isSynthesizedEisScatter(doc)) return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(doc));
  } catch {
    /* quota */
  }
}

/** Stable chart payload: project-data JSON → localStorage → bundled curve impact. */
export async function loadStableEisMagnitudeAnalysis(
  bundled: EisMagnitudeAnalysisDoc | null | undefined,
): Promise<EisMagnitudeAnalysisDoc | null> {
  let best = bundled ?? null;

  const cached = readLocalCache();
  if (cached) {
    best = mergeEisMagnitudeAnalysis(best ?? undefined, cached) ?? cached;
  }

  const { data: disk } = await fetchProjectJson<EisMagnitudeAnalysisDoc>(SNAPSHOT_FILE);
  if (disk && (disk.n_events_scored ?? 0) > 0) {
    best = mergeEisMagnitudeAnalysis(best ?? undefined, disk) ?? disk;
  }

  return best;
}
