import type { MIGResult } from "./marketInterestGate";
import type { TranslationKey } from "../shared/i18n";

export type MigDeltaSourceId = "Var.1M→5d" | "Var.giorn×5" | "slope5d×5" | "missing";

const DELTA_SOURCE_I18N: Record<MigDeltaSourceId, TranslationKey> = {
  "Var.1M→5d": "signals.mig.deltaSource.var1m",
  "Var.giorn×5": "signals.mig.deltaSource.daily",
  "slope5d×5": "signals.mig.deltaSource.slope5",
  missing: "signals.mig.deltaSource.missing",
};

export function resolveMigDeltaSourceId(raw?: string): MigDeltaSourceId {
  if (raw === "Var.1M→5d" || raw === "Var.giorn×5" || raw === "slope5d×5") return raw;
  return "missing";
}

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

/** True when MII Δ and 24h daily move disagree in sign (both meaningful). */
export function migDeltaDivergesFrom24h(
  row: Pick<MIGResult, "deltaPricePct" | "deltaSource">,
  dailyPct24h: number | null | undefined,
): boolean {
  if (dailyPct24h == null || !Number.isFinite(dailyPct24h)) return false;
  if (Math.abs(dailyPct24h) < 0.15) return false;
  if (Math.abs(row.deltaPricePct) < 0.15) return false;
  if (row.deltaSource !== "Var.1M→5d") return false;
  return Math.sign(row.deltaPricePct) !== Math.sign(dailyPct24h);
}

export function buildMigDeltaSourceLine(
  row: Pick<MIGResult, "deltaPricePct" | "deltaSource">,
  tr: (key: TranslationKey, vars?: Record<string, string | number>) => string,
): string {
  const id = resolveMigDeltaSourceId(row.deltaSource);
  return tr(DELTA_SOURCE_I18N[id], { delta: fmtPct(row.deltaPricePct) });
}

export function buildMigSlopeTooltip(
  row: MIGResult,
  dailyPct24h: number | null | undefined,
  tr: (key: TranslationKey, vars?: Record<string, string | number>) => string,
): string {
  const parts: string[] = [row.detail, buildMigDeltaSourceLine(row, tr)];
  if (migDeltaDivergesFrom24h(row, dailyPct24h)) {
    parts.push(
      tr("signals.mig.deltaSource.divergence", {
        daily: fmtPct(dailyPct24h!),
        delta: fmtPct(row.deltaPricePct),
      }),
    );
  }
  if (row.lowVolumePenalty) {
    parts.push(tr("signals.mig.deltaSource.lowVolPenalty"));
  }
  const sign = row.slopeAngleDeg >= 0 ? "+" : "";
  parts.push(`${sign}${row.slopeAngleDeg.toFixed(1)}°`);
  return parts.join(" · ");
}

export function buildMigDeltaColumnTooltip(
  row: Pick<MIGResult, "deltaPricePct" | "deltaSource">,
  dailyPct24h: number | null | undefined,
  tr: (key: TranslationKey, vars?: Record<string, string | number>) => string,
): string {
  const parts = [tr("signals.mig.col.deltaTip"), buildMigDeltaSourceLine(row, tr)];
  if (migDeltaDivergesFrom24h(row, dailyPct24h)) {
    parts.push(
      tr("signals.mig.deltaSource.divergenceShort", {
        daily: fmtPct(dailyPct24h!),
      }),
    );
  }
  return parts.join(" · ");
}
