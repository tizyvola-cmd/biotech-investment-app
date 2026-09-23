import { describe, expect, it, beforeEach } from "vitest";
import {
  acknowledgeWeeklyFullServerStatus,
  isWeeklyFullActuallyRunning,
  isWeeklyFullCompletionNew,
  weeklyFullCompletedToday,
  weeklyFullCompletionCandidates,
} from "./weeklyFullServerWatch";

describe("isWeeklyFullActuallyRunning", () => {
  it("is false when API running=false", () => {
    expect(isWeeklyFullActuallyRunning({ running: false })).toBe(false);
  });

  it("distrusts running=true after a completed last_run (>10 min ago)", () => {
    const finished = new Date(Date.now() - 60 * 60_000).toISOString();
    expect(
      isWeeklyFullActuallyRunning({
        running: true,
        last_run: { ok: true, finished_at: finished, message: "WeeklyFull completato" },
      }),
    ).toBe(false);
  });

  it("keeps running=true when finish is very recent (overlap window)", () => {
    const finished = new Date(Date.now() - 2 * 60_000).toISOString();
    expect(
      isWeeklyFullActuallyRunning({
        running: true,
        last_run: { ok: true, finished_at: finished },
      }),
    ).toBe(true);
  });

  it("keeps running=true when there is no successful last_run", () => {
    expect(isWeeklyFullActuallyRunning({ running: true, last_run: null })).toBe(true);
  });
});

describe("isWeeklyFullCompletionNew", () => {
  beforeEach(() => {
    try {
      localStorage?.removeItem?.("supernova_weekly_full_ack_finished_at");
      localStorage?.removeItem?.("supernova_weekly_full_ack_ids");
    } catch {
      /* jsdom */
    }
    // Reset via acknowledging empty is not exposed — clear by overwriting with a throwaway then
    // re-importing is heavy; acknowledge a unique old id then test with fresh ids instead.
  });

  it("can surface completion even if stale running flag is set", () => {
    const finished = new Date(Date.now() - 2 * 3600_000).toISOString();
    expect(
      isWeeklyFullCompletionNew({
        running: true,
        last_run: { ok: true, finished_at: finished },
      }),
    ).toBe(true);
  });

  it("treats last_run and summary finish times as the same cycle once either is acked", () => {
    const recent = new Date(Date.now() - 2 * 3600_000);
    const lastIso = recent.toISOString().slice(0, 19);
    const summaryIso = new Date(recent.getTime() - 90_000).toISOString().slice(0, 19);
    const status = {
      running: false,
      last_run: { ok: true as const, finished_at: lastIso },
      summary: {
        ok: true,
        finished_at: summaryIso,
        elapsed_sec: 4035,
      },
    };
    const candidates = weeklyFullCompletionCandidates(status);
    expect(candidates).toContain(lastIso);
    expect(candidates).toContain(summaryIso);
    expect(isWeeklyFullCompletionNew(status)).toBe(true);
    acknowledgeWeeklyFullServerStatus(status);
    expect(isWeeklyFullCompletionNew(status)).toBe(false);
  });

  it("does not resurface a finish older than 36 hours", () => {
    const finished = new Date(Date.now() - 48 * 3600_000).toISOString();
    expect(
      isWeeklyFullCompletionNew({
        running: false,
        last_run: { ok: true, finished_at: finished },
      }),
    ).toBe(false);
  });
});

describe("weeklyFullCompletedToday", () => {
  it("is true for a successful finish on the same calendar day", () => {
    const now = new Date(2026, 6, 25, 11, 20, 0);
    const finished = new Date(2026, 6, 25, 8, 45, 0).toISOString();
    expect(
      weeklyFullCompletedToday(
        {
          running: true,
          last_run: { ok: true, finished_at: finished },
        },
        now,
      ),
    ).toBe(true);
  });
});
