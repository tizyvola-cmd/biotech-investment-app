# MIT EAR backtest — SuperNova cohort

**Generato:** 2026-06-02T18:59:47  
**Coorte:** CD passate con d1_pct  
**N eventi:** 5359  

## Metodologia

- **Realizzato:** `d1_pct` = variazione % dalla ultima chiusura ≤ CD alla 1ª seduta dopo CD (`data_orchestrator._pct_post_cd_retro_aligned`).
- **MIT EAR:** somma strutturale ex-ante (company type + phase + disease + design), **senza** outcome type, coefficienti centrati sulle medie tabella brief.
- **SuperNova:** `model_d1_pct` (predizione T+1) e `model_d4_pct` (nodo CD+4) vs stesso realizzato.
- I MIT abnormal returns del paper sono aggiustati Fama-French; qui confrontiamo return grezzi → utilità **relativa** del segnale.

## Copertura feature

| Feature | % righe |
|---------|---------|
| company_type_known | 67.8% |
| phase_known | 80.1% |
| disease_known | 52.0% |
| trial_design_known | 43.2% |
| model_d1_present | 99.6% |

### MIT EAR vs realizzato (d1)

| Metrica | Valore |
|--------|--------|
| N | 5359 |
| MAE | 4.593% |
| RMSE | 9.267% |
| Bias (pred − real) | 2.169% |
| Pearson r | -0.0019 |
| Spearman ρ | -0.0511 |
| Direction hit rate | 45.9% |
| Media pred | 2.286% |
| Media realizzato | 0.117% |

### MIT EAR vs realizzato (d3)

| Metrica | Valore |
|--------|--------|
| N | 5357 |
| MAE | 6.055% |
| RMSE | 10.415% |
| Bias (pred − real) | 2.033% |
| Pearson r | -0.0137 |
| Spearman ρ | -0.0518 |
| Direction hit rate | 48.1% |
| Media pred | 2.286% |
| Media realizzato | 0.253% |

### SuperNova model_d1 vs realizzato

| Metrica | Valore |
|--------|--------|
| N | 5338 |
| MAE | 5.234% |
| RMSE | 10.223% |
| Bias (pred − real) | 0.529% |
| Pearson r | 0.0024 |
| Spearman ρ | -0.0118 |
| Direction hit rate | 47.0% |
| Media pred | 0.645% |
| Media realizzato | 0.115% |

### SuperNova model_d4 vs realizzato d1

| Metrica | Valore |
|--------|--------|
| N | 5338 |
| MAE | 5.706% |
| RMSE | 10.609% |
| Bias (pred − real) | 0.594% |
| Pearson r | -0.0052 |
| Spearman ρ | -0.0139 |
| Direction hit rate | 44.1% |
| Media pred | 0.71% |
| Media realizzato | 0.115% |

## Decili MIT EAR → media d1 realizzato

| Decile | N | Media MIT EAR | Media d1 real |
|--------|---|---------------|---------------|
| 1 | 535 | -4.514% | 0.292% |
| 2 | 535 | -1.014% | 0.254% |
| 3 | 535 | -0.261% | 0.086% |
| 4 | 535 | 0.2% | -0.016% |
| 5 | 535 | 1.134% | -0.107% |
| 6 | 535 | 3.338% | -0.2% |
| 7 | 535 | 4.675% | -0.231% |
| 8 | 535 | 5.371% | 1.149% |
| 9 | 535 | 6.176% | 0.024% |
| 10 | 544 | 7.667% | -0.078% |

## Per phase bucket (MIT)

- **1** (n=1134): MAE 4.4%, hit dir 46.9%, bias 1.608%
- **1/2** (n=379): MAE 4.726%, hit dir 31.4%, bias 0.739%
- **2** (n=1378): MAE 4.593%, hit dir 50.2%, bias 2.548%
- **2/3** (n=126): MAE 5.935%, hit dir 27.8%, bias 4.797%
- **3** (n=1107): MAE 5.291%, hit dir 34.2%, bias 3.341%
- **4** (n=169): MAE 4.374%, hit dir 48.5%, bias 2.499%
- **UNK** (n=1066): MAE 3.904%, hit dir 58.2%, bias 1.208%

## Per company type (MIT)

- **BP** (n=409): MAE 5.7%, hit dir 28.4%, media real 0.301%
- **EB** (n=2489): MAE 7.137%, hit dir 35.1%, media real 0.128%
- **LB** (n=737): MAE 3.57%, hit dir 48.9%, media real 0.11%
- **UNK** (n=1724): MAE 1.097%, hit dir 64.3%, media real 0.06%

## Direction ensemble v4 (baseline)

- Hit rate vs **d1**: 47.7%
- Hit rate vs **d3**: 36.1%

## Conclusioni (prima iterazione)

- **Correlazione MIT ↔ realizzato quasi nulla** (Pearson -0.0019, Spearman -0.0511). I decili non ordinano monotonicamente il d1 (spread D10−D1 = -0.37% ).
- **MAE:** MIT (4.593%) leggermente migliore di SuperNova d1 (5.234%), ma MIT ha **bias positivo** (2.169%) — sovrastima sistematica del movimento.
- **Direction hit:** v4 47.7% ≈ MIT 45.9% ≈ SN d1 47.0% — nessun vantaggio netto del prior MIT su questo orizzonte.

### Perché il segnale MIT è debole qui (ipotesi)

1. **Data evento:** SuperNova ancorato al *Completion Date*; il paper MIT usa spesso la *Publish Date* (91% dei casi).
2. **Return grezzo vs abnormal:** MIT aggiusta Fama-French; `d1_pct` è variazione prezzo pura.
3. **Market cap corrente** al posto di quella storica al CD.
4. **Enrollment / design** non disponibili nel CSV clinico locale.
5. Il motore SuperNova predice la **curva pre-CD**, non l'event study day 0–1 — confronto parziale per design.

### Prossimo passo consigliato

Prima di integrare in produzione: backtest con **publish date** da CT.gov, cap storico, e confronto su **d3/d5** (finestra più vicina a come Accuracy Lab valuta v4). Se il ranking migliora sui decili, procedere con Fase 1–2.

Fonte coefficienti: Singh et al. 2022, PLoS ONE — brief interno `supernova-research-brief.PDF`.
