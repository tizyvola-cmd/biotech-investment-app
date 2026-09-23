import { fetchProjectJson } from "../data/projectData";
import { eisCdDistanceFactor } from "./cdPatternHorizons";

export type EisSuperScoreWindowState = {
  cal_factor?: number;
};

export type EisSuperScoreState = {
  global_score_blend?: number;
  windows?: Record<string, EisSuperScoreWindowState>;
};

const CD_BIN_LABELS: Array<{ lo: number; hi: number; label: string }> = [
  { lo: 181, hi: 9999, label: "180d+" },
  { lo: 121, hi: 180, label: "121–180d" },
  { lo: 91, hi: 120, label: "91–120d" },
  { lo: 61, hi: 90, label: "61–90d" },
  { lo: 46, hi: 60, label: "46–60d" },
  { lo: 31, hi: 45, label: "31–45d" },
  { lo: 16, hi: 30, label: "16–30d" },
  { lo: 8, hi: 15, label: "8–15d" },
  { lo: 0, hi: 7, label: "0–7d" },
];

function resolveBinLabel(daysBeforeCd: number | null): string | null {
  if (daysBeforeCd == null || daysBeforeCd < 0) return null;
  const d = Math.round(daysBeforeCd);
  for (const b of CD_BIN_LABELS) {
    if (d >= b.lo && d <= b.hi) return b.label;
  }
  return null;
}

export function computeEisSuperScore(
  eisScore: number,
  daysBeforeCd: number | null,
  state?: EisSuperScoreState | null,
): number {
  const { factor } = eisCdDistanceFactor(daysBeforeCd);
  const raw = eisScore * factor;
  const label = resolveBinLabel(daysBeforeCd);
  const cal = label && state?.windows?.[label]?.cal_factor != null ? state.windows[label].cal_factor! : 1;
  const blend = state?.global_score_blend ?? 0.6;
  const learned = raw * cal;
  return Math.round((blend * learned + (1 - blend) * raw) * 10) / 10;
}

export function parseEisSuperScoreState(raw: unknown): EisSuperScoreState | null {
  if (!raw || typeof raw !== "object") return null;
  const doc = raw as Record<string, unknown>;
  return {
    global_score_blend: typeof doc.global_score_blend === "number" ? doc.global_score_blend : 0.6,
    windows: doc.windows as Record<string, EisSuperScoreWindowState> | undefined,
  };
}

export async function loadEisSuperScoreState(): Promise<EisSuperScoreState | null> {
  const { data } = await fetchProjectJson<Record<string, unknown>>("eis_super_score_learning.json");
  return parseEisSuperScoreState(data);
}
