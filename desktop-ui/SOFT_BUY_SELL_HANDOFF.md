# SuperNova — Brief logica BUY / SELL (handoff)

Passaggio per review / rafforzamento logica (Claude o altro).  
Fonte di verità: `RECOMMENDATION_LOGIC.md`, `softSignalGrades.ts`, `investDecisionSimLoop.ts`, `continuationScore.ts`.

**Data brief:** 2026-08-08

---

## 1. Principio

**Una sola azione operativa per ticker per tick:** `BUY | SELL | HOLD | REVIEW`.

Arbiter unico: `deriveSuggestedAction()` → la UI legge **`suggestedAction`**, non `exitDecision` / Top2 grezzi.

**Strategia volume (scelta di prodotto):** Soft BUY **largo** (più ingressi, più falsi positivi OK) + Urgent SELL G2 **duro** (tappo sulle perdite day del book).

Lista vera ingresso: pannello **Home Suggested BUY** (= Soft BUY G1).  
**Non** è il fulmine “Strong” del what-if 24h (solo path di giornata / KPI capture).

Home e Evaluation devono concordare sullo stesso Soft BUY G1.

---

## 2. Indici — cosa sono e a cosa servono

| Indice | Significato | Ruolo |
|--------|-------------|--------|
| **SDS** | Study / pattern score (setup clinico-strutturale) | Qualità studio; soglia Soft BUY |
| **P(plan)** / recovery % | Prob. che il piano di gain/recovery tenga | Soft BUY ≥50; Soft SELL se &lt;50 con perdita |
| **P(cont)** | Tra analoghi con stesso regime di **10d %**, quanto spesso la corsa ha tenuto (~5g) invece di cedere ≥5% | Filtro qualità BUY se già corso; take-profit SELL se edge&gt;0 |
| **10d % (g10)** | Variazione ~10 sessioni | Regime: &lt;0 declining · 0–5% weak run · ≥5% sell/cont regime |
| **edge** | P(esaurimento) − base bucket | &gt;0 = corsa più esausta degli analoghi → no Soft BUY; sì Soft SELL take-profit |
| **pct Own / pct Pop** | Percentile della corsa su curva Own/Pop | Posizione sulla mezza campana; edge usa densità in-regime |
| **Top2** | Verdetto modello ingresso/uscita | Off-book: yes=entra, NO blocca G1 (WAIT ok). On-book: yes=esci |
| **Precat** | Segnale pre-catalizzatore | `sell` blocca Soft BUY |
| **Risk v2** | Rischio perdita posizione | Soft SELL se ≥40 con MTM≤−2.5% |
| **Reg** | Regulatory risk | Soft SELL se ≥45 con MTM≤−2.5% |
| **EIS** | Event / news score | Evidence studio (G1c / strict); non arbiter Soft G1 |
| **MCS** | Market context | Framing mercato; non gate Soft BUY |
| **β** | Beta vs mercato | Post-gate: demote se &gt;2.0 |
| **Liq FY** | Liquidità | Post-gate: demote se &lt;0.25 |
| **Momentum pesato** | 24h/7g/3M/6M | Post-gate: demote se score &lt;−4 |
| **Composite 0–100** | Mix per zona CD | Ranking / REVIEW borderline — **non** sovrascrive Soft/Urgent |
| **MTM %** | P&amp;L totale posizione | Soft/deep SELL; mai SELL se MTM&gt;0 salvo continuation |
| **Δ day %** | Var. giornaliera | G2 budget; ↑≥2 sessioni Soft BUY; no SELL hard su giorno verde |

**Nota UI Evaluation:** il **“P xx%”** accanto a BUY/HOLD/UNCERTAIN è **P(plan)**. L’onda / chip wind è **P(cont)** (o stato WEAK RUN / DECLINING).

---

## 3. Soft BUY G1 / G1w (= Suggested BUY)

### G1w vento (promuove Suggested BUY)

1. **Off-book** · non warrant · SDS ≥ 20 · P(plan) ≥ 50  
2. **10d % ≥ +5%** · **P(cont) ≥ 50%** · **edge ≤ 0**  
3. Precat ≠ sell · tape non catastrofico  
4. **Top2 / ↑2d / cooldown / β·liq·momentum**: solo **priorità** in lista (non bloccano)

### G1 classico (senza vento)

1. Off-book · non warrant · SDS ≥ 20 · P(plan) ≥ 50  
2. **Top2 ≠ NO** (WAIT ok) · **↑ ≥ 2 sessioni**  
3. Precat ≠ sell · tape ok · P(cont) gate se 10d≥5%  
4. Cooldown **5g** post-vendita (hard su G1; G1w lo supera)

Se P(plan) ≥ 50 ma Soft BUY fallisce → **HOLD** (attendi), non blanket UNCERTAIN.

### Soft BUY G1c (override studio)

SDS ≥ 40 · P(plan) ≥ 55 · forward ≥ 3% · ↑ ≥ 2d · stesso filtro P(cont) → può superare Top2 NO / precat avoid (β hard block a 3.0).

### Path legacy (secondari)

Strict Top2 yes + ENTER + P(plan) ≥ 60 + evidence SDS/EIS; altri path in `qualifiesStrictOpportunityBuy`.

### Post-promotion quality gates → REVIEW (non inventano SELL)

| Gate | Rule |
|------|------|
| Weighted price momentum | 24h **35** · 7g **30** · 3M **20** · 6M **15** (renormalize if missing). Demote if score &lt; **−4**. No horizons → neutral. |
| Beta | Demote if β &gt; **2.0** |
| Liquidity FY | Demote if score 0–1 &lt; **0.25** |

---

## 4. Perché ciascun gate di entrata (intent)

| Gate | Perché selezionato |
|------|-------------------|
| **SDS ≥ 20** | Evita BUY su setup clinici deboli; 20 = trial “volume” (era 25) dopo sweep what-if |
| **P(plan) ≥ 50** | Senza tesi di piano ≥ coin-flip non promuovere ingresso |
| **Top2 ≠ NO** | Rispetta veto modello ingresso; WAIT non è veto (lascia volume) |
| **↑ ≥ 2 sessioni** | Qualità timing: non Soft BUY su nastro rosso / rimbalzo 1 giorno; su G1 sostituisce l’obbligo forward ≥ 3% |
| **No warrant** | Warrant = leva/illiquidità — fuori volume Soft |
| **Precat ≠ sell** | Non entrare contro segnale pre-CD di uscita |
| **Tape non catastrofico** | Evita chase su crash day |
| **P(cont)/edge se 10d ≥ 5%** | Se già corso, non Soft BUY su esaurimento (stesso segnale del take-profit SELL) |
| **WEAK RUN: P(cont) off** | Sotto +5% P(cont) non è in regime sell scoring — non promuove né blocca |
| **Cooldown 5g** | Evita churn sell → Suggested BUY sullo stesso nome |
| **G1c più stretto** | Solo studi forti possono forzare contro Top2 NO |
| **Post-gate β/liq/momentum** | Demote a REVIEW, non inventano SELL |

---

## 5. SELL — ordine Suggested SELL

**G2 → Soft G1 → continuation exhaustion → hard exit**

### Urgent SELL G2 (auto, book-wide)

- Trigger: `|perdite day €| > 20% × vincite day €` (`URGENT_SELL_G2_MAX_LOSS_OF_WINS = 0.2`)
- Taglia i peggiori % day finché il budget regge
- Tie-break cont: declining → weak run (not-in-regime) → exhaustion edge
- Recovery **non** blocca G2
- UI notifica **solo** i ticker venduti

### Soft SELL G1 (consiglio; G2 è l’auto hard)

- MTM ≤ **−12%** → SELL (deep; recovery **e giorno verde** non bloccano)
- MTM ≤ **−2.5%** + (riskV2 ≥ 40 **o** reg ≥ 45 **o** P(plan) &lt; 50 **o** g10 declining / weak run / edge &gt; 0) — **bloccato se sessione verde**
- MTM ≤ **−6%** se risk/reg/P tutti assenti (orphan enhance)

### Continuation take-profit (unico SELL su MTM &gt; 0)

MTM &gt; 0 · 10d % ≥ +5% · **edge &gt; 0**

### Hard / Top2 exit

Uscita residua slope/Top2 dopo i soft; priorità più bassa.

**Mai SELL** se MTM &gt; 0 salvo continuation.  
**Mai SELL hard** se giorno sessione verde (salvo regole continuation dedicate).

### Recovery HOLD

P(recovery) alta + curva che copre → può tenere contro Soft SELL (non contro G2 / deep −12%).  
Su libro rosso, recovery **indebolita** se g10 declining / out-of-regime / edge &gt; 0.

---

## 6. Cosa NON è BUY / SELL

| Segnale UI | Ruolo |
|------------|--------|
| Fulmine **Strong** what-if 24h | Path giornata forte — KPI capture, non Soft BUY |
| Cutoff SDS×P sweep | What-if capture; pills operative = Soft BUY G1 |
| Onda / chip P(cont) | Continuazione; non arbiter da solo |
| Composite score | Ranking / confidence — non sovrascrive Soft/Urgent |

---

## 7. File da aprire

| File | Contenuto |
|------|-----------|
| `desktop-ui/RECOMMENDATION_LOGIC.md` | Source of truth |
| `desktop-ui/src/sheet/investDecisionSimLoop.ts` | `deriveSuggestedAction`, Soft BUY wiring |
| `desktop-ui/src/sheet/softSignalGrades.ts` | Soglie Soft / Urgent G2 |
| `desktop-ui/src/sheet/continuationScore.ts` | P(cont), edge, `softBuyContinuationAllows` |
| `desktop-ui/src/sheet/operationalRecommendation.ts` | Near-miss Home (`pcont`, rising, top2, …) |
| `desktop-ui/src/sheet/recommendationCompositionGuide.ts` | Testo Prediction / composition |
| `desktop-ui/src/sheet/decisionChartLogic.ts` | Score-only Soft BUY (`risingStreakOk`, `continuationOk`) |
| `.cursor/rules/recommendation-logic.mdc` | Brief agent Cursor |

---

## 8. Domande per rafforzare la logica

1. Soft BUY è troppo largo? Alzare SDS/P, o rendere P(cont) attivo anche sotto +5% (es. promuovere solo se onda ≥ 55 e ↑ ≥ 2d)?
2. WEAK RUN con P(cont) alto oggi è “buona opportunità a occhio” ma non BUY — serve un path **Soft BUY early** esplicito?
3. Soft SELL −2.5% è troppo aggressivo vs rumore biotech?
4. G2 al 20% delle vincite day: calibrazione storica win/loss del book?
5. Allineare what-if Strong a un sottoinsieme Soft BUY per non confondere i tester?
6. Coerenza Evaluation badge Soft BUY G1 vs Home `ops.buys` sui near-miss (rising / Top2 / pcont).
7. Forward ≥ 3% va reintrodotto su G1 volume, o resta solo su G1c?

---

## 9. Esempio mentale (Evaluation)

- **NRIX** Soft BUY G1 · P(plan) 69% · P(cont) ~63% → passa i gate.  
- **CCCC** HOLD · P(plan) 64% · stessa onda ~63% → ha P(plan) ≥ 50 ma manca un altro gate Soft BUY (tipicamente SDS / Top2 / ↑ ≥ 2d), **non** il solo P(cont).  
- **VIR** HOLD · WEAK RUN · P(plan) ~52% → sotto regime 10d; P(cont) non decide.  
- **JSPR** HOLD · DECLINING → non setup Soft BUY; lato sell se in book con perdita.

---

*Fine handoff. Aggiornare questo file se cambiano soglie Soft/Urgent o il filtro P(cont).*
