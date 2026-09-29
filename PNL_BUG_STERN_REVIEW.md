# Review severa — Bug P0 P&L Portfolio / Sim loop / Synth

> **Scopo:** documento autocontenuto per una valutazione critica (peer review / second opinion) della logica P&L, dei dati utente, della causa radice e dell’implementazione del fix del 2026-06-23.  
> **Repo:** `C:\coding\Biotech_Investment app 6` · **Scope:** `desktop-ui/` only.  
> **Come usarlo:** apri una nuova chat, `@`-menziona questo file e chiedi una review severa rispondendo alle domande in §12.

---

## §1 — Sintesi esecutiva

| Superficie | Prima del fix | Dopo il fix | Percorso “verità” (audit) |
|------------|---------------|-------------|---------------------------|
| RYTM P&L dashboard | ~€21.900 (+178%) | ~€625 (+5%) | ~€450–650 (+5%) |
| NRIX P&L dashboard | ~€8.164 (+65%) | ~€450 (+3.6%) | ~€450 (+3.6%) |
| Totale 6 ticker (Piggy Bank) | ~€48k | ~€2–3k | ~€2–3k |
| Export audit Excel | corretto | invariato | **Engine A** |

**Formula corretta (Engine A — audit, `computeSimulationPosition`):**

```
shares     = capital_eur / buy_price_usd
value_eur  = shares × current_price_usd
pnl_eur    = value_eur − capital_eur
```

**Formula buggy pre-fix (Engine B — dashboard):**

```
priorLeg   = Σ (snap[i].value − snap[i−1].value)   ← da HIST.byTicker contaminati
todayLeg   = Var. Giorn. % su MTM
total      = priorLeg + todayLeg                   ← esplode con ≥2 snapshot gonfiati
```

**Fix applicato:** quando lo storico risulta **contaminato** (`historyCloseSeriesLooksContaminated`), Engine B usa **MTM da prezzo** per il totale (`mtmValue − entryValue`), non la somma delle gambe storiche. La gamba “oggi” resta da Var. Giorn. %.

---

## §2 — Dati utente di riferimento

### 2.1 Posizioni (`data/invest_sim_inputs.json` / localStorage `supernova_invest_sim_inputs`)

| Key | buyPrice USD | capital EUR |
|-----|--------------|-------------|
| `RYTM\|2026-09-15` | 90.00 | 12,500 |
| `NRIX\|2026-08-31` | 17.73 | 12,500 |
| `KURA\|2026-09-30` | 9.80 | 10,606 |
| `PTCT\|2026-09-30` | 78.42 | 7,697 |
| `GPCR\|2026-08-26` | 45.73 | 3,499 |
| `MLTX\|2026-09-28` | 18.51 | 5 |

### 2.2 Storico (`data/invest_sim_history.json` / `supernova_invest_sim_history`)

Snapshot orari con `byTicker[key].value`, `.pnl`, `.pnlPct` scritti da un motore pre-fix che persisteva valori da colonne Excel obsolete (`Valore Attuale ($)`, `P&L (%)`) invece del MTM da buy/capital/prezzo corrente.

**Esempio numerico RYTM (repro):**

- Buy: $90, Capital: €12,500, Current: $94.5  
- MTM corretto: `(12500/90)×94.5 = €13,125` → P&L **+€625 (+5%)**  
- Snapshot contaminato 2026-06-17: `value: 34_750`, `pnlPct: 178` (da Excel stale)

### 2.3 Colonne foglio Simulation — NON fidarsi per MTM live

| Colonna | Problema |
|---------|----------|
| `P&L (%)` | Stale rispetto a buy utente + prezzo live |
| `Valore Attuale ($)` | Può riflettere modello/scenario, non MTM portafoglio |
| `Prezzo Corrente ($)` | OK (Yahoo refresh) |
| `Var. Giorn. %` | OK per gamba 24h |

---

## §3 — Architettura: tre motori P&L

```
┌─────────────────────────────────────────────────────────────────┐
│ Engine A — CORRETTO (audit, computeSimulationPosition)          │
│   shares = capital / buy                                        │
│   pnl = shares×curr − capital                                   │
│   Usato da: portfolioGainAuditExport, computeSimulationPosition │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Engine B — ERA BUGGY, FIX QUI (resolvePositionPnlBreakdown)     │
│   positionPnlForOpenRow → resolvePositionPnlBreakdown           │
│   → tickerDailyCloseSeries(hist) → sumPnlFromDailyCloseSeries   │
│   Usato da: Piggy Bank, Pulse, Sim P&L tab, Sim loop OPEN POS   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Engine C — Sim loop chart history (buildSimLoopHistoryFromTicks)│
│   Paper marks da tick — NON fixato in P0                        │
│   KPI live eredita Engine B → si sistema col fix B              │
└─────────────────────────────────────────────────────────────────┘
```

### 3.1 Catena di chiamate UI (Engine B)

| UI | File | Entry point |
|----|------|-------------|
| Piggy Bank | `MainDashboardView.tsx` | `aggregateOpenPortfolioPnl` |
| Pulse KPI / tabella | `dashboardPulseView.ts` | `aggregateOpenPortfolioPnl`, chips |
| Simulation → P&L tab | `InvestmentSimulationView.tsx` | `positionPnlForOpenRow` |
| Sim loop / Synth OPEN | `simLoopPulseView.ts` | `resolveSimLoopAlignedOpenPnl` → `positionPnlForOpenRow` |
| Gain vs plan chart (parziale) | `dashboardPulseAggregate.ts` | `actualFromHistoryPoint` → somma `byTicker.pnl` storico |

### 3.2 Writer storico (fixato — stop nuova contaminazione)

`InvestmentSimulationView.tsx` → `portfolioSnapshot()` (~L713):

```ts
// ORA (corretto per snapshot futuri):
const m = row ? positionPnlForOpenRow(row, inputs, history) : null;
byTicker[p.key] = { value, pnl: m?.pnlEur ?? p.pnlEur, pnlPct: m?.pnlPct ?? p.pnlPct };

// PRIMA (contaminava ogni save orario):
byTicker[p.key] = { value: pos.valueNow, pnl: pos.pnlEur, pnlPct: pos.pnlPct };
```

**Conseguenza:** snapshot passati restano contaminati in localStorage/disk finché Engine B non li ignora o finché non si fa migration/sanitize on hydrate.

---

## §4 — Causa radice (analisi dettagliata)

### 4.1 Sequenza del bug

1. Utente imposta buy/capital trusted in `invest_sim_inputs`.
2. `computeSimulationPosition` calcola MTM corretto (Engine A).
3. Dashboard usa Engine B: somma **delta giornalieri** da `invest_sim_history.byTicker`.
4. Snapshot orari salvavano `value`/`pnl`/`pnlPct` da Engine B **prima** del fix writer → valori gonfiati persistiti.
5. `historyCloseSeriesLooksContaminated()` (pre-fix P0) correggeva solo `mtmValue` **oggi** in `resolveMtmValueForPositionLegs`, **non** le gambe `priorLeg` in `sumPnlFromDailyCloseSeries`.

### 4.2 Perché 1 snapshot vs 2+ snapshot si comportano diversamente

`buildPositionDailyPnlLegs` (~L997–L1001):

```ts
if (!seededFromFirstSnap && investDayKey && pt.dayKey > investDayKey) {
  prev = pt.value;  // baseline = valore gonfiato, ZERO leg aggiunto
  continue;
}
```

| Scenario | priorCloseCount | priorLeg | total (pre-fix) |
|----------|-----------------|----------|-----------------|
| 1 snapshot contaminato post-ingresso | 1 | 0 (seed skip) | ~solo today → **sottostima** (~€55) |
| 2 snapshot (clean + contaminated) | 2 | +€669 + €21.581 | **+€21.636 (+173%)** |
| 0 snapshot | 0 | fallback MTM | **€625 OK** |

→ I test con **un solo** snapshot contaminato **non** riproducevano il bug prod; serviva il test multi-snapshot (§8).

### 4.3 Fix tentati in precedenza (insufficienti da soli)

| Area | Cosa fa | Perché UI ancora sbagliata |
|------|---------|----------------------------|
| `resolvePortfolioEntryBuyUsd` | Buy corretto per MTM | Dashboard usava leg sum, non MTM raw |
| Skip `reconcileAnchoredBuyMarkToMarket` se entryBuy | `computeSimulationPosition` OK | Stesso |
| `historyCloseSeriesLooksContaminated` in `resolveMtmValueForPositionLegs` | Fix mtmValue oggi | Prior legs ancora sommate |
| `portfolioSnapshot` → `positionPnlForOpenRow` | Stop nuova contaminazione | Storico passato resta bad |
| `resolveSimLoopAlignedOpenPnl` | Sim loop → Engine B | Engine B ancora broken |

---

## §5 — Implementazione del fix (2026-06-23)

### 5.1 File modificati

| File | Modifica |
|------|----------|
| `desktop-ui/src/sheet/simulationPosition.ts` | Fix principale in `resolvePositionPnlBreakdown` + allineamento `buildPortfolioDailyPnlLedger` |
| `desktop-ui/src/sheet/simulationPnlReconcile.test.ts` | Test multi-snapshot §8 |

### 5.2 `resolvePositionPnlBreakdown` (~L1215–L1244)

**Logica post-fix:**

```ts
const entryBuy = resolvePortfolioEntryBuyUsd(simRow ?? {}, rawInp, curr, investedAtIso);
const contaminated = historyCloseSeriesLooksContaminated(
  entryValue, closeSeries, entryBuy > 0 ? entryBuy : null, curr,
);

let totalEur = summed.totalEur;
let totalSource = "daily_close_sum";

if (contaminated || (summed.priorCloseCount === 0 && !isInvestedToday(investedAtIso))) {
  totalEur = roundEur(mtmValue - entryValue);
  totalPct = entryValue > 0 ? round((totalEur / entryValue) * 10000) / 100 : 0;
  if (summed.hasToday && summed.pnlEurToday != null) {
    priorLegEur = roundEur(totalEur - summed.pnlEurToday);  // identità total = prior + today
  }
  if (contaminated) totalSource = "price_mtm_contaminated_history";
}
```

**Cosa NON cambia:**

- `pnlEurToday` / `pnlPctToday` → ancora da `sumPnlFromDailyCloseSeries` / Var. Giorn. %
- `mtmValue` → già corretto da `resolveMtmValueForPositionLegs` quando contaminated
- Percorso leg-sum → invariato quando storico **non** contaminato e `priorCloseCount > 0`

### 5.3 Decisione: `contaminated` only vs `entryBuy > 0`

Il handoff originale (`CURSOR_PNL_BUG_HANDOFF.md` §7) suggeriva:

```
if (contaminated || trustedEntryBuy) → MTM
```

**Scelta implementata:** solo `contaminated` (più `priorCloseCount === 0` pre-esistente).

**Motivo:** `entryBuy > 0` da solo disabilita leg-sum anche con storico **pulito**, rompendo test espliciti:

- `"prefers history + Var% over stale Valore Attuale when prior closes exist"`
- `"aggregate uses leg total when prior closes exist"`
- `"rescales history closes when Capital € was raised (synth sync)"`

**Rischio accettato:** se contamination heuristic fallisce (false negative), leg-sum gonfiato potrebbe persistere nonostante buy trusted.

### 5.4 `buildPortfolioDailyPnlLedger` (~L1475–L1494)

Allineamento parziale: `totalEur` riga usa MTM quando `contaminated || priorCloseCount === 0`.

**Attenzione reviewer:** le **colonne giornaliere** (`legs`, `pnlByDay`) restano calcolate da `buildPositionDailyPnlLegs` sulla serie storica — possono **non** sommare al `totalEur` quando contaminated. Flag `legTotalDiffersFromMtm` dovrebbe essere true.

### 5.5 Nuovo tipo `PositionPnlTotalSource`

Aggiunto `"price_mtm_contaminated_history"` oltre a `"daily_close_sum"` | `"entry_today"`.

---

## §6 — Euristiche contamination (`historyCloseSeriesLooksContaminated`)

```ts
// simulationPosition.ts ~L253–L271
function historyCloseSeriesLooksContaminated(capital, closeSeries, entryBuy, curr): boolean {
  if (capital <= 0) return false;
  const prior = closeSeries.filter(pt => pt.dayKey < todayKey);
  if (!prior.length) return false;
  const lastClose = prior[prior.length - 1].value;
  const histPct = ((lastClose - capital) / capital) * 100;
  const priceMtm = priceMarkValueFromEntryBuy(capital, entryBuy, curr);
  if (priceMtm == null) return Math.abs(histPct) > 35;      // no buy/price → soglia alta
  const pricePct = ((priceMtm - capital) / capital) * 100;
  if (Math.abs(histPct) <= 20) return false;                  // storico “piccolo” → trusted
  return Math.abs(histPct - pricePct) > 12;                   // drift > 12pp
}
```

### 6.1 Casi limite da scrutinare

| Caso | Comportamento atteso | Rischio |
|------|---------------------|---------|
| Gain reale >20% e storico coerente | `histPct ≤ 20` o drift ≤12pp → leg-sum | OK se gain reale <20% o drift piccolo |
| Gain reale >35% senza buy/price | `histPct > 35` → contaminated → MTM | OK se MTM fallback corretto |
| Storico clean +1 snap a +3.6% (NRIX) | `histPct ≤ 20` → **non** contaminated | Leg-sum OK |
| Storico clean poi 1 snap bad (+178%) | drift 173pp → contaminated | **Fix target** |
| Solo 1 snap contaminato | contaminated=true → MTM | Fix sottostima pre-fix (~€55→€625) |
| Capital rescaling synth (5000→12500) | Storico rescalato; se % coerente → leg-sum | Non forzato MTM se non contaminated |

### 6.2 Soglie magiche (12pp, 20%, 35%)

Non derivate da dati statistici — scelte euristiche. Un reviewer severo dovrebbe valutare se servono test parametrizzati o configurazione.

---

## §7 — Output verifica post-fix

### 7.1 Script repro (`npx tsx scripts/diag-pnl-audit.ts`)

```
=== single contaminated snapshot ===
computeSimulationPosition pnlEur: 625
breakdown totalEur: 625  priorLeg: 570.11  today: 54.89  priorCloseCount: 1

=== clean then contaminated (typical prod) ===
computeSimulationPosition pnlEur: 625
breakdown totalEur: 625  priorLeg: 570.11  today: 54.89  priorCloseCount: 2

=== no history (MTM only) ===
computeSimulationPosition pnlEur: 625
breakdown totalEur: 625  priorLeg: 570.11  today: 54.89  priorCloseCount: 0
```

**Prima del fix (scenario prod):** `aggregate totals pnlEur: 21635.89`

### 7.2 Test suite

```powershell
cd desktop-ui
npx vitest run src/sheet/simulationPnlReconcile.test.ts src/sheet/simLoopPulseView.test.ts
# 35/35 passed (12 + 23)

npx vitest run src/sheet/simulationPnlBreakdown.test.ts src/sheet/ledgerReconciliation.test.ts src/sheet/portfolioGainAuditExport.test.ts
# 13/13 passed

npm run build
# OK
```

---

## §8 — Test aggiunto (multi-snapshot)

File: `simulationPnlReconcile.test.ts` — `"ignores contaminated leg chain when clean snapshot preceded bad save"`

- Snapshot 1 (2026-06-15): value 13_169, pnlPct 5.35 — **clean**
- Snapshot 2 (2026-06-17): value 34_750, pnlPct 178 — **contaminated**
- Assert: `totals.pnlEur < 800`, `pnlPct < 8`, identità `priorLeg + today = total`

**Gap test noti:**

- Nessun test end-to-end su 6 ticker reali da `data/*.json`
- Nessun test su `dashboardPulseAggregate` chart con storico contaminato
- Nessun test su ledger: colonne giorno vs total quando contaminated
- Nessun test false-positive contamination (gain reale >20%)

---

## §9 — Cosa NON è stato fixato (P1–P2)

| ID | Descrizione | File | Impatto residuo |
|----|-------------|------|-----------------|
| P1 | Sanitize on hydrate | `investSimStorage.ts` → `hydrateInvestSimHistory` | Storico su disk resta dirty; fix runtime only |
| P1 | Chart pulse actual | `dashboardPulseAggregate.ts` → `actualFromHistoryPoint` | Gain vs plan chart può mostrare actual storico gonfiato |
| P2 | Sim loop chart history | `simLoopPulseView.ts` → `buildSimLoopHistoryFromTicks` | Grafico storico sim loop non allineato MTM |
| P3 | Migration dati utente | DevTools `localStorage.removeItem('supernova_invest_sim_history')` | Opzionale post-deploy |

### 9.1 `dashboardPulseAggregate.actualFromHistoryPoint` (non toccato)

Somma ancora `h.byTicker[row.key].pnl` dagli snapshot storici per la serie “actual” del chart Gain vs Plan. **Solo il punto live** (ultimo) usa `row.pnlEur` da Engine B. I punti passati nel chart possono restare gonfiati.

### 9.2 Ledger colonne giornaliere vs TOTAL

Quando contaminated, `totalEur` = MTM ma `legs[]` possono contenere delta gonfiati (+€21k su un giorno). UI dovrebbe mostrare `mtmTotalEur` quando `legTotalDiffersFromMtm` — verificare che i componenti lo rispettino.

---

## §10 — Coerenza identità contabili

### 10.1 Identità mantenuta post-fix

```
totalEur ≈ priorLegEur + pnlEurToday   (quando hasToday)
```

Quando si forza MTM, `priorLegEur` è **ricalcolato** come `totalEur - pnlEurToday`, non dalla somma delle gambe storiche.

### 10.2 Possibile incoerenza semantica

- `priorLegEur` post-fix = “implicit prior” per far quadrare l’identità, **non** più la somma reale delle gambe storiche.
- `priorCloseCount` resta 2 anche se le gambe sono ignorate → può confondere debug/UI che interpretano priorCloseCount come “gambe usate nel total”.

### 10.3 `resolveAggregatePositionPnl`

Quando `hasToday`, usa `legTotal = priorFromLegs + today` dove `priorFromLegs` viene dal breakdown già ricalcolato → OK.

Quando **no** today e `priorCloseCount > 0`, usa ancora legTotal — con fix contaminated il breakdown ha già total MTM e prior ricalcolato.

---

## §11 — Confronto Engine A vs Engine B post-fix

Per RYTM repro (buy=90, cap=12500, curr=94.5, var=0.42%):

| Metrica | Engine A | Engine B post-fix |
|---------|----------|-------------------|
| totalEur | 625 | 625 |
| pnlEurToday | N/A (non distingue) | ~54.89 (Var. Giorn. %) |
| priorLegEur | N/A | ~570.11 (implicito) |
| Fonte total | price MTM | price MTM (contaminated path) |

**Domanda reviewer:** `priorLegEur = 570.11` è economicamente sensato? Deriva da `625 - 54.89` dove 54.89 è Var.% su mtmValue (~13125). Non corrisponde alla somma delle chiusure clean (+669 del 15/06).

---

## §12 — Domande per review severa

Il reviewer dovrebbe rispondere esplicitamente:

1. **Correttezza:** Il fix risolve la causa radice o maschera sintomi lasciando dati storici corrotti?
2. **minuità:** `historyCloseSeriesLooksContaminated` è sufficiente? Quali false positive/negative mancano?
3. **Scelta `entryBuy > 0`:** Era giusto **non** forzare MTM quando buy trusted + storico clean? O conviene MTM sempre quando buy trusted?
4. **Ledger:** È accettabile che colonne giornaliere mostrino gambe gonfiate mentre TOTAL è MTM? La UI gestisce `legTotalDiffersFromMtm`?
5. **Chart pulse:** `dashboardPulseAggregate` va fixato in P0 o è accettabile differire?
6. **Test:** La suite copre abbastanza? Quale test mancante è più critico?
7. **Migration:** Serve sanitize on hydrate (P1) prima del deploy o il runtime fix basta?
8. **Identità contabile:** `priorLegEur` ricalcolato post-fix è semanticamente corretto per Piggy Bank “24h vs prior”?
9. **Single source of truth:** Convince avere Engine A (audit) e Engine B (dashboard) con due path, o unificare?
10. **Edge case MLTX** (capital €5): distorce % — il fix P0 introduce regressioni su capitali microscopici?

---

## §13 — File da leggere (ordine consigliato)

| # | File | Righe / simboli chiave |
|---|------|------------------------|
| 1 | `desktop-ui/src/sheet/simulationPosition.ts` | L253 `historyCloseSeriesLooksContaminated`, L981 `buildPositionDailyPnlLegs`, L1056 `sumPnlFromDailyCloseSeries`, L1120 `resolvePositionPnlBreakdown`, L1390 `buildPortfolioDailyPnlLedger`, L1921 `positionPnlForOpenRow`, L1998+ `aggregateOpenPortfolioPnl` |
| 2 | `desktop-ui/scripts/diag-pnl-audit.ts` | Repro numerico |
| 3 | `desktop-ui/src/sheet/simulationPnlReconcile.test.ts` | Suite regressione |
| 4 | `desktop-ui/src/components/InvestmentSimulationView.tsx` | L713 `portfolioSnapshot` |
| 5 | `desktop-ui/src/sheet/portfolioGainAuditExport.ts` | Percorso audit (reference) |
| 6 | `desktop-ui/src/sheet/dashboardPulseAggregate.ts` | L37 `actualFromHistoryPoint` (gap P1) |
| 7 | `desktop-ui/src/sheet/simLoopPulseView.ts` | L191 `resolveSimLoopAlignedOpenPnl` |
| 8 | `CURSOR_PNL_BUG_HANDOFF.md` | Handoff originale pre-fix |
| 9 | `PNL_BUG_AUDIT_REPORT.md` | Audit tecnico appendice |

---

## §14 — Prompt suggerito per Claude (review severa)

```
Leggi PNL_BUG_STERN_REVIEW.md nel repo Biotech Investment app 6.

Fai una review severa e indipendente:
1. Verifica la causa radice descritta leggendo simulationPosition.ts
2. Giudica se il fix in resolvePositionPnlBreakdown è corretto, completo, o fragile
3. Elenca bug residui, false positive/negative dell'euristica contamination
4. Rispondi alle 10 domande in §12 con verdict (APPROVE / APPROVE WITH CAVEATS / REJECT)
5. Proponi test mancanti prioritizzati
6. Indica se dashboardPulseAggregate e ledger richiedono fix before deploy

Sii scettico: assumi che il fix possa essere sbagliato finché non dimostri il contrario dai test e dalla logica.
Esegui npx tsx scripts/diag-pnl-audit.ts e vitest se hai accesso al repo.
```

---

## §15 — Issue secondarie (non bloccanti P0)

- **GPCR** close anomalo $32 il 22/06 — data quality sheet
- **MLTX** capital €5 — distorce % display
- Colonne Excel `P&L (%)` stale alla source Python — UI non deve fidarsi
- Bundle non deployato — utente potrebbe vedere versione pre-fix finché non rebuild + hard refresh

---

*Documento generato 2026-06-23 — post-implementazione fix P0 P&L · per peer review severa*
