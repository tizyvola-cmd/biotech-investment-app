import type { SheetCellRenderResult, SheetCellRenderer } from "../components/ConfigurableSheetGrid";
import {
  renderSheetCellLinks,
  sheetCellAsLinkOrSec,
  sheetCellPlainText,
} from "./cellLinks";
import { formatSecK8ColumnHeader } from "./secK8Styles";
import {
  fmtSharedPctCell,
  sharedTableCellExtras,
} from "./sharedTableCellStyle";

function plainCell(raw: unknown): SheetCellRenderResult {
  if (raw === null || raw === undefined) return { text: "—" };
  if (typeof raw === "number") {
    const text = Number.isInteger(raw) ? String(raw) : raw.toFixed(2);
    return { text, title: text };
  }
  const text = sheetCellPlainText(raw) || String(raw);
  return { text, title: text };
}

function applySharedColors(
  column: string,
  raw: unknown,
  row: Record<string, unknown>,
  rendered: SheetCellRenderResult
): SheetCellRenderResult {
  const extras = sharedTableCellExtras(column, raw, row);
  const fmtPct = fmtSharedPctCell(column, raw);
  const text = fmtPct ?? rendered.text;
  return {
    ...rendered,
    text,
    title: rendered.title ?? text,
    style: rendered.style ?? extras?.style,
    icon: rendered.icon ?? extras?.icon,
    iconColor: rendered.iconColor ?? extras?.iconColor,
  };
}

/** Renderer SEC K-8: link EDGAR / CIK + colori stile Simulation (▲▼● su Δ%). */
export const secK8SheetCellRenderer: SheetCellRenderer = (column, raw, row) => {
  const linkContent = renderSheetCellLinks(raw);
  if (linkContent) {
    const text = sheetCellPlainText(raw) || "—";
    const sec = sheetCellAsLinkOrSec(raw, column, row);
    return applySharedColors(column, raw, row, {
      text,
      title: sec?.href ?? text,
      content: linkContent,
    });
  }
  const sec = sheetCellAsLinkOrSec(raw, column, row);
  if (sec) {
    const linkNode = renderSheetCellLinks({ text: sec.text, href: sec.href });
    return applySharedColors(column, raw, row, {
      text: sec.text,
      title: sec.href,
      content: linkNode ?? sec.text,
    });
  }
  return applySharedColors(column, raw, row, plainCell(raw));
};

export { formatSecK8ColumnHeader };
