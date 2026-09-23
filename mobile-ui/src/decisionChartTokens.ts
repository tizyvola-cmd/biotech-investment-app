/** Design tokens for mobile Decision Chart zones (light / dark). */
import type { CSSProperties } from "react";
import type { MobileTheme } from "./hooks/useTheme";
import type { DecisionRec } from "./decisionChartLogic";

export type DecisionChartTheme = {
  pageBg: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  borderDefault: string;
  varPos: string;
  varNeg: string;
  varFlat: string;
  filterActive: string;
  filterActiveTxt: string;
  filterGain: string;
  filterLoss: string;
  chipBg: string;
  zones: Record<
    DecisionRec,
    {
      bg: string;
      headerBg: string;
      text: string;
      dot: string;
      chipBorder: string;
    }
  >;
};

export const decisionChartLight: DecisionChartTheme = {
  pageBg: "#F2F1EC",
  textPrimary: "#1A1A18",
  textSecondary: "#5C5B57",
  textMuted: "#9B9A96",
  borderDefault: "rgba(0,0,0,0.08)",
  varPos: "#3B6D11",
  varNeg: "#A32D2D",
  varFlat: "#9B9A96",
  filterActive: "#1A1A18",
  filterActiveTxt: "#F2F1EC",
  filterGain: "#27500A",
  filterLoss: "#791F1F",
  chipBg: "rgba(255,255,255,0.7)",
  zones: {
    buy: {
      bg: "#EAF3DE",
      headerBg: "#D4EBB5",
      text: "#27500A",
      dot: "#639922",
      chipBorder: "rgba(99,153,34,0.15)",
    },
    hold: {
      bg: "#E6F1FB",
      headerBg: "#CBE3F7",
      text: "#0C447C",
      dot: "#185FA5",
      chipBorder: "rgba(24,95,165,0.15)",
    },
    review: {
      bg: "#FAEEDA",
      headerBg: "#F5D9A5",
      text: "#633806",
      dot: "#BA7517",
      chipBorder: "rgba(186,117,23,0.15)",
    },
    sell: {
      bg: "#FCEBEB",
      headerBg: "#F9CCCC",
      text: "#791F1F",
      dot: "#E24B4A",
      chipBorder: "rgba(226,75,74,0.15)",
    },
  },
};

export const decisionChartDark: DecisionChartTheme = {
  pageBg: "#0F0F0E",
  textPrimary: "#F0EFE9",
  textSecondary: "#A09F9A",
  textMuted: "#5C5B57",
  borderDefault: "rgba(255,255,255,0.08)",
  varPos: "#C0DD97",
  varNeg: "#F7C1C1",
  varFlat: "#5C5B57",
  filterActive: "#F0EFE9",
  filterActiveTxt: "#0F0F0E",
  filterGain: "#C0DD97",
  filterLoss: "#F7C1C1",
  chipBg: "rgba(255,255,255,0.06)",
  zones: {
    buy: {
      bg: "#173404",
      headerBg: "#1F4A06",
      text: "#C0DD97",
      dot: "#97C459",
      chipBorder: "rgba(151,196,89,0.2)",
    },
    hold: {
      bg: "#042C53",
      headerBg: "#063A6E",
      text: "#85B7EB",
      dot: "#378ADD",
      chipBorder: "rgba(55,138,221,0.2)",
    },
    review: {
      bg: "#412402",
      headerBg: "#593208",
      text: "#FAC775",
      dot: "#EF9F27",
      chipBorder: "rgba(239,159,39,0.2)",
    },
    sell: {
      bg: "#501313",
      headerBg: "#6B1B1B",
      text: "#F7C1C1",
      dot: "#E24B4A",
      chipBorder: "rgba(226,75,74,0.2)",
    },
  },
};

export function decisionChartTheme(mode: MobileTheme): DecisionChartTheme {
  return mode === "light" ? decisionChartLight : decisionChartDark;
}

export function decisionChartThemeStyle(mode: MobileTheme): CSSProperties {
  const t = decisionChartTheme(mode);
  const vars: Record<string, string> = {
    "--dc-page-bg": t.pageBg,
    "--dc-text-primary": t.textPrimary,
    "--dc-text-secondary": t.textSecondary,
    "--dc-text-muted": t.textMuted,
    "--dc-border": t.borderDefault,
    "--dc-var-pos": t.varPos,
    "--dc-var-neg": t.varNeg,
    "--dc-var-flat": t.varFlat,
    "--dc-filter-active": t.filterActive,
    "--dc-filter-active-txt": t.filterActiveTxt,
    "--dc-filter-gain": t.filterGain,
    "--dc-filter-loss": t.filterLoss,
    "--dc-chip-bg": t.chipBg,
  };
  for (const rec of ["buy", "hold", "review", "sell"] as const) {
    const z = t.zones[rec];
    vars[`--dc-zone-${rec}-bg`] = z.bg;
    vars[`--dc-zone-${rec}-header`] = z.headerBg;
    vars[`--dc-zone-${rec}-text`] = z.text;
    vars[`--dc-zone-${rec}-dot`] = z.dot;
    vars[`--dc-zone-${rec}-chip-border`] = z.chipBorder;
  }
  return vars as CSSProperties;
}
