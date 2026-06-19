import { useEffect, useState } from "react";
import { fetchLearningLabOverview } from "../api/supernova";
import {
  parseCdPatternPolygonOverview,
  type CdPatternPolygonOverview,
} from "./cdPatternPolygonAccuracyView";

let cachedOverview: CdPatternPolygonOverview | null | undefined;
let inflight: Promise<CdPatternPolygonOverview | null> | null = null;

/** Shared loader — one Learning Lab fetch per session for polygon ρ timeline. */
export async function loadCdPatternPolygonOverview(): Promise<CdPatternPolygonOverview | null> {
  if (cachedOverview !== undefined) return cachedOverview;
  if (inflight) return inflight;
  inflight = fetchLearningLabOverview()
    .then((doc) => {
      cachedOverview = parseCdPatternPolygonOverview(doc.cd_pattern_polygon);
      return cachedOverview;
    })
    .catch(() => {
      cachedOverview = null;
      return null;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function invalidateCdPatternPolygonOverviewCache(): void {
  cachedOverview = undefined;
}

/** Reuse polygon slice from a Learning Lab overview response (avoids duplicate /overview fetch). */
export function seedCdPatternPolygonOverviewFromLab(
  doc: { cd_pattern_polygon?: unknown } | null | undefined,
): void {
  cachedOverview = parseCdPatternPolygonOverview(doc?.cd_pattern_polygon);
}

export function useCdPatternPolygonOverview(): CdPatternPolygonOverview | null {
  const [overview, setOverview] = useState<CdPatternPolygonOverview | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadCdPatternPolygonOverview().then((doc) => {
      if (!cancelled) setOverview(doc);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return overview;
}
