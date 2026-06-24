import {
  formatPriceVariationPct,
  priceVariationTone,
} from "../sheet/priceVariationHorizons";
import { sheetTrendIcon } from "../sheet/sharedTableCellStyle";

const TONE_CLS = {
  up: "text-[rgb(var(--signal-up))]",
  down: "text-[rgb(var(--signal-down))]",
  flat: "text-ink-muted",
  muted: "text-ink-muted/60",
} as const;

/** Variazione % compatta con triangolo direzionale (tabella Simulation). */
export function PnlDeltaCell({
  pct,
  title,
  measuredAt,
  locale = "en-GB",
}: {
  pct: number | null | undefined;
  title?: string;
  /** Data/ora ultima misurazione — mostrata sotto la %. */
  measuredAt?: string | null;
  locale?: string;
}) {
  if (pct == null || !Number.isFinite(pct)) {
    return (
      <span className="inline-flex flex-col items-center gap-0.5 text-ink-muted tabular-nums" title={title}>
        <span>—</span>
        {measuredAt ? (
          <span className="text-[9px] font-normal leading-none opacity-80">
            {formatReadingTs(measuredAt, locale)}
          </span>
        ) : null}
      </span>
    );
  }
  const tone = priceVariationTone(pct);
  const cls = TONE_CLS[tone];
  const { icon } = sheetTrendIcon(pct);
  return (
    <span
      className={`inline-flex flex-col items-center justify-center gap-0.5 font-semibold tabular-nums text-xs whitespace-nowrap ${cls}`}
      title={title}
    >
      <span className="inline-flex items-center gap-0.5">
        <span className="text-[10px] leading-none" aria-hidden>
          {icon}
        </span>
        <span>{formatPriceVariationPct(pct)}</span>
      </span>
      {measuredAt ? (
        <span className="text-[9px] font-normal leading-none opacity-80 text-ink-muted">
          {formatReadingTs(measuredAt, locale)}
        </span>
      ) : null}
    </span>
  );
}

function formatReadingTs(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(locale, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
