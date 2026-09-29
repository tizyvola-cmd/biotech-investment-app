/**
 * Freeze entry scores at paper BUY time (P / SDS / EIS / Reg).
 * Prefer this over freezing at closed-deal analysis (live drift).
 */
import type { RegulatoryRiskSnapshot, SdsRow } from "../api/supernova";
import {
  fillMissingFrozenEntryScores,
  freezePaperBuyEntrySnapshot,
  type FrozenEntryLiveScores,
} from "../calibration/featureSnapshotStore";
import { resolveRegSignedScoreForTicker } from "./decisionChartBuild";
import { computeEisFeedWindowScore } from "./lossRescueEngine";
import { buildSdsByTicker } from "./sdsTopOppGate";
import type {
  PaperTradeEvent,
  TickerSimEvaluation,
} from "./investDecisionSimLoop";

export type PaperBuyEntryScores = {
  pplanPct: number | null;
  sds: number | null;
  eisScore: number | null;
  regulatoryScore: number | null;
};

function clinicalPhaseFromRow(row: Record<string, unknown> | null): string | null {
  if (!row) return null;
  const v = String(row["Studio Phase"] ?? row["studio_phase"] ?? "").trim();
  return v || null;
}

function clinicalIndicationFromRow(row: Record<string, unknown> | null): string | null {
  if (!row) return null;
  const v = String(
    row["Indication"] ?? row["Indicazione"] ?? row["indication"] ?? "",
  ).trim();
  return v || null;
}

export function resolvePaperBuyEntryScores(args: {
  ev: TickerSimEvaluation;
  simRow: Record<string, unknown> | null;
  sdsRows: SdsRow[] | null | undefined;
  autoRegSnap: RegulatoryRiskSnapshot | null | undefined;
  lang: "it" | "en";
}): PaperBuyEntryScores {
  const tk = args.ev.ticker.trim().toUpperCase();
  const sds = buildSdsByTicker(args.sdsRows).get(tk)?.sds ?? null;
  const eisScore = computeEisFeedWindowScore(args.ev.ticker, args.lang);
  const regulatoryScore = resolveRegSignedScoreForTicker(
    args.ev.ticker,
    args.simRow,
    args.autoRegSnap ?? null,
  );
  return {
    pplanPct: args.ev.probPct,
    sds: sds != null && Number.isFinite(sds) ? sds : null,
    eisScore,
    regulatoryScore,
  };
}

/**
 * For each paper BUY trade: freeze localStorage snapshot + return scores by key
 * so the caller can stamp PaperPosition.
 */
export function capturePaperBuyEntrySnapshots(args: {
  trades: PaperTradeEvent[];
  evaluations: TickerSimEvaluation[];
  simRowByKey: Map<string, Record<string, unknown>>;
  sdsRows: SdsRow[] | null | undefined;
  autoRegSnap: RegulatoryRiskSnapshot | null | undefined;
  lang: "it" | "en";
}): Map<string, PaperBuyEntryScores> {
  const out = new Map<string, PaperBuyEntryScores>();
  const buyTrades = args.trades.filter((t) => t.side === "buy");
  if (!buyTrades.length) return out;

  const evByKey = new Map(args.evaluations.map((e) => [e.key, e]));
  for (const trade of buyTrades) {
    const ev = evByKey.get(trade.key);
    if (!ev) continue;
    const simRow = args.simRowByKey.get(trade.key) ?? null;
    const scores = resolvePaperBuyEntryScores({
      ev,
      simRow,
      sdsRows: args.sdsRows,
      autoRegSnap: args.autoRegSnap,
      lang: args.lang,
    });
    const live: FrozenEntryLiveScores = {
      sds: scores.sds,
      clinicalPhase: clinicalPhaseFromRow(simRow),
      clinicalIndication: clinicalIndicationFromRow(simRow),
      pplanPct: scores.pplanPct,
      eisScore: scores.eisScore,
      regulatoryScore: scores.regulatoryScore,
      mcsAtEntry: null,
    };
    freezePaperBuyEntrySnapshot(trade.key, live);
    fillMissingFrozenEntryScores(trade.key, live);
    out.set(trade.key, scores);
  }
  return out;
}
