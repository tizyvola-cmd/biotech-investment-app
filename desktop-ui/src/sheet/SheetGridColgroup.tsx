import { equalGridColPct } from "./sheetGridTable";

type SheetGridColgroupProps = {
  /** Numero colonne → larghezze uguali che sommano 100%. */
  columnCount?: number;
  /** Larghezze % esplicite (devono sommare ~100). */
  widths?: readonly number[];
};

export function SheetGridColgroup({ columnCount, widths }: SheetGridColgroupProps) {
  const pct =
    widths && widths.length > 0
      ? [...widths]
      : equalGridColPct(columnCount ?? 1);
  return (
    <colgroup>
      {pct.map((w, i) => (
        <col key={i} style={{ width: `${w}%` }} />
      ))}
    </colgroup>
  );
}
