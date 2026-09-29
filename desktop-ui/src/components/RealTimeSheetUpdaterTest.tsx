import { useState } from "react";
import { RealTimeSheetUpdater } from "./RealTimeSheetUpdater";
import { useRealTimeSheetIntegration } from "./RealTimeSheetUpdater";

// Dati test simulati
function generateTestTable(count: number) {
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      ticker: `TICKER${i}`,
      name: `Test Company ${i}`,
      currentPrice: (Math.random() * 100 + 10).toFixed(2),
      "Var. Giorn. %": (Math.random() * 20 - 10).toFixed(2),
    });
  }
  return rows;
}

export function RealTimeSheetUpdaterTest() {
  const [rowCount, setRowCount] = useState(50);
  const [tableData, setTableData] = useState(() => generateTestTable(rowCount));
  const [updateCount, setUpdateCount] = useState(0);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);

  const { getRowProps, visibleIndices } = useRealTimeSheetIntegration();

  const handleRowCountChange = (value: number) => {
    setRowCount(value);
    setTableData(generateTestTable(value));
    setUpdateCount(0);
    setLastUpdate(null);
  };

  const handleUpdate = (updates: Map<number, Record<string, unknown>>) => {
    setUpdateCount((prev) => prev + 1);
    setLastUpdate(new Date().toLocaleTimeString());

    setTableData((prev) => {
      const next = [...prev];
      for (const [index, update] of updates) {
        if (index < next.length) {
          next[index] = { ...next[index], ...update };
        }
      }
      return next;
    });
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">RealTimeSheetUpdater Test</h1>

      <div className="mb-4 flex items-center gap-4">
        <label className="text-sm">
          Row Count:
          <input
            type="number"
            value={rowCount}
            onChange={(e) => handleRowCountChange(Number(e.target.value))}
            className="ml-2 w-24 px-2 py-1 border rounded"
            min="10"
            max="200"
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

      <div className="mb-4 p-4 bg-slate-100 rounded text-sm">
        <p><strong>Visible rows:</strong> {visibleIndices.size}</p>
        <p><strong>Total updates:</strong> {updateCount}</p>
        <p><strong>Last update:</strong> {lastUpdate || "Never"}</p>
      </div>

      <div className="border border-[rgb(var(--border))]/40 rounded-lg overflow-hidden bg-white">
        <div className="flex items-center bg-slate-100 px-4 py-2 text-[11px] font-semibold border-b border-[rgb(var(--border))]/40">
          <div className="w-24">Ticker</div>
          <div className="flex-1">Name</div>
          <div className="w-20 text-right">Price</div>
          <div className="w-20 text-right">Change %</div>
          <div className="w-20 text-center">Visible</div>
        </div>

        <div className="h-[400px] overflow-auto">
          {tableData.map((row, index) => (
            <div
              key={index}
              {...getRowProps(index)}
              className={`flex items-center border-b border-[rgb(var(--border))]/20 px-4 py-2 text-[11px] ${
                visibleIndices.has(index) ? "bg-emerald-50" : "bg-white"
              }`}
            >
              <div className="w-24 font-semibold">{String(row.ticker)}</div>
              <div className="flex-1 truncate">{String(row.name)}</div>
              <div className="w-20 text-right tabular-nums">${String(row.currentPrice)}</div>
              <div className="w-20 text-right tabular-nums">{String(row["Var. Giorn. %"])}%</div>
              <div className="w-20 text-center">
                {visibleIndices.has(index) ? "✓" : "○"}
              </div>
            </div>
          ))}
        </div>
      </div>

      <RealTimeSheetUpdater
        realTimeColumns={["currentPrice", "Var. Giorn. %"]}
        tableData={tableData}
        onUpdate={handleUpdate}
      />

      <div className="mt-4 text-sm text-ink-muted">
        <p>Scroll to see real-time updates trigger for visible rows only.</p>
        <p>Updates are simulated (mock API call would be made in production).</p>
        <p>Green rows are currently visible and would receive real-time updates.</p>
      </div>
    </div>
  );
}
