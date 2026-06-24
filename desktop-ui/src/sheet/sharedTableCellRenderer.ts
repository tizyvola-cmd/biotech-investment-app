import type { ReactNode } from "react";
import type { SheetCellRenderResult, SheetCellRenderer } from "../components/ConfigurableSheetGrid";
import {
  renderSheetCellLinks,
  sheetCellAsLink,
  sheetCellAsMultiLink,
  sheetCellPlainText,
} from "./cellLinks";
import {
  fmtSharedPctCell,
  sharedTableCellExtras,
} from "./sharedTableCellStyle";

function plainText(raw: unknown): string {
  if (raw === null || raw === undefined) return "—";
  if (typeof raw === "number") {
    return Number.isInteger(raw) ? String(raw) : raw.toFixed(2);
  }
  return String(raw);
}

function linkRender(raw: unknown): SheetCellRenderResult | null {
  const linkContent = renderSheetCellLinks(raw);
  if (linkContent) {
    const text = sheetCellPlainText(raw) || "—";
    const multi = sheetCellAsMultiLink(raw);
    const single = sheetCellAsLink(raw);
    const title = multi
      ? multi.links.map((l) => l.href).join("\n")
      : single?.href ?? text;
    return { text, title, content: linkContent as ReactNode };
  }
  return null;
}

/** Renderer default per tutte le griglie: link + colori stile Simulation. */
export const sharedTableCellRenderer: SheetCellRenderer = (column, raw, row) => {
  const linked = linkRender(raw);
  if (linked?.content) {
    const extras = sharedTableCellExtras(column, raw, row);
    return {
      ...linked,
      style: extras?.style,
      icon: extras?.icon,
      iconColor: extras?.iconColor,
    };
  }

  const fmtPct = fmtSharedPctCell(column, raw);
  const text = fmtPct ?? plainText(raw);
  const extras = sharedTableCellExtras(column, raw, row);
  return {
    text,
    title: text,
    style: extras?.style,
    icon: extras?.icon,
    iconColor: extras?.iconColor,
  };
};

/** Combina renderer custom (link) con colori condivisi. */
export function withSharedTableColors(
  base: SheetCellRenderer
): SheetCellRenderer {
  return (column, raw, row) => {
    const rendered = base(column, raw, row);
    const extras = sharedTableCellExtras(column, raw, row);
    const fmtPct = fmtSharedPctCell(column, raw);
    return {
      ...rendered,
      text: fmtPct ?? rendered.text,
      style: rendered.style ?? extras?.style,
      icon: rendered.icon ?? extras?.icon,
      iconColor: rendered.iconColor ?? extras?.iconColor,
    };
  };
}
