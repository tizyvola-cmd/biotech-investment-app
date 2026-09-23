import { useState } from "react";
import { useVisibleRows } from "../hooks/useVisibleRows";

export function UseVisibleRowsTest() {
  const [rowCount, setRowCount] = useState(100);
  const { visibleIndices, registerRow } = useVisibleRows({
    rootMargin: "100px",
    debounceMs: 50,
  });

  const handleRowCountChange = (value: number) => {
    setRowCount(value);
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">useVisibleRows Hook Test</h1>

      <div className="mb-4 flex items-center gap-4">
        <label className="text-sm">
          Row Count:
          <input
            type="number"
            value={rowCount}
            onChange={(e) => handleRowCountChange(Number(e.target.value))}
            className="ml-2 w-24 px-2 py-1 border rounded"
            min="10"
            max="500"
            step="10"
          />
        </label>
      </div>

      <div className="mb-4 p-4 bg-slate-100 rounded text-sm">
        <p><strong>Visible indices:</strong> {visibleIndices.size > 0 ? Array.from(visibleIndices).sort((a, b) => a - b).join(", ") : "None"}</p>
        <p><strong>Total visible:</strong> {visibleIndices.size}</p>
      </div>

      <div className="border border-[rgb(var(--border))]/40 rounded-lg overflow-hidden bg-white h-[500px] overflow-auto">
        {Array.from({ length: rowCount }).map((_, i) => (
          <div
            key={i}
            data-row-index={i}
            ref={(el) => registerRow(i, el)}
            className={`border-b border-[rgb(var(--border))]/20 px-4 py-2 text-[11px] ${
              visibleIndices.has(i) ? "bg-emerald-50" : "bg-white"
            }`}
          >
            <span className="font-semibold">Row {i}:</span>
            <span className="ml-2">
              {visibleIndices.has(i) ? "✓ VISIBLE" : "○ Not visible"}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-4 text-sm text-ink-muted">
        <p>Scroll to see which rows become visible (highlighted in green).</p>
        <p>Intersection Observer tracks visibility with 100px margin.</p>
      </div>
    </div>
  );
}
