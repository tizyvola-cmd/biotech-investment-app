# Biotech Investment App - Cuore Modelli e Valutazione (Export)

Ultimo aggiornamento: 2026-05-09  
Scope: orchestrazione modelli `v4`, `2.0`, `2.1`, popolazioni di calibrazione, strumenti di valutazione, output Excel.

## 1) Architettura logica del motore

Il programma ha 4 blocchi principali:

1. **Raccolta dati e feature engineering**
   - Prezzi/volumi (Yahoo), benchmark `^XBI`, metadati clinici (CT.gov), metadati sponsor/NCT.
2. **Predizione**
   - **Direzione** con `v4_options` (ensemble multi-segnale).
   - **Traiettoria numerica** (+1/+3/+5/+10/+30) con fit empirico (lineare/parabolico/log, spline per 2.1) e curve aggregate.
3. **Auto-calibrazione**
   - Aggiorna `cal_factor` e curve empiriche aggregate da retro-backtest + completati.
4. **Reporting**
   - Scrive sheet operative e sheet di controllo/accuratezza, inclusa la nuova sheet su popolazione ristretta.

## 2) Modelli applicati

## `v4_options` (motore direzionale principale)

Modello ensemble che combina segnali pre-catalyst e produce label:
- `↑↑ Forte crescita`
- `↑ Crescita lieve`
- `→ Stabile`
- `↓ Calo lieve`
- `↓↓ Calo forte`

Segnali principali usati nel codice:
- trend relativo vs `XBI` (`exc_slope`)
- `RSI`
- volume build-up (`vol_ratio`) e accelerazione volume (`vol_accel`)
- coerenza multi-timeframe (`slope_5d`, `slope_20d`)
- run-up/sell-off contrarian
- drift quality (graduale vs spike)
- prossimità ATH 52 settimane
- divergenza volume-prezzo
- opzioni: `put/call ratio (PCR)` e `expected move`
- regola `priced-in` vicino al catalyst

Output direzionale poi usato nei fogli `Simulation`, `Modello`, `Accuratezza Modello`.

## `2.0` e `2.1` (motore numerico empirico)

Servono a stimare ampiezza del movimento su orizzonti post-catalyst.

- **2.0**: curva empirica/polinomiale (fit numerico).
- **2.1**: variante spline/piecewise linear (fit più robusto su forme non lineari).

Entrambi lavorano su basi storiche aggregate e sono usati come layer numerico di scenario e confronto.

## 2-bis) Formule dei polinomi applicati

Di seguito le formule effettivamente usate nel codice per il layer numerico.

### A) Modello 2.0 (engine `poly`)

Fit su punti empirici `(t, mediana%)` con:
- `t` = offset temporale rispetto al CD (griglia tipica `-7, -5, -3, +3, +5, +7`)
- `y` = variazione percentuale mediana della coorte

Polinomio:

`y(t) = a_d t^d + a_{d-1} t^{d-1} + ... + a_1 t + a_0`

dove:
- i coefficienti `[a_d, ..., a_0]` sono quelli di `numpy.polyfit`
- `d = min(4, N_punti_validi - 1)` (grado adattivo)

Valutazione:
- su nodi interni: usa direttamente la mediana del nodo se disponibile
- per estrapolazione (es. `+10`, `+30`): `y_hat = y(t)` tramite valutazione del polinomio

### B) Modello 2.1 (engine `spline`)

Spline lineare (PWL) sui nodi mediani ordinati:

se `t_i <= t <= t_{i+1}`:

`y(t) = y_i + (y_{i+1} - y_i) * (t - t_i) / (t_{i+1} - t_i)`

Estrapolazione:
- oltre ultimo nodo: prosegue con la pendenza dell'ultimo segmento
- prima del primo nodo: prosegue con la pendenza del primo segmento
- fallback: se spline non calcolabile e il polinomio esiste, usa il polinomio

### C) Fit numerico per-ticker (Path B, scenario live/completati)

Per i punti storici del singolo ticker il motore confronta 3 famiglie e sceglie la migliore per `R²`:

1. Lineare:
   - `y(x) = m x + q`
2. Polinomiale di grado 2:
   - `y(x) = a x^2 + b x + c`
3. Esponenziale log-lineare:
   - `y(x) = exp(b x + a) - shift`

dove `x` e' il tempo relativo alla data decisionale/CD (in giorni) e `y` e' la variazione %.

Predizione orizzonti:
- `y(x+3)`, `y(x+5)`, `y(x+10)`, `y(x+30)`
- successivo clipping operativo sulle previsioni in % (cap `+-25%` nel blocco fallback)

### D) Dove trovi i coefficienti per export tecnico

I coefficienti polinomiali delle curve aggregate sono nello stato calibrazione (`model_calibration_state.json`), nel blocco:
- `current.curves.<versione>.<categoria>.poly`

quindi puoi esportare direttamente le formule sostituendo i coefficienti nella forma:

`y(t) = a_d t^d + ... + a_0`

## 3) Input dati reali usati dai modelli

Uso operativo nel codice:
- **Usati direttamente**: `Close`, `Volume`, benchmark `XBI`, metadati fase clinica, giorni a catalyst, segnali opzioni.
- **Open/High/Low**: non sono il driver principale del cuore predittivo v4 nel flusso direzionale corrente; il nucleo decisionale lavora principalmente su close/volume/segnali derivati.

Quindi: il cuore pratico della previsione è centrato su **close+volume+contesto clinico+opzioni+XBI**.

## 4) Popolazioni di calibrazione

## Popolazione storica originaria (prima del filtro stretto)

Calibrazione costruita su:
- retro-backtest (`_run_retro_backtest`)
- record dei catalyst completati (`past_pred_data`)
- con regole di eligibility qualità input/predizione nei blocchi accuracy.

## Popolazione ristretta attuale (attiva)

È stata introdotta una coorte filtrata per `nct_relation_type`:
- `direct sponsor`
- `collaborator`
- `correlated company/subsidiary`

Esclusi:
- `N/D` e relazioni non ammesse.

Questa popolazione è marcata nello stato calibrazione con:
- `population_filter = "nct_relation_restricted_v1"`

Effetti operativi implementati:
- ricalcolo `cal_factor` e curve empiriche con coorte ristretta
- refresh automatico se lo stato disco non ha quel filtro
- `Accuratezza Modello` filtrata sulla stessa coorte
- `Simulation` riscritta nello **stesso run** con stato ristretto appena ricalcolato

## 5) Auto-calibrazione: come funziona

Per ogni versione:
- calcola `acc_reale` da retro
- legge `acc_target` da registry
- costruisce `cal_factor = acc_reale / acc_target`
- applica clipping `[0.5, 1.5]`

In parallelo produce curve aggregate per categorie:
- `success`
- `failure`
- `neutral`
- `control` (baseline unrelated)

Lo stato viene salvato in `model_calibration_state.json` e riusato dai fogli.

## 6) Strumenti di valutazione implementati

## A) Valutazione direzionale

- booleani `ok_v1..ok_v4` (verso corretto/non corretto)
- score direzionali aggregati su retro/completati
- monitor storico run-to-run (`📈 Accuratezza nel tempo`)

## B) Valutazione numerica (errore ampiezza)

- errori `d*_err` (scarto predetto vs osservato)
- metriche aggregate (MAE, MedAE, bias, hit-rate, gap calibrazione)
- indicatori di affidabilità stimata/reale

## C) Sheet `Accuratezza Modello`

Focus su qualità del fit numerico v4 vs storico:
- blocchi `Prediction`, `Storico`, `Delta`
- colori R-W-G su prediction/storico/delta
- delta con zona bianca vicino allo zero (errore piccolo)
- outcome a due livelli: stesso verso + affidabilità/distanza

## D) Sheet `📊 Modelli popolazione ristretta`

Nuova sheet dedicata alla coorte stretta:
- descrizione funzioni modelli
- tabella confronto (accuracy, N, cal_factor, numerosità curve)
- grafici:
  - accuratezza direzionale coorte ristretta
  - numerosità curve empiriche

Nota tecnica: nella tabella comparativa della sheet ristretta, le righe `v4`, `2.0`, `2.1` condividono attualmente la stessa base direzionale (`ok_v4`) per il confronto operativo.

## 7) Cuore decisionale del programma (in sintesi)

1. Costruisce universo catalyst e segnali mercato.
2. Applica `v4` per direzione e affidabilità.
3. Applica layer numerico (2.0/2.1 + curve empiriche) per ampiezza scenario.
4. Confronta con storico su completati (direzione + errore).
5. Auto-ricalibra (`cal_factor` + curve) su coorte valida.
6. Scrive output Excel con viste operative e di controllo qualità.

## 8) Glossario rapido

- **CD**: Completion Date studio clinico.
- **cal_factor**: fattore di taratura (acc_reale/acc_target), usato per correggere affidabilità.
- **Curve empiriche**: mediana/IQR per categorie predittive.
- **Reliability (stimata/reale)**: qualità attesa vs qualità misurata ex-post.
- **Population filter**: etichetta della coorte usata per calibrazione corrente.

## 9) Stato corrente del sistema (dopo le ultime modifiche)

- Calibrazione allineata alla coorte NCT ristretta.
- `Accuratezza Modello` allineata alla stessa coorte.
- `Simulation` coerente nel run corrente con stato appena ricalcolato.
- Nuova sheet `📊 Modelli popolazione ristretta` disponibile per audit/export.

