import { describe, expect, it } from "vitest";
import {
  deskCellTone,
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
  it("is red or green for any signed value, gray only when missing", () => {
    expect(deskSignedLiveTone(1.2)).toBe("pos");
    expect(deskSignedLiveTone(-0.01)).toBe("neg");
    expect(deskSignedLiveTone(0)).toBe("pos");
    expect(deskSignedLiveTone(null)).toBe("empty");
  });
});

describe("deskCellTone", () => {
  it("keeps colors for outdated prints and falls back to the signed %", () => {
    expect(deskCellTone("up")).toBe("pos");
    expect(deskCellTone("stale", { signedPct: -0.2 })).toBe("neg");
    expect(deskCellTone("stale")).toBe("stale");
    expect(deskCellTone("flat", { signedPct: -0.2 })).toBe("neg");
    expect(deskCellTone("warn")).toBe("neu");
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
