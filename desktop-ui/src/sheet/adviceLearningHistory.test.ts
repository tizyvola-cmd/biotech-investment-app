import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  ADVICE_LEARNING_AUTO_SNAPSHOT_INTERVAL_MS,
  ADVICE_LEARNING_HISTORY_LIMIT,
  appendSnapshotToHistory,
  buildAdviceLearningSnapshot,
  clearAdviceLearningHistory,
  decideAppendStrategy,
  emptyAdviceLearningHistory,
  loadAdviceLearningHistory,
  recordAdviceLearningSnapshot,
  saveAdviceLearningHistory,
  shouldAutoSnapshot,
  type AdviceLearningSnapshot,
} from "./adviceLearningHistory";
import type { AdviceCalibrationSummary } from "./investDecisionSimAdviceCalibration";
import { emptyAdviceFeedback } from "./adviceFeedback";

function installBrowserShim(): { restore: () => void } {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
  const w = {
    localStorage,
    dispatchEvent: () => true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  const previousWindow = (globalThis as { window?: unknown }).window;
  const previousCustomEvent = (globalThis as { CustomEvent?: unknown }).CustomEvent;
  (globalThis as { window?: unknown }).window = w;
  (globalThis as { CustomEvent?: unknown }).CustomEvent = class {
    constructor(
      public type: string,
      public init?: unknown,
    ) {}
  };
  return {
    restore: () => {
      (globalThis as { window?: unknown }).window = previousWindow;
      (globalThis as { CustomEvent?: unknown }).CustomEvent = previousCustomEvent;
    },
  };
}

function makeSummary(opts: Partial<AdviceCalibrationSummary> = {}): AdviceCalibrationSummary {
  return {
    lowProb: { count: 10, good: 5, bad: 5, successRatePct: 50, ...opts.lowProb },
    highProb: { count: 4, good: 3, bad: 1, successRatePct: 75, ...opts.highProb },
    scoredCount: 14,
    pendingCount: 2,
    goodCount: 8,
    badCount: 6,
    overallSuccessRatePct: 57.1,
    ...opts,
  };
}

function makeSnapshot(opts: Partial<AdviceLearningSnapshot>): AdviceLearningSnapshot {
  return buildAdviceLearningSnapshot({
    summary: opts.scoredPoints == null ? makeSummary() : makeSummary({ scoredCount: opts.scoredPoints }),
    feedback: emptyAdviceFeedback(),
    manual: opts.manual ?? false,
    now: opts.ts ? new Date(opts.ts) : new Date("2026-06-01T12:00:00Z"),
    ...opts,
  });
}

describe("adviceLearningHistory", () => {
  describe("buildAdviceLearningSnapshot", () => {
    it("captures the summary and feedback into a serialisable snapshot", () => {
      const snap = buildAdviceLearningSnapshot({
        summary: makeSummary({ overallSuccessRatePct: 60 }),
        feedback: emptyAdviceFeedback(),
        unifiedAdviceSuccessPct: 92.3,
        capturePct: 295.7,
        manual: true,
        now: new Date("2026-06-17T10:00:00Z"),
      });
      expect(snap.day).toBe("2026-06-17");
      expect(snap.manual).toBe(true);
      expect(snap.overallSuccessRatePct).toBe(60);
      expect(snap.unifiedAdviceSuccessPct).toBe(92.3);
      expect(snap.capturePct).toBe(295.7);
      expect(snap.scoredPoints).toBe(14);
    });
  });

  describe("decideAppendStrategy", () => {
    it("appends on a new day", () => {
      const hist = { schemaVersion: 1 as const, snapshots: [makeSnapshot({ ts: "2026-06-01T12:00:00Z" })] };
      const next = makeSnapshot({ ts: "2026-06-02T12:00:00Z" });
      expect(decideAppendStrategy(hist, next).action).toBe("append");
    });

    it("skips on the same day with the same metrics", () => {
      const a = makeSnapshot({ ts: "2026-06-01T12:00:00Z" });
      const hist = { schemaVersion: 1 as const, snapshots: [a] };
      const b = makeSnapshot({ ts: "2026-06-01T13:00:00Z" });
      expect(decideAppendStrategy(hist, b).action).toBe("skip");
    });

    it("replaces a same-day auto entry with a manual one", () => {
      const a = makeSnapshot({ ts: "2026-06-01T08:00:00Z", manual: false });
      const hist = { schemaVersion: 1 as const, snapshots: [a] };
      const b = makeSnapshot({ ts: "2026-06-01T14:00:00Z", manual: true });
      expect(decideAppendStrategy(hist, b).action).toBe("replace");
    });

    it("does not overwrite a manual entry with an auto one", () => {
      const a = makeSnapshot({ ts: "2026-06-01T10:00:00Z", manual: true });
      const hist = { schemaVersion: 1 as const, snapshots: [a] };
      const b = makeSnapshot({ ts: "2026-06-01T15:00:00Z", manual: false });
      expect(decideAppendStrategy(hist, b).action).toBe("skip");
    });
  });

  describe("appendSnapshotToHistory", () => {
    it("enforces the rolling cap", () => {
      const snaps: AdviceLearningSnapshot[] = [];
      for (let i = 0; i < ADVICE_LEARNING_HISTORY_LIMIT; i++) {
        const ts = new Date(2024, 0, 1 + i).toISOString();
        snaps.push(makeSnapshot({ ts, scoredPoints: i + 1 }));
      }
      const hist = { schemaVersion: 1 as const, snapshots: snaps };
      const newSnap = makeSnapshot({
        ts: new Date(2024, 0, ADVICE_LEARNING_HISTORY_LIMIT + 1).toISOString(),
        scoredPoints: ADVICE_LEARNING_HISTORY_LIMIT + 1,
      });
      const result = appendSnapshotToHistory(hist, newSnap);
      expect(result.changed).toBe(true);
      expect(result.history.snapshots.length).toBe(ADVICE_LEARNING_HISTORY_LIMIT);
      expect(result.history.snapshots[result.history.snapshots.length - 1].scoredPoints).toBe(
        ADVICE_LEARNING_HISTORY_LIMIT + 1,
      );
    });
  });

  describe("shouldAutoSnapshot", () => {
    it("returns false when no scored points", () => {
      const hist = emptyAdviceLearningHistory();
      expect(shouldAutoSnapshot(hist, 0, Date.now())).toBe(false);
    });

    it("returns true when history is empty and we have data", () => {
      const hist = emptyAdviceLearningHistory();
      expect(shouldAutoSnapshot(hist, 5, Date.now())).toBe(true);
    });

    it("respects the auto-snapshot interval", () => {
      const lastTs = "2026-06-15T12:00:00Z";
      const hist = { schemaVersion: 1 as const, snapshots: [makeSnapshot({ ts: lastTs })] };
      const lastMs = Date.parse(lastTs);
      expect(shouldAutoSnapshot(hist, 5, lastMs + 1000)).toBe(false);
      expect(
        shouldAutoSnapshot(hist, 5, lastMs + ADVICE_LEARNING_AUTO_SNAPSHOT_INTERVAL_MS),
      ).toBe(true);
    });
  });

  describe("persistence", () => {
    let shim: { restore: () => void } | null = null;
    beforeEach(() => {
      shim = installBrowserShim();
      clearAdviceLearningHistory();
    });
    afterEach(() => {
      shim?.restore();
      shim = null;
    });

    it("round-trips through localStorage", () => {
      const snap = makeSnapshot({ ts: "2026-06-01T12:00:00Z", manual: true });
      const hist = appendSnapshotToHistory(emptyAdviceLearningHistory(), snap).history;
      saveAdviceLearningHistory(hist);
      const reloaded = loadAdviceLearningHistory();
      expect(reloaded.snapshots).toHaveLength(1);
      expect(reloaded.snapshots[0].manual).toBe(true);
      expect(reloaded.snapshots[0].day).toBe("2026-06-01");
    });

    it("recordAdviceLearningSnapshot appends and persists on a new day", () => {
      const snap1 = makeSnapshot({ ts: "2026-06-01T12:00:00Z" });
      expect(recordAdviceLearningSnapshot(snap1)).toBe(true);
      const snap2 = makeSnapshot({ ts: "2026-06-02T12:00:00Z" });
      expect(recordAdviceLearningSnapshot(snap2)).toBe(true);
      expect(loadAdviceLearningHistory().snapshots).toHaveLength(2);
    });

    it("recordAdviceLearningSnapshot skips duplicate same-day auto entries", () => {
      const snap1 = makeSnapshot({ ts: "2026-06-01T08:00:00Z" });
      expect(recordAdviceLearningSnapshot(snap1)).toBe(true);
      const snap2 = makeSnapshot({ ts: "2026-06-01T20:00:00Z" });
      expect(recordAdviceLearningSnapshot(snap2)).toBe(false);
    });
  });
});
