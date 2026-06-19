/**
 * EIS Super Score — state loaded from backend JSON; score computed via API
 * (prediction/eis_super_score_learning.compute_super_score).
 *
 * Replaces desktop-ui/src/sheet/eisSuperScore.ts to avoid formula drift.
 */
import { fetchProjectJson } from "../data/projectData";
import { api } from "./supernova";
import { eisCdDistanceFactor } from "../sheet/cdPatternHorizons";

export type EisSuperScoreWindowState = {
  cal_factor?: number;
};

export type EisSuperScoreState = {
  global_score_blend?: number;
  windows?: Record<string, EisSuperScoreWindowState>;
};

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

/** Compute super score using backend Python (source of truth). */
export async function computeEisSuperScore(
  eisScore: number,
  daysBeforeCd: number | null,
  _state?: EisSuperScoreState | null,
): Promise<number> {
  if (!Number.isFinite(eisScore)) return eisScore;
  const doc = await api<{ super_score: number }>("/api/models/eis-super-score/compute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eis_score: eisScore, days_before_cd: daysBeforeCd }),
  });
  return doc.super_score;
}

export function computeEisSuperScoreSync(
  eisScore: number,
  daysBeforeCd: number | null,
  state?: EisSuperScoreState | null,
): number {
  if (!Number.isFinite(eisScore)) return eisScore;
  const { factor } = eisCdDistanceFactor(daysBeforeCd);
  const raw = eisScore * factor;
  const bins: Array<{ lo: number; hi: number; label: string }> = [
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
  let label: string | null = null;
  if (daysBeforeCd != null && daysBeforeCd >= 0) {
    const d = Math.round(daysBeforeCd);
    for (const b of bins) {
      if (d >= b.lo && d <= b.hi) {
        label = b.label;
        break;
      }
    }
  }
  const cal = label && state?.windows?.[label]?.cal_factor != null ? state.windows[label].cal_factor! : 1;
  const blend = state?.global_score_blend ?? 0.6;
  const learned = raw * cal;
  return Math.round((blend * learned + (1 - blend) * raw) * 10) / 10;
}
