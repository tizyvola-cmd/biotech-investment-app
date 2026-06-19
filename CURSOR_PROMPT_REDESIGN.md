# SuperNova UI Redesign — Cursor Prompt

Copia e incolla tutto il testo qui sotto direttamente nella chat di Cursor.

---

## PROMPT DA INCOLLARE IN CURSOR

Sto lavorando su un'app desktop Electron + React chiamata **SuperNova** — una piattaforma di analisi predittiva per catalyst di titoli biotech. Voglio un redesign completo dell'interfaccia mantenendo tutta la logica esistente intatta.

**Stack:** React 18 + TypeScript, Vite, Tailwind CSS, Electron. File principali in `desktop-ui/src/`.

---

### OBIETTIVO GENERALE

Trasformare il layout attuale (header orizzontale + tab in fila) in un layout professionale a **sidebar verticale sinistra + area principale** ispirato a un terminale Bloomberg, stile dark terminal.

Il mockup di riferimento esiste già come file HTML statico in `mockup_supernova.html` nella root del progetto — aprilo nel browser per vedere l'esatto design da replicare. Ha tre schermate cliccabili: Catalyst Hub, Simulation, Accuracy Lab.

---

### REGOLA ASSOLUTA — NON TOCCARE MAI

- `desktop-ui/src/api/supernova.ts` — nessuna modifica
- `desktop-ui/src/types.ts` — nessuna modifica  
- `desktop-ui/src/data/` — nessuna modifica (tutti i file)
- `desktop-ui/src/sheet/` — nessuna modifica (tutti i file)
- `electron/` — nessuna modifica
- `supernova_api.py` — nessuna modifica
- Tutta la logica di stato in `App.tsx` (fetch, useState, useEffect, callbacks) — **non toccare**, cambia solo il JSX del layout/render

---

### MODIFICHE RICHIESTE

#### 1. `desktop-ui/src/index.css` — aggiungi CSS variables

Nel blocco `:root` esistente aggiungi queste variabili in fondo (dopo `--border`):

```css
--surface-3: 46 53 96;
--bg-deep: 15 18 33;
--signal-up: 22 163 74;
--signal-down: 220 38 38;
--signal-neutral: 100 116 139;
--warn: 245 158 11;
--purple-soft: 167 139 250;
--sidebar-w: 200px;
```

Nel blocco `.dark` aggiungi in fondo:

```css
--surface-3: 46 53 96;
--bg-deep: 15 18 33;
--signal-up: 34 197 94;
--signal-down: 239 68 68;
--signal-neutral: 100 116 139;
--warn: 245 158 11;
--purple-soft: 167 139 250;
```

Poi aggiungi questi componenti Tailwind nel blocco `@layer components`:

```css
.signal-up {
  @apply inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold;
  background: rgb(var(--signal-up) / 0.12);
  color: rgb(var(--signal-up));
}
.signal-down {
  @apply inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold;
  background: rgb(var(--signal-down) / 0.12);
  color: rgb(var(--signal-down));
}
.signal-neutral {
  @apply inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold;
  background: rgb(var(--signal-neutral) / 0.12);
  color: rgb(var(--signal-neutral));
}
.phase-badge {
  @apply inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold;
  background: rgb(var(--purple-soft) / 0.15);
  color: rgb(var(--purple-soft));
}
.infer-ok {
  @apply inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold;
  background: rgb(var(--signal-up) / 0.12);
  color: rgb(var(--signal-up));
}
.infer-warn {
  @apply inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold;
  background: rgb(var(--warn) / 0.12);
  color: rgb(var(--warn));
}
.quality-dot-green { @apply inline-block w-2 h-2 rounded-full bg-[rgb(var(--signal-up))] shadow-[0_0_5px_rgb(var(--signal-up))]; }
.quality-dot-yellow { @apply inline-block w-2 h-2 rounded-full bg-[rgb(var(--warn))] shadow-[0_0_5px_rgb(var(--warn))]; }
.quality-dot-red { @apply inline-block w-2 h-2 rounded-full bg-[rgb(var(--signal-down))] shadow-[0_0_5px_rgb(var(--signal-down))]; }
```

---

#### 2. `desktop-ui/src/App.tsx` — cambia solo il layout JSX

**NON toccare** nessuno dei useState, useEffect, useCallback, useMemo, o le funzioni reloadXxx/onRunQuick.

Cambia solo il `return (...)` finale. Il nuovo layout deve essere:

```tsx
return (
  <div className="flex h-screen overflow-hidden" style={{background: 'rgb(var(--bg-deep))'}}>
    <AppSidebar screen={screen} onScreen={setScreen} apiOk={apiOk} />
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Top bar con titolo schermata corrente */}
      <AppTopBar
        screen={screen}
        desktopManifest={desktopManifest}
        apiOk={apiOk}
        status={status}
        onReloadData={() => void reloadData()}
      />
      {/* Area contenuto principale */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {screen === "catalyst" && (
          <CatalystHubView ... /> // props invariate come prima
        )}
        {screen === "simulation" && (
          <InvestmentSimulationView ... /> // props invariate
        )}
        // ... tutti gli altri screen invariati
      </div>
    </div>
  </div>
);
```

---

#### 3. CREA `desktop-ui/src/components/AppSidebar.tsx` — NUOVO FILE

Sidebar verticale sinistra. Props: `screen: AppScreen`, `onScreen: (s: AppScreen) => void`, `apiOk: boolean | null`.

Struttura visiva (vedi mockup):
- **Logo in cima**: icona quadrata con gradiente indigo-violet + testo "SuperNova" + sottotitolo "BIOTECH INTEL" in caps piccole
- **Sezione WATCH** (label in grigio dim, caps):
  - `⚡ Catalyst Hub` → screen "catalyst" — con badge numero (hardcoded 5 per ora, poi dinamico)
  - `📈 Simulation` → screen "simulation"
- **Sezione ANALYZE**:
  - `🎯 Accuracy Lab` → screen "accuracy"
  - `🧠 Model Analysis` → screen "models"
- **Sezione RESEARCH**:
  - `🔬 Clinical Trials` → screen "clinical"
  - `📄 SEC 8-K` → screen "secK8"
  - `💰 Financial` → screen "financial"
- **Footer** (margin-top: auto, border-top):
  - `⚙ System` → screen "system"
  - Card status modello: dot verde animato + "Model v4" + "MAE 13pp"

Stili nav item:
- Default: `text-ink-muted`, hover: `bg-[rgb(var(--surface-3))] text-ink`
- Active: `bg-accent/15 text-accent`
- Larghezza sidebar: 200px, `flex-shrink-0`, `bg-[rgb(var(--surface))]`, `border-r border-[rgb(var(--border))]`

---

#### 4. CREA `desktop-ui/src/components/AppTopBar.tsx` — NUOVO FILE

Top bar orizzontale sopra il contenuto principale. Props: `screen`, `desktopManifest`, `apiOk`, `status`, `onReloadData`.

Contenuto:
- Sinistra: titolo schermata corrente (mappa `screen → label` es. "catalyst" → "Catalyst Hub")
- Data corrente in grigio dim
- Destra: pill filtri contestuali (per catalyst: "All", "↑ Long", "↓ Short", "⭐ High conf.") + avatar "TR"
- Altezza 52px, `bg-[rgb(var(--surface))]`, `border-b border-[rgb(var(--border))]`

---

#### 5. `desktop-ui/src/components/CatalystHubView.tsx` — modifica

Aggiungi **in cima** (prima della Dashboard/tabella esistente) la **Catalyst Strip**: una riga orizzontale scrollabile con card compatte per i prossimi 5 catalyst ordinati per `completionDate` più vicina.

Ogni card mostra:
- Ticker in grassetto grande
- Badge direction: usa classe `signal-up` / `signal-down` / `signal-neutral`
- Countdown: `"in X giorni"` calcolato da `completionDate` — se ≤7 giorni mostra `"⚡ in X gg"` in colore `warn`
- `D+7 pred.` con il valore `modelD7Pct` formattato come `+X.X%` / `-X.X%`

Card evidenziata con `border-[rgb(var(--warn))]` se countdown ≤7 giorni.

Dati da `catalystRows` (prop già esistente di tipo `CatalystRow[]`). Ordina per `completionDate` ASC e prendi i primi 5. Salta le righe senza `completionDate`.

Il resto del componente (pannello curve, Dashboard, ecc.) rimane invariato.

---

#### 6. `desktop-ui/src/components/Dashboard.tsx` — modifica tabella

Nella tabella principale dei catalyst, aggiungi/modifica queste colonne:

**Colonna "Signal"** (sostituisce o affianca la colonna direction testuale):
```tsx
// Logica signal badge
const signalClass = row.direction === "up" ? "signal-up"
  : row.direction === "down" ? "signal-down"
  : "signal-neutral";
const signalLabel = row.direction === "up" ? "↑ Long"
  : row.direction === "down" ? "↓ Short"
  : "— Neutral";
// Se confidence > 0.75 e direction !== neutral: aggiungi "Strong " prima
```

**Colonna "Countdown"**: calcola giorni da oggi a `completionDate`. Se ≤14 giorni: colore `text-[rgb(var(--warn))]` + prefisso ⚡. Se null: "—".

**Colonna "Quality"**: se `dataQualityScore` < 1 → `quality-dot-green`, 1-2 → `quality-dot-yellow`, > 2 → `quality-dot-red`. Se null → nessun dot.

**Evidenzia riga** con `bg-[rgb(var(--warn))]/5` se countdown ≤ 14 giorni.

---

#### 7. `desktop-ui/src/components/InvestmentSimulationView.tsx` — modifica

**Aggiungi KPI bar** in cima al componente (prima della tabella esistente). Calcola dai dati di `simTable.rows`:

```tsx
// KPI da calcolare su simTable.rows
const totalTickers = simTable.rows.length;
const withPosition = simTable.rows.filter(r => r["Capitale Investito ($)"] != null).length;
const totalCapital = simTable.rows.reduce((s, r) => s + (Number(r["Capitale Investito ($)"]) || 0), 0);
const nextCD = simTable.rows
  .filter(r => r["Completion Date"])
  .sort((a, b) => new Date(a["Completion Date"]).getTime() - new Date(b["Completion Date"]).getTime())[0];
const avgAffidabilita = (
  simTable.rows.reduce((s, r) => s + (Number(r["Affidabilità\ncalib %"]) || 0), 0) / totalTickers * 100
).toFixed(0);
```

Mostra 5 KPI card affiancate:
1. "Portafoglio attivo" → `{withPosition} / {totalTickers}`
2. "Capitale investito" → `$${totalCapital.toLocaleString()}`
3. "P&L stimato" — calcola da `P&L ($)` se disponibile, altrimenti "—"
4. "Affidabilità media" → `{avgAffidabilita}%`
5. "Prossima CD" → data della CD più vicina + ticker

**Aggiungi sub-tabs** sotto la KPI bar:
- "Tutti i ticker" (default)
- "Solo portafoglio" — filtra righe con `Capitale Investito ($) != null`
- "Solo esplorativi" — filtra righe con `Inferenza modello === "Solo esplorativa"`

**Aggiungi intestazioni gruppo colonne** nella tabella come `<tr>` separato sopra le th normali:
- "IDENTIFICATIVO" → span 4 colonne (Ticker, Phase, CD, Inferenza)
- "PREDIZIONE MODELLO" → span 3 (Affidabilità, Pred+7, R²)
- "CURVA (Δ% vs T−60)" → span 2 (Sparkline, Pred+4/+7)
- "PORTAFOGLIO" → span 2 (P&L%, Stato)

**Aggiungi colonna Sparkline**: per ogni riga, leggi i valori `Δ% vs Pred−60 Pred -30`, `-10`, `-7`, `-5`, `-3`, `+4`, `+7`. Renderizza mini-bar chart inline: 7 barre verticali alte massimo 20px, verde se valore > 0, rosso se < 0. Usa `flex items-end gap-[2px]`.

**Aggiungi colonna badge inferenza**: `infer-ok` se `Inferenza modello === "Applicabile"`, `infer-warn` se `"Solo esplorativa"`.

---

#### 8. `desktop-ui/src/components/AccuracySheetGrid.tsx` — modifica (o crea nuovo componente `AccuracyLabView.tsx`)

**Aggiungi KPI bar** in cima con queste card (calcola su `table.rows`):

```tsx
// Colonna chiave per MAE: "Δ%\nPred−Stor\nT+7"
// Colonna storico: "Storico %\nvs T−60\nT+7"
// Colonna pred: "Δ% vs Pred−60\nPred\n+7"
const rows = table.rows.filter(r => r["Storico %\nvs T−60\nT+7"] != null);
const errors = rows.map(r => Math.abs(Number(r["Δ%\nPred−Stor\nT+7"]) || 0));
const mae = errors.length ? (errors.reduce((s,e) => s+e, 0) / errors.length * 100).toFixed(1) : "—";
const nEvents = rows.length;
// Hit rate: conteggio dove pred e reale hanno stesso segno
const hits = rows.filter(r => {
  const pred = Number(r["Δ% vs Pred−60\nPred\n+7"]);
  const real = Number(r["Storico %\nvs T−60\nT+7"]);
  return (pred > 0 && real > 0) || (pred < 0 && real < 0);
}).length;
const hitRate = nEvents ? ((hits / nEvents) * 100).toFixed(0) : "—";
```

KPI da mostrare: MAE v4 (verde se < 15pp), Hit Rate % (verde se > 60%), N° eventi, bias medio run-up (leggi dal JSON storico se disponibile altrimenti "—").

**Aggiungi toggle** in alto a destra: "v4" | "v5 q50" | "v4 vs v5". Per ora solo "v4" attivo, gli altri cambiano il label ma non filtrano ancora.

**Aggiungi filter tabs** sotto la KPI bar:
- "Tutti" (default)
- "Ultimi 90 gg" — filtra per `CD` >= oggi - 90gg
- "Ultimi 180 gg"
- "↑ Long only" — filtra per `Δ% vs Pred-60 Pred +7` > 0
- "↓ Short only"

**Nella tabella aggiungi colonna "Barra errore"**: per ogni riga, mostra la barra errore centrata — una track larga 80px con linea centrale, fill verde a destra se errore positivo, fill rosso a sinistra se negativo. Larghezza fill proporzionale all'errore (clamped a max ±30pp = 100% larghezza).

**Colonna errore colorata**: `text-[rgb(var(--signal-up))]` se > 0, `text-[rgb(var(--signal-down))]` se < 0.

---

### ORDINE DI ESECUZIONE SUGGERITO

1. `index.css` — aggiungi variabili e componenti
2. Crea `AppSidebar.tsx`
3. Crea `AppTopBar.tsx`
4. Modifica `App.tsx` — solo il return JSX
5. Modifica `CatalystHubView.tsx` — aggiungi catalyst strip
6. Modifica `Dashboard.tsx` — migliora colonne tabella
7. Modifica `InvestmentSimulationView.tsx` — KPI bar + sub-tabs + sparkline
8. Modifica `AccuracySheetGrid.tsx` — KPI bar + filter tabs + barra errore

---

### RIFERIMENTO VISIVO

Il file `mockup_supernova.html` nella root del progetto contiene il mockup interattivo completo. Aprilo con un browser qualsiasi per vedere il design esatto da replicare — incluse le tre schermate cliccabili (Catalyst Hub, Simulation, Accuracy Lab), i colori, i badge, le sparkline, e le barre errore.

---

### VINCOLI FINALI

- Usa **solo Tailwind CSS** per lo styling, niente CSS inline tranne per valori dinamici (es. altezza barre sparkline)
- Tutti i testi dell'UI restano in italiano come nell'app esistente
- Mantieni compatibilità con light mode e dark mode (le CSS variables gestiscono già tutto)
- Non aggiungere librerie npm nuove — usa solo quelle già in `package.json` (React, Tailwind, Recharts, @xyflow/react)
- Non rompere il build TypeScript — tutti i tipi devono essere corretti
- Per le date usa `new Date(dateString).toLocaleDateString("it-IT")` per formattarle in italiano
