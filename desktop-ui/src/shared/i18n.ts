/**
 * i18n — minimal language store + dictionary.
 *
 * Strategy:
 *  - English is the canonical baseline (every key MUST have an `en` value).
 *  - Italian is opt-in: components migrated to `useT()` re-render when the user
 *    flips the language toggle in System → Settings.
 *  - Keys are stable identifiers (e.g. "sidebar.section.overview") so they
 *    survive copywriting changes. Use namespaces by feature.
 *  - Strings not yet migrated stay in their hard-coded language until they are
 *    moved into the dictionary. This keeps the migration incremental.
 */

import { useSyncExternalStore } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

export type AppLang = "en" | "it";

export type TranslationEntry = {
  en: string;
  it: string;
};

// ── Storage ──────────────────────────────────────────────────────────────────

const LS_KEY = "supernova:app:lang";
const DEFAULT_LANG: AppLang = "en";

function readStoredLang(): AppLang {
  if (typeof window === "undefined") return DEFAULT_LANG;
  try {
    const v = window.localStorage.getItem(LS_KEY);
    return v === "it" || v === "en" ? v : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}

function writeStoredLang(lang: AppLang) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, lang);
  } catch {
    /* ignore */
  }
}

// ── Subscribable store ───────────────────────────────────────────────────────

let currentLang: AppLang = readStoredLang();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function getLang(): AppLang {
  return currentLang;
}

export function setLang(next: AppLang): void {
  if (next === currentLang) return;
  currentLang = next;
  writeStoredLang(next);
  // Also update the <html lang="…"> attribute for accessibility / browser hints.
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("lang", next);
  }
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Initialize <html lang="…"> on module load.
if (typeof document !== "undefined") {
  document.documentElement.setAttribute("lang", currentLang);
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * `useLang()` returns the current language code and a setter that updates it
 * globally (every consumer re-renders).
 */
export function useLang(): {
  lang: AppLang;
  setLang: (lang: AppLang) => void;
  toggle: () => void;
} {
  const lang = useSyncExternalStore(subscribe, getLang, getLang);
  return {
    lang,
    setLang,
    toggle: () => setLang(lang === "en" ? "it" : "en"),
  };
}

/**
 * `useT()` returns a translation function bound to the current language.
 * It re-renders the caller when the language changes.
 *
 * Usage:
 *   const t = useT();
 *   <button>{t("common.reload")}</button>
 */
export function useT(): (key: TranslationKey, vars?: Record<string, string | number>) => string {
  const lang = useSyncExternalStore(subscribe, getLang, getLang);
  return (key, vars) => translate(key, lang, vars);
}

/** Non-hook variant: useful inside callbacks or non-component code. */
export function t(key: TranslationKey, vars?: Record<string, string | number>): string {
  return translate(key, currentLang, vars);
}

function translate(
  key: TranslationKey,
  lang: AppLang,
  vars?: Record<string, string | number>
): string {
  const entry = DICT[key] as TranslationEntry | undefined;
  // Fallback chain: requested lang → English → key itself (dev signal).
  let raw: string = entry?.[lang] ?? entry?.en ?? String(key);
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      raw = raw.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return raw;
}

// ── Dictionary ───────────────────────────────────────────────────────────────
// Keep entries grouped by feature/area. Add an entry only when migrating a
// hard-coded string from a component. The build-time TS check on `TranslationKey`
// guarantees every consumer keeps using an existing key.

const DICT = {
  // ── Common buttons / labels ────────────────────────────────────────────────
  "common.reload": {
    en: "Reload",
    it: "Ricarica",
  },
  "common.refreshPage": {
    en: "Refresh",
    it: "Aggiorna",
  },
  "refresh.page.default.tooltip": {
    en: "Re-read this page's data from snapshots and recalculate local metrics (~1s). Server auto-refresh runs on schedule; heavy jobs are under System → Refresh.",
    it: "Rilegge i dati di questa pagina dagli snapshot e ricalcola le metriche locali (~1s). Il server aggiorna in automatico; job pesanti in System → Refresh.",
  },
  "refresh.page.dashboard.tooltip": {
    en: "Reload Dashboard from snapshots: Simulation, charts, SDS, SEC 8-K, AI feed and P&L. «Data updated» in the top bar is the last server pipeline run — use System → Refresh for new Yahoo prices.",
    it: "Rilegge la Dashboard dagli snapshot: Simulation, grafici, SDS, SEC 8-K, feed AI e P&L. «Data updated» in alto = ultimo job server — per nuovi prezzi Yahoo usa Sistema → Refresh.",
  },
  "refresh.page.catalyst.tooltip": {
    en: "Reload Curves charts from the Simulation snapshot.",
    it: "Aggiorna i grafici Curve dallo snapshot Simulation.",
  },
  "refresh.page.decisionLab.tooltip": {
    en: "Reload Pick stocks: Simulation snapshot, charts, Top Opps store, and all tabs (Opportunities · SuperNova). Live signals run in background if API is online.",
    it: "Ricarica Scegli titoli: snapshot Simulation, grafici, store Top Opps e tutte le tab (Opportunità · SuperNova). Live signals in background se l'API è online.",
  },
  "refresh.page.simulation.tooltip": {
    en: "Refresh Simulation: re-read snapshot, reload charts and recalculate P&L (~1s). New CD studies arrive via morning server job.",
    it: "Aggiorna Simulation: rilegge snapshot, grafici e ricalcolo P&L (~1s). Nuovi CD arrivano con il job mattutino sul server.",
  },
  "refresh.page.modelAnalysis.tooltip": {
    en: "Reload Accuracy / monitor JSON and refresh this lab's panels.",
    it: "Ricarica JSON Accuracy/monitor e aggiorna i pannelli di questa pagina.",
  },
  "refresh.page.sdsRoiConvergence.tooltip": {
    en: "Recalculate SDS ROI forecasts, score matured Simulation events (CD+14d), and reload convergence charts.",
    it: "Ricalcola previsioni ROI SDS, valuta eventi Simulation maturi (CD+14g) e ricarica i grafici di convergenza.",
  },
  "refresh.page.financial.tooltip": {
    en: "Reload Financial table from snapshot (prices updated hourly on server when connected to VPS).",
    it: "Ricarica tabella Financial dallo snapshot (prezzi aggiornati ogni ora sul server se connesso al VPS).",
  },
  "refresh.page.catalystFeed.tooltip": {
    en: "Reload Catalyst Feed snapshots and AI enrichment for this page.",
    it: "Ricarica snapshot Catalyst Feed e arricchimento AI per questa pagina.",
  },
  "common.reloading": {
    en: "Reloading…",
    it: "Ricarica…",
  },
  "common.reloaded": {
    en: "✓ Reloaded",
    it: "✓ Ricaricato",
  },
  "common.refreshData": {
    en: "🔄 Refresh data",
    it: "🔄 Aggiorna dati",
  },
  "common.updated": {
    en: "Updated",
    it: "Aggiornato",
  },
  "common.pageReloadedAt": {
    en: "Page read",
    it: "Pagina riletta",
  },
  "refresh.controls.lastPageRefresh": {
    en: "Last refresh",
    it: "Ultimo refresh",
  },
  "common.loading": {
    en: "Loading…",
    it: "Caricamento…",
  },
  "common.cancel": {
    en: "Cancel",
    it: "Annulla",
  },
  "common.confirm": {
    en: "Confirm",
    it: "Conferma",
  },
  "common.save": {
    en: "Save",
    it: "Salva",
  },
  "common.close": {
    en: "Close",
    it: "Chiudi",
  },
  "common.open": {
    en: "Open",
    it: "Apri",
  },
  "common.error": {
    en: "Error",
    it: "Errore",
  },
  "common.online": {
    en: "online",
    it: "online",
  },
  "common.offline": {
    en: "offline",
    it: "offline",
  },
  "common.now": {
    en: "now",
    it: "ora",
  },
  "common.stop": {
    en: "stop",
    it: "stop",
  },
  "common.sort": {
    en: "Sort",
    it: "Ordina",
  },
  "common.filter": {
    en: "Filter",
    it: "Filtra",
  },
  "common.search": {
    en: "Search",
    it: "Cerca",
  },
  "common.day": {
    en: "day",
    it: "giorno",
  },
  "common.days": {
    en: "days",
    it: "giorni",
  },
  "common.minAgo": {
    en: "{n} min ago",
    it: "{n} min fa",
  },
  "common.hAgo": {
    en: "{n} h ago",
    it: "{n} h fa",
  },

  // ── Sidebar ────────────────────────────────────────────────────────────────
  "sidebar.brand.tagline": {
    en: "Biotech Intel",
    it: "Biotech Intel",
  },
  "sidebar.section.overview": {
    en: "Today",
    it: "Oggi",
  },
  "sidebar.section.watch": {
    en: "Watch",
    it: "Osserva",
  },
  "sidebar.section.portfolio": {
    en: "Portfolio",
    it: "Portafoglio",
  },
  "sidebar.section.market": {
    en: "Market",
    it: "Mercato",
  },
  "sidebar.section.analyze": {
    en: "Model",
    it: "Modello",
  },
  "sidebar.section.research": {
    en: "News",
    it: "News",
  },
  "sidebar.section.collab": {
    en: "Research",
    it: "Ricerca",
  },
  "sidebar.item.mainDashboard": {
    en: "Home",
    it: "Home",
  },
  "sidebar.item.catalystHub": {
    en: "Charts & curves",
    it: "Grafici & curve",
  },
  "sidebar.item.simulation": {
    en: "My portfolio",
    it: "Il mio portafoglio",
  },
  "sim.page.title": {
    en: "My portfolio",
    it: "Il mio portafoglio",
  },
  "sidebar.item.decisionLab": {
    en: "Pick stocks",
    it: "Scegli titoli",
  },
  "sidebar.item.modelAnalysis": {
    en: "Model quality",
    it: "Qualità modello",
  },
  "sidebar.item.distribCurves": {
    en: "Distribution & Curves",
    it: "Distribuzione & Curve",
  },
  "sidebar.item.clinical": {
    en: "Clinical Trials",
    it: "Studi clinici",
  },
  "sidebar.item.secK8": {
    en: "SEC 8-K",
    it: "SEC 8-K",
  },
  "sidebar.item.financial": {
    en: "Financials",
    it: "Bilanci",
  },
  "sidebar.item.catalystFeed": {
    en: "Catalyst news",
    it: "Notizie catalyst",
  },
  "sidebar.item.testerMonitor": {
    en: "Tester feedback",
    it: "Feedback tester",
  },
  "testerMonitor.decisionSim.title": {
    en: "Investment / divestment simulation loop",
    it: "Loop simulazione investimento / disinvestimento",
  },
  "testerMonitor.decisionSim.subtitle": {
    en: "Measures what you gain or lose by following every BUY/SELL recommendation in parallel (virtual paper portfolio). 💼 = also in your real Simulation capital. Run a tick to execute new trades; KPI piggy bank tracks cumulative P&L vs missed buys.",
    it: "Misura quanto guadagni o perdi seguendo pari passo ogni raccomandazione BUY/SELL (portfolio paper virtuale). 💼 = anche nel capitale Simulation reale. Esegui un tick per i trade; il piggy bank traccia P&L cumulato vs buy non seguiti.",
  },
  "testerMonitor.decisionSim.startExperiment": {
    en: "Start long-run experiment",
    it: "Avvia esperimento long-run",
  },
  "testerMonitor.decisionSim.experimentRunning": {
    en: "Experiment running",
    it: "Esperimento attivo",
  },
  "testerMonitor.decisionSim.startWeek": {
    en: "Start {days}-day loop",
    it: "Avvia loop {days} giorni",
  },
  "testerMonitor.decisionSim.stop": {
    en: "Stop loop",
    it: "Ferma loop",
  },
  "testerMonitor.decisionSim.runNow": {
    en: "Run tick now",
    it: "Esegui tick ora",
  },
  "testerMonitor.decisionSim.col.composite": {
    en: "Composite",
    it: "Composito",
  },
  "testerMonitor.decisionSim.col.gainIdea": {
    en: "Gain idea",
    it: "Idea guadagno",
  },
  "recommendation.gainIdea.tip": {
    en: "Expected € gain and horizon from pred+recalibration curve peak, adjusted by MII angle. Hover — for why an estimate is missing.",
    it: "Guadagno € atteso e orizzonte dal picco curva pred+ricalibrazione, aggiustato dall'angolo MII. Passa il mouse su — per il motivo se manca.",
  },
  "testerMonitor.decisionSim.compositeHint": {
    en: "Weighted score 0–100 by CD zone (hot/watch/early/loss). Auxiliary — does not override recovery guards.",
    it: "Score pesato 0–100 per fascia CD (hot/watch/early/loss). Ausiliario — non sostituisce le guardie recovery.",
  },
  "testerMonitor.decisionSim.download": {
    en: "Download JSON",
    it: "Scarica JSON",
  },
  "testerMonitor.decisionSim.progress": {
    en: "{pct}% of week",
    it: "{pct}% settimana",
  },
  "testerMonitor.decisionSim.interval": {
    en: "every {h}h",
    it: "ogni {h}h",
  },
  "testerMonitor.decisionSim.marketSchedule": {
    en: "Mon–Fri 15:00–22:00 Rome · hourly",
    it: "lun–ven 15:00–22:00 Roma · ogni ora",
  },
  "testerMonitor.decisionSim.lastTick": {
    en: "Last tick",
    it: "Ultimo tick",
  },
  "testerMonitor.decisionSim.kpi.ticks": {
    en: "Ticks",
    it: "Tick",
  },
  "testerMonitor.decisionSim.kpi.paperPnl": {
    en: "Paper P&L",
    it: "P&L paper",
  },
  "testerMonitor.decisionSim.kpi.piggyTotal": {
    en: "Piggy bank",
    it: "Piggy bank",
  },
  "testerMonitor.decisionSim.kpi.closedPiggy": {
    en: "Closed piggy",
    it: "Piggy chiusura",
  },
  "testerMonitor.decisionSim.kpi.closedPiggySub": {
    en: "{n} matured · {wins}✓ / {losses}✗ · {tickers}",
    it: "{n} maturati · {wins}✓ / {losses}✗ · {tickers}",
  },
  "testerMonitor.decisionSim.kpi.closedPiggyEmpty": {
    en: "No closed paper deals yet",
    it: "Nessun deal paper chiuso",
  },
  "testerMonitor.decisionSim.kpi.closedPiggyTip": {
    en: "Realized P&L from paper SELL trades — deals that were sold and matured. Open MTM stays in Piggy bank total.",
    it: "P&L realizzato dai SELL paper — deal venduti e maturati. Il MTM aperto resta nel Piggy bank totale.",
  },
  "testerMonitor.decisionSim.chart.maturationTitle": {
    en: "Stock maturation over time",
    it: "Maturazione azioni nel tempo",
  },
  "testerMonitor.decisionSim.chart.maturationSub": {
    en: "Three groups — Portfolio, Sim loop, Sim loop · synth. Solid = closed deals (realized). Dashed = open positions (MTM). Dots = paper SELL events.",
    it: "Tre gruppi — Portfolio, Sim loop, Sim loop · synth. Linea continua = deal chiusi (realizzato). Tratteggiato = posizioni aperte (MTM). Punti = SELL paper.",
  },
  "testerMonitor.decisionSim.chart.maturationEmpty": {
    en: "Run ticks to see maturation — closed piggy grows on each paper SELL.",
    it: "Esegui tick per la maturazione — il piggy chiusura cresce ad ogni SELL paper.",
  },
  "testerMonitor.decisionSim.closedDealsTable": {
    en: "Matured closed deals",
    it: "Deal chiusi maturati",
  },
  "testerMonitor.decisionSim.kpi.closed": {
    en: "closed",
    it: "chiuso",
  },
  "testerMonitor.decisionSim.kpi.portfolio": {
    en: "Open positions",
    it: "Posizioni aperte",
  },
  "testerMonitor.decisionSim.kpi.paperSim": {
    en: "Paper sim",
    it: "Sim paper",
  },
  "testerMonitor.decisionSim.kpi.paperSimEmpty": {
    en: "0 slots · experiment not following yet",
    it: "0 slot · sim non ha ancora seguito",
  },
  "testerMonitor.decisionSim.kpi.paperSimTip": {
    en: "Open positions in the paper-trading experiment — the sim loop buys every reliable BUY signal (no cap). Not the same as your real portfolio (💼) or the recommendation count in the table below.",
    it: "Posizioni aperte nell'esperimento paper — il loop sim compra ogni segnale BUY affidabile (nessun limite). Non coincide con il portafoglio reale (💼) né con il numero di raccomandazioni in tabella sotto.",
  },
  "testerMonitor.decisionSim.kpi.realPortfolio": {
    en: "Real portfolio",
    it: "Portafoglio reale",
  },
  "testerMonitor.decisionSim.kpi.realPortfolioEmpty": {
    en: "No open lines in Simulation sheet",
    it: "Nessuna riga aperta nel foglio Simulation",
  },
  "testerMonitor.decisionSim.kpi.realPortfolioTip": {
    en: "Tickers marked 💼 in the table — capital deployed in your real portfolio (Simulation inputs).",
    it: "Ticker con 💼 in tabella — capitale impiegato nel portafoglio reale (input Simulation).",
  },
  "testerMonitor.decisionSim.kpi.deployed": {
    en: "deployed",
    it: "investito",
  },
  "testerMonitor.decisionSim.kpi.missedOpp": {
    en: "Missed buys",
    it: "Buy persi",
  },
  "testerMonitor.decisionSim.kpi.missedOppSub": {
    en: "{eur} est. · now (not in paper)",
    it: "{eur} stim. · ora (non in paper)",
  },
  "testerMonitor.decisionSim.kpi.est": {
    en: "est.",
    it: "stim.",
  },
  "testerMonitor.decisionSim.kpi.adviceSuccess": {
    en: "Advice direction (24h)",
    it: "Direzione consigli (24h)",
  },
  "testerMonitor.decisionSim.kpi.adviceSuccessTip": {
    en: "24h direction correctness (✓/✗) — not € P&L. Headline: live P(plan) chart when ≥3 scored; else paper sim ticks; closed Simulation round-trips only with ≥8 closes. See capture & portfolio return for complementary KPIs.",
    it: "Correttezza direzione 24h (✓/✗) — non P&L €. Headline: grafico P(plan) live con ≥3 valutati; altrimenti tick paper sim; Simulation chiusa solo con ≥8 round-trip. Vedi capture e rendimento portafoglio per KPI complementari.",
  },
  "testerMonitor.decisionSim.kpi.captureVsRecs": {
    en: "Capture vs recs",
    it: "Capture vs raccomandazioni",
  },
  "testerMonitor.decisionSim.kpi.captureVsRecsSub": {
    en: "{actual} / {potential} pot. 24h",
    it: "{actual} / {potential} pot. 24h",
  },
  "testerMonitor.decisionSim.kpi.captureVsRecsTip": {
    en: "Paper P&L realized ÷ potential 24h P&L on executable recommendations (BUY/SELL/in paper). Low % means sizing, timing, or missed entries — not wrong direction.",
    it: "P&L paper realizzato ÷ potenziale 24h sulle raccomandazioni eseguibili (BUY/SELL/in paper). % bassa = sizing, timing o entry mancate — non direzione sbagliata.",
  },
  "testerMonitor.decisionSim.kpi.closedPnlSuccess": {
    en: "Closed P&L success",
    it: "Successo P&L chiuso",
  },
  "testerMonitor.decisionSim.kpi.closedPnlSuccessSub": {
    en: "{wins}✓ / {losses}✗ round-trip",
    it: "{wins}✓ / {losses}✗ round-trip",
  },
  "testerMonitor.decisionSim.kpi.closedPnlSuccessTip": {
    en: "Win rate on closed paper round-trips (realized €), not 24h direction.",
    it: "Win rate su round-trip paper chiusi (€ realizzati), non direzione 24h.",
  },
  "testerMonitor.decisionSim.kpi.paperBookReturn": {
    en: "Paper book return",
    it: "Rendimento book paper",
  },
  "testerMonitor.decisionSim.kpi.paperBookReturnSub": {
    en: "{pnl} on {book} deployed",
    it: "{pnl} su {book} impiegati",
  },
  "testerMonitor.decisionSim.kpi.paperBookReturnTip": {
    en: "Total paper P&L (open MTM + closed) ÷ capital deployed — portfolio outcome, separate from 24h advice direction.",
    it: "P&L paper totale (MTM aperto + chiuso) ÷ capitale impiegato — esito portafoglio, separato dalla direzione 24h dei consigli.",
  },
  "testerMonitor.decisionSim.kpi.advicePrecision": {
    en: "Paper sim score (detail)",
    it: "Score paper sim (dettaglio)",
  },
  "testerMonitor.decisionSim.kpi.advicePrecisionSub": {
    en: "{good}✓ / {bad}✗ · paper sim ticks",
    it: "{good}✓ / {bad}✗ · tick paper sim",
  },
  "testerMonitor.decisionSim.kpi.advicePrecisionTip": {
    en: "Detail layer — paper-sim experiment ticks. Included in unified Advice success when live sample is too small.",
    it: "Strato dettaglio — tick esperimento paper sim. Entra in Successo consigli unificato se il campione live è troppo piccolo.",
  },
  "testerMonitor.decisionSim.kpi.adviceReliability": {
    en: "Live reliability (detail)",
    it: "Affidabilità live (dettaglio)",
  },
  "testerMonitor.decisionSim.kpi.adviceReliabilitySub": {
    en: "{good}✓ / {bad}✗ · {pending} pending · live",
    it: "{good}✓ / {bad}✗ · {pending} in attesa · live",
  },
  "testerMonitor.decisionSim.kpi.adviceReliabilityTip": {
    en: "Primary layer when ≥3 scored — same ✓/✗ as P(plan) vs forecast error chart. Drives unified Advice success headline.",
    it: "Strato primario con ≥3 valutati — stessi ✓/✗ del grafico P(plan) vs errore stima. Alimenta la metrica unificata Successo consigli.",
  },
  "testerMonitor.decisionSim.kpi.open": {
    en: "open",
    it: "aperti",
  },
  "testerMonitor.decisionSim.kpi.misalign": {
    en: "Misaligned",
    it: "Disallineati",
  },
  "testerMonitor.decisionSim.kpi.misalignSub": {
    en: "live · critical flags only",
    it: "live · solo flag critici",
  },
  "testerMonitor.decisionSim.kpi.agree": {
    en: "Signal agree",
    it: "Accordo segnali",
  },
  "testerMonitor.decisionSim.kpi.agreeSub": {
    en: "precat = verdict",
    it: "precat = verdetto",
  },
  "testerMonitor.decisionSim.chart.piggyTrend": {
    en: "Piggy bank & misalignment over ticks",
    it: "Piggy bank e disallineamento nel tempo",
  },
  "testerMonitor.decisionSim.chart.piggyTrendSub": {
    en: "€ from saved ticks · Misaligned % ends at · now (live, post-fix logic). Older tick points keep their snapshot.",
    it: "€ dagli tick salvati · Disallineati % termina a · ora (live, logica aggiornata). I tick precedenti restano snapshot storici.",
  },
  "testerMonitor.decisionSim.chart.cumulativePnl": {
    en: "Cumulative paper P&L",
    it: "P&L cumulativo paper",
  },
  "testerMonitor.decisionSim.chart.cumulativePnlSub": {
    en: "Paper MTM per tick · purple dashed = raw 100% recs (€5k × Var.24h) · teal = cumulative executable recs (cap 8, paper capital, no Enter on losers).",
    it: "MTM paper per tick · viola tratteggiato = 100% rec grezzo (€5k × Var.24h) · teal = cumulativo rec eseguibili (cap 8, capitale paper, no Enter su perdenti).",
  },
  "testerMonitor.decisionSim.chart.recs24hLine": {
    en: "100% recs · 24h only",
    it: "100% rec · solo Var.24h",
  },
  "testerMonitor.decisionSim.chart.fairRecsCumLine": {
    en: "Executable recs · cumulative",
    it: "Rec eseguibili · cumulativo",
  },
  "testerMonitor.decisionSim.chart.tradesPnl": {
    en: "Paper portfolio · BUY / SELL",
    it: "Portafoglio paper · BUY / SELL",
  },
  "testerMonitor.decisionSim.chart.tradesPnlSynth": {
    en: "Sim loop (synth) · BUY / SELL",
    it: "Sim loop (synth) · BUY / SELL",
  },
  "testerMonitor.decisionSim.chart.tradesPnlWeight": {
    en: "Sim loop (weight) · BUY / SELL",
    it: "Sim loop (weight) · BUY / SELL",
  },
  "testerMonitor.decisionSim.exportGainAudit": {
    en: "Excel gain audit",
    it: "Excel audit gain",
  },
  "testerMonitor.decisionSim.exportGainAuditTip": {
    en: "Download tick-by-tick equal / weight / synth P&L for external audit (.xls).",
    it: "Scarica P&L equal / weight / synth per tick per audit esterno (.xls).",
  },
  "testerMonitor.decisionSim.chart.showSynthCurve": {
    en: "⇄ Synth curve",
    it: "⇄ Curva synth",
  },
  "testerMonitor.decisionSim.chart.showEqualCurve": {
    en: "⇄ Equal · €5k",
    it: "⇄ Equal · €5k",
  },
  "testerMonitor.decisionSim.chart.showSynthCurveTip": {
    en: "Show Weight Sim Exp sized P&L and BUY/SELL markers on the synth book.",
    it: "Mostra P&L e BUY/SELL con sizing Weight Sim Exp sul book synth.",
  },
  "testerMonitor.decisionSim.chart.showEqualCurveTip": {
    en: "Back to equal-weight paper sim loop (€5k per deal).",
    it: "Torna al sim loop paper equal-weight (€5k per deal).",
  },
  "simLoopTradeAlert.titleOne": {
    en: "Sim loop · {side} {ticker}",
    it: "Sim loop · {side} {ticker}",
  },
  "simLoopTradeAlert.titleMany": {
    en: "Sim loop · {n} trade(s) executed",
    it: "Sim loop · {n} operazioni eseguite",
  },
  "simLoopTradeAlert.subtitle": {
    en: "Paper recommendation executed at {when}",
    it: "Raccomandazione paper eseguita alle {when}",
  },
  "simLoopTradeAlert.subtitlePending": {
    en: "Signal detected at {when} · execution scheduled {execute}",
    it: "Segnale rilevato alle {when} · esecuzione prevista {execute}",
  },
  "simLoopTradeAlert.pendingHint": {
    en: "Market move applied first (entry weight). BUY/SELL runs after the 10-minute response window.",
    it: "Prima colpisce il movimento di mercato (peso ingresso). BUY/SELL dopo 10 minuti di finestra di risposta.",
  },
  "simLoopTradeAlert.open24h": {
    en: "Open 24h assessment →",
    it: "Apri valutazione 24h →",
  },
  "simLoopTradeAlert.dismiss": {
    en: "Close",
    it: "Chiudi",
  },
  "gapInvestigation.title": {
    en: "Gap investigation · {ticker}",
    it: "Indagine gap · {ticker}",
  },
  "gapInvestigation.subtitle": {
    en: "Mark jump detected at {when} — review before changing size",
    it: "Salto mark rilevato alle {when} — rivedi prima di cambiare size",
  },
  "gapInvestigation.gap": { en: "Gap", it: "Gap" },
  "gapInvestigation.size": { en: "Paper size", it: "Size paper" },
  "gapInvestigation.daysToCd": { en: "Days to CD", it: "Giorni a CD" },
  "gapInvestigation.noNewsBody": {
    en: "No ticker-specific news found — the move may reflect sector/market action or information not yet public. This is not confirmation that the move is unjustified.",
    it: "Nessuna notizia specifica sul titolo — il movimento può riflettere settore/mercato o informazione non ancora pubblica. Non è conferma che il calo sia ingiustificato.",
  },
  "gapInvestigation.confidenceHigh": { en: "high confidence", it: "confidenza alta" },
  "gapInvestigation.sourceLink": { en: "Source", it: "Fonte" },
  "gapInvestigation.chooseHint": {
    en: "Choose an action (nothing runs until you confirm):",
    it: "Scegli un'azione (nulla viene eseguito finché non confermi):",
  },
  "gapInvestigation.optionReduce": { en: "Reduce / sell size", it: "Riduci / vendi size" },
  "gapInvestigation.optionAdd": { en: "Add size", it: "Aggiungi size" },
  "gapInvestigation.optionDismiss": { en: "Do nothing / close", it: "Non fare nulla / chiudi" },
  "gapInvestigation.closePending": {
    en: "Close (review later)",
    it: "Chiudi (rivedi dopo)",
  },
  "gapInvestigation.confirm": { en: "Confirm choice", it: "Conferma scelta" },
  "gapInvestigation.pendingBanner": {
    en: "{n} gap event(s) awaiting review",
    it: "{n} gap in attesa di revisione",
  },
  "gapInvestigation.reviewOpen": { en: "Review", it: "Rivedi" },
  "gapInvestigation.newsType.clinical_data": { en: "Clinical data", it: "Dati clinici" },
  "gapInvestigation.newsType.regulatory_8k": { en: "Regulatory / 8-K", it: "Regolatorio / 8-K" },
  "gapInvestigation.newsType.analyst_action": { en: "Analyst action", it: "Azione analisti" },
  "gapInvestigation.newsType.sector_wide": { en: "Sector-wide", it: "Settore ampio" },
  "gapInvestigation.newsType.unknown": { en: "Unknown", it: "Sconosciuto" },
  "testerMonitor.decisionSim.tradePortfolio.sub": {
    en: "Solid line = cumulative sim loop P&L €. Green ● = BUY. SELL = ▼: green if the stock fell after the sell (good advice), red if it kept rising (bad). Amber ▲ = HOLD/REVIEW.",
    it: "Linea continua = P&L cumulativo sim loop €. ● verde = BUY. SELL = ▼: verde se il titolo scende dopo la vendita (consiglio giusto), rosso se continua a salire (sbagliato). Ambra ▲ = HOLD/REVIEW.",
  },
  "testerMonitor.decisionSim.tradePortfolio.tableTitle": {
    en: "Operations log",
    it: "Registro operazioni",
  },
  "testerMonitor.decisionSim.chart.tradesOpenOnly": {
    en: "{open} open positions · {buy} BUY · 0 SELL · open MTM €{mtm} (unrealized — see chart above)",
    it: "{open} posizioni aperte · {buy} BUY · 0 SELL · MTM aperto €{mtm} (non realizzato — vedi grafico sopra)",
  },
  "testerMonitor.decisionSim.chart.tradesEmptyOpen": {
    en: "{open} open paper positions · open MTM €{mtm} · no trade log in tick history yet",
    it: "{open} posizioni paper aperte · MTM aperto €{mtm} · nessun log operazioni nello storico tick",
  },
  "testerMonitor.decisionSim.chart.pnlEmpty": {
    en: "Run at least one tick to see P&L charts.",
    it: "Esegui almeno un tick per vedere i grafici P&L.",
  },
  "testerMonitor.decisionSim.chart.tradesEmpty": {
    en: "No paper trades yet.",
    it: "Nessun trade paper ancora.",
  },
  "testerMonitor.decisionSim.adviceCalib.title": {
    en: "P(plan) vs forecast error",
    it: "P(plan) vs errore stima",
  },
  "testerMonitor.decisionSim.adviceCalib.sub": {
    en: "24h direction metric — separate from portfolio € return. Circle = BUY · ▼ = SELL. Green ✓ = correct direction; red ✗ = wrong. X = P(plan); Y = forecast error vs actual 24h move.",
    it: "Metrica direzione 24h — separata dal rendimento € del portafoglio. Cerchio = BUY · ▼ = SELL. Verde ✓ = direzione giusta; rosso ✗ = sbagliata. X = P(plan); Y = errore stima vs Var. 24h.",
  },
  "testerMonitor.decisionSim.adviceCalib.complementNote": {
    en: "Complementary KPIs: capture = realized paper P&L vs potential 24h on recs; closed = round-trip win rate; book return = total P&L ÷ deployed capital.",
    it: "KPI complementari: capture = P&L paper vs potenziale 24h sulle rec; chiuso = win rate round-trip; rendimento book = P&L totale ÷ capitale impiegato.",
  },
  "testerMonitor.decisionSim.adviceCalib.xAxis": {
    en: "P(plan) at advice time",
    it: "P(plan) al consiglio",
  },
  "testerMonitor.decisionSim.adviceCalib.yAxis": {
    en: "Forecast error %",
    it: "Errore previsione %",
  },
  "testerMonitor.decisionSim.adviceCalib.scopeLive": {
    en: "Current table",
    it: "Tabella attuale",
  },
  "testerMonitor.decisionSim.adviceCalib.scopeExperiment": {
    en: "Experiment log",
    it: "Log esperimento",
  },
  "testerMonitor.decisionSim.adviceCalib.scopeCombined": {
    en: "Combined",
    it: "Combinato",
  },
  "testerMonitor.decisionSim.adviceCalib.lowProbBand": {
    en: "P(plan) ≤59%: {n} scored · {good}✓ / {bad}✗ · success {rate}",
    it: "P(plan) ≤59%: {n} valutati · {good}✓ / {bad}✗ · successo {rate}",
  },
  "testerMonitor.decisionSim.adviceCalib.highProbBand": {
    en: "P(plan) ≥70%: {n} scored · {good}✓ / {bad}✗ · success {rate}",
    it: "P(plan) ≥70%: {n} valutati · {good}✓ / {bad}✗ · successo {rate}",
  },
  "testerMonitor.decisionSim.adviceCalib.pending": {
    en: "{n} in neutral zone (excluded from chart)",
    it: "{n} in zona neutra — esclusi dal grafico",
  },
  "testerMonitor.decisionSim.adviceCalib.smallSampleNote": {
    en: "Summary chips use advice outcome (✓/✗); chart dots need a plan target to compute forecast error.",
    it: "I chip riassuntivi usano l'esito consiglio (✓/✗); i punti richiedono un target piano per calcolare l'errore.",
  },
  "testerMonitor.decisionSim.adviceCalib.empty": {
    en: "No scored advice yet (need a clear stock move vs BUY / SELL / HOLD).",
    it: "Nessun consiglio valutato ancora (serve un movimento chiaro vs BUY / SELL / HOLD).",
  },
  "testerMonitor.decisionSim.adviceCalib.lowProbList": {
    en: "Low P(plan) advice scored ({n})",
    it: "Consigli a bassa P(plan) valutati ({n})",
  },
  "testerMonitor.decisionSim.adviceCalib.badAdviceList": {
    en: "Bad advice ✗ — what went wrong ({n})",
    it: "Consigli errati ✗ — cosa è andato storto ({n})",
  },
  "testerMonitor.decisionSim.paperPortfolio": {
    en: "Paper portfolio (follows advice)",
    it: "Portfolio paper (segue i consigli)",
  },
  "testerMonitor.decisionSim.paperPortfolioEmpty": {
    en: "No paper positions yet. Each tick follows every BUY/SELL recommendation (portfolio + opportunities). 💼 marks tickers also in your real Simulation portfolio. Misalignment % does not block trades.",
    it: "Nessuna posizione paper. Ogni tick segue tutte le raccomandazioni BUY/SELL (portafoglio + opportunità). 💼 = titolo anche nel portafoglio Simulation reale. La % disallineamento non blocca i trade.",
  },
  "testerMonitor.decisionSim.kpi.buySignals": {
    en: "Buy signals",
    it: "Segnali buy",
  },
  "testerMonitor.decisionSim.kpi.buySignalsSub": {
    en: "last tick · not blocked by misalign",
    it: "ultimo tick · il disallineamento non blocca",
  },
  "testerMonitor.decisionSim.buyRulesHint": {
    en: "Table below = active recommendations ({n} rows), not position count. 💼 = real portfolio · green = paper sim followed · amber = BUY missed. Paper experiment max 8 slots (see KPI above).",
    it: "La tabella sotto = raccomandazioni attive ({n} righe), non conteggio posizioni. 💼 = portafoglio reale · verde = sim paper ha seguito · ambra = BUY perso. Esperimento paper max 8 slot (vedi KPI sopra).",
  },
  "testerMonitor.decisionSim.tickSummary": {
    en: "Tick {time} — {trades} trades this tick · {open} open ({tickers}) · {buy} buy signals · piggy €{piggy} · {missed} missed buys",
    it: "Tick {time} — {trades} trade in questo tick · {open} aperte ({tickers}) · {buy} segnali buy · piggy €{piggy} · {missed} buy persi",
  },
  "testerMonitor.decisionSim.adviceLog": {
    en: "Advice outcomes log",
    it: "Log esiti consigli",
  },
  "testerMonitor.decisionSim.chart.misalignTypes": {
    en: "Misalignment types (live)",
    it: "Tipi disallineamento (live)",
  },
  "testerMonitor.decisionSim.chart.misalignTypesSub": {
    en: "{n} of {total} tickers with a critical flag · recalculated on load",
    it: "{n} su {total} ticker con flag critico · ricalcolato al caricamento",
  },
  "testerMonitor.decisionSim.chart.misalignTypesClear": {
    en: "No misalignment flags on the current universe.",
    it: "Nessun flag disallineamento sull'universo attuale.",
  },
  "testerMonitor.decisionSim.misalignGuide": {
    en: "KPI counts critical misalignments only: Precat vs Top2 and Slope5 sign always; Pred overlay vs slope >1.5 pp; Plan target vs Supernova peak >5 pp; Spot vs model >12%. Row table still shows all flags (Pred >0.5 pp, Plan >2.5 pp, Spot >8%).",
    it: "Il KPI conta solo disallineamenti critici: Precat vs Top2 e segno Slope5 sempre; Pred overlay vs slope >1,5 pp; target Piano vs picco Supernova >5 pp; Spot vs modello >12%. La tabella per riga mostra ancora tutti i flag (Pred >0,5 pp, Piano >2,5 pp, Spot >8%).",
  },
  "testerMonitor.decisionSim.weekTable": {
    en: "Weekly rollup",
    it: "Riepilogo settimanale",
  },
  "testerMonitor.decisionSim.evalTable": {
    en: "Ticker evaluations",
    it: "Valutazioni ticker",
  },
  "testerMonitor.decisionSim.recommendationsTable": {
    en: "Recommendations & paper follow-through",
    it: "Raccomandazioni & follow sim paper",
  },
  "testerMonitor.decisionSim.recommendationsTableSub": {
    en: "{buy} BUY · {sell} SELL · {missed} BUY not followed yet — SELL uses exit signals (slope/target/timing), not P&L sign alone",
    it: "{buy} BUY · {sell} SELL · {missed} BUY non seguiti — il SELL segue segnali exit (pendenza/target/timing), non solo il segno del P&L",
  },
  "testerMonitor.decisionSim.recommendationsEmpty": {
    en: "No rows match this filter.",
    it: "Nessuna riga con questo filtro.",
  },
  "testerMonitor.decisionSim.recommendationsTableCollapse": {
    en: "Collapse recommendations table",
    it: "Comprimi tabella raccomandazioni",
  },
  "testerMonitor.decisionSim.recommendationsTableExpand": {
    en: "Expand recommendations table",
    it: "Espandi tabella raccomandazioni",
  },
  "testerMonitor.decisionSim.filterRecommended": {
    en: "Recommendations",
    it: "Raccomandazioni",
  },
  "testerMonitor.decisionSim.filterAll": {
    en: "All tickers",
    it: "Tutti i ticker",
  },
  "testerMonitor.decisionSim.tickLog": {
    en: "Tick log",
    it: "Log tick",
  },
  "testerMonitor.decisionSim.raWhatIf.toggleOff": {
    en: "Compare RA in sim loop",
    it: "Confronta RA nel sim loop",
  },
  "testerMonitor.decisionSim.raWhatIf.toggleOn": {
    en: "RA what-if · ON",
    it: "What-if RA · ON",
  },
  "testerMonitor.decisionSim.raWhatIf.toggleTip": {
    en: "Replay stored ticks with RA→ in paper logic: BUY only if Top2 buy + RA buy; SELL on Top2 sell or RA reduce. Rebuilds live evaluations per tick (stored ticks omit evaluation rows). Dashed line = current logic.",
    it: "Riproduce i tick salvati con RA→ nella logica paper: BUY solo se Top2 buy + RA buy; SELL su Top2 sell o RA reduce. Ricostruisce le valutazioni live per tick (i tick salvati non includono le righe evaluation). Linea tratteggiata = logica attuale.",
  },
  "testerMonitor.decisionSim.raWhatIf.banner": {
    en: "What-if: RA in the sim loop vs current Top2/P(plan) logic.",
    it: "What-if: RA nel sim loop vs logica attuale Top2/P(plan).",
  },
  "testerMonitor.decisionSim.raWhatIf.stats": {
    en: "Blocked buys {blocked} · trades {trades}/{baselineTrades} · return RA {raReturn} vs baseline {baselineReturn}",
    it: "Buy bloccati {blocked} · trade {trades}/{baselineTrades} · rendimento RA {raReturn} vs baseline {baselineReturn}",
  },
  "testerMonitor.decisionSim.chart.tradesPnlRa": {
    en: "Paper portfolio — RA in loop",
    it: "Portafoglio paper — RA nel loop",
  },
  "testerMonitor.decisionSim.chart.maturationTitleRa": {
    en: "Stock maturation — RA in loop",
    it: "Maturazione titoli — RA nel loop",
  },
  "testerMonitor.decisionSim.adviceCalib.titleRa": {
    en: "P(plan) vs forecast error — RA in loop",
    it: "P(plan) vs errore stima — RA nel loop",
  },
  "testerMonitor.decisionSim.openSuggestionsMonitor": {
    en: "All suggestions & scores",
    it: "Tutti i suggerimenti & score",
  },
  "testerMonitor.suggestionsMonitor.title": {
    en: "Buy / sell suggestion monitor",
    it: "Monitor suggerimenti buy / sell",
  },
  "testerMonitor.suggestionsMonitor.subtitle": {
    en: "Full pipeline for every ticker: Precat → Top2 verdict → P(plan) → exit → sim action, plus RA, Aff, Match, SDS, MII/Calib and curve cross-checks. Expand a row for step-by-step detail.",
    it: "Pipeline completa per ogni ticker: Precat → verdetto Top2 → P(plan) → exit → azione sim, più RA, Aff, Match, SDS, MII/Calib e controlli curva. Espandi la riga per il dettaglio step-by-step.",
  },
  "testerMonitor.suggestionsMonitor.evaluatedAt": {
    en: "Last sim tick",
    it: "Ultimo tick sim",
  },
  "testerMonitor.suggestionsMonitor.live": {
    en: "Live snapshot (current sheet + curves)",
    it: "Snapshot live (foglio + curve attuali)",
  },
  "testerMonitor.suggestionsMonitor.noData": {
    en: "Simulation table not loaded.",
    it: "Tabella Simulation non caricata.",
  },
  "testerMonitor.suggestionsMonitor.noMatch": {
    en: "No tickers match the current filter.",
    it: "Nessun ticker corrisponde al filtro.",
  },
  "testerMonitor.suggestionsMonitor.pipeline": {
    en: "Decision pipeline",
    it: "Pipeline decisionale",
  },
  "testerMonitor.suggestionsMonitor.buyBlock": {
    en: "Why not buy",
    it: "Perché no buy",
  },
  "testerMonitor.suggestionsMonitor.buyGateHint": {
    en: "Only BUY and SELL are recommendations. Buy paths: (1) Top2 yes + exit hold/review or yes+enter+P≥40%; (2) Top2 wait + enter/accumulate + P≥45%; (3) 24h gainer ≥0.5% + P≥45% (momentum override); (4) watch zone accumulate + P≥40%; (5) late CD + 24h gainer + P≥45%.",
    it: "Solo BUY e SELL sono raccomandazioni. Buy: (1) Top2 yes + exit hold/review o yes+enter+P≥40%; (2) Top2 wait + enter/accumulate + P≥45%; (3) gainer 24h ≥0,5% + P≥45% (override momentum); (4) watch accumulate + P≥40%; (5) late CD + gainer 24h + P≥45%.",
  },
  "testerMonitor.suggestionsMonitor.filterRecommended": {
    en: "Recommendations",
    it: "Raccomandazioni",
  },
  "testerMonitor.suggestionsMonitor.filterNotRecommended": {
    en: "No action",
    it: "Non raccom.",
  },
  "testerMonitor.suggestionsMonitor.recentOutcomesTitle": {
    en: "Recent position outcomes (sim tracking)",
    it: "Esiti posizioni recenti (tracking sim)",
  },
  "testerMonitor.suggestionsMonitor.recentOutcomesEmpty": {
    en: "No entries in the last 48h in investment_sim_outcomes.",
    it: "Nessun ingresso nelle ultime 48h in investment_sim_outcomes.",
  },
  "testerMonitor.suggestionsMonitor.recentOutcomesGenerated": {
    en: "Outcomes file",
    it: "File esiti",
  },
  "testerMonitor.suggestionsMonitor.colSignal": {
    en: "Buy signal",
    it: "Segnale buy",
  },
  "testerMonitor.suggestionsMonitor.colPnl": {
    en: "P&L",
    it: "P&L",
  },
  "testerMonitor.suggestionsMonitor.colOutcome": {
    en: "Outcome",
    it: "Esito",
  },
  "sidebar.item.system": {
    en: "System",
    it: "Sistema",
  },

  // ── Top bar ────────────────────────────────────────────────────────────────
  "topbar.reloadJson": {
    en: "Reload JSON",
    it: "Ricarica JSON",
  },
  "topbar.apiOffline": {
    en: "API offline",
    it: "API offline",
  },
  "topbar.dataUpdatedAt": {
    en: "Server snapshot",
    it: "Snapshot server",
  },
  "topbar.dataUpdatedAtTip": {
    en: "Last time the server pipeline wrote Excel/Yahoo prices and JSON snapshots to data/. Page Refresh re-reads these files; it does not download new prices. Use System → Refresh data for a full update.",
    it: "Ultima scrittura di prezzi Excel/Yahoo e snapshot JSON in data/ da job server. Refresh pagina rilegge questi file, non scarica prezzi nuovi. Per aggiornare i dati: Sistema → Refresh data.",
  },
  /** @deprecated use topbar.dataUpdatedAt */
  "topbar.snapshot": {
    en: "Server snapshot",
    it: "Snapshot server",
  },
  "topbar.workbook": {
    en: "wb",
    it: "wb",
  },
  "topbar.pillAll": {
    en: "All",
    it: "Tutti",
  },
  "topbar.pillLong": {
    en: "↑ Long",
    it: "↑ Long",
  },
  "topbar.pillShort": {
    en: "↓ Short",
    it: "↓ Short",
  },
  "topbar.pillHighConf": {
    en: "⭐ High conf.",
    it: "⭐ Alta conf.",
  },

  // ── Refresh controls ───────────────────────────────────────────────────────
  "refresh.btn.reload.tooltip": {
    en: "Quick re-read (~1s): reads the snapshots already present in data/. Use Refresh data if you want fresh prices/curves from Yahoo+Finnhub.",
    it: "Rilettura rapida (~1s): legge gli snapshot già presenti in data/. Usa Aggiorna dati se vuoi prezzi/curve freschi da Yahoo+Finnhub.",
  },
  "refresh.sim.reload.tooltip": {
    en: "Scan CT.gov for new biotech with CD within 4 months, regenerate Simulation (~2–8 min), then reload snapshots.",
    it: "Scan CT.gov per nuove biotech con CD entro 4 mesi, rigenera Simulation (~2–8 min), poi ricarica gli snapshot.",
  },
  "refresh.sim.cdScan.running": {
    en: "CD scan…",
    it: "Scan CD…",
  },
  "refresh.sim.cdScan.reloadJson": {
    en: "Reloading snapshots…",
    it: "Ricarica snapshot…",
  },
  "refresh.btn.refreshData.tooltip": {
    en: "Daily refresh (~8–18 min): Simulation + prices/curves (Yahoo). Skips Accuracy on weekdays; UI reloads as soon as Excel finishes (no duplicate export, KPI cohort in background). Sunday = full orchestrator.",
    it: "Refresh giornaliero (~8–18 min): Simulation + prezzi/curve (Yahoo). In feriale salta Accuracy; la UI si aggiorna appena finisce Excel (niente export doppio, KPI cohort in background). Domenica = orchestrator completo.",
  },
  "refresh.btn.refreshData.offline": {
    en: "API offline (port 8765) — start SuperNova desktop / Avvia_UI.bat, then run Refresh data. Reload still reads local snapshots in data/.",
    it: "API offline (porta 8765) — avvia SuperNova desktop / Avvia_UI.bat, poi Refresh data. Reload legge comunque gli snapshot locali in data/.",
  },
  "refresh.modal.apiOffline.title": {
    en: "SuperNova API is offline",
    it: "API SuperNova offline",
  },
  "refresh.modal.apiOffline.body": {
    en: "Refresh data needs the Python server on port 8765 (Excel + Yahoo prices). Restart Avvia_Biotech_Desktop.bat or desktop-ui/Avvia_UI.bat, wait until the top bar no longer shows «API offline», then press Start refresh.",
    it: "Refresh data richiede il server Python sulla porta 8765 (Excel + prezzi Yahoo). Riavvia Avvia_Biotech_Desktop.bat o desktop-ui/Avvia_UI.bat, attendi che in alto sparisca «API offline», poi premi Start refresh.",
  },
  "refresh.modal.apiOffline.reloadHint": {
    en: "Reload (without Refresh data) only re-reads JSON snapshots already in data/ — P&L prices will not update until a full refresh succeeds.",
    it: "Reload (senza Refresh data) rilegge solo gli snapshot JSON già in data/ — i prezzi P&L non si aggiornano finché un refresh completo non va a buon fine.",
  },
  "sundayRefresh.popup.titleOk": {
    en: "Sunday full refresh completed",
    it: "Refresh domenica full completato",
  },
  "sundayRefresh.popup.titleErr": {
    en: "Sunday full refresh ended with errors",
    it: "Refresh domenica full terminato con errori",
  },
  "sundayRefresh.popup.subtitle": {
    en: "Weekly orchestrator (Simulation + SEC 8-K + full data)",
    it: "Orchestrator settimanale (Simulation + SEC 8-K + dati completi)",
  },
  "sundayRefresh.popup.elapsed": {
    en: "Total time:",
    it: "Tempo totale:",
  },
  "sundayRefresh.popup.okDefault": {
    en: "Pipeline finished successfully. UI snapshots were regenerated.",
    it: "Pipeline completata con successo. Snapshot UI rigenerati.",
  },
  "sundayRefresh.popup.errDefault": {
    en: "Check the log in the refresh panel or data/last_orchestrator_log.txt",
    it: "Controlla il log nel pannello refresh o data/last_orchestrator_log.txt",
  },
  "sundayRefresh.badge.running": {
    en: "Sunday full",
    it: "Domenica full",
  },
  "sundayRefresh.modal.title": {
    en: "Sunday full refresh",
    it: "Refresh domenica full",
  },
  "sundayRefresh.modal.eta": {
    en: "ETA ~30–90+ min · close Excel on the data workbook first",
    it: "ETA ~30–90+ min · chiudi Excel sul workbook dati prima",
  },
  "sundayRefresh.autostart.msg": {
    en: "Saturday morning — starting scheduled weekly orchestrator…",
    it: "Sabato mattina — avvio orchestrator settimanale programmato…",
  },

  "clinicalFeed.apiKeys.title": {
    en: "API keys (Claude / optional OpenAI · GitHub)",
    it: "Chiavi API (Claude / opz. OpenAI · GitHub)",
  },
  "clinicalFeed.apiKeys.notSet": {
    en: "Claude not set",
    it: "Claude non configurata",
  },
  "clinicalFeed.apiKeys.hint": {
    en: "Keys are saved on the API server (data/ai_secrets.json) — no restart needed. For Copilot: fine-grained PAT with Models → Read, or classic PAT with scope models.",
    it: "Le chiavi si salvano sul server API (data/ai_secrets.json) — niente restart. Per Copilot: PAT fine-grained con Models → Read, oppure PAT classic con scope models.",
  },
  "clinicalFeed.apiKeys.copilotNotSet": {
    en: "Copilot not set",
    it: "Copilot non configurato",
  },
  "clinicalFeed.apiKeys.githubLabel": {
    en: "GitHub PAT (Copilot / Models)",
    it: "GitHub PAT (Copilot / Models)",
  },
  "clinicalFeed.apiKeys.githubHint": {
    en: "github.com → Settings → Developer settings → Personal access tokens. Requires active GitHub Copilot subscription.",
    it: "github.com → Settings → Developer settings → Personal access tokens. Richiede abbonamento GitHub Copilot attivo.",
  },
  "clinicalFeed.apiKeys.anthropicLabel": {
    en: "Anthropic API key (Claude)",
    it: "Chiave API Anthropic (Claude)",
  },
  "clinicalFeed.apiKeys.moreProviders": {
    en: "Other providers (optional)",
    it: "Altri provider (opzionale)",
  },
  "clinicalFeed.apiKeys.save": {
    en: "Save keys",
    it: "Salva chiavi",
  },
  "clinicalFeed.apiKeys.test": {
    en: "Test API",
    it: "Test API",
  },
  "clinicalFeed.apiKeys.clearClaude": {
    en: "Remove Claude key",
    it: "Rimuovi chiave Claude",
  },
  "clinicalFeed.apiKeys.billing": {
    en: "Anthropic credits",
    it: "Crediti Anthropic",
  },
  "clinicalFeed.apiKeys.prepaidLabel": {
    en: "Credits loaded (€) — remaining balance updates as you use Claude",
    it: "Crediti caricati (€) — il saldo si aggiorna man mano che usi Claude",
  },
  "clinicalFeed.apiKeys.orgIdLabel": {
    en: "Anthropic org ID (optional — for live balance from console)",
    it: "Org ID Anthropic (opzionale — saldo live da console)",
  },
  "clinicalFeed.apiKeys.orgIdHint": {
    en: "Settings → Organization → ID at the bottom of the page.",
    it: "Impostazioni → Organization → ID in fondo alla pagina.",
  },
  "clinicalFeed.apiKeys.balanceLive": {
    en: "Balance: €{eur} (live from Anthropic)",
    it: "Saldo: €{eur} (live da Anthropic)",
  },
  "clinicalFeed.apiKeys.balanceEstimated": {
    en: "Balance: €{eur} (€{prepaid} loaded − €{spent} used since top-up)",
    it: "Saldo: €{eur} (€{prepaid} caricati − €{spent} usati dal top-up)",
  },
  "clinicalFeed.apiKeys.balanceUnset": {
    en: "Enter credits loaded (€) below to track your balance.",
    it: "Inserisci i crediti caricati (€) sotto per tracciare il saldo.",
  },
  "clinicalFeed.provider.balanceLine": {
    en: "Balance €{eur}",
    it: "Saldo €{eur}",
  },
  "clinicalFeed.provider.usageSpend": {
    en: "{calls} calls · {spent} used (30d est.)",
    it: "{calls} chiamate · {spent} usati (30 gg stim.)",
  },

  "accuracyGuide.btn": {
    en: "Explain metrics",
    it: "Spiega metriche",
  },
  "accuracyGuide.title": {
    en: "Accuracy & KPI metrics — guide",
    it: "Guida metriche accuratezza e KPI",
  },
  "accuracyGuide.intro": {
    en: "Definitions for the directional calibration tables and KPI scoring panel in Predictive diagnostics. Green values ≈ real edge; red ≈ noise or weak calibration.",
    it: "Definizioni per le tabelle di calibrazione direzionale e il pannello KPI in Diagnostica predittiva. Valori verdi ≈ edge reale; rossi ≈ rumore o calibrazione debole.",
  },
  "accuracyGuide.section.kpi.title": {
    en: "1 · Three headline KPIs (Raw / Useful / Strong)",
    it: "1 · Tre KPI principali (Raw / Useful / Strong)",
  },
  "accuracyGuide.section.kpi.intro": {
    en: "All three measure whether the predicted curve direction (↑/↓) matched the realized move on past catalysts. They differ only by which observations are counted.",
    it: "I tre misurano se la direzione prevista dalla curva (↑/↓) coincide con il movimento realizzato sui catalyst passati. Cambiano solo il filtro sulle osservazioni incluse.",
  },
  "accuracyGuide.kpi.raw.term": {
    en: "Raw — all signals",
    it: "Raw — tutti i segnali",
  },
  "accuracyGuide.kpi.raw.body": {
    en: "Hit% on every directional prediction with reliability > 0. Includes flat or tiny moves (|Δ| < ~1%) where direction is hard to judge — often dilutes accuracy toward ~50%. Use for auditing only, not for trading decisions.",
    it: "Hit% su ogni previsione direzionale con affidabilità > 0. Include movimenti piatti o minimi (|Δ| < ~1%) dove la direzione è difficile da valutare — spesso trascina l’accuratezza verso ~50%. Solo audit, non per decisioni operative.",
  },
  "accuracyGuide.kpi.useful.term": {
    en: "Useful — non-noise zone",
    it: "Useful — zona non-rumore",
  },
  "accuracyGuide.kpi.useful.body": {
    en: "Same metric after filtering: reliability ≥ 50 (typ.) and |realized move| ≥ 2%. Excludes “noise zone” observations. Aligns with Decision Lab Top Opportunities (reliability + Pred ±5). This is the primary KPI for signal quality.",
    it: "Stessa metrica dopo filtro: affidabilità ≥ 50 (tip.) e |movimento realizzato| ≥ 2%. Esclude osservazioni in “zona rumore”. Allineato alle Top Opportunities del Decision Lab (affidabilità + Pred ±5). È il KPI principale per la qualità del segnale.",
  },
  "accuracyGuide.kpi.strong.term": {
    en: "Strong signal — high conviction",
    it: "Strong — alta convinzione",
  },
  "accuracyGuide.kpi.strong.body": {
    en: "Stricter filter: same reliability floor but |realized move| ≥ 3%. Fewer samples (N smaller) but shows edge on moves large enough to matter for P&L.",
    it: "Filtro più stretto: stessa soglia di affidabilità ma |movimento realizzato| ≥ 3%. Meno campioni (N più piccolo) ma mostra l’edge su movimenti rilevanti per il P&L.",
  },
  "accuracyGuide.kpi.edge.term": {
    en: "Color thresholds (edge labels)",
    it: "Soglie colore (etichette edge)",
  },
  "accuracyGuide.kpi.edge.body": {
    en: "≥65% solid edge · 58–64% moderate · 52–57% marginal · <52% no edge. Applied to Useful/Strong Hit% and to Acc. ↑/↓ in the confidence table.",
    it: "≥65% edge solido · 58–64% moderato · 52–57% marginale · <52% nessun edge. Applicato a Hit% Useful/Strong e ad Acc. ↑/↓ nella tabella per fascia di confidence.",
  },
  "accuracyGuide.kpi.noise.term": {
    en: "Noise zone (footnote)",
    it: "Zona rumore (nota)",
  },
  "accuracyGuide.kpi.noise.body": {
    en: "Observations with |Δ| below ~1%: hit rate is near random. Automatically excluded from Useful and Strong counts.",
    it: "Osservazioni con |Δ| sotto ~1%: hit rate quasi casuale. Escluse automaticamente dai conteggi Useful e Strong.",
  },
  "accuracyGuide.section.horizon.title": {
    en: "2 · Breakdown by prediction horizon (matched)",
    it: "2 · Breakdown per orizzonte (matched)",
  },
  "accuracyGuide.section.horizon.intro": {
    en: "Splits Useful/Raw accuracy by how many trading days after the catalyst (CD) the prediction was evaluated. “Matched” means pred and actual are paired on the same horizon (T+1, T+3, T+5).",
    it: "Suddivide accuratezza Useful/Raw per quanti giorni di borsa dopo il catalyst (CD) è stata valutata la previsione. “Matched” = predizione e realizzato accoppiati sullo stesso orizzonte (T+1, T+3, T+5).",
  },
  "accuracyGuide.horizon.horizon.term": {
    en: "Horizon (T+1 / T+3 / T+5)",
    it: "Orizzonte (T+1 / T+3 / T+5)",
  },
  "accuracyGuide.horizon.horizon.body": {
    en: "T+N = price change measured N sessions after CD vs the curve direction at prediction time. Short horizons react faster; T+5 smooths one-off spikes.",
    it: "T+N = variazione prezzo a N sedute dal CD rispetto alla direzione della curva al momento della previsione. Orizzonti corti reagiscono prima; T+5 attenua spike isolati.",
  },
  "accuracyGuide.horizon.nRaw.term": {
    en: "N raw",
    it: "N raw",
  },
  "accuracyGuide.horizon.nRaw.body": {
    en: "Number of matched directional evaluations in the unfiltered population for that horizon.",
    it: "Numero di valutazioni direzionali accoppiate nella popolazione non filtrata per quell’orizzonte.",
  },
  "accuracyGuide.horizon.hitRaw.term": {
    en: "Hit% raw",
    it: "Hit% raw",
  },
  "accuracyGuide.horizon.hitRaw.body": {
    en: "% correct direction on N raw. Shown muted — compare mainly to Hit% useful.",
    it: "% direzione corretta su N raw. Mostrato attenuato — confronta soprattutto con Hit% useful.",
  },
  "accuracyGuide.horizon.nUseful.term": {
    en: "N useful",
    it: "N useful",
  },
  "accuracyGuide.horizon.nUseful.body": {
    en: "Count after Useful filters (reliability + minimum |Δ|). Smaller than N raw; this is the sample that matters for signals.",
    it: "Conteggio dopo i filtri Useful (affidabilità + |Δ| minimo). Minore di N raw; è il campione rilevante per i segnali.",
  },
  "accuracyGuide.horizon.hitUseful.term": {
    en: "Hit% useful (highlighted)",
    it: "Hit% useful (in evidenza)",
  },
  "accuracyGuide.horizon.hitUseful.body": {
    en: "Directional accuracy on the useful subset for this horizon. Green if ≥60%, amber 52–59%, red <52%. Best column for comparing T+1 vs T+5 edge.",
    it: "Accuratezza direzionale sul sottoinsieme useful per questo orizzonte. Verde se ≥60%, ambra 52–59%, rosso <52%. Colonna migliore per confrontare edge T+1 vs T+5.",
  },
  "accuracyGuide.section.aff.title": {
    en: "3 · Accuracy by confidence band",
    it: "3 · Accuratezza per fascia di confidence",
  },
  "accuracyGuide.section.aff.intro": {
    en: "Maps the model’s Confidence score (0–95, same scale as Decision Lab) to historical hit rates on past signals. Use to set Expected Hit% sliders and filter weak bands.",
    it: "Collega il punteggio Confidence del modello (0–95, stessa scala del Decision Lab) all’hit rate storico sui segnali passati. Serve per Expected Hit% e per escludere fasce deboli.",
  },
  "accuracyGuide.aff.confidence.term": {
    en: "Confidence (band)",
    it: "Confidence (fascia)",
  },
  "accuracyGuide.aff.confidence.body": {
    en: "Range of the reliability/confidence field at signal time (e.g. 65–79). Higher bands should show higher Acc. ↑/↓ if calibration is healthy.",
    it: "Intervallo del campo affidabilità/confidence al momento del segnale (es. 65–79). Fasce più alte dovrebbero avere Acc. ↑/↓ più alta se la calibrazione è sana.",
  },
  "accuracyGuide.aff.nTotal.term": {
    en: "N total",
    it: "N total",
  },
  "accuracyGuide.aff.nTotal.body": {
    en: "All archived signals in that band (directional + flat/neutral outcomes).",
    it: "Tutti i segnali archiviati in quella fascia (esiti direzionali + flat/neutri).",
  },
  "accuracyGuide.aff.nDir.term": {
    en: "N dir.",
    it: "N dir.",
  },
  "accuracyGuide.aff.nDir.body": {
    en: "Subset where the model issued a clear up/down call (excludes “flat” predictions).",
    it: "Sottoinsieme in cui il modello ha emesso un chiaro up/down (esclude previsioni “flat”).",
  },
  "accuracyGuide.aff.accDir.term": {
    en: "Acc. ↑/↓ (dir. signals)",
    it: "Acc. ↑/↓ (segnali dir.)",
  },
  "accuracyGuide.aff.accDir.body": {
    en: "Primary column: % of directional signals where realized move matched predicted curve direction. This is what you want ≥55–60% in bands you trade.",
    it: "Colonna principale: % di segnali direzionali dove il movimento realizzato coincide con la direzione prevista dalla curva. Obiettivo ≥55–60% nelle fasce che usi operativamente.",
  },
  "accuracyGuide.aff.hitGlob.term": {
    en: "Hit% glob. (incl. flat)",
    it: "Hit% glob. (incl. flat)",
  },
  "accuracyGuide.aff.hitGlob.body": {
    en: "Includes flat/neutral outcomes (±5% rule). Often higher or misleading vs Acc. ↑/↓ — secondary, for completeness only.",
    it: "Include esiti flat/neutri (regola ±5%). Spesso più alto o fuorviante rispetto ad Acc. ↑/↓ — secondario, solo per completezza.",
  },
  "accuracyGuide.aff.decisionLab.term": {
    en: "How to use in Decision Lab",
    it: "Uso nel Decision Lab",
  },
  "accuracyGuide.aff.decisionLab.body": {
    en: "If Acc. ↑/↓ in your signal’s band is <52%, treat Expected Hit% conservatively or skip. Bands ≥65–79 with Acc. ↑/↓ ≥60% support aggressive sizing.",
    it: "Se Acc. ↑/↓ nella fascia del tuo segnale è <52%, usa Expected Hit% con prudenza o salta. Fasce ≥65–79 con Acc. ↑/↓ ≥60% supportano sizing più aggressivo.",
  },
  "accuracyGuide.section.kpiSignal.title": {
    en: "4 · KPI indicator scoring — impact analysis",
    it: "4 · KPI indicator scoring — analisi impatto",
  },
  "accuracyGuide.section.kpiSignal.intro": {
    en: "After clinical enrichment (“Arricchisci clinico”), each CD record has KPI indicators (efficacy, safety, p-value, data maturity…). Their scores shift the prediction curve in probability points (pp). This panel compares the legacy scorer vs the upgraded one.",
    it: "Dopo l’arricchimento clinico, ogni record CD ha indicatori KPI (efficacia, safety, p-value, maturità dati…). I punteggi spostano la curva predittiva in punti percentuali (pp). Il pannello confronta lo scorer legacy con quello aggiornato.",
  },
  "accuracyGuide.kpiSig.enriched.term": {
    en: "Enriched records",
    it: "Enriched records",
  },
  "accuracyGuide.kpiSig.enriched.body": {
    en: "Ticker–CD rows present in clinical_pre_cd_enrichment_snapshot.json with at least one indicator parsed.",
    it: "Righe ticker–CD in clinical_pre_cd_enrichment_snapshot.json con almeno un indicatore parsato.",
  },
  "accuracyGuide.kpiSig.rich.term": {
    en: "Rich KPI records",
    it: "Rich KPI records",
  },
  "accuracyGuide.kpiSig.rich.body": {
    en: "Records where at least one indicator has p-value and/or data_maturity — required for the full new scoring path.",
    it: "Record con almeno un indicatore con p-value e/o data_maturity — necessari per il percorso di scoring nuovo completo.",
  },
  "accuracyGuide.kpiSig.coverage.term": {
    en: "p-value coverage",
    it: "p-value coverage",
  },
  "accuracyGuide.kpiSig.coverage.body": {
    en: "Share of indicators (across all records) with a parseable p-value. Low % means clinical text lacks stats — new scorer adds less lift.",
    it: "Quota di indicatori (su tutti i record) con p-value leggibile. % bassa = testo clinico povero di statistiche — il nuovo scorer aggiunge poco.",
  },
  "accuracyGuide.kpiSig.meanShift.term": {
    en: "Mean KPI shift",
    it: "Mean KPI shift",
  },
  "accuracyGuide.kpiSig.meanShift.body": {
    en: "Average curve shift in pp from aggregating indicator scores (old vs new formula). Subtitle shows old mean, new mean, and mean delta across records.",
    it: "Spostamento medio della curva in pp dall’aggregazione degli score indicatori (formula vecchia vs nuova). Il sottotitolo mostra media vecchia, nuova e delta medio sui record.",
  },
  "accuracyGuide.kpiSig.dist.term": {
    en: "Shift distribution bar",
    it: "Barra distribuzione shift",
  },
  "accuracyGuide.kpiSig.dist.body": {
    en: "Per record: delta = shift_new − shift_old. Green = improved >+0.05 pp · grey = unchanged · red = worsened <−0.05 pp.",
    it: "Per record: delta = shift_new − shift_old. Verde = migliorato >+0,05 pp · grigio = invariato · rosso = peggiorato <−0,05 pp.",
  },
  "accuracyGuide.kpiSig.shiftOld.term": {
    en: "Shift old (table)",
    it: "Shift old (tabella)",
  },
  "accuracyGuide.kpiSig.shiftOld.body": {
    en: "Legacy _indicator_unit_score: endpoint met + direction + basic numeric ORR/PFS hints. No p-value weighting.",
    it: "Legacy _indicator_unit_score: endpoint met + direction + hint numerici ORR/PFS base. Senza peso p-value.",
  },
  "accuracyGuide.kpiSig.shiftNew.term": {
    en: "Shift new (table)",
    it: "Shift new (tabella)",
  },
  "accuracyGuide.kpiSig.shiftNew.body": {
    en: "Upgraded score: adds p-value tiers, data_maturity bonus, vs_soc / CI, KPI type weights (efficacy > enrollment). Capped and time-decayed when applied to the curve.",
    it: "Score aggiornato: aggiunge fasce p-value, bonus data_maturity, vs_soc / CI, pesi per tipo KPI (efficacy > enrollment). Limitato e decaduto nel tempo sulla curva.",
  },
  "accuracyGuide.kpiSig.delta.term": {
    en: "Delta (table)",
    it: "Delta (tabella)",
  },
  "accuracyGuide.kpiSig.delta.body": {
    en: "shift_new − shift_old for that ticker/CD. Positive = new clinical scoring would push the curve more bullish (or less bearish) vs before.",
    it: "shift_new − shift_old per quel ticker/CD. Positivo = il nuovo scoring clinico spingerebbe la curva più rialzista (o meno ribassista) rispetto a prima.",
  },
  "accuracyGuide.kpiSig.pvals.term": {
    en: "p-vals (per row)",
    it: "p-vals (per riga)",
  },
  "accuracyGuide.kpiSig.pvals.body": {
    en: "Count of indicators on that CD with a parsed p-value. 0 = row uses mostly legacy-only logic.",
    it: "Numero di indicatori su quel CD con p-value parsato. 0 = riga che usa soprattutto logica legacy.",
  },
  "accuracyGuide.kpiSig.maturity.term": {
    en: "Maturity (per row)",
    it: "Maturity (per riga)",
  },
  "accuracyGuide.kpiSig.maturity.body": {
    en: "Indicators with data_maturity (final / primary / interim). Feeds the new scorer’s maturity bonus.",
    it: "Indicatori con data_maturity (final / primary / interim). Alimenta il bonus maturità del nuovo scorer.",
  },
  "accuracyGuide.kpiSig.cd.term": {
    en: "CD past / fut",
    it: "CD past / fut",
  },
  "accuracyGuide.kpiSig.cd.body": {
    en: "past = catalyst date already passed (outcome known); fut = upcoming CD — shift is forward-looking for the curve only.",
    it: "past = data catalyst già passata (esito noto); fut = CD futuro — lo shift è prospettico sulla curva.",
  },

  // ── Notification bell ──────────────────────────────────────────────────────
  "bell.title.unread": {
    en: "{n} new signals",
    it: "{n} nuovi segnali",
  },
  "bell.title.idle": {
    en: "Signal notifications",
    it: "Notifiche segnali",
  },
  "bell.header.title": {
    en: "Signal notifications",
    it: "Notifiche segnali",
  },
  "bell.header.noSignals": {
    en: "No active signals",
    it: "Nessun segnale attivo",
  },
  "bell.header.summarySingular": {
    en: "{n} signal · auto-updated",
    it: "{n} segnale · aggiornati automaticamente",
  },
  "bell.header.summaryPlural": {
    en: "{n} signals · auto-updated",
    it: "{n} segnali · aggiornati automaticamente",
  },
  "bell.btn.clearAll": {
    en: "Clear all",
    it: "Cancella tutti",
  },
  "bell.empty.title": {
    en: "No active signals",
    it: "Nessun segnale attivo",
  },
  "bell.empty.body": {
    en: "Notifications appear when the model detects investment opportunities or exit signals. Data is checked every 5 minutes.",
    it: "Le notifiche appaiono quando il modello rileva opportunità d'investimento o segnali d'uscita. I dati vengono verificati ogni 5 minuti.",
  },
  "bell.btn.dismiss": {
    en: "Dismiss",
    it: "Rimuovi",
  },
  "bell.footer.native": {
    en: "🔔 Native notifications enabled · the same alerts also appear as system popups",
    it: "🔔 Notifiche native attive · le stesse alert appaiono anche come popup di sistema",
  },
  "bell.kind.forte": {
    en: "Invest now",
    it: "Investi ora",
  },
  "bell.kind.watch": {
    en: "Watch long",
    it: "Watch long",
  },
  "bell.kind.short": {
    en: "Watch short",
    it: "Watch short",
  },
  "bell.kind.exit": {
    en: "Consider exit",
    it: "Valuta uscita",
  },
  "bell.kind.stop": {
    en: "Stop loss",
    it: "Stop loss",
  },
  "bell.kind.slopeDec": {
    en: "Slope declining",
    it: "Pendenza in calo",
  },
  "bell.kind.slopeRev": {
    en: "Slope reversal",
    it: "Inversione pendenza",
  },
  "bell.cd.inDays": {
    en: " · in {n} {unit}",
    it: " · tra {n} {unit}",
  },
  "bell.cd.past": {
    en: " · past",
    it: " · passata",
  },

  // ── System / Settings ──────────────────────────────────────────────────────
  "system.header.title": {
    en: "System",
    it: "Sistema",
  },
  "system.header.subtitle": {
    en: "Data refresh, orchestrator and app settings",
    it: "Refresh dati, orchestrator e impostazioni app",
  },
  "system.tab.refresh": {
    en: "Refresh",
    it: "Aggiornamento",
  },
  "system.tab.settings": {
    en: "Settings",
    it: "Impostazioni",
  },
  "system.tab.coherence": {
    en: "Cross-tab",
    it: "Coerenza tab",
  },
  "system.tab.about": {
    en: "About",
    it: "Info",
  },
  "system.ownership.title": {
    en: "💼 Ownership and Disclaimer",
    it: "💼 Proprietà e disclaimer",
  },
  "system.ownership.conceptLabel": {
    en: "Concept and Development:",
    it: "Concept e sviluppo:",
  },
  "system.ownership.author": {
    en: "Tiziana Rossetti",
    it: "Tiziana Rossetti",
  },
  "system.ownership.descriptionLabel": {
    en: "Description:",
    it: "Descrizione:",
  },
  "system.ownership.description": {
    en: "Financial tool designed to support investment decision-making.",
    it: "Strumento finanziario per supportare le decisioni di investimento.",
  },
  "system.ownership.noticeLabel": {
    en: "Notice:",
    it: "Avviso:",
  },
  "system.ownership.notice": {
    en: "The use of this application implies full awareness that all analyses, outputs, and recommendations are subject to error and interpretation.",
    it: "L'uso di questa applicazione implica piena consapevolezza che analisi, output e raccomandazioni sono soggetti a errore e interpretazione.",
  },
  "system.ownership.responsibilityLabel": {
    en: "Responsibility:",
    it: "Responsabilità:",
  },
  "system.ownership.responsibility": {
    en: "All decisions and outcomes resulting from the use of this tool are entirely the user's responsibility.",
    it: "Tutte le decisioni e gli esiti derivanti dall'uso di questo strumento sono interamente responsabilità dell'utente.",
  },
  "marketGate.pill.riskOn": {
    en: "Sector: risk-on",
    it: "Settore: risk-on",
  },
  "marketGate.pill.neutral": {
    en: "Sector: neutral",
    it: "Settore: neutro",
  },
  "marketGate.pill.riskOff": {
    en: "Sector: risk-off — entries paused",
    it: "Settore: risk-off — ingressi in pausa",
  },
  "marketGate.pill.crisis": {
    en: "Sector: CRISIS — all signals suspended",
    it: "Settore: CRISIS — segnali sospesi",
  },
  "marketGate.pill.bypass": {
    en: "gate bypassed",
    it: "gate disattivato",
  },
  "settings.marketGate.title": {
    en: "Market context gate",
    it: "Gate contesto di mercato",
  },
  "settings.marketGate.hint": {
    en: "When XBI/TLT/VIX indicate sector risk-off or crisis, entry signals are paused. Enable bypass to force entries anyway (manual override).",
    it: "Con risk-off o crisi settore (XBI/TLT/VIX), gli ingressi sono in pausa. Attiva bypass per forzare gli ingressi (override manuale).",
  },
  "settings.marketGate.bypass": {
    en: "Bypass sector gate (allow entries during risk-off)",
    it: "Bypass gate settore (consenti ingressi in risk-off)",
  },
  "sim.solidity.badge.blocked": {
    en: "Entry risky — criteria not met",
    it: "Ingresso rischioso — criteri non soddisfatti",
  },
  "sim.solidity.badge.caution": {
    en: "Weak RAscore — review before entry",
    it: "RAscore debole — verifica prima dell'ingresso",
  },
  "sim.solidity.reason.macro_gate_hold": {
    en: "Sector gate: entries paused (risk-off)",
    it: "Gate settore: ingressi in pausa (risk-off)",
  },
  "sim.solidity.reason.macro_gate_avoid": {
    en: "Sector gate: crisis — signals suspended",
    it: "Gate settore: crisi — segnali sospesi",
  },
  "sim.solidity.reason.precat_hold": {
    en: "Pre-CD signal: hold",
    it: "Segnale pre-CD: hold",
  },
  "sim.solidity.reason.precat_avoid": {
    en: "Pre-CD signal: do not enter",
    it: "Segnale pre-CD: non entrare",
  },
  "sim.solidity.reason.align_contrarian": {
    en: "Direction misaligned (Score Align)",
    it: "Direzione non allineata (Score Align)",
  },
  "sim.solidity.reason.precat_sell": {
    en: "Pre-CD signal: sell",
    it: "Segnale pre-CD: vendi",
  },
  "sim.solidity.reason.precat_late": {
    en: "Pre-CD signal: too late",
    it: "Segnale pre-CD: troppo tardi",
  },
  "sim.solidity.reason.precat_too_early": {
    en: "Pre-CD signal: too early",
    it: "Segnale pre-CD: troppo presto",
  },
  "sim.solidity.reason.timing_binary": {
    en: "Entry timing: binary zone — too close to CD",
    it: "Timing ingresso: zona binaria — troppo vicino al CD",
  },
  "sim.solidity.reason.timing_pre_peak": {
    en: "Entry timing: pre-peak window (wait for T−11…T−3)",
    it: "Timing ingresso: pre-picco (attendi T−11…T−3)",
  },
  "sim.solidity.reason.timing_beyond_hot": {
    en: "Entry timing: beyond 2 months — monitor only",
    it: "Timing ingresso: oltre 2 mesi — solo monitor",
  },
  "sim.solidity.reason.precat_other": {
    en: "Pre-CD signal not eligible for strict pick",
    it: "Segnale pre-CD non idoneo al pick strict",
  },
  "sim.solidity.reason.no_target_roi": {
    en: "No positive target ROI",
    it: "Nessun ROI target positivo",
  },
  "sim.solidity.reason.low_pred5": {
    en: "Pred +5d below threshold",
    it: "Pred +5g sotto soglia",
  },
  "sim.solidity.reason.low_score_reliability": {
    en: "Score Reliability below minimum",
    it: "Score Reliability sotto il minimo",
  },
  "sim.solidity.reason.low_affid": {
    en: "Reliability below minimum",
    it: "Affidabilità sotto il minimo",
  },
  "sim.solidity.reason.stability_exit": {
    en: "Slope stability: exit",
    it: "Stabilità pendenza: exit",
  },
  "sim.solidity.reason.stability_avoid": {
    en: "Slope stability: avoid",
    it: "Stabilità pendenza: avoid",
  },
  "sim.solidity.reason.stability_watch": {
    en: "Slope stability: watch (low ROI)",
    it: "Stabilità pendenza: watch (ROI basso)",
  },
  "sim.solidity.reason.has_position": {
    en: "Already in portfolio",
    it: "Già in portafoglio",
  },
  "sim.solidity.reason.cd_past": {
    en: "Completion date passed",
    it: "Completion date passata",
  },
  "sim.solidity.reason.sds_veto": {
    en: "SDS veto — do not enter",
    it: "Veto SDS — non entrare",
  },
  "sim.solidity.reason.sds_low_confidence": {
    en: "SDS missing data too high",
    it: "SDS: dati mancanti eccessivi",
  },
  "sim.solidity.reason.sds_below_hot": {
    en: "SDS below hot-zone minimum (55)",
    it: "SDS sotto minimo hot zone (55)",
  },
  "sim.solidity.reason.sds_below_watch": {
    en: "SDS below watch-zone minimum (30)",
    it: "SDS sotto minimo watch zone (30)",
  },
  "sim.solidity.reason.sds_unavailable": {
    en: "Not in SDS cohort",
    it: "Assente dalla cohort SDS",
  },
  "sim.rascore.col.label": {
    en: "RA",
    it: "RA",
  },
  "sim.rascore.col.tip": {
    en: "Entry conviction 0–100 — higher = stronger BUY (not today's price move). Same polarized formula as Model Lab «Entry RA» line. Raw RA ρ in calibration can be negative — that is diagnostic only.",
    it: "Conviction ingresso 0–100 — più alto = BUY più forte (non il movimento di oggi). Stessa formula polarizzata del grafico Model Lab «RA ingresso». Il ρ del RA grezzo in calibrazione può essere negativo — solo diagnostica.",
  },
  "sim.rascore.harmonization.banner": {
    en: "Entry RA (Pick stocks): higher score = stronger buy recommendation. Model Lab ρ charts are retrospective diagnostics — negative ρ on Raw RA is why live uses polarized Entry RA, not the raw sum.",
    it: "RA ingresso (Pick stocks): punteggio più alto = raccomandazione BUY più forte. I grafici ρ in Model Lab sono diagnostica retrospettiva — ρ negativo sul RA grezzo spiega perché live usiamo RA ingresso polarizzato, non la somma grezza.",
  },
  "sim.raVerdict.col.label": {
    en: "RA→",
    it: "RA→",
  },
  "sim.raVerdict.col.tip": {
    en: "RA-derived invest hint from calibrated thresholds (≥{investMin} buy · ≤{divestBelow} avoid/reduce). Complements Top2/P(plan) — not a standalone sell rule.",
    it: "Hint investimento da RA e soglie calibrate (≥{investMin} buy · ≤{divestBelow} evita/riduci). Complementa Top2/P(plan) — non regola di vendita autonoma.",
  },
  "sim.raVerdict.tip": {
    en: "RA signal {verdict} · Entry RA {ra} · thresholds ≥{investMin} / ≤{divestBelow} · calibration {tier} ({source}){note}",
    it: "Segnale RA {verdict} · RA ingresso {ra} · soglie ≥{investMin} / ≤{divestBelow} · calibrazione {tier} ({source}){note}",
  },
  "sim.raVerdict.sourceSnapshot": {
    en: "weekly snapshot {week}",
    it: "snapshot sett. {week}",
  },
  "sim.raVerdict.sourceDefault": {
    en: "default thresholds (run Model Quality refresh)",
    it: "soglie default (esegui refresh Model Quality)",
  },
  "sim.raVerdict.downgradedNote": {
    en: " · buy downgraded to hold — calibration weak/inverted",
    it: " · buy declassato a hold — calibrazione debole/invertita",
  },
  "sim.raVerdict.lossAnalysis.banner": {
    en: "RA→ uses Entry RA + Model Quality thresholds. Higher Entry RA = stronger entry conviction; complements exit/P(plan) logic.",
    it: "RA→ usa RA ingresso + soglie Model Quality. RA ingresso più alto = conviction ingresso più forte; complementa uscita/P(plan).",
  },
  "sim.solidity.modal.title": {
    en: "Recommendation Score — {ticker}",
    it: "Recommendation Score — {ticker}",
  },
  "sim.solidity.modal.scoreSection": {
    en: "Model reliability (Score)",
    it: "Affidabilità modello (Score)",
  },
  "sim.solidity.modal.timingSection": {
    en: "Entry timing (invest now?)",
    it: "Timing ingresso (investire ora?)",
  },
  "sim.solidity.modal.targetSection": {
    en: "Target ROI (strict pick)",
    it: "ROI target (strict pick)",
  },
  "sim.solidity.modal.targetOk": {
    en: "+{pct}% at curve peak · ~{days}d to target",
    it: "+{pct}% al picco curva · ~{days}g al target",
  },
  "sim.solidity.modal.targetMissing": {
    en: "No positive target ROI on model curve",
    it: "Nessun ROI target positivo sulla curva modello",
  },
  "sim.solidity.modal.targetCdHint": {
    en: "ROI→CD (info only): {pct}%",
    it: "ROI→CD (solo info): {pct}%",
  },
  "sim.solidity.modal.entrySection": {
    en: "Entry checklist",
    it: "Checklist ingresso",
  },
  "sim.solidity.modal.bucketExpected": {
    en: "Expected in this window",
    it: "Atteso in questa finestra",
  },
  "sim.solidity.modal.bucketMonitor": {
    en: "Monitor",
    it: "Da monitorare",
  },
  "sim.solidity.modal.bucketBlock": {
    en: "Blocks entry",
    it: "Blocca ingresso",
  },
  "sim.solidity.modal.allPass": {
    en: "All entry checks passed.",
    it: "Tutti i criteri ingresso soddisfatti.",
  },
  "sim.solidity.modal.scoreUnavailable": {
    en: "Score breakdown unavailable for this row.",
    it: "Breakdown score non disponibile per questa riga.",
  },
  "sim.solidity.composite.tooltip": {
    en: "RAscore {score}/100",
    it: "RAscore {score}/100",
  },
  "sim.solidity.composite.top": {
    en: "Strong recommendation",
    it: "Raccomandazione forte",
  },
  "sim.solidity.composite.section": {
    en: "Recommendation Score (RAscore)",
    it: "Recommendation Score (RAscore)",
  },
  "sim.solidity.composite.sectionHint": {
    en: "Entry RA 0–100 — higher = stronger BUY. Each slice = one index; polarized total (Σ ρ+ − Σ ρ−) subtracts indices that historically moved opposite to price. Not the Raw RA ρ line in Model Lab.",
    it: "RA ingresso 0–100 — più alto = BUY più forte. Ogni fetta = un indice; totale polarizzato (Σ ρ+ − Σ ρ−) sottrae indici storicamente opposti al prezzo. Non la linea ρ RA grezzo in Model Lab.",
  },
  "sim.solidity.composite.breakdownSection": {
    en: "Index by index",
    it: "Indice per indice",
  },
  "sim.solidity.composite.reliability": {
    en: "Model reliability (Score)",
    it: "Affidabilità modello (Score)",
  },
  "sim.solidity.composite.timing": {
    en: "Entry timing",
    it: "Timing ingresso",
  },
  "sim.solidity.composite.align": {
    en: "Direction align",
    it: "Allineamento direzione",
  },
  "sim.solidity.composite.roiTarget": {
    en: "Target ROI",
    it: "ROI target",
  },
  "sim.solidity.composite.sds": {
    en: "SDS health",
    it: "Salute SDS",
  },
  "sim.solidity.composite.precat": {
    en: "Pre-CD signal",
    it: "Segnale pre-CD",
  },
  "sim.solidity.composite.mii": {
    en: "Market MII °",
    it: "MII mercato °",
  },
  "sim.solidity.composite.calib": {
    en: "Calib pre≈MII",
    it: "Calib pre≈MII",
  },
  "sim.solidity.composite.momentum_accel": {
    en: "Momentum acceleration",
    it: "Accelerazione momentum",
  },
  "sim.solidity.composite.tierTop": {
    en: "Top — ready",
    it: "Top — pronto",
  },
  "sim.solidity.composite.tierStrong": {
    en: "Strong",
    it: "Forte",
  },
  "sim.solidity.composite.tierWatch": {
    en: "Watch",
    it: "Watch",
  },
  "sim.solidity.composite.tierWeak": {
    en: "Weak",
    it: "Debole",
  },
  "signals.excluded.sds_veto": {
    en: "SDS veto",
    it: "Veto SDS",
  },
  "signals.excluded.sds_veto_detail": {
    en: "SDS veto: {veto}",
    it: "Veto SDS: {veto}",
  },
  "signals.excluded.sds_low_confidence": {
    en: "SDS low confidence",
    it: "SDS bassa confidenza",
  },
  "signals.excluded.sds_low_confidence_detail": {
    en: "SDS missing data {pct}% > 40%",
    it: "SDS dati mancanti {pct}% > 40%",
  },
  "signals.excluded.sds_below_hot": {
    en: "SDS below hot minimum",
    it: "SDS sotto minimo hot",
  },
  "signals.excluded.sds_below_watch": {
    en: "SDS below watch minimum",
    it: "SDS sotto minimo watch",
  },
  "signals.excluded.sds_below_detail": {
    en: "SDS {detail}",
    it: "SDS {detail}",
  },
  "signals.excluded.sds_unavailable": {
    en: "SDS unavailable",
    it: "SDS non disponibile",
  },
  "signals.excluded.sds_unavailable_detail": {
    en: "SDS: {detail}",
    it: "SDS: {detail}",
  },
  "modelHealth.title": {
    en: "Model health",
    it: "Salute modello",
  },
  "modelHealth.subtitle": {
    en: "Weekly validation feedback — per-ticker MAE, direction accuracy, and cal_factor adjustments.",
    it: "Feedback validazione settimanale — MAE per ticker, accuratezza direzione e aggiustamenti cal_factor.",
  },
  "modelHealth.bridgeFromValidation": {
    en: "Linked to the T-5 snapshot above (portfolio backtest MAE {mae}, direction {dir}). This section tracks the same kind of error per ticker on resolved catalysts and proposes cal_factor fixes.",
    it: "Collegato allo snapshot T-5 sopra (backtest portafoglio MAE {mae}, direzione {dir}). Qui si traccia lo stesso tipo di errore per ticker sui CD risolti e si propongono correzioni cal_factor.",
  },
  "modelHealth.apiUnavailable": {
    en: "Feedback loop API not available on this server — update supernova_api.py or run preview locally. JSON files under data/ still load via Reload.",
    it: "API feedback loop non disponibile su questo server — aggiorna supernova_api.py o esegui l'anteprima in locale. I JSON in data/ si caricano comunque con Ricarica.",
  },
  "modelHealth.maeTrend": {
    en: "Portfolio MAE (8 wk)",
    it: "MAE portafoglio (8 sett.)",
  },
  "modelHealth.portfolioMae": {
    en: "Avg MAE",
    it: "MAE medio",
  },
  "modelHealth.portfolioDir": {
    en: "Dir accuracy",
    it: "Acc. direzione",
  },
  "modelHealth.lastRun": {
    en: "Last run:",
    it: "Ultimo run:",
  },
  "modelHealth.never": {
    en: "never",
    it: "mai",
  },
  "modelHealth.runPreview": {
    en: "Run feedback loop",
    it: "Esegui feedback loop",
  },
  "modelHealth.running": {
    en: "Running…",
    it: "In corso…",
  },
  "modelHealth.previewTitle": {
    en: "Confirm cal_factor changes",
    it: "Conferma modifiche cal_factor",
  },
  "modelHealth.previewHint": {
    en: "Review proposed cal_factor adjustments before writing to disk. Nothing is saved until you confirm.",
    it: "Rivedi le modifiche proposte a cal_factor prima di scrivere su disco. Nulla viene salvato senza conferma.",
  },
  "modelHealth.previewEmpty": {
    en: "No cal_factor changes proposed.",
    it: "Nessuna modifica cal_factor proposta.",
  },
  "modelHealth.applyConfirm": {
    en: "Apply changes",
    it: "Applica modifiche",
  },
  "modelHealth.applyOk": {
    en: "Applied {n} cal_factor change(s).",
    it: "Applicate {n} modifica/e cal_factor.",
  },
  "modelHealth.recentCal": {
    en: "Recent cal_factor changes",
    it: "Ultime modifiche cal_factor",
  },
  "modelHealth.noData": {
    en: "No ticker performance data yet — run feedback loop after ≥3 resolved catalyst nodes.",
    it: "Nessun dato performance ticker — esegui feedback loop dopo ≥3 nodi CD risolti.",
  },
  "modelHealth.col.ticker": { en: "Ticker", it: "Ticker" },
  "modelHealth.col.mae": { en: "MAE", it: "MAE" },
  "modelHealth.col.dir": { en: "Dir Acc", it: "Acc. dir." },
  "modelHealth.col.bias": { en: "Bias", it: "Bias" },
  "modelHealth.col.cal": { en: "Cal factor", it: "Cal factor" },
  "modelHealth.col.flag": { en: "Flag", it: "Flag" },
  "modelHealth.flag.underperformer": { en: "underperformer", it: "sottoperformante" },
  "modelHealth.flag.strong": { en: "strong", it: "forte" },
  "modelHealth.flag.biasPlus": { en: "bias+", it: "bias+" },
  "modelHealth.flag.biasMinus": { en: "bias−", it: "bias−" },
  "modelHealth.flag.suspended": { en: "suspended", it: "sospeso" },
  "modelHealth.flag.insufficient": { en: "insufficient data", it: "dati insufficienti" },
  "system.coherence.title": {
    en: "Cross-tab coherence audit",
    it: "Audit coerenza tra tab",
  },
  "system.coherence.subtitle": {
    en: "Live comparison of Top Opps publishers, slope feed, and portfolio input warnings.",
    it: "Confronto live tra pubblicatori Top Opps, feed slope e avvisi input portafoglio.",
  },
  "system.coherence.noSim": {
    en: "Load the Simulation sheet first (refresh or open Simulation).",
    it: "Carica prima il foglio Simulation (refresh o apri Simulation).",
  },
  "system.coherence.strictHot": {
    en: "Strict hot (computed)",
    it: "Hot strict (calcolato)",
  },
  "system.coherence.watch": {
    en: "watch",
    it: "watch",
  },
  "system.coherence.relaxedHot": {
    en: "Relaxed hot (legacy)",
    it: "Hot relaxed (legacy)",
  },
  "system.coherence.relaxedHint": {
    en: "0.8% / aff 45% — may differ from Decision Lab",
    it: "0.8% / aff 45% — può differire dal Decision Lab",
  },
  "system.coherence.storeHot": {
    en: "Store hot keys",
    it: "Hot nello store",
  },
  "system.coherence.upsidePct": {
    en: "Upside threshold",
    it: "Soglia upside",
  },
  "system.coherence.minAff": {
    en: "Min confidence",
    it: "Affidabilità min.",
  },
  "system.coherence.slopeFeed": {
    en: "Slope feed (portfolio)",
    it: "Feed slope (portafoglio)",
  },
  "system.coherence.openPos": {
    en: "Open positions",
    it: "Posizioni aperte",
  },
  "system.coherence.storeAge": {
    en: "Store age",
    it: "Età store",
  },
  "system.coherence.buyWarn": {
    en: "Buy price warnings",
    it: "Avvisi prezzo buy",
  },
  "system.coherence.pubDecisionLab": {
    en: "Source: Decision Lab",
    it: "Fonte: Decision Lab",
  },
  "system.coherence.pubDashboardStrict": {
    en: "Source: Dashboard (strict)",
    it: "Fonte: Dashboard (strict)",
  },
  "system.coherence.pubDashboardPreview": {
    en: "Source: Dashboard (preview)",
    it: "Fonte: Dashboard (preview)",
  },
  "system.coherence.divergentTitle": {
    en: "Hot only in relaxed mode",
    it: "Hot solo in modalità relaxed",
  },
  "system.coherence.divergentBody": {
    en: "These tickers would appear with legacy permissive filters but not with strict pick rules.",
    it: "Questi ticker comparirebbero con filtri permissivi legacy ma non con le regole strict sui pick.",
  },
  "system.coherence.buyWarnTitle": {
    en: "Buy price far from spot — check Simulation inputs",
    it: "Buy molto lontano dallo spot — verifica input in Simulation",
  },
  "system.coherence.rawStore": {
    en: "Raw topOpps store",
    it: "Store topOpps (JSON)",
  },
  "system.coherence.footer": {
    en: "Refreshed on tab focus",
    it: "Aggiornato all'apertura tab",
  },
  "system.coherence.banner.ok": {
    en: "All checks passed — tabs are aligned.",
    it: "Tutti i controlli ok — le tab sono allineate.",
  },
  "system.coherence.banner.warn": {
    en: "Attention — some checks are trending toward a misalignment.",
    it: "Attenzione — alcuni controlli tendono verso un disallineamento.",
  },
  "system.coherence.banner.error": {
    en: "Critical — misalignment detected between tabs or portfolio inputs.",
    it: "Critico — disallineamento rilevato tra tab o input portafoglio.",
  },
  "system.coherence.warningsTitle": {
    en: "Warnings (monitor)",
    it: "Avvisi (monitorare)",
  },
  "coherenceAlert.modal.title": {
    en: "Recommendations need a refresh",
    it: "Aggiorna le raccomandazioni",
  },
  "coherenceAlert.modal.subtitle": {
    en: "Dashboard and Top Opps lists may still show tickers saved hours ago. Fix this before trading or filtering on those lists.",
    it: "Dashboard e Top Opps potrebbero mostrare titoli salvati ore fa. Sistemalo prima di usare filtri o liste «hot».",
  },
  "coherenceAlert.modal.count": {
    en: "{n} item(s) to fix",
    it: "{n} punto/i da sistemare",
  },
  "coherenceAlert.modal.gotIt": {
    en: "Close for now",
    it: "Chiudi per ora",
  },
  "coherenceAlert.modal.dismissHint": {
    en: "Closing hides this alert until the problem changes — it does not refresh data.",
    it: "Chiudere nasconde l'avviso finché il problema non cambia — non aggiorna i dati.",
  },
  "coherenceAlert.modal.openSystem": {
    en: "Technical details (System)",
    it: "Dettaglio tecnico (Sistema)",
  },
  "coherenceAlert.modal.goDashboard": {
    en: "Open Dashboard — refresh Top Opps",
    it: "Apri Dashboard — aggiorna Top Opps",
  },
  "coherenceAlert.modal.goSimulation": {
    en: "Open Simulation — fix buy prices",
    it: "Apri Simulation — correggi prezzi buy",
  },
  "coherenceAlert.action.refreshTopOpps": {
    en: "→ Open Dashboard (sidebar). It recalculates Top Opps and Top 2 buy in a few seconds. Alternative: Decision Lab → Signals.",
    it: "→ Apri Dashboard (menu laterale): ricalcola Top Opps e Top 2 buy in pochi secondi. In alternativa: Decision Lab → Segnali.",
  },
  "coherenceAlert.action.fixBuyPrice": {
    en: "→ Open Simulation, check the buy price column for the tickers listed below (too far from live price).",
    it: "→ Apri Simulation e verifica la colonna buy per i ticker sotto (troppo lontani dal prezzo live).",
  },
  "coherenceAlert.action.viewCoherence": {
    en: "→ Optional: System → Coherence tab to compare strict vs legacy filters.",
    it: "→ Opzionale: Sistema → Coerenza tab per confrontare filtri strict vs legacy.",
  },
  "coherenceAlert.issue.storeMismatch.title": {
    en: "Top Opps store ≠ strict picks",
    it: "Store Top Opps ≠ pick strict",
  },
  "coherenceAlert.issue.storeMismatch.detail": {
    en: "Store shows {storeN} hot ticker(s) but strict rules compute {strictN}. Dashboard and Decision Lab may disagree.",
    it: "Lo store ha {storeN} hot ma le regole strict ne calcolano {strictN}. Dashboard e Decision Lab possono divergere.",
  },
  "coherenceAlert.issue.staleStore.title": {
    en: "Stale hot in store",
    it: "Hot obsoleto nello store",
  },
  "coherenceAlert.issue.staleStore.detail": {
    en: "{storeN} ticker(s) still flagged hot but none pass strict now — open Dashboard or Decision Lab → Signals to refresh.",
    it: "{storeN} ticker ancora hot nello store ma nessuno passa i filtri strict — apri Dashboard o Decision Lab → Segnali per aggiornare.",
  },
  "coherenceAlert.issue.unpublishedHot.title": {
    en: "Strict hot not published to store",
    it: "Hot strict non pubblicati nello store",
  },
  "coherenceAlert.issue.unpublishedHot.detail": {
    en: "{n} ticker(s) pass strict filters but store is empty ({ageMin} min since last publish).",
    it: "{n} ticker passano i filtri strict ma lo store è vuoto ({ageMin} min dall'ultima pubblicazione).",
  },
  "coherenceAlert.issue.buyPrice.title": {
    en: "Buy price inconsistent with spot",
    it: "Prezzo buy incoerente con lo spot",
  },
  "coherenceAlert.issue.buyPrice.detail": {
    en: "{n} open position(s) have buy far from current price — check Simulation inputs.",
    it: "{n} posizione/i con buy molto lontano dallo spot — verifica input in Simulation.",
  },
  "coherenceAlert.issue.storeStale.title": {
    en: "Top Opps not updated for {ageHours}+ hours",
    it: "Top Opps non aggiornate da {ageHours}+ ore",
  },
  "coherenceAlert.issue.storeStale.detail": {
    en: "You have open positions or saved «hot» tickers, but the recommendation list was last saved {ageMin} min ago (~{ageHours} h). Scores and filters may look wrong until you refresh.",
    it: "Hai posizioni aperte o ticker «hot» salvati, ma l'ultimo salvataggio risale a {ageMin} min fa (~{ageHours} h). Score e filtri possono sembrare sbagliati finché non aggiorni.",
  },
  "coherenceAlert.issue.storeAging.title": {
    en: "Top Opps aging ({ageMin} min)",
    it: "Top Opps invecchiate ({ageMin} min)",
  },
  "coherenceAlert.issue.storeAging.detail": {
    en: "With open positions, refresh Top Opps at least every 2 hours so Dashboard stays aligned with live prices.",
    it: "Con posizioni aperte, aggiorna le Top Opps almeno ogni 2 ore così la Dashboard resta allineata ai prezzi live.",
  },
  "coherenceAlert.issue.legacyPublish.title": {
    en: "Legacy preview publisher active",
    it: "Pubblicatore legacy (preview) attivo",
  },
  "coherenceAlert.issue.legacyPublish.detail": {
    en: "Hot keys were published with permissive preview rules, not strict picks.",
    it: "Hot keys pubblicate con regole preview permissive, non strict.",
  },
  "coherenceAlert.issue.unknownPublish.title": {
    en: "Unknown publish source",
    it: "Fonte pubblicazione sconosciuta",
  },
  "coherenceAlert.issue.unknownPublish.detail": {
    en: "Store has hot keys but publishedBy is unset.",
    it: "Lo store ha hot keys ma publishedBy non è impostato.",
  },
  "coherenceAlert.issue.relaxedInStore.title": {
    en: "Relaxed-only tickers in store",
    it: "Ticker solo-relaxed nello store",
  },
  "coherenceAlert.issue.relaxedInStore.detail": {
    en: "These tickers pass legacy filters only — they should not be in the strict store.",
    it: "Questi ticker passano solo i filtri legacy — non dovrebbero essere nello store strict.",
  },
  "coherenceAlert.issue.relaxedOnly.title": {
    en: "Hot only in relaxed mode",
    it: "Hot solo in modalità relaxed",
  },
  "coherenceAlert.issue.relaxedOnly.detail": {
    en: "Legacy filters would show more tickers than strict rules (informational).",
    it: "I filtri legacy mostrerebbero più ticker delle regole strict (informativo).",
  },
  "refreshView.title": {
    en: "Data refresh",
    it: "Refresh dati",
  },
  "refreshView.subtitle": {
    en: "Two jobs only: daily update (Simulation + prices) or full orchestrator (SEC 8-K, liquidity, full cohort). Logs and last-run summary below.",
    it: "Due job: aggiornamento giornaliero (Simulation + prezzi) o orchestrator completo (SEC 8-K, liquidità, coorte). Log e riepilogo sotto.",
  },
  "refreshView.daily.title": {
    en: "Daily refresh",
    it: "Refresh giornaliero",
  },
  "refreshView.daily.detail": {
    en: "Simulation sheet, Yahoo prices, curves and KPIs. Preserves buy price and capital on open positions.",
    it: "Foglio Simulation, prezzi Yahoo, curve e KPI. Preserva prezzo acquisto e capitale sulle posizioni aperte.",
  },
  "refreshView.daily.eta": {
    en: "ETA ~15–25 min",
    it: "ETA ~15–25 min",
  },
  "refreshView.full.title": {
    en: "Full orchestrator",
    it: "Orchestrator completo",
  },
  "refreshView.full.detail": {
    en: "Full pipeline: external fetch, SEC 8-K, liquidity, cohort rebuild, all sheets. Auto-starts Saturday morning on first launch.",
    it: "Pipeline completa: fetch esterni, SEC 8-K, liquidità, ricostruzione coorte, tutti i fogli. Auto-avvio sabato mattina al primo avvio.",
  },
  "refreshView.full.eta": {
    en: "ETA ~30–90+ min",
    it: "ETA ~30–90+ min",
  },
  "refreshView.sources.title": {
    en: "Data sources used by the app",
    it: "Fonti dati usate dall'app",
  },
  "refreshView.sources.yahoo": {
    en: "Yahoo Finance",
    it: "Yahoo Finance",
  },
  "refreshView.sources.sec": {
    en: "SEC EDGAR",
    it: "SEC EDGAR",
  },
  "refreshView.sources.ctgov": {
    en: "ClinicalTrials.gov",
    it: "ClinicalTrials.gov",
  },
  "refreshView.sources.fda": {
    en: "FDA Drugs",
    it: "FDA Drugs",
  },
  "refreshView.sources.openfda": {
    en: "openFDA",
    it: "openFDA",
  },
  "refreshView.summary.dailyLabel": {
    en: "Last daily refresh",
    it: "Ultimo refresh giornaliero",
  },
  "refreshView.summary.fullLabel": {
    en: "Last full orchestrator",
    it: "Ultimo orchestrator completo",
  },
  "refreshView.summary.running": {
    en: "Daily refresh in progress…",
    it: "Refresh giornaliero in corso…",
  },
  "refreshView.summary.fullRunning": {
    en: "Full orchestrator in progress — clock badge in the top bar shows progress.",
    it: "Orchestrator completo in corso — badge orologio in alto per l'avanzamento.",
  },
  "refreshView.summary.noDaily": {
    en: "No daily refresh message saved yet.",
    it: "Nessun messaggio di refresh giornaliero salvato.",
  },
  "refreshView.summary.fullOk": {
    en: "Completed in {elapsed}",
    it: "Completato in {elapsed}",
  },
  "refreshView.summary.fullErr": {
    en: "Ended with errors",
    it: "Terminato con errori",
  },
  "refreshView.summary.reopenFull": {
    en: "View full result",
    it: "Vedi esito completo",
  },
  "refreshView.refreshStatus": {
    en: "Refresh status",
    it: "Aggiorna stato",
  },
  "refreshView.workbook.label": {
    en: "Workbook:",
    it: "Workbook:",
  },
  "refreshView.workbook.locked": {
    en: "locked (close Excel)",
    it: "bloccato (chiudi Excel)",
  },
  "refreshView.workbook.writable": {
    en: "writable",
    it: "scrivibile",
  },
  "refreshView.staged": {
    en: "Staged",
    it: "Staged",
  },
  "refreshView.lastFull": {
    en: "Last full orchestrator:",
    it: "Ultimo orchestrator full:",
  },
  "refreshView.duration": {
    en: "duration {min}m {sec}s",
    it: "durata {min}m {sec}s",
  },
  "refreshView.noFullSummary": {
    en: "No full orchestrator summary saved yet.",
    it: "Nessun riepilogo orchestrator completo salvato.",
  },
  "refreshView.statusFile": {
    en: "Status file",
    it: "File stato",
  },
  "refreshView.logTitle": {
    en: "Log",
    it: "Log",
  },
  "refreshView.log.running": {
    en: "Running…",
    it: "In corso…",
  },
  "refreshView.log.empty": {
    en: "(empty)",
    it: "(vuoto)",
  },
  "refreshView.log.starting": {
    en: "Starting profile {profile}…\n",
    it: "Avvio profilo {profile}…\n",
  },
  "refreshView.log.started": {
    en: "Started.",
    it: "Avviato.",
  },
  "refreshView.apiOffline": {
    en: "API offline — restart the desktop app or free port 8765. Tabs still read snapshots in data/.",
    it: "API offline — riavvia l'app desktop o libera la porta 8765. Le tab leggono ancora gli snapshot in data/.",
  },
  "settings.title": {
    en: "Settings",
    it: "Impostazioni",
  },
  "settings.section.theme": {
    en: "Theme",
    it: "Tema",
  },
  "settings.theme.modeHint": {
    en: "Display mode: light (Chiaro), blue glass (Blu), or flat black (Nero).",
    it: "Modalità display: Chiaro, Blu (vetro) o Nero piatto.",
  },
  "settings.section.appearance": {
    en: "Appearance",
    it: "Aspetto",
  },
  "settings.appearance.hint": {
    en: "Choose the interface palette — applies to every tab instantly.",
    it: "Scegli la palette dell'interfaccia — si applica a tutte le tab all'istante.",
  },
  "settings.appearance.violet": {
    en: "Violet",
    it: "Violetto",
  },
  "settings.appearance.violetDesc": {
    en: "Deep violet · rose · apple green accents",
    it: "Violetto profondo · rosa · verde mela",
  },
  "settings.appearance.mint": {
    en: "Mint",
    it: "Menta",
  },
  "settings.appearance.mintDesc": {
    en: "Mint green · ochre · rose accents",
    it: "Verde menta · ocra · rosa",
  },
  "settings.section.language": {
    en: "Language",
    it: "Lingua",
  },
  "settings.language.hint": {
    en: "Switch the user interface between English and Italian. Some text may stay in English until fully migrated.",
    it: "Cambia l'interfaccia tra Inglese e Italiano. Alcuni testi potrebbero restare in inglese finché non sono completamente migrati.",
  },
  "settings.language.en": {
    en: "🇬🇧 English",
    it: "🇬🇧 English",
  },
  "settings.language.it": {
    en: "🇮🇹 Italiano",
    it: "🇮🇹 Italiano",
  },
  "settings.section.api": {
    en: "SuperNova API (local → 127.0.0.1:8765)",
    it: "API SuperNova (locale → 127.0.0.1:8765)",
  },
  "settings.section.apiRemote": {
    en: "SuperNova API (remote → {host})",
    it: "API SuperNova (remoto → {host})",
  },
  "settings.api.localOnlyHint": {
    en: "Online here means the local API on this PC — not the VPS. Use Connect above to switch to the server.",
    it: "Online qui = API locale su questo PC, non il VPS. Usa Connetti sopra per passare al server.",
  },
  "settings.api.status": {
    en: "Status:",
    it: "Stato:",
  },
  "settings.api.workbook": {
    en: "Workbook:",
    it: "Workbook:",
  },
  "settings.api.path": {
    en: "Path:",
    it: "Percorso:",
  },
  "settings.api.updated": {
    en: "Updated:",
    it: "Aggiornato:",
  },
  "settings.api.dailyRefresh": {
    en: "Daily refresh:",
    it: "Refresh giornaliero:",
  },
  "settings.api.orchestrator": {
    en: "Orchestrator:",
    it: "Orchestrator:",
  },
  "settings.api.lastRefresh": {
    en: "Last refresh:",
    it: "Ultimo refresh:",
  },
  "settings.api.running": {
    en: "running",
    it: "in corso",
  },
  "settings.api.stopped": {
    en: "stopped",
    it: "fermo",
  },
  "settings.intro": {
    en: "Theme, language, remote VPS and API token. Data refresh jobs are in the Refresh tab.",
    it: "Tema, lingua, VPS remoto e token API. I job di refresh sono nella tab Refresh.",
  },
  "settings.api.refreshTabHint": {
    en: "Start daily or full orchestrator from the Refresh tab.",
    it: "Avvia refresh giornaliero o orchestrator completo dalla tab Refresh.",
  },
  "settings.sunday.title": {
    en: "Sunday full refresh (weekly orchestrator)",
    it: "Refresh domenica full (orchestrator settimanale)",
  },
  "settings.sunday.where": {
    en: "Full pipeline: fetch, SEC 8-K, liquidity, cohort rebuild. ETA ~30–90+ min. Close Excel on the data workbook first. On Saturday morning the app may auto-start this on first launch.",
    it: "Pipeline completa: fetch, SEC 8-K, liquidità, ricostruzione coorte. ETA ~30–90+ min. Chiudi Excel sul workbook dati prima. Il sabato mattina l'app può avviarlo al primo avvio.",
  },
  "settings.sunday.start": {
    en: "Start Sunday full",
    it: "Avvia domenica full",
  },
  "settings.sunday.running": {
    en: "Sunday full in progress — click the clock badge in the top bar to see progress.",
    it: "Domenica full in corso — clicca l'orologio in alto per vedere l'avanzamento.",
  },
  "settings.sunday.lastOk": {
    en: "Last Sunday full: completed in {elapsed}",
    it: "Ultima domenica full: completata in {elapsed}",
  },
  "settings.sunday.lastErr": {
    en: "Last Sunday full: ended with errors",
    it: "Ultima domenica full: terminata con errori",
  },
  "settings.sunday.reopen": {
    en: "View result popup",
    it: "Rivedi popup esito",
  },
  "settings.sunday.none": {
    en: "No Sunday full result recorded in this session yet. Check the orchestrator log below after a run.",
    it: "Nessun esito domenica full in questa sessione. Dopo un run controlla il log orchestrator sotto.",
  },
  "settings.api.lastRefreshHint": {
    en: "This line is the last fast/daily job message from the server — not necessarily the weekly Sunday orchestrator.",
    it: "Questa riga è l'ultimo messaggio del job giornaliero/rapido sul server — non è necessariamente l'orchestrator domenica settimanale.",
  },
  "settings.api.refreshStatus": {
    en: "Refresh API status",
    it: "Aggiorna stato API",
  },
  "settings.api.runQuick": {
    en: "Orchestrator (quick)",
    it: "Orchestrator (rapido)",
  },
  "settings.api.tokenLabel": {
    en: "X-SuperNova-Token (mutating POSTs)",
    it: "X-SuperNova-Token (POST mutanti)",
  },
  "settings.api.tokenPlaceholder": {
    en: "optional — SUPERNOVA_API_TOKEN",
    it: "opzionale — SUPERNOVA_API_TOKEN",
  },
  "settings.api.tokenHint": {
    en: "Or use the {var} variable in {file}",
    it: "Oppure variabile {var} in {file}",
  },
  "settings.api.tokenSave": {
    en: "Save token",
    it: "Salva token",
  },
  "settings.api.tokenTest": {
    en: "Test token",
    it: "Test token",
  },
  "settings.api.tokenTestOk": {
    en: "Token accepted by the server — you can switch AI provider and run refresh.",
    it: "Token accettato dal server — puoi cambiare provider AI e fare refresh.",
  },
  "settings.api.tokenClear": {
    en: "Clear",
    it: "Cancella",
  },
  "settings.api.tokenSavedOk": {
    en: "Token saved in this browser — refresh jobs can run.",
    it: "Token salvato in questo browser — i refresh possono partire.",
  },
  "settings.api.tokenMissingHint": {
    en: "Server requires an API token for refresh. Paste the VPS SUPERNOVA_API_TOKEN and click Save.",
    it: "Il server richiede un token API per i refresh. Incolla il SUPERNOVA_API_TOKEN del VPS e clicca Salva.",
  },
  "settings.api.tokenServerPlaceholder": {
    en: "Server token was reset to the repo placeholder — generate a new token on the VPS and save it here.",
    it: "Token server reimpostato al placeholder del repo — genera un nuovo token sul VPS e salvalo qui.",
  },
  "settings.api.tokenPersistHint": {
    en: "Stored in browser localStorage (per origin). Deploys no longer overwrite the server token; re-save here if you use another browser or cleared site data.",
    it: "Salvato nel localStorage del browser (per origine). I deploy non sovrascrivono più il token sul server; risalva qui se cambi browser o cancelli i dati sito.",
  },
  "settings.section.remote": {
    en: "Remote server (VPS)",
    it: "Server remoto (VPS)",
  },
  "settings.remote.active": {
    en: "Connected — data and refresh use the server (always up to date).",
    it: "Connesso — dati e refresh dal server (sempre aggiornati).",
  },
  "settings.remote.inactive": {
    en: "Local mode — reads data/ on this PC. Set the VPS URL to sync with the server.",
    it: "Modalità locale — legge data/ su questo PC. Imposta l'URL VPS per allinearti al server.",
  },
  "settings.remote.pendingConnect": {
    en: "URL ready — click Connect & reload to switch to the server.",
    it: "URL pronto — clicca Connetti e ricarica per passare al server.",
  },
  "settings.remote.urlLabel": {
    en: "Server URL",
    it: "URL server",
  },
  "settings.remote.urlPlaceholder": {
    en: "http://91.99.15.48:8765",
    it: "http://91.99.15.48:8765",
  },
  "settings.remote.connect": {
    en: "Connect & reload",
    it: "Connetti e ricarica",
  },
  "settings.remote.disconnect": {
    en: "Use local data",
    it: "Usa dati locali",
  },
  "settings.remote.hint": {
    en: "Same URL and token as the mobile app (sn_api_base). Refresh runs on the server; this app auto-reloads when data changes.",
    it: "Stesso URL e token della mobile app (sn_api_base). Il refresh gira sul server; l'app ricarica i dati quando cambiano.",
  },
  "settings.remote.electronLocal": {
    en: "Desktop app (Electron): always uses local data/ and API on 127.0.0.1:8765. Remote VPS applies only in the browser build.",
    it: "App desktop (Electron): usa sempre data/ locale e API su 127.0.0.1:8765. Il VPS remoto vale solo nella build browser.",
  },
  "topbar.remoteServer": {
    en: "Remote",
    it: "Remoto",
  },
  "topbar.back": {
    en: "Back",
    it: "Indietro",
  },
  "topbar.backTo": {
    en: "Back to {screen}",
    it: "Torna a {screen}",
  },
  "topbar.openMenu": {
    en: "Open menu",
    it: "Apri menu",
  },
  "topbar.closeMenu": {
    en: "Close menu",
    it: "Chiudi menu",
  },
  "settings.section.dailyLog": {
    en: "Daily refresh log",
    it: "Log refresh giornaliero",
  },
  "settings.section.orchLog": {
    en: "Orchestrator log",
    it: "Log orchestrator",
  },
  "settings.log.empty": {
    en: "(empty)",
    it: "(vuoto)",
  },
  "settings.log.emptyDaily": {
    en: "(empty — start «Daily refresh»)",
    it: "(vuoto — avvia «Refresh giornaliero»)",
  },
  "settings.footer.localData": {
    en: "Local data (stable): Simulation / Accuracy / Financial only read {file} — not the HTTP API.",
    it: "Dati locali (stabile): Simulation / Accuracy / Financial leggono solo {file} — non l'API HTTP.",
  },
  "settings.footer.dashboard": {
    en: "Dashboard: {file} (or ui_snapshot.json)",
    it: "Dashboard: {file} (o ui_snapshot.json)",
  },
  "settings.footer.afterRefresh": {
    en: "After refresh: snapshots update themselves; otherwise {script}.",
    it: "Dopo refresh: gli snapshot si aggiornano da soli; oppure {script}.",
  },
  "settings.footer.startApp": {
    en: "Start the app with {script} (Electron).",
    it: "Avvia l'app con {script} (Electron).",
  },

  // ── Decision Lab — header / tabs ───────────────────────────────────────────
  "decisionLab.title": {
    en: "Pick stocks",
    it: "Scegli titoli",
  },
  "decisionLab.subtitle.signals": {
    en: "Past pred curves vs real stock movement · analysis of your simulations",
    it: "Curve predittive passate vs movimento reale · analisi delle tue simulazioni",
  },
  "decisionLab.subtitle.learnings": {
    en: "Is the model getting better? What it's waiting on · what changes for your signals and curves",
    it: "Il modello migliora? Cosa sta aspettando · cosa cambia per segnali e curve",
  },
  "decisionLab.tab.learnings": {
    en: "Model learnings",
    it: "Learnings modello",
  },
  "decisionLab.loading.learnings": {
    en: "Loading model learnings…",
    it: "Caricamento learnings modello…",
  },
  "decisionLab.learnings.heading": {
    en: "How the model learns over time",
    it: "Come il modello impara nel tempo",
  },
  "decisionLab.learnings.intro": {
    en: "When a prediction is verified (after ~5 days), the model uses the result to adjust its curves. The chart shows whether accuracy is improving.",
    it: "Quando una previsione viene verificata (dopo ~5 giorni), il modello usa il risultato per ritoccare le curve. Il grafico mostra se la precisione migliora.",
  },
  "decisionLab.subtitle.portfolio": {
    en: "Your portfolio = decision tracking · capital invested/divested · curve slope + reliability vs P&L",
    it: "Tuo portafoglio = tracciamento decisioni · capitale investito/disinvestito · pendenza curva + affidabilità vs P&L",
  },
  "decisionLab.tab.slopeErrors": {
    en: "Slope",
    it: "Slope",
  },
  "decisionLab.tab.slopeErrorsCount": {
    en: "Slope ({n})",
    it: "Slope ({n})",
  },
  "decisionLab.subtitle.slopeErrors": {
    en: "Slope Δ vs model curve · portfolio alerts · company overview table",
    it: "Δ pendenza vs curva modello · alert portafoglio · tabella riepilogo società",
  },
  "decisionLab.tab.monitor": {
    en: "Opportunities",
    it: "Opportunità",
  },
  "decisionLab.subtitle.monitor": {
    en: "Stocks near CD · trajectory · price moves · slope vs curve",
    it: "Titoli vicini al CD · traiettoria · variazioni prezzo · pendenza vs curva",
  },
  "decisionLab.tab.signals": {
    en: "⚡ Top opportunities",
    it: "⚡ Top opportunities",
  },
  "decisionLab.tab.portfolio": {
    en: "Your portfolio",
    it: "Tuo portafoglio",
  },
  "decisionLab.tab.sds": {
    en: "SuperNova",
    it: "SuperNova",
  },
  "decisionLab.subtitle.sds": {
    en: "Supernova Distance Score — proximity to historical pre-surge setups (0–100).",
    it: "Supernova Distance Score — distanza dalle condizioni storiche pre-surge (0–100).",
  },
  "decisionLab.tab.patterns": {
    en: "Ticker focus",
    it: "Focus titolo",
  },
  "decisionLab.subtitle.patterns": {
    en: "CD-aligned recommendation radar — RA, SDS, MII, Calib and slope vs fixed thresholds per pre-CD arc.",
    it: "Radar raccomandazione allineato al CD — RA, SDS, MII, Calib e slope vs soglie fisse per arco pre-CD.",
  },
  "decisionLab.pattern.title": {
    en: "CD pattern recommendation",
    it: "Raccomandazione pattern CD",
  },
  "decisionLab.pattern.lead": {
    en: "Each ticker is scored against the active pre-CD window (T−60→T+4). The green polygon is the target profile; blue is the current state. ROI is measured on the same arc segment, not a fixed calendar horizon.",
    it: "Ogni ticker è valutato sulla finestra pre-CD attiva (T−60→T+4). Il poligono verde è il profilo target; il blu lo stato attuale. Il ROI è misurato sullo stesso segmento d'arco, non su un orizzonte fisso.",
  },
  "decisionLab.pattern.loading": {
    en: "Loading cohort and SDS…",
    it: "Caricamento coorte e SDS…",
  },
  "decisionLab.pattern.empty": {
    en: "No tickers in the CD monitor window (−7…120d).",
    it: "Nessun ticker nella finestra monitor CD (−7…120g).",
  },
  "decisionLab.pattern.colTicker": {
    en: "Ticker",
    it: "Ticker",
  },
  "decisionLab.pattern.colDays": {
    en: "CD",
    it: "CD",
  },
  "decisionLab.pattern.colMatch": {
    en: "Match",
    it: "Match",
  },
  "decisionLab.pattern.colPriority": {
    en: "PPI",
    it: "PPI",
  },
  "decisionLab.pattern.colPriorityTip": {
    en: "Portfolio Pattern Index 0–100: match % + arc urgency + CD proximity + verdict. Portfolio rows ranked #1…n at top.",
    it: "Portfolio Pattern Index 0–100: match % + urgenza arco + prossimità CD + verdict. Righe portfolio in cima con rank #1…n.",
  },
  "decisionLab.pattern.priorityHint": {
    en: "💼 Portfolio rows first — sorted by PPI (Portfolio Pattern Index). Higher PPI = review first (hot CD window + polygon fit).",
    it: "💼 Portfolio in cima — ordinato per PPI (Portfolio Pattern Index). PPI più alto = da rivedere per primo (finestra CD calda + fit polygon).",
  },
  "decisionLab.pattern.filterAll": {
    en: "All ({n})",
    it: "Tutti ({n})",
  },
  "decisionLab.pattern.filterAllTip": {
    en: "All tickers in the CD monitor window",
    it: "Tutti i ticker nella finestra monitor CD",
  },
  "decisionLab.pattern.filterPortfolio": {
    en: "Portfolio ({n})",
    it: "Portfolio ({n})",
  },
  "decisionLab.pattern.filterPortfolioTip": {
    en: "Only tickers with an open portfolio position",
    it: "Solo ticker con posizione portfolio aperta",
  },
  "decisionLab.pattern.sortPpi": {
    en: "Sort · PPI",
    it: "Ordina · PPI",
  },
  "decisionLab.pattern.sortPpiTip": {
    en: "Portfolio first, then by Portfolio Pattern Index (match + CD urgency + verdict)",
    it: "Portfolio in cima, poi per Portfolio Pattern Index (match + urgenza CD + verdict)",
  },
  "decisionLab.pattern.sortMatch": {
    en: "Sort · Match %",
    it: "Ordina · Match %",
  },
  "decisionLab.pattern.sortMatchTip": {
    en: "Highest polygon match first — best fit to the green target profile",
    it: "Match % poligono decrescente — miglior aderenza al profilo target verde",
  },
  "decisionLab.pattern.listHint.allMatch": {
    en: "Sorted by polygon match % — highest fit to the target profile first.",
    it: "Ordinato per match % poligono — miglior aderenza al profilo target per primo.",
  },
  "decisionLab.pattern.listHint.portfolioPpi": {
    en: "💼 Portfolio only — sorted by PPI (hot CD window + polygon fit).",
    it: "💼 Solo portfolio — ordinato per PPI (finestra CD calda + fit polygon).",
  },
  "decisionLab.pattern.listHint.portfolioMatch": {
    en: "💼 Portfolio only — sorted by polygon match % (highest first).",
    it: "💼 Solo portfolio — ordinato per match % poligono (decrescente).",
  },
  "decisionLab.pattern.emptyPortfolio": {
    en: "No portfolio tickers in the CD monitor window.",
    it: "Nessun ticker portfolio nella finestra monitor CD.",
  },
  "decisionLab.pattern.portfolioRank": {
    en: "Portfolio priority #{rank}",
    it: "Priorità portfolio #{rank}",
  },
  "decisionLab.pattern.verdict.strong": {
    en: "Strong entry",
    it: "Ingresso forte",
  },
  "decisionLab.pattern.verdict.watch": {
    en: "Watch",
    it: "Watch",
  },
  "decisionLab.pattern.verdict.weak": {
    en: "Weak",
    it: "Debole",
  },
  "decisionLab.pattern.verdict.blocked": {
    en: "Below threshold",
    it: "Sotto soglia",
  },
  "decisionLab.pattern.radar.current": {
    en: "Current",
    it: "Attuale",
  },
  "decisionLab.pattern.radar.target": {
    en: "Target (window)",
    it: "Target (finestra)",
  },
  "decisionLab.pattern.arcTitle": {
    en: "Recommendation polygon (CD arc)",
    it: "Poligono raccomandazione (arco CD)",
  },
  "decisionLab.pattern.segmentRoi": {
    en: "ROI on arc segment",
    it: "ROI sul segmento d'arco",
  },
  "decisionLab.pattern.eis.title": {
    en: "Nearest EIS event",
    it: "Evento EIS più vicino",
  },
  "decisionLab.pattern.eis.noEvent": {
    en: "No clinical feed events for this ticker.",
    it: "Nessun evento feed clinico per questo ticker.",
  },
  "decisionLab.pattern.eis.noEventHint": {
    en: "Refresh the clinical feed or use Clinical KPI on the Simulation sheet. Open detail for full breakdown.",
    it: "Aggiorna il feed clinico o valorizza Clinical KPI nel foglio Simulation. Apri dettaglio per la scomposizione.",
  },
  "decisionLab.pattern.eis.sheetBadge": {
    en: "sheet",
    it: "foglio",
  },
  "decisionLab.pattern.eis.clinicalIndicators": {
    en: "Clinical indicators",
    it: "Indicatori clinici",
  },
  "decisionLab.pattern.eis.cdDistance": {
    en: "CD distance bucket",
    it: "Fascia distanza CD",
  },
  "decisionLab.pattern.eis.beforeCd": {
    en: "before CD",
    it: "prima del CD",
  },
  "decisionLab.pattern.eis.moderatedImpact": {
    en: "Moderated expected ΔP",
    it: "ΔP atteso moderato",
  },
  "decisionLab.pattern.eis.baseImpact": {
    en: "Base:",
    it: "Base:",
  },
  "decisionLab.pattern.eis.windowHint": {
    en: "EIS impact is scaled by how far the event sits from Completion Date — closer events carry more weight near readout.",
    it: "L'impatto EIS è scalato in base alla distanza dell'evento dal Completion Date — eventi più vicini pesano di più in prossimità del readout.",
  },
  "decisionLab.pattern.eis.superScoreTemporal": {
    en: "Super score is not a daily index: it is computed once per feed event at publication (T). Forward coupling is measured at T+1 (1 session) and T+7 (~5 sessions). CD-distance bins (180d→0d) modulate impact; learning recalibrates those bins weekly. The Match % radar above uses today's RA/SDS/MII in the active pre-CD arc (T−60→T+4).",
    it: "Il super score non è un indice giornaliero: si calcola per ogni evento feed alla pubblicazione (T). L'accoppiamento forward si misura a T+1 (1 seduta) e T+7 (~5 sedute). Le fasce distanza-CD (180g→0g) modulano l'impatto; il learning ricalibra quelle fasce settimanalmente. Il Match % nel radar usa RA/SDS/MII odierni nell'arco pre-CD attivo (T−60→T+4).",
  },
  "decisionLab.pattern.openSimulationRowBuy": {
    en: "Open {ticker} in Simulation tab → buy",
    it: "Apri {ticker} nel tab Simulation → acquisto",
  },
  "decisionLab.pattern.openSimulationRowSell": {
    en: "Open {ticker} in Simulation tab → sell",
    it: "Apri {ticker} nel tab Simulation → vendita",
  },
  "decisionLab.pattern.eis.openFeed": {
    en: "Open clinical feed",
    it: "Apri feed clinico",
  },
  "decisionLab.pattern.eis.openDetail": {
    en: "EIS detail",
    it: "Dettaglio EIS",
  },
  "decisionLab.pattern.eis.openSource": {
    en: "Source",
    it: "Fonte",
  },
  "decisionLab.sds.title": {
    en: "Supernova Distance Score",
    it: "Supernova Distance Score",
  },
  "decisionLab.sds.lead": {
    en: "SDS does not predict the surge — it measures distance from conditions that preceded +100%…+1800% moves around clinical events. Threshold: SDS ≥ 55 entry zone, ≥ 75 supernova zone.",
    it: "L'SDS non predice il surge — misura la distanza dalle condizioni che precedono movimenti +100%…+1800% intorno agli eventi clinici. Soglia: SDS ≥ 55 zona entry, ≥ 75 supernova zone.",
  },
  "decisionLab.sds.regime": {
    en: "Market regime",
    it: "Regime di mercato",
  },
  "decisionLab.sds.refresh": {
    en: "Recalculate SDS",
    it: "Ricalcola SDS",
  },
  "decisionLab.sds.refreshing": {
    en: "Calculating…",
    it: "Calcolo…",
  },
  "decisionLab.sds.restoreBackup": {
    en: "Restore from backup",
    it: "Ripristina backup",
  },
  "decisionLab.sds.staleSnapshot": {
    en: "SDS scores degraded (cluster B/C missing — timing only). Reload the tab or restore from backup; use «Recalculate SDS» only with FMP key active (2–4 min).",
    it: "Score SDS degradati (mancano cluster B/C — solo timing). Ricarica il tab o ripristina dal backup; usa «Ricalcola SDS» solo con chiave FMP attiva (2–4 min).",
  },
  "decisionLab.sds.refreshDegraded": {
    en: "Recalculate returned incomplete scores (FMP/cluster B not loaded). Previous snapshot restored — restart API with .env FMP key and retry.",
    it: "Il ricalcolo ha restituito score incompleti (FMP/cluster B non caricati). Ripristinato lo snapshot precedente — riavvia l'API con FMP in .env e riprova.",
  },
  "decisionLab.sds.loading": {
    en: "Loading SDS cohort…",
    it: "Caricamento coorte SDS…",
  },
  "decisionLab.sds.errorLoad": {
    en: "Could not load SDS — start API and click Recalculate.",
    it: "Impossibile caricare SDS — avvia l'API e premi Ricalcola.",
  },
  "decisionLab.sds.errorApiFallback": {
    en: "Remote API unavailable — showing local SDS snapshot.",
    it: "API remota non disponibile — snapshot SDS locale.",
  },
  "decisionLab.sds.noCandidates": {
    en: "No ticker with SDS ≥ 55 in this cohort. Switch to “All tickers” to inspect scores.",
    it: "Nessun ticker con SDS ≥ 55. Passa a “Tutti i ticker” per vedere i punteggi.",
  },
  "decisionLab.sds.emptyCohort": {
    en: "Empty cohort — click Recalculate SDS or run a refresh on the server.",
    it: "Coorte vuota — premi Ricalcola SDS o esegui refresh sul server.",
  },
  "decisionLab.sds.filterCandidate": {
    en: "SDS ≥ 55",
    it: "SDS ≥ 55",
  },
  "decisionLab.sds.filterAll": {
    en: "All tickers",
    it: "Tutti i ticker",
  },
  "decisionLab.sds.filterPortfolio": {
    en: "Portfolio",
    it: "Portfolio",
  },
  "decisionLab.sds.cdHorizon.all": {
    en: "All CD",
    it: "Tutte CD",
  },
  "decisionLab.sds.cdHorizon.within2mo": {
    en: "≤2 mo to CD",
    it: "≤2 mesi al CD",
  },
  "decisionLab.sds.cdHorizon.beyond2mo": {
    en: ">2 mo to CD",
    it: ">2 mesi al CD",
  },
  "decisionLab.sds.cdHorizon.allTip": {
    en: "All pre-CD opportunities regardless of distance to Completion Date",
    it: "Tutte le opportunità pre-CD indipendentemente dalla distanza al Completion Date",
  },
  "decisionLab.sds.cdHorizon.within2moTip": {
    en: "Hot zone — catalyst within ~60 calendar days (≈2 months), primary entry timing",
    it: "Zona hot — catalyst entro ~60 giorni calendario (≈2 mesi), timing ingresso primario",
  },
  "decisionLab.sds.cdHorizon.beyond2moTip": {
    en: "Watch zone — CD more than 2 months away; monitor, no urgent entry",
    it: "Zona watch — CD oltre 2 mesi; monitoraggio, nessun ingresso urgente",
  },
  "decisionLab.sds.noWithin2mo": {
    en: "No tickers with CD within 2 months in this cohort. Try “>2 mo to CD” or “All CD”.",
    it: "Nessun ticker con CD entro 2 mesi in questa coorte. Prova “>2 mesi al CD” o “Tutte CD”.",
  },
  "decisionLab.sds.noBeyond2mo": {
    en: "No tickers with CD beyond 2 months. Switch to “≤2 mo to CD” for the hot zone.",
    it: "Nessun ticker con CD oltre 2 mesi. Passa a “≤2 mesi al CD” per la zona hot.",
  },
  "decisionLab.sds.noPortfolio": {
    en: "No tickers with an open portfolio position in this SDS cohort.",
    it: "Nessun ticker con posizione aperta in portfolio in questa coorte SDS.",
  },
  "decisionLab.sds.sortLabel": {
    en: "Priority",
    it: "Priorità",
  },
  "decisionLab.sds.sortDefault": {
    en: "Default",
    it: "Default",
  },
  "decisionLab.sds.sortRoiTip": {
    en: "Sort by estimated ROI at {horizon} (highest first)",
    it: "Ordina per ROI stimato a {horizon} (maggiori prima)",
  },
  "decisionLab.sds.sortDaysTip": {
    en: "Sort by days to CD (soonest first)",
    it: "Ordina per giorni al CD (più vicini prima)",
  },
  "decisionLab.sds.colDaysToCd": {
    en: "Days→CD",
    it: "G→CD",
  },
  "decisionLab.sds.daysToCdTooltip": {
    en: "Calendar days to Completion Date ({days} remaining)",
    it: "Giorni calendario al Completion Date ({days} rimanenti)",
  },
  "decisionLab.sds.count": {
    en: "{n} shown / {total} total",
    it: "{n} visibili / {total} totali",
  },
  "decisionLab.sds.topCandidates": {
    en: "Top supernova candidates",
    it: "Top candidati supernova",
  },
  "decisionLab.sds.colTicker": {
    en: "Ticker",
    it: "Ticker",
  },
  "decisionLab.sds.colZone": {
    en: "Zone",
    it: "Zona",
  },
  "decisionLab.sds.colSimulation": {
    en: "Simulation",
    it: "Simulation",
  },
  "decisionLab.sds.simLinkShort": {
    en: "Perf →",
    it: "Perf →",
  },
  "decisionLab.sds.openSimulationRow": {
    en: "Open {ticker} in Simulation tab for buy/sell",
    it: "Apri {ticker} nel tab Simulation per buy/sell",
  },
  "decisionLab.sds.colFit": {
    en: "Fit μ",
    it: "Fit μ",
  },
  "decisionLab.sds.colRoiPre10": {
    en: "T−10",
    it: "T−10",
  },
  "decisionLab.sds.colRoiPre5": {
    en: "T−5",
    it: "T−5",
  },
  "decisionLab.sds.colRoiPost4": {
    en: "T+4",
    it: "T+4",
  },
  "decisionLab.sds.fitTooltip": {
    en: "Best historical μ fit (100 − RMSE pp): {profile} {pct}%",
    it: "Miglior fit μ storico (100 − RMSE pp): {profile} {pct}%",
  },
  "decisionLab.sds.roiHorizonTooltip": {
    en: "SDS↔ROI calibrated estimate (% vs T−60) at this calendar knot — blended from historical profiles, not the raw ticker curve.",
    it: "Stima calibrata SDS↔ROI (% vs T−60) in questo nodo calendario — blend da profili storici, non la curva grezza del ticker.",
  },
  "decisionLab.sds.colRoiPre10Tip": {
    en: "Estimated % vs T−60 at T−10 (10 trading days before CD)",
    it: "Stima % vs T−60 a T−10 (10 giorni di borsa prima del CD)",
  },
  "decisionLab.sds.colRoiPre5Tip": {
    en: "Estimated % vs T−60 at T−5",
    it: "Stima % vs T−60 a T−5",
  },
  "decisionLab.sds.colRoiPost4Tip": {
    en: "Estimated % vs T−60 at T+4 (4 days after CD)",
    it: "Stima % vs T−60 a T+4 (4 giorni dopo il CD)",
  },
  "decisionLab.sds.compareChart.postRefTitle": {
    en: "Post-CD reference μ (rise / neutral / decline)",
    it: "μ di riferimento post-CD (rialzo / neutro / ribasso)",
  },
  "decisionLab.sds.colAction": {
    en: "Decision",
    it: "Decisione",
  },
  "decisionLab.sds.selectRow": {
    en: "Select a ticker for cluster breakdown and investment card.",
    it: "Seleziona un ticker per breakdown cluster e scheda investimento.",
  },
  "decisionLab.sds.closeDetail": {
    en: "Close",
    it: "Chiudi",
  },
  "decisionLab.sds.investmentCard": {
    en: "Investment decision",
    it: "Decisione investimento",
  },
  "decisionLab.sds.action": {
    en: "Action",
    it: "Azione",
  },
  "decisionLab.sds.size": {
    en: "Size",
    it: "Size",
  },
  "decisionLab.sds.reliability": {
    en: "Reliability",
    it: "Affidabilità",
  },
  "decisionLab.sds.notReliable": {
    en: "not reliable — outside the window, no estimate",
    it: "non affidabile — fuori finestra, nessuna stima",
  },
  "decisionLab.sds.missingData": {
    en: "Missing data estimate: {pct}%",
    it: "Dati mancanti stimati: {pct}%",
  },
  "decisionLab.sds.cluster.catalyst": {
    en: "A · Catalyst quality",
    it: "A · Qualità catalizzatore",
  },
  "decisionLab.sds.cluster.institutional": {
    en: "B · Institutional signal",
    it: "B · Segnale istituzionale",
  },
  "decisionLab.sds.cluster.price": {
    en: "C · Price structure",
    it: "C · Struttura prezzo",
  },
  "decisionLab.sds.cluster.fundamentals": {
    en: "D · Fundamentals",
    it: "D · Fondamentali",
  },
  "decisionLab.sds.cluster.timing": {
    en: "E · Timing",
    it: "E · Timing",
  },
  "decisionLab.sds.shortFloat": {
    en: "Short float",
    it: "Short float",
  },
  "decisionLab.sds.analystScore": {
    en: "Analyst upgrades (30d)",
    it: "Upgrade analisti (30g)",
  },
  "decisionLab.sds.fmpFetched": {
    en: "FMP cluster B refreshed",
    it: "Cluster B FMP aggiornato",
  },
  "decisionLab.sds.lightRefresh": {
    en: "light refresh (C+E prices)",
    it: "refresh leggero (C+E prezzi)",
  },
  "decisionLab.sds.lastFmpRefresh": {
    en: "last FMP full @ {at}",
    it: "ultimo FMP completo @ {at}",
  },
  "decisionLab.sds.fmpMissingKey": {
    en: "FMP_API_KEY not set — short/analyst from cache only",
    it: "FMP_API_KEY assente — short/analyst solo da cache",
  },
  "decisionLab.sds.clusterAFetched": {
    en: "Cluster A (openFDA) refreshed",
    it: "Cluster A (openFDA) aggiornato",
  },
  "decisionLab.sds.clusterA.title": {
    en: "Cluster A — catalyst quality",
    it: "Cluster A — catalyst quality",
  },
  "decisionLab.sds.clusterB.title": {
    en: "Cluster B — institutional signal",
    it: "Cluster B — institutional signal",
  },
  "decisionLab.sds.clusterC.title": {
    en: "Cluster C — price structure",
    it: "Cluster C — price structure",
  },
  "decisionLab.sds.clusterD.title": {
    en: "Cluster D — fundamentals",
    it: "Cluster D — fundamentals",
  },
  "decisionLab.sds.clusterE.title": {
    en: "Cluster E — timing",
    it: "Cluster E — timing",
  },
  "decisionLab.sds.comp.title": {
    en: "Component breakdown",
    it: "Dettaglio componenti",
  },
  "decisionLab.sds.comp.missing": {
    en: "missing",
    it: "mancante",
  },
  "decisionLab.sds.comp.insufficientHistory": {
    en: "insufficient history",
    it: "storico insufficiente",
  },
  "decisionLab.sds.comp.notImplemented": {
    en: "planned",
    it: "in roadmap",
  },
  "decisionLab.sds.comp.na": {
    en: "N/A",
    it: "N/D",
  },
  "decisionLab.sds.clusterB.shortLabel": {
    en: "Short {pct}% · {dtc}d to cover",
    it: "Short {pct}% · {dtc}g to cover",
  },
  "decisionLab.sds.clusterB.squeezeSetup": {
    en: "Squeeze setup",
    it: "Setup squeeze",
  },
  "decisionLab.sds.clusterB.bearishSignal": {
    en: "Bearish signal",
    it: "Segnale bearish",
  },
  "decisionLab.sds.clusterB.tier1Coverage": {
    en: "Tier 1 coverage",
    it: "Copertura Tier 1",
  },
  "decisionLab.sds.clusterB.multipleDowngrades": {
    en: "Multiple downgrades",
    it: "Downgrade multipli",
  },
  "decisionLab.sds.clusterB.noRecentCoverage": {
    en: "No recent coverage",
    it: "Nessuna copertura recente",
  },
  "decisionLab.sds.clusterB.premiumFund": {
    en: "Premium fund ✓",
    it: "Premium fund ✓",
  },
  "decisionLab.sds.clusterB.stale13f": {
    en: "Stale — next 13F due soon",
    it: "Datato — prossimo 13F in arrivo",
  },
  "decisionLab.sds.clusterB.instExit": {
    en: "Institutional exit",
    it: "Uscita istituzionale",
  },
  "decisionLab.sds.clusterB.ago": {
    en: "ago",
    it: "fa",
  },
  "decisionLab.sds.clusterC.bbTooltip": {
    en: "BB width at {pct}th percentile of 6-month history. {interp}. Lower = more compressed = higher breakout potential.",
    it: "BB width al {pct}° percentile dello storico 6 mesi. {interp}. Più basso = più compresso = maggiore potenziale breakout.",
  },
  "decisionLab.sds.clusterC.obvTooltip": {
    en: "OBV pattern: {pattern}. Price slope: {slope}%/day. OBV slope: {obvDir}.",
    it: "Pattern OBV: {pattern}. Slope prezzo: {slope}%/g. Slope OBV: {obvDir}.",
  },
  "decisionLab.sds.clusterC.xbiTooltip": {
    en: "90-day return: ticker {tkRet}% vs XBI {xbiRet}%. Alpha vs sector: {alpha}%.",
    it: "Rendimento 90g: ticker {tkRet}% vs XBI {xbiRet}%. Alpha vs settore: {alpha}%.",
  },
  "decisionLab.sds.clusterC.volTooltip": {
    en: "5-day avg volume is {ratio5}x the 20-day average. Today: {ratioToday}x average.",
    it: "Volume medio 5g è {ratio5}x la media 20g. Oggi: {ratioToday}x la media.",
  },
  "decisionLab.sds.clusterD.runwayLabel": {
    en: "~{mo}mo runway · ${burn}M/mo burn",
    it: "~{mo}mesi runway · ${burn}M/mese burn",
  },
  "decisionLab.sds.clusterD.caution": {
    en: "Caution",
    it: "Attenzione",
  },
  "decisionLab.sds.clusterD.dilutionRisk": {
    en: "Dilution risk",
    it: "Rischio diluzione",
  },
  "decisionLab.sds.clusterD.cashCrisisBanner": {
    en: "CASH CRISIS — SDS suspended",
    it: "CRISI LIQUIDITÀ — SDS sospeso",
  },
  "decisionLab.sds.clusterD.mcTooltip": {
    en: "MC ${mcap}B vs pipeline NPV est. ${npv}B ({prob}% approval prob × ${peak}B peak sales × 5x multiple)",
    it: "MC ${mcap}B vs NPV pipeline stim. ${npv}B ({prob}% prob approvazione × ${peak}B peak sales × 5x multiplo)",
  },
  "decisionLab.sds.clusterD.undervalued": {
    en: "Undervalued",
    it: "Sottovalutato",
  },
  "decisionLab.sds.clusterD.stretched": {
    en: "Stretched valuation",
    it: "Valutazione elevata",
  },
  "decisionLab.sds.clusterD.maTarget": {
    en: "M&A target",
    it: "Target M&A",
  },
  "decisionLab.sds.clusterD.maDisclaimer": {
    en: "Rule-based estimate · not financial advice",
    it: "Stima rule-based · non consulenza finanziaria",
  },
  "decisionLab.sds.clusterE.countdown": {
    en: "T-{days} days to CD",
    it: "T-{days} giorni al CD",
  },
  "decisionLab.sds.clusterE.cdPassed": {
    en: "CD passed",
    it: "CD superato",
  },
  "decisionLab.sds.clusterE.binaryBanner": {
    en: "Binary event within 7 days — new entries suspended",
    it: "Evento binario entro 7 giorni — nuove entry sospese",
  },
  "decisionLab.sds.clusterE.qualityModifier": {
    en: "Quality modifier {mod} applied to window score",
    it: "Modificatore qualità {mod} applicato al window score",
  },
  "decisionLab.sds.comp.phaseCred": {
    en: "Phase credibility",
    it: "Phase credibility",
  },
  "decisionLab.sds.comp.endpointCred": {
    en: "Endpoint credibility",
    it: "Endpoint credibility",
  },
  "decisionLab.sds.comp.unmetNeed": {
    en: "Unmet need",
    it: "Unmet need",
  },
  "decisionLab.sds.comp.marketSize": {
    en: "Market size",
    it: "Market size",
  },
  "decisionLab.sds.comp.instDelta": {
    en: "Institutional Δ (13F)",
    it: "Institutional Δ (13F)",
  },
  "decisionLab.sds.comp.shortInterest": {
    en: "Short interest",
    it: "Short interest",
  },
  "decisionLab.sds.comp.analystUpgrade": {
    en: "Analyst upgrades",
    it: "Analyst upgrades",
  },
  "decisionLab.sds.comp.bbSqueeze": {
    en: "Bollinger squeeze",
    it: "Bollinger squeeze",
  },
  "decisionLab.sds.comp.obv": {
    en: "OBV accumulation",
    it: "OBV accumulation",
  },
  "decisionLab.sds.comp.xbiRs": {
    en: "Relative strength vs XBI",
    it: "Forza relativa vs XBI",
  },
  "decisionLab.sds.comp.volRatio": {
    en: "Volume ratio (5d)",
    it: "Volume ratio (5d)",
  },
  "decisionLab.sds.comp.cashRunway": {
    en: "Cash runway",
    it: "Cash runway",
  },
  "decisionLab.sds.comp.mcPipeline": {
    en: "MC / pipeline ratio",
    it: "MC / pipeline ratio",
  },
  "decisionLab.sds.comp.maAttr": {
    en: "M&A attractiveness",
    it: "M&A attractiveness",
  },
  "decisionLab.sds.comp.catWindow": {
    en: "Catalyst window",
    it: "Catalyst window",
  },
  "decisionLab.sds.comp.seqCat": {
    en: "Sequential catalysts",
    it: "Catalyst sequenziali",
  },
  "decisionLab.sds.clusterA.detailToggle": {
    en: "Show scoring details",
    it: "Dettaglio punteggio",
  },
  "decisionLab.sds.clusterA.detailHide": {
    en: "Hide scoring details",
    it: "Nascondi dettaglio",
  },
  "decisionLab.sds.clusterA.phaseDetected": {
    en: "Phase detected",
    it: "Fase rilevata",
  },
  "decisionLab.sds.clusterA.bonuses": {
    en: "Bonuses",
    it: "Bonus",
  },
  "decisionLab.sds.clusterA.endpointType": {
    en: "Endpoint type",
    it: "Tipo endpoint",
  },
  "decisionLab.sds.clusterA.keyword": {
    en: "Keyword",
    it: "Keyword",
  },
  "decisionLab.sds.clusterA.approvedDrugs": {
    en: "Approved drugs (openFDA)",
    it: "Farmaci approvati (openFDA)",
  },
  "decisionLab.sds.clusterA.firstInClass": {
    en: "First-in-class",
    it: "First-in-class",
  },
  "decisionLab.sds.clusterA.tamBn": {
    en: "TAM estimate ($B)",
    it: "Stima TAM ($B)",
  },
  "decisionLab.sds.clusterA.source": {
    en: "Source",
    it: "Fonte",
  },
  "decisionLab.sds.approvedDrugs": {
    en: "Approved drugs",
    it: "Farmaci approvati",
  },
  "decisionLab.sds.unmetNeed": {
    en: "Unmet need",
    it: "Unmet need",
  },
  "decisionLab.sds.marketSize": {
    en: "Market size",
    it: "Market size",
  },
  "decisionLab.sds.firstInClass": {
    en: "First-in-class",
    it: "First-in-class",
  },
  "decisionLab.sds.pipelineValue": {
    en: "Pipeline value (est.)",
    it: "Pipeline value (stim.)",
  },
  "decisionLab.sds.legend.btn": {
    en: "Legend",
    it: "Legenda",
  },
  "decisionLab.sds.tab.score": {
    en: "SDS Score",
    it: "Punteggio SDS",
  },
  "decisionLab.sds.tab.legend": {
    en: "Legend",
    it: "Legenda",
  },
  "decisionLab.sds.tab.history": {
    en: "History",
    it: "History",
  },
  "decisionLab.sds.readout.title": {
    en: "Score reading — SDS 0–100",
    it: "Lettura dello score — SDS 0–100",
  },
  "decisionLab.sds.readout.subtitle": {
    en: "Operating thresholds based on historical patterns ACRS, ANTX, CTMX, MDGL (+ BTAI as external comparator)",
    it: "Soglie operative basate sui pattern storici ACRS, ANTX, CTMX, MDGL (+ BTAI come comparatore esterno)",
  },
  "decisionLab.sds.readout.marker.distant": {
    en: "0 — Distant",
    it: "0 — Lontano",
  },
  "decisionLab.sds.readout.marker.watch": {
    en: "30 — Watch",
    it: "30 — Watch",
  },
  "decisionLab.sds.readout.marker.candidate": {
    en: "55 — Candidate",
    it: "55 — Candidato",
  },
  "decisionLab.sds.readout.marker.supernova": {
    en: "75+ — Supernova zone",
    it: "75+ — Zona supernova",
  },
  "decisionLab.sds.readout.zone.distant.label": {
    en: "0–30 Distant",
    it: "0–30 Lontano",
  },
  "decisionLab.sds.readout.zone.distant.desc": {
    en: "No action. Structural conditions are missing.",
    it: "Nessuna azione. Mancano condizioni strutturali.",
  },
  "decisionLab.sds.readout.zone.watch.label": {
    en: "30–55 Watch",
    it: "30–55 Watch",
  },
  "decisionLab.sds.readout.zone.watch.desc": {
    en: "Monitor. Start weekly data accumulation.",
    it: "Monitorare. Inizia accumulo dati settimanale.",
  },
  "decisionLab.sds.readout.zone.candidate.label": {
    en: "55–75 Candidate",
    it: "55–75 Candidato",
  },
  "decisionLab.sds.readout.zone.candidate.desc": {
    en: "Entry window. Small position, intense monitoring.",
    it: "Entry window. Posizione piccola, monitoring intenso.",
  },
  "decisionLab.sds.readout.zone.supernova.label": {
    en: "75–100 Supernova zone",
    it: "75–100 Zona supernova",
  },
  "decisionLab.sds.readout.zone.supernova.desc": {
    en: "All conditions aligned. Full position.",
    it: "Tutte le condizioni allineate. Posizione piena.",
  },
  "decisionLab.sds.compareChart.title": {
    en: "SuperNova vs historical surges",
    it: "SuperNova vs surge storici",
  },
  "decisionLab.sds.compareChart.subtitle": {
    en: "μ SuperNova mean curve alongside ACRS, ANTX, CTMX and MDGL (% vs T−60, cluster 1 cohort).",
    it: "Curva media μ SuperNova con ACRS, ANTX, CTMX e MDGL (% vs T−60, coorte cluster 1).",
  },
  "decisionLab.sds.compareChart.all": {
    en: "All reference",
    it: "Tutte ref.",
  },
  "decisionLab.sds.compareChart.onlyOverlays": {
    en: "Overlays only",
    it: "Solo overlay",
  },
  "decisionLab.sds.compareChart.showReferenceTip": {
    en: "Show all historical SuperNova reference curves",
    it: "Mostra tutte le curve storiche SuperNova di riferimento",
  },
  "decisionLab.sds.compareChart.onlyOverlaysTip": {
    en: "Hide μ SuperNova and historical surges — zoom Y-axis to overlay curves",
    it: "Nascondi μ SuperNova e surge storici — zoom asse Y sulle curve overlay",
  },
  "decisionLab.sds.compareChart.toggleSeriesTip": {
    en: "Click to show/hide this curve (Y-axis auto-scales to visible curves)",
    it: "Clic per mostrare/nascondere — asse Y adattato alle curve visibili",
  },
  "decisionLab.sds.compareChart.nowMarker": {
    en: "Today · {ticker} ({offset})",
    it: "Oggi · {ticker} ({offset})",
  },
  "decisionLab.sds.compareChart.nowMarkerShort": {
    en: "Today {offset}",
    it: "Oggi {offset}",
  },
  "decisionLab.sds.compareChart.yAxisAuto": {
    en: "Y-axis auto: {min}% … {max}% (visible curves only)",
    it: "Asse Y auto: {min}% … {max}% (solo curve visibili)",
  },
  "decisionLab.sds.compareChart.clickTickerHint": {
    en: "Click a ticker in the table below to overlay its Prediction + Recalibration curve (8-K, AI feed, daily open anchor) — estimated peak ROI (%) on chart. +EIS is not included in this overlay.",
    it: "Clicca un ticker nella tabella sotto per sovrapporre la curva Prediction + Recalibration (8-K, AI feed, ricalib quotidiana) — ROI stimato (%) sul grafico. +EIS non è incluso in questo overlay.",
  },
  "decisionLab.sds.compareChart.toggleTicker": {
    en: "Add/remove {ticker} curve on chart",
    it: "Aggiungi/rimuovi curva {ticker} sul grafico",
  },
  "decisionLab.sds.compareChart.noCurve": {
    en: "Chart curve not available — refresh Simulation",
    it: "Curva non disponibile — refresh Simulation",
  },
  "decisionLab.sds.compareChart.estimatedRoi": {
    en: "Peak {pct}% @ {offset}",
    it: "Picco {pct}% @ {offset}",
  },
  "decisionLab.sds.compareChart.estimatedRoiTooltip": {
    en: "Peak % vs T−60 on the Prediction + Recalibration curve ({pct}% at {offset}). Hover on the chart shows the value at that day only — not this peak.",
    it: "Picco % vs T−60 sulla curva Prediction + Recalibration ({pct}% a {offset}). Passando sul grafico vedi il valore di quel giorno — non il picco.",
  },
  "decisionLab.sds.compareChart.estimatedRoiShort": {
    en: "peak {pct}%@{offset}",
    it: "picco {pct}%@{offset}",
  },
  "decisionLab.sds.compareChart.cdOutlookShort": {
    en: "↓{pct}%@{offset}",
    it: "↓{pct}%@{offset}",
  },
  "decisionLab.sds.compareChart.cdOutlookTooltip": {
    en: "Expected % vs today at {offset} on the Prediction + Recalibration curve ({pct}% — curve declining toward CD).",
    it: "Atteso % vs oggi a {offset} sulla curva Prediction + Recalibration ({pct}% — curva in discesa verso CD).",
  },
  "decisionLab.sds.compareChart.roiLegend": {
    en: "Hover = % vs T−60 at that day (0.01 pp) · Solid dashed = Prediction + Recalibration · Violet dotted = SDS μ blend · Large dots = table knots T−10/T−5/T+4 · Chip = forward move from today (not absolute level)",
    it: "Hover = % vs T−60 in quel giorno (0,01 pp) · Tratteggio pieno = Prediction + Ricalibrazione · Viola punteggiato = blend μ SDS · Pallini grandi = nodi tabella T−10/T−5/T+4 · Chip = movimento da oggi (non livello assoluto)",
  },
  "decisionLab.sds.compareChart.blendCurveLabel": {
    en: "{ticker} μ SDS blend",
    it: "{ticker} μ blend SDS",
  },
  "decisionLab.sds.compareChart.blendCurveShort": {
    en: "μ SDS",
    it: "μ SDS",
  },
  "decisionLab.sds.compareChart.blendCurveTooltip": {
    en: "SDS-calibrated μ blend (% vs T−60): weighted historical profiles + SDS/cluster bonuses + up to ~45% live curve. Large dots = same knots as table T−10/T−5/T+4.",
    it: "Blend μ calibrato SDS (% vs T−60): profili storici pesati + bonus SDS/cluster + fino ~45% curva live. Pallini grandi = stessi nodi della tabella T−10/T−5/T+4.",
  },
  "decisionLab.sds.compareChart.blendTableKnot": {
    en: "table knot",
    it: "nodo tabella",
  },
  "decisionLab.sds.compareChart.overlayPeakTooltip": {
    en: "{label} · absolute at {offset}: {level}% vs T−60",
    it: "{label} · assoluto a {offset}: {level}% vs T−60",
  },
  "decisionLab.sds.history.btn": {
    en: "History",
    it: "History",
  },
  "decisionLab.sds.history.title": {
    en: "SuperNova — where it comes from",
    it: "SuperNova — da dove nasce",
  },
  "decisionLab.sds.history.subtitle": {
    en: "Empirical cluster of extraordinary pre-CD surges (+100%…+1800%) identified by k-means on % vs T−60 trajectories.",
    it: "Cluster empirico di surge pre-CD straordinari (+100%…+1800%) identificato con k-means sulle traiettorie % vs T−60.",
  },
  "decisionLab.sds.history.intro": {
    en: "SuperNova (cluster 1) is the minority k-means profile in the Prediction Guide cohort (N=4 vs ~631 in cluster 0). SDS measures how close a live ticker is to the conditions that preceded these moves — not the move itself.",
    it: "SuperNova (cluster 1) è il profilo minoritario k-means nella coorte Prediction Guide (N=4 vs ~631 nel cluster 0). L'SDS misura quanto un ticker live si avvicina alle condizioni che hanno preceduto questi movimenti — non il movimento in sé.",
  },
  "decisionLab.sds.history.chartTitle": {
    en: "μ SuperNova curve (% vs T−60)",
    it: "Curva μ SuperNova (% vs T−60)",
  },
  "decisionLab.sds.history.chartSubtitle": {
    en: "Mean of ACRS, ANTX, CTMX, MDGL — historical seq curves",
    it: "Media di ACRS, ANTX, CTMX, MDGL — curve seq storiche",
  },
  "decisionLab.sds.history.cdMarker": {
    en: "≈ CD",
    it: "≈ CD",
  },
  "decisionLab.sds.history.cohortTitle": {
    en: "Cluster 1 members",
    it: "Membri cluster 1",
  },
  "decisionLab.sds.history.observationsTitle": {
    en: "Three lessons for SuperNova & SDS",
    it: "Tre lezioni per SuperNova & SDS",
  },
  "decisionLab.sds.history.obs1.title": {
    en: "MDGL — the same molecule, two surges",
    it: "MDGL — la stessa molecola, due surge",
  },
  "decisionLab.sds.history.obs1.body": {
    en: "The most instructive case: MDGL surged twice on the same drug — Phase 2 (Dec 2017 / Jan 2018) and Phase 3 (Dec 2022 / Jan 2023). In both cases the market had partial information weeks before the formal CD (academic presentation). The DB CD marks the official readout; price action often starts earlier. SDS timing must allow pre-CD accumulation windows, not only T−0.",
    it: "Il caso più didattico: MDGL ha fatto il surge due volte sulla stessa molecola — Phase 2 (dic 2017 / gen 2018) e Phase 3 (dic 2022 / gen 2023). In entrambi i casi il mercato aveva informazioni parziali settimane prima della CD formale (presentazione accademica). La CD nel database segna il readout ufficiale; il prezzo spesso si muove prima. Il timing SDS deve includere finestre di accumulo pre-CD, non solo T−0.",
  },
  "decisionLab.sds.history.obs2.title": {
    en: "ANTX — surge without clinical data",
    it: "ANTX — surge senza dati clinici",
  },
  "decisionLab.sds.history.obs2.body": {
    en: "Important outlier: ANTX's move came from institutional financing, not a clinical readout. SuperNova should classify catalysts into at least three types — clinical data readout, regulatory milestone, corporate event (financing / partnership) — each with distinct price-action patterns. SDS cluster B (institutional signal) is especially relevant here.",
    it: "Outlier importante: il surge di ANTX viene da un financing istituzionale, non da dati clinici. SuperNova dovrebbe classificare i catalyst in almeno tre categorie — clinical data readout, regulatory milestone, corporate event (financing/partnership) — con pattern di price action distinti. Il cluster B SDS (segnale istituzionale) è particolarmente rilevante qui.",
  },
  "decisionLab.sds.history.obs3.title": {
    en: "CTMX — sequential catalysts over 12 months",
    it: "CTMX — catalyst sequenziali su 12 mesi",
  },
  "decisionLab.sds.history.obs3.body": {
    en: "Surges can stack sequentially: multiple catalysts in a ~90-day window (data readout + follow-on offering + analyst upgrade). The DB CD may capture only one node. SDS sequential-catalyst score (+2 pts per extra event) reflects this — watch the full calendar, not a single date.",
    it: "I surge possono essere sequenziali: più catalyst in una finestra ~90 giorni (data readout + follow-on offering + upgrade analisti). La CD nel database può catturare solo un nodo. Lo score sequential-catalyst SDS (+2 pt per evento extra) riflette questo — guardare tutto il calendario, non una sola data.",
  },
  "decisionLab.sds.history.taxonomyNote": {
    en: "Next step: formal catalyst taxonomy (clinical / regulatory / corporate) with expected price-action templates — foundation for SDS cluster E and catalyst-type weights.",
    it: "Prossimo passo: tassonomia formale dei catalyst (clinical / regulatory / corporate) con pattern di price action attesi — base per il cluster E SDS e pesi per tipo di evento.",
  },
  "decisionLab.sds.history.casesTitle": {
    en: "Historical case studies — cluster 1 (N=4)",
    it: "Case study storici — cluster 1 (N=4)",
  },
  "decisionLab.sds.history.candidatesTitle": {
    en: "Related surge — not in cluster 1",
    it: "Surge correlato — fuori dal cluster 1",
  },
  "decisionLab.sds.history.candidatesSubtitle": {
    en: "Useful comparator cited in the guide; not part of the k-means μ SuperNova curve until seq_curve % vs T−60 is verified.",
    it: "Comparatore citato nella guida; non entra nella curva μ SuperNova k-means finché la seq_curve % vs T−60 non è verificata.",
  },
  "decisionLab.sds.history.outsideClusterBadge": {
    en: "Outside cluster",
    it: "Fuori cluster",
  },
  "decisionLab.sds.history.patternsTitle": {
    en: "Common patterns — lessons for SuperNova",
    it: "Pattern comuni — lezioni per SuperNova",
  },
  "decisionLab.sds.history.patterns.amplifiers": {
    en: "Surge amplifiers",
    it: "Amplificatori del surge",
  },
  "decisionLab.sds.history.patterns.preSurge": {
    en: "Detectable pre-surge signals",
    it: "Segnali pre-surge rilevabili",
  },
  "decisionLab.sds.history.patterns.amp1": {
    en: "First-in-class in orphan indication",
    it: "First-in-class in indicazione orfana",
  },
  "decisionLab.sds.history.patterns.amp2": {
    en: "Dual / multiple primary endpoints",
    it: "Dual/multiple primary endpoints",
  },
  "decisionLab.sds.history.patterns.amp3": {
    en: "Biopsy endpoint (NASH gold standard)",
    it: "Biopsy endpoint (gold standard NASH)",
  },
  "decisionLab.sds.history.patterns.amp4": {
    en: "Active M&A speculation",
    it: "M&A speculation attiva",
  },
  "decisionLab.sds.history.patterns.amp5": {
    en: "Institutional entry (13F + placement)",
    it: "Istituzionali entranti (13F + placement)",
  },
  "decisionLab.sds.history.patterns.pre1": {
    en: "High short interest → potential squeeze",
    it: "Short interest alto → squeeze potenziale",
  },
  "decisionLab.sds.history.patterns.pre2": {
    en: "Abnormal volume 2–3 weeks before",
    it: "Volume anomalo 2–3 settimane prima",
  },
  "decisionLab.sds.history.patterns.pre3": {
    en: "Goldman / Leerink coverage initiation",
    it: "Goldman/Leerink coverage initiation",
  },
  "decisionLab.sds.history.patterns.pre4": {
    en: "Pipeline expansion announcement",
    it: "Pipeline expansion announcement",
  },
  "decisionLab.sds.history.patterns.pre5": {
    en: "Cash runway extension (financing)",
    it: "Cash runway extension (financing)",
  },
  "decisionLab.sds.history.field.drug": { en: "Drug", it: "Drug" },
  "decisionLab.sds.history.field.indication": { en: "Indication", it: "Indicazione" },
  "decisionLab.sds.history.field.keyResult": { en: "Key result", it: "Risultato chiave" },
  "decisionLab.sds.history.field.cdIndicated": { en: "CD indicated", it: "CD indicata" },
  "decisionLab.sds.history.field.safety": { en: "Safety", it: "Safety" },
  "decisionLab.sds.history.field.surgeTiming": { en: "Surge timing", it: "Timing surge" },
  "decisionLab.sds.history.field.marketPotential": { en: "Market potential", it: "Mercato potenziale" },
  "decisionLab.sds.history.field.buyoutNarrative": { en: "Buyout narrative", it: "Buyout narrative" },
  "decisionLab.sds.history.field.endpoint1": { en: "Endpoint 1", it: "Endpoint 1" },
  "decisionLab.sds.history.field.endpoint2": { en: "Endpoint 2", it: "Endpoint 2" },
  "decisionLab.sds.history.field.patients": { en: "Patients", it: "Pazienti" },
  "decisionLab.sds.history.field.outcome": { en: "Outcome", it: "Outcome" },
  "decisionLab.sds.history.field.event": { en: "Event", it: "Evento" },
  "decisionLab.sds.history.field.runway": { en: "Runway", it: "Runway" },
  "decisionLab.sds.history.field.investors": { en: "Investors", it: "Investitori" },
  "decisionLab.sds.history.field.newProgram": { en: "New program", it: "Nuovo programma" },
  "decisionLab.sds.history.field.noteShort": { en: "Note", it: "Nota" },
  "decisionLab.sds.history.field.orr": { en: "ORR", it: "ORR" },
  "decisionLab.sds.history.field.dcr": { en: "DCR", it: "DCR" },
  "decisionLab.sds.history.field.volume": { en: "Volume", it: "Volume" },
  "decisionLab.sds.history.field.context": { en: "Context", it: "Contesto" },
  "decisionLab.sds.history.field.then": { en: "Then", it: "Poi" },
  "decisionLab.sds.history.field.specificData": { en: "Specific data", it: "Dati specifici" },
  "decisionLab.sds.history.case.acrs.gain": { en: "+220% (1-day)", it: "+220% (1 giorno)" },
  "decisionLab.sds.history.case.acrs.badge1": { en: "Positive Phase 2a", it: "Phase 2a positivo" },
  "decisionLab.sds.history.case.acrs.badge2": { en: "New mechanism of action", it: "Nuovo meccanismo d'azione" },
  "decisionLab.sds.history.case.acrs.date": { en: "19 Jan 2021", it: "19 Gen 2021" },
  "decisionLab.sds.history.case.acrs.drug": { en: "ATI-450 (MK2 inhibitor)", it: "ATI-450 (MK2 inhibitor)" },
  "decisionLab.sds.history.case.acrs.keyResult": {
    en: "Durable DAS28-CRP reduction over 12 weeks (Phase 2a topline)",
    it: "Riduzione DAS28-CRP sostenuta a 12 settimane (topline Phase 2a)",
  },
  "decisionLab.sds.history.case.acrs.cdIndicated": { en: "04/02/2021", it: "04/02/2021" },
  "decisionLab.sds.history.case.acrs.indication": { en: "Rheumatoid arthritis", it: "Artrite reumatoide" },
  "decisionLab.sds.history.case.acrs.safety": { en: "No serious adverse events", it: "No eventi avversi seri" },
  "decisionLab.sds.history.case.acrs.surgeTiming": { en: "~2 weeks before CD", it: "~2 settimane prima della CD" },
  "decisionLab.sds.history.case.acrs.noteTitle": { en: "Why it surged", it: "Perché è esploso" },
  "decisionLab.sds.history.case.acrs.noteBody": {
    en: "MK2 is a novel target for RA — no approved drug with this mechanism. On 19 Jan 2021 the stock rose ~+220% in one session on Phase 2a topline (12-week activity, generally well tolerated). The market priced both efficacy and commercial optionality in a large indication; no serious safety signal removed the main residual risk. Formal ACR congress presentation followed on 04 Feb 2021 (DB CD).",
    it: "MK2 è un target nuovo per la RA — nessun farmaco approvato con questo meccanismo. Il 19 gen 2021 il titolo è salito ~+220% in una sessione sulla topline Phase 2a (attività a 12 settimane, generalmente ben tollerato). Il mercato ha prezzato efficacia e opzionalità commerciale in un'indicazione grande; nessun segnale di safety serio ha rimosso il rischio residuo principale. Presentazione formale al congresso ACR il 04/02/2021 (CD nel DB).",
  },
  "decisionLab.sds.history.case.mdglP2.gain": { en: "+600% (12-mo leg)", it: "+600% (tranche 12 mesi)" },
  "decisionLab.sds.history.case.mdglP2.badge1": { en: "Positive Phase 2 NASH biopsy", it: "Phase 2 NASH biopsy positivo" },
  "decisionLab.sds.history.case.mdglP2.badge2": { en: "First-in-class", it: "First-in-class" },
  "decisionLab.sds.history.case.mdglP2.date": { en: "Dec 2017 – Jan 2018", it: "Dic 2017 – Gen 2018" },
  "decisionLab.sds.history.case.mdglP2.drug": { en: "MGL-3196 / resmetirom (THR-β agonist)", it: "MGL-3196 / resmetirom (THR-β agonist)" },
  "decisionLab.sds.history.case.mdglP2.keyResult": {
    en: "Dec 2017: 12-wk MRI-PDFF primary met. May 2018: 27% NASH resolution vs 6% pbo; fibrosis resolved in 50% of NASH responders",
    it: "Dic 2017: primary MRI-PDFF a 12 sett. Mag 2018: 27% NASH resolution vs 6% pbo; fibrosi risolta nel 50% dei responder NASH",
  },
  "decisionLab.sds.history.case.mdglP2.cdIndicated": { en: "15/01/2018 (DB) · move from Dec 2017", it: "15/01/2018 (DB) · move da dic 2017" },
  "decisionLab.sds.history.case.mdglP2.indication": {
    en: "NASH — no approved drugs",
    it: "NASH — nessun farmaco approvato",
  },
  "decisionLab.sds.history.case.mdglP2.marketPotential": {
    en: "$4B (Goldman Sachs peak sales est.)",
    it: "$4B (Goldman Sachs peak sales est.)",
  },
  "decisionLab.sds.history.case.mdglP2.buyoutNarrative": {
    en: "Yes — M&A speculation amplifies the move",
    it: "Sì — M&A speculation amplifica il move",
  },
  "decisionLab.sds.history.case.mdglP2.noteTitle": {
    en: "Why it surged (most instructive case)",
    it: "Perché è esploso (il caso più didattico)",
  },
  "decisionLab.sds.history.case.mdglP2.noteBody": {
    en: "Three simultaneous amplifiers: (1) first-in-class in an indication with no approved drugs, (2) Phase 2 with biopsy endpoints — the most credible possible for NASH, (3) active M&A speculation. The first surge came with the Dec 2017 12-week MRI-PDFF primary readout; 36-week biopsy topline followed on 31 May 2018 (formal AASLD presentation Nov 2018). The DB CD (15 Jan 2018) marks the official calendar milestone — price action often starts earlier. Over ~12 months from Dec 2017 the stock rose up to ~+1800% (guide estimate, M&A rumors amplified).",
    it: "Tre amplificatori simultanei: (1) first-in-class in indicazione senza farmaci approvati, (2) Phase 2 con endpoint biopsy — il più credibile possibile per NASH, (3) speculazione M&A attiva. Il primo surge è arrivato con la primary MRI-PDFF a 12 settimane (dic 2017); la topline biopsy a 36 settimane il 31 mag 2018 (presentazione AASLD nov 2018). La CD nel DB (15 gen 2018) segna il milestone ufficiale — il prezzo spesso si muove prima. In ~12 mesi da dic 2017 il titolo è salito fino a ~+1800% (stima guida, rumors M&A).",
  },
  "decisionLab.sds.history.case.mdglP3.gain": { en: "+244–268%", it: "+244–268%" },
  "decisionLab.sds.history.case.mdglP3.badge1": { en: "Positive pivotal Phase 3", it: "Phase 3 pivotal positivo" },
  "decisionLab.sds.history.case.mdglP3.badge2": { en: "Dual primary endpoint", it: "Dual primary endpoint" },
  "decisionLab.sds.history.case.mdglP3.date": { en: "19 Dec 2022", it: "19 Dic 2022" },
  "decisionLab.sds.history.case.mdglP3.drug": { en: "Resmetirom — MAESTRO-NASH Phase 3", it: "Resmetirom — MAESTRO-NASH Phase 3" },
  "decisionLab.sds.history.case.mdglP3.endpoint1": {
    en: "NASH resolution: 26–30% vs 10–14% placebo",
    it: "NASH resolution: 26–30% vs 10–14% placebo",
  },
  "decisionLab.sds.history.case.mdglP3.cdIndicated": { en: "06/01/2023", it: "06/01/2023" },
  "decisionLab.sds.history.case.mdglP3.patients": {
    en: "950+ — full pivotal study",
    it: "950+ — studio pivotale completo",
  },
  "decisionLab.sds.history.case.mdglP3.endpoint2": {
    en: "Fibrosis improvement: 24–26% vs 14% placebo",
    it: "Fibrosis improvement: 24–26% vs 14% placebo",
  },
  "decisionLab.sds.history.case.mdglP3.outcome": {
    en: "FDA approval Mar 2024 as Rezdiffra",
    it: "FDA approval marzo 2024 come Rezdiffra",
  },
  "decisionLab.sds.history.case.mdglP3.noteTitle": {
    en: "Why it surged (second act)",
    it: "Perché è esploso (secondo atto)",
  },
  "decisionLab.sds.history.case.mdglP3.noteBody": {
    en: "Phase 3 with both primary endpoints — the maximum regulatory credibility threshold. The market knew an NDA would follow within months. On 19 Dec 2022 the stock rose from ~$63.80 to ~$234.83 (+268%) in one session; it reached ~$289 by 21 Dec. The January 2023 CD (06 Jan) was the formal data presentation after the December pre-announcement.",
    it: "Phase 3 con entrambi i primary endpoint — soglia massima di credibilità regolatoria. Il mercato sapeva che l'NDA sarebbe seguita entro mesi. Il 19 dic 2022 il titolo è passato da ~$63,80 a ~$234,83 (+268%) in una sessione; ~$289 entro il 21 dic. La CD di gennaio 2023 (06 gen) era la presentazione formale dopo il pre-annuncio di dicembre.",
  },
  "decisionLab.sds.history.case.antx.gain": { en: "+93%", it: "+93%" },
  "decisionLab.sds.history.case.antx.badge1": { en: "$40M private placement", it: "Private placement $40M" },
  "decisionLab.sds.history.case.antx.badge2": { en: "Pipeline expansion", it: "Pipeline expansion" },
  "decisionLab.sds.history.case.antx.date": { en: "9 Mar 2026", it: "9 Mar 2026" },
  "decisionLab.sds.history.case.antx.event": { en: "$40M institutional private placement", it: "$40M private placement istituzionale" },
  "decisionLab.sds.history.case.antx.runway": { en: "Extended to 2029", it: "Esteso fino al 2029" },
  "decisionLab.sds.history.case.antx.cdIndicated": { en: "14/03/2026", it: "14/03/2026" },
  "decisionLab.sds.history.case.antx.investors": { en: "Coastlands, Commodore, Vivo Capital", it: "Coastlands, Commodore, Vivo Capital" },
  "decisionLab.sds.history.case.antx.newProgram": {
    en: "Phase 2 in polycythemia vera (PV)",
    it: "Phase 2 in polycythemia vera (PV)",
  },
  "decisionLab.sds.history.case.antx.noteShort": {
    en: "Pre-CD surge driven by financing, not clinical data",
    it: "Surge pre-CD guidato da financing, non da dati clinici",
  },
  "decisionLab.sds.history.case.antx.noteTitle": {
    en: "Why it surged — different from the others",
    it: "Perché è esploso — caso diverso dagli altri",
  },
  "decisionLab.sds.history.case.antx.noteBody": {
    en: "This is not a clinical catalyst — it is a financial catalyst. The private placement from specialized healthcare funds signaled institutional belief in the pipeline. Timing with the CD is correlation, not direct cause. Important for SuperNova: this pattern (financing + pipeline expansion) is a distinct signal to classify separately.",
    it: "Questo non è un catalyst clinico — è un catalyst finanziario. Il private placement da fondi healthcare specializzati ha segnalato al mercato che gli istituzionali credono nella pipeline. Il timing con la CD è correlazione, non causa diretta. Importante per SuperNova: questo pattern (financing + pipeline expansion) è un segnale distinto da classificare separatamente.",
  },
  "decisionLab.sds.history.case.ctmx.gain": { en: "+44% (Mar 2026)", it: "+44% (Mar 2026)" },
  "decisionLab.sds.history.case.ctmx.badge1": { en: "Positive Phase 1 expansion", it: "Phase 1 expansion positivo" },
  "decisionLab.sds.history.case.ctmx.badge2": { en: "Oncology ADC", it: "ADC oncologia" },
  "decisionLab.sds.history.case.ctmx.date": { en: "16 Mar 2026", it: "16 Mar 2026" },
  "decisionLab.sds.history.case.ctmx.drug": { en: "Varseta-M (CX-2051) — EpCAM ADC", it: "Varseta-M (CX-2051) — EpCAM ADC" },
  "decisionLab.sds.history.case.ctmx.orr": { en: "28–32% response rate", it: "28–32% response rate" },
  "decisionLab.sds.history.case.ctmx.volume": { en: "2211% above 3-month average", it: "2211% sopra media 3 mesi" },
  "decisionLab.sds.history.case.ctmx.indication": {
    en: "Metastatic colorectal cancer late-line",
    it: "Colorectal cancer metastatico late-line",
  },
  "decisionLab.sds.history.case.ctmx.dcr": { en: "94% disease control rate", it: "94% disease control rate" },
  "decisionLab.sds.history.case.ctmx.cdIndicated": {
    en: "04/06/2025 — ~1 year before data presented",
    it: "04/06/2025 — 1 anno prima dei dati presentati",
  },
  "decisionLab.sds.history.case.ctmx.noteTitle": {
    en: "Critical note for SuperNova",
    it: "Nota critica per SuperNova",
  },
  "decisionLab.sds.history.case.ctmx.noteBody": {
    en: "The indicated CD (04/06/2025) is ~9 months from the main surge (March 2026). The stock rose +1000% over 12 months across multiple progressive catalysts (Q1 data → expansion data → follow-on offering). Not a single event but a sequence. The DB CD may refer to an intermediate milestone, not the final surge.",
    it: "La CD indicata (04/06/2025) è distante ~9 mesi dal surge principale (marzo 2026). Il titolo è salito +1000% nell'arco di 12 mesi su più catalyst progressivi (Q1 data → expansion data → follow-on offering). Non è un evento singolo ma una sequenza. La CD nel database potrebbe riferirsi a un milestone intermedio, non al surge finale.",
  },
  "decisionLab.sds.history.case.btai.gain": { en: "To verify", it: "Da verificare" },
  "decisionLab.sds.history.case.btai.badge1": { en: "CD: 21 May 2020", it: "CD: 21 Mag 2020" },
  "decisionLab.sds.history.case.btai.badge2": { en: "BXCL501 Phase 2", it: "BXCL501 Phase 2" },
  "decisionLab.sds.history.case.btai.date": { en: "~May 2020", it: "~Mag 2020" },
  "decisionLab.sds.history.case.btai.drug": {
    en: "BXCL501 — sublingual dexmedetomidine",
    it: "BXCL501 — dexmedetomidine sublinguale",
  },
  "decisionLab.sds.history.case.btai.context": {
    en: "Phase 2 SERENITY — stock peak in 2020",
    it: "Phase 2 SERENITY — picco stock nel 2020",
  },
  "decisionLab.sds.history.case.btai.cdIndicated": { en: "21/05/2020", it: "21/05/2020" },
  "decisionLab.sds.history.case.btai.indication": {
    en: "Agitation in schizophrenia / bipolar",
    it: "Agitazione in schizofrenia/bipolare",
  },
  "decisionLab.sds.history.case.btai.then": {
    en: "FDA approval 2022 as IGALMI",
    it: "FDA approval 2022 come IGALMI",
  },
  "decisionLab.sds.history.case.btai.specificData": {
    en: "Not found — confirmation required",
    it: "Non trovati — conferma richiesta",
  },
  "decisionLab.sds.history.case.btai.noteTitle": { en: "Note", it: "Nota" },
  "decisionLab.sds.history.case.btai.noteBody": {
    en: "BTAI is not in k-means cluster 1 (μ SuperNova = ACRS, ANTX, CTMX, MDGL only). It is kept here as a guide comparator: public data show a significant 2020 peak around SERENITY Phase 2/3 for BXCL501, but the cited ~+500% and the seq_curve % vs T−60 still need direct price verification before inclusion in the cluster.",
    it: "BTAI non è nel cluster 1 k-means (μ SuperNova = solo ACRS, ANTX, CTMX, MDGL). Resta qui come comparatore della guida: i dati pubblici mostrano un picco significativo nel 2020 intorno a SERENITY Phase 2/3 per BXCL501, ma il ~+500% citato e la seq_curve % vs T−60 vanno ancora verificati sui prezzi prima di includerlo nel cluster.",
  },
  "decisionLab.sds.legend.title": {
    en: "Supernova Distance Score — guide",
    it: "Supernova Distance Score — guida",
  },
  "decisionLab.sds.legend.subtitle": {
    en: "Investment evaluation indices for biotech — five clusters, thresholds, vetoes and formula.",
    it: "Indici di valutazione degli investimenti biotech — cinque cluster, soglie, veto e formula.",
  },
  "decisionLab.sds.legend.intro": {
    en: "SDS (0–100) measures how close a biotech stock is to conditions that historically preceded extraordinary surges (+100% to +1800%) around clinical events. SDS does not predict the surge — it measures distance from it. Operational threshold: SDS > 70 = supernova zone. SDS 55–70 still captures most pre-surge potential with lower risk.\n\nCluster 1 (μ SuperNova): ACRS · ANTX · CTMX · MDGL. BTAI is a cited comparator only — not in the k-means cluster until verified.",
    it: "Il Supernova Distance Score (SDS) è un punteggio continuo da 0 a 100 che misura quanto un titolo biotech si avvicina alle condizioni che storicamente precedono surge straordinari (+100% a +1800%) intorno agli eventi clinici.\n\nIl SDS non predice il surge — misura la distanza da esso. Soglia operativa: SDS > 70 = zona supernova. Anche SDS 55–70 cattura la maggior parte del potenziale pre-surge con rischio inferiore.\n\nCluster 1 (μ SuperNova): ACRS · ANTX · CTMX · MDGL. BTAI è solo un comparatore citato — non è nel cluster k-means finché non verificato.",
  },
  "decisionLab.sds.legend.thresholdsTitle": {
    en: "Operational SDS thresholds",
    it: "Soglie operative SDS",
  },
  "decisionLab.sds.legend.thresholdsBody": {
    en: "75–100 — SUPERNOVA ZONE — Full position (3–5% portfolio)\n55–74 — CANDIDATE — Small position, daily monitoring\n30–54 — WATCH — Monitor, no entry\n0–29 — FAR — No action",
    it: "75–100 — ZONA SUPERNOVA — Posizione piena (3–5% portafoglio)\n55–74 — CANDIDATO — Posizione piccola, monitoraggio giornaliero\n30–54 — WATCH — Monitorare, nessuna entrata\n0–29 — LONTANO — Nessuna azione",
  },
  "decisionLab.sds.legend.vetoTitle": {
    en: "Absolute vetoes (zero SDS regardless of score)",
    it: "Veto assoluti (azzerano SDS indipendentemente dal punteggio)",
  },
  "decisionLab.sds.legend.vetoBody": {
    en: "Cash runway < 3 months · Market regime CRISIS · Binary event within 7 days",
    it: "Cash runway < 3 mesi · Regime mercato CRISIS · Evento binario entro 7 giorni",
  },
  "decisionLab.sds.legend.formulaTitle": {
    en: "Full SDS formula",
    it: "Formula SDS completa",
  },
  "decisionLab.sds.legend.formulaBody": {
    en: "SDS = (A/45×30) + (B/26×25) + (C/28×20) + (D/23×15) + (E/10×10)\n\nA Catalyst Quality 30% (max 45 raw) · B Institutional Signal 25% (max 26) · C Price Structure 20% (max 28) · D Company Fundamentals 15% (max 23) · E Timing Proximity 10% (max 10)",
    it: "SDS = (A/45×30) + (B/26×25) + (C/28×20) + (D/23×15) + (E/10×10)\n\nA Catalyst Quality 30% (max 45 raw) · B Institutional Signal 25% (max 26) · C Price Structure 20% (max 28) · D Company Fundamentals 15% (max 23) · E Timing Proximity 10% (max 10)",
  },
  "decisionLab.sds.legend.confidenceNote": {
    en: "If data is missing for more than 40% of indices, SDS is flagged low confidence and does not generate operational recommendations. Minimum recommended coverage: 60% of indices.",
    it: "Se mancano dati per più del 40% degli indici, il SDS viene flaggato come 'bassa confidenza' e non genera raccomandazioni operative. Copertura minima raccomandata: 60% degli indici.",
  },
  "decisionLab.sds.legend.source": {
    en: "Source",
    it: "Fonte",
  },
  "decisionLab.sds.legend.colCriterion": {
    en: "Criterion",
    it: "Criterio",
  },
  "decisionLab.sds.legend.colPoints": {
    en: "Points",
    it: "Punti",
  },
  "decisionLab.sds.legend.rows.phase.p3pivotal": {
    en: "Phase 3 pivotal (NDA-enabling)",
    it: "Phase 3 pivotal (NDA-enabling)",
  },
  "decisionLab.sds.legend.rows.phase.p3nonpivotal": {
    en: "Phase 3 non-pivotal",
    it: "Phase 3 non-pivotal",
  },
  "decisionLab.sds.legend.rows.phase.p2b": {
    en: "Phase 2b",
    it: "Phase 2b",
  },
  "decisionLab.sds.legend.rows.phase.p2": {
    en: "Phase 2 / 2a",
    it: "Phase 2 / 2a",
  },
  "decisionLab.sds.legend.rows.phase.p1b2": {
    en: "Phase 1b/2",
    it: "Phase 1b/2",
  },
  "decisionLab.sds.legend.rows.phase.bonus": {
    en: "Bonuses: placebo-controlled +1 · dual primary endpoint +2 · biopsy endpoint (e.g. NASH) +2",
    it: "Bonus: placebo-controlled +1 · dual primary endpoint +2 · biopsy endpoint (es. NASH) +2",
  },
  "decisionLab.sds.legend.rows.endpoint.os": {
    en: "Overall Survival (OS)",
    it: "Overall Survival (OS)",
  },
  "decisionLab.sds.legend.rows.endpoint.biopsy": {
    en: "Biopsy / histologic",
    it: "Biopsy / istologico",
  },
  "decisionLab.sds.legend.rows.endpoint.pfsEfs": {
    en: "Progression-Free Survival (PFS) / Event-Free Survival (EFS)",
    it: "Progression-Free Survival (PFS) / Event-Free Survival (EFS)",
  },
  "decisionLab.sds.legend.rows.endpoint.composite": {
    en: "Objective composite endpoint",
    it: "Endpoint composito oggettivo",
  },
  "decisionLab.sds.legend.rows.endpoint.orr": {
    en: "ORR (Overall Response Rate)",
    it: "ORR (Overall Response Rate)",
  },
  "decisionLab.sds.legend.rows.endpoint.biomarker": {
    en: "Biomarker / pharmacologic",
    it: "Biomarker / farmacologico",
  },
  "decisionLab.sds.legend.rows.endpoint.pro": {
    en: "PRO (Patient Reported Outcome)",
    it: "PRO (Patient Reported Outcome)",
  },
  "decisionLab.sds.legend.rows.unmet.none": {
    en: "No approved drug in indication",
    it: "Nessun farmaco approvato nell'indicazione",
  },
  "decisionLab.sds.legend.rows.unmet.oneTwo": {
    en: "1–2 approved alternatives",
    it: "1–2 farmaci approvati",
  },
  "decisionLab.sds.legend.rows.unmet.crowded": {
    en: "Crowded indication (3+ approved)",
    it: "Indicazione affollata (3+ approvati)",
  },
  "decisionLab.sds.legend.rows.unmet.bonus": {
    en: "Bonus: first-in-class mechanism +3",
    it: "Bonus: meccanismo first-in-class +3",
  },
  "decisionLab.sds.legend.rows.unmet.example": {
    en: "Example: NASH in 2018 had no approved drug → max score. MDGL was the only game in town.",
    it: "Esempio: NASH nel 2018 non aveva nessun farmaco approvato → score massimo. MDGL era l'unico gioco in città.",
  },
  "decisionLab.sds.legend.rows.market.gt8b": {
    en: "> $8B peak sales",
    it: "> $8 mld peak sales",
  },
  "decisionLab.sds.legend.rows.market.5to8b": {
    en: "$5–8B",
    it: "$5–8 mld",
  },
  "decisionLab.sds.legend.rows.market.3to5b": {
    en: "$3–5B",
    it: "$3–5 mld",
  },
  "decisionLab.sds.legend.rows.market.1to3b": {
    en: "$1–3B",
    it: "$1–3 mld",
  },
  "decisionLab.sds.legend.rows.market.lt1b": {
    en: "< $1B",
    it: "< $1 mld",
  },
  "decisionLab.sds.legend.rows.market.example": {
    en: "Examples: $10B+ Alzheimer, obesity, diabetes · $7–9B lung/breast cancer, NASH · $4–6B RA, myeloma, melanoma",
    it: "Esempi: $10B+ Alzheimer, obesità, diabete · $7–9B cancro polmone/seno, NASH · $4–6B artrite reumatoide, mieloma, melanoma",
  },
  "decisionLab.sds.legend.rows.short.squeeze": {
    en: "Short >20% + positive momentum + DTC >5 (squeeze setup)",
    it: "Short >20% + momentum positivo + DTC >5 (squeeze setup)",
  },
  "decisionLab.sds.legend.rows.short.gt20Pos": {
    en: "Short >20% + positive momentum",
    it: "Short >20% + momentum positivo",
  },
  "decisionLab.sds.legend.rows.short.gt15": {
    en: "Short >15%",
    it: "Short >15%",
  },
  "decisionLab.sds.legend.rows.short.gt10": {
    en: "Short >10%",
    it: "Short >10%",
  },
  "decisionLab.sds.legend.rows.short.gt5": {
    en: "Short >5%",
    it: "Short >5%",
  },
  "decisionLab.sds.legend.rows.short.gt20Neg": {
    en: "Short >20% + negative momentum",
    it: "Short >20% + momentum negativo",
  },
  "decisionLab.sds.legend.rows.short.footnote": {
    en: "DTC = days to cover all short interest. DTC > 5 = potentially explosive squeeze.",
    it: "DTC = giorni per ricomprare tutto lo short. DTC > 5 = squeeze potenzialmente esplosivo.",
  },
  "decisionLab.sds.legend.rows.analyst.t1Init": {
    en: "Tier 1 initiation (14d)",
    it: "Initiation Tier 1 (14 gg)",
  },
  "decisionLab.sds.legend.rows.analyst.t1Upgrade": {
    en: "Tier 1 upgrade",
    it: "Upgrade Tier 1",
  },
  "decisionLab.sds.legend.rows.analyst.boutiqueInit": {
    en: "Boutique initiation",
    it: "Initiation boutique",
  },
  "decisionLab.sds.legend.rows.analyst.boutiqueUpgrade": {
    en: "Boutique upgrade",
    it: "Upgrade boutique",
  },
  "decisionLab.sds.legend.rows.analyst.t1Reiterated": {
    en: "Tier 1 reiterated",
    it: "Reiterated Tier 1",
  },
  "decisionLab.sds.legend.rows.analyst.downgrades": {
    en: "2+ downgrades in 60d",
    it: "2+ downgrades in 60 gg",
  },
  "decisionLab.sds.legend.rows.analyst.footnote": {
    en: "Tier 1: Goldman, Morgan Stanley, Jefferies, Leerink, SVB, Cowen, RBC, HC Wainwright, Cantor, Needham, Piper Sandler",
    it: "Tier 1: Goldman, Morgan Stanley, Jefferies, Leerink, SVB, Cowen, RBC, HC Wainwright, Cantor, Needham, Piper Sandler",
  },
  "decisionLab.sds.legend.rows.instOwn.premiumDelta": {
    en: "Premium fund + delta >5%",
    it: "Premium fund + delta >5%",
  },
  "decisionLab.sds.legend.rows.instOwn.premiumPresent": {
    en: "Premium fund present",
    it: "Premium fund presente",
  },
  "decisionLab.sds.legend.rows.instOwn.deltaGt15": {
    en: "Delta >15%",
    it: "Delta >15%",
  },
  "decisionLab.sds.legend.rows.instOwn.deltaGt8": {
    en: "Delta >8%",
    it: "Delta >8%",
  },
  "decisionLab.sds.legend.rows.instOwn.deltaGt3": {
    en: "Delta >3%",
    it: "Delta >3%",
  },
  "decisionLab.sds.legend.rows.instOwn.delta0to3": {
    en: "Delta 0–3%",
    it: "Delta 0–3%",
  },
  "decisionLab.sds.legend.rows.instOwn.exit": {
    en: "Significant institutional exit",
    it: "Uscita istituzionale significativa",
  },
  "decisionLab.sds.legend.rows.instOwn.footnote": {
    en: "Premium funds (2×): RA Capital, OrbiMed, Baker Bros, Perceptive, Vivo, Commodore, Foresite, Deerfield, Boxer, RTW, Eventide. Note: 13F data is always 45–90 days delayed (SEC requirement) — normal.",
    it: "Premium funds (2×): RA Capital, OrbiMed, Baker Bros, Perceptive, Vivo, Commodore, Foresite, Deerfield, Boxer, RTW, Eventide. Nota: dati 13F hanno 45–90 giorni di ritardo (obbligo SEC) — normale.",
  },
  "decisionLab.sds.legend.rows.bb.lt10": {
    en: "BB width < 10th percentile (6 mo)",
    it: "BB width < 10° percentile (6 mesi)",
  },
  "decisionLab.sds.legend.rows.bb.lt20": {
    en: "BB width < 20th percentile",
    it: "BB width < 20° percentile",
  },
  "decisionLab.sds.legend.rows.bb.lt35": {
    en: "BB width < 35th percentile",
    it: "BB width < 35° percentile",
  },
  "decisionLab.sds.legend.rows.bb.lt50": {
    en: "BB width < 50th percentile",
    it: "BB width < 50° percentile",
  },
  "decisionLab.sds.legend.rows.bb.gt50": {
    en: "BB width > 50th percentile",
    it: "BB width > 50° percentile",
  },
  "decisionLab.sds.legend.rows.bb.footnote": {
    en: "Largest surges (MDGL, ACRS) show BB squeeze 2–4 weeks before catalyst.",
    it: "I surge maggiori (MDGL, ACRS) mostrano BB squeeze nelle 2–4 settimane precedenti.",
  },
  "decisionLab.sds.legend.rows.obv.risingFlat": {
    en: "OBV rising + flat price (silent accumulation)",
    it: "OBV in salita + prezzo piatto (accumulo silenzioso)",
  },
  "decisionLab.sds.legend.rows.obv.risingDiv": {
    en: "OBV up + bullish divergence",
    it: "OBV in salita + divergenza rialzista",
  },
  "decisionLab.sds.legend.rows.obv.risingUp": {
    en: "OBV up + price up",
    it: "OBV in salita + prezzo in salita",
  },
  "decisionLab.sds.legend.rows.obv.risingWeak": {
    en: "OBV up + weak price",
    it: "OBV in salita + prezzo debole",
  },
  "decisionLab.sds.legend.rows.obv.downFlat": {
    en: "OBV down + flat price",
    it: "OBV in discesa + prezzo piatto",
  },
  "decisionLab.sds.legend.rows.obv.bothDown": {
    en: "Both OBV and price down",
    it: "OBV e prezzo entrambi in discesa",
  },
  "decisionLab.sds.legend.rows.obv.footnote": {
    en: "Key pattern: OBV rising + price flat = invisible institutional accumulation — most reliable before large surges.",
    it: "Pattern chiave: OBV rising + price flat = accumulo istituzionale invisibile — il più affidabile prima dei grandi surge.",
  },
  "decisionLab.sds.legend.rows.xbi.gt20": {
    en: "Combined RS > +20%",
    it: "RS combinata > +20%",
  },
  "decisionLab.sds.legend.rows.xbi.gt10": {
    en: "Combined RS > +10%",
    it: "RS combinata > +10%",
  },
  "decisionLab.sds.legend.rows.xbi.gt3": {
    en: "Combined RS > +3%",
    it: "RS combinata > +3%",
  },
  "decisionLab.sds.legend.rows.xbi.neutral": {
    en: "Combined RS −3% to +3%",
    it: "RS combinata −3% a +3%",
  },
  "decisionLab.sds.legend.rows.xbi.mildNeg": {
    en: "Combined RS −10% to −3%",
    it: "RS combinata −10% a −3%",
  },
  "decisionLab.sds.legend.rows.xbi.ltNeg10": {
    en: "Combined RS < −10%",
    it: "RS combinata < −10%",
  },
  "decisionLab.sds.legend.rows.volRatio.gt25": {
    en: "5d volume > 2.5× 20d average",
    it: "Volume 5d > 2.5× media 20d",
  },
  "decisionLab.sds.legend.rows.volRatio.gt18": {
    en: "5d volume > 1.8× average",
    it: "Volume 5d > 1.8× media",
  },
  "decisionLab.sds.legend.rows.volRatio.gt13": {
    en: "5d volume > 1.3× average",
    it: "Volume 5d > 1.3× media",
  },
  "decisionLab.sds.legend.rows.volRatio.gt10": {
    en: "5d volume > 1.0× average",
    it: "Volume 5d > 1.0× media",
  },
  "decisionLab.sds.legend.rows.volRatio.normal": {
    en: "5d volume 0.7–1.0× average",
    it: "Volume 5d 0.7–1.0× media",
  },
  "decisionLab.sds.legend.rows.volRatio.lt07": {
    en: "5d volume < 0.7× average",
    it: "Volume 5d < 0.7× media",
  },
  "decisionLab.sds.legend.rows.cash.positive": {
    en: "Positive cash flow / unlimited runway",
    it: "Cash flow positivo / runway illimitato",
  },
  "decisionLab.sds.legend.rows.cash.gte24": {
    en: "Runway ≥ 24 months",
    it: "Runway ≥ 24 mesi",
  },
  "decisionLab.sds.legend.rows.cash.18to24": {
    en: "Runway 18–24 months",
    it: "Runway 18–24 mesi",
  },
  "decisionLab.sds.legend.rows.cash.12to18": {
    en: "Runway 12–18 months",
    it: "Runway 12–18 mesi",
  },
  "decisionLab.sds.legend.rows.cash.9to12": {
    en: "Runway 9–12 months",
    it: "Runway 9–12 mesi",
  },
  "decisionLab.sds.legend.rows.cash.6to9": {
    en: "Runway 6–9 months",
    it: "Runway 6–9 mesi",
  },
  "decisionLab.sds.legend.rows.cash.3to6": {
    en: "Runway 3–6 months",
    it: "Runway 3–6 mesi",
  },
  "decisionLab.sds.legend.rows.cash.lt3": {
    en: "Runway < 3 months",
    it: "Runway < 3 mesi",
  },
  "decisionLab.sds.legend.rows.cash.footnote": {
    en: "< 3 months triggers ABSOLUTE VETO — no operational recommendation regardless of SDS score.",
    it: "< 3 mesi attiva VETO ASSOLUTO — nessuna raccomandazione operativa indipendentemente dal punteggio SDS.",
  },
  "decisionLab.sds.legend.rows.pipeline.lt02": {
    en: "MC / pipeline NPV < 0.2",
    it: "Ratio MC/pipeline < 0.2",
  },
  "decisionLab.sds.legend.rows.pipeline.lt04": {
    en: "MC / pipeline NPV < 0.4",
    it: "Ratio MC/pipeline < 0.4",
  },
  "decisionLab.sds.legend.rows.pipeline.lt07": {
    en: "MC / pipeline NPV < 0.7",
    it: "Ratio MC/pipeline < 0.7",
  },
  "decisionLab.sds.legend.rows.pipeline.lt10": {
    en: "MC / pipeline NPV < 1.0",
    it: "Ratio MC/pipeline < 1.0",
  },
  "decisionLab.sds.legend.rows.pipeline.lt15": {
    en: "MC / pipeline NPV < 1.5",
    it: "Ratio MC/pipeline < 1.5",
  },
  "decisionLab.sds.legend.rows.pipeline.gte15": {
    en: "MC / pipeline NPV ≥ 1.5",
    it: "Ratio MC/pipeline ≥ 1.5",
  },
  "decisionLab.sds.legend.rows.pipeline.example": {
    en: "Pipeline NPV = peak_sales × approval probability (Singh) × 5× revenue multiple. Example MDGL pre-surge: MC $200M vs NPV ~$800M → ratio 0.25 → max score.",
    it: "Pipeline NPV = peak_sales × probabilità approvazione (Singh) × 5× multiplo revenue. Esempio MDGL pre-surge: MC $200M vs NPV ~$800M → ratio 0.25.",
  },
  "decisionLab.sds.legend.rows.ma.firstInClass": {
    en: "First-in-class + market >$3B",
    it: "First-in-class + mercato >$3B",
  },
  "decisionLab.sds.legend.rows.ma.p3Momentum": {
    en: "Phase 3 + positive momentum",
    it: "Phase 3 + momentum positivo",
  },
  "decisionLab.sds.legend.rows.ma.smallCap": {
    en: "Market cap < $2B",
    it: "Market cap < $2B",
  },
  "decisionLab.sds.legend.rows.ma.bigPharma": {
    en: "Big pharma active in therapeutic area",
    it: "Grande pharma attiva nell'area terapeutica",
  },
  "decisionLab.sds.legend.rows.ma.example": {
    en: "Examples: NASH — AstraZeneca, Novo, Gilead · Oncology — Pfizer, BMS, Roche · Rare disease — Sanofi, BioMarin, Ultragenyx",
    it: "Esempi: NASH — AstraZeneca, Novo Nordisk, Gilead · Oncologia — Pfizer, BMS, Roche · Malattie rare — Sanofi, BioMarin, Ultragenyx",
  },
  "decisionLab.sds.legend.rows.window.t14to30": {
    en: "T-14 to T-30 (ideal entry)",
    it: "T-14 a T-30 (entry ideale)",
  },
  "decisionLab.sds.legend.rows.window.t30to45": {
    en: "T-30 to T-45",
    it: "T-30 a T-45",
  },
  "decisionLab.sds.legend.rows.window.t7to14": {
    en: "T-7 to T-14 (late, higher risk)",
    it: "T-7 a T-14 (entrata tardiva, rischio maggiore)",
  },
  "decisionLab.sds.legend.rows.window.t45to60": {
    en: "T-45 to T-60",
    it: "T-45 a T-60",
  },
  "decisionLab.sds.legend.rows.window.lt7": {
    en: "Below T-7 (binary zone + BINARY LOCK)",
    it: "Sotto T-7 (zona binaria + flag BINARY LOCK)",
  },
  "decisionLab.sds.legend.rows.window.t60to90": {
    en: "T-60 to T-90",
    it: "T-60 a T-90",
  },
  "decisionLab.sds.legend.rows.window.passed": {
    en: "CD passed",
    it: "CD passato",
  },
  "decisionLab.sds.legend.rows.window.footnote": {
    en: "Below T-7: binary zone — stock moves only on clinical data. No new entry.",
    it: "Sotto T-7: zona binaria — il titolo si muove solo sui dati clinici. Nessuna nuova entrata.",
  },
  "decisionLab.sds.legend.rows.sequential.gte4": {
    en: "4+ catalyst types in 90d",
    it: "4+ tipi di catalyst in 90 gg",
  },
  "decisionLab.sds.legend.rows.sequential.eq3": {
    en: "3 catalyst types",
    it: "3 tipi di catalyst",
  },
  "decisionLab.sds.legend.rows.sequential.eq2": {
    en: "2 catalyst types",
    it: "2 tipi di catalyst",
  },
  "decisionLab.sds.legend.rows.sequential.eq1": {
    en: "1 type (CD only)",
    it: "1 tipo (solo CD)",
  },
  "decisionLab.sds.legend.rows.sequential.none": {
    en: "None",
    it: "Nessuno",
  },
  "decisionLab.sds.legend.rows.sequential.footnote": {
    en: "Types: clinical readout · regulatory (PDUFA, FDA, NDA/BLA) · conference (ASCO, ESMO, ASH) · financial (offering, partnership) · publication (NEJM, Lancet) · analyst event",
    it: "Tipi: clinical readout · regulatory (PDUFA, FDA, NDA/BLA) · conference (ASCO, ESMO, ASH) · financial (offering, partnership) · publication (NEJM, Lancet) · analyst event",
  },
  "decisionLab.sds.legend.rows.sequential.example": {
    en: "Example CTMX: clinical data + follow-on offering + analyst upgrade in 90d window → +1000% in 12 months.",
    it: "Esempio CTMX: clinical data + follow-on offering + analyst upgrade → surge +1000% in 12 mesi.",
  },
  "decisionLab.sds.legend.status.exists": {
    en: "Exists",
    it: "Esiste",
  },
  "decisionLab.sds.legend.status.new": {
    en: "New",
    it: "Nuovo",
  },
  "decisionLab.sds.legend.status.partial": {
    en: "Partial",
    it: "Parziale",
  },
  "decisionLab.sds.legend.status.hard": {
    en: "Hard",
    it: "Difficile",
  },
  "decisionLab.sds.legend.clusterA.title": {
    en: "Cluster A — Catalyst Quality",
    it: "Cluster A — Catalyst Quality",
  },
  "decisionLab.sds.legend.clusterA.weight": {
    en: "Weight 30%",
    it: "Peso 30%",
  },
  "decisionLab.sds.legend.clusterA.intro": {
    en: "Is this trial worth betting on?",
    it: "Vale la pena scommettere su questo trial?",
  },
  "decisionLab.sds.legend.a.phase.name": {
    en: "Phase credibility — 0 to 14 pts",
    it: "Phase Credibility — 0 a 14 punti",
  },
  "decisionLab.sds.legend.a.phase.desc": {
    en: "How advanced and solid the clinical trial is.",
    it: "Misura quanto è avanzato e solido il trial clinico.",
  },
  "decisionLab.sds.legend.a.phase.source": {
    en: "ClinicalTrials.gov — phase + study_design",
    it: "ClinicalTrials.gov — campo phase + study_design",
  },
  "decisionLab.sds.legend.a.endpoint.name": {
    en: "Endpoint credibility — 0 to 10 pts",
    it: "Endpoint Credibility — 0 a 10 punti",
  },
  "decisionLab.sds.legend.a.endpoint.desc": {
    en: "How credible and objective the primary endpoint is to investors and analysts.",
    it: "Misura quanto è credibile e oggettivo il primary endpoint agli occhi degli investitori e degli analisti.",
  },
  "decisionLab.sds.legend.a.endpoint.source": {
    en: "ClinicalTrials.gov — primary_outcome field",
    it: "ClinicalTrials.gov — campo primary_outcome",
  },
  "decisionLab.sds.legend.a.unmet.name": {
    en: "Unmet need — 0 to 13 pts",
    it: "Unmet Need — 0 a 13 punti",
  },
  "decisionLab.sds.legend.a.unmet.desc": {
    en: "How much the market needs this drug — how many approved alternatives exist.",
    it: "Misura quanto il mercato ha bisogno di questo farmaco — quante alternative approvate esistono già.",
  },
  "decisionLab.sds.legend.a.unmet.source": {
    en: "openFDA API + Claude API for first-in-class from intervention_description",
    it: "openFDA API + Claude API per first-in-class da intervention_description",
  },
  "decisionLab.sds.legend.a.market.name": {
    en: "Market size — 0 to 10 pts",
    it: "Market Size — 0 a 10 punti",
  },
  "decisionLab.sds.legend.a.market.desc": {
    en: "Commercial potential if approved — peak sales estimate.",
    it: "Misura il potenziale commerciale dell'indicazione — quanto può valere il farmaco se approvato.",
  },
  "decisionLab.sds.legend.a.market.source": {
    en: "Indication lookup table + analyst reports / SEC filings",
    it: "Lookup table per indicazione + analyst reports / SEC filings",
  },
  "decisionLab.sds.legend.clusterB.title": {
    en: "Cluster B — Institutional Signal",
    it: "Cluster B — Institutional Signal",
  },
  "decisionLab.sds.legend.clusterB.weight": {
    en: "Weight 25%",
    it: "Peso 25%",
  },
  "decisionLab.sds.legend.clusterB.intro": {
    en: "Are professionals already betting on this?",
    it: "I professionisti stanno già scommettendo su questo?",
  },
  "decisionLab.sds.legend.b.short.name": {
    en: "Short interest + days to cover — −5 to +10 pts",
    it: "Short Interest + Days to Cover — da −5 a +10 punti",
  },
  "decisionLab.sds.legend.b.short.desc": {
    en: "Short float and squeeze potential. If the trial succeeds and shorts must cover quickly, the surge amplifies enormously.",
    it: "Misura quante azioni sono vendute allo scoperto e il potenziale di short squeeze.",
  },
  "decisionLab.sds.legend.b.short.source": {
    en: "FMP /v4/short-float · yfinance fallback",
    it: "FMP API /v4/short-float · fallback yfinance",
  },
  "decisionLab.sds.legend.b.analyst.name": {
    en: "Analyst upgrades — 0 to 8 pts",
    it: "Analyst Upgrades — 0 a 8 punti",
  },
  "decisionLab.sds.legend.b.analyst.desc": {
    en: "Biotech analyst activity in the last 4–8 weeks. Tier 1 initiation brings significant institutional capital.",
    it: "Attività analisti biotech nelle ultime 4–8 settimane.",
  },
  "decisionLab.sds.legend.b.analyst.source": {
    en: "FMP /v3/grade/{ticker} — last 60 days",
    it: "FMP API /v3/grade/{ticker} — ultimi 60 giorni",
  },
  "decisionLab.sds.legend.b.instOwn.name": {
    en: "Institutional Δ 13F — −2 to +8 pts",
    it: "Institutional Δ 13F — da −2 a +8 punti",
  },
  "decisionLab.sds.legend.b.instOwn.desc": {
    en: "Institutional ownership change between last two SEC quarters. Healthcare funds often enter months before the catalyst — even quarter-old data has predictive value.",
    it: "Confronta ownership istituzionale tra ultimi due trimestri SEC.",
  },
  "decisionLab.sds.legend.b.instOwn.source": {
    en: "FMP /v3/institutional-holder/{ticker} — weekly refresh",
    it: "FMP API /v3/institutional-holder/{ticker} — refresh settimanale",
  },
  "decisionLab.sds.legend.clusterC.title": {
    en: "Cluster C — Price Structure",
    it: "Cluster C — Price Structure",
  },
  "decisionLab.sds.legend.clusterC.weight": {
    en: "Weight 20%",
    it: "Peso 20%",
  },
  "decisionLab.sds.legend.clusterC.intro": {
    en: "Is the chart setting up for a move?",
    it: "Il grafico sta preparando un movimento?",
  },
  "decisionLab.sds.legend.c.bb.name": {
    en: "Bollinger squeeze — 0 to 10 pts",
    it: "Bollinger Squeeze — 0 a 10 punti",
  },
  "decisionLab.sds.legend.c.bb.desc": {
    en: "Price compression in a tight range. When Bollinger Band width approaches 6-month lows, it's a coiled spring.",
    it: "Compressione del prezzo in un range stretto — come una molla che si schiaccia.",
  },
  "decisionLab.sds.legend.c.bb.source": {
    en: "Yahoo Finance prices — computed in Supernova",
    it: "Prezzi Yahoo Finance — calcolo in Supernova",
  },
  "decisionLab.sds.legend.c.obv.name": {
    en: "OBV accumulation — 0 to 8 pts",
    it: "OBV Accumulation — 0 a 8 punti",
  },
  "decisionLab.sds.legend.c.obv.desc": {
    en: "On-Balance Volume: are large investors quietly buying?",
    it: "On-Balance Volume: i grandi investitori stanno comprando in silenzio?",
  },
  "decisionLab.sds.legend.c.obv.source": {
    en: "Yahoo prices + volumes",
    it: "Prezzi + volumi Yahoo",
  },
  "decisionLab.sds.legend.c.xbi.name": {
    en: "Relative strength vs XBI — −2 to +5 pts",
    it: "Relative Strength vs XBI — da −2 a +5 punti",
  },
  "decisionLab.sds.legend.c.xbi.desc": {
    en: "Ticker return vs biotech ETF (XBI) over 90d (+ 20d blend). Stock rising while XBI flat/down = ticker-specific interest.",
    it: "Rendimento titolo vs ETF settore biotech (XBI) negli ultimi 90 giorni.",
  },
  "decisionLab.sds.legend.c.xbi.source": {
    en: "XBI + ticker prices from Yahoo",
    it: "XBI + prezzi ticker da Yahoo",
  },
  "decisionLab.sds.legend.c.volRatio.name": {
    en: "Volume ratio (5d) — −1 to +5 pts",
    it: "Volume Ratio (5d) — da −1 a +5 punti",
  },
  "decisionLab.sds.legend.c.volRatio.desc": {
    en: "Last 5-day volume vs 20-day average. Breakout on double volume is real; on normal volume is often noise.",
    it: "Volume ultimi 5 giorni vs media 20 giorni.",
  },
  "decisionLab.sds.legend.c.volRatio.source": {
    en: "Yahoo volumes",
    it: "Volumi Yahoo",
  },
  "decisionLab.sds.legend.clusterD.title": {
    en: "Cluster D — Company Fundamentals",
    it: "Cluster D — Company Fundamentals",
  },
  "decisionLab.sds.legend.clusterD.weight": {
    en: "Weight 15%",
    it: "Peso 15%",
  },
  "decisionLab.sds.legend.clusterD.intro": {
    en: "Is the company solid enough to reach the catalyst?",
    it: "L'azienda è abbastanza solida da arrivare al catalyst?",
  },
  "decisionLab.sds.legend.d.cash.name": {
    en: "Cash runway — −8 to +8 pts",
    it: "Cash Runway — da −8 a +8 punti",
  },
  "decisionLab.sds.legend.d.cash.desc": {
    en: "Months of life at current cash burn. Below 6 months risks dilutive offering before catalyst; above 18 months is safe.",
    it: "Quanti mesi di vita con la cassa attuale?",
  },
  "decisionLab.sds.legend.d.cash.source": {
    en: "SEC 10-Q or FMP balance sheet",
    it: "SEC 10-Q o FMP /v3/balance-sheet-statement",
  },
  "decisionLab.sds.legend.d.pipeline.name": {
    en: "MC / pipeline ratio — 0 to 8 pts",
    it: "MC / Pipeline Ratio — 0 a 8 punti",
  },
  "decisionLab.sds.legend.d.pipeline.desc": {
    en: "Is the market pricing pipeline value or ignoring it? Large gap between market cap and estimated pipeline NPV = upside.",
    it: "Il mercato prezza la pipeline o la ignora?",
  },
  "decisionLab.sds.legend.d.pipeline.source": {
    en: "Yahoo market cap + Singh phase_probability + market size lookup",
    it: "Market cap Yahoo + phase_probability modello Singh + lookup MARKET_SIZE_ESTIMATES",
  },
  "decisionLab.sds.legend.d.ma.name": {
    en: "M&A attractiveness — 0 to 7 pts",
    it: "M&A Attractiveness — 0 a 7 punti",
  },
  "decisionLab.sds.legend.d.ma.desc": {
    en: "Likelihood of acquisition before/after catalyst. M&A speculation can amplify moves (MDGL +1800% partly driven by acquisition rumors).",
    it: "Quanto è probabile un'acquisizione prima o dopo il catalyst?",
  },
  "decisionLab.sds.legend.d.ma.source": {
    en: "Rule-based from first_in_class, phase, market_cap, condition",
    it: "Rule-based da first_in_class, phase, market_cap, condition",
  },
  "decisionLab.sds.legend.clusterE.title": {
    en: "Cluster E — Timing Proximity",
    it: "Cluster E — Timing Proximity",
  },
  "decisionLab.sds.legend.clusterE.weight": {
    en: "Weight 10%",
    it: "Peso 10%",
  },
  "decisionLab.sds.legend.clusterE.intro": {
    en: "Are we entering at the right moment?",
    it: "Siamo nel momento giusto per entrare?",
  },
  "decisionLab.sds.legend.e.window.name": {
    en: "Catalyst window — 0 to 6 pts",
    it: "Catalyst Window — 0 a 6 punti",
  },
  "decisionLab.sds.legend.e.window.desc": {
    en: "Days to CD. Optimal historical window: T-45 to T-14 — close enough to capture pre-catalyst move, far enough from binary zone.",
    it: "Giorni al CD. Finestra ottimale storica: T-45 a T-14.",
  },
  "decisionLab.sds.legend.e.window.source": {
    en: "CD calendar Supernova — days_to_cd",
    it: "CD calendar Supernova — days_to_cd",
  },
  "decisionLab.sds.legend.e.sequential.name": {
    en: "Sequential catalysts — 0 to 4 pts",
    it: "Sequential Catalysts — 0 a 4 punti",
  },
  "decisionLab.sds.legend.e.sequential.desc": {
    en: "How many distinct positive catalyst types in the next 90 days? Each extra catalyst is another chance for re-rating.",
    it: "Quanti tipi diversi di catalyst positivi nei prossimi 90 giorni?",
  },
  "decisionLab.sds.legend.e.sequential.source": {
    en: "EIS events + CD calendar + SEC 8-K + AI feed",
    it: "EIS events + CD calendar + 8-K SEC + AI feed",
  },
  "decisionLab.nav.openSimulation": {
    en: "Go to portfolio →",
    it: "Vai al portafoglio →",
  },
  "decisionLab.nav.openSimulationTip": {
    en: "Open My portfolio — positions, buy/sell and capital",
    it: "Apri Il mio portafoglio — posizioni, buy/sell e capitale",
  },
  "decisionLab.extra.simRows": {
    en: "{n} Simulation rows",
    it: "{n} righe Simulation",
  },
  "decisionLab.extra.cohort": {
    en: "{n} cohort",
    it: "{n} cohort",
  },
  "decisionLab.loading.validation": {
    en: "Loading validation data…",
    it: "Caricamento dati validazione…",
  },

  // ── Signals panel — action badges ──────────────────────────────────────────
  "signals.action.forte": {
    en: "⚡ Strong Signal",
    it: "⚡ Segnale forte",
  },
  "signals.action.watch": {
    en: "▲ Watch Long",
    it: "▲ Watch Long",
  },
  "signals.action.short": {
    en: "▼ Watch Short",
    it: "▼ Watch Short",
  },
  "signals.action.monitor": {
    en: "● Monitor",
    it: "● Monitora",
  },
  "signals.action.exit": {
    en: "↩ Consider exit",
    it: "↩ Valuta uscita",
  },
  "signals.action.skip": {
    en: "— Skip",
    it: "— Salta",
  },
  "signals.action.doNotAdd": {
    en: "— Don't add",
    it: "— Non aggiungere",
  },
  "signals.action.monitorPosition": {
    en: "● Monitor position",
    it: "● Monitora posizione",
  },
  "signals.action.reviewPosition": {
    en: "● Review position",
    it: "● Rivedi posizione",
  },

  // ── Signals panel — generic labels ─────────────────────────────────────────
  "signals.badge.openPosition": {
    en: "● Open position",
    it: "● Posizione aperta",
  },
  "signals.badge.simulationLink": {
    en: "→ Simulation",
    it: "→ Simulation",
  },
  "signals.badge.simulationTooltip": {
    en: "Open Simulation workspace, filter All, scroll to this ticker row (Buy/Sell in Actions)",
    it: "Apri Simulation, filtro Tutti, scroll sulla riga del ticker (Buy/Sell in Azioni)",
  },
  "signals.badge.simulationGoto": {
    en: "Go to Simulation → highlight {ticker}",
    it: "Vai a Simulation → evidenzia {ticker}",
  },
  "signals.timing.urgent": {
    en: "⚡ Urgent entry",
    it: "⚡ Entrata urgente",
  },
  "signals.timing.lastDays": {
    en: "🔴 Last days",
    it: "🔴 Ultimi giorni",
  },
  "signals.timing.openWindow": {
    en: "Open window",
    it: "Finestra aperta",
  },
  "signals.timing.prePhase": {
    en: "Pre-phase",
    it: "Pre-fase",
  },
  "signals.timing.past": {
    en: "Past CD",
    it: "CD passata",
  },
  "signals.timing.postCdWatch": {
    en: "Post-CD watch",
    it: "Watch post-CD",
  },
  "signals.timing.postCdWatchDays": {
    en: "Post-CD watch · T+{days}",
    it: "Watch post-CD · T+{days}",
  },
  "signals.timing.pastCatalyst": {
    en: "Past catalyst (archived)",
    it: "Past catalyst (archivio)",
  },
  "signals.slope.postCdWatchNote": {
    en: "Post-CD watch: companies stay visible for {days} calendar days after CD (off Simulation sheet), then move to past catalyst and leave active tabs.",
    it: "Watch post-CD: le società restano visibili per {days} giorni calendario dopo il CD (fuori foglio Simulation), poi passano in past catalyst e spariscono dalle tab attive.",
  },
  "signals.timing.watchZone": {
    en: "Watch zone (early monitor)",
    it: "Zona watch (monitoraggio)",
  },
  "signals.timing.tooEarly": {
    en: "Beyond monitor window",
    it: "Oltre finestra monitor",
  },
  "signals.hot.title": {
    en: "Hot zone — Top opportunities",
    it: "Zona hot — Top opportunità",
  },
  "signals.hot.subtitle": {
    en: "CD within {days} days · full timing weight · highest curve predictability",
    it: "CD entro {days} gg · peso timing pieno · massima predictibilità curva",
  },
  "signals.hot.emptyFiltered": {
    en: "No opportunities in the hot zone with the current Confidence and Min upside filters. Lower thresholds or check the excluded list below.",
    it: "Nessuna opportunità in zona hot con i filtri Affidabilità e Rialzo minimo attuali. Abbassa le soglie o consulta l’elenco esclusi sotto.",
  },
  "signals.filter.panelCounts": {
    en: "🔥 {hot} hot · 👁 {watch} watch · Top2 {top2}",
    it: "🔥 {hot} hot · 👁 {watch} watch · Top2 {top2}",
  },
  "signals.filter.summaryLine": {
    en: "{shown} shown / {total} tickers",
    it: "{shown} visibili / {total} ticker",
  },
  "signals.worst.title": {
    en: "Portfolio — exit review (underperformers)",
    it: "Portafoglio — analisi exit (in difficoltà)",
  },
  "signals.worst.subtitle": {
    en: "All open positions with negative outlook, sustained decline, or underwater P&L — ranked worst first. Positions rising toward target are excluded.",
    it: "Tutte le posizioni aperte con outlook negativo, decrescita sostenuta o P&L in perdita — ordinate dal peggiore. Escluse quelle in salita verso target.",
  },
  "signals.worst.zoneBadge": {
    en: "Exit review",
    it: "Analisi exit",
  },
  "signals.worst.emptyNone": {
    en: "No open portfolio positions.",
    it: "Nessuna posizione aperta in portafoglio.",
  },
  "signals.worst.emptyOk": {
    en: "All {n} portfolio positions look OK — no sustained decline or negative outlook to CD.",
    it: "Tutte le {n} posizioni del portafoglio OK — nessuna decrescita sostenuta o outlook negativo verso CD.",
  },
  "signals.worst.reason.decline": {
    en: "Sustained ↓ slope",
    it: "Pendenza ↓ sostenuta",
  },
  "signals.worst.reason.negative_plan": {
    en: "ROI→CD ≤ 0",
    it: "ROI→CD ≤ 0",
  },
  "signals.worst.reason.negative_pnl": {
    en: "Underwater P&L",
    it: "P&L in perdita",
  },
  "signals.worst.reason.exit_verdict": {
    en: "Slope exit/avoid",
    it: "Verdict exit/avoid",
  },
  "signals.worst.reason.precat_sell": {
    en: "Pre-cat sell",
    it: "Pre-cat vendi",
  },
  "signals.worst.sellToday.title": {
    en: "If you sell today (P&L from entry)",
    it: "Se vendi oggi (P&L da ingresso)",
  },
  "signals.worst.sellToday.onCapital": {
    en: "on € {amount} invested",
    it: "su € {amount} investiti",
  },
  "signals.worst.sellToday.dailyNote": {
    en: "Today vs prev. close (not total P&L)",
    it: "Var. giorno vs chiusura ieri (non è il P&L totale)",
  },
  "signals.worst.sellToday.unavailable": {
    en: "Sell-today P&L unavailable — set buy price in Simulation",
    it: "P&L vendita oggi non disponibile — imposta prezzo acquisto in Simulation",
  },
  "signals.watch.title": {
    en: "Watch zone — Early opportunities",
    it: "Zona watch — Opportunità anticipate",
  },
  "signals.watch.subtitle": {
    en: "CD in {hot}–{monitor} days · lower timing weight · rank by curve quality (R²) and effective Hit%",
    it: "CD tra {hot} e {monitor} gg · peso timing ridotto · ranking per qualità curva (R²) e Hit% effettivo",
  },
  "signals.watch.zoneBadge": {
    en: "Watch",
    it: "Watch",
  },
  "signals.sparkline.zoneWatching": {
    en: "Watching",
    it: "Watch",
  },
  "signals.sparkline.zoneHot": {
    en: "Hot zone",
    it: "Zona hot",
  },
  "signals.sparkline.zonePost": {
    en: "Post-CD",
    it: "Post-CD",
  },
  "signals.watch.predictability": {
    en: "Curve pred.",
    it: "Pred. curva",
  },
  "signals.watch.predictabilityTip": {
    en: "Operational curve predictability (0–100): lower far from CD because timing and fit matter less until the hot zone.",
    it: "Predictibilità operativa della curva (0–100): più bassa lontano dal CD finché non si entra nella zona hot.",
  },
  "signals.watch.effectiveHit": {
    en: "Eff. Hit%",
    it: "Hit% eff.",
  },
  "signals.watch.effectiveHitTip": {
    en: "Historical cohort Hit% scaled by timing predictability — expected directional accuracy today, not at CD.",
    it: "Hit% cohort storico scalato sulla predictibilità timing — accuracy direzionale attesa oggi, non al CD.",
  },
  "signals.label.historicalHit": {
    en: "Historical Hit%",
    it: "Hit% storica",
  },
  "signals.label.confidence": {
    en: "Conf.",
    it: "Conf.",
  },
  "signals.label.pred5": {
    en: "PRED +5",
    it: "PRED +5",
  },
  "signals.label.score": {
    en: "SCORE",
    it: "SCORE",
  },
  "signals.label.action": {
    en: "ACTION",
    it: "AZIONE",
  },
  "signals.label.size": {
    en: "SIZE",
    it: "SIZE",
  },
  "signals.label.targetStop": {
    en: "TARGET · STOP",
    it: "TARGET · STOP",
  },
  "signals.label.pnlAtt": {
    en: "P&L ATT.",
    it: "P&L ATT.",
  },
  "signals.label.ticker": {
    en: "TICKER",
    it: "TICKER",
  },
  "signals.label.cdTiming": {
    en: "CD · TIMING",
    it: "CD · TIMING",
  },
  "signals.label.expHit": {
    en: "EXP. HIT%",
    it: "HIT% ATT.",
  },

  // ── Signals panel — card sections ──────────────────────────────────────────
  "signals.card.timingPrecat": {
    en: "TIMING PRE-CATALYST",
    it: "TIMING PRE-CATALYST",
  },
  "signals.card.signal": {
    en: "SIGNAL",
    it: "SEGNALE",
  },
  "signals.card.expectedReturn": {
    en: "EXPECTED RETURN TOWARD CD",
    it: "RENDIMENTO ATTESO VERSO CD",
  },
  "signals.card.targetStop": {
    en: "TARGET · STOP",
    it: "TARGET · STOP",
  },
  "signals.card.whenToExit": {
    en: "WHEN TO EXIT",
    it: "QUANDO USCIRE",
  },
  "signals.card.pRiseToCd": {
    en: "P(rise toward CD)",
    it: "P(rialzo verso CD)",
  },
  "signals.card.postCatContext": {
    en: "Post-catalyst context",
    it: "Contesto post-catalyst",
  },
  "signals.card.predictionCurve": {
    en: "Prediction curve with σ bands",
    it: "Curva di predizione con bande σ",
  },
  "signals.card.basedOnCohort": {
    en: "based on calibrated σ · {n} historical trajectories",
    it: "basato su σ calibrato · {n} traiettorie storiche",
  },
  "signals.card.roiTarget": {
    en: "ROI at target",
    it: "ROI al target",
  },
  "signals.col.expectedRoi": {
    en: "ROI→CD (info)",
    it: "ROI→CD (info)",
  },
  "signals.col.expectedRoiTip": {
    en: "Informational only: return to Completion Date if you hold through CD. Decisions use ROI at target (rise segment peak).",
    it: "Solo informativo: rendimento al Completion Date se tieni fino al CD. Le decisioni usano il ROI al target (picco tratto in salita).",
  },
  "sim.col.expectedRoi": {
    en: "ROI→CD",
    it: "ROI→CD",
  },
  "sim.col.expectedRoiTip": {
    en: "Informational: days to CD and model % return today → CD (not used for ranking or BUY/SELL).",
    it: "Informativo: giorni al CD e rendimento % modello oggi → CD (non usato per ranking né BUY/SELL).",
  },
  "sim.col.targetRoi": {
    en: "ROI target",
    it: "ROI target",
  },
  "sim.col.targetRoiTip": {
    en: "Expected gain IF price reaches the dynamic target — not your current P&L vs buy. Drives ranking and Top 2.",
    it: "Gain atteso SE il prezzo raggiunge il target dinamico — non è il P&L attuale vs acquisto. Guida ranking e Top 2.",
  },
  "sim.plan.expectedRoiTitle": {
    en: "Expected ROI (entry → CD)",
    it: "ROI atteso (ingresso → CD)",
  },
  "signals.card.similarHistory": {
    en: "Similar history: {n} events",
    it: "Eventi storici simili: {n}",
  },
  "signals.card.currentPnl": {
    en: "Current P&L:",
    it: "P&L attuale:",
  },
  "signals.card.doNotEnter": {
    en: "Do not enter",
    it: "Non entrare",
  },
  "signals.card.doNotEnter.reason": {
    en: "No positive momentum: {slope}. Wait for a recovery signal.",
    it: "Nessun momentum positivo: {slope}. Attendi un segnale di ripresa.",
  },
  "signals.card.doNotAdd": {
    en: "Don't add",
    it: "Non aggiungere",
  },
  "signals.card.doNotAdd.reason": {
    en: "No positive momentum: {slope}. Not a new-entry setup (ROI target may still reflect an older rise segment).",
    it: "Nessun momentum positivo: {slope}. Non è un setup di ingresso (il ROI target può riflettere ancora un tratto in salita precedente).",
  },
  "signals.card.considerExit": {
    en: "Consider exit",
    it: "Valuta uscita",
  },
  "signals.card.considerExit.reason": {
    en: "Open position with weak momentum: {slope}. Align with ROI target / dynamic stop.",
    it: "Posizione aperta con momentum debole: {slope}. Allinea a ROI target / stop dinamico.",
  },
  "signals.card.considerExit.exitNote": {
    en: "Review partial or full exit — slope no longer supports holding until the model target.",
    it: "Valuta uscita parziale o totale — la pendenza non supporta più il hold fino al target modello.",
  },
  "signals.card.considerExit.lateReason": {
    en: "Only {days} d to CD with an open position — elevated risk near the pre-CD top.",
    it: "Solo {days} gg al CD con posizione aperta — rischio elevato vicino al top pre-CD.",
  },
  "signals.card.roiVsSlopeHint": {
    en: "ROI target from the last rise segment; live slope ↓ — signal is exit/hold, not add.",
    it: "ROI target dall'ultimo tratto in salita; pendenza attuale ↓ — segnale uscita/hold, non ingresso.",
  },
  "signals.card.exit.monitor": {
    en: "Monitor: enter only if slope5d returns > 0 and there are still ≥ 7 d to CD.",
    it: "Monitora: entra solo se slope5d torna > 0 e mancano ancora ≥ 7 gg al CD.",
  },
  "signals.card.warnWeakR2": {
    en: "⚠ Weak R² — unreliable curve fit",
    it: "⚠ R² debole — fit della curva poco affidabile",
  },
  "signals.card.warnLowConf": {
    en: "⚠ Low confidence — elevated risk",
    it: "⚠ Bassa affidabilità — rischio elevato",
  },
  "signals.card.warnNearZeroPred": {
    en: "⚠ Empirical prediction near zero — weak directional signal",
    it: "⚠ Predizione empirica prossima a zero — segnale direzionale debole",
  },
  "signals.slopeDesc.reversal": {
    en: "recent reversal",
    it: "inversione recente",
  },
  "signals.slopeDesc.nonPositive": {
    en: "non-positive slope",
    it: "pendenza non positiva",
  },
  "signals.caveat.weakR2": {
    en: "Weak R² — unreliable curve fit",
    it: "R² debole — fit della curva poco affidabile",
  },
  "signals.caveat.exploratory": {
    en: "Exploratory inference only",
    it: "Inferenza solo esplorativa",
  },
  "signals.caveat.predNearZero": {
    en: "Empirical prediction near zero — weak directional signal",
    it: "Predizione empirica prossima a zero — segnale direzionale debole",
  },
  "signals.caveat.lowConfidence": {
    en: "Low confidence — elevated risk",
    it: "Bassa affidabilità — rischio elevato",
  },
  "signals.caveat.fewEvents": {
    en: "Few historical events — estimate not robust",
    it: "Pochi eventi storici — stima poco robusta",
  },
  "signals.caveat.btr": {
    en: "Stock already priced-in (BTR +25%) — sell-the-news risk at CD",
    it: "Titolo già prezzato (BTR +25%) — rischio sell-the-news al CD",
  },
  "signals.caveat.ctr": {
    en: "Negative run-up (CTR) — contrarian trade, high volatility",
    it: "Run-up negativo (CTR) — trade contrarian, alta volatilità",
  },

  // ── Signals panel — table top toolbar / filters ────────────────────────────
  "signals.toolbar.activeQuality": {
    en: "Active: only signals with historical Hit% ≥ 55% (outside random zone) and slope verdict entry / persistent / none. Disable to also see borderline signals (random zone, watch, exit).",
    it: "Attivo: solo segnali con Hit% storica ≥ 55% (fuori zona random) e verdetto pendenza entry / persistent / none. Disattiva per vedere anche segnali borderline (zona random, watch, exit).",
  },
  "signals.toolbar.totalTickers": {
    en: "{n} total tickers",
    it: "{n} ticker totali",
  },
  "signals.toolbar.withPosPred": {
    en: "{n} with pred > 0",
    it: "{n} con pred > 0",
  },
  "signals.toolbar.expectedToFall": {
    en: "{n} expected to fall",
    it: "{n} attesi in calo",
  },
  "signals.toolbar.openPositions": {
    en: "{n} open positions",
    it: "{n} posizioni aperte",
  },
  "signals.toolbar.allSignals": {
    en: "All signals",
    it: "Tutti i segnali",
  },

  // ── Investment Decision Lab → "now / target / stop" helpers ────────────────
  "signals.targetStop.now": {
    en: "now",
    it: "ora",
  },
  "signals.targetStop.spotToday": {
    en: "Today",
    it: "Oggi",
  },
  "signals.targetStop.stop": {
    en: "stop",
    it: "stop",
  },
  "signals.targetStop.cohort": {
    en: "cohort",
    it: "cohort",
  },

  // ── Slope alert banner ─────────────────────────────────────────────────────
  "signals.slope.title.error": {
    en: "SLOPE ERROR",
    it: "ERRORE PENDENZA",
  },
  "signals.slope.title.alert": {
    en: "Slope alert",
    it: "Alert pendenza",
  },
  "signals.slope.title.rise": {
    en: "SLOPE ↑",
    it: "PENDENZA ↑",
  },
  "signals.slope.summary.singular": {
    en: "— 1 shown on open positions",
    it: "— 1 in evidenza su posizioni aperte",
  },
  "signals.slope.summary.plural": {
    en: "— {n} shown on open positions",
    it: "— {n} in evidenza su posizioni aperte",
  },
  "signals.slope.summary.pool": {
    en: " (top of {total}: {errors} error · {accels} ↑)",
    it: " (top su {total}: {errors} errori · {accels} ↑)",
  },
  "signals.slope.section.rise": {
    en: "Strong rise · hold / add",
    it: "Salita forte · hold / aggiungi",
  },
  "signals.slope.moreHidden": {
    en: "+{n} more ({errors} error · {accels} ↑) · slope charts",
    it: "+{n} altri ({errors} errori · {accels} ↑) · grafici pendenza",
  },
  "signals.slope.descr.reversal": {
    en: "reversal — slope5d {s5} vs slope20d {s20} pp/d",
    it: "inversione — slope5d {s5} vs slope20d {s20} pp/g",
  },
  "signals.slope.descr.acceleration": {
    en: "acceleration {d} pp/d · trend strengthening",
    it: "accelerazione {d} pp/g · trend in rafforzamento",
  },
  "signals.slope.descr.deceleration": {
    en: "deceleration {d} pp/d · trend slowing",
    it: "decelerazione {d} pp/g · trend in rallentamento",
  },
  "signals.slope.descr.contrarian": {
    en: "contrarian · model vs curve diverge · slope5d {s5} pp/d",
    it: "contrarian · modello vs curva divergono · slope5d {s5} pp/g",
  },
  "signals.slope.action.contrarian": {
    en: " · verify pred vs live curve",
    it: " · verifica pred vs curva live",
  },
  "signals.slope.action.exit": {
    en: " · ⚠ consider exit",
    it: " · ⚠ valuta uscita",
  },
  "signals.slope.link.considerExitTip": {
    en: "Open Simulation → All, scroll to this ticker row (Sell in Actions)",
    it: "Apri Simulation → Tutti, scroll sulla riga (Sell in Azioni)",
  },
  "signals.slope.action.acceleration": {
    en: " · hold while slope ↑",
    it: " · hold finché slope ↑",
  },
  "signals.slope.action.keepMonitoring": {
    en: " · keep monitoring",
    it: " · continua a monitorare",
  },
  "signals.slope.cdInDays": {
    en: "CD in {n} d",
    it: "CD tra {n} gg",
  },
  "signals.slope.threshold": {
    en: "Reversal: opposite sign on slope5d vs slope20d (|slope| ≥ 0.10 pp/d) · accel/decel: |Δ| ≥ 0.8 pp/d · strong ↑: slope5d ≥ 0.35 & slope20d ≥ 0.12 · Simulation sheet",
    it: "Inversione: segno opposto slope5d vs slope20d (|slope| ≥ 0.10 pp/g) · accel/decel: |Δ| ≥ 0.8 pp/g · ↑ forte: slope5d ≥ 0.35 e slope20d ≥ 0.12 · foglio Simulation",
  },
  "signals.slope.severityFloor.label": {
    en: "Min. severity",
    it: "Gravità min.",
  },
  "signals.slope.severityFloor.critical": {
    en: "Critical",
    it: "Critici",
  },
  "signals.slope.severityFloor.high": {
    en: "High+",
    it: "Alti+",
  },
  "signals.slope.severityFloor.medium": {
    en: "Medium+",
    it: "Medi+",
  },
  "signals.slope.severityFloor.low": {
    en: "All",
    it: "Tutti",
  },
  "signals.slope.severityFloor.hidden": {
    en: "{n} hidden (below threshold)",
    it: "{n} nascosti (sotto soglia)",
  },
  "signals.slope.col.trajectory.label": {
    en: "Trajectory",
    it: "Traiettoria",
  },
  "signals.slope.col.trajectory.labelShort": {
    en: "Traj.",
    it: "Trac.",
  },
  "signals.slope.col.trajectory.body": {
    en: "Mini sparkline of slope windows: gray = 20d trend, green/red = 5d trend. Contrarian rows show pred vs live curve divergence.",
    it: "Mini-curva delle finestre pendenza: grigio = trend 20g, verde/rosso = trend 5g. Righe contrarian: divergenza tra pred e curva live.",
  },
  "signals.slope.col.ticker.label": {
    en: "Ticker",
    it: "Ticker",
  },
  "signals.slope.col.ticker.body": {
    en: "Stock symbol. Click to open the company slope-error detail (event log + trajectory chart).",
    it: "Simbolo titolo. Clic per aprire il dettaglio errori pendenza (log eventi + grafico traiettoria).",
  },
  "signals.slope.col.company.label": {
    en: "Company",
    it: "Società",
  },
  "signals.slope.col.company.body": {
    en: "Company name from the Simulation sheet (Yahoo / SEC metadata).",
    it: "Nome società dal foglio Simulation (metadati Yahoo / SEC).",
  },
  "signals.slope.col.errorType.label": {
    en: "Error type",
    it: "Tipo errore",
  },
  "signals.slope.col.errorType.body": {
    en: "Reversal = 5d and 20d slopes opposite sign. Deceleration / Acceleration = same sign but |slope5d − slope20d| ≥ 0.8 pp/d. Contrarian = model Pred direction ≠ live curve slope. Badge color: red = negative error · yellow = slowdown · green = stock rising.",
    it: "Inversione = pendenza 5g e 20g con segno opposto. Decelerazione / Accelerazione = stesso segno ma |slope5d − slope20d| ≥ 0,8 pp/g. Contrarian = direzione Pred modello ≠ pendenza curva live. Colore badge: rosso = errore negativo · giallo = rallentamento · verde = stock in salita.",
  },
  "signals.slope.col.slopeDelta.label": {
    en: "Slope Δ",
    it: "Δ pendenza",
  },
  "signals.slope.col.slopeDelta.body": {
    en: "Slope events: Δ = slope5d − slope20d (pp/d), or 20d → 5d for reversals. Contrarian: Pred +X% (model at T+5) vs curve ±Y pp/d (live recalibrated path). Hover cell for full detail.",
    it: "Eventi pendenza: Δ = slope5d − slope20d (pp/g), oppure 20g → 5g per inversioni. Contrarian: Pred +X% (modello a T+5) vs curva ±Y pp/g (traiettoria ricalibrata live). Passa il mouse per il dettaglio.",
  },
  "signals.slope.col.expectedStock.label": {
    en: "Expected $",
    it: "Atteso $",
  },
  "signals.slope.col.expectedStock.body": {
    en: "Expected price in ~5 trading days: spot today × (1 + Pred+5 pp from recalibrated model). Color matches slope error tone (red / yellow / green). Not the current market price.",
    it: "Prezzo atteso tra ~5 sedute: spot oggi × (1 + Pred+5 pp dal modello ricalibrato). Colore = tono errore pendenza (rosso / giallo / verde). Non è il prezzo di mercato corrente.",
  },
  "signals.slope.col.actualStock.label": {
    en: "Real $",
    it: "Reale $",
  },
  "signals.slope.col.capitalLoss.label": {
    en: "Cap. loss (gap)",
    it: "Perdita cap. (gap)",
  },
  "signals.slope.col.capitalLoss.body": {
    en: "EUR impact on invested capital from real price vs model T+5 (shares × price gap). Tooltip also shows total mark-to-market P&L when in portfolio.",
    it: "Impatto in € sul capitale investito per scostamento spot vs modello T+5 (azioni × gap prezzo). Nel tooltip anche P&L mark-to-market totale se in portafoglio.",
  },
  "signals.slope.col.capitalLoss.pnlTotal": {
    en: "Total P&L",
    it: "P&L totale",
  },
  "signals.slope.banner.capitalLoss": {
    en: "cap. {loss}",
    it: "cap. {loss}",
  },
  "signals.slope.col.actualStock.body": {
    en: "Current market price from the Simulation sheet (Yahoo / last refresh).",
    it: "Prezzo di mercato corrente dal foglio Simulation (Yahoo / ultimo refresh).",
  },
  "signals.slope.col.severity.label": {
    en: "Severity",
    it: "Gravità",
  },
  "signals.slope.col.severity.body": {
    en: "Badge = magnitude within type (Critical…Low). Table sort: Reversal > Contrarian > Deceleration, then |Δ|. Filter chips hide rows below severity floor.",
    it: "Badge = magnitudine nel tipo (Critica…Bassa). Ordine tabella: Inversione > Contrarian > Decelerazione, poi |Δ|. I chip filtrano sotto la soglia gravità.",
  },
  "signals.slope.col.log.label": {
    en: "Log",
    it: "Log",
  },
  "signals.slope.col.log.body": {
    en: "Count of slope + contrarian events logged for this company in the current session (Decision Lab / signal checks).",
    it: "Numero di eventi pendenza + contrarian registrati per la società nella sessione corrente (Decision Lab / controlli segnali).",
  },
  "signals.slope.col.chart.label": {
    en: "Chart",
    it: "Graf.",
  },
  "signals.slope.col.chart.body": {
    en: "Active trajectory charts (slope deceleration/reversal or contrarian pred vs curve, 14-day TTL). Orange count = charts available below; ↓ on a row opens the verification chart.",
    it: "Grafici traiettoria attivi (decelerazione/inversione pendenza o contrarian pred vs curva, TTL 14 giorni). Contatore arancione = grafici disponibili sotto; ↓ sulla riga apre il grafico di verifica.",
  },
  "signals.slope.col.detected.label": {
    en: "Detected",
    it: "Rilevato",
  },
  "signals.slope.col.detected.body": {
    en: "Date and time when this event was written to the slope/contrarian log.",
    it: "Data e ora in cui l'evento è stato scritto nel log pendenza/contrarian.",
  },
  "signals.slope.openCharts": {
    en: "View slope charts →",
    it: "Apri grafici pendenza →",
  },
  "signals.priority.openCharts": {
    en: "View curves in Charts →",
    it: "Vedi curve in Grafici →",
  },
  "signals.priority.openChartsTitle": {
    en: "Open Catalyst & curves → Charts for this ticker",
    it: "Apri Catalyst & curve → Grafici per questo titolo",
  },
  "signals.precat.legend.recalib": {
    en: "Recalibrated curve (sheet)",
    it: "Curva ricalibrata (foglio)",
  },
  "signals.precat.legend.medianLinear": {
    en: "Linear median (eff. slope)",
    it: "Mediana lineare (slope eff.)",
  },
  "signals.precat.recalibNote": {
    en: "Solid line = recalibrated prediction path from the sheet (real segment slopes). Dashed = constant-slope median from 5d/20d slopes.",
    it: "Linea continua = percorso predizione ricalibrato dal foglio (pendenze reali). Tratteggiata = mediana a slope costante da 5g/20g.",
  },
  "signals.slope.openChartsTicker": {
    en: "Open slope error chart for this ticker",
    it: "Apri grafico errore pendenza per questo titolo",
  },
  "signals.slopeCharts.readout.reversal.title": {
    en: "↻ Slope reversal — read here",
    it: "↻ Inversione pendenza — leggi qui",
  },
  "signals.slopeCharts.readout.reversal.body": {
    en:
      "The trend flipped sign: 20d slope {s20} (medium term) vs 5d slope {s5} (recent). Opposite signs with |slope| ≥ 0.10 pp/d → REVERSAL event (not just deceleration). Compare the two KPI boxes SLOPE 5D vs SLOPE 20D and ROTATION = Yes.",
    it:
      "Il trend ha cambiato segno: pendenza 20g {s20} (medio termine) vs 5g {s5} (recente). Segni opposti con |slope| ≥ 0,10 pp/g → evento INVERSIONE (non solo decelerazione). Guarda le KPI SLOPE 5D vs SLOPE 20D e ROTATION = Sì.",
  },
  "signals.slopeCharts.readout.deceleration.title": {
    en: "↘ Deceleration — read here",
    it: "↘ Decelerazione — leggi qui",
  },
  "signals.slopeCharts.readout.deceleration.body": {
    en:
      "Same sign but 5d slope weaker than 20d: Δ 5d−20d = {delta}. The % trajectory may still rise; deceleration = momentum slowing (monitor), not automatic exit unless rotation/reversal.",
    it:
      "Stesso segno ma pendenza 5g più debole di 20g: Δ 5g−20g = {delta}. La traiettoria % può ancora salire; decelerazione = momentum che rallenta (monitor), non exit automatico salvo rotazione/inversione.",
  },
  "signals.slopeCharts.guide.btn": {
    en: "KPI guide & SELL logic",
    it: "Guida KPI e logica SELL",
  },
  "signals.slopeCharts.guide.title": {
    en: "How to read slope charts (deceleration vs SELL)",
    it: "Come leggere i grafici pendenza (decelerazione vs SELL)",
  },
  "signals.slopeCharts.guide.close": {
    en: "Close",
    it: "Chiudi",
  },
  "signals.slopeCharts.guide.body": {
    en:
      "Thresholds: reversal = |slope5d| and |slope20d| ≥ 0.10 pp/d with opposite sign → stability verdict exit. Deceleration/acceleration alert = |slope5d − slope20d| ≥ 0.8 pp/d with the same sign → monitor only; it does not place a ticker in Top 2 SELL by itself.\n\n" +
      "Stable negative 20d slope (e.g. −0.77 pp/d) with high R² → verdict avoid (persistence ≥ 7 d) → Top 2 SELL if the position is open.\n\n" +
      "Expected gain on priority cards = pre-CD return from buildPrecatEntry (effective slope × days to CD, blend if 5d vs 20d diverge > 0.5 pp/d). Pred +5 = model at T+5 days (different metric).\n\n" +
      "Model (dashed) slope uses linear regression on the full recalibrated curve (standard + 8-K + AI feed knots in simulation_charts_snapshot), not only two Pred grid cells. Gap 5d/20d = actual − model per window. Purple dots = recalibration knots.\n\n" +
      "Top 2 SELL (portfolio only): action exit/short, or verdict exit/avoid, or pred5 < 0.",
    it:
      "Soglie: inversione = |slope5d| e |slope20d| ≥ 0,10 pp/g con segno opposto → verdetto stabilità exit. Alert decelerazione/accelerazione = |slope5d − slope20d| ≥ 0,8 pp/g a pari segno → solo monitoraggio; da solo non mette il titolo in Top 2 SELL.\n\n" +
      "Pendenza 20d negativa stabile (es. −0,77 pp/g) con R² alto → verdetto avoid (persistenza ≥ 7 gg) → Top 2 SELL se la posizione è aperta.\n\n" +
      "Expected gain sulle card prioritarie = rendimento pre-CD da buildPrecatEntry (pendenza effettiva × giorni al CD, blend se 5d vs 20d divergono > 0,5 pp/g). Pred +5 = modello a T+5 giorni (metrica diversa).\n\n" +
      "Pendenza modello (tratteggio): regressione su tutta la curva ricalibrata (nodi standard + 8-K + AI feed da simulation_charts_snapshot), non solo due celle Pred. Gap 5d/20d = reale − modello per finestra. Pallini viola = nodi di ricalibrazione.\n\n" +
      "Top 2 SELL (solo portafoglio): action exit/short, oppure verdetto exit/avoid, oppure pred5 < 0.",
  },
  "signals.slopeCharts.cardExplain.btn": {
    en: "Why this signal?",
    it: "Perché questo segnale?",
  },
  "signals.slopeCharts.metricsTable.btn": {
    en: "KPI table",
    it: "Tabella KPI",
  },
  "signals.slopeCharts.nav.hint": {
    en: "Click a ticker to jump to its error curve below.",
    it: "Clicca il ticker per saltare alla curva errore sotto.",
  },
  "signals.slopeCharts.curvesSection": {
    en: "Error curves — all companies",
    it: "Curve errore — tutte le società",
  },
  "signals.slopeCharts.curvesSectionHint": {
    en: "One chart per logged event with curve data. Open the KPI table on each card for full metrics.",
    it: "Un grafico per evento nel log con dati curva. Apri la tabella KPI su ogni card per le metriche complete.",
  },
  "signals.slopeCharts.noCurves": {
    en: "No renderable error curves. Run Refresh data with chart export or lower the severity filter.",
    it: "Nessuna curva errore disponibile. Esegui Refresh data con export grafici o abbassa il filtro gravità.",
  },
  "signals.slopeCharts.kpi.slope5d": {
    en: "Slope 5d",
    it: "Pendenza 5d",
  },
  "signals.slopeCharts.kpi.slope20d": {
    en: "Slope 20d",
    it: "Pendenza 20d",
  },
  "signals.slopeCharts.kpi.slope45d": {
    en: "Slope 45d",
    it: "Pendenza 45d",
  },
  "signals.slopeCharts.kpi.r2": {
    en: "R² fit",
    it: "R² fit",
  },
  "signals.slopeCharts.kpi.confidence": {
    en: "Model conf.",
    it: "Conf. modello",
  },
  "signals.slopeCharts.kpi.expectedPrecat": {
    en: "Expected gain (pre-CD)",
    it: "Rend. atteso (pre-CD)",
  },
  "signals.slopeCharts.kpi.pred5": {
    en: "Pred +5",
    it: "Pred +5",
  },
  "signals.slopeCharts.kpi.rotation": {
    en: "Rotation",
    it: "Rotazione",
  },
  "signals.slopeCharts.kpi.top2Sell": {
    en: "Top 2 SELL",
    it: "Top 2 SELL",
  },
  "signals.slopeCharts.kpi.eventKind": {
    en: "Logged event",
    it: "Evento registrato",
  },
  "signals.slopeCharts.yes": { en: "Yes", it: "Sì" },
  "signals.slopeCharts.no": { en: "No", it: "No" },

  // ── Top Opportunità section header ─────────────────────────────────────────
  "signals.top.title": {
    en: "Top & Worst Opportunities",
    it: "Top & Worst Opportunities",
  },
  "signals.top.subtitle": {
    en: "· buy candidates (expected rise) · all portfolio underperformers for exit review · Top 2 SELL on Dashboard",
    it: "· candidati acquisto (rialzo atteso) · tutte le posizioni in portafoglio in difficoltà per analisi exit · Top 2 SELL in Dashboard",
  },
  "signals.top.btn.updateSignals": {
    en: "Update signals",
    it: "Aggiorna segnali",
  },
  "signals.top.btn.updating": {
    en: "Updating…",
    it: "Aggiornamento…",
  },
  "signals.top.btn.updateTip": {
    en: "Update slope, confidence and predictions for stocks with imminent CD (~20 seconds, without touching Excel)",
    it: "Aggiorna slope, confidence e predizioni per i titoli con CD imminente (~20 secondi, senza toccare Excel)",
  },

  // ── Sort toolbar ──────────────────────────────────────────────────────────
  "signals.sortBy": {
    en: "Sort by",
    it: "Ordina per",
  },
  "signals.sort.upside": {
    en: "⚡ Upside score",
    it: "⚡ Upside score",
  },
  "signals.sort.pred5": {
    en: "📈 Pred +5",
    it: "📈 Pred +5",
  },
  "signals.sort.confidence": {
    en: "🎯 Confidence",
    it: "🎯 Affidabilità",
  },
  "signals.sort.expectedHit": {
    en: "✓ Expected Hit%",
    it: "✓ Hit% atteso",
  },
  "signals.sort.upside.hint": {
    en: "Composite: curve slope + R² + pred magnitude + Confidence + cohort validation. Default.",
    it: "Composito: pendenza curva + R² + intensità pred + Affidabilità + validazione cohort. Default.",
  },
  "signals.sort.pred5.hint": {
    en: "Raw model prediction magnitude.",
    it: "Magnitudine grezza della predizione del modello.",
  },
  "signals.sort.confidence.hint": {
    en: "Calibrated model confidence (0–100%).",
    it: "Affidabilità calibrata del modello (0–100%).",
  },
  "signals.sort.expectedHit.hint": {
    en: "Historical directional Hit% on the matching cohort (requires cohort data).",
    it: "Hit% direzionale storica sul cohort corrispondente (richiede dati cohort).",
  },
  "signals.top.cap": {
    en: "cap {n}",
    it: "cap {n}",
  },
  "signals.top.pinned": {
    en: "pinned",
    it: "pinnati",
  },
  "signals.top.removeAll": {
    en: "↺ remove all",
    it: "↺ rimuovi tutti",
  },

  // ── Expected upside threshold ─────────────────────────────────────────────
  "signals.upside.threshold.label": {
    en: "Expected upside threshold",
    it: "Soglia rialzo atteso",
  },
  "signals.upside.threshold.hint": {
    en: "(adjustable: slider · input · preset)",
    it: "(modulabile: slider · input · preset)",
  },
  "signals.upside.threshold.match.singular": {
    en: "1 match",
    it: "1 risultato",
  },
  "signals.upside.threshold.match.plural": {
    en: "{n} matches",
    it: "{n} risultati",
  },
  "signals.upside.threshold.unit": {
    en: "% pred +5",
    it: "% pred +5",
  },
  "signals.upside.threshold.default": {
    en: "↺ default ({pct}%)",
    it: "↺ default ({pct}%)",
  },
  "signals.upside.threshold.tip": {
    en: "Only stocks with prediction +5 ≥ threshold enter Top Opportunities. Drag the slider, type a value, or use presets.",
    it: "Solo titoli con predizione +5 ≥ soglia entrano nelle Top Opportunità. Sposta lo slider, scrivi un valore o usa i preset.",
  },
  "signals.preset": {
    en: "Preset:",
    it: "Preset:",
  },

  // ── Expected Hit% filter ──────────────────────────────────────────────────
  "signals.hit.filter.label": {
    en: "Expected Hit% filter (cohort)",
    it: "Filtro Hit% atteso (cohort)",
  },
  "signals.hit.filter.hintShort": {
    en: "(adjustable)",
    it: "(modulabile)",
  },
  "signals.hit.filter.tip": {
    en: "Expected Hit% = % of times the prediction curve correctly called the direction in historical signals with the same Confidence band (from cohort). Drag slider, type a value, or use presets.",
    it: "Hit% atteso = % di volte in cui la curva di predizione ha azzeccato la direzione nei segnali storici con la stessa fascia di Affidabilità (dal cohort). Sposta lo slider, scrivi un valore o usa i preset.",
  },
  "signals.hit.cohort.notLoaded": {
    en: "Cohort not loaded",
    it: "Cohort non caricato",
  },
  "signals.hit.off.note": {
    en: "off · score still penalised in random zones",
    it: "off · lo score resta penalizzato nelle zone random",
  },
  "signals.hit.only": {
    en: "only signals with historical Hit% ≥ {n}%",
    it: "solo segnali con Hit% storica ≥ {n}%",
  },
  "signals.percentMinimum": {
    en: "% minimum",
    it: "% minimo",
  },
  "signals.off": {
    en: "↺ off",
    it: "↺ off",
  },

  // ── Minimum confidence filter ─────────────────────────────────────────────
  "signals.minConf.label": {
    en: "Minimum Confidence",
    it: "Affidabilità minima",
  },
  "signals.minConf.qualityHint": {
    en: "(model quality filter)",
    it: "(filtro qualità modello)",
  },
  "signals.minConf.tip": {
    en: "Filter Top Opportunities by minimum model Confidence (calibrated 0-100%). Below Conf<70% the cohort diagnostic shows Hit% 38-40% (below random); at Conf≥85% Hit% reaches 47-51% (solid edge). Configurable threshold.",
    it: "Filtra le Top Opportunità per Affidabilità minima del modello (calibrata 0-100%). Sotto Conf<70% la diagnostica cohort mostra Hit% 38-40% (sotto random); a Conf≥85% Hit% raggiunge 47-51% (edge solido). Soglia configurabile.",
  },
  "signals.minConf.numInputTip": {
    en: "Threshold in % (0 = filter disabled, 100 = no signals pass)",
    it: "Soglia in % (0 = filtro disattivato, 100 = nessun segnale passa)",
  },
  "signals.minConf.disabled": {
    en: "Filter disabled — signals with low confidence (anti-correlated) will also appear in Top.",
    it: "Filtro disattivato — anche i segnali a bassa affidabilità (anti-correlati) appariranno nelle Top.",
  },
  "signals.minConf.solidEdge": {
    en: "Solid edge",
    it: "Edge solido",
  },
  "signals.minConf.solidEdge.body": {
    en: ": only signals with Confidence ≥ {n}% — bucket where historical Hit% is 47–51% (vs random 43%).",
    it: ": solo segnali con Affidabilità ≥ {n}% — fascia dove Hit% storica è 47–51% (vs random 43%).",
  },
  "signals.minConf.standard": {
    en: "Standard filter",
    it: "Filtro standard",
  },
  "signals.minConf.standard.body": {
    en: ": excludes signals with Confidence < {n}% (noise zone). Consider ≥ 85% for solid edge.",
    it: ": esclude segnali con Affidabilità < {n}% (zona rumore). Considera ≥ 85% per edge solido.",
  },
  "signals.minConf.low": {
    en: "Low threshold",
    it: "Soglia bassa",
  },
  "signals.minConf.low.body": {
    en: ": includes signals with Confidence ≥ {n}%, but below 70% cohort diagnostics show Hit% < 45%.",
    it: ": include segnali con Affidabilità ≥ {n}%, ma sotto 70% la diagnostica cohort mostra Hit% < 45%.",
  },

  // ── Strict quality filter ─────────────────────────────────────────────────
  "signals.strict.label": {
    en: "Strict quality filter",
    it: "Filtro qualità rigoroso",
  },
  "signals.strict.subtitle": {
    en: "(excludes random Hit% + unstable verdicts)",
    it: "(esclude Hit% random + verdetti instabili)",
  },
  "signals.strict.tip": {
    en: "Quality filter: excludes signals with historical Hit% below random (< 45%), in random zone (50±5pp with n≥5), or with compromised slope stability (rotation/avoid/low coherence). Keep ON for true top investment opportunities.",
    it: "Filtro qualità: esclude segnali con Hit% storica sotto random (< 45%), in zona random (50±5pp con n≥5), o con stabilità di pendenza compromessa (rotation/avoid/bassa coerenza). Tienilo ON per le vere top opportunità d'investimento.",
  },
  "signals.strict.on": {
    en: "ON",
    it: "ON",
  },
  "signals.strict.off": {
    en: "OFF",
    it: "OFF",
  },
  "signals.strict.activeLabel": {
    en: "Active",
    it: "Attivo",
  },
  "signals.strict.activeBody.prefix": {
    en: ": only signals with historical Hit% ",
    it: ": solo segnali con Hit% storica ",
  },
  "signals.strict.activeBody.thresh": {
    en: "≥ 55%",
    it: "≥ 55%",
  },
  "signals.strict.activeBody.middle": {
    en: " (outside random zone) ",
    it: " (fuori zona random) ",
  },
  "signals.strict.activeBody.and": {
    en: "and",
    it: "e",
  },
  "signals.strict.activeBody.verdict.lead": {
    en: " slope verdict ",
    it: " verdetto pendenza ",
  },
  "signals.strict.activeBody.verdict.values": {
    en: "entry / persistent / none",
    it: "entry / persistent / none",
  },
  "signals.strict.activeBody.tail": {
    en: ". Disable to also see borderline signals (random zone, watch, exit).",
    it: ". Disattiva per vedere anche segnali borderline (zona random, watch, exit).",
  },
  "signals.strict.disabledLabel": {
    en: "Disabled",
    it: "Disattivato",
  },
  "signals.strict.disabledBody": {
    en: ": Top also includes signals with Hit% in random zone and verdicts exit/avoid/watch (rotation, decline, low coherence). Useful for debugging — not a list of real investment opportunities.",
    it: ": le Top includono anche segnali con Hit% in zona random e verdetti exit/avoid/watch (rotazione, calo, bassa coerenza). Utile per debug — non è una lista di vere opportunità d'investimento.",
  },

  // ── Reload (panel-level) ──────────────────────────────────────────────────
  "signals.top.btn.reload": {
    en: "Reload",
    it: "Ricarica",
  },

  // ── Main Dashboard ─────────────────────────────────────────────────────────
  // ── Simulation workspace & P&L tab ─────────────────────────────────────────
  "sim.pnl.title": {
    en: "P&L per ticker",
    it: "P&L per ticker",
  },
  "sim.pnl.back": {
    en: "← Simulation",
    it: "← Simulation",
  },
  "sim.pnl.subtitle.meta": {
    en: "{n} positions · ranked best 👑🐷 → worst 🐔 ({scope})",
    it: "{n} posizioni · ordinati migliore 👑🐷 → peggiore 🐔 ({scope})",
  },
  "sim.pnl.scope.today": {
    en: "daily ranking",
    it: "ranking giornata",
  },
  "sim.pnl.scope.total": {
    en: "total ranking",
    it: "ranking totale",
  },
  "sim.pnl.sortedBestWorst": {
    en: "Cards sorted best → worst by {scope}",
    it: "Card ordinate dal migliore al peggiore ({scope})",
  },
  "sim.pnl.sumTotal": {
    en: "Total gain sum",
    it: "Somma gain totale",
  },
  "sim.pnl.sumTotalTip": {
    en: "Mark-to-market on open positions: current value minus capital invested (from entry).",
    it: "Mark-to-market posizioni aperte: valore attuale meno capitale investito (da ingresso).",
  },
  "sim.pnl.sumToday": {
    en: "Today gain sum (24h)",
    it: "Somma gain oggi (24h)",
  },
  "sim.pnl.sumTodayTip": {
    en: "Sum of «Daily chg. %» × position value for open tickers (vs prior close).",
    it: "Somma «Var. Giorn. %» × valore posizione per i ticker aperti (vs chiusura precedente).",
  },
  "sim.pnl.priorLeg": {
    en: "Before today",
    it: "Prima di oggi",
  },
  "sim.pnl.priorLegNote": {
    en: "Sum of prior trading days’ closes ({days} days since entry).",
    it: "Somma gain giorni precedenti (chiusure, ingresso {days} giorni fa).",
  },
  "sim.pnl.portfolioPriorLeg": {
    en: "Before today (all tickers): {amount} · equals total − today 24h",
    it: "Prima di oggi (tutti i ticker): {amount} · totale − oggi 24h",
  },
  "sim.pnl.pricesAt": {
    en: "prices",
    it: "prezzi",
  },
  "sim.pnl.ledger.open": {
    en: "Daily detail",
    it: "Dettaglio giornaliero",
  },
  "sim.pnl.ledger.openTitle": {
    en: "Open day-by-day gain/loss table for all portfolio tickers",
    it: "Apri tabella gain/loss giorno per giorno per tutti i ticker del portafoglio",
  },
  "sim.audit.export.label": {
    en: "Gain audit (Excel)",
    it: "Audit gain (Excel)",
  },
  "sim.audit.export.title": {
    en: "Download day-by-day log: buy price, purchase date, shares, daily close, position value and P&L — for external reconciliation",
    it: "Scarica log giorno per giorno: prezzo acquisto, data ingresso, azioni, chiusura giornaliera, valore posizione e P&L — per controllo esterno",
  },
  "sim.audit.export.empty": {
    en: "No portfolio positions to export.",
    it: "Nessuna posizione da esportare.",
  },
  "sim.pnl.ledger.title": {
    en: "Daily P&L ledger",
    it: "Registro P&L giornaliero",
  },
  "sim.pnl.ledger.subtitle": {
    en: "Gain/loss per ticker for each recorded trading day (portfolio close snapshots + today). Closed positions stay in the ledger from history.",
    it: "Gain/loss per ticker per ogni giornata registrata (snapshot di chiusura + oggi). Le posizioni chiuse restano nel ledger dallo storico.",
  },
  "sim.pnl.ledger.close": {
    en: "Close",
    it: "Chiudi",
  },
  "sim.pnl.ledger.empty": {
    en: "No open positions with calculable P&L.",
    it: "Nessuna posizione aperta con P&L calcolabile.",
  },
  "sim.pnl.ledger.colTicker": {
    en: "Ticker",
    it: "Ticker",
  },
  "sim.pnl.ledger.colCd": {
    en: "CD",
    it: "CD",
  },
  "sim.pnl.ledger.colTotal": {
    en: "Total",
    it: "Totale",
  },
  "sim.pnl.ledger.colToday": {
    en: "Today (live or daily chg.)",
    it: "Oggi (live o var. giorn.)",
  },
  "sim.pnl.ledger.portfolioTotal": {
    en: "Portfolio total",
    it: "Totale portafoglio",
  },
  "sim.pnl.ledger.portfolioTotalOpen": {
    en: "Portfolio total (open)",
    it: "Totale portafoglio (aperte)",
  },
  "sim.pnl.ledger.portfolioTotalAll": {
    en: "Incl. closed (ledger history)",
    it: "Incl. chiuse (storico ledger)",
  },
  "sim.pnl.ledger.colTotalMtmTip": {
    en: "Sum of all daily € columns for this ticker (full history). Differs from the P&L card when «Daily chg. %» drives today.",
    it: "Somma di tutte le colonne € giornaliere del ticker (storico completo). Può differire dalla card P&L se oggi usa «Var. Giorn. %».",
  },
  "sim.pnl.ledger.colTotalAllDays": {
    en: "Total (all days)",
    it: "Totale (tutti i gg)",
  },
  "sim.pnl.ledger.colTotalAllDaysTitle": {
    en: "Sum of every daily € cell for this row — includes days outside the 5-day window.",
    it: "Somma di ogni cella € giornaliera della riga — include giorni fuori dalla finestra da 5.",
  },
  "sim.pnl.ledger.windowSubtotal": {
    en: "Subtotal (visible window)",
    it: "Subtotale (finestra visibile)",
  },
  "sim.pnl.ledger.windowSubtotalOpen": {
    en: "Open — subtotal (window)",
    it: "Aperte — subtotale (finestra)",
  },
  "sim.pnl.ledger.windowSubtotalAll": {
    en: "All — subtotal (window)",
    it: "Tutte — subtotale (finestra)",
  },
  "sim.pnl.ledger.windowMismatchNote": {
    en: "The TOTAL column sums all recorded days; the 5-day window above may not add up to TOTAL — see the subtotal row.",
    it: "La colonna TOTALE somma tutti i giorni registrati; la finestra da 5 giorni può non coincidere col TOTALE — vedi riga subtotale.",
  },
  "sim.pnl.ledger.mtmDivergenceBanner": {
    en: "Some open rows: ledger total (daily legs) differs from mark-to-market on the P&L card — usually because today uses «Daily chg. %» while the card uses current price vs entry.",
    it: "Su alcune aperte: il totale ledger (gambe giornaliere) differisce dal mark-to-market della card P&L — di solito perché oggi usa «Var. Giorn. %» mentre la card usa prezzo corrente vs ingresso.",
  },
  "sim.pnl.ledger.rowMtmTip": {
    en: "Mark-to-market since entry: {mtm} (ledger total {ledger})",
    it: "Mark-to-market da ingresso: {mtm} (totale ledger {ledger})",
  },
  "sim.pnl.ledger.todayNote": {
    en: "Each column is the € change vs the prior close. Empty cells = no snapshot that day for that ticker.",
    it: "Ogni colonna è la variazione € vs la chiusura precedente. Celle vuote = nessuno snapshot quel giorno per il ticker.",
  },
  "sim.pnl.ledger.todayFootnote": {
    en: "Today — current prices or «Daily chg. %» when no prior close is stored.",
    it: "Oggi — prezzi correnti o «Var. Giorn. %» se manca la chiusura precedente.",
  },
  "sim.pnl.ledger.incompleteBanner": {
    en: "Past daily closes are missing (days before server sync cannot be recovered). Day columns show only recorded snapshots; TOTAL sums recorded legs only. New snapshots sync automatically.",
    it: "Mancano chiusure giornaliere passate (giorni pre-sync non recuperabili). Le colonne giorno mostrano solo snapshot registrati; il TOTALE somma solo le gambe registrate. I nuovi snapshot si sincronizzano automaticamente.",
  },
  "sim.pnl.ledger.colTotalSinceEntry": {
    en: "Total (since entry)",
    it: "Totale (dall'ingresso)",
  },
  "sim.pnl.ledger.colTotalSinceEntryTitle": {
    en: "Mark-to-market P&L since purchase — used when daily close history is incomplete",
    it: "P&L mark-to-market dall'acquisto — usato quando lo storico giornaliero è incompleto",
  },
  "sim.pnl.ledger.archivedTag": {
    en: "closed",
    it: "chiusa",
  },
  "sim.pnl.ledger.archivedNote": {
    en: "{open} open · {closed} closed — closed rows use saved daily snapshots only.",
    it: "{open} aperte · {closed} chiuse — le righe chiuse usano solo snapshot giornalieri salvati.",
  },
  "sim.pnl.ledger.closedInPiggyNote": {
    en: "Open positions only. {n} closed deal(s) are in Closed piggy bank (beer glass), not listed here.",
    it: "Solo posizioni aperte. {n} deal chiusi sono nel Salvadanaio chiusi (bicchiere birra), non in questa tabella.",
  },
  "sim.pnl.ledger.windowTitle": {
    en: "View window",
    it: "Finestra visualizzazione",
  },
  "sim.pnl.ledger.windowDays": {
    en: "{n} days",
    it: "{n} giorni",
  },
  "sim.pnl.ledger.windowLast5": {
    en: "Last 5 days",
    it: "Ultimi 5 giorni",
  },
  "sim.pnl.ledger.windowPrevDay": {
    en: "Shift window one day back",
    it: "Sposta finestra indietro di 1 giorno",
  },
  "sim.pnl.ledger.windowNextDay": {
    en: "Shift window one day forward",
    it: "Sposta finestra avanti di 1 giorno",
  },
  "sim.pnl.ledger.windowPrevMonth": {
    en: "Previous month",
    it: "Mese precedente",
  },
  "sim.pnl.ledger.windowNextMonth": {
    en: "Next month",
    it: "Mese successivo",
  },
  "sim.pnl.ledger.windowHint": {
    en: "Click a day to set the window end — table shows 5 consecutive days ending on that date. Green dot = snapshot data.",
    it: "Clicca un giorno come fine finestra — la tabella mostra 5 giorni consecutivi fino a quella data. Punto verde = snapshot disponibile.",
  },
  "sim.pnl.ledger.windowHasData": {
    en: "Portfolio snapshot recorded this day",
    it: "Snapshot portafoglio registrato in questo giorno",
  },
  "closedPiggy.title": {
    en: "Closed piggy bank",
    it: "Salvadanaio chiuso",
  },
  "closedPiggy.short": {
    en: "Closed",
    it: "Chiuse",
  },
  "closedPiggy.count": {
    en: "{n} closed",
    it: "{n} chiuse",
  },
  "closedPiggy.pnlTip": {
    en: "Since last reset (if any) — realized P&L from sold/closed opportunities. Ledger cumulative may differ; see note below.",
    it: "Dall'ultimo azzeramento (se presente) — P&L realizzato da vendite/chiusure. Il totale ledger può differire; vedi nota sotto.",
  },
  "closedPiggy.onCapital": {
    en: "on capital",
    it: "su capitale",
  },
  "closedPiggy.empty": {
    en: "No closed opportunities yet — after Sell, P&L moves here from history.",
    it: "Nessuna opportunità chiusa — dopo Vendi, il P&L finisce qui dallo storico.",
  },
  "closedPiggy.gainFill": {
    en: "Gains fill the glass — cheers!",
    it: "I gain riempiono il bicchiere — cin cin!",
  },
  "closedPiggy.lossEmpty": {
    en: "Capital loss — glass stays empty.",
    it: "Perdita di capitale — bicchiere vuoto.",
  },
  "closedPiggy.explain": {
    en: "When you Sell, the position leaves the open piggy bank. Its realized daily P&L stays in this ledger and accumulates here.",
    it: "Quando vendi, la posizione esce dal salvadanaio aperto. Il P&L giornaliero realizzato resta nel ledger e si accumula qui.",
  },
  "closedPiggy.reset": {
    en: "Reset",
    it: "Azzera",
  },
  "closedPiggy.resetTip": {
    en: "Set current cumulative as zero — start a fresh closed piggy bank counter",
    it: "Imposta il cumulato attuale a zero — riparti con un nuovo contatore",
  },
  "closedPiggy.resetConfirm": {
    en: "Reset closed piggy bank?\n\nReading € {display} → €0 (counter only).\nLedger cumulative € {raw} stored as baseline.\nClosed positions stay in the ledger.",
    it: "Azzerare il salvadanaio chiuso?\n\nLettura € {display} → €0 (solo contatore).\nCumulato ledger € {raw} salvato come baseline.\nLe posizioni chiuse restano nel ledger.",
  },
  "closedPiggy.resetConfirmFirst": {
    en: "Reset closed piggy bank?\n\nCurrent cumulative € {amount} → €0.\nClosed positions stay in the ledger.",
    it: "Azzerare il salvadanaio chiuso?\n\nCumulato attuale € {amount} → €0.\nLe posizioni chiuse restano nel ledger.",
  },
  "closedPiggy.sinceResetNote": {
    en: "Since last reset · ledger total € {raw}",
    it: "Dall'ultimo azzeramento · totale ledger € {raw}",
  },
  "closedPiggy.compactTipSinceReset": {
    en: "Closed P&L since last Reset: {sinceReset} €. All-time (matches Pulse · Gain closed): {allTime} €.",
    it: "P&L chiuso dall'ultimo Reset: {sinceReset} €. Totale storico (come Pulse · Gain closed): {allTime} €.",
  },
  "closedPiggy.compactTipAllTime": {
    en: "All-time closed P&L: {allTime} € — same basis as Pulse · Gain closed.",
    it: "P&L chiuso totale: {allTime} € — stessa base di Pulse · Gain closed.",
  },
  "closedPiggy.openLedger": {
    en: "Open closed P&L ledger in Simulation",
    it: "Apri ledger P&L chiuso in Simulation",
  },
  "sim.pnl.empty": {
    en: "Enter capital and buy price on at least one row in the portfolio simulation.",
    it: "Inserisci capitale e prezzo acquisto su almeno una riga nella simulazione portafoglio.",
  },
  "sim.pnl.hero.label": {
    en: "Open portfolio — total P&L since entry",
    it: "Portafoglio aperto — P&L totale dall'ingresso",
  },
  "sim.pnl.hero.breakdown": {
    en: "Before today {prior} · Today {today} ({todayPct}) · adds up to total above",
    it: "Prima di oggi {prior} · Oggi {today} ({todayPct}) · somma = totale sopra",
  },
  "sim.pnl.hero.breakdownImplicit": {
    en: "Before today {prior} (estimated: total − today, daily closes not verified) · Today {today} ({todayPct})",
    it: "Prima di oggi {prior} (stimato: totale − oggi, chiusure giornaliere non verificate) · Oggi {today} ({todayPct})",
  },
  "sim.pnl.hero.breakdownUncertain": {
    en: "Before today {prior} (estimated — history may be unreliable; using price MTM total) · Today {today} ({todayPct})",
    it: "Prima di oggi {prior} (stimato — storico possibilmente inaffidabile; totale da MTM prezzo) · Oggi {today} ({todayPct})",
  },
  "sim.pnl.hero.breakdownTodayOnly": {
    en: "Today alone: {today} ({todayPct}) — not your total portfolio loss",
    it: "Solo oggi: {today} ({todayPct}) — non è la perdita totale del portafoglio",
  },
  "sim.pnl.kpi.totalTitle": {
    en: "Total P&L (from entry · MTM)",
    it: "P&L totale (da ingresso · MTM)",
  },
  "sim.pnl.kpi.todayTitle": {
    en: "Today only (24h vs prev close)",
    it: "Solo oggi (24h vs chiusura precedente)",
  },
  "sim.pnl.kpi.todayTitleTip": {
    en: "Today's move only — not total since buy. Uses «Daily chg. %» × position value vs prior close.",
    it: "Solo il movimento di oggi — non il totale dall'acquisto. «Var. Giorn. %» × valore posizione vs chiusura precedente.",
  },
  "sim.pnl.recalc": {
    en: "Recalc",
    it: "Ricalc",
  },
  "sim.pnl.onInvested": {
    en: "on {capital} invested · value {value}",
    it: "su {capital} investiti · valore {value}",
  },
  "sim.pnl.tickersWithDaily": {
    en: "{covered}/{total} tickers with «Daily chg. %»",
    it: "{covered}/{total} ticker con «Var. Giorn. %»",
  },
  "sim.pnl.hintReload": {
    en: "On VPS the server refreshes Yahoo prices automatically every hour Mon–Fri 15:30–22:00 Rome; desktop reloads all tabs within ~20s when the manifest changes. Manual Reload only needed if you are offline from the server or after a local-only refresh.",
    it: "Su VPS il server aggiorna i prezzi Yahoo ogni ora lun–ven 15:30–22:00 (Roma); il desktop ricarica tutte le tab entro ~20s quando cambia il manifest. Reload manuale serve solo se sei offline dal server o dopo un refresh solo locale.",
  },
  "sim.pnl.slopeHarmonyNote": {
    en: "Expected gain here = model curve to catalyst (CD), not Slope errors «Model T+5 $». Acceleration in the Lab only means 5d slope strengthening vs 20d (|Δ| ≥ 0.8 pp/d).",
    it: "Gain atteso qui = curva modello verso il catalizzatore (CD), non la colonna «Modello T+5 $» in Errori pendenza. Accelerazione nel Lab = solo pendenza 5g che si rafforza vs 20g (|Δ| ≥ 0,8 pp/g).",
  },
  "signals.slopeHarmonyNote": {
    en: "Slope errors are diagnostic (momentum Δ, Model T+5 $). BUY/SELL, P&L expected gain and Top 2 use pred5 + curve-to-CD — not the acceleration badge alone.",
    it: "Errori pendenza = diagnostica (Δ momentum, Modello T+5 $). BUY/SELL, gain atteso P&L e Top 2 usano pred5 + curva verso CD — non il solo badge Accelerazione.",
  },
  "signals.mig.tab": {
    en: "Market interest (MII)",
    it: "Interesse mercato (MII)",
  },
  "signals.slope.tab": {
    en: "Slope",
    it: "Slope",
  },
  "signals.slope.panelTitle": {
    en: "Companies — slope",
    it: "Società — slope",
  },
  "signals.mig.title": {
    en: "Market Interest Index — all Simulation tickers",
    it: "Market Interest Index — tutti i ticker Simulation",
  },
  "signals.mig.subtitle": {
    en: "Price × volume slope angle. Separate gate from SDS — filters structural market interest vs noise. On VPS, prices and MII recalibrate hourly Mon–Fri 15:30–22:00 (Rome).",
    it: "Angolo pendenza prezzo × volume. Gate separato dal SDS — filtra interesse strutturale vs rumore. Su VPS, prezzi e MII si ricalibrano ogni ora lun–ven 15:30–22:00 (ora di Roma).",
  },
  "signals.mig.minAngle": {
    en: "Min slope angle: {deg}°",
    it: "Angolo minimo: {deg}°",
  },
  "signals.mig.angleGuide.openButton": {
    en: "Angle guide",
    it: "Guida angoli",
  },
  "signals.mig.angleGuide.openTip": {
    en: "What each MII slope threshold means — and the price move + volume that corresponds to each angle.",
    it: "Cosa significa ogni soglia di pendenza MII — e a quale movimento prezzo + volume corrisponde ciascun angolo.",
  },
  "signals.mig.angleGuide.title": {
    en: "MII slope angle thresholds",
    it: "Soglie angolo pendenza MII",
  },
  "signals.mig.angleGuide.subtitle": {
    en: "Gate PASS when |MII°| ≥ your slider. ΔP ≈ 5-day move; Vol× vs 20-day average. Formula: arctan(ΔP × log(Vol×+1) × √Vol× / {norm}) × 180/π.",
    it: "Gate PASS se |MII°| ≥ slider. ΔP ≈ movimento ~5g; Vol× vs media 20g. Formula: arctan(ΔP × log(Vol×+1) × √Vol× / {norm}) × 180/π.",
  },
  "signals.mig.angleGuide.col.threshold": {
    en: "Threshold",
    it: "Soglia",
  },
  "signals.mig.angleGuide.col.behavior": {
    en: "Behavior",
    it: "Comportamento",
  },
  "signals.mig.angleGuide.col.priceVol": {
    en: "Price ~5d · Vol×",
    it: "Prezzo ~5g · Vol×",
  },
  "signals.mig.angleGuide.currentBadge": {
    en: "current",
    it: "attuale",
  },
  "signals.mig.angleGuide.behavior.below15": {
    en: "Too sensitive — too much noise, frequent false signals.",
    it: "Troppo sensibile — passa troppo rumore, segnali falsi frequenti.",
  },
  "signals.mig.angleGuide.behavior.15": {
    en: "Very sensitive — catches early whispers; more noise.",
    it: "Molto sensibile — cattura sussurri early; più rumore.",
  },
  "signals.mig.angleGuide.behavior.20": {
    en: "Minimum conservative threshold — filters noise, captures real interest.",
    it: "Soglia minima conservativa — filtra il rumore, cattura interesse reale.",
  },
  "signals.mig.angleGuide.behavior.23": {
    en: "Good for pre-CD biotech with catalyst nearby — balanced signal/noise.",
    it: "Buono per biotech pre-CD con CD vicino — equilibrio segnale/rumore.",
  },
  "signals.mig.angleGuide.behavior.28": {
    en: "Aggressive threshold — only strong momentum passes.",
    it: "Soglia aggressiva — lascia passare solo titoli con forte momentum.",
  },
  "signals.mig.angleGuide.behavior.35": {
    en: "Very strict — late entries, fewer names.",
    it: "Molto restrittivo — ingressi tardivi, meno titoli.",
  },
  "signals.mig.angleGuide.behavior.above35": {
    en: "Too restrictive — you lose early-stage opportunities.",
    it: "Troppo restrittivo — perdi opportunità early-stage.",
  },
  "signals.mig.angleGuide.why23Title": {
    en: "Why ~23° is defensible for pre-CD biotech:",
    it: "Perché ~23° è difendibile in biotech pre-CD:",
  },
  "signals.mig.angleGuide.why23a": {
    en: "≈ +6% price with Vol× 1.5 (typical hot-zone move with elevated volume).",
    it: "≈ prezzo +6% con Vol× 1,5 (movimento tipico in zona hot con volume elevato).",
  },
  "signals.mig.angleGuide.why23b": {
    en: "Or ≈ +10% price even with normal volume (Vol× 1.0).",
    it: "Oppure ≈ prezzo +10% anche con volume nella norma (Vol× 1,0).",
  },
  "signals.mig.angleGuide.why23c": {
    en: "Pre-CD biotech often moves in these magnitudes before catalyst.",
    it: "In biotech pre-CD il mercato si muove spesso con questi ordini di grandezza prima del catalizzatore.",
  },
  "signals.mig.filterPositiveSlope": {
    en: "Slope + only ({n})",
    it: "Solo slope + ({n})",
  },
  "signals.mig.filterPositiveSlopeTip": {
    en: "Show only tickers with positive MII angle (upward market slope), sorted steepest first.",
    it: "Mostra solo società con MII ° positivo (pendenza mercato al rialzo), ordinate dalla più ripida.",
  },
  "signals.mig.filterCdUnder60": {
    en: "CD <60d ({n})",
    it: "CD <60g ({n})",
  },
  "signals.mig.filterCdUnder60Tip": {
    en: "Show only tickers in the hot zone — Completion Date within the next 60 days (T−60…T−0).",
    it: "Mostra solo società in zona hot — Completion Date entro i prossimi 60 giorni (T−60…T−0).",
  },
  "signals.mig.filterAll": {
    en: "All",
    it: "Tutti",
  },
  "signals.mig.formulaTitle": {
    en: "Formula & calibration",
    it: "Formula e calibrazione",
  },
  "signals.mig.gateNote": {
    en: "Recommended as a separate gate (like macro context): PASS → SDS/ranking; WATCH → flag; BLOCK → exclude from hot list. Not merged into SDS cluster C without validation.",
    it: "Consigliato come gate separato (come macro context): PASS → SDS/ranking; WATCH → flag; BLOCK → escluso da hot list. Non fondere nel cluster C SDS senza validazione.",
  },
  "signals.mig.emptySim": {
    en: "Load Simulation data first.",
    it: "Carica prima i dati Simulation.",
  },
  "signals.mig.emptyFilter": {
    en: "No tickers for this filter.",
    it: "Nessun ticker per questo filtro.",
  },
  "signals.mig.glyphLegend": {
    en: "Slope icon: green/red arm = MII angle; dashed grey = 0°; dashed amber = ± PASS threshold from slider.",
    it: "Icona pendenza: braccio verde/rosso = angolo MII; grigio tratteggiato = 0°; ambra = soglia PASS ± dal slider.",
  },
  "signals.mig.col.miiAngle": {
    en: "MII °",
    it: "MII °",
  },
  "signals.mig.col.miiAngleTip": {
    en: "How steeply the market is moving: price change weighted by volume. Green = rising interest, red = falling. Hover row values for Δ source (1M trend vs 24h).",
    it: "Quanto è ripida la pendenza del mercato: variazione prezzo pesata sul volume. Verde = interesse in salita, rosso = in discesa. Passa il mouse sulla riga per la fonte del Δ (trend 1M vs 24h).",
  },
  "signals.mig.col.miiRaw": {
    en: "Idx",
    it: "Indice",
  },
  "signals.mig.col.miiRawTip": {
    en: "Raw interest score before converting to degrees — combines recent price move and volume activity.",
    it: "Punteggio grezzo di interesse prima dei gradi — combina movimento prezzo recente e attività di volume.",
  },
  "signals.mig.col.tickerTip": {
    en: "Company ticker. For portfolio names, CD and days to catalyst are shown below.",
    it: "Ticker società. Per i titoli in portafoglio, sotto compaiono CD e giorni al catalizzatore.",
  },
  "signals.mig.col.gate": {
    en: "Gate",
    it: "Gate",
  },
  "signals.mig.col.gateTip": {
    en: "Market-interest filter: PASS = strong slope (actionable), WATCH = borderline, BLOCK = too flat or low conviction.",
    it: "Filtro interesse mercato: PASS = pendenza forte (operativa), WATCH = zona grigia, BLOCK = troppo piatta o poco convincente.",
  },
  "signals.mig.col.delta": {
    en: "ΔP ~5d",
    it: "ΔP ~5g",
  },
  "signals.mig.col.deltaTip": {
    en: "Approximate price change over ~5 days — main input for the MII slope (from daily move or 1M trend).",
    it: "Variazione prezzo approssimativa su ~5 giorni — input principale della pendenza MII (da var. giornaliera o trend 1M).",
  },
  "signals.mig.deltaSource.var1m": {
    en: "MII Δ from 1M trend (Var. 1M % → ~5d) = {delta} — not extrapolated from today's 24h alone",
    it: "Δ MII da trend 1M (Var. 1M % → ~5g) = {delta} — non ricavato solo dal 24h di oggi",
  },
  "signals.mig.deltaSource.daily": {
    en: "MII Δ from daily move (Var. Giorn. % × 5) = {delta}",
    it: "Δ MII da var. giornaliera (Var. Giorn. % × 5) = {delta}",
  },
  "signals.mig.deltaSource.slope5": {
    en: "MII Δ from sheet slope≈5d × 5 = {delta}",
    it: "Δ MII da slope≈5g foglio × 5 = {delta}",
  },
  "signals.mig.deltaSource.missing": {
    en: "MII Δ estimate = {delta} (no Var. 1M / daily in sheet)",
    it: "Stima Δ MII = {delta} (manca Var. 1M / giornaliera nel foglio)",
  },
  "signals.mig.deltaSource.divergence": {
    en: "24h is {daily} but MII uses the 1M trend ({delta} ~5d) — bounce vs structural slope",
    it: "24h = {daily} ma MII usa il trend 1M ({delta} ~5g) — rimbalzo vs pendenza strutturale",
  },
  "signals.mig.deltaSource.divergenceShort": {
    en: "24h today {daily} — can differ when 1M trend drives MII",
    it: "24h oggi {daily} — può differire se guida il trend 1M",
  },
  "signals.mig.deltaSource.lowVolPenalty": {
    en: "low volume on rise penalizes MII",
    it: "volume basso su rialzo penalizza MII",
  },
  "signals.mig.col.vol": {
    en: "Vol×",
    it: "Vol×",
  },
  "signals.mig.col.volTip": {
    en: "Recent volume vs 20-day average. Above 1× = more trading activity; low volume on a rise reduces the MII score.",
    it: "Volume recente vs media 20 giorni. Sopra 1× = più scambi; volume basso su un rialzo riduce il punteggio MII.",
  },
  "signals.mig.col.curve": {
    en: "Pred+recalib",
    it: "Pred+recalib",
  },
  "signals.mig.col.curveTip": {
    en: "Mini chart of the predicted path to the catalyst, recalibrated each day. Click to open the full curve.",
    it: "Mini grafico del percorso previsto verso il CD, ricalibrato ogni giorno. Clic per aprire la curva completa.",
  },
  "signals.mig.tableGuide": {
    en: "Hover column headers for a short explanation of each metric.",
    it: "Passa il mouse sui titoli di colonna per una spiegazione breve di ogni indice.",
  },
  "signals.mig.col.pnl24h": {
    en: "24h",
    it: "24h",
  },
  "signals.mig.col.pnl24hTip": {
    en: "Today's gain or loss vs yesterday's close (%). For portfolio tickers, € move on your position is shown below.",
    it: "Gain o loss di oggi vs chiusura di ieri (%). Per titoli in portafoglio, sotto compare anche il movimento € sulla posizione.",
  },
  "signals.mig.col.calib": {
    en: "Calib",
    it: "Calib",
  },
  "signals.mig.col.calibTip": {
    en: "Model calibration — how much the MII inclinometer (market) differs from the recalibrated model slope (same arctan formula & volume). 100 = aligned, low = drift or contrarian.",
    it: "Calibrazione modello — quanto l'inclinometro MII (mercato) differisce dalla slope del modello ricalibrato (stessa formula arctan e volume). 100 = allineato, basso = drift o contrarian.",
  },
  "signals.mig.col.calibVisual": {
    en: "Calib",
    it: "Calib",
  },
  "signals.mig.col.calibVisualTip": {
    en: "How well the model slope matches the market (0–100). High = prediction and real move agree. Click the donut for details.",
    it: "Quanto la pendenza del modello coincide col mercato (0–100). Alto = previsione e movimento reale concordi. Clic sulla torta per il dettaglio.",
  },
  "signals.mig.calibVisualLegend": {
    en: "Calib chart: violet dashed = model before daily open · blue = after live anchor · bold green/red = MII. Pie fill = pre≈MII alignment %.",
    it: "Grafico Calib: viola tratteggio = modello prima daily open · blu = dopo ancoraggio live · verde/rosso = MII. Riempimento torta = allineamento pre≈MII %.",
  },
  "signals.mig.calibModal.title": {
    en: "Slope calibration — {ticker}",
    it: "Calib pendenza — {ticker}",
  },
  "signals.mig.calibModal.subtitle": {
    en: "Pre-daily model vs post-daily vs market MII. Amber arc = relative gap % between pre and MII.",
    it: "Modello pre-daily vs post-daily vs MII mercato. Arco ambra = gap % relativo tra pre e MII.",
  },
  "signals.mig.calibModal.legendTitle": {
    en: "Legend",
    it: "Didascalia",
  },
  "signals.mig.col.calibClickHint": {
    en: "Click to open slope chart",
    it: "Clic per aprire il grafico",
  },
  "signals.mig.calibModal.slopeChart": {
    en: "Market vs model slopes (today)",
    it: "Pendenze mercato vs modello (oggi)",
  },
  "signals.mig.calibModal.refresh": {
    en: "Data as of: {at} · recalculated on each Simulation refresh",
    it: "Dati aggiornati al: {at} · ricalcolati ad ogni refresh Simulation",
  },
  "signals.mig.calibModal.dailyNote": {
    en: "MII uses live price Δ and SDS volume; model slopes use Pred+5 from the recalibrated curve (pre = before daily open anchor, post = after live shift). On VPS, hourly refresh Mon–Fri 15:30–22:00 Rome recalibrates prices and slope.",
    it: "MII usa Δ prezzo live e volume SDS; le pendenze modello usano Pred+5 dalla curva ricalibrata (pre = prima ancoraggio daily open, post = dopo shift live). Su VPS, refresh orario lun–ven 15:30–22:00 (Roma) ricalibra prezzi e pendenza.",
  },
  "signals.mig.calibTier.aligned": {
    en: "Aligned",
    it: "Allineato",
  },
  "signals.mig.calibTier.drift": {
    en: "Drift",
    it: "Drift",
  },
  "signals.mig.calibTier.diverge": {
    en: "Diverge",
    it: "Diverge",
  },
  "signals.mig.calibTier.contrarian": {
    en: "Contrarian",
    it: "Contrarian",
  },
  "signals.mig.calibTier.unknown": {
    en: "No model",
    it: "No modello",
  },
  "modelLab.subtitle.learnings": {
    en: "Plain-language status: is the model improving, what's it waiting on, and what it means for your signals",
    it: "Stato in parole semplici: il modello migliora? Cosa aspetta? Cosa cambia per i tuoi segnali",
  },
  "modelLab.tab.qc": {
    en: "Q&C",
    it: "Q&C",
  },
  "modelLab.tab.qcToday": {
    en: "Today",
    it: "Oggi",
  },
  "modelLab.tab.performance": {
    en: "Today",
    it: "Oggi",
  },
  "modelLab.tab.raCalibration": {
    en: "RA Score Calibration",
    it: "RA Score Calibration",
  },
  "modelLab.subtitle.performance": {
    en: "Model health, stretch, SDS ROI and forward accuracy tracking",
    it: "Salute modello, stretch, ROI SDS e tracking accuratezza forward",
  },
  "modelLab.subtitle.eisAnalysis": {
    en: "EIS score vs market reaction — high vs low magnitude, price correlation, temporal radius before CD",
    it: "Score EIS vs reazione di mercato — magnitudine alta vs bassa, correlazione prezzo, raggio temporale pre-CD",
  },
  "modelLab.subtitle.raCalibration": {
    en: "RA score bands, invest threshold, monotonicity ρ and calibration confidence",
    it: "Bande RA score, soglia invest, monotonicità ρ e confidence di calibrazione",
  },
  "modelLab.accuracyLastUpdated": {
    en: "Last update: {at}",
    it: "Ultimo aggiornamento: {at}",
  },
  "modelLab.accuracyLastUpdatedPending": {
    en: "Awaiting first scheduled refresh (Mon–Fri 4:30 PM Europe/Rome).",
    it: "In attesa del primo refresh programmato (lun–ven 16:30 Europe/Rome).",
  },
  "modelLab.accuracyScheduleNote": {
    en: "Scheduled refresh (Europe/Rome): RA Prediction Calibration, SDS Accuracy, and EIS Signal Impact Mon–Fri at 4:30 PM.",
    it: "Refresh programmato (Europe/Rome): RA Prediction Calibration, SDS Accuracy e Impatto segnale EIS lun–ven alle 16:30.",
  },
  "modelLab.subtitle.learningLab": {
    en: "Learning Lab — cluster CF, regime ×, effectiveness",
    it: "Learning Lab — cluster CF, regime ×, effectiveness",
  },
  "modelLab.performance.openLearningLab": {
    en: "Learning over time",
    it: "Impara nel tempo",
  },
  "modelLab.performance.openRaCalibration": {
    en: "RA calibration",
    it: "Calibra RA",
  },
  "modelLab.performance.openSdsAccuracy": {
    en: "SuperNova accuracy",
    it: "Precisione SuperNova",
  },
  "modelLab.performance.openEisAnalysis": {
    en: "Event impact",
    it: "Impatto eventi",
  },
  "modelLab.missedOpp.introTitle": {
    en: "Missed entry opportunities (24h)",
    it: "Opportunità di ingresso perse (24h)",
  },
  "modelLab.missedOpp.introBody": {
    en: "Primary recall: operational T−90→T−14 (CD 14–90 days). Secondary watch recall: T−61→T−120 with provisional target (Phase 1–2). Near-CD and held gainers shown separately.",
    it: "Recall primario: operativo T−90→T−14 (CD 14–90 gg). Recall watch secondario: T−61→T−120 con target provvisorio (Fase 1–2). Near-CD e già in portafoglio mostrati a parte.",
  },
  "modelLab.missedOpp.kpiRecall": {
    en: "Recall Enter",
    it: "Recall Enter",
  },
  "modelLab.missedOpp.kpiRecallSub": {
    en: "{detected}/{total} operational · monitor {monitorPct}%",
    it: "{detected}/{total} operativi · monitor {monitorPct}%",
  },
  "modelLab.missedOpp.kpiWatchRecall": {
    en: "Watch recall",
    it: "Recall watch",
  },
  "modelLab.missedOpp.kpiWatchRecallSub": {
    en: "{detected}/{total} T−61→T−120 gainers",
    it: "{detected}/{total} rialzi T−61→T−120",
  },
  "modelLab.missedOpp.kpiMissed": {
    en: "Missed today",
    it: "Perse oggi",
  },
  "modelLab.missedOpp.kpiMissedSub": {
    en: "≥ +{min}% · T−90→T−14 only",
    it: "≥ +{min}% · solo T−90→T−14",
  },
  "modelLab.missedOpp.kpiGainers": {
    en: "24h gainers",
    it: "Rialzi 24h",
  },
  "modelLab.missedOpp.kpiGainersSub": {
    en: "{with24h}/{universe} with daily data",
    it: "{with24h}/{universe} con dato giornaliero",
  },
  "modelLab.missedOpp.kpiPrecision": {
    en: "Enter precision",
    it: "Precisione Enter",
  },
  "modelLab.missedOpp.kpiPrecisionSub": {
    en: "{fp} false positives / {suggested} Enter calls",
    it: "{fp} falsi positivi / {suggested} chiamate Enter",
  },
  "modelLab.missedOpp.funnelLine": {
    en: "{total} total gainers → {operational} {operationalWord} → {missed} {missedWord}",
    it: "{total} rialzi totali → {operational} {operationalWord} → {missed} {missedWord}",
  },
  "modelLab.missedOpp.funnelLineTip": {
    en: "Operational = off-portfolio, CD 14–90 days, ≥ +0.5% today. Recall uses only this subset.",
    it: "Operativo = fuori portafoglio, CD 14–90 gg, ≥ +0,5% oggi. Il recall usa solo questo sottoinsieme.",
  },
  "modelLab.missedOpp.funnelExcluded": {
    en: "{excluded} excluded: {held} held · {cdDistant} CD distant · {outside} outside monitor",
    it: "{excluded} esclusi: {held} in portafoglio · {cdDistant} CD lontano · {outside} fuori monitor",
  },
  "modelLab.missedOpp.funnelWatchLine": {
    en: "Watch T−61→T−120: {recall}% recall ({detected}/{total} Enter + gain)",
    it: "Watch T−61→T−120: recall {recall}% ({detected}/{total} Enter + rialzo)",
  },
  "modelLab.missedOpp.funnelOperationalOne": {
    en: "operational",
    it: "operativo",
  },
  "modelLab.missedOpp.funnelOperationalMany": {
    en: "operational",
    it: "operativi",
  },
  "modelLab.missedOpp.funnelMissedOne": {
    en: "missed",
    it: "persa",
  },
  "modelLab.missedOpp.funnelMissedMany": {
    en: "missed",
    it: "perse",
  },
  "modelLab.missedOpp.chartCoverageTitle": {
    en: "Coverage of 24h gainers",
    it: "Copertura rialzi 24h",
  },
  "modelLab.missedOpp.chartCoverageSub": {
    en: "Operational T−90→T−14, watch T−61→T−120, CD distant, held, outside monitor.",
    it: "Operativo T−90→T−14, watch T−61→T−120, CD lontano, in portafoglio, fuori monitor.",
  },
  "modelLab.missedOpp.chartPnlTitle": {
    en: "24h P&L comparison (€)",
    it: "Confronto P&L 24h (€)",
  },
  "modelLab.missedOpp.chartPnlSub": {
    en: "Hypothetical €{capital} per ticker — today’s 24h move vs recommendations and your portfolio.",
    it: "Ipotetico €{capital} per titolo — movimento 24h di oggi vs raccomandazioni e portafoglio.",
  },
  "modelLab.missedOpp.chartPnlSnapshotNote": {
    en: "One snapshot per calendar day when you open Performance (stored locally, up to 45 days). Reopening the same day updates that point.",
    it: "Uno snapshot per giorno di calendario aprendo Performance (localStorage, max 45 gg). Riaprendo lo stesso giorno si aggiorna il punto.",
  },
  "modelLab.missedOpp.chartPnlDailyTitle": {
    en: "Daily 24h P&L",
    it: "P&L 24h giornaliero",
  },
  "modelLab.missedOpp.chartPnlDailySub": {
    en: "Each point = that day’s 24h gain only. Blue dashed = paper sim loop experiment; orange = your real portfolio.",
    it: "Ogni punto = solo guadagno 24h del giorno. Blu tratteggiato = sim loop paper; arancio = portafoglio reale.",
  },
  "modelLab.missedOpp.chartPnlCumTitle": {
    en: "Cumulative P&L",
    it: "P&L cumulativo",
  },
  "modelLab.missedOpp.chartPnlCumSub": {
    en: "Running sum — green = all gainers ceiling · blue dashed = sim loop · teal = executable recs · orange = you.",
    it: "Somma progressiva — verde = tetto rialzisti · blu = sim loop · teal = rec eseguibili · arancio = tu.",
  },
  "modelLab.missedOpp.kpiDeltaActual": {
    en: "Actual vs yesterday",
    it: "Reale vs ieri",
  },
  "modelLab.missedOpp.kpiFirstDay": {
    en: "first day",
    it: "primo giorno",
  },
  "modelLab.missedOpp.kpiCaptureRate": {
    en: "Capture rate",
    it: "Tasso cattura",
  },
  "modelLab.missedOpp.kpiCaptureRateFair": {
    en: "Capture (executable)",
    it: "Cattura (eseguibile)",
  },
  "modelLab.missedOpp.kpiCaptureRateRaw": {
    en: "Capture (raw 100%)",
    it: "Cattura (100% grezzo)",
  },
  "modelLab.missedOpp.kpiCaptureFairHint": {
    en: "actual ÷ executable recs",
    it: "reale ÷ rec eseguibili",
  },
  "modelLab.missedOpp.kpiCaptureHint": {
    en: "actual ÷ recommendations",
    it: "reale ÷ raccomandazioni",
  },
  "modelLab.missedOpp.kpiGapVsRec": {
    en: "Gap vs raw recs",
    it: "Gap vs rec grezzo",
  },
  "modelLab.missedOpp.kpiGapVsFairRec": {
    en: "Gap vs executable",
    it: "Gap vs eseguibile",
  },
  "modelLab.missedOpp.kpiGapFairHint": {
    en: "€ left vs executable recs",
    it: "€ persi vs rec eseguibili",
  },
  "modelLab.missedOpp.kpiGapHint": {
    en: "€ left vs 100% recs",
    it: "€ persi vs 100% rec",
  },
  "modelLab.missedOpp.lineAllGainers": {
    en: "All 24h gainers (€5k each)",
    it: "Tutti i rialzi 24h (€5k ciascuno)",
  },
  "modelLab.missedOpp.lineRecommendations": {
    en: "100% recommendations (raw)",
    it: "100% raccomandazioni (grezzo)",
  },
  "modelLab.missedOpp.lineSimLoop": {
    en: "Paper sim loop (experiment)",
    it: "Sim loop paper (esperimento)",
  },
  "modelLab.missedOpp.lineSimLoopTip": {
    en: "Daily Δ total piggy from Decision Sim ticks — auto-trades all BUY/SELL signals. Compare vs your actual portfolio (orange).",
    it: "Δ giornaliero piggy totale dai tick Decision Sim — segue tutti i segnali BUY/SELL. Confronta col tuo portafoglio reale (arancio).",
  },
  "modelLab.missedOpp.kpiVsSimLoop": {
    en: "Portfolio vs sim loop",
    it: "Portafoglio vs sim loop",
  },
  "modelLab.missedOpp.kpiVsSimLoopHint": {
    en: "actual − paper experiment (cum.)",
    it: "reale − esperimento paper (cum.)",
  },
  "modelLab.missedOpp.kpiSimLoopGain": {
    en: "Sim loop experiment gain",
    it: "Gain esperimento sim loop",
  },
  "modelLab.missedOpp.kpiSimLoopGainHint": {
    en: "paper experiment (cum.)",
    it: "esperimento paper (cum.)",
  },
  "modelLab.missedOpp.vsSimLoop.kpiDelta": {
    en: "Portfolio vs sim loop (Δ €)",
    it: "Portafoglio vs sim loop (Δ €)",
  },
  "modelLab.missedOpp.vsSimLoop.kpiDeltaHint": {
    en: "positive = you beat the paper experiment",
    it: "positivo = batti l'esperimento paper",
  },
  "modelLab.missedOpp.vsSimLoop.analysisShow": {
    en: "Why the gap? — deep dive",
    it: "Perché il divario? — analisi",
  },
  "modelLab.missedOpp.vsSimLoop.analysisHide": {
    en: "Hide analysis",
    it: "Nascondi analisi",
  },
  "modelLab.missedOpp.vsSimLoop.analysisLead": {
    en: "The sim loop is a paper portfolio that auto-executes every BUY/SELL from Decision Sim (P(plan), Top2, precat). Your real book can differ in timing, sizing and filters.",
    it: "Il sim loop è un portafoglio paper che esegue automaticamente ogni BUY/SELL del Decision Sim (P(plan), Top2, precat). Il tuo portafoglio reale può differire per timing, size e filtri.",
  },
  "modelLab.missedOpp.vsSimLoop.factorAhead": {
    en: "Your cumulative P&L is about €{delta} above the paper sim loop — selective entries or better holds likely helped.",
    it: "Il P&L cumulativo è circa €{delta} sopra il sim loop paper — ingressi selettivi o hold migliori hanno probabilmente aiutato.",
  },
  "modelLab.missedOpp.vsSimLoop.factorBehind": {
    en: "The paper sim loop is about €{delta} ahead — it may have taken BUYs you skipped or exited losers earlier.",
    it: "Il sim loop paper è circa €{delta} avanti — può aver preso BUY che hai saltato o chiuso perdenti prima.",
  },
  "modelLab.missedOpp.vsSimLoop.factorRaNotDriver": {
    en: "RA score is not the sim loop gate — it uses P(plan), Top2, precat and 24h momentum. A weak RA split at T−X does not by itself explain sim loop underperformance.",
    it: "Lo RA score non governa il sim loop — usa P(plan), Top2, precat e momentum 24h. Un RA debole a T−X non spiega da solo un sim loop indietro.",
  },
  "modelLab.missedOpp.vsSimLoop.factorBadBuys": {
    en: "Sim loop scorecard: {n} bad buy(s) closed (paper loss > ~3%) — your real portfolio may have avoided these names.",
    it: "Scorecard sim loop: {n} bad buy chiusi (perdita paper > ~3%) — il portafoglio reale può aver evitato questi titoli.",
  },
  "modelLab.missedOpp.vsSimLoop.factorMissedBuys": {
    en: "{n} missed buy(s) in the experiment (~€{eur} est.) — cap 8 slots or gates blocked paper entries you may have taken manually.",
    it: "{n} missed buy nell'esperimento (~€{eur} st.) — cap 8 slot o gate hanno bloccato ingressi paper che tu puoi aver fatto manualmente.",
  },
  "modelLab.missedOpp.vsSimLoop.factorLowOverlap": {
    en: "Only {overlap}/{paperN} paper tickers overlap your {realN} real holdings — different books amplify P&L divergence.",
    it: "Solo {overlap}/{paperN} ticker paper coincidono con {realN} titoli reali — libri diversi amplificano il divario P&L.",
  },
  "modelLab.missedOpp.vsSimLoop.factorAdvicePrecision": {
    en: "Closed advice precision in the experiment: {pct}% good vs bad — checks whether auto-signals worked on paper.",
    it: "Precisione consigli chiusi nell'esperimento: {pct}% buoni vs cattivi — verifica se i segnali auto hanno funzionato on paper.",
  },
  "modelLab.missedOpp.vsSimLoop.factorExecutableAligned": {
    en: "You match or beat executable recs (gap ≤ €{gap}) — performance is in line with the fair benchmark, not just beating a noisy auto-trader.",
    it: "Allineato o sopra le rec eseguibili (gap ≤ €{gap}) — la performance è coerente col benchmark fair, non solo col auto-trader rumoroso.",
  },
  "modelLab.missedOpp.vsSimLoop.overlapMeta": {
    en: "Holdings overlap: {overlap} · paper {paperN} · real {realN}",
    it: "Overlap posizioni: {overlap} · paper {paperN} · reale {realN}",
  },
  "modelLab.missedOpp.vsSimLoop.dailyDelta": {
    en: "Today's 24h delta vs sim loop: {delta}",
    it: "Delta 24h odierno vs sim loop: {delta}",
  },
  "modelLab.missedOpp.lineFairRecommendations": {
    en: "Executable recs (cap 8)",
    it: "Rec eseguibili (cap 8)",
  },
  "modelLab.missedOpp.fairRecsSub": {
    en: "max {n} positions · real capital · no Enter on losers",
    it: "max {n} posizioni · capitale reale · no Enter su perdenti",
  },
  "modelLab.missedOpp.lineActual": {
    en: "Actual portfolio gain",
    it: "Guadagno reale portafoglio",
  },
  "modelLab.missedOpp.chartTrendTitle": {
    en: "24h opportunity trend",
    it: "24h opportunity trend",
  },
  "modelLab.missedOpp.chartTrendSub": {
    en: "Daily snapshots stored locally when you open Performance — one point per calendar day.",
    it: "Daily snapshots stored locally when you open Performance — one point per calendar day.",
  },
  "modelLab.missedOpp.lineRising24h": {
    en: "Rising opportunities in the last 24h",
    it: "Rising opportunities in the last 24h",
  },
  "modelLab.missedOpp.lineRecommendedInvested24h": {
    en: "Recommended and invested opportunities in the last 24h",
    it: "Recommended and invested opportunities in the last 24h",
  },
  "modelLab.missedOpp.blockersTitle": {
    en: "Why missed — top blockers",
    it: "Perché perse — blocker principali",
  },
  "modelLab.missedOpp.blockersSub": {
    en: "Aggregated from skipped Enter rows — use to tune thresholds (target, match, slope).",
    it: "Aggregati dalle righe senza Enter — per tarare soglie (target, match, pendenza).",
  },
  "modelLab.missedOpp.errorTrendSectionTitle": {
    en: "Error trend over time (avg signed % vs the 0 line)",
    it: "Trend errore nel tempo (% media signed rispetto alla linea 0)",
  },
  "modelLab.missedOpp.errorTrendSectionSub": {
    en: "Average % size of the move that contradicted the recommendation. Above 0 (errore +) = mean drop on stocks the model said Enter. Below 0 (errore −) = mean rise on stocks the model said skip, sign-flipped. The dashed green line at 0 = no error — both curves should converge toward 0 as the loop-learning system improves.",
    it: "Dimensione media in % del movimento che ha contraddetto la raccomandazione. Sopra lo 0 (errore +) = calo medio sui titoli con Enter consigliato. Sotto lo 0 (errore −) = rialzo medio sui titoli scartati, ribaltato di segno. La linea tratteggiata verde a 0 = nessun errore — entrambe le curve dovrebbero convergere verso lo 0 quando il loop learning migliora.",
  },
  "modelLab.missedOpp.errorTrendCloseTitle": {
    en: "Deals ≤ 2 months from CD (T−14 → T−60)",
    it: "Deal ≤ 2 mesi dalla CD (T−14 → T−60)",
  },
  "modelLab.missedOpp.errorTrendFarTitle": {
    en: "Deals 2–4 months from CD (T−61 → T−120)",
    it: "Deal 2–4 mesi dalla CD (T−61 → T−120)",
  },
  "modelLab.missedOpp.tableTitle": {
    en: "Missed gainers detail",
    it: "Dettaglio rialzi persi",
  },
  "modelLab.missedOpp.showTableDetail": {
    en: "Show detailed table",
    it: "Mostra tabella dettagliata",
  },
  "modelLab.missedOpp.tableSub": {
    en: "Off-portfolio · T−90→T−14 · Var. Giorn. % ≥ threshold · no Enter today.",
    it: "Fuori portafoglio · T−90→T−14 · Var. Giorn. % ≥ soglia · nessun Enter oggi.",
  },
  "modelLab.missedOpp.watchTableTitle": {
    en: "Watch window misses (T−61→T−120)",
    it: "Perse in watch (T−61→T−120)",
  },
  "modelLab.missedOpp.watchTableSub": {
    en: "Off-portfolio gainers in watch zone without Enter — provisional target policy applies.",
    it: "Rialzi fuori portafoglio in watch senza Enter — vale la policy target provvisorio.",
  },
  "modelLab.missedOpp.colBlockers": {
    en: "Blockers",
    it: "Blocker",
  },
  "modelLab.missedOpp.emptySim": {
    en: "Load Simulation data to audit missed opportunities.",
    it: "Carica i dati Simulation per l'audit opportunità perse.",
  },
  "modelLab.missedOpp.loading": {
    en: "Loading charts for entry audit…",
    it: "Caricamento grafici per audit ingressi…",
  },
  "modelLab.missedOpp.no24h": {
    en: "No ticker with Var. Giorn. % in Simulation — run daily refresh.",
    it: "Nessun ticker con Var. Giorn. % in Simulation — esegui refresh giornaliero.",
  },
  "modelLab.missedOpp.noGainers": {
    en: "No 24h gainers in the cohort today.",
    it: "Nessun rialzo 24h nella coorte oggi.",
  },
  "modelLab.missedOpp.trendPending": {
    en: "Open Performance on multiple days to build recall trend.",
    it: "Apri Performance in giorni diversi per costruire il trend recall.",
  },
  "modelLab.missedOpp.calibrationTitle": {
    en: "Calibration plan (from missed gainers)",
    it: "Piano calibrazione (da rialzi persi)",
  },
  "modelLab.missedOpp.calibrationSub": {
    en: "Actionable tuning hints — P(plan) already applies 24h momentum boost when arc and price diverge.",
    it: "Suggerimenti di taratura — P(plan) applica già boost momentum 24h quando arco e prezzo divergono.",
  },
  "modelLab.missedOpp.detailLead": {
    en: "Missed gainer {pct} · P(plan) {prob} — polygon vs target",
    it: "Rialzo perso {pct} · P(plan) {prob} — poligono vs target",
  },
  "modelLab.missedOpp.detailBlockers": {
    en: "Why Enter was not suggested",
    it: "Perché non è stato suggerito Enter",
  },
  "modelLab.missedOpp.noPattern": {
    en: "Pattern data unavailable for this row.",
    it: "Dati pattern non disponibili per questa riga.",
  },
  "modelLab.missedOpp.axisGapTitle": {
    en: "Axis gaps vs target polygon",
    it: "Gap assi vs poligono target",
  },
  "modelLab.missedOpp.axisGapSub": {
    en: "Highlighted rows are >15 pp below target on that axis.",
    it: "Righe evidenziate >15 pp sotto target su quell'asse.",
  },
  "modelLab.missedOpp.axisCol": {
    en: "Axis",
    it: "Asse",
  },
  "modelLab.missedOpp.currentCol": {
    en: "Current",
    it: "Attuale",
  },
  "modelLab.missedOpp.targetCol": {
    en: "Target",
    it: "Target",
  },
  "modelLab.missedOpp.gapCol": {
    en: "Gap",
    it: "Gap",
  },
  "modelLab.missedOpp.tableClickHint": {
    en: "Click a row for polygon drill-down.",
    it: "Clicca una riga per il drill-down poligono.",
  },
  "modelLab.subtitle.sdsAccuracy": {
    en: "SDS predicted vs historical ROI per T-node · error curve · learning curve",
    it: "SDS predetto vs ROI storico per T-node · curva errore · curva di apprendimento",
  },
  "modelLab.sdsAccuracy.loading": {
    en: "Loading SDS prediction accuracy…",
    it: "Caricamento accuratezza predizione SDS…",
  },
  "modelLab.sdsAccuracy.loadError": {
    en: "Could not load SDS chart data.",
    it: "Impossibile caricare i dati grafici SDS.",
  },
  "modelLab.sdsAccuracy.empty": {
    en: "No SDS predictions in the simulation cohort yet.",
    it: "Nessuna predizione SDS nella coorte simulazione.",
  },
  "modelLab.sdsAccuracy.kpi.signals": {
    en: "SDS signals",
    it: "Segnali SDS",
  },
  "modelLab.sdsAccuracy.kpi.signalsSub": {
    en: "with prediction",
    it: "con predizione",
  },
  "modelLab.sdsAccuracy.kpi.coverage": {
    en: "Data coverage",
    it: "Copertura dati",
  },
  "modelLab.sdsAccuracy.kpi.coverageSub": {
    en: "T-nodes with actual data",
    it: "T-node con dato reale",
  },
  "modelLab.sdsAccuracy.kpi.mae": {
    en: "Mean MAE",
    it: "MAE medio",
  },
  "modelLab.sdsAccuracy.kpi.maeSub": {
    en: "prediction vs actual error",
    it: "errore predizione vs reale",
  },
  "modelLab.sdsAccuracy.kpi.bestNode": {
    en: "Best accuracy window",
    it: "Finestra più accurata",
  },
  "modelLab.sdsAccuracy.kpi.bestNodeSubMeasured": {
    en: "±{mae}pp · n={n} pairs (closest curves)",
    it: "±{mae}pp · n={n} coppie (curve più vicine)",
  },
  "modelLab.sdsAccuracy.kpi.bestNodeSubLowSample": {
    en: "±{mae}pp · n={n} pair(s) — indicative (low sample)",
    it: "±{mae}pp · n={n} coppia/e — indicativo (campione ridotto)",
  },
  "modelLab.sdsAccuracy.kpi.bestNodeSubNone": {
    en: "needs ≥{min} paired signals per node",
    it: "serve ≥{min} coppie pred/reale per nodo",
  },
  "modelLab.sdsAccuracy.kpi.rho": {
    en: "Correlation ρ",
    it: "Correlazione ρ",
  },
  "modelLab.sdsAccuracy.kpi.rhoSub": {
    en: "pred → actual (Spearman)",
    it: "pred → reale (Spearman)",
  },
  "modelLab.sdsAccuracy.kpi.rhoPSub": {
    en: "p={p} {stars} · n={n} pairs",
    it: "p={p} {stars} · n={n} coppie",
  },
  "modelLab.sdsAccuracy.kpi.minSds": {
    en: "Min significant SDS",
    it: "SDS min. significativo",
  },
  "modelLab.sdsAccuracy.kpi.minSdsSub": {
    en: "band {band} · {grow}% price ↑ at {window} · n={n} (≥{pct}% threshold)",
    it: "fascia {band} · {grow}% prezzo ↑ a {window} · n={n} (soglia ≥{pct}%)",
  },
  "modelLab.sdsAccuracy.kpi.minSdsSubNone": {
    en: "no band reaches ≥{pct}% stocks up at best window",
    it: "nessuna fascia raggiunge ≥{pct}% titoli su al best window",
  },
  "modelLab.sdsAccuracy.kpi.confidenceIndex": {
    en: "Confidence index",
    it: "Indice di confidenza",
  },
  "modelLab.sdsAccuracy.kpi.bestNodeSubScoreRho": {
    en: " · SDS→price ρ {rho}",
    it: " · SDS→prezzo ρ {rho}",
  },
  "modelLab.sdsAccuracy.kpi.bestNodeSubUnranked": {
    en: " · indicative (<3 pairs ranked)",
    it: " · indicativo (<3 coppie classificate)",
  },
  "modelLab.sdsAccuracy.stat.legend": {
    en: "Stars refer to the p-value of ρ (not ρ itself): * p<0.05 · ** p<0.01 · *** p<0.001 · ns = not significant. With enough pairs (e.g. n=42), even moderate ρ can be highly significant.",
    it: "Le stelle riguardano il p-value di ρ (non il valore di ρ): * p<0,05 · ** p<0,01 · *** p<0,001 · ns = non significativo. Con abbastanza coppie (es. n=42), anche un ρ moderato può essere molto significativo.",
  },
  "modelLab.sdsAccuracy.stat.pValue": {
    en: "p = {p} (two-tailed)",
    it: "p = {p} (bilaterale)",
  },
  "modelLab.sdsAccuracy.stat.pValueStars": {
    en: "p = {p} (two-tailed) → {stars}",
    it: "p = {p} (bilaterale) → {stars}",
  },
  "modelLab.sdsAccuracy.stat.starsMeaning": {
    en: "significance: {stars}",
    it: "significatività: {stars}",
  },
  "modelLab.sdsAccuracy.main.title": {
    en: "① Where does SDS ROI best match historical ROI?",
    it: "① Dove la ROI SDS coincide meglio con quella storica?",
  },
  "modelLab.sdsAccuracy.main.desc": {
    en: "Compares mean SDS predicted % ROI (violet dashed) with mean historical ROI from pct_reale (green). Closeness = vertical gap (MAE). «★ closest» marks the T-node where the curves are nearest (lowest MAE), even with n=1. Amber nodes have <3 pairs (indicative); green nodes have ≥3 pairs (statistically ranked).",
    it: "Confronta % ROI media predetta SDS (viola tratteggiata) con ROI storica da pct_reale (verde). Vicinanza = distanza verticale (MAE). «★ più vicino» segna il T-node dove le curve sono più vicine (MAE minimo), anche con n=1. Nodi ambra = <3 coppie (indicativo); verdi = ≥3 coppie (classifica statistica).",
  },
  "modelLab.sdsAccuracy.main.nodeStripHint": {
    en: "Per-node coverage: n = paired SDS + historical observations. ★ = closest curves (lowest MAE). Hollow green = 1–2 pairs (shown, indicative).",
    it: "Copertura per nodo: n = coppie SDS + storico. ★ = curve più vicine (MAE minimo). Verde vuoto = 1–2 coppie (mostrate, indicative).",
  },
  "modelLab.sdsAccuracy.main.insightBestAccurate": {
    en: "Closest curves at {node} (±{mae}pp MAE, n={n} pairs).",
    it: "Curve più vicine a {node} (±{mae}pp MAE, n={n} coppie).",
  },
  "modelLab.sdsAccuracy.main.insightBestAccurateLowN": {
    en: "Closest curves at {node} (±{mae}pp MAE, n={n} pair(s)) — indicative; need ≥{min} pairs for statistical ranking.",
    it: "Curve più vicine a {node} (±{mae}pp MAE, n={n} coppia/e) — indicativo; servono ≥{min} coppie per classifica statistica.",
  },
  "modelLab.sdsAccuracy.main.insightBestAccurateRankedAlt": {
    en: "Best with ≥{min} pairs: {node} (±{mae}pp MAE, n={n}).",
    it: "Migliore con ≥{min} coppie: {node} (±{mae}pp MAE, n={n}).",
  },
  "modelLab.sdsAccuracy.main.insightDensestDiffers": {
    en: "{node} has the most historical pairs (n={n}) — more data does not mean better accuracy.",
    it: "{node} ha più coppie storiche (n={n}) — più dati non significa maggiore accuratezza.",
  },
  "modelLab.sdsAccuracy.main.insightInsufficientOnly": {
    en: "Historical ROI exists but sample too small to rank (need ≥{min} pairs): {nodes}.",
    it: "ROI storica presente ma campione insufficiente per classificare (serve ≥{min} coppie): {nodes}.",
  },
  "modelLab.sdsAccuracy.main.insightNoDataNodes": {
    en: "No historical data yet: {nodes} (SDS prediction only).",
    it: "Nessun dato storico ancora: {nodes} (solo predizione SDS).",
  },
  "modelLab.sdsAccuracy.main.insightLowCoverage": {
    en: "Partial data — historical ROI fills in as catalyst dates pass.",
    it: "Dati parziali — la ROI storica si completa man mano che passano le CD.",
  },
  "modelLab.sdsAccuracy.main.insightExcellent": {
    en: "Excellent: mean error < 5pp. SDS model is well calibrated.",
    it: "Eccellente: errore medio < 5pp. Il modello SDS è ben calibrato.",
  },
  "modelLab.sdsAccuracy.main.insightGood": {
    en: "Good: mean error {mae}pp. Room to improve on T+4/T+10 post-CD nodes.",
    it: "Buono: errore medio {mae}pp. Margine di miglioramento su T+4/T+10 post-CD.",
  },
  "modelLab.sdsAccuracy.main.insightHigh": {
    en: "High gap ({mae}pp). Auto-calibration loop is active.",
    it: "Scarto elevato ({mae}pp). Il loop di auto-calibrazione è attivo.",
  },
  "modelLab.sdsAccuracy.main.legendLead": {
    en: "Violet dashed = mean % ROI predicted by SDS · Green solid = mean % ROI observed in the market (pct_reale, historical). Vertical gap = prediction error.",
    it: "Viola tratteggiata = ROI % media predetta dall’SDS · Verde solida = ROI % media osservata a mercato (pct_reale, storico). Distanza verticale = errore di predizione.",
  },
  "modelLab.sdsAccuracy.legend.predicted": {
    en: "ROI % — SDS prediction (dashed)",
    it: "ROI % — prediction SDS (tratteggio)",
  },
  "modelLab.sdsAccuracy.legend.actual": {
    en: "ROI % — historical market (solid, ≥3 pairs)",
    it: "ROI % — storico mercato (solido, ≥3 coppie)",
  },
  "modelLab.sdsAccuracy.legend.actualPartial": {
    en: "Historical ROI (1–2 pairs, not ranked)",
    it: "ROI storica (1–2 coppie, non classificata)",
  },
  "modelLab.sdsAccuracy.legend.range": {
    en: "Historical range [min–max]",
    it: "Range storico [min–max]",
  },
  "modelLab.sdsAccuracy.legend.cdZone": {
    en: "Post-CD zone",
    it: "Zona post-CD",
  },
  "modelLab.sdsAccuracy.legend.today": {
    en: "Today (T-node)",
    it: "Oggi (T-node)",
  },
  "modelLab.sdsAccuracy.nodeStrip.noData": {
    en: "n/d",
    it: "n/d",
  },
  "modelLab.sdsAccuracy.nodeStrip.pairs": {
    en: "n={n}",
    it: "n={n}",
  },
  "modelLab.sdsAccuracy.nodeStrip.mae": {
    en: "±{mae}pp",
    it: "±{mae}pp",
  },
  "modelLab.sdsAccuracy.nodeStrip.bestAccurate": {
    en: "★ closest",
    it: "★ più vicino",
  },
  "modelLab.sdsAccuracy.nodeStrip.mostData": {
    en: "most data",
    it: "più dati",
  },
  "modelLab.sdsAccuracy.nodeStrip.tipNoData": {
    en: "No paired historical ROI — SDS prediction only",
    it: "Nessuna ROI storica accoppiata — solo predizione SDS",
  },
  "modelLab.sdsAccuracy.nodeStrip.tipInsufficient": {
    en: "{n} pair(s) — indicative; ≥{min} for statistical ranking",
    it: "{n} coppia/e — indicativo; ≥{min} per classifica statistica",
  },
  "modelLab.sdsAccuracy.nodeStrip.tipMeasured": {
    en: "±{mae}pp MAE · n={n} pairs",
    it: "±{mae}pp MAE · n={n} coppie",
  },
  "modelLab.sdsAccuracy.tooltip.noPrediction": {
    en: "SDS: no prediction",
    it: "SDS: nessuna predizione",
  },
  "modelLab.sdsAccuracy.tooltip.predicted": {
    en: "SDS: {value}% (n={n} signals)",
    it: "SDS: {value}% (n={n} segnali)",
  },
  "modelLab.sdsAccuracy.tooltip.noHistorical": {
    en: "Historical: no data yet",
    it: "Storico: dati assenti",
  },
  "modelLab.sdsAccuracy.tooltip.actual": {
    en: "Historical: {value}% (n={n}, MAE ±{mae}pp)",
    it: "Storico: {value}% (n={n}, MAE ±{mae}pp)",
  },
  "modelLab.sdsAccuracy.chart.predicted": {
    en: "SDS prediction (mean)",
    it: "Predizione SDS (media)",
  },
  "modelLab.sdsAccuracy.chart.actual": {
    en: "Actual (mean)",
    it: "Reale (media)",
  },
  "modelLab.sdsAccuracy.chart.rangeMax": {
    en: "Actual max",
    it: "Reale max",
  },
  "modelLab.sdsAccuracy.chart.rangeMin": {
    en: "Actual min",
    it: "Reale min",
  },
  "modelLab.sdsAccuracy.chart.today": {
    en: "Today",
    it: "Oggi",
  },
  "modelLab.sdsAccuracy.chart.bestClosest": {
    en: "★ closest",
    it: "★ più vicino",
  },
  "modelLab.sdsAccuracy.legend.bestClosest": {
    en: "★ closest curves (lowest MAE)",
    it: "★ curve più vicine (MAE minimo)",
  },
  "modelLab.sdsAccuracy.chart.mae": {
    en: "MAE (pp)",
    it: "MAE (pp)",
  },
  "modelLab.sdsAccuracy.chart.rho": {
    en: "Spearman ρ",
    it: "Spearman ρ",
  },
  "modelLab.sdsAccuracy.chart.maeAxis": {
    en: "MAE (pp)",
    it: "MAE (pp)",
  },
  "modelLab.sdsAccuracy.chart.rhoAxis": {
    en: "Spearman ρ",
    it: "Spearman ρ",
  },
  "modelLab.sdsAccuracy.chart.maeTarget": {
    en: "MAE target",
    it: "MAE target",
  },
  "modelLab.sdsAccuracy.chart.rhoReliable": {
    en: "ρ reliable",
    it: "ρ affidabile",
  },
  "modelLab.sdsAccuracy.chart.rhoZero": {
    en: "ρ=0",
    it: "ρ=0",
  },
  "modelLab.sdsAccuracy.chart.rhoSig": {
    en: "ρ≥{r} sig.",
    it: "ρ≥{r} sig.",
  },
  "modelLab.sdsAccuracy.chart.rhoTarget": {
    en: "ρ target {r}",
    it: "ρ target {r}",
  },
  "modelLab.sdsAccuracy.gapCurve.title": {
    en: "② SDS error over time — historical ROI minus SDS ROI",
    it: "② Errore SDS nel tempo — ROI storico meno ROI SDS",
  },
  "modelLab.sdsAccuracy.gapCurve.desc": {
    en: "Y = mean (historical ROI − SDS predicted ROI) in pp at each T-node. Historical ROI = real market move (pct_reale). SDS ROI = model forecast from the SDS curve. X = calendar timeline (T−60 … CD … T+10).",
    it: "Asse Y = media (ROI storico − ROI predetto SDS) in punti percentuali per ogni T-node. ROI storico = movimento reale di mercato (pct_reale). ROI SDS = previsione del modello sulla curva SDS. Asse X = timeline (T−60 … CD … T+10).",
  },
  "modelLab.sdsAccuracy.gapCurve.legend": {
    en: "Historical − SDS (pp)",
    it: "Storico − SDS (pp)",
  },
  "modelLab.sdsAccuracy.gapCurve.legendZero": {
    en: "0 pp = perfect match",
    it: "0 pp = perfetta corrispondenza",
  },
  "modelLab.sdsAccuracy.gapCurve.yAxis": {
    en: "Historical − SDS (pp)",
    it: "Storico − SDS (pp)",
  },
  "modelLab.sdsAccuracy.gapCurve.series": {
    en: "ROI gap (historical − SDS)",
    it: "Scostamento ROI (storico − SDS)",
  },
  "modelLab.sdsAccuracy.gapCurve.zeroLine": {
    en: "0 pp",
    it: "0 pp",
  },
  "modelLab.sdsAccuracy.gapCurve.insightEmpty": {
    en: "Not enough paired historical + SDS points yet — refresh data as catalyst dates pass.",
    it: "Ancora pochi punti accoppiati storico + SDS — aggiorna i dati man mano che passano le CD.",
  },
  "modelLab.sdsAccuracy.gapCurve.insightUnder": {
    en: "At {node} SDS underestimates the move by ~{gap} pp on average (historical ROI higher than SDS).",
    it: "A {node} l'SDS sottostima il movimento di ~{gap} pp in media (ROI storico > ROI SDS).",
  },
  "modelLab.sdsAccuracy.gapCurve.insightOver": {
    en: "At {node} SDS overestimates the move by ~{gap} pp on average (SDS ROI higher than historical).",
    it: "A {node} l'SDS sovrastima il movimento di ~{gap} pp in media (ROI SDS > ROI storico).",
  },
  "modelLab.sdsAccuracy.gapCurve.insightAligned": {
    en: "At {node} historical and SDS ROI are aligned on average.",
    it: "A {node} ROI storico e SDS sono allineati in media.",
  },
  "modelLab.sdsAccuracy.gapCurve.insightClosestLink": {
    en: "★ closest in chart ① ({node}, ±{mae}pp MAE) reads {signed} here — smallest vertical gap between curves.",
    it: "★ più vicino nel grafico ① ({node}, ±{mae}pp MAE) corrisponde a {signed} qui — distanza verticale minima tra le curve.",
  },
  "modelLab.sdsAccuracy.gapCurve.legendClosest": {
    en: "★ closest (chart ①)",
    it: "★ più vicino (grafico ①)",
  },
  "modelLab.sdsAccuracy.gapCurve.legendRanked": {
    en: "Best ≥{min} pairs (chart ①)",
    it: "Migliore ≥{min} coppie (grafico ①)",
  },
  "modelLab.sdsAccuracy.gapCurve.tooltip.signed": {
    en: "Historical − SDS: {value}",
    it: "Storico − SDS: {value}",
  },
  "modelLab.sdsAccuracy.gapCurve.tooltip.maeLink": {
    en: "|gap| = ±{mae}pp MAE (same as chart ①)",
    it: "|scostamento| = ±{mae}pp MAE (come nel grafico ①)",
  },
  "modelLab.sdsAccuracy.gapCurve.tooltip.closest": {
    en: "★ closest curves in chart ①",
    it: "★ curve più vicine nel grafico ①",
  },
  "modelLab.sdsAccuracy.gapCurve.tooltip.ranked": {
    en: "Best with ≥{min} pairs in chart ①",
    it: "Migliore con ≥{min} coppie nel grafico ①",
  },
  "modelLab.sdsAccuracy.crossLink.title": {
    en: "Bridge ① → ② — same T-nodes, two views",
    it: "Collegamento ① → ② — stessi T-node, due letture",
  },
  "modelLab.sdsAccuracy.crossLink.colRole": {
    en: "Role in ①",
    it: "Ruolo in ①",
  },
  "modelLab.sdsAccuracy.crossLink.colChart1": {
    en: "MAE ①",
    it: "MAE ①",
  },
  "modelLab.sdsAccuracy.crossLink.colNode": {
    en: "T-node",
    it: "T-node",
  },
  "modelLab.sdsAccuracy.crossLink.colChart2": {
    en: "Gap ②",
    it: "Scost. ②",
  },
  "modelLab.sdsAccuracy.crossLink.colMeaning": {
    en: "Direction in ②",
    it: "Direzione in ②",
  },
  "modelLab.sdsAccuracy.crossLink.roleClosest": {
    en: "★ closest",
    it: "★ più vicino",
  },
  "modelLab.sdsAccuracy.crossLink.roleRanked": {
    en: "Best ≥{min} pairs",
    it: "Migliore ≥{min} coppie",
  },
  "modelLab.sdsAccuracy.crossLink.direction.over": {
    en: "SDS overestimates (SDS ROI > historical)",
    it: "SDS sovrastima (ROI SDS > storico)",
  },
  "modelLab.sdsAccuracy.crossLink.direction.under": {
    en: "SDS underestimates (historical > SDS ROI)",
    it: "SDS sottostima (storico > ROI SDS)",
  },
  "modelLab.sdsAccuracy.crossLink.direction.aligned": {
    en: "Aligned on average",
    it: "Allineato in media",
  },
  "modelLab.sdsAccuracy.crossLink.noGapData": {
    en: "No paired data in ②",
    it: "Nessun dato accoppiato in ②",
  },
  "modelLab.sdsAccuracy.crossLink.footnote": {
    en: "Chart ① MAE = mean |pred − actual| (distance between curves). Chart ② gap = mean (historical − SDS): sign shows over/under-estimation; |gap| equals MAE when all errors share the same direction.",
    it: "Grafico ① MAE = media |pred − reale| (distanza tra curve). Grafico ② scostamento = media (storico − SDS): il segno indica sovra/sotto-stima; |scostamento| = MAE quando tutti gli errori vanno nella stessa direzione.",
  },
  "modelLab.sdsAccuracy.learning.title": {
    en: "③ Is the model learning? — MAE and ρ over time",
    it: "③ Il modello impara? — MAE e ρ nel tempo",
  },
  "modelLab.sdsAccuracy.learning.desc": {
    en: "Weekly snapshot when you open this panel. Red (left): global MAE ±pp across all T-nodes — target 5pp (pink line). Purple (right): Spearman ρ (rho, not p-value) — rank correlation between SDS predicted ROI and actual ROI. Scale: weak |ρ|<0.3 · moderate 0.3–0.5 · good ≥0.5 · strong ≥0.7. Violet dashed = ρ target 0.5 · green = statistical significance (p<0.05) · grey = no correlation.",
    it: "Snapshot settimanale all’apertura del pannello. Rosso (sinistra): MAE globale ±pp su tutti i T-node — target 5pp (linea rosa). Viola (destra): Spearman ρ (rho, non p-value) — correlazione dei ranghi tra ROI predetta SDS e ROI reale. Scala: debole |ρ|<0,3 · moderata 0,3–0,5 · buona ≥0,5 · forte ≥0,7. Viola tratteggiato = target ρ 0,5 · verde = significatività statistica (p<0,05) · grigio = nessuna correlazione.",
  },
  "modelLab.sdsAccuracy.learning.refLegend": {
    en: "Refs: MAE target 5pp · ρ target {target} · ρ=0 · ρ≥{r} sig. (p<0.05, n={n})",
    it: "Riferimenti: MAE target 5pp · ρ target {target} · ρ=0 · ρ≥{r} sig. (p<0,05, n={n})",
  },
  "modelLab.sdsAccuracy.learning.insightRhoModerate": {
    en: "· ρ {rho} = moderate rank alignment (statistically meaningful but below target {target} — model orders tickers reasonably, numeric MAE still high).",
    it: "· ρ {rho} = correlazione moderata (significativa ma sotto target {target} — il modello ordina i titoli in modo ragionevole, MAE numerico ancora alto).",
  },
  "modelLab.sdsAccuracy.learning.insightRhoGood": {
    en: "· ρ {rho} = good rank alignment (at or above target 0.5).",
    it: "· ρ {rho} = buona correlazione (al target 0,5 o sopra).",
  },
  "modelLab.sdsAccuracy.learning.insightRhoWeak": {
    en: "· ρ {rho} = weak rank alignment (below 0.3 — target {target}).",
    it: "· ρ {rho} = correlazione debole (sotto 0,3 — target {target}).",
  },
  "modelLab.sdsAccuracy.learning.insightNeedWeeks": {
    en: "Need ≥3 weeks to estimate trend.",
    it: "Servono ≥3 settimane per stimare il trend.",
  },
  "modelLab.sdsAccuracy.learning.insightImproving": {
    en: "✓ Model improving: MAE falling, ρ rising.",
    it: "✓ Il modello sta migliorando: MAE in calo, ρ in salita.",
  },
  "modelLab.sdsAccuracy.learning.insightStable": {
    en: "Model stable. Calibration loop active but no major gains yet.",
    it: "Modello stabile. Loop di calibrazione attivo senza miglioramenti significativi ancora.",
  },
  "modelLab.sdsAccuracy.learning.insightWorsening": {
    en: "Warning: MAE rising. Check input data quality or market regime.",
    it: "Attenzione: MAE in aumento. Verificare qualità dati o regime di mercato.",
  },
  "modelLab.sdsAccuracy.confidence.title": {
    en: "④ SDS learning confidence",
    it: "④ SDS Learning confidence",
  },
  "modelLab.sdsAccuracy.confidence.intro": {
    en: "Each bar fills to 100% when the target is met. Values are global (all T-nodes, all paired signals).",
    it: "Ogni barra arriva al 100% quando il target è raggiunto. Valori globali (tutti i T-node, tutti i segnali accoppiati).",
  },
  "modelLab.sdsAccuracy.confidence.coverage": {
    en: "Real T-node coverage",
    it: "Copertura T-node reali",
  },
  "modelLab.sdsAccuracy.confidence.coverageTarget": {
    en: "Target: ≥{pct}% of signal×T-node slots with both predicted and actual ROI",
    it: "Target: ≥{pct}% degli slot segnale×T-node con ROI predetta e reale",
  },
  "modelLab.sdsAccuracy.confidence.coverageDisplay": {
    en: "{current}% → ≥{target}%",
    it: "{current}% → ≥{target}%",
  },
  "modelLab.sdsAccuracy.confidence.mae": {
    en: "Global MAE",
    it: "MAE globale",
  },
  "modelLab.sdsAccuracy.confidence.maeTarget": {
    en: "Target: mean |pred − actual| < {pp} pp across all paired points",
    it: "Target: media |pred − reale| < {pp} pp su tutti i punti accoppiati",
  },
  "modelLab.sdsAccuracy.confidence.maeDisplay": {
    en: "{current} → <{target} pp",
    it: "{current} → <{target} pp",
  },
  "modelLab.sdsAccuracy.confidence.rho": {
    en: "Spearman ρ (rank alignment)",
    it: "Spearman ρ (allineamento ranghi)",
  },
  "modelLab.sdsAccuracy.confidence.rhoTarget": {
    en: "Target: ρ ≥ {rho} (good practical correlation — distinct from statistical p-value)",
    it: "Target: ρ ≥ {rho} (buona correlazione pratica — distinta dal p-value statistico)",
  },
  "modelLab.sdsAccuracy.confidence.rhoDisplay": {
    en: "{current} → ≥{target}",
    it: "{current} → ≥{target}",
  },
  "modelLab.sdsAccuracy.confidence.rhoSub": {
    en: "threshold |ρ|≥{crit} at n={n}",
    it: "soglia |ρ|≥{crit} con n={n}",
  },
  "modelLab.sdsAccuracy.confidence.temporal": {
    en: "Temporal consistency",
    it: "Consistenza temporale",
  },
  "modelLab.sdsAccuracy.confidence.temporalTarget": {
    en: "Target: ≥{weeks} weekly snapshots (chart ③) to estimate MAE/ρ trend",
    it: "Target: ≥{weeks} snapshot settimanali (grafico ③) per stimare trend MAE/ρ",
  },
  "modelLab.sdsAccuracy.confidence.temporalDisplay": {
    en: "{current}/{target} weeks",
    it: "{current}/{target} settimane",
  },
  "modelLab.sdsAccuracy.confidence.loop": {
    en: "Active calibration loop",
    it: "Loop calibrazione attivo",
  },
  "modelLab.sdsAccuracy.confidence.loopTarget": {
    en: "Target: ≥{n} saved weekly calibrations (one per ISO week when panel opens)",
    it: "Target: ≥{n} calibrazioni settimanali salvate (una per settimana ISO all’apertura del pannello)",
  },
  "modelLab.sdsAccuracy.confidence.loopDisplay": {
    en: "{current} → ≥{target}",
    it: "{current} → ≥{target}",
  },
  "modelLab.sdsAccuracy.confidence.score": {
    en: "Overall confidence: {pct}% · {summary}",
    it: "Confidence globale: {pct}% · {summary}",
  },
  "modelLab.sdsAccuracy.confidence.summaryHigh": {
    en: "SDS reliable · contained error · improving",
    it: "SDS affidabile · errore contenuto · in miglioramento",
  },
  "modelLab.sdsAccuracy.confidence.summaryMid": {
    en: "SDS calibrating · partial data · loop active",
    it: "SDS in calibrazione · dati parziali · loop attivo",
  },
  "modelLab.sdsAccuracy.confidence.summaryLow": {
    en: "SDS early stage · insufficient data · wait for more CDs",
    it: "SDS fase iniziale · dati insufficienti · attendi più CD",
  },
  "modelLab.raCalibration.kpi.totalSignals": {
    en: "Total signals",
    it: "Signals totali",
  },
  "modelLab.raCalibration.kpi.totalSignalsSub": {
    en: "with RA score",
    it: "con RA score",
  },
  "modelLab.raCalibration.kpi.bestBand": {
    en: "Best RA window (CD timeline)",
    it: "Miglior finestra RA (timeline CD)",
  },
  "modelLab.raCalibration.kpi.bestBandSub": {
    en: "7d {pct} · 24h {pct24h} price-up (calendar fallback)",
    it: "7g {pct} · 24h {pct24h} price-up (fallback calendario)",
  },
  "modelLab.raCalibration.kpi.bestBandTemporalSub": {
    en: "{range} · long →{longTarget} {longPct} · short →{shortTarget} {shortPct} · n={n}",
    it: "{range} · lungo →{longTarget} {longPct} · breve →{shortTarget} {shortPct} · n={n}",
  },
  "modelLab.raCalibration.kpi.monotonicity": {
    en: "Monotonicity ρ",
    it: "Monotonicity ρ",
  },
  "modelLab.raCalibration.kpi.monotonicitySub": {
    en: "RA ↑ → higher ρ → more price-ups",
    it: "RA → più ρ → più rialzi",
  },
  "modelLab.raCalibration.kpi.investThreshold": {
    en: "Invest threshold",
    it: "Soglia invest",
  },
  "modelLab.raCalibration.kpi.investThresholdSub": {
    en: "top quartile with ≥55% price-up (7d)",
    it: "quartile alto con ≥55% price-up (7d)",
  },
  "modelLab.raCalibration.nd": {
    en: "n/d",
    it: "n/d",
  },
  "modelLab.raCalibration.bubble.title": {
    en: "① RA reliability map — each company vs pre/post CD",
    it: "① Mappa affidabilità RA — ogni società vs pre/post CD",
  },
  "modelLab.raCalibration.bubble.desc": {
    en: "Each dot = one simulation row at one CD anchor. X = classic pre/post CD timeline; Y = % price change (long → T+7). Dot color = RA score (signal accuracy). Reliability = distance from the 55% green target at that timepoint.",
    it: "Ogni punto = una riga Simulation su un ancoraggio CD. X = timeline pre/post CD; Y = variazione % prezzo (lungo → T+7). Colore = RA score (accuratezza segnale). Affidabilità = distanza dal target verde 55% su quel timepoint.",
  },
  "modelLab.raCalibration.scatter.title": {
    en: "① RA reliability map — each company vs pre/post CD",
    it: "① Mappa affidabilità RA — ogni società vs pre/post CD",
  },
  "modelLab.raCalibration.scatter.desc": {
    en: "Each dot = one simulation company at one CD anchor. X = pre/post CD axis (T−60 … T+7). Y = % price move from anchor (● long to T+7 · ◆ short to next knot). Color = RA score as-of that anchor (v2). Violet line = cohort % price-up · dashed amber = % ≥55%. Green dashed = 55% invest line. Click Q1–Q4 to filter by RA quartile.",
    it: "Ogni punto = una società su un ancoraggio CD. X = asse pre/post CD. Y = Δ% prezzo (● lungo → T+7 · ◆ breve). Colore = RA as-of quell'ancoraggio (v2). Viola = % price-up coorte · ambra = % ≥55%. Verde = 55%. Q1–Q4 = filtro quartile RA.",
  },
  "modelLab.raCalibration.scatter.trendPriceUp": {
    en: "Cohort % price-up (trend)",
    it: "% price-up coorte (trend)",
  },
  "modelLab.raCalibration.scatter.trendAbove55": {
    en: "Cohort % ≥55% target",
    it: "% coorte ≥55% target",
  },
  "modelLab.raCalibration.scatter.rhoRowTitle": {
    en: "ρ(RA, Δ%) per anchor:",
    it: "ρ(RA, Δ%) per ancoraggio:",
  },
  "modelLab.raCalibration.scatter.rhoChipHint": {
    en: "n={n} · cohort price-up {pct}",
    it: "n={n} · price-up coorte {pct}",
  },
  "modelLab.raCalibration.scatter.rhoChipNa": {
    en: "ρ n/d",
    it: "ρ n/d",
  },
  "modelLab.raCalibration.scatter.quartileRowTitle": {
    en: "RA quartile (cohort rank):",
    it: "Quartile RA (rank coorte):",
  },
  "modelLab.raCalibration.scatter.filterAll": {
    en: "All",
    it: "Tutti",
  },
  "modelLab.raCalibration.scatter.quartileChipHint": {
    en: "{caption} · {range} · n={n}",
    it: "{caption} · {range} · n={n}",
  },
  "modelLab.raCalibration.scatter.filterActiveHint": {
    en: "Highlighting {quartile} — other points faded.",
    it: "In evidenza {quartile} — altri punti attenuati.",
  },
  "modelLab.raCalibration.scatter.filterAllAnchors": {
    en: "all anchors",
    it: "tutti gli ancoraggi",
  },
  "modelLab.raCalibration.scatter.filterAllQuartiles": {
    en: "all quartiles",
    it: "tutti i quartili",
  },
  "modelLab.raCalibration.scatter.filterClear": {
    en: "Clear",
    it: "Azzera",
  },
  "modelLab.raCalibration.scatter.tooltipTrendPriceUp": {
    en: "Cohort price-up: {pct} (n={n})",
    it: "Price-up coorte: {pct} (n={n})",
  },
  "modelLab.raCalibration.scatter.tooltipTrendAbove55": {
    en: "≥55% target: {pct}",
    it: "≥55% target: {pct}",
  },
  "modelLab.raCalibration.scatter.tooltipTrendAbove55Only": {
    en: "Cohort ≥55%: {pct}",
    it: "Coorte ≥55%: {pct}",
  },
  "modelLab.raCalibration.scatter.tooltipTrendReliability": {
    en: "Mean reliability: {rel}",
    it: "Affidabilità media: {rel}",
  },
  "modelLab.raCalibration.scatter.tooltipTrendRho": {
    en: "ρ(RA, Δ%): {rho}",
    it: "ρ(RA, Δ%): {rho}",
  },
  "modelLab.raCalibration.scatter.insightBestAnchor": {
    en: " Best anchor {anchor} ({pct} price-up, {rho}).",
    it: " Miglior ancoraggio {anchor} ({pct} price-up, {rho}).",
  },
  "modelLab.raCalibration.scatter.xAxis": {
    en: "Days vs Completion Date (pre/post CD)",
    it: "Giorni vs Completion Date (pre/post CD)",
  },
  "modelLab.raCalibration.scatter.yAxis": {
    en: "% price change from anchor",
    it: "Variazione % prezzo dall'ancoraggio",
  },
  "modelLab.raCalibration.scatter.legendRaLow": {
    en: "RA < 40 (weak signal)",
    it: "RA < 40 (segnale debole)",
  },
  "modelLab.raCalibration.scatter.legendRaMid": {
    en: "RA 40–54",
    it: "RA 40–54",
  },
  "modelLab.raCalibration.scatter.legendRaHigh": {
    en: "RA ≥ 55 (strong signal)",
    it: "RA ≥ 55 (segnale forte)",
  },
  "modelLab.raCalibration.scatter.legendLong": {
    en: "● long → T+7",
    it: "● lungo → T+7",
  },
  "modelLab.raCalibration.scatter.legendShort": {
    en: "◆ short → next knot",
    it: "◆ breve → nodo succ.",
  },
  "modelLab.raCalibration.scatter.empty": {
    en: "No price history at CD anchors — need simulation_charts_snapshot.json with price_storico_usd + Completion Date on Simulation rows.",
    it: "Nessuno storico prezzi agli ancoraggi CD — servono simulation_charts_snapshot.json con price_storico_usd + Completion Date sulle righe Simulation.",
  },
  "modelLab.raCalibration.scatter.preCdBanner": {
    en: "Pre-CD cohort: T+7 not reached yet — ● long uses anchor → today; ◆ short = anchor → next knot.",
    it: "Coorte pre-CD: T+7 non ancora raggiunto — ● lungo = ancoraggio → oggi; ◆ breve = ancoraggio → nodo succ.",
  },
  "modelLab.raCalibration.scatter.insightPreCdShort": {
    en: " [Short horizon only until T+7.]",
    it: " [Solo orizzonte breve fino a T+7.]",
  },
  "modelLab.raCalibration.scatter.insightPreCdPartial": {
    en: " [Partial long: anchor → today where T+7 pending.]",
    it: " [Lungo parziale: ancoraggio → oggi dove T+7 manca.]",
  },
  "modelLab.raCalibration.scatter.tooltipPriceChg": {
    en: "Price change: {chg}",
    it: "Variazione prezzo: {chg}",
  },
  "modelLab.raCalibration.scatter.tooltipRa": {
    en: "RA score: {ra}",
    it: "RA score: {ra}",
  },
  "modelLab.raCalibration.scatter.tooltipReliability": {
    en: "Reliability (dist. from 55%): {rel}",
    it: "Affidabilità (dist. da 55%): {rel}",
  },
  "modelLab.raCalibration.scatter.tooltipUp": {
    en: "Outcome: price-up",
    it: "Esito: prezzo su",
  },
  "modelLab.raCalibration.scatter.tooltipDown": {
    en: "Outcome: flat/down",
    it: "Esito: flat/giù",
  },
  "modelLab.raCalibration.scatter.insight": {
    en: "{n} companies · {points} long-anchor points · {above} at/above 55% · RA≥55 price-up: {highRaUp}/{highRaN} · ρ={rho} · invest floor {threshold}.{bestAnchor}",
    it: "{n} società · {points} punti ancoraggio lungo · {above} ≥55% · RA≥55 price-up: {highRaUp}/{highRaN} · ρ={rho} · soglia invest {threshold}.{bestAnchor}",
  },
  "modelLab.raCalibration.scatter.insightEmpty": {
    en: "No CD-anchored price moves yet · monotonicity ρ={rho}",
    it: "Nessun movimento prezzo agli ancoraggi CD · monotonicità ρ={rho}",
  },
  "modelLab.raCalibration.bubble.xAxis": {
    en: "RA score quartile window",
    it: "Finestra quartile RA score",
  },
  "modelLab.raCalibration.bubble.quartileLegend": {
    en: "{label} {caption} ({range})",
    it: "{label} {caption} ({range})",
  },
  "modelLab.raCalibration.bubble.legend7d": {
    en: "7d dot",
    it: "dot 7g",
  },
  "modelLab.raCalibration.bubble.legend24h": {
    en: "24h dot",
    it: "dot 24h",
  },
  "modelLab.raCalibration.bubble.tooltipBand": {
    en: "RA window {band}",
    it: "Finestra RA {band}",
  },
  "modelLab.raCalibration.bubble.tooltipDetail": {
    en: "{pct}% price-up ({window}) · {n} signals in window",
    it: "{pct}% price-up ({window}) · {n} segnali nella finestra",
  },
  "modelLab.raCalibration.bubble.insight7dBest": {
    en: "Best window: {band} — 7d {pct} · 24h {pct24h} price-up. ρ={rho}. Invest RA floor: {threshold}.",
    it: "Miglior finestra: {band} — 7g {pct} · 24h {pct24h} price-up. ρ={rho}. Soglia RA invest: {threshold}.",
  },
  "modelLab.raCalibration.bubble.insight7dNoBand": {
    en: "Insufficient data for an optimal RA window. ρ={rho}.",
    it: "Dati insufficienti per una finestra RA ottimale. ρ={rho}.",
  },
  "modelLab.raCalibration.bubble.insight24h": {
    en: "The 24h window is noisy — use it as a short-term check alongside 7d, not alone for invest rules.",
    it: "La finestra 24h è rumorosa — usala come controllo breve insieme ai 7g, non da sola per regole invest.",
  },
  "modelLab.raCalibration.temporalCorr.title": {
    en: "RA vs price correlation on CD timeline",
    it: "Correlazione RA vs prezzo sulla timeline CD",
  },
  "modelLab.raCalibration.temporalCorr.desc": {
    en: "Retrospective diagnostic only — not how to read Pick stocks. Pearson ρ between historical RA and % move (anchor → T+7). Live Entry RA uses polarized formula (Σ ρ+ − Σ ρ−); Raw RA line shows the legacy sum that can correlate inversely.",
    it: "Solo diagnostica retrospettiva — non è come leggere Pick stocks. ρ di Pearson tra RA storico e Δ% (ancoraggio → T+7). Il RA ingresso live usa formula polarizzata (Σ ρ+ − Σ ρ−); la linea RA grezzo mostra la somma legacy che può correlare inversamente.",
  },
  "modelLab.raCalibration.liveVsAuditBanner": {
    en: "Live: Entry RA ↑ = stronger BUY (polarized Σρ+ − Σρ−). Model Quality charts audit history — do not invert the rule (low RA ≠ buy signal). RA→ column in Simulation applies calibrated buy/hold/avoid thresholds.",
    it: "Live: RA ingresso ↑ = BUY più forte (polarizzato Σρ+ − Σρ−). I grafici Model Quality auditano la storia — non invertire la regola (RA basso ≠ segnale buy). Colonna RA→ in Simulation applica soglie calibrate buy/hold/evita.",
  },
  "modelLab.raCalibration.temporalCorr.harmonizationBanner": {
    en: "Harmonization: Pick stocks «Entry RA» = higher is better for BUY. This chart audits history — if Raw RA ρ is negative, polarized Entry RA (dashed green) is what Simulation applies live.",
    it: "Armonizzazione: «RA ingresso» in Pick stocks = più alto è meglio per BUY. Questo grafico audita la storia — se ρ del RA grezzo è negativo, il RA ingresso polarizzato (verde tratteggiato) è ciò che Simulation applica live.",
  },
  "modelLab.raCalibration.temporalCorr.pooledBarsTitle": {
    en: "Pooled ρ — {pairs} (RA, Δ%→T+7) pairs",
    it: "ρ pooled — {pairs} coppie (RA, Δ%→T+7)",
  },
  "modelLab.raCalibration.temporalCorr.pooledBarsCohort": {
    en: "{simRows} Simulation rows · {eligible} eligible · {chart} with price curve · {tickers} tickers in chart",
    it: "{simRows} righe Simulation · {eligible} eleggibili · {chart} con curva prezzo · {tickers} ticker nel grafico",
  },
  "modelLab.raCalibration.temporalCorr.toggleAlignedRho": {
    en: "Bars: price-aligned ρ (sign-corrected indices)",
    it: "Barre: ρ allineato al prezzo (indici corretti)",
  },
  "modelLab.raCalibration.temporalCorr.pooledBarsAlignedTitle": {
    en: "Pooled ρ aligned with price (↑) — {pairs} pairs",
    it: "ρ pooled allineato al rialzo (↑) — {pairs} coppie",
  },
  "modelLab.raCalibration.temporalCorr.pooledBarsNote": {
    en: "n = paired observations (not row count). Tickers with price_storico_usd contribute at every passed CD knot (not just today). Timeline may pool adjacent knots when a knot has <3 pairs.",
    it: "n = coppie (RA, Δ% prezzo), non righe totali. I ticker con price_storico_usd contribuiscono a ogni nodo CD già superato (non solo oggi). La timeline può unire nodi vicini se un nodo ha <3 coppie.",
  },
  "modelLab.raCalibration.temporalCorr.timelineTitle": {
    en: "ρ by CD knot (≥3 pairs per knot, or neighbor pool)",
    it: "ρ per nodo CD (≥3 coppie per nodo, o pool vicini)",
  },
  "modelLab.raCalibration.temporalCorr.timelineSparse": {
    en: "Timeline still sparse: {total} pairs across knots — not enough even with neighbor pooling. Pooled bars above remain the best read. Add more Simulation rows with price curves.",
    it: "Timeline ancora sparsa: {total} coppie sui nodi — insufficienti anche con pool vicini. Le barre pooled sopra restano la lettura migliore. Aggiungi righe Simulation con curve prezzo.",
  },
  "modelLab.raCalibration.temporalCorr.tooltipWindowPooled": {
    en: "neighbor knots pooled",
    it: "nodi vicini accorpati",
  },
  "modelLab.raCalibration.temporalCorr.yAxis": {
    en: "ρ(RA, Δ% price)",
    it: "ρ(RA, Δ% prezzo)",
  },
  "modelLab.raCalibration.temporalCorr.legendFullRa": {
    en: "Raw RA (legacy sum · diagnostic)",
    it: "RA grezzo (somma legacy · diagnostica)",
  },
  "modelLab.raCalibration.temporalCorr.legendNormalizedRa": {
    en: "Entry RA (live Pick stocks · Σ ρ+ − Σ ρ−)",
    it: "RA ingresso (live Pick stocks · Σ ρ+ − Σ ρ−)",
  },
  "modelLab.raCalibration.temporalCorr.peakEntryRaInsight": {
    en: "Entry RA peak {anchor} ρ {rho} (n={n}, p={p}) — this is the live formula.",
    it: "Picco RA ingresso {anchor} ρ {rho} (n={n}, p={p}) — formula usata live.",
  },
  "modelLab.raCalibration.temporalCorr.peakRawRaInsight": {
    en: "Raw RA at {anchor} ρ {rho} — inverse correlation here is why Entry RA subtracts negative-ρ indices.",
    it: "RA grezzo a {anchor} ρ {rho} — correlazione inversa qui spiega perché RA ingresso sottrae indici ρ−.",
  },
  "modelLab.raCalibration.temporalCorr.toggleNormalized": {
    en: "Show price-aligned RA",
    it: "Mostra RA allineato al prezzo",
  },
  "modelLab.raCalibration.temporalCorr.peakNormalizedInsight": {
    en: "· Normalized RA peak {anchor} ρ {rho} ({inverted} indices inverted).",
    it: "· Picco RA normalizzato {anchor} ρ {rho} ({inverted} indici invertiti).",
  },
  "modelLab.raCalibration.polarity.title": {
    en: "RA index polarity vs price-up",
    it: "Polarità indici RA vs rialzo prezzo",
  },
  "modelLab.raCalibration.polarity.desc": {
    en: "Raw ρ(fill%, Δ%→T+7). If ρ<0 and n≥4, we mirror fill (100%−fill) — same idea as flipping the sign: aligned ρ measures how strongly the index moves with price after that fix. |ρ| near 1 = strong; near 0 = weak.",
    it: "ρ grezzo (fill%, Δ%→T+7). Se ρ<0 e n≥4, specchiamo il fill (100%−fill) — come mettere − davanti al segno: ρ allineato = forza con cui l'indice accompagna il prezzo dopo la correzione. |ρ| vicino a 1 = forte; a 0 = debole.",
  },
  "modelLab.raCalibration.polarity.colRhoRaw": {
    en: "Raw ρ",
    it: "ρ grezzo",
  },
  "modelLab.raCalibration.polarity.colRhoAligned": {
    en: "Aligned ρ (↑ with price)",
    it: "ρ allineato (↑ con prezzo)",
  },
  "modelLab.raCalibration.polarity.colIndex": {
    en: "Index",
    it: "Indice",
  },
  "modelLab.raCalibration.polarity.colRho": {
    en: "ρ vs Δ% price",
    it: "ρ vs Δ% prezzo",
  },
  "modelLab.raCalibration.polarity.colSign": {
    en: "Link",
    it: "Legame",
  },
  "modelLab.raCalibration.polarity.colAction": {
    en: "Normalization",
    it: "Normalizzazione",
  },
  "modelLab.raCalibration.polarity.positive": {
    en: "↑ Positive",
    it: "↑ Positivo",
  },
  "modelLab.raCalibration.polarity.negative": {
    en: "↓ Negative",
    it: "↓ Negativo",
  },
  "modelLab.raCalibration.polarity.neutral": {
    en: "Neutral",
    it: "Neutro",
  },
  "modelLab.raCalibration.polarity.unknown": {
    en: "Insufficient n",
    it: "n insufficiente",
  },
  "modelLab.raCalibration.polarity.actionInvert": {
    en: "Invert (max−pts)",
    it: "Inverti (max−pt)",
  },
  "modelLab.raCalibration.polarity.actionKeep": {
    en: "Keep as-is",
    it: "Mantieni",
  },
  "modelLab.raCalibration.temporalCorr.peakInsight": {
    en: "Strongest pre-CD link: {anchor} · ρ {rho} · n={n} · p {p}",
    it: "Legame pre-CD più forte: {anchor} · ρ {rho} · n={n} · p {p}",
  },
  "modelLab.raCalibration.temporalCorr.peakNone": {
    en: "No pre-CD anchor with n≥{minN} yet — add more completed CDs.",
    it: "Nessun ancoraggio pre-CD con n≥{minN} — servono più CD completate.",
  },
  "modelLab.raCalibration.temporalCorr.empty": {
    en: "Not enough anchor-level price moves to compute ρ.",
    it: "Movimenti prezzo per ancoraggio insufficienti per calcolare ρ.",
  },
  "modelLab.raCalibration.temporalCorr.toggleComponents": {
    en: "Show all 8 RA indices",
    it: "Mostra tutti gli 8 indici RA",
  },
  "modelLab.raCalibration.temporalCorr.componentsFallback": {
    en: "Component lines need simulation chart data — showing full RA only.",
    it: "Le linee componenti richiedono i dati grafico Simulation — solo RA completo.",
  },
  "modelLab.raCalibration.temporalCorr.snapshotHint": {
    en: "SDS/MII/calib use today's snapshot even at historical anchors",
    it: "SDS/MII/calib usano lo snapshot odierno anche su ancoraggi storici",
  },
  "modelLab.raCalibration.temporalCorr.footnote": {
    en: "Outcome = price_storico_usd (today’s offset → T+7 when chart covers it). Live rows: one point each at the nearest knot (e.g. T−8 → T−7). Completed CDs: all knots retrospectively. SDS/MII/calib (†) = current snapshot. Dashed vertical = peak |ρ| pre-CD.",
    it: "Esito = price_storico_usd (offset odierno → T+7 se in chart). Righe live: un punto ciascuna sul nodo più vicino (es. T−8 → T−7). CD completate: tutti i nodi in retrospectiva. SDS/MII/calib (†) = snapshot attuale. Linea verticale = picco |ρ| pre-CD.",
  },
  "modelLab.raCalibration.temporalCorr.bucketCounts": {
    en: "Opportunities per knot:",
    it: "Opportunità per nodo:",
  },
  "modelLab.raCalibration.temporalCorr.collapse": {
    en: "Collapse",
    it: "Comprimi",
  },
  "modelLab.raCalibration.temporalCorr.expand": {
    en: "Expand",
    it: "Espandi",
  },
  "modelLab.raCalibration.temporalCorr.tooltipPreCd": {
    en: "Window: {pre}",
    it: "Finestra: {pre}",
  },
  "modelLab.raCalibration.temporalCorr.preCdYes": {
    en: "pre-CD",
    it: "pre-CD",
  },
  "modelLab.raCalibration.temporalCorr.preCdNo": {
    en: "post-CD",
    it: "post-CD",
  },
  "modelLab.raCalibration.inverse.title": {
    en: "Inverse pattern — price outcome → RA indices",
    it: "Pattern inverso — esito prezzo → indici RA",
  },
  "modelLab.raCalibration.inverse.desc": {
    en: "Split companies by stock move at the selected CD anchor (long → T+7). RA indices are computed as-of that anchor (curve + timing at T−X; SDS/MII from current snapshot). Compare mean fills in price-up vs price-down groups.",
    it: "Divide per movimento prezzo all'ancoraggio CD scelto (lungo → T+7). Gli indici RA sono calcolati as-of quell'ancoraggio (curva + timing a T−X; SDS/MII dallo snapshot attuale). Confronta i riempimenti medi nei gruppi price-up vs price-down.",
  },
  "modelLab.raCalibration.inverse.asOfBanner": {
    en: "RA v2 at {anchor}: Reliability, Timing, Align, ROI, Pre-CD use the curve as-of that anchor. SDS, MII, and Calib still use today's snapshot — they can flip the ↑/↓ split vs price outcome.",
    it: "RA v2 a {anchor}: Reliability, Timing, Align, ROI, Pre-CD usano la curva a quell'ancoraggio. SDS, MII e Calib restano lo snapshot odierno — possono invertire lo split ↑/↓ rispetto all'esito prezzo.",
  },
  "modelLab.raCalibration.inverse.anchorLabel": {
    en: "CD anchor:",
    it: "Ancoraggio CD:",
  },
  "modelLab.raCalibration.inverse.colIndex": {
    en: "RA index",
    it: "Indice RA",
  },
  "modelLab.raCalibration.inverse.colUp": {
    en: "Price ↑",
    it: "Prezzo ↑",
  },
  "modelLab.raCalibration.inverse.colDown": {
    en: "Price ↓",
    it: "Prezzo ↓",
  },
  "modelLab.raCalibration.inverse.colDelta": {
    en: "Δ fill",
    it: "Δ riemp.",
  },
  "modelLab.raCalibration.inverse.raTotal": {
    en: "RA total — raw composite",
    it: "RA totale — composito grezzo",
  },
  "modelLab.raCalibration.inverse.summary": {
    en: "At {anchor}: {upN} price-up · {downN} price-down · mean RA {upRa} vs {downRa} (Δ {raDelta}). Strongest split: {top}.",
    it: "A {anchor}: {upN} price-up · {downN} price-down · RA medio {upRa} vs {downRa} (Δ {raDelta}). Split più forte: {top}.",
  },
  "modelLab.raCalibration.inverse.negativeDeltaHint": {
    en: "Price-up mean RA is below price-down — weak directional split at this anchor (often SDS/MII/calib use today’s snapshot, not historical T−X). Check ρ and p-value before trusting RA as a direction filter.",
    it: "RA medio price-up sotto price-down — split direzionale debole a questo ancoraggio (SDS/MII/calib usano lo snapshot odierno, non il T−X storico). Controlla ρ e p-value prima di usare RA come filtro direzione.",
  },
  "modelLab.raCalibration.inverse.negativeDeltaHintCurveOnly": {
    en: "Curve-only RA still inverts at this anchor — price-up mean below price-down on Reliability/Timing/Align/ROI/Pre-CD as-of T−X. Check p-value and sample size before using as a direction filter.",
    it: "Anche il RA solo-curva è invertito a questo ancoraggio — RA medio price-up sotto price-down su Reliability/Timing/Align/ROI/Pre-CD as-of T−X. Controlla p-value e campione prima di usarlo come filtro direzione.",
  },
  "modelLab.raCalibration.inverse.scoreModeCurveOnly": {
    en: "Curve only (as-of anchor)",
    it: "Solo curva (as-of anchor)",
  },
  "modelLab.raCalibration.inverse.scoreModeFull": {
    en: "Full RA (+ SDS/MII/calib today)",
    it: "RA completo (+ SDS/MII/calib oggi)",
  },
  "modelLab.raCalibration.inverse.curveOnlyBanner": {
    en: "Curve-only mode: Reliability, Timing, Align, ROI, Pre-CD at the selected anchor — excludes SDS, MII, Calib (today’s snapshot) for a fair comparison vs historical price outcome.",
    it: "Modalità solo-curva: Reliability, Timing, Align, ROI, Pre-CD all'ancoraggio scelto — esclude SDS, MII, Calib (snapshot odierno) per un confronto coerente con l'esito prezzo storico.",
  },
  "modelLab.raCalibration.inverse.fullRaCompare": {
    en: "Full RA (with today’s SDS/MII/calib): price-up {upRa} vs price-down {downRa} (Δ {delta}).",
    it: "RA completo (con SDS/MII/calib odierni): price-up {upRa} vs price-down {downRa} (Δ {delta}).",
  },
  "modelLab.raCalibration.inverse.raTotalCurveOnly": {
    en: "RA curve-only — raw composite",
    it: "RA solo-curva — composito grezzo",
  },
  "modelLab.raCalibration.inverse.raTotalAligned": {
    en: "RA total — polarized (Σ ρ+ − Σ ρ−)",
    it: "RA totale — polarizzato (Σ ρ+ − Σ ρ−)",
  },
  "modelLab.raCalibration.inverse.rawVsAlignedNote": {
    en: "Raw = simple sum of index points. Polarized = Σ(positive-ρ indices) − Σ(negative-ρ indices) — same as the cumulative chart and live Simulation RA.",
    it: "Grezzo = somma semplice dei punti indice. Polarizzato = Σ(indici ρ+) − Σ(indici ρ−) — come il grafico cumulativo e il RA live in Simulation.",
  },
  "modelLab.raCalibration.inverse.compressionBanner": {
    en: "Cohort RA is compressed (max ≈ {max}, none ≥60) — weak scatter correlation may reflect low score spread, not a broken model.",
    it: "RA coorte compresso (max ≈ {max}, nessuno ≥60) — correlazione debole può dipendere da poca dispersione punteggi, non da modello rotto.",
  },
  "modelLab.raCalibration.inverse.empty": {
    en: "No price path at any CD anchor — need simulation_charts_snapshot.json with price_storico_usd.",
    it: "Nessun percorso prezzo agli ancoraggi CD — servono simulation_charts_snapshot.json con price_storico_usd.",
  },
  "modelLab.raCalibration.inverse.emptyTitle": {
    en: "Insufficient data",
    it: "Dati insufficienti",
  },
  "modelLab.raCalibration.inverse.emptyDetail": {
    en: "At {anchor}: only {n} companies with a price path (↑{up} · ↓{down} · flat {flat}). Need ≥4 in ↑/↓ groups (missing {need}). Near-CD anchors (T−10, T−7) often lack data while the catalyst is still far out.",
    it: "A {anchor}: solo {n} società con percorso prezzo (↑{up} · ↓{down} · flat {flat}). Servono ≥4 in ↑/↓ (mancano {need}). Ancoraggi vicini al CD (T−10, T−7) spesso mancano se il catalizzatore è ancora lontano.",
  },
  "modelLab.raCalibration.inverse.anchorChipReady": {
    en: "{n} companies · ↑{up} · ↓{down} — table ready",
    it: "{n} società · ↑{up} · ↓{down} — tabella ok",
  },
  "modelLab.raCalibration.inverse.anchorChipSparse": {
    en: "{n} companies (↑{up} · ↓{down} · flat {flat}) — need ≥4 in ↑/↓ for table",
    it: "{n} società (↑{up} · ↓{down} · flat {flat}) — servono ≥4 in ↑/↓ per la tabella",
  },
  "modelLab.raCalibration.inverse.colP": {
    en: "p (MWU)",
    it: "p (MWU)",
  },
  "modelLab.raCalibration.inverse.exportCsv": {
    en: "↓ Export CSV",
    it: "↓ Esporta CSV",
  },
  "modelLab.raCalibration.inverse.tableShow": {
    en: "Detail table (indices · p-value)",
    it: "Tabella dettaglio (indici · p-value)",
  },
  "modelLab.raCalibration.inverse.tableHide": {
    en: "Hide detail table",
    it: "Nascondi tabella dettaglio",
  },
  "modelLab.raCalibration.inverse.pFootnote": {
    en: "p = two-tailed Mann–Whitney U on index fill % (↑ vs ↓). * p<0.05 · ** p<0.01 · *** p<0.001 · ns = not significant. Small n → treat as exploratory.",
    it: "p = Mann–Whitney U bilateral sul riempimento % indice (↑ vs ↓). * p<0,05 · ** p<0,01 · *** p<0,001 · ns = non significativo. n piccolo → uso esplorativo.",
  },
  "modelLab.raCalibration.inverseCumulative.title": {
    en: "Cumulative RA build-up — price ↑ vs ↓",
    it: "Curva cumulativa RA — prezzo ↑ vs ↓",
  },
  "modelLab.raCalibration.inverseCumulative.desc": {
    en: "At {anchor}: mean RA decomposed step-by-step. Each band is one index contribution; the line is the running total (RA {delta} gap ↑−↓). Updates as new catalysts close.",
    it: "A {anchor}: RA medio scomposto passo-passo. Ogni fascia è un indice; la linea è il totale cumulativo (gap RA {delta} ↑−↓). Si aggiorna con nuovi catalizzatori chiusi.",
  },
  "modelLab.raCalibration.inverseCumulative.descCurveOnly": {
    en: "Curve-only at {anchor} (Reliability → Pre-CD, as-of anchor). Gap {delta} ↑−↓ — excludes SDS/MII/calib snapshot.",
    it: "Solo-curva a {anchor} (Reliability → Pre-CD, as-of anchor). Gap {delta} ↑−↓ — esclusi SDS/MII/calib snapshot.",
  },
  "modelLab.raCalibration.inverseCumulative.yAxis": {
    en: "RA pts",
    it: "pt RA",
  },
  "modelLab.raCalibration.inverseCumulative.axisStart": {
    en: "0",
    it: "0",
  },
  "modelLab.raCalibration.inverseCumulative.tooltipStart": {
    en: "Start — no index points yet",
    it: "Inizio — nessun punto indice",
  },
  "modelLab.raCalibration.inverseCumulative.tooltipSegment": {
    en: "This step",
    it: "Questo step",
  },
  "modelLab.raCalibration.inverseCumulative.tooltipCumulative": {
    en: "Running total",
    it: "Totale cumulativo",
  },
  "modelLab.raCalibration.inverseCumulative.footnote": {
    en: "Smooth cumulative curve left-to-right in composite order (reliability → calib). Each colored band = mean points from that index; band height = relative contribution under the total line.",
    it: "Curva cumulativa morbida da sinistra a destra nell'ordine del composito (reliability → calib). Ogni fascia colorata = punti medi di quell'indice; altezza fascia = contributo relativo sotto la linea totale.",
  },
  "modelLab.raCalibration.inverseCumulative.alignedBanner": {
    en: "Entry RA polarized (Σ ρ+ − Σ ρ−): price-up {up} vs price-down {down} (Δ {delta}) · {inverted} indices subtracted — same as Pick stocks. Cohort split is historical; live: higher Entry RA = stronger BUY.",
    it: "RA ingresso polarizzato (Σ ρ+ − Σ ρ−): rialzo {up} vs calo {down} (Δ {delta}) · {inverted} indici sottratti — come Pick stocks. Split coorte è storico; live: RA ingresso più alto = BUY più forte.",
  },
  "modelLab.raCalibration.inverseCumulative.alignedFootnote": {
    en: "Dashed bands = indices with ρ<0 vs price (subtracted, not mirrored). Same Entry RA formula as Pick stocks — not the Raw RA line that can correlate inversely.",
    it: "Fasce tratteggiate = indici con ρ<0 vs prezzo (sottratti, non specchiati). Stessa formula RA ingresso di Pick stocks — non la linea RA grezzo che può correlare inversamente.",
  },
  "modelLab.raCalibration.inverseCumulative.panelTitleUp": {
    en: "Price ↑ · Entry RA",
    it: "Prezzo ↑ · RA ingresso",
  },
  "modelLab.raCalibration.inverseCumulative.panelTitleDown": {
    en: "Price ↓ · Entry RA",
    it: "Prezzo ↓ · RA ingresso",
  },
  "modelLab.raCalibration.inverseCumulative.short.reliability": {
    en: "Rel.",
    it: "Aff.",
  },
  "modelLab.raCalibration.inverseCumulative.short.timing": {
    en: "Timing",
    it: "Timing",
  },
  "modelLab.raCalibration.inverseCumulative.short.align": {
    en: "Align",
    it: "Allineam.",
  },
  "modelLab.raCalibration.inverseCumulative.short.roiTarget": {
    en: "ROI",
    it: "ROI",
  },
  "modelLab.raCalibration.inverseCumulative.short.sds": {
    en: "SDS",
    it: "SDS",
  },
  "modelLab.raCalibration.inverseCumulative.short.precat": {
    en: "Pre-CD",
    it: "Pre-CD",
  },
  "modelLab.raCalibration.inverseCumulative.short.mii": {
    en: "MII",
    it: "MII",
  },
  "modelLab.raCalibration.inverseCumulative.short.calib": {
    en: "Calib",
    it: "Calib",
  },
  "modelLab.raCalibration.threshold.title": {
    en: "② Threshold finder — at what RA threshold is the model reliable?",
    it: "② Threshold finder — a quale soglia RA il modello diventa affidabile?",
  },
  "modelLab.raCalibration.threshold.desc": {
    en: "At {anchor} (long → T+7): for each RA threshold “invest if ≥ X”, shows % of signals with price-up among those with RA ≥ X at that anchor.",
    it: "A {anchor} (lungo → T+7): per ogni soglia RA 'invest se ≥ X', mostra % price-up tra i segnali con RA ≥ X a quell'ancoraggio.",
  },
  "modelLab.raCalibration.threshold.anchorScope": {
    en: "One curve per CD anchor ({anchor}) — not a single pre/post CD timeline. Switch T−60 / T−30 chips in inverse pattern above; gray zones = n<{minN} (exploratory only at that anchor).",
    it: "Una curva per ancoraggio CD ({anchor}) — non un unico asse pre/post CD. Cambia chip T−60 / T−30 nel pattern inverso sopra; zone grigie = n<{minN} (solo esplorativo a quell'ancoraggio).",
  },
  "modelLab.raCalibration.threshold.legend.successRate": {
    en: "% price-up (7d) — left axis · success rate among signals with RA ≥ X",
    it: "% price-up (7d) — asse sinistro · quota di successo tra segnali con RA ≥ X",
  },
  "modelLab.raCalibration.threshold.legend.sampleN": {
    en: "Signal count (n) — right axis · how many signals qualify at each threshold",
    it: "Conteggio segnali (n) — asse destro · quanti segnali superano ogni soglia",
  },
  "modelLab.raCalibration.threshold.legend.lowN": {
    en: "Gray zone — n < {minN} at this anchor (do not use as invest rule)",
    it: "Zona grigia — n < {minN} a questo ancoraggio (non usare come regola invest)",
  },
  "modelLab.raCalibration.threshold.xAxis": {
    en: "RA invest threshold (≥ X)",
    it: "Soglia RA invest (≥ X)",
  },
  "modelLab.raCalibration.threshold.insightFound": {
    en: "At {anchor}: purple curve enters green zone — operational threshold RA≥{threshold} ({rate}% on n={n}).",
    it: "A {anchor}: curva viola in zona verde — soglia operativa RA≥{threshold} ({rate}% su n={n}).",
  },
  "modelLab.raCalibration.threshold.insightLowN": {
    en: "At {anchor}: RA≥{threshold} shows {rate}% but only n={n} — need ≥{minN} before treating as operational (gray zone).",
    it: "A {anchor}: RA≥{threshold} mostra {rate}% ma solo n={n} — servono ≥{minN} prima di usarla come operativa (zona grigia).",
  },
  "modelLab.raCalibration.threshold.insightNone": {
    en: "At {anchor}: no threshold reaches 55% success with n≥4 — keep collecting catalyst outcomes.",
    it: "A {anchor}: nessuna soglia raggiunge 55% successo con n≥4 — raccogliere altri esiti catalizzatore.",
  },
  "modelLab.raCalibration.threshold.tooltipLowN": {
    en: "⚠ n < {minN} at this anchor — exploratory only",
    it: "⚠ n < {minN} a questo ancoraggio — solo esplorativo",
  },
  "modelLab.raCalibration.threshold.heatmap.title": {
    en: "Anchor × RA threshold — where does the rule hold?",
    it: "Ancoraggio × soglia RA — dove regge la regola?",
  },
  "modelLab.raCalibration.threshold.heatmap.desc": {
    en: "Each cell = % price-up (long → T+7) at that CD anchor with RA ≥ column. Gray = n<{minN}. Click a row to switch anchor.",
    it: "Ogni cella = % price-up (lungo → T+7) a quell'ancoraggio con RA ≥ colonna. Grigio = n<{minN}. Clicca la riga per cambiare ancoraggio.",
  },
  "modelLab.raCalibration.threshold.heatmap.colAnchor": {
    en: "CD anchor",
    it: "Ancoraggio CD",
  },
  "modelLab.raCalibration.threshold.heatmap.selectAnchor": {
    en: "Switch curve to this anchor",
    it: "Mostra curva per questo ancoraggio",
  },
  "modelLab.raCalibration.threshold.heatmap.empty": {
    en: "No price path at this anchor",
    it: "Nessun percorso prezzo a questo ancoraggio",
  },
  "modelLab.raCalibration.threshold.heatmap.lowN": {
    en: "n < {minN} — exploratory only",
    it: "n < {minN} — solo esplorativo",
  },
  "modelLab.raCalibration.threshold.heatmap.legendGreen": {
    en: "Green ≥55% · amber 45–55% · red <45% (only if n≥4)",
    it: "Verde ≥55% · ambra 45–55% · rosso <45% (solo se n≥4)",
  },
  "modelLab.raCalibration.threshold.heatmap.legendGray": {
    en: "Gray = n<4 or no data",
    it: "Grigio = n<4 o senza dati",
  },
  "modelLab.raCalibration.trend.title": {
    en: "③ Reliability over time — is the model improving?",
    it: "③ Affidabilità nel tempo — il modello sta migliorando?",
  },
  "modelLab.raCalibration.trend.insightNeedWeeks": {
    en: "Need ≥3 weeks with ρ to estimate trend. Points available: {n}.",
    it: "Servono ≥3 settimane con ρ per stimare il trend. Punti disponibili: {n}.",
  },
  "modelLab.raCalibration.trend.insightImproving": {
    en: "ρ trend improving over recent weeks.",
    it: "Trend ρ in miglioramento sulle ultime settimane.",
  },
  "modelLab.raCalibration.trend.insightDeclining": {
    en: "ρ trend declining — review RA weights.",
    it: "Trend ρ in calo — rivedi pesi RA.",
  },
  "modelLab.raCalibration.trend.insightStable": {
    en: "ρ trend stable over recent weeks.",
    it: "Trend ρ stabile sulle ultime settimane.",
  },
  "modelLab.raCalibration.confidence.title": {
    en: "④ Confidence meter — where are we today?",
    it: "④ Confidence meter — dove siamo oggi?",
  },
  "modelLab.raCalibration.confidence.global": {
    en: "Overall confidence: {pct}% · {phase}",
    it: "Confidence globale: {pct}% · {phase}",
  },
  "modelLab.raCalibration.confidence.phase.calibrated": {
    en: "calibrated",
    it: "calibrato",
  },
  "modelLab.raCalibration.confidence.phase.calibrating": {
    en: "calibrating",
    it: "in calibrazione",
  },
  "modelLab.raCalibration.confidence.phase.insufficient": {
    en: "insufficient",
    it: "insufficiente",
  },
  "modelLab.raCalibration.radar.monotonicity": {
    en: "Monotonicity ρ",
    it: "Monotonicity ρ",
  },
  "modelLab.raCalibration.radar.sampleSize": {
    en: "Sample size",
    it: "Sample size",
  },
  "modelLab.raCalibration.radar.bandCoverage": {
    en: "Band coverage",
    it: "Band coverage",
  },
  "modelLab.raCalibration.radar.priceUp55": {
    en: "Price-up ≥55%",
    it: "Price-up ≥55%",
  },
  "modelLab.raCalibration.radar.risingTrend": {
    en: "Rising ρ trend",
    it: "Trend crescente",
  },
  "modelLab.raCalibration.radar.current": {
    en: "Current state",
    it: "Stato attuale",
  },
  "modelLab.raCalibration.radar.target": {
    en: "Target",
    it: "Target",
  },
  "modelLab.raCalibration.chart.priceUp7d": {
    en: "% price-up (7d)",
    it: "% price-up (7d)",
  },
  "modelLab.raCalibration.chart.priceUp24h": {
    en: "% price-up (24h)",
    it: "% price-up (24h)",
  },
  "modelLab.raCalibration.chart.nSignals": {
    en: "n signals",
    it: "n segnali",
  },
  "modelLab.raCalibration.check.rho": {
    en: "Monotonicity ρ > 0.6",
    it: "Monotonicity ρ > 0.6",
  },
  "modelLab.raCalibration.check.bands": {
    en: "≥3 bands with n≥2",
    it: "≥3 band con n≥2",
  },
  "modelLab.raCalibration.check.priceUp": {
    en: "At least 1 band ≥55% (7d)",
    it: "Almeno 1 band ≥55% (7d)",
  },
  "modelLab.raCalibration.check.threshold": {
    en: "Invest threshold defined",
    it: "Soglia invest definita",
  },
  "modelLab.raCalibration.check.trend": {
    en: "Rising ρ trend (≥3w)",
    it: "Trend ρ crescente (≥3w)",
  },
  "modelLab.raCalibration.check.status.found": {
    en: "✓ found",
    it: "✓ found",
  },
  "modelLab.raCalibration.check.status.zeroPct": {
    en: "✗ 0%",
    it: "✗ 0%",
  },
  "modelLab.raCalibration.check.status.pending": {
    en: "~ pending",
    it: "~ pending",
  },
  "modelLab.performance.backToDashboard": {
    en: "Back to Today",
    it: "Torna a Oggi",
  },
  "modelLab.qc.performance.title": {
    en: "Model performance overview",
    it: "Panoramica performance modello",
  },
  "modelLab.qc.performance.lead": {
    en: "Curve sign hit from T−60 to T+7 — where pre-CD predictions matter for entries.",
    it: "Segno curva da T−60 a T+7 — la zona pre-CD dove contano le entrate.",
  },
  "modelLab.tab.qcDetail": {
    en: "Detail",
    it: "Dettaglio",
  },
  "modelLab.subtitle.qcToday": {
    en: "Today's model health, SDS ROI estimates and forward accuracy tracking",
    it: "Salute modello di oggi, stime ROI SDS e tracking accuratezza forward",
  },
  "modelLab.qc.today.title": {
    en: "Model improvements today",
    it: "Miglioramenti modello oggi",
  },
  "modelLab.qc.today.lead": {
    en: "Curve sign hit from T−60 to T+7 — where pre-CD predictions matter for entries.",
    it: "Segno curva da T−60 a T+7 — la zona pre-CD dove contano le entrate.",
  },
  "modelLab.qc.kpi.backtest.title": {
    en: "Past trials — direction hit",
    it: "Trial passati — segno azzeccato",
  },
  "modelLab.qc.kpi.backtest.hint": {
    en: "Legacy post-CD metric (deprecated in Q&C). Use sign curve below.",
    it: "Metrica legacy post-CD (non più usata in Q&C). Vedi curva segno sotto.",
  },
  "modelLab.qc.kpi.signCurve.title": {
    en: "Daily sign T−60…T+7",
    it: "Segno giornaliero T−60…T+7",
  },
  "modelLab.qc.kpi.signCurve.preCdAvg": {
    en: "node avg (legacy)",
    it: "media nodi (legacy)",
  },
  "modelLab.qc.kpi.signCurve.dailyOverall": {
    en: "2 mo before CD",
    it: "2 mesi prima CD",
  },
  "modelLab.qc.kpi.signCurve.peakAt": {
    en: "at {offset} days",
    it: "a {offset} giorni",
  },
  "modelLab.qc.kpi.signCurve.hint": {
    en: "Legacy: sign of cumulative % vs T−60 at each node.",
    it: "Legacy: segno della % cumulata vs T−60 a ogni nodo.",
  },
  "modelLab.qc.kpi.signCurve.dailyHint": {
    en: "X-axis: days to CD (−60…+7). Blue = historical cohort · Orange dashed = Simulation (daily seq_curve, open/close sessions).",
    it: "Asse X: giorni alla CD (−60…+7). Blu = corte storica · Arancione tratteggiato = Simulation (seq_curve giornaliero, sedute open/chiusura).",
  },
  "modelLab.qc.kpi.signCurve.chartSignTitle": {
    en: "1 · Direction sign hit",
    it: "1 · Segno azzeccato",
  },
  "modelLab.qc.kpi.signCurve.chartSignCaption": {
    en: "Day-over-day sign match (estimated vs actual). Y-axis in %.",
    it: "Segno giornaliero stimato vs reale. Asse Y in %.",
  },
  "modelLab.qc.kpi.signCurve.chartPriceTitle": {
    en: "2 · Price accuracy",
    it: "2 · Accuratezza prezzo",
  },
  "modelLab.qc.kpi.signCurve.chartPriceCaption": {
    en: "How close the model price is to the actual stock price (0–100%, higher = better). Close each session; Simulation also uses open when available.",
    it: "Quanto il prezzo modello si avvicina al reale (0–100%, più alto = meglio). Chiusura seduta; Simulation anche apertura se disponibile.",
  },
  "modelLab.qc.kpi.signCurve.legendHit": {
    en: "Sign hit %",
    it: "Hit % segno",
  },
  "modelLab.qc.kpi.signCurve.legendMag": {
    en: "Mag error (sign ok)",
    it: "Err. magn. (segno ok)",
  },
  "modelLab.qc.kpi.signCurve.chartCaption": {
    en: "Blue = sign hit · Orange = magnitude gap when sign is correct",
    it: "Blu = hit segno · Arancione = scarto magnitudine se segno ok",
  },
  "modelLab.qc.kpi.signCurve.magWhenHit": {
    en: "When sign matches: avg |Δ_pred − Δ_real| = {pp} pp/day",
    it: "Se il segno coincide: |Δ stim − Δ reale| medio = {pp} pp/giorno",
  },
  "modelLab.qc.kpi.signCurve.emptyDaily": {
    en: "Run orchestrator refresh to build model_sign_curve_daily.json (needs past_pred + price history).",
    it: "Esegui refresh orchestrator per generare model_sign_curve_daily.json (serve past_pred + storico prezzi).",
  },
  "modelLab.qc.kpi.simLive.title": {
    en: "Simulation — live check",
    it: "Simulation — verifica live",
  },
  "modelLab.qc.kpi.simLive.hint": {
    en: "Tickers you added to Simulation: scored once price data exists ~32 days after CD.",
    it: "Ticker messi in Simulation: si valuta quando passano ~32 giorni dalla CD e c'è il prezzo reale.",
  },
  "modelLab.qc.anticipatory.title": {
    en: "Anticipatory window (pre-CD)",
    it: "Finestra anticipatoria (pre-CD)",
  },
  "modelLab.qc.anticipatory.lead": {
    en: "Best sign-hit % on the daily curve before completion date — when entries matter most.",
    it: "Miglior hit% segno sulla curva giornaliera prima della CD — la zona che conta per le entrate.",
  },
  "modelLab.qc.kpi.strongSignals.title": {
    en: "Strong signal — peak pre-CD",
    it: "Segnale forte — picco pre-CD",
  },
  "modelLab.qc.kpi.strongSignals.peakTitle": {
    en: "T{offset} peak (not average)",
    it: "Picco T{offset} (non media)",
  },
  "modelLab.qc.kpi.strongSignals.hint": {
    en: "Best day-over-day sign bin on the anticipatory curve — not the cohort average (~60% on the same chart). Differs from operative panel sign %.",
    it: "Miglior bin segno giornaliero sulla curva anticipatoria — non la media di coorte (~60% sullo stesso grafico). Diverso dal segno % nel pannello operativo.",
  },
  "modelLab.qc.kpi.strongSignals.peakAtPreCd": {
    en: "at {offset} days to CD · curve peak",
    it: "a {offset} giorni alla CD · picco curva",
  },
  "modelLab.qc.kpi.strongSignals.peakAtHorizon": {
    en: "{pct} at {window}",
    it: "{pct} a {window}",
  },
  "modelLab.qc.kpi.strongSignals.bestPending": {
    en: "{ticker} {pred} at {offset} days",
    it: "{ticker} {pred} a {offset} giorni",
  },
  "modelLab.qc.decisionGain.title": {
    en: "Investment decisions — gain vs loss",
    it: "Decisioni d'investimento — gain vs loss",
  },
  "modelLab.qc.decisionGain.lead": {
    en: "How your buy/sell choices translated into realized and open P&L.",
    it: "Quanto le tue scelte buy/sell si sono tradotte in P&L realizzato e aperto.",
  },
  "modelLab.qc.decisionGain.body": {
    en: "Closed positions = realized after exit. Open = mark-to-market from Simulation. Signal bars = model buy/sell suggestions that were evaluated.",
    it: "Chiuse = realizzato dopo uscita. Aperte = mark-to-market da Simulation. Barre segnali = suggerimenti buy/sell del modello già valutati.",
  },
  "modelLab.qc.decisionGain.empty": {
    en: "No portfolio decisions yet. Set capital in Simulation and open/close positions — data fills in here automatically.",
    it: "Nessuna decisione di portafoglio ancora. Imposta capitale in Simulation e apri/chiudi posizioni — i dati compariranno qui.",
  },
  "modelLab.qc.decisionGain.kpi.realized": {
    en: "Realized (closed)",
    it: "Realizzato (chiuse)",
  },
  "modelLab.qc.decisionGain.kpi.open": {
    en: "Open (MTM)",
    it: "Aperte (MTM)",
  },
  "modelLab.qc.decisionGain.kpi.total": {
    en: "Total P&L",
    it: "P&L totale",
  },
  "modelLab.qc.decisionGain.kpi.totalSub": {
    en: "Realized + open mark-to-market",
    it: "Realizzato + mark-to-market aperte",
  },
  "modelLab.qc.decisionGain.barTitle": {
    en: "Positions by outcome",
    it: "Posizioni per esito",
  },
  "modelLab.qc.decisionGain.barCaption": {
    en: "Green = gain · red = loss · grey = flat. Count includes open + closed.",
    it: "Verde = gain · rosso = loss · grigio = flat. Conteggio include aperte + chiuse.",
  },
  "modelLab.qc.decisionGain.timelineTitle": {
    en: "Cumulative realized P&L",
    it: "P&L realizzato cumulativo",
  },
  "modelLab.qc.decisionGain.timelineCaption": {
    en: "Each point = one closed position (exit order). Line shows running total €.",
    it: "Ogni punto = una posizione chiusa (ordine uscita). La linea mostra il totale € progressivo.",
  },
  "modelLab.qc.decisionGain.cumulativeLine": {
    en: "Cumulative €",
    it: "Cumulativo €",
  },
  "modelLab.qc.decisionGain.signalTitle": {
    en: "Signal quality (buy / sell)",
    it: "Qualità segnali (buy / sell)",
  },
  "modelLab.qc.kpi.curveMult.title": {
    en: "Model stretch",
    it: "Model stretch",
  },
  "modelLab.qc.kpi.curveMult.hint": {
    en: "Global curve scale (cal_factor v4) learned from past catalyst errors. 1.00 = no stretch; compare outcome below.",
    it: "Scala globale curva (cal_factor v4) appresa dagli errori sui catalyst passati. 1,00 = neutro; vedi esito sotto.",
  },
  "modelLab.qc.modelStretch.title": {
    en: "Model stretch — learning outcome",
    it: "Model stretch — esito apprendimento",
  },
  "modelLab.qc.modelStretch.lead": {
    en: "We stretch the prediction curve using resolved past catalysts",
    it: "Allungiamo la curva di previsione usando i catalyst passati già risolti",
  },
  "modelLab.qc.modelStretch.body": {
    en: "Each recalibration compares estimated vs actual price paths and applies a global scale (cal_factor). Gray = before learning · Blue dashed = after stretch + daily recalib. Check whether price accuracy and sign hit improved.",
    it: "Ogni ricalibrazione confronta percorsi stimati vs reali e applica una scala globale (cal_factor). Grigio = prima dell'apprendimento · Blu tratteggiato = dopo stretch + ricalib giornaliera. Verifica se accuratezza prezzo e segno sono migliorati.",
  },
  "modelLab.qc.modelStretch.verdict.improved": {
    en: "↗ Stretch helped",
    it: "↗ Stretch utile",
  },
  "modelLab.qc.modelStretch.verdict.worse": {
    en: "↘ Stretch hurt",
    it: "↘ Stretch peggiorativo",
  },
  "modelLab.qc.modelStretch.verdict.neutral": {
    en: "≈ Mixed / flat",
    it: "≈ Misto / piatto",
  },
  "modelLab.qc.modelStretch.verdict.unknown": {
    en: "Outcome pending",
    it: "Esito in attesa",
  },
  "modelLab.qc.modelStretch.priceBefore": {
    en: "Price acc. before",
    it: "Acc. prezzo prima",
  },
  "modelLab.qc.modelStretch.priceAfter": {
    en: "Price acc. after",
    it: "Acc. prezzo dopo",
  },
  "modelLab.qc.modelStretch.signBefore": {
    en: "Sign hit before",
    it: "Segno prima",
  },
  "modelLab.qc.modelStretch.signAfter": {
    en: "Sign hit after",
    it: "Segno dopo",
  },
  "modelLab.qc.modelStretch.pillPriceDelta": {
    en: "price {delta}",
    it: "prezzo {delta}",
  },
  "modelLab.qc.modelStretch.pillSignDelta": {
    en: "sign {delta}",
    it: "segno {delta}",
  },
  "modelLab.qc.modelStretch.outcomeChartTitle": {
    en: "Did the stretch improve the curve?",
    it: "Lo stretch ha migliorato la curva?",
  },
  "modelLab.qc.modelStretch.outcomeChartCaption": {
    en: "Historical cohort (before) vs Simulation with learning (after), by days to CD.",
    it: "Corte storica (prima) vs Simulation con apprendimento (dopo), per giorni alla CD.",
  },
  "modelLab.qc.modelStretch.modePrice": {
    en: "Price accuracy",
    it: "Accuratezza prezzo",
  },
  "modelLab.qc.modelStretch.modeSign": {
    en: "Sign hit",
    it: "Segno azzeccato",
  },
  "modelLab.qc.modelStretch.lineBefore": {
    en: "Before learning",
    it: "Prima apprendimento",
  },
  "modelLab.qc.modelStretch.lineAfter": {
    en: "After stretch",
    it: "Dopo stretch",
  },
  "modelLab.qc.modelStretch.historyTitle": {
    en: "Stretch factor over recalibrations",
    it: "Fattore stretch nel tempo",
  },
  "modelLab.qc.modelStretch.historyLead": {
    en: "How much the model has stretched or compressed predictions over time.",
    it: "Quanto il modello ha allungato o compresso le previsioni nel tempo.",
  },
  "modelLab.qc.modelStretch.historyCaption": {
    en: "Y-axis = global scale multiplier (×). 1.00 = neutral (no change). Below 1 = compressed predictions; above 1 = elongated. Each dot = retro-pool recalibration.",
    it: "Asse Y = moltiplicatore globale (×). 1,00 = neutro (nessun cambio). Sotto 1 = previsioni compresse; sopra 1 = allungate. Ogni punto = ricalib sul pool retro.",
  },
  "modelLab.qc.modelStretch.yAxisLabel": {
    en: "Scale (×)",
    it: "Scala (×)",
  },
  "modelLab.qc.modelStretch.neutralLine": {
    en: "Neutral 1.00",
    it: "Neutro 1,00",
  },
  "modelLab.qc.modelStretch.tooltipFactor": {
    en: "cal_factor v4",
    it: "cal_factor v4",
  },
  "modelLab.qc.modelStretch.tooltipStretch": {
    en: "{pct}% vs neutral",
    it: "{pct}% vs neutro",
  },
  "modelLab.qc.modelStretch.tooltipCompressed": {
    en: "compressed",
    it: "compresso",
  },
  "modelLab.qc.modelStretch.tooltipElongated": {
    en: "elongated",
    it: "allungato",
  },
  "modelLab.qc.modelStretch.scheduleTitle": {
    en: "Recalibration timeline",
    it: "Timeline ricalibrazioni",
  },
  "modelLab.qc.modelStretch.scheduleCaption": {
    en: "Full retro-pool recalibrations run about every {days} days (Sunday refresh or when the interval expires). Future dates are estimated.",
    it: "Le ricalibrazioni complete sul pool retro avvengono circa ogni {days} giorni (refresh domenicale o a scadenza intervallo). Le date future sono stimate.",
  },
  "modelLab.qc.modelStretch.scheduleCompleted": {
    en: "Done",
    it: "Eseguita",
  },
  "modelLab.qc.modelStretch.scheduleCurrent": {
    en: "Current",
    it: "Attuale",
  },
  "modelLab.qc.modelStretch.scheduleNext": {
    en: "Next expected",
    it: "Prossima attesa",
  },
  "modelLab.qc.modelStretch.schedulePlanned": {
    en: "Planned",
    it: "Pianificata",
  },
  "modelLab.qc.modelStretch.scheduleInDays": {
    en: "in {days}d",
    it: "tra {days}g",
  },
  "modelLab.qc.modelStretch.scheduleToday": {
    en: "today",
    it: "oggi",
  },
  "modelLab.qc.modelStretch.scheduleDaysAgo": {
    en: "{days}d ago",
    it: "{days}g fa",
  },
  "modelLab.qc.modelStretch.lineCalFactor": {
    en: "cal_factor v4",
    it: "cal_factor v4",
  },
  "modelLab.qc.eisImpact.title": {
    en: "EIS signal impact",
    it: "Impatto segnale EIS",
  },
  "modelLab.qc.eisImpact.lead": {
    en: "Do opportunities with a detected EIS score better on price fit and sign hit?",
    it: "Le opportunità con EIS rilevato performano meglio su accuratezza prezzo e hit di segno?",
  },
  "modelLab.qc.eisImpact.body": {
    en: "Simulation opportunities split by EIS ≠ 0 (positive or negative score from clinical feed, or applied shift) vs EIS = 0 or null. Price accuracy = 100 − path RMSE pre-CD; sign hit = correct direction at T−5 vs realized move.",
    it: "Opportunità Simulation divise per EIS ≠ 0 (punteggio positivo o negativo dal feed clinico, o shift applicato) vs EIS = 0 o nullo. Accuratezza prezzo = 100 − RMSE path pre-CD; hit segno = direzione corretta a T−5 vs movimento reale.",
  },
  "modelLab.qc.eisImpact.empty": {
    en: "No scored Simulation opportunities yet — ensure past_pred has chart paths and run clinical feed enrichment (EIS morning refresh or manual enrich).",
    it: "Nessuna opportunità Simulation scored — servono path curva in past_pred e arricchimento feed clinico (refresh EIS mattutino o enrich manuale).",
  },
  "modelLab.qc.eisImpact.loading": {
    en: "Computing EIS cohort comparison from live data…",
    it: "Calcolo confronto coorti EIS dai dati live…",
  },
  "modelLab.qc.eisImpact.loadError": {
    en: "Could not compute EIS cohort — check API and past_pred / clinical feed data.",
    it: "Impossibile calcolare coorti EIS — verifica API e dati past_pred / feed clinico.",
  },
  "modelLab.qc.eisImpact.cohortCounts": {
    en: "{withN} with EIS · {withoutN} without · {total} total",
    it: "{withN} con EIS · {withoutN} senza · {total} totali",
  },
  "modelLab.qc.eisImpact.withEisPrice": {
    en: "With EIS · price",
    it: "Con EIS · prezzo",
  },
  "modelLab.qc.eisImpact.withoutEisPrice": {
    en: "No EIS · price",
    it: "Senza EIS · prezzo",
  },
  "modelLab.qc.eisImpact.withEisSign": {
    en: "With EIS · sign",
    it: "Con EIS · segno",
  },
  "modelLab.qc.eisImpact.withoutEisSign": {
    en: "No EIS · sign",
    it: "Senza EIS · segno",
  },
  "modelLab.qc.eisImpact.chartTitle": {
    en: "EIS cohort weekly trend",
    it: "Andamento settimanale coorti EIS",
  },
  "modelLab.qc.eisImpact.chartCaption": {
    en: "Green = with EIS · price · grey = without EIS · price · blue = with EIS · sign · pink = without EIS · sign · horizontal dashed = 50%. X-axis = Monday of each ISO week.",
    it: "Verde = con EIS · prezzo · grigio = senza EIS · prezzo · blu = con EIS · segno · rosa = senza EIS · segno · tratteggio orizzontale = 50%. Asse X = lunedì di ogni settimana ISO.",
  },
  "modelLab.qc.eisImpact.chartReadHint": {
    en: "Each series has its own color — compare green vs grey for price, blue vs pink for sign, week over week.",
    it: "Ogni serie ha il suo colore — confronta verde vs grigio sul prezzo, blu vs rosa sul segno, settimana per settimana.",
  },
  "modelLab.qc.eisImpact.trendEmpty": {
    en: "Weekly trend starts after the first Monday 10:00 EIS refresh — cards above show the current snapshot.",
    it: "L'andamento settimanale parte dal primo refresh EIS del lunedì alle 10:00 — le card sopra mostrano lo snapshot corrente.",
  },
  "modelLab.qc.eisImpact.scheduleNote": {
    en: "Scheduled refresh (Europe/Rome): EIS feed + this test Mon–Fri 10:00 (one point per week, updated until next Monday). Performance tab data also refreshes at 07:00 / 09:00 on weekdays; Learning Lab polls every 5 min and runs its learning cycle on Sunday after the server refresh.",
    it: "Refresh programmato (Europe/Rome): feed EIS + questo test lun–ven 10:00 (un punto a settimana, aggiornato fino al lunedì successivo). La tab Performance si aggiorna anche alle 07:00 / 09:00 nei giorni feriali; Learning Lab interroga ogni 5 min e il ciclo learning parte la domenica dopo il refresh server.",
  },
  "modelLab.qc.eisImpact.metricPrice": {
    en: "Price accuracy",
    it: "Accuratezza prezzo",
  },
  "modelLab.qc.eisImpact.metricSign": {
    en: "Sign hit",
    it: "Hit segno",
  },
  "modelLab.qc.eisImpact.legendWithEis": {
    en: "EIS ≠ 0",
    it: "EIS ≠ 0",
  },
  "modelLab.qc.eisMagnitude.captionTitle": {
    en: "Caption — EIS score vs market reaction",
    it: "Didascalia — score EIS vs reazione di mercato",
  },
  "modelLab.qc.eisMagnitude.captionBody": {
    en: "Only feed events with a scored EIS (|score| > 0). Linear regression: EIS score (x) vs stock move after publication — T+1 (~24h) and T+5 sessions (~1 trading week). Second chart: how regression slope changes as you approach CD.",
    it: "Solo eventi feed con EIS scored (|score| > 0). Regressione lineare: score EIS (x) vs movimento azionario dopo la pubblicazione — T+1 (~24h) e T+5 sedute (~1 settimana di borsa). Secondo grafico: come cambia la pendenza avvicinandosi al CD.",
  },
  "modelLab.qc.eisMagnitude.scopeNote": {
    en: "Companies without EIS are excluded. Path RMSE at T−60…T−3 is not used here.",
    it: "Società senza EIS escluse. RMSE path a T−60…T−3 non usato qui.",
  },
  "modelLab.qc.eisMagnitude.title": {
    en: "EIS magnitude analysis",
    it: "Analisi magnitudine EIS",
  },
  "modelLab.qc.eisMagnitude.lead": {
    en: "Does a higher EIS score correlate with a positive stock move after the event?",
    it: "Uno score EIS più alto correla con un movimento azionario positivo dopo l'evento?",
  },
  "modelLab.qc.eisMagnitude.counts": {
    en: "{scored} scored events · {withPrice} with T+1 price",
    it: "{scored} eventi scored · {withPrice} con prezzo T+1",
  },
  "modelLab.qc.eisMagnitude.countsWeek": {
    en: "{n} with T+7 price",
    it: "{n} con prezzo T+7",
  },
  "modelLab.qc.eisMagnitude.horizonT1": {
    en: "T+1 (~24h)",
    it: "T+1 (~24h)",
  },
  "modelLab.qc.eisMagnitude.horizonT7": {
    en: "T+7 (~1 week)",
    it: "T+7 (~1 settimana)",
  },
  "modelLab.qc.eisMagnitude.slopeChartTitle": {
    en: "EIS impact vs distance to CD",
    it: "Impatto EIS vs distanza dal CD",
  },
  "modelLab.qc.eisMagnitude.slopeChartBody": {
    en: "Y = regression slope: average pp price move (T+1 or T+7) per +1 EIS point. X = days before CD (→ CD at 0). Shaded band = strongest EIS→price window.",
    it: "Y = pendenza regressione: pp di movimento medio (T+1 o T+7) per +1 punto EIS. X = giorni mancanti al CD (→ CD a 0). Fascia evidenziata = finestra con impatto EIS→prezzo più forte.",
  },
  "modelLab.qc.eisMagnitude.slopeXAxis": {
    en: "days to CD →",
    it: "giorni al CD →",
  },
  "modelLab.qc.eisMagnitude.cdLine": {
    en: "CD",
    it: "CD",
  },
  "modelLab.qc.eisMagnitude.beforeCd": {
    en: "before CD",
    it: "prima del CD",
  },
  "modelLab.qc.eisMagnitude.signSplitChartTitle": {
    en: "Does EIS sign predict price direction? (by days-to-CD window)",
    it: "Il segno EIS predice la direzione del prezzo? (per finestra giorni-al-CD)",
  },
  "modelLab.qc.eisMagnitude.signSplitChartBody": {
    en: "Each cluster = calendar window before Completion Date. Bars = average stock ΔP (pp) after the feed event. Compare green (EIS>0) vs red (EIS<0) — not each bar vs zero.",
    it: "Ogni cluster = finestra calendario prima del CD. Barre = ΔP medio azionario (pp) dopo l'evento feed. Confronta verde (EIS>0) vs rosso (EIS<0) — non ogni barra vs zero.",
  },
  "modelLab.qc.eisMagnitude.signSplitReadRule": {
    en: "Signal works when green (EIS+) is above red (EIS−) — even if both bars are below zero. What counts is the gap (EIS+ − EIS−), not the absolute level.",
    it: "Il segnale funziona quando il verde (EIS+) è sopra il rosso (EIS−) — anche se entrambe le barre sono sotto zero. Conta il divario (EIS+ − EIS−), non il livello assoluto.",
  },
  "modelLab.qc.eisMagnitude.signSplitExpand": {
    en: "Show sign-split chart and table",
    it: "Mostra grafico split segno e tabella",
  },
  "modelLab.qc.eisMagnitude.signSplitCollapse": {
    en: "Hide sign-split chart and table",
    it: "Nascondi grafico split segno e tabella",
  },
  "modelLab.qc.eisMagnitude.signSplitPeakBand": {
    en: "Strongest window (largest EIS+ − EIS− gap)",
    it: "Finestra più forte (gap EIS+ − EIS− maggiore)",
  },
  "modelLab.qc.eisMagnitude.signSplitLiftT1": {
    en: "Split T+1 (EIS+ − EIS−)",
    it: "Split T+1 (EIS+ − EIS−)",
  },
  "modelLab.qc.eisMagnitude.signSplitLiftT7": {
    en: "Split T+7 (EIS+ − EIS−)",
    it: "Split T+7 (EIS+ − EIS−)",
  },
  "modelLab.qc.eisMagnitude.signSplitWorks": {
    en: "aligned",
    it: "allineato",
  },
  "modelLab.qc.eisMagnitude.signSplitInverted": {
    en: "inverted",
    it: "invertito",
  },
  "modelLab.qc.eisMagnitude.signSplitTableWindow": {
    en: "Window",
    it: "Finestra",
  },
  "modelLab.qc.eisMagnitude.signSplitTooltipLift": {
    en: "Split {horizon}: {lift} ({verdict})",
    it: "Split {horizon}: {lift} ({verdict})",
  },
  "modelLab.qc.eisMagnitude.signSplitYAxis": {
    en: "avg ΔP",
    it: "ΔP medio",
  },
  "modelLab.qc.eisMagnitude.negativeEisT1": {
    en: "EIS− · T+1",
    it: "EIS− · T+1",
  },
  "modelLab.qc.eisMagnitude.positiveEisT1": {
    en: "EIS+ · T+1",
    it: "EIS+ · T+1",
  },
  "modelLab.qc.eisMagnitude.negativeEisT7": {
    en: "EIS− · T+7",
    it: "EIS− · T+7",
  },
  "modelLab.qc.eisMagnitude.positiveEisT7": {
    en: "EIS+ · T+7",
    it: "EIS+ · T+7",
  },
  "modelLab.qc.eisMagnitude.negativeAvgMove": {
    en: "EIS negative · avg ΔP T+3",
    it: "EIS negativo · ΔP medio T+3",
  },
  "modelLab.qc.eisMagnitude.positiveAvgMove": {
    en: "EIS positive · avg ΔP T+3",
    it: "EIS positivo · ΔP medio T+3",
  },
  "modelLab.qc.eisMagnitude.negativePositiveRate": {
    en: "EIS negative · % price up",
    it: "EIS negativo · % prezzo su",
  },
  "modelLab.qc.eisMagnitude.positivePositiveRate": {
    en: "EIS positive · % price up",
    it: "EIS positivo · % prezzo su",
  },
  "modelLab.qc.eisMagnitude.posMinusNeg": {
    en: "EIS+ minus EIS− avg: {v}",
    it: "Δ medio EIS+ − EIS−: {v}",
  },
  "modelLab.qc.eisMagnitude.slopeAxis": {
    en: "slope pp/EIS",
    it: "pendenza pp/EIS",
  },
  "modelLab.qc.eisMagnitude.calibrationTitle": {
    en: "EIS → expected price move (calibration curve)",
    it: "EIS → movimento atteso (curva di calibrazione)",
  },
  "modelLab.qc.eisMagnitude.calibrationBody": {
    en: "From cohort OLS on verified feed events: each EIS score maps to an average expected ΔP (pp). Read the slope as pp gained/lost per +1 EIS point.",
    it: "Da OLS sulla coorte eventi feed verificati: ogni score EIS corrisponde a un ΔP medio atteso (pp). La pendenza = pp guadagnati/persi per ogni +1 punto EIS.",
  },
  "modelLab.qc.eisMagnitude.calibrationXAxis": {
    en: "EIS score",
    it: "score EIS",
  },
  "modelLab.qc.eisMagnitude.calibrationYAxis": {
    en: "expected ΔP",
    it: "ΔP atteso",
  },
  "modelLab.qc.eisMagnitude.calibrationLineT1": {
    en: "expected ΔP · T+1",
    it: "ΔP atteso · T+1",
  },
  "modelLab.qc.eisMagnitude.calibrationLineT7": {
    en: "expected ΔP · T+7",
    it: "ΔP atteso · T+7",
  },
  "modelLab.qc.eisMagnitude.calibrationAnchorsT1": {
    en: "reference · T+1",
    it: "riferimento · T+1",
  },
  "modelLab.qc.eisMagnitude.calibrationAnchorsT7": {
    en: "reference · T+7",
    it: "riferimento · T+7",
  },
  "modelLab.qc.eisMagnitude.calibrationTableEis": {
    en: "EIS",
    it: "EIS",
  },
  "modelLab.qc.eisMagnitude.calibrationTableT1": {
    en: "expected ΔP T+1",
    it: "ΔP atteso T+1",
  },
  "modelLab.qc.eisMagnitude.calibrationTableT7": {
    en: "expected ΔP T+7",
    it: "ΔP atteso T+7",
  },
  "modelLab.qc.eisMagnitude.calibrationExample": {
    en: "Example: EIS {eis} → {pp} on average ({horizon}).",
    it: "Esempio: EIS {eis} → {pp} in media ({horizon}).",
  },
  "modelLab.qc.eisMagnitude.calibrationExpand": {
    en: "Show calibration curve and table",
    it: "Mostra curva di calibrazione e tabella",
  },
  "modelLab.qc.eisMagnitude.calibrationCollapse": {
    en: "Hide calibration curve and table",
    it: "Nascondi curva di calibrazione e tabella",
  },
  "modelLab.qc.eisMagnitude.calibrationStrengthStrong": {
    en: "Strong",
    it: "Forte",
  },
  "modelLab.qc.eisMagnitude.calibrationStrengthModerate": {
    en: "Moderate",
    it: "Moderata",
  },
  "modelLab.qc.eisMagnitude.calibrationStrengthWeak": {
    en: "Weak",
    it: "Debole",
  },
  "modelLab.qc.eisMagnitude.calibrationStrengthR2": {
    en: "R² {pct}% variance explained",
    it: "R² {pct}% varianza spiegata",
  },
  "modelLab.qc.eisMagnitude.calibrationObservedCount": {
    en: "{n} observed",
    it: "{n} osservati",
  },
  "modelLab.qc.eisMagnitude.calibrationExpectedT1": {
    en: "expected T+1",
    it: "atteso T+1",
  },
  "modelLab.qc.eisMagnitude.calibrationExpectedT7": {
    en: "expected T+7",
    it: "atteso T+7",
  },
  "modelLab.qc.eisMagnitude.calibrationObservedT1": {
    en: "observed events · T+1",
    it: "eventi osservati · T+1",
  },
  "modelLab.qc.eisMagnitude.calibrationObservedT7": {
    en: "observed events · T+7",
    it: "eventi osservati · T+7",
  },
  "modelLab.qc.eisMagnitude.calibrationScatterHint": {
    en: "Faded dots = actual feed events; line = OLS fit. Tighter cloud around the line = stronger correlation.",
    it: "Punti sfumati = eventi feed reali; linea = fit OLS. Nuvola più stretta attorno alla linea = correlazione più forte.",
  },
  "modelLab.qc.eisMagnitude.scatter1dTitle": {
    en: "EIS → ΔP regression (T+1)",
    it: "Regressione EIS → ΔP (T+1)",
  },
  "modelLab.qc.eisMagnitude.scatter1dBody": {
    en: "Each dot = one feed event. Green/blue line = OLS fit (all windows pooled).",
    it: "Ogni punto = un evento feed. Retta = fit OLS (tutte le finestre).",
  },
  "modelLab.qc.eisMagnitude.scatter7dTitle": {
    en: "EIS → ΔP regression (T+7)",
    it: "Regressione EIS → ΔP (T+7)",
  },
  "modelLab.qc.eisMagnitude.scatter7dBody": {
    en: "~5 trading sessions after publication — slower market digestion.",
    it: "~5 sedute di borsa dopo la pubblicazione — digestione più lenta del mercato.",
  },
  "modelLab.qc.eisMagnitude.regressionMeta": {
    en: "slope {slope} · ρ {r} · n={n}",
    it: "pendenza {slope} · ρ {r} · n={n}",
  },
  "modelLab.qc.eisMagnitude.scatterEmpty": {
    en: "no price data yet — run clinical enrich with Yahoo prices",
    it: "nessun prezzo — esegui arricchimento clinico con prezzi Yahoo",
  },
  "modelLab.qc.eisMagnitude.scatterNeedsApi": {
    en: "regression charts need a live API refresh — reload the page or update the server",
    it: "grafici regressione richiedono refresh API live — ricarica la pagina o aggiorna il server",
  },
  "modelLab.qc.eisMagnitude.scatterLineOnly": {
    en: "OLS line from correlation — event dots load from live API",
    it: "retta OLS da correlazione — punti evento da API live",
  },
  "modelLab.qc.eisMagnitude.chartsStaleHint": {
    en: "Summary stats are from cache; regression charts load from /api/models/eis-magnitude-analysis. If panels stay empty, rebuild the desktop UI and restart the Python API on the server.",
    it: "Le statistiche riassuntive sono in cache; i grafici regressione arrivano da /api/models/eis-magnitude-analysis. Se restano vuoti, ricompila la UI e riavvia l'API Python sul server.",
  },
  "modelLab.qc.eisMagnitude.scatterSynthesizedHint": {
    en: "Scatter shows {shown} summary anchors (median split), not all {total} events with T+1 price — reload after API refresh or rebuild eis_magnitude_analysis.json on the server.",
    it: "Lo scatter mostra {shown} punti riassuntivi (split mediano), non tutti i {total} eventi con prezzo T+1 — ricarica dopo refresh API o rebuild di eis_magnitude_analysis.json sul server.",
  },
  "modelLab.qc.eisMagnitude.t7MissingHint": {
    en: "T+7 prices missing ({withT1}/{scored} events have T+1 only). The clinical snapshot was enriched before T+7 was added — re-run «Enrich portfolio» with Yahoo prices to backfill ~1 week moves.",
    it: "Prezzi T+7 assenti ({withT1}/{scored} eventi hanno solo T+1). Lo snapshot clinico è precedente al campo T+7 — riesegui «Arricchisci portfolio» con prezzi Yahoo per il backfill ~1 settimana.",
  },
  "modelLab.qc.eisMagnitude.dataCoverage": {
    en: "Price coverage",
    it: "Copertura prezzi",
  },
  "modelLab.qc.eisMagnitude.chartsSnapshotHint": {
    en: "Charts from stable snapshot (median split + temporal windows). Full event scatter loads after signal_calibration rebuild or live API refresh.",
    it: "Grafici da snapshot stabile (split mediano + finestre temporali). Scatter completo dopo rebuild signal_calibration o refresh API live.",
  },
  "modelLab.qc.eisMagnitude.weekDataHint": {
    en: "T+7 prices missing in snapshot — re-run «Enrich portfolio» to backfill ~1 week moves.",
    it: "Prezzi T+7 assenti nello snapshot — riesegui «Arricchisci portfolio» per backfill movimenti ~1 settimana.",
  },
  "modelLab.qc.eisMagnitude.lowAvgMove": {
    en: "Low EIS · avg ΔP T+3",
    it: "EIS basso · ΔP medio T+3",
  },
  "modelLab.qc.eisMagnitude.highAvgMove": {
    en: "High EIS · avg ΔP T+3",
    it: "EIS alto · ΔP medio T+3",
  },
  "modelLab.qc.eisMagnitude.lowPositiveRate": {
    en: "Low EIS · % price up",
    it: "EIS basso · % prezzo su",
  },
  "modelLab.qc.eisMagnitude.highPositiveRate": {
    en: "High EIS · % price up",
    it: "EIS alto · % prezzo su",
  },
  "modelLab.qc.eisMagnitude.nWithPrice": {
    en: "n={n} with price",
    it: "n={n} con prezzo",
  },
  "modelLab.qc.eisMagnitude.threshold": {
    en: "median split ≤ {v}",
    it: "split mediano ≤ {v}",
  },
  "modelLab.qc.eisMagnitude.liftPositive": {
    en: "Δ vs low: {v}",
    it: "Δ vs basso: {v}",
  },
  "modelLab.qc.eisMagnitude.correlationTitle": {
    en: "EIS ↔ price correlation",
    it: "Correlazione EIS ↔ prezzo",
  },
  "modelLab.qc.eisMagnitude.correlationBody": {
    en: "Pearson / Spearman between event EIS score and % change T→T+3 (same-day close baseline).",
    it: "Pearson / Spearman tra score EIS evento e variazione % T→T+3 (baseline chiusura stesso giorno).",
  },
  "modelLab.qc.eisMagnitude.overallLift": {
    en: "High − low avg move",
    it: "ΔP medio alto − basso",
  },
  "modelLab.qc.eisMagnitude.horizonT3": {
    en: "T+3 horizon",
    it: "orizzonte T+3",
  },
  "modelLab.qc.eisMagnitude.temporalTitle": {
    en: "Temporal radius before CD",
    it: "Raggio temporale pre-CD",
  },
  "modelLab.qc.eisMagnitude.temporalBody": {
    en: "High vs low EIS avg ΔP T+3 by days-before-CD window — where the signal still separates positive market reaction.",
    it: "ΔP medio T+3 EIS alto vs basso per finestra giorni-pre-CD — dove il segnale separa ancora reazione positiva.",
  },
  "modelLab.qc.eisMagnitude.peakWindow": {
    en: "Strongest window",
    it: "Finestra più forte",
  },
  "modelLab.qc.eisMagnitude.lift": {
    en: "High − low lift",
    it: "Lift alto − basso",
  },
  "modelLab.qc.eisMagnitude.temporalFootnote": {
    en: "Sparse price data in some windows — interpret ρ and lift only when n ≥ 5.",
    it: "Dati prezzo radi in alcune finestre — interpreta ρ e lift solo con n ≥ 5.",
  },
  "modelLab.qc.eisMagnitude.empty": {
    en: "No scored EIS events with verified reference — run clinical feed enrichment first.",
    it: "Nessun evento EIS scored con riferimento verificato — esegui prima l'arricchimento feed clinico.",
  },
  "modelLab.qc.eisMagnitude.loadError": {
    en: "Could not load EIS magnitude analysis from the API — restart the backend or run signal calibration rebuild.",
    it: "Impossibile caricare l'analisi magnitudine EIS dall'API — riavvia il backend o esegui rebuild signal calibration.",
  },
  "modelLab.qc.eisMagnitude.sparsePriceWarning": {
    en: "{n} scored events but no T+3 price yet — KPI-only EIS. Run enrichment with yfinance for market reaction.",
    it: "{n} eventi scored senza prezzo T+3 — EIS solo KPI. Esegui enrich con yfinance per la reazione di mercato.",
  },
  "modelLab.qc.eisImpact.legendWithoutEis": {
    en: "EIS = 0 / null",
    it: "EIS = 0 / nullo",
  },
  "modelLab.qc.eisImpact.deltaSummary": {
    en: "With EIS minus without",
    it: "Con EIS meno senza",
  },
  "modelLab.qc.rascoreImpact.title": {
    en: "RA score · invest / divest calibration",
    it: "RA score · calibrazione invest / divest",
  },
  "modelLab.qc.rascoreImpact.sectionTitle": {
    en: "RA score · price up vs down (24h / 7d)",
    it: "RA score · prezzo su vs giù (24h / 7g)",
  },
  "modelLab.qc.rascoreImpact.sectionLead": {
    en: "Scroll here — not the SDS ROI panel below. By RA band: share of signaled opportunities whose price rose or fell.",
    it: "Sezione qui — non il pannello SDS ROI sotto. Per fascia RA: quota opportunità con segnale il cui prezzo sale o scende.",
  },
  "modelLab.qc.rascoreImpact.lead": {
    en: "Is RA score reliable for invest/divest? Each bubble = % of signaled stocks whose price rose (bubble size = sample n). Empty bands = n/a in your cohort.",
    it: "RA score è affidabile per invest/divest? Ogni bolla = % titoli con segnale il cui prezzo è salito (dimensione = campione n). Fasce vuote = n/a nella tua coorte.",
  },
  "modelLab.qc.rascoreImpact.loading": {
    en: "Loading Simulation signals and price moves…",
    it: "Caricamento segnali Simulation e movimenti prezzo…",
  },
  "modelLab.qc.rascoreImpact.loadError": {
    en: "Could not load chart snapshot — refresh Simulation or export desktop snapshots.",
    it: "Impossibile caricare lo snapshot grafici — refresh Simulation o export snapshot desktop.",
  },
  "modelLab.qc.rascoreImpact.empty": {
    en: "No Simulation rows with a visible RA signal and price change yet.",
    it: "Nessuna riga Simulation con segnale RA visibile e variazione prezzo.",
  },
  "modelLab.qc.rascoreImpact.noSim": {
    en: "Simulation sheet not loaded — open Simulation or refresh data first.",
    it: "Foglio Simulation non caricato — apri Simulation o aggiorna i dati.",
  },
  "modelLab.qc.rascoreImpact.noPriceData": {
    en: "{n} rows with RA signal but missing 24h/7d price — check Var. Giorn. % / chart snapshot.",
    it: "{n} righe con segnale RA ma senza prezzo 24h/7g — verifica Var. Giorn. % / snapshot grafici.",
  },
  "modelLab.qc.rascoreImpact.cohortCounts": {
    en: "{signals} with RA signal · {with24h} with 24h · {with7d} with 7d · {invested} in portfolio",
    it: "{signals} con segnale RA · {with24h} con 24h · {with7d} con 7g · {invested} in portafoglio",
  },
  "modelLab.qc.rascoreImpact.chartTitle": {
    en: "Price-up success by RA band",
    it: "Successo «prezzo su» per fascia RA",
  },
  "modelLab.qc.rascoreImpact.chartCaption": {
    en: "Y = share of signals with stock price up. Toggle 7d (primary) vs 24h (noisy). Green ≥55% · amber 45–55% · red <45%.",
    it: "Y = quota segnali con prezzo azione su. Toggle 7g (primario) vs 24h (rumoroso). Verde ≥55% · ambra 45–55% · rosso <45%.",
  },
  "modelLab.qc.rascoreImpact.yAxis": {
    en: "Price up %",
    it: "% prezzo su",
  },
  "modelLab.qc.rascoreImpact.yAxis7d": {
    en: "% price up · 7d",
    it: "% prezzo su · 7g",
  },
  "modelLab.qc.rascoreImpact.yAxis24h": {
    en: "% price up · 24h",
    it: "% prezzo su · 24h",
  },
  "modelLab.qc.rascoreImpact.window7d": {
    en: "7 days",
    it: "7 giorni",
  },
  "modelLab.qc.rascoreImpact.window24h": {
    en: "24 hours",
    it: "24 ore",
  },
  "modelLab.qc.rascoreImpact.majorityRule": {
    en: "55% invest rule",
    it: "soglia 55% invest",
  },
  "modelLab.qc.rascoreImpact.bubbleLegend7d": {
    en: "Price up (7d) · bubble size = n",
    it: "Prezzo su (7g) · bolla = n",
  },
  "modelLab.qc.rascoreImpact.bubbleLegend24h": {
    en: "Price up (24h) · bubble size = n",
    it: "Prezzo su (24h) · bolla = n",
  },
  "modelLab.qc.rascoreImpact.bubbleSizeHint": {
    en: "Larger bubble = more historical signals in that RA band. Bands without data show n/a on the axis.",
    it: "Bolla più grande = più segnali storici in quella fascia RA. Fasce senza dati mostrano n/a sull'asse.",
  },
  "modelLab.qc.rascoreImpact.tooltipAltWindow": {
    en: "Other window",
    it: "Altra finestra",
  },
  "modelLab.qc.rascoreImpact.winRateSingle": {
    en: "Win rate hidden (only 1 portfolio row — not statistically meaningful)",
    it: "Win rate nascosto (1 sola riga in portafoglio — non significativo)",
  },
  "modelLab.qc.rascoreImpact.answer.title": {
    en: "Reliability check (your cohort)",
    it: "Verifica affidabilità (tua coorte)",
  },
  "modelLab.qc.rascoreImpact.answer.investYes": {
    en: "Invest hint: RA ≥ {score} → {pct} of signaled stocks had price up within 7 days (≥55% majority rule).",
    it: "Hint invest: RA ≥ {score} → {pct} dei titoli con segnale ha avuto prezzo su entro 7 giorni (regola ≥55%).",
  },
  "modelLab.qc.rascoreImpact.answer.investWeak": {
    en: "No band reaches 55% price-up at 7d yet. Best so far: RA {band} at {pct} — RA not fully reliable for invest in this cohort.",
    it: "Nessuna fascia raggiunge 55% prezzo su a 7g. Migliore finora: RA {band} al {pct} — RA non ancora pienamente affidabile per invest in questa coorte.",
  },
  "modelLab.qc.rascoreImpact.answer.investNo": {
    en: "Not enough 7d price data to suggest an invest RA threshold.",
    it: "Dati prezzo 7g insufficienti per suggerire una soglia RA invest.",
  },
  "modelLab.qc.rascoreImpact.answer.timeWindow": {
    en: "Primary window: 7 calendar days after the signal (stock price change). 24h is shown for comparison but is often ~50% noise — do not calibrate invest rules on 24h alone.",
    it: "Finestra primaria: 7 giorni di calendario dopo il segnale (variazione prezzo azione). 24h è solo confronto ma spesso rumore ~50% — non calibrare regole invest solo su 24h.",
  },
  "modelLab.qc.rascoreImpact.answer.cohortRange": {
    en: "Your historical RA signals span {min}–{max} (10-point bands).",
    it: "I tuoi segnali RA storici coprono {min}–{max} (fasce da 10 punti).",
  },
  "modelLab.qc.rascoreImpact.answer.noHighRa": {
    en: "RA ≥ 60: n/a — no signals in your cohort; chart shows empty bands as n/a.",
    it: "RA ≥ 60: n/a — nessun segnale nella coorte; sul grafico le fasce vuote sono n/a.",
  },
  "modelLab.qc.rascoreImpact.investRef": {
    en: "Invest ≥",
    it: "Invest ≥",
  },
  "modelLab.qc.rascoreImpact.series.grow7d": {
    en: "Price up (7d)",
    it: "Prezzo su (7g)",
  },
  "modelLab.qc.rascoreImpact.series.winInvest": {
    en: "Win rate (portfolio)",
    it: "Win rate (portafoglio)",
  },
  "modelLab.qc.rascoreImpact.series.meanPnl": {
    en: "Mean MTM P&L %",
    it: "P&L MTM medio %",
  },
  "modelLab.qc.rascoreImpact.series.grow24h": {
    en: "Rising (24h)",
    it: "In crescita (24h)",
  },
  "modelLab.qc.rascoreImpact.series.decline7d": {
    en: "Falling (7d)",
    it: "In calo (7g)",
  },
  "modelLab.qc.rascoreImpact.series.decline24h": {
    en: "Falling (24h)",
    it: "In calo (24h)",
  },
  "modelLab.qc.rascoreImpact.tile.investMin": {
    en: "Suggested invest ≥",
    it: "Invest suggerito ≥",
  },
  "modelLab.qc.rascoreImpact.tile.investMinHint": {
    en: "Lowest band with ≥55% rising on 7d",
    it: "Fascia più bassa con ≥55% in crescita su 7g",
  },
  "modelLab.qc.rascoreImpact.tile.divestBelow": {
    en: "Review divest ≤",
    it: "Review divest ≤",
  },
  "modelLab.qc.rascoreImpact.tile.divestHint": {
    en: "Upper bound where ≥55% fall on 7d",
    it: "Limite superiore dove ≥55% in calo su 7g",
  },
  "modelLab.qc.rascoreImpact.tile.peakBin": {
    en: "Best growth band (7d)",
    it: "Fascia crescita migliore (7g)",
  },
  "modelLab.qc.rascoreImpact.tile.peakGrow7dSuffix": {
    en: "rising on 7d",
    it: "in crescita su 7g",
  },
  "modelLab.qc.rascoreImpact.caption.intro": {
    en: "Purpose: test if RA score (0–100 composite) predicts stock price gains after invest signals. Success = stock price up, not portfolio € P&L.",
    it: "Scopo: verificare se RA score (composito 0–100) predice rialzi del prezzo azione dopo i segnali invest. Successo = prezzo su, non P&L € portafoglio.",
  },
  "modelLab.qc.rascoreImpact.caption.growWindow": {
    en: "Bubbles: % price up in the selected window (7d primary). Size = number of signals n in that RA band.",
    it: "Bolle: % prezzo su nella finestra scelta (7g primario). Dimensione = numero segnali n in quella fascia RA.",
  },
  "modelLab.qc.rascoreImpact.caption.declineWindow": {
    en: "Empty X labels (n/a) = no signals in your history for that RA range (e.g. RA ≥ 60).",
    it: "Etichette n/a sull'asse X = nessun segnale nel tuo storico per quella fascia (es. RA ≥ 60).",
  },
  "modelLab.qc.rascoreImpact.caption.thresholds": {
    en: "Invest ≥ / Review divest ≤ are empirical hints (7d majority). ρ (Spearman) measures if higher RA → higher success (need ≥3 bands with n≥2).",
    it: "Invest ≥ / Review divest ≤ sono hint empirici (maggioranza 7g). ρ (Spearman) misura se RA più alto → più successo (servono ≥3 fasce con n≥2).",
  },
  "modelLab.qc.rascoreImpact.caption.title": {
    en: "How to read RA score calibration",
    it: "Come leggere la calibrazione RA score",
  },
  "modelLab.qc.rascoreImpact.caption.footnote": {
    en: "RA weights are fixed in code — they do not auto-learn from this chart. Model accuracy loop (v4/v5, recalib) lives in Model Learnings / Evolution. RA weight tuning is not wired yet.",
    it: "I pesi RA sono fissi nel codice — non imparano da questo grafico. Il loop accuratezza modello (v4/v5, recalib) è in Model Learnings / Evolution. Retuning pesi RA non è ancora collegato.",
  },
  "modelLab.qc.rascoreImpact.tile.monotonicity": {
    en: "Monotonicity ρ (7d)",
    it: "Monotonicità ρ (7g)",
  },
  "modelLab.qc.rascoreImpact.tile.monotonicity.strong": {
    en: "Higher RA → more 7d rises",
    it: "RA alto → più rialzi 7g",
  },
  "modelLab.qc.rascoreImpact.tile.monotonicity.weak": {
    en: "Weak / flat calibration",
    it: "Calibrazione debole / piatta",
  },
  "modelLab.qc.rascoreImpact.tile.monotonicity.inverted": {
    en: "Inverted — review weights",
    it: "Invertita — rivedi pesi",
  },
  "modelLab.qc.rascoreImpact.tile.monotonicity.insufficient": {
    en: "Need more bands (n≥2 each)",
    it: "Servono più fasce (n≥2 ciascuna)",
  },
  "modelLab.qc.rascoreImpact.evolution.title": {
    en: "RA calibration trend · ρ over time",
    it: "Trend calibrazione RA · ρ nel tempo",
  },
  "modelLab.qc.rascoreImpact.evolution.caption": {
    en: "Weekly snapshot when you open this panel. ρ = Spearman between RA band and % price-up at 7d. Rising ρ = RA score becoming more reliable.",
    it: "Snapshot settimanale all'apertura di questo pannello. ρ = Spearman tra fascia RA e % prezzo su a 7g. ρ in salita = RA score più affidabile.",
  },
  "modelLab.qc.rascoreImpact.evolution.empty": {
    en: "Open this panel once per week to build ρ history (like Model Evolution).",
    it: "Apri questo pannello almeno una volta a settimana per costruire lo storico ρ (come Model Evolution).",
  },
  "modelLab.qc.rascoreImpact.evolution.seriesRho": {
    en: "Monotonicity ρ (7d)",
    it: "Monotonicità ρ (7g)",
  },
  "modelLab.qc.eisImpact.adjustmentNote": {
    en: "Within EIS cohort, applying the EIS shift: price {price} · sign {sign} vs K-8 baseline.",
    it: "Nella coorte EIS, applicando lo shift EIS: prezzo {price} · segno {sign} vs baseline K-8.",
  },
  "modelLab.qc.eisImpact.evaluatedN": {
    en: "evaluated n={n}",
    it: "valutati n={n}",
  },
  "modelLab.qc.eisImpact.caption.title": {
    en: "Caption — EIS signal impact",
    it: "Didascalia — impatto segnale EIS",
  },
  "modelLab.qc.eisImpact.caption.intro": {
    en: "EIS (Event Impact Score) summarizes pre-CD feed events: price reaction (ΔP 1d/3d), volume, and endpoint KPIs. Not SDS score or stretch cal_factor — it checks whether, when a documented catalyst appears, the model fits price and direction better.",
    it: "EIS (Event Impact Score) sintetizza eventi pre-CD dal feed clinico: reazione prezzo (ΔP 1g/3g), volume e KPI endpoint. Non è il punteggio SDS né il cal_factor stretch — misura se, quando compare un catalizzatore documentato, il modello azzecca meglio prezzo e direzione.",
  },
  "modelLab.qc.eisImpact.caption.compareTitle": {
    en: "What the chart compares:",
    it: "Cosa confronta il grafico:",
  },
  "modelLab.qc.eisImpact.caption.withEis": {
    en: "With EIS — EIS score > 0 or < 0 (clinical feed), or non-zero EIS shift on the curve",
    it: "Con EIS — punteggio EIS > 0 o < 0 (feed clinico), o shift EIS ≠ 0 sulla curva",
  },
  "modelLab.qc.eisImpact.caption.withoutEis": {
    en: "Without EIS — EIS score = 0 or null, no shift applied",
    it: "Senza EIS — punteggio EIS = 0 o nullo, nessuno shift applicato",
  },
  "modelLab.qc.eisImpact.caption.metricsTitle": {
    en: "The two metrics (Y axis, 0–100%):",
    it: "Le due metriche (asse Y, 0–100%):",
  },
  "modelLab.qc.eisImpact.caption.priceMetric": {
    en: "Price accuracy — how well the prediction curve tracks realized pre-CD price (100 − mean path error; ↑ = tighter fit)",
    it: "Accuratezza prezzo — quanto la curva predittiva segue il prezzo reale pre-CD (100 − errore medio sul path; ↑ = migliore aderenza)",
  },
  "modelLab.qc.eisImpact.caption.signMetric": {
    en: "Sign hit — % of cases where T−5 direction matches the realized move (↑ = more often correct; 50% ≈ random)",
    it: "Hit segno — % casi in cui la direzione a T−5 coincide con il movimento reale (↑ = più spesso azzeccato; 50% ≈ random)",
  },
  "modelLab.qc.eisImpact.caption.footnote": {
    en: "Green bars = EIS cohort · grey = without. Higher green bars mean EIS flags opportunities where the model performs better. The footnote shows extra lift when the EIS shift is applied within the EIS cohort.",
    it: "Barre verdi = coorte con EIS · grigie = senza. Se la verde è più alta, il segnale EIS marca opportunità dove il modello performa meglio. La nota in fondo indica il lift aggiuntivo quando si applica lo shift EIS sulla stessa coorte.",
  },
  "modelLab.qc.eisImpact.caption.tableTitle": {
    en: "Chart elements",
    it: "Elementi del grafico",
  },
  "modelLab.qc.eisImpact.caption.colElement": {
    en: "Element",
    it: "Elemento",
  },
  "modelLab.qc.eisImpact.caption.colMeaning": {
    en: "What it means",
    it: "Cosa significa",
  },
  "modelLab.qc.eisImpact.caption.rowWithEis.element": {
    en: "Green bars (EIS detected)",
    it: "Barre verdi (EIS rilevato)",
  },
  "modelLab.qc.eisImpact.caption.rowWithEis.meaning": {
    en: "Price accuracy and sign hit where EIS score is positive or negative (≠ 0), or an EIS shift was applied.",
    it: "Accuratezza prezzo e hit segno dove il punteggio EIS è positivo o negativo (≠ 0), o è stato applicato uno shift EIS.",
  },
  "modelLab.qc.eisImpact.caption.rowWithoutEis.element": {
    en: "Grey bars (no EIS / EIS=0)",
    it: "Barre grigie (no EIS / EIS=0)",
  },
  "modelLab.qc.eisImpact.caption.rowWithoutEis.meaning": {
    en: "Same metrics where EIS score is zero or missing — baseline for comparison.",
    it: "Stesse metriche dove il punteggio EIS è zero o assente — baseline di confronto.",
  },
  "modelLab.qc.eisImpact.caption.rowPrice.element": {
    en: "Price accuracy (left pair)",
    it: "Accuratezza prezzo (coppia sinistra)",
  },
  "modelLab.qc.eisImpact.caption.rowPrice.meaning": {
    en: "100 − mean path RMSE pre-CD; higher = prediction curve closer to realized price.",
    it: "100 − RMSE medio path pre-CD; più alto = curva predittiva più vicina al prezzo reale.",
  },
  "modelLab.qc.eisImpact.caption.rowSign.element": {
    en: "Sign hit (right pair)",
    it: "Hit segno (coppia destra)",
  },
  "modelLab.qc.eisImpact.caption.rowSign.meaning": {
    en: "Share of cases where predicted direction at T−5 matches the realized move; 50% ≈ random.",
    it: "Quota casi in cui la direzione predetta a T−5 coincide col movimento reale; 50% ≈ casuale.",
  },
  "modelLab.qc.kpi.decisionRules.title": {
    en: "Decision cohort hit%",
    it: "Hit% coorte decisionale",
  },
  "modelLab.qc.kpi.decisionRules.hint": {
    en: "Direction hit rate on the investment decision cohort after buy/sell threshold rebuilds (rolling pre-CD validation).",
    it: "Tasso di successo direzionale sulla coorte investimenti dopo rebuild soglie buy/sell (validazione rolling pre-CD).",
  },
  "modelLab.qc.decisionCohort.title": {
    en: "Decision cohort — hit rate over rebuilds",
    it: "Coorte decisionale — hit% nel tempo",
  },
  "modelLab.qc.decisionCohort.lead": {
    en: "How often buy/sell rules call direction correctly on the historical cohort",
    it: "Quanto spesso le regole buy/sell azzeccano la direzione sulla coorte storica",
  },
  "modelLab.qc.decisionCohort.body": {
    en: "Each point is a cohort rebuild: thresholds are tuned on past catalysts, then hit% is scored on the same rolling pre-CD window. 50% = random.",
    it: "Ogni punto è un rebuild della coorte: le soglie si calibrano sui catalyst passati, poi si misura l'hit% sulla stessa finestra rolling pre-CD. 50% = casuale.",
  },
  "modelLab.qc.decisionCohort.explainTitle": {
    en: "What is this?",
    it: "Cos'è?",
  },
  "modelLab.qc.decisionCohort.explainBody": {
    en: "Blue line = historical cohort: after each rebuild, we ask “did buy/sell rules guess up/down correctly?” on closed catalysts (T−7→T+7 style window). Below 50% = worse than a coin flip.",
    it: "Linea blu = coorte storica: dopo ogni rebuild chiediamo «le regole buy/sell hanno indovinato su/giù?» sui catalyst chiusi (finestra tipo T−7→T+7). Sotto 50% = peggio del caso.",
  },
  "modelLab.qc.decisionCohort.explainSim": {
    en: "Orange dashed = Simulation: direction hit % on tickers you added to Simulation (new analyses), from the same monitor snapshots when available.",
    it: "Arancione tratteggiato = Simulation: hit% direzionale sui ticker che hai messo in Simulation (nuove analisi), dagli snapshot monitor quando disponibili.",
  },
  "modelLab.qc.decisionCohort.tileRetro": {
    en: "Historical cohort (rebuilds)",
    it: "Coorte storica (rebuild)",
  },
  "modelLab.qc.decisionCohort.tileSim": {
    en: "Simulation (new data)",
    it: "Simulation (dati nuovi)",
  },
  "modelLab.qc.decisionCohort.simSub": {
    en: "{n} scored · {pending} pending",
    it: "{n} valutati · {pending} in attesa",
  },
  "modelLab.qc.decisionCohort.lineSim": {
    en: "Simulation hit%",
    it: "Hit% Simulation",
  },
  "modelLab.qc.decisionCohort.chartTitle": {
    en: "Hit rate after each rebuild",
    it: "Hit% dopo ogni rebuild",
  },
  "modelLab.qc.decisionCohort.chartCaption": {
    en: "Each dot = one rebuild (#1 oldest → #N latest). Blue = historical rules · Orange dashed = Simulation on the same dates when monitor data exists.",
    it: "Ogni punto = un rebuild (#1 più vecchio → #N recente). Blu = regole storiche · Arancione tratteggiato = Simulation sulle stesse date quando c'è il monitor.",
  },
  "modelLab.qc.decisionCohort.yAxisLabel": {
    en: "Direction hit %",
    it: "Hit% direzione",
  },
  "modelLab.qc.decisionCohort.xAxisLabel": {
    en: "Rebuild # (oldest → newest)",
    it: "Rebuild # (vecchio → recente)",
  },
  "modelLab.qc.decisionCohort.randomLine": {
    en: "Random 50%",
    it: "Casuale 50%",
  },
  "modelLab.qc.decisionCohort.rebuildN": {
    en: "Rebuild #{n}",
    it: "Rebuild #{n}",
  },
  "modelLab.qc.decisionCohort.tooltipDelta": {
    en: "Δ vs prev rebuild: {delta}",
    it: "Δ vs rebuild prec.: {delta}",
  },
  "modelLab.qc.decisionCohort.aboveRandom": {
    en: "Above random — rules add value",
    it: "Sopra il casuale — le regole aggiungono valore",
  },
  "modelLab.qc.decisionCohort.belowRandom": {
    en: "Below random — rules underperform coin flip",
    it: "Sotto il casuale — le regole fanno peggio del caso",
  },
  "modelLab.qc.decisionCohort.legendGood": {
    en: "≥58% strong",
    it: "≥58% forte",
  },
  "modelLab.qc.decisionCohort.legendOk": {
    en: "50–58% ok",
    it: "50–58% ok",
  },
  "modelLab.qc.decisionCohort.legendBad": {
    en: "<50% weak",
    it: "<50% debole",
  },
  "modelLab.qc.decisionCohort.rangeSummary": {
    en: "{start} → {now} ({delta}) · best {best}",
    it: "{start} → {now} ({delta}) · max {best}",
  },
  "modelLab.qc.decisionCohort.lineHit": {
    en: "Cohort hit%",
    it: "Hit% coorte",
  },
  "modelLab.qc.decisionCohort.wasPct": {
    en: "was {pct}",
    it: "era {pct}",
  },
  "modelLab.qc.decisionCohort.nEvents": {
    en: "{n} catalyst events in current cohort",
    it: "{n} eventi catalyst nella coorte attuale",
  },
  "modelLab.qc.kpi.signT5.title": {
    en: "Sign match at T+5",
    it: "Segno ok a T+5",
  },
  "modelLab.qc.kpi.signT5.hint": {
    en: "5 days after CD: predicted % move and actual % move have the same sign?",
    it: "A 5 giorni dalla CD: la % prevista e quella reale vanno nella stessa direzione?",
  },
  "modelLab.qc.kpi.errT5.title": {
    en: "Avg size error (monitor)",
    it: "Errore medio grandezza",
  },
  "modelLab.qc.kpi.errT5.hint": {
    en: "Weekly monitor: mean absolute price gap at T+7 after CD (pp, not direction). See chart below.",
    it: "Monitor settimanale: gap medio prezzo a T+7 dopo CD (pp, non segno). Vedi grafico sotto.",
  },
  "modelLab.qc.modelSizeError.title": {
    en: "Model errors — variation across weeks",
    it: "Errori modello — variazione settimanale",
  },
  "modelLab.qc.modelSizeError.lead": {
    en: "How far off the numeric price forecast is (magnitude, not direction)",
    it: "Quanto dista numericamente la previsione di prezzo (grandezza, non direzione)",
  },
  "modelLab.qc.modelSizeError.body": {
    en: "Weekly monitor snapshot at {horizon} after CD: average gap in percentage points between predicted and realized price level on the M2 cohort.",
    it: "Snapshot monitor settimanale a {horizon} dalla CD: gap medio in punti % tra prezzo previsto e reale sulla coorte M2.",
  },
  "modelLab.qc.modelSizeError.explainTitle": {
    en: "What this measures",
    it: "Cosa misura",
  },
  "modelLab.qc.modelSizeError.explainBody": {
    en: "Not sign hit — if the model says +8% and the stock moves +3%, sign can be right but size error is ~5 pp. Lower line = tighter price fit.",
    it: "Non è il segno — se il modello dice +8% e il titolo fa +3%, il segno può essere giusto ma l'errore di grandezza è ~5 pp. Linea più bassa = prezzo più aderente.",
  },
  "modelLab.qc.modelSizeError.explainUse": {
    en: "Use with the sign curves above: good direction + high MAE = right way, wrong size; both low = strong forecast.",
    it: "Usalo con le curve segno sopra: buon segno + MAE alto = direzione ok, grandezza sbagliata; entrambi bassi = previsione solida.",
  },
  "modelLab.qc.modelSizeError.chartTitle": {
    en: "Mean absolute size error by week",
    it: "Errore medio di grandezza per settimana",
  },
  "modelLab.qc.modelSizeError.chartCaption": {
    en: "Last monitor run of each ISO week. Orange reference ≈ 10 pp — typical noise band.",
    it: "Ultimo run monitor di ogni settimana ISO. Riferimento arancione ≈ 10 pp — banda rumore tipica.",
  },
  "modelLab.qc.modelSizeError.chartFooter": {
    en: "Downward slope = model learning to match price magnitude better week over week.",
    it: "Pendenza verso il basso = il modello avvicina meglio la grandezza del prezzo settimana dopo settimana.",
  },
  "modelLab.qc.modelSizeError.lineMae": {
    en: "MAE size (pp)",
    it: "MAE grandezza (pp)",
  },
  "modelLab.qc.modelSizeError.vsPrevWeek": {
    en: "{delta} vs prior week",
    it: "{delta} vs sett. precedente",
  },
  "modelLab.qc.modelSizeError.needMoreWeeks": {
    en: "Need at least 2 monitor weeks to plot the error curve.",
    it: "Servono almeno 2 settimane di monitor per il grafico errori.",
  },
  "modelLab.qc.modelSizeError.trend.improving": {
    en: "↘ Errors shrinking",
    it: "↘ Errori in calo",
  },
  "modelLab.qc.modelSizeError.trend.worse": {
    en: "↗ Errors rising",
    it: "↗ Errori in salita",
  },
  "modelLab.qc.modelSizeError.trend.stable": {
    en: "≈ Stable",
    it: "≈ Stabile",
  },
  "modelLab.qc.modelSizeError.trend.unknown": {
    en: "Trend pending",
    it: "Trend in attesa",
  },
  "modelLab.qc.kpi.sub.nCases": {
    en: "{n} cases scored",
    it: "{n} casi valutati",
  },
  "modelLab.qc.kpi.sub.simClosedPending": {
    en: "{closed} scored · {pending} waiting",
    it: "{closed} chiuse · {pending} in attesa",
  },
  "modelLab.qc.kpi.sub.signalsClosedPending": {
    en: "{closed} closed · {pending} waiting",
    it: "{closed} chiuse · {pending} in attesa",
  },
  "modelLab.qc.kpi.sub.calFactorDelta": {
    en: "Δ vs last recalib {delta}",
    it: "Δ vs ultimo ricalib {delta}",
  },
  "modelLab.qc.kpi.sub.decisionAt": {
    en: "Updated {date}",
    it: "Aggiornato {date}",
  },
  "modelLab.qc.kpi.sub.thisWeek": {
    en: "monitor snapshot",
    it: "snapshot monitor",
  },
  "modelLab.qc.sdsRoi.title": {
    en: "SDS ROI convergence — Simulation",
    it: "Convergenza ROI SDS — Simulation",
  },
  "modelLab.qc.sdsRoi.lead": {
    en: "Compare SDS-based ROI estimates to realized prices for Simulation companies. New events appear as CD+14d passes and actual ROI is logged in past_pred.",
    it: "Confronta le stime ROI da SDS con i prezzi reali delle company Simulation. Nuovi eventi compaiono quando passa CD+14g e il ROI reale è registrato in past_pred.",
  },
  "modelLab.qc.sdsRoi.emptyData": {
    en: "No data — run SDS refresh and ensure Simulation sheet is loaded.",
    it: "Dati non disponibili — esegui refresh SDS e verifica il foglio Simulation.",
  },
  "modelLab.qc.sdsRoi.pendingSim": {
    en: "Awaiting realized ROI (CD+14d)",
    it: "In attesa ROI reale (CD+14g)",
  },
  "modelLab.qc.sdsRoi.refreshProgress": {
    en: "+{n} Simulation event(s) scored since last refresh",
    it: "+{n} evento/i Simulation scored dall'ultimo refresh",
  },
  "modelLab.qc.sdsRoi.refreshLocalOnly": {
    en: "API offline — reloaded local JSON only. Connect to VPS for new SDS scoring.",
    it: "API offline — ricaricati solo JSON locali. Connetti al VPS per nuovo scoring SDS.",
  },
  "modelLab.qc.sdsRoi.liveToday": {
    en: "Live SDS cohort — ROI estimates today",
    it: "Coorte SDS live — stime ROI oggi",
  },
  "modelLab.qc.sdsRoi.forwardScored": {
    en: "Forward scored — estimate vs actual",
    it: "Forward scored — stima vs reale",
  },
  "modelLab.qc.sdsRoi.forwardEmpty": {
    en: "No matured forward scores yet. Each SDS refresh appends predictions; scoring starts ~14 days after CD when realized ROI is in past_pred.",
    it: "Nessuno score forward maturo. Ogni refresh SDS appende le previsioni; lo scoring parte ~14 giorni dopo la CD quando il ROI realizzato è in past_pred.",
  },
  "modelLab.qc.sdsRoi.caption.title": {
    en: "Caption — what this panel measures",
    it: "Didascalia — cosa misura questo pannello",
  },
  "modelLab.qc.sdsRoi.blendEval.title": {
    en: "Blend evaluation window — Pred vs μ SDS",
    it: "Finestra valutazione blend — Pred vs μ SDS",
  },
  "modelLab.qc.sdsRoi.blendEval.body": {
    en: "Measures whether the SDS μ blend improves ROI estimates vs the raw Prediction+Recalibration curve at T−10/T−5/T+4.",
    it: "Misura se il blend μ SDS migliora le stime ROI rispetto alla curva grezza Prediction+Ricalibrazione a T−10/T−5/T+4.",
  },
  "modelLab.qc.sdsRoi.blendEval.step1": {
    en: "Estimate — at each SDS refresh, log both curves at calendar knots.",
    it: "Stima — ad ogni refresh SDS, registra entrambe le curve ai nodi calendario.",
  },
  "modelLab.qc.sdsRoi.blendEval.step2": {
    en: "Maturity — after CD+14d, realized % vs T−60 is read from past_pred.",
    it: "Maturità — dopo CD+14g, il % reale vs T−60 arriva da past_pred.",
  },
  "modelLab.qc.sdsRoi.blendEval.step3": {
    en: "Score — MAE (pp), direction hit-rate, and % of events where blend beats pred.",
    it: "Score — MAE (pp), hit-rate direzione, e % eventi in cui il blend batte la pred.",
  },
  "modelLab.qc.sdsRoi.blendEval.panelTitle": {
    en: "Blend lift @ {horizon}",
    it: "Lift blend @ {horizon}",
  },
  "modelLab.qc.sdsRoi.blendEval.maePred": {
    en: "MAE Pred+Recal",
    it: "MAE Pred+Recal",
  },
  "modelLab.qc.sdsRoi.blendEval.maeBlend": {
    en: "MAE μ SDS blend",
    it: "MAE μ blend SDS",
  },
  "modelLab.qc.sdsRoi.blendEval.blendWins": {
    en: "Blend wins",
    it: "Vittorie blend",
  },
  "modelLab.qc.sdsRoi.blendEval.pendingEst": {
    en: "Pending estimates",
    it: "Stime in attesa",
  },
  "modelLab.qc.sdsRoi.blendEval.pendingSub": {
    en: "awaiting CD+14d confirm",
    it: "in attesa conferma CD+14g",
  },
  "modelLab.qc.sdsRoi.blendEval.awaitingHistory": {
    en: "Estimates logged — historical confirmation will appear after CD+14d when past_pred has realized ROI.",
    it: "Stime registrate — la conferma storica apparirà dopo CD+14g quando past_pred avrà il ROI realizzato.",
  },
  "modelLab.qc.sdsRoi.blendEval.noEstimates": {
    en: "No dual-curve estimates yet — run SDS refresh (with Simulation cohort tickers in window).",
    it: "Nessuna stima doppia curva — esegui refresh SDS (ticker Simulation in finestra pre-CD).",
  },
  "modelLab.qc.sdsRoi.temporalConvergence.title": {
    en: "Prediction vs realized ROI — cohort convergence",
    it: "Predizione vs ROI reale — convergenza coorte",
  },
  "modelLab.qc.sdsRoi.temporalConvergence.subtitle": {
    en: "Mean ± SD of |estimate − realized ROI| at calendar knots (T−60 … T+10). Lower = closer to history. Builds as CD+14d actuals arrive.",
    it: "Media ± DS di |stima − ROI realizzato| sui nodi calendario (T−60 … T+10). Più basso = più vicino allo storico. Si costruisce man mano che arrivano i realizzati CD+14g.",
  },
  "modelLab.qc.sdsRoi.temporalConvergence.awaiting": {
    en: "No matured realized ROI yet — curves appear after CD+14d when backtest/forecast logs score Simulation events.",
    it: "Nessun ROI realizzato maturo — le curve compaiono dopo CD+14g quando backtest/log forecast valutano gli eventi Simulation.",
  },
  "modelLab.qc.sdsRoi.temporalConvergence.yAxis": {
    en: "Mean |Δ| vs realized (pp)",
    it: "Media |Δ| vs reale (pp)",
  },
  "modelLab.qc.sdsRoi.temporalConvergence.legend.sds": {
    en: "SDS estimate",
    it: "Stima SDS",
  },
  "modelLab.qc.sdsRoi.temporalConvergence.legend.pred": {
    en: "Pred + recalibration",
    it: "Pred + ricalibrazione",
  },
  "modelLab.qc.sdsRoi.temporalConvergence.legend.blend": {
    en: "Pred + recal + blend",
    it: "Pred + recal + blend",
  },
  "modelLab.qc.sdsRoi.caption.body": {
    en: "Tracks Simulation tickers only. At each SDS refresh the model logs a ROI estimate at T−5 (blue bars). After CD+14d the realized price move is compared (green bars). MAE and scatter show how close estimates get to reality — not Learning Lab calibration clusters.",
    it: "Monitora solo i ticker Simulation. A ogni refresh SDS il modello registra una stima ROI a T−5 (barre blu). Dopo CD+14g si confronta il movimento reale del prezzo (barre verdi). MAE e scatter mostrano quanto le stime convergono al reale — non sono i cluster di calibrazione del Learning Lab.",
  },
  "modelLab.qc.sdsRoi.clusterCoverage.title": {
    en: "SDS cluster coverage — Simulation cohort",
    it: "Copertura cluster SDS — coorte Simulation",
  },
  "modelLab.qc.sdsRoi.clusterCoverage.openPanel": {
    en: "Open analysis",
    it: "Apri analisi",
  },
  "modelLab.qc.sdsRoi.clusterCoverage.close": {
    en: "Close",
    it: "Chiudi",
  },
  "modelLab.qc.sdsRoi.clusterCoverage.drawerSubtitle": {
    en: "Sub-index fill rates per cluster A–E. Gaps may weaken ROI estimates.",
    it: "Fill dei sotto-indici per cluster A–E. I buchi possono indebolire le stime ROI.",
  },
  "modelLab.qc.sdsRoi.clusterCoverage.lead": {
    en: "SuperNova clusters A–E (fundamentals, sentiment, price, timing). Click a cluster to see which sub-indices are well populated vs sparse — gaps may weaken ROI estimates.",
    it: "Cluster SuperNova A–E (fondamentali, sentiment, prezzo, timing). Clicca un cluster per vedere quali sotto-indici sono popolati o scarsi — i buchi possono indebolire le stime ROI.",
  },
  "modelLab.qc.sdsRoi.clusterCoverage.cohortGap": {
    en: "{inSnap}/{sim} tickers in SDS snapshot · {missing} missing",
    it: "{inSnap}/{sim} ticker nello snapshot SDS · {missing} assenti",
  },
  "modelLab.qc.sdsRoi.clusterCoverage.fillPct": {
    en: "avg fill {pct}%",
    it: "fill medio {pct}%",
  },
  "modelLab.qc.sdsRoi.clusterCoverage.componentRow": {
    en: "{present}/{total} populated",
    it: "{present}/{total} popolati",
  },
  "modelLab.qc.sdsRoi.clusterCoverage.sparseWarning": {
    en: "Sparse sub-indices (<50% populated): may need more data collection or FMP refresh.",
    it: "Sotto-indici scarsi (<50% popolati): potrebbero servire più raccolta dati o refresh FMP.",
  },
  "modelLab.qc.sdsRoi.clusterCoverage.allOk": {
    en: "All Simulation tickers present in SDS snapshot; sub-indices look well populated.",
    it: "Tutti i ticker Simulation sono nello snapshot SDS; i sotto-indici sembrano ben popolati.",
  },
  "modelLab.qc.sdsRoi.clusterCoverage.noSnapshot": {
    en: "No SDS snapshot — run refresh to analyze cluster coverage.",
    it: "Nessuno snapshot SDS — esegui refresh per analizzare la copertura cluster.",
  },
  "modelLab.qc.sdsRoi.clusterCoverage.missingTickers": {
    en: "Missing from snapshot",
    it: "Assenti dallo snapshot",
  },
  "modelLab.qc.sdsRoi.clusterCoverage.status.present": {
    en: "populated",
    it: "popolato",
  },
  "modelLab.qc.sdsRoi.clusterCoverage.status.missing": {
    en: "missing",
    it: "mancante",
  },
  "modelLab.qc.sdsRoi.clusterCoverage.status.insufficient": {
    en: "insufficient history",
    it: "storico insufficiente",
  },
  "modelLab.qc.sdsRoi.clusterCoverage.status.na": {
    en: "N/A",
    it: "N/D",
  },
  "modelLab.qc.sdsRoi.backtestSample": {
    en: "Historical backtest sample",
    it: "Campione backtest storico",
  },
  "modelLab.qc.sdsRoi.bandChart.title": {
    en: "Expected vs historical ROI gap by SDS band",
    it: "Scarto ROI atteso vs storico per fascia SDS",
  },
  "modelLab.qc.sdsRoi.bandChart.caption": {
    en: "Mean signed error (estimate − actual) at T−5, grouped by SDS score zone. Positive = model overestimates ROI.",
    it: "Errore medio con segno (stima − reale) a T−5, per fascia SDS. Positivo = il modello sovrastima il ROI.",
  },
  "modelLab.qc.sdsRoi.bandChart.meanSigned": {
    en: "Mean Δ",
    it: "Δ medio",
  },
  "modelLab.qc.sdsRoi.bandChart.mae": {
    en: "MAE",
    it: "MAE",
  },
  "modelLab.tab.distribution": {
    en: "Distribution",
    it: "Distribuzione",
  },
  "modelLab.tab.portfolio": {
    en: "Sim portfolio",
    it: "Portafoglio sim",
  },
  "modelLab.tab.sells": {
    en: "Sells",
    it: "Vendite",
  },
  "modelLab.page.title": {
    en: "Model quality",
    it: "Qualità modello",
  },
  "modelLab.subtitle.portfolio": {
    en: "Your portfolio = decision tracking · capital invested/divested · curve slope + reliability vs P&L",
    it: "Tuo portafoglio = tracciamento decisioni · capitale investito/disinvestito · pendenza curva + affidabilità vs P&L",
  },
  "modelLab.subtitle.sells": {
    en: "Sells = exit-error taxonomy (premature / missed) · open-gain impact · recommendation adherence",
    it: "Vendite = tassonomia errori di uscita (precoci / mancate) · impatto sul gain open · adesione alle raccomandazioni",
  },
  "modelLab.subtitle.qc": {
    en: "Quality & control — validation, learnings and pre-CD signal audit",
    it: "Qualità e controllo — validation, learnings e audit segnali pre-CD",
  },
  "modelLab.qc.navLabel": {
    en: "Q&C sections",
    it: "Sezioni Q&C",
  },
  "modelLab.qc.nav.validation": {
    en: "Validation",
    it: "Validation",
  },
  "modelLab.qc.nav.learnings": {
    en: "Model learnings",
    it: "Model learnings",
  },
  "modelLab.qc.nav.preCdSignals": {
    en: "Pre-CD signals",
    it: "Pre-CD signals",
  },
  "modelLab.qc.blend.title": {
    en: "Layer i — empirical precat blend (A/B)",
    it: "Layer i — blend empirico precat (A/B)",
  },
  "modelLab.qc.blend.lead": {
    en: "OFF = raw polynomial (fit_pct / pct_modello_raw) · ON = after cohort blend. Path RMSE vs realized pre-CD.",
    it: "OFF = polinomio grezzo (fit_pct / pct_modello_raw) · ON = dopo blend coorte. RMSE path vs storico pre-CD.",
  },
  "modelLab.qc.blend.loading": {
    en: "Computing blend A/B…",
    it: "Calcolo blend A/B…",
  },
  "modelLab.qc.blend.empty": {
    en: "No evaluable events — run Validation or refresh Simulation JSON.",
    it: "Nessun evento valutabile — esegui Validation o refresh Simulation.",
  },
  "modelLab.qc.blend.runTest": {
    en: "Run Validation test to compute layer-i metrics (empirical precat blend).",
    it: "Esegui il test Validation per calcolare le metriche layer i (blend empirico precat).",
  },
  "modelLab.qc.blend.refresh": {
    en: "Recalculate",
    it: "Ricalcola",
  },
  "modelLab.qc.blend.retry": {
    en: "Retry",
    it: "Riprova",
  },
  "modelLab.qc.blend.rmseOff": {
    en: "RMSE OFF",
    it: "RMSE OFF",
  },
  "modelLab.qc.blend.rmseOn": {
    en: "RMSE ON",
    it: "RMSE ON",
  },
  "modelLab.qc.blend.maeOff": {
    en: "MAE OFF (raw)",
    it: "MAE OFF (grezzo)",
  },
  "modelLab.qc.blend.maeOn": {
    en: "MAE ON (blend)",
    it: "MAE ON (blend)",
  },
  "modelLab.qc.blend.wins": {
    en: "Wins RMSE",
    it: "Vittorie RMSE",
  },
  "modelLab.qc.blend.hitT5": {
    en: "Hit T−5",
    it: "Hit T−5",
  },
  "modelLab.qc.blend.proxyNote": {
    en: "partial proxy on past_pred",
    it: "proxy parziale su past_pred",
  },
  "modelLab.qc.blend.verdictImproved": {
    en: "Blend ON improves average path RMSE on the cohort.",
    it: "Blend ON migliora la RMSE media path sulla coorte.",
  },
  "modelLab.qc.blend.verdictWorse": {
    en: "Blend ON worsens average path RMSE — review λ or emp pick.",
    it: "Blend ON peggiora la RMSE media — rivedi λ o emp pick.",
  },
  "modelLab.qc.blend.verdictNeutral": {
    en: "Neutral average effect on the cohort.",
    it: "Effetto medio neutro sulla coorte.",
  },
  "modelLab.qc.blend.topBetter": {
    en: "Best improvements",
    it: "Migliori miglioramenti",
  },
  "modelLab.qc.blend.topWorse": {
    en: "Largest regressions",
    it: "Peggiori regressioni",
  },
  "modelLab.qc.layer.raw": {
    en: "i) Raw polynomial",
    it: "i) Polinomio grezzo",
  },
  "modelLab.qc.layer.empBlend": {
    en: "i) + Empirical blend",
    it: "i) + Blend empirico",
  },
  "modelLab.qc.layer.base": {
    en: "Stored model (past_pred)",
    it: "Modello salvato (past_pred)",
  },
  "modelLab.qc.layer.seq": {
    en: "ii) Seq / daily recalib",
    it: "ii) Seq / ricalib giornaliera",
  },
  "modelLab.qc.layer.eis": {
    en: "iii) EIS shift",
    it: "iii) Shift EIS",
  },
  "modelLab.qc.layer.daily": {
    en: "Daily open anchor",
    it: "Ancora open giornaliero",
  },
  "modelLab.qc.layer.full": {
    en: "Full stack",
    it: "Stack completo",
  },
  "learningLab.caption.mae.intro": {
    en: "MAE (Mean Absolute Error) = average price error, as a percentage.",
    it: "MAE (Mean Absolute Error) = errore medio sul prezzo, in percentuale.",
  },
  "learningLab.caption.mae.trend": {
    en: "Falling MAE = less error = better model",
    it: "MAE che scende = meno errore = modello migliore",
  },
  "learningLab.caption.dir.intro": {
    en: "Direction accuracy = % of times the predicted up/down sign matches the actual move.",
    it: "Accuratezza direzione = % di volte in cui il segno su/giù della previsione coincide con il reale.",
  },
  "learningLab.caption.dir.trend": {
    en: "Rising direction accuracy = more correct up/down calls",
    it: "Acc. direzione che sale = segno su/giù corretto più spesso",
  },
  "learningLab.caption.dir.axis": {
    en: "Y-axis: % correct · 50% = random (not the error rate).",
    it: "Asse Y: % corrette · 50% = caso (non è la % di errori).",
  },
  "learningLab.caption.coverage.caption1Label": {
    en: "Caption 1 — Blue line:",
    it: "Didascalia 1 — Linea blu:",
  },
  "learningLab.caption.coverage.caption1Body": {
    en: "The blue line shows the model's weekly self-correction. A value of 1.0 means no correction needed. Above 1.0 means the model was slightly underestimating price moves, so it stretches predictions up a little. The line is flat and close to 1.0 — the model is stable.",
    it: "La linea blu mostra l'auto-correzione settimanale del modello. 1.0 = nessuna correzione necessaria. Sopra 1.0 il modello sottostimava leggermente i movimenti, quindi allunga un po' le previsioni. Se la linea è piatta e vicina a 1.0, il modello è stabile.",
  },
  "learningLab.caption.coverage.caption2Label": {
    en: "Caption 2 — Green line:",
    it: "Didascalia 2 — Linea verde:",
  },
  "learningLab.caption.coverage.caption2Body": {
    en: "The green line shows how many trial types have learned their own correction (instead of using the generic one). Each type needs at least 5 past resolved cases to qualify. Currently {active} out of {total} trial types have enough data. The remaining {remaining} will calibrate automatically as more past predictions are resolved.",
    it: "La linea verde indica quanti tipi di trial hanno una correzione propria (invece di quella generica). Ogni tipo serve almeno 5 casi passati risolti. Attualmente {active} su {total} tipi hanno dati sufficienti. I restanti {remaining} si calibreranno automaticamente con nuovi esiti.",
  },
  "learningLab.caption.coverage.caption3Label": {
    en: "Caption 3 — Bottom summary:",
    it: "Didascalia 3 — Sintesi:",
  },
  "learningLab.caption.coverage.caption3Body": {
    en: "If both lines are flat and close to their baseline, the model is stable and well-calibrated. You want the blue line near 1.0 (no big correction needed) and the green line rising over time (more trial types covered). A sudden drop or spike in the blue line would signal the model drifted and needs review.",
    it: "Se entrambe le linee sono piatte e vicine alla baseline, il modello è stabile e ben calibrato. Vuoi la linea blu vicina a 1.0 (poca correzione) e la verde che sale nel tempo (più tipi coperti). Un calo o picco improvviso sulla blu segnala deriva del modello da rivedere.",
  },
  "learningLab.caption.coverage.intro": {
    en: "Not the MAE chart (that one is above). Here you see whether learning is correcting curves and covering more trial types. Two lines, two axes — read each on its own scale, do not compare them to each other.",
    it: "Non è il grafico MAE (quello è sopra). Qui vedi se il learning sta correggendo le curve e coprendo più tipi di trial. Due linee, due assi — leggi ognuna sul suo asse, non confrontarle tra loro.",
  },
  "learningLab.caption.coverage.tableTitle": {
    en: "What each element means",
    it: "Cosa significa ogni elemento",
  },
  "learningLab.caption.coverage.colElement": {
    en: "Element",
    it: "Elemento",
  },
  "learningLab.caption.coverage.colMeaning": {
    en: "What it means",
    it: "Cosa significa",
  },
  "learningLab.caption.coverage.rowCf.element": {
    en: "Purple line — Global CF (left axis)",
    it: "Linea viola — CF globale (asse sinistro)",
  },
  "learningLab.caption.coverage.rowCf.meaning": {
    en: "Every Sunday the model asks: were past forecasts systematically too optimistic or too pessimistic? 1.0 = no correction; below 1.0 compresses all estimates; above 1.0 stretches them (same idea as stretch in the Today tab).",
    it: "Ogni domenica il modello chiede: le previsioni passate erano sistematicamente troppo ottimiste o pessimiste? 1.0 = nessuna correzione; sotto 1.0 comprime le stime; sopra 1.0 le allunga (come lo stretch in tab Today).",
  },
  "learningLab.caption.coverage.rowClusters.element": {
    en: "Green line — Calibrated clusters (right axis)",
    it: "Linea verde — Cluster calibrati (asse destro)",
  },
  "learningLab.caption.coverage.rowClusters.meaning": {
    en: "How many phase × therapeutic area groups (e.g. Phase 3 oncology) have at least 5 past catalysts with a real outcome and get a dedicated calibration. Higher = more trial types covered — not SDS A–E clusters.",
    it: "Quanti gruppi fase × area terapeutica (es. Fase 3 oncologia) hanno almeno 5 catalyst passati con esito reale e una calibrazione dedicata. Più alto = più tipologie coperte — non sono i cluster SDS A–E.",
  },
  "learningLab.caption.coverage.rowOutcomes.element": {
    en: "Total outcomes (tile above)",
    it: "Outcome totali (riquadro sopra)",
  },
  "learningLab.caption.coverage.rowOutcomes.meaning": {
    en: "How many past catalysts with a real price outcome the system has learned from. Not shown as a third line because counts (100+) do not share the CF scale.",
    it: "Quanti catalyst passati con esito reale di prezzo ha imparato il sistema. Non è una terza linea perché i numeri (100+) non stanno sulla stessa scala del CF.",
  },
  "learningLab.caption.coverage.footnote": {
    en: "Left axis ~0.85–1.12 · right axis ~0–10 clusters · dashed line at 1.0 = neutral CF.",
    it: "Asse sinistro ~0.85–1.12 · asse destro ~0–10 cluster · linea tratteggiata a 1.0 = CF neutro.",
  },
  "learningLab.caption.coverage.chartTitle": {
    en: "Is the model learning? — Weekly correction & trial type coverage",
    it: "Il modello sta imparando? — Correzione settimanale e copertura tipi di trial",
  },
  "learningLab.caption.coverage.chartSubtitle": {
    en: "Blue = weekly self-correction (1.0 = neutral) · Green = trial types with own calibration ({active}/{total})",
    it: "Blu = auto-correzione settimanale (1.0 = neutro) · Verde = tipi di trial calibrati ({active}/{total})",
  },
  "learningLab.caption.coverage.lineCf": {
    en: "Global correction (CF)",
    it: "Correzione globale (CF)",
  },
  "learningLab.caption.coverage.lineClusters": {
    en: "Calibrated clusters",
    it: "Cluster calibrati",
  },
  "learningLab.caption.coverage.yCf": {
    en: "Global CF",
    it: "CF globale",
  },
  "learningLab.caption.coverage.yClusters": {
    en: "Cluster count",
    it: "N. cluster",
  },
  "learningLab.caption.coverage.neutralLine": {
    en: "1.0 neutral",
    it: "1.0 neutro",
  },
  "learningLab.caption.overview.title": {
    en: "Caption — Learning Lab overview",
    it: "Didascalia — panoramica Learning Lab",
  },
  "learningLab.caption.overview.intro": {
    en: "Summary of the weekly learning cycle (Sunday refresh). The banner shows whether the loop is active, partial, or stalled. Not SDS score or single-ticker quality — it tracks whether the predictive model is accumulating outcomes and applying corrections overall.",
    it: "Vista sintetica del ciclo di apprendimento settimanale (refresh domenicale). Il banner indica se il loop è attivo, parziale o fermo. Non misura il punteggio SDS né la qualità di un singolo ticker — monitora se il modello predittivo, nel complesso, sta accumulando outcome e applicando correzioni.",
  },
  "learningLab.caption.overview.pipeline": {
    en: "Pipeline tracked:",
    it: "Pipeline analizzata:",
  },
  "learningLab.caption.overview.chartSection": {
    en: "Weekly correction & trial type coverage chart:",
    it: "Grafico correzione settimanale e copertura tipi di trial:",
  },
  "learningLab.caption.overview.chartLeft": {
    en: "Left axis: global CF (~1.0 = neutral) — how much we stretch/compress all curves.",
    it: "Asse sinistro: CF globale (~1.0 = neutro) — quanto stretch/compress applichiamo a tutte le curve.",
  },
  "learningLab.caption.overview.chartRight": {
    en: "Right axis: phase×area clusters with active calibration (≥5 cases) — not SDS clusters.",
    it: "Asse destro: cluster fase×area con calibrazione attiva (≥5 casi) — non cluster SDS.",
  },
  "learningLab.caption.cluster.title": {
    en: "Caption — calibration clusters (Learning)",
    it: "Didascalia — cluster di calibrazione (Learning)",
  },
  "learningLab.caption.cluster.intro": {
    en: "These are not SDS clusters (SuperNova A/B/C/D/E score dimensions). Each cluster groups resolved model outcomes by clinical phase × therapeutic area, from trial metadata in signal audit and past_pred. It calibrates a dedicated cal_factor per cohort (min. 5 cases, 60/40 blend with global).",
    it: "Non sono i cluster SDS (A/B/C/D/E di SuperNova). Ogni cluster raggruppa outcome risolti del modello per fase clinica × area terapeutica, da metadati trial su signal audit e past_pred. Calibra un cal_factor dedicato per cohort omogenee (min. 5 casi, blend 60/40 con il globale).",
  },
  "learningLab.caption.cluster.listTitle": {
    en: "Clusters analyzed (9 + other):",
    it: "Cluster analizzati (9 + other):",
  },
  "learningLab.caption.cluster.collecting": {
    en: " · collecting",
    it: " · in raccolta",
  },
  "learningLab.caption.regime.title": {
    en: "Caption — market regime (Learning)",
    it: "Didascalia — regime di mercato (Learning)",
  },
  "learningLab.caption.regime.intro": {
    en: "Not SDS clusters or phase×area cohorts. Regime is overall market mood at outcome resolution from market_context_gate (e.g. VIX, index trend). Each regime has a multiplier calibrated on its historical outcomes (min. 8 cases). Current regime: {regime}.",
    it: "Non sono cluster SDS né cluster fase×area. Il regime descrive l'umore di mercato al momento dell'outcome, da market_context_gate (es. VIX, trend indici). Ogni regime ha un moltiplicatore calibrato sui propri outcome (min. 8 casi). Regime attuale: {regime}.",
  },
  "learningLab.caption.regime.riskOn": {
    en: " — risk-on; multiplier > 1 often corrects underestimation",
    it: " — mercato risk-on; moltiplicatore > 1 tende a correggere sottostima",
  },
  "learningLab.caption.regime.neutral": {
    en: " — neutral conditions; multiplier ~1.0",
    it: " — condizioni neutre; moltiplicatore ~1.0",
  },
  "learningLab.caption.regime.riskOff": {
    en: " — defensive market; multiplier < 1 often corrects overestimation",
    it: " — mercato difensivo; moltiplicatore < 1 tende a correggere sovrastima",
  },
  "learningLab.caption.regime.charts": {
    en: "Charts show multiplier evolution and MAE impact before/after regime correction.",
    it: "I grafici mostrano l'evoluzione dei moltiplicatori e l'impatto su MAE prima/dopo la correzione regime.",
  },
  "learningLab.caption.effectiveness.title": {
    en: "Caption — learning effectiveness",
    it: "Didascalia — efficacia del learning",
  },
  "learningLab.caption.effectiveness.intro": {
    en: "Weekly comparison of three independent mechanisms acting in sequence on prediction curves. Shows which layer improves MAE and direction accuracy — not portfolio P&L or SDS score.",
    it: "Confronto settimanale di tre meccanismi indipendenti che agiscono in sequenza sulle curve predittive. Mostra quale layer migliora MAE e accuratezza direzione — non è P&L di portafoglio né score SDS.",
  },
  "learningLab.caption.effectiveness.global": {
    en: " — global correction (v4 stretch) on all tickers",
    it: " — correzione globale (stretch v4) su tutti i ticker",
  },
  "learningLab.caption.effectiveness.cluster": {
    en: " — adjustment per phase×area cohort (9+other)",
    it: " — aggiustamento per cohort fase×area (9+other)",
  },
  "learningLab.caption.effectiveness.regime": {
    en: " — multiplier for RISK_ON / NEUTRAL / RISK_OFF",
    it: " — moltiplicatore per RISK_ON / NEUTRAL / RISK_OFF",
  },
  "learningLab.eisSuper.empty": {
    en: "No EIS super-score timeline yet — run a learning cycle after clinical feed enrichment.",
    it: "Timeline EIS super-score non disponibile — esegui un ciclo learning dopo l'enrichment feed clinico.",
  },
  "learningLab.eisSuper.introTitle": {
    en: "EIS Super Score — learned blend",
    it: "EIS Super Score — blend appreso",
  },
  "learningLab.eisSuper.introBody": {
    en: "Super score blends raw EIS×CD-distance with per-window calibration learned from feed outcomes. The chart shows how well the score correlates with forward stock moves (T+1 / T+7) as you approach Completion Date.",
    it: "Il super score combina EIS grezzo×distanza CD con calibrazione per finestra appresa dagli outcome feed. Il grafico mostra quanto lo score correla con i movimenti azionari forward (T+1 / T+7) avvicinandosi al Completion Date.",
  },
  "learningLab.eisSuper.blendNote": {
    en: "Blend: {learned}% learned path · cycle update weight {cycle}%",
    it: "Blend: {learned}% percorso appreso · peso aggiornamento ciclo {cycle}%",
  },
  "learningLab.eisSuper.kpiRaw7d": {
    en: "Mean ρ raw · T+7",
    it: "Media ρ raw · T+7",
  },
  "learningLab.eisSuper.kpiSuper7d": {
    en: "Mean ρ super · T+7",
    it: "Media ρ super · T+7",
  },
  "learningLab.eisSuper.kpiLift": {
    en: "Mean Δρ (super−raw)",
    it: "Media Δρ (super−raw)",
  },
  "learningLab.eisSuper.kpiEvents": {
    en: "Scored events",
    it: "Eventi scored",
  },
  "learningLab.eisSuper.timelineTitle": {
    en: "Correlation vs distance to CD",
    it: "Correlazione vs distanza dal CD",
  },
  "learningLab.eisSuper.timelineSubtitle": {
    en: "X axis: days before CD (→ 0 = readout). Higher ρ = stronger predictive coupling between super score and post-publication price move.",
    it: "Asse X: giorni prima del CD (→ 0 = readout). ρ più alto = accoppiamento predittivo più forte tra super score e movimento post-pubblicazione.",
  },
  "learningLab.eisSuper.xAxis": {
    en: "days before CD →",
    it: "giorni prima del CD →",
  },
  "learningLab.eisSuper.lineRaw7d": {
    en: "Raw · T+7",
    it: "Raw · T+7",
  },
  "learningLab.eisSuper.lineSuper7d": {
    en: "Super · T+7",
    it: "Super · T+7",
  },
  "learningLab.eisSuper.lineRaw1d": {
    en: "Raw · T+1",
    it: "Raw · T+1",
  },
  "learningLab.eisSuper.lineSuper1d": {
    en: "Super · T+1",
    it: "Super · T+1",
  },
  "learningLab.eisSuper.trendTitle": {
    en: "Learning effectiveness over time",
    it: "Efficacia learning nel tempo",
  },
  "learningLab.eisSuper.trendSubtitle": {
    en: "Weekly mean correlation after each applied learning cycle — rising super ρ vs raw = learning is helping.",
    it: "Correlazione media settimanale dopo ogni ciclo applicato — super ρ in crescita vs raw = il learning aiuta.",
  },
  "learningLab.eisSuper.colWindow": {
    en: "Window",
    it: "Finestra",
  },
  "learningLab.polygonAccuracy.empty": {
    en: "No polygon accuracy timeline yet — run a learning cycle after past catalyst data is available.",
    it: "Timeline accuratezza polygon non disponibile — esegui un ciclo learning con dati catalyst storici.",
  },
  "learningLab.polygonAccuracy.title": {
    en: "Recommendation polygon — match vs stock by CD distance",
    it: "Recommendation polygon — match vs stock per distanza CD",
  },
  "learningLab.polygonAccuracy.subtitle": {
    en: "Pearson ρ between polygon Match % (RA/SDS/MII/calib/slope vs window thresholds) and realized stock % vs T−60, per pre-CD arc window. Higher ρ = the radar score aligns with price path as you approach readout.",
    it: "Pearson ρ tra Match % del polygon (RA/SDS/MII/calib/slope vs soglie finestra) e % stock realizzata vs T−60, per finestra pre-CD. ρ più alto = lo score radar si allinea al percorso prezzo avvicinandosi al readout.",
  },
  "learningLab.polygonAccuracy.kpiMeanRho": {
    en: "Mean ρ match↔stock",
    it: "Media ρ match↔stock",
  },
  "learningLab.polygonAccuracy.kpiSamples": {
    en: "Knot samples",
    it: "Campioni ai nodi",
  },
  "learningLab.polygonAccuracy.kpiEvents": {
    en: "Past events",
    it: "Eventi passati",
  },
  "learningLab.polygonAccuracy.xAxis": {
    en: "days before CD →",
    it: "giorni prima del CD →",
  },
  "learningLab.polygonAccuracy.lineCorr": {
    en: "ρ Match % ↔ stock %",
    it: "ρ Match % ↔ stock %",
  },
  "learningLab.polygonAccuracy.trendTitle": {
    en: "Learning trend — mean ρ over weekly cycles",
    it: "Trend learning — media ρ nei cicli settimanali",
  },
  "learningLab.polygonAccuracy.trendSubtitle": {
    en: "Each point is a snapshot after a learning cycle. Rising ρ = polygon match better predicts realized moves.",
    it: "Ogni punto è uno snapshot dopo un ciclo learning. ρ in salita = il match polygon predice meglio i movimenti realizzati.",
  },
  "learningLab.polygonAccuracy.trendLine": {
    en: "Mean ρ",
    it: "Media ρ",
  },
  "learningLab.tab.polygonHistory": {
    en: "Pattern ρ",
    it: "Pattern ρ",
  },
  "learningLab.tab.overview": {
    en: "Overview",
    it: "Panoramica",
  },
  "learningLab.tab.feedback": {
    en: "Validation feedback",
    it: "Feedback validazione",
  },
  "learningLab.tab.signals": {
    en: "Pre-CD signals",
    it: "Segnali Pre-CD",
  },
  "learningLab.tab.curveImpact": {
    en: "Curve recalib",
    it: "Recalib curva",
  },
  "learningLab.effectiveness.title": {
    en: "All learning loops — effectiveness",
    it: "Tutti i loop learning — efficacia",
  },
  "learningLab.effectiveness.subtitle": {
    en: "Lift = layer MAE vs same-week baseline (↓ = helps). Δ MAE / Δ metric = week-over-week. Changes within noise show Neutral.",
    it: "Lift = MAE del layer vs baseline stessa settimana (↓ = aiuta). Δ MAE / Δ metrica = settimanale. Variazioni nel rumore → Neutro.",
  },
  "learningLab.effectiveness.colMechanism": {
    en: "Mechanism",
    it: "Meccanismo",
  },
  "learningLab.effectiveness.colLift": {
    en: "Lift",
    it: "Lift",
  },
  "learningLab.effectiveness.colMae": {
    en: "Δ MAE",
    it: "Δ MAE",
  },
  "learningLab.effectiveness.colDir": {
    en: "Δ metric",
    it: "Δ metrica",
  },
  "learningLab.effectiveness.colVerdict": {
    en: "Verdict",
    it: "Verdetto",
  },
  "learningLab.effectiveness.verdict.improving": {
    en: "Improving",
    it: "In miglioramento",
  },
  "learningLab.effectiveness.verdict.learning": {
    en: "Learning",
    it: "In apprendimento",
  },
  "learningLab.effectiveness.verdict.neutral": {
    en: "Neutral",
    it: "Neutro",
  },
  "learningLab.effectiveness.verdict.not_helping": {
    en: "Not helping",
    it: "Non aiuta",
  },
  "learningLab.effectiveness.verdict.collecting_data": {
    en: "Collecting data",
    it: "Raccolta dati",
  },
  "learningLab.feedback.empty": {
    en: "No saved feedback run yet. Click Run feedback loop to compute MAE and cal_factor proposals from resolved catalysts.",
    it: "Nessun run feedback salvato. Clicca Esegui feedback loop per calcolare MAE e proposte cal_factor dai CD risolti.",
  },
  "learningLab.feedback.previewBadge": {
    en: "Preview — not saved",
    it: "Anteprima — non salvato",
  },
  "learningLab.feedback.previewAt": {
    en: "Computed at {at}. Apply to persist and update cal_factor.",
    it: "Calcolato il {at}. Applica per salvare e aggiornare cal_factor.",
  },
  "learningLab.feedback.noHistoryYet": {
    en: "Trend chart appears after the first Apply (weekly history is stored on disk).",
    it: "Il grafico trend compare dopo il primo Apply (lo storico settimanale viene salvato su disco).",
  },
  "learningLab.feedback.introTitle": {
    en: "Ticker-level cal_factor feedback",
    it: "Feedback cal_factor per ticker",
  },
  "learningLab.feedback.introBody": {
    en: "Persistent MAE and direction accuracy per portfolio ticker; underperformers get cal_factor cuts.",
    it: "MAE persistente e accuratezza direzione per ticker in portafoglio; gli underperformer ricevono tagli al cal_factor.",
  },
  "learningLab.feedback.kpiMae": {
    en: "Portfolio MAE",
    it: "MAE portafoglio",
  },
  "learningLab.feedback.kpiDir": {
    en: "Direction acc.",
    it: "Acc. direzione",
  },
  "learningLab.feedback.kpiUnder": {
    en: "Underperformers",
    it: "Underperformer",
  },
  "learningLab.feedback.kpiTickers": {
    en: "Tickers tracked",
    it: "Ticker tracciati",
  },
  "learningLab.feedback.trendTitle": {
    en: "Feedback loop history",
    it: "Storico loop feedback",
  },
  "learningLab.feedback.trendSubtitle": {
    en: "Portfolio MAE and direction accuracy after each apply.",
    it: "MAE portafoglio e accuratezza direzione dopo ogni apply.",
  },
  "learningLab.feedback.underList": {
    en: "Underperformers",
    it: "Underperformer",
  },
  "learningLab.signals.empty": {
    en: "No closed Pre-CD signal outcomes yet. Click Rebuild to close pending signals (+5 sessions) and refresh calibration.",
    it: "Nessun esito segnale Pre-CD chiuso. Clicca Ricostruisci per chiudere i segnali in attesa (+5 sessioni) e aggiornare la calibrazione.",
  },
  "learningLab.signals.rebuild": {
    en: "Rebuild calibration",
    it: "Ricostruisci calibrazione",
  },
  "learningLab.signals.rebuilding": {
    en: "Rebuilding…",
    it: "Ricostruzione…",
  },
  "learningLab.signals.updatedAt": {
    en: "Updated {at}",
    it: "Aggiornato {at}",
  },
  "learningLab.signals.closedCount": {
    en: "{n} outcomes closed this run",
    it: "{n} esiti chiusi in questo run",
  },
  "learningLab.signals.pendingNote": {
    en: "{log} log rows · {pending} still pending (+5 sessions). Rebuild after more live refreshes.",
    it: "{log} righe log · {pending} ancora in attesa (+5 sessioni). Ricostruisci dopo altri refresh live.",
  },
  "learningLab.signals.kpiPending": {
    en: "Pending",
    it: "In attesa",
  },
  "learningLab.signals.introTitle": {
    en: "Pre-CD signal calibration",
    it: "Calibrazione segnali Pre-CD",
  },
  "learningLab.signals.introBody": {
    en: "Weekly hit rate on actionable signals (affid ≥50, |pred5| ≥2%). Feeds cluster/regime learning outcomes.",
    it: "Hit rate settimanale su segnali actionable (affid ≥50, |pred5| ≥2%). Alimenta gli outcome cluster/regime.",
  },
  "learningLab.signals.kpiHit": {
    en: "Useful hit rate",
    it: "Hit rate useful",
  },
  "learningLab.signals.kpiN": {
    en: "Closed signals",
    it: "Segnali chiusi",
  },
  "learningLab.signals.kpiWeeks": {
    en: "Weekly buckets",
    it: "Settimane",
  },
  "learningLab.signals.trendTitle": {
    en: "Weekly hit rate trend",
    it: "Trend hit rate settimanale",
  },
  "learningLab.signals.trendSubtitle": {
    en: "Actionable signals only. 50% = random direction.",
    it: "Solo segnali actionable. 50% = direzione casuale.",
  },
  "learningLab.signals.trendLine": {
    en: "Hit %",
    it: "Hit %",
  },
  "learningLab.signals.trendNeedMore": {
    en: "Need ≥2 weekly buckets for trend chart.",
    it: "Servono ≥2 settimane per il grafico trend.",
  },
  "learningLab.signals.trendLowSample": {
    en: "{n} week(s) excluded from trend (sample too small).",
    it: "{n} settimana/e esclusa/e dal trend (campione troppo piccolo).",
  },
  "learningLab.signals.lowSampleWarning": {
    en: "Hit rate is based on only {n} closed signal(s) — not statistically meaningful yet.",
    it: "Hit rate basato su solo {n} segnale/i chiuso/i — non ancora statisticamente significativo.",
  },
  "learningLab.curveImpact.empty": {
    en: "No curve impact state yet. Run pre-CD curve impact build after simulation refresh.",
    it: "Nessuno stato curve impact. Esegui build pre-CD dopo refresh simulazione.",
  },
  "learningLab.curveImpact.introTitle": {
    en: "Daily open recalib layer",
    it: "Layer recalib daily open",
  },
  "learningLab.curveImpact.introBody": {
    en: "Cumulative MAE/hit deltas across base → daily recalib → K8 → EIS on historic catalyst curves.",
    it: "Delta cumulativi MAE/hit da base → recalib daily → K8 → EIS sulle curve storiche.",
  },
  "learningLab.curveImpact.kpiEvents": {
    en: "Chart events",
    it: "Eventi chart",
  },
  "learningLab.curveImpact.kpiMaeBase": {
    en: "MAE base",
    it: "MAE base",
  },
  "learningLab.curveImpact.kpiMaeDaily": {
    en: "MAE daily recalib",
    it: "MAE recalib daily",
  },
  "learningLab.curveImpact.kpiHitDaily": {
    en: "Hit daily recalib",
    it: "Hit recalib daily",
  },
  "learningLab.curveImpact.layerTitle": {
    en: "Layer deltas (MAE)",
    it: "Delta per layer (MAE)",
  },
  "learningLab.curveImpact.deltaDaily": {
    en: "Daily vs base",
    it: "Daily vs base",
  },
  "learningLab.curveImpact.deltaK8": {
    en: "K8 vs daily",
    it: "K8 vs daily",
  },
  "learningLab.curveImpact.deltaEis": {
    en: "EIS vs K8",
    it: "EIS vs K8",
  },
  "learningLab.curveImpact.enrichTitle": {
    en: "Clinical enrichment path",
    it: "Percorso arricchimento clinico",
  },
  "learningLab.curveImpact.kpiMaeRaw": {
    en: "MAE raw",
    it: "MAE raw",
  },
  "learningLab.curveImpact.kpiMaeEis": {
    en: "MAE raw+EIS",
    it: "MAE raw+EIS",
  },
  "learningLab.curveImpact.deltaEisEnrich": {
    en: "EIS vs pre-EIS",
    it: "EIS vs pre-EIS",
  },
  "learningLab.caption.history.title": {
    en: "Caption — learning cycle history",
    it: "Didascalia — storico ciclo learning",
  },
  "learningLab.caption.history.intro": {
    en: "Weekly diary written at each learning cycle (typically Sunday after refresh). Each point snapshots MAE, direction accuracy, and global cal_factor at run time. Chart markers flag apply/cluster/regime updates.",
    it: "Diario settimanale a ogni ciclo learning (tipicamente domenica dopo refresh). Ogni punto è uno snapshot di MAE, accuratezza direzione e cal_factor globale. I marker segnalano apply/aggiornamenti cluster o regime.",
  },
  "learningLab.caption.clusterCf.intro": {
    en: "cal_factor = per-cluster multiplier (1.0 = neutral). Each line is a phase × therapeutic area group.",
    it: "cal_factor = moltiplicatore per cluster (1.0 = neutro). Ogni linea è un gruppo fase × area terapeutica.",
  },
  "learningLab.caption.clusterCf.trend": {
    en: "Convergence toward 1.0 = stabilized calibration for that cluster",
    it: "Convergenza verso 1.0 = calibrazione stabilizzata per quel cluster",
  },
  "learningLab.caption.clusterMae.intro": {
    en: "Aggregate MAE across all clusters: before vs after cluster-specific cal_factor.",
    it: "MAE aggregato su tutti i cluster: prima vs dopo l'applicazione del cal_factor cluster-specifico.",
  },
  "modelLab.learnings.overviewTitle": {
    en: "Does the model learn from itself?",
    it: "Il modello impara da solo?",
  },
  "modelLab.learnings.overviewLead": {
    en: "This tab checks whether the prediction engine gets better over time. It compares past forecasts with what the stock actually did, then uses those gaps to adjust curves and signal rules — without you having to change anything manually.",
    it: "Questa tab verifica se il motore predittivo migliora nel tempo. Confronta le previsioni passate con ciò che il titolo ha fatto davvero, poi usa quelle differenze per aggiustare curve e regole dei segnali — senza che tu debba cambiare nulla a mano.",
  },
  "modelLab.learnings.overviewStep1": {
    en: "Each prediction is saved; after about 5 trading days we know if price moved up or down as expected.",
    it: "Ogni previsione viene registrata; dopo circa 5 giorni di borsa sappiamo se il prezzo è andato su o giù come previsto.",
  },
  "modelLab.learnings.overviewStep2": {
    en: "Hits and misses are counted — accuracy, useful-signal hit rate, and curve calibration factors are updated.",
    it: "Si contano successi e fallimenti — si aggiornano precisione, hit rate dei segnali utili e fattori di calibrazione delle curve.",
  },
  "modelLab.learnings.overviewStep3": {
    en: "When enough new results arrive, the model runs an automatic refresh: Simulation curves and ROI reflect the latest correction.",
    it: "Quando arrivano abbastanza nuovi risultati, il modello fa un aggiornamento automatico: curve e ROI in Simulation usano l'ultima correzione.",
  },
  "modelLab.learnings.todayHeading": {
    en: "Today's snapshot",
    it: "Stato ad oggi",
  },
  "modelLab.subtitle.curveEngine": {
    en: "Weekly v4/v5 accuracy · monitor snapshots · curve recalibration impact",
    it: "Accuratezza v4/v5 settimanale · snapshot monitor · impatto ricalibrazione curve",
  },
  "modelLab.subtitle.preCdSignals": {
    en: "Live pre-CD signals · 2-month run-up (default) or ±7 days around CD",
    it: "Segnali pre-CD live · run-up 2 mesi (default) o ±7 giorni attorno al CD",
  },
  "modelLab.subtitle.distribution": {
    en: "% distribution around CD · μ curve fitting · weekly comparison",
    it: "Distribuzione % intorno al CD · fitting curve μ · confronto settimanale",
  },
  "modelLab.subtitle.validation": {
    en: "Historical backtest at T-60…T+7 · T-5 snapshot · per-ticker feedback loop (cal_factor)",
    it: "Backtest storico T-60…T+7 · snapshot T-5 · feedback loop per ticker (cal_factor)",
  },
  "modelLab.validation.overviewTitle": {
    en: "Does the model predict moves around the catalyst?",
    it: "Il modello prevede i movimenti attorno al CD?",
  },
  "modelLab.validation.overviewLead": {
    en: "Replays past Completion Dates: at each node (T-60…T+7) it compares forecast vs actual price — no look-ahead.",
    it: "Ripete i CD passati: a ogni nodo (T-60…T+7) confronta previsione e prezzo reale — senza dati futuri.",
  },
  "modelLab.validation.overviewStep1": {
    en: "MAE chart should be U-shaped (lowest near T-10). For live signals, focus on T-5 and T-3.",
    it: "Il grafico MAE dovrebbe essere a U (minimo verso T-10). Per i segnali live guarda T-5 e T-3.",
  },
  "modelLab.validation.overviewStep2": {
    en: "Dir acc = how often up/down was right. Green = good · red = investigate.",
    it: "Dir acc = quante volte su/giù era giusto. Verde = ok · rosso = da approfondire.",
  },
  "modelLab.validation.overviewStep3": {
    en: "Before changes: run test → Save baseline. After update: re-run and check Δ MAE (negative = better).",
    it: "Prima di cambiare: esegui test → Salva baseline. Dopo l'update: riesegui e controlla Δ MAE (negativo = meglio).",
  },
  "modelLab.validation.overviewStep4": {
    en: "Below T-5 snapshot: Model health turns the same errors into per-ticker cal_factor proposals — preview first, apply only after confirm.",
    it: "Sotto lo snapshot T-5: Model health trasforma gli stessi errori in proposte cal_factor per ticker — anteprima prima, applica solo dopo conferma.",
  },
  "modelLab.validation.glossaryToggle": {
    en: "Metric glossary",
    it: "Glossario metriche",
  },
  "modelLab.validation.metricMae": {
    en: "MAE / Dir — average % error and direction hit rate.",
    it: "MAE / Dir — errore medio % e quota direzione giusta.",
  },
  "modelLab.validation.metricDir": {
    en: "Bias / Coverage — overshoot tendency and % with a valid forecast.",
    it: "Bias / Coverage — tendenza sovrastima e % casi con previsione valida.",
  },
  "modelLab.validation.metricBaseline": {
    en: "Baseline — dashed line on chart = saved run to compare before/after.",
    it: "Baseline — linea tratteggiata = run salvata per confronto prima/dopo.",
  },
  "modelLab.validation.metricLookback": {
    en: "Lookback must match between runs — otherwise baseline compare is unreliable.",
    it: "Lookback uguale tra le run — altrimenti il confronto baseline non è affidabile.",
  },
  "modelLab.validation.metricFeedbackLoop": {
    en: "Model health — persistent MAE/dir/bias per ticker on resolved CDs; proposes cal_factor changes (never auto-applied).",
    it: "Model health — MAE/dir/bias persistenti per ticker sui CD risolti; propone modifiche cal_factor (mai automatiche).",
  },
  "modelLab.validation.metricMaeDirTradeoff": {
    en: "MAE and Dir can move opposite ways: Δ MAE + (red) = larger % error, Δ Dir + (green) = better up/down calls. Real improvement = both MAE down and Dir up together.",
    it: "MAE e Dir possono andare in senso opposto: Δ MAE + (rosso) = errore % più alto, Δ Dir + (verde) = direzione su/giù più spesso giusta. Miglioramento reale = MAE in calo e Dir in salita insieme.",
  },
  "modelLab.validation.compareLegend": {
    en: "Δ MAE T-5 ↓ = less error · Δ Dir T-5 ↑ = better direction · Δ Seq ↓ = seq layer helps more vs polynomial base.",
    it: "Δ MAE T-5 ↓ = meno errore · Δ Dir T-5 ↑ = direzione migliore · Δ Seq ↓ = layer seq aiuta di più vs base polinomiale.",
  },
  "modelLab.validation.tradeoffNotice": {
    en: "Mixed result on this run: direction improved (+{dir} pp) but % error worsened (+{mae}%). Check layer table and align lookback before calling it a win.",
    it: "Esito misto su questa run: direzione migliorata (+{dir} pp) ma errore % peggiorato (+{mae}%). Controlla la tabella layer e allinea il lookback prima di considerarla un successo.",
  },
  "modelLab.validation.resultsTitle": {
    en: "T-5 snapshot",
    it: "Esito T-5",
  },
  "modelLab.validation.resultsHeadlineGood": {
    en: "Solid at T-5 — error {mae}, direction {dir}. OK for signals.",
    it: "Buono a T-5 — errore {mae}, direzione {dir}. OK per i segnali.",
  },
  "modelLab.validation.resultsHeadlineWarn": {
    en: "Mixed at T-5 — error {mae}, direction {dir}. Check chart before trading harder.",
    it: "Misto a T-5 — errore {mae}, direzione {dir}. Controlla il grafico prima di spingere i trade.",
  },
  "modelLab.validation.resultsHeadlineBad": {
    en: "Weak at T-5 — error {mae}, direction only {dir}. Calibrate before trusting entries.",
    it: "Debole a T-5 — errore {mae}, direzione solo {dir}. Calibra prima di fidarti degli ingressi.",
  },
  "modelLab.validation.resultsBulletSampleShort": {
    en: "{tickers} tickers · all CDs · T-5 MAE {mae} · dir {dir} ({n} paths).",
    it: "{tickers} ticker · tutti i CD · MAE T-5 {mae} · dir {dir} ({n} percorsi).",
  },
  "modelLab.validation.resultsBulletSampleShortN": {
    en: "{tickers} tickers · last {cds} CD each · T-5 MAE {mae} · dir {dir} ({n} paths).",
    it: "{tickers} ticker · ultimi {cds} CD · MAE T-5 {mae} · dir {dir} ({n} percorsi).",
  },
  "modelLab.validation.resultsBulletUShapeShort": {
    en: "U-shape off — best node is {node}, not T-10/T-7. Check data or cohort size.",
    it: "U-shape atipica — miglior nodo {node}, non T-10/T-7. Controlla dati o campione.",
  },
  "modelLab.validation.resultsBulletSlope5Short": {
    en: "5-day slope direction works {dir} of the time — often better than raw % alone.",
    it: "Pendenza 5g indovina la direzione {dir} delle volte — spesso meglio della sola %.",
  },
  "modelLab.validation.resultsBulletMockShort": {
    en: "Demo data — run a full evaluation on real past_catalyst for live numbers.",
    it: "Dati demo — esegui valutazione completa su past_catalyst reali.",
  },
  "modelLab.validation.resultsBulletBaselineImprovedShort": {
    en: "Vs baseline: error {maeDelta}%, direction +{dirDelta} pp at T-5.",
    it: "Vs baseline: errore {maeDelta}%, direzione +{dirDelta} pp a T-5.",
  },
  "modelLab.validation.resultsBulletBaselineWorseShort": {
    en: "Vs baseline: error worsened {maeDelta}% at T-5.",
    it: "Vs baseline: errore peggiorato {maeDelta}% a T-5.",
  },
  "modelLab.validation.resultsBulletSampleAll": {
    en: "Sample: {tickers} tickers, all historical CDs in the backtest, {n} price paths checked at T-5.",
    it: "Campione: {tickers} ticker, tutti i CD storici nel backtest, {n} percorsi prezzo verificati a T-5.",
  },
  "modelLab.validation.resultsBulletSampleN": {
    en: "Sample: {tickers} tickers, last {cds} CDs per ticker, {n} paths at T-5.",
    it: "Campione: {tickers} ticker, ultimi {cds} CD per ticker, {n} percorsi a T-5.",
  },
  "modelLab.validation.resultsBulletUShapeOk": {
    en: "U-shape OK: lowest error near {node} (typical). T-10 MAE {t10} vs T-5 {t5} — model is calmest just before the catalyst.",
    it: "U-shape OK: errore minimo verso {node} (normale). MAE T-10 {t10} vs T-5 {t5} — il modello è più preciso poco prima del CD.",
  },
  "modelLab.validation.resultsBulletUShapeOff": {
    en: "U-shape unusual: best node is {node}, not T-10/T-7 — check data quality or cohort size.",
    it: "U-shape atipica: miglior nodo {node}, non T-10/T-7 — controlla qualità dati o dimensione coorte.",
  },
  "modelLab.validation.resultsBulletT5": {
    en: "At 5 days before CD: average miss {mae}, direction right {dir} — this is what buy/sell hints lean on.",
    it: "A 5 giorni dal CD: sbaglio medio {mae}, direzione giusta {dir} — ciò che usano di più i suggerimenti buy/sell.",
  },
  "modelLab.validation.resultsBulletSlope5": {
    en: "5-day slope direction works {dir} of the time — often better than raw % prediction alone.",
    it: "La pendenza 5g indovina la direzione {dir} delle volte — spesso meglio della sola previsione %.",
  },
  "modelLab.validation.resultsBulletMock": {
    en: "Demo data (mock U-shape) — run a full evaluation on real past_catalyst for live numbers.",
    it: "Dati demo (U-shape mock) — esegui valutazione completa su past_catalyst reali per numeri live.",
  },
  "modelLab.validation.resultsBulletBaselineNone": {
    en: "No baseline saved yet — you only see absolute scores, not «better or worse than before».",
    it: "Nessuna baseline salvata — vedi solo punteggi assoluti, non «meglio o peggio di prima».",
  },
  "modelLab.validation.resultsBulletBaselineUnreliable": {
    en: "Baseline compare unreliable (different lookback) — align lookback, re-run, then save baseline again.",
    it: "Confronto baseline inaffidabile (lookback diverso) — allinea lookback, riesegui e salva di nuovo la baseline.",
  },
  "modelLab.validation.resultsBulletBaselineImproved": {
    en: "Vs baseline: clearer win — error {maeDelta}% and direction +{dirDelta} pp at T-5.",
    it: "Vs baseline: miglioramento netto — errore {maeDelta}% e direzione +{dirDelta} pp a T-5.",
  },
  "modelLab.validation.resultsBulletBaselineMixed": {
    en: "Vs baseline: mixed — error Δ {maeDelta}%, direction Δ {dirDelta} pp (one up, one down).",
    it: "Vs baseline: misto — errore Δ {maeDelta}%, direzione Δ {dirDelta} pp (uno su, uno giù).",
  },
  "modelLab.validation.resultsBulletBaselineWorse": {
    en: "Vs baseline: worse on both error and direction — last change did not help.",
    it: "Vs baseline: peggio su errore e direzione — l'ultima modifica non ha aiutato.",
  },
  "modelLab.validation.resultsBulletBaselineUnchanged": {
    en: "Vs baseline: essentially flat — no meaningful change at T-5.",
    it: "Vs baseline: sostanzialmente flat — nessun cambiamento significativo a T-5.",
  },
  "modelLab.validation.lookback": {
    en: "Lookback",
    it: "Lookback",
  },
  "modelLab.validation.run": {
    en: "Run evaluation",
    it: "Esegui valutazione",
  },
  "modelLab.validation.running": {
    en: "Running evaluation…",
    it: "Valutazione in corso…",
  },
  "modelLab.validation.reloadCache": {
    en: "Reload cache",
    it: "Ricarica cache",
  },
  "modelLab.validation.saveBaseline": {
    en: "Save baseline",
    it: "Salva baseline",
  },
  "modelLab.validation.savingBaseline": {
    en: "Saving…",
    it: "Salvataggio…",
  },
  "modelLab.validation.loading": {
    en: "Loading validation…",
    it: "Caricamento valutazione…",
  },
  "modelLab.validation.noBaseline": {
    en: "No baseline yet — run an evaluation, then click «Save baseline» before changing the model.",
    it: "Nessuna baseline — esegui una valutazione e clicca «Salva baseline» prima di modificare il modello.",
  },
  "modelLab.validation.baselineLine": {
    en: "Baseline: {label} · {date}{lookback}",
    it: "Baseline: {label} · {date}{lookback}",
  },
  "modelLab.validation.chartTitle": {
    en: "MAE by node (T-60 → T+7)",
    it: "MAE per nodo (T-60 → T+7)",
  },
  "modelLab.validation.chartHint": {
    en: "Solid = current run · dashed = baseline (if saved).",
    it: "Continua = run corrente · tratteggiata = baseline (se salvata).",
  },
  "modelLab.validation.compareTitle": {
    en: "Compare vs baseline",
    it: "Confronto vs baseline",
  },
  "modelLab.validation.detailsLayers": {
    en: "Layer deltas at T-5 (advanced)",
    it: "Delta layer a T-5 (avanzato)",
  },
  "modelLab.validation.detailsSlopes": {
    en: "Slope signals (advanced)",
    it: "Segnali pendenza (avanzato)",
  },
  "modelLab.validation.detailsUpFilter": {
    en: "UP filter (advanced)",
    it: "Filtro UP (avanzato)",
  },
  "modelLab.validation.detailsWorst": {
    en: "Worst cases (advanced)",
    it: "Peggiori casi (avanzato)",
  },
  "modelLab.slopeHarmonyNote": {
    en: "Model accuracy here measures historical pred vs realized — independent of live Slope errors (|Δ| ≥ 0.8 pp/d).",
    it: "L'affidabilità modello qui è pred vs realizzato su storico — indipendente dagli Errori pendenza live (|Δ| ≥ 0,8 pp/g).",
  },
  "preCd.overviewTitle": {
    en: "What are pre-CD signals?",
    it: "Cosa sono i segnali pre-CD?",
  },
  "preCd.overviewTitleRunup": {
    en: "Pre-CD run-up (2 months before CD)",
    it: "Run-up pre-CD (2 mesi prima del CD)",
  },
  "preCd.overviewTitleNear": {
    en: "At the catalyst (±7 days around CD)",
    it: "A ridosso del catalizzatore (CD ±7 giorni)",
  },
  "preCd.overviewLead": {
    en: "This tab shows live buy/sell hints for tickers approaching their Completion Date (CD). It does not retrain the model — it reads today's Pred5, reliability (Affid) and direction, then tracks whether those calls were right after ~5 trading days.",
    it: "Questa tab mostra suggerimenti live Long/Short sui titoli che si avvicinano al Completion Date (CD). Non riaddestra il modello — legge Pred5, affidabilità (Affid) e direzione di oggi, poi verifica se le chiamate erano corrette dopo ~5 giorni di borsa.",
  },
  "preCd.overviewLeadRunup": {
    en: "Signals while the stock is still 8–60 calendar days before CD — the gradual pre-catalyst run-up. Momentum and curve shape matter more than the event day itself.",
    it: "Segnali quando il titolo è ancora a 8–60 giorni di calendario dal CD — la fase di run-up pre-catalizzatore. Contano momentum e forma della curva più del giorno dell'evento.",
  },
  "preCd.overviewLeadNear": {
    en: "Signals in the hot window around CD: from 7 days before to 7 days after. Highest volatility and sell-the-news risk — separate from the longer pre-CD run-up view.",
    it: "Segnali nella finestra calda attorno al CD: da 7 giorni prima a 7 dopo. Massima volatilità e rischio sell-the-news — separata dalla vista run-up pre-CD più lunga.",
  },
  "preCd.overviewStep1": {
    en: "«Refresh live signals» scans Simulation for tickers with CD ≤90 days and saves Pred5, Affid and direction (Long ▲ / Short ▼) into an audit log.",
    it: "«Refresh live signals» scansiona Simulation per titoli con CD ≤90 giorni e salva Pred5, Affid e direzione (Long ▲ / Short ▼) in un log audit.",
  },
  "preCd.overviewStep1Runup": {
    en: "Use the «2 months pre-CD» view for tickers 8–60 days before CD. Switch to «Near CD ±7» for the week around the catalyst.",
    it: "Usa la vista «2 mesi pre-CD» per titoli a 8–60 giorni dal CD. Passa a «Vicino al CD ±7» per la settimana attorno al catalizzatore.",
  },
  "preCd.overviewStep1Near": {
    en: "This view filters the same live refresh to CD ±7 days only — before and just after the event. Use «2 months pre-CD» for the longer run-up.",
    it: "Questa vista filtra lo stesso refresh live solo su CD ±7 giorni — prima e subito dopo l'evento. Usa «2 mesi pre-CD» per il run-up più lungo.",
  },
  "preCd.scope.runup": {
    en: "2 months pre-CD",
    it: "2 mesi pre-CD",
  },
  "preCd.scope.nearCd": {
    en: "Near CD ±7",
    it: "Vicino al CD ±7",
  },
  "preCd.scope.activeWindow": {
    en: "Window",
    it: "Finestra",
  },
  "preCd.scope.emptyRunup": {
    en: "No tickers in the 8–60 day pre-CD window right now. Try «Near CD ±7» or run Refresh live signals.",
    it: "Nessun titolo nella finestra 8–60 gg pre-CD adesso. Prova «Vicino al CD ±7» o Refresh live signals.",
  },
  "preCd.scope.emptyNear": {
    en: "No tickers within ±7 days of CD right now. Try «2 months pre-CD» or wait for a catalyst to approach.",
    it: "Nessun titolo entro ±7 giorni dal CD adesso. Prova «2 mesi pre-CD» o attendi un catalizzatore più vicino.",
  },
  "preCd.scope.historicNote": {
    en: "Hit% badges and charts below use the full audit history (all windows). The table and snapshot above are filtered to this window.",
    it: "I badge Hit% e i grafici sotto usano lo storico audit completo (tutte le finestre). Tabella e snapshot sopra sono filtrati su questa finestra.",
  },
  "preCd.overviewStep2": {
    en: "Only confident moves count as actionable: Useful (Affid ≥50, |Pred5| ≥2%) or Strong (|Pred5| ≥3%) — green and blue dots in the table below.",
    it: "Solo i movimenti più convincenti sono actionable: Useful (Affid ≥50, |Pred5| ≥2%) o Strong (|Pred5| ≥3%) — puntini verde e blu nella tabella sotto.",
  },
  "preCd.overviewStep3": {
    en: "After ~5 sessions «Rebuild calibration» closes each outcome (Hit ✓/✗) and fills hit%, weekly chart and scatter — so you see how often these live signals work.",
    it: "Dopo ~5 sessioni «Rebuild calibration» chiude ogni outcome (Hit ✓/✗) e popola hit%, grafico settimanale e scatter — così vedi quanto spesso funzionano questi segnali live.",
  },
  "preCd.curveImpact.title": {
    en: "Curve quality — model vs real path (cumulative)",
    it: "Qualità curva — traiettoria modello vs reale (cumulativa)",
  },
  "preCd.curveImpact.histTitle": {
    en: "Historical recalib — cumulative path RMSE",
    it: "Ricalib dati storici — RMSE traiettoria cumulativa",
  },
  "preCd.curveImpact.histSubtitle": {
    en: "Simulation tab pipeline — historic recalib (daily + 8-K). Updates as new seq_curve rows appear.",
    it: "Pipeline tab Simulation — ricalib storica (chiusure + 8-K). Si aggiorna man mano che compaiono nuove seq_curve.",
  },
  "preCd.curveImpact.histClarifierTitle": {
    en: "Blue & teal = historic data only (NOT EIS)",
    it: "Blu e verde acqua = solo dati storici (NON EIS)",
  },
  "preCd.curveImpact.histClarifierBody": {
    en: "Grey: polynomial with no market data. Blue: raw model re-anchored to daily closes (seq_curve). Teal: same path + 8-K filing knots. Purple EIS appears only in the bottom chart.",
    it: "Grigio: polinomio senza dati di mercato. Blu: modello grezzo riancorato alle chiusure giornaliere (seq_curve). Verde acqua: stessa traiettoria + nodi filing 8-K. EIS viola solo nel grafico sotto.",
  },
  "preCd.curveImpact.histSampleLabel": {
    en: "Historic samples H#",
    it: "Campioni storici H#",
  },
  "preCd.curveImpact.histPoolNote": {
    en: "of {total} total catalyst events",
    it: "su {total} eventi catalyst totali",
  },
  "preCd.curveImpact.histLegendTitle": {
    en: "Legend — historical recalib",
    it: "Legenda — ricalib storica",
  },
  "preCd.curveImpact.histLegendMae": {
    en: "Path RMSE vs realized market closes — lower = curve closer to what actually happened. Grey = raw model; blue/teal = historic recalib only.",
    it: "RMSE traiettoria vs close di mercato realizzate — più basso = curva più vicina al reale. Grigio = modello grezzo; blu/verde = solo ricalib storica.",
  },
  "preCd.curveImpact.histLegendHit": {
    en: "Directional hit rate on the same historic sample set (H#).",
    it: "Hit rate direzionale sullo stesso campione storico (H#).",
  },
  "preCd.curveImpact.histLegendLineBase": {
    en: "Grey — raw polynomial (pct_modello_raw)",
    it: "Grigio — polinomio grezzo (pct_modello_raw)",
  },
  "preCd.curveImpact.histLegendLineDaily": {
    en: "Blue — historic: daily close recalib (NOT EIS)",
    it: "Blu — storico: ricalib chiusura giornaliera (NON EIS)",
  },
  "preCd.curveImpact.histLegendLineK8": {
    en: "Teal — historic: + 8-K filing knots (NOT EIS)",
    it: "Verde acqua — storico: + nodi filing 8-K (NON EIS)",
  },
  "preCd.curveImpact.histLegendLineRealized": {
    en: "Orange dashed — realized path (control, RMSE=0)",
    it: "Arancio tratteggiato — traiettoria realizzata (controllo, RMSE=0)",
  },
  "preCd.curveImpact.histLineBase": {
    en: "Raw model",
    it: "Modello grezzo",
  },
  "preCd.curveImpact.histLineDaily": {
    en: "Historic · daily close",
    it: "Storico · chiusura",
  },
  "preCd.curveImpact.histLineK8": {
    en: "Historic · 8-K",
    it: "Storico · 8-K",
  },
  "preCd.curveImpact.histCardBaseHint": {
    en: "No market recalib",
    it: "Senza ricalib mercato",
  },
  "preCd.curveImpact.histCardDailyHint": {
    en: "Historic closes only",
    it: "Solo chiusure storiche",
  },
  "preCd.curveImpact.histCardK8Hint": {
    en: "Historic + 8-K knots",
    it: "Storico + nodi 8-K",
  },
  "preCd.curveImpact.histCardRealizedHint": {
    en: "What actually happened",
    it: "Ciò che è accaduto",
  },
  "preCd.curveImpact.lineRealized": {
    en: "Realized (control)",
    it: "Realizzato (controllo)",
  },
  "preCd.curveImpact.histFooter": {
    en: "Simulation tab cohort only (seq_curve / co:TICKER|CD chart keys). Cumulative H# grows after each Simulation refresh + Rebuild calibration when new catalyst rows get pipeline curves.",
    it: "Solo cohort tab Simulation (seq_curve / chiavi co:TICKER|CD). H# cumulativo cresce dopo ogni refresh Simulation + Rebuild calibration quando nuovi catalizzatori ottengono curve pipeline.",
  },
  "preCd.curveImpact.newSinceRebuild": {
    en: "new this rebuild",
    it: "nuovi questo rebuild",
  },
  "preCd.curveImpact.eisTitle": {
    en: "EIS Catalyst Feed — cumulative impact",
    it: "EIS Catalyst Feed — impatto cumulativo",
  },
  "preCd.curveImpact.eisSubtitle": {
    en: "Only events with Simulation seq_curve/8-K path AND eis_poly_applied (Catalyst Feed ran for this catalyst)",
    it: "Solo eventi con traiettoria Simulation (seq_curve/8-K) E eis_poly_applied (EIS Catalyst Feed su quel catalizzatore)",
  },
  "preCd.curveImpact.eisSampleLabel": {
    en: "EIS samples E#",
    it: "Campioni EIS E#",
  },
  "preCd.curveImpact.eisDeltaLabel": {
    en: "Δ EIS vs pre-EIS",
    it: "Δ EIS vs pre-EIS",
  },
  "preCd.curveImpact.eisLegendTitle": {
    en: "Legend — EIS enrichment",
    it: "Legenda — enrichment EIS",
  },
  "preCd.curveImpact.eisLegendMae": {
    en: "Three layers on EIS cohort (E#): grey = raw model without 8-K; teal = + historic 8-K/daily recalib; purple = EIS shift applied to raw model only. Lower RMSE = better.",
    it: "Tre livelli sul cohort EIS (E#): grigio = modello raw senza 8-K; verde = + 8-K/chiusure storiche; viola = shift EIS sul modello raw. RMSE più basso = meglio.",
  },
  "preCd.curveImpact.eisRmseHint": {
    en: "Purple measures EIS on the raw polynomial — not stacked on top of 8-K recalib.",
    it: "Viola misura EIS sul polinomio raw — non sommato alla ricalib 8-K.",
  },
  "preCd.curveImpact.eisWorseHint": {
    en: "worse fit",
    it: "peggior aderenza",
  },
  "preCd.curveImpact.eisLegendHit": {
    en: "Directional hit rate before vs after EIS on enriched samples (E#).",
    it: "Hit rate direzionale prima vs dopo EIS sui campioni arricchiti (E#).",
  },
  "preCd.curveImpact.eisLegendLineRaw": {
    en: "Grey — raw model (polynomial, no 8-K)",
    it: "Grigio — modello raw (polinomio, senza 8-K)",
  },
  "preCd.curveImpact.eisLegendLineK8Hist": {
    en: "Teal — + historic 8-K / daily recalib",
    it: "Verde — + 8-K / chiusure storiche",
  },
  "preCd.curveImpact.eisLegendLineRawEis": {
    en: "Purple — raw model + EIS shift (Catalyst Feed)",
    it: "Viola — modello raw + shift EIS (Catalyst Feed)",
  },
  "preCd.curveImpact.eisLineRaw": {
    en: "Raw (no 8-K)",
    it: "Raw (no 8-K)",
  },
  "preCd.curveImpact.eisLineK8Hist": {
    en: "+ 8-K historic",
    it: "+ 8-K storico",
  },
  "preCd.curveImpact.eisLineRawEis": {
    en: "Raw + EIS",
    it: "Raw + EIS",
  },
  "preCd.curveImpact.eisDeltaRawLabel": {
    en: "Δ EIS vs raw",
    it: "Δ EIS vs raw",
  },
  "preCd.curveImpact.eisSmallSample": {
    en: "Only {n} catalyst events have both Simulation path and EIS metadata — chart grows as enrich backfill completes.",
    it: "Solo {n} eventi catalyst hanno sia traiettoria Simulation sia metadati EIS — il grafico cresce col backfill enrich.",
  },
  "preCd.curveImpact.eisFooter": {
    en: "Simulation tab + EIS only. E# grows when new enriched catalyst rows enter the pipeline. Same refresh cycle as above.",
    it: "Solo tab Simulation + EIS. E# cresce quando nuovi catalizzatori arricchiti entrano in pipeline. Stesso ciclo refresh di sopra.",
  },
  "preCd.curveImpact.subtitle": {
    en: "RMSE between Simulation curve trajectories and realized % path (T−60…T−3 vs T−60 anchor)",
    it: "RMSE tra traiettorie curve Simulation e percorso % realizzato (T−60…T−3 vs ancora T−60)",
  },
  "preCd.curveImpact.modeMae": {
    en: "Path RMSE (%)",
    it: "RMSE traiettoria (%)",
  },
  "preCd.curveImpact.modeHit": {
    en: "Hit (%)",
    it: "Hit (%)",
  },
  "preCd.curveImpact.metricHelp.open": {
    en: "How to read?",
    it: "Come si legge?",
  },
  "preCd.curveImpact.metricHelp.openTitle": {
    en: "Explain Path RMSE vs Hit rate",
    it: "Spiega Path RMSE vs Hit rate",
  },
  "preCd.curveImpact.metricHelp.title": {
    en: "Two ways to read the cumulative curves",
    it: "Due modi di leggere le curve cumulative",
  },
  "preCd.curveImpact.metricHelp.rmseTitle": {
    en: "Path RMSE (%) — trajectory error",
    it: "Path RMSE (%) — errore di traiettoria",
  },
  "preCd.curveImpact.metricHelp.rmseBody": {
    en: "Measures how far the model curve is from what actually happened (realized closes at nodes −60, −30, −10, −7, −5, −3 vs T−60). It is a gap in percentage points along the whole pre-CD path, not a single T−5 point.",
    it: "Misura quanto la curva del modello dista da ciò che è realmente accaduto (close realizzate ai nodi −60, −30, −10, −7, −5, −3 vs T−60). È uno scarto in punti percentuali sull'intera traiettoria pre-CD, non un solo punto T−5.",
  },
  "preCd.curveImpact.metricHelp.rmseHow": {
    en: "Lower = better (curve closer to reality). If teal drops below grey, historic 8-K/daily recalib helped. If purple rises above grey on the EIS chart, EIS moved the raw model away from realized prices.",
    it: "Più basso = meglio (curva più vicina al reale). Se il verde scende sotto il grigio, 8-K/chiusure storiche hanno aiutato. Se il viola sale sopra il grigio nel grafico EIS, lo shift EIS ha allontanato il raw dai prezzi realizzati.",
  },
  "preCd.curveImpact.metricHelp.hitTitle": {
    en: "Hit (%) — directional accuracy at T−5",
    it: "Hit (%) — accuratezza direzionale a T−5",
  },
  "preCd.curveImpact.metricHelp.hitBody": {
    en: "Share of events where predicted direction (up / down / flat band ±0.5 pp) matched the realized move at T−5. This is a success rate from 0% to 100%, not an error in points.",
    it: "Quota di eventi in cui la direzione prevista (su / giù / banda piatta ±0,5 pp) coincide con il movimento realizzato a T−5. È un tasso di successo da 0% a 100%, non un errore in punti.",
  },
  "preCd.curveImpact.metricHelp.hitHow": {
    en: "Higher = better. Useful when RMSE looks similar between lines but you care whether the model called the right side of the trade at catalyst time.",
    it: "Più alto = meglio. Utile quando l'RMSE sembra simile tra le linee ma ti interessa se il modello ha indovinato il verso del trade al catalizzatore.",
  },
  "preCd.curveImpact.metricHelp.activeMode": {
    en: "Active view: {mode}. Switch tabs to compare the same cohort under both metrics.",
    it: "Vista attiva: {mode}. Cambia tab per confrontare lo stesso cohort con entrambe le metriche.",
  },
  "preCd.curveImpact.yAxisMae": {
    en: "Path RMSE (%)",
    it: "RMSE traiettoria (%)",
  },
  "preCd.curveImpact.yAxisHit": {
    en: "Hit rate (%)",
    it: "Hit rate (%)",
  },
  "preCd.curveImpact.legendTitle": {
    en: "Legend",
    it: "Legenda",
  },
  "preCd.curveImpact.legendMae": {
    en: "Path RMSE (%): root-mean-square gap between model % path and realized closes at calendar nodes −60, −30, −10, −7, −5, −3 (all vs T−60). Lower = model curve closer to reality.",
    it: "RMSE traiettoria (%): scarto quadratico medio tra percorso % del modello e close reali ai nodi −60, −30, −10, −7, −5, −3 (vs T−60). Più basso = curva modello più vicina al reale.",
  },
  "preCd.curveImpact.legendHit": {
    en: "Hit (%): share of events where predicted direction (up / down / flat) matched the realized move. Higher is better — a rate from 0% to 100%, not an error in pp.",
    it: "Hit (%): quota di eventi in cui la direzione prevista (su / giù / stabile) coincide con il movimento realizzato. Più alto = meglio — tasso da 0% a 100%, non un errore in punti percentuali.",
  },
  "preCd.curveImpact.legendLineBase": {
    en: "Grey — raw polynomial model (pct_modello_raw, pre-EIS / pre-recalib)",
    it: "Grigio — modello polinomiale grezzo (pct_modello_raw, pre-EIS / pre-ricalib)",
  },
  "preCd.curveImpact.legendLineDaily": {
    en: "Blue — daily close recalib (seq_curve / knot snapshots at calendar nodes)",
    it: "Blu — ricalib chiusura giornaliera (seq_curve / snapshot nodi calendar)",
  },
  "preCd.curveImpact.legendLineK8": {
    en: "Teal — + 8-K historical recalib (pct_foglio / chart bundle knots)",
    it: "Teal — + ricalib storica 8-K (pct_foglio / nodi bundle chart)",
  },
  "preCd.curveImpact.legendLineEis": {
    en: "Purple — 8-K path + EIS shift (Catalyst Feed KPI)",
    it: "Viola — traiettoria 8-K + shift EIS (KPI Catalyst Feed)",
  },
  "preCd.curveImpact.legendLineRecalib": {
    en: "Blue — daily close recalib (seq_curve / knot snapshots at calendar nodes)",
    it: "Blu — ricalib chiusura giornaliera (seq_curve / snapshot nodi calendar)",
  },
  "preCd.curveImpact.lineBase": {
    en: "Model (raw)",
    it: "Modello (grezzo)",
  },
  "preCd.curveImpact.lineDaily": {
    en: "Daily close",
    it: "Chiusura giornaliera",
  },
  "preCd.curveImpact.lineK8": {
    en: "+ 8-K",
    it: "+ 8-K",
  },
  "preCd.curveImpact.lineRecalib": {
    en: "Daily close",
    it: "Chiusura giornaliera",
  },
  "preCd.curveImpact.lineEis": {
    en: "+ EIS",
    it: "+ EIS",
  },
  "preCd.curveImpact.footer": {
    en: "Paths from Simulation sparklines: grey = raw model; blue = seq_curve daily anchoring; teal = +8-K knots; purple = +EIS. Cumulative chart grows with each historic event; enrichment sub-chart tracks Catalyst Feed backfill only. Rebuild calibration refreshes.",
    it: "Percorsi dalle sparkline Simulation: grigio = modello grezzo; blu = ancoraggio seq_curve a chiusura; teal = + nodi 8-K; viola = + EIS. Il grafico cumulativo cresce con ogni evento storico; il sotto-grafico enrichment segue solo il backfill Catalyst Feed. Rebuild calibration aggiorna.",
  },
  "preCd.curveImpact.deltaEisK8": {
    en: "Δ vs 8-K",
    it: "Δ vs 8-K",
  },
  "preCd.curveImpact.enrichmentTitle": {
    en: "EIS Catalyst Feed — cumulative impact",
    it: "EIS Catalyst Feed — impatto cumulativo",
  },
  "preCd.curveImpact.enrichmentSubtitle": {
    en: "Only Catalyst Feed enriched events — pre-EIS vs post-EIS path RMSE.",
    it: "Solo eventi Catalyst Feed arricchiti — RMSE traiettoria pre-EIS vs post-EIS.",
  },
  "preCd.curveImpact.deltaEis": {
    en: "Δ vs model",
    it: "Δ vs modello",
  },
  "preCd.curveImpact.deltaCal": {
    en: "Δ vs recalib",
    it: "Δ vs ricalib",
  },
  "preCd.curveImpact.noEisNote": {
    en: "Few rows with non-zero EIS shift in {nEvents} enriched samples — Catalyst Feed covers {nFeed} studies. Post-EIS line overlaps pre-EIS until backfill completes.",
    it: "Poche righe con shift EIS ≠ 0 su {nEvents} campioni arricchiti — Catalyst Feed copre {nFeed} studi. Post-EIS sovrapposto a pre-EIS finché il backfill non completa.",
  },
  "preCd.curveImpact.tryHitMode": {
    en: "Path RMSE drops after daily close recalib (blue). Switch to Hit (%) for directional accuracy at T−5.",
    it: "RMSE cala dopo ricalib a chiusura (blu). Passa a Hit (%) per la direzione a T−5.",
  },
  "preCd.curveImpact.empty": {
    en: "No historical pre-CD curve pairs yet — run a full refresh with past_catalyst_predictions, then Rebuild calibration.",
    it: "Nessuna coppia curva pre-CD storica — esegui un refresh completo con past_catalyst_predictions, poi Rebuild calibration.",
  },
  "preCd.legend.open": {
    en: "Guide",
    it: "Legenda",
  },
  "preCd.legend.openTitle": {
    en: "How to read the Pre-CD signals tab",
    it: "Come leggere la tab Pre-CD signals",
  },
  "preCd.legend.title": {
    en: "Pre-CD signals — guide",
    it: "Pre-CD signals — legenda",
  },
  "preCd.legend.subtitle": {
    en: "Live actionable signals, calibration KPIs and audit workflow.",
    it: "Segnali actionable live, KPI di calibrazione e flusso audit.",
  },
  "preCd.legend.close": {
    en: "Close",
    it: "Chiudi",
  },
  "preCd.legend.overviewTitle": {
    en: "What this tab shows",
    it: "Cosa mostra questa tab",
  },
  "preCd.legend.overviewBody": {
    en: "Pre-completion-date signals from the live refresh: predicted 5-session move (Pred5), model reliability (Affid), direction (Long/Short). The audit log stores each emission; after ~5 trading sessions the actual move is scored (Hit).",
    it: "Segnali pre-Completion Date dal refresh live: movimento previsto a 5 sessioni (Pred5), affidabilità modello (Affid), direzione (Long/Short). Il log audit registra ogni emissione; dopo ~5 sessioni di borsa il movimento reale viene valutato (Hit).",
  },
  "preCd.legend.kpiTitle": {
    en: "Top KPI badges",
    it: "Badge KPI in alto",
  },
  "preCd.legend.kpiRaw": {
    en: "All logged signals with a closed +5d outcome — directional hit rate without filters.",
    it: "Tutti i segnali loggati con outcome +5g chiuso — hit rate direzionale senza filtri.",
  },
  "preCd.legend.kpiUseful": {
    en: "Actionable tier: Affid ≥ 50 and |Pred5| ≥ 2%.",
    it: "Tier actionable: Affid ≥ 50 e |Pred5| ≥ 2%.",
  },
  "preCd.legend.kpiStrong": {
    en: "Strong tier: Affid ≥ 50 and |Pred5| ≥ 3%.",
    it: "Tier strong: Affid ≥ 50 e |Pred5| ≥ 3%.",
  },
  "preCd.legend.kpiHitNote": {
    en: "Hit% = share of signals where actual +5d moved in the predicted direction. n=0 until outcomes close.",
    it: "Hit% = quota di segnali il cui actual +5g è andato nella direzione prevista. n=0 finché gli outcome non si chiudono.",
  },
  "preCd.legend.chartsTitle": {
    en: "Charts (top row)",
    it: "Grafici (riga in alto)",
  },
  "preCd.legend.chartLearning": {
    en: "Weekly hit% of actionable signals — model learning over time. Needs ≥ 2 weeks of live refresh with closed outcomes.",
    it: "Hit% settimanale dei segnali actionable — apprendimento del modello nel tempo. Servono ≥ 2 settimane di refresh live con outcome chiusi.",
  },
  "preCd.legend.chartScatter": {
    en: "Pred5 (x) vs actual +5d (y). Points on the diagonal = well calibrated. Needs ≥ 3 closed outcomes (Rebuild ~6 days after first log).",
    it: "Pred5 (x) vs actual +5g (y). Punti sulla diagonale = buona calibrazione. Servono ≥ 3 outcome chiusi (Rebuild ~6 giorni dopo il primo log).",
  },
  "preCd.legend.chartsEmptyWhy": {
    en: "Why charts are empty now: the audit log has 0 closed outcomes (see «pending (+5g)»). Run «Refresh live signals», wait for sessions to pass, then «Rebuild calibration». Until then the table may show a Simulation preview only.",
    it: "Perché i grafici sono vuoti ora: il log audit ha 0 outcome chiusi (vedi «in attesa (+5g)»). Esegui «Refresh live signals», attendi le sessioni, poi «Rebuild calibration». Fino ad allora la tabella può mostrare solo l'anteprima da Simulation.",
  },
  "preCd.legend.tableTitle": {
    en: "Signals table",
    it: "Tabella segnali",
  },
  "preCd.legend.colTicker": {
    en: "Symbol; colored dot = tier (green strong, blue useful).",
    it: "Simbolo; puntino colorato = tier (verde strong, blu useful).",
  },
  "preCd.legend.colDays": {
    en: "Calendar days to Completion Date. Amber ≤ 7d (hot window), red bold ≤ 3d.",
    it: "Giorni di calendario al Completion Date. Ambra ≤ 7g (finestra calda), rosso grassetto ≤ 3g.",
  },
  "preCd.legend.colDir": {
    en: "▲ Long if Pred5 > 0, ▼ Short if Pred5 < 0.",
    it: "▲ Long se Pred5 > 0, ▼ Short se Pred5 < 0.",
  },
  "preCd.legend.colPred5": {
    en: "Predicted % change over the next 5 sessions (from the model curve).",
    it: "Variazione % prevista sulle prossime 5 sessioni (curva modello).",
  },
  "preCd.legend.colAffid": {
    en: "Model reliability 0–100. Green ≥ 75, amber below ~55.",
    it: "Affidabilità modello 0–100. Verde ≥ 75, ambra sotto ~55.",
  },
  "preCd.legend.colActual": {
    en: "Realized move after 5 sessions — «pending» until the window closes.",
    it: "Movimento realizzato dopo 5 sessioni — «pending» finché la finestra non si chiude.",
  },
  "preCd.legend.colHit": {
    en: "✓ direction correct, ✗ wrong, — still pending.",
    it: "✓ direzione corretta, ✗ errata, — ancora in attesa.",
  },
  "preCd.legend.colorsTitle": {
    en: "Colors & highlights",
    it: "Colori e evidenziazioni",
  },
  "preCd.legend.colorsBody": {
    en: "Row background: light green = hit, light red = miss, light amber = CD within 7 days.",
    it: "Sfondo riga: verde chiaro = hit, rosso chiaro = miss, ambra chiaro = CD entro 7 giorni.",
  },
  "preCd.legend.colorCd": {
    en: "CD column: amber ≤ 7d, bold red ≤ 3d.",
    it: "Colonna CD: ambra ≤ 7g, rosso grassetto ≤ 3g.",
  },
  "preCd.legend.colorAffid": {
    en: "Affid column: green ≥ 75.",
    it: "Colonna Affid: verde ≥ 75.",
  },
  "preCd.legend.colorHit": {
    en: "Hit: green ✓ / red ✗.",
    it: "Hit: verde ✓ / rosso ✗.",
  },
  "preCd.legend.workflowTitle": {
    en: "Recommended workflow",
    it: "Flusso consigliato",
  },
  "preCd.legend.stepLive": {
    en: "Refresh live signals — writes today's actionable rows to the audit log.",
    it: "Refresh live signals — scrive le righe actionable di oggi nel log audit.",
  },
  "preCd.legend.stepWait": {
    en: "Wait ~5 trading sessions for Actual +5g to populate.",
    it: "Attendi ~5 sessioni di borsa perché Actual +5g si popoli.",
  },
  "preCd.legend.stepRebuild": {
    en: "Rebuild calibration — closes pending outcomes and refreshes KPIs/charts.",
    it: "Rebuild calibration — chiude gli outcome in attesa e aggiorna KPI/grafici.",
  },
  "preCd.legend.stepReload": {
    en: "↻ JSON — reload signal_calibration.json without rebuilding.",
    it: "↻ JSON — ricarica signal_calibration.json senza rebuild.",
  },
  "simOutcomes.slopeHarmonyNote": {
    en: "Outcome calibration uses slope20d + P&L vs pre-CD plan — not the Slope errors acceleration badge.",
    it: "Calibrazione esiti usa slope20d + P&L vs piano pre-CD — non il badge Accelerazione in Errori pendenza.",
  },
  "simOutcomes.open.empty": {
    en: "No open positions. Set capital > 0 in Simulation — P&L and exit verdicts appear here (same engine as the P&L tab).",
    it: "Nessuna posizione aperta. Imposta capitale > 0 in Simulation — P&L e verdetto exit compaiono qui (stesso motore del tab P&L).",
  },
  "simOutcomes.syncNote": {
    en: "Open P&L and row colors use the same rules as Simulation → P&L (mark-to-market from buy price + live price). Refresh data to update prices.",
    it: "P&L aperti e colori riga seguono le stesse regole di Simulation → P&L (mark-to-market da prezzo acquisto + prezzo live). Usa Aggiorna dati per i prezzi.",
  },
  "simOutcomes.kpi.totalDecisions": {
    en: "Total decisions",
    it: "Decisioni totali",
  },
  "simOutcomes.kpi.committed": {
    en: "Committed capital",
    it: "Capitale impegnato",
  },
  "simOutcomes.kpi.committedSub": {
    en: "on open positions",
    it: "su posizioni aperte",
  },
  "simOutcomes.kpi.mtm": {
    en: "P&L mark-to-market",
    it: "P&L mark-to-market",
  },
  "simOutcomes.kpi.mtmSub": {
    en: "open · aligned with Simulation → P&L",
    it: "aperte · allineato a Simulation → P&L",
  },
  "simOutcomes.kpi.realized": {
    en: "Realized P&L",
    it: "P&L realizzato",
  },
  "simOutcomes.kpi.realizedSub": {
    en: "closed · definitive",
    it: "chiuse · definitivo",
  },
  "simOutcomes.kpi.cumulativeDaily": {
    en: "Cumulative daily P&L",
    it: "P&L giornaliero cumulativo",
  },
  "simOutcomes.kpi.todayLedger": {
    en: "Today P&L (24h · open)",
    it: "P&L oggi (24h · aperte)",
  },
  "simOutcomes.kpi.todayLedgerSub": {
    en: "Same 24h total as Simulation → P&L · Daily detail",
    it: "Stesso totale 24h di Simulation → P&L · Dettaglio giornaliero",
  },
  "simOutcomes.kpi.cumulativeDailySub": {
    en: "Open positions MTM total · {days} days in ledger · {open} open + {closed} closed",
    it: "MTM totale aperte · {days} gg nel ledger · {open} aperte + {closed} chiuse",
  },
  "simOutcomes.ledger.title": {
    en: "Daily P&L ledger",
    it: "Registro P&L giornaliero",
  },
  "simOutcomes.ledger.subtitle": {
    en: "Each column is the € change vs. the prior close. Open and closed positions from portfolio history snapshots.",
    it: "Ogni colonna è la variazione € rispetto alla chiusura precedente. Posizioni aperte e chiuse dagli snapshot storici.",
  },
  "simOutcomes.pnlAlign.hint": {
    en: "Totals match Simulation → P&L. Full daily breakdown lives in Daily detail.",
    it: "I totali coincidono con Simulation → P&L. Il dettaglio giornaliero è in Dettaglio giornaliero.",
  },
  "simOutcomes.pnlAlign.openDailyDetail": {
    en: "Open daily detail",
    it: "Apri dettaglio giornaliero",
  },
  "simOutcomes.pnlAlign.openPnlTab": {
    en: "Simulation → P&L",
    it: "Simulation → P&L",
  },
  "simOutcomes.kpi.combinedPnl": {
    en: "Open + realized total",
    it: "Totale aperte + realizzato",
  },
  "simOutcomes.kpi.combinedPnlSub": {
    en: "Mark-to-market open + closed outcomes — system performance check",
    it: "Mark-to-market aperte + outcomes chiuse — verifica performance sistema",
  },
  "simOutcomes.kpi.buyAccuracy": {
    en: "BUY signal accuracy",
    it: "Accuratezza segnale BUY",
  },
  "simOutcomes.kpi.sellAccuracy": {
    en: "SELL signal accuracy",
    it: "Accuratezza segnale SELL",
  },
  "simOutcomes.kpi.signalQa": {
    en: "Signal QA overall",
    it: "QA segnali complessivo",
  },
  "simOutcomes.kpi.successSub": {
    en: "{success}/{total} successes (excl. pending/n-a)",
    it: "{success}/{total} successi (escl. pending/n-a)",
  },
  "simOutcomes.kpi.noEval": {
    en: "no evaluable cases",
    it: "nessun caso valutabile",
  },
  "simOutcomes.kpi.overallTotal": {
    en: "Overall total",
    it: "Totale complessivo",
  },
  "simOutcomes.kpi.overallSub": {
    en: "Realized + mark-to-market P&L across {n} decision(s)",
    it: "P&L realizzato + mark-to-market su {n} decisione/i",
  },
  "simOutcomes.open.title": {
    en: "Open positions → when to exit",
    it: "Posizioni aperte → quando uscire",
  },
  "simOutcomes.open.subtitle": {
    en: "Verdict: 20d slope + P&L + pre-CD plan. P&L column = live mark-to-market (Simulation prices). EXIT if slope ≤ −0.3 pp/d and P&L < +10% without active pre-CD thesis. HOLD if slope positive, profit ≥ +10%, or pre-CD upside.",
    it: "Verdetto: slope 20d + P&L + piano pre-CD. Colonna P&L = mark-to-market live (prezzi Simulation). EXIT se slope ≤ −0,3 pp/g e P&L < +10% senza tesi pre-CD. HOLD se slope positiva, profitto ≥ +10% o upside pre-CD.",
  },
  "simOutcomes.open.count": {
    en: "{n} open position",
    it: "{n} posizione aperta",
  },
  "simOutcomes.open.countPlural": {
    en: "{n} open positions",
    it: "{n} posizioni aperte",
  },
  "simOutcomes.open.lossCount": {
    en: "{n} in loss (P&L tab)",
    it: "{n} in perdita (tab P&L)",
  },
  "simOutcomes.open.openPnlTab": {
    en: "P&L tab →",
    it: "Tab P&L →",
  },
  "simOutcomes.open.movedNote": {
    en: "The per-position exit verdict (EXIT / HOLD / WATCH) now lives in the unified Pick stocks portfolio table, next to the Sell button — no longer duplicated here. Use the P&L tab for the curve deep-dive.",
    it: "Il verdetto d'uscita per posizione (EXIT / HOLD / WATCH) è ora nella tabella portafoglio unica di Pick stocks, accanto al pulsante Sell — non più duplicato qui. Usa la tab P&L per l'analisi della curva.",
  },
  "simOutcomes.closed.title": {
    en: "Closed positions — what worked",
    it: "Posizioni chiuse — cosa ha funzionato",
  },
  "simOutcomes.closed.subtitle": {
    en: "Each point = one closed position (realized P&L). Hover for ticker, outcome and amounts.",
    it: "Ogni punto = una posizione chiusa (P&L realizzato). Passa il mouse per ticker, esito e importi.",
  },
  "simOutcomes.closed.deduped": {
    en: " · {unique} unique of {total} log rows (duplicate sells merged).",
    it: " · {unique} uniche su {total} righe log (vendite duplicate accorpate).",
  },
  "simOutcomes.closed.empty": {
    en: "No closed positions yet — after sell/CD, outcomes appear here as chart points.",
    it: "Nessuna posizione chiusa — dopo vendita/CD compaiono qui come punti grafico.",
  },
  "simOutcomes.chart.slopeTitle": {
    en: "Curve slope vs realized P&L %",
    it: "Pendenza curva vs P&L % realizzato",
  },
  "simOutcomes.chart.slopeSub": {
    en: "Slope 20d at entry (or best proxy). Green = gain, red = loss.",
    it: "Slope 20d all'ingresso (o miglior proxy). Verde = guadagno, rosso = perdita.",
  },
  "simOutcomes.chart.affTitle": {
    en: "Reliability at entry vs realized P&L %",
    it: "Affidabilità all'ingresso vs P&L % realizzato",
  },
  "simOutcomes.chart.affSub": {
    en: "Confidence at buy vs outcome. Replaces the detailed table under the charts.",
    it: "Affidabilità al buy vs esito. Sostituisce la tabella dettagliata sotto i grafici.",
  },
  "simOutcomes.chart.corrPos": {
    en: "↑ Positive correlation: higher {label} → better P&L. Confirms {label} is a useful index.",
    it: "↑ Correlazione positiva: {label} più alto → P&L migliore. Conferma utilità dell'indice.",
  },
  "simOutcomes.chart.corrNeg": {
    en: "↓ Negative correlation: higher {label} → worse P&L. {label} could be misleading.",
    it: "↓ Correlazione negativa: {label} più alto → P&L peggiore. {label} potrebbe fuorviare.",
  },
  "simOutcomes.chart.corrWeak": {
    en: "Weak correlation — with n={n} positions the signal is not yet conclusive.",
    it: "Correlazione debole — con n={n} posizioni il segnale non è ancora conclusivo.",
  },
  "simOutcomes.tradeCalib": {
    en: "Trade-calib active · BUY slope≥{buy} · SELL slope≤{sell}",
    it: "Trade-calib attiva · BUY slope≥{buy} · SELL slope≤{sell}",
  },
  "simOutcomes.tradeCalibPositions": {
    en: " · {n} positions analyzed",
    it: " · {n} posizioni analizzate",
  },
  "simOutcomes.tradeCalibHint": {
    en: " — Action thresholds tuned from Simulation trade outcomes (rebuild after buy/sell).",
    it: " — soglie Action tarate dagli esiti trade Simulation (rebuild dopo buy/sell).",
  },
  "simOutcomes.subTab.tracking": {
    en: "Tracking & P&L",
    it: "Tracking & P&L",
  },
  "simOutcomes.subTab.planProb": {
    en: "P(plan) learning",
    it: "Learning P(plan)",
  },
  "testerMonitor.diversify.title": {
    en: "Capital & diversification lab",
    it: "Lab capitale & diversificazione",
  },
  "testerMonitor.diversify.subtitle": {
    en: "How many companies and how much € per position to have a high probability of closing in profit — based on your closed Simulation trades (win rate and average win/loss).",
    it: "Quante società e quanti € per posizione per avere alta probabilità di chiudere in positivo — basato sui trade chiusi in Simulation (% successo e media vincita/perdita).",
  },
  "testerMonitor.diversify.loading": {
    en: "Loading closed trade outcomes…",
    it: "Caricamento esiti trade chiusi…",
  },
  "modelLab.diversify.title": {
    en: "How many positions to stay positive?",
    it: "Quante posizioni per chiudere in positivo?",
  },
  "modelLab.diversify.subtitle": {
    en: "Uses your closed Simulation trades: win rate, average win/loss €, and binomial probability that the portfolio ends green when you split capital equally across N companies (independent-trade model).",
    it: "Usa i trade chiusi in Simulation: % successo, media vincita/perdita € e probabilità binomiale di chiudere in verde ripartendo il capitale su N società (modello trade indipendenti).",
  },
  "modelLab.diversify.empty": {
    en: "Close at least one Simulation position to estimate win rate and build the diversification curve.",
    it: "Chiudi almeno una posizione in Simulation per stimare la % di successo e tracciare la curva di diversificazione.",
  },
  "modelLab.diversify.lowSample": {
    en: "Only {n} closed trades — treat estimates as indicative until you have ≥8 outcomes.",
    it: "Solo {n} trade chiusi — tratta le stime come indicative finché non hai ≥8 esiti.",
  },
  "modelLab.diversify.kpi.winRate": {
    en: "Closed sim win %",
    it: "Sim chiusi · % successo",
  },
  "modelLab.diversify.kpi.winRateSub": {
    en: "Round-trip only · not unified advice success until n≥8",
    it: "Solo round-trip · non è Successo consigli finché n<8",
  },
  "modelLab.diversify.kpi.avgWin": {
    en: "Avg win",
    it: "Media vincita",
  },
  "modelLab.diversify.kpi.avgLoss": {
    en: "Avg loss",
    it: "Media perdita",
  },
  "modelLab.diversify.kpi.expectancy": {
    en: "Expectancy",
    it: "Valore atteso",
  },
  "modelLab.diversify.kpi.perTrade": {
    en: "per trade",
    it: "per trade",
  },
  "modelLab.diversify.kpi.breakeven": {
    en: "Break-even WR",
    it: "WR pareggio",
  },
  "modelLab.diversify.kpi.breakevenHint": {
    en: "min wins with current sizes",
    it: "min vittorie con queste taglie",
  },
  "modelLab.diversify.kpi.sample": {
    en: "Sample",
    it: "Campione",
  },
  "modelLab.diversify.kpi.closed": {
    en: "closed trades",
    it: "trade chiusi",
  },
  "modelLab.diversify.capitalPerPosition": {
    en: "€ per company",
    it: "€ per società",
  },
  "modelLab.diversify.recFor": {
    en: "≥{pct}% confidence",
    it: "≥{pct}% confidenza",
  },
  "modelLab.diversify.recPositions": {
    en: "≥{n} companies",
    it: "≥{n} società",
  },
  "modelLab.diversify.recNotReached": {
    en: ">24 needed",
    it: ">24 necessarie",
  },
  "modelLab.diversify.recDailyTotal": {
    en: "/ day (whole portfolio)",
    it: "/ giorno (totale portfolio)",
  },
  "modelLab.diversify.chartTitle": {
    en: "Probability of positive portfolio vs N positions",
    it: "Probabilità portafoglio positivo vs N posizioni",
  },
  "modelLab.diversify.chartSub": {
    en: "Blue = P(net € > 0) · ref 90% / 95% · green = cum. expected P&L · amber = expected €/day (N slots × expectancy ÷ avg hold days)",
    it: "Blu = P(net € > 0) · rif. 90% / 95% · verde = P&L atteso cumul. · ambra = €/giorno attesi (N slot × expectancy ÷ giorni medi holding)",
  },
  "modelLab.diversify.kpi.avgHold": {
    en: "Avg hold",
    it: "Holding medio",
  },
  "modelLab.diversify.kpi.days": {
    en: "days",
    it: "giorni",
  },
  "modelLab.diversify.kpi.realizedDaily": {
    en: "Historical €/day",
    it: "Storico €/giorno",
  },
  "modelLab.diversify.kpi.obsWindow": {
    en: "over {d}d sample window",
    it: "su finestra {d} gg",
  },
  "modelLab.diversify.dailyHint": {
    en: "Expected €/day assumes N slots always invested and one round-trip every avg hold days.",
    it: "€/giorno atteso = N slot sempre pieni, un round-trip ogni holding medio in giorni.",
  },
  "modelLab.diversify.tooltipPositions": {
    en: "{n} positions",
    it: "{n} posizioni",
  },
  "modelLab.diversify.disclaimer": {
    en: "Model assumes i.i.d. trades with historical average win/loss — not a guarantee. Correlation, timing and regime shifts can reduce real-world safety.",
    it: "Modello con trade i.i.d. e medie storiche vincita/perdita — non è una garanzia. Correlazione, timing e cambi regime possono ridurre la sicurezza reale.",
  },
  "modelLab.successBridge.title": {
    en: "Exit & capture metrics (not unified advice success)",
    it: "Metriche uscita & cattura (≠ Successo consigli unificato)",
  },
  "modelLab.successBridge.lead": {
    en: "Unified Advice success lives in Decision Sim (live 24h + P(plan)). Here: closed round-trip win % and today’s capture — different populations.",
    it: "Successo consigli unificato è in Decision Sim (live 24h + P(plan)). Qui: % successo round-trip chiusi e cattura oggi — popolazioni diverse.",
  },
  "modelLab.successBridge.closedHorizon": {
    en: "Closed trades (round-trip)",
    it: "Trade chiusi (round-trip)",
  },
  "modelLab.successBridge.todayHorizon": {
    en: "Today (open book · 24h)",
    it: "Oggi (book aperto · 24h)",
  },
  "modelLab.successBridge.closedWinRate": {
    en: "Simulation exits only",
    it: "Solo uscite Simulation",
  },
  "modelLab.successBridge.closedWinSub": {
    en: "{wins}✓ · {losses}✗ · n={n} closed · excluded from unified headline if n<8",
    it: "{wins}✓ · {losses}✗ · n={n} chiusi · escluso da Successo consigli se n<8",
  },
  "modelLab.successBridge.closedWinTip": {
    en: "Share of closed Simulation positions with realized P&L > 0. Becomes unified Advice success fallback only with ≥8 closes; otherwise indicative only.",
    it: "Quota posizioni Simulation chiuse con P&L realizzato > 0. Diventa fallback di Successo consigli solo con ≥8 chiusure; altrimenti solo indicativa.",
  },
  "modelLab.successBridge.closedExpectancy": {
    en: "Expectancy / trade",
    it: "Expectancy / trade",
  },
  "modelLab.successBridge.closedExpectancySub": {
    en: "Avg win × win rate − avg loss × loss rate",
    it: "Media vincita × win rate − media perdita × loss rate",
  },
  "modelLab.successBridge.closedExpectancyTip": {
    en: "Can be positive even with low win rate if wins are larger than losses.",
    it: "Può essere positiva anche con win rate basso se le vincite superano le perdite.",
  },
  "modelLab.successBridge.closedRealizedDaily": {
    en: "Historical € / day (closed)",
    it: "€ / giorno storico (chiusi)",
  },
  "modelLab.successBridge.closedRealizedDailySub": {
    en: "Total realized P&L ÷ observation window of closed trades",
    it: "P&L realizzato totale ÷ finestra osservazione trade chiusi",
  },
  "modelLab.successBridge.closedEmpty": {
    en: "No closed trades yet — close a Simulation position to populate win rate.",
    it: "Nessun trade chiuso — chiudi una posizione in Simulation per calcolare la % successo.",
  },
  "modelLab.successBridge.todayActualSub": {
    en: "Open portfolio P&L today (ledger)",
    it: "P&L portafoglio aperto oggi (ledger)",
  },
  "modelLab.successBridge.todayActualTip": {
    en: "Same figure as Performance → Actual vs yesterday when history has one day.",
    it: "Stesso valore di Performance → Reale vs ieri quando c’è un solo giorno in history.",
  },
  "modelLab.successBridge.todayCaptureTip": {
    en: "Today’s actual ÷ hypothetical P&L if every BUY recommendation had been followed (€5k/ticker model). Not the closed win rate.",
    it: "Reale oggi ÷ P&L ipotetico se avessi seguito ogni raccomandazione BUY (modello €5k/ticker). Non è la % successo sulle chiusure.",
  },
  "modelLab.successBridge.todayCaptureFairTip": {
    en: "Share of executable recommendation P&L captured — cap 8 positions, real capital, no Enter on losers.",
    it: "Quota del P&L rec eseguibili catturata — cap 8 posizioni, capitale reale, no Enter su perdenti.",
  },
  "modelLab.successBridge.todayFairRecSub": {
    en: "Executable recs today: {eur}",
    it: "Rec eseguibili oggi: {eur}",
  },
  "modelLab.successBridge.todayGapFairTip": {
    en: "€ left on table vs executable recs (fair benchmark).",
    it: "€ persi vs rec eseguibili (benchmark equo).",
  },
  "modelLab.successBridge.todayRecSub": {
    en: "100% recs hypothetical today: {eur}",
    it: "Ipotetico 100% raccom. oggi: {eur}",
  },
  "modelLab.successBridge.todayGapTip": {
    en: "Gap vs following all recommendations today — not related to exit win rate.",
    it: "Gap vs seguire tutte le raccomandazioni oggi — non legato alla % successo a uscita.",
  },
  "modelLab.successBridge.todayHistoryShort": {
    en: "Only {n} day(s) in capture history — trend charts need more daily snapshots.",
    it: "Solo {n} giorno/i in history cattura — i grafici trend servono più snapshot giornalieri.",
  },
  "modelLab.successBridge.todayEmpty": {
    en: "Today’s capture metrics need Simulation data with 24h moves — open Model quality → Today.",
    it: "Le metriche di oggi servono dati Simulation con Var. 24h — apri Qualità modello → Oggi.",
  },
  "modelLab.successBridge.footer": {
    en: "20% closed win rate and 88% capture today can coexist: exits vs open-book daily performance are different populations.",
    it: "20% successo chiusure e 88% cattura oggi possono coesistere: uscite vs performance giornaliera del book aperto sono popolazioni diverse.",
  },
  "simOutcomes.planProb.empty": {
    en: "No portfolio decisions yet — open or close positions in Simulation to build the audit.",
    it: "Nessuna decisione in portafoglio — apri o chiudi posizioni in Simulation per popolare l'audit.",
  },
  "simOutcomes.planProb.introTitle": {
    en: "Recommendation vs outcome (weighted by P(plan))",
    it: "Raccomandazione vs esito (pesata su P(plan))",
  },
  "simOutcomes.planProb.introBody": {
    en: "Each row recomputes P(plan) from the entry snapshot (slope, pred, reliability). Enter is correct if P&L > +0.5%; Wait if |P&L| ≤ 2%; Skip if P&L ≤ +0.5%. Errors on high-confidence calls weigh more (Brier + penalty) for the learning loop.",
    it: "Ogni riga ricalcola P(plan) dallo snapshot di ingresso (pendenza, pred, affidabilità). Enter è corretto se P&L > +0,5%; Wait se |P&L| ≤ 2%; Skip se P&L ≤ +0,5%. Gli errori ad alta confidenza pesano di più (Brier + penalità) per il learning loop.",
  },
  "simOutcomes.planProb.kpiAccuracy": {
    en: "Recommendation accuracy",
    it: "Accuratezza raccomandazioni",
  },
  "simOutcomes.planProb.kpiAccuracySub": {
    en: "{correct}/{total} correct (evaluable)",
    it: "{correct}/{total} corrette (valutabili)",
  },
  "simOutcomes.planProb.kpiBrier": {
    en: "Mean Brier score",
    it: "Brier medio",
  },
  "simOutcomes.planProb.kpiBrierSub": {
    en: "Lower = better calibration (p vs outcome)",
    it: "Più basso = migliore calibrazione (p vs esito)",
  },
  "simOutcomes.planProb.kpiPenalty": {
    en: "Weighted error penalty",
    it: "Penalità errore pesata",
  },
  "simOutcomes.planProb.kpiPenaltySub": {
    en: "Mean P(plan) on wrong calls — drives recalibration",
    it: "Media P(plan) sulle chiamate errate — guida la ricalibrazione",
  },
  "simOutcomes.planProb.kpiPending": {
    en: "Pending",
    it: "In attesa",
  },
  "simOutcomes.planProb.kpiPendingSub": {
    en: "Open positions without final P&L",
    it: "Posizioni aperte senza P&L finale",
  },
  "simOutcomes.planProb.correctShort": {
    en: "correct",
    it: "corrette",
  },
  "simOutcomes.planProb.chartCalibTitle": {
    en: "Calibration: predicted vs actual hit rate",
    it: "Calibrazione: probabilità prevista vs hit rate reale",
  },
  "simOutcomes.planProb.chartCalibSub": {
    en: "Bars = mean P(plan) in bin · line = share of correct recommendations",
    it: "Barre = P(plan) medio nel bin · linea = quota raccomandazioni corrette",
  },
  "simOutcomes.planProb.linePredicted": {
    en: "Mean P(plan)",
    it: "P(plan) medio",
  },
  "simOutcomes.planProb.lineActual": {
    en: "Actual hit rate",
    it: "Hit rate reale",
  },
  "simOutcomes.planProb.chartNeedMore": {
    en: "Need more evaluable cases for this chart.",
    it: "Servono più casi valutabili per questo grafico.",
  },
  "simOutcomes.planProb.chartScatterTitle": {
    en: "P(plan) vs outcome",
    it: "P(plan) vs esito",
  },
  "simOutcomes.planProb.chartScatterSub": {
    en: "Each point = one closed/evaluable decision · Y = OK if recommendation was right",
    it: "Ogni punto = una decisione chiusa/valutabile · Y = OK se la raccomandazione aveva ragione",
  },
  "simOutcomes.planProb.hit": {
    en: "Recommendation correct",
    it: "Raccomandazione corretta",
  },
  "simOutcomes.planProb.miss": {
    en: "Recommendation wrong",
    it: "Raccomandazione errata",
  },
  "simOutcomes.planProb.colTicker": {
    en: "Ticker",
    it: "Ticker",
  },
  "simOutcomes.planProb.colRec": {
    en: "Rec.",
    it: "Rec.",
  },
  "simOutcomes.planProb.colResult": {
    en: "Result",
    it: "Esito",
  },
  "simOutcomes.planProb.learningNote": {
    en: "Learning loop: when predicted P(plan) systematically overshoots actual hit rate in a bin, tighten entry thresholds or down-weight drivers in recoveryProbability. Export this view to Learning Lab in a future pass.",
    it: "Learning loop: quando P(plan) previsto supera sistematicamente l'hit rate reale in un bin, stringi le soglie Enter o riduci il peso dei driver in recoveryProbability. Esportazione verso Learning Lab in un passo successivo.",
  },
  "sim.pnl.chartLabel": {
    en: "Chart",
    it: "Grafico",
  },
  "sim.pnl.curveLabel": {
    en: "Curve",
    it: "Curva",
  },
  "sim.pnl.openCurveDetail": {
    en: "Curve detail →",
    it: "Dettaglio curva →",
  },
  "sim.pnl.openCurveDetailTitle": {
    en: "Open full prediction curves for {ticker} (Catalyst & curves → Charts)",
    it: "Apri le curve di predizione per {ticker} (Catalyst & curve → Grafici)",
  },
  "sim.pnl.chart.today": {
    en: "Trading day",
    it: "Giornata",
  },
  "sim.pnl.chart.total": {
    en: "Total",
    it: "Totale",
  },
  "sim.pnl.chart.todayTip": {
    en: "Daily chg. % from Simulation (vs previous session close)",
    it: "Var. Giorn. % da Simulation (vs chiusura sessione precedente)",
  },
  "sim.pnl.chart.totalTip": {
    en: "P&L since capital entry",
    it: "P&L dall'ingresso capitale",
  },
  "sim.pnl.chart.reading": {
    en: "Last reading",
    it: "Ultima lettura",
  },
  "sim.pnl.chart.readingTip": {
    en: "Δ vs previous portfolio snapshot — trend between price refreshes",
    it: "Δ vs snapshot portfolio precedente — trend tra refresh prezzi",
  },
  "sim.pnl.chart.readingHint": {
    en: "Shows growth/decay since the last saved reading. Requires at least two snapshots (refresh prices twice).",
    it: "Mostra crescita/decrescita dall'ultima lettura salvata. Servono almeno due snapshot (refresh prezzi due volte).",
  },
  "sim.pnl.scope.reading": {
    en: "last reading",
    it: "ultima lettura",
  },
  "sim.pnl.bar.pctReading": {
    en: "P&L % vs last reading",
    it: "P&L % vs ultima lettura",
  },
  "sim.pnl.bar.noSeriesData": {
    en: "No values for this view — try Total or Trading day after Reload, or Last reading after prices update in this tab.",
    it: "Nessun valore per questa vista — prova Totale o Giornata dopo Reload, oppure Ultima lettura dopo un aggiornamento prezzi in questa tab.",
  },
  "sim.pnl.bar.eurReading": {
    en: "P&L € vs last reading",
    it: "P&L € vs ultima lettura",
  },
  "sim.pnl.metric": {
    en: "Metric",
    it: "Metrica",
  },
  "sim.pnl.bar.pctDay": {
    en: "P&L % day (vs prev close)",
    it: "P&L % giornata (vs chius. prec.)",
  },
  "sim.pnl.bar.pctTotal": {
    en: "P&L % total",
    it: "P&L % totale",
  },
  "sim.pnl.bar.eurDay": {
    en: "P&L € day",
    it: "P&L € giornata",
  },
  "sim.pnl.bar.eurTotal": {
    en: "P&L € total",
    it: "P&L € totale",
  },
  "sim.pnl.chart.refTotal": {
    en: "Portfolio total {value}",
    it: "Totale portafoglio {value}",
  },
  "sim.pnl.chart.refToday": {
    en: "Portfolio today {value}",
    it: "Portafoglio oggi {value}",
  },
  "sim.pnl.card.currentStock": {
    en: "Current stock",
    it: "Titolo corrente",
  },
  "sim.pnl.card.planEntry": {
    en: "Plan at entry",
    it: "Piano all'ingresso",
  },
  "sim.pnl.card.tradingDay": {
    en: "Trading day",
    it: "Giornata",
  },
  "sim.pnl.card.totalEntry": {
    en: "Total · from entry",
    it: "Totale · da ingresso",
  },
  "sim.pnl.sell": {
    en: "Sell",
    it: "Vendi",
  },
  "sim.pnl.sellTitle": {
    en: "Sell {ticker} at current price and close the position",
    it: "Vendi {ticker} al prezzo corrente e chiudi la posizione",
  },
  "sim.pnl.sellConfirm": {
    en: "Confirm · {ticker}",
    it: "Conferma · {ticker}",
  },
  "sim.pnl.sellCancel": {
    en: "Cancel",
    it: "Annulla",
  },
  "sim.pnl.sellConfirmGroup": {
    en: "Confirm sale of {ticker}",
    it: "Conferma vendita {ticker}",
  },
  "sim.pnl.sellFailed.noRow": {
    en: "Could not sell: Simulation row not found. Reload the sheet and try again.",
    it: "Vendita non riuscita: riga Simulation non trovata. Ricarica il foglio e riprova.",
  },
  "sim.pnl.sellFailed.notInPortfolio": {
    en: "This ticker is not in your open portfolio (or was already sold).",
    it: "Questo titolo non è nel portafoglio aperto (o è già stato venduto).",
  },
  "sim.pnl.sellFailed.noCapital": {
    en: "Could not sell: no invested capital on this row. Set buy price and capital in Simulation first.",
    it: "Vendita non riuscita: nessun capitale investito su questa riga. Imposta prezzo e capitale in Simulation.",
  },
  "sim.pnl.sellFailed.generic": {
    en: "Could not close the position. Try again from the Simulation tab.",
    it: "Impossibile chiudere la posizione. Riprova dal tab Simulation.",
  },
  "sim.pnl.field.priceUsd": {
    en: "Price $",
    it: "Prezzo $",
  },
  "sim.pnl.field.buyUsd": {
    en: "Buy $",
    it: "Acquisto $",
  },
  "sim.pnl.field.purchaseDateSub": {
    en: "Bought {date}",
    it: "Acquisto {date}",
  },
  "sim.pnl.purchaseDateUnknown": {
    en: "Purchase date not recorded",
    it: "Data acquisto non registrata",
  },
  "sim.pnl.field.valueEur": {
    en: "Value €",
    it: "Valore €",
  },
  "sim.pnl.field.days": {
    en: "Days",
    it: "Giorni",
  },
  "sim.pnl.field.exitDate": {
    en: "Exit date",
    it: "Data uscita",
  },
  "sim.pnl.field.expGain": {
    en: "Exp gain",
    it: "Gain atteso",
  },
  "sim.pnl.field.expGainTip": {
    en: "Total expected P&L from entry to catalyst (full hold plan on model curve), not just remaining days. Hover shows residual today→CD.",
    it: "P&L atteso totale da ingresso al catalizzatore (piano completo sulla curva modello), non solo i giorni residui. Nel tooltip: residuo oggi→CD.",
  },
  "sim.pnl.field.pnlPct": {
    en: "P&L %",
    it: "P&L %",
  },
  "sim.pnl.field.pnlEur": {
    en: "P&L €",
    it: "P&L €",
  },
  "sim.col.gainVsLoss": {
    en: "Target",
    it: "Target",
  },
  "sim.col.gainVsLossTip": {
    en: "Donut = progress toward model target · price = target $ toward CD when curve rises; ↓ when model expects decline.",
    it: "Torta = avanzamento verso target modello · prezzo = target $ verso CD se curva in rialzo; ↓ se calo atteso.",
  },
  "sim.col.targetReachedGainTip": {
    en: "Plan target {target} reached · realized {pct} ({usd})",
    it: "Target piano {target} raggiunto · gain {pct} ({usd})",
  },
  "sim.pnl.field.lossEur": {
    en: "Loss €",
    it: "Perdita €",
  },
  "sim.pnl.field.gainPct": {
    en: "Gain %",
    it: "Gain %",
  },
  "sim.pnl.field.gainEur": {
    en: "Gain €",
    it: "Gain €",
  },
  "sim.pnl.portfolioSumTitle": {
    en: "Σ portfolio — sum of all positions",
    it: "Σ portafoglio — somma di tutte le posizioni",
  },
  "sim.pnl.portfolio.capital": {
    en: "Capital",
    it: "Capitale",
  },
  "sim.pnl.portfolio.invested": {
    en: "Invested",
    it: "Investito",
  },
  "sim.pnl.portfolio.valueNow": {
    en: "Value now",
    it: "Valore ora",
  },
  "sim.pnl.portfolio.dayCoverage": {
    en: "Day coverage",
    it: "Copertura giornata",
  },
  "sim.pnl.portfolio.tickersDaily": {
    en: "Tickers with daily chg.",
    it: "Ticker con Var. giorn.",
  },
  "sim.pnl.sumTodayShort": {
    en: "Today gain sum",
    it: "Somma gain · oggi",
  },
  "sim.pnl.sumTotalShort": {
    en: "Total gain sum",
    it: "Somma gain · totale",
  },
  "sim.workspace.tab.chart": {
    en: "Trend",
    it: "Andamento",
  },
  "sim.workspace.tab.table": {
    en: "Sheet",
    it: "Tabella",
  },
  "sim.workspace.tab.tableTip": {
    en: "Opportunity sheet — hot zone ≤60 d from CD, filters and sort",
    it: "Foglio opportunità — hot zone ≤60 g da CD, filtri e ordinamento",
  },
  "sim.workspace.tab.pnl": {
    en: "P&L",
    it: "P&L",
  },
  "sim.workspace.tab.chartTip": {
    en: "Portfolio value trend over time",
    it: "Andamento valore portafoglio nel tempo",
  },
  "sim.workspace.tab.pnlTip": {
    en: "P&L % bar chart per ticker",
    it: "Grafico a barre P&L % per ticker",
  },
  "sim.workspace.tab.lossAnalysis": {
    en: "24h check",
    it: "Check 24h",
  },
  "sim.workspace.tab.lossAnalysisTip": {
    en: "Open positions and opportunities — 24h P&L, slope, recalibration, SDS blend, RA score and MII",
    it: "Posizioni aperte e opportunità — P&L 24h, pendenza, ricalibrazione, blend SDS, RA score e MII",
  },
  "sim.lossAnalysis.back": {
    en: "← P&L",
    it: "← P&L",
  },
  "sim.curves.subtitle": {
    en: "Prediction curves for open portfolio positions — open full charts in Charts & curves.",
    it: "Curve di predizione per le posizioni aperte — apri i grafici completi in Grafici & curve.",
  },
  "sim.curves.empty": {
    en: "No open positions. Set capital in P&L to track curves for your holdings.",
    it: "Nessuna posizione aperta. Imposta capitale nel tab P&L per tracciare le curve dei titoli.",
  },
  "sim.lossAnalysis.title": {
    en: "24h assessment",
    it: "Valutazione 24h",
  },
  "sim.lossAnalysis.subtitle": {
    en: "Last 24h read on every open position: slope errors, model + SDS blend, RA score and MII — exit or hold.",
    it: "Lettura ultime 24h su ogni posizione aperta: slope errors, modello + blend SDS, RA score e MII — uscire o rimanere.",
  },
  "sim.lossAnalysis.subtitleOpportunities": {
    en: "Off-portfolio hot-zone opportunities (CD ≤ 2 months): same 24h deep-dive — entry timing, RA score, MII and SDS blend.",
    it: "Opportunità fuori portafoglio in zona hot (CD ≤ 2 mesi): stesso deep-dive 24h — timing entry, RA score, MII e blend SDS.",
  },
  "sim.lossAnalysis.subtitleOpportunitiesHot": {
    en: "Off-portfolio opportunities within {days} days of CD (hot zone) — 24h deep-dive: entry timing, RA score, MII and SDS blend.",
    it: "Opportunità fuori portafoglio entro {days} giorni dal CD (hot zone) — deep-dive 24h: timing entry, RA score, MII e blend SDS.",
  },
  "sim.lossAnalysis.subtitleOpportunitiesWatch": {
    en: "Early off-portfolio opportunities — CD between {min} and {max} days (watch zone, 4–2 months). Target ROI calibrates when entering hot zone.",
    it: "Opportunità anticipate fuori portafoglio — CD tra {min} e {max} giorni (watch zone, 4–2 mesi). ROI target si calibra entrando in hot zone.",
  },
  "sim.lossAnalysis.profile.portfolio": {
    en: "Portfolio",
    it: "Portfolio",
  },
  "sim.lossAnalysis.profile.opportunities": {
    en: "Other opportunities",
    it: "Altre opportunità",
  },
  "sim.lossAnalysis.emptyOpportunities": {
    en: "No off-portfolio opportunities in the hot CD window. Check Simulation rows with CD within 2 months and no capital allocated.",
    it: "Nessuna opportunità fuori portafoglio nella finestra CD hot. Controlla righe Simulation con CD entro 2 mesi e senza capitale allocato.",
  },
  "sim.lossAnalysis.emptyOpportunitiesHot": {
    en: "No off-portfolio opportunities within 2 months of CD. Check Simulation rows with CD ≤ 60 days and no capital allocated.",
    it: "Nessuna opportunità fuori portafoglio entro 2 mesi dal CD. Controlla righe Simulation con CD ≤ 60 giorni e senza capitale allocato.",
  },
  "sim.lossAnalysis.emptyOpportunitiesWatch": {
    en: "No off-portfolio opportunities in the watch window (CD 61–120 days). Switch to «Within 2 mo» or add Simulation rows with catalyst 4–2 months out.",
    it: "Nessuna opportunità fuori portafoglio nella finestra watch (CD 61–120 giorni). Passa a «Entro 2 mesi» o aggiungi righe Simulation con CD tra 4 e 2 mesi.",
  },
  "sim.lossAnalysis.oppHorizon.label": {
    en: "CD window",
    it: "Finestra CD",
  },
  "sim.lossAnalysis.oppHorizon.hot": {
    en: "Within 2 mo",
    it: "Entro 2 mesi",
  },
  "sim.lossAnalysis.oppHorizon.hotTip": {
    en: "Hot zone — completion date within {days} days (operational timing, full target ROI)",
    it: "Hot zone — CD entro {days} giorni (timing operativo, ROI target completo)",
  },
  "sim.lossAnalysis.oppHorizon.watch": {
    en: "Early 4–2 mo",
    it: "Anticipate 4–2 mesi",
  },
  "sim.lossAnalysis.oppHorizon.watchTip": {
    en: "Watch zone — CD between {min} and {max} days (4–2 months out, lower timing weight)",
    it: "Watch zone — CD tra {min} e {max} giorni (da 4 a 2 mesi, peso timing minore)",
  },
  "sim.lossAnalysis.opportunity.planCap": {
    en: "Plan €{eur} (not in portfolio)",
    it: "Piano €{eur} (fuori portafoglio)",
  },
  "sim.lossAnalysis.registerBuy.label": {
    en: "Add to portfolio",
    it: "In portafoglio",
  },
  "sim.lossAnalysis.registerBuy.title": {
    en: "Register this buy in Simulation — sets capital and entry price (stored locally, not synced with your broker). Adjust capital in the P&L tab afterward.",
    it: "Registra l'acquisto in Simulation — imposta capitale e prezzo di entrata (salvato in locale, non collegato al broker). Modifica il capitale nel tab P&L dopo.",
  },
  "sim.lossAnalysis.registerBuy.confirm": {
    en: "Register {ticker} in portfolio with €{eur} at the current sheet price?",
    it: "Registrare {ticker} in portafoglio con €{eur} al prezzo attuale del foglio?",
  },
  "sim.lossAnalysis.registerBuy.gatedShort": {
    en: "Buy gated",
    it: "Buy bloccato",
  },
  "sim.lossAnalysis.registerBuy.gatedAlert": {
    en: "Buy blocked — same rule as sim loop / suggestion monitor:\n{reason}",
    it: "Buy bloccato — stessa regola del loop sim / monitor suggerimenti:\n{reason}",
  },
  "sim.lossAnalysis.summaryTable.title": {
    en: "Top KPI snapshot",
    it: "Snapshot KPI principali",
  },
  "sim.lossAnalysis.summaryTable.hint": {
    en: "Click ticker to jump to the deep-dive panel below.",
    it: "Clicca il ticker per scendere al pannello deep-dive sotto.",
  },
  "sim.lossAnalysis.summaryTable.hintPolygonSort": {
    en: "Sorted by polygon match % — highest fit to the target profile first.",
    it: "Ordinato per match % poligono — miglior aderenza al profilo target per primo.",
  },
  "sim.lossAnalysis.summaryTable.polygon": {
    en: "Polygon",
    it: "Poligono",
  },
  "sim.lossAnalysis.summaryTable.polygonTip": {
    en: "CD pattern sketch (purple = current, dashed green = target) and PPI — higher = review first.",
    it: "Sketch poligono CD (viola = attuale, verde tratteggiato = target) e PPI — più alto = da rivedere prima.",
  },
  "sim.lossAnalysis.summaryTable.collapse": {
    en: "Collapse KPI table",
    it: "Chiudi tabella KPI",
  },
  "sim.lossAnalysis.summaryTable.expand": {
    en: "Expand KPI table",
    it: "Apri tabella KPI",
  },
  "sim.lossAnalysis.summaryTable.sortPolygon": {
    en: "Sort · Match %",
    it: "Ordina · Match %",
  },
  "sim.lossAnalysis.summaryTable.sortPolygonTip": {
    en: "Prioritize rows by polygon match score — table and cards below follow this order",
    it: "Prioritizza per match % poligono — tabella e schede sotto seguono questo ordine",
  },
  "sim.lossAnalysis.summaryTable.sortActionSolidity": {
    en: "Sort · Buy / Sell",
    it: "Ordina · Buy / Sell",
  },
  "sim.lossAnalysis.summaryTable.sortActionSolidityTip": {
    en: "Solid BUY recommendations first (Top2, P(plan), precat), then solid SELL (exit, slope), then the rest. Combine with Match % to sort within each group.",
    it: "Prima BUY solidi (Top2, P(plan), precat), poi SELL solidi (exit, slope), poi il resto. Combina con Match % per ordinare dentro ogni gruppo.",
  },
  "sim.lossAnalysis.summaryTable.hintActionSort": {
    en: "Sorted: solid BUY → solid SELL → hold/review. Click ticker to jump to the card below.",
    it: "Ordinato: BUY solidi → SELL solidi → hold/review. Clicca il ticker per la scheda sotto.",
  },
  "sim.lossAnalysis.summaryTable.planProb": {
    en: "P(plan)",
    it: "P(piano)",
  },
  "sim.lossAnalysis.summaryTable.planProbPortfolio": {
    en: "P(rec)",
    it: "P(rec)",
  },
  "sim.lossAnalysis.summaryTable.planProbTip": {
    en: "Model probability the suggested action is correct (Enter / Wait / Skip or Hold / Review / Exit) — curve, polygon match, SDS, MII, CD window, EIS.",
    it: "Probabilità stimata che il suggerimento sia corretto (Entra / Attendi / Evita o Mantieni / Rivedi / Esci) — curva, match poligono, SDS, MII, finestra CD, EIS.",
  },
  "sim.lossAnalysis.summaryTable.eisCumulative": {
    en: "EIS cumul.",
    it: "EIS cumul.",
  },
  "sim.lossAnalysis.summaryTable.eisCumulativeTip": {
    en: "Sum of EIS scores across all clinical feed events for this ticker. Click to open detail.",
    it: "Somma degli score EIS di tutti gli eventi feed clinico per questo ticker. Clicca per il dettaglio.",
  },
  "sim.lossAnalysis.summaryTable.ticker": {
    en: "Ticker",
    it: "Ticker",
  },
  "sim.lossAnalysis.summaryTable.company": {
    en: "Company",
    it: "Società",
  },
  "sim.lossAnalysis.summaryTable.verdict": {
    en: "Verdict",
    it: "Verdetto",
  },
  "sim.lossAnalysis.summaryTable.entry": {
    en: "Entry",
    it: "Entry",
  },
  "sim.lossAnalysis.summaryTable.jumpTip": {
    en: "Scroll to deep-dive charts",
    it: "Vai ai grafici deep-dive",
  },
  "sim.lossAnalysis.summaryTable.portfolioMark": {
    en: "Real portfolio position",
    it: "Posizione in portafoglio reale",
  },
  "sim.lossAnalysis.summaryTable.pnl24h": {
    en: "24h move",
    it: "Var. 24h",
  },
  "sim.lossAnalysis.oppFilter.label": {
    en: "24h move filter",
    it: "Filtro movimento 24h",
  },
  "sim.lossAnalysis.oppFilter.all": {
    en: "All",
    it: "Tutte",
  },
  "sim.lossAnalysis.oppFilter.gain24h": {
    en: "↑ 24h gain",
    it: "↑ Gain 24h",
  },
  "sim.lossAnalysis.oppFilter.loss24h": {
    en: "↓ 24h loss",
    it: "↓ Loss 24h",
  },
  "sim.lossAnalysis.oppFilter.empty": {
    en: "No opportunities match this 24h filter. Try «All» or refresh Simulation prices.",
    it: "Nessuna opportunità con questo filtro 24h. Prova «Tutte» o aggiorna i prezzi Simulation.",
  },
  "sim.lossAnalysis.oppFilter.best": {
    en: "Best picks",
    it: "Migliori",
  },
  "sim.lossAnalysis.oppFilter.bestTip": {
    en: "Show enter and wait only, ranked by verdict, target ROI, RA score and 24h move",
    it: "Mostra solo enter e wait, ordinate per verdetto, ROI target, RA score e movimento 24h",
  },
  "sim.lossAnalysis.oppFilter.emptyBest": {
    en: "No enter or wait opportunities right now. Turn off «Best picks» to see all rows.",
    it: "Nessuna opportunità enter o wait al momento. Disattiva «Migliori» per vedere tutte le righe.",
  },
  "sim.lossAnalysis.oppFilter.emptyCombined": {
    en: "No rows match both filters. Relax the 24h filter or turn off «Best picks».",
    it: "Nessuna riga con entrambi i filtri. Allenta il filtro 24h o disattiva «Migliori».",
  },
  "sim.lossAnalysis.summary.oppCount": {
    en: "{n} opportunities",
    it: "{n} opportunità",
  },
  "sim.lossAnalysis.summary.enter": {
    en: "{n} enter",
    it: "{n} entra",
  },
  "sim.lossAnalysis.summary.waitEntry": {
    en: "{n} wait",
    it: "{n} attendi",
  },
  "sim.lossAnalysis.summary.skip": {
    en: "{n} skip",
    it: "{n} evita",
  },
  "sim.lossAnalysis.entryDecision.enter": {
    en: "Enter",
    it: "Entra",
  },
  "sim.lossAnalysis.entryDecision.wait": {
    en: "Wait",
    it: "Attendi",
  },
  "sim.lossAnalysis.entryDecision.skip": {
    en: "Skip",
    it: "Evita",
  },
  "sim.lossAnalysis.recoveryProb": {
    en: "P(recovery) {pct}%",
    it: "P(recupero) {pct}%",
  },
  "sim.lossAnalysis.entryProb": {
    en: "P(plan) {pct}%",
    it: "P(piano) {pct}%",
  },
  "sim.lossAnalysis.entryProbTip": {
    en: "Estimated probability the entry plan (forward target) succeeds — from curve slope, polygon match, SDS, MII, CD window and EIS. ≥60% → Enter now · 40–59% → Wait · <40% → Skip.",
    it: "Probabilità stimata che il piano di entrata (target forward) si realizzi — da pendenza curva, match poligono, SDS, MII, finestra CD ed EIS. ≥60% → Entra ora · 40–59% → Attendi · <40% → Evita.",
  },
  "sim.lossAnalysis.probAction.enterNow": {
    en: "Enter now",
    it: "Entra ora",
  },
  "sim.lossAnalysis.probAction.waitEntry": {
    en: "Wait",
    it: "Attendi",
  },
  "sim.lossAnalysis.probAction.skipEntry": {
    en: "Skip entry",
    it: "Evita entrata",
  },
  "sim.lossAnalysis.probAction.hold": {
    en: "Hold",
    it: "Mantieni",
  },
  "sim.lossAnalysis.probAction.review": {
    en: "Review",
    it: "Rivedi",
  },
  "sim.lossAnalysis.probAction.exit": {
    en: "Exit",
    it: "Esci",
  },
  "sim.lossAnalysis.recoveryProbTip": {
    en: "Estimated probability of recovering the open loss before exit — same signal blend as entry outlook.",
    it: "Probabilità stimata di recuperare la perdita aperta prima dell'uscita — stesso blend di segnali dell'outlook entrata.",
  },
  "sim.lossAnalysis.empty": {
    en: "No open positions with capital. Set buy price and capital in P&L to start tracking.",
    it: "Nessuna posizione aperta con capitale. Imposta prezzo acquisto e capitale nel tab P&L per iniziare il monitoraggio.",
  },
  "sim.lossAnalysis.summary.count": {
    en: "{n} open positions",
    it: "{n} posizioni aperte",
  },
  "sim.lossAnalysis.summary.inLoss": {
    en: "{n} in loss",
    it: "{n} in perdita",
  },
  "sim.lossAnalysis.summary.inGain": {
    en: "{n} in gain",
    it: "{n} in guadagno",
  },
  "sim.lossAnalysis.summary.pnl24h": {
    en: "24h P&L",
    it: "P&L 24h",
  },
  "sim.lossAnalysis.summary.totalPnl": {
    en: "Total P&L",
    it: "P&L totale",
  },
  "sim.lossAnalysis.summary.invested": {
    en: "invested",
    it: "investiti",
  },
  "sim.lossAnalysis.summary.totalGapLoss": {
    en: "Model gap loss (cap.)",
    it: "Perdita gap modello (cap.)",
  },
  "sim.lossAnalysis.metric.modelGapLoss": {
    en: "Cap. loss vs model T+5 ({gap}): {loss}",
    it: "Perdita cap. vs modello T+5 ({gap}): {loss}",
  },
  "sim.lossAnalysis.metric.capLossSummary": {
    en: "Cap. loss (gap): {loss}",
    it: "Perdita cap. (gap): {loss}",
  },
  "sim.lossAnalysis.target.progressTip": {
    en: "{progress}% toward target {target}",
    it: "{progress}% verso target {target}",
  },
  "sim.lossAnalysis.target.unavailableTip": {
    en: "Target {target} — progress not available",
    it: "Target {target} — avanzamento non disponibile",
  },
  "sim.lossAnalysis.metric.curveGapLoss": {
    en: "Cap. loss vs curve today: {loss}",
    it: "Perdita cap. vs curva oggi: {loss}",
  },
  "sim.lossAnalysis.metric.curveGapLossTip": {
    en: "EUR impact on invested capital from real price below recalibrated model today (Δ vs curve).",
    it: "Impatto in € sul capitale investito quando il prezzo reale è sotto il modello ricalibrato oggi (Δ vs curva).",
  },
  "sim.lossAnalysis.summary.exit": {
    en: "{n} exit",
    it: "{n} uscita",
  },
  "sim.lossAnalysis.summary.hold": {
    en: "{n} hold",
    it: "{n} rimani",
  },
  "sim.lossAnalysis.summary.review": {
    en: "{n} review",
    it: "{n} valuta",
  },
  "sim.lossAnalysis.decision.exit": {
    en: "Exit now",
    it: "Esci ora",
  },
  "sim.lossAnalysis.decision.hold": {
    en: "Hold",
    it: "Rimani",
  },
  "sim.lossAnalysis.decision.review": {
    en: "Review",
    it: "Valuta",
  },
  "sim.lossAnalysis.badge.forwardTooLow": {
    en: "Curve target low for Enter (<{min}%)",
    it: "Target curva basso per Enter (<{min}%)",
  },
  "sim.lossAnalysis.pnlDual.today": {
    en: "Today {pct}",
    it: "Oggi {pct}",
  },
  "sim.lossAnalysis.pnlDual.entry": {
    en: "since entry {pct}",
    it: "dall'ingresso {pct}",
  },
  "sim.lossAnalysis.pnlDual.tip": {
    en: "Three horizons: portfolio since your buy price · vs last saved snapshot (trend between refreshes) · trading day vs previous market close.",
    it: "Tre orizzonti: portafoglio dal prezzo d'ingresso · vs ultimo snapshot salvato (trend tra refresh) · giornata borsa vs chiusura precedente.",
  },
  "sim.lossAnalysis.pnlDual.entryLabel": {
    en: "Portfolio (entry)",
    it: "Portafoglio (ingresso)",
  },
  "sim.lossAnalysis.pnlDual.entryTip": {
    en: "Mark-to-market since you invested — buy price vs current price.",
    it: "Mark-to-market dall'investimento — prezzo d'acquisto vs prezzo attuale.",
  },
  "sim.lossAnalysis.pnlDual.readingLabel": {
    en: "Last reading",
    it: "Ultima lettura",
  },
  "sim.lossAnalysis.pnlDual.readingTip": {
    en: "Change since the previous portfolio snapshot (each price refresh / reload).",
    it: "Variazione dall'ultimo snapshot portfolio (ogni refresh prezzi / reload).",
  },
  "sim.lossAnalysis.pnlDual.readingSince": {
    en: "since {ts}",
    it: "da {ts}",
  },
  "sim.lossAnalysis.pnlDual.todayLabel": {
    en: "Trading day",
    it: "Giornata borsa",
  },
  "sim.lossAnalysis.pnlDual.todayTip": {
    en: "Var. Giorn. % vs previous session close (Yahoo / sheet).",
    it: "Var. Giorn. % vs chiusura sessione precedente (Yahoo / foglio).",
  },
  "sim.lossAnalysis.pnlDual.recovering": {
    en: "↗ Recovering today — total still underwater from entry price",
    it: "↗ Recupero oggi — totale ancora sotto il prezzo di ingresso",
  },
  "sim.lossAnalysis.pnlDual.invested": {
    en: "invested",
    it: "investiti",
  },
  "sim.pnl.chart.totalDualHint": {
    en: "Red bars = loss since entry. Switch to «Trading day» to see today’s move only — e.g. CRDF can be −10% total but +1% today.",
    it: "Barre rosse = perdita dall'ingresso. Passa a «Giornata» per solo il movimento di oggi — es. CRDF −10% totale ma +1% oggi.",
  },
  "sim.pnl.chart.todayVsTotalHint": {
    en: "Bars = today only (% vs previous close). «Gain vs plan» below = total € since buy — green bar today + red total is normal when recovering from a loss.",
    it: "Barre = solo oggi (% vs chiusura precedente). «Gain vs piano» sotto = € totali dall'acquisto — barra verde oggi + totale rosso è normale in recupero da perdita.",
  },
  "sim.pnl.bar.tooltipToday": {
    en: "Today (24h)",
    it: "Oggi (24h)",
  },
  "sim.pnl.bar.tooltipTotal": {
    en: "Since entry",
    it: "Dall'ingresso",
  },
  "sim.pnl.bar.tooltipReading": {
    en: "Last reading",
    it: "Ultima lettura",
  },
  "sim.lossAnalysis.metric.slopes": {
    en: "Slopes (pp/day)",
    it: "Pendenze (pp/g)",
  },
  "sim.lossAnalysis.metric.pnl24h": {
    en: "24h move",
    it: "Movimento 24h",
  },
  "sim.lossAnalysis.metric.miiCalibPre": {
    en: "Calib pre-CD",
    it: "Calib pre-CD",
  },
  "sim.lossAnalysis.metric.pred5": {
    en: "Pred +5",
    it: "Pred +5",
  },
  "sim.lossAnalysis.metric.targetRoi": {
    en: "Target ROI",
    it: "ROI target",
  },
  "sim.lossAnalysis.metric.peakDays": {
    en: "Days to peak",
    it: "Giorni all'apice",
  },
  "sim.lossAnalysis.metric.gainIdea": {
    en: "Gain idea",
    it: "Idea guadagno",
  },
  "sim.lossAnalysis.metric.peakDaysValue": {
    en: "{days}d (+{pct}%)",
    it: "{days}g (+{pct}%)",
  },
  "sim.lossAnalysis.peak.hint": {
    en: "Curve peak in {days} days (+{pct}% then flattening) — hold until apex if slope stays ↑",
    it: "Apice curva tra {days} giorni (+{pct}% poi appiattimento) — rimani fino all'apice se pendenza ↑",
  },
  "sim.lossAnalysis.peak.tip": {
    en: "End of the rising segment on the recalibrated model curve before plateau or decline.",
    it: "Fine del tratto in salita sulla curva ricalibrata prima del plateau o della discesa.",
  },
  "sim.lossAnalysis.peak.missing": {
    en: "No clear rising segment toward a peak on the model curve.",
    it: "Nessun tratto in salita verso un apice sulla curva modello.",
  },
  "sim.lossAnalysis.gap.beyondHotShort": {
    en: ">60d",
    it: ">60g",
  },
  "sim.lossAnalysis.gap.beyondHotTip": {
    en: "CD in watch zone (T−{days}d, beyond 60d). Target ROI and peak are calibrated in the hot zone (≤60d to CD).",
    it: "CD in watch zone (T−{days}g, oltre 60 gg). ROI target e apice si calibrano in hot zone (≤60 gg dal CD).",
  },
  "sim.lossAnalysis.gap.watchProvShort": {
    en: "Prov.",
    it: "Prov.",
  },
  "sim.lossAnalysis.gap.watchProvTip": {
    en: "Provisional watch-zone target (T−{days}d) — extrapolated from curve + run-up to hot zone; refines at ≤60d.",
    it: "Target provvisorio watch zone (T−{days}g) — estrapolato da curva + run-up verso hot zone; si affina a ≤60g.",
  },
  "sim.lossAnalysis.gap.beyondMonitorShort": {
    en: ">4 mo",
    it: ">4 mesi",
  },
  "sim.lossAnalysis.gap.beyondMonitorTip": {
    en: "CD more than 4 months away (T−{days}d) — outside the operational monitoring window.",
    it: "CD oltre 4 mesi (T−{days}g) — fuori dalla finestra di monitoraggio operativo.",
  },
  "sim.lossAnalysis.gap.pastCdShort": {
    en: "Post-CD",
    it: "Post-CD",
  },
  "sim.lossAnalysis.gap.pastCdTip": {
    en: "Completion Date has passed — pre-CD target and peak no longer apply.",
    it: "Completion Date superata — target e apice pre-CD non si applicano più.",
  },
  "sim.lossAnalysis.gap.noChartShort": {
    en: "No curve",
    it: "No curva",
  },
  "sim.lossAnalysis.gap.noChartTip": {
    en: "Simulation chart not loaded — open Simulation refresh or wait for bundle load to compute target and peak.",
    it: "Grafico Simulation non caricato — aggiorna Simulation o attendi il bundle per calcolare target e apice.",
  },
  "sim.lossAnalysis.gap.noRiseShort": {
    en: "Flat",
    it: "Flat",
  },
  "sim.lossAnalysis.gap.unknownCdTip": {
    en: "Completion Date missing or invalid.",
    it: "Completion Date mancante o non valida.",
  },
  "sim.lossAnalysis.peak.chartBadge": {
    en: "Peak · {days}d · {pct}%",
    it: "Apice · {days}g · {pct}%",
  },
  "sim.lossAnalysis.metric.sds": {
    en: "SDS score",
    it: "Score SDS",
  },
  "sim.lossAnalysis.patternMatch.tip": {
    en: "CD pattern match {pct}% — radar vs historical archetype",
    it: "Match pattern CD {pct}% — radar vs archetipo storico",
  },
  "sim.lossAnalysis.metric.slopeVerdict": {
    en: "Slope verdict",
    it: "Verdetto pendenza",
  },
  "sim.lossAnalysis.slopeVerdict.finalActionNote": {
    en: "Intermediate slope signal — final action: {final}",
    it: "Segnale slope intermedio — azione finale: {final}",
  },
  "sim.lossAnalysis.slopeVerdict.exitSignalSecondary": {
    en: "Exit layer fired — recovery guards → final action overrides mechanical exit",
    it: "Layer exit attivo — guardie recovery → l'azione finale prevale sull'exit meccanico",
  },
  "sim.lossAnalysis.probExitSignalSecondary": {
    en: "Exit signal",
    it: "Segnale exit",
  },
  "sim.lossAnalysis.slopeVerdict.openTip": {
    en: "Open full slope + MII analysis",
    it: "Apri analisi completa pendenza + MII",
  },
  "sim.lossAnalysis.slopeVerdict.openCta": {
    en: "Tap for details (MII, Calib, stability)",
    it: "Clicca per dettagli (MII, Calib, stabilità)",
  },
  "sim.lossAnalysis.slopeVerdict.modal.kicker": {
    en: "Slope + market interest analysis",
    it: "Analisi pendenza + interesse mercato",
  },
  "sim.lossAnalysis.slopeVerdict.modal.tension": {
    en: "Signal tension",
    it: "Tensione segnali",
  },
  "sim.lossAnalysis.slopeVerdict.modal.slopeSection": {
    en: "Multi-timeframe slope stability",
    it: "Stabilità pendenza multi-timeframe",
  },
  "sim.lossAnalysis.slopeVerdict.modal.slope5d": {
    en: "Slope 5d",
    it: "Pendenza 5g",
  },
  "sim.lossAnalysis.slopeVerdict.modal.slope20d": {
    en: "Slope 20d",
    it: "Pendenza 20g",
  },
  "sim.lossAnalysis.slopeVerdict.modal.stabilityClass": {
    en: "Stability class",
    it: "Classe stabilità",
  },
  "sim.lossAnalysis.slopeVerdict.modal.stabilityHint": {
    en: "From 5d/20d/45d consistency (histlib calibration)",
    it: "Da coerenza 5g/20g/45g (calibrazione histlib)",
  },
  "sim.lossAnalysis.slopeVerdict.modal.persistence": {
    en: "Persistence window",
    it: "Finestra persistenza",
  },
  "sim.lossAnalysis.slopeVerdict.modal.rotationBullet": {
    en: "5d slope reversed vs 20d → EXIT driver (rotation flag).",
    it: "Pendenza 5g invertita vs 20g → driver EXIT (flag rotazione).",
  },
  "sim.lossAnalysis.slopeVerdict.modal.consistencyBullet": {
    en: "Timeframe consistency: {pct}% — higher = more reliable trend.",
    it: "Coerenza timeframe: {pct}% — più alto = trend più affidabile.",
  },
  "sim.lossAnalysis.slopeVerdict.modal.pred5Ref": {
    en: "Model Pred+5 forward: {v}",
    it: "Modello Pred+5 forward: {v}",
  },
  "sim.lossAnalysis.slopeVerdict.modal.miiSection": {
    en: "Market Interest Index (MII tab)",
    it: "Market Interest Index (tab MII)",
  },
  "sim.lossAnalysis.slopeVerdict.modal.miiMissing": {
    en: "MII data unavailable for this ticker — open the MII tab after a Simulation refresh.",
    it: "Dati MII non disponibili per questo ticker — apri tab MII dopo refresh Simulation.",
  },
  "sim.lossAnalysis.slopeVerdict.modal.volRatio": {
    en: "Volume ratio",
    it: "Rapporto volume",
  },
  "sim.lossAnalysis.slopeVerdict.modal.calibPre": {
    en: "Calib pre-daily",
    it: "Calib pre-daily",
  },
  "sim.lossAnalysis.slopeVerdict.modal.summary": {
    en: "Combined reading",
    it: "Lettura combinata",
  },
  "sim.lossAnalysis.chart.pred": {
    en: "Model + recalibration",
    it: "Modello + ricalibrazione",
  },
  "sim.lossAnalysis.chart.predBlend": {
    en: "Model + recalibration + SDS blend",
    it: "Modello + ricalibrazione + blend SDS",
  },
  "sim.lossAnalysis.chart.overlayToggles": {
    en: "Layers",
    it: "Curve",
  },
  "sim.lossAnalysis.chart.showBenchmarks": {
    en: "+ Benchmarks",
    it: "+ Benchmark",
  },
  "sim.lossAnalysis.chart.hideBenchmarks": {
    en: "− Benchmarks",
    it: "− Benchmark",
  },
  "sim.lossAnalysis.chart.blendKnots": {
    en: "Pred vs μ SDS blend (knots)",
    it: "Pred vs μ SDS blend (nodi)",
  },
  "sim.lossAnalysis.chart.slope": {
    en: "Slope errors",
    it: "Slope errors",
  },
  "sim.lossAnalysis.chart.slope24h": {
    en: "Model vs actual (% vs today)",
    it: "Modello vs reale (% vs oggi)",
  },
  "sim.lossAnalysis.chart.miiCalib": {
    en: "MII + calibration",
    it: "MII + calibrazione",
  },
  "sim.lossAnalysis.miiMissing": {
    en: "MII data not available for this position.",
    it: "Dati MII non disponibili per questa posizione.",
  },
  "sim.lossAnalysis.noChart": {
    en: "Chart data not available.",
    it: "Dati grafico non disponibili.",
  },
  "sim.lossAnalysis.slopeMissing": {
    en: "Insufficient price history for slope trajectory.",
    it: "Storico prezzi insufficiente per la traiettoria slope.",
  },
  "sim.lossAnalysis.action.sell": {
    en: "Sell position",
    it: "Vendi posizione",
  },
  "sim.lossAnalysis.action.sellShares": {
    en: "Sell",
    it: "Vendi",
  },
  "sim.lossAnalysis.exitSell.label": {
    en: "EXIT",
    it: "EXIT",
  },
  "sim.lossAnalysis.exitSell.title": {
    en: "Manual sell — closes the position at current price (not the model recommendation)",
    it: "Vendita manuale — chiude la posizione al prezzo corrente (non è la raccomandazione del modello)",
  },
  "sim.lossAnalysis.action.slope": {
    en: "Slope errors →",
    it: "Slope errors →",
  },
  "sim.lossAnalysis.action.curves": {
    en: "Prediction curves →",
    it: "Curve predizione →",
  },
  "sim.lossAnalysis.action.decisionLab": {
    en: "Decision Lab →",
    it: "Decision Lab →",
  },
  "sim.lossAnalysis.action.eis": {
    en: "EIS details →",
    it: "Dettaglio EIS →",
  },
  "sim.lossAnalysis.action.eisTip": {
    en: "Event Impact Score breakdown: ΔP, volume, clinical KPIs per feed event",
    it: "Breakdown Event Impact Score: ΔP, volume, KPI clinici per evento feed",
  },
  "sim.lossAnalysis.action.mii": {
    en: "MII slopes →",
    it: "Pendenze MII →",
  },
  "sim.lossAnalysis.miiDrawer.title": {
    en: "Market vs model slopes",
    it: "Pendenze mercato vs modello",
  },
  "sim.lossAnalysis.miiDrawer.subtitle": {
    en: "MII market angle vs recalibrated model slope, gap and calibration score.",
    it: "Angolo MII mercato vs pendenza modello ricalibrato, gap e score calibrazione.",
  },
  "sim.lossAnalysis.miiDrawer.openHint": {
    en: "Open MII detail",
    it: "Apri dettaglio MII",
  },
  "sim.lossAnalysis.chart.caption.predBlend": {
    en: "Model + SDS blend · % vs today · pre-CD grid from T−60 (or further when CD is distant). Slope chart below → T+90 post-CD.",
    it: "Modello + blend SDS · % vs oggi · griglia pre-CD da T−60 (o più indietro se CD lontana). Slope sotto → T+90 post-CD.",
  },
  "sim.lossAnalysis.chart.caption.gainPlan": {
    en: "Actual € gain vs recalibrated plan from entry.",
    it: "Gain € reale vs piano ricalibrato dall'ingresso.",
  },
  "sim.lossAnalysis.chart.caption.gainPlanHypothesis": {
    en: "Hypothetical entry today — teal = historical stock path (€ vs entry price); dashed = recalibrated plan.",
    it: "Ingresso ipotetico oggi — teal = curva storica prezzo (€ vs ingresso); tratteggiato = piano ricalibrato.",
  },
  "sim.lossAnalysis.chart.caption.gainPlanMissing": {
    en: "Curve data required for gain vs plan.",
    it: "Servono dati curva per gain vs piano.",
  },
  "sim.lossAnalysis.chart.gainPlanMissing": {
    en: "Chart unavailable",
    it: "Grafico non disponibile",
  },
  "sim.lossAnalysis.chart.caption.slope24h": {
    en: "Long horizon: model vs actual rebased to 0% at Today → T+90 post-CD. Pin = Var. Giorn. % when available.",
    it: "Orizonte lungo: modello vs reale con 0% a Oggi → T+90 post-CD. Pin = Var. Giorn. % se disponibile.",
  },
  "sim.lossAnalysis.chart.todayDailyMove": {
    en: "24h {pct} (Var. Giorn.)",
    it: "24h {pct} (Var. Giorn.)",
  },
  "sim.lossAnalysis.chart.caption.mii": {
    en: "Market slope (MII) vs recalibrated model — click for detail.",
    it: "Pendenza mercato (MII) vs modello ricalibrato — clic per dettaglio.",
  },
  "sim.workspace.details": {
    en: "Curves",
    it: "Curve",
  },
  "sim.workspace.detailsTip": {
    en: "Open prediction curves in Catalyst & curves → Charts",
    it: "Apri curve predizione in Catalyst & curve → Grafici",
  },
  "sim.workspace.tickerDecisionLabTip": {
    en: "Open this company in Decision Lab → Active signals",
    it: "Apri questa società in Decision Lab → Segnali attivi",
  },
  "sim.workspace.tickerSimulationTip": {
    en: "Open this row in Decision Lab → Simulation tab",
    it: "Apri questa riga in Decision Lab → tab Simulation",
  },
  "sim.workspace.tickerSimulationLink": {
    en: "Simulation tab →",
    it: "Tab Simulation →",
  },
  "signals.focus.fromSimulation": {
    en: "Opened from Simulation — not in current Top/Watch filters",
    it: "Aperto da Simulation — fuori dai filtri Top/Watch correnti",
  },
  "sim.workspace.filter.all": {
    en: "All",
    it: "Tutte",
  },
  "sim.workspace.filter.portfolio": {
    en: "Portfolio",
    it: "Portafoglio",
  },
  "sim.workspace.filter.topOpps": {
    en: "Top opportunity",
    it: "Top opportunità",
  },
  "sim.workspace.filter.sellNow": {
    en: "To sell now",
    it: "Da vendere ora",
  },
  "sim.workspace.filter.hotZone": {
    en: "Hot Zone",
    it: "Hot Zone",
  },
  "sim.workspace.filter.topOppsTip": {
    en: "Same hot-zone Top list as Decision Lab Active Signals (published keys) · sorted by ROI/day",
    it: "Stesso elenco hot Top del Decision Lab → Active Signals (chiavi pubblicate) · ordine ROI/giorno",
  },
  "sim.workspace.filter.sellNowTip": {
    en: "Open positions with declining curve toward CD: ROI ≤ 0, negative slopes, or exit/avoid verdict",
    it: "Posizioni aperte con curva in calo verso CD: ROI ≤ 0, pendenze negative o verdetto exit/avoid",
  },
  "sim.workspace.filter.hotZoneTip": {
    en: "All tickers with catalyst within 60 days (operational hot zone)",
    it: "Tutti i ticker con CD entro 60 giorni (zona hot operativa)",
  },
  "sim.workspace.cdScope.hotTitle": {
    en: "Opportunities within 2 months of CD",
    it: "Opportunità entro 2 mesi dal CD",
  },
  "sim.workspace.cdScope.hotSubtitle": {
    en: "Primary list · catalyst in {days} days or less · same screen, filters apply within this window",
    it: "Lista primaria · CD entro {days} giorni · stessi filtri, solo in questa finestra",
  },
  "sim.workspace.cdScope.watchTitle": {
    en: "Early opportunities (4–2 months to CD)",
    it: "Opportunità anticipate (4–2 mesi dal CD)",
  },
  "sim.workspace.cdScope.watchSubtitle": {
    en: "Watch zone · CD between {min} and {max} days · curve still readable, lower timing weight",
    it: "Zona watch · CD tra {min} e {max} giorni · curva ancora leggibile, peso timing minore",
  },
  "sim.workspace.cdScope.showWatch": {
    en: "Early (4–2 mo) · {count}",
    it: "Anticipate 4–2 mesi · {count}",
  },
  "sim.workspace.cdScope.showWatchTip": {
    en: "Same table for tickers with completion date between 120 and 61 days (4–2 months out)",
    it: "Stessa tabella per ticker con CD tra 120 e 61 giorni (da 4 a 2 mesi)",
  },
  "sim.workspace.cdScope.backToHot": {
    en: "← Primary (within 2 mo)",
    it: "← Primarie (entro 2 mesi)",
  },
  "sim.workspace.cdScope.backToHotTip": {
    en: "Back to opportunities within 60 days of catalyst",
    it: "Torna alle opportunità entro 60 giorni dal CD",
  },
  "sim.workspace.sort.label": {
    en: "Sort",
    it: "Ordina",
  },
  "sim.workspace.sort.auto": {
    en: "Auto",
    it: "Auto",
  },
  "sim.workspace.sort.autoTip": {
    en: "Filter default (Top opp → ROI/day, Sell now → worst decline first)",
    it: "Default del filtro (Top opp → ROI/g, Vendere → peggiori prima)",
  },
  "sim.workspace.sort.roiDesc": {
    en: "ROI ↓",
    it: "ROI ↓",
  },
  "sim.workspace.sort.roiDescTip": {
    en: "Highest expected ROI % toward CD first",
    it: "Prima il ROI atteso % più alto verso CD",
  },
  "sim.workspace.sort.roiAsc": {
    en: "ROI ↑",
    it: "ROI ↑",
  },
  "sim.workspace.sort.roiAscTip": {
    en: "Lowest expected ROI % first",
    it: "Prima il ROI atteso % più basso",
  },
  "sim.workspace.sort.daysAsc": {
    en: "Days ↑",
    it: "Giorni ↑",
  },
  "sim.workspace.sort.daysAscTip": {
    en: "Shortest horizon to CD first (fewer days)",
    it: "Prima l'orizzonte più breve al CD (meno giorni)",
  },
  "sim.workspace.sort.daysDesc": {
    en: "Days ↓",
    it: "Giorni ↓",
  },
  "sim.workspace.sort.daysDescTip": {
    en: "Longest horizon to CD first",
    it: "Prima l'orizzonte più lungo al CD",
  },
  "sim.workspace.sort.roiPerDayDesc": {
    en: "ROI/day ↓",
    it: "ROI/g ↓",
  },
  "sim.workspace.sort.roiPerDayDescTip": {
    en: "Highest ROI per calendar day to target (rise segment)",
    it: "Prima il ROI per giorno verso il target (tratto in salita)",
  },
  "sim.workspace.filter.empty": {
    en: "No rows match this filter.",
    it: "Nessuna riga per questo filtro.",
  },
  "sim.workspace.cdScope.emptyHot": {
    en: "No opportunities within 2 months of CD — try Early (4–2 mo) if any are in the watch window.",
    it: "Nessuna opportunità entro 2 mesi dal CD — prova Anticipate 4–2 mesi se ce ne sono in watch.",
  },
  "sim.workspace.cdScope.emptyWatch": {
    en: "No opportunities between 4 and 2 months to CD — switch back to Primary.",
    it: "Nessuna opportunità tra 4 e 2 mesi dal CD — torna alle Primarie.",
  },
  "sim.workspace.table.layoutFull": {
    en: "Full table",
    it: "Tabella completa",
  },
  "sim.workspace.table.layoutVariations": {
    en: "Price Δ%",
    it: "Var. prezzo",
  },
  "sim.workspace.table.trajectory": {
    en: "Curve",
    it: "Curva",
  },
  "sim.workspace.table.trajectoryTip": {
    en: "Same prediction curve as Simulation: recalibrated model, CD zones, target/stop.",
    it: "Stessa curva predittiva di Simulation: modello ricalibrato, zone CD, target/stop.",
  },
  "sim.workspace.table.modelToday": {
    en: "Curve $",
    it: "Curva $",
  },
  "sim.workspace.table.modelTodayTip": {
    en: "Model-implied price today on the recalibrated % vs T−60 axis — not your entry P&L.",
    it: "Prezzo implicito del modello a oggi sull'asse % vs T−60 — non è il P&L di ingresso.",
  },
  "sim.workspace.table.gapVsCurve": {
    en: "Δ vs curve",
    it: "Δ vs curva",
  },
  "sim.workspace.table.gapVsCurveTip": {
    en: "Real minus model price today (%). Measures curve tracking — not capital gain/loss vs buy.",
    it: "Reale meno modello oggi (%). Misura allineamento alla curva — non gain/perdita capitale vs acquisto.",
  },
  "sim.workspace.table.gapVsCurveTipDetail": {
    en: "Δ vs curve today: {pct}% ({usd} per share). Not P&L vs purchase.",
    it: "Δ vs curva oggi: {pct}% ({usd} per azione). Non è P&L vs acquisto.",
  },
  "sim.workspace.table.pnlVsBuy": {
    en: "Entry",
    it: "Ingresso",
  },
  "sim.workspace.table.pnlVsBuyTip": {
    en: "Mark-to-market vs your buy price since investment (portfolio only).",
    it: "Mark-to-market vs prezzo di acquisto dall'ingresso (solo portafoglio).",
  },
  "sim.workspace.table.pnlReading": {
    en: "Last read",
    it: "Ult. lettura",
  },
  "sim.workspace.table.pnlReadingTip": {
    en: "Price change since the previous local reading (hourly snapshots Mon–Fri 15:30–22:00 Rome on VPS). Requires at least two refreshes.",
    it: "Variazione prezzo rispetto alla lettura precedente (snapshot orari lun–ven 15:30–22:00 Roma su VPS). Servono almeno due refresh.",
  },
  "sim.workspace.table.pnlDay": {
    en: "Day",
    it: "Oggi",
  },
  "sim.workspace.table.pnlDayTip": {
    en: "Trading-day move vs previous close (Var. Giorn. % × position value). Not total P&L since entry.",
    it: "Variazione del giorno vs chiusura precedente (Var. Giorn. % × valore posizione). Non è il P&L totale dall'ingresso.",
  },
  "sim.workspace.table.variationsLegend": {
    en: "Row tint: green = curve toward CD · yellow = in loss but model still points to target (HOLD) · red = loss + weak curve. Entry P&L (red/green under ticker) is mark-to-market vs buy price.",
    it: "Sfondo riga: verde = curva verso CD · giallo = in perdita ma modello verso target (HOLD) · rosso = perdita + curva debole. Entry P&L (sotto ticker) = mark-to-market vs prezzo acquisto.",
  },
  "sim.workspace.table.realToday": {
    en: "Real $",
    it: "Reale $",
  },
  "sim.workspace.table.realTodayTip": {
    en: "Current market price (Yahoo / Simulation sheet, last refresh).",
    it: "Prezzo di mercato corrente (Yahoo / foglio Simulation, ultimo refresh).",
  },
  "sim.workspace.table.var1d": {
    en: "1d",
    it: "1g",
  },
  "sim.workspace.table.var7d": {
    en: "7d",
    it: "7g",
  },
  "sim.workspace.table.roiCd": {
    en: "ROI→CD",
    it: "ROI→CD",
  },
  "sim.workspace.table.var1m": {
    en: "1M",
    it: "1M",
  },
  "sim.workspace.table.varSpark": {
    en: "Var.",
    it: "Var.",
  },
  "sim.workspace.table.varSparkTip": {
    en: "Price variation mini-chart: 1d, 7d, 1M (% vs previous close / history).",
    it: "Mini-grafico variazioni prezzo: 1g, 7g, 1M (% vs chiusura precedente / storico).",
  },
  "sim.workspace.table.roiSnTarget": {
    en: "ROI-Target",
    it: "ROI-Target",
  },
  "sim.workspace.table.roiSnTargetTip": {
    en: "SuperNova target ROI — peak of pred+recalib curve (end of estimated rise segment, not CD).",
    it: "ROI-Target SuperNova — picco curva pred+recalib (fine tratto di crescita stimato, non al CD).",
  },
  "sim.workspace.table.sdsTip": {
    en: "Supernova Distance Score (0–100) — context quality for entry timing.",
    it: "Supernova Distance Score (0–100) — qualità contesto per timing ingresso.",
  },
  "sim.workspace.openCatalyst": {
    en: "Simulation → Catalyst ↗",
    it: "Simulation → Catalyst ↗",
  },
  "sim.workspace.openDecisionLab": {
    en: "Decision Lab →",
    it: "Decision Lab →",
  },
  "sim.workspace.openDecisionLabTip": {
    en: "Open Decision Lab (Performance & portfolio analysis)",
    it: "Apri Decision Lab (Performance e analisi portfolio)",
  },
  "sim.workspace.openSupernova": {
    en: "SuperNova tab →",
    it: "Tab SuperNova →",
  },
  "sim.workspace.openSupernovaTip": {
    en: "Back to Decision Lab — Supernova Distance Score",
    it: "Torna al Decision Lab — Supernova Distance Score",
  },
  "sim.workspace.openPattern": {
    en: "Ticker focus →",
    it: "Ticker focus →",
  },
  "sim.workspace.openPatternTip": {
    en: "CD-aligned recommendation radar per ticker (Decision Lab)",
    it: "Radar raccomandazione allineato al CD per ticker (Decision Lab)",
  },
  "sim.workspace.openSupernovaShort": {
    en: "SuperNova ↗",
    it: "SuperNova ↗",
  },
  "sim.workspace.openSupernovaTickerTip": {
    en: "Open SuperNova tab for this ticker",
    it: "Apri tab SuperNova per questo ticker",
  },
  "sim.gainPlan.title": {
    en: "Gain vs plan over time",
    it: "Gain vs piano nel tempo",
  },
  "sim.gainPlan.desc": {
    en: "Total € since your buy (chips + green line). Bars above show today only (% vs prev close) — they can disagree: e.g. +today while still −729€ total. Dashed = recalibrated plan curve.",
    it: "€ totali dall'acquisto (chip + linea verde). Le barre sopra mostrano solo oggi (% vs chiusura precedente) — possono divergere: es. +oggi ma −729€ totali. Tratteggiato = curva piano ricalibrata.",
  },
  "sim.gainPlan.actualTotal": {
    en: "Total since entry",
    it: "Totale dall'ingresso",
  },
  "sim.gainPlan.actualToday": {
    en: "Today vs prev close",
    it: "Oggi vs chiusura prec.",
  },
  "sim.gainPlan.chipTotal": {
    en: "Total since entry",
    it: "Totale dall'ingresso",
  },
  "sim.gainPlan.chipToday": {
    en: "Today vs prev close",
    it: "Oggi vs chiusura prec.",
  },
  "sim.gainPlan.chipTotalShort": {
    en: "tot",
    it: "tot",
  },
  "sim.gainPlan.chipTodayShort": {
    en: "today",
    it: "oggi",
  },
  "sim.gainPlan.empty": {
    en: "Enter buy price and capital on at least one position to view the gain chart.",
    it: "Inserisci prezzo acquisto e capitale su almeno una posizione per il grafico gain.",
  },
  "sim.gainPlan.historicalCurve": {
    en: "Historical curve",
    it: "Curva storica",
  },
  "sim.gainPlan.historicalCurveShort": {
    en: "Historical",
    it: "Storica",
  },
  "charts.recalib.title": {
    en: "Daily open recalibration",
    it: "Ricalibrazione giornaliera (open)",
  },
  "charts.recalib.noShift": {
    en: "no shift (< 0.02 pp)",
    it: "nessuno shift (< 0,02 pp)",
  },
  "charts.recalib.anchor": {
    en: "Anchor",
    it: "Ancoraggio",
  },
  "charts.recalib.livePct": {
    en: "live",
    it: "live",
  },
  "charts.recalib.modelPct": {
    en: "model",
    it: "modello",
  },
  "charts.recalib.refresh": {
    en: "Price refresh",
    it: "Refresh prezzo",
  },
  "charts.recalib.badgeTip": {
    en: "Parallel shift of future prediction nodes so «today» matches the live anchor (% vs T−60). Priority: Nasdaq open → Prezzo Corrente → snapshot close.",
    it: "Shift parallelo dei nodi futuri così «oggi» coincide con l'ancoraggio live (% vs T−60). Priorità: apertura Nasdaq → Prezzo Corrente → close snapshot.",
  },
  "dashboard.company.label": {
    en: "Company",
    it: "Società",
  },
  "dashboard.company.all": {
    en: "All ({n})",
    it: "Tutte ({n})",
  },
  "dashboard.company.focus": {
    en: "focus {ticker}",
    it: "focus {ticker}",
  },
  "dashboard.company.count": {
    en: "{n} tickers",
    it: "{n} ticker",
  },
  "dashboard.company.clear": {
    en: "✕ All",
    it: "✕ Tutte",
  },
  "dashboard.tab.table": {
    en: "Table",
    it: "Tabella",
  },
  "dashboard.tab.charts": {
    en: "Charts",
    it: "Grafici",
  },
  "dashboard.list.portfolio": {
    en: "Portfolio",
    it: "Portafoglio",
  },
  "dashboard.list.topOpps": {
    en: "Opportunities",
    it: "Opportunità",
  },
  "dashboard.rec.title": {
    en: "Since last visit — recommendations",
    it: "Dall'ultima visita — raccomandazioni",
  },
  "dashboard.rec.modalTitle": {
    en: "Since last visit — recommendations to review",
    it: "Dall'ultima visita — raccomandazioni da rivedere",
  },
  "dashboard.rec.sub": {
    en: "{n} pending · {new} new or updated since last review",
    it: "{n} in sospeso · {new} nuove o aggiornate dall'ultima revisione",
  },
  "dashboard.rec.modalClose": {
    en: "Reviewed — close",
    it: "Revisionate — chiudi",
  },
  "dashboard.rec.reviewOpen": {
    en: "{n} recommendation(s) pending ({new} new) — Review",
    it: "{n} raccomandazione/i in sospeso ({new} nuove) — Rivedi",
  },
  "dashboard.rec.filterAll": {
    en: "All",
    it: "Tutte",
  },
  "dashboard.rec.filterPortfolio": {
    en: "Portfolio",
    it: "Portafoglio",
  },
  "dashboard.rec.filterOpportunity": {
    en: "Opportunities",
    it: "Opportunità",
  },
  "dashboard.rec.cdNear": {
    en: "CD ≤2 mo",
    it: "CD ≤2 mesi",
  },
  "dashboard.rec.cdFar": {
    en: "CD >2 mo",
    it: "CD >2 mesi",
  },
  "dashboard.rec.cdAll": {
    en: "All CD",
    it: "Tutti CD",
  },
  "dashboard.rec.sortLabel": {
    en: "Sort recommendations",
    it: "Ordina raccomandazioni",
  },
  "dashboard.rec.sortRecent": {
    en: "Recent / urgent first",
    it: "Recenti / urgenti prima",
  },
  "dashboard.rec.sortScore": {
    en: "Recommendation score",
    it: "Score raccomandazione",
  },
  "dashboard.rec.sortDeal": {
    en: "Deal urgency (€/day)",
    it: "Urgenza deal (€/g)",
  },
  "dashboard.rec.colCompany": {
    en: "Company",
    it: "Società",
  },
  "dashboard.rec.colRec": {
    en: "Recommendation",
    it: "Raccom.",
  },
  "dashboard.rec.colPrice": {
    en: "Price $",
    it: "Prezzo $",
  },
  "dashboard.rec.targetReachedGainTip": {
    en: "Plan target {target} reached · realized {pct} ({usd})",
    it: "Target piano {target} raggiunto · gain {pct} ({usd})",
  },
  "dashboard.rec.colReason": {
    en: "Reason",
    it: "Motivo",
  },
  "dashboard.rec.empty": {
    en: "No pending actions — invest or exit in Simulation when you follow a recommendation and it will leave this list.",
    it: "Nessuna azione in sospeso — investi o esci in Simulation quando segui una raccomandazione e sparisce da qui.",
  },
  "dashboard.rec.emptyFiltered": {
    en: "No recommendations match the current filters — try All CD or a different profile.",
    it: "Nessuna raccomandazione con i filtri attuali — prova Tutti CD o un altro profilo.",
  },
  "dashboard.rec.colActions": {
    en: "Actions",
    it: "Azioni",
  },
  "dashboard.rec.openSim": {
    en: "Sim",
    it: "Sim",
  },
  "dashboard.rec.open24h": {
    en: "24h",
    it: "24h",
  },
  "dashboard.rec.dismissTip": {
    en: "Dismiss — action taken or skip for now",
    it: "Chiudi — azione eseguita o salta per ora",
  },
  "dashboard.rec.lastReadMarketCloseTip": {
    en: "No prior local reading — showing Var. Giorn. % vs previous market close (Simulation sheet).",
    it: "Nessuna lettura locale precedente — Var. Giorn. % vs chiusura di mercato precedente (foglio Simulation).",
  },
  "dashboard.rec.lastReadPortfolioTip": {
    en: "Portfolio move since last history snapshot (no local price read or daily % on sheet).",
    it: "Movimento portafoglio dall'ultimo snapshot storico (senza lettura locale o Var. Giorn. sul foglio).",
  },
  "dashboard.charts.simPaperSub": {
    en: "Paper sim loop — follows BUY/SELL advice from Tester monitor.",
    it: "Sim loop paper — segue i consigli BUY/SELL dal Tester monitor.",
  },
  "dashboard.charts.simPaperEmpty": {
    en: "No paper trades yet — start the sim loop in Tester monitor.",
    it: "Nessun trade paper — avvia il sim loop nel Tester monitor.",
  },
  "dashboard.charts.lastUpdated": {
    en: "Last update: {at}",
    it: "Ultimo aggiornamento: {at}",
  },
  "dashboard.charts.lastUpdatedPending": {
    en: "Not updated yet — open dashboard after daily refresh.",
    it: "Non ancora aggiornato — apri la dashboard dopo il refresh giornaliero.",
  },
  "dashboard.pulse.title": {
    en: "Since your last visit",
    it: "Dall'ultima visita",
  },
  "dashboard.pulse.firstVisit": {
    en: "First dashboard visit — next time you'll see Δ vs now.",
    it: "Prima visita — alla prossima vedrai il Δ rispetto ad adesso.",
  },
  "dashboard.pulse.sinceVisit": {
    en: "Changes since {when}",
    it: "Cambiamenti da {when}",
  },
  "dashboard.pulse.portfolioPnl": {
    en: "Portfolio",
    it: "Portafoglio",
  },
  "dashboard.pulse.portfolioPnlTip": {
    en: "Total mark-to-market P&L on open positions (current value − capital). Same as Piggy Bank.",
    it: "P&L mark-to-market totale sulle posizioni aperte (valore − capitale). Uguale al Piggy Bank.",
  },
  "dashboard.pulse.pnl24hTip": {
    en: "Sum of each open position's 24h move in € — not the same as cumulative 8-day charts below.",
    it: "Somma del movimento 24h di ogni posizione aperta — diverso dal cumulativo 8g nei grafici sotto.",
  },
  "dashboard.piggy.priorLegImplicit": {
    en: "Total since entry. Today {today}; before today {prior} (estimated: total − today — daily closes not verified).",
    it: "Totale dall'ingresso. Oggi {today}; prima di oggi {prior} (stimato: totale − oggi — chiusure non verificate).",
  },
  "dashboard.piggy.priorLegUncertain": {
    en: "Total since entry. Today {today}; before today {prior} (estimated — history may be unreliable; total from price MTM).",
    it: "Totale dall'ingresso. Oggi {today}; prima di oggi {prior} (stimato — storico possibilmente inaffidabile; totale da MTM prezzo).",
  },
  "dashboard.piggy.priorLegVerified": {
    en: "Total since entry. Today {today}; before today ~{prior}.",
    it: "Totale dall'ingresso. Oggi {today}; prima di oggi ~{prior}.",
  },
  "dashboard.pulse.deltaTip": {
    en: "P&L change since last dashboard visit",
    it: "Variazione P&L dall'ultima visita dashboard",
  },
  "dashboard.pulse.noPortfolio": {
    en: "No open positions — enter capital in Simulation.",
    it: "Nessuna posizione aperta — inserisci capitale in Simulation.",
  },
  "dashboard.pulse.positionsSummary": {
    en: "Open positions ({n})",
    it: "Posizioni aperte ({n})",
  },
  "dashboard.pulse.colTicker": {
    en: "Ticker",
    it: "Ticker",
  },
  "dashboard.pulse.colTrend": {
    en: "Trend",
    it: "Trend",
  },
  "dashboard.pulse.colTrendTip": {
    en: "Direction aligned with Δ visit when you have a prior visit (↑ up · ↓ down · → flat); otherwise 24h move.",
    it: "Direzione allineata al Δ visita se c'è una visita precedente (↑ salita · ↓ discesa · → piatto); altrimenti movimento 24h.",
  },
  "dashboard.pulse.colDelta": {
    en: "Δ visit",
    it: "Δ visita",
  },
  "dashboard.pulse.colPnl": {
    en: "P&L total",
    it: "P&L totale",
  },
  "dashboard.pulse.colGainPlan": {
    en: "Gain vs plan",
    it: "Gain vs piano",
  },
  "dashboard.pulse.oppsTitle": {
    en: "Opportunities · MII rising significantly",
    it: "Opportunità · MII in crescita significativa",
  },
  "dashboard.pulse.miiDeltaTip": {
    en: "MII angle change since last visit",
    it: "Variazione angolo MII dall'ultima visita",
  },
  "dashboard.pulse.footnote": {
    en: "Dashed = planned gain curve · solid = actual €. Snapshot saved when you leave the dashboard.",
    it: "Tratteggio = piano gain · continua = € reali. Snapshot salvato quando esci dalla dashboard.",
  },
  "dashboard.pulse.inGain": {
    en: "Portfolio in gain",
    it: "Portafoglio in gain",
  },
  "dashboard.pulse.inLoss": {
    en: "Portfolio in loss",
    it: "Portafoglio in perdita",
  },
  "dashboard.pulse.kpiTitle": {
    en: "Portfolio P&L summary",
    it: "Riepilogo P&L portafoglio",
  },
  "dashboard.pulse.chartTitle": {
    en: "Gain vs plan · portfolio (€)",
    it: "Gain vs piano · portafoglio (€)",
  },
  "dashboard.pulse.simLoop.title": {
    en: "Sim loop · Since your last visit",
    it: "Sim loop · Dalla tua ultima visita",
  },
  "dashboard.pulse.simLoop.sinceVisit": {
    en: "Changes since {when}",
    it: "Cambiamenti dal {when}",
  },
  "dashboard.pulse.simLoop.firstVisit": {
    en: "First visit — next time you come back you'll see deltas vs the current sim-loop state.",
    it: "Prima visita — al prossimo ritorno vedrai i delta rispetto allo stato attuale del sim loop.",
  },
  "dashboard.pulse.simLoop.switchPortfolio": {
    en: "Portfolio",
    it: "Portfolio",
  },
  "dashboard.pulse.simLoop.switchPortfolioTip": {
    en: "Switch back to the real-portfolio view (same panel, computed on live positions).",
    it: "Torna alla vista del portafoglio reale (stesso pannello, calcolato sulle posizioni live).",
  },
  "dashboard.pulse.simLoop.noPortfolio": {
    en: "No open paper positions in the sim loop.",
    it: "Nessuna posizione paper aperta nel sim loop.",
  },
  "dashboard.pulse.simLoop.kpiTitle": {
    en: "Sim loop P&L summary",
    it: "Riepilogo P&L · sim loop",
  },
  "dashboard.pulse.simLoop.portfolioPnl": {
    en: "Sim loop · Total P&L",
    it: "Sim loop · P&L totale",
  },
  "dashboard.pulse.simLoop.deltaTip": {
    en: "Total sim loop P&L change since the last time you left this view.",
    it: "Variazione del P&L totale sim loop da quando hai lasciato questa vista l'ultima volta.",
  },
  "dashboard.pulse.simLoop.chartTitle": {
    en: "Gain vs plan · sim loop (€)",
    it: "Gain vs piano · sim loop (€)",
  },
  "dashboard.pulse.simLoop.chartCaption": {
    en: "Hold-day axis (d0…now) — same as Portfolio pulse · dashed = plan today · solid green = paper sim actual €.",
    it: "Asse per giorni di hold (g0…ora) — come Portfolio pulse · tratteggio = piano oggi · verde = € reali paper sim.",
  },
  "dashboard.pulse.simLoop.footnote": {
    en: "Same panel as Portfolio but computed on the sim loop's paper positions. Use ⇄ Portfolio to switch back.",
    it: "Stesso pannello del Portfolio ma calcolato sulle posizioni paper del sim loop. Usa ⇄ Portfolio per tornare.",
  },
  "dashboard.pulse.simLoop.switchEqualLabel": {
    en: "Sim loop",
    it: "Sim loop",
  },
  "dashboard.pulse.simLoop.switchEqualTip": {
    en: "Equal-weight paper sim loop (same cap per deal).",
    it: "Sim loop paper a peso uguale (stesso cap per deal).",
  },
  "dashboard.pulse.simLoopSynth.title": {
    en: "Sim loop · synth · Since your last visit",
    it: "Sim loop · synth · Dalla tua ultima visita",
  },
  "dashboard.pulse.simLoopSynth.sinceVisit": {
    en: "Synth-sized changes since {when}",
    it: "Cambiamenti synth dal {when}",
  },
  "dashboard.pulse.simLoopSynth.firstVisit": {
    en: "First visit on synth view — next time you'll see deltas vs this Weight Sim Exp mix.",
    it: "Prima visita vista synth — al prossimo ritorno vedrai i delta vs questo mix Weight Sim Exp.",
  },
  "dashboard.pulse.simLoopSynth.switchLabel": {
    en: "Synth",
    it: "Synth",
  },
  "dashboard.pulse.simLoopSynth.switchTip": {
    en: "Same panel with Weight Sim Exp sizing on the sim loop book (Cap Div pipeline).",
    it: "Stesso pannello con sizing Weight Sim Exp sul book sim loop (pipeline Cap Div).",
  },
  "dashboard.pulse.simLoopSynth.noPortfolio": {
    en: "No open paper positions in the sim loop.",
    it: "Nessuna posizione paper aperta nel sim loop.",
  },
  "dashboard.pulse.simLoopSynth.unavailable": {
    en: "Synth mix unavailable — need sim loop deals and Learning Lab approved weights.",
    it: "Mix synth non disponibile — servono deal nel sim loop e pesi approvati in Learning Lab.",
  },
  "dashboard.pulse.simLoopSynth.kpiTitle": {
    en: "Sim loop · synth P&L summary",
    it: "Riepilogo P&L · sim loop synth",
  },
  "dashboard.pulse.simLoopSynth.portfolioPnl": {
    en: "Sim loop (synth) · Total P&L",
    it: "Sim loop (synth) · P&L totale",
  },
  "dashboard.pulse.simLoopSynth.deltaTip": {
    en: "Synth-sized sim loop P&L change since you last left this view.",
    it: "Variazione P&L sim loop con sizing synth da quando hai lasciato questa vista.",
  },
  "dashboard.pulse.simLoopSynth.chartTitle": {
    en: "Gain vs plan · sim loop synth (€)",
    it: "Gain vs piano · sim loop synth (€)",
  },
  "dashboard.pulse.simLoopSynth.chartCaption": {
    en: "Hold-day axis (d0…now) — same as Portfolio pulse · dashed = plan today · solid green = Weight Sim Exp sized actual €.",
    it: "Asse per giorni di hold (g0…ora) — come Portfolio pulse · tratteggio = piano oggi · verde = € reali con sizing Weight Sim Exp.",
  },
  "dashboard.pulse.simLoopSynth.footnote": {
    en: "Weight Sim Exp mix on the sim loop book — compare with equal-weight Sim loop and live Portfolio via ⇄ buttons.",
    it: "Mix Weight Sim Exp sul book sim loop — confronta con Sim loop equal e Portfolio live con i pulsanti ⇄.",
  },
  "dashboard.pulse.simLoopSynth.equalRefFootnote": {
    en: "Equal-weight reference (same trades, €{cap}/slot): {pnl}. Synth marks open positions at entry Weight Sim Exp until a new BUY; closed trades use share at entry.",
    it: "Riferimento equal-weight (stesse operazioni, €{cap}/slot): {pnl}. Il synth marca le posizioni aperte col peso all'ingresso fino a un nuovo BUY; le chiusure col peso all'ingresso.",
  },
  "dashboard.pulse.simLoopSynth.reconcile.title": {
    en: "Equal vs synth breakdown",
    it: "Breakdown equal vs synth",
  },
  "dashboard.pulse.simLoopSynth.reconcile.subtitle": {
    en: "Δ synth − equal {delta} · click to expand",
    it: "Δ synth − equal {delta} · clicca per espandere",
  },
  "dashboard.pulse.simLoopSynth.reconcile.signMismatch": {
    en: "Total P&L sign differs between equal and synth — check closed rows (entry share) vs open rows (live Weight Sim Exp).",
    it: "Il segno del P&L totale differisce tra equal e synth — controlla le righe chiuse (peso ingresso) vs aperte (Weight Sim Exp corrente).",
  },
  "dashboard.pulse.simLoopSynth.reconcile.openPnl": {
    en: "Open MTM",
    it: "MTM aperto",
  },
  "dashboard.pulse.simLoopSynth.reconcile.closedPnl": {
    en: "Closed realized",
    it: "Chiuso realizzato",
  },
  "dashboard.pulse.simLoopSynth.reconcile.totalPnl": {
    en: "Total P&L",
    it: "P&L totale",
  },
  "dashboard.pulse.simLoopSynth.reconcile.colStatus": {
    en: "Status",
    it: "Stato",
  },
  "dashboard.pulse.simLoopSynth.reconcile.colEqualCap": {
    en: "Equal cap",
    it: "Cap equal",
  },
  "dashboard.pulse.simLoopSynth.reconcile.colSynthCap": {
    en: "Synth cap",
    it: "Cap synth",
  },
  "dashboard.pulse.simLoopSynth.reconcile.colShareEntry": {
    en: "Share in",
    it: "Peso in",
  },
  "dashboard.pulse.simLoopSynth.reconcile.colShareEntryTip": {
    en: "Weight Sim Exp share snapshot when the position first entered the paper book.",
    it: "Snapshot peso Weight Sim Exp quando la posizione è entrata nel book paper.",
  },
  "dashboard.pulse.simLoopSynth.reconcile.colShareLive": {
    en: "Share now",
    it: "Peso ora",
  },
  "dashboard.pulse.simLoopSynth.reconcile.colShareLiveTip": {
    en: "Current Weight Sim Exp share — used for open MTM.",
    it: "Peso Weight Sim Exp corrente — usato per MTM aperto.",
  },
  "dashboard.pulse.simLoopSynth.reconcile.colClosedEqual": {
    en: "Closed € eq",
    it: "Chiuso € eq",
  },
  "dashboard.pulse.simLoopSynth.reconcile.colClosedSynth": {
    en: "Closed € syn",
    it: "Chiuso € syn",
  },
  "dashboard.pulse.simLoopSynth.reconcile.colOpenEqual": {
    en: "Open € eq",
    it: "Aperto € eq",
  },
  "dashboard.pulse.simLoopSynth.reconcile.colOpenSynth": {
    en: "Open € syn",
    it: "Aperto € syn",
  },
  "dashboard.pulse.simLoopSynth.reconcile.statusOpen": {
    en: "Open",
    it: "Aperto",
  },
  "dashboard.pulse.simLoopSynth.reconcile.statusClosed": {
    en: "Closed",
    it: "Chiuso",
  },
  "dashboard.pulse.simLoopSynth.reconcile.noEntryShare": {
    en: "{n} closed ticker(s) use live share fallback — no entry snapshot yet.",
    it: "{n} ticker chiusi usano peso live di fallback — nessuno snapshot all'ingresso.",
  },
  "dashboard.pulse.chartCaption": {
    en: "Dashed = planned curve to today · solid green = actual € to today. No future projection — updates on each refresh.",
    it: "Tratteggio = curva piano fino a oggi · verde = € reali fino a oggi. Nessuna proiezione futura — si aggiorna a ogni refresh.",
  },
  "dashboard.pulse.chartEmpty": {
    en: "Not enough history yet — snapshot builds after refresh cycles.",
    it: "Storico insufficiente — si forma dopo i refresh.",
  },
  "dashboard.pulse.planActual": {
    en: "Actual P&L now",
    it: "P&L reale ora",
  },
  "dashboard.pulse.planActualTip": {
    en: "Live MTM on open positions — used vs the planned gain curve (not cumulative 24h sum).",
    it: "MTM live sulle posizioni aperte — confronto con la curva piano (non somma cumulativa 24h).",
  },
  "dashboard.pulse.planLabel": {
    en: "Plan",
    it: "Piano",
  },
  "dashboard.pulse.planGap": {
    en: "Plan gap (actual − plan)",
    it: "Scostamento piano (reale − piano)",
  },
  "dashboard.pulse.planGapTip": {
    en: "Gap vs plan today (actual − planned €) — NOT expected ROI. Positive = ahead of today's plan curve. % hidden below €500 capital (too noisy).",
    it: "Scostamento vs piano oggi (reale − piano €) — NON è il ROI atteso. Positivo = avanti rispetto alla curva piano di oggi. % nascosta sotto €500 capitale (rumore).",
  },
  "dashboard.pulse.colPlanGap": {
    en: "Δ plan",
    it: "Δ piano",
  },
  "dashboard.pulse.firstVisitShort": {
    en: "saved on exit",
    it: "salvato all'uscita",
  },
  "dashboard.title.portfolio": {
    en: "Active Investments",
    it: "Investimenti attivi",
  },
  "dashboard.title.topOpps": {
    en: "Opportunities (within 2 months of CD)",
    it: "Opportunità (entro 2 mesi dal CD)",
  },
  "dashboard.fromDecisionLab": {
    en: " · hot zone Top (Decision Lab)",
    it: " · hot Top zona calda (Decision Lab)",
  },
  "dashboard.fromSimulation": {
    en: " · off-portfolio · CD within 60 days",
    it: " · fuori portafoglio · CD entro 60 giorni",
  },
  "dashboard.topOpps.emptyHint": {
    en: " · none in hot zone",
    it: " · nessuna in zona calda",
  },
  "dashboard.topOpps.emptyBody": {
    en: "No opportunities in the hot zone — off-portfolio tickers need a completion date within the next 60 days.",
    it: "Nessuna opportunità in zona calda — servono titoli fuori portafoglio con CD entro i prossimi 60 giorni.",
  },
  "dashboard.col.price": {
    en: "Price $",
    it: "Price $",
  },
  "dashboard.col.roi": {
    en: "ROI",
    it: "ROI",
  },
  "dashboard.col.roiDays": {
    en: "Days to ROI",
    it: "Giorni ROI",
  },
  "dashboard.col.roiDaysTip": {
    en: "Expected calendar days to catalyst (CD) for the estimated ROI",
    it: "Giorni calendario attesi al CD per il ROI stimato",
  },
  "dashboard.col.curve": {
    en: "Curve",
    it: "Curva",
  },
  "dashboard.col.pnl": {
    en: "P&L",
    it: "P&L",
  },
  "dashboard.focus.completionDate": {
    en: "Completion date",
    it: "Data CD",
  },
  "dashboard.focus.completionDateTip": {
    en: "Completion Date (catalyst)",
    it: "Completion Date (catalizzatore)",
  },
  "dashboard.focus.cdToday": {
    en: "today",
    it: "oggi",
  },
  "dashboard.focus.cdInDays": {
    en: "in {n} d",
    it: "tra {n} g",
  },
  "dashboard.focus.cdDaysAgo": {
    en: "{n} d ago",
    it: "{n} g fa",
  },
  "dashboard.focus.price": {
    en: "Stock price",
    it: "Prezzo",
  },
  "dashboard.focus.pred7": {
    en: "Pred +7",
    it: "Pred +7",
  },
  "dashboard.focus.reliability": {
    en: "Reliability",
    it: "Affidabilità",
  },
  "dashboard.focus.roiPerDay": {
    en: "ROI / day",
    it: "ROI / giorno",
  },
  "dashboard.focus.roiPerDayTip": {
    en: "Expected return % per calendar day (target rise segment when available)",
    it: "Rendimento % atteso per giorno calendario (target salita se disponibile)",
  },

  // ── Portfolio refresh alerts (modal + diff) ───────────────────────────────
  "morningDiscovery.modal.title": {
    en: "Morning updates — new IPO & catalysts",
    it: "Aggiornamenti mattutini — nuove IPO e catalyst",
  },
  "morningDiscovery.modal.subtitle": {
    en: "Changes detected since your last session (server refresh or new clinical data).",
    it: "Novità rispetto all’ultima sessione (refresh server o nuovi dati clinici).",
  },
  "clinicalFeedRefresh.modal.title": {
    en: "Clinical feed & EIS updated",
    it: "Feed clinico & EIS aggiornati",
  },
  "clinicalFeedRefresh.modal.subtitle": {
    en: "Scheduled morning refresh (Mon–Fri ~10:00) — new or updated pre-CD events with EIS scores.",
    it: "Refresh mattutino schedulato (lun–ven ~10:00) — eventi pre-CD nuovi o aggiornati con punteggi EIS.",
  },
  "clinicalFeedRefresh.alert.new.title": {
    en: "New feed entry · {ticker}",
    it: "Nuova voce feed · {ticker}",
  },
  "clinicalFeedRefresh.alert.new.detail": {
    en: "CD {cd} · EIS events: {eisCount} (top {topEis})",
    it: "CD {cd} · eventi EIS: {eisCount} (max {topEis})",
  },
  "clinicalFeedRefresh.alert.updated.title": {
    en: "Feed updated · {ticker}",
    it: "Feed aggiornato · {ticker}",
  },
  "clinicalFeedRefresh.alert.updated.detail": {
    en: "CD {cd} · EIS events: {eisCount} (top {topEis})",
    it: "CD {cd} · eventi EIS: {eisCount} (max {topEis})",
  },
  "clinicalFeedRefresh.alert.openFeed": {
    en: "Open clinical feed →",
    it: "Apri feed clinico →",
  },
  "clinicalFeedRefresh.alert.sourceLink": {
    en: "{label} →",
    it: "{label} →",
  },
  "clinicalFeedRefresh.alert.sourceLinkDefault": {
    en: "Open source →",
    it: "Apri fonte →",
  },
  "clinicalFeedRefresh.alert.more.title": {
    en: "More feed changes",
    it: "Altre modifiche feed",
  },
  "clinicalFeedRefresh.alert.more.detail": {
    en: "+{n} additional ticker/CD rows updated in this run.",
    it: "+{n} righe ticker/CD aggiuntive aggiornate in questo run.",
  },
  "morningDiscovery.alert.newSimRow.detail": {
    en: "New row in Simulation · CD in {days} days ({cd})",
    it: "Nuova riga in Simulation · CD tra {days} giorni ({cd})",
  },
  "morningDiscovery.alert.newSimRowFar.title": {
    en: "New trial (>4 months to CD)",
    it: "Nuovo trial (CD oltre 4 mesi)",
  },
  "morningDiscovery.alert.newSimRowFar.detail": {
    en: "Added to Simulation · CD in {days} days ({cd}) — beyond the 4-month hot window",
    it: "Aggiunto a Simulation · CD tra {days} giorni ({cd}) — oltre la finestra calda 4 mesi",
  },
  "morningDiscovery.alert.newIpo.title": {
    en: "New biotech IPO",
    it: "Nuova IPO biotech",
  },
  "morningDiscovery.alert.newIpo.detail": {
    en: "{ticker} — {name} (IPO {ipoDate}) · IPO price {ipoPrice}",
    it: "{ticker} — {name} (IPO {ipoDate}) · prezzo IPO {ipoPrice}",
  },
  "morningDiscovery.alert.newIpo.website": {
    en: "Company website →",
    it: "Sito web società →",
  },
  "morningDiscovery.alert.newIpoBatch.title": {
    en: "New biotech IPOs",
    it: "Nuove IPO biotech",
  },
  "morningDiscovery.alert.newIpoBatch.detail": {
    en: "{count} new companies added to the universe (morning scan).",
    it: "{count} nuove società aggiunte all’universo (scan mattutino).",
  },
  "portfolioRefresh.modal.title": {
    en: "Portfolio changes after refresh",
    it: "Variazioni portafoglio dopo l'aggiornamento",
  },
  "portfolioRefresh.modal.subtitle": {
    en: "Compared to your portfolio before the refresh. Review direction shifts, momentum, and buy/sell urgency.",
    it: "Confronto con il portafoglio prima dell'aggiornamento. Controlla direzione, momentum e urgenza acquisto/vendita.",
  },
  "portfolioRefresh.modal.empty": {
    en: "No material portfolio changes detected versus the pre-refresh snapshot.",
    it: "Nessuna variazione rilevante rispetto allo snapshot pre-aggiornamento.",
  },
  "portfolioRefresh.modal.gotIt": {
    en: "Got it",
    it: "Ho capito",
  },
  "portfolioRefresh.severity.urgent": {
    en: "Urgent",
    it: "Urgente",
  },
  "portfolioRefresh.severity.attention": {
    en: "Attention",
    it: "Attenzione",
  },
  "portfolioRefresh.severity.update": {
    en: "Update",
    it: "Aggiornamento",
  },
  "portfolioRefresh.count.urgent": {
    en: "{n} urgent",
    it: "{n} urgenti",
  },
  "portfolioRefresh.count.warnings": {
    en: "{n} warnings",
    it: "{n} avvisi",
  },
  "portfolioRefresh.summary.now": {
    en: "Portfolio now: €{value} on €{capital} invested ({pnlPct}) · {n} positions",
    it: "Portafoglio: €{value} su €{capital} investiti ({pnlPct}) · {n} posizioni",
  },
  "portfolioRefresh.summary.noPositions": {
    en: "No active positions with capital and buy price.",
    it: "Nessuna posizione attiva con capitale e prezzo di acquisto.",
  },
  "portfolioRefresh.alert.closed.title": {
    en: "Position closed",
    it: "Posizione chiusa",
  },
  "portfolioRefresh.alert.closed.detail": {
    en: "Capital was removed from {ticker} (was {pnl} P&L).",
    it: "Capitale rimosso da {ticker} (P&L era {pnl}).",
  },
  "portfolioRefresh.alert.newPos.title": {
    en: "New portfolio position",
    it: "Nuova posizione in portafoglio",
  },
  "portfolioRefresh.alert.newPos.detail": {
    en: "€{capital} at buy ${price}.",
    it: "€{capital} a prezzo acquisto ${price}.",
  },
  "portfolioRefresh.alert.dir.title": {
    en: "Model direction changed",
    it: "Direzione modello cambiata",
  },
  "portfolioRefresh.alert.dir.detail": {
    en: "Pred +5: {before} → {after} ({predBefore} → {predAfter}).",
    it: "Pred +5: {before} → {after} ({predBefore} → {predAfter}).",
  },
  "portfolioRefresh.alert.curve.title": {
    en: "Curve trend flipped",
    it: "Trend curva invertito",
  },
  "portfolioRefresh.alert.curve.detail": {
    en: "Short-term slope: {before} → {after} ({slopeBefore} → {slopeAfter} pp/d).",
    it: "Pendenza breve: {before} → {after} ({slopeBefore} → {slopeAfter} pp/g).",
  },
  "portfolioRefresh.alert.reversal.title": {
    en: "Slope reversal",
    it: "Inversione pendenza",
  },
  "portfolioRefresh.alert.reversal.detail": {
    en: "Trend5d {t5} vs trend20d {t20} — consider exit.",
    it: "Trend5d {t5} vs trend20d {t20} — valuta uscita.",
  },
  "portfolioRefresh.alert.decel.title": {
    en: "Momentum decelerating",
    it: "Momentum in rallentamento",
  },
  "portfolioRefresh.alert.decel.detail": {
    en: "Slope gap {before} → {after} pp/d (Δ {delta}).",
    it: "Gap pendenza {before} → {after} pp/g (Δ {delta}).",
  },
  "portfolioRefresh.alert.accel.title": {
    en: "Momentum accelerating",
    it: "Momentum in accelerazione",
  },
  "portfolioRefresh.alert.accel.detail": {
    en: "Slope gap {before} → {after} pp/d (Δ +{delta}).",
    it: "Gap pendenza {before} → {after} pp/g (Δ +{delta}).",
  },
  "portfolioRefresh.alert.stop.title": {
    en: "Stop loss — sell now",
    it: "Stop loss — vendi ora",
  },
  "portfolioRefresh.alert.stop.detail": {
    en: "P&L {pnl} below −8% threshold.",
    it: "P&L {pnl} sotto soglia −8%.",
  },
  "portfolioRefresh.alert.sellUrgent.title": {
    en: "Urgent sell signal",
    it: "Segnale vendita urgente",
  },
  "portfolioRefresh.alert.sellUrgent.detail": {
    en: "Slope reversal on an open position — review exit immediately.",
    it: "Inversione pendenza su posizione aperta — valuta uscita immediata.",
  },
  "portfolioRefresh.alert.takeProfit.title": {
    en: "Consider taking profit",
    it: "Valuta presa di profitto",
  },
  "portfolioRefresh.alert.takeProfit.detail": {
    en: "P&L {pnl}{cdSuffix}",
    it: "P&L {pnl}{cdSuffix}",
  },
  "portfolioRefresh.alert.takeProfit.cdSuffix": {
    en: " · CD in {days}d",
    it: " · CD tra {days} g",
  },
  "portfolioRefresh.alert.buyNow.title": {
    en: "Strong buy — act now",
    it: "Acquisto forte — agisci ora",
  },
  "portfolioRefresh.alert.buyNow.detail": {
    en: "High score signal · Pred {pred}{cdSuffix}",
    it: "Segnale score alto · Pred {pred}{cdSuffix}",
  },
  "portfolioRefresh.alert.pnl.title": {
    en: "P&L moved since refresh",
    it: "P&L variato dopo l'aggiornamento",
  },
  "portfolioRefresh.alert.pnl.detail": {
    en: "{pnlBefore} → {pnlAfter} (€{eurBefore} → €{eurAfter}).",
    it: "{pnlBefore} → {pnlAfter} (€{eurBefore} → €{eurAfter}).",
  },
  "portfolioRefresh.alert.buyNotHeld.title": {
    en: "Strong buy — not in portfolio",
    it: "Acquisto forte — non in portafoglio",
  },
  "portfolioRefresh.alert.buyNotHeld.detail": {
    en: "New strong signal after refresh · Pred {pred}{cdSuffix}",
    it: "Nuovo segnale forte post-aggiornamento · Pred {pred}{cdSuffix}",
  },
  "portfolioRefresh.alert.newSimRow.title": {
    en: "New catalyst in Simulation",
    it: "Nuovo catalyst in Simulation",
  },
  "portfolioRefresh.alert.newSimRow.detail": {
    en: "New ticker|CD row after refresh · Pred {pred}",
    it: "Nuova riga ticker|CD dopo l'aggiornamento · Pred {pred}",
  },
  "portfolioRefresh.alert.cdChanged.title": {
    en: "Completion Date updated",
    it: "Completion Date aggiornata",
  },
  "portfolioRefresh.alert.cdChanged.detail": {
    en: "CD moved from {before} to {after}.",
    it: "CD spostata da {before} a {after}.",
  },
  "portfolioRefresh.alert.newBiotech.title": {
    en: "New biotech ticker",
    it: "Nuovo ticker biotech",
  },
  "portfolioRefresh.alert.newBiotech.detail": {
    en: "{ticker} added to the local universe (discovery/extra/IPO).",
    it: "{ticker} aggiunto all'universo locale (discovery/extra/IPO).",
  },
  "portfolioRefresh.alert.newCdOrchestrator.title": {
    en: "New catalyst (Exact/Partial)",
    it: "Nuovo catalyst (Exact/Partial)",
  },
  "portfolioRefresh.alert.newCdOrchestrator.detail": {
    en: "New cohort entry · {match} · {relation}",
    it: "Nuova voce in coorte · {match} · {relation}",
  },
  "portfolioRefresh.alert.cdImminent.title": {
    en: "Catalyst within 3 days",
    it: "Catalyst entro 3 giorni",
  },
  "portfolioRefresh.alert.cdImminent.detailHeld": {
    en: "Completion in {days}d — open position, review exit timing.",
    it: "Completion tra {days}g — posizione aperta, rivedi timing uscita.",
  },
  "portfolioRefresh.alert.cdImminent.detailWatch": {
    en: "Completion in {days}d — watchlist row approaching catalyst.",
    it: "Completion tra {days}g — riga watchlist in avvicinamento al catalyst.",
  },
  "portfolioRefresh.alert.sustainedDecline.title": {
    en: "Sustained decline",
    it: "Calo sostenuto",
  },
  "portfolioRefresh.alert.sustainedDecline.detailHeld": {
    en: "5d {t5} · 20d {t20} — both negative, worsened since refresh. Review exit.",
    it: "5g {t5} · 20g {t20} — entrambe negative, peggiorate dal refresh. Valuta uscita.",
  },
  "portfolioRefresh.alert.sustainedDecline.detailWatch": {
    en: "5d {t5} · 20d {t20} — watch slowdown before entry.",
    it: "5g {t5} · 20g {t20} — watch, rallentamento prima dell'ingresso.",
  },

  // ── Portfolio loss urgent modal ───────────────────────────────────────────
  "portfolioLoss.modal.title.exit": {
    en: "Urgent — sell {ticker} now",
    it: "Urgente — vendi {ticker} ora",
  },
  "portfolioLoss.modal.title.hold": {
    en: "Wait — {ticker} in loss, curve rising",
    it: "Attendi — {ticker} in perdita, curva in salita",
  },
  "portfolioLoss.modal.title.review": {
    en: "Monitor — {ticker} in loss",
    it: "Monitora — {ticker} in perdita",
  },
  "portfolioLoss.modal.subtitle.exit": {
    en: "The model sees sustained decline or negative target — consider exiting to limit loss.",
    it: "Il modello vede pendenza in calo o target negativo — valuta l'uscita per limitare la perdita.",
  },
  "portfolioLoss.modal.subtitle.hold": {
    en: "You're below entry price, but the curve still points up toward target. No rush to sell — watch the slope.",
    it: "Sei sotto il prezzo di ingresso, ma la curva punta ancora verso il target. Nessuna urgenza di vendere — osserva la pendenza.",
  },
  "portfolioLoss.modal.subtitle.review": {
    en: "Open position in loss. Check curves and slope errors before deciding.",
    it: "Posizione aperta in perdita. Controlla curve e slope errors prima di decidere.",
  },
  "portfolioLoss.modal.capital": {
    en: "€{cap} invested",
    it: "€{cap} investiti",
  },
  "portfolioLoss.modal.slopes": {
    en: "Slopes · 5d {s5} · 20d {s20} pp/day",
    it: "Pendenze · 5g {s5} · 20g {s20} pp/g",
  },
  "portfolioLoss.modal.close": {
    en: "Close",
    it: "Chiudi",
  },
  "portfolioLoss.modal.preparing": {
    en: "Loading curve data for this alert…",
    it: "Caricamento curve per l'avviso…",
  },
  "portfolioLoss.modal.positionOf": {
    en: "Position {n} of {total}",
    it: "Posizione {n} di {total}",
  },
  "portfolioLoss.modal.recommendation.exit": {
    en: "Sell now to limit further drawdown. Inspect slope errors and prediction curves below before acting.",
    it: "Vendi ora per limitare ulteriori perdite. Ispeziona slope errors e curve sotto prima di agire.",
  },
  "portfolioLoss.modal.recommendation.hold": {
    en: "Hold and wait for the model target — the curve is still rising. Sell only if the slope turns down.",
    it: "Rimani e attendi il target del modello — la curva è ancora in salita. Vendi solo se la pendenza gira verso il basso.",
  },
  "portfolioLoss.modal.recommendation.review": {
    en: "No immediate sell signal — monitor the position and review the charts below.",
    it: "Nessun segnale di vendita immediata — monitora la posizione e rivedi i grafici sotto.",
  },
  "portfolioLoss.modal.chart.pred": {
    en: "Model + recalibration",
    it: "Modello + ricalibrazione",
  },
  "portfolioLoss.modal.chart.slope": {
    en: "Slope errors",
    it: "Slope errors",
  },
  "portfolioLoss.modal.noChart": {
    en: "Chart data not available.",
    it: "Dati grafico non disponibili.",
  },
  "portfolioLoss.modal.slopeMissing": {
    en: "Insufficient price history for slope trajectory.",
    it: "Storico prezzi insufficiente per la traiettoria slope.",
  },
  "portfolioLoss.modal.action.sellSim": {
    en: "Sell in Simulation →",
    it: "Vendi in Simulation →",
  },
  "portfolioLoss.modal.action.slope": {
    en: "Slope errors tab →",
    it: "Tab Slope errors →",
  },
  "portfolioLoss.modal.action.curves": {
    en: "Prediction curves →",
    it: "Curve predizione →",
  },
  "portfolioLoss.modal.action.lossTab": {
    en: "In Loss tab →",
    it: "Tab In perdita →",
  },
  "portfolioLoss.modal.action.eis": {
    en: "EIS details →",
    it: "Dettaglio EIS →",
  },
  "portfolioLoss.modal.dismissTicker": {
    en: "Don't show again for {ticker}",
    it: "Non mostrare più per {ticker}",
  },
  "portfolioLoss.modal.acknowledge": {
    en: "I've read this — close",
    it: "Ho letto — chiudi",
  },

  "modalCharts.horizonBanner.modals": {
    en: "Two horizons: sparkline = absolute pre-CD curve forward to ~T+7 (short); slope = % vs today to T+90 post-CD (long). They can disagree — slope drives exit/hold on the long view.",
    it: "Due orizzonti: sparkline = curva assoluta pre-CD fino ~T+7 (breve); slope = % vs oggi fino T+90 post-CD (lungo). Possono divergere — la slope guida exit/hold sulla vista lunga.",
  },
  "modalCharts.horizonBanner.lossAnalysis": {
    en: "Short view (pred blend): % vs today to ~T+7. Long view (slope): same anchor, extended to T+90 post-CD. Gain plan tracks € vs entry.",
    it: "Vista breve (pred blend): % vs oggi fino ~T+7. Vista lunga (slope): stesso anchor, esteso a T+90 post-CD. Gain plan = € vs ingresso.",
  },
  "modalCharts.caption.pred": {
    en: "Absolute pre-CD curve · forward to ~T+7 · color = short-term trend",
    it: "Curva assoluta pre-CD · forward fino ~T+7 · colore = trend breve",
  },
  "modalCharts.caption.slope": {
    en: "% vs today · model to T+90 post-CD (long horizon)",
    it: "% vs oggi · modello fino T+90 post-CD (orizzonte lungo)",
  },
  "modalCharts.caption.gainPlan": {
    en: "Actual € gain vs recalibrated plan from entry",
    it: "Gain € reale vs piano ricalibrato dall'ingresso",
  },
  "modalCharts.caption.gainPlanRecovery": {
    en: "Recovery marker at ~{days}d to plan target",
    it: "Marker recupero a ~{days}g sul target piano",
  },
  "modalCharts.caption.pattern": {
    en: "CD pattern arc · match {pct}% vs cohort",
    it: "Arco pattern CD · match {pct}% vs coorte",
  },
  "modalCharts.caption.patternMissing": {
    en: "CD pattern data unavailable",
    it: "Dati pattern CD non disponibili",
  },
  "modalCharts.caption.mii": {
    en: "Market slope (MII) vs recalibrated model — gap and calibration.",
    it: "Pendenza mercato (MII) vs modello ricalibrato — gap e calibrazione.",
  },

  "recommendationAlert.title.buy": {
    en: "New recommendation — BUY",
    it: "Nuova raccomandazione — BUY",
  },
  "recommendationAlert.title.sell": {
    en: "New recommendation — SELL",
    it: "Nuova raccomandazione — SELL",
  },
  "recommendationAlert.title.hold": {
    en: "Hold — wait for recovery",
    it: "Hold — attendi recupero",
  },
  "recommendationAlert.title.holdPortfolio": {
    en: "Hold — do not sell",
    it: "Mantieni — non vendere",
  },
  "recommendationAlert.title.review": {
    en: "Review — check exposure",
    it: "Review — verifica esposizione",
  },
  "recommendationAlert.title.synthTrim": {
    en: "Urgent — reduce synth exposure",
    it: "Urgente — riduci esposizione synth",
  },
  "recommendationAlert.title.synthSell": {
    en: "Urgent — synth confirms exit",
    it: "Urgente — synth conferma uscita",
  },
  "recommendationAlert.whySynthTrim": {
    en: "Synth exposure",
    it: "Esposizione synth",
  },
  "recommendationAlert.trimToSynth": {
    en: "Trim to {amount}",
    it: "Riduci a {amount}",
  },
  "synthSyncSummary.title": {
    en: "Synth alignment complete",
    it: "Allineamento synth completato",
  },
  "synthSyncSummary.subtitle": {
    en: "{n} position(s) updated — capital adjusted to Weight Sim Exp targets.",
    it: "{n} posizione/i aggiornata/e — capitale allineato ai target Weight Sim Exp.",
  },
  "synthSyncSummary.sourceBulk": {
    en: "Sync → Synth (bulk)",
    it: "Sync → Synth (bulk)",
  },
  "synthSyncSummary.sourceManual": {
    en: "Manual sync",
    it: "Sync manuale",
  },
  "synthSyncSummary.upsizedBadge": {
    en: "↑ {n} increased",
    it: "↑ {n} aumentate",
  },
  "synthSyncSummary.trimmedBadge": {
    en: "↓ {n} reduced",
    it: "↓ {n} ridotte",
  },
  "synthSyncSummary.upsizedSection": {
    en: "Partial buy (capital ↑)",
    it: "Buy parziale (capitale ↑)",
  },
  "synthSyncSummary.trimmedSection": {
    en: "Partial trim (capital ↓)",
    it: "Trim parziale (capitale ↓)",
  },
  "synthSyncSummary.colTicker": {
    en: "Ticker",
    it: "Ticker",
  },
  "synthSyncSummary.colFrom": {
    en: "From",
    it: "Da",
  },
  "synthSyncSummary.colTo": {
    en: "To",
    it: "A",
  },
  "synthSyncSummary.colDelta": {
    en: "Δ",
    it: "Δ",
  },
  "synthSyncSummary.footerNote": {
    en: "Capital € was updated in Simulation. Full Sell is separate — see Synth history per row or use ↩ Synth revert to undo.",
    it: "Capitale € aggiornato in Simulation. Sell completo resta separato — vedi Storico synth per riga o ↩ Annulla synth per tornare indietro.",
  },
  "synthSyncSummary.acknowledge": {
    en: "OK",
    it: "OK",
  },
  "recommendationAlert.probAction.buy": {
    en: "BUY",
    it: "BUY",
  },
  "recommendationAlert.chart.predCaption": {
    en: "Absolute pre-CD curve · forward to ~T+7 · color = short-term trend",
    it: "Curva assoluta pre-CD · forward fino ~T+7 · colore = trend breve",
  },
  "recommendationAlert.chart.slopeCaption": {
    en: "% vs today · model to T+90 post-CD (long horizon)",
    it: "% vs oggi · modello fino T+90 post-CD (orizzonte lungo)",
  },
  "recommendationAlert.chart.gainHoldCaption": {
    en: "Recovery marker at plan target days",
    it: "Marker recupero sui giorni target piano",
  },
  "recommendationAlert.subtitle": {
    en: "System suggests {action} on this {profile} line — curves, scores and pipeline below.",
    it: "Il sistema suggerisce {action} su questa riga {profile} — curve, score e pipeline sotto.",
  },
  "recommendationAlert.subtitle.holdPortfolio": {
    en: "Position already open — system suggests holding, not selling. Curves, scores and pipeline below.",
    it: "Posizione già aperta — il sistema suggerisce di mantenere, non di vendere. Curve, score e pipeline sotto.",
  },
  "recommendationAlert.whyBuy": {
    en: "Why BUY",
    it: "Perché BUY",
  },
  "recommendationAlert.whyHoldPortfolio": {
    en: "Why hold (not sell)",
    it: "Perché mantenere (non vendere)",
  },
  "recommendationAlert.whySell": {
    en: "Why SELL",
    it: "Perché SELL",
  },
  "recommendationAlert.holdThesis": {
    en: "Hold thesis",
    it: "Tesi hold",
  },
  "recommendationAlert.compositeScore": {
    en: "Composite score ({zone}): {score}/100{dampened}",
    it: "Score composito ({zone}): {score}/100{dampened}",
  },
  "recommendationAlert.compositeDrivers": {
    en: "Top drivers: {drivers}",
    it: "Driver principali: {drivers}",
  },
  "recommendationAlert.compositeDampened": {
    en: " (dampened)",
    it: " (penalizzato)",
  },
  "recommendationAlert.scoringZone.hot": {
    en: "hot",
    it: "hot",
  },
  "recommendationAlert.scoringZone.watch": {
    en: "watch",
    it: "watch",
  },
  "recommendationAlert.scoringZone.early": {
    en: "early",
    it: "early",
  },
  "recommendationAlert.scoringZone.loss": {
    en: "loss",
    it: "loss",
  },
  "recommendationAlert.preparing": {
    en: "Loading charts…",
    it: "Caricamento grafici…",
  },
  "recommendationAlert.close": {
    en: "Close",
    it: "Chiudi",
  },
  "recommendationAlert.positionOf": {
    en: "Recommendation {n} of {total}",
    it: "Raccomandazione {n} di {total}",
  },
  "recommendationAlert.misalignments": {
    en: "Misalignments",
    it: "Disallineamenti",
  },
  "recommendationAlert.openSimulation": {
    en: "Open row in Simulation tab",
    it: "Apri riga nel tab Simulation",
  },
  "recommendationAlert.acknowledge": {
    en: "Viewed — don't show again",
    it: "Visionata — non mostrare più",
  },

  // ── Catalyst Hub strip / tabs ─────────────────────────────────────────────
  "catalystHub.upcoming": {
    en: "Upcoming",
    it: "In arrivo",
  },
  "catalystHub.inDays": {
    en: "in {days} days",
    it: "tra {days} giorni",
  },
  "catalystHub.inDaysUrgent": {
    en: "⚡ in {days}d",
    it: "⚡ tra {days} g",
  },
  "catalystHub.predD7": {
    en: "D+7 pred.",
    it: "Pred. D+7",
  },
  "catalystHub.tab.curves": {
    en: "Price curves",
    it: "Curve prezzo",
  },
  "catalystHub.tab.slopeErrors": {
    en: "Slope alerts",
    it: "Alert pendenza",
  },
  "catalystHub.tab.slopeErrorsCount": {
    en: "Slope alerts ({n})",
    it: "Alert pendenza ({n})",
  },
  "catalystHub.tab.marketSlopes": {
    en: "Market vs model",
    it: "Mercato vs modello",
  },
  "catalystHub.tab.portfolioStatus": {
    en: "Portfolio status",
    it: "Stato portfolio",
  },
  "catalystHub.tab.portfolioStatusCount": {
    en: "Portfolio ({n})",
    it: "Portfolio ({n})",
  },
  "catalystHub.simRows": {
    en: "{n} Simulation rows",
    it: "{n} righe Simulation",
  },
  "catalyst.signal.long": {
    en: "▲ Long",
    it: "▲ Long",
  },
  "catalyst.signal.short": {
    en: "▼ Short",
    it: "▼ Short",
  },
  "catalyst.signal.neutral": {
    en: "● Neutral",
    it: "● Neutro",
  },
  "catalyst.signal.strong": {
    en: "★ ",
    it: "★ ",
  },

  // ── Advice learning loop ────────────────────────────────────────────────────
  "adviceLearning.timeline.title": {
    en: "Recommendation quality — learning timeline",
    it: "Qualità raccomandazioni — timeline di apprendimento",
  },
  "adviceLearning.timeline.lead": {
    en: "Tracks how the advice-success rate evolves as the system observes errors and applies bucket corrections / action demotions. Diamonds = manual 'Apply learnings' checkpoints.",
    it: "Traccia come il success rate dei consigli evolve mentre il sistema osserva gli errori e applica correzioni per bucket o declassamenti d'azione. I rombi = checkpoint manuali 'Applica apprendimenti'.",
  },
  "adviceLearning.timeline.legendHint": {
    en: "Solid line: overall success. Dashed: low-/high-P(plan) bands. Thin sky line: 24h direction KPI. Reference line at 50% = coin flip.",
    it: "Linea piena: successo complessivo. Tratteggiata: bande P(plan) basse/alte. Linea sky sottile: KPI direzione 24h. Linea di riferimento a 50% = lancio della moneta.",
  },
  "adviceLearning.timeline.empty": {
    en: "No learning checkpoints yet. Open the Decision Sim → P(plan) vs forecast error panel and click 'Apply learnings' to record the first checkpoint.",
    it: "Nessun checkpoint di apprendimento ancora. Apri Decision Sim → P(plan) vs forecast error e clicca 'Applica apprendimenti' per registrare il primo.",
  },
  "adviceLearning.timeline.notEnough": {
    en: "Only one checkpoint recorded. Come back tomorrow (auto-snapshot once per day) or apply a fresh learning checkpoint to draw the trend.",
    it: "Un solo checkpoint registrato. Torna domani (auto-snapshot 1×/giorno) oppure applica un nuovo checkpoint per disegnare il trend.",
  },
  "adviceLearning.timeline.reset": {
    en: "Clear history",
    it: "Cancella storico",
  },
  "adviceLearning.feedback.applyBtn": {
    en: "Apply learnings",
    it: "Applica apprendimenti",
  },
  "adviceLearning.feedback.applyBtnTip": {
    en: "Re-apply bucket corrections + action demotions now (also auto-saved when ≥5 scored advices and rules change). Records a manual learning checkpoint.",
    it: "Ri-applica subito correzioni bucket e declassamenti (si salvano anche in automatico con ≥5 consigli valutati e regole cambiate). Registra un checkpoint manuale.",
  },
  "adviceLearning.feedback.clearBtn": {
    en: "Clear corrections",
    it: "Rimuovi correzioni",
  },
  "adviceLearning.feedback.clearBtnTip": {
    en: "Remove every active bucket correction and action demotion — recommendations go back to raw P(plan).",
    it: "Rimuove tutte le correzioni per bucket e i declassamenti attivi — le raccomandazioni tornano a P(plan) raw.",
  },
  "adviceLearning.feedback.statusActive": {
    en: "Learnings active: {buckets} bucket corrections · {demotions} action demotions · applied {when}",
    it: "Apprendimenti attivi: {buckets} correzioni bucket · {demotions} declassamenti · applicati {when}",
  },
  "adviceLearning.feedback.statusIdle": {
    en: "No corrections active — recommendations use raw P(plan).",
    it: "Nessuna correzione attiva — le raccomandazioni usano P(plan) raw.",
  },
  "adviceLearning.feedback.statusInsufficient": {
    en: "Not enough scored advices yet to derive bucket corrections (need ≥5 scored per bucket).",
    it: "Pochi consigli valutati per derivare correzioni di bucket (servono ≥5 valutati per bucket).",
  },
  "adviceLearning.feedback.insightsSummary": {
    en: "Learnings & stats (P(plan) / SELL)",
    it: "Apprendimenti e statistiche (P(plan) / SELL)",
  },

  // ── View error boundary ─────────────────────────────────────────────────────
  "viewError.title": {
    en: "UI error",
    it: "Errore UI",
  },
  "viewError.titleWithLabel": {
    en: "{label} — UI error",
    it: "{label} — errore UI",
  },
  "viewError.chunkLoad": {
    en: "Desktop build out of sync. Close the app and run scripts\\Avvia_Biotech_Desktop.bat (rebuilds the UI).",
    it: "Build desktop non allineata. Chiudi l'app e rilancia scripts\\Avvia_Biotech_Desktop.bat (ricompila la UI).",
  },
  "viewError.retry": {
    en: "Retry",
    it: "Riprova",
  },
} as const;

export type TranslationKey = keyof typeof DICT;
