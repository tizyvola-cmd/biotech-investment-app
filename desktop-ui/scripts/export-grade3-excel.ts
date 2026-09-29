/**
 * Full Grade 3 Excel export (crown + historical non-crown control).
 *
 *   cd desktop-ui
 *   npx tsx scripts/export-grade3-excel.ts
 *   npx tsx scripts/export-grade3-excel.ts --from-xls "C:/Users/.../supernova-grade3.xls"
 *   npx tsx scripts/export-grade3-excel.ts --crown ../data/whatif_crown_hits_export.json --skip-control
 *
 * Writes:
 *   data/whatif_noncrown_export.json  (unless --skip-control)
 *   data/supernova-grade3_export.xls
 */
import fs from "node:fs";
import path from "node:path";
import type { SheetTable } from "../src/types";
import { normalizedRowKey } from "../src/sheet/investSimKeys";
import {
  buildWhatIfGrade3Export,
  buildWhatIfGrade3SpreadsheetXml,
} from "../src/sheet/whatIfGrade3Export";
import type { WhatIfCrownHitEvent, WhatIfCrownHitStore } from "../src/sheet/whatIfCrownHitStore";
import type { WhatIfCrownReadout } from "../src/sheet/whatIfCrownReadout";
import {
  buildNonCrownControlExport,
  type NonCrownControlEvent,
} from "./export-noncrown-control";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DATA = path.join(ROOT, "data");

function readJson<T>(file: string): T | null {
  const p = path.join(DATA, file);
  if (!fs.existsSync(p)) return null;
  let raw = fs.readFileSync(p, "utf8");
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  return JSON.parse(raw) as T;
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

function rowCellValues(rowXml: string): string[] {
  const out: string[] = [];
  const cellRe = /<Cell[^>]*>([\s\S]*?)<\/Cell>/g;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(rowXml))) {
    const inner = m[1] ?? "";
    const dataMatch = inner.match(/<Data ss:Type="(?:String|Number)">([\s\S]*?)<\/Data>/);
    out.push(dataMatch ? decodeXml(dataMatch[1] ?? "").trim() : "");
  }
  return out;
}

function parseNum(s: string): number | null {
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function simKeyForTicker(ticker: string, simRows: SheetTable["rows"]): string | null {
  const tk = ticker.trim().toUpperCase();
  for (const r of simRows ?? []) {
    if (String(r.Ticker ?? "").trim().toUpperCase() === tk) {
      const cd = String(r["Completion Date"] ?? "").trim();
      return normalizedRowKey(tk, cd);
    }
  }
  return null;
}

/** Recover crown log from a prior Grade 3 .xls (Data sheet, Group=Crown). */
export function parseCrownEventsFromGrade3Xls(xlsPath: string): WhatIfCrownHitEvent[] {
  const raw = fs.readFileSync(xlsPath, "utf8");
  const dataMatch = raw.match(/<Worksheet ss:Name="Data"[^>]*><Table>([\s\S]*?)<\/Table><\/Worksheet>/);
  if (!dataMatch) throw new Error(`No Data worksheet in ${xlsPath}`);

  const simSnap = readJson<{ rows: SheetTable["rows"] }>("simulation_sheet_snapshot.json");
  const simRows = simSnap?.rows ?? [];

  const rows = [...dataMatch[1]!.matchAll(/<Row>([\s\S]*?)<\/Row>/g)].map((m) => rowCellValues(m[1]!));
  if (rows.length < 2) return [];

  const out: WhatIfCrownHitEvent[] = [];
  for (const cells of rows.slice(1)) {
    const group = cells[0] ?? "";
    if (!/^crown$/i.test(group)) continue;

    const sessionDate = cells[1] ?? "";
    const ticker = (cells[2] ?? "").trim().toUpperCase();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate) || !ticker) continue;

    const readout: WhatIfCrownReadout | undefined = (() => {
      const sds = parseNum(cells[3] ?? "");
      const eis = parseNum(cells[4] ?? "");
      const pPlan = parseNum(cells[5] ?? "");
      const pCont = parseNum(cells[6] ?? "");
      const precatKind = cells[7]?.trim() || null;
      const dailyPct24h = parseNum(cells[8] ?? "");
      const src = (cells[13] ?? "").trim();
      if (sds == null && eis == null && pPlan == null && pCont == null && !precatKind && dailyPct24h == null) {
        return undefined;
      }
      return {
        sds,
        eis,
        pPlan: pPlan != null ? Math.round(pPlan) : null,
        precatKind,
        pCont: pCont != null ? Math.round(pCont) : null,
        contG10: null,
        exhaustEdge: null,
        dailyPct24h,
        miiAngleDeg: null,
        frozenAt: `${sessionDate}T16:00:00.000Z`,
        source: src === "backfill" ? "backfill" : "capture",
      };
    })();

    const endPnl = parseNum(cells[9] ?? "") ?? 0;
    const pathMax = parseNum(cells[10] ?? "") ?? endPnl;
    const pathMin = parseNum(cells[11] ?? "") ?? endPnl;

    out.push({
      sessionDate,
      ticker,
      simKey: simKeyForTicker(ticker, simRows),
      endPnl,
      pathMax,
      pathMin,
      oscillating: false,
      capturedAt: `${sessionDate}T16:00:00.000Z`,
      updatedAt: `${sessionDate}T16:00:00.000Z`,
      readout,
    });
  }
  return out;
}

function loadCrownEvents(): WhatIfCrownHitEvent[] {
  const crownArg = process.argv.find((a, i) => process.argv[i - 1] === "--crown") ?? null;
  const fromXls = process.argv.find((a, i) => process.argv[i - 1] === "--from-xls") ?? null;

  if (fromXls) {
    const events = parseCrownEventsFromGrade3Xls(fromXls);
    if (!events.length) throw new Error(`No crown rows parsed from ${fromXls}`);
    const store: WhatIfCrownHitStore = { schemaVersion: 1, events };
    const outPath = path.join(DATA, "whatif_crown_hits_export.json");
    fs.writeFileSync(outPath, JSON.stringify(store, null, 2));
    console.log(`Parsed ${events.length} crown hits from XLS → ${outPath}`);
    return events;
  }

  if (crownArg) {
    const doc = JSON.parse(fs.readFileSync(crownArg, "utf8")) as WhatIfCrownHitStore;
    if (doc?.events?.length) return doc.events;
  }

  for (const rel of ["whatif_crown_hits_export.json"]) {
    const doc = readJson<WhatIfCrownHitStore>(rel);
    if (doc?.events?.length) return doc.events;
  }

  throw new Error(
    "Missing crown log. Pass --from-xls PATH or --crown PATH or create data/whatif_crown_hits_export.json",
  );
}

function main() {
  const skipControl = process.argv.includes("--skip-control");
  const dryRun = process.argv.includes("--dry-run");
  const lang = process.argv.includes("--it") ? "it" : "en";

  const crownEvents = loadCrownEvents();
  console.log(`Crown events: ${crownEvents.length}`);

  let exportedNonCrown: NonCrownControlEvent[] = [];
  if (!skipControl) {
    const { events, byPop } = buildNonCrownControlExport(crownEvents, { dryRun, verbose: true });
    exportedNonCrown = events;
    const outPath = path.join(DATA, "whatif_noncrown_export.json");
    fs.writeFileSync(outPath, JSON.stringify({ schemaVersion: 1, events }, null, 2));
    console.log(`\nWrote ${outPath} (${events.length} control rows · off-PF ${byPop.strong_offbook} · pf_non ${byPop.pf_nonstrong})`);
  } else {
    const doc = readJson<{ events?: NonCrownControlEvent[] }>("whatif_noncrown_export.json");
    exportedNonCrown = doc?.events ?? [];
    console.log(`Using existing control export (${exportedNonCrown.length} rows)`);
  }

  const exp = buildWhatIfGrade3Export({
    lang,
    crownEvents,
    exportedNonCrown,
    importedNonCrown: [],
    liveNonCrown: [],
  });

  const xml = buildWhatIfGrade3SpreadsheetXml(exp);
  const stamp = new Date().toISOString().slice(0, 10);
  const xlsPath = path.join(DATA, `supernova-grade3_export_${stamp}.xls`);
  fs.writeFileSync(xlsPath, xml, "utf8");

  const crownN = exp.rows.filter((r) => r.kind === "crown").length;
  const ctrlN = exp.rows.filter((r) => r.kind !== "crown").length;
  console.log(`\nExcel: ${xlsPath}`);
  console.log(`  Crown rows:   ${crownN}`);
  console.log(`  Control rows: ${ctrlN}`);
  if (ctrlN === 0) {
    console.warn("\n⚠ No control rows — run without --skip-control (needs Yahoo intraday per session day).");
  }
}

main();
