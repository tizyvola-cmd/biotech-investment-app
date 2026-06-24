# Icona collegamento Desktop «SuperNova»

Windows usa file **`.ico`** (non `.png` sul collegamento).

## Icona attuale (immagine Copilot)

- `refresh_desktop\BiotechRefresh.png` — sorgente
- `refresh_desktop\BiotechRefresh.ico` — usata dal collegamento Desktop

Per aggiornare: sostituisci il PNG e riesegui **`scripts\Installa_Refresh_Su_Desktop.bat`**.

## Metodo 1 — Altro file tuo

1. Prepara un'icona `.ico` (es. 256×256) oppure un PNG quadrato ~256px.
2. Copialo come `refresh_desktop\BiotechRefresh.png` o `.ico`.
3. Riesegui **`scripts\Installa_Refresh_Su_Desktop.bat`**.

## Metodo 2 — Da un PNG del progetto

Se hai `assets\supernova_app_icon.png` (o un altro PNG):

```powershell
cd "C:\coding\Biotech_Investment app 6"
py -3 scripts\set_refresh_desktop_icon.py --png "percorso\alla\tua\immagine.png"
scripts\Installa_Refresh_Su_Desktop.bat
```

## Metodo 3 — Icona personalizzata al volo

```powershell
scripts\Create_Desktop_Refresh_Shortcut.ps1 -IconPath "C:\percorso\mia_icona.ico"
```

## Metodo manuale (senza reinstall)

1. Tasto destro sul collegamento **SuperNova** sul Desktop → **Proprietà**.
2. **Cambia icona** → Sfoglia → scegli il tuo `.ico` → OK.

Non serve rifare il refresh dei dati per cambiare l'icona.
