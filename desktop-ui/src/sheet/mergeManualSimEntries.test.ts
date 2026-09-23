import { describe, expect, it } from "vitest";
import {
  applySimulationSidecarRows,
  mergeManualSimEntriesIntoTable,
} from "./mergeManualSimEntries";
import type { SheetTable } from "../types";

const base: SheetTable = {
  sheet: "Simulation",
  columns: ["Ticker", "Completion Date"],
  rows: [{ Ticker: "BIIB", "Completion Date": "27/09/2026" }],
};

const cpix = {
  Ticker: "CPIX",
  "Completion Date": "26/08/2026",
  _note: "Reintrodotto manualmente — feed clinico senza CD",
};

describe("mergeManualSimEntriesIntoTable", () => {
  it("appends CPIX when the snapshot omitted the sidecar row", () => {
    const next = mergeManualSimEntriesIntoTable(base, [cpix]);
    expect(next).not.toBe(base);
    expect(next?.rows.map((r) => r.Ticker)).toEqual(["BIIB", "CPIX"]);
    expect(next?.rows[1]?._manual).toBe(true);
  });

  it("does not duplicate an already-present Ticker|CD (ISO vs IT date)", () => {
    const already: SheetTable = {
      ...base,
      rows: [
        ...base.rows,
        { Ticker: "CPIX", "Completion Date": "2026-08-26" },
      ],
    };
    expect(mergeManualSimEntriesIntoTable(already, [cpix])).toBe(already);
  });

  it("returns the same table when entries are empty", () => {
    expect(mergeManualSimEntriesIntoTable(base, [])).toBe(base);
  });
});

describe("applySimulationSidecarRows", () => {
  it("keeps both hype and manual names on a raw snapshot preview", () => {
    const next = applySimulationSidecarRows(base, {
      hypeEntries: [{ Ticker: "CANF", "Completion Date": "31/08/2027" }],
      manualEntries: [cpix],
    });
    expect(next?.rows.map((r) => r.Ticker)).toEqual(["BIIB", "CANF", "CPIX"]);
  });

  it("appends catalyst-day names and keeps a second CD for a ticker already on the sheet", () => {
    const next = applySimulationSidecarRows(base, {
      catalystEntries: [
        { Ticker: "BDSX", "Completion Date": "31/07/2026" },
        { Ticker: "BIIB", "Completion Date": "01/01/2027" },
      ],
    });
    expect(next?.rows.map((r) => r.Ticker)).toEqual(["BIIB", "BDSX", "BIIB"]);
    expect(next?.rows[1]?.guidance_calendar_catalyst).toBe(true);
    expect(next?.rows[2]?.["Completion Date"]).toBe("01/01/2027");
    expect(next?.rows[0]?.guidance_calendar_catalyst).toBeUndefined();
  });

  it("stamps the catalyst flag when the same Ticker|CD is already on the sheet", () => {
    const next = applySimulationSidecarRows(base, {
      catalystEntries: [{ Ticker: "BIIB", "Completion Date": "27/09/2026" }],
    });
    expect(next?.rows).toHaveLength(1);
    expect(next?.rows[0]?.guidance_calendar_catalyst).toBe(true);
  });
});
