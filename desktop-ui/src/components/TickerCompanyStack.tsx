/**
 * Ticker on the first line, company name underneath (table cells).
 * Soft BUY/SELL unchanged.
 */
import type { ReactNode } from "react";
import { truncateCompanyLabel } from "../sheet/tickerCompanyLabel";

export function TickerCompanyStack({
  ticker,
  company,
  tickerNode,
  className = "",
  companyClassName = "text-[9px] text-ink-muted truncate max-w-[11rem] leading-snug mt-0.5",
}: {
  ticker: string;
  company?: string | null;
  /** Custom first line (button, icons). Defaults to bold ticker. */
  tickerNode?: ReactNode;
  className?: string;
  companyClassName?: string;
}) {
  const name = String(company ?? "").trim();
  const label = name ? truncateCompanyLabel(name) : "";
  return (
    <div className={`flex flex-col leading-tight min-w-0 ${className}`.trim()}>
      <div className="min-w-0">
        {tickerNode ?? (
          <span className="font-semibold tabular-nums text-ink">{ticker}</span>
        )}
      </div>
      {label ? (
        <span className={companyClassName} title={name}>
          {label}
        </span>
      ) : null}
    </div>
  );
}
