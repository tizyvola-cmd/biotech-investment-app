import { afterEach, describe, expect, it } from "vitest";
import {
  loadG2AutoSoldAck,
  markG2AutoSoldKeys,
  resetG2AutoSoldAckForTests,
} from "./urgentSellG2AutoExecute";

describe("G2 auto-sold ack", () => {
  afterEach(() => {
    resetG2AutoSoldAckForTests();
  });

  it("stores keys for the calendar day and reloads them", () => {
    const now = new Date("2026-07-22T12:00:00Z");
    markG2AutoSoldKeys(["A|cd", "B|cd"], now);
    const ack = loadG2AutoSoldAck(now);
    expect(ack.keys).toEqual(expect.arrayContaining(["A|cd", "B|cd"]));
    expect(ack.keys).toHaveLength(2);
  });

  it("resets on a new calendar day", () => {
    markG2AutoSoldKeys(["OLD|cd"], new Date("2026-07-21T12:00:00Z"));
    const ack = loadG2AutoSoldAck(new Date("2026-07-22T12:00:00Z"));
    expect(ack.keys).toEqual([]);
  });
});
