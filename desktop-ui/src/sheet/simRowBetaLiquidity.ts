import type { CSSProperties } from "react";

function findCol(row: Record<string, unknown>, ...keywords: string[]): unknown {
  for (const kw of keywords) {
    const lo = kw.toLowerCase();
    const key = Object.keys(row).find((k) => k.toLowerCase().includes(lo));
    if (key) return row[key];
  }
  return undefined;
}

export function toSimMetricNum(raw: unknown): number | null {
  if (raw == null || raw === "" || raw === "—") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, ".").replace(/%/g, ""));
  return Number.isFinite(n) ? n : null;
}

function clip01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Same weights as ``prediction.financial_liquidity.liquidity_score``. */
export function computeLiquidityScore(
  currentRatio: number | null,
  quickRatio: number | null,
  cashRatio: number | null,
): number | null {
  const parts: { w: number; v: number }[] = [];
  if (currentRatio != null) parts.push({ w: 0.4, v: clip01(currentRatio / 2) });
  if (quickRatio != null) parts.push({ w: 0.35, v: clip01(quickRatio / 1.5) });
  if (cashRatio != null) parts.push({ w: 0.25, v: clip01(cashRatio / 0.5) });
  if (!parts.length) return null;
  const wSum = parts.reduce((s, p) => s + p.w, 0);
  return wSum > 0 ? parts.reduce((s, p) => s + p.w * p.v, 0) / wSum : 1;
}

export function parseLiquidityRatiosFromDisplay(raw: string): {
  currentRatio: number | null;
  quickRatio: number | null;
  cashRatio: number | null;
} {
  const s = raw.trim();
  const cr = /CR\s*([\d.]+)/i.exec(s);
  const qr = /QR\s*([\d.]+)/i.exec(s);
  const cash =
    /Cash[^|]*?([\d.]+)\s*M/i.exec(s) ??
    /Cash\s*([\d.]+)/i.exec(s) ??
    /CAR\s*([\d.]+)/i.exec(s);
  return {
    currentRatio: cr ? toSimMetricNum(cr[1]) : null,
    quickRatio: qr ? toSimMetricNum(qr[1]) : null,
    cashRatio: cash ? toSimMetricNum(cash[1]) : null,
  };
}

export function normalizeLiquidityScore(raw: number): number {
  if (raw > 1 && raw <= 100) return raw / 100;
  if (raw > 100) return 1;
  return Math.max(0, Math.min(1, raw));
}

export function resolveSimRowBeta(simRow: Record<string, unknown>): number | null {
  return toSimMetricNum(
    simRow.beta ??
      simRow.Beta ??
      findCol(simRow, "beta (5y", "beta"),
  );
}

export function resolveSimRowLiquidityScore(simRow: Record<string, unknown>): number | null {
  const direct = toSimMetricNum(
    findCol(simRow, "liquidity_score", "liquidity score", "liq score"),
  );
  if (direct != null) return normalizeLiquidityScore(direct);

  const cr = toSimMetricNum(simRow.current_ratio ?? findCol(simRow, "current_ratio", "current ratio"));
  const qr = toSimMetricNum(simRow.quick_ratio ?? findCol(simRow, "quick_ratio", "quick ratio"));
  const car = toSimMetricNum(simRow.cash_ratio ?? findCol(simRow, "cash_ratio", "cash ratio"));
  const fromCols = computeLiquidityScore(cr, qr, car);
  if (fromCols != null) return fromCols;

  const fyRaw = String(
    simRow.liquidita_fy ??
      findCol(
        simRow,
        "liquidità (fy)",
        "liquidita (fy)",
        "liquidity (fy)",
        "liquidita_fy",
        "liquidità",
        "liquidity fy",
      ) ??
      "",
  ).trim();
  if (!fyRaw || fyRaw === "—") return null;
  const parsed = parseLiquidityRatiosFromDisplay(fyRaw);
  return computeLiquidityScore(parsed.currentRatio, parsed.quickRatio, parsed.cashRatio);
}

export function resolveSimRowLiquiditaFy(simRow: Record<string, unknown>): string {
  const raw =
    simRow.liquidita_fy ??
    findCol(simRow, "liquidità (fy)", "liquidita (fy)", "liquidity (fy)", "liquidita_fy", "liquidità");
  const s = String(raw ?? "").trim();
  return s && s !== "—" ? s : "";
}

export function liquidityScoreCellStyle(score01: number): CSSProperties {
  const pct = Math.max(1, Math.min(100, Math.round(score01 * 100)));
  let fill = "rgba(var(--accent) / 0.2)";
  let color = "rgb(var(--accent))";
  let weight: CSSProperties["fontWeight"] = 700;
  if (score01 >= 0.75) {
    fill = "rgba(var(--positive) / 0.3)";
    color = "rgb(var(--positive))";
  } else if (score01 >= 0.55) {
    fill = "rgba(var(--positive) / 0.17)";
    color = "rgb(var(--positive))";
    weight = 600;
  } else if (score01 >= 0.4) {
    fill = "rgba(var(--warn) / 0.22)";
    color = "rgb(var(--warn))";
    weight = 600;
  }
  return {
    color,
    fontWeight: weight,
    fontVariantNumeric: "tabular-nums",
    boxShadow: "inset 0 -1px 0 0 rgba(var(--panel-feed-border-soft) / 0.45)",
    backgroundImage: `linear-gradient(to right, ${fill} 0%, ${fill} ${pct}%, transparent ${pct}%)`,
  };
}

/** Approximate share of return variance explained by the market (β² in a one-factor model). */
export function betaMarketVariancePct(beta: number): number {
  return Math.round(beta * beta * 100);
}

export type BetaBucket = "high" | "elevated" | "market" | "idiosyncratic" | "inverse";

export function betaDisplay(beta: number): {
  text: string;
  style: CSSProperties;
  icon?: string;
  bucket: BetaBucket;
} {
  let color = "rgb(var(--ink))";
  let weight: CSSProperties["fontWeight"] = 600;
  let icon: string | undefined;
  let bucket: BetaBucket = "market";

  if (beta < 0) {
    color = "rgb(var(--warn))";
    weight = 700;
    icon = "↔";
    bucket = "inverse";
  } else if (beta > 2) {
    color = "rgb(var(--warn))";
    weight = 700;
    icon = "⚡";
    bucket = "high";
  } else if (beta > 1.35) {
    color = "rgb(var(--warn))";
    weight = 600;
    bucket = "elevated";
  } else if (beta < 0.85) {
    color = "rgb(var(--positive))";
    weight = beta < 0.5 ? 700 : 600;
    bucket = "idiosyncratic";
  }

  return {
    text: beta.toFixed(2),
    style: { color, fontWeight: weight, fontVariantNumeric: "tabular-nums" },
    icon,
    bucket,
  };
}

export function betaBucketLabel(bucket: BetaBucket, it: boolean): string {
  switch (bucket) {
    case "high":
      return it ? "forte legame al mercato" : "strong market link";
    case "elevated":
      return it ? "varianza più market-driven" : "more market-driven variance";
    case "idiosyncratic":
      return it ? "segnale più company-specific" : "cleaner company-specific signal";
    case "inverse":
      return it ? "correlazione inversa (raro)" : "inverse correlation (rare)";
    default:
      return it ? "correlazione ~ mercato" : "~ market correlation";
  }
}

/** Educational tooltip — correlation semantics, not direction or risk. */
export function betaTooltipText(beta: number | null, it: boolean): string {
  const lines = it
    ? [
        "Beta misura correlazione col benchmark, non direzione né rischio.",
        "β² ≈ quota di varianza spiegata dal mercato (es. 0,36 → ~13% market-driven).",
        "β basso: segnali company-specific (Composite, Regulatory Risk, catalyst) meno confusi dal rumore XBI — più pulito da interpretare, non più «prevedibile».",
        "β alto: più varianza spiegata dal mercato — attribuzione company più difficile.",
        "Colori: verde <0,85 · neutro 0,85–1,35 · ambra 1,35–2 · ⚡ >2.",
      ]
    : [
        "Beta measures benchmark correlation, not direction or risk.",
        "β² ≈ share of variance explained by the market (e.g. 0.36 → ~13% market-driven).",
        "Low β: company-specific signals (Composite, Regulatory Risk, catalyst proximity) face less XBI noise — cleaner to interpret, not more «predictable».",
        "High β: more market-explained variance — harder to attribute company moves.",
        "Colors: green <0.85 · neutral 0.85–1.35 · amber 1.35–2 · ⚡ >2.",
      ];
  if (beta != null && Number.isFinite(beta)) {
    const mktPct = betaMarketVariancePct(beta);
    lines.unshift(
      it
        ? `β ${beta.toFixed(2)} (5Y vs mercato) · ~${mktPct}% varianza market-driven`
        : `β ${beta.toFixed(2)} (5Y vs market) · ~${mktPct}% market-driven variance`,
    );
  }
  return lines.join("\n");
}

export function liquidityTooltipText(score: number | null, fyDisplay: string, it: boolean): string {
  const base = it
    ? "Score 0–1 (più alto = più liquido). Barra verde = alta, ambra = media, navy = bassa."
    : "Score 0–1 (higher = stronger liquidity). Green bar = high, amber = mid, navy = low.";
  const parts = [base];
  if (score != null) parts.unshift(it ? `Score ${score.toFixed(2)}` : `Score ${score.toFixed(2)}`);
  if (fyDisplay) parts.push(fyDisplay);
  return parts.join("\n");
}
