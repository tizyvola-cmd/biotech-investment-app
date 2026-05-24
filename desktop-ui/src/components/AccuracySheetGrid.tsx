import { useMemo, useState } from "react";
import type { SheetTable } from "../types";
import {
  accuracyCellStyle,
  buildAccuracyStyleContext,
  fmtAccuracyCell,
  formatAccuracyColumnHeader,
} from "../sheet/accuracyStyles";
import { TABLE_COLORS_ENABLED } from "../sheet/tableColorsEnabled";
import { ConfigurableSheetGrid } from "./ConfigurableSheetGrid";

const COL_ERR = "Δ%\nPred−Stor\nT+7";
const COL_STOR = "Storico %\nvs T−60\nT+7";
const COL_PRED = "Δ% vs Pred−60\nPred\n+7";

type AccFilter = "all" | "90d" | "180d" | "long" | "short";
type AccModelToggle = "v4" | "v5" | "compare";

function parseAccPct(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function ErrorBar({ errPct }: { errPct: number }) {
  const max = 30;
  const clamped = Math.max(-max, Math.min(max, errPct));
  const half = 40;
  const fill = (Math.abs(clamped) / max) * half;
  const positive = clamped >= 0;
  return (
    <div className="relative w-[80px] h-3 bg-[rgb(var(--surface-3))]/50 rounded-sm overflow-hidden">
      <span className="absolute left-1/2 top-0 bottom-0 w-px bg-ink-muted/40" />
      {positive ? (
        <span
          className="absolute top-0 bottom-0 bg-[rgb(var(--signal-up))]/70 rounded-r-sm"
          style={{ left: "50%", width: `${fill}px` }}
        />
      ) : (
        <span
          className="absolute top-0 bottom-0 bg-[rgb(var(--signal-down))]/70 rounded-l-sm"
          style={{ right: "50%", width: `${fill}px` }}
        />
      )}
    </div>
  );
}

export function AccuracySheetGrid({
  table,
  loading,
  error,
  onReload,
}: {
  table: SheetTable | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
}) {
  const [accFilter, setAccFilter] = useState<AccFilter>("all");
  const [modelToggle, setModelToggle] = useState<AccModelToggle>("v4");

  const baseRows = table?.rows ?? [];

  const filteredRows = useMemo(() => {
    let rows = baseRows.filter((r) => r[COL_STOR] != null);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (accFilter === "90d" || accFilter === "180d") {
      const days = accFilter === "90d" ? 90 : 180;
      const cut = new Date(today);
      cut.setDate(cut.getDate() - days);
      rows = rows.filter((r) => {
        const cd = r.CD ?? r["CD"];
        if (!cd) return false;
        const d = new Date(String(cd));
        return !Number.isNaN(d.getTime()) && d >= cut;
      });
    } else if (accFilter === "long") {
      rows = rows.filter((r) => (parseAccPct(r[COL_PRED]) ?? 0) > 0);
    } else if (accFilter === "short") {
      rows = rows.filter((r) => (parseAccPct(r[COL_PRED]) ?? 0) < 0);
    }
    return rows;
  }, [baseRows, accFilter]);

  const kpi = useMemo(() => {
    const errors = filteredRows
      .map((r) => Math.abs(parseAccPct(r[COL_ERR]) ?? NaN))
      .filter((n) => Number.isFinite(n));
    const mae =
      errors.length > 0
        ? ((errors.reduce((s, e) => s + e, 0) / errors.length) * 100).toFixed(1)
        : "—";
    const hits = filteredRows.filter((r) => {
      const pred = parseAccPct(r[COL_PRED]);
      const real = parseAccPct(r[COL_STOR]);
      if (pred == null || real == null) return false;
      return (pred > 0 && real > 0) || (pred < 0 && real < 0);
    }).length;
    const nEvents = filteredRows.length;
    const hitRate = nEvents ? ((hits / nEvents) * 100).toFixed(0) : "—";
    return { mae, hitRate, nEvents, hits };
  }, [filteredRows]);

  const filteredTable = useMemo(
    () =>
      table
        ? { ...table, rows: filteredRows, row_count: filteredRows.length }
        : null,
    [table, filteredRows]
  );

  const styleCtx = useMemo(
    () => buildAccuracyStyleContext(filteredRows),
    [filteredRows]
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[rgb(var(--border))]/60 shrink-0">
        <h2 className="text-lg font-semibold">Accuracy Lab</h2>
        <div className="ml-auto flex gap-1">
          {(
            [
              ["v4", "v4"],
              ["v5", "v5 q50"],
              ["compare", "v4 vs v5"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
                modelToggle === id
                  ? "bg-accent/20 text-accent border-accent/40"
                  : "border-[rgb(var(--border))]/40 text-ink-muted"
              }`}
              onClick={() => setModelToggle(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-4 py-3 border-b border-[rgb(var(--border))]/40 shrink-0">
        <AccKpi
          label={`MAE v4${modelToggle !== "v4" ? " (label)" : ""}`}
          value={kpi.mae === "—" ? "—" : `${kpi.mae} pp`}
          good={kpi.mae !== "—" && Number(kpi.mae) < 15}
        />
        <AccKpi
          label="Hit rate"
          value={kpi.hitRate === "—" ? "—" : `${kpi.hitRate}%`}
          good={kpi.hitRate !== "—" && Number(kpi.hitRate) > 60}
        />
        <AccKpi label="N° eventi" value={String(kpi.nEvents)} />
        <AccKpi label="Bias run-up" value="—" />
      </div>

      <div className="flex flex-wrap gap-1 px-4 py-2 border-b border-[rgb(var(--border))]/40 shrink-0">
        {(
          [
            ["all", "Tutti"],
            ["90d", "Ultimi 90 gg"],
            ["180d", "Ultimi 180 gg"],
            ["long", "↑ Long only"],
            ["short", "↓ Short only"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${
              accFilter === id ? "bg-accent/15 text-accent" : "text-ink-muted hover:text-ink"
            }`}
            onClick={() => setAccFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <ConfigurableSheetGrid
        table={filteredTable}
        loading={loading}
        error={error}
        onReload={onReload}
        sheetId="Accuracy"
        formatColumnHeader={formatAccuracyColumnHeader}
        headerClassName="sticky top-0 z-10 bg-surface-elevated text-left text-ink-muted"
        headerCellClassName="font-medium border border-[rgb(var(--border))]/40"
        headerNote={undefined}
        renderCell={(column, raw, row) => {
          const text = fmtAccuracyCell(column, raw);
          if (!TABLE_COLORS_ENABLED) {
            return { text, title: text };
          }
          if (column === COL_ERR) {
            const err = parseAccPct(raw);
            if (err != null) {
              const errPct = err * 100;
              const color =
                errPct > 0
                  ? "rgb(var(--signal-up))"
                  : errPct < 0
                    ? "rgb(var(--signal-down))"
                    : undefined;
              return {
                content: (
                  <div className="flex items-center gap-2">
                    <ErrorBar errPct={errPct} />
                    <span style={{ color }}>{text}</span>
                  </div>
                ),
                text,
              };
            }
          }
          const extras = accuracyCellStyle(column, raw, row, styleCtx);
          let style = extras?.style;
          if (column === COL_ERR) {
            const err = parseAccPct(raw);
            if (err != null) {
              style = {
                ...style,
                color:
                  err > 0
                    ? "rgb(var(--signal-up))"
                    : err < 0
                      ? "rgb(var(--signal-down))"
                      : undefined,
              };
            }
          }
          return {
            text,
            style,
            icon: extras?.icon,
            iconColor: extras?.iconColor,
            title: text,
          };
        }}
      />
    </div>
  );
}

function AccKpi({ label, value }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/50 px-3 py-2 bg-surface/50">
      <p className="text-[10px] text-ink-muted">{label}</p>
      <p className="font-semibold tabular-nums text-ink">
        {value}
      </p>
    </div>
  );
}
