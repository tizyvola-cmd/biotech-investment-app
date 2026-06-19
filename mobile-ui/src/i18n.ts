import type { MobileLang } from "./langStorage";

const DICT = {
  "common.refresh": { en: "Refresh", it: "Aggiorna" },
  "common.refreshing": { en: "Refreshing…", it: "Aggiornamento…" },
  "common.updatedNow": { en: "updated now", it: "aggiornato ora" },
  "common.minAgo": { en: "{n}m ago", it: "{n}m fa" },
  "common.hAgo": { en: "{n}h ago", it: "{n}h fa" },
  "common.back": { en: "Back", it: "Indietro" },
  "common.close": { en: "Close", it: "Chiudi" },
  "common.save": { en: "Save", it: "Salva" },
  "common.online": { en: "Online", it: "Online" },
  "common.settings": { en: "Settings", it: "Impostazioni" },
  "common.language": { en: "Language", it: "Lingua" },
  "common.lang.en": { en: "English", it: "English" },
  "common.lang.it": { en: "Italiano", it: "Italiano" },
  "common.loading": { en: "Loading…", it: "Caricamento…" },

  "eis.sheetTitle": { en: "EIS · {ticker}", it: "EIS · {ticker}" },
  "eis.detailTitle": { en: "EIS detail · {ticker}", it: "EIS detail · {ticker}" },
  "eis.detailSubtitle": {
    en: "Clinical feed impact score: price reaction, volume, endpoint KPIs.",
    it: "Event Impact Score dal feed clinico: reazione prezzo, volume, KPI endpoint.",
  },
  "eis.noEvents": { en: "No clinical feed events for this ticker.", it: "Nessun evento feed clinico per questo ticker." },
  "eis.openSource": { en: "Open source", it: "Apri fonte" },

  "curve.details": { en: "Charts", it: "Grafici" },
  "curve.openCharts": { en: "Open charts for {ticker}", it: "Apri grafici per {ticker}" },
  "curve.sheetTitle": { en: "Curves · {ticker}", it: "Curve · {ticker}" },
  "curve.noData": {
    en: "Charts unavailable — ensure API :8765 is running and refresh.",
    it: "Grafici non disponibili — verifica API :8765 attiva e aggiorna.",
  },
  "curve.renderError": {
    en: "Could not render charts for this row.",
    it: "Impossibile mostrare i grafici per questa riga.",
  },
  "curve.polygonTitle": { en: "Recommendation polygon (CD arc)", it: "Poligono raccomandazione (arco CD)" },
  "curve.radarLegendCurrent": { en: "Current", it: "Attuale" },
  "curve.radarLegendTarget": { en: "Target (window)", it: "Target (finestra)" },
  "curve.radarSimilarity": { en: "Similarity {pct}%", it: "Similitudine {pct}%" },
  "curve.radarIncomplete": {
    en: "{filled}/{total} axes · missing data",
    it: "{filled}/{total} assi · dati mancanti",
  },
  "curve.raScoreTip": {
    en: "Entry solidity (Recommendation Score) at this CD window anchor — from desktop refresh when available.",
    it: "Solidità ingresso (Recommendation Score) all'ancoraggio CD della finestra — da refresh desktop se disponibile.",
  },
  "curve.miiTip": {
    en: "Market MII ° — price × volume slope (Δ5d × vol ratio from SDS). Same formula as desktop Market Interest gate.",
    it: "MII mercato ° — pendenza prezzo × volume (Δ5g × rapporto vol da SDS). Stessa formula del gate MII desktop.",
  },
  "curve.predBlendTitle": { en: "Model + recalibration + SDS blend", it: "Modello + ricalibrazione + blend SDS" },
  "curve.slopeTitle": { en: "Model vs actual (% vs today)", it: "Modello vs reale (% vs oggi)" },
  "curve.slopeCaption": { en: "5d {s5} pp/d · 20d {s20} pp/d", it: "5g {s5} pp/g · 20g {s20} pp/g" },
  "curve.gainPlanTitle": { en: "Gain vs plan over time", it: "Gain vs piano nel tempo" },
  "curve.gainPlanHypo": {
    en: "Hypothetical entry today — dashed = recalibrated plan.",
    it: "Ingresso ipotetico oggi — tratteggio = piano ricalibrato.",
  },
  "curve.gainPlanLive": {
    en: "Actual € gain vs recalibrated plan from entry.",
    it: "Gain € reale vs piano ricalibrato dall'ingresso.",
  },
  "curve.gainLegendHistorical": { en: "Historical path", it: "Percorso storico" },
  "curve.gainLegendPlanned": { en: "Planned (recalibrated)", it: "Piano (ricalibrato)" },
  "curve.gainLegendActual": { en: "Actual gain", it: "Gain reale" },
  "curve.gainToday": { en: "Today", it: "Oggi" },
  "curve.marketModelTitle": { en: "Market vs model slopes", it: "Pendenze mercato vs modello" },
  "curve.marketModelCaption": {
    en: "Market slope (MII) vs recalibrated model.",
    it: "Pendenza mercato (MII) vs modello ricalibrato.",
  },
  "curve.marketPredictionTitle": {
    en: "Market prediction trajectory",
    it: "Traiettoria mkt prediction",
  },
  "curve.marketPredictionCaption": {
    en: "Green = market (MII); dashed purple = model. CD and Today marked on axis.",
    it: "Verde = mercato (MII); viola tratteggio = modello. CD e Oggi sull'asse.",
  },
  "curve.tabsLabel": { en: "Chart types", it: "Tipi di grafico" },
  "curve.swipeHint": { en: "Swipe or tap a tab to switch chart", it: "Scorri o tocca un tab per cambiare grafico" },
  "curve.tabPolygon": { en: "Polygon", it: "Poligono" },
  "curve.tabPred": { en: "Model", it: "Modello" },
  "curve.tabGain": { en: "Gain", it: "Gain" },
  "curve.tabMarket": { en: "MII", it: "MII" },
  "curve.tabMarketPrediction": { en: "Mkt prediction", it: "Mkt prediction" },
  "curve.zonePast": { en: "Past", it: "Passato" },
  "curve.legendModelRecalib": { en: "Model + recalib.", it: "Modello + ricalib." },
  "curve.legendSdsBlend": { en: "SDS blend", it: "Blend SDS" },
  "curve.zonePreCdHot": { en: "Pre-CD hot", it: "Pre-CD hot" },
  "curve.zoneToday": { en: "Today", it: "Oggi" },
  "curve.watchAxisHint": {
    en: "Watch arc T{min}…T{max} · +/- = zoom time axis",
    it: "Arco watch T{min}…T{max} · +/- = zoom asse tempo",
  },
  "curve.zoomRail": { en: "Chart zoom", it: "Zoom grafico" },
  "curve.zoomXIn": { en: "Zoom in on time axis", it: "Ingrandisci asse tempo" },
  "curve.zoomXOut": { en: "Zoom out on time axis", it: "Riduci asse tempo" },

  "sync.now": { en: "sync · now", it: "sync · adesso" },
  "sync.minAgo": { en: "sync · {n} min ago", it: "sync · {n} min fa" },
  "sync.hAgo": { en: "sync · {n}h ago", it: "sync · {n}h fa" },

  "connection.localDev": { en: "Local dev", it: "Dev locale" },
  "connection.v3": { en: "Online server · HTTPS", it: "Server online · HTTPS" },
  "connection.title": { en: "Server connection", it: "Connessione server" },
  "connection.subtitle": { en: "Connection", it: "Connessione" },
  "connection.section": { en: "Connection", it: "Connessione" },
  "connection.apiUrl": { en: "API URL", it: "URL API" },
  "connection.apiUrlHint": {
    en: "API URL (empty = same-site HTTPS or local dev proxy)",
    it: "URL API (vuoto = stesso sito HTTPS o dev locale)",
  },
  "connection.apiToken": { en: "API token", it: "Token API" },
  "connection.tokenPlaceholder": { en: "VPS SUPERNOVA_API_TOKEN", it: "SUPERNOVA_API_TOKEN del VPS" },
  "connection.hint": {
    en: "Online server: use {host} + VPS token. Home dev: leave URL empty (proxy :5174 → :8765).",
    it: "Server online: usa {host} + token VPS. Dev casa: lascia URL vuoto (proxy :5174 → :8765).",
  },
  "connection.onlineBold": { en: "Online server:", it: "Server online:" },
  "connection.homeDevBold": { en: "Home dev:", it: "Dev casa:" },
  "connection.connect": { en: "Connect", it: "Connetti" },
  "connection.useVps": { en: "Use VPS", it: "Usa VPS" },
  "connection.lastSync": { en: "Last sync:", it: "Ultimo sync:" },
  "connection.saveReload": { en: "Save & reload", it: "Salva e ricarica" },
  "connection.reconfigure": { en: "Reconfigure", it: "Riconfigura" },
  "refresh.section": { en: "Data refresh", it: "Refresh dati" },
  "refresh.sectionHint": {
    en: "Runs on the PC/server API (Term 1). Close Excel on the workbook before starting.",
    it: "Esegue sull'API PC/server (Term 1). Chiudi Excel sul workbook prima di avviare.",
  },
  "refresh.daily.title": { en: "Day refresh", it: "Refresh giornaliero" },
  "refresh.daily.detail": {
    en: "Simulation sheet, Yahoo prices, curves and KPIs.",
    it: "Foglio Simulation, prezzi Yahoo, curve e KPI.",
  },
  "refresh.daily.eta": { en: "ETA ~15–25 min", it: "ETA ~15–25 min" },
  "refresh.daily.run": { en: "Run day refresh", it: "Avvia refresh giornaliero" },
  "refresh.daily.running": { en: "Day refresh running…", it: "Refresh giornaliero in corso…" },
  "refresh.full.title": { en: "Full refresh (orchestrator)", it: "Refresh completo (orchestrator)" },
  "refresh.full.detail": {
    en: "Full pipeline: SEC 8-K, liquidity, cohort rebuild, all sheets.",
    it: "Pipeline completa: SEC 8-K, liquidità, coorte, tutti i fogli.",
  },
  "refresh.full.eta": { en: "ETA ~30–90+ min", it: "ETA ~30–90+ min" },
  "refresh.full.run": { en: "Run full refresh", it: "Avvia orchestrator" },
  "refresh.full.running": { en: "Full orchestrator running…", it: "Orchestrator completo in corso…" },
  "refresh.full.confirm": {
    en: "Start full orchestrator? This can take 30–90+ minutes. Close Excel on the workbook first.",
    it: "Avviare l'orchestrator completo? Può richiedere 30–90+ minuti. Chiudi Excel sul workbook prima.",
  },
  "refresh.running": { en: "Running…", it: "In corso…" },
  "refresh.started": {
    en: "Refresh started on server — you can close this panel.",
    it: "Refresh avviato sul server — puoi chiudere questo pannello.",
  },
  "tester.access": { en: "Tester access", it: "Accesso tester" },
  "tester.loading": { en: "Checking access…", it: "Verifica accesso…" },
  "tester.registerTitle": { en: "Tester sign-in", it: "Accesso tester" },
  "tester.registerBody": {
    en: "Enter your email to request access. An admin must approve you in Monitor tester before you can use the app.",
    it: "Inserisci la tua email per richiedere l'accesso. Un admin deve approvarti in Monitor tester prima di usare l'app.",
  },
  "tester.email": { en: "Email", it: "Email" },
  "tester.displayName": { en: "Display name", it: "Nome visualizzato" },
  "tester.displayNameHint": { en: "Optional", it: "Opzionale" },
  "tester.inviteCode": { en: "Invite code", it: "Codice invito" },
  "tester.inviteCodeRequired": { en: "Invite code *", it: "Codice invito *" },
  "tester.inviteOptional": { en: "If required by server", it: "Se richiesto dal server" },
  "tester.invitePlaceholder": { en: "e.g. SN-PLAY-2026", it: "es. SN-PLAY-2026" },
  "tester.inviteRequiredHint": {
    en: "Your admin enabled invite codes on the server — ask them for the code.",
    it: "L'admin ha attivato i codici invito sul server — chiedigli il codice.",
  },
  "tester.inviteRequiredError": { en: "Invite code is required.", it: "Codice invito obbligatorio." },
  "tester.inviteInvalid": {
    en: "Invalid invite code — check with your admin.",
    it: "Codice invito non valido — verifica con l'admin.",
  },
  "tester.requestAccess": { en: "Request access", it: "Richiedi accesso" },
  "tester.pendingTitle": { en: "Waiting for approval", it: "In attesa di approvazione" },
  "tester.pendingBody": {
    en: "When the admin approves you, this screen updates automatically (or tap Check again). You'll then see how to add the app icon to your home screen.",
    it: "Quando l'admin ti approva, questa schermata si aggiorna da sola (oppure premi Controlla di nuovo). Vedrai poi come aggiungere l'icona alla Home.",
  },
  "tester.pendingApprovedHint": {
    en: "If you already received approval, tap Check again.",
    it: "Se sei già stato approvato, premi Controlla di nuovo.",
  },
  "connection.tokenOnlyHint": {
    en: "Optional: admin API token for server refresh. Tester sign-in works without it.",
    it: "Opzionale: token admin per refresh sul server. L'accesso tester funziona anche senza.",
  },
  "tester.welcomeTitle": { en: "Access approved", it: "Accesso approvato" },
  "tester.welcomeBody": {
    en: "Welcome to SuperNova. Follow the steps below to add the app icon to your phone home screen.",
    it: "Benvenuto in SuperNova. Segui i passi qui sotto per aggiungere l'icona dell'app alla Home del telefono.",
  },
  "tester.welcomeContinue": { en: "Enter the app", it: "Entra nell'app" },
  "tester.welcomeLinkHint": {
    en: "Your access is approved — tap Enter below or Request access with the same email.",
    it: "Accesso già approvato — tocca Entra sotto oppure Richiedi accesso con la stessa email.",
  },
  "tester.welcomeEnterAs": {
    en: "Enter as {email}",
    it: "Entra come {email}",
  },
  "tester.revokedTitle": { en: "Access revoked", it: "Accesso revocato" },
  "tester.revokedBody": {
    en: "Your tester access was revoked. Contact the admin if you think this is a mistake.",
    it: "Il tuo accesso tester è stato revocato. Contatta l'admin se pensi sia un errore.",
  },
  "tester.checkAgain": { en: "Check again", it: "Controlla di nuovo" },
  "tester.changeAccount": { en: "Use another email", it: "Usa altra email" },
  "tester.signedInAs": { en: "Signed in as", it: "Accesso come" },
  "tester.account": { en: "Tester account", it: "Account tester" },
  "tester.signOutHint": {
    en: "Switch tester email (requires new approval if pending).",
    it: "Cambia email tester (richiede nuova approvazione se in attesa).",
  },

  "settings.ownership.title": {
    en: "💼 Ownership and Disclaimer",
    it: "💼 Proprietà e disclaimer",
  },
  "settings.ownership.conceptLabel": {
    en: "Concept and Development:",
    it: "Concept e sviluppo:",
  },
  "settings.ownership.author": {
    en: "Tiziana Rossetti",
    it: "Tiziana Rossetti",
  },
  "settings.ownership.descriptionLabel": {
    en: "Description:",
    it: "Descrizione:",
  },
  "settings.ownership.description": {
    en: "Financial tool designed to support investment decision-making.",
    it: "Strumento finanziario per supportare le decisioni di investimento.",
  },
  "settings.ownership.noticeLabel": {
    en: "Notice:",
    it: "Avviso:",
  },
  "settings.ownership.notice": {
    en: "The use of this application implies full awareness that all analyses, outputs, and recommendations are subject to error and interpretation.",
    it: "L'uso di questa applicazione implica piena consapevolezza che analisi, output e raccomandazioni sono soggetti a errore e interpretazione.",
  },
  "settings.ownership.responsibilityLabel": {
    en: "Responsibility:",
    it: "Responsabilità:",
  },
  "settings.ownership.responsibility": {
    en: "All decisions and outcomes resulting from the use of this tool are entirely the user's responsibility.",
    it: "Tutte le decisioni e gli esiti derivanti dall'uso di questo strumento sono interamente responsabilità dell'utente.",
  },

  "dashboard.kpi.portfolioOpp": { en: "Portfolio / Opp.", it: "Portfolio / Opp." },
  "dashboard.kpi.totalCapital": { en: "Total capital", it: "Capitale totale" },
  "dashboard.kpi.nextCatalyst": { en: "Next Catalyst", it: "Prossimo CD" },
  "dashboard.kpi.imminent": { en: "⚡ imminent", it: "⚡ imminente" },
  "dashboard.kpi.topAiFeed": { en: "Top AI Feed", it: "Top AI Feed" },
  "dashboard.kpi.aiFeedSub": { en: "clinical pubs · 30d", it: "pub clinical · 30g" },
  "dashboard.actions.title": { en: "Actions to take", it: "Azioni da fare" },
  "dashboard.actions.subCount": { en: "{n} open recommendations", it: "{n} raccomandazioni aperte" },
  "dashboard.actions.subWithNew": {
    en: "{n} open recommendations · {new} new since last visit",
    it: "{n} raccomandazioni aperte · {new} nuove dall'ultima visita",
  },
  "dashboard.actions.filterAll": { en: "All", it: "Tutte" },
  "dashboard.actions.filterPortfolio": { en: "Portfolio", it: "Portafoglio" },
  "dashboard.actions.filterOpp": { en: "Opportunities", it: "Opportunità" },
  "dashboard.actions.colTicker": { en: "Ticker", it: "Ticker" },
  "dashboard.actions.colCompany": { en: "Company", it: "Società" },
  "dashboard.actions.colCurve": { en: "Curve", it: "Curva" },
  "dashboard.actions.colRec": { en: "Rec", it: "Rec" },
  "dashboard.actions.colPrice": { en: "Price", it: "Prezzo" },
  "dashboard.actions.colLastRead": { en: "Last read", it: "Last read" },
  "dashboard.actions.lastReadLocalTip": {
    en: "Change vs your last mobile refresh (local price snapshot).",
    it: "Variazione vs ultimo refresh mobile (snapshot prezzo locale).",
  },
  "dashboard.actions.lastReadMarketCloseTip": {
    en: "Var. Giorn. % vs previous session close (Simulation sheet).",
    it: "Var. Giorn. % vs chiusura sessione precedente (foglio Simulation).",
  },
  "dashboard.actions.colTarget": { en: "Target", it: "Target" },
  "dashboard.actions.colEis": { en: "EIS", it: "EIS" },
  "dashboard.actions.eisDetails": { en: "EIS details", it: "Dettaglio EIS" },
  "dashboard.actions.colReason": { en: "Reason", it: "Motivo" },
  "dashboard.actions.sub": { en: "Max 5 · portfolio", it: "Max 5 · portafoglio" },
  "dashboard.actions.empty": { en: "No active recommendations.", it: "Nessuna raccomandazione attiva." },
  "dashboard.actions.syncHint": {
    en: "Open desktop Home tab, wait ~5s, then ↻ Refresh. If stuck, restart Term 2 (npm run dev).",
    it: "Apri Home desktop, attendi ~5s, poi ↻ Aggiorna. Se bloccato, riavvia Term 2 (npm run dev).",
  },
  "dashboard.upcoming.title": { en: "Upcoming CDs", it: "Prossimi CD" },
  "dashboard.upcoming.sub": { en: "Portfolio", it: "Portafoglio" },
  "dashboard.upcoming.empty": { en: "No imminent catalysts.", it: "Nessun catalizzatore imminente." },
  "dashboard.upcoming.nctLink": { en: "{nct} · ClinicalTrials.gov", it: "{nct} · ClinicalTrials.gov" },
  "dashboard.upcoming.studyLink": {
    en: "Clinical study · ClinicalTrials.gov",
    it: "Studio clinico · ClinicalTrials.gov",
  },
  "dashboard.footer.portfolio": { en: "→ Portfolio", it: "→ Portafoglio" },
  "dashboard.footer.opportunities": { en: "→ Opportunities", it: "→ Opportunità" },

  "piggy.title": { en: "Piggy Bank", it: "Piggy Bank" },
  "piggy.open24h": { en: "24h open {amount}", it: "24h aperte {amount}" },
  "piggy.closed": { en: "{n} closed {amount}", it: "{n} chiuse {amount}" },
  "piggy.capital": { en: "capital {amount}", it: "capitale {amount}" },
  "piggy.positions": { en: "{n} positions", it: "{n} posizioni" },

  "portfolio.views.24h": { en: "24h check", it: "Check 24h" },
  "portfolio.check.ppiHint": {
    en: "Portfolio Pattern Index (0–100): higher = review first (hot CD window + polygon fit).",
    it: "Portfolio Pattern Index (0–100): più alto = da rivedere prima (finestra CD calda + fit poligono).",
  },
  "portfolio.check.var": { en: "Var.", it: "Var." },
  "portfolio.check.varHint": {
    en: "Price variation mini-chart: 1d, 7d, 1M (% vs previous close / history).",
    it: "Mini-grafico variazione prezzo: 1g, 7g, 1M (% vs chiusura precedente / storico).",
  },
  "portfolio.check.var1d": { en: "1d", it: "1g" },
  "portfolio.check.var1w": { en: "1w", it: "1s" },
  "portfolio.check.var1m": { en: "1m", it: "1m" },
  "portfolio.check.roiTarget": { en: "ROI tgt", it: "ROI tgt" },
  "portfolio.check.roiTargetHint": {
    en: "Plan target % · below = days to curve peak + expected gain on invested capital ($)",
    it: "Target piano % · sotto = giorni al picco curva + gain atteso sul capitale investito ($)",
  },
  "portfolio.check.verdict": { en: "Verdict", it: "Verdict" },
  "portfolio.views.pnl": { en: "P&L", it: "P&L" },
  "portfolio.views.trend": { en: "Trend", it: "Trend" },
  "portfolio.summary": {
    en: "{count} pos · {loss} loss · {gain} gain",
    it: "{count} pos · {loss} loss · {gain} gain",
  },
  "portfolio.totalPnl": { en: "Total P&L:", it: "P&L totale:" },
  "portfolio.totalGain": { en: "Totale Gain", it: "Totale Gain" },
  "portfolio.gain24h": { en: "24h Gain", it: "Gain 24h" },
  "portfolio.invested": { en: "invested", it: "investiti" },
  "portfolio.value": { en: "value", it: "valore" },
  "portfolio.today": { en: "Today", it: "Oggi" },
  "portfolio.investedValue": {
    en: "{value} on {capital} invested",
    it: "{value} su {capital} investito",
  },
  "portfolio.tickers24h": { en: "{n}/{total} tickers · 24h move", it: "{n}/{total} ticker · mov. 24h" },
  "portfolio.gainFooter": {
    en: "{gain} gaining · {loss} losing · {pct}% gain",
    it: "{gain} in gain · {loss} in loss · {pct}% gain",
  },
  "portfolio.trend.pnlTitle": { en: "P&L % — return on capital", it: "P&L % — rendimento sul capitale" },
  "portfolio.trend.pnlCaption": {
    en: "Above 0% = gain · below 0% = loss · dashed line = breakeven",
    it: "Sopra 0% = guadagno · sotto 0% = perdita · linea tratteggiata = pareggio",
  },
  "portfolio.trend.eurTitle": { en: "P&L €", it: "P&L €" },
  "portfolio.trend.eurCaption": {
    en: "Same scope as above — profit/loss in euros vs breakeven at €0",
    it: "Stesso ambito sopra — guadagno/perdita in euro vs pareggio a €0",
  },
  "portfolio.trend.scopeLabel": { en: "Company in portfolio", it: "Società in portafoglio" },
  "portfolio.trend.allPortfolio": { en: "All portfolio (aggregate)", it: "Tutto il portafoglio (cumulativo)" },
  "portfolio.trend.needHistory": {
    en: "Need at least 2 readings — enter capital on positions, refresh prices on desktop, then reload here.",
    it: "Servono almeno 2 letture — inserisci capitale, aggiorna prezzi su desktop, poi ricarica qui.",
  },
  "portfolio.trend.readings": {
    en: "{n} readings · auto snapshot after price refresh",
    it: "{n} letture · snapshot automatico dopo refresh prezzi",
  },

  "opportunities.primary": { en: "Primary ≤2mo", it: "Primary ≤2 mesi" },
  "opportunities.early": { en: "Early 2–4mo", it: "Early 2–4 mesi" },
  "opportunities.meta": {
    en: "{n} opp · sort ROI/day · prices {when}",
    it: "{n} opp · sort ROI/g · prezzi {when}",
  },
  "opportunities.aiFeed.title": { en: "Top AI Feed", it: "Top AI Feed" },
  "opportunities.aiFeed.sub": { en: "3 recent events", it: "3 eventi recenti" },
  "opportunities.aiFeed.empty": {
    en: "No AI events — sync from desktop dashboard.",
    it: "Nessun evento AI — sincronizza dalla dashboard desktop.",
  },
  "opportunities.tableTitle": { en: "Simulation · {n} total", it: "Simulazione · {n} totali" },
  "opportunities.emptyBand": { en: "No opportunities in this band.", it: "Nessuna opportunità in questa fascia." },

  "detail.action": { en: "Action", it: "Azione" },
  "detail.gainInProgress": { en: "{amount} in progress", it: "{amount} in corso" },
  "detail.editSim": { en: "Edit simulation", it: "Modifica simulazione" },
  "detail.addSim": { en: "Add to simulator", it: "Aggiungi al simulatore" },
  "detail.formHint": {
    en: "Enter price and capital to track this opportunity.",
    it: "Inserisci prezzo e capitale per tracciare questa opportunità.",
  },
  "detail.buyPrice": { en: "Buy price ($)", it: "Prezzo acquisto ($)" },
  "detail.useCurrentPrice": { en: "Use current price ({price})", it: "Usa prezzo attuale ({price})" },
  "detail.capital": { en: "Capital (€)", it: "Capitale (€)" },
  "detail.capitalPlaceholder": { en: "e.g. 5000", it: "es. 5000" },
  "detail.saveChanges": { en: "Save changes", it: "Salva modifiche" },
  "detail.closePosition": { en: "Close position", it: "Chiudi posizione" },
  "detail.summary": { en: "Summary", it: "Riepilogo" },
  "detail.marketPrice": { en: "Market price", it: "Prezzo mercato" },
  "detail.desktopNote": {
    en: "Slope errors · Prediction curves · Decision Lab · full EIS details → open on desktop",
    it: "Slope errors · Prediction curves · Decision Lab · EIS details completi → apri su desktop",
  },

  "install.compactSummary": { en: "How to add the icon to Home", it: "Come aggiungere l'icona alla Home" },
  "install.compactHint": {
    en: "Safari (iOS): Share → Add to Home. Chrome (Android): menu ⋮ → Install app / Add to Home screen.",
    it: "Safari (iOS): Condividi → Aggiungi a Home. Chrome (Android): menu ⋮ → Installa app / Aggiungi a schermata Home.",
  },
  "install.title": { en: "Home screen icon", it: "Icona sulla Home" },
  "install.hint": {
    en: "Online server: {host} + token. Home dev: Term 1 (8765) + Term 2 (5174).",
    it: "Server online: {host} + token. Dev casa: Term 1 (8765) + Term 2 (5174).",
  },
  "install.iosTitle": { en: "iPhone / iPad (Safari)", it: "iPhone / iPad (Safari)" },
  "install.ios1": { en: "Safari → app URL → Connect with VPS token.", it: "Safari → URL app → Connetti con token VPS." },
  "install.ios2": { en: "Share → Add to Home.", it: "Condividi → Aggiungi a Home." },
  "install.androidTitle": { en: "Android (Chrome)", it: "Android (Chrome)" },
  "install.android1": { en: "Chrome → same URL.", it: "Chrome → stesso URL." },
  "install.android2": {
    en: "Menu ⋮ → Install app or Add to Home screen.",
    it: "Menu ⋮ → Installa app o Aggiungi a schermata Home.",
  },

  "error.invalidPriceCapital": {
    en: "Price and capital must be valid numbers.",
    it: "Prezzo e capitale devono essere numeri validi.",
  },
  "error.serverGeneric": { en: "server error", it: "errore server" },
  "error.excelLocked": {
    en: "Excel open or file locked — close biotech_orchestrated_output.xlsx and retry.",
    it: "Excel aperto o file bloccato — chiudi biotech_orchestrated_output.xlsx e riprova.",
  },
  "error.workbookMissing": {
    en: "Workbook missing or saving — wait for desktop refresh.",
    it: "Workbook assente o in salvataggio — attendi refresh desktop.",
  },
  "error.apiDown": {
    en: "API error — start Term 1 (python -m supernova_api) and close Excel.",
    it: "API in errore — controlla Terminale 1 (python -m supernova_api) e chiudi Excel.",
  },
  "error.apiOfflineDev": {
    en: "API offline — start Term 1: scripts\\Avvia_Term1_Biotech.bat (port 8765), then refresh.",
    it: "API offline — avvia Term 1: scripts\\Avvia_Term1_Biotech.bat (porta 8765), poi aggiorna.",
  },
  "error.apiOfflineRemote": {
    en: "Cannot reach {host} — check VPN/network or clear API URL in settings (use empty URL for local dev).",
    it: "Server {host} non raggiungibile — controlla rete/VPN o svuota URL API nelle impostazioni (dev locale = URL vuoto).",
  },
  "error.apiSlow": {
    en: "API slow or busy — keep Term 1 open, close Excel, wait ~20s and tap Refresh.",
    it: "API lenta o occupata — Term 1 acceso, chiudi Excel, attendi ~20s e premi Aggiorna.",
  },
  "error.endpointNotFound": {
    en: "API endpoint not found — use http://HOST:8765 (not /mobile/). Home dev: leave URL empty on :5174.",
    it: "Endpoint API non trovato — usa http://HOST:8765 (senza /mobile/). Dev casa: lascia URL vuoto su :5174.",
  },

  "msg.saved": { en: "Saved to server ✓", it: "Salvato sul server ✓" },
  "msg.positionClosed": { en: "Position closed ✓", it: "Posizione chiusa ✓" },

  "nav.main": { en: "Main navigation", it: "Navigazione principale" },
  "nav.dashboard": { en: "Dashboard", it: "Dashboard" },
  "nav.portfolio": { en: "Portfolio", it: "Portfolio" },
  "nav.opportunities": { en: "Opportunities", it: "Opportunities" },
  "nav.myPortfolio": { en: "My Portfolio", it: "Il mio portafoglio" },
} as const;

export type I18nKey = keyof typeof DICT;

export function t(
  key: I18nKey,
  lang: MobileLang,
  vars?: Record<string, string | number>,
): string {
  const entry = DICT[key];
  let text: string = entry[lang] ?? entry.en;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return text;
}
