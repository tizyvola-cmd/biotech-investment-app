# Guida Test Sistema Cache + Real-Time

## Componenti da Testare

### 1. VirtualSheetGrid
**File**: `src/components/VirtualSheetGridTest.tsx`

**Come testare**:
1. Aggiungi route in App.tsx per accedere alla pagina test
2. Naviga alla pagina test
3. Verifica:
   - Scrolling fluido con 500+ righe
   - Solo righe visibili renderizzate (controlla DOM inspector)
   - Header fisso durante scroll
   - Buffer righe caricate prima visibilità

**Atteso**:
- Scrolling senza lag
- ~30 DOM nodes invece di 500+
- Header sempre visibile

### 2. API Paginata Backend
**File**: `test_pagination_api.py`

**Come testare**:
```bash
cd "c:\coding\Biotech_Investment app 6"
python test_pagination_api.py
```

**Verifica output**:
- Tutti i test cases passano
- Metadata paginazione corretti (total, has_next, has_prev)
- Indici calcolati correttamente

**Atteso**:
```
Total rows: 500
--------------------------------------------------
Page 1, Size 50:
  Rows: 50 (indices 0-49)
  Metadata: {...}
  ✓ Assertions passed
...
All pagination logic tests passed!
```

### 3. useVisibleRows Hook
**File**: `src/components/UseVisibleRowsTest.tsx`

**Come testare**:
1. Aggiungi route in App.tsx
2. Naviga alla pagina test
3. Verifica:
   - Righe visibili evidenziate in verde
   - Contatore visible indices aggiornato durante scroll
   - Margin 100px pre-carica righe prima visibilità

**Atteso**:
- Righe verdi quando in viewport + 100px
- Contatore aggiornato in real-time
- Scroll fluido

### 4. RealTimeSheetUpdater
**File**: `src/components/RealTimeSheetUpdaterTest.tsx`

**Come testare**:
1. Aggiungi route in App.tsx
2. Naviga alla pagina test
3. Verifica:
   - Righe visibili evidenziate in verde
   - Contatore updates incrementa quando righe visibili
   - Timestamp last update aggiornato

**Atteso**:
- Aggiornamenti solo per righe visibili
- Contatore updates aumenta
- Timestamp aggiornato

## Integrazione in App.tsx

Per testare i componenti React, aggiungi temporaneamente:

```tsx
import { VirtualSheetGridTest } from "./components/VirtualSheetGridTest";
import { UseVisibleRowsTest } from "./components/UseVisibleRowsTest";
import { RealTimeSheetUpdaterTest } from "./components/RealTimeSheetUpdaterTest";

// Nel routing:
{location === "test-virtual" && <VirtualSheetGridTest />}
{location === "test-visible" && <UseVisibleRowsTest />}
{location === "test-realtime" && <RealTimeSheetUpdaterTest />}
```

Oppure crea una pagina test dedicata con tab per switchare tra i test.

## Checklist Test

- [ ] VirtualSheetGrid: scrolling fluido con 500 righe
- [ ] VirtualSheetGrid: header fisso
- [ ] VirtualSheetGrid: buffer righe caricate
- [ ] API paginata: logica corretta (test Python)
- [ ] API paginata: endpoint funzionano (con server attivo)
- [ ] useVisibleRows: righe evidenziate correttamente
- [ ] useVisibleRows: contatore aggiornato
- [ ] RealTimeSheetUpdater: aggiornamenti solo righe visibili
- [ ] RealTimeSheetUpdater: contatore updates incrementa

## Note

- I test React richiedono dev server attivo (`npm run dev`)
- Il test Python può essere eseguito standalone
- Per testare API paginata con server reale, avvia supernova_api e chiama:
  - `GET http://127.0.0.1:8765/api/sheets/financial?page=1&page_size=50`
  - `GET http://127.0.0.1:8765/api/sheets/simulation?page=1&page_size=50`
