import { useLang, useT } from "../shared/i18n";
import type { TranslationKey } from "../shared/i18n";
import type { StrictPickFailure } from "../sheet/topOppsStrictPick";
import type { SimulationSolidityResult } from "../sheet/simulationEntrySolidity";
import { entryRaHarmonizationTooltipLines } from "../sheet/entryRaHarmonization";
import { RaEntryVerdictChip } from "./RaEntryVerdictChip";
import { SolidityPieIcon } from "./SolidityPieIcon";

export function formatFailureLine(
  f: StrictPickFailure,
  tr: (key: TranslationKey, vars?: Record<string, string | number>) => string,
): string {
  const key = `sim.solidity.reason.${f.code}` as TranslationKey;
  const base = tr(key);
  if (f.detail && (f.code === "macro_gate_hold" || f.code === "macro_gate_avoid")) {
    return `${base} — ${f.detail}`;
  }
  if (f.detail && f.code === "low_score_reliability") {
    return `${base} (${f.detail})`;
  }
  if (
    f.detail &&
    (f.code === "timing_binary" ||
      f.code === "timing_pre_peak" ||
      f.code === "timing_beyond_hot")
  ) {
    return `${base} (T−${f.detail}d)`;
  }
  if (f.detail && f.code.startsWith("sds_")) {
    return `${base} — ${f.detail}`;
  }
  if (f.detail && f.code === "align_contrarian") {
    return `${base} (${f.detail})`;
  }
  return base;
}

export function buildSimulationSolidityTooltip(
  result: SimulationSolidityResult,
  tr: (key: TranslationKey, vars?: Record<string, string | number>) => string,
  opts?: { entryRaMode?: boolean; lang?: "it" | "en" },
): string {
  const parts: string[] = opts?.entryRaMode && opts.lang
    ? entryRaHarmonizationTooltipLines(opts.lang, result.composite.total)
    : [tr("sim.solidity.composite.tooltip", { score: result.composite.total })];
  if (result.reliabilityLabel) parts.push(result.reliabilityLabel);
  if (result.timingLabel) parts.push(result.timingLabel);
  parts.push(...result.failures.map((f) => formatFailureLine(f, tr)));
  if (result.gateReason && result.macroGateFired) {
    const gr = result.gateReason;
    if (!parts.some((p) => p.includes(gr))) parts.unshift(gr);
  }
  return parts.join(" · ");
}

type SimulationSolidityBadgeProps = {
  result: SimulationSolidityResult;
  /** inline = short label; strip = full-width; icon = tooltip-only glyph; column = pie + score for table column */
  variant?: "inline" | "strip" | "icon" | "column";
  /** Pick stocks RA column — harmonized Entry RA tooltip (not raw calibration ρ). */
  entryRaMode?: boolean;
  /** For RA→ invest hint chip (Simulation / 24h). */
  hasPosition?: boolean;
  showRaVerdict?: boolean;
  className?: string;
  onOpenDetail?: () => void;
};

export function SimulationSolidityBadge({
  result,
  variant = "inline",
  entryRaMode = false,
  hasPosition = false,
  showRaVerdict = false,
  className = "",
  onOpenDetail,
}: SimulationSolidityBadgeProps) {
  const t = useT();
  const { lang } = useLang();
  const tip = buildSimulationSolidityTooltip(result, t, {
    entryRaMode,
    lang: entryRaMode ? lang : undefined,
  });
  const label =
    result.level === "blocked"
      ? t("sim.solidity.badge.blocked")
      : result.level === "caution"
        ? t("sim.solidity.badge.caution")
        : t("sim.solidity.composite.top");

  const cls =
    result.level === "blocked"
      ? "bg-amber-500/15 text-amber-800 border-amber-500/40 dark:text-amber-300"
      : result.level === "caution"
        ? "bg-slate-500/10 text-slate-700 border-slate-400/35 dark:text-slate-300"
        : "bg-emerald-500/8 text-emerald-800 border-emerald-500/30 dark:text-emerald-300";

  const pie = (
    <SolidityPieIcon
      composite={result.composite}
      size={variant === "icon" ? 18 : 20}
      className={result.level === "ok" ? "opacity-95" : ""}
    />
  );

  if (variant === "strip") {
    const inner = (
      <>
        <div className="flex items-center gap-2">
          {pie}
          <p className="font-semibold">
            {label} · {result.composite.total}/100
          </p>
        </div>
        <p className="opacity-90 mt-0.5 line-clamp-2">{tip}</p>
      </>
    );
    if (onOpenDetail) {
      return (
        <button
          type="button"
          className={`rounded-md border px-2 py-1.5 text-[10px] leading-snug text-left w-full ${cls} ${className}`}
          title={tip}
          onClick={(e) => {
            e.stopPropagation();
            onOpenDetail();
          }}
        >
          {inner}
        </button>
      );
    }
    return (
      <div
        className={`rounded-md border px-2 py-1.5 text-[10px] leading-snug ${cls} ${className}`}
        title={tip}
        role="note"
      >
        {inner}
      </div>
    );
  }

  if (variant === "column") {
    const inner = (
      <>
        {pie}
        <span className="text-[9px] font-semibold tabular-nums leading-none">
          {result.composite.total}
        </span>
        {showRaVerdict && entryRaMode ? (
          <RaEntryVerdictChip
            entryRa={result.composite.total}
            hasPosition={hasPosition}
            compact
          />
        ) : null}
      </>
    );
    if (onOpenDetail) {
      return (
        <button
          type="button"
          className={`inline-flex flex-col items-center justify-center gap-0.5 cursor-pointer hover:opacity-80 ${className}`}
          title={`${label} — ${tip}`}
          aria-label={`${t("sim.rascore.col.label")} ${result.composite.total}/100`}
          onClick={(e) => {
            e.stopPropagation();
            onOpenDetail();
          }}
        >
          {inner}
        </button>
      );
    }
    return (
      <span
        className={`inline-flex flex-col items-center justify-center gap-0.5 cursor-help ${className}`}
        title={`${label} — ${tip}`}
        role="img"
        aria-label={`${t("sim.rascore.col.label")} ${result.composite.total}/100`}
      >
        {inner}
      </span>
    );
  }

  if (variant === "icon") {
    if (onOpenDetail) {
      return (
        <button
          type="button"
          className={`inline-flex shrink-0 items-center justify-center cursor-pointer hover:opacity-80 ${className}`}
          title={`${label} — ${tip}`}
          aria-label={`${label} ${result.composite.total}/100`}
          onClick={(e) => {
            e.stopPropagation();
            onOpenDetail();
          }}
        >
          {pie}
        </button>
      );
    }
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center cursor-help ${className}`}
        title={`${label} — ${tip}`}
        role="img"
        aria-label={`${label} ${result.composite.total}/100`}
      >
        {pie}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-semibold leading-tight ${cls} ${className}`}
      title={tip}
      role="note"
    >
      {pie}
      <span>
        {result.composite.total}
        {result.level !== "ok" ? ` · ${label}` : ""}
      </span>
    </span>
  );
}
