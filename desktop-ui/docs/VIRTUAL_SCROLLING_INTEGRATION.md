# Sistema Cache + Real-Time per Scrolling Efficiente

## Panoramica

Sistema completo per ottimizzare tabelle grandi con tre componenti:
1. **Virtual Scrolling** - Renderizza solo righe visibili
2. **Cache Paginata Backend** - API con paginazione per ridurre payload
3. **Real-Time Selettivo** - Aggiorna solo colonne real-time per righe visibili

## Componenti Implementati

### 1. VirtualSheetGrid (`src/components/VirtualSheetGrid.tsx`)

Componente React per virtual scrolling nativo senza dipendenze esterne.

**Props:**
- `table: SheetTable | null` - Dati tabella
- `rowHeight: number` - Altezza riga in px (default: 40)
- `visibleRowCount: number` - Numero righe visibili (default: 20)
- `bufferRowCount: number` - Buffer righe sopra/sotto (default: 5)
- `renderRow: (row, index) => ReactNode` - Renderer riga
- `renderHeader: () => ReactNode` - Renderer header

**Esempio:**
```tsx
<VirtualSheetGrid
  table={financialTable}
  rowHeight={40}
  visibleRowCount={25}
  renderRow={(row, index) => <FinancialRow row={row} />}
  renderHeader={() => <FinancialHeader />}
/>
```

### 2. Backend API Paginata (`supernova_api.py`)

Endpoint modificati per supportare paginazione:

**Financial:**
```
GET /api/sheets/financial?page=1&page_size=50
```

**Simulation:**
```
GET /api/sheets/simulation?page=1&page_size=50
```

**Risposta:**
```json
{
  "columns": [...],
  "rows": [...],
  "_pagination": {
    "page": 1,
    "page_size": 50,
    "total": 500,
    "total_pages": 10,
    "has_next": true,
    "has_prev": false
  }
}
```

### 3. Real-Time Selettivo

#### Hook: `useVisibleRows` (`src/hooks/useVisibleRows.ts`)

Traccia quali righe sono visibili usando Intersection Observer.

```tsx
const { visibleIndices, registerRow, unregisterRow } = useVisibleRows({
  rootMargin: "200px", // Pre-load 200px prima visibilità
});

// In rendering riga:
<div
  data-row-index={index}
  ref={(el) => registerRow(index, el)}
>
  {/* contenuto riga */}
</div>
```

#### Componente: `RealTimeSheetUpdater` (`src/components/RealTimeSheetUpdater.tsx`)

Aggiorna colonne real-time solo per righe visibili.

```tsx
<RealTimeSheetUpdater
  realTimeColumns={["currentPrice", "dailyChange_%"]}
  tableData={tableRows}
  onUpdate={(updates) => {
    // updates: Map<rowIndex, partialRowData>
    applyUpdates(updates);
  }}
/>
```

#### Hook: `useRealTimeSheetIntegration`

Helper per integrazione rapida con tabelle.

```tsx
const { getRowProps, visibleIndices } = useRealTimeSheetIntegration();

// In rendering riga:
<tr {...getRowProps(index)}>
  <td>{row.ticker}</td>
  <td>{row.currentPrice}</td>
</tr>
```

## Integrazione con ConfigurableSheetGrid

Per integrare con `ConfigurableSheetGrid` esistente:

### Opzione 1: Sostituzione Completa

Sostituisci `ConfigurableSheetGrid` con `VirtualSheetGrid` per tabelle grandi (>100 righe).

### Opzione 2: Ibrido

Usa `VirtualSheetGrid` per Financial/Simulation, mantieni `ConfigurableSheetGrid` per tabelle piccole.

```tsx
{table.rows.length > 100 ? (
  <VirtualSheetGrid
    table={table}
    rowHeight={40}
    renderRow={renderRow}
    renderHeader={renderHeader}
  />
) : (
  <ConfigurableSheetGrid
    table={table}
    renderCell={renderCell}
    // ... altre props
  />
)}
```

## Integrazione Real-Time

### Passo 1: Identificare Colonne Real-Time

```tsx
const REALTIME_COLUMNS = [
  "Prezzo Corrente ($)",
  "Var. Giorn. %",
  "currentPrice",
  "dailyChange_%",
];
```

### Passo 2: Aggiungere RealTimeSheetUpdater

```tsx
<RealTimeSheetUpdater
  realTimeColumns={REALTIME_COLUMNS}
  tableData={table.rows}
  onUpdate={(updates) => {
    setTableData((prev) => {
      const next = [...prev];
      for (const [index, update] of updates) {
        next[index] = { ...next[index], ...update };
      }
      return next;
    });
  }}
/>
```

### Passo 3: Tracciare Visibilità Righe

```tsx
const { getRowProps } = useRealTimeSheetIntegration();

// Nel render riga:
<div {...getRowProps(index)}>
  {/* celle */}
</div>
```

## Performance Attese

### Prima
- 500 righe: ~5000 DOM nodes
- Scrolling: laggy
- Real-time: aggiorna tutte le celle

### Dopo
- 500 righe: ~30 DOM nodes (visibili + buffer)
- Scrolling: fluido
- Real-time: aggiorna solo ~20 celle visibili

## Note Importanti

1. **Altezza Riga Fissa**: Virtual scrolling richiede altezza riga costante per calcolo preciso
2. **Fallback**: Se IntersectionObserver non supportato, tutte le righe considerate visibili
3. **Debounce**: Aggiornamenti real-time debounced a 100ms per evitare flickering
4. **Pre-fetch**: Buffer 200px prima visibilità per caricamento anticipato

## Testing

Testare con:
1. Tabella Financial (500+ ticker)
2. Tabella Simulation (100+ righe)
3. Scrolling veloce
4. Aggiornamenti real-time durante scroll
