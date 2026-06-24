import { describe, expect, it } from "vitest";
import { resolvePinLabelLayout } from "./nowTimelineMarker";

describe("resolvePinLabelLayout", () => {
  it("places labels to the right when pin is on the left (avoids Y-axis)", () => {
    const layout = resolvePinLabelLayout({ x: 40, y: 0, width: 400, height: 200 }, true);
    expect(layout.anchor).toBe("start");
    expect(layout.tx).toBeGreaterThan(40);
    expect(layout.tySub).toBeGreaterThan(layout.tyMain);
  });

  it("places labels to the left when pin is on the right", () => {
    const layout = resolvePinLabelLayout({ x: 340, y: 0, width: 400, height: 200 }, true);
    expect(layout.anchor).toBe("end");
    expect(layout.tx).toBeLessThan(340);
    expect(layout.tySub).toBeGreaterThan(layout.tyMain);
  });

  it("stacks labels above pin in the center zone", () => {
    const layout = resolvePinLabelLayout({ x: 200, y: 0, width: 400, height: 200 }, true);
    expect(layout.anchor).toBe("middle");
    expect(layout.tyMain).toBeLessThan(layout.tySub);
  });
});
