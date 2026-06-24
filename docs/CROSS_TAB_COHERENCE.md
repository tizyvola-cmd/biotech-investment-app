# Coerenza cross-tab (SuperNova desktop)

Questo documento descrive **una sola fonte di verità per concetto**, quali tab la consumano e come verificare che i messaggi «si parlino».

## Mappa concetti → moduli

| Concetto | Fonte dati | Logica principale | Tab che la mostrano |
|----------|------------|-------------------|---------------------|
| **Posizione aperta** | `InvestSimInputs` + foglio Simulation | `rowHasActivePortfolio`, `computeSimulationPosition` | Simulation, P&L, Dashboard portafoglio, Segnali, Slope |
| **P&L totale vs giornata** | Prezzi foglio + buy/capital locali | `portfolioPnlTone`, `portfolioTotalDisplayValues`, `portfolioDailyPnlValues` | Tab P&L, chip portafoglio, Worst |
| **ROI target / Plan** | Curve + `resolveExpectedGainPlan` | `planRoiBundleFromGainPlan`, `buildPrecatEntry` | P&L «Plan at entry», card Segnali, Top 2 |
| **Precat label (ingresso/uscita)** | `buildPrecatEntry(..., { hasPosition })` | Non aggiungere vs Valuta uscita | Card Segnali, Top/Worst |
| **Top hot / watch** | `topOppsStore` (pubblicato) | Decision Lab **strict** vs Dashboard **relaxed** (vedi sotto) | Dashboard lista Top, Simulation badge |
| **Top 2 BUY/SELL** | `top2BuySellStore` | `pickTop2BuyCandidates` / `pickTop2SellCandidates` | Dashboard, Decision Lab |
| **Slope banner** | Live sheet + log JSON | `buildSlopeAlertsFromSignalRows` | Decision Lab header + Segnali inline |
| **Slope errors tab** | Log + live portafoglio | `buildSlopeFeedForPanel` | Catalyst Hub → Slope errors |
| **Action badge** | Score + pred5 + slope | `actionKind` | Tabella Segnali, card |

## Regole colore (allineate)

### Tab P&L Simulation
- **TOTAL FROM ENTRY**: solo `portfolioPnlTone(pnlEur, pnlPct)` — rosso se perdita, verde se gain.
- **TODAY / 24h**: solo `portfolioPnlTone(pnlEurToday, pnlPctToday)` — indipendente dal totale.
- Bordo card: `resolvePnlTabCardTone` (stesso criterio del totale, **non** la pendenza 5d).

### Card Segnali / Worst
- Pendenza mercato può colorare **metriche modello** (`resolveModelMetricTone`).
- **Action** e **precat** con posizione: `doNotAdd` vs `Valuta uscita` se `hasPosition`.

### Slope
- **Banner**: errori (reversal, decel, contrarian) vs accelerazioni (sezione verde separata).
- **Tab Slope errors**: stesso feed (`buildSlopeFeedForPanel`) per tabella società, dettaglio ticker e contatore tab.
- Soglia surfacing: `|modello T+5 − spot| ≥ $0.50` (`SLOPE_MIN_PRICE_GAP_USD`); gap sconosciuto → evento **mantenuto** (non escluso).

## Punto critico: due pubblicatori Top Opps

| Pubblicatore | Quando | Soglie tipiche |
|--------------|--------|----------------|
| **Decision Lab** (`InvestmentSignalsPanel`) | Tab Segnali attivi montata | pred ≥ slider (default **1.5%**), `qualityStrict`, hit%, verdict, precat avoid… |
| **Dashboard** (`publishDashboardRecommendationsFromSimulation`) | Caricamento Simulation su Dashboard | **strict pick** (precat enter/accumulate, slider upside + aff) — legacy relaxed solo in audit |
| **Debug** | Sistema → **Coerenza tab** | `buildCrossTabCoherenceReport` live |

**Effetto (mitigato):** dopo **Decision Lab → Segnali**, il Dashboard **non sovrascrive** hot/watch per **6 ore** se `publishedBy === decision-lab`. Il Lab applica ancora filtri extra (Hit% cohort, action badge) non replicabili sui pick.

**Cosa è coerente comunque:** Top 2 BUY/SELL usa la stessa pipeline `buildPickSignalsFromSimTable` + `pickTop2*` su entrambe le tab.

**Raccomandazione operativa:** per confronti tra tab, apri **Decision Lab → Segnali** dopo il refresh, poi Dashboard (o allinea le soglie — vedi `topOppsThreshold.ts`).

## Fili logici per il trader

1. **Vuoi comprare?** → Decision Lab Top (strict) + Top 2 BUY + precat «Enter/Accumulate» + pred5 positiva.
2. **Hai già posizione?** → Tab P&L (totale reale) + Worst/SELL + precat «Valuta uscita» se pendenza ↓ + banner slope se contrarian/decel.
3. **Solo movimento oggi?** → Blocco TODAY in P&L (Var. giorn. % foglio), non confondere con ROI target.
4. **Diagnostica pendenza?** → Banner → Slope errors (stesso ticker deve comparire in tabella dopo fix feed).

## Verifiche automatiche

Dalla cartella `desktop-ui`:

```bash
npm run test:coherence
```

Copre invarianti su filtro slope, toni P&L, precat con posizione e allineamento builder slope.

## Checklist manuale (5 min dopo refresh)

1. Scegli un ticker **in portafoglio** con Var. giorn. % nota (es. +2%).
2. **P&L tab**: TODAY verde/rosso secondo var.; TOTAL secondo P&L dall’ingresso (non verde se −80%).
3. **Decision Lab**: stesso ticker in banner slope ↔ presente in **Catalyst Hub → Slope errors (N)** con N coerente.
4. Clic sul ticker nel banner → dettaglio con **≥1 evento** e grafico se curve caricate.
5. **Simulation → All**: badge Hot/Top2 solo se ticker in `topOppsStore` (apri Segnali prima per criteri strict).
6. **ROI target** positivo ma precat «Valuta uscita» → leggi riga `roiVsSlopeHint` (tensione piano storico vs pendenza oggi).

## Estensioni future

- Unificare pubblicazione `topOppsStore` in un solo modulo con `mode: 'strict' | 'preview'`.
- Test E2E con snapshot Simulation JSON reale in `data/simulation_sheet_snapshot.json`.
- Campo `publishedBy` nello store per mostrare in UI «ultimo aggiornamento: Decision Lab».
