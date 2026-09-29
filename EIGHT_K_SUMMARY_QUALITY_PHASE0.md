# PHASE 0 — Audit sola lettura: qualità summary 8-K (tab Financial)

**Data:** 2026-09-19  
**Fonte cache:** VPS `data/ticker_8k_dossier_cache.json` (mtime server ~2026-09-18; 29 ticker, **56 filing**)  
**Nessuna modifica al codice.** Artefatti grezzi: `_tmp_8k_phase0_audit.json`, `_tmp_8k_gemini_samples.md`

---

## A — Genericità dei summary

### A1 — 15 filing Gemini recenti (summary grezzi)

Vedi sezione completa in fondo (§ Samples) o `_tmp_8k_gemini_samples.md`.

**Impressioni rapide (per giudizio umano):**
- Molti summary Gemini sono **già specifici** (date, $, Phase, nomi prodotto) — es. BBNX Mint FDA, BTAI DIP $77.25M, BHVN Kv7 $400M upfront.
- Esempi **vaghi / sintomo A–B**:
  - **ALMS 2026-09-01** Item 8.01: dice che ha rilasciato topline Phase 2b SLE ma **zero numeri/endpoint** nel summary.
  - **CADL 2026-09-09** Item 7.01: solo “updated corporate presentation… pipeline strategies”.
  - **CRVO 2026-09-10** Item 7.01: presentation on website — generico; Item 8.01 invece ha data congresso concreta.
  - **CHRS 2026-08-28** ATM: ha $50M (ok) ma title taxonomy dice “Shelf registration” mentre session è ATM.

### A2 — Vincolo numerico nel prompt Gemini?

**No — non c’è un hard requirement “almeno un dato numerico”.**

System (`ticker_8k_dossier._SYSTEM_8K`):

> “…conceptual summary of the MESSAGE…: **product, action, numbers, dates**. Max 50 English words. Do not copy the first sentences. Skip signature legalese…”

User prompt: JSON `{item, title, summary:"max 50 words"}` — **nessuna** regola tipo “MUST include $ / % / date / NCT when present in source”.

Quindi: soft hint (“numbers, dates”) + ≤50 parole + no legalese. La specificità è opzionale → spiega ALMS-style “topline released” senza cifre.

Heuristic post-hoc sui 71 session Gemini in cache: **~83%** contengono almeno un segnale numerico/data/Phase/NCT (regex grezza) — quindi Gemini spesso li mette, ma **non è imposto** e i casi vaghi restano legali rispetto al prompt.

### A3 — Gemini vs fallback extractive

| digest_method | n filing | % |
|---|---:|---:|
| `gemini` | 38 | **67.9%** |
| `sec_8k_items` (extractive / non-Gemini) | 18 | **32.1%** |

**~1 filing su 3** non ha Gemini. Non è dominante, ma **non è raro** — fallback silenzioso rilevante.  
Nota: in `daily_news_desk` il brief interno può settare `digest_method: "sec_8k_gemini"`; nel dossier UI/cache il valore salvato è `"gemini"` quando vincono `gemini_sessions`.

---

## B — Dati mancanti dal PR (Ex-99)

### B4 — Quanti Item 2.02/7.01/8.01/5.02 hanno Ex-99 scaricato?

**Non misurabile dalla cache.**  
Il dossier salva solo `sessions[]`, score, `link`, `items_raw` — **non** salva testo primary/exhibit né flag `exhibit_fetched`.

Conteggi Item (presence in `items_raw` / sessions) sulla cache:

| Item | filing che lo contengono |
|---|---:|
| 2.02 | 23 |
| 7.01 | 16 |
| 8.01 | 9 |
| 5.02 | 6 |
| **Qualsiasi dei 4** | **45 / 56** filing |

Per misurare Ex-99 servirebbe re-fetch EDGAR o loggare in cache `exhibit_names` / `bundle_chars_primary` / `bundle_chars_exhibit`.

### B5 — Keyword che skippano l’exhibit crawl

In `catalyst_extractor._fetch_8k_bundle_text` (condizione **AND** `len(primary) >= 8000`):

```regex
(?i)\b(?:pdufa|topline|top[- ]line|read[- ]?out|advisory\s+committee|
2H\s*20|1H\s*20|Q[1-4]\s*20|second\s+half|target\s+action)\b
```

**Sì, rischio false positive:** una menzione generica nel primary (es. “topline expected in 2H 2026” in una frase forward-looking, o “readout” in una slide list) con primary ≥ 8k caratteri **salta tutti gli Ex-99**, anche se i numeri veri sono solo nell’exhibit.  
Il commento nel codice dice che lo skip è per “calendar language” / performance — non per garantire completezza finanziaria.

### B6 — Rischio truncate a 80_000 caratteri

**Non misurabile dalla cache** (niente lunghezze primary/exhibit).  
Dal codice: `max_chars=80_000` sul bundle; exhibit presi dopo il primary con budget residuo; se primary è già grande, l’exhibit viene **tagliato o saltato** (`budget < 4000` → no exhibit).  
Serve uno script di re-fetch campionario per quantificare.

---

## C — Score / classificazione

### C7 — Fin≈0 ma Clin/Corp rilevanti (UI “vuota”)

Soglia UI neutra: `|Fin| < 0.15`.

**6 / 56 filing (10.7%)** con `financial_score ≈ 0` e `clinical_score` o `corporate_score` ≥ 0.15:

| Ticker | Date | Items | Fin | Clin | Corp | Title (taxonomy) |
|---|---|---|---:|---:|---:|---|
| CRVO | 2026-09-10 | 7.01, 8.01 | 0 | **0.45** | 0 | Readout expected… |
| ALMS | 2026-09-01 | 8.01 | 0 | **1.12** | 0 | Positive topline… |
| BTAI | 2026-08-28 | 1.03 | 0 | 0 | **-1.0** | M&A / distressed |
| COCP | 2026-08-18 | 5.02 | 0 | 0 | **1.0** | Key executive hire |
| COCP | 2026-08-17 | 7.01 | 0 | **3.0** | **1.0** | Key executive hire (ma Clin=3!) |
| BHVN | 2026-08-07 | 5.02 | 0 | 0 | **1.0** | Key executive hire |

Conferma il sintomo C: badge UI solo **Fin** → filing clinici/corporate “forti” sembrano neutri.

### C8 — `_fill_empty_dims_from_heuristic`

**Dal codice (non Item-gated):**
- Interviene su **qualsiasi dimensione** (`clinical` / `financial` / `corporate` / `market_access`) se `event_id` è vuoto.
- Chiama `classify_heuristic(text)` sul **bundle intero** (pattern regex ad alta precisione: primary met, dosing, offering, ecc.) — **non** filtra per Item 7.01/8.01.
- Il commento vicino alla call cita Item 7.01 wrapping clinical PR come motivazione tipica, ma l’implementazione è dim-empty → fill.

**Dalla cache: non misurabile** quante volte si attiva (`classification_method: "heuristic_fill"` non è persistito nel dossier filing).

---

## Sintesi operativa (solo fatti Phase 0)

| Domanda | Risposta |
|---|---|
| Prompt impone numeri? | **No** — solo “numbers, dates” soft + ≤50 parole |
| Fallback extractive frequente? | **Sì, ~32%** filing |
| Ex-99 coverage misurabile in cache? | **No** |
| Skip exhibit keyword rischiose? | **Sì** — esp. `topline` / `readout` / `2H 20` / `Q[1-4] 20` + primary≥8k |
| Fin=0 nasconde Clin/Corp? | **Sì — 6/56** casi chiari |
| heuristic_fill frequenza? | **Sconosciuta** senza arricchire la cache |

---

## Samples grezzi (15 Gemini — per giudizio umano)

### 1. BBNX · 2026-09-15 · items=7.01, 8.01 · Fin=0.35 Clin=3.0 Corp=-2.0
**Title:** Regulation FD Disclosure: FDA / EMA approval
- **Item 7.01** — *Corporate Disclosures*
  - `Management issued a press release on September 14, 2026, announcing FDA clearance for the Mint patch pump and a 510(k) submission for the 3D Intelligence algorithm, alongside an updated corporate presentation.`
- **Item 8.01** — *Mint FDA Clearance and Launch*
  - `The FDA cleared the Mint patch pump featuring a reusable-disposable architecture requiring no recharging. A full US commercial launch is slated for Q1 2027 through the pharmacy channel, backed by a 2027 manufacturing capacity of at least 1.5 million disposable units.`
- **Item 8.01** — *3D Intelligence Algorithm Submission*
  - `Beta Bionics submitted a 510(k) application for its 3D Intelligence insulin dosing algorithm, offering Original, Optimized, and Conservative modes to power upcoming iLet 3D and Mint 3D systems upon regulatory clearance.`

### 2. BHVN · 2026-09-10 · items=8.01 · Fin=0.35 Clin=-3.0 Corp=2.0
**Title:** Other Events: Trial halted on safety
- **Item 8.01** — *BHV-7000 Phase 3 Enrollment Complete and Timeline*
  - `Management confirmed that enrollment for the BHV7000-303 pivotal focal epilepsy trial is complete. Dosing continues for over 600 active patients, and topline Phase 3 data readout remains on track for the second half of 2026, supported by a favorable safety profile across more than 1,200 participants.`
- **Item 8.01** — *FDA Partial Clinical Hold on New Patient Enrollment*
  - `The FDA issued a partial clinical hold on September 4, 2026, pausing new patient enrollment for BHV-7000 pending additional nonclinical studies on a specific rodent metabolite. Existing patients continue dosing normally, and management expects to resolve this data gap within the coming weeks.`

### 3. CADL · 2026-09-10 · items=5.02, 7.01 · Fin=0.35 Clin=1.0 Corp=1.0
**Title:** Regulation FD Disclosure: Key executive hire
- **Item 5.02** — *Board Expansion and New Independent Director Appointment*
  - `Candel expanded its board from ten to eleven members, appointing Martine Zimmermann, Pharm.D., as an independent Class III director effective September 8, 2026. She receives a 64,000-share stock option vesting over three years and a $40,000 annual retainer, bringing extensive regulatory expertise from leadership roles at Inventiva, Ipsen, and Alexion.`
- **Item 7.01** — *Press Release Regarding Board Appointment*
  - `The company issued a press release on September 10, 2026, announcing the appointment of Dr. Zimmermann to the Board of Directors to support upcoming regulatory milestones, including a planned BLA submission in the fourth quarter of 2026.`

### 4. CRVO · 2026-09-10 · items=7.01, 8.01 · Fin=0.0 Clin=0.45 Corp=0.0
**Title:** Regulation FD Disclosure: Readout expected with guided window
- **Item 7.01** — *Investor Presentation Availability*
  - `CervoMed has published an updated corporate presentation on its website detailing business updates, clinical pipelines, and financial status, intended for ongoing investor outreach and conference discussions.`
- **Item 8.01** — *Phase 2a Late-Breaking Oral Presentation*
  - `Initial Phase 2a trial results for neflamapimod in nonfluent variant primary progressive aphasia will be presented as a late-breaking oral at the International Society of Frontotemporal Dementias Annual Meeting on October 8-11, 2026.`

### 5. CADL · 2026-09-09 · items=7.01 · Fin=0.0 Clin=0.0 Corp=0.0
**Title:** Regulation FD Disclosure: Candel Therapeutics, Inc.
- **Item 7.01** — *Investor Presentation*
  - `Management provided an updated corporate presentation for use in stakeholder discussions during September 2026, highlighting pipeline strategies and upcoming operational milestones aimed at strengthening immunotherapy responses against various cancers.`

### 6. COCP · 2026-09-09 · items=7.01 · Fin=0.0 Clin=0.1 Corp=0.0
**Title:** Regulation FD Disclosure: Dosing milestone (first / last patient dosed)
- **Item 7.01** — *Phase 1b Norovirus Study Completion*
  - `Cocrystal Pharma completed dosing the final subject in the Phase 1b clinical trial of oral antiviral candidate CDI-988 for norovirus prevention and treatment. The trial showed a clean safety profile so far, with preliminary efficacy results anticipated in late 2026 or early 2027.`

### 7. ALMS · 2026-09-01 · items=8.01 · Fin=0.0 Clin=1.12 Corp=0.0  ← **caso B tipico**
**Title:** Other Events: Positive topline / interim results
- **Item 8.01** — *Envudeucitinib Phase 2b SLE Topline Data*
  - `On September 1, 2026, management released topline efficacy and safety results from the Phase 2b trial evaluating envudeucitinib in systemic lupus erythematosus, accompanied by a dedicated investor webcast presentation detailing the findings.`

### 8. BTAI · 2026-09-01 · items=2.03, 3.01 · Fin=1.5 Clin=0.0 Corp=-2.5
**Title:** Notice of Delisting / Failure to Satisfy Listing Rule: Delisting / non-compliance notice
- **Item 2.03** — *Chapter 11 DIP Financing*
  - `Following Chapter 11 bankruptcy filings on August 27, 2026, the company secured a $77.25 million debtor-in-possession credit agreement with Oaktree and Qatar Investment Authority. The facility includes up to $19 million in new money term loans across two draws and $58.25 million in prepetition debt roll-up loans.`
- **Item 3.01** — *Nasdaq Delisting Notice*
  - `Due to the Chapter 11 bankruptcy proceedings, Nasdaq notified the company of its intent to delist its common stock. Trading suspension is scheduled for September 8, 2026, after which the stock is expected to trade on the OTC Pink Limited Market without a company appeal.`

### 9. BTAI · 2026-08-28 · items=1.03 · Fin=0.0 Clin=0.0 Corp=-1.0
**Title:** Entry into Material Agreement: M&A target (distressed valuation)
- **Item 1.03** — *Chapter 11 Bankruptcy Filing*
  - `On August 27, 2026, BioXcel Therapeutics and subsidiaries filed voluntary Chapter 11 petitions in Delaware to pursue a value-maximizing sale of assets. The company operates as a debtor-in-possession, seeking first-day relief and up to $19 million in new-money DIP financing from Oaktree and Qatar Investment Authority.`

### 10. CHRS · 2026-08-28 · items=8.01 · Fin=0.0 Clin=0.0 Corp=0.0
**Title:** Other Events: Shelf registration filed (no takedown)
- **Item 8.01** — *At-The-Market Equity Offering Facility*
  - `Coherus Oncology entered into an ATM sales agreement with Leerink Partners on August 28, 2026, allowing the company to opportunistically offer and sell up to $50.0 million in common stock. Leerink will receive a commission of up to 3.0% on gross proceeds.`

### 11. BHVN · 2026-08-26 · items=1.01, 7.01, 9.01 · Fin=2.25 Clin=0.45 Corp=3.0
**Title:** Regulation FD Disclosure: Partnership / licensing signed (with upfront)
- **Item 1.01** — *Kv7 Platform Global License Agreement*
  - `Biohaven's subsidiary granted SK Biopharmaceuticals an exclusive worldwide license for its Kv7 channel platform, led by opakalim. The deal includes $400 million in upfront payments, up to $150 million in milestones, and tiered royalties. Biohaven retains development responsibilities for ongoing Phase 2/3 trials and regulatory filings.`
- **Item 7.01** — *Press Release and Transaction Announcement*
  - `Management issued a press release on August 26, 2026, announcing the strategic licensing partnership with SK Biopharmaceuticals for the Kv7 platform, alongside the assumption of specific financial and contractual obligations originally tied to Knopp.`
- **Item 9.01** — *Exhibit Filing of License and Assignment Agreements*
  - `The company filed the definitive License Agreement, MIPA Assignment and Assumption Agreement, and the associated press release detailing the global epilepsy partnership for the opakalim program as exhibits to support the current report.`

### 12. BTAI · 2026-08-25 · items=1.01 · Fin=1.5 Clin=0.0 Corp=0.0
**Title:** Entry into Material Agreement: Non-dilutive funding (grant / milestone / royalty)
- **Item 1.01** — *New Credit Agreement Amendment and Term Loans*
  - `BioXcel entered into a Fourteenth Amendment securing $1,250,000 in new term loans with a $250,000 upfront fee. Lenders lowered the minimum cash liquidity covenant to $250,000 from $3.0 million, tightened asset sale and licensing flexibilities, and mandated definitive transaction agreements for loan repayment or capital solutions by August 31, 2026.`

### 13. BTAI · 2026-08-24 · items=1.01 · Fin=0.0 Clin=0.0 Corp=0.0
**Title:** Entry into Material Agreement: BioXcel Therapeutics, Inc.
- **Item 1.01** — *Credit Agreement Thirteenth Amendment*
  - `BioXcel Therapeutics extended its deadline to August 28, 2026, to execute definitive agreements for loan repayment or an alternative capital solutions transaction acceptable to lenders under its Oaktree credit facility.`

### 14. COCP · 2026-08-18 · items=5.02 · Fin=0.0 Clin=0.0 Corp=1.0
**Title:** Departure / Election of Directors or Officers: Key executive hire
- **Item 5.02** — *Board Appointment*
  - `Carol L. Brosgart joined the Board of Directors immediately on August 12, 2026. Management confirmed no hidden selection arrangements, family ties, or disclosable related party transactions exist regarding her appointment.`

### 15. CHRS · 2026-08-17 · items=7.01, 8.01 · Fin=1.5 Clin=0.0 Corp=0.0
**Title:** Regulation FD Disclosure: Coherus Oncology, Inc.
- **Item 7.01** — *Special Dividend Press Release and FAQ*
  - `Management issued a press release and shareholder FAQ on August 17, 2026, announcing a board-declared special dividend of contingent value rights, available on the company investor relations website.`
- **Item 8.01** — *Contingent Value Rights Distribution Terms*
  - `Common stockholders of record on September 30, 2026, will receive one CVR per share, entitling them to cash proceeds from any sale or monetization of legacy biosimilar assets between October 7, 2026, and October 7, 2028.`
- **Item 8.01** — *CVR Structure and Asset Sale Process*
  - `The non-transferable CVRs are governed by an agreement with Equiniti Trust Company and an Innovatus loan agreement. An investment bank was hired to advise on monetizing the remaining biosimilar assets.`

---

*Fine Phase 0. Nessun codice modificato.*
