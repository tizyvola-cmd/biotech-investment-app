/**
 * Compare Soft Logic Gen 0–3 on the last 3 calendar weeks of open-book curve.
 *
 * Important: this attributes the *actual* portfolio curve by which Gen was in
 * force when each segment realized — not a counterfactual replay of Gen 0–3
 * trading rules on the same names (we do not have that audit).
 *
 *   npx tsx scripts/diag-soft-logic-last3w.ts
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SOFT_LOGIC_ERAS,
  aggregateGainBySoftLogicEraFromCurve,
  resolveSoftLogicEra,
  type SoftLogicEraGain,
} from "../src/sheet/softLogicChronology";

const __dirname = dirname(fileURLToPath(import.meta.url));

type HistPoint = {
  ts: string;
  value?: number;
  pnl?: number;
  capital?: number;
  byTicker?: Record<string, { value?: number; pnl?: number }>;
};

function readHistory(): HistPoint[] {
  const p = resolve(__dirname, "../../data/invest_sim_history.json");
  const raw = JSON.parse(readFileSync(p, "utf8")) as {
    history?: HistPoint[];
    points?: HistPoint[];
  };
  const arr = raw.history ?? raw.points ?? (Array.isArray(raw) ? (raw as HistPoint[]) : []);
  return [...arr].sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
}

function openPnl(p: HistPoint): number {
  if (p.value != null && Number.isFinite(p.value)) return Number(p.value);
  if (p.pnl != null && Number.isFinite(p.pnl)) return Number(p.pnl);
  return 0;
}

function mondayUtc(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() - (day - 1));
  return x;
}

function fmtEur(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}$${Math.round(n).toLocaleString("en-US")}`;
}

function fmtPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function main() {
  const hist = readHistory();
  if (hist.length < 2) {
    console.error("invest_sim_history.json: too few points");
    process.exit(1);
  }

  const lastTs = new Date(hist[hist.length - 1]!.ts);
  // Rolling last 21 calendar days through latest history point (≈ 3 weeks).
  const start = new Date(
    Date.UTC(lastTs.getUTCFullYear(), lastTs.getUTCMonth(), lastTs.getUTCDate()),
  );
  start.setUTCDate(start.getUTCDate() - 21);
  const startIso = start.toISOString();

  const window = hist.filter((p) => p.ts >= startIso);
  // Need one point before window for first segment Δ
  const idx0 = hist.findIndex((p) => p.ts >= startIso);
  const withPrev =
    idx0 > 0 ? [hist[idx0 - 1]!, ...window] : window;

  const points = withPrev.map((p) => ({
    ts: p.ts,
    value: openPnl(p),
    capital: p.capital != null && p.capital > 0 ? p.capital : null,
  }));

  console.log("=== Soft Logic Gen compare · last ~3 weeks (actual curve attribution) ===");
  console.log(`History points: ${hist.length} · window from ${start.toISOString().slice(0, 10)} → ${lastTs.toISOString().slice(0, 10)}`);
  console.log(`Curve points in window (+1 prev): ${points.length}`);
  console.log("");
  console.log("Era cutovers:");
  for (const e of SOFT_LOGIC_ERAS) {
    console.log(`  ${e.shortLabel} from ${e.from} · ${e.labelEn}`);
  }
  console.log("");

  const gains = aggregateGainBySoftLogicEraFromCurve(points);
  const byGen = new Map<number, SoftLogicEraGain>();
  for (const g of gains) byGen.set(g.era.gen, g);

  // Also total window Δ
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const totalDelta = Math.round((last.value - first.value) * 100) / 100;

  console.log(`Total open-book curve Δ in window: ${fmtEur(totalDelta)}`);
  console.log("");
  console.log(
    "Gen | Δ curve | % on capital | weeks w/ activity | window in force (in sample)",
  );
  console.log("-".repeat(78));

  let best: SoftLogicEraGain | null = null;
  for (const era of SOFT_LOGIC_ERAS) {
    const g = byGen.get(era.gen);
    if (!g) {
      console.log(
        `${era.shortLabel} | (not in force in this window) | — | 0 | —`,
      );
      continue;
    }
    if (!best || g.delta > best.delta) best = g;
    const from = g.fromTs?.slice(0, 10) ?? "—";
    const to = g.toTs?.slice(0, 10) ?? "—";
    console.log(
      `${era.shortLabel} | ${fmtEur(g.delta).padStart(10)} | ${fmtPct(g.gainPctOnInvested).padStart(8)} | ${String(g.weekCount).padStart(2)}w | ${from} → ${to}`,
    );
  }

  // Per-week breakdown for clarity
  console.log("");
  console.log("=== Weekly sessions (Mon week) · which Gen was in force at week end ===");
  type W = { key: string; start: string; end: string; delta: number; era: string };
  const weeks = new Map<string, { first: typeof points[0]; last: typeof points[0]; delta: number }>();
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    const d = new Date(cur.ts);
    const mon = mondayUtc(d);
    const key = mon.toISOString().slice(0, 10);
    const seg = cur.value - prev.value;
    const row = weeks.get(key);
    if (!row) {
      weeks.set(key, { first: prev, last: cur, delta: seg });
    } else {
      row.last = cur;
      row.delta += seg;
    }
  }
  const weekRows: W[] = [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, w]) => ({
      key,
      start: w.first.ts.slice(0, 10),
      end: w.last.ts.slice(0, 10),
      delta: Math.round(w.delta * 100) / 100,
      era: resolveSoftLogicEra(w.last.ts).shortLabel,
    }));
  // Only show weeks that overlap the 3w window (skip pure prev seed week if empty)
  for (const w of weekRows) {
    if (w.end < start.toISOString().slice(0, 10)) continue;
    console.log(
      `  week of ${w.key}: ${fmtEur(w.delta).padStart(10)} · era@end ${w.era} · ${w.start}→${w.end}`,
    );
  }

  // $/week normalization for gens that were active
  console.log("");
  console.log("=== Normalized (Δ / weekCount) — fairer when eras have different lengths ===");
  const active = SOFT_LOGIC_ERAS.map((e) => byGen.get(e.gen)).filter(
    (g): g is SoftLogicEraGain => !!g && g.weekCount > 0,
  );
  for (const g of active) {
    const perW = Math.round((g.delta / g.weekCount) * 100) / 100;
    console.log(
      `  ${g.era.shortLabel}: ${fmtEur(perW)} / week  (raw ${fmtEur(g.delta)} over ${g.weekCount}w)`,
    );
  }

  console.log("");
  if (best && best.delta > 0) {
    console.log(
      `Verdict (actual curve, last ~3w): strongest Gen in-force = ${best.era.shortLabel} at ${fmtEur(best.delta)} (${fmtPct(best.gainPctOnInvested)} on capital).`,
    );
  } else if (best) {
    console.log(
      `Verdict (actual curve, last ~3w): least-negative Gen in-force = ${best.era.shortLabel} at ${fmtEur(best.delta)}.`,
    );
  } else {
    console.log("Verdict: no Gen activity in window.");
  }
  console.log(
    "Note: Gen chips on Home = lifetime-while-in-force, not a 3-week counterfactual of all 4 logics.",
  );
}

main();
