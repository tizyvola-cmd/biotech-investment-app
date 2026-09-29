# Diagnosi — Non-monotonicità P(plan) bucket (Approved weights)

**Data:** 2026-06-30  
**Scope:** Solo lettura — nessuna modifica a `sizingRules.ts` né ai pesi approvati.  
**Script di riproduzione:** `scripts/diag_pplan_bucket_weights.py`

---

## Fase 0 — Architettura (come funziona oggi)

### Dove si calcola il "Weight"

| Layer | File | Ruolo |
|-------|------|--------|
| Calcolo live | `desktop-ui/src/calibration/shrinkageEngine.ts` (+ mirror Python `prediction/bayesian_shrinkage.py`) | Win rate per cella → shrinkage bayesiano |
| Proposta | `desktop-ui/src/calibration/proposalEngine.ts` | Diff snapshot vs frozen; `newWeight = cell.shrinkageApplied` |
| Persistenza | `desktop-ui/src/calibration/proposalStore.ts` → `localStorage` `supernova.calibration.frozenWeights.v1` | Solo dopo **Approve** umano |
| Consumo sizing | `desktop-ui/src/calibration/sizingRules.ts` | Legge **solo** `FrozenWeights` — mai il motore live |

Il numero in tabella **Approved weights** è quindi il **win rate shrinkato** (`shrinkageApplied`), non il win rate grezzo.

### Formula

```
p_shrunk = (n × p_observed + k × prior) / (n + k)     con k = 8 (default)
```

- `prior` = win rate pooled a livello **dimensione** P(plan) (tutti i trade con bucket P(plan) valido), se `n_dim ≥ 3`, altrimenti prior globale.
- **Win operativo del motore:** `pnl_pct > -2%` (banda piatta simmetrica ±2%), **non** `pnl > 0` e **non** il flag JSON `is_win`.

### Bucketing P(plan)

Definito in `lossAuditAnalysis.ts` → `bucketPplan()` (fissi, non configurabili):

| Cella | Regola |
|-------|--------|
| P(plan) <30% | `p < 30` |
| P(plan) 30-50% | `30 ≤ p < 50` |
| P(plan) 50-70% | `50 ≤ p < 70` |
| P(plan) ≥70% | `p ≥ 70` |

**Valore usato per il bucket:** `entry_affidabilita_pct` sull’outcome, fallback `affidabilita_pct` — **solo al momento dell’entry** (`shrinkageEngine.ts` righe 90-96, 115). Non si usa P(plan) live/aggiornato nel tempo per ribucketizzare i trade chiusi.

### Fonte dati

- Input: `GET /api/investment/sim-outcomes` → `data/investment_sim_outcomes.json`
- Origine righe: posizioni **Simulation sheet** con capitale > 0 (`prediction/investment_sim_outcomes.py`)
- **Non** include le chiusure del portafoglio reale da `invest_sim_inputs` (soldAt) — quelle alimentano altri grafici (Model Comparison, n≈80), non il Calibration Center

---

## Riproduzione numerica sui dati attuali (n=64 chiusi)

Esecuzione: `py -3 scripts/diag_pplan_bucket_weights.py`

### Motore ufficiale (`pnl > -2%`, shrinkage k=8)

| Cella | n | Raw | Shrunk | Conf |
|-------|---|-----|--------|------|
| P(plan) <30% | 2 | 50.0% | 86.2% | LOW |
| P(plan) 30-50% | 12 | 91.7% | 93.1% | MED |
| P(plan) 50-70% | 35 | **97.1%** | **96.8%** | HIGH |
| P(plan) ≥70% | 15 | 100.0% | 98.4% | HIGH |

**Con i dati odierni il pattern è monotono** (raw e shrunk crescono con P(plan)).  
**L’anomalia riportata in UI (50-70% a 48,6%) non è riproducibile** ricalcolando il motore sul file outcomes corrente.

### Confronto con la tabella segnalata dall’utente

| Cella | UI utente | Shrunk engine (oggi) | Δ |
|-------|-----------|----------------------|---|
| <30% | 56,3% (n=2) | 86,2% | +30 pp |
| 30-50% | 53,1% (n=12) | 93,1% | +40 pp |
| **50-70%** | **48,6% (n=34)** | **96,8% (n=35)** | **−48 pp** |
| ≥70% | 76,6% (n=15) | 98,4% | +22 pp |

Conclusione immediata: i **pesi approvati in UI sono stale** rispetto al dataset outcomes attuale, oppure sono stati approvati su un snapshot storico molto diverso (P&L / composizione trade).

---

## Fase 1 — Verifica ipotesi 1.1–1.5

### 1.1 — Mix sim loop + portafoglio reale

**Esito: non spiega l’anomalia nel Calibration Center (mix assente), ma spiega la tensione con r=+0,50 su n=80.**

- Tutte le 35 righe in fascia 50-70% hanno `row_key` con suffisso `#cycleN` → **100% sim loop / paper cycles**
- Il shrinkage **non** mescola `invest_sim_inputs` chiusure reali
- Il correlato r=+0,50 (Model Comparison) usa un universo più ampio (~80 deal chiusi sim + portfolio) — **metriche diverse su popolazioni diverse**

| Popolazione | n tipico | Uso |
|-------------|----------|-----|
| `investment_sim_outcomes.json` | 64 | Approved weights |
| Model Comparison chart1 | ~80 | Correlazione P(plan)↔P&L |

### 1.2 — Bucketing su P(plan) non rappresentativo

**Esito: parzialmente rilevante per interpretazione, non causa principale del 48,6%.**

- Il bucket è **entry-only** (corretto per evitare leakage)
- P(plan) live può divergere dopo l’entry, ma **non ribucketizza** i trade già chiusi
- Non spiega da solo il gap 48,6% vs 97% sullo stesso file

### 1.3 — Outlier nella fascia 50-70%

**Esito: insufficiente come spiegazione unica.**

Elenco 35 posizioni (estratto):

| Ticker | P(plan) entry | P&L% | outcome | Nota |
|--------|---------------|------|---------|------|
| WVE | 50 | **−7,92%** | failure | Unico loss profondo |
| GPCR | 54 | −1,68% | failure | 2 righe duplicate cycle |
| PLSE ×4 | 58 | −0,02% | flat | Contate **win** dal motore (pnl > −2%) |
| 10+ ticker | 50–67 | 0% … +0,66% | flat | Win motore; `is_win=false` |

- Con `pnl > -2%`: **1 loss netta** (WVE) su 35 → raw 97,1%
- Con `pnl > +1%` (soglia flat Python): **17/35 win** → raw **48,57%** ≈ **48,6% UI**

**Evidenza forte:** il valore **48,6% coincide esattamente** con il win rate grezzo `pnl > +1%` nella fascia 50-70%, **non** con il win rate del motore (`pnl > -2%`).

### 1.4 — Bordi di fascia arbitrari

**Esito: non è artefatto dei bordi con il motore attuale.**

Test con tagli alternativi (win `pnl > -2%`):

| Tagli (b1/b2/b3/b4) | n per fascia | Win rate | Monotono |
|---------------------|--------------|----------|----------|
| 30 / 50 / 70 (default) | 2 / 12 / 35 / 15 | 50% → 92% → 97% → 100% | Sì |
| 25 / 55 / 75 | 1 / 25 / 31 / 7 | 0% → 92% → 100% → 100% | Sì |
| 35 / 55 / 75 | 3 / 23 / 31 / 7 | 67% → 91% → 100% → 100% | Sì |

Spostare i confini non genera il pattern “50-70% più basso di 30-50%” sui dati correnti.

### 1.5 — Definizione di "weight" (shrinkage)

**Esito: confermato — il weight **dovrebbe** essere shrinkato; l’UI utente sembra allineata a un criterio di win diverso o a dati obsoleti.**

| Definizione win | 50-70% raw | 50-70% shrunk | Match UI 48,6%? |
|-----------------|------------|---------------|-----------------|
| **pnl > −2% (motore)** | 97,1% | 96,8% | No |
| pnl > 0 | 60,0% | 61,6% | No |
| **pnl > +1% (flat band)** | **48,6%** | 50,9% | **Raw: sì** |
| flag `is_win` JSON | 54,3% | 56,4% | No |
| `outcome == success` | 54,3% | 54,9% | No |

Effetto shrinkage con n grandi (34–35) è modesto (~2–3 pp). Un peso approvato a 48,6% con n=34 **non può** venire dallo shrinkage del motore su dati attuali (shrunk sarebbe ~97%). È compatibile con:

1. **Raw win rate** sotto definizione più stretta (`pnl > +1%`), oppure  
2. **Snapshot storico** con molti più loss nella fascia 50-70%, non aggiornato dopo refresh outcomes/P&L

### Complicazione aggiuntiva: righe duplicate per ciclo sim

Molti ticker compaiono più volte (`PLSE` ×4, `NRIX` ×4, `PTCT` ×3, …) come `#cycle1…#cycle6`. Il motore conta **ogni ciclo come trade separato** (n=35 nella fascia, non ~20 deal unici `ticker|CD`). Questo gonfia n e può abbassare o alzare la media a seconda degli esiti dei cicli duplicati — ma **non** spiega da solo un crollo a 48,6% con il motore ufficiale.

---

## Ipotesi vincente (sintesi)

| # | Ipotesi | Verdetto | Evidenza |
|---|---------|----------|----------|
| **1.1** | Mix sim + reale nel bucket | ❌ nel Calibration Center | Solo sim-outcomes; tensione r=0,50 = universo diverso |
| **1.2** | P(plan) snapshot obsoleto | ⚠️ secondario | Entry-only by design |
| **1.3** | Outlier | ⚠️ contribuisce solo sotto win stretto | WVE −8%; molti flat 0% |
| **1.4** | Bordi fasce | ❌ | Monotono con tagli alternativi |
| **1.5** | Weight ≠ win rate grezzo | ✅ **centrale** | UI 48,6% = raw `pnl>+1%`; motore usa `pnl>−2%` + shrinkage |

**Causa radice (diagnosi):**

1. **Metodologica:** disallineamento tra ciò che l’utente interpreta come “win” (P&L positivo / soglia flat ±1%) e ciò che il motore calcola (`pnl > −2%`). Sotto `pnl > +1%` la fascia 50-70% è **deliberatamente** la peggiore (molti esiti flat 0–1%).
2. **Operativa:** i **pesi approvati** in `localStorage` non corrispondono al ricalcolo fresh sul outcomes odierno → tabella **stale** o approvata su cohort diversa.
3. **Campione:** non è rumore da n piccolo su 50-70% (n=34–35, HIGH conf), ma **definizione di successo + eventuale staleness**, non varianza statistica.

**Problema di campione o di metodologia?** → **Metodologia + staleness**, non campione insufficiente nella fascia 50-70%.

---

## Altre non-monotonicità nella stessa schermata

Ricalcolo fresh (stesso file, stesso motore):

### Clinical phase (raw / shrunk)

| Cella | n | Raw | Shrunk |
|-------|---|-----|--------|
| Phase 1 | 12 | 91,7% | 93,1% |
| Phase 2 | 23 | 95,7% | 95,6% |
| Phase 3 | 17 | 100% | 98,5% |

Su dati **attuali** Phase 2 ≥ Phase 1; l’anomalia “Phase 2 più basso” osservata in UI **non si riproduce** → stessa spiegazione: **pesi frozen stale**.

### SDS bucket

| Cella | n | Raw | Shrunk |
|-------|---|-----|--------|
| SDS <40 | 44 | 93,2% | 93,5% |
| SDS 40-55 Mid | 15 | 100% | 98,4% |
| No SDS | 4 | 100% | 96,9% |

“No SDS più basso di Mid” **non** compare sul fresh compute (No SDS ha n=4, alta varianza, shrinkage verso prior).

**Conclusione:** le non-monotonicità minori in UI condividono la stessa radice probabile — **frozen weights non allineati al dataset corrente**, non un bug isolato della fascia P(plan).

---

## Raccomandazioni (solo proposta — nessun fix in questo comando)

### P0 — Validazione prima di qualsiasi fix ai pesi

1. In Calibration Center → **“Ricalcola ora”** e confrontare la proposta pending con la tabella Approved: se differiscono molto (come atteso), i frozen sono obsoleti.
2. Esportare/salvare `localStorage` `supernova.calibration.frozenWeights.v1` e timestamp `updatedAt` per audit.
3. Rieseguire `scripts/diag_pplan_bucket_weights.py` dopo ogni refresh outcomes.

### P1 — Allineamento definizioni (fix metodologico, non ancora implementare)

| Opzione | Pro | Contro |
|---------|-----|--------|
| A. Documentare in UI che “win” = `pnl > −2%` | Zero rischio sizing | Controintuitivo vs “P&L positivo” |
| B. Allineare win a `pnl > 0` o `outcome == success` | Coerente con intuizione | Cambia tutti i pesi; flat band 0% diventa loss |
| C. Mostrare **raw + shrunk + definizione win** per cella | Trasparenza | Solo UI |

**Raccomandazione:** **C** subito, poi decidere **A vs B** con un comando dedicato — non silent-fix.

### P2 — Campione (fix strutturale)

- **Deduplicare** per `ticker|CD` (ignorando `#cycle`) nel calcolo calibration, oppure tenere solo l’ultimo ciclo per decisione — oggi i cicli sim moltiplicano n artificialmente.
- **Separare** esplicitamente in UI/proposta: “sim outcomes (sizing)” vs “portfolio closed (validazione)” per evitare confronti con r=0,50 su n=80.

### P3 — Cosa non fare

- Non “aggiustare” manualmente il 48,6% nella tabella.
- Non modificare `sizingRules.ts` finché frozen e definizione win non sono validati.
- Non usare la monotonicità dei bucket come prova che P(plan) “funziona” o “non funziona” senza allineare win criterion e dataset.

---

## Appendice — Lista posizioni P(plan) 50-70% (n=35)

Vedi output completo di `scripts/diag_pplan_bucket_weights.py`. Riepilogo:

- **1 failure profonda:** WVE −7,9%
- **2 failure lievi:** GPCR −1,68% (×2 righe cycle)
- **12 flat** (−0,02% … +0,66%): contano come **win** per il motore, **loss** per `pnl>+1%` e spesso `is_win=false`
- **20 success** chiari (>+1%)

Questo spiega perché, sotto una definizione di win più stretta della correlazione P(plan)↔P&L continua, la fascia 50-70% appare “peggiore” delle fasce adiacenti anche senza errori di calcolo aritmetico.
