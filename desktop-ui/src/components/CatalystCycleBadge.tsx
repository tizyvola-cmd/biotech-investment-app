import type { CatalystCyclePrimary, CatalystPatternMatch } from "../api/catalystPatterns";
import { cycleConfidenceDotClass, cyclePhaseToneClass, cycleTooltip } from "../sheet/catalystCycleState";
import {
  cyclePhaseCompactLabel,
  cyclePhaseFullLabel,
  CYCLE_DUMP_UNCONFIRMED,
} from "../sheet/cyclePhaseDisplay";
import { useLang } from "../shared/i18n";

export function CatalystCycleBadge({
  primary,
  matches,
  compact = false,
}: {
  primary: CatalystCyclePrimary;
  matches?: CatalystPatternMatch[];
  compact?: boolean;
}) {
  const { lang } = useLang();
  const it = lang === "it";
  const isUnconfirmedDump =
    primary.phase === "dump_entry" &&
    primary.primary_pattern_id == null &&
    /unconfirmed|non confermato|debole|weak/i.test(
      `${primary.label_en} ${primary.label_it}`,
    );
  const label = compact
    ? isUnconfirmedDump
      ? it
        ? CYCLE_DUMP_UNCONFIRMED.compactIt
        : CYCLE_DUMP_UNCONFIRMED.compactEn
      : cyclePhaseCompactLabel(primary.phase, it)
    : isUnconfirmedDump
      ? it
        ? CYCLE_DUMP_UNCONFIRMED.labelIt
        : CYCLE_DUMP_UNCONFIRMED.labelEn
      : cyclePhaseFullLabel(primary.phase, it);
  const match = matches?.find((m) => m.pattern_id === primary.primary_pattern_id);
  const tip = cycleTooltip(primary, it, {
    lift: match?.historical_lift,
    n: match?.historical_n,
  });

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wide leading-none ${cyclePhaseToneClass(primary.phase)}`}
      title={tip}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${cycleConfidenceDotClass(primary.confidence)}`}
        aria-hidden
      />
      {label}    </span>
  );
}

export function CatalystCycleBanner({
  items,
}: {
  items: Array<{ ticker: string; primary: CatalystCyclePrimary }>;
}) {
  const { lang } = useLang();
  const it = lang === "it";
  if (!items.length) return null;

  return (
    <div className="mx-4 mt-2 mb-1 rounded-lg border border-[rgb(var(--panel-feed-border))]/40 bg-[rgb(var(--panel-feed-header-bg))]/35 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted/90 mb-1.5">
        {it ? "Segnali ciclo catalyst (pattern storico)" : "Catalyst cycle signals (historical patterns)"}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {items.map(({ ticker, primary }) => (
          <span key={ticker} className="inline-flex items-center gap-1 text-[10px]">
            <span className="font-bold text-ink">{ticker}</span>
            <CatalystCycleBadge primary={primary} compact />
          </span>
        ))}
      </div>
      <p className="text-[9px] text-ink-muted/75 mt-1.5 leading-snug">
        {it
          ? "Pattern confermati su ~8k catalyst storici. Non è consiglio di investimento — validazione in corso con nuovi casi."
          : "Patterns confirmed on ~8k historical catalysts. Not investment advice — validation ongoing with new cases."}
      </p>
    </div>
  );
}
