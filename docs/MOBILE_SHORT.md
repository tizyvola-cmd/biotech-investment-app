# SuperNova Short — simulazioni mobile

Vedi **`docs/TERMINALI.md`** (dev locale) e **`docs/DEPLOY_V3.md`** (hosting v3).

## Obiettivo

**Telefono:** Dashboard, My Portfolio, Opportunities — dati dal server online (VPS) o API locale.

## Tab app

| Tab | Contenuto |
|-----|-----------|
| **Dashboard** | KPI · **Azioni da fare** · **Upcoming Catalysts** · **Top AI feed** · anteprima portafoglio (sync da desktop) |
| **My Portfolio** | Posizioni simulate con P&L |
| **Opportunities** | Hot (≤60 gg) e Watch (61–120 gg) fuori portafoglio |

Impostazioni (⚙️ in header): URL API, token, guida installazione PWA.

## Connessione server online (VPS)

**URL corretto mobile:** `http://91.99.15.48:8765/mobile/`  
(non la root `/` che è la UI desktop con sidebar)

1. Build: `powershell -File scripts\build_mobile_vps.ps1`
2. Deploy: `powershell -File scripts\deploy_vps_update.ps1`
3. Telefono: apri **`/mobile/`** → token VPS → Aggiungi a Home
4. In header vedi **`v2026.06.10-v3`** = build nuova

Se vedi ancora Portafoglio / Tutti / Setup = cache o URL sbagliato. Cancella icona Home e riapri `/mobile/`.

## API usate

| Endpoint | Uso |
|----------|-----|
| `GET /api/health` | Test connessione |
| `GET /api/mobile-host/config` | Modalità host (v3 / dev) |
| `GET /api/sheets/simulation` | Simulation + opportunità |
| `GET /api/investment/sim-inputs` | Portafoglio |
| `GET /api/mobile/dashboard-snapshot` | Raccomandazioni, catalizzatori, feed AI (pubblicato dalla dashboard desktop) |
| `PUT /api/mobile/dashboard-snapshot` | Desktop → server (automatico all'apertura dashboard) |

File server: `data/invest_sim_inputs.json`, `data/mobile_dashboard_snapshot.json`

**Sync contenuti desktop ↔ mobile:** apri la **Dashboard desktop** sul VPS (root `/`); il client pubblica lo snapshot su server. Poi su mobile (`/mobile/`) premi **Aggiorna** — vedrai le stesse raccomandazioni, catalizzatori e feed AI (non grafici/Pulse, solo mobile).

