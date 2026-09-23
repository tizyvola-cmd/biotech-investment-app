import { useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { InvestSimHistoryPoint, InvestSimInputs } from "../sheet/investSimStorage";
import {
  buildPortfolioAllocationSlices,
  PORTFOLIO_ALLOCATION_COLORS,
} from "../sheet/portfolioAllocationSlices";
import type { SheetTable } from "../types";
import { useLang } from "../shared/i18n";

type Props = {
  simTable: SheetTable | null;
  inputs: InvestSimInputs;
  history?: InvestSimHistoryPoint[] | null;
  /** Shorter chart for Pulse hero (Gain vs Plan slot). */
  dense?: boolean;
  /** Flush pane inside a shared window (no extra card chrome). */
  embedded?: boolean;
};

function fmtUsd(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function PortfolioAllocationPie({
  simTable,
  inputs,
  history = null,
  dense = false,
  embedded = false,
}: Props) {
  const { lang } = useLang();
  const it = lang === "it";
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  const slices = useMemo(
    () => buildPortfolioAllocationSlices(simTable, inputs, history),
    [simTable, inputs, history],
  );

  const total = useMemo(
    () => slices.reduce((s, x) => s + x.capitalEur, 0),
    [slices],
  );

  const chartData = useMemo(
    () =>
      slices.map((s, i) => ({
        ...s,
        fill: PORTFOLIO_ALLOCATION_COLORS[i % PORTFOLIO_ALLOCATION_COLORS.length]!,
      })),
    [slices],
  );

  const shellClass = embedded
    ? "h-full min-w-0"
    : "rounded-lg border border-[rgb(var(--border))]/45 bg-white/90 px-3 py-2.5";

  if (!slices.length) {
    return (
      <div className={embedded ? "h-full min-w-0" : "rounded-lg border border-[rgb(var(--border))]/45 bg-white/90 px-3 py-3"}>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
          {it ? "Allocazione portafoglio" : "Portfolio allocation"}
        </p>
        <p className="text-[12px] text-ink-muted mt-2">
          {it ? "Nessuna posizione aperta." : "No open positions."}
        </p>
      </div>
    );
  }

  return (
    <div className={shellClass}>
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            {it ? "Allocazione portafoglio" : "Portfolio allocation"}
          </p>
          <p className="text-[10px] text-ink-muted mt-0.5">
            {it
              ? `% capitale investito per titolo · totale ${fmtUsd(total)}`
              : `% invested capital by ticker · total ${fmtUsd(total)}`}
          </p>
        </div>
        <span className="text-[11px] font-semibold tabular-nums text-ink shrink-0">
          {slices.length} {it ? "titoli" : "names"}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(140px,0.85fr)] gap-2 items-center">
        <div className={`min-w-0 ${dense ? "h-[168px]" : "h-[220px]"}`}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                dataKey="capitalEur"
                nameKey="ticker"
                cx="50%"
                cy="50%"
                innerRadius={dense ? 38 : 48}
                outerRadius={dense ? 68 : 88}
                paddingAngle={1.2}
                onMouseEnter={(_, i) => setActiveIdx(i)}
                onMouseLeave={() => setActiveIdx(null)}
              >
                {chartData.map((entry, i) => (
                  <Cell
                    key={entry.key}
                    fill={entry.fill}
                    stroke="rgb(var(--surface))"
                    strokeWidth={activeIdx === i ? 2 : 1}
                    opacity={activeIdx == null || activeIdx === i ? 1 : 0.55}
                  />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number, _name, item) => {
                  const pct = Number(item?.payload?.pct ?? 0);
                  return [`${fmtUsd(value)} · ${pct.toFixed(1)}%`, String(item?.payload?.ticker ?? "")];
                }}
                contentStyle={{
                  fontSize: 11,
                  borderRadius: 8,
                  border: "1px solid rgb(var(--border) / 0.5)",
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <ul
          className={`space-y-1 pr-0.5 text-[11px] ${
            chartData.length > 6
              ? `overflow-y-auto overscroll-y-contain ${dense ? "max-h-[168px]" : "max-h-[220px]"}`
              : "overflow-visible"
          }`}
        >
          {chartData.map((s, i) => (
            <li
              key={s.key}
              className={`flex items-center gap-1.5 rounded px-1 py-0.5 ${
                activeIdx === i ? "bg-[rgb(var(--surface-2))]/80" : ""
              }`}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseLeave={() => setActiveIdx(null)}
            >
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ background: s.fill }}
              />
              <span className="font-bold tabular-nums w-12 shrink-0">{s.ticker}</span>
              <span className="tabular-nums text-ink-muted">{s.pct.toFixed(1)}%</span>
              <span className="ml-auto tabular-nums text-ink-muted">{fmtUsd(s.capitalEur)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
