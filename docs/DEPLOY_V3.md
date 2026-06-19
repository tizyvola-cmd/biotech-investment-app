# SuperNova Short — versione 3 (host sempre online)

Telefono **senza** Term 1 / Term 2 sul PC di casa: l’app e l’API girano su un **server sempre acceso** (VPS, NAS, cloud) con **HTTPS**.

---

## Architettura

| Componente | Dove |
|------------|------|
| API SuperNova | Server (`8765` dietro nginx + SSL) |
| PWA SuperNova Short | Stessi host (`SUPERNOVA_SERVE_MOBILE=1` → `mobile-ui/dist` sulla root) |
| Dati | Cartella `data/` sul server (workbook + snapshot JSON) |
| PC desktop | Opzionale: sync dati verso il server (rsync / refresh pianificato) |

Il telefono apre solo: `https://supernova.tuodominio.it` → Aggiungi a Home. **Nessun terminale** sul PC.

---

## 1. Build PWA (sul PC o sul server)

```powershell
cd "c:\coding\Biotech_Investment app 6"
powershell -File scripts\build_mobile_v3.ps1
```

---

## 2. Test locale “v3” (un solo processo)

```powershell
$env:SUPERNOVA_BIND_ALL="1"
$env:SUPERNOVA_SERVE_MOBILE="1"
$env:SUPERNOVA_API_TOKEN="test-token-segreto"
cd "c:\coding\Biotech_Investment app 6"
.\.venv\Scripts\python.exe -m supernova_api
```

Oppure: `scripts\Avvia_V3_Host.bat`

- PC: `http://127.0.0.1:8765` → app + API
- Telefono (Wi‑Fi): `http://IP_PC:8765` — URL API **vuoto**, token = `test-token-segreto`

---

## 3. Deploy su VPS (Ubuntu esempio)

### 3.1 Copia progetto

```bash
git clone ... /opt/supernova
cd /opt/supernova
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt   # se esiste
```

Copia la cartella **`data/`** dal PC (workbook, snapshot, `invest_sim_inputs.json`).

### 3.2 Variabili ambiente

File `/opt/supernova/config/profiles/mobile_v3_host.env`:

```bash
SUPERNOVA_BIND_ALL=1
SUPERNOVA_SERVE_MOBILE=1
SUPERNOVA_API_TOKEN=<chiave-lunga-random>
SUPERNOVA_PORT=8765
```

### 3.3 Servizio systemd

```ini
[Unit]
Description=SuperNova v3 Host
After=network.target

[Service]
WorkingDirectory=/opt/supernova
EnvironmentFile=/opt/supernova/config/profiles/mobile_v3_host.env
ExecStart=/opt/supernova/.venv/bin/python -m supernova_api
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now supernova-v3
```

### 3.4 HTTPS (nginx + Let’s Encrypt)

```nginx
server {
    listen 443 ssl;
    server_name supernova.tuodominio.it;
    ssl_certificate     /etc/letsencrypt/live/.../fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/.../privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8765;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 3.5 Telefono

1. Safari → `https://supernova.tuodominio.it`
2. Prima volta: token API (quello di `SUPERNOVA_API_TOKEN`)
3. Condividi → **Aggiungi a Home**

---

## 4. Aggiornare i dati dal PC

Il server non legge il tuo Excel in tempo reale sul PC. Opzioni:

| Metodo | Descrizione |
|--------|-------------|
| **rsync** | `rsync -avz data/ user@vps:/opt/supernova/data/` dopo refresh desktop |
| **Refresh sul server** | Cron che esegue `data_orchestrator` sul VPS (se hai le API key lì) |
| **Snapshot** | Copia solo `simulation_sheet_snapshot.json` + `invest_sim_inputs.json` |

---

## 5. Sicurezza

- **Obbligatorio** `SUPERNOVA_API_TOKEN` su internet
- **Non** usare `SUPERNOVA_CORS_PERMISSIVE=1` in produzione
- Firewall: solo 443 (nginx), non esporre 8765 direttamente

---

## Confronto modalità

| | Dev (casa) | v3 (host) |
|--|------------|-----------|
| Terminali PC | Term 1 + Term 2 | Nessuno |
| URL telefono | `http://IP:5174` | `https://dominio` |
| PC acceso | Sì | No (solo sync dati) |
| Token | Opzionale | Obbligatorio |

Vedi anche `docs/TERMINALI.md` (solo modalità dev).
