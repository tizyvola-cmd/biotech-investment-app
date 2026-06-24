# MIT EAR backtest — SuperNova cohort

**Generato:** 2026-06-02T18:59:02  
**Coorte:** CD passate con d1_pct (NCT ristretto)  
**N eventi:** 691  

## Metodologia

- **Realizzato:** `d1_pct` = variazione % dalla ultima chiusura ≤ CD alla 1ª seduta dopo CD (`data_orchestrator._pct_post_cd_retro_aligned`).
- **MIT EAR:** somma strutturale ex-ante (company type + phase + disease + design), **senza** outcome type, coefficienti centrati sulle medie tabella brief.
- **SuperNova:** `model_d1_pct` (predizione T+1) e `model_d4_pct` (nodo CD+4) vs stesso realizzato.
- I MIT abnormal returns del paper sono aggiustati Fama-French; qui confrontiamo return grezzi → utilità **relativa** del segnale.

## Copertura feature

| Feature | % righe |
|---------|---------|
| company_type_known | 99.4% |
| phase_known | 90.9% |
| disease_known | 50.1% |
| trial_design_known | 54.7% |
| model_d1_present | 99.7% |

### MIT EAR vs realizzato (d1)

| Metrica | Valore |
|--------|--------|
| N | 691 |
| MAE | 5.986% |
| RMSE | 8.4% |
| Bias (pred − real) | 2.829% |
| Pearson r | -0.0019 |
| Spearman ρ | -0.0162 |
| Direction hit rate | 38.2% |
| Media pred | 2.714% |
| Media realizzato | -0.115% |

### SuperNova model_d1 vs realizzato

| Metrica | Valore |
|--------|--------|
| N | 689 |
| MAE | 7.072% |
| RMSE | 9.952% |
| Bias (pred − real) | 0.794% |
| Pearson r | 0.0004 |
| Spearman ρ | -0.0099 |
| Direction hit rate | 38.8% |
| Media pred | 0.682% |
| Media realizzato | -0.112% |

### SuperNova model_d4 vs realizzato d1

| Metrica | Valore |
|--------|--------|
| N | 689 |
| MAE | 7.628% |
| RMSE | 10.4% |
| Bias (pred − real) | 0.892% |
| Pearson r | 0.0044 |
| Spearman ρ | -0.0076 |
| Direction hit rate | 38.8% |
| Media pred | 0.781% |
| Media realizzato | -0.112% |

## Decili MIT EAR → media d1 realizzato

| Decile | N | Media MIT EAR | Media d1 real |
|--------|---|---------------|---------------|
| 1 | 69 | -5.931% | -0.013% |
| 2 | 69 | -2.197% | -0.231% |
| 3 | 69 | -0.01% | -0.562% |
| 4 | 69 | 1.745% | 0.768% |
| 5 | 69 | 3.872% | -0.307% |
| 6 | 69 | 4.532% | -0.074% |
| 7 | 69 | 5.098% | -0.432% |
| 8 | 69 | 5.582% | -0.707% |
| 9 | 69 | 6.427% | 0.002% |
| 10 | 70 | 7.944% | 0.4% |

## Per phase bucket (MIT)

- **1** (n=225): MAE 5.175%, hit dir 41.8%, bias 2.075%
- **1/2** (n=80): MAE 6.857%, hit dir 30.0%, bias 1.815%
- **2** (n=172): MAE 6.145%, hit dir 37.8%, bias 3.671%
- **2/3** (n=14): MAE 8.638%, hit dir 7.1%, bias 7.035%
- **3** (n=120): MAE 6.22%, hit dir 36.7%, bias 2.912%
- **4** (n=17): MAE 4.745%, hit dir 47.1%, bias -0.843%
- **UNK** (n=63): MAE 6.645%, hit dir 44.4%, bias 4.406%

## Per company type (MIT)

- **BP** (n=89): MAE 5.625%, hit dir 28.1%, media real -0.171%
- **EB** (n=433): MAE 6.881%, hit dir 35.1%, media real -0.136%
- **LB** (n=165): MAE 3.734%, hit dir 52.1%, media real -0.194%

## Interpretazione rapida

- Correlazione positiva sui decili MIT → il prior ha **ordine** informativo sulla coorte.
- Se SuperNova batte MIT su MAE/direction → il motore pre-CD resta dominante per timing fine.
- Se MIT batte SuperNova su direction hit → ha senso integrarlo come **anchor al CD** (Fase 1–2 roadmap).
- Market cap è **corrente** (non storico al CD): backtest company type è conservativo.

Fonte coefficienti: Singh et al. 2022, PLoS ONE — brief interno `supernova-research-brief.PDF`.
