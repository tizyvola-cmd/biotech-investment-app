import type { EvolutionTrend } from "./modelEvolution";

export type LearningTrendKind = EvolutionTrend["label"];

export type LearningTrendVisual = {
  kind: LearningTrendKind;
  /** Emoji principale (cometa / 💩 / nido / clessidra). */
  icon: string;
  shortIt: string;
  shortEn: string;
  explainIt: string;
  explainEn: string;
  badgeCls: string;
  panelBorderCls: string;
  panelBgCls: string;
  headlineAccentCls: string;
};

const VISUALS: Record<LearningTrendKind, Omit<LearningTrendVisual, "kind">> = {
  improving: {
    icon: "☄️",
    shortIt: "In miglioramento",
    shortEn: "Improving",
    explainIt:
      "Buone notizie: nelle ultime settimane il modello indovina più spesso se il titolo sale o scende.",
    explainEn:
      "Good news: over recent weeks the model is getting direction right more often.",
    badgeCls: "text-[rgb(var(--signal-up))] bg-[rgb(var(--signal-up))]/12 border-[rgb(var(--signal-up))]/35",
    panelBorderCls: "border-[rgb(var(--signal-up))]/40",
    panelBgCls: "bg-gradient-to-br from-[rgb(var(--signal-up))]/10 to-transparent",
    headlineAccentCls: "text-[rgb(var(--signal-up))]",
  },
  degrading: {
    icon: "💩",
    shortIt: "In peggioramento",
    shortEn: "Getting worse",
    explainIt:
      "Attenzione: nelle ultime settimane il modello sbaglia più spesso. Conviene essere più cauti con i segnali.",
    explainEn:
      "Heads up: the model has been wrong more often lately. Be extra careful with signals.",
    badgeCls: "text-[rgb(var(--signal-down))] bg-[rgb(var(--signal-down))]/12 border-[rgb(var(--signal-down))]/35",
    panelBorderCls: "border-[rgb(var(--signal-down))]/40",
    panelBgCls: "bg-gradient-to-br from-[rgb(var(--signal-down))]/8 to-transparent",
    headlineAccentCls: "text-[rgb(var(--signal-down))]",
  },
  stable: {
    icon: "🪺",
    shortIt: "Stabile",
    shortEn: "Steady",
    explainIt:
      "Il modello va come prima: non peggiora, ma in questo momento non sta imparando nulla di nuovo.",
    explainEn:
      "The model is about the same as before: not worse, but not learning anything new right now.",
    badgeCls: "text-[rgb(var(--warn))] bg-[rgb(var(--warn))]/12 border-[rgb(var(--warn))]/35",
    panelBorderCls: "border-[rgb(var(--warn))]/40",
    panelBgCls: "bg-gradient-to-br from-[rgb(var(--warn))]/8 to-transparent",
    headlineAccentCls: "text-[rgb(var(--warn))]",
  },
  unknown: {
    icon: "🪺",
    shortIt: "In pausa",
    shortEn: "On hold",
    explainIt:
      "Non abbiamo ancora abbastanza risultati verificati per capire se il modello sta migliorando o peggiorando.",
    explainEn:
      "We don't have enough verified results yet to tell if the model is getting better or worse.",
    badgeCls: "text-[rgb(var(--warn))] bg-[rgb(var(--warn))]/10 border-[rgb(var(--warn))]/30",
    panelBorderCls: "border-[rgb(var(--warn))]/35",
    panelBgCls: "bg-gradient-to-br from-[rgb(var(--warn))]/6 to-transparent",
    headlineAccentCls: "text-[rgb(var(--warn))]",
  },
};

export function learningTrendVisual(trend: EvolutionTrend): LearningTrendVisual {
  const label: LearningTrendKind =
    trend.label === "improving" ||
    trend.label === "degrading" ||
    trend.label === "stable" ||
    trend.label === "unknown"
      ? trend.label
      : "unknown";
  const base = VISUALS[label];
  return {
    kind: label,
    ...base,
    explainIt:
      trend.label === "unknown" && trend.description
        ? `${base.explainIt} (${trend.description})`
        : trend.label !== "unknown" && trend.description
          ? trend.description
          : base.explainIt,
    explainEn:
      trend.label === "unknown" && trend.description
        ? `${base.explainEn} (${trend.description})`
        : trend.label !== "unknown" && trend.description
          ? trend.description
          : base.explainEn,
  };
}

/** Raffinamento: delta monitor recente può forzare stable vs unknown quando la serie è piatta. */
export function resolveLearningsTrendDisplay(
  trend: EvolutionTrend,
  opts?: { deltaPpLastMonitor?: number | null; pendingSignals?: number; closedSignals?: number },
): LearningTrendVisual {
  const visual = learningTrendVisual(trend);
  if (trend.label !== "unknown") return visual;

  const delta = opts?.deltaPpLastMonitor;
  const pending = opts?.pendingSignals ?? 0;
  const closed = opts?.closedSignals ?? 0;

  if (delta != null && Math.abs(delta) <= 0.05 && (pending > 0 || closed === 0)) {
    return {
      ...visual,
      kind: "stable",
      icon: "🪺",
      shortIt: "In attesa",
      shortEn: "Waiting",
      explainIt:
        closed === 0 && pending > 0
          ? `Ci sono ${pending} previsioni ancora da verificare (servono circa 5 giorni di borsa). Finché non si chiudono, il modello resta in pausa e non si aggiorna.`
          : `L'ultimo controllo non mostra cambiamenti misurabili — il modello aspetta nuovi risultati verificati.`,
      explainEn:
        closed === 0 && pending > 0
          ? `${pending} predictions are still being checked (about 5 trading days needed). Until they close, the model stays on hold and won't update.`
          : `The latest check shows no measurable change — the model is waiting for new verified results.`,
    };
  }

  return visual;
}
