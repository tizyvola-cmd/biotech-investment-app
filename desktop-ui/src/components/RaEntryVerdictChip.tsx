import { useLang, useT } from "../shared/i18n";
import {
  deriveRaEntryInvestVerdict,
  raEntryVerdictLabel,
  type RaEntryInvestVerdictResult,
} from "../sheet/raEntryInvestVerdict";

function verdictToneClass(
  verdict: RaEntryInvestVerdictResult["verdict"],
): string {
  switch (verdict) {
    case "buy":
      return "bg-emerald-500/15 text-emerald-800 border-emerald-500/35 dark:text-emerald-300";
    case "reduce":
    case "avoid":
      return "bg-red-500/12 text-red-800 border-red-500/35 dark:text-red-300";
    case "hold":
      return "bg-slate-500/10 text-slate-700 border-slate-400/35 dark:text-slate-300";
    default:
      return "bg-surface/60 text-ink-muted border-[rgb(var(--border))]/40";
  }
}

export function RaEntryVerdictChip({
  entryRa,
  hasPosition,
  precomputed,
  compact = true,
  className = "",
}: {
  entryRa: number | null | undefined;
  hasPosition: boolean;
  precomputed?: RaEntryInvestVerdictResult | null;
  compact?: boolean;
  className?: string;
}) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";
  const result =
    precomputed ??
    deriveRaEntryInvestVerdict({
      entryRa,
      hasPosition,
    });

  if (result.verdict == null) {
    return <span className={`text-[9px] text-ink-muted/50 ${className}`}>—</span>;
  }

  const label = raEntryVerdictLabel(result.verdict, it ? "it" : "en");
  const th = result.thresholds;
  const tip = t("sim.raVerdict.tip", {
    verdict: label,
    ra: entryRa != null ? entryRa.toFixed(1) : "—",
    investMin: th.investMinScore,
    divestBelow: th.divestBelowScore,
    tier: th.tier,
    source:
      th.source === "snapshot"
        ? t("sim.raVerdict.sourceSnapshot", { week: th.snapshotWeek ?? "?" })
        : t("sim.raVerdict.sourceDefault"),
    note: result.downgraded ? t("sim.raVerdict.downgradedNote") : "",
  });

  return (
    <span
      className={`inline-flex items-center rounded-full border font-bold uppercase tracking-wide tabular-nums ${
        compact ? "px-1.5 py-0.5 text-[8px]" : "px-2 py-0.5 text-[9px]"
      } ${verdictToneClass(result.verdict)} ${className}`}
      title={tip}
    >
      {label}
    </span>
  );
}
