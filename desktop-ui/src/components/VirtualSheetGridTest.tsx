import { useState } from "react";
import { VirtualSheetGrid } from "./VirtualSheetGrid";

// Dati test simulati
function generateTestRows(count: number) {
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      ticker: `TICKER${i}`,
      name: `Test Company ${i}`,
      currentPrice: (Math.random() * 100 + 10).toFixed(2),
      dailyChange: (Math.random() * 20 - 10).toFixed(2),
      marketCap: (Math.random() * 10 + 1).toFixed(1),
      sector: i % 3 === 0 ? "Healthcare" : i % 3 === 1 ? "Technology" : "Finance",
    });
  }
  return rows;
}

export function VirtualSheetGridTest() {
  const [rowCount, setRowCount] = useState(500);
  const [table, setTable] = useState(() => ({
    sheet: "test",
    columns: ["ticker", "name", "currentPrice", "dailyChange", "marketCap", "sector"],
    rows: generateTestRows(rowCount),
  }));

  const handleRowCountChange = (value: number) => {
    setRowCount(value);
    setTable({
      sheet: "test",
      columns: ["ticker", "name", "currentPrice", "dailyChange", "marketCap", "sector"],
      rows: generateTestRows(value),
    });
  };

  const renderRow = (row: Record<string, unknown>, _index: number) => {
    const dailyChange = Number(row.dailyChange);
    const changeColor = dailyChange >= 0 ? "text-emerald-600" : "text-rose-600";
    const changeSign = dailyChange >= 0 ? "+" : "";

    return (
      <div className="flex items-center border-b border-[rgb(var(--border))]/20 hover:bg-slate-50/50 px-4 py-2 text-[11px]">
        <div className="w-24 font-semibold">{String(row.ticker)}</div>
        <div className="flex-1 truncate">{String(row.name)}</div>
        <div className="w-20 text-right tabular-nums">${String(row.currentPrice)}</div>
        <div className={`w-20 text-right tabular-nums ${changeColor}`}>
          {changeSign}{String(row.dailyChange)}%
        </div>
        <div className="w-20 text-right tabular-nums">${String(row.marketCap)}B</div>
        <div className="w-32 truncate">{String(row.sector)}</div>
      </div>
    );
  };

  const renderHeader = () => {
    return (
      <div className="flex items-center bg-slate-100 px-4 py-2 text-[11px] font-semibold border-b border-[rgb(var(--border))]/40">
        <div className="w-24">Ticker</div>
        <div className="flex-1">Name</div>
        <div className="w-20 text-right">Price</div>
        <div className="w-20 text-right">Change %</div>
        <div className="w-20 text-right">Market Cap</div>
        <div className="w-32">Sector</div>
      </div>
    );
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">VirtualSheetGrid Test</h1>

      <div className="mb-4 flex items-center gap-4">
        <label className="text-sm">
          Row Count:
          <input
            type="number"
            value={rowCount}
            onChange={(e) => handleRowCountChange(Number(e.target.value))}
            className="ml-2 w-24 px-2 py-1 border rounded"
            min="10"
            max="5000"
            step="10"
          />
        </label>
        <button
          onClick={() => handleRowCountChange(rowCount)}
          className="px-3 py-1 bg-sky-600 text-white rounded hover:bg-sky-700 text-sm"
        >
          Regenerate
        </button>
      </div>

      <div className="border border-[rgb(var(--border))]/40 rounded-lg overflow-hidden bg-white">
        <VirtualSheetGrid
          table={table}
          loading={false}
          error={null}
          onReload={() => {}}
          sheetId="test"
          rowHeight={36}
          visibleRowCount={20}
          bufferRowCount={5}
          renderRow={renderRow}
          renderHeader={renderHeader}
          className="h-[500px]"
        />
      </div>

      <div className="mt-4 text-sm text-ink-muted">
        <p>Total rows: {table.rows.length}</p>
        <p>Scroll to test virtual rendering performance.</p>
      </div>
    </div>
  );
}
