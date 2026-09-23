/**
 * Declared Soft BUY / Soft SELL logic eras over calendar time.
 *
 * We do **not** have a tick-level audit log of which gates fired in May.
 * This chronology records when product logic was introduced / changed so the
 * breakeven week modal never pretends P(cont) (etc.) applied before its era.
 *
 * Dates are inclusive on `from`, exclusive on the next era's `from`.
 * Adjust here when shipping a new Soft Soft rule change.
 */

export type SoftLogicGateId =
  | "sds"
  | "pplan"
  | "pcont"
  | "rising"
  | "top2"
  | "forward"
  | "precat"
  | "mtm"
  | "riskV2"
  | "reg"
  | "g10"
  | "edge"
  | "urgent_g2"
  | "giveback";

export type SoftLogicGateDef = {
  id: SoftLogicGateId;
  label: string;
  /** Numeric min/max gate when applicable; null = structural / non-numeric. */
  gate: number | null;
  side: "buy" | "sell";
  /** Can we score clearance from today's book indices? */
  scoreable: boolean;
  detailIt: string;
  detailEn: string;
};

export type SoftLogicEra = {
  id: string;
  /** ISO date YYYY-MM-DD inclusive. */
  from: string;
  /** Display generation: Gen 0 … Gen 5. */
  gen: 0 | 1 | 2 | 3 | 4 | 5;
  labelIt: string;
  labelEn: string;
  shortLabel: string;
  summaryIt: string;
  summaryEn: string;
  /** RGB for under-curve fill / era chips (fade via alpha in UI). */
  curveRgb: { r: number; g: number; b: number };
  buyGates: SoftLogicGateDef[];
  sellGates: SoftLogicGateDef[];
};

/** Under-curve / chip fill for an era at the given opacity (0–1). */
export function softLogicEraFill(
  era: SoftLogicEra,
  alpha = 0.28,
): string {
  const a = Math.max(0, Math.min(1, alpha));
  const { r, g, b } = era.curveRgb;
  return `rgba(${r},${g},${b},${a})`;
}

/** Hex swatch for legends (full saturation). */
export function softLogicEraHex(era: SoftLogicEra): string {
  const { r, g, b } = era.curveRgb;
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

const gate = (
  id: SoftLogicGateId,
  label: string,
  g: number | null,
  side: "buy" | "sell",
  scoreable: boolean,
  detailIt: string,
  detailEn: string,
): SoftLogicGateDef => ({
  id,
  label,
  gate: g,
  side,
  scoreable,
  detailIt,
  detailEn,
});

/**
 * Product chronology — keep in sync with SOFT_BUY_SELL_HANDOFF / softSignalGrades.
 * P(cont) Soft BUY quality + continuation take-profit: early Aug 2026 (user).
 * Soft volume SDS 20 + Urgent G2: 2026-07-26 (code comment).
 * Soft G1 SDS 25 trial: July 2026 before volume loosen.
 * Pre-July: classic Top2 / P(plan) / SDS / forward arbiter (no Soft Soft stack).
 */
export const SOFT_LOGIC_ERAS: SoftLogicEra[] = [
  {
    id: "classic_top2_pplan",
    from: "2020-01-01",
    gen: 0,
    labelIt: "Gen 0 · Top2 + P(plan) + SDS",
    labelEn: "Gen 0 · Top2 + P(plan) + SDS",
    shortLabel: "Gen 0",
    summaryIt:
      "Prima dello stack Soft Soft: ingresso/uscita guidati da Top2, P(plan), SDS e forward. Nessun Soft BUY volume, nessun P(cont).",
    summaryEn:
      "Before Soft Soft stack: entry/exit driven by Top2, P(plan), SDS and forward. No Soft BUY volume, no P(cont).",
    curveRgb: { r: 100, g: 116, b: 139 }, // slate
    buyGates: [
      gate("pplan", "P(plan)", 60, "buy", true, "Soglia ingresso classica ~60%", "Classic entry floor ~60%"),
      gate("sds", "SDS", 25, "buy", true, "Soglia studio pre-volume", "Pre-volume study floor"),
      gate("top2", "Top2", null, "buy", false, "yes / ENTER per promuovere", "yes / ENTER to promote"),
      gate("forward", "Forward %", 3, "buy", false, "Target piano forward", "Forward plan target"),
    ],
    sellGates: [
      gate("mtm", "MTM %", -4, "sell", true, "Uscita su perdita aperta (legacy)", "Exit on open loss (legacy)"),
      gate("top2", "Top2 exit", null, "sell", false, "Verdetto uscita modello", "Model exit verdict"),
      gate("pplan", "P(plan)↓", 50, "sell", true, "Piano debole su libro rosso", "Weak plan on losing book"),
    ],
  },
  {
    id: "soft_g1_sds25",
    from: "2026-07-01",
    gen: 1,
    labelIt: "Gen 1 · Soft SDS≥25",
    labelEn: "Gen 1 · Soft SDS≥25",
    shortLabel: "Gen 1",
    summaryIt:
      "Soft BUY G1 introdotto (SDS≥25 · P(plan)≥50 · Top2≠NO · ↑≥2d). Soft SELL su MTM/risk/reg. Ancora senza P(cont).",
    summaryEn:
      "Soft BUY G1 introduced (SDS≥25 · P(plan)≥50 · Top2≠NO · ↑≥2d). Soft SELL on MTM/risk/reg. Still no P(cont).",
    curveRgb: { r: 124, g: 58, b: 237 }, // violet
    buyGates: [
      gate("sds", "SDS", 25, "buy", true, "Soft BUY G1 (pre-volume)", "Soft BUY G1 (pre-volume)"),
      gate("pplan", "P(plan)", 50, "buy", true, "Coin-flip piano", "Plan coin-flip"),
      gate("top2", "Top2≠NO", null, "buy", false, "WAIT ok · NO blocca", "WAIT ok · NO blocks"),
      gate("rising", "↑≥2d", null, "buy", false, "Streak sessioni verdi", "Green session streak"),
      gate("precat", "Precat≠sell", null, "buy", false, "Blocca ingresso", "Blocks entry"),
    ],
    sellGates: [
      gate("mtm", "MTM %", -2.5, "sell", true, "Soft SELL con risk/reg/P", "Soft SELL with risk/reg/P"),
      gate("riskV2", "Risk v2", 40, "sell", true, "Pressione rischio", "Risk pressure"),
      gate("reg", "Reg", 45, "sell", true, "Rischio regolatorio", "Regulatory risk"),
      gate("pplan", "P(plan)↓", 50, "sell", true, "Piano debole", "Weak plan"),
    ],
  },
  {
    id: "soft_g1_volume_sds20",
    from: "2026-07-26",
    gen: 2,
    labelIt: "Gen 2 · Soft volume SDS≥20 + G2",
    labelEn: "Gen 2 · Soft volume SDS≥20 + G2",
    shortLabel: "Gen 2",
    summaryIt:
      "Trial volume: SDS≥20 · Soft BUY largo + Urgent SELL G2 (budget 20% vincite day). Ancora senza filtro P(cont).",
    summaryEn:
      "Volume trial: SDS≥20 · wide Soft BUY + Urgent SELL G2 (20% day-wins budget). Still no P(cont) filter.",
    curveRgb: { r: 234, g: 88, b: 12 }, // orange
    buyGates: [
      gate("sds", "SDS", 20, "buy", true, "Volume Soft BUY", "Volume Soft BUY"),
      gate("pplan", "P(plan)", 50, "buy", true, "Coin-flip piano", "Plan coin-flip"),
      gate("top2", "Top2≠NO", null, "buy", false, "WAIT ok", "WAIT ok"),
      gate("rising", "↑≥2d", null, "buy", false, "Timing nastro", "Tape timing"),
      gate("precat", "Precat≠sell", null, "buy", false, "Veto pre-CD", "Pre-CD veto"),
    ],
    sellGates: [
      gate("mtm", "MTM %", -2.5, "sell", true, "Soft SELL G1 / deep −12%", "Soft SELL G1 / deep −12%"),
      gate("riskV2", "Risk v2", 40, "sell", true, "Con MTM≤−2.5%", "With MTM≤−2.5%"),
      gate("reg", "Reg", 45, "sell", true, "Con MTM≤−2.5%", "With MTM≤−2.5%"),
      gate("pplan", "P(plan)↓", 50, "sell", true, "Piano debole", "Weak plan"),
      gate("urgent_g2", "Urgent G2", null, "sell", false, "Budget 20% vincite day", "20% day-wins budget"),
    ],
  },
  {
    id: "soft_g1_pcont",
    from: "2026-08-05",
    gen: 3,
    labelIt: "Gen 3 · Soft + P(cont) / edge",
    labelEn: "Gen 3 · Soft + P(cont) / edge",
    shortLabel: "Gen 3",
    summaryIt:
      "Aggiunto P(cont)/edge: se 10d%≥+5% non Soft BUY su corsa esausta; take-profit Soft SELL se edge>0.",
    summaryEn:
      "Added P(cont)/edge: if 10d%≥+5% no Soft BUY on exhausted run; Soft SELL take-profit when edge>0.",
    curveRgb: { r: 8, g: 145, b: 178 }, // cyan
    buyGates: [
      gate("sds", "SDS", 20, "buy", true, "Volume Soft BUY", "Volume Soft BUY"),
      gate("pplan", "P(plan)", 50, "buy", true, "Coin-flip piano", "Plan coin-flip"),
      gate("pcont", "P(cont)", 50, "buy", true, "Solo se G10≥+5%", "Only if G10≥+5%"),
      gate("g10", "G10 / edge", null, "buy", false, "Regime corsa + edge≤0", "Run regime + edge≤0"),
      gate("top2", "Top2≠NO", null, "buy", false, "WAIT ok", "WAIT ok"),
      gate("rising", "↑≥2d", null, "buy", false, "Timing nastro", "Tape timing"),
      gate("precat", "Precat≠sell", null, "buy", false, "Veto pre-CD", "Pre-CD veto"),
    ],
    sellGates: [
      gate("mtm", "MTM %", -2.5, "sell", true, "Soft SELL G1 / deep −12%", "Soft SELL G1 / deep −12%"),
      gate("riskV2", "Risk v2", 40, "sell", true, "Con MTM≤−2.5%", "With MTM≤−2.5%"),
      gate("reg", "Reg", 45, "sell", true, "Con MTM≤−2.5%", "With MTM≤−2.5%"),
      gate("pplan", "P(plan)↓", 50, "sell", true, "Piano debole", "Weak plan"),
      gate("pcont", "P(cont)", 50, "sell", true, "Contesto esaurimento", "Exhaustion context"),
      gate("edge", "Edge>0", null, "sell", false, "Take-profit continuation", "Continuation take-profit"),
      gate("urgent_g2", "Urgent G2", null, "sell", false, "Budget 20% vincite day", "20% day-wins budget"),
    ],
  },
  {
    id: "soft_g4_volume_giveback",
    from: "2026-08-09",
    gen: 4,
    labelIt: "Gen 4 · Soft volume + giveback 25%",
    labelEn: "Gen 4 · Soft volume + giveback 25%",
    shortLabel: "Gen 4",
    summaryIt:
      "Soft BUY più largo: Top2 NO / P(cont) solo ranking. Home Soft Soft: size Grade 3 (strong/mid/weak). Flash Test: capitale fisso per trade (stesso € di Gen 0–3). Soft SELL giveback ≥25% del picco € solo se MTM<0; deep −12% e Urgent G2 restano.",
    summaryEn:
      "Wider Soft BUY: Top2 NO / P(cont) ranking only. Home Soft Soft: Grade 3 size (strong/mid/weak). Flash Test: fixed capital per trade (same € as Gen 0–3). Soft SELL giveback ≥25% of peak € only when MTM<0; deep −12% and Urgent G2 remain.",
    curveRgb: { r: 16, g: 185, b: 129 }, // emerald
    buyGates: [
      gate("sds", "SDS", 20, "buy", true, "Volume Soft BUY", "Volume Soft BUY"),
      gate("pplan", "P(plan)", 50, "buy", true, "Coin-flip piano", "Plan coin-flip"),
      gate("rising", "↑≥2d", null, "buy", false, "Timing nastro", "Tape timing"),
      gate("precat", "Precat≠sell", null, "buy", false, "Veto pre-CD", "Pre-CD veto"),
      gate("top2", "Top2", null, "buy", false, "Solo ranking (NO non blocca)", "Rank only (NO does not block)"),
      gate("pcont", "P(cont)", 50, "buy", true, "Solo ranking / edge", "Rank / edge only"),
    ],
    sellGates: [
      gate("giveback", "Giveback", 25, "sell", false, "≥25% del picco € e MTM<0", "≥25% of peak € and MTM<0"),
      gate("mtm", "MTM %", -2.5, "sell", true, "Soft SELL G1 / deep −12%", "Soft SELL G1 / deep −12%"),
      gate("riskV2", "Risk v2", 40, "sell", true, "Con MTM≤−2.5%", "With MTM≤−2.5%"),
      gate("reg", "Reg", 45, "sell", true, "Con MTM≤−2.5%", "With MTM≤−2.5%"),
      gate("pplan", "P(plan)↓", 50, "sell", true, "Piano debole", "Weak plan"),
      gate("pcont", "P(cont)", 50, "sell", true, "Contesto esaurimento", "Exhaustion context"),
      gate("edge", "Edge>0", null, "sell", false, "Take-profit continuation", "Continuation take-profit"),
      gate("urgent_g2", "Urgent G2", null, "sell", false, "Budget 20% vincite day", "20% day-wins budget"),
    ],
  },
  {
    id: "soft_g5_purchased_plus_gains",
    from: "2026-08-13",
    gen: 5,
    labelIt: "Gen 5 · G2 su acquistato+guadagnato · campanella 20%",
    labelEn: "Gen 5 · G2 on purchased+gains · 20% bell",
    shortLabel: "Gen 5",
    summaryIt:
      "Urgent SELL G2: perdite day > 20% di (capitale acquistato + guadagni aperti) sul portafoglio; vende prima i ribassi day più drastiche. Campanella rossa per-titolo: giveback ≥% del G/L vinto (default 10%, settabile). Soft Soft giveback Suggested SELL: drop ≥20% di (acquistato + picco) con MTM<0.",
    summaryEn:
      "Urgent SELL G2: day losses > 20% of (purchased capital + open gains) on the book; sells fastest day losers first. Per-ticker red bell: giveback ≥% of G/L won (default 10%, user-settable). Soft Soft giveback Suggested SELL: drop ≥20% of (purchased + peak) while MTM<0.",
    curveRgb: { r: 225, g: 29, b: 72 }, // rose
    buyGates: [
      gate("sds", "SDS", 20, "buy", true, "Volume Soft BUY", "Volume Soft BUY"),
      gate("pplan", "P(plan)", 50, "buy", true, "Coin-flip piano", "Plan coin-flip"),
      gate("rising", "↑≥2d", null, "buy", false, "Timing nastro", "Tape timing"),
      gate("precat", "Precat≠sell", null, "buy", false, "Veto pre-CD", "Pre-CD veto"),
      gate("top2", "Top2", null, "buy", false, "Solo ranking (NO non blocca)", "Rank only (NO does not block)"),
      gate("pcont", "P(cont)", 50, "buy", true, "Solo ranking / edge", "Rank / edge only"),
    ],
    sellGates: [
      gate(
        "giveback",
        "Giveback",
        20,
        "sell",
        false,
        "≥20% di (acquistato+guadagni) e MTM<0",
        "≥20% of (purchased+gains) and MTM<0",
      ),
      gate("mtm", "MTM %", -2.5, "sell", true, "Soft SELL G1 / deep −12%", "Soft SELL G1 / deep −12%"),
      gate("riskV2", "Risk v2", 40, "sell", true, "Con MTM≤−2.5%", "With MTM≤−2.5%"),
      gate("reg", "Reg", 45, "sell", true, "Con MTM≤−2.5%", "With MTM≤−2.5%"),
      gate("pplan", "P(plan)↓", 50, "sell", true, "Piano debole", "Weak plan"),
      gate("pcont", "P(cont)", 50, "sell", true, "Contesto esaurimento", "Exhaustion context"),
      gate("edge", "Edge>0", null, "sell", false, "Take-profit continuation", "Continuation take-profit"),
      gate(
        "urgent_g2",
        "Urgent G2",
        null,
        "sell",
        false,
        "Budget 20% acquistato+guadagnato",
        "20% purchased+gains budget",
      ),
    ],
  },
];

function dayKey(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

/** Era in force on a given timestamp (inclusive from, exclusive next.from). */
export function resolveSoftLogicEra(isoTs: string): SoftLogicEra {
  const day = dayKey(isoTs);
  let active = SOFT_LOGIC_ERAS[0]!;
  for (const era of SOFT_LOGIC_ERAS) {
    if (day >= era.from) active = era;
  }
  return active;
}

export function softLogicEraEnd(era: SoftLogicEra): string | null {
  const idx = SOFT_LOGIC_ERAS.findIndex((e) => e.id === era.id);
  const next = idx >= 0 ? SOFT_LOGIC_ERAS[idx + 1] : undefined;
  return next?.from ?? null;
}

export function scoreableGateIds(era: SoftLogicEra, side: "buy" | "sell"): Set<string> {
  const gates = side === "buy" ? era.buyGates : era.sellGates;
  return new Set(gates.filter((g) => g.scoreable).map((g) => g.id));
}

export type SoftLogicEraGain = {
  era: SoftLogicEra;
  /** Net curve Δ while this Gen was in force (sum of consecutive point moves). */
  delta: number;
  weekCount: number;
  fromTs: string | null;
  toTs: string | null;
  /** Capital at first point of this Gen window (for % on invested). */
  investedCapital: number | null;
  /** delta / investedCapital as % (1 decimal); null if capital unknown. */
  gainPctOnInvested: number | null;
};

function emptyEraGain(era: SoftLogicEra): SoftLogicEraGain {
  return {
    era,
    delta: 0,
    weekCount: 0,
    fromTs: null,
    toTs: null,
    investedCapital: null,
    gainPctOnInvested: null,
  };
}

function pctOnInvested(delta: number, capital: number | null): number | null {
  if (capital == null || !(capital > 0) || !Number.isFinite(delta)) return null;
  return Math.round((delta / capital) * 1000) / 10;
}

/** Monday-based ISO week key (local to this module — avoid circular imports). */
function isoWeekKey(iso: string): string | null {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/** Horizontal gradient stops for under-curve Gen coloring (faded rgba). */
export function buildSoftLogicEraGradientStops(
  points: { ts: string }[],
  alpha = 0.3,
): { offset: string; color: string }[] {
  if (points.length < 1) return [];
  const n = Math.max(1, points.length - 1);
  return points.map((p, i) => {
    const era = resolveSoftLogicEra(p.ts);
    return {
      offset: `${(i / n) * 100}%`,
      color: softLogicEraFill(era, alpha),
    };
  });
}

/**
 * Curve-true Gen gains: attribute each consecutive segment Δ to the Gen in
 * force at the **end** of the segment (when the move realized).
 * Prefer this over summing whole-week buckets (weeks can straddle cutovers).
 */
export function aggregateGainBySoftLogicEraFromCurve(
  points: { ts: string; value: number; capital?: number | null }[],
): SoftLogicEraGain[] {
  const byId = new Map<string, SoftLogicEraGain>();
  const weeksByEra = new Map<string, Set<string>>();
  for (const era of SOFT_LOGIC_ERAS) {
    byId.set(era.id, emptyEraGain(era));
    weeksByEra.set(era.id, new Set());
  }
  if (points.length < 2) return [];

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    const era = resolveSoftLogicEra(cur.ts);
    const row = byId.get(era.id);
    if (!row) continue;
    const seg = (Number(cur.value) || 0) - (Number(prev.value) || 0);
    row.delta = Math.round((row.delta + seg) * 100) / 100;
    if (!row.fromTs || prev.ts < row.fromTs) row.fromTs = prev.ts;
    if (!row.toTs || cur.ts > row.toTs) row.toTs = cur.ts;
    if (row.investedCapital == null) {
      const c0 = prev.capital;
      const c1 = cur.capital;
      const cap =
        c0 != null && Number.isFinite(c0) && c0 > 0
          ? c0
          : c1 != null && Number.isFinite(c1) && c1 > 0
            ? c1
            : null;
      if (cap != null) row.investedCapital = Math.round(cap * 100) / 100;
    }
    const wk = isoWeekKey(cur.ts);
    if (wk) weeksByEra.get(era.id)?.add(wk);
  }

  for (const era of SOFT_LOGIC_ERAS) {
    const row = byId.get(era.id)!;
    const weeks = weeksByEra.get(era.id)!;
    row.weekCount = weeks.size;
    row.gainPctOnInvested = pctOnInvested(row.delta, row.investedCapital);
  }

  return SOFT_LOGIC_ERAS.map((e) => byId.get(e.id)!).filter((r) => r.weekCount > 0);
}

/**
 * @deprecated Prefer {@link aggregateGainBySoftLogicEraFromCurve} — whole-week
 * attribution mis-assigns straddling cutovers (e.g. week starting Gen 0 / mid Gen 1).
 */
export function aggregateGainBySoftLogicEra(
  weeks: { startTs: string; endTs: string; delta: number; capital?: number | null }[],
): SoftLogicEraGain[] {
  const byId = new Map<string, SoftLogicEraGain>();
  for (const era of SOFT_LOGIC_ERAS) {
    byId.set(era.id, emptyEraGain(era));
  }
  for (const w of weeks) {
    const era = resolveSoftLogicEra(w.startTs);
    const row = byId.get(era.id);
    if (!row) continue;
    row.delta = Math.round((row.delta + w.delta) * 100) / 100;
    row.weekCount += 1;
    if (!row.fromTs || w.startTs < row.fromTs) row.fromTs = w.startTs;
    if (!row.toTs || w.endTs > row.toTs) row.toTs = w.endTs;
    if (row.investedCapital == null && w.capital != null && w.capital > 0) {
      row.investedCapital = w.capital;
    }
  }
  for (const row of byId.values()) {
    row.gainPctOnInvested = pctOnInvested(row.delta, row.investedCapital);
  }
  return SOFT_LOGIC_ERAS.map((e) => byId.get(e.id)!).filter((r) => r.weekCount > 0);
}
