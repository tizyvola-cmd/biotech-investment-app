# Nota Cursor — Logica P&L e perché può sovrastimare i guadagni

> **Repo:** `C:\coding\Biotech_Investment app 6` · **Scope:** `desktop-ui/` (mobile mirror in `mobile-ui/src/simLogic.ts`)  
> **Data:** 2026-08-13 · **Segnalazione utente:** il P&L “mostra guadagni che non corrispondono al denaro realmente guadagnato”.

---

## 1. Cosa significa “guadagnato” nell’app

| Metrica | Significato | È denaro incassato? |
|---------|-------------|---------------------|
| **P&L totale aperto (MTM)** | `(capitale/buy × prezzo_ora) − capitale` | **No** — mark-to-market, non realizzato |
| **P&L 24h** | Movimento **di sessione** su valore aperto | **No** — solo oggi |
| **Δ visit** | Variazione MTM dall’ultima visita (o ≈ 24h se baseline sintetica) | **No** |
| **Closed P&L / Piggy chiuso** | `closedPnlEur` al momento della vendita | **Sì** — unico guadagno/perdita **realizzato** |

L’UI spesso mostra **MTM aperto** come “guadagno”. Non è cash finché non vendi.

---

## 2. Formula corretta (percorso audit — reference)

**File:** `desktop-ui/src/sheet/simulationPosition.ts` → `computeSimulationPosition()` (L2070–2158)

```
shares    = capital / buy_price_usd
valueNow  = shares × current_price_usd   // da sheet "Prezzo Corrente ($)"
pnlEur    = valueNow − capital
pnlPct    = (curr − buy) / buy × 100
```

**Buy price** (priorità): `resolvePortfolioEntryBuyUsd()` (L271–318)
1. Sheet `Prezzo Acquisto ($)`
2. `invest_sim_inputs[key].buyPrice` (libro locale)
3. **Mai** inferire da Excel `P&L (%)` se c’è buy trusted (`entryBuy > 0` → skip reconcile L2115)

**Export audit (ground truth):** `desktop-ui/src/sheet/portfolioGainAuditExport.ts` — usa solo `computeSimulationPosition`.

---

## 3. Formula dashboard / Pulse / Piggy (Engine B)

**File:** `simulationPosition.ts`

| Step | Funzione | Linee |
|------|----------|-------|
| Breakdown giornaliero | `resolvePositionPnlBreakdown()` | L1418–1610 |
| Totale riga | `resolveAggregatePositionPnl()` | L1618–1646 |
| Σ portafoglio | `aggregateOpenPortfolioPnl()` | L2457–2538 |
| Chip Pulse | `buildDashboardPortfolioChips()` | L2400–2430 |
| KPI Home | `buildDashboardPulseData()` | `dashboardPulseView.ts` L253+ |

**Identità desiderata:**
```
totalEur = MTM (valueNow − entryValue)   quando forceMtmTotal
priorLeg = totalEur − pnlEurToday        (stima implicita, non chiusure verificate)
pnlEurToday = Var. Giorn. % × valueNow
```

**Guard P0 (fix storico contaminato):** L1547–1578
```typescript
forceMtmTotal =
  assessment.contaminated ||
  assessment.uncertainContamination ||
  trustedEntryBuy ||
  (summed.priorCloseCount === 0 && !isInvestedToday(investedAtIso));
if (forceMtmTotal) {
  totalEur = roundEur(mtmValue - entryValue);  // NON somma gambe history
}
```

**Verifica locale (2026-08-13):** `npx tsx scripts/diag-pnl-audit.ts` → tutti gli scenari RYTM ≈ **€625 (+5%)**, non €21k.

---

## 4. Percorsi che ANCORA possono sovrastimare

### 4.1 Buy mancante → inferenza da sheet/history

**File:** `reconcileAnchoredBuyMarkToMarket()` L810–1079

Se `entryBuy <= 0` e buy locale ≈ spot, il motore può **abbassare il buy** usando:
- Excel `P&L (%)` → `inferredBuy = curr / (1 + pct/100)` (L912–941)
- Excel `Valore Attuale ($)` (L944–971)
- Snapshot `invest_sim_history.byTicker` contaminati (L1016–1034)

**Effetto:** buy troppo basso → P&L % gonfiato (es. sheet dice +178% → MTM mostra +178% anche se il vero buy era diverso).

### 4.2 Fallback sheet senza prezzo corrente

**File:** `computeSimulationPosition()` L2137–2142

Se manca spot:
```typescript
pnlPct = sheetPnlPct(row);   // colonna Excel P&L (%)
pnlEur = parseNum(row["P&L ($)"]);
```
Valori Excel possono essere **obsoleti** rispetto al libro reale.

### 4.3 Storico `invest_sim_history` contaminato (bundle vecchio)

**Causa storica P0:** snapshot history salvavano `value`/`pnlPct` gonfiati da Excel; Engine B sommava gambe giornaliere → +€48k portfolio.

**Fix in source:** `forceMtmTotal` (§3). **Se l’utente vede ancora numeri alti:**
- Bundle desktop non ricostruito (`npm run build`)
- `localStorage` con history pre-fix
- VPS non aggiornato

**Pulizia dati (solo dopo deploy fix):**
```js
localStorage.removeItem('supernova_invest_sim_history');
```

### 4.4 Mobile companion — engine semplificato

**File:** `mobile-ui/src/simLogic.ts` L131–179

- Nessun `reconcileAnchoredBuyMarkToMarket`
- Nessun guard `forceMtmTotal` / contamination
- Fallback sheet per buy/capital

Desktop pubblica snapshot via `mobileDashboardSnapshot.ts` (usa `aggregateOpenPortfolioPnl`) — **online dovrebbe allinearsi**; offline/local può divergere.

### 4.5 Confusione metriche in UI

- **Verde Pulse** può venire da 24h positivo mentre MTM totale è piatto (`portfolioGainLossStyle.ts` `resolvePortfolioDisplayTone`)
- **Open MTM + Closed P&L** mostrati come KPI separati — sommarli mentalmente ≠ cash in tasca
- **Δ visit** (fix recente `buildSyntheticDayVisitBaseline`) ≈ movimento sessione, non guadagno totale da ingresso

### 4.6 Warrant vs common (JSPRW/JSPR)

History su simbolo warrant, prezzo da common → MTM warrant può essere fuorviante.

---

## 5. Persistenza e vendita

| Evento | File | Campo |
|--------|------|-------|
| Sell | `portfolioSell.ts` L271–276 | `closedPnlEur = pos.pnlEur` (MTM a vendita) |
| Storage | `investSimStorage.ts` L28 | `InvestSimInputEntry.closedPnlEur` |
| History append | `investSimStorage.ts` L1366+ | `byTicker[key].value`, `.pnl` |
| Closed piggy | `closedPiggyBank.ts` | Ledger deal chiusi |

---

## 6. Test e script

```powershell
cd "C:\coding\Biotech_Investment app 6\desktop-ui"
npx tsx scripts/diag-pnl-audit.ts
npx vitest run src/sheet/simulationPnlReconcile.test.ts
```

**Test chiave:** `simulationPnlReconcile.test.ts`
- History contaminata multi-snapshot → totale < €800 (non €21k)
- buy≈spot → no guadagno fantasma da history

**Doc precedenti:** `CURSOR_PNL_BUG_HANDOFF.md`, `PNL_BUG_AUDIT_REPORT.md` (status P0 fix in source; verificare deploy + dati).

---

## 7. TASK per Cursor (fix residui / UX)

```
1. Verificare che l'istanza in esecuzione usi il bundle con forceMtmTotal (L1547).
2. Se P&L utente ≠ audit Excel: confrontare per ticker buyPrice in invest_sim_inputs vs sheet.
3. Bloccare reconcileAnchoredBuyMarkToMarket quando sheet P&L % >> MTM plausibile (es. >50pp drift).
4. Etichettare UI: "Guadagno aperto (MTM)" vs "Guadagno realizzato (chiuso)".
5. Allineare mobile-ui/simLogic.ts ai guard desktop O forzare sempre snapshot desktop per P&L.
6. Mostrare flag historyContaminated / priorLegIsImplicitEstimate in P&L tab quando prior non verificato.
```

---

## 8. Esempio numerico (RYTM)

| | Valore |
|---|--------|
| Capitale | €12.500 |
| Buy | $90 |
| Current | $94.50 |
| **MTM corretto** | **+€625 (+5%)** |
| History contaminato (bug pre-fix) | +€21.636 (+173%) |
| **Post-fix Engine B** | **+€625** (forceMtmTotal) |

---

## 9. Source map rapida

```
desktop-ui/src/sheet/simulationPosition.ts     ← motore P&L (A + B)
desktop-ui/src/sheet/dashboardPulseView.ts     ← Pulse KPI, Δ visit
desktop-ui/src/sheet/portfolioGainAuditExport.ts ← audit Excel (reference)
desktop-ui/src/sheet/portfolioSell.ts          ← realizzato a vendita
desktop-ui/src/sheet/investSimStorage.ts       ← inputs + history
desktop-ui/src/sheet/portfolioGainLossStyle.ts ← colori/display (non calcolo)
mobile-ui/src/simLogic.ts                      ← MTM mobile semplificato
desktop-ui/scripts/diag-pnl-audit.ts           ← repro script
```
