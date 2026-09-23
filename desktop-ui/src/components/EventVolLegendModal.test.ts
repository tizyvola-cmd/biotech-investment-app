import { describe, expect, it } from "vitest";
import { catalystColumnHint } from "./EventVolLegendModal";

describe("catalystColumnHint", () => {
  it("explains Daily Score as independent Clin / Fin / Corp / Acc", () => {
    const en = catalystColumnHint("newsScores", false);
    expect(en.title).toBe("Daily Score");
    expect(en.body).toMatch(/Clin/i);
    expect(en.body).toMatch(/Fin/i);
    expect(en.body).toMatch(/36\s*hours/i);
    expect(en.body).toMatch(/Acc/i);
    const itHint = catalystColumnHint("newsScores", true);
    expect(itHint.title).toBe("Daily Score");
    expect(itHint.body).toMatch(/Clin/i);
    expect(itHint.body).toMatch(/36\s*ore/i);
    expect(itHint.body.length).toBeGreaterThan(40);
    expect(itHint.body.length).toBeLessThan(280);
  });

  it("explains Event as Catalyst Days that may move the market", () => {
    const en = catalystColumnHint("event", false);
    expect(en.title).toBe("Event");
    expect(en.body).toMatch(/Catalyst Days/i);
    expect(en.body).toMatch(/market reaction/i);
    const itHint = catalystColumnHint("event", true);
    expect(itHint.body).toMatch(/Catalyst Days/i);
    expect(itHint.body.length).toBeGreaterThan(40);
    expect(itHint.body.length).toBeLessThan(280);
  });

  it("explains Momentum, Days, G-Trends and Vol in English", () => {
    expect(catalystColumnHint("bias", false).body).toMatch(/direction/i);
    expect(catalystColumnHint("day", false).body).toMatch(/Days until/i);
    expect(catalystColumnHint("trends", false).body).toMatch(/Google Trends/i);
    expect(catalystColumnHint("vol", false).body).toMatch(/volume/i);
  });
});
