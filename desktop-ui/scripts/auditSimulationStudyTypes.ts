/**
 * Audit drug vs device sulla lista Simulation completa.
 * Run: cd desktop-ui && npx tsx scripts/auditSimulationStudyTypes.ts
 */
import fs from "node:fs";
import path from "node:path";
import type { SheetTable } from "../src/types";
import type { ClinicalPreCdRecord } from "../src/api/supernova";
import {
  auditStudyTypes,
  formatAuditReport,
} from "../src/sheet/auditStudyTypes";
import {
  STUDY_DEVICE_KEYWORD_LABELS,
  STUDY_DRUG_KEYWORD_LABELS,
  buildStudyTextFromSources,
  findClinicalMetaForTicker,
} from "../src/sheet/studyClassifier";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DATA = path.join(ROOT, "data");

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8")) as T;
}

function tryReadJson<T>(file: string): T | null {
  try {
    return readJson<T>(file);
  } catch {
    return null;
  }
}

function loadSimTable(): SheetTable {
  const snap = readJson<{ rows: SheetTable["rows"]; columns?: string[] }>(
    "simulation_sheet_snapshot.json",
  );
  return { sheet: "Simulation", columns: snap.columns ?? [], rows: snap.rows ?? [] };
}

function loadClinicalRecords(): ClinicalPreCdRecord[] {
  const snap = tryReadJson<{ records?: ClinicalPreCdRecord[] }>(
    "clinical_pre_cd_enrichment_snapshot.json",
  );
  return snap?.records ?? [];
}

type SimAuditRow = {
  ticker: string;
  completionDate: string;
  studyText: string;
  simRow: Record<string, unknown>;
};

function main() {
  const simTable = loadSimTable();
  const clinicalRecords = loadClinicalRecords();
  const rows: SimAuditRow[] = [];

  for (const row of simTable.rows ?? []) {
    const ticker = String(row["Ticker"] ?? "").trim().toUpperCase();
    if (!ticker || ticker.includes("TOTALE")) continue;
    const cd = String(row["Completion Date"] ?? "").trim();
    if (!cd || cd === "—") continue;
    const clinicalMeta = findClinicalMetaForTicker(clinicalRecords, ticker);
    const studyText = buildStudyTextFromSources(row, clinicalMeta);
    rows.push({ ticker, completionDate: cd, studyText, simRow: row });
  }

  const report = auditStudyTypes(
    rows,
    (r) => r.ticker,
    (r) => r.studyText,
  );

  console.log("\n=== AUDIT TIPI STUDIO (Drug vs Device) ===");
  console.log(formatAuditReport(report, "it"));
  console.log(`\nClinical enrichment records loaded: ${clinicalRecords.length}`);

  console.log("\n--- Drug ---");
  for (const r of report.byClass.drug.sort((a, b) => a.ticker.localeCompare(b.ticker))) {
    console.log(
      `  ${r.ticker.padEnd(6)} ${r.classification.confidence} · ${r.classification.matchedDrug.join(", ") || "—"}`,
    );
  }

  console.log("\n--- Device ---");
  for (const r of report.byClass.device.sort((a, b) => a.ticker.localeCompare(b.ticker))) {
    console.log(
      `  ${r.ticker.padEnd(6)} ${r.classification.confidence} · ${r.classification.matchedDevice.join(", ") || "—"}`,
    );
  }

  if (report.needsReview.length) {
    console.log("\n--- Da rivedere manualmente ---");
    for (const r of report.needsReview.sort((a, b) => a.ticker.localeCompare(b.ticker))) {
      const snippet = r.text.slice(0, 72);
      console.log(
        `  ${r.ticker.padEnd(6)} ${r.classification.klass}/${r.classification.confidence} · ${snippet}${r.text.length > 72 ? "…" : ""}`,
      );
    }
  }

  console.log("\n--- Keyword reference (drug) ---");
  console.log(STUDY_DRUG_KEYWORD_LABELS.join(" · "));
  console.log("\n--- Keyword reference (device) ---");
  console.log(STUDY_DEVICE_KEYWORD_LABELS.join(" · "));

  if (report.summary.device === 0) {
    console.log("\n⚠ Nessun device classificato — verifica testo studio / enrichment clinico.");
  }
  if (report.summary.drug === 0) {
    console.log("\n⚠ Nessun farmaco classificato — verifica Studio Phase nello snapshot.");
  }
  if (report.hasMixedPortfolio) {
    console.log("\n✓ Portfolio misto confermato: farmaci + medical device presenti.");
  } else if (report.summary.drug > 0 && report.summary.device === 0) {
    console.log(
      "\nℹ Lista attuale: solo farmaci classificati via Studio Phase / enrichment clinico.",
    );
    console.log(
      "  Device (es. INBS 510k) richiedono keyword nel testo studio — vedi needsReview.",
    );
  }
}

main();
