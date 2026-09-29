import { describe, expect, it } from "vitest";
import { resolveLiveScreen } from "./retiredScreens";

describe("resolveLiveScreen", () => {
  it("sends retired tabs to a live screen", () => {
    expect(resolveLiveScreen("decisionLab")).toBe("simulation");
    expect(resolveLiveScreen("models")).toBe("catalystDesk");
    expect(resolveLiveScreen("main")).toBe("catalystDesk");
    expect(resolveLiveScreen("wind")).toBe("catalystDesk");
    expect(resolveLiveScreen("catalystFeed")).toBe("catalystDesk");
  });

  it("leaves live tabs unchanged", () => {
    expect(resolveLiveScreen("catalystDesk")).toBe("catalystDesk");
    expect(resolveLiveScreen("simulation")).toBe("simulation");
  });
});
