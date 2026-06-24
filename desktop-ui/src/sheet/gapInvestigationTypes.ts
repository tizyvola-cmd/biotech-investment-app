/** Mark-to-mark jump (|Δ|) that triggers the investigation gate. */
export const GAP_INVESTIGATION_THRESHOLD_PCT = 5;

/** Default add-size suggestion when user picks "Aggiungi" (15% of current paper cap). */
export const GAP_INVESTIGATION_ADD_SIZE_DEFAULT_PCT = 15;

export const GAP_INVESTIGATION_LOG_MAX = 80;

export type GapEvent = {
  ticker: string;
  tickTimestamp: string;
  previousMarkPct: number;
  currentMarkPct: number;
  gapPct: number;
  positionCapitalEur: number;
  /** Days until Completion Date (maps codebase `daysToCd`; null if unknown). */
  daysSinceCD: number | null;
};

/** Gap event with row key — used internally after detection. */
export type DetectedGapEvent = GapEvent & { rowKey: string };

export type GapNewsType =
  | "clinical_data"
  | "regulatory_8k"
  | "analyst_action"
  | "sector_wide"
  | "unknown";

export type GapContextFinding = {
  ticker: string;
  hasSpecificNews: boolean;
  newsType: GapNewsType | null;
  summary: string | null;
  sourceUrl: string | null;
  confidence: "high" | "low";
};

export interface GapContextProvider {
  investigate(event: GapEvent): Promise<GapContextFinding>;
};

export type GapInvestigationUserDecision =
  | { kind: "reduce"; amountEur: number }
  | { kind: "add"; amountEur: number }
  | { kind: "dismiss" }
  | { kind: "ignored" };

export type GapInvestigationRecord = {
  id: string;
  /** Simulation row key — not shown in GapEvent but required for audit / size edits. */
  rowKey: string;
  event: GapEvent;
  finding: GapContextFinding;
  status: "pending" | "decided";
  userDecision: GapInvestigationUserDecision | null;
  decidedAt: string | null;
  createdAt: string;
};

export type GapInvestigationModalPayload = {
  recordId: string;
  event: GapEvent;
  rowKey: string;
  finding: GapContextFinding;
};

export const GAP_INVESTIGATION_EVENT = "supernova:gap-investigation";
