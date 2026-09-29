import { describe, expect, it } from "vitest";

/** Mirrors HomeSignalsDesk first-match Map builders (Lotto 1 #5). */
function buildFdaHitByTickerDate(
  rows: Array<{ ticker: string; date: string; id?: string }>,
): Map<string, { ticker: string; date: string; id?: string }> {
  const m = new Map<string, { ticker: string; date: string; id?: string }>();
  for (const f of rows) {
    const tk = String(f.ticker ?? "")
      .trim()
      .toUpperCase();
    const day = String(f.date ?? "").slice(0, 10);
    if (!tk || !day) continue;
    const key = `${tk}|${day}`;
    if (!m.has(key)) m.set(key, f);
  }
  return m;
}

function buildCompanyFallbackByTicker(
  fda: Array<{ ticker: string; company?: string }>,
  guidance: Array<{ ticker?: string; company?: string }>,
): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of fda) {
    const tk = String(f.ticker ?? "")
      .trim()
      .toUpperCase();
    const company = String(f.company ?? "").trim();
    if (tk && company && !m.has(tk)) m.set(tk, company);
  }
  for (const g of guidance) {
    const tk = String(g.ticker ?? "")
      .trim()
      .toUpperCase();
    const company = String(g.company ?? "").trim();
    if (tk && company && !m.has(tk)) m.set(tk, company);
  }
  return m;
}

describe("desk lookup Maps (first-match semantics)", () => {
  it("keeps the first FDA row per ticker|date", () => {
    const m = buildFdaHitByTickerDate([
      { ticker: "COCP", date: "2026-10-01", id: "a" },
      { ticker: "cocp", date: "2026-10-01", id: "b" },
      { ticker: "COCP", date: "2026-10-02", id: "c" },
    ]);
    expect(m.get("COCP|2026-10-01")?.id).toBe("a");
    expect(m.get("COCP|2026-10-02")?.id).toBe("c");
  });

  it("prefers FDA company over guidance (same as find chain)", () => {
    const m = buildCompanyFallbackByTicker(
      [{ ticker: "ENTA", company: "Enanta FDA" }],
      [
        { ticker: "ENTA", company: "Enanta Guidance" },
        { ticker: "AZN", company: "Astra" },
      ],
    );
    expect(m.get("ENTA")).toBe("Enanta FDA");
    expect(m.get("AZN")).toBe("Astra");
  });
});
