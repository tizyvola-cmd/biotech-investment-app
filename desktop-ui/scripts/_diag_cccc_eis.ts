import fs from "fs";
import path from "path";
import { buildTickerEisDetail } from "../src/sheet/tickerEisSummary";
import type { ClinicalPreCdRecord } from "../src/sheet/clinicalPreCdTypes";

const p = path.join("..", "data", "clinical_pre_cd_enrichment_snapshot.json");
const snap = JSON.parse(fs.readFileSync(p, "utf8")) as { records?: ClinicalPreCdRecord[] };
const cccc = (snap.records ?? []).filter((r) => (r.ticker ?? "").toUpperCase() === "CCCC");
console.log("records", cccc.length);
const detail = buildTickerEisDetail("CCCC", "en", null, cccc, "2026-09-30");
console.log("score", detail.score, "events", detail.eventCount, detail.feedLabels);
for (const e of detail.events.slice(0, 8)) {
  console.log(" -", e.eventDate, e.sourceLabel, e.breakdown?.score, e.title?.slice(0, 65));
}
