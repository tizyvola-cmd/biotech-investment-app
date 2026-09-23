import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import { realizedPnlEurFromOutcome, realizedPnlPctFromOutcome } from "./outcomePnlDisplay";

export type DecisionGainBucket = "gain" | "loss" | "flat";

export type DecisionGainBarRow = {
  key: DecisionGainBucket;
  label: string;
  count: number;
  totalEur: number;
  fill: string;
};

export type DecisionGainTimelinePoint = {
  label: string;
  ts: number;
  cumulativeEur: number;
  eventEur: number;
  ticker: string;
};

export type DecisionGainView = {
  closedGain: number;
  closedLoss: number;
  closedFlat: number;
  closedGainEur: number;
  closedLossEur: number;
  openGain: number;
  openLoss: number;
  openFlat: number;
  openGainEur: number;
  openLossEur: number;
  buySuccess: number;
  buyFailure: number;
  sellSuccess: number;
  sellFailure: number;
  barRows: DecisionGainBarRow[];
  timeline: DecisionGainTimelinePoint[];
  hasChart: boolean;
};

function isOpenPosition(r: SimOutcomeRow): boolean {
  if (typeof r.decision_current_open === "boolean") return r.decision_current_open;
  if (!r.exit_ts) return true;
  return false;
}

function classifyPnl(eur: number | null, pct: number | null): DecisionGainBucket {
  if (eur == null && pct == null) return "flat";
  const v = eur ?? pct ?? 0;
  if (Math.abs(v) < (eur != null ? 1 : 0.25)) return "flat";
  return v > 0 ? "gain" : "loss";
}

function dedupeClosed(rows: SimOutcomeRow[]): SimOutcomeRow[] {
  const closed = rows.filter((r) => !isOpenPosition(r));
  const byKey = new Map<string, SimOutcomeRow>();
  for (const r of closed) {
    const prev = byKey.get(r.row_key);
    if (!prev) {
      byKey.set(r.row_key, r);
      continue;
    }
    const aTs = Date.parse(r.exit_ts ?? "");
    const bTs = Date.parse(prev.exit_ts ?? "");
    const pick =
      Number.isFinite(aTs) && Number.isFinite(bTs)
        ? aTs > bTs
        : (r.pnl_pct ?? -1e9) > (prev.pnl_pct ?? -1e9);
    if (pick) byKey.set(r.row_key, r);
  }
  return [...byKey.values()];
}

export function buildDecisionGainView(
  rows: SimOutcomeRow[],
  openMtm: { gain: number; loss: number; flat: number; gainEur: number; lossEur: number },
  lang: "en" | "it",
): DecisionGainView {
  const closed = dedupeClosed(rows);

  let closedGain = 0;
  let closedLoss = 0;
  let closedFlat = 0;
  let closedGainEur = 0;
  let closedLossEur = 0;

  for (const r of closed) {
    const eur = realizedPnlEurFromOutcome(r);
    const pct = realizedPnlPctFromOutcome(r);
    const bucket = classifyPnl(eur, pct);
    if (bucket === "gain") {
      closedGain++;
      if (eur != null && eur > 0) closedGainEur += eur;
    } else if (bucket === "loss") {
      closedLoss++;
      if (eur != null && eur < 0) closedLossEur += eur;
    } else {
      closedFlat++;
    }
  }

  let buySuccess = 0;
  let buyFailure = 0;
  let sellSuccess = 0;
  let sellFailure = 0;
  for (const r of rows) {
    if (r.buy_signal_result === "success") buySuccess++;
    else if (r.buy_signal_result === "failure") buyFailure++;
    if (r.sell_signal_result === "success") sellSuccess++;
    else if (r.sell_signal_result === "failure") sellFailure++;
  }

  const labels: Record<DecisionGainBucket, string> =
    lang === "it"
      ? { gain: "Gain", loss: "Loss", flat: "Flat" }
      : { gain: "Gain", loss: "Loss", flat: "Flat" };

  const barRows: DecisionGainBarRow[] = [
    {
      key: "gain",
      label: `${labels.gain} (${closedGain + openMtm.gain})`,
      count: closedGain + openMtm.gain,
      totalEur: closedGainEur + openMtm.gainEur,
      fill: "#059669",
    },
    {
      key: "loss",
      label: `${labels.loss} (${closedLoss + openMtm.loss})`,
      count: closedLoss + openMtm.loss,
      totalEur: closedLossEur + openMtm.lossEur,
      fill: "#dc2626",
    },
    {
      key: "flat",
      label: `${labels.flat} (${closedFlat + openMtm.flat})`,
      count: closedFlat + openMtm.flat,
      totalEur: 0,
      fill: "#94a3b8",
    },
  ];

  const sortedClosed = [...closed].sort((a, b) => {
    const ta = Date.parse(a.exit_ts ?? a.entry_ts ?? "");
    const tb = Date.parse(b.exit_ts ?? b.entry_ts ?? "");
    return (Number.isFinite(ta) ? ta : 0) - (Number.isFinite(tb) ? tb : 0);
  });

  let cumulative = 0;
  const timeline: DecisionGainTimelinePoint[] = [];
  for (const r of sortedClosed) {
    const eur = realizedPnlEurFromOutcome(r);
    if (eur == null) continue;
    cumulative += eur;
    const tsRaw = r.exit_ts ?? r.entry_ts ?? "";
    const ts = Date.parse(tsRaw);
    timeline.push({
      label: r.ticker,
      ts: Number.isFinite(ts) ? ts : timeline.length,
      cumulativeEur: Math.round(cumulative * 100) / 100,
      eventEur: eur,
      ticker: r.ticker,
    });
  }

  const hasChart =
    barRows.some((b) => b.count > 0) ||
    timeline.length >= 2 ||
    buySuccess + buyFailure + sellSuccess + sellFailure > 0;

  return {
    closedGain,
    closedLoss,
    closedFlat,
    closedGainEur,
    closedLossEur,
    openGain: openMtm.gain,
    openLoss: openMtm.loss,
    openFlat: openMtm.flat,
    openGainEur: openMtm.gainEur,
    openLossEur: openMtm.lossEur,
    buySuccess,
    buyFailure,
    sellSuccess,
    sellFailure,
    barRows,
    timeline,
    hasChart,
  };
}

export function summarizeOpenMtm(
  positions: { pnlEur: number | null; pnlUnavailable?: boolean }[],
): { gain: number; loss: number; flat: number; gainEur: number; lossEur: number } {
  let gain = 0;
  let loss = 0;
  let flat = 0;
  let gainEur = 0;
  let lossEur = 0;
  for (const p of positions) {
    if (p.pnlUnavailable || p.pnlEur == null) {
      flat++;
      continue;
    }
    if (p.pnlEur > 1) {
      gain++;
      gainEur += p.pnlEur;
    } else if (p.pnlEur < -1) {
      loss++;
      lossEur += p.pnlEur;
    } else {
      flat++;
    }
  }
  return { gain, loss, flat, gainEur, lossEur };
}
