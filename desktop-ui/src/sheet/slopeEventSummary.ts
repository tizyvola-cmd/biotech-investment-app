/**
 * Testi e metriche compatte per eventi pendenza (tabelle overview / dettaglio).
 */

import type { ContrarianEventRecord } from "./contrarianLog";
import type { SlopeEventRecord } from "./slopeEventLog";
import type { UnifiedSlopeFeedRow } from "./slopeEventsFeed";

export type SlopeEventSeverity = "low" | "medium" | "high" | "critical";

/** Direzione dell'errore pendenza per colori tabella: rosso / giallo / verde. */
export type SlopeErrorTone = "negative" | "slowdown" | "positive" | "neutral";

export function slopeErrorToneStyles(tone: SlopeErrorTone): {
  cls: string;
  pillCls: string;
  dotCls: string;
} {
  switch (tone) {
    case "negative":
      return {
        cls: "text-[rgb(var(--signal-down))]",
        pillCls:
          "bg-[rgb(var(--signal-down))]/10 text-[rgb(var(--signal-down))] border-[rgb(var(--signal-down))]/25",
        dotCls: "bg-[rgb(var(--signal-down))]",
      };
    case "slowdown":
      return {
        cls: "text-[rgb(var(--warn))]",
        pillCls: "bg-[rgb(var(--warn))]/10 text-[rgb(var(--warn))] border-[rgb(var(--warn))]/25",
        dotCls: "bg-[rgb(var(--warn))]",
      };
    case "positive":
      return {
        cls: "text-[rgb(var(--signal-up))]",
        pillCls:
          "bg-[rgb(var(--signal-up))]/10 text-[rgb(var(--signal-up))] border-[rgb(var(--signal-up))]/25",
        dotCls: "bg-[rgb(var(--signal-up))]",
      };
    default:
      return {
        cls: "text-ink-muted",
        pillCls: "bg-slate-100/90 text-slate-600 border-slate-200/80",
        dotCls: "bg-slate-400",
      };
  }
}

export function slopeErrorToneCls(tone: SlopeErrorTone): string {
  return slopeErrorToneStyles(tone).cls;
}

const SLOPE_SIGN_EPS = 0.08;

/** Rosso = pendenza/errore negativo · giallo = rallentamento · verde = stock in salita. */
export function resolveSlopeErrorTone(row: UnifiedSlopeFeedRow): SlopeErrorTone {
  const { slope5d, slope20d } = slopesFromFeedRow(row);

  if (row.kind === "slope_dec") return "slowdown";
  if (row.kind === "slope_acc") return "positive";

  if (row.kind === "slope_rev") {
    if (slope5d != null && slope20d != null && slope5d * slope20d < 0) {
      return slope5d > 0 ? "positive" : "negative";
    }
    if (slope5d != null && Number.isFinite(slope5d)) {
      if (slope5d > SLOPE_SIGN_EPS) return "positive";
      if (slope5d < -SLOPE_SIGN_EPS) return "negative";
    }
    return "slowdown";
  }

  if (row.source === "contrarian") {
    const div = row.contrarianEvent.divergence_type;
    if (div === "model_up") return "negative";
    if (div === "model_down") return "positive";
    if (slope5d != null && slope5d > SLOPE_SIGN_EPS) return "positive";
    if (slope5d != null && slope5d < -SLOPE_SIGN_EPS) return "negative";
    return "neutral";
  }

  if (slope5d != null && slope20d != null && slope5d * slope20d < 0) {
    return slope5d > 0 ? "positive" : "negative";
  }
  if (slope5d != null && slope5d < -SLOPE_SIGN_EPS) return "negative";
  if (slope5d != null && slope5d > SLOPE_SIGN_EPS) return "positive";
  return "neutral";
}

export type SlopeKindMeta = {
  icon: string;
  labelIt: string;
  labelEn: string;
  cls: string;
  pillCls: string;
  dotCls: string;
};

export const SLOPE_KIND_META: Record<string, SlopeKindMeta> = {
  slope_rev: {
    icon: "",
    labelIt: "Inversione",
    labelEn: "Reversal",
    cls: "text-[rgb(var(--signal-down))]",
    pillCls:
      "bg-[rgb(var(--signal-down))]/10 text-[rgb(var(--signal-down))] border-[rgb(var(--signal-down))]/25",
    dotCls: "bg-[rgb(var(--signal-down))]",
  },
  slope_dec: {
    icon: "",
    labelIt: "Decelerazione",
    labelEn: "Deceleration",
    cls: "text-[rgb(var(--warn))]",
    pillCls: "bg-[rgb(var(--warn))]/10 text-[rgb(var(--warn))] border-[rgb(var(--warn))]/25",
    dotCls: "bg-[rgb(var(--warn))]",
  },
  slope_acc: {
    icon: "",
    labelIt: "Accelerazione",
    labelEn: "Acceleration",
    cls: "text-[rgb(var(--signal-up))]",
    pillCls:
      "bg-[rgb(var(--signal-up))]/10 text-[rgb(var(--signal-up))] border-[rgb(var(--signal-up))]/25",
    dotCls: "bg-[rgb(var(--signal-up))]",
  },
  contrarian: {
    icon: "",
    labelIt: "Contrarian",
    labelEn: "Contrarian",
    cls: "text-[rgb(var(--accent))]",
    pillCls: "bg-[rgb(var(--accent))]/10 text-[rgb(var(--accent))] border-[rgb(var(--accent))]/25",
    dotCls: "bg-[rgb(var(--accent))]",
  },
};

export function fmtSlopePp(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
}

export function slopesFromFeedRow(row: UnifiedSlopeFeedRow): {
  slope5d: number | null;
  slope20d: number | null;
  delta: number | null;
} {
  if (row.source === "slope") {
    const e = row.slopeEvent;
    return { slope5d: e.slope5d, slope20d: e.slope20d, delta: e.delta_pp_per_day };
  }
  return { slope5d: row.contrarianEvent.slope5d, slope20d: null, delta: null };
}

function signWord(v: number | null, lang: "it" | "en"): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v > 0.08) return lang === "it" ? "positiva" : "positive";
  if (v < -0.08) return lang === "it" ? "negativa" : "negative";
  return lang === "it" ? "piatta" : "flat";
}

/** Es. "negativa → positiva" oppure "+0.45 → −0.82". */
export function slopeSignTransition(
  slope5d: number | null,
  slope20d: number | null,
  lang: "it" | "en",
  mode: "words" | "values" = "words",
): string | null {
  if (slope5d == null || slope20d == null) return null;
  if (Math.abs(slope5d) < 0.001 && Math.abs(slope20d) < 0.001) return null;
  if (mode === "values") return `${fmtSlopePp(slope20d)} → ${fmtSlopePp(slope5d)}`;
  if (slope5d * slope20d >= 0) return null;
  return `${signWord(slope20d, lang)} → ${signWord(slope5d, lang)}`;
}

export function computeSlopeEventSeverity(
  kind: UnifiedSlopeFeedRow["kind"],
  slope5d: number | null,
  slope20d: number | null,
  delta: number | null,
  pred5: number | null = null,
): SlopeEventSeverity {
  if (kind === "contrarian") {
    const curveMag = Math.abs(slope5d ?? 0);
    const predMag = Math.abs((pred5 ?? 0) / 5);
    const mag = Math.max(curveMag, predMag);
    if (mag >= 1.5) return "high";
    if (mag >= 0.9) return "medium";
    return "low";
  }
  if (kind === "slope_rev") {
    const mag = Math.max(Math.abs(slope5d ?? 0), Math.abs(slope20d ?? 0));
    const flip =
      slope5d != null && slope20d != null && slope5d * slope20d < 0;
    if (flip && mag >= 1.2) return "critical";
    if (mag >= 1.0) return "high";
    if (mag >= 0.35) return "medium";
    return "low";
  }
  const d = Math.abs(delta ?? 0);
  if (d >= 2.0) return "critical";
  if (d >= 1.4) return "high";
  if (d >= 1.0) return "medium";
  return "low";
}

export function severityLabel(sev: SlopeEventSeverity, lang: "it" | "en"): string {
  const map: Record<SlopeEventSeverity, { it: string; en: string }> = {
    low: { it: "Bassa", en: "Low" },
    medium: { it: "Media", en: "Medium" },
    high: { it: "Alta", en: "High" },
    critical: { it: "Critica", en: "Critical" },
  };
  return lang === "it" ? map[sev].it : map[sev].en;
}

export function severityBadgeCls(sev: SlopeEventSeverity): string {
  switch (sev) {
    case "critical":
      return "bg-[rgb(var(--signal-down))]/15 text-[rgb(var(--signal-down))] border-[rgb(var(--signal-down))]/40";
    case "high":
      return "bg-[rgb(var(--signal-down))]/10 text-[rgb(var(--signal-down))] border-[rgb(var(--signal-down))]/30";
    case "medium":
      return "bg-[rgb(var(--warn))]/12 text-[rgb(var(--warn))] border-[rgb(var(--warn))]/35";
    default:
      return "bg-[rgb(var(--panel-feed-accent))]/12 text-[rgb(var(--panel-feed-accent-strong))] border-[rgb(var(--panel-feed-accent))]/35";
  }
}

export type SlopeEventSummary = {
  kindMeta: SlopeKindMeta;
  severity: SlopeEventSeverity;
  /** Riga compatta in tabella (modifica pendenza). */
  shiftLine: string;
  /** Solo tooltip / diagramma — non mostrato in tabella. */
  subLine: string;
  diagramTitle: string;
  slope5d: number | null;
  slope20d: number | null;
  shiftCls: string;
};

function ppUnit(lang: "it" | "en"): string {
  return lang === "it" ? "pp/g" : "pp/d";
}

function contrarianLines(e: ContrarianEventRecord, lang: "it" | "en"): {
  shift: string;
  sub: string;
} {
  const pred =
    e.pred5 != null && Number.isFinite(e.pred5)
      ? `${e.pred5 >= 0 ? "+" : ""}${e.pred5.toFixed(1)}%`
      : "—";
  const s5 = fmtSlopePp(e.slope5d);
  const u = ppUnit(lang);
  return {
    shift: lang === "it" ? `Pred ${pred} · curva ${s5} ${u}` : `Pred ${pred} · curve ${s5} ${u}`,
    sub:
      e.divergence_type === "model_up"
        ? lang === "it"
          ? "Modello ↑ vs curva ↓"
          : "Model ↑ vs curve ↓"
        : lang === "it"
          ? "Modello ↓ vs curva ↑"
          : "Model ↓ vs curve ↑",
  };
}

export function summarizeSlopeFeedRow(
  row: UnifiedSlopeFeedRow,
  lang: "it" | "en",
): SlopeEventSummary {
  const baseMeta = SLOPE_KIND_META[row.kind] ?? SLOPE_KIND_META.slope_dec;
  const errorTone = resolveSlopeErrorTone(row);
  const toneStyle = slopeErrorToneStyles(errorTone);
  const kindMeta: SlopeKindMeta = {
    ...baseMeta,
    cls: toneStyle.cls,
    pillCls: toneStyle.pillCls,
    dotCls: toneStyle.dotCls,
  };
  const { slope5d, slope20d, delta } = slopesFromFeedRow(row);
  const pred5 = row.source === "contrarian" ? row.contrarianEvent.pred5 : null;
  const severity = computeSlopeEventSeverity(row.kind, slope5d, slope20d, delta, pred5);
  const shiftCls = slopeErrorToneCls(errorTone);

  if (row.source === "contrarian") {
    const { shift, sub } = contrarianLines(row.contrarianEvent, lang);
    return {
      kindMeta,
      severity,
      shiftLine: shift,
      subLine: sub,
      diagramTitle: `${kindMeta.labelIt}: ${shift} · ${sub}`,
      slope5d,
      slope20d,
      shiftCls,
    };
  }

  const e = row.slopeEvent;
  const u = ppUnit(lang);
  let shiftLine: string;
  let subLine: string;

  if (row.kind === "slope_rev") {
    shiftLine = `${fmtSlopePp(slope20d)} → ${fmtSlopePp(slope5d)} ${u}`;
    subLine =
      slopeSignTransition(slope5d, slope20d, lang, "words") ??
      (lang === "it" ? "Segno 5g ≠ 20g" : "5d sign ≠ 20d");
  } else if (row.kind === "slope_acc" || row.kind === "slope_dec") {
    shiftLine = `Δ ${fmtSlopePp(delta)} ${u}`;
    subLine =
      lang === "it"
        ? `20g ${fmtSlopePp(slope20d)} → 5g ${fmtSlopePp(slope5d)} ${u}`
        : `20d ${fmtSlopePp(slope20d)} → 5d ${fmtSlopePp(slope5d)} ${u}`;
  } else {
    shiftLine = `Δ ${fmtSlopePp(delta)} ${u}`;
    subLine = "";
  }

  const diagramTitle = [
    lang === "it" ? kindMeta.labelIt : kindMeta.labelEn,
    shiftLine,
    subLine,
    lang === "it" ? `Gravità ${severityLabel(severity, lang)}` : `Severity ${severityLabel(severity, lang)}`,
    `T-${Math.max(0, e.days_to_cd_at_detection)}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    kindMeta,
    severity,
    shiftLine,
    subLine,
    diagramTitle,
    slope5d,
    slope20d,
    shiftCls,
  };
}

/** Compat: detail string per feed e log. */
export function slopeEventDetailText(row: UnifiedSlopeFeedRow, lang: "it" | "en"): string {
  const s = summarizeSlopeFeedRow(row, lang);
  return [s.shiftLine, s.subLine].filter(Boolean).join(" · ");
}

export function slopeEventDetailFromRecord(e: SlopeEventRecord, lang: "it" | "en"): string {
  return slopeEventDetailText(
    {
      source: "slope",
      id: e.id,
      ticker: e.ticker,
      cd: e.cd,
      detected_at: e.detected_at,
      kind: e.kind,
      detail: "",
      had_open_position: e.had_open_position,
      hasActiveChart: false,
      slopeEvent: e,
    },
    lang,
  );
}
