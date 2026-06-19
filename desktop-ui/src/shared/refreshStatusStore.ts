/**
 * Store globale dello stato refresh dati condiviso tra Decision Lab,
 * Simulation e qualunque altra tab voglia mostrare badge live + timestamp
 * ultimo aggiornamento.
 *
 * Il backend ha un solo lock per il refresh server-side (`launch_refresh_fast.py`),
 * quindi anche se due tab montano ciascuna un `RefreshDataModal` il polling
 * legge lo stesso job e gli aggiornamenti convergono. Questo store serve per:
 *
 *   1. permettere a una tab di sapere se un'altra ha appena fatto partire
 *      un refresh (badge ⏳ visibile ovunque, non solo in Decision Lab);
 *   2. mostrare in tutte le tab l'orario dell'ultima rilettura locale
 *      ("Updated 19:42 · 21 Simulation rows").
 *
 * Pattern: store minimale con subscribe/getSnapshot per `useSyncExternalStore`
 * — niente librerie esterne, niente React Context (più semplice da usare).
 */

import { useSyncExternalStore } from "react";

export type RefreshState =
  | "idle"
  | "starting"
  | "running"
  | "exporting"
  | "post-pipeline"
  | "ok"
  | "error";

export type RefreshProfile = "daily" | "sunday";

/** Long refresh = daily fast or Sunday orchestrator; short = dry-run / quick tests. */
export type RefreshDurationClass = "long" | "short";

export type RefreshLifecycleInfo = {
  state: RefreshState;
  elapsedSec: number;
  message: string;
  profile: RefreshProfile;
};

const IDLE: RefreshLifecycleInfo = {
  state: "idle",
  elapsedSec: 0,
  message: "",
  profile: "daily",
};

import type { OrchestratorRunSummary } from "../api/refresh";

export type SundayRefreshResult = {
  success: boolean;
  elapsedSec: number;
  message: string;
  exitCode: number | null;
  summary?: OrchestratorRunSummary | null;
};

type RefreshSnapshot = {
  life: RefreshLifecycleInfo;
  finishedAt: Date | null;
  lastReloadAt: Date | null;
  /** ISO from desktop manifest / workbook — authoritative pipeline refresh time. */
  dataUpdatedAt: string | null;
  /** Mirrors App health poller — shared for RefreshControls / RefreshDataModal. */
  apiOk: boolean | null;
  /** Full refresh modal open (single instance mounted in App). */
  modalOpen: boolean;
  /** After reload, run portfolio diff + optional alerts modal. */
  pendingPortfolioReview: boolean;
  /** Active server refresh profile (daily fast vs sunday orchestrator). */
  profile: RefreshProfile;
  /** Whether the in-flight/completed refresh is a long pipeline (vs dry-run). */
  durationClass: RefreshDurationClass;
  /** Modal should call start immediately (Saturday autostart). */
  pendingAutoStart: boolean;
  /** Sunday full completion popup (separate from daily portfolio alerts). */
  sundayResultOpen: boolean;
  sundayResult: SundayRefreshResult | null;
  /** Ultimo esito domenica full (resta dopo chiusura popup). */
  lastSundayResult: SundayRefreshResult | null;
  lastSundayFinishedAt: Date | null;
};

let snapshot: RefreshSnapshot = {
  life: IDLE,
  finishedAt: null,
  lastReloadAt: null,
  dataUpdatedAt: null,
  apiOk: null,
  modalOpen: false,
  pendingPortfolioReview: false,
  profile: "daily",
  durationClass: "long",
  pendingAutoStart: false,
  sundayResultOpen: false,
  sundayResult: null,
  lastSundayResult: null,
  lastSundayFinishedAt: null,
};

const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((fn) => fn());
}

export function getRefreshSnapshot(): RefreshSnapshot {
  return snapshot;
}

/** True mentre modale refresh o job server sono in corso (evita reload manifest a catena). */
export function isRefreshInFlight(): boolean {
  const s = snapshot.life.state;
  return (
    s === "starting" ||
    s === "running" ||
    s === "exporting" ||
    s === "post-pipeline"
  );
}

export function subscribeRefresh(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Costruisce lifecycle info con profile di fallback (store o daily). */
export function makeRefreshLife(
  partial: Pick<RefreshLifecycleInfo, "state" | "elapsedSec" | "message"> & {
    profile?: RefreshProfile;
  }
): RefreshLifecycleInfo {
  return {
    state: partial.state,
    elapsedSec: partial.elapsedSec,
    message: partial.message,
    profile: partial.profile ?? snapshot.profile ?? "daily",
  };
}

export function setRefreshLife(life: RefreshLifecycleInfo): void {
  if (
    snapshot.life.state === life.state &&
    snapshot.life.elapsedSec === life.elapsedSec &&
    snapshot.life.message === life.message &&
    snapshot.life.profile === life.profile
  ) {
    return;
  }
  let finishedAt = snapshot.finishedAt;
  if ((life.state === "ok" || life.state === "error") && snapshot.life.state !== life.state) {
    finishedAt = new Date();
  }
  if (life.state === "starting" || life.state === "running") {
    finishedAt = null;
  }
  snapshot = { ...snapshot, life, finishedAt };
  emit();
}

export function markReloadCompleted(): void {
  snapshot = { ...snapshot, lastReloadAt: new Date() };
  emit();
}

export function setDataUpdatedAt(iso: string | null): void {
  const next = iso?.trim() || null;
  if (snapshot.dataUpdatedAt === next) return;
  snapshot = { ...snapshot, dataUpdatedAt: next };
  emit();
}

export function setRefreshStoreApiOk(ok: boolean | null): void {
  if (snapshot.apiOk === ok) return;
  snapshot = { ...snapshot, apiOk: ok };
  emit();
}

export function setRefreshModalOpen(open: boolean): void {
  if (snapshot.modalOpen === open) return;
  snapshot = { ...snapshot, modalOpen: open };
  if (!open) snapshot = { ...snapshot, pendingAutoStart: false };
  emit();
}

export function setRefreshProfile(profile: RefreshProfile): void {
  if (snapshot.profile === profile) return;
  snapshot = { ...snapshot, profile };
  emit();
}

export function setRefreshDurationClass(durationClass: RefreshDurationClass): void {
  if (snapshot.durationClass === durationClass) return;
  snapshot = { ...snapshot, durationClass };
  emit();
}

export function getRefreshDurationClass(): RefreshDurationClass {
  return snapshot.durationClass;
}

/** Sabato mattina: apre modale + avvia orchestrator domenica full. */
export function requestSundayFullAutostart(): void {
  snapshot = {
    ...snapshot,
    profile: "sunday",
    modalOpen: true,
    pendingAutoStart: true,
  };
  emit();
}

export function clearPendingAutoStart(): void {
  if (!snapshot.pendingAutoStart) return;
  snapshot = { ...snapshot, pendingAutoStart: false };
  emit();
}

export function showSundayRefreshResult(result: SundayRefreshResult): void {
  snapshot = {
    ...snapshot,
    sundayResult: result,
    sundayResultOpen: true,
    lastSundayResult: result,
    lastSundayFinishedAt: new Date(),
    profile: "daily",
  };
  emit();
}

export function closeSundayRefreshResult(): void {
  if (!snapshot.sundayResultOpen) return;
  snapshot = { ...snapshot, sundayResultOpen: false };
  emit();
}

/** Riapre il popup con l'ultimo esito domenica full (es. da System → Settings). */
export function reopenSundayRefreshResult(): void {
  const result = snapshot.sundayResult ?? snapshot.lastSundayResult;
  if (!result) return;
  snapshot = { ...snapshot, sundayResult: result, sundayResultOpen: true };
  emit();
}

export function requestPortfolioReviewAfterReload(): void {
  if (snapshot.pendingPortfolioReview) return;
  snapshot = { ...snapshot, pendingPortfolioReview: true };
  emit();
}

export function clearPortfolioReviewPending(): void {
  if (!snapshot.pendingPortfolioReview) return;
  snapshot = { ...snapshot, pendingPortfolioReview: false };
  emit();
}

/** Hook React: legge lo snapshot reattivo. */
export function useRefreshStatus(): RefreshSnapshot {
  return useSyncExternalStore(subscribeRefresh, getRefreshSnapshot, getRefreshSnapshot);
}
