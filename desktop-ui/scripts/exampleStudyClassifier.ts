/**
 * Esempio end-to-end — adatta getTicker/getStudyText al tuo schema SuperNova.
 *
 * Run: npx tsx desktop-ui/scripts/exampleStudyClassifier.ts
 */
import { classifyStudy, studyTextFromSimRow } from "../src/sheet/studyClassifier";
import { auditStudyTypes, formatAuditReport } from "../src/sheet/auditStudyTypes";

interface Position {
  ticker: string;
  clinicalStudy: string;
}

const positions: Position[] = [
  {
    ticker: "INBS",
    clinicalStudy:
      "FDA 510(k) submission for the Intelligent Fingerprinting Drug Screening System; multi-site Method Comparison Study vs predicate device; LC-MS/MS confirmation",
  },
  {
    ticker: "CMPX",
    clinicalStudy:
      "Phase 2/3 COMPANION-002 of tovecimig in biliary tract cancer; planned BLA submission; FDA feedback expected",
  },
  {
    ticker: "MLTX",
    clinicalStudy:
      "Phase 3 VELA study of sonelokimab in hidradenitis suppurativa; BLA filing planned end-Q3",
  },
  {
    ticker: "BIIB",
    clinicalStudy: "Phase 2 CELIA study of diranersen; LEQEMBI analyses",
  },
  {
    ticker: "VIR",
    clinicalStudy: "Phase 1 dual-masked T-cell engager, dose escalation",
  },
  {
    ticker: "XXXX",
    clinicalStudy: "clinical platform, multi-site enrollment",
  },
];

for (const p of positions) {
  const r = classifyStudy(p.clinicalStudy);
  console.log(`${p.ticker.padEnd(6)} -> ${r.klass}/${r.confidence}`);
}

const report = auditStudyTypes(
  positions,
  (p) => p.ticker,
  (p) => p.clinicalStudy,
);
console.log("\n" + formatAuditReport(report));

const simRow = {
  Ticker: "INBS",
  Fase: "Regulatory",
  Indication: "Drug screening device",
  "Clinical Study":
    "FDA 510(k) submission for the Intelligent Fingerprinting Drug Screening System; predicate device",
};
console.log("\nSim row:", studyTextFromSimRow(simRow));
console.log("Sim classify:", classifyStudy(studyTextFromSimRow(simRow)));
