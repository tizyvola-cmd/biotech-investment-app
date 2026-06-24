/** SDS score zones — aligned with SdsScoreReadoutPanel legend. */

export type SdsZoneId = "distant" | "watch" | "candidate" | "supernova";

export const SDS_ZONE_STYLES: Record<
  SdsZoneId,
  { bar: string; text: string; bg: string; label: string }
> = {
  distant: { bar: "#f5b5b5", text: "#9b2335", bg: "#fce8e8", label: "DISTANT" },
  watch: { bar: "#f5d89a", text: "#9a6700", bg: "#fff4e0", label: "WATCH" },
  candidate: { bar: "#b8e986", text: "#3d6b1e", bg: "#eef8e0", label: "CANDIDATE" },
  supernova: { bar: "#6db33f", text: "#2d5016", bg: "#e8f5e0", label: "SUPERNOVA ZONE" },
};

export function sdsZoneId(score: number): SdsZoneId {
  if (score >= 75) return "supernova";
  if (score >= 55) return "candidate";
  if (score >= 30) return "watch";
  return "distant";
}

export function sdsZoneBarColor(score: number): string {
  return SDS_ZONE_STYLES[sdsZoneId(score)].bar;
}

export function sdsZoneTextColor(score: number): string {
  return SDS_ZONE_STYLES[sdsZoneId(score)].text;
}

/** Classi testo SDS — allineate a Simulation tab / SdsScoreCompactCell. */
export function sdsSimulationTableScoreClass(score: number): string {
  const id = sdsZoneId(score);
  if (id === "supernova") return "text-[#059669] font-bold";
  if (id === "candidate") return "text-[#2563eb] font-semibold";
  if (id === "watch") return "text-[#d97706] font-medium";
  return "text-ink-muted";
}
