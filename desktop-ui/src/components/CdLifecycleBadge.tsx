import {
  cdLifecycleLabel,
  cdLifecycleShortLabel,
  daysPastCd,
  isPostCdWatch,
  resolveCdLifecyclePhase,
} from "../sheet/cdLifecycle";
import { daysFromToday } from "../sheet/simulationPlanGain";
import { useLang } from "../shared/i18n";

export function CdLifecycleBadge({
  cd,
  days: daysProp,
  variant = "short",
  className = "",
}: {
  cd?: string | null;
  days?: number | null;
  variant?: "short" | "full";
  className?: string;
}) {
  const { lang } = useLang();
  const days = daysProp ?? (cd ? daysFromToday(cd) : null);
  const phase = resolveCdLifecyclePhase(days);
  if (phase !== "post_cd_watch") return null;

  const label =
    variant === "full"
      ? cdLifecycleLabel(days, lang)
      : cdLifecycleShortLabel(days, lang);
  if (!label) return null;

  const past = daysPastCd(days);
  const title =
    lang === "it"
      ? `Monitoraggio post-CD (${POST_CD_WATCH_TITLE_DAYS} gg). CD passato${past != null ? ` da ${past} gg` : ""}. Fuori dal foglio Simulation; dati da log / portafoglio.`
      : `Post-CD monitoring (${POST_CD_WATCH_TITLE_DAYS} calendar days). CD passed${past != null ? ` ${past}d ago` : ""}. Off Simulation sheet; data from log / portfolio.`;

  return (
    <span
      className={`inline-flex items-center text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full border whitespace-nowrap bg-[rgb(var(--warn))]/10 text-[rgb(var(--warn))] border-[rgb(var(--warn))]/30 ${className}`}
      title={title}
    >
      {label}
    </span>
  );
}

const POST_CD_WATCH_TITLE_DAYS = 7;

/** Riga ticker + badge post-CD opzionale. */
export function TickerWithCdLifecycle({
  ticker,
  cd,
  days,
  tickerClassName = "",
}: {
  ticker: string;
  cd?: string | null;
  days?: number | null;
  tickerClassName?: string;
}) {
  const d = days ?? (cd ? daysFromToday(cd) : null);
  const showWatch = isPostCdWatch(d);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 min-w-0">
      <span className={tickerClassName}>{ticker}</span>
      {showWatch ? <CdLifecycleBadge cd={cd} days={d} variant="short" /> : null}
    </span>
  );
}
