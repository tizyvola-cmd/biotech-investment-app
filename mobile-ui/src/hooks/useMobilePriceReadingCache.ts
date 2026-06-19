import { useEffect, useRef, useState } from "react";
import {
  seedPriceReadingCacheIfMissing,
  backfillSyntheticPricePrevious,
  recordPriceReadingUpdates,
} from "../priceReadingCache";
import { computeSimTableVersion } from "../simTableVersion";
import { currentPriceFromRow, normalizedRowKey } from "../simLogic";
import type { InvestSimInputs, SheetTable } from "../types";

function dailyPctFromRow(r: Record<string, unknown>): number | null {
  for (const col of ["Var. Giorn. %", "Var. Giorn.%", "Var. Giornaliera %"]) {
    const raw = r[col];
    if (raw == null || raw === "") continue;
    const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function useMobilePriceReadingCache(
  sheet: SheetTable | null,
  inputs: InvestSimInputs,
): { simTableVersion: string; revision: number } {
  const [revision, setRevision] = useState(0);
  const prevVersionRef = useRef<string | null>(null);
  const simTableVersion = computeSimTableVersion(sheet, inputs);

  useEffect(() => {
    if (!sheet?.rows?.length) return;

    const rows: Array<{ key: string; priceUsd: number; dailyPct?: number | null }> = [];
    for (const r of sheet.rows) {
      const tk = String(r.Ticker ?? "").trim().toUpperCase();
      if (!tk || tk.includes("TOTALE")) continue;
      const key = normalizedRowKey(tk, r["Completion Date"]);
      const priceUsd = currentPriceFromRow(r);
      if (priceUsd != null && priceUsd > 0) {
        rows.push({ key, priceUsd, dailyPct: dailyPctFromRow(r) });
      }
    }
    if (!rows.length) return;

    const versionChanged =
      prevVersionRef.current != null && prevVersionRef.current !== simTableVersion;
    prevVersionRef.current = simTableVersion;

    const id = requestAnimationFrame(() => {
      if (versionChanged) {
        recordPriceReadingUpdates(rows, { simTableVersion, versionChanged: true });
      } else {
        seedPriceReadingCacheIfMissing(rows, simTableVersion);
        backfillSyntheticPricePrevious(rows, simTableVersion);
      }
      setRevision((n) => n + 1);
    });
    return () => cancelAnimationFrame(id);
  }, [sheet, simTableVersion]);

  return { simTableVersion, revision };
}
