# SuperNova — Quali terminali usare

Usa **sempre questi nomi** (due finestre PowerShell separate).

| Nome | Cosa fa | Porta | OK se vedi |
|------|---------|-------|------------|
| **Term 1 = Biotech** | API dati (Excel, simulation, salvataggi) | **8765** | `Uvicorn running on http://0.0.0.0:8765` |
| **Term 2 = Mobile** | App SuperNova Short sul telefono | **5174** | `Network: http://192.168.x.x:5174/` |

**Term 3** (o altri): opzionali per test (`Invoke-RestMethod`); **non** servono per telefono o icona.

---

## Avvio rapido (doppio click)

1. `scripts\Avvia_Term1_Biotech.bat` → lascia aperto **Term 1 = Biotech**
2. `scripts\Avvia_Term2_Mobile.bat` → lascia aperto **Term 2 = Mobile**
3. Telefono (stessa Wi‑Fi): `http://IP:5174` — API nell’app: `http://IP:8765`

---

## Term 1 = Biotech (comandi manuali)

```powershell
$env:SUPERNOVA_BIND_ALL="1"
$env:SUPERNOVA_CORS_PERMISSIVE="1"
cd "c:\coding\Biotech_Investment app 6"
.\.venv\Scripts\python.exe -m supernova_api
```

Non chiudere. Non incollare righe `PS C:\...>` o log `INFO:` / `WARNING:`.

---

## Term 2 = Mobile (comandi manuali)

```powershell
cd "c:\coding\Biotech_Investment app 6\mobile-ui"
npm run dev
```

Se compare **`Port 5174 is already in use`**: **Term 2 = Mobile** è già acceso in un’altra finestra → usa quella, non rilanciare.

---

## Telefono

| Cosa | URL |
|------|-----|
| Browser / icona Home | `http://192.168.1.203:5174` (IP da riga `Network:` di Term 2) |
| Campo URL API nell’app | `http://192.168.1.203:8765` |

Icona: Safari → Condividi → **Aggiungi a Home** (supernova colorata). Se resta vecchia: **rimuovi** scorciatoia dalla Home e ri-aggiungi. Icone: `assets/supernova_mobile_icon_source.png` + `python scripts/gen_mobile_pwa_icons.py`.

---

## Errori comuni

| Messaggio | Significato |
|-----------|-------------|
| `Port 5174 already in use` | Term 2 = Mobile già avviato |
| `500` / errore connessione | Term 1 = Biotech spento, o Excel con workbook aperto |
| Pagina router | URL senza `:5174` o IP sbagliato |

---

## Versione 3 — senza terminali sul telefono

Server sempre online (VPS + HTTPS): **nessun** Term 1 / Term 2 sul PC di casa.

- Guida completa: **`docs/DEPLOY_V3.md`**
- Build PWA: `scripts\build_mobile_v3.ps1`
- Host unificato: `scripts\Avvia_V3_Host.bat` (API + app su porta `8765`)
- Telefono: `https://tuodominio` + token API → Aggiungi a Home
