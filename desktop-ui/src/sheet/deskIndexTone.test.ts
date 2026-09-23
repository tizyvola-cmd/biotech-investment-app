import { describe, expect, it } from "vitest";
import {
  deskLiveOrStaleTone,
  deskSignedLiveTone,
  recToDeskIndexTone,
  toDeskIndexTone,
} from "./deskIndexTone";

describe("toDeskIndexTone", () => {
  it("maps up/down/flat to green/red/yellow", () => {
    expect(toDeskIndexTone("up")).toBe("pos");
    expect(toDeskIndexTone("down")).toBe("neg");
    expect(toDeskIndexTone("flat")).toBe("neu");
    expect(toDeskIndexTone("warn")).toBe("neu");
    expect(toDeskIndexTone("none")).toBe("empty");
    expect(toDeskIndexTone("stale")).toBe("stale");
  });
});

describe("deskSignedLiveTone", () => {
  it("uses gray only when stale; otherwise always red or green", () => {
    expect(deskSignedLiveTone(1.2)).toBe("pos");
    expect(deskSignedLiveTone(-0.01)).toBe("neg");
    expect(deskSignedLiveTone(0)).toBe("pos");
    expect(deskSignedLiveTone(1.2, { stale: true })).toBe("stale");
    expect(deskSignedLiveTone(null)).toBe("empty");
  });
});

describe("deskLiveOrStaleTone", () => {
  it("forces gray for outdated prints", () => {
    expect(deskLiveOrStaleTone("up", { stale: true })).toBe("stale");
    expect(deskLiveOrStaleTone("flat", { signedPct: -0.2 })).toBe("neg");
    expect(deskLiveOrStaleTone("warn")).toBe("neu");
  });
});

describe("recToDeskIndexTone", () => {
  it("maps BUY/SELL/HOLD to the same three colors", () => {
    expect(recToDeskIndexTone("buy")).toBe("pos");
    expect(recToDeskIndexTone("sell")).toBe("neg");
    expect(recToDeskIndexTone("hold")).toBe("neu");
    expect(recToDeskIndexTone("none")).toBe("empty");
  });
});
