import { useSyncExternalStore } from "react";
import type { LossAnalysisProfile } from "./portfolioLossAnalysis";

const LOSS_ANALYSIS_PROFILE_KEY = "supernova_loss_analysis_profile_v1";

const listeners = new Set<() => void>();

function readStored(): LossAnalysisProfile {
  if (typeof window === "undefined") return "portfolio";
  try {
    const raw = localStorage.getItem(LOSS_ANALYSIS_PROFILE_KEY);
    if (raw === "opportunities" || raw === "portfolio" || raw === "catalysts") return raw;
  } catch {
    /* ignore */
  }
  return "portfolio";
}

let current: LossAnalysisProfile = readStored();

function emit() {
  for (const fn of listeners) fn();
}

export function getEvalLabProfile(): LossAnalysisProfile {
  return current;
}

export function setEvalLabProfile(next: LossAnalysisProfile): void {
  if (next === current) return;
  current = next;
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(LOSS_ANALYSIS_PROFILE_KEY, next);
    } catch {
      /* ignore */
    }
  }
  emit();
}

export function subscribeEvalLabProfile(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useEvalLabProfile(): LossAnalysisProfile {
  return useSyncExternalStore(subscribeEvalLabProfile, getEvalLabProfile, getEvalLabProfile);
}

export const EVAL_LAB_PROFILES: readonly LossAnalysisProfile[] = [
  "portfolio",
  "opportunities",
  "catalysts",
];
