/**
 * Build data/mobile_dashboard_snapshot.json from desktop snapshot JSON files.
 * Run: npx tsx scripts/build-mobile-dashboard-snapshot.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMobileDashboardSnapshotFromDataDir } from "./mobileDashboardSnapshotServer";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function joinDefaultData(repoRoot: string): string {
  return `${repoRoot}/data`;
}

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  if (i < 0 || i + 1 >= process.argv.length) return null;
  return process.argv[i + 1] ?? null;
}

const dataDir = resolve(argValue("--data-dir") ?? joinDefaultData(root));
const outPath = resolve(argValue("--out") ?? `${dataDir}/mobile_dashboard_snapshot.json`);
const lang = argValue("--lang") === "en" ? "en" : "it";

const snapshot = buildMobileDashboardSnapshotFromDataDir(dataDir, { lang });
if (!snapshot) {
  console.error("[mobile-snapshot] simulation_sheet_snapshot.json missing or empty");
  process.exit(1);
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(snapshot), "utf8");
console.log(
  `[mobile-snapshot] OK — ${snapshot.recommendations.length} recs, ` +
    `${snapshot.hero.portfolioCount} portfolio / ${snapshot.hero.opportunityCount} opps → ${outPath}`,
);
