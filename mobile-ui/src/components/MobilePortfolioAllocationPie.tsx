import { useMemo } from "react";
import {
  ArcElement,
  Chart as ChartJS,
  Legend,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from "chart.js";
import { Doughnut } from "react-chartjs-2";
import { useMobileLang } from "../hooks/useMobileLang";
import {
  buildMobilePortfolioAllocation,
  MOBILE_ALLOCATION_COLORS,
} from "../mobilePortfolioAllocation";
import type { MobileDashboardSnapshot } from "../dashboardTypes";
import type { InvestSimInputs, SheetTable } from "../types";

ChartJS.register(ArcElement, Tooltip, Legend);

type OpenCapRow = {
  key: string;
  ticker: string;
  invested: number;
};

type Props = {
  sheet: SheetTable | null;
  inputs: InvestSimInputs;
  dashSnapshot?: MobileDashboardSnapshot | null;
  /** Same rows as Open positions — pie total must match this invested capital. */
  openRows?: OpenCapRow[] | null;
  onOpenDetail?: (key: string) => void;
};

/** Same $ formatting as desktop Pulse PortfolioAllocationPie. */
function fmtUsd(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function MobilePortfolioAllocationPie({
  sheet,
  inputs,
  dashSnapshot,
  openRows,
  onOpenDetail,
}: Props) {
  const { t } = useMobileLang();
  const slices = useMemo(
    () => buildMobilePortfolioAllocation(sheet, inputs, dashSnapshot, openRows),
    [sheet, inputs, dashSnapshot, openRows],
  );
  const total = useMemo(
    () => slices.reduce((s, x) => s + x.capitalEur, 0),
    [slices],
  );

  const data: ChartData<"doughnut"> = useMemo(
    () => ({
      labels: slices.map((s) => s.ticker),
      datasets: [
        {
          data: slices.map((s) => s.capitalEur),
          backgroundColor: slices.map(
            (_, i) => MOBILE_ALLOCATION_COLORS[i % MOBILE_ALLOCATION_COLORS.length]!,
          ),
          borderWidth: 1,
          borderColor: "rgb(var(--surface))",
        },
      ],
    }),
    [slices],
  );

  const options: ChartOptions<"doughnut"> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      cutout: "52%",
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const s = slices[ctx.dataIndex];
              if (!s) return "";
              return ` ${s.ticker}: ${fmtUsd(s.capitalEur)} · ${s.pct.toFixed(1)}%`;
            },
          },
        },
      },
      onClick: (_evt, els) => {
        const i = els[0]?.index;
        if (i == null || !onOpenDetail) return;
        const s = slices[i];
        if (s) onOpenDetail(s.key);
      },
    }),
    [slices, onOpenDetail],
  );

  return (
    <section className="card dash-alloc-card">
      <header className="dash-section-head">
        <h3>{t("dashboard.alloc.title")}</h3>
        <p className="hint">
          {t("dashboard.alloc.sub", { total: fmtUsd(total) })}
        </p>
      </header>
      {slices.length === 0 ? (
        <p className="hint">{t("dashboard.alloc.empty")}</p>
      ) : (
        <div className="dash-alloc-body">
          <div className="dash-alloc-chart">
            <Doughnut data={data} options={options} />
          </div>
          <ul className="dash-alloc-legend">
            {slices.map((s, i) => (
              <li key={s.key}>
                <button
                  type="button"
                  className="dash-alloc-legend-btn"
                  onClick={() => onOpenDetail?.(s.key)}
                >
                  <span
                    className="dash-alloc-swatch"
                    style={{
                      background:
                        MOBILE_ALLOCATION_COLORS[i % MOBILE_ALLOCATION_COLORS.length],
                    }}
                  />
                  <strong>{s.ticker}</strong>
                  <span className="tabular-nums">{s.pct.toFixed(1)}%</span>
                  <span className="dash-alloc-cap tabular-nums">{fmtUsd(s.capitalEur)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
