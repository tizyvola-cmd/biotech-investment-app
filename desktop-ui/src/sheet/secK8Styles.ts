/** Intestazioni compatte foglio SEC K-8 (colori via sharedTableCellStyle). */

export function formatSecK8ColumnHeader(column: string): string {
  if (column.includes("Δ% vs baseline")) {
    const m = column.match(/\+(\d)/);
    if (m) return `Δ% +${m[1]}`;
  }
  const parts = column.split("\n").map((s) => s.trim()).filter(Boolean);
  const joined = parts.length > 1 ? parts.join(" · ") : column;
  return joined.replace(/\bK-8\b/g, "8-K");
}
