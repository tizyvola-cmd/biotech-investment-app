import type { MobileLang } from "./langStorage";

const DICT = {
  "common.refresh": { en: "Refresh", it: "Aggiorna" },
  "common.refreshing": { en: "Refreshing…", it: "Aggiornamento…" },
  "common.updatedNow": { en: "updated now", it: "aggiornato ora" },
  "common.minAgo": { en: "{n}m ago", it: "{n}m fa" },
  "common.hAgo": { en: "{n}h ago", it: "{n}h fa" },
  "common.back": { en: "Back", it: "Indietro" },
  "common.menu": { en: "Menu", it: "Menu" },
  "common.close": { en: "Close", it: "Chiudi" },
  "common.save": { en: "Save", it: "Salva" },
  "common.online": { en: "Online", it: "Online" },
  "common.settings": { en: "Settings", it: "Impostazioni" },
  "common.language": { en: "Language", it: "Lingua" },
  "common.lang.en": { en: "English", it: "English" },
  "common.lang.it": { en: "Italiano", it: "Italiano" },
  "common.loading": { en: "Loading…", it: "Caricamento…" },

  "eis.sheetTitle": { en: "EIS · {ticker}", it: "EIS · {ticker}" },
  "eis.detailTitle": { en: "EIS detail · {ticker}", it: "Dettaglio EIS · {ticker}" },
  "eis.detailSubtitle": {
    en: "Clinical feed impact score: price reaction, volume, endpoint KPIs.",
    it: "Event Impact Score dal feed clinico: reazione prezzo, volume, KPI endpoint.",
  },
  "eis.noEvents": { en: "No clinical feed events for this ticker.", it: "Nessun evento feed clinico per questo ticker." },
  "eis.openSource": { en: "Open source", it: "Apri fonte" },

  "regulatory.detailTitle": { en: "Regulatory · {ticker}", it: "Regolatorio · {ticker}" },
  "regulatory.detailSubtitle": {
    en: "Signals from SEC 8-K / catalyst feed that drive the regulatory score.",
    it: "Segnali da SEC 8-K / feed catalyst che alimentano lo score regolatorio.",
  },
  "regulatory.signalsTitle": { en: "Detected signals", it: "Segnali rilevati" },
  "regulatory.noSignals": {
    en: "Ticker scanned — no risk or favorable keywords in recent filings.",
    it: "Ticker analizzato — nessuna keyword rischio/favorevole nei filing recenti.",
  },
  "regulatory.noSignalDetail": {
    en: "No detailed regulatory signals — score may come from the Simulation sheet column.",
    it: "Nessun segnale regolatorio dettagliato — lo score può provenire dalla colonna Simulation.",
  },
  "regulatory.scoreExplainTitle": {
    en: "How this score is built",
    it: "Come si forma lo score",
  },
  "regulatory.scoreExplainScale": {
    en: "Scale −100…+100: negative = favorable regulatory outlook, positive = risk (CRL, PDUFA, CMC).",
    it: "Scala −100…+100: negativo = profilo regolatorio favorevole, positivo = rischio (CRL, PDUFA, CMC).",
  },
  "regulatory.scoreSource": { en: "Source", it: "Fonte" },
  "regulatory.scoreExplainImpact": {
    en: "Investment impact view (sign flipped): {impact} — positive means favorable tailwind.",
    it: "Vista impatto investimento (segno invertito): {impact} — positivo = vento favorevole.",
  },
  "regulatory.scorePrimarySource": {
    en: "Primary driver: {source}",
    it: "Driver principale: {source}",
  },
  "regulatory.snapshotUpdated": { en: "Snapshot · {date}", it: "Snapshot · {date}" },

  "curve.details": { en: "Charts", it: "Grafici" },
  "curve.openCharts": { en: "Open charts for {ticker}", it: "Apri grafici per {ticker}" },
  "curve.sheetTitle": { en: "Curves · {ticker}", it: "Grafici · {ticker}" },
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
  "curve.predBlendTitle": { en: "Model + recalibration + SDS blend", it: "Modello + ricalibrazione + mix SDS" },
  "curve.slopeTitle": { en: "Model vs actual (% vs today)", it: "Modello vs reale (% vs oggi)" },
  "curve.slopeCaption": { en: "5d {s5} pp/d · 20d {s20} pp/d", it: "5g {s5} pp/g · 20g {s20} pp/g" },
  "curve.gainPlanTitle": { en: "Gain vs plan over time", it: "Guadagno vs piano nel tempo" },
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
  "curve.gainLegendActual": { en: "Actual gain", it: "Guadagno reale" },
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
  "curve.tabGain": { en: "Gain", it: "Guadagno" },
  "curve.tabMarket": { en: "MII", it: "MII" },
  "curve.tabMarketPrediction": { en: "Mkt prediction", it: "Previsione mercato" },
  "curve.zonePast": { en: "Past", it: "Passato" },
  "curve.legendModelRecalib": { en: "Model + recalib.", it: "Modello + ricalib." },
  "curve.legendSdsBlend": { en: "SDS blend", it: "Mix SDS" },
  "curve.zonePreCdHot": { en: "Pre-CD hot", it: "Pre-CD caldo" },
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
  "sync.stale": {
    en: "sync · stale · {age}",
    it: "sync · obsoleto · {age}",
  },
  "sync.tokenRequired": {
    en: "Snapshot not updated — set API token in Settings (same as desktop).",
    it: "Snapshot non aggiornato — imposta il token API in Settings (stesso del desktop).",
  },
  "sync.rebuildFailed": {
    en: "Snapshot rebuild failed: {detail}",
    it: "Rebuild snapshot fallito: {detail}",
  },

  "connection.localDev": { en: "Local dev", it: "Dev locale" },
  "connection.v3": { en: "Online server · HTTPS", it: "Server online · HTTPS" },
  "connection.title": { en: "Server connection", it: "Connessione server" },
  "connection.subtitle": { en: "Connection", it: "Connessione" },
  "dev.banner": {
    en: "UI preview only — API on VPS. Use http://91.99.15.48:8765/mobile/ on phone (no PC terminals).",
    it: "Solo anteprima UI — API sul VPS. Sul telefono usa http://91.99.15.48:8765/mobile/ (nessun terminale sul PC).",
  },
  "connection.section": { en: "Connection", it: "Connessione" },
  "connection.apiUrl": { en: "API URL", it: "URL API" },
  "connection.apiUrlHint": {
    en: "API URL (empty = same-site HTTPS or local dev proxy)",
    it: "URL API (vuoto = stesso sito HTTPS o dev locale)",
  },
  "connection.apiToken": { en: "API token", it: "Token API" },
  "connection.tokenPlaceholder": { en: "VPS SUPERNOVA_API_TOKEN", it: "SUPERNOVA_API_TOKEN del VPS" },
  "connection.hint": {
    en: "Production: open {host}/mobile/ — same origin, token only. Optional UI preview: localhost:5174 (proxied to VPS).",
    it: "Produzione: apri {host}/mobile/ — stesso origin, solo token. Anteprima UI opzionale: localhost:5174 (proxy verso VPS).",
  },
  "connection.onlineBold": { en: "Online server:", it: "Server online:" },
  "connection.homeDevBold": { en: "Home dev:", it: "Dev casa:" },
  "connection.connect": { en: "Connect", it: "Connetti" },
  "connection.useVps": { en: "Use VPS", it: "Usa VPS" },
  "connection.lastSync": { en: "Last sync:", it: "Ultimo sync:" },
  "connection.saveReload": { en: "Save & reload", it: "Salva e ricarica" },
  "connection.reconfigure": { en: "Reconfigure", it: "Riconfigura" },
  "refresh.section": { en: "Data refresh", it: "Aggiornamento dati" },
  "refresh.sectionHint": {
    en: "Runs on the VPS server (orchestrator). Close Excel on the workbook before starting from desktop.",
    it: "Esegue sul server VPS (orchestrator). Chiudi Excel sul workbook prima di avviare da desktop.",
  },
  "refresh.daily.title": { en: "Day refresh", it: "Aggiornamento giornaliero" },
  "refresh.daily.detail": {
    en: "Simulation sheet, Yahoo prices, curves and KPIs.",
    it: "Foglio Simulation, prezzi Yahoo, curve e KPI.",
  },
  "refresh.daily.eta": { en: "ETA ~15–25 min", it: "ETA ~15–25 min" },
  "refresh.daily.run": { en: "Run day refresh", it: "Avvia aggiornamento giornaliero" },
  "refresh.daily.running": { en: "Day refresh running…", it: "Aggiornamento giornaliero in corso…" },
  "refresh.full.title": { en: "Full refresh (orchestrator)", it: "Aggiornamento completo (orchestrator)" },
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
    it: "Aggiornamento avviato sul server — puoi chiudere questo pannello.",
  },
  "tester.access": { en: "Tester access", it: "Accesso tester" },
  "tester.loading": { en: "Checking access…", it: "Verifica accesso…" },
  "tester.registerTitle": { en: "Tester sign-in", it: "Accesso tester" },
  "tester.registerBody": {
    en: "Use the same email as on desktop SuperNova. Mobile shows only that account’s invest book from the server.",
    it: "Usa la stessa email del desktop SuperNova. La mobile mostra solo il book investimenti di quell’account sul server.",
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
  "tester.requestAccess": { en: "Enter app", it: "Entra nell'app" },
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
  "manualFeed.gainStar.mark": {
    en: "24h manual EIS today — one ★ (color rotates each new confirming day)",
    it: "EIS manuale 24h oggi — una ★ (colore ruota ogni nuovo giorno confermato)",
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

  "dashboard.kpi.portfolioOpp": { en: "Portfolio / Opp.", it: "Portafoglio / Opp." },
  "dashboard.kpi.totalCapital": { en: "Total capital", it: "Capitale totale" },
  "dashboard.kpi.nextCatalyst": { en: "Next Catalyst", it: "Prossimo CD" },
  "dashboard.kpi.imminent": { en: "⚡ imminent", it: "⚡ imminente" },
  "dashboard.kpi.topAiFeed": { en: "Top AI Feed", it: "Feed AI top" },
  "dashboard.kpi.aiFeedSub": { en: "clinical pubs · 30d", it: "pub cliniche · 30g" },
  "dashboard.rec.lead": {
    en: "Your book only — same email as desktop. Soft SELL chips apply to your open positions.",
    it: "Solo il tuo book — stessa email del desktop. Soft SELL solo sulle tue posizioni aperte.",
  },
  "signalsBook.aria": {
    en: "Soft BUY/SELL and prior-day book activity",
    it: "Soft BUY/SELL e attività book ieri",
  },
  "signalsBook.kicker": { en: "Signals & book", it: "Segnali & book" },
  "signalsBook.title": {
    en: "Soft BUY/SELL · bought & sold (prior day)",
    it: "Soft BUY/SELL · acquistati e venduti (ieri)",
  },
  "signalsBook.sub": {
    en: "Suggestions above · what you already did below · tap a chip to trade in sim",
    it: "Suggerimenti sopra · sotto cosa hai già fatto · tap su un chip per operare in sim",
  },
  "signalsBook.buySuggest": {
    en: "Suggested BUY ({n})",
    it: "BUY consigliati ({n})",
  },
  "signalsBook.buySuggestSub": {
    en: "Off-book Soft BUY · tap → buy in sim",
    it: "Soft BUY off-book · tap → compra in sim",
  },
  "signalsBook.sellSuggest": {
    en: "Suggested SELL ({n})",
    it: "SELL consigliati ({n})",
  },
  "signalsBook.sellSuggestSub": {
    en: "Open book Soft / Urgent / continuation · tap → sell",
    it: "Book aperto Soft / Urgent / continuation · tap → vendi",
  },
  "dashboard.book.sharedHint": {
    en: "Same open book & P&L as desktop Pulse (synced from Home).",
    it: "Stesso book aperto e P&L del Pulse desktop (sincronizzato dalla Home).",
  },
  "dashboard.book.emailHint": {
    en: "Same book as desktop · {email}",
    it: "Stesso book del desktop · {email}",
  },
  "dashboard.emailLink.kicker": {
    en: "Desktop account",
    it: "Account desktop",
  },
  "dashboard.emailLink.tip": {
    en: "Mobile companion is locked to this email — same invest book as desktop for this account.",
    it: "Il companion mobile è legato a questa email — stesso book investimenti del desktop per questo account.",
  },
  "dashboard.rec.buyTitle": { en: "Suggested BUY ({n})", it: "BUY consigliati ({n})" },
  "dashboard.rec.buySub": {
    en: "Off-book Soft BUY · tap → buy in sim",
    it: "Soft BUY off-book · tap → compra in sim",
  },
  "dashboard.rec.buyEmpty": { en: "None now", it: "Nessuno ora" },
  "dashboard.rec.sellTitle": { en: "Suggested SELL ({n})", it: "SELL consigliati ({n})" },
  "dashboard.rec.sellSub": {
    en: "Open book Soft / Urgent / continuation · tap → sell in sim",
    it: "Book aperto Soft / Urgent / continuation · tap → vendi in sim",
  },
  "recTrade.buyTitle": {
    en: "Buy {ticker}",
    it: "Compra {ticker}",
  },
  "recTrade.sellTitle": {
    en: "Sell {ticker}",
    it: "Vendi {ticker}",
  },
  "recTrade.buyLead": {
    en: "Adds this name to the shared simulation book. Buy price = live current quote (updates as the stock moves).",
    it: "Aggiunge il titolo al book di simulazione condiviso. Prezzo BUY = quotazione corrente live (si aggiorna con il titolo).",
  },
  "recTrade.sellLead": {
    en: "Closes the open simulation position for this ticker (same book as desktop Pulse).",
    it: "Chiude la posizione aperta in simulazione (stesso book del Pulse desktop).",
  },
  "recTrade.price": { en: "Current price", it: "Prezzo attuale" },
  "recTrade.priceLocked": {
    en: "Live quote",
    it: "Quotazione live",
  },
  "recTrade.priceLive": {
    en: "Live",
    it: "Live",
  },
  "recTrade.capital": { en: "Capital to invest (€)", it: "Capitale da investire (€)" },
  "recTrade.suggested": {
    en: "Suggested size: {eur}",
    it: "Taglia suggerita: {eur}",
  },
  "recTrade.openCapital": { en: "Open capital", it: "Capitale aperto" },
  "recTrade.openPnl": { en: "Open P&L", it: "P&L aperto" },
  "recTrade.confirmBuy": { en: "Confirm BUY", it: "Conferma BUY" },
  "recTrade.confirmSell": { en: "Confirm SELL", it: "Conferma SELL" },
  "recTrade.cancel": { en: "Cancel", it: "Annulla" },
  "recTrade.close": { en: "Close", it: "Chiudi" },
  "recTrade.viewDetail": {
    en: "Open ticker detail",
    it: "Apri dettaglio ticker",
  },
  "recTrade.msg.bought": {
    en: "Bought {ticker} · {eur} @ {price}",
    it: "Comprato {ticker} · {eur} @ {price}",
  },
  "recTrade.msg.sold": {
    en: "Sold {ticker}",
    it: "Venduto {ticker}",
  },
  "recTrade.err.noPrice": {
    en: "No current price on the sheet — cannot buy yet.",
    it: "Nessun prezzo corrente sul foglio — impossibile comprare ora.",
  },
  "recTrade.err.noPosition": {
    en: "No open position to sell.",
    it: "Nessuna posizione aperta da vendere.",
  },
  "recTrade.err.invalidCapital": {
    en: "Enter a valid capital > 0.",
    it: "Inserisci un capitale valido > 0.",
  },
  "dashboard.rec.sellEmpty": { en: "None now", it: "Nessuno ora" },
  "dashboard.banner.open": { en: "Open", it: "Apri" },
  "dashboard.banner.dismiss": { en: "Dismiss", it: "Chiudi" },

  "urgentSell.kicker": {
    en: "Urgent Soft SELL",
    it: "Soft SELL urgente",
  },
  "urgentSell.title": {
    en: "Sell now ({n})",
    it: "Vendi subito ({n})",
  },
  "urgentSell.subtitle": {
    en: "Home Soft / Urgent / continuation flagged these open names — sell in the sim book now.",
    it: "Home Soft / Urgent / continuation ha segnalato questi titoli aperti — vendili subito nel book di simulazione.",
  },
  "urgentSell.hint": {
    en: "Tap a ticker to confirm SELL · × dismisses until the list changes.",
    it: "Tocca un ticker per confermare SELL · × nasconde finché la lista non cambia.",
  },
  "urgentSell.dismiss": { en: "Dismiss", it: "Chiudi" },
  "dashboard.seg.book": { en: "Book", it: "Book" },
  "dashboard.seg.whatif": { en: "24h what-if", it: "What-if 24h" },

  "autoSold.title": {
    en: "Auto-sold (Urgent G2)",
    it: "Vendita automatica (Urgent G2)",
  },
  "autoSold.subtitle": {
    en: "Desktop closed these names — day losses exceeded 20% of (purchased + gains) on the whole book. Fastest day losers sold first.",
    it: "Il desktop ha chiuso questi titoli — perdite giornaliere oltre il 20% di (acquistato + guadagnato) sul portafoglio. Prima i ribassi day più drastiche.",
  },
  "autoSold.openAfter": {
    en: "Open positions now: {n}",
    it: "Posizioni aperte ora: {n}",
  },
  "autoSold.dayLine": {
    en: "day {pct} · {eur}",
    it: "giorno {pct} · {eur}",
  },
  "autoSold.close": { en: "Close", it: "Chiudi" },

  "redBell.kicker": {
    en: "Real-time alert",
    it: "Avviso in tempo reale",
  },
  "redBell.title": {
    en: "Red bell ({n})",
    it: "Campanella rossa ({n})",
  },
  "redBell.subtitle": {
    en: "These open names dropped ≥20% of (purchased + gains) from peak and are underwater.",
    it: "Questi titoli aperti hanno perso ≥20% di (acquistato + guadagnato) dal picco e sono in perdita.",
  },
  "redBell.line": {
    en: "{pct} of base {base} · MTM {pnl}",
    it: "{pct} della base {base} · MTM {pnl}",
  },
  "redBell.close": { en: "Got it", it: "Ho capito" },

  "priorDay.aria": {
    en: "Prior-day book activity",
    it: "Movimenti giorno precedente",
  },
  "priorDay.kicker": { en: "Previous day", it: "Giorno precedente" },
  "priorDay.title": {
    en: "Buys & sells · {day}",
    it: "Acquisti e vendite · {day}",
  },
  "priorDay.sub": {
    en: "Opened yesterday · closed yesterday or today. Same book as desktop Home.",
    it: "Aperture di ieri · chiusure di ieri o di oggi. Stesso book della Home desktop.",
  },
  "priorDay.noBuys": { en: "No buys yesterday", it: "Nessun acquisto ieri" },
  "priorDay.noSells": {
    en: "No sells yesterday/today",
    it: "Nessuna vendita ieri/oggi",
  },
  "priorDay.dismiss": { en: "Dismiss", it: "Nascondi" },

  "push.section": { en: "Action alerts", it: "Avvisi azioni" },
  "push.sectionHint": {
    en: "Phone banners for auto-sold, red bells, and Soft/Urgent SELL — even when the app is in background. Needs HTTPS (or localhost), installed PWA, and permission.",
    it: "Banner sul telefono per vendite automatiche, campanelle rosse e Soft/Urgent SELL — anche a app in background. Serve HTTPS (o localhost), PWA installata e permesso.",
  },
  "push.enable": { en: "Enable action notifications", it: "Attiva notifiche azioni" },
  "push.disable": { en: "Disable notifications", it: "Disattiva notifiche" },
  "push.status.granted": { en: "Notifications on", it: "Notifiche attive" },
  "push.status.denied": {
    en: "Blocked in system settings — enable for SuperNova / Safari.",
    it: "Bloccate nelle impostazioni di sistema — abilita per SuperNova / Safari.",
  },
  "push.status.default": { en: "Not enabled yet", it: "Non ancora attivate" },
  "push.status.unsupported": {
    en: "Not supported in this browser (use installed PWA on HTTPS).",
    it: "Non supportate in questo browser (usa la PWA installata su HTTPS).",
  },
  "push.status.subscribed": { en: "Subscribed for push", it: "Iscritto al push" },
  "push.status.error": { en: "Could not subscribe: {err}", it: "Iscrizione non riuscita: {err}" },
  "push.iosNote": {
    en: "iOS: Add to Home first, then enable alerts here (Safari 16.4+).",
    it: "iOS: prima Aggiungi a Home, poi attiva gli avvisi qui (Safari 16.4+).",
  },
  "dashboard.whatif.title": {
    en: "24h what-if · $5,000 / name",
    it: "What-if 24h · $5.000 / titolo",
  },
  "dashboard.whatif.sub": {
    en: "{n} names · equal-weight {cap} stake (Simulation)",
    it: "{n} titoli · stake uguale {cap} (Simulation)",
  },
  "dashboard.whatif.empty": {
    en: "No Simulation rows for what-if.",
    it: "Nessuna riga Simulation per il what-if.",
  },
  "dashboard.whatif.kpiPf": { en: "PF 24h", it: "PF 24h" },
  "dashboard.whatif.kpiUni": { en: "Universe 24h", it: "Universo 24h" },
  "dashboard.whatif.kpiCap": { en: "Capture", it: "Capture" },
  "dashboard.whatif.missed": { en: "Missed {eur}", it: "Perso {eur}" },
  "dashboard.whatif.scopeAll": { en: "All", it: "Tutti" },
  "dashboard.whatif.scopePf": { en: "Portfolio", it: "Portafoglio" },
  "dashboard.whatif.scopeOff": { en: "Off-book", it: "Fuori book" },
  "dashboard.whatif.colTicker": { en: "Ticker", it: "Ticker" },
  "dashboard.whatif.colD24": { en: "Δ24h", it: "Δ24h" },
  "dashboard.whatif.colG10": { en: "10d %", it: "10g %" },
  "dashboard.whatif.colWind": { en: "P(cont)", it: "P(cont)" },
  "dashboard.whatif.foot": {
    en: "Green row = strong wind (10d≥5% · P(cont)≥50% · day not red). Soft BUY/SELL live on Book tab.",
    it: "Riga verde = vento forte (10g≥5% · P(cont)≥50% · giorno non rosso). Soft BUY/SELL nella tab Book.",
  },
  "dashboard.wind.title": {
    en: "Market moves & wind",
    it: "Movimenti di mercato e vento",
  },
  "dashboard.wind.sub": {
    en: "24h path · Δ24h · P(continuation) wind — same sheet as desktop what-if.",
    it: "Path 24h · Δ24h · vento P(continuation) — stesso foglio del what-if desktop.",
  },
  "dashboard.wind.empty": {
    en: "No market / wind rows yet — refresh Simulation.",
    it: "Nessuna riga mercato/vento — aggiorna Simulation.",
  },
  "dashboard.wind.colTicker": { en: "Ticker", it: "Ticker" },
  "dashboard.wind.colPath": { en: "24h path", it: "Path 24h" },
  "dashboard.wind.colD24": { en: "Δ 24h", it: "Δ 24h" },
  "dashboard.wind.colWind": { en: "P(cont)", it: "P(cont)" },
  "dashboard.wind.inBook": { en: "In portfolio", it: "In portafoglio" },
  "dashboard.open.title": {
    en: "Open positions ({n})",
    it: "Posizioni aperte ({n})",
  },
  "dashboard.open.sub": {
    en: "Book holdings — tap a row for detail.",
    it: "Posizioni in book — tocca una riga per il dettaglio.",
  },
  "dashboard.open.empty": { en: "No open positions.", it: "Nessuna posizione aperta." },
  "dashboard.open.colTicker": { en: "Ticker", it: "Ticker" },
  "dashboard.open.colRec": { en: "Rec", it: "Rec" },
  "dashboard.open.colWind": { en: "Wind", it: "Vento" },
  "dashboard.open.colInvested": { en: "Inv.", it: "Inv." },
  "dashboard.open.colMove": { en: "24h / Δ", it: "24h / Δ" },
  "dashboard.open.col24h": { en: "24h", it: "24h" },
  "dashboard.open.colPnl": { en: "P&L", it: "P&L" },
  "dashboard.alloc.title": {
    en: "Portfolio allocation",
    it: "Allocazione portafoglio",
  },
  "dashboard.alloc.sub": {
    en: "% invested capital by ticker · total {total}",
    it: "% capitale investito per titolo · totale {total}",
  },
  "dashboard.alloc.empty": { en: "No open positions.", it: "Nessuna posizione aperta." },
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
  "dashboard.actions.colLastRead": { en: "Last read", it: "Ultima lettura" },
  "dashboard.actions.lastReadLocalTip": {
    en: "Change vs your last mobile refresh (local price snapshot).",
    it: "Variazione vs ultimo refresh mobile (snapshot prezzo locale).",
  },
  "dashboard.actions.lastReadMarketCloseTip": {
    en: "Daily var. % vs previous session close (Simulation sheet).",
    it: "Var. Giorn. % vs chiusura sessione precedente (foglio Simulation).",
  },
  "dashboard.actions.colTarget": { en: "Target", it: "Target" },
  "dashboard.actions.colEis": { en: "EIS", it: "EIS" },
  "dashboard.actions.eisDetails": { en: "EIS details", it: "Dettaglio EIS" },
  "dashboard.actions.colReason": { en: "Reason", it: "Motivo" },
  "dashboard.actions.sub": { en: "Max 5 · portfolio", it: "Max 5 · portafoglio" },
  "dashboard.actions.empty": { en: "No active recommendations.", it: "Nessuna raccomandazione attiva." },
  "dashboard.actions.syncHint": {
    en: "Recommendations are built on this device from VPS data when desktop is offline. Tap ↻ Refresh after server updates.",
    it: "Le raccomandazioni sono calcolate sul dispositivo dai dati VPS quando il desktop è spento. ↻ Aggiorna dopo gli update server.",
  },
  "dashboard.snapshot.localSource": {
    en: "Built on device (VPS data)",
    it: "Calcolato sul dispositivo (dati VPS)",
  },
  "dashboard.snapshot.desktopSource": {
    en: "Synced from desktop",
    it: "Sincronizzato da desktop",
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

  "portfolio.views.24h": { en: "24h check", it: "Controllo 24h" },
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
  "portfolio.check.verdict": { en: "Verdict", it: "Verdetto" },
  "portfolio.views.pnl": { en: "P&L", it: "P&L" },
  "portfolio.views.trend": { en: "Trend", it: "Andamento" },
  "portfolio.summary": {
    en: "{count} pos · {loss} loss · {gain} gain",
    it: "{count} pos · {loss} in perdita · {gain} in guadagno",
  },
  "portfolio.totalPnl": { en: "Total P&L:", it: "P&L totale:" },
  "portfolio.totalGain": { en: "Total gain", it: "Guadagno totale" },
  "portfolio.gain24h": { en: "24h gain", it: "Guadagno 24h" },
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
    it: "{gain} in guadagno · {loss} in perdita · {pct}% gain",
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
  "opportunities.aiFeed.title": { en: "Top AI Feed", it: "Feed AI top" },
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
  "detail.capitalInvested": { en: "Invested capital", it: "Capitale investito" },
  "detail.capitalAvailable": { en: "Available capital", it: "Capitale disponibile" },
  "detail.recommendation": { en: "Recommendation", it: "Raccomandazione" },
  "detail.recSize": { en: "Rec. size", it: "Dim. raccom." },
  "detail.pRecovery": { en: "P(recovery)", it: "P(recovery)" },
  "detail.portfolioEntry": { en: "Portfolio entry", it: "Ingresso portafoglio" },
  "detail.lastReading": { en: "Last reading", it: "Ultima lettura" },
  "detail.tradingDay": { en: "Trading day", it: "Giornata di borsa" },
  "detail.gainIdeaTitle": { en: "Gain outlook", it: "Prospettiva guadagno" },
  "detail.targetRoiHint": {
    en: "Target ROI {roi} · PPI {ppi} · {capital} invested",
    it: "ROI target {roi} · PPI {ppi} · {capital} investiti",
  },
  "detail.slopeModelTitle": { en: "Slope & model", it: "Pendenza e modello" },
  "detail.slopeModelLine": {
    en: "MII slope: {slope} · PPI: {ppi} · ROI target: {roi}",
    it: "Pendenza MII: {slope} · PPI: {ppi} · ROI target: {roi}",
  },
  "detail.pred5": { en: "Pred +5", it: "Pred +5" },
  "detail.notAvailable": { en: "N/A", it: "N/D" },
  "detail.verdict.drop": { en: "DROP", it: "CALO" },
  "detail.verdict.rise": { en: "RISE", it: "SALITA" },
  "detail.verdict.flat": { en: "FLAT", it: "FLAT" },
  "detail.verdict.watch": { en: "WATCH", it: "ATTENZIONE" },
  "detail.holdAction": { en: "HOLD", it: "HOLD" },
  "detail.marketPrice": { en: "Market price", it: "Prezzo mercato" },
  "detail.marketClosedTitle": { en: "NASDAQ closed", it: "NASDAQ chiuso" },
  "detail.marketClosedHint": {
    en: "Buy price will be locked at the last regular close ({price}) when you save, to avoid phantom P&L until the market reopens.",
    it: "Al salvataggio il prezzo di acquisto verrà bloccato all'ultimo close regolare ({price}), per evitare P&L fantasma finché il mercato non riapre.",
  },
  "detail.marketClosedSnapped": {
    en: "Buy price snapped to last close ({price}) — market was closed.",
    it: "Prezzo di acquisto allineato all'ultimo close ({price}) — mercato chiuso.",
  },
  "detail.priceMismatchWarn": {
    en: "Your price differs from the market ({price}) by {diff}. Double-check before saving.",
    it: "Il tuo prezzo si discosta dal mercato ({price}) di {diff}. Verifica prima di salvare.",
  },
  "detail.priceMismatchAck": {
    en: "Use market price",
    it: "Usa prezzo di mercato",
  },
  "detail.desktopNote": {
    en: "Slope errors · Prediction curves · Decision Lab · full EIS details → open on desktop",
    it: "Slope errors · Prediction curves · Decision Lab · EIS details completi → apri su desktop",
  },

  "install.compactSummary": { en: "How to add the icon to Home", it: "Come aggiungere l'icona alla Home" },
  "install.compactHint": {
    en: "Safari (iOS): Share → Add to Home, then Settings → Action alerts. Chrome (Android): menu ⋮ → Install / Add to Home, then enable notifications.",
    it: "Safari (iOS): Condividi → Aggiungi a Home, poi Impostazioni → Avvisi azioni. Chrome (Android): menu ⋮ → Installa / Aggiungi a Home, poi attiva le notifiche.",
  },
  "install.title": { en: "Home screen icon", it: "Icona sulla Home" },
  "install.hint": {
    en: "Online server: {host}/mobile/ + token. Optional UI preview: :5174 (API proxied to VPS).",
    it: "Server online: {host}/mobile/ + token. Anteprima UI opzionale: :5174 (API in proxy sul VPS).",
  },
  "install.iosTitle": { en: "iPhone / iPad (Safari)", it: "iPhone / iPad (Safari)" },
  "install.ios1": { en: "Safari → app URL → Connect with VPS token.", it: "Safari → URL app → Connetti con token VPS." },
  "install.ios2": { en: "Share → Add to Home.", it: "Condividi → Aggiungi a Home." },
  "install.ios3": {
    en: "Open the Home icon → Settings → enable Action alerts (required for lock-screen banners).",
    it: "Apri l’icona Home → Impostazioni → attiva Avvisi azioni (serve per i banner a schermo bloccato).",
  },
  "install.androidTitle": { en: "Android (Chrome)", it: "Android (Chrome)" },
  "install.android1": { en: "Chrome → same URL.", it: "Chrome → stesso URL." },
  "install.android2": {
    en: "Menu ⋮ → Install app or Add to Home screen.",
    it: "Menu ⋮ → Installa app o Aggiungi a schermata Home.",
  },
  "install.android3": {
    en: "Allow notifications when prompted (or Settings → Action alerts).",
    it: "Consenti le notifiche al prompt (o Impostazioni → Avvisi azioni).",
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
    en: "API error — check VPS health or retry in settings.",
    it: "API in errore — controlla lo stato del VPS o riprova dalle impostazioni.",
  },
  "error.apiOfflineDev": {
    en: "API offline — open http://91.99.15.48:8765/mobile/ or check network, then refresh.",
    it: "API offline — apri http://91.99.15.48:8765/mobile/ o controlla la rete, poi aggiorna.",
  },
  "error.apiOfflineRemote": {
    en: "Cannot reach {host} — check VPN/network or clear API URL in settings (use empty URL for local dev).",
    it: "Server {host} non raggiungibile — controlla rete/VPN o svuota URL API nelle impostazioni (dev locale = URL vuoto).",
  },
  "error.apiSlow": {
    en: "API slow or busy — wait ~20s and tap Refresh.",
    it: "API lenta o occupata — attendi ~20s e premi Aggiorna.",
  },
  "error.endpointNotFound": {
    en: "API endpoint not found — open http://91.99.15.48:8765/mobile/ (same origin, empty API URL).",
    it: "Endpoint API non trovato — apri http://91.99.15.48:8765/mobile/ (stesso origin, URL API vuoto).",
  },

  "msg.saved": { en: "Saved to server ✓", it: "Salvato sul server ✓" },
  "msg.positionClosed": { en: "Position closed ✓", it: "Posizione chiusa ✓" },

  "nav.main": { en: "Main navigation", it: "Navigazione principale" },
  "nav.dashboard": { en: "Dashboard", it: "Dashboard" },
  "nav.trades": { en: "Trades", it: "Trades" },

  "trades.intro": {
    en: "Portfolio + CD-window opportunities — edit Buy $ and Capital $ inline.",
    it: "Portafoglio + opportunità in finestra CD — modifica Buy $ e Capital $ in linea.",
  },
  "trades.empty": { en: "No trade candidates.", it: "Nessun candidato trade." },
  "trades.inPortfolio": { en: "In your portfolio", it: "Nel tuo portafoglio" },
  "trades.cdSoonStar": { en: "CD within 7 days", it: "CD entro 7 giorni" },
  "trades.col.ticker": { en: "Ticker / Company", it: "Ticker / Società" },
  "trades.col.ticker1": { en: "Ticker", it: "Ticker" },
  "trades.col.ticker2": { en: "Company", it: "Società" },
  "trades.col.cd": { en: "CD", it: "CD" },
  "trades.col.riskBenefit": { en: "Risk / Benefit", it: "Rischio / Beneficio" },
  "trades.col.risk1": { en: "Risk", it: "Rischio" },
  "trades.col.risk2": { en: "Benefit", it: "Beneficio" },
  "trades.col.price": { en: "Price", it: "Prezzo" },
  "trades.col.target": { en: "Target", it: "Target" },
  "trades.col.rec": { en: "Rec.", it: "Rec." },
  "trades.col.recSize": { en: "Rec. size", it: "Dim. raccom." },
  "trades.col.recSize1": { en: "Rec.", it: "Raccom." },
  "trades.col.recSize2": { en: "Size", it: "Dim." },
  "trades.col.buy": { en: "Buy $", it: "Buy $" },
  "trades.col.capital": { en: "Capital $", it: "Capital $" },

  "simCapital.short": { en: "Cap.", it: "Cap." },
  "simCapital.aria": { en: "Simulation starting capital", it: "Capitale iniziale simulazione" },
  "simCapital.hint": {
    en: "Total simulation budget — drives available capital and Rec. size €.",
    it: "Budget totale simulazione — alimenta capitale disponibile e Rec. size €.",
  },
  "simCapital.availableHint": {
    en: "Available capital (budget + closed P&L − invested)",
    it: "Capitale disponibile (budget + P&L chiusi − investito)",
  },
  "nav.piggy": { en: "Investments", it: "Investimenti" },
  "nav.investments": { en: "Investments", it: "Investimenti" },
  "nav.portfolio": { en: "Portfolio", it: "Portafoglio" },
  "nav.opportunities": { en: "Opportunities", it: "Opportunità" },
  "nav.myPortfolio": { en: "My Portfolio", it: "Il mio portafoglio" },

  "decision.title": { en: "Decision chart", it: "Grafico decisionale" },
  "decision.subtitle": {
    en: "Buy · Hold · Review · Sell — tap a ticker for radar detail.",
    it: "Buy · Hold · Review · Sell — tocca un ticker per il dettaglio radar.",
  },
  "decision.subtitlePortfolio": {
    en: "Open portfolio positions — same view as desktop Portfolio tab.",
    it: "Posizioni aperte in portafoglio — stessa vista del tab Portfolio desktop.",
  },
  "decision.subtitleOppHot": {
    en: "Off-portfolio opportunities within 2 months of CD (hot zone).",
    it: "Opportunità fuori portafoglio entro 2 mesi dal CD (zona calda).",
  },
  "decision.subtitleOppWatch": {
    en: "Early opportunities — CD between 61–120 days (4–2 months watch zone).",
    it: "Opportunità anticipate — CD tra 61–120 giorni (zona watch 4–2 mesi).",
  },
  "decision.cdWindow": { en: "CD window", it: "Finestra CD" },
  "decision.cdFilter": { en: "CD filter", it: "Filtro CD" },
  "decision.sectionPortfolio": { en: "Decision chart · portfolio", it: "Grafico decisionale · portafoglio" },
  "decision.sectionOppHot": { en: "Decision chart · off-portfolio · CD ≤ 2 mo", it: "Grafico decisionale · fuori portafoglio · CD ≤ 2 mesi" },
  "decision.sectionOppWatch": { en: "Decision chart · off-portfolio · CD 4–2 mo", it: "Grafico decisionale · fuori portafoglio · CD 4–2 mesi" },
  "decision.scopePortfolio": { en: "Portfolio", it: "Portfolio" },
  "decision.scopeOppHot": { en: "Within 2 mo", it: "Entro 2 mesi" },
  "decision.scopeOppWatch": { en: "Early 4–2 mo", it: "Anticipate 4–2 mesi" },
  "decision.filterAll": { en: "All", it: "Tutti" },
  "decision.filterGain24": { en: "↑ 24h gain", it: "↑ guadagno 24h" },
  "decision.filterLoss24": { en: "↓ 24h loss", it: "↓ perdita 24h" },
  "decision.emptyPortfolio": {
    en: "No open portfolio positions with loss-analysis data.",
    it: "Nessuna posizione aperta con dati analisi perdite.",
  },
  "decision.emptyOppHot": {
    en: "No off-portfolio opportunities within 2 months of CD.",
    it: "Nessuna opportunità fuori portafoglio entro 2 mesi dal CD.",
  },
  "decision.emptyOppWatch": {
    en: "No opportunities in the 4–2 month watch window (CD 61–120 days).",
    it: "Nessuna opportunità nella finestra watch 4–2 mesi (CD 61–120 giorni).",
  },
  "decision.emptyOppFilter": {
    en: "No tickers match this 24h filter in the current CD window.",
    it: "Nessun ticker corrisponde a questo filtro 24h nella finestra CD corrente.",
  },
  "decision.empty": { en: "No tickers for decision chart.", it: "Nessun ticker per il grafico decisionale." },
  "decision.insufficient": { en: "Insufficient scores for a firm call.", it: "Score insufficienti per una raccomandazione solida." },
  "decision.guideLink": { en: "Index guide", it: "Guida indici" },
  "decision.guideTitle": { en: "Decision chart indices", it: "Indici del decision chart" },
  "decision.guideSubtitle": {
    en: "Scores used for BUY / HOLD / UNCERTAIN / SELL on the radar and bars.",
    it: "Score usati per BUY / HOLD / INCERTO / SELL su radar e barre.",
  },
  "decision.guideInvNote": {
    en: "(inv.) on LOSS and Regulatory Risk: the radar axis is inverted — high risk shrinks the polygon dot; bars still show raw 0–100.",
    it: "(inv.) su LOSS e Regulatory Risk: l'asse radar è invertito — rischio alto riduce il punto; le barre mostrano il valore grezzo 0–100.",
  },
  "decision.recLegend": {
    en: "Orange badge/chip = UNCERTAIN (unclear profile — not an immediate buy or sell).",
    it: "Badge/chip arancione = INCERTO (profilo non chiaro — non è un acquisto o vendita immediata).",
  },
  "decision.eisMissing": {
    en: "No clinical feed event with EIS for this ticker.",
    it: "Nessun evento clinico con EIS calcolabile per questo ticker.",
  },
  "decision.deepenScore": {
    en: "Open {label} block below",
    it: "Apri blocco {label} sotto",
  },
  "decision.openChartsBelow": {
    en: "Curves →",
    it: "Grafici →",
  },
  "decision.curvesHint": {
    en: "Opens the full ticker card with price, model, MII and gain charts.",
    it: "Apre la scheda ticker con grafici price, modello, MII e gain.",
  },
  "decision.index.rec.acronym": { en: "REC", it: "REC" },
  "decision.index.rec.full": { en: "Recommendation", it: "Raccomandazione" },
  "decision.index.rec.desc": {
    en: "Recovery / entry probability P(plan) on a 0–100 scale. Same headline score as desktop recommendations.",
    it: "Probabilità di recovery / ingresso P(plan) su scala 0–100. Stesso score headline delle raccomandazioni desktop.",
  },
  "decision.index.sds.acronym": { en: "SDS", it: "SDS" },
  "decision.index.sds.full": { en: "Supernova Distance Score", it: "Supernova Distance Score" },
  "decision.index.sds.desc": {
    en: "Distance of the current price path from the Supernova reference curve — higher = closer to the model target.",
    it: "Distanza del percorso prezzo dalla curva di riferimento Supernova — più alto = più vicino al target del modello.",
  },
  "decision.index.eis.acronym": { en: "EIS", it: "EIS" },
  "decision.index.eis.full": { en: "Event Impact Score", it: "Event Impact Score" },
  "decision.index.eis.desc": {
    en: "Clinical feed impact: price reaction, volume and endpoint KPIs. Bar label shows signed raw score (e.g. +1); radar uses 0–100 display scale.",
    it: "Impatto feed clinico: reazione prezzo, volume e KPI endpoint. Etichetta barra = score grezzo con segno (es. +1); radar su scala 0–100.",
  },
  "decision.index.loss.acronym": { en: "LOSS", it: "LOSS" },
  "decision.index.loss.full": { en: "Loss risk (Risk v2)", it: "Rischio loss (Risk v2)" },
  "decision.index.loss.desc": {
    en: "Combined investment risk 0–100 from the Loss Risk engine (plan, timing, liquidity, regulatory on closed deals). Higher = more risk.",
    it: "Rischio investimento combinato 0–100 dal motore Loss Risk (plan, timing, liquidità, regolatorio su deal chiusi). Più alto = più rischio.",
  },
  "decision.index.regulatory.acronym": { en: "Regulatory Risk", it: "Rischio regolatorio" },
  "decision.index.regulatory.full": { en: "Regulatory risk", it: "Rischio regolatorio" },
  "decision.index.regulatory.desc": {
    en: "Regulatory imminence / burden from the regulatory snapshot. High values push toward SELL or cautious UNCERTAIN.",
    it: "Imminenza / carico regolatorio dallo snapshot regulatory. Valori alti spingono verso SELL o INCERTO prudente.",
  },
  "decision.index.mcs.acronym": { en: "MCS", it: "MCS" },
  "decision.index.mcs.full": { en: "Market Context Score", it: "Market Context Score" },
  "decision.index.mcs.desc": {
    en: "Market Context Score: sector, macro, breadth, FDA tone and rolling ticker–XBI correlation. Favorable MCS supports HOLD in rescue; adverse MCS flags external headwinds.",
    it: "Market Context Score: settore, macro, breadth, tono FDA e correlazione rolling ticker–XBI. MCS favorevole aiuta HOLD in rescue; MCS avverso segnala vento contrario esterno.",
  },

  "pickStocks.title": { en: "Pick stocks", it: "Selezione titoli" },
  "pickStocks.sub": { en: "Top off-portfolio opportunities by ROI/day.", it: "Migliori opportunità fuori portafoglio per ROI/giorno." },
  "pickStocks.empty": { en: "No picks in hot/watch zone.", it: "Nessun pick in zona calda/watch." },
  "pickStocks.col.ticker": { en: "Ticker", it: "Ticker" },

  "portfolioNews.title": { en: "Portfolio EIS & regulatory news", it: "News EIS e regolatorie portafoglio" },
  "portfolioNews.sub": {
    en: "Clinical and regulatory feed for your {n} open positions.",
    it: "Feed clinico e regolatorio per le tue {n} posizioni aperte.",
  },
  "portfolioNews.noPortfolio": { en: "No open positions.", it: "Nessuna posizione aperta." },
  "portfolioNews.loading": { en: "Loading clinical feed…", it: "Caricamento feed clinico…" },
  "portfolioNews.emptyAll": {
    en: "No EIS or regulatory news in the last 7 days for portfolio tickers.",
    it: "Nessuna news EIS o regolatoria negli ultimi 7 giorni sui ticker in portafoglio.",
  },
  "portfolioNews.window24h": { en: "Last 24 hours", it: "Ultime 24 ore" },
  "portfolioNews.window7d": { en: "Last 7 days", it: "Ultimi 7 giorni" },
  "portfolioNews.emptyEis": { en: "No EIS news in this window.", it: "Nessuna news EIS in questa finestra." },
  "portfolioNews.emptyReg": {
    en: "No regulatory news in this window.",
    it: "Nessuna news regolatoria in questa finestra.",
  },

  "buySizing.title": { en: "Suggested allocation (BUY)", it: "Allocazione suggerita (BUY)" },
  "buySizing.hint": {
    en: "Invest ~{pct}% of capital ({eur}) on a {capital} portfolio — risk-adjusted.",
    it: "Investi ~{pct}% del capitale ({eur}) su portafoglio {capital} — aggiustato per rischio.",
  },
  "buySizing.riskNote": { en: "Lower risk → higher %; reg/risk penalties applied.", it: "Rischio basso → % più alta; penalità reg/rischio applicate." },
  "buySizing.notBuy": {
    en: "No BUY allocation for this ticker — select a BUY chip below to see suggested sizing.",
    it: "Nessuna allocazione BUY per questo ticker — seleziona un chip BUY sotto per vedere la sizing suggerita.",
  },

  "assessment24h.intro": {
    en: "24h portfolio assessment — verdict, moves and charts per position.",
    it: "Valutazione 24h portafoglio — verdetto, movimenti e grafici per posizione.",
  },
  "assessment24h.empty": { en: "No open positions.", it: "Nessuna posizione aperta." },
  "assessment24h.charts": { en: "Charts", it: "Grafici" },
  "assessment24h.editSim": { en: "Edit sim", it: "Modifica sim" },
  "assessment24h.openCard": { en: "Open analysis", it: "Apri analisi" },

  "nav.opportunity": { en: "Opportunity", it: "Opportunità" },

  "opportunity.section.priceVsMarket": { en: "Price vs Market (XBI)", it: "Prezzo vs mercato (XBI)" },
  "opportunity.section.scoreProfile": { en: "Score profile", it: "Profilo score" },
  "oppTrade.title": { en: "Buy / Sell", it: "Compra / Vendi" },
  "oppTrade.lead": {
    en: "Updates the shared simulation book. Buy price follows the live current quote as the stock moves.",
    it: "Aggiorna il book di simulazione condiviso. Il prezzo BUY segue la quotazione corrente live del titolo.",
  },
  "oppTrade.price": { en: "Current price", it: "Prezzo attuale" },
  "oppTrade.priceLocked": { en: "Live", it: "Live" },
  "oppTrade.priceLive": { en: "Live", it: "Live" },
  "oppTrade.capital": { en: "Capital to invest (€)", it: "Capitale da investire (€)" },
  "oppTrade.buy": { en: "Buy", it: "Compra" },
  "oppTrade.sell": { en: "Sell", it: "Vendi" },
  "oppTrade.sellHint": { en: "Close open position · {eur}", it: "Chiudi posizione aperta · {eur}" },
  "oppTrade.sellDisabled": {
    en: "No open position to sell",
    it: "Nessuna posizione aperta da vendere",
  },
  "opportunity.section.clinical": { en: "Clinical indicators", it: "Indicatori clinici" },
  "opportunity.section.modelSlopes": { en: "Model + slopes", it: "Modello + pendenze" },
  "opportunity.section.slopeActual": { en: "Actual vs model path", it: "Percorso reale vs modello" },
  "opportunity.clinicalEmpty": { en: "No clinical KPIs available.", it: "Nessun KPI clinico disponibile." },
  "opportunity.clinicalMore": { en: "indicators · all events →", it: "indicatori · tutti gli eventi →" },
  "opportunity.modelMissing": { en: "Model data not available.", it: "Dati modello non disponibili." },
  "opportunity.section.curves": { en: "Curves", it: "Grafici" },
  "opportunity.section.eisReg": { en: "EIS · Regulatory", it: "EIS · Regolatorio" },
  "opportunity.eisAllEvents": { en: "All events", it: "Tutti gli eventi" },
  "opportunity.curvesFullscreen": { en: "Full screen charts", it: "Grafici a schermo intero" },
  "opportunity.impactMore": { en: "All events →", it: "Tutti gli eventi →" },
  "opportunity.modelCollapsed": {
    en: "Use the Curves links below to jump to each chart.",
    it: "Usa i link Grafici sotto per saltare ai grafici.",
  },
  "opportunity.modelLegend": { en: "Model", it: "Modello" },
  "opportunity.actualLegend": { en: "Actual", it: "Reale" },
  "opportunity.lowerGood": { en: "↓ good", it: "↓ buono" },
  "opportunity.footer.slopes": { en: "Slopes", it: "Pendenze" },
  "opportunity.footer.curves": { en: "Curves", it: "Grafici" },
  "opportunity.footer.decisionLab": { en: "Decision Lab", it: "Laboratorio decisioni" },
  "opportunity.footer.eis": { en: "EIS", it: "EIS" },
  "opportunity.footer.mii": { en: "MII", it: "MII" },

  "piggy.summaryTitle": { en: "Piggy Bank summary", it: "Riepilogo Piggy Bank" },
  "piggy.simBudgetTitle": { en: "Simulation budget", it: "Budget simulazione" },
  "piggy.gainOpen": { en: "Open gain", it: "Guadagni aperti" },
  "piggy.gainClosed": { en: "Closed gain", it: "Guadagni chiusi" },
  "piggy.gain24h": { en: "24h gain", it: "Guadagno 24h" },
  "piggy.openPositions": { en: "Open positions", it: "Posizioni aperte" },
  "piggy.col.ticker": { en: "Ticker / Company", it: "Ticker / Società" },
  "piggy.col.investedAt": { en: "Buy date", it: "Data invest." },
  "piggy.col.capitalIn": { en: "Capital in", it: "Cap. invest." },
  "piggy.col.pnl": { en: "P&L", it: "Guadagno/perdita" },
  "piggy.col.cd": { en: "CD", it: "Data CD" },
  "piggy.col.pnlUnavailable": {
    en: "P&L unavailable (missing current price)",
    it: "P&L non disponibile (prezzo corrente mancante)",
  },
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
