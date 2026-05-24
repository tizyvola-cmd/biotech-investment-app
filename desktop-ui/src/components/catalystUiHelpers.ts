import type { CatalystRow } from "../types";

export function catalystDirectionKind(direction: string): "up" | "down" | "neutral" {
  if (direction.includes("↑")) return "up";
  if (direction.includes("↓")) return "down";
  return "neutral";
}

export function catalystSignalMeta(row: CatalystRow): { className: string; label: string } {
  const kind = catalystDirectionKind(row.direction);
  const strong =
    row.confidence != null && row.confidence > 0.75 && kind !== "neutral";
  const prefix = strong ? "★ " : "";
  if (kind === "up") return { className: "signal-up", label: `${prefix}▲ Long` };
  if (kind === "down") return { className: "signal-down", label: `${prefix}▼ Short` };
  return { className: "signal-neutral", label: "● Neutro" };
}

export function daysUntilCompletion(completionDate: string): number | null {
  if (!completionDate) return null;
  const d = new Date(completionDate);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

export function qualityDotClass(score: number | null): string | null {
  if (score == null || Number.isNaN(score)) return null;
  if (score < 1) return "quality-dot-green";
  if (score <= 2) return "quality-dot-yellow";
  return "quality-dot-red";
}

export function fmtPctSigned(v: number | null): string {
  if (v == null || Number.isNaN(v)) return "—";
  const s = v > 0 ? "+" : "";
  return `${s}${v.toFixed(1)}%`;
}

export function upcomingCatalystStrip(rows: CatalystRow[], limit = 5): CatalystRow[] {
  return [...rows]
    .filter((r) => r.completionDate)
    .sort(
      (a, b) =>
        new Date(a.completionDate).getTime() - new Date(b.completionDate).getTime()
    )
    .slice(0, limit);
}
