# EIS / Price / Volume / Liquidity — Pattern Report

_Generated: 2026-08-30 09:21 UTC_

## Data summary
- Panel rows: **520**
- Tickers: **4**

> **Disclaimer:** Patterns on 4–6 months and a handful of tickers are **hypotheses**,
> not validated signals. Past correlation does not guarantee future results.
> This is a research tool, not investment advice.

## Event study (EIS window)
- Events analyzed: **14**
- Statistically trustworthy (n≥8): **True**
- Note: Based on 14 events. Minimum event count reached — still validate on longer history.

### Pre-event abnormal return tests

| window   | eis_sign   |   n |   mean_abn_ret |    t_stat |   p_value |
|:---------|:-----------|----:|---------------:|----------:|----------:|
| pre      | positive   | 220 |    8.84601e-05 | 0.0461581 |  0.963226 |
| pre      | negative   |  60 |    0.00204458  | 0.531319  |  0.597192 |
| pre      | all        | 280 |    0.000507629 | 0.29613   |  0.767351 |

### Post-event abnormal return tests

| window   | eis_sign   |   n |   mean_abn_ret |    t_stat |   p_value |
|:---------|:-----------|----:|---------------:|----------:|----------:|
| post     | positive   | 231 |   -0.000971325 | -0.484541 | 0.628463  |
| post     | negative   |  63 |   -0.00799935  | -1.95867  | 0.0546529 |
| post     | all        | 294 |   -0.00247733  | -1.37139  | 0.171303  |

## Pre-event pattern mining
- Pre-event windows: **14**
- Control windows: **3**
- Trustworthy: **False**

- ⚠ 2 feature(s) pass p<0.05 but sample is too small — likely false discovery.

### Feature comparison (Mann-Whitney U)

| feature                         |   n_pre |   n_ctrl |      pre_mean |     ctrl_mean |   u_stat |      p_value | significant_05   |
|:--------------------------------|--------:|---------:|--------------:|--------------:|---------:|-------------:|:-----------------|
| volume_zscore_60d               |      14 |        3 |   0.392401    |  -0.283691    |       41 |   0.00588235 | True             |
| volume_zscore_20d               |      14 |        3 |   0.280341    |  -0.159957    |       37 |   0.0470588  | True             |
| volatility_20d                  |      14 |        3 |   0.024487    |   0.0281202   |       12 |   0.3        | False            |
| relative_strength_20d           |      14 |        3 |   0.051468    |   0.00408667  |       25 |   0.676471   | False            |
| return_1d                       |      14 |        3 |   0.000874258 |   0.000686702 |       20 |   0.952941   | False            |
| relative_strength_5d            |      14 |        3 |   0.00777644  |   0.00660291  |       20 |   0.952941   | False            |
| turnover_ratio                  |      14 |        3 |   0.00773219  |   0.00740997  |       22 |   0.952941   | False            |
| rolling_beta_60d                |      14 |        1 | nan           | nan           |      nan | nan          | False            |
| liquidity_current_ratio_qoq_pct |       4 |        0 | nan           | nan           |      nan | nan          | False            |

### Feature importance (random forest)

| feature                         |   importance |
|:--------------------------------|-------------:|
| volume_zscore_60d               |    0.353342  |
| volume_zscore_20d               |    0.245195  |
| volatility_20d                  |    0.105082  |
| return_1d                       |    0.0923367 |
| relative_strength_5d            |    0.0729109 |
| turnover_ratio                  |    0.0600138 |
| rolling_beta_60d                |    0.0356257 |
| relative_strength_20d           |    0.0354937 |
| liquidity_current_ratio_qoq_pct |    0         |

### Pre-event archetype clusters

- Cluster 0: 6 events
- Cluster 1: 3 events
- Cluster 2: 5 events

## Predictive model (walk-forward logistic)
- Test-set positive labels: **0**
- Trustworthy: **False**
- Note: Walk-forward logistic regression. 0 positive labels in test folds. Too few events — metrics are not reliable.

### Random baseline (same signal frequency)

- **mean_fwd_return_5d**: 0.018241916218296086
- **n_signals**: 23

## Scanner (latest day similarity to pre-event archetypes)

| ticker   | as_of               |   similarity_score |   cluster_id | note                                                                                                                           |
|:---------|:--------------------|-------------------:|-------------:|:-------------------------------------------------------------------------------------------------------------------------------|
| BIIB     | 2026-08-28 00:00:00 |             0.9658 |            1 | High similarity to pre-EIS archetype — research alert only, not a trade signal. (Pattern library not statistically validated.) |
| NRIX     | 2026-08-28 00:00:00 |             0.8315 |            0 | High similarity to pre-EIS archetype — research alert only, not a trade signal. (Pattern library not statistically validated.) |
| VRTX     | 2026-08-28 00:00:00 |             0.587  |            2 | Moderate/low similarity — no strong pre-event pattern match. (Pattern library not statistically validated.)                    |
| SRPT     | 2026-08-28 00:00:00 |            -0.7305 |            1 | Moderate/low similarity — no strong pre-event pattern match. (Pattern library not statistically validated.)                    |

## Charts
- `reports/event_study_car.png`
- `reports/pre_event_feature_comparison.png`

## Next steps
1. Export real OHLCV + EIS from SuperNova (see `SupernovaEisStubLoader` in `src/ingestion.py`).
2. Extend to 20+ tickers and 2–3 years of history.
3. Re-run pipeline; ignore patterns that do not survive larger sample.