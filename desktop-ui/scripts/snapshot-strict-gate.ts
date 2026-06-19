/**
 * Snapshot analysis: strict picks with/without market gate.
 * Run: npx tsx scripts/snapshot-strict-gate.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SheetTable } from "../src/types";
import { buildPickSignalsFromSimTable } from "../src/sheet/top2FromSimulation";
import { classifyTopOppsFromPickSignals } from "../src/sheet/topOppsFromSimulation";
import { passesStrictTopPick } from "../src/sheet/topOppsStrictPick";
import { roiPerDayFromPlan } from "../src/sheet/topOppQuality";
import {
  applyMarketContextGate,
  buildGatePayload,
  effectivePrecatKindForPick,
  type MarketContextDoc,
} from "../src/sheet/marketContextGate";
import { buildPrecatEntry, extractCurveInputs } from "../src/sheet/precatCurve";
import { daysFromToday } from "../src/sheet/simulationPlanGain";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const snap = JSON.parse(
  fs.readFileSync(path.join(root, "data/simulation_sheet_snapshot.json"), "utf8"),
) as SheetTable;
const ctx = JSON.parse(
  fs.readFileSync(path.join(root, "data/market_context.json"), "utf8"),
) as MarketContextDoc;

const UPSIDE = 1.5;
const MIN_AFF = 50;

function buildBypassSignals(ctxDoc: MarketContextDoc) {
  const all = buildPickSignalsFromSimTable(snap, {}, undefined, null);
  return all.map((s) => {
    const row = s.simRow ?? {};
    const cd = String(row["Completion Date"] ?? "");
    const days = daysFromToday(cd);
    const { slope5d, slope20d, runUp30d } = extractCurveInputs(row);
    const precatRaw = buildPrecatEntry(slope5d, slope20d, runUp30d, days);
    return {
      ...s,
      precatKind: precatRaw.kind,
      precatOriginalKind: precatRaw.kind,
      precatLabel: precatRaw.label,
      marketGate: null,
    };
  });
}

const gated = buildPickSignalsFromSimTable(snap, {}, undefined, ctx);
const bypass = buildBypassSignals(ctx);

function strictHot(signals: typeof gated) {
  const { hot } = classifyTopOppsFromPickSignals(signals, {
    mode: "strict",
    upsideThresholdPct: UPSIDE,
    minAffidabilita: MIN_AFF,
  });
  return hot;
}

function fmtRow(s: (typeof gated)[0]) {
  const aff = s.affid != null ? `${(s.affid * 100).toFixed(0)}%` : "—";
  const pk = s.precatKind ?? "—";
  const orig = s.precatOriginalKind ?? pk;
  const gate = orig !== pk ? `${orig}→${pk}` : pk;
  const roi = s.planReturnPct != null ? `${s.planReturnPct.toFixed(1)}%` : "—";
  const p5 = s.pred5 != null ? `${s.pred5.toFixed(1)}%` : "—";
  const rd = roiPerDayFromPlan(s.planReturnPct, s.planDays ?? s.days).toFixed(3);
  return `${s.ticker.padEnd(6)} CD ${String(s.days).padStart(3)}d | precat ${gate.padEnd(12)} | plan ${roi.padStart(6)} pred5 ${p5.padStart(6)} | aff ${aff} | ROI/d ${rd}`;
}

const gatedHot = strictHot(gated);
const bypassHot = strictHot(bypass);

const gatedStrict = gated.filter((s) =>
  passesStrictTopPick(s, { upsideThresholdPct: UPSIDE, minAffidabilita: MIN_AFF }),
);
const bypassStrict = bypass.filter((s) =>
  passesStrictTopPick(s, { upsideThresholdPct: UPSIDE, minAffidabilita: MIN_AFF }),
);

// Tickers that pass without gate but blocked by gate
const blockedByGate = bypassStrict.filter((s) => {
  const g = gated.find((x) => x.ticker === s.ticker && x.cd === s.cd);
  return g && !passesStrictTopPick(g, { upsideThresholdPct: UPSIDE, minAffidabilita: MIN_AFF });
});

console.log("=== MARKET REGIME (6 Jun 2026) ===");
console.log(`Regime: ${ctx.regime}`);
console.log(`Motivo: ${ctx.gate_reason}`);
console.log(
  `XBI 5d ${ctx.signals?.xbi_5d_return}% | XBI 20d ${ctx.signals?.xbi_20d_return}% | TLT 5d ${ctx.signals?.tlt_5d_return}% | VIX ${ctx.signals?.vix_level}`,
);
console.log(`Soglie strict: upside pred5 ≥ ${UPSIDE}% | affid ≥ ${MIN_AFF}%`);
console.log("");

console.log(`=== CON GATE (risk-off attivo) — strict hot: ${gatedHot.length} ===`);
if (gatedHot.length === 0) console.log("  (nessuno)");
else gatedHot.slice(0, 15).forEach((s) => console.log(" ", fmtRow(s)));

console.log("");
console.log(`=== SENZA GATE (bypass) — strict hot: ${bypassHot.length} ===`);
if (bypassHot.length === 0) console.log("  (nessuno)");
else bypassHot.slice(0, 15).forEach((s) => console.log(" ", fmtRow(s)));

console.log("");
console.log(`=== BLOCCATI DAL GATE (${blockedByGate.length} ticker passerebbero strict senza gate) ===`);
for (const s of blockedByGate.slice(0, 20)) {
  const row = s.simRow ?? {};
  const days = daysFromToday(String(row["Completion Date"] ?? ""));
  const { slope5d, slope20d, runUp30d } = extractCurveInputs(row);
  const precat = buildPrecatEntry(slope5d, slope20d, runUp30d, days);
  const gate = buildGatePayload(precat.kind, ctx.regime ?? "NEUTRAL", ctx.signals);
  console.log(`  ${fmtRow(s)}`);
  console.log(`         gate: ${gate.gate_reason}`);
}

// Notable failures without gate
console.log("");
console.log("=== ESEMPI NOTI (senza gate) ===");
for (const tk of ["PLSE", "BCAB", "TLX", "PBYI", "CRDF", "TELA"]) {
  const s = bypass.find((x) => x.ticker === tk);
  if (!s) {
    console.log(`  ${tk}: non in universo simulation attivo`);
    continue;
  }
  const ok = passesStrictTopPick(s, { upsideThresholdPct: UPSIDE, minAffidabilita: MIN_AFF });
  const g = gated.find((x) => x.ticker === tk);
  const okGated = g
    ? passesStrictTopPick(g, { upsideThresholdPct: UPSIDE, minAffidabilita: MIN_AFF })
    : false;
  console.log(
    `  ${tk}: strict ${ok ? "SÌ" : "NO"} | con gate ${okGated ? "SÌ" : "NO"} | precat ${s.precatOriginalKind ?? s.precatKind}${g && g.precatKind !== s.precatKind ? ` → ${g.precatKind}` : ""}`,
  );
}
