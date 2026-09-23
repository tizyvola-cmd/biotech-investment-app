# EIS Auto Feed Audit Report

Generated: 2026-08-31T15:14:22.730Z

## Summary

- Snapshot: `C:\coding\Biotech_Investment app 6\data\clinical_pre_cd_enrichment_snapshot.json`
- Auto events scanned: **904**
- Flagged rows (|EIS|≥1 or any anomaly): **506**
- Score drift (≥0.2): **272**
- Feed-untrusted with |EIS|≥1: **1**
- Semantic mismatch: **12**

### Flag counts

| Flag | Count |
|------|-------|
| score_drift | 272 |
| price_down_eis_positive | 26 |
| eis_without_price | 26 |
| kpi_positive_eis_negative | 11 |
| price_up_eis_negative | 7 |
| untrusted_sponsor_scored | 5 |
| text_positive_eis_negative | 1 |
| text_negative_eis_positive | 1 |
| feed_untrusted | 1 |

## Top anomalies (by severity)

### CRDL — 2026-04-05 (severity 9)

- **Title:** FDA Orphan Drug Designation maintained for CardiolRx in recurrent pericarditis
- **Stored / recomputed EIS:** -2.37 / -2 (Δ 0.37)
- **ΔP1d:** -1.42 | KPI: 1.138 | Feed trusted: true
- **Flags:** score_drift, text_positive_eis_negative, kpi_positive_eis_negative
- **Action:** re-enrich or trust recomputed EIS on next refresh

### VNDA — 2026-10-01 (severity 6)

- **Title:** Tradipitant NDA status for gastroparesis — potential FDA correspondence (historical context)
- **Stored / recomputed EIS:** 1.22 / 1.45 (Δ 0.23)
- **ΔP1d:** — | KPI: 0.812 | Feed trusted: true
- **Flags:** score_drift, text_negative_eis_positive
- **Action:** re-enrich or trust recomputed EIS on next refresh

### MLTX — 2026-08-10 (severity 6)

- **Title:** Results of operations (earnings) · Regulation FD disclosure
- **Stored / recomputed EIS:** 2.73 / 7.23 (Δ 4.5)
- **ΔP1d:** -5.09 | KPI: 1.654 | Feed trusted: true
- **Flags:** score_drift, price_down_eis_positive
- **Action:** re-enrich or trust recomputed EIS on next refresh

### PODD — 2026-08-05 (severity 6)

- **Title:** Results of operations (earnings)
- **Stored / recomputed EIS:** -3.15 / 2.1 (Δ 5.25)
- **ΔP1d:** -20.12 | KPI: 1.412 | Feed trusted: true
- **Flags:** score_drift, price_down_eis_positive
- **Action:** re-enrich or trust recomputed EIS on next refresh

### CERS — 2026-07-30 (severity 6)

- **Title:** Results of operations (earnings)
- **Stored / recomputed EIS:** -9.3 / -7.62 (Δ 1.68)
- **ΔP1d:** 0.7 | KPI: 1.064 | Feed trusted: true
- **Flags:** score_drift, kpi_positive_eis_negative
- **Action:** re-enrich or trust recomputed EIS on next refresh

### NSPR — 2026-07-29 (severity 6)

- **Title:** Officer/director departure or appointment
- **Stored / recomputed EIS:** -3.77 / -1.36 (Δ 2.41)
- **ΔP1d:** -1.47 | KPI: 1.539 | Feed trusted: true
- **Flags:** score_drift, kpi_positive_eis_negative
- **Action:** re-enrich or trust recomputed EIS on next refresh

### CCCC — 2026-06-15 (severity 6)

- **Title:** Preventive effects of dexamethasone oral solution on radiation-induced mucositis in patients with head and neck cancer: 
- **Stored / recomputed EIS:** -1.94 / -1.95 (Δ -0.01)
- **ΔP1d:** -2.05 | KPI: -0.01 | Feed trusted: false
- **Flags:** feed_untrusted, untrusted_sponsor_scored
- **Action:** exclude from ticker EIS aggregate until sponsor/reference fixed

### CHRS — 2026-06-01 (severity 6)

- **Title:** SEC 8-K filing
- **Stored / recomputed EIS:** -4.21 / -1.57 (Δ 2.64)
- **ΔP1d:** -1.26 | KPI: 1.548 | Feed trusted: true
- **Flags:** score_drift, kpi_positive_eis_negative
- **Action:** re-enrich or trust recomputed EIS on next refresh

### PODD — 2026-05-26 (severity 6)

- **Title:** Regulation FD disclosure
- **Stored / recomputed EIS:** -3.3 / -1.05 (Δ 2.25)
- **ΔP1d:** -0.69 | KPI: 1.412 | Feed trusted: true
- **Flags:** score_drift, kpi_positive_eis_negative
- **Action:** re-enrich or trust recomputed EIS on next refresh

### JSPR — 2026-05-14 (severity 6)

- **Title:** Results of operations (earnings)
- **Stored / recomputed EIS:** -3.17 / -4.61 (Δ -1.44)
- **ΔP1d:** 4.24 | KPI: -0.021 | Feed trusted: true
- **Flags:** score_drift, price_up_eis_negative
- **Action:** re-enrich or trust recomputed EIS on next refresh

### PODD — 2026-05-06 (severity 6)

- **Title:** Results of operations (earnings)
- **Stored / recomputed EIS:** 0.42 / 5.67 (Δ 5.25)
- **ΔP1d:** -9.7 | KPI: 1.412 | Feed trusted: true
- **Flags:** score_drift, price_down_eis_positive
- **Action:** re-enrich or trust recomputed EIS on next refresh

### INSP — 2026-05-05 (severity 6)

- **Title:** Officer/director departure or appointment · Amendment to articles
- **Stored / recomputed EIS:** -0.39 / 3.04 (Δ 3.43)
- **ΔP1d:** -12.02 | KPI: 1.021 | Feed trusted: true
- **Flags:** score_drift, price_down_eis_positive
- **Action:** re-enrich or trust recomputed EIS on next refresh

### PODD — 2026-04-29 (severity 6)

- **Title:** Regulation FD disclosure
- **Stored / recomputed EIS:** 2.42 / 7.67 (Δ 5.25)
- **ΔP1d:** -12.5 | KPI: 1.412 | Feed trusted: true
- **Flags:** score_drift, price_down_eis_positive
- **Action:** re-enrich or trust recomputed EIS on next refresh

### PLSE — 2026-04-27 (severity 6)

- **Title:** Regulation FD disclosure
- **Stored / recomputed EIS:** -4.76 / -2.07 (Δ 2.69)
- **ΔP1d:** -1.61 | KPI: 1.51 | Feed trusted: true
- **Flags:** score_drift, kpi_positive_eis_negative
- **Action:** re-enrich or trust recomputed EIS on next refresh

### CCCC — 2026-04-09 (severity 6)

- **Title:** Material definitive agreement · Regulation FD disclosure
- **Stored / recomputed EIS:** 15.85 / 15.83 (Δ -0.02)
- **ΔP1d:** -2.41 | KPI: -0.01 | Feed trusted: true
- **Flags:** untrusted_sponsor_scored, price_down_eis_positive
- **Action:** exclude from ticker EIS aggregate until sponsor/reference fixed

### BIIB — 2026-04-06 (severity 6)

- **Title:** Results of operations (earnings)
- **Stored / recomputed EIS:** 2.68 / 5.53 (Δ 2.85)
- **ΔP1d:** -2.82 | KPI: 1.409 | Feed trusted: true
- **Flags:** score_drift, price_down_eis_positive
- **Action:** re-enrich or trust recomputed EIS on next refresh

### MLTX — 2026-04-01 (severity 6)

- **Title:** MoonLake Q4/FY2025 financial results and clinical pipeline update
- **Stored / recomputed EIS:** 2.96 / 3.55 (Δ 0.59)
- **ΔP1d:** -11.37 | KPI: 0.906 | Feed trusted: true
- **Flags:** score_drift, price_down_eis_positive
- **Action:** re-enrich or trust recomputed EIS on next refresh

### BIIB — 2026-03-31 (severity 6)

- **Title:** Material definitive agreement · Other material events (press release)
- **Stored / recomputed EIS:** 3.06 / 5.91 (Δ 2.85)
- **ΔP1d:** -2.26 | KPI: 1.409 | Feed trusted: true
- **Flags:** score_drift, price_down_eis_positive
- **Action:** re-enrich or trust recomputed EIS on next refresh

### BIIB — 2026-03-31 (severity 6)

- **Title:** Biogen Q1 2026 pipeline update — litifilimab Phase 3 SLE readout anticipated H2 2026
- **Stored / recomputed EIS:** 5.34 / 6.06 (Δ 0.72)
- **ΔP1d:** -2.26 | KPI: 1.823 | Feed trusted: true
- **Flags:** score_drift, price_down_eis_positive
- **Action:** re-enrich or trust recomputed EIS on next refresh

### TELA — 2026-03-24 (severity 6)

- **Title:** Results of operations (earnings) · Regulation FD disclosure
- **Stored / recomputed EIS:** 2.65 / 5.51 (Δ 2.86)
- **ΔP1d:** -8.31 | KPI: -0.035 | Feed trusted: true
- **Flags:** score_drift, price_down_eis_positive
- **Action:** re-enrich or trust recomputed EIS on next refresh

### RYTM — 2026-03-20 (severity 6)

- **Title:** Regulation FD disclosure · Other material events (press release)
- **Stored / recomputed EIS:** 3.11 / 5.25 (Δ 2.14)
- **ΔP1d:** -3.17 | KPI: 0.39 | Feed trusted: true
- **Flags:** score_drift, price_down_eis_positive
- **Action:** re-enrich or trust recomputed EIS on next refresh

### OLMA — 2026-03-09 (severity 6)

- **Title:** Olema Pharmaceuticals (OLMA) Stock Plummets 41% on Roche Trial Disappointment - Blockonomi
- **Stored / recomputed EIS:** 8.34 / 9.7 (Δ 1.36)
- **ΔP1d:** -25.75 | KPI: 0.399 | Feed trusted: true
- **Flags:** score_drift, price_down_eis_positive
- **Action:** re-enrich or trust recomputed EIS on next refresh

### CERS — 2026-03-02 (severity 6)

- **Title:** Results of operations (earnings)
- **Stored / recomputed EIS:** -3.41 / -1.74 (Δ 1.67)
- **ΔP1d:** -1.17 | KPI: 1.064 | Feed trusted: true
- **Flags:** score_drift, kpi_positive_eis_negative
- **Action:** re-enrich or trust recomputed EIS on next refresh

### INBS — 2026-02-25 (severity 6)

- **Title:** Regulation FD disclosure
- **Stored / recomputed EIS:** 7.56 / 9 (Δ 1.44)
- **ΔP1d:** -4.35 | KPI: -0.032 | Feed trusted: true
- **Flags:** score_drift, price_down_eis_positive
- **Action:** re-enrich or trust recomputed EIS on next refresh

### PLSE — 2026-02-19 (severity 6)

- **Title:** Results of operations (earnings)
- **Stored / recomputed EIS:** -7.55 / -4.86 (Δ 2.69)
- **ΔP1d:** -1.49 | KPI: 1.51 | Feed trusted: true
- **Flags:** score_drift, kpi_positive_eis_negative
- **Action:** re-enrich or trust recomputed EIS on next refresh

### PLSE — 2026-02-19 (severity 6)

- **Title:** Material definitive agreement · Termination of material agreement
- **Stored / recomputed EIS:** -7.55 / -4.86 (Δ 2.69)
- **ΔP1d:** -1.49 | KPI: 1.51 | Feed trusted: true
- **Flags:** score_drift, kpi_positive_eis_negative
- **Action:** re-enrich or trust recomputed EIS on next refresh

### BIIB — 2026-09-01 (severity 5)

- **Title:** Litifilimab Phase 3 SLE data presentation anticipated at ACR Convergence 2026
- **Stored / recomputed EIS:** 2.61 / 3 (Δ 0.39)
- **ΔP1d:** — | KPI: 1.737 | Feed trusted: true
- **Flags:** score_drift, eis_without_price
- **Action:** re-enrich or trust recomputed EIS on next refresh

### SRPT — 2026-08-05 (severity 5)

- **Title:** Sarepta Q2 2026 earnings: pipeline and commercial update
- **Stored / recomputed EIS:** -0.62 / 1.21 (Δ 1.83)
- **ΔP1d:** -2.81 | KPI: 0.968 | Feed trusted: true
- **Flags:** score_drift, price_down_eis_positive
- **Action:** re-enrich or trust recomputed EIS on next refresh

### SRPT — 2026-08-05 (severity 5)

- **Title:** Results of operations (earnings)
- **Stored / recomputed EIS:** -0.62 / 1.21 (Δ 1.83)
- **ΔP1d:** -2.81 | KPI: 0.968 | Feed trusted: true
- **Flags:** score_drift, price_down_eis_positive
- **Action:** re-enrich or trust recomputed EIS on next refresh

### INBS — 2026-07-21 (severity 5)

- **Title:** Regulation FD disclosure
- **Stored / recomputed EIS:** 1.35 / 2.78 (Δ 1.43)
- **ΔP1d:** -8.12 | KPI: -0.032 | Feed trusted: true
- **Flags:** score_drift, price_down_eis_positive
- **Action:** re-enrich or trust recomputed EIS on next refresh

### BIIB — 2026-06-10 (severity 5)

- **Title:** SEC 8-K filing
- **Stored / recomputed EIS:** -1.33 / 1.52 (Δ 2.85)
- **ΔP1d:** -2.44 | KPI: 1.409 | Feed trusted: true
- **Flags:** score_drift, price_down_eis_positive
- **Action:** re-enrich or trust recomputed EIS on next refresh

### VIR — 2026-06-10 (severity 5)

- **Title:** Officer/director departure or appointment
- **Stored / recomputed EIS:** -1.95 / 1.49 (Δ 3.44)
- **ΔP1d:** -3.06 | KPI: 1.042 | Feed trusted: true
- **Flags:** score_drift, price_down_eis_positive
- **Action:** re-enrich or trust recomputed EIS on next refresh

### BJDX — 2026-06-08 (severity 5)

- **Title:** Material definitive agreement · Other material events (press release)
- **Stored / recomputed EIS:** -0.41 / -1.93 (Δ -1.52)
- **ΔP1d:** 8.96 | KPI: -0.008 | Feed trusted: true
- **Flags:** score_drift, price_up_eis_negative
- **Action:** re-enrich or trust recomputed EIS on next refresh

### BIIB — 2026-05-14 (severity 5)

- **Title:** Material definitive agreement · Acquisition / disposal of assets · Creation of direct financial obligation · Regulation 
- **Stored / recomputed EIS:** -2.08 / 2.27 (Δ 4.35)
- **ΔP1d:** -6.43 | KPI: 1.409 | Feed trusted: true
- **Flags:** score_drift, price_down_eis_positive
- **Action:** re-enrich or trust recomputed EIS on next refresh

### OLMA — 2026-05-12 (severity 5)

- **Title:** Results of operations (earnings)
- **Stored / recomputed EIS:** -0.11 / 2.75 (Δ 2.86)
- **ΔP1d:** -5.99 | KPI: 0.399 | Feed trusted: true
- **Flags:** score_drift, price_down_eis_positive
- **Action:** re-enrich or trust recomputed EIS on next refresh

### INSP — 2026-05-01 (severity 5)

- **Title:** SLEEP 2026 / ESRS — Anticipated Inspire UAS Data Presentations (Estimated)
- **Stored / recomputed EIS:** -2.34 / -1.82 (Δ 0.52)
- **ΔP1d:** 1 | KPI: 1.099 | Feed trusted: true
- **Flags:** score_drift, kpi_positive_eis_negative
- **Action:** re-enrich or trust recomputed EIS on next refresh

### ISRG — 2026-04-21 (severity 5)

- **Title:** Results of operations (earnings)
- **Stored / recomputed EIS:** 1.19 / 2.67 (Δ 1.48)
- **ΔP1d:** -3.07 | KPI: -0.01 | Feed trusted: true
- **Flags:** score_drift, price_down_eis_positive
- **Action:** re-enrich or trust recomputed EIS on next refresh

### CCCC — 2026-04-10 (severity 5)

- **Title:** Amendment to articles
- **Stored / recomputed EIS:** -5.32 / -3.83 (Δ 1.49)
- **ΔP1d:** -10.42 | KPI: -0.01 | Feed trusted: true
- **Flags:** score_drift, untrusted_sponsor_scored
- **Action:** re-enrich or trust recomputed EIS on next refresh

### TELA — 2026-04-01 (severity 5)

- **Title:** Potential OviTex PRS data presentation at ASPS or ASRM spring 2026 meetings
- **Stored / recomputed EIS:** 1.64 / 1.38 (Δ -0.26)
- **ΔP1d:** -8.23 | KPI: -0.03 | Feed trusted: true
- **Flags:** score_drift, price_down_eis_positive
- **Action:** re-enrich or trust recomputed EIS on next refresh

### NSPR — 2026-11-20 (severity 4)

- **Title:** NCT06653387 CGuard Prime 80cm pivotal study primary completion date
- **Stored / recomputed EIS:** 2.19 / 2.4 (Δ 0.21)
- **ΔP1d:** — | KPI: 1.463 | Feed trusted: true
- **Flags:** score_drift, eis_without_price
- **Action:** re-enrich or trust recomputed EIS on next refresh

## Next steps

1. Fix enrichment rules for recurring semantic flags (see `autoFeedSemanticAudit.ts`).
2. Re-run clinical refresh for tickers with `score_drift` after formula changes.
3. Exclude `feed_untrusted` events from ticker EIS aggregate until reference fixed.
4. Re-run: `cd desktop-ui && npx tsx scripts/audit-eis-auto-feed.ts`
