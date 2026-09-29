/**
 * Vertical lanes for price-chart catalyst banners so nearby dates do not
 * paint over each other (same-day stacking plus horizontal overlap).
 */

export const CATALYST_TYPE_LABELS: Record<string, string> = {
  cd: "CD",
  readout: "READOUT",
  submission: "SUBMISSION",
  approval: "APPROVAL",
  pdufa: "PDUFA",
  partnership: "PARTNERSHIP",
  preclinical: "PRECLINICAL",
  initiation: "INITIATION",
  fda_vote: "FDA VOTE",
  fda_safety: "FDA SAFETY",
  other: "CATALYST",
};

export const CATALYST_BADGE_GAP_PX = 10;
/** Assumed plot inner width — narrower than typical so we stack earlier, never clip. */
export const CATALYST_LANE_PLOT_WIDTH_PX = 480;
/** Hard cap so stacked banners cannot consume the price-line plot height. */
export const CATALYST_MAX_LANES = 2;

/** Compact phase for chart badges: PHASE2 / Phase 2 → "2". */
export function catalystPhaseShort(phase: string | null | undefined): string | null {
  const raw = String(phase || "").trim();
  if (!raw) return null;
  const spaced = raw.replace(/[_-]/g, " ").replace(/\s+/g, " ").trim();
  const combo = /^phase\s*([1-4])\s*\/\s*(?:phase\s*)?([1-4])$/i.exec(spaced);
  if (combo) return `${combo[1]}/${combo[2]}`;
  const m = /^(?:early\s+)?phase\s*([1-4])([ab])?$/i.exec(spaced);
  if (m) return `${m[1]}${(m[2] || "").toUpperCase()}`;
  const glued = /^phase\s*([1-4](?:\s*\/\s*[1-4])?[ab]?)$/i.exec(spaced.replace(/\s+/g, ""));
  if (glued) return glued[1].replace(/\s+/g, "").toUpperCase().replace(/PHASE/i, "");
  const only = /^([1-4](?:\/[1-4])?[ab]?)$/i.exec(spaced.replace(/\s+/g, ""));
  if (only) return only[1].toUpperCase();
  // PHASE2 without space
  const compact = spaced.replace(/\s+/g, "").toUpperCase();
  const p2 = /^PHASE([1-4](?:\/[1-4])?[AB]?)$/.exec(compact);
  if (p2) return p2[1];
  return spaced.length <= 6 ? spaced : spaced.slice(0, 6);
}

export function catalystBadgeBox(
  eventType: string,
  phase: string | null | undefined,
  dateLabel: string | null | undefined,
): { w: number; h: number; label: string } {
  const key = eventType || "other";
  const typeLabel = CATALYST_TYPE_LABELS[key] || key.toUpperCase();
  const short = catalystPhaseShort(phase);
  const phaseBit = short ? ` Ph${short}` : "";
  const label = `${typeLabel}${phaseBit}`;
  return {
    w: Math.max(label.length * 5.6 + 12, 48),
    h: dateLabel ? 24 : 16,
    label,
  };
}

export function catalystLaneTopPad(laneCount: number): number {
  const lanes = Math.min(Math.max(laneCount, 1), CATALYST_MAX_LANES);
  const h = 24;
  return Math.max(40, 8 + lanes * (h + CATALYST_BADGE_GAP_PX));
}

/**
 * Lowest-lane packing: items that overlap on X get distinct lanes (0 = top).
 * Returns a lane per input item (same order).
 */
export function assignOverlapLanesByX(
  items: { xIndex: number; widthPx: number }[],
  seriesLen: number,
  plotWidthPx = CATALYST_LANE_PLOT_WIDTH_PX,
): number[] {
  if (!items.length) return [];
  const n = Math.max(seriesLen, 2);
  const tickPx = plotWidthPx / (n - 1);
  const work = items.map((it, i) => ({
    i,
    x: it.xIndex,
    half: (it.widthPx / 2 + 8) / tickPx,
  }));
  work.sort((a, b) => a.x - b.x || a.i - b.i);
  const lanes = Array.from({ length: items.length }, () => 0);
  const placed: { x: number; half: number; lane: number }[] = [];
  for (const w of work) {
    let lane = 0;
    while (
      lane < CATALYST_MAX_LANES &&
      placed.some((p) => p.lane === lane && Math.abs(p.x - w.x) < p.half + w.half)
    ) {
      lane += 1;
    }
    if (lane >= CATALYST_MAX_LANES) {
      lanes[w.i] = -1;
      continue;
    }
    placed.push({ x: w.x, half: w.half, lane });
    lanes[w.i] = lane;
  }
  return lanes;
}
