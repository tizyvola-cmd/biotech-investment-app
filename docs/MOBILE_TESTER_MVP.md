# SuperNova — Mobile tester companion (MVP)

## Obiettivo

Raccogliere **confluenza di dati** da tester esterni (predizioni azzeccate/sbagliate, errori di pendenza, feedback segnali, eventi catalyst) mentre il **desktop** resta il laboratorio per orchestrator, Excel e miglioramento del modello.

## Decisioni di prodotto (default implementati)

| Domanda | Scelta |
|---------|--------|
| Cosa vedono i tester? | **Stesso snapshot predizioni** del modello (read-only da API / snapshot pubblicati) |
| Tracciamento | **Per tester** (`tester_id` + email) — portfolio sim **separato** dal desktop |
| Portfolio mobile | `data/tester_sim_inputs/{tester_id}.json` — una simulazione per email approvata |
| Esiti gain/loss | Eventi `gain_note` (modulo `portfolio`) nel feedback store alla chiusura posizione |
| Cosa scrivono | Solo **eventi di feedback** strutturati (POST), mai refresh orchestrator |

## Tab mobile (v1)

1. **Dashboard** — KPI globali + “i tuoi ultimi feedback”
2. **Simulation** — pred vs esito: hit / miss / flat / N/A per ticker
3. **Decision Lab** — card segnale: agree / disagree + outcome T+N
4. **Catalyst feed** — timeline compatta: rilevante / rumore + validazione summary

Su desktop: tab **Monitor tester** (`testerMonitor`) per vedere confluenza in tempo reale.

## Storage

File: `data/tester_feedback_store.json`

```json
{
  "schema_version": 1,
  "updated_at": "2026-05-29T12:00:00+00:00",
  "testers": {
    "alice": {
      "tester_id": "alice",
      "display_name": "Alice",
      "invite_code": "SN-01",
      "created_at": "...",
      "last_seen_at": "...",
      "event_count": 12
    }
  },
  "events": [
    {
      "id": "uuid",
      "tester_id": "alice",
      "source": "mobile",
      "module": "simulation",
      "kind": "prediction_outcome",
      "ticker": "BNTX",
      "payload": { "outcome": "hit", "horizon": "T+3" },
      "created_at": "..."
    }
  ]
}
```

## API (FastAPI, stessa porta 8765)

| Metodo | Path | Uso |
|--------|------|-----|
| GET | `/api/tester-feedback/config` | Schema, moduli/kind validi |
| GET | `/api/tester-feedback/summary` | Aggregati per tab desktop Monitor |
| GET | `/api/tester-feedback/events?limit=&tester_id=&module=&kind=` | Lista eventi |
| POST | `/api/tester-feedback/testers/register` | Registrazione tester |
| POST | `/api/tester-feedback/events` | Invio feedback |

Header mutazioni (se configurato): `X-SuperNova-Token` = `SUPERNOVA_API_TOKEN`.

### Registrazione tester

```json
POST /api/tester-feedback/testers/register
{
  "tester_id": "alice",
  "display_name": "Alice",
  "invite_code": "SN-TEST-01"
}
```

### Evento — esito predizione (Simulation)

```json
POST /api/tester-feedback/events
{
  "tester_id": "alice",
  "module": "simulation",
  "kind": "prediction_outcome",
  "ticker": "BNTX",
  "payload": {
    "outcome": "hit",
    "horizon": "T+3",
    "pred_dir": "up",
    "actual_dir": "up",
    "note": ""
  }
}
```

`outcome`: `hit` | `miss` | `flat` | `skip`

### Evento — errore pendenza

```json
{
  "module": "simulation",
  "kind": "slope_error",
  "ticker": "IRWD",
  "payload": {
    "error_type": "pendenza_eccessiva",
    "days_to_cd": 14,
    "note": "curva troppo ripida vs storico"
  }
}
```

### Evento — segnale Decision Lab

```json
{
  "module": "decisionLab",
  "kind": "signal_feedback",
  "ticker": "OLMA",
  "payload": {
    "agree": false,
    "signal_id": "row-42",
    "note": "CTR troppo alto per il mio sizing"
  }
}
```

### Evento — catalyst feed

```json
{
  "module": "catalystFeed",
  "kind": "catalyst_label",
  "ticker": "BNTX",
  "payload": {
    "relevant": true,
    "event_ref": "NCT123",
    "summary_ok": true
  }
}
```

### Ping sessione (opzionale)

```json
{
  "module": "dashboard",
  "kind": "session_ping",
  "payload": { "app_version": "0.1.0-mvp" }
}
```

## Moduli e kind validi

- **module**: `dashboard` | `simulation` | `decisionLab` | `catalystFeed`
- **kind**: `session_ping` | `prediction_outcome` | `slope_error` | `signal_feedback` | `catalyst_label` | `gain_note`
- **source**: `mobile` | `desktop` | `api`

## Deploy per tester (fase successiva)

1. API su host raggiungibile (HTTPS) con `SUPERNOVA_API_TOKEN`
2. `SUPERNOVA_BIND_ALL=1` + CORS ristretto agli origin della PWA
3. Snapshot predizioni esposti in GET read-only (stessi endpoint sheet/predictions già esistenti, o export periodico)
4. PWA / Capacitor che punta a `VITE_API_BASE`

## Privacy

- Non richiedere capitale reale nel MVP: solo watchlist + giudizio sul modello
- Documentare uso dati solo per calibrazione interna
- Possibilità di revocare `tester_id` lato server (futuro)

## Fasi

| Fase | Deliverable |
|------|-------------|
| **Fatto** | Store JSON + API + tab desktop Monitor tester |
| **Fatto** | Export Model Lab (`tester_feedback_calibration.json`) + pannello in Analisi modello |
| **Fatto** | PWA MVP in `mobile-ui/` (4 tab) |
| **3** | Host HTTPS + token per tester remoti |

## Avvio PWA sul telefono (MVP locale)

1. PC: avvia API (`scripts\Avvia_Biotech_Desktop.bat` o `python -m supernova_api`).
2. PC: `scripts\Avvia_Mobile_PWA.bat` (oppure `cd mobile-ui` → `npm install` → `npm run dev`).
3. Trova IP LAN del PC (`ipconfig` → IPv4, es. `192.168.1.42`).
4. Per accesso da telefono, avvia API in ascolto sulla LAN (PowerShell, una volta per sessione):

```powershell
$env:SUPERNOVA_BIND_ALL="1"
$env:SUPERNOVA_CORS_PERMISSIVE="1"
cd "c:\coding\Biotech_Investment app 6"
.\.venv\Scripts\python.exe -m supernova_api
```

5. Telefono (stessa Wi‑Fi): browser → `http://192.168.1.42:5174`
6. Prima schermata: **URL API** = `http://192.168.1.42:8765`, poi `tester_id` + nome → Salva.
6. iOS/Android: menu browser → **Aggiungi a Home** (installazione PWA leggera).

Monitor eventi su desktop: **Collaborazione → Monitor tester**.

## Export Model Lab

- **Monitor tester** → pulsanti *Salva per Model Lab* / *Scarica JSON*
- **Analisi modello → Curve engine** → sezione *Feedback tester → calibrazione*
- File: `data/tester_feedback_calibration.json`
- API: `GET /api/tester-feedback/export`, `POST /api/tester-feedback/export/snapshot`

## Test rapido (curl, PC acceso)

```powershell
curl -X POST http://127.0.0.1:8765/api/tester-feedback/testers/register `
  -H "Content-Type: application/json" `
  -d '{"tester_id":"demo","display_name":"Demo Tester"}'

curl -X POST http://127.0.0.1:8765/api/tester-feedback/events `
  -H "Content-Type: application/json" `
  -d '{"tester_id":"demo","module":"simulation","kind":"prediction_outcome","ticker":"BNTX","payload":{"outcome":"hit"}}'
```

Poi apri desktop → **Monitor tester**.
