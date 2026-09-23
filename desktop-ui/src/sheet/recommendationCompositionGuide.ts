/**
 * Documentazione strutturata — da quali score e pesi nascono BUY / SELL / HOLD / REVIEW.
 * Allineato a: softSignalGrades.ts, continuationScore.ts, investDecisionSimLoop.ts,
 * recoveryProbability.ts, compositeScore.ts (brief recommendation v2).
 */
import {
  COMPOSITE_LOSS_REVIEW_MIN,
  COMPOSITE_REVIEW_MIN,
} from "../lib/scoring/compositeScore";
import { ZONE_WEIGHTS, type IndexId, type ScoringZone } from "../lib/scoring/zoneWeights";
import { P_CONT_SELL_MIN_G10, SOFT_BUY_MIN_PCONT } from "./continuationScore";
import {
  SOFT_BUY_G1_MIN_PLAN_RETURN_PCT,
  SOFT_BUY_G1_PPLAN_MIN,
  SOFT_BUY_G1_SDS_MIN,
  SOFT_BUY_G1C_PPLAN_MIN,
  SOFT_BUY_G1C_SDS_MIN,
  SOFT_SELL_G1_DEEP_PNL_PCT,
  SOFT_SELL_G1_MIN_HOLD_SESSIONS,
  SOFT_SELL_G1_ORPHAN_PNL_PCT,
  SOFT_SELL_G1_PNL_PCT,
  SOFT_SELL_G1_PPLAN_MAX,
  SOFT_SELL_G1_REG,
  SOFT_SELL_G1_RISK_V2,
  URGENT_SELL_G2_MAX_LOSS_OF_WINS,
} from "./softSignalGrades";
import { SOFT_BUY_RISING_DAYS_MIN } from "./softBuyRisingStreak";
import {
  FWD_ENTRY_MIN,
  P_ENTRY_MIN,
  RECOVERY_HOLD_PROB_MIN,
} from "./recoveryProbability";

const G2_WIN_PCT = Math.round(URGENT_SELL_G2_MAX_LOSS_OF_WINS * 100);

export type CompositionWeightRow = {
  id: string;
  labelIt: string;
  labelEn: string;
  weightPct: number;
  detailIt: string;
  detailEn: string;
};

export type RecommendationActionGuide = {
  action: "buy" | "sell" | "hold" | "review";
  titleIt: string;
  titleEn: string;
  accent: string;
  gatesIt: string[];
  gatesEn: string[];
  /** Blocchi score con peso % (somma ≈ 100 per blocco o sotto-blocco). */
  scoreBlocks: CompositionWeightRow[];
  /** Zona composite rilevante (se applicabile). */
  compositeZones?: ScoringZone[];
  footnoteIt?: string;
  footnoteEn?: string;
};

/** P(plan) — sotto-blocchi pTrack / pSetup (recoveryProbability). */
export const PPLAN_TRACK_WEIGHTS: CompositionWeightRow[] = [
  {
    id: "curve_gap",
    labelIt: "Gap curva vs spot",
    labelEn: "Curve gap vs spot",
    weightPct: 55,
    detailIt: "Quanto il prezzo è sotto/sopra la curva modello",
    detailEn: "How far spot is below/above the model curve",
  },
  {
    id: "slope",
    labelIt: "Stabilità pendenza",
    labelEn: "Slope stability",
    weightPct: 45,
    detailIt: "persistent / watch / exit + curveRisingHold",
    detailEn: "persistent / watch / exit + curveRisingHold",
  },
];

export const PPLAN_SETUP_WEIGHTS: CompositionWeightRow[] = [
  {
    id: "sds",
    labelIt: "SDS score",
    labelEn: "SDS score",
    weightPct: 65,
    detailIt: "Cluster A–E · veto se <25",
    detailEn: "Cluster A–E · veto if <25",
  },
  {
    id: "mii",
    labelIt: "MII angolo",
    labelEn: "MII angle",
    weightPct: 35,
    detailIt: "Pendenza mercato (MIG)",
    detailEn: "Market slope (MIG)",
  },
];

/** P(plan) — blocchi combinati (media geometrica dei fattori 0–1). */
export const PPLAN_COMBINE_BLOCKS: CompositionWeightRow[] = [
  {
    id: "p_track",
    labelIt: "pTrack (curva + pendenza)",
    labelEn: "pTrack (curve + slope)",
    weightPct: 17,
    detailIt: "Vedi sotto-blocco track",
    detailEn: "See track sub-block",
  },
  {
    id: "p_setup",
    labelIt: "pSetup (match + SDS + MII)",
    labelEn: "pSetup (match + SDS + MII)",
    weightPct: 17,
    detailIt: "Vedi sotto-blocco setup",
    detailEn: "See setup sub-block",
  },
  {
    id: "p_window",
    labelIt: "Finestra CD",
    labelEn: "CD window",
    weightPct: 17,
    detailIt: "Timing T−n + correlazione finestra",
    detailEn: "T−n timing + window correlation",
  },
  {
    id: "p_eis",
    labelIt: "EIS super-score",
    labelEn: "EIS super-score",
    weightPct: 17,
    detailIt: "Eventi catalyst recenti",
    detailEn: "Recent catalyst events",
  },
  {
    id: "forward",
    labelIt: "Target forward %",
    labelEn: "Forward target %",
    weightPct: 16,
    detailIt: `Min entry ${FWD_ENTRY_MIN}% · tier SDS/match/EIS`,
    detailEn: `Min entry ${FWD_ENTRY_MIN}% · SDS/match/EIS tiers`,
  },
  {
    id: "momentum",
    labelIt: "Arco ROI + Var.24h",
    labelEn: "Arc ROI + 24h change",
    weightPct: 16,
    detailIt: "Momentum segmento curva e giornaliero",
    detailEn: "Curve segment and daily momentum",
  },
];

export const RECOMMENDATION_ACTION_GUIDES: RecommendationActionGuide[] = [
  {
    action: "buy",
    titleIt: "BUY — Soft BUY (ingresso)",
    titleEn: "BUY — Soft BUY (entry)",
    accent: "#10b981",
    gatesIt: [
      `Soft BUY G1: SDS ≥ ${SOFT_BUY_G1_SDS_MIN} · P(plan) ≥ ${SOFT_BUY_G1_PPLAN_MIN} · Top2 ≠ NO (WAIT ok)`,
      `In rialzo ≥ ${SOFT_BUY_RISING_DAYS_MIN} sessioni (oggi + ieri verdi) · non warrant · precat ≠ sell`,
      `G1w vento: 10d % ≥ +${P_CONT_SELL_MIN_G10}% · P(cont) ≥ ${SOFT_BUY_MIN_PCONT}% · edge ≤ 0 · giorno ≥ 0 → Suggested BUY (Top2/↑/cooldown = priorità)`,
      `High Vol: VOL vs prev ≥150% + T_double ≤30 min (RVOL 5m confermato) → Soft BUY High Vol + ricerca EIS`,
      `Forward ≥ ${SOFT_BUY_G1_MIN_PLAN_RETURN_PCT}% non obbligatorio su G1 volume (↑≥2d basta)`,
      `Soft BUY G1c (override Top2 NO): SDS ≥ ${SOFT_BUY_G1C_SDS_MIN} · P ≥ ${SOFT_BUY_G1C_PPLAN_MIN} · forward ≥ ${SOFT_BUY_G1_MIN_PLAN_RETURN_PCT}% · stesso filtro P(cont)`,
      "Cooldown 5g post-vendita libro reale · niente Soft BUY sullo stesso titolo",
    ],
    gatesEn: [
      `Soft BUY G1: SDS ≥ ${SOFT_BUY_G1_SDS_MIN} · P(plan) ≥ ${SOFT_BUY_G1_PPLAN_MIN} · Top2 ≠ NO (WAIT ok)`,
      `Rising ≥ ${SOFT_BUY_RISING_DAYS_MIN} sessions (green today + yesterday) · no warrants · precat ≠ sell`,
      `G1w wind: 10d % ≥ +${P_CONT_SELL_MIN_G10}% · P(cont) ≥ ${SOFT_BUY_MIN_PCONT}% · edge ≤ 0 · day ≥ 0 → Suggested BUY (Top2/rising/cooldown = priority)`,
      `High Vol: VOL vs prev ≥150% + T_double ≤30 min (confirmed 5m RVOL) → Soft BUY High Vol + EIS search`,
      `Forward ≥ ${SOFT_BUY_G1_MIN_PLAN_RETURN_PCT}% not required on G1 volume (↑≥2d is enough)`,
      `Soft BUY G1c (overrides Top2 NO): SDS ≥ ${SOFT_BUY_G1C_SDS_MIN} · P ≥ ${SOFT_BUY_G1C_PPLAN_MIN} · forward ≥ ${SOFT_BUY_G1_MIN_PLAN_RETURN_PCT}% · same P(cont) filter`,
      "5d cooldown after real-book sell — no Soft BUY on the same name",
    ],
    scoreBlocks: [
      {
        id: "soft_g1",
        labelIt: "Soft BUY G1",
        labelEn: "Soft BUY G1",
        weightPct: 55,
        detailIt: `SDS / P(plan) / Top2≠NO / ↑≥${SOFT_BUY_RISING_DAYS_MIN}d — Home Suggested BUY`,
        detailEn: `SDS / P(plan) / Top2≠NO / ↑≥${SOFT_BUY_RISING_DAYS_MIN}d — Home Suggested BUY`,
      },
      {
        id: "soft_g1c",
        labelIt: "Soft BUY G1c studio",
        labelEn: "Soft BUY G1c study",
        weightPct: 25,
        detailIt: "Override Top2 NO se SDS/P/forward forti",
        detailEn: "Overrides Top2 NO when SDS/P/forward are strong",
      },
      {
        id: "quality",
        labelIt: "Gate qualità",
        labelEn: "Quality gates",
        weightPct: 20,
        detailIt: "Momentum · β · liquidità · tape non catastrofico",
        detailEn: "Momentum · β · liquidity · non-catastrophic tape",
      },
    ],
    compositeZones: ["hot", "watch", "early"],
    footnoteIt: `Fonte UI: suggestedAction da deriveSuggestedAction (non exitDecision). P(plan)≥${SOFT_BUY_G1_PPLAN_MIN} senza Soft BUY → HOLD, non BUY.`,
    footnoteEn: `UI source: suggestedAction from deriveSuggestedAction (not exitDecision). P(plan)≥${SOFT_BUY_G1_PPLAN_MIN} without Soft BUY → HOLD, not BUY.`,
  },
  {
    action: "sell",
    titleIt: "SELL — Soft / Urgent / continuation",
    titleEn: "SELL — Soft / Urgent / continuation",
    accent: "#f43f5e",
    gatesIt: [
      `Urgent SELL G2 (auto): perdite day del book > ${G2_WIN_PCT}% di (capitale acquistato + guadagni aperti) → taglio perdenti (priorità % day più drastica; tie-break 10d % declining → corsa debole → edge)`,
      `Soft SELL G1: MTM ≤ ${SOFT_SELL_G1_PNL_PCT}% + (riskV2≥${SOFT_SELL_G1_RISK_V2} / reg≥${SOFT_SELL_G1_REG} / P(plan)<${SOFT_SELL_G1_PPLAN_MAX} oppure 10d % declining / corsa debole / edge>0) dopo ≥${SOFT_SELL_G1_MIN_HOLD_SESSIONS} sessioni NYSE`,
      `Deep Soft SELL: MTM ≤ ${SOFT_SELL_G1_DEEP_PNL_PCT}% immediato (recovery non blocca) · orphan ≤ ${SOFT_SELL_G1_ORPHAN_PNL_PCT}% se risk/P assenti (stesso hold di ${SOFT_SELL_G1_MIN_HOLD_SESSIONS} sessioni)`,
      `Take-profit continuation: MTM > 0 · 10d % ≥ +${P_CONT_SELL_MIN_G10}% · edge esaurimento > 0 (unico SELL su libro verde)`,
      "pct Own / pct Pop: percentili su curva g10→P(cont) — fuori regime (10d % < +5%) → n/d; edge usa queste densità",
      "Mai SELL se MTM > 0 salvo continuation · ordine Suggested SELL: G2 → G1 → cont_exh → hard",
    ],
    gatesEn: [
      `Urgent SELL G2 (auto): book day losses > ${G2_WIN_PCT}% of (purchased capital + open gains) → cut losers (fastest day % first; tie-break 10d % declining → weak run → edge)`,
      `Soft SELL G1: MTM ≤ ${SOFT_SELL_G1_PNL_PCT}% + (riskV2≥${SOFT_SELL_G1_RISK_V2} / reg≥${SOFT_SELL_G1_REG} / P(plan)<${SOFT_SELL_G1_PPLAN_MAX} or 10d % declining / weak run / edge>0) after ≥${SOFT_SELL_G1_MIN_HOLD_SESSIONS} NYSE sessions`,
      `Deep Soft SELL: MTM ≤ ${SOFT_SELL_G1_DEEP_PNL_PCT}% immediate (recovery does not block) · orphan ≤ ${SOFT_SELL_G1_ORPHAN_PNL_PCT}% if risk/P missing (same ${SOFT_SELL_G1_MIN_HOLD_SESSIONS}-session hold)`,
      `Continuation take-profit: MTM > 0 · 10d % ≥ +${P_CONT_SELL_MIN_G10}% · exhaustion edge > 0 (only SELL on green book)`,
      "pct Own / pct Pop: percentiles on g10→P(cont) curve — out of regime (10d % < +5%) → n/a; edge uses these densities",
      "Never SELL when MTM > 0 except continuation · Suggested SELL order: G2 → G1 → cont_exh → hard",
    ],
    scoreBlocks: [
      {
        id: "urgent_g2",
        labelIt: "Urgent SELL G2",
        labelEn: "Urgent SELL G2",
        weightPct: 40,
        detailIt: `Budget book ${G2_WIN_PCT}% di (acquistato + guadagnato) · auto-execute · recovery non blocca`,
        detailEn: `Book budget ${G2_WIN_PCT}% of (purchased + gains) · auto-execute · recovery does not block`,
      },
      {
        id: "soft_g1",
        labelIt: "Soft SELL G1",
        labelEn: "Soft SELL G1",
        weightPct: 30,
        detailIt: `≤${SOFT_SELL_G1_PNL_PCT}% + rischio/piano o segnale 10d % · hold ≥${SOFT_SELL_G1_MIN_HOLD_SESSIONS} sessioni · deep ≤${SOFT_SELL_G1_DEEP_PNL_PCT}% immediato`,
        detailEn: `≤${SOFT_SELL_G1_PNL_PCT}% + risk/plan or 10d % signal · hold ≥${SOFT_SELL_G1_MIN_HOLD_SESSIONS} sessions · deep ≤${SOFT_SELL_G1_DEEP_PNL_PCT}% immediate`,
      },
      {
        id: "cont_exh",
        labelIt: "Continuation (take-profit)",
        labelEn: "Continuation (take-profit)",
        weightPct: 20,
        detailIt: `10d % ≥ +${P_CONT_SELL_MIN_G10}% · edge > 0 · pct Own/Pop sulla curva percentile`,
        detailEn: `10d % ≥ +${P_CONT_SELL_MIN_G10}% · edge > 0 · pct Own/Pop on percentile curve`,
      },
      {
        id: "hard_exit",
        labelIt: "Hard / Top2 exit",
        labelEn: "Hard / Top2 exit",
        weightPct: 10,
        detailIt: "Uscita dura residua (slope/Top2) dopo i gate soft — priorità più bassa",
        detailEn: "Residual hard exit (slope/Top2) after soft gates — lowest priority",
      },
    ],
    compositeZones: ["loss"],
    footnoteIt: `Recovery HOLD indebolito su libro rosso se 10d % declining / fuori regime / edge>0. Composite ≥ ${COMPOSITE_LOSS_REVIEW_MIN} in loss può restare REVIEW, non sostituisce G2.`,
    footnoteEn: `Recovery HOLD weakens on red book if 10d % declining / out-of-regime / edge>0. Composite ≥ ${COMPOSITE_LOSS_REVIEW_MIN} in loss may stay REVIEW — does not override G2.`,
  },
  {
    action: "hold",
    titleIt: "HOLD — attendi recovery",
    titleEn: "HOLD — wait for recovery",
    accent: "#0ea5e9",
    gatesIt: [
      `P(recovery) ≥ ${RECOVERY_HOLD_PROB_MIN}% e curva copre la perdita (se non indebolito da 10d %)`,
      "curveRisingHold: curva in salita → non vendere (salvo G2 / Soft G1 deep)",
      "Top2 «wait» su posizione aperta · Soft BUY fallito ma P(plan) ≥ 50 → HOLD off-book",
      "Recovery non blocca Urgent G2 né Soft SELL deep",
      `exitDecision = hold dal motore P(plan) (entry ≥ ${P_ENTRY_MIN}% fuori perdita)`,
    ],
    gatesEn: [
      `P(recovery) ≥ ${RECOVERY_HOLD_PROB_MIN}% and curve covers loss (unless weakened by 10d %)`,
      "curveRisingHold: rising curve → do not sell (except G2 / Soft G1 deep)",
      "Top2 «wait» on open position · failed Soft BUY but P(plan) ≥ 50 → off-book HOLD",
      "Recovery does not block Urgent G2 or Soft SELL deep",
      `exitDecision = hold from P(plan) engine (entry ≥ ${P_ENTRY_MIN}% when not in loss)`,
    ],
    scoreBlocks: PPLAN_COMBINE_BLOCKS,
    compositeZones: ["loss", "watch"],
    footnoteIt: "Corretto se |Var.24h| ≤ 2% o rally lieve (+0…+5%) — tesi multi-giorno. 10d % declining indebolisce HOLD recovery.",
    footnoteEn: "Correct if |24h move| ≤ 2% or mild rally (+0…+5%) — multi-day thesis. Declining 10d % weakens recovery HOLD.",
  },
  {
    action: "review",
    titleIt: "INCERTO — profilo non chiaro",
    titleEn: "UNCERTAIN — unclear profile",
    accent: "#f59e0b",
    gatesIt: [
      `Top2 «wait» senza path BUY completo`,
      `Composite score ≥ ${COMPOSITE_REVIEW_MIN} senza posizione`,
      `P(plan) in fascia intermedia (wait ${P_ENTRY_MIN - 5}%…${P_ENTRY_MIN}%)`,
      `Zona loss: composite ≥ ${COMPOSITE_LOSS_REVIEW_MIN} al posto di SELL immediato`,
      "Non è un «no» — monitoraggio fino a segnale BUY o scadenza",
    ],
    gatesEn: [
      `Top2 «wait» without full BUY path`,
      `Composite score ≥ ${COMPOSITE_REVIEW_MIN} without position`,
      `P(plan) in intermediate band (wait ${P_ENTRY_MIN - 5}%…${P_ENTRY_MIN}%)`,
      `Loss zone: composite ≥ ${COMPOSITE_LOSS_REVIEW_MIN} instead of immediate SELL`,
      "Not a hard «no» — monitor until BUY signal or expiry",
    ],
    scoreBlocks: (Object.keys(ZONE_WEIGHTS.watch) as IndexId[]).map((id) => ({
      id: `composite_${id}`,
      labelIt:
        id === "pplan"
          ? "P(plan)"
          : id === "top2"
            ? "Top2"
            : id === "precat"
              ? "Precat"
              : id === "slope"
                ? "Pendenza"
                : id === "timing"
                  ? "Timing CD"
                  : id === "conf"
                    ? "Confidenza"
                    : id === "sds"
                      ? "SDS"
                      : "EIS",
      labelEn:
        id === "pplan"
          ? "P(plan)"
          : id === "top2"
            ? "Top2"
            : id === "precat"
              ? "Precat"
              : id === "slope"
                ? "Slope"
                : id === "timing"
                  ? "CD timing"
                  : id === "conf"
                    ? "Confidence"
                    : id === "sds"
                      ? "SDS"
                      : "EIS",
      weightPct: ZONE_WEIGHTS.watch[id],
      detailIt: "Peso zona watch nel composite (normalizzato a 100)",
      detailEn: "Watch-zone weight in composite (normalized to 100)",
    })),
    compositeZones: ["watch", "early", "loss"],
    footnoteIt: "Il composite usa pesi diversi per hot / watch / early / loss — vedi tabella sotto.",
    footnoteEn: "Composite uses different weights per hot / watch / early / loss — see table below.",
  },
];
