# Desktop UI — Language Audit (EN vs IT)

Data audit: 2026-07-03 · Scope: `desktop-ui/` only (mobile-ui separato, non toccato).

## Architettura i18n (baseline)

- File dizionario: `desktop-ui/src/shared/i18n.ts` — **3.786 chiavi** con `en`/`it`.
- Toggle lingua globale in **System → Settings** (persistito in `localStorage` key `supernova:app:lang`, default `en`).
- Pattern d'uso: `const t = useT(); t("chiave")` oppure `const { lang } = useLang()` + branching locale (`const it = lang === "it"; return it ? "…" : "…";`).
- Regola: se una stringa **non** passa dal dizionario o dal branching, resta **hardcoded nella lingua in cui è stata scritta** — è la fonte principale dei bug di localizzazione.

## Verdetto sintetico

| Area | Copertura EN | Copertura IT | Note |
| --- | --- | --- | --- |
| Sidebar / topbar / settings | ottima | buona | 8 voci sidebar con `it===en` (Home, Feeds, Trades, Piggy Bank, Evaluation Lab, News) — sono nomi prodotto/brand, accettabile |
| Dashboard principale | buona | buona | Alcune tooltip/frasi hardcoded in italiano (dettaglio sotto) |
| Simulation / P&L | buona | **parziale** | Alcuni titoli colonna hardcoded (`Affidabilità`, `N° Azioni Implicite`, `Prezzo Corrente ($)`) |
| Decision Lab / SDS | buona | **parziale** | 111 chiavi con `en===it` in namespace `decisionLab.*`. Molti sono tecnicismi legittimi (ORR, MAE, Pred +5), altri traducibili |
| Model Lab / Learning Lab | buona | **parziale** | 84 chiavi `en===it` in `modelLab.*` (metriche tecniche + label chart) |
| Panel "nuovi" (RegulatoryRisk, PipelineStaleWarning, ClinicalPreCdFeed, LossRescue, CapDiv Step 1/2/3, LearningLab*, Copilot chat, PatternSearchMonitor…) | **ROTTO in EN** | ok in IT | Interi componenti scritti in IT senza branching → l'utente inglese vede italiano |
| `NewBioIpoModal`, `ConditionalFormatSettings`, `PredictionGuidePanel`, `StudySummaryModal`, `SecK8SimulationView`, `SimulationCurveChart` (fallback), `CatalystCopilotChat` (hint) | ok in EN | **ROTTO in IT** | Interi componenti scritti in EN senza branching → l'utente italiano vede inglese |
| Testi guida / help panel (`financialIndicatorGuide.ts`, `recommendationCompositionGuide.ts`, `curveEngineNarrative.ts`) | **ROTTO in EN** | ok in IT | Guida indicatori 100% italiano |

**Totale problemi confermati**

- **115 stringhe** italiane in **51 file** dove il file non ha alcun meccanismo di lingua (compaiono sempre in italiano, anche in EN).
- **74 stringhe** italiane in **32 file** che DI SOLITO fanno branching ma dove alcune label sono rimaste hardcoded (compaiono in italiano anche in EN).
- **~51 stringhe** inglesi in **16 file** che non fanno branching (compaiono sempre in inglese, anche in IT).
- **398 chiavi** dizionario con `en === it` — dopo aver escluso jargon tecnico (MAE, ORR, ρ, Pred +5…), restano ~60-80 candidati da tradurre in italiano.

---

## Sezione A — Componenti 100% italiano (l'utente EN vede IT)

Ordinati per numero di stringhe hardcoded (top 20):

| # | File | Hits | Cosa vede l'utente inglese |
| - | ---- | ---- | -------------------------- |
| 1 | `desktop-ui/src/sheet/financialIndicatorGuide.ts` | 13 | Intera guida indicatori finanziari — "Nome società…", "Capitalizzazione di mercato…", "Liquidità FY…" |
| 2 | `desktop-ui/src/components/RegulatoryRiskPanel.tsx` | 7 | "Aggiungi data PDUFA", "Salva", "Annulla", "Menzioni CMC / manufacturing", "Nessuna menzione…", "Storico CRL…", "Non registrata" |
| 3 | `desktop-ui/src/sheet/decisionChartLogic.ts` | 7 | Motivazioni raccomandazione: "P(plan) alto/basso", "posizione in rescue space", "MCS non ancora disponibile" |
| 4 | `desktop-ui/src/components/CdPatternPolygonAccuracySection.tsx` | 5 | Attributi `title` in italiano + testo "Tutte", "I dati proxy…" |
| 5 | `desktop-ui/src/sheet/precatCurve.ts` | 5 | Etichette confidenza "MOLTO ALTA", "ALTA", "BASSA" |
| 6 | `desktop-ui/src/components/catalystCopilotFocus.ts` | 4 | Prompt Copilot "criticità e passi avanti…", "reazione prezzo T+1/T+3…" |
| 7 | `desktop-ui/src/components/PipelineStaleWarningModal.tsx` | 4 | Intero modal: "Aggiornamento EIS non riuscito", "L'ultimo refresh…", "Gli score EIS e Regulatory Risk…" |
| 8 | `desktop-ui/src/components/SimulationAnalysisView.tsx` | 3 | "Nessuna posizione aperta in Simulation", "Mostra tutte le curve delle posizioni aperte", "— seleziona preset —" |
| 9 | `desktop-ui/src/components/WeightSimExpPanel.tsx` | 3 | Descrizione lunga: "Calcola la distribuzione ottimale…", "Le curve rosa/fucsia…" |
| 10 | `desktop-ui/src/sheet/recommendationCompositionGuide.ts` | 3 | Regole raccomandazione |
| 11 | `desktop-ui/src/sheet/simulationStyles.ts` | 3 | "Prezzo Corrente ($)", "Affidabilità", "Liquidità" |
| 12 | `desktop-ui/src/components/ManualAllocationSynthesizerPanel.tsx` | 2 | "ovvero circa … sono stati win", "Precision/recall sulle aperte…" |
| 13 | `desktop-ui/src/components/TableViewSettings.tsx` | 2 | Attributi accessibilità: "Chiudi pannello layout", "Mostra colonna" |
| 14 | `desktop-ui/src/data/accuracyModelData.ts` | 2 | Errori: "File assente (…). Esegui scripts/…" |
| 15 | `desktop-ui/src/data/investmentSimOutcomesData.ts` | 2 | Errori: "Rigenerazione non disponibile…" |
| 16 | `desktop-ui/src/data/simulationCharts.ts` | 2 | Errori: "Dati grafici assenti…", "esegui Export_Desktop_Snapshots.bat…" |
| 17 | `desktop-ui/src/riskPattern/continuousFeatureRegression.ts` | 2 | Commenti/etichette regressione |
| 18 | `desktop-ui/src/sheet/clinicalSimulationFilter.ts` | 2 | Header "Società" |
| 19 | `desktop-ui/src/sheet/dashboardRecommendationsView.ts` | 2 | Header colonna "Prezzo Corrente ($)" |
| 20 | `desktop-ui/src/sheet/investSimStorage.ts` | 2 | Commenti (non user-facing) — falsi positivi |

*(elenco completo, 51 file, in `_i18n_hardcoded_scan_out.txt`)*

## Sezione B — Componenti con branching parziale (label italiane sfuggite)

Il file fa branching in molti punti, ma alcune label restano fisse in italiano.

| # | File | Hits | Esempi |
| - | ---- | ---- | ------ |
| 1 | `desktop-ui/src/sheet/simulationPosition.ts` | 11 | "N° Azioni Implicite", "Prezzo Acquisto ($)", "Prezzo Corrente ($)", "Prezzo Apertura ($)", "Variazione giornaliera %", "Società" (usate anche come chiavi di lookup — verificare) |
| 2 | `desktop-ui/src/components/LearningLabUnifiedView.tsx` | 7 | "C · Portafoglio / sizing / advice", "D · Monitoring & qualità", "In miglioramento", "Raccolta dati", "settimanale · Dom", "refresh giornaliero" |
| 3 | `desktop-ui/src/components/InvestmentDecisionLabView.tsx` | 4 | "Prezzo acquisto" (JSX), commenti "Un job è già in corso" (non user-facing) |
| 4 | `desktop-ui/src/components/InvestmentSimulationView.tsx` | 4 | Header "Affidabilità", "Affidabilità calib %", "Affidabilità %" |
| 5 | `desktop-ui/src/components/ModelComparisonPanel.tsx` | 4 | "portafoglio" (2x), "Affidabilità %", riga meta metadata polygon |
| 6 | `desktop-ui/src/components/CapDivStep2RiskView.tsx` | 3 | Testi tooltip lunghi "Questo step identifica…", "Il sistema cerca il pattern AND…", 'Clicca "Usa nello score"…' |
| 7 | `desktop-ui/src/components/CapDivStep3BreakevenView.tsx` | 3 | "Nessun deal del portfolio con gain SDS positivo", "Nessun deal del sim loop…" |
| 8 | `desktop-ui/src/components/ContinuousFeatureRegressionPanel.tsx` | 3 | "il feature è basso nelle perdite", "il feature è alto nelle perdite", "red flag se basso" |
| 9 | `desktop-ui/src/components/PatternSearchMonitorPanel.tsx` | 3 | Tooltip "Il lift misura quanto un pattern è discriminante…" |
| 10 | `desktop-ui/src/components/SlopeTrajectoryChart.tsx` | 3 | Testi legenda "Oggi …", "A sinistra il passato…", "= traiettoria attesa…" |

*(elenco completo, 32 file, in `_i18n_hardcoded_scan_out.txt`)*

## Sezione C — Componenti 100% inglese (l'utente IT vede EN)

| # | File | Hits | Cosa vede l'utente italiano |
| - | ---- | ---- | --------------------------- |
| 1 | `desktop-ui/src/components/NewBioIpoModal.tsx` | 7 | Intero modal IPO biotech: "IPO date", "Sector · Industry", "Market cap", "Price $", "Start refresh", "New biotech added:" |
| 2 | `desktop-ui/src/components/ConditionalFormatSettings.tsx` | 6 | Pannello formattazione condizionale: "Conditional formatting", "Color scale", "Bar color", "Icon set", "Priority (application order)", "All numeric columns" |
| 3 | `desktop-ui/src/components/PredictionGuidePanel.tsx` | 6 | "Loading Accuracy sheet…", "Computing curves…", "Prediction Guide", "Week comparison:", "Visible curves (Post-CD)", "Visible curves (Pre-CD)" |
| 4 | `desktop-ui/src/components/ClinicalSimulationView.tsx` | 2 | "Not yet refreshed", "Primary Completion Date" |
| 5 | `desktop-ui/src/components/StudySummaryModal.tsx` | 1 | "This may take 15–25 seconds" |
| 6 | `desktop-ui/src/components/SimulationCurveChart.tsx` | 1 | Fallback "Prices not available." |
| 7 | `desktop-ui/src/components/SimulationPortfolioSheetView.tsx` | 1 | Header colonna "Completion Date (Simulation)" |
| 8 | `desktop-ui/src/components/CatalystCopilotChat.tsx` | 1 | Hint "Enter · Shift+Enter newline" |
| 9 | `desktop-ui/src/components/SecK8SimulationView.tsx` | 1 | Titolo "SEC 8-K" (accettabile — acronimo/brand) |
| 10 | `desktop-ui/src/sheet/simulationSparkline.tsx` | 1 | Tooltip "Model curve (fallback to sheet columns; chart bundle not loaded)" |

## Sezione D — Chiavi dizionario con `en === it` da valutare per traduzione IT

**~398 chiavi totali con testo identico**, ma ~200 sono jargon tecnico che DEVE restare tale (MAE, RMSE, ρ, ORR, PFS/OS, DCR, EIS, SDS, MII, R², Pred +5, RA, P(plan), MAE (pp), ecc.). Sotto le più rilevanti dove la traduzione italiana sarebbe utile:

**Sidebar / navigazione** (tab principali visibili sempre)

| Chiave | Testo attuale (EN=IT) | Traduzione IT suggerita |
| ------ | --------------------- | ----------------------- |
| `sidebar.item.simulation` | Evaluation Lab | *lasciare (brand)* — o "Lab valutazione" |
| `sidebar.item.decisionLab` | Trades | "Trade" (invariato) o "Operazioni" |
| `sidebar.item.piggyBank` | Piggy Bank | *lasciare (brand)* |
| `sidebar.item.catalystFeed` | Feeds | *lasciare* — o "Notizie" |
| `sidebar.section.research` | News | *lasciare* — o "Notizie" |
| `sidebar.item.mainDashboard` | Home | *lasciare* |
| `sidebar.brand.tagline` | Biotech Intel | *lasciare (brand)* |
| `piggyBank.tab.trend` | Trend | *lasciare* — o "Andamento" |
| `piggyBank.page.title` | Piggy Bank | *lasciare* |

**Sezione Impostazioni / API**

| Chiave | EN=IT | Traduzione IT suggerita |
| ------ | ----- | ----------------------- |
| `settings.language.en` | 🇬🇧 English | *lasciare* |
| `settings.language.it` | 🇮🇹 Italiano | *lasciare* |
| `settings.api.workbook` | Workbook: | "Workbook:" (invariato) |
| `settings.api.orchestrator` | Orchestrator: | "Orchestrator:" (invariato) |
| `settings.api.tokenTest` | Test token | "Testa token" o "Verifica token" |
| `refreshView.workbook.label` | Workbook: | invariato |
| `refreshView.staged` | Staged | "In coda" |
| `refreshView.logTitle` | Log | invariato |
| `refreshView.daily.eta` / `.full.eta` | ETA ~15–25 min | "Circa 15–25 min" |

**Decision Lab — tab e SDS panel** (grafici e legende)

Molte etichette in `decisionLab.sds.legend.*`, `decisionLab.sds.history.*` sono nomi di studi / farmaci / concetti clinici che devono restare in inglese. Tuttavia alcuni titoli sezione beneficerebbero di traduzione:

| Chiave | EN=IT | IT suggerito |
| ------ | ----- | ------------ |
| `decisionLab.tab.slopeErrors` | Slope | "Pendenza" |
| `decisionLab.tab.signals` | ⚡ Top opportunities | "⚡ Migliori opportunità" |
| `decisionLab.tab.sds` | SuperNova | *lasciare* |
| `decisionLab.pattern.colMatch` | Match | "Match" (invariato) |
| `decisionLab.pattern.filterPortfolio` | Portfolio ({n}) | "Portafoglio ({n})" |
| `decisionLab.pattern.verdict.watch` | Watch | "Osserva" |
| `decisionLab.sds.filterPortfolio` | Portfolio | "Portafoglio" |
| `decisionLab.sds.sortDefault` | Default | "Predefinito" |
| `decisionLab.sds.colSimulation` | Simulation | "Simulation" (brand) |
| `decisionLab.sds.size` | Size | "Dimensione" |
| `decisionLab.sds.shortFloat` | Short float | "Short float" (finanziario invariato) |
| `decisionLab.sds.tab.history` | History | "Storico" |
| `decisionLab.sds.clusterA/B/C/D/E.title` | Cluster A/B/C/D/E — … | traducibili (catalyst quality → qualità catalyst; institutional signal → segnale istituzionale; ecc.) |
| `signals.action.watch` / `.short` | ▲ Watch Long / ▼ Watch Short | "▲ Osserva Long" / "▼ Osserva Short" (o lasciare) |
| `signals.top.title` | Top & Worst Opportunities | "Migliori & peggiori opportunità" |
| `signals.sort.upside` | ⚡ Upside score | "⚡ Score al rialzo" |

**Refresh view — pipeline sorgenti dati**

Sono nomi propri (Yahoo Finance, SEC EDGAR, ClinicalTrials.gov, FDA Drugs, openFDA) — vanno lasciati invariati.

**Segnali / colonne tabella Simulation** (top-of-tab)

| Chiave | EN=IT | IT suggerito |
| ------ | ----- | ------------ |
| `signals.slope.tab` | Slope | "Pendenza" |
| `signals.mig.col.miiAngle` | MII ° | invariato |
| `signals.mig.col.gate` | Gate | "Filtro" o invariato |
| `signals.mig.col.vol` | Vol× | invariato |
| `signals.mig.calibTier.drift/diverge/contrarian` | Drift / Diverge / Contrarian | "Deriva" / "Divergente" / "Contrarian" |
| `sim.pnl.field.pnlPct` | P&L % | invariato |
| `sim.pnl.field.pnlEur` | P&L € | invariato |
| `sim.workspace.filter.hotZone` | Hot Zone | "Zona calda" |
| `sim.workspace.sort.roiDesc/.roiAsc` | ROI ↓ / ↑ | invariati |

**Dashboard row & Model Lab**

| Chiave | EN=IT | IT suggerito |
| ------ | ----- | ------------ |
| `dashboard.pulse.simLoop.switchPortfolio` | Portfolio | "Portafoglio" |
| `dashboard.company.focus` | focus {ticker} | invariato |
| `dashboard.col.price` | Price $ | "Prezzo $" |
| `dashboard.focus.pred7` | Pred +7 | invariato (jargon) |
| `modelLab.tab.qc` | Q&C | invariato |
| `modelLab.subtitle.learningLab` | Learning Lab — cluster CF, regime ×, effectiveness | "Learning Lab — CF cluster, regime ×, efficacia" |
| `modelLab.missedOpp.kpiRecall` | Recall Enter | invariato |
| `modelLab.missedOpp.chartTrendTitle` | 24h opportunity trend | "Trend opportunità 24h" |
| `modelLab.missedOpp.chartTrendSub` | Daily snapshots stored locally when you open Performance — one point per calendar day. | (**da tradurre**, questo è già stato scritto in EN come frase completa) |
| `modelLab.missedOpp.lineRising24h` | Rising opportunities in the last 24h | "Opportunità in salita nelle ultime 24h" |
| `modelLab.missedOpp.lineRecommendedInvested24h` | Recommended and invested opportunities in the last 24h | "Opportunità raccomandate e investite nelle ultime 24h" |
| `modelLab.missedOpp.targetCol` | Target | "Obiettivo" (o lasciare) |
| `modelLab.missedOpp.gapCol` | Gap | invariato |

---

## Raccomandazioni operative

Priorità decrescente:

1. **Massima priorità — file 100% italiani non ancora migrati (Sezione A).**
   L'utente inglese vede pannelli interi in italiano. Da migrare a `useT()` (o al pattern locale `const it = lang === "it"`) i primi 10 file, che coprono ~70% del debito:
   - `RegulatoryRiskPanel.tsx`, `PipelineStaleWarningModal.tsx`, `financialIndicatorGuide.ts`, `decisionChartLogic.ts`, `precatCurve.ts`, `catalystCopilotFocus.ts`, `SimulationAnalysisView.tsx`, `WeightSimExpPanel.tsx`, `recommendationCompositionGuide.ts`, `simulationStyles.ts`.

2. **Alta priorità — file 100% inglesi non tradotti (Sezione C).**
   L'utente italiano vede pannelli interi in inglese. Sono più pochi e concentrati (10 file):
   - `NewBioIpoModal.tsx`, `ConditionalFormatSettings.tsx`, `PredictionGuidePanel.tsx`, `ClinicalSimulationView.tsx`, `StudySummaryModal.tsx`, `SimulationCurveChart.tsx` (solo il fallback), `SimulationPortfolioSheetView.tsx` (header), `CatalystCopilotChat.tsx` (hint), `simulationSparkline.tsx` (tooltip).

3. **Media priorità — label sfuggite in file con branching parziale (Sezione B).**
   I 32 file usano già `useLang()`/branching, quindi basta convertire le stringhe segnalate al pattern esistente (nessuna riorganizzazione).

4. **Bassa priorità — chiavi dizionario con `en===it` (Sezione D).**
   Le più visibili sono nella sidebar/topbar/settings (già bilanciate: sono brand o parole universali). Le ~40 chiavi in `decisionLab.*` e `modelLab.*` sarebbero migliorabili ma non sono bloccanti — molte parole (SDS, MAE, Pred +5) devono restare tecniche.

## File di appoggio prodotti (nella root)

- `I18N_AUDIT_REPORT.md` — questo report.
- `_i18n_audit.mjs` — script Node che ha estratto le 3.786 chiavi e trovato le 398 dove `en===it`.
- `_i18n_hardcoded_scan.mjs` — script Node che ha classificato i 189 hardcoded italiano in Sezione A/B.
- `_i18n_english_scan.mjs` — script Node che ha trovato i 16 file interamente inglese senza i18n (Sezione C).
- `_i18n_hardcoded_scan_out.txt` — dump completo delle 189 righe italiane (con file:linea).
- `_i18n_english_scan_out.txt` — dump completo delle 51 righe inglesi (con file:linea).

Nota: gli output `.txt` mostrano caratteri mojibake solo per limiti dell'encoding console PowerShell. I file sorgente TSX sono correttamente in UTF-8: quando li si legge direttamente le lettere accentate si vedono giuste.
