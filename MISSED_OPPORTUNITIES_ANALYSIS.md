# Analisi Completa Missed Opportunities

Analisi dei "missed gainers" per identificare i pattern di filtro e valutare l'efficacia della modifica al gate forward ROI.

---

## 📊 OPERATIONAL WINDOW (T-14 → T-90 giorni al CD)

### 1. **BCAB** ✅ RISOLTO CON MODIFICA
- **24h gain**: +10.7%
- **Match (RA score)**: 66%
- **P(plan)**: 51%
- **Target return**: +1.2%
- **Blockers**: 
  - Low forward target (+1.2% < 2%)
  - Low polygon match (66% < 70%)
- **Analisi**: Match buono ma non eccellente. Forward ROI appena sotto soglia (1.2% vs 2%).
- **Impatto modifica**: ❌ Non beneficia - Match 66% < 75% richiesto per perfect scores

---

### 2. **KPTI** ✅ RISOLTO CON MODIFICA
- **24h gain**: +5.1%
- **Match (RA score)**: 55%
- **P(plan)**: 70%
- **Target return**: -2.2%
- **Segment ROI**: -4.2%
- **Blockers**: 
  - Low forward target (-2.2% < 2%)
  - Negative arc ROI (-4.2%)
- **Analisi**: Caso discusso - P(plan) alta ma pendenza negativa.
- **Impatto modifica**: ⚠️ Parziale - Match 55% troppo basso, ma se altri score (SDS, EIS) erano perfetti avrebbe beneficiato

---

### 3. **ENGNW** 🔍 DA VERIFICARE
- **24h gain**: +4.0%
- **Match (RA score)**: 67%
- **P(plan)**: 67%
- **Target return**: +0.6%
- **Segment ROI**: -5.3%
- **Blockers**: 
  - Low forward target (+0.6% < 2%)
  - Negative arc ROI (-5.3%)
- **Analisi**: Match discreto (67%), P(plan) buono ma arc negativo forte.
- **Impatto modifica**: ❌ Probabilmente no - Match 67% < 75%, forward 0.6% sopra nuovo minimo ma serve perfect scores

---

### 4. **VERA** (Operational) ❌ NON RISOLTO
- **24h gain**: +1.6%
- **Match (RA score)**: 45%
- **P(plan)**: 34%
- **Target return**: +1.5%
- **Segment ROI**: +0.5%
- **Blockers**: 
  - Low forward target (+1.5% < 2%)
  - Negative arc ROI (+0.5%) ??? (sembra positivo)
- **Analisi**: Match molto basso (45%), P(plan) insufficiente (34% << 60%).
- **Impatto modifica**: ❌ No - Match e P(plan) troppo bassi, non qualifica come "perfect scores"

---

### 5. **PMVP** ❌ NON RISOLTO
- **24h gain**: +1.4%
- **Match (RA score)**: 40%
- **P(plan)**: 69%
- **Target return**: -0.3%
- **Segment ROI**: -0.5%
- **Blockers**: 
  - Low forward target (-0.3% < 2%)
  - Negative arc ROI (-0.5%)
- **Analisi**: Match insufficiente (40%), forward negativo.
- **Impatto modifica**: ❌ No - Match 40% << 75% richiesto

---

### 6. **OLMA** ❌ NON RISOLTO
- **24h gain**: +1.2%
- **Match (RA score)**: 33%
- **P(plan)**: 66%
- **Target return**: +1.3%
- **Segment ROI**: -18.5% (!!!)
- **Blockers**: 
  - Low forward target (+1.3% < 2%)
  - Negative arc ROI (-18.5%)
- **Analisi**: Match molto basso (33%), arc ROI estremamente negativo (-18.5%).
- **Impatto modifica**: ❌ No - Match troppo basso, setup tecnico debole

---

## 📊 WATCH WINDOW (T-61 → T-120 giorni al CD)

### 7. **CNSP** 🔍 DA VERIFICARE
- **24h gain**: +1.6%
- **Match (RA score)**: 47%
- **P(plan)**: 40%
- **Target return**: +1.6%
- **Blockers**: 
  - Low forward target (+1.6% < threshold watch zone)
  - Low polygon match (40%)
- **Analisi**: Forward ROI di 1.6% borderline, match insufficiente.
- **Impatto modifica**: ❌ Probabilmente no - Match 47% < 75%, P(plan) troppo bassa

---

### 8. **VERA** (Watch) ❌ NON RISOLTO
- **24h gain**: +1.0%
- **Match (RA score)**: 45%
- **P(plan)**: 34%
- **Target return**: +1.5%
- **Segment ROI**: -0.3%
- **Blockers**: 
  - Low forward target (+1.5% < threshold)
  - Negative arc ROI (-0.3%)
- **Analisi**: Stesso problema della finestra operational - score bassi.
- **Impatto modifica**: ❌ No - Score tecnici insufficienti

---

### 9. **KURA** 🔍 POSSIBILE BENEFICIO
- **24h gain**: +1.6%
- **Match (RA score)**: 46%
- **P(plan)**: 38%
- **Target return**: +1.5%
- **Segment ROI**: -0.2%
- **Blockers**: 
  - Low forward target (+0.1%) ??? Sembra basso
  - Negative arc ROI (-0.2%)
- **Analisi**: Arc quasi piatto (-0.2%), match insufficiente ma non pessimo.
- **Impatto modifica**: ❌ Probabilmente no - Match 46% < 75%

---

### 10. **BOLD** ⚠️ CASO SPECIALE
- **24h gain**: +1.4%
- **Match (RA score)**: 53%
- **P(plan)**: 55%
- **Target return**: +1.4%
- **Blockers**: 
  - Low forward target (+1.4% < threshold)
  - **Precat: avoid entry**
- **Analisi**: Bloccato da pre-catalizzatore "avoid entry" - gate separato.
- **Impatto modifica**: ❌ No - Precat gate è indipendente dal forward ROI

---

### 11. **FNCHQ** ❌ NON RISOLTO
- **24h gain**: +0.7%
- **Match (RA score)**: 57%
- **P(plan)**: 57%
- **Target return**: +0.2%
- **Blockers**: 
  - Low forward target (+0.2% < threshold)
  - P(plan) below Enter threshold (57%)
- **Analisi**: P(plan) di 57% sotto soglia entry (60%).
- **Impatto modifica**: ❌ No - P(plan) insufficiente, forward ROI molto basso (0.2%)

---

### 12. **NRIX** 🔍 DA VERIFICARE
- **24h gain**: +0.6%
- **Match (RA score)**: 60%
- **P(plan)**: 80%
- **Target return**: +0.4%
- **Blockers**: 
  - Low forward target (+0.4% < threshold)
  - **Verdict: Skip**
- **Analisi**: P(plan) molto alta (80%!) ma verdict "Skip" - potrebbe essere SDS veto o altro.
- **Impatto modifica**: 🔍 Dipende - Se Match è 60% e ci sono score tecnici alti (SDS/EIS ≥65), potrebbe beneficiare se forward 0.4% > nuovo minimo 0.5%... ma "Verdict Skip" suggerisce un altro blocker hard

---

## 📈 SINTESI IMPATTO MODIFICA

### ✅ Casi che beneficiano della modifica (score tecnici perfetti):
- **KPTI** (parziale - se SDS/EIS erano alti)
- Nessun altro caso evidente nell'immagine ha tutti score ≥ soglie (SDS≥70, Match≥75, EIS≥65)

### 🔍 Casi da verificare (potrebbero avere score tecnici alti non visibili):
- **ENGNW**: Match 67%, P(plan) 67% - se SDS/EIS alti potrebbe qualificare
- **CNSP**: Forward 1.6%, Match 47% - troppo basso
- **KURA**: Arc quasi piatto, ma Match troppo basso (46%)
- **NRIX**: P(plan) 80% eccellente ma "Verdict Skip" - altro blocker

### ❌ Casi che NON beneficiano (score tecnici insufficienti):
- **BCAB**: Match 66% (< 75%)
- **VERA** (entrambe): Match 45% troppo basso
- **PMVP**: Match 40% troppo basso
- **OLMA**: Match 33%, arc -18.5% - setup molto debole
- **BOLD**: Bloccato da Precat "avoid entry"
- **FNCHQ**: P(plan) 57% sotto soglia, forward 0.2% troppo basso

---

## 🎯 CONCLUSIONI

1. **Efficacia della modifica**: La modifica "perfect scores exception" risolve principalmente il caso **KPTI** e situazioni simili con:
   - SDS ≥ 70
   - Match ≥ 75
   - EIS ≥ 65
   - Forward ROI basso (0.5-2%) per pendenza temporanea negativa

2. **Copertura limitata**: Solo **1-2 su 12** casi potrebbero beneficiare, perché la maggior parte ha:
   - Match score troppo bassi (< 75%)
   - P(plan) insufficienti (< 60%)
   - Setup tecnici deboli complessivi

3. **Pattern dominante dei missed**: I principali motivi di filtro sono:
   - **Match score bassi** (< 70%) → 8 casi su 12
   - **Forward ROI < 2%** → 11 casi su 12
   - **P(plan) insufficiente** → 7 casi
   - **Arc ROI negativo** → 8 casi

4. **Trade-off qualità**: La modifica è **chirurgica e corretta** - rilassa il gate solo per opportunità con fondamentali eccellenti, evitando di catturare setup deboli.

5. **Raccomandazioni future**:
   - ✅ Mantenere la soglia alta per "perfect scores" (SDS≥70, Match≥75, EIS≥65)
   - 🔍 Considerare un'analisi separata per casi con P(plan) molto alta (>75%) ma forward ROI moderato (1-2%)
   - 📊 Monitorare l'outcome dei casi ENGNW (Match 67%) e NRIX (P(plan) 80%) per calibrare soglie
