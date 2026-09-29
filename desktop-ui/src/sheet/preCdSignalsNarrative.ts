import type { LearningTrendVisual } from "./learningTrendVisual";
import { learningTrendVisual } from "./learningTrendVisual";
import type { EvolutionTrend } from "./modelEvolution";
import type {
  SignalCalibrationDoc,
  SignalLiveRow,
} from "../data/signalCalibrationData";
import type { PreCdSignalsScope } from "./preCdSignalsScope";
import { NEAR_CD_WINDOW_DAYS, PRE_CD_RUNUP_MAX_DAYS, PRE_CD_RUNUP_MIN_DAYS } from "./preCdSignalsScope";

export type PreCdSignalsNarrative = {
  headline: string;
  whatHappened: string[];
  modelImpact: string[];
  kpis: {
    liveTotal: number;
    liveActionable: number;
    liveStrong: number;
    liveUseful: number;
    imminentCd: number;
    usefulHitPct: number | null;
    strongHitPct: number | null;
    rawHitPct: number | null;
    pendingOutcomes: number;
    closedOutcomes: number;
    weeklyHitPct: number | null;
    weeklyDeltaPp: number | null;
  };
};

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

function countLiveBuckets(rows: SignalLiveRow[]) {
  let strong = 0;
  let useful = 0;
  let actionable = 0;
  let imminent = 0;
  for (const r of rows) {
    const tier = String(r.signal_tier ?? "").toLowerCase();
    const emitted = r.signal_emitted || tier === "strong" || tier === "useful";
    if (tier === "strong") {
      strong += 1;
      actionable += 1;
    } else if (tier === "useful") {
      useful += 1;
      actionable += 1;
    } else if (emitted) {
      actionable += 1;
    }
    if (emitted) imminent += 1;
  }
  return { strong, useful, actionable, imminent, total: rows.length };
}

function weeklyTrend(weekly: SignalCalibrationDoc["weekly_actionable"]) {
  const rows = (weekly ?? []).filter((w) => w.hit_pct != null && (w.n ?? 0) > 0);
  if (rows.length === 0) return { latest: null as number | null, deltaPp: null as number | null };
  const latest = rows[rows.length - 1]?.hit_pct ?? null;
  const prev = rows.length >= 2 ? rows[rows.length - 2]?.hit_pct ?? null : null;
  const deltaPp =
    latest != null && prev != null && Number.isFinite(latest) && Number.isFinite(prev)
      ? latest - prev
      : null;
  return { latest, deltaPp };
}

export function resolvePreCdTrendVisual(
  doc: SignalCalibrationDoc | null,
  liveRows: SignalLiveRow[],
  usingSimPreview: boolean,
): LearningTrendVisual {
  const closed = doc?.closed_rows ?? 0;
  const pending = doc?.pending_outcomes ?? 0;
  const usefulHit = doc?.cohorts?.useful?.hit_pct ?? null;
  const { latest: weeklyHit, deltaPp } = weeklyTrend(doc?.weekly_actionable);

  if (usingSimPreview && closed === 0) {
    const trend: EvolutionTrend = {
      label: "unknown",
      accSlope: null,
      description: "",
    };
    const base = learningTrendVisual(trend);
    return {
      ...base,
      icon: "🔭",
      shortIt: "Anteprima live",
      shortEn: "Live preview",
      explainIt:
        "Stai vedendo i segnali calcolati adesso da Simulation. Per tracciare se azzeccano davvero, serve almeno un refresh live e ~5 giorni di borsa.",
      explainEn:
        "You're seeing signals computed now from Simulation. To track whether they work, run a live refresh and wait ~5 trading days.",
      badgeCls: "text-[rgb(var(--accent))] bg-[rgb(var(--accent))]/10 border-[rgb(var(--accent))]/30",
      panelBorderCls: "border-[rgb(var(--accent))]/35",
      panelBgCls: "bg-gradient-to-br from-[rgb(var(--accent))]/8 to-transparent",
      headlineAccentCls: "text-[rgb(var(--accent))]",
    };
  }

  if (closed === 0 && pending > 0) {
    const trend: EvolutionTrend = { label: "unknown", accSlope: null, description: "" };
    const base = learningTrendVisual(trend);
    return {
      ...base,
      icon: "⏳",
      shortIt: "In attesa",
      shortEn: "Waiting",
      explainIt: `${pending} segnali emessi sono ancora in attesa del risultato a +5 giorni. I grafici si riempiranno quando si chiudono.`,
      explainEn: `${pending} emitted signals are still waiting for their +5-day result. Charts will fill in once outcomes close.`,
      badgeCls: "text-[rgb(var(--warn))] bg-[rgb(var(--warn))]/12 border-[rgb(var(--warn))]/35",
      panelBorderCls: "border-[rgb(var(--warn))]/40",
      panelBgCls: "bg-gradient-to-br from-[rgb(var(--warn))]/8 to-transparent",
      headlineAccentCls: "text-[rgb(var(--warn))]",
    };
  }

  let label: EvolutionTrend["label"] = "unknown";
  const refHit = usefulHit ?? weeklyHit;
  if (refHit != null) {
    if (refHit >= 60 || (deltaPp != null && deltaPp >= 3)) label = "improving";
    else if (refHit < 50 || (deltaPp != null && deltaPp <= -3)) label = "degrading";
    else label = "stable";
  }

  const trend: EvolutionTrend = { label, accSlope: deltaPp, description: "" };
  const visual = learningTrendVisual(trend);

  if (label === "improving" && usefulHit != null) {
    return {
      ...visual,
      explainIt: `I segnali utili (Affid ≥50, |Pred5| ≥2%) azzeccano il ${fmtPct(usefulHit)} delle volte — sopra la soglia che ci aspettiamo.`,
      explainEn: `Useful signals (Affid ≥50, |Pred5| ≥2%) are right ${fmtPct(usefulHit)} of the time — above what we expect.`,
    };
  }
  if (label === "degrading" && usefulHit != null) {
    return {
      ...visual,
      explainIt: `I segnali utili azzeccano solo il ${fmtPct(usefulHit)} — sotto il 50%. Meglio privilegiare tier Strong o aspettare.`,
      explainEn: `Useful signals are right only ${fmtPct(usefulHit)} — below 50%. Prefer Strong tier or wait.`,
    };
  }
  if (label === "stable" && usefulHit != null) {
    return {
      ...visual,
      explainIt: `I segnali utili stanno intorno al ${fmtPct(usefulHit)} — né in netto miglioramento né in peggioramento.`,
      explainEn: `Useful signals sit around ${fmtPct(usefulHit)} — neither clearly improving nor worsening.`,
    };
  }

  if (liveRows.length > 0 && closed === 0) {
    return {
      ...visual,
      icon: "🔭",
      shortIt: "Dati in raccolta",
      shortEn: "Collecting data",
      explainIt: "I segnali live ci sono, ma mancano ancora outcome verificati per calibrare l'hit rate.",
      explainEn: "Live signals are present, but verified outcomes are still missing to calibrate hit rate.",
    };
  }

  return visual;
}

export function buildPreCdSignalsNarrative(
  doc: SignalCalibrationDoc | null,
  liveRows: SignalLiveRow[],
  usingSimPreview: boolean,
  lang: "en" | "it",
  scope: PreCdSignalsScope = "preCdRunup",
): PreCdSignalsNarrative {
  const it = lang === "it";
  const buckets = countLiveBuckets(liveRows);
  const usefulHit = doc?.cohorts?.useful?.hit_pct ?? null;
  const strongHit = doc?.cohorts?.strong?.hit_pct ?? null;
  const rawHit = doc?.cohorts?.raw?.hit_pct ?? null;
  const pending = doc?.pending_outcomes ?? 0;
  const closed = doc?.closed_rows ?? 0;
  const { latest: weeklyHit, deltaPp } = weeklyTrend(doc?.weekly_actionable);

  const usefulN = doc?.cohorts?.useful?.n ?? 0;
  const strongN = doc?.cohorts?.strong?.n ?? 0;

  let headline: string;
  if (liveRows.length === 0) {
    headline = it
      ? "Nessun titolo con segnale pre-CD in questo momento — prova Refresh live signals."
      : "No tickers with a pre-CD signal right now — try Refresh live signals.";
  } else if (buckets.actionable === 0) {
    headline = it
      ? `${buckets.total} titoli monitorati, ma nessun segnale abbastanza forte (serve Affid ≥50 e |Pred5| ≥2%).`
      : `${buckets.total} tickers tracked, but none strong enough (needs Affid ≥50 and |Pred5| ≥2%).`;
  } else if (usefulHit != null && usefulN > 0) {
    headline = it
      ? `${buckets.actionable} segnali utili o forti adesso · storicamente azzeccano il ${fmtPct(usefulHit)} (tier Useful).`
      : `${buckets.actionable} useful or strong signals now · historically right ${fmtPct(usefulHit)} (Useful tier).`;
  } else {
    headline = it
      ? `${buckets.actionable} segnali utili o forti su ${buckets.total} titoli — ${buckets.strong} Strong, ${buckets.useful} Useful.`
      : `${buckets.actionable} useful or strong signals among ${buckets.total} tickers — ${buckets.strong} Strong, ${buckets.useful} Useful.`;
  }

  const whatHappened: string[] = [];

  if (usingSimPreview) {
    whatHappened.push(
      it
        ? "Tabella in anteprima da Simulation (audit log non ancora popolato)."
        : "Table is a Simulation preview (audit log not populated yet).",
    );
  } else if (doc?.generated_at) {
    const when = new Date(doc.generated_at).toLocaleString(it ? "it-IT" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });
    whatHappened.push(
      it ? `Ultimo aggiornamento calibrazione: ${when}.` : `Last calibration update: ${when}.`,
    );
  }

  if (liveRows.length > 0) {
    const parts: string[] = [];
    if (buckets.strong > 0) parts.push(it ? `${buckets.strong} Strong` : `${buckets.strong} Strong`);
    if (buckets.useful > 0) parts.push(it ? `${buckets.useful} Useful` : `${buckets.useful} Useful`);
    const weak = buckets.total - buckets.actionable;
    whatHappened.push(
      it
        ? `In tabella: ${buckets.total} titoli, ${buckets.actionable} segnali actionable${parts.length ? ` (${parts.join(", ")})` : ""}${weak > 0 ? `, ${weak} deboli` : ""}.`
        : `In table: ${buckets.total} tickers, ${buckets.actionable} actionable${parts.length ? ` (${parts.join(", ")})` : ""}${weak > 0 ? `, ${weak} weak` : ""}.`,
    );
    if (buckets.imminent > 0) {
      whatHappened.push(
        scope === "nearCd"
          ? it
            ? `${buckets.imminent} segnali actionable nella finestra CD ±${NEAR_CD_WINDOW_DAYS} giorni.`
            : `${buckets.imminent} actionable signals in the CD ±${NEAR_CD_WINDOW_DAYS}-day window.`
          : it
            ? `${buckets.imminent} segnali actionable nel run-up ${PRE_CD_RUNUP_MIN_DAYS}–${PRE_CD_RUNUP_MAX_DAYS} gg prima del CD.`
            : `${buckets.imminent} actionable signals in the ${PRE_CD_RUNUP_MIN_DAYS}–${PRE_CD_RUNUP_MAX_DAYS}d pre-CD run-up.`,
      );
    }
  }

  if (closed > 0 || pending > 0) {
    whatHappened.push(
      it
        ? `Storico audit: ${closed} outcome verificati, ${pending} ancora in attesa (+5 sessioni).`
        : `Audit history: ${closed} verified outcomes, ${pending} still waiting (+5 sessions).`,
    );
  }

  if (strongHit != null && strongN > 0) {
    whatHappened.push(
      it
        ? `Tier Strong (|Pred5| ≥3%): hit ${fmtPct(strongHit)} su ${strongN} segnali chiusi.`
        : `Strong tier (|Pred5| ≥3%): ${fmtPct(strongHit)} hit on ${strongN} closed signals.`,
    );
  } else if (usefulHit != null && usefulN > 0) {
    whatHappened.push(
      it
        ? `Tier Useful: hit ${fmtPct(usefulHit)} su ${usefulN} segnali chiusi.`
        : `Useful tier: ${fmtPct(usefulHit)} hit on ${usefulN} closed signals.`,
    );
  }

  if (weeklyHit != null && deltaPp != null && Math.abs(deltaPp) >= 1) {
    const dir = deltaPp > 0 ? (it ? "salito" : "up") : it ? "sceso" : "down";
    whatHappened.push(
      it
        ? `Settimana scorsa hit ${fmtPct(weeklyHit)} (${dir} ${Math.abs(deltaPp).toFixed(1)} pp vs precedente).`
        : `Last week hit ${fmtPct(weeklyHit)} (${dir} ${Math.abs(deltaPp).toFixed(1)} pp vs prior).`,
    );
  }

  const modelImpact: string[] = [];

  if (buckets.actionable > 0) {
    modelImpact.push(
      it
        ? "Puntino verde = Strong, blu = Useful: sono i segnali su cui vale la pena concentrarsi."
        : "Green dot = Strong, blue = Useful: these are the signals worth focusing on.",
    );
  }

  modelImpact.push(
    it
      ? "«Refresh live signals» ricalcola Pred5, Affid e direzione sui titoli con CD ≤90 giorni."
      : "«Refresh live signals» recomputes Pred5, Affid and direction for tickers with CD ≤90 days.",
  );

  if (pending > 0 || closed === 0) {
    modelImpact.push(
      it
        ? "Dopo ~5 giorni di borsa usa «Rebuild calibration» per chiudere gli outcome e aggiornare hit% e grafici."
        : "After ~5 trading days use «Rebuild calibration» to close outcomes and refresh hit% and charts.",
    );
  } else {
    modelImpact.push(
      it
        ? "Hit% e grafici sotto riflettono l'ultimo rebuild — confronta Pred5 vs movimento reale."
        : "Hit% and charts below reflect the latest rebuild — compare Pred5 vs actual move.",
    );
  }

  if (usefulHit != null && usefulHit < 52) {
    modelImpact.push(
      it
        ? "Hit rate sotto il 52%: tratta i segnali come ipotesi, non come certezze."
        : "Hit rate below 52%: treat signals as hypotheses, not certainties.",
    );
  }

  return {
    headline,
    whatHappened,
    modelImpact,
    kpis: {
      liveTotal: buckets.total,
      liveActionable: buckets.actionable,
      liveStrong: buckets.strong,
      liveUseful: buckets.useful,
      imminentCd: buckets.imminent,
      usefulHitPct: usefulHit,
      strongHitPct: strongHit,
      rawHitPct: rawHit,
      pendingOutcomes: pending,
      closedOutcomes: closed,
      weeklyHitPct: weeklyHit,
      weeklyDeltaPp: deltaPp,
    },
  };
}
