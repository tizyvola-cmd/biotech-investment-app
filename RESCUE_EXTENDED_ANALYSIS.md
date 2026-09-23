# Rescue Score (extended) — Report analisi diagnostica

**Data:** 2026-06-19  
**Scope:** Portafoglio reale (open + closed) + sim loop — **non** società mai investite.

---

## Fase 0 — Fattibilità tecnica (confermata)

### Dove scatta il filtro operativo

| Livello | Soglia | Comportamento |
|---------|--------|---------------|
| `lossRescueEngine.ts` — `LOSS_ENTRY_THRESHOLD_PCT` | `0` | Posizioni “in loss” per budget rescue (`computeLossRescue`) |
| UI / export / Model Comparison — `isLoss` / export | **`< -2%`** | Rescue score **operativo** mostrato solo sotto −2% |
| `computeRescueScoreBreakdown()` | Nessun early return | Formula eseguibile con qualsiasi `lastMarkPct`; usa `abs(pnl%)` per Loss depth |

Il filtro `pnl < -2%` è **a monte** (UI, export operativo, grafici Gruppo A). La formula non presuppone implicitamente perdita, salvo l’uso di `abs()` nel breakdown operativo.

### Entry price — fonti

- **Portafoglio reale:** `invest_sim_inputs` + `invest_sim_history` (`pnlPct` da history o paper `lastMarkPct`); closed usa `closedValue/closedCapital`.
- **Sim loop:** `paperPortfolio.lastMarkPct` o righe sim sheet (`P&L (%)` se capitale > 0, altrimenti `Var. 1M %`).

Senza entry price valido la posizione è esclusa (coerente con scope).

### Conclusione Fase 0

**Calcolo “Rescue score (extended)” tecnicamente fattibile** riusando la stessa formula con una sola modifica al termine Loss depth:

```
loss_depth_pt_extended = pnl% < 0 ? clamp(abs(pnl%) × 0.88, 0, 25) : 0
```

---

## Fase 1 — Implementazione

### Nuovo motore

- `computeRescueScoreExtendedBreakdown()` in `desktop-ui/src/sheet/lossRescueEngine.ts`
- Costante `RESCUE_OPERATIONAL_THRESHOLD_PCT = -2` (invariata per alert/UI)
- `summarizeRescueExtendedGroups()` per statistiche Gruppo A vs B

### Campo `Rescue score (extended)`

Popolato su **tutte** le posizioni portfolio + sim in:

- `ModelComparisonPanel.tsx` — `CompRow.rescueScoreExtended`
- Export `supernova-score-validation_*.xls` — colonne aggiuntive in **Daily Scores**:
  - `Rescue score (extended)`
  - `Rescue ext. P(plan) pt`
  - `Rescue ext. Loss depth pt`
  - `Rescue ext. EIS pt`

Il campo operativo `Rescue score` resta `null` quando `Price vs entry ≥ -2%`.

### Test di sanità (unit test)

`lossRescueEngine.test.ts` verifica:

- `lossPt = 0` quando `lastMarkPct = +16%` (extended)
- `lossPt > 0` quando `lastMarkPct = -10%` (extended)
- Il breakdown **operativo** continua a usare `abs()` anche su guadagni (solo per confronto diagnostico)

**Verifica manuale consigliata:** in Model Comparison o export, controllare MLTX (o altra posizione a +16%): extended ≈ P(plan)pt + EISpt, Loss depth = 0.

---

## Fase 2 — Confronto Gruppo A vs B

### Definizione

| Gruppo | Criterio | Score usato |
|--------|----------|-------------|
| **A** | `pnl% < -2%` | `Rescue score` operativo nei grafici; extended nelle statistiche aggregate |
| **B** | `pnl% ≥ -2%` | `Rescue score (extended)` |

### Dove vedere i numeri

Pannello **“Rescue score (extended) — confronto Gruppo A vs B”** in Model Comparison (Tab Modelli), sotto Chart 2.

Mostra per ciascun gruppo: **n, media, mediana, min–max**.

Se Gruppo B non supera Gruppo A in media, compare un avviso esplicito che la formula **non discrimina ancora bene** — senza interpretazione ottimistica.

> I valori numerici dipendono dal portafoglio live (localStorage + snapshot). Aprire la dashboard per i numeri aggiornati al tuo campione (~31 posizioni reali + sim loop).

---

## Fase 3 — Redesign grafici Rescue

### Componente `RescueScoreScatter`

Sostituisce i vecchi `MiniScatter` per:

- **Chart 1:** Rescue Score vs P&L (chiuse)
- **Chart 2:** Rescue Score vs Var. prezzo (aperte)

### Principi applicati

1. **Due popolazioni distinte**
   - Cerchi colorati (verde/rosso): Gruppo A — rescue operativo (`rescueScore`, `pnl < -2%`)
   - Rombo blu/grigio: Gruppo B — extended (`rescueScoreExtended`, `pnl ≥ -2%`)

2. **Regressione senza estrapolazione**
   - OLS calcolata solo sul range X **osservato** nei punti (non più 0–100 fissi)
   - Applicato anche a **tutti** i `MiniScatter` della dashboard Model Comparison

3. **Etichetta recuperi**
   - Es. `0 recuperi pieni su 9 chiuse in rescue space` (accanto a r e n)

4. **Campione ridotto**
   - Se `n < 10` nel Gruppo A: icona ⚠ e testo “campione ridotto” accanto a r

### Descrizione visiva (layout)

```
┌─────────────────────────────────────┐
│ Rescue Score vs P&L          r 0.66⚠│
│ 0 recuperi pieni su 9 in rescue space│
│ ● rescue space  ◇ extended (≥ −2%)   │
│  [scatter: cerchi a sinistra/basso,  │
│   rombi a destra/alto — regressione  │
│   solo tra i cerchi, non oltre X max] │
└─────────────────────────────────────┘
```

---

## Cosa NON è stato modificato

- Soglia operativa `pnl% < -2%` per alert e UI produzione
- Formula operativa `computeRescueScoreBreakdown()` (incluso `abs()` su Loss depth)
- Scope esteso a società mai investite

---

## File toccati

| File | Modifica |
|------|----------|
| `desktop-ui/src/sheet/lossRescueEngine.ts` | Extended breakdown + group stats |
| `desktop-ui/src/sheet/lossRescueEngine.test.ts` | Test sanità extended |
| `desktop-ui/src/components/ModelComparisonPanel.tsx` | Campo extended, grafici, pannello A vs B |
| `desktop-ui/src/sheet/scoreValidationExport.ts` | Colonne export extended |
| `desktop-ui/src/components/ModelComparisonPanel.tsx` (`MiniScatter`) | Regressione clamped a range osservato |

---

## Prossimi passi suggeriti (fuori scope)

- Accumulare casi di recupero pieno in rescue space per validare correlazione operativa
- Valutare se allineare il coeff Loss depth operativo (0.7, max 20) con quello extended (0.88, max 25) solo dopo più dati
- Estendere export Outcome Summary con snapshot finale `rescueScoreExtended` per posizione
