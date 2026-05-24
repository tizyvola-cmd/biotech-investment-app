import type { SheetCellRenderResult, SheetCellRenderer } from "../components/ConfigurableSheetGrid";
import {
  renderSheetCellLinks,
  sheetCellAsLinkOrNct,
  sheetCellPlainText,
} from "./cellLinks";
import { withSharedTableColors } from "./sharedTableCellRenderer";

function plainCell(raw: unknown): SheetCellRenderResult {
  if (raw === null || raw === undefined) return { text: "—" };
  if (typeof raw === "number") {
    const text = Number.isInteger(raw) ? String(raw) : raw.toFixed(2);
    return { text, title: text };
  }
  const text = String(raw);
  return { text, title: text };
}

/** Renderer Clinical OpenFDA: NCT ID → link CT.gov (snapshot ``href`` o pattern ``NCT…``). */
export const clinicalSheetCellRenderer: SheetCellRenderer = withSharedTableColors(
  (column, raw) => {
    const linkContent = renderSheetCellLinks(raw);
    if (linkContent) {
      const text = sheetCellPlainText(raw) || "—";
      const nct = sheetCellAsLinkOrNct(raw, column);
      return { text, title: nct?.href ?? text, content: linkContent };
    }
    const nct = sheetCellAsLinkOrNct(raw, column);
    if (nct) {
      const linkNode = renderSheetCellLinks({ text: nct.text, href: nct.href });
      return { text: nct.text, title: nct.href, content: linkNode ?? nct.text };
    }
    return plainCell(raw);
  }
);
