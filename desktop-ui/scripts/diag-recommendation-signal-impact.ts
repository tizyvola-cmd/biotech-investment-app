/**
 * Dry-run: how many operational recommendations would change with BETA/LIQ demotion.
 * Does not write any state.
 *
 *   npx tsx scripts/diag-recommendation-signal-impact.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { buildRecommendationSignalCtx } from "../src/sheet/recommendationSignalGates";
import { applyDirectionalSignalDemotion } from "../src/sheet/recommendationSignalGates";

type SimSnap = { rows?: Record<string, unknown>[] };

function loadSim(): Record<string, unknown>[] {
  const p = resolve(process.cwd(), "../data/simulation_sheet_snapshot.json");
  if (!existsSync(p)) return [];
  const doc = JSON.parse(readFileSync(p, "utf-8")) as SimSnap & {
    rows?: Record<string, unknown>[] | Record<string, Record<string, unknown>>;
  };
  if (Array.isArray(doc.rows)) return doc.rows;
  if (doc.rows && typeof doc.rows === "object") return Object.values(doc.rows);
  return [];
}

function main() {
  const rows = loadSim();
  let withBeta = 0;
  let withLiq = 0;
  let buyDemoteIfWereBuy = 0;

  for (const row of rows) {
    const ctx = buildRecommendationSignalCtx(row);
    if (ctx.beta != null) withBeta += 1;
    if (ctx.liquidityFy != null) withLiq += 1;
    const demote = applyDirectionalSignalDemotion("buy", ctx);
    if (demote.demoted) buyDemoteIfWereBuy += 1;
  }

  console.log(
    JSON.stringify(
      {
        rows: rows.length,
        coverage: { withBeta, withLiq },
        /** Upper bound: rows that would block a BUY if the engine said BUY. */
        structuralBuyBlocksIfBuy: buyDemoteIfWereBuy,
        note:
          "Direction flips on live portfolio require full deriveSuggestedAction; this reports structural BUY blocks only.",
      },
      null,
      2,
    ),
  );
}

main();
