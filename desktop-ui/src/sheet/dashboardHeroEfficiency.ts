/** Compact sub-line for the dashboard «success efficiency» hero KPI. */
import type { SimLoopActivityMetrics } from "./dashboardSimLoopActivity";
import { formatSimLoopActivityFragment } from "./dashboardSimLoopActivity";

export function buildDashboardRecEfficiencySub(args: {
  lang: "it" | "en";
  portfolioMtmEur: number | null;
  portfolioClosedWinPct: number | null;
  simLoopPct: number | null;
  advicePct: number | null;
  simActivity?: SimLoopActivityMetrics | null;
}): string {
  const parts: string[] = [];
  const activityFrag =
    args.simActivity != null ? formatSimLoopActivityFragment(args.simActivity, args.lang) : null;
  if (activityFrag) parts.push(activityFrag);
  if (args.portfolioMtmEur != null && Number.isFinite(args.portfolioMtmEur)) {
    parts.push(
      args.lang === "it"
        ? `portaf. MTM ${fmtSignedUsd(args.portfolioMtmEur)}`
        : `portf. MTM ${fmtSignedUsd(args.portfolioMtmEur)}`,
    );
  }
  if (args.portfolioClosedWinPct != null) {
    parts.push(
      args.lang === "it"
        ? `chiusi ${args.portfolioClosedWinPct}%`
        : `closed ${args.portfolioClosedWinPct}%`,
    );
  }
  if (args.simLoopPct != null) {
    parts.push(`sim ${args.simLoopPct}%`);
  }
  if (args.advicePct != null) {
    parts.push(args.lang === "it" ? `raccom. ${args.advicePct}%` : `advice ${args.advicePct}%`);
  }
  if (!parts.length) {
    return args.lang === "it" ? "Nessun esito ancora" : "No outcomes yet";
  }
  return parts.join(" · ");
}

function fmtSignedUsd(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : v > 0 ? "+" : "";
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function companyNameFromSimRow(row: Record<string, unknown>): string {
  const name = String(
    row.Società ?? row.Nome ?? row.Company ?? row["Company Name"] ?? "",
  ).trim();
  const ticker = String(row.Ticker ?? "")
    .trim()
    .toUpperCase();
  return name || ticker || "—";
}
