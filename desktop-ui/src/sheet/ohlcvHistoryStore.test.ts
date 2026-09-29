import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  clearOhlcvHistoryCache,
  fetchOhlcvHistory,
  pairOhlcvFetchDays,
} from "./ohlcvHistoryStore";

vi.mock("../api/supernova", () => ({
  fetchVolumeHistory: vi.fn(async (ticker: string, days: number) => ({
    ticker,
    bars: Array.from({ length: Math.min(days, 5) }, (_, i) => ({
      date: `2026-09-${String(10 + i).padStart(2, "0")}`,
      close: 10 + i,
      volume: 1000 + i,
    })),
    updated_at: "2026-09-19T00:00:00Z",
    error: null,
  })),
}));

import { fetchVolumeHistory } from "../api/supernova";

describe("ohlcvHistoryStore", () => {
  beforeEach(() => {
    clearOhlcvHistoryCache();
    vi.mocked(fetchVolumeHistory).mockClear();
  });

  it("pairOhlcvFetchDays covers volume character floor on short ranges", () => {
    expect(pairOhlcvFetchDays("24h")).toBe(60);
    expect(pairOhlcvFetchDays("7d")).toBe(60);
    expect(pairOhlcvFetchDays("1M")).toBe(60);
    expect(pairOhlcvFetchDays("cat6M")).toBe(200);
  });

  it("coalesces parallel fetches for the same ticker|days", async () => {
    const a = fetchOhlcvHistory("COCP", 200);
    const b = fetchOhlcvHistory("COCP", 200);
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.bars).toHaveLength(5);
    expect(rb.bars).toHaveLength(5);
    expect(fetchVolumeHistory).toHaveBeenCalledTimes(1);
  });

  it("serves warm cache without a second network call", async () => {
    await fetchOhlcvHistory("ENTA", 60);
    await fetchOhlcvHistory("ENTA", 60);
    expect(fetchVolumeHistory).toHaveBeenCalledTimes(1);
  });
});
