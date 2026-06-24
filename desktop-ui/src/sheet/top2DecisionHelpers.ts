/**
 * Testo compatto per Top 2 BUY/SELL — allineato a Decision Lab / pipeline ROI.
 */
import type { ExpectedGainSource } from "./simulationPlanGain";
import { pipelineToneFromReturnPct } from "./pipelineOpportunity";
import { inWatchEntryWindow, resolveWatchEntryThresholds, isWatchZoneEnterEnabled } from "./watchZoneEntryPolicy";

export type Top2InvestVerdict = "yes" | "wait" | "no";

export type Top2DecisionContext = {
  side: "buy" | "sell";
  /** ROI target (decisioni). */
  planReturnPct: number | null;
  /** Alias / ROI→CD informativo quando passato separatamente. */
  targetReturnPct?: number | null;
  planCdReturnPct?: number | null;
  daysToTarget?: number | null;
  precatKind: string;
  action: string;
  precatLabel: string;
  stabilityVerdict: string;
  planGainSource?: ExpectedGainSource | string | null;
  /** Curva in salita — per SELL = attendi target, non uscire ora. */
  curveRisingHold?: boolean;
  /** Pendenza negativa sostenuta — per SELL = esci. */
  slopeDeclining?: boolean;
  /** P&L totale in perdita (tab Simulation → P&L). */
  portfolioPnlLoss?: boolean;
  daysToCd?: number | null;
  targetProvisional?: boolean;
  matchPct?: number | null;
  dailyPct24h?: number | null;
};

export type Top2HeadlineRoi = {
  headlinePct: number | null;
  headlineDays: number | null;
  showCdSecondary: boolean;
  useTarget: boolean;
};

/** ROI headline: sempre target se disponibile; CD solo riga secondaria. */
export function resolveTop2HeadlineRoi(
  side: "buy" | "sell",
  planCdReturnPct: number | null,
  targetReturnPct: number | null,
  daysToCd: number | null,
  daysToTarget: number | null,
  _curveRisingHold: boolean,
): Top2HeadlineRoi {
  void side;
  const hasTarget = targetReturnPct != null && Number.isFinite(targetReturnPct);
  return {
    headlinePct: hasTarget ? targetReturnPct : planCdReturnPct,
    headlineDays: hasTarget ? daysToTarget : daysToCd,
    showCdSecondary: hasTarget && planCdReturnPct != null,
    useTarget: hasTarget,
  };
}

export function resolveTop2InvestVerdict(ctx: Top2DecisionContext): Top2InvestVerdict {
  if (ctx.side === "sell") {
    if (ctx.curveRisingHold) return "wait";
    if (ctx.slopeDeclining || ctx.stabilityVerdict === "exit" || ctx.stabilityVerdict === "avoid") {
      return "yes";
    }
    if (ctx.action === "exit" || ctx.action === "short") return "yes";
    const ret = ctx.planReturnPct;
    const tone = pipelineToneFromReturnPct(ret);
    if (tone === "loss" || (ret != null && ret < 0)) return "yes";
    return "wait";
  }
  const ret = ctx.planReturnPct;
  const tone = pipelineToneFromReturnPct(ret);
  const watchTh =
    isWatchZoneEnterEnabled() && inWatchEntryWindow(ctx.daysToCd)
      ? resolveWatchEntryThresholds(ctx.daysToCd, {
          targetProvisional: ctx.targetProvisional,
          dailyPct24h: ctx.dailyPct24h,
          matchPct: ctx.matchPct,
        })
      : null;
  const retMin = watchTh?.fwdMin ?? 2;

  if (
    ctx.precatKind === "avoid" ||
    ctx.precatKind === "sell" ||
    ctx.stabilityVerdict === "avoid" ||
    ctx.stabilityVerdict === "exit"
  ) {
    return "no";
  }
  if (ret != null && ret < retMin) return "wait";
  if (tone === "loss" || (ret != null && ret <= 0)) return "no";
  if (ctx.precatKind === "too_early" || ctx.precatKind === "late") return "wait";
  if (ctx.action === "forte" || ctx.action === "watch") {
    if (ctx.precatKind === "enter" || ctx.precatKind === "accumulate") return "yes";
    return "wait";
  }
  if (ctx.precatKind === "enter" || ctx.precatKind === "accumulate") return "yes";
  return "wait";
}

export function top2InvestVerdictLabel(
  verdict: Top2InvestVerdict,
  lang: "it" | "en",
): string {
  if (lang === "it") {
    if (verdict === "yes") return "Sì";
    if (verdict === "wait") return "Attendere";
    return "No";
  }
  if (verdict === "yes") return "Yes";
  if (verdict === "wait") return "Wait";
  return "No";
}

/** Intestazione colonna — distingue ingresso (opportunità) vs uscita (portafoglio). */
export function top2VerdictColumnLabel(
  profile: "portfolio" | "opportunity",
  lang: "it" | "en",
): string {
  if (profile === "portfolio") {
    return lang === "it" ? "Top2 uscita" : "Top2 exit";
  }
  return lang === "it" ? "Top2 ingresso" : "Top2 entry";
}

/** Valore celle UI — «yes» ha significato opposto buy-side vs sell-side. */
export function formatTop2VerdictDisplay(
  profile: "portfolio" | "opportunity",
  verdict: Top2InvestVerdict,
  lang: "it" | "en",
): string {
  if (profile === "portfolio") {
    if (lang === "it") {
      if (verdict === "yes") return "Uscita: sì";
      if (verdict === "wait") return "Uscita: attendi";
      return "Uscita: no";
    }
    if (verdict === "yes") return "Exit: yes";
    if (verdict === "wait") return "Exit: wait";
    return "Exit: no";
  }
  if (lang === "it") {
    if (verdict === "yes") return "Ingresso: sì";
    if (verdict === "wait") return "Ingresso: attendi";
    return "Ingresso: no";
  }
  if (verdict === "yes") return "Entry: yes";
  if (verdict === "wait") return "Entry: wait";
  return "Entry: no";
}

/** Campi Top2 disambiguati per lato (brief P1-A). `investVerdict` resta alias interno. */
export type Top2VerdictFields = {
  investVerdict: Top2InvestVerdict;
  entryVerdict: Top2InvestVerdict | null;
  exitVerdict: Top2InvestVerdict | null;
};

export function resolveTop2VerdictFields(
  hasPosition: boolean,
  verdict: Top2InvestVerdict,
): Top2VerdictFields {
  return {
    investVerdict: verdict,
    entryVerdict: hasPosition ? null : verdict,
    exitVerdict: hasPosition ? verdict : null,
  };
}

/** Etichetta compatta per chip/export — «Top2 entry: yes» / «Top2 exit: wait». */
export function getTop2Label(
  hasPosition: boolean,
  verdict: Top2InvestVerdict,
  lang: "it" | "en",
): string {
  const profile = hasPosition ? "portfolio" : "opportunity";
  return formatTop2VerdictDisplay(profile, verdict, lang);
}

function precatKindFallbackLabel(kind: string, lang: "it" | "en"): string | null {
  const m: Record<string, { it: string; en: string }> = {
    enter: { it: "Finestra ingresso ottimale", en: "Optimal entry window" },
    accumulate: { it: "Accumula verso CD", en: "Accumulate toward CD" },
    too_early: { it: "CD ancora lontano — attendi T−40", en: "CD still far — wait for T−40" },
    late: { it: "Ingresso tardivo", en: "Late entry" },
    avoid: { it: "Evita ingresso", en: "Avoid entry" },
    sell: { it: "Uscita pre-CD", en: "Pre-CD exit" },
  };
  const hit = m[kind];
  return hit ? hit[lang] : null;
}

export function top2InvestReasonShort(
  ctx: Top2DecisionContext,
  lang: "it" | "en",
  opts?: { includeTarget?: boolean },
): string {
  const includeTarget = opts?.includeTarget !== false;
  const label = ctx.precatLabel.replace(/^[^\w\u{1F300}-\u{1FAFF}]/u, "").trim();
  const parts: string[] = [];

  if (ctx.side === "sell" && ctx.curveRisingHold) {
    parts.push(
      ctx.portfolioPnlLoss
        ? lang === "it"
          ? "In perdita P&L — curva ↑, attendi o valuta in In Loss"
          : "P&L in loss — curve ↑, hold or review In Loss"
        : lang === "it"
          ? "Curva in salita — attendi recupero, esci se pendenza ↓"
          : "Curve rising — hold for recovery, exit when slope ↓",
    );
  } else if (ctx.side === "sell" && ctx.portfolioPnlLoss && !ctx.slopeDeclining) {
    parts.push(
      lang === "it"
        ? "In perdita P&L — monitora curva e pendenza"
        : "P&L in loss — monitor curve and slope",
    );
  } else if (ctx.side === "sell" && ctx.slopeDeclining && label) {
    parts.push(label);
  } else if (label && ctx.side === "buy") {
    parts.push(label);
  } else if (
    label &&
    ctx.side === "sell" &&
    ctx.planReturnPct != null &&
    ctx.planReturnPct <= 0
  ) {
    parts.push(label);
  }

  if (
    ctx.stabilityVerdict === "exit" ||
    ctx.stabilityVerdict === "avoid"
  ) {
    if (!ctx.curveRisingHold) {
      parts.push(lang === "it" ? "Pendenza in uscita" : "Slope exit signal");
    }
  } else if (ctx.stabilityVerdict === "persistent") {
    parts.push(lang === "it" ? "Trend stabile" : "Stable trend");
  }

  const roi = resolveTop2HeadlineRoi(
    ctx.side,
    ctx.planCdReturnPct ?? null,
    ctx.targetReturnPct ?? ctx.planReturnPct,
    null,
    ctx.daysToTarget ?? null,
    ctx.curveRisingHold ?? false,
  );

  if (includeTarget && roi.headlinePct != null && Number.isFinite(roi.headlinePct)) {
    const sign = roi.headlinePct > 0 ? "+" : "";
    const horizon =
      roi.headlineDays != null && roi.headlineDays > 0
        ? lang === "it"
          ? ` (${roi.headlineDays}g)`
          : ` (${roi.headlineDays}d)`
        : "";
    if (roi.useTarget) {
      parts.push(
        lang === "it"
          ? `Target ${sign}${roi.headlinePct.toFixed(1)}%${horizon}`
          : `Target ${sign}${roi.headlinePct.toFixed(1)}%${horizon}`,
      );
      if (
        roi.showCdSecondary &&
        ctx.planReturnPct != null &&
        Math.abs(ctx.planReturnPct - roi.headlinePct) > 0.1
      ) {
        const cdSign = ctx.planReturnPct > 0 ? "+" : "";
        parts.push(
          lang === "it"
            ? `CD ${cdSign}${ctx.planReturnPct.toFixed(1)}%`
            : `CD ${cdSign}${ctx.planReturnPct.toFixed(1)}%`,
        );
      }
    } else if (ctx.planReturnPct != null) {
      parts.push(
        lang === "it"
          ? `Modello ${sign}${ctx.planReturnPct.toFixed(1)}% verso CD`
          : `Model ${sign}${ctx.planReturnPct.toFixed(1)}% to CD`,
      );
    }
  }

  if (parts.length > 0) return parts.slice(0, 2).join(" · ");

  const kindFallback = ctx.precatKind ? precatKindFallbackLabel(ctx.precatKind, lang) : null;
  if (kindFallback) return kindFallback;

  if (
    ctx.side === "buy" &&
    ctx.planReturnPct != null &&
    Number.isFinite(ctx.planReturnPct) &&
    ctx.planReturnPct > 0
  ) {
    return lang === "it"
      ? "ROI target positivo — score/confidenza bassi, attendi"
      : "Positive target ROI — low score/confidence, wait";
  }

  return lang === "it" ? "Dati modello incompleti" : "Incomplete model data";
}

export function top2SolidityLabel(
  score: number,
  affidFrac: number | null,
  hitPct: number | null,
  lang: "it" | "en",
): string {
  const aff =
    affidFrac != null && Number.isFinite(affidFrac)
      ? `${Math.round(affidFrac * 100)}%`
      : "—";
  const hit = hitPct != null && Number.isFinite(hitPct) ? `${Math.round(hitPct)}%` : "—";
  if (lang === "it") {
    return `Score ${Math.round(score)} · Conf. ${aff} · Hit ${hit}`;
  }
  return `Score ${Math.round(score)} · Conf. ${aff} · Hit ${hit}`;
}
