# Cursor Handoff — Bug P0 P&L Portfolio / Sim loop / Synth

> **Come usare questo file:** apri una nuova chat Cursor, allega o `@`-menziona questo file, e incolla il blocco **TASK PROMPT** in §1.  
> Repo: `C:\coding\Biotech_Investment app 6` · Frontend: `desktop-ui/` only (non toccare `mobile-ui/`).

---

## §1 — TASK PROMPT (copia-incolla in Cursor)

```
Fix bug P0 P&L descritto in CURSOR_PNL_BUG_HANDOFF.md (root repo).

SINTOMO: Dashboard Portfolio, Piggy Bank, Sim loop e Synth mostrano P&L gonfiati
(+€48k totali, RYTM +178%, NRIX +65%) mentre l'export audit Excel è corretto (~+3–10%).

REPRO (deve passare dopo il fix):
  cd desktop-ui
  npx tsx scripts/diag-pnl-audit.ts
Scenario "clean then contaminated" deve dare aggregateOpenPortfolioPnl ~€625 (+5%), NON ~€21636 (+173%).

CAUSA RADICE:
  resolvePositionPnlBreakdown() in simulationPosition.ts somma gambe giornaliere da
  invest_sim_history.byTicker contaminati. historyCloseSeriesLooksContaminated() corregge
  solo mtmValue di oggi, NON le gambe prior. Con ≥2 snapshot (prod) i totali esplodono.

IMPLEMENTAZIONE RICHIESTA (P0):
  In resolvePositionPnlBreakdown (e coerentemente buildPortfolioDailyPnlLedger se serve):
  quando historyCloseSeriesLooksContaminated() è true OPPURE resolvePortfolioEntryBuyUsd > 0,
  il totalEur deve essere price MTM (mtmValue - entryValue), NON la somma delle gambe storiche.
  Mantieni pnlEurToday da Var. Giorn. % quando hasToday.

  Opzionale P1: sanitize byTicker on hydrateInvestSimHistory (mergeInvestSimHistoryPoints).

TEST:
  Aggiungi in simulationPnlReconcile.test.ts il test multi-snapshot in §6 di questo file.
  Tutti i test esistenti devono restare verdi:
    npx vitest run src/sheet/simulationPnlReconcile.test.ts src/sheet/simLoopPulseView.test.ts

VINCOLI:
  - Non rompere portfolioGainAuditExport (percorso audit già corretto).
  - Scope desktop-ui/ only.
  - Diff minimo, segui stile simulationPosition.ts esistente.
  - Non committare data/*.json né .env.

VERIFICA: diag script + vitest + build (npm run build in desktop-ui).
```

---

## §2 — Executive summary

| | Audit Excel | Dashboard live (bug) |
|---|-------------|----------------------|
| RYTM P&L | ~+€450–650 (~+5%) | ~+€21.900 (+178%) |
| NRIX P&L | ~+€450 (~+3.6%) | ~+€8.164 (+65%) |
| Totale 6 ticker | ~€2–3k | ~€48k |

**Formula corretta (audit):**
```
shares     = capital_eur / buy_price_usd
value_eur  = shares × current_price_usd
pnl_eur    = value_eur − capital_eur
```

**Formula dashboard (buggy quando storico contaminato):**
```
priorLeg   = Σ (snap[i].value − snap[i−1].value)   ← da HIST.byTicker
todayLeg   = Var. Giorn. % su MTM
total      = priorLeg + todayLeg                   ← esplode se snap[i] gonfiati
```

---

## §3 — Repro numerico (già verificato)

```powershell
cd "C:\coding\Biotech_Investment app 6\desktop-ui"
npx tsx scripts/diag-pnl-audit.ts
```

**Output attuale (BUG):**

```
=== single contaminated snapshot ===
computeSimulationPosition pnlEur: 625 pnlPct: 5
aggregate totals pnlEur: 54.89          ← sottostima (1 snap, seeding quirk)

=== clean then contaminated (typical prod) ===
computeSimulationPosition pnlEur: 625 pnlPct: 5
breakdown totalEur: 21635.89 priorLeg: 21581 today: 54.89 priorCloseCount: 2
aggregate totals pnlEur: 21635.89       ← BUG: +173% invece di +5%

=== no history (MTM only) ===
aggregate totals pnlEur: 625            ← OK
```

**Output atteso post-fix:** tutti e 3 gli scenari → dashboard `pnlEur` ≈ **625** (± Var. Giorn. % oggi).

---

## §4 — Portfolio utente (riferimento)

File: `data/invest_sim_inputs.json` (localStorage mirror: `supernova_invest_sim_inputs`)

| Key | buyPrice USD | capital EUR |
|-----|--------------|-------------|
| `RYTM\|2026-09-15` | 90.00 | 12,500 |
| `NRIX\|2026-08-31` | 17.73 | 12,500 |
| `KURA\|2026-09-30` | 9.80 | 10,606 |
| `PTCT\|2026-09-30` | 78.42 | 7,697 |
| `GPCR\|2026-08-26` | 45.73 | 3,499 |
| `MLTX\|2026-09-28` | 18.51 | 5 |

Storico: `data/invest_sim_history.json` + `localStorage` key `supernova_invest_sim_history`  
(contiene snapshot orari con `byTicker[key].pnlPct` gonfiati dal motore pre-fix)

Foglio Simulation: colonne Excel `P&L (%)` e `Valore Attuale ($)` **obsolete** — non usarle per MTM live se posizione attiva in portfolio.

---

## §5 — Architettura codice

### 5.1 Tre motori P&L

```
Engine A (CORRETTO — audit)
  computeSimulationPosition()
  → MTM = (capital/buy)×curr − capital
  → portfolioGainAuditExport.ts, ledger today liveValue

Engine B (BUGGY — dashboard)  ← FIX QUI
  positionPnlForOpenRow()
  → resolvePositionPnlBreakdown()
  → tickerDailyCloseSeries(hist, key)  ← legge byTicker contaminati
  → sumPnlFromDailyCloseSeries()
  → aggregateOpenPortfolioPnl() / buildDashboardPortfolioChips()

Engine C (Sim loop — eredita B)
  resolveSimLoopAlignedOpenPnl() → positionPnlForOpenRow()
  buildSimLoopHistoryFromTicks() → ancora paper marks (P2, non P0)
```

### 5.2 Superfici UI affette (tutte Engine B)

| UI | File | Entry point |
|----|------|-------------|
| Piggy Bank | `desktop-ui/src/components/MainDashboardView.tsx` | `aggregateOpenPortfolioPnl` |
| Portfolio pulse KPI / tabella | `desktop-ui/src/sheet/dashboardPulseView.ts` | same + chips |
| Simulation → P&L tab | `desktop-ui/src/components/InvestmentSimulationView.tsx` | `positionPnlForOpenRow` |
| Sim loop / Synth OPEN POSITIONS | `desktop-ui/src/sheet/simLoopPulseView.ts` | `resolveSimLoopAlignedOpenPnl` |
| Gain vs plan chart (parziale) | `desktop-ui/src/sheet/dashboardPulseAggregate.ts` | `actualFromHistoryPoint` → byTicker |

### 5.3 Writer storico (già fixato — non riscrive passato)

`InvestmentSimulationView.tsx` → `portfolioSnapshot()` (~L713):

```ts
// ORA (corretto per snapshot futuri):
const m = row ? positionPnlForOpenRow(row, inputs, history) : null;
byTicker[p.key] = { value, pnl: m?.pnlEur ?? p.pnlEur, pnlPct: m?.pnlPct ?? p.pnlPct };

// PRIMA (contaminava):
byTicker[p.key] = { value: pos.valueNow, pnl: pos.pnlEur, pnlPct: pos.pnlPct };
```

Snapshot **passati** restano contaminati finché Engine B non li ignora o finché non si fa migration storico.

---

## §6 — Test da aggiungere (fallisce oggi)

File: `desktop-ui/src/sheet/simulationPnlReconcile.test.ts`

```ts
it("ignores contaminated leg chain when clean snapshot preceded bad save", () => {
  const key = "RYTM|2026-09-15";
  const row = {
    Ticker: "RYTM",
    "Completion Date": "15/09/2026",
    "Prezzo Corrente ($)": 94.5,
    "Prezzo Acquisto ($)": 90,
    "Var. Giorn. %": 0.42,
    "Valore Attuale ($)": 34_750,
    "P&L (%)": 178,
    "Capitale Investito ($)": 12_500,
  };
  const inputs = {
    [key]: {
      buyPrice: 90,
      capital: 12_500,
      ignoreSheet: false,
      investedAt: "2026-06-12T07:11:18.665Z",
    },
  };
  const history = [
    {
      ts: "2026-06-15T16:00:00.000Z",
      capital: 12_500,
      value: 13_169,
      pnl: 669,
      pnlPct: 5.35,
      byTicker: { [key]: { value: 13_169, pnl: 669, pnlPct: 5.35 } },
    },
    {
      ts: "2026-06-17T16:00:00.000Z",
      capital: 12_500,
      value: 34_750,
      pnl: 22_250,
      pnlPct: 178,
      byTicker: { [key]: { value: 34_750, pnl: 22_250, pnlPct: 178 } },
    },
  ];
  const simTable = { sheet: "Simulation", rows: [row], columns: [] };
  const chips = buildDashboardPortfolioChips(simTable, inputs, history);
  const totals = aggregateOpenPortfolioPnl(simTable, inputs, history);

  expect(chips[0]?.pnlEur).toBeLessThan(800);
  expect(chips[0]?.pnlPct).toBeLessThan(8);
  expect(totals.pnlEur).toBeLessThan(800);
  expect(totals.pnlEur).toBeCloseTo(totals.priorLegEur + totals.pnlEurToday, 2);
});
```

---

## §7 — Fix implementativo (P0) — pseudocodice

**File principale:** `desktop-ui/src/sheet/simulationPosition.ts`  
**Funzione:** `resolvePositionPnlBreakdown` (~L1120)

Dopo il calcolo di `mtmValue`, `closeSeries`, e `summed`:

```ts
const rawInp = inputs?.[pos.key];
const entryBuy = resolvePortfolioEntryBuyUsd(
  simRow ?? {},
  rawInp,
  pos.currPrice ?? (simRow ? currentPriceFromRow(simRow) : null),
  investedAtIso,
);
const contaminated = historyCloseSeriesLooksContaminated(
  entryValue,
  closeSeries,
  entryBuy > 0 ? entryBuy : null,
  pos.currPrice ?? null,
);
const trustedEntryBuy = entryBuy > 0;

if (contaminated || trustedEntryBuy) {
  const totalEur = roundEur(mtmValue - entryValue);
  const totalPct =
    entryValue > 0 ? Math.round((totalEur / entryValue) * 10000) / 100 : 0;
  let priorLegEur = 0;
  if (summed.hasToday && summed.pnlEurToday != null) {
    priorLegEur = roundEur(totalEur - summed.pnlEurToday);
  }
  return attachReadingDelta({
    totalEur,
    totalPct,
    entryValue,
    pnlEurToday: summed.pnlEurToday,
    pnlPctToday: summed.pnlPctToday,
    hasToday: summed.hasToday,
    todaySource: /* same as existing */,
    totalSource: contaminated ? "price_mtm_contaminated_history" : "price_mtm_trusted_buy",
    dailyLegCount: summed.dailyLegCount,
    priorValue: summed.priorValue,
    priorLegEur,
    priorCloseCount: summed.priorCloseCount,
  }, mtmValue, hist, pos.key);
}
// else: existing summed path unchanged
```

**Attenzione:** valutare se `trustedEntryBuy` da solo è troppo aggressivo (disabilita leg sum anche con storico pulito). Alternativa più conservativa: applicare solo quando `contaminated === true`. Il repro prod richiede almeno `contaminated`.

**Coerenza ledger:** `buildPortfolioDailyPnlLedger` (~L1390) usa la stessa catena — se il ledger mostra totali gonfiati, allineare con la stessa guard.

---

## §8 — Fix opzionali (P1–P2)

### P1 — Sanitize on hydrate

File: `desktop-ui/src/sheet/investSimStorage.ts` → `hydrateInvestSimHistory` / `mergeInvestSimHistoryPoints`

Per ogni punto storico, se `byTicker[key].pnlPct` diverge >12pp da price MTM e buy trusted → ricalcola o elimina snap.

### P1 — Chart pulse

File: `desktop-ui/src/sheet/dashboardPulseAggregate.ts`  
`actualFromHistoryPoint` e `sanitizePulseHistory` — preferire `row.pnlEur` live quando contamination.

### P2 — Sim loop chart history

File: `desktop-ui/src/sheet/simLoopPulseView.ts`  
`buildSimLoopHistoryFromTicks` — non P0; KPI live si sistemano con fix Engine B.

### P3 — Migration dati utente

Dopo deploy codice:
```js
// DevTools — opzionale se sanitize on hydrate non basta
localStorage.removeItem('supernova_invest_sim_history');
// poi refresh — si re-idrata da disk (meglio se disk anche sanificato)
```

---

## §9 — Fix già tentati (NON sufficienti da soli)

| Commit area | Cosa fa | Perché UI ancora sbagliata |
|-------------|---------|----------------------------|
| `resolvePortfolioEntryBuyUsd` | Buy corretto per MTM | Dashboard usa leg sum, non MTM raw |
| Skip `reconcileAnchoredBuyMarkToMarket` se entryBuy | `computeSimulationPosition` OK | Stesso |
| `historyCloseSeriesLooksContaminated` | Fix mtmValue oggi | Prior legs ancora sommate |
| `portfolioSnapshot` → `positionPnlForOpenRow` | Stop nuova contaminazione | Storico passato resta bad |
| `resolveSimLoopAlignedOpenPnl` | Sim loop → Engine B | Engine B ancora broken |

---

## §10 — File da leggere (ordine suggerito)

1. `desktop-ui/src/sheet/simulationPosition.ts` — L253 `historyCloseSeriesLooksContaminated`, L929 `tickerDailyCloseSeries`, L1056 `sumPnlFromDailyCloseSeries`, L1120 `resolvePositionPnlBreakdown`, L1998 `aggregateOpenPortfolioPnl`
2. `desktop-ui/scripts/diag-pnl-audit.ts` — repro
3. `desktop-ui/src/sheet/simulationPnlReconcile.test.ts` — test suite
4. `desktop-ui/src/components/InvestmentSimulationView.tsx` — L713 `portfolioSnapshot`
5. `desktop-ui/src/sheet/investSimStorage.ts` — L458 merge, L563 hydrate
6. `desktop-ui/src/sheet/simLoopPulseView.ts` — L191 `resolveSimLoopAlignedOpenPnl`
7. `desktop-ui/src/sheet/portfolioGainAuditExport.ts` — percorso corretto (reference)

---

## §11 — Comandi verifica

```powershell
cd "C:\coding\Biotech_Investment app 6\desktop-ui"

# Repro bug / post-fix
npx tsx scripts/diag-pnl-audit.ts

# Unit tests
npx vitest run src/sheet/simulationPnlReconcile.test.ts src/sheet/simLoopPulseView.test.ts

# Build
npm run build
```

**Checklist post-fix:**

- [ ] diag: "clean then contaminated" → `aggregate totals pnlEur` ≈ 625
- [ ] nuovo test §6 verde
- [ ] 34+ test esistenti verdi
- [ ] build OK
- [ ] UI: Piggy Bank ~€2–3k (non ~€48k) dopo hard refresh
- [ ] Audit export invariato (~stessi numeri di prima)

---

## §12 — Perché i test passavano ma la UI no

`buildPositionDailyPnlLegs` (~L994) con **un solo** snapshot post-ingresso:

```ts
if (!seededFromFirstSnap && investDayKey && pt.dayKey > investDayKey) {
  prev = pt.value;  // baseline = valore gonfiato, ZERO leg aggiunto
  continue;
}
```

→ `priorLeg = 0`, total ≈ solo oggi → test single-snap sembra OK.  
Con **due+ snapshot** (prod, salvataggi orari): prima leg +€669, seconda +€21.581 → totale +173%.

---

## §13 — Issue secondarie (non bloccare P0)

- **GPCR** close anomalo $32 il 22/06 — data quality sheet
- **MLTX** capital €5 — distorce % display (Risk & Benefit)
- **Build non deployato** — utente potrebbe vedere bundle vecchio; rebuild + hard refresh dopo fix
- Colonne Excel `P&L (%)` stale alla source (Python orchestrator) — UI non deve fidarsi

---

## §14 — Regole repo

- **Desktop only** per questo bug (`desktop-ui/`). Mobile (`mobile-ui/`) è frontend separato.
- Non importare codice desktop in mobile.
- Diff minimo; no refactor non richiesto.
- Non committare secrets o `data/*.json` con dati utente.

---

## §15 — Documenti correlati

| File | Contenuto |
|------|-----------|
| `CURSOR_PNL_BUG_HANDOFF.md` | **Questo file** — handoff completo per Cursor |
| `PNL_BUG_AUDIT_REPORT.md` | Audit tecnico dettagliato (appendice) |
| `desktop-ui/scripts/diag-pnl-audit.ts` | Script repro numerico |

---

*Handoff generato 2026-06-23 — pronto per sessione Cursor Agent*
