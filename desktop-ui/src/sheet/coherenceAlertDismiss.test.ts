import { beforeEach, describe, expect, it } from "vitest";
import {
  ackCoherenceAlert,
  isCoherenceAlertAcked,
  resetCoherenceAlertAckForTests,
} from "./coherenceAlertDismiss";

describe("coherenceAlertDismiss", () => {
  beforeEach(() => {
    resetCoherenceAlertAckForTests();
    try {
      localStorage?.clear?.();
    } catch {
      /* ignore — node test env may lack localStorage */
    }
  });

  it("keeps Close for now across signature-stable checks", () => {
    const sig = "storeFreshness:coherenceAlert.issue.storeStale.title::{}";
    ackCoherenceAlert(sig, ["storeFreshness"]);
    expect(isCoherenceAlertAcked(sig, ["storeFreshness"])).toBe(true);
  });

  it("snoozes same issue ids when signature drifts", () => {
    ackCoherenceAlert("sig-a", ["storeFreshness"]);
    expect(isCoherenceAlertAcked("sig-b-different", ["storeFreshness"])).toBe(true);
  });

  it("keeps Close when the issue set shrinks", () => {
    ackCoherenceAlert("sig-a", ["storeAlignment", "storeFreshness"]);
    expect(isCoherenceAlertAcked("sig-b", ["storeFreshness"])).toBe(true);
  });

  it("reopens when a new issue id appears", () => {
    ackCoherenceAlert("sig-a", ["storeFreshness"]);
    expect(isCoherenceAlertAcked("sig-b", ["storeFreshness", "buyPriceInputs"])).toBe(
      false,
    );
  });

  it("memory ack works even without durable storage", () => {
    // ack always writes memoryAck first — Close for now must not depend on LS.
    const sig = "storeFreshness:x::{}";
    ackCoherenceAlert(sig, ["storeFreshness"]);
    resetCoherenceAlertAckForTests();
    // After memory clear, without LS the alert is not acked.
    expect(isCoherenceAlertAcked(sig, ["storeFreshness"])).toBe(false);
    ackCoherenceAlert(sig, ["storeFreshness"]);
    expect(isCoherenceAlertAcked(sig, ["storeFreshness"])).toBe(true);
  });
});

