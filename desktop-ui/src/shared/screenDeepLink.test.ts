import { describe, expect, it } from "vitest";
import { isAppScreen, parseScreenDeepLink } from "./screenDeepLink";

describe("parseScreenDeepLink", () => {
  it("reads hash screen + popout", () => {
    expect(parseScreenDeepLink("", "#screen=wind&popout=1")).toEqual({
      screen: "wind",
      popout: true,
    });
  });

  it("reads query screen without popout", () => {
    expect(parseScreenDeepLink("?screen=decisionLab", "")).toEqual({
      screen: "decisionLab",
      popout: false,
    });
  });

  it("accepts bare #/wind form", () => {
    expect(parseScreenDeepLink("", "#/wind")).toEqual({
      screen: "wind",
      popout: false,
    });
  });

  it("rejects unknown screens", () => {
    expect(parseScreenDeepLink("", "#screen=nope")).toEqual({
      screen: null,
      popout: false,
    });
    expect(isAppScreen("wind")).toBe(true);
    expect(isAppScreen("calendar")).toBe(true);
    expect(isAppScreen("discovery")).toBe(true);
    expect(isAppScreen("catalystDesk")).toBe(true);
    expect(isAppScreen("eisDeepDive")).toBe(true);
    expect(isAppScreen("nope")).toBe(false);
  });
});
