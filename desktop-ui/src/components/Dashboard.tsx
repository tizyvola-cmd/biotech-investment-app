import { useMemo, useState } from "react";
import type { CatalystRow } from "../types";
import {
  catalystSignalMeta,
  daysUntilCompletion,
  fmtPctSigned,
  qualityDotClass,
} from "./catalystUiHelpers";
import { TABLE_COLORS_ENABLED } from "../sheet/tableColorsEnabled";

type SortKey =
  | "ticker"
  | "completionDate"
  | "direction"
  | "modelD7Pct"
  | "runUp30d"
  | "confidence";

function fmtConf(v: number | null): string {
  if (v === null || Number.isNaN(v)) return "—";
  return `${(v * 100).toFixed(0)}%`;
}

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) return <span className="ml-1 text-ink-muted/40">↕</span>;
  return <span className="ml-1">{dir === "asc" ? "↑" : "↓"}</span>;
}

export function Dashboard({
  rows,
  filter,
  onFilter,
  selectedId,
  onSelect,
  loading,
  source,
  total,
  onRefresh,
  refreshBusy,
}: {
  rows: CatalystRow[];
  filter: string;
  onFilter: (v: string) => void;
  selectedId: string | null;
  onSelect: (row: CatalystRow) => void;
  loading: boolean;
  source: string;
  total: number;
  onRefresh?: () => void;
  refreshBusy?: boolean;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("completionDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let av: string | number | null = a[sortKey];
      let bv: string | number | null = b[sortKey];
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      const cmp =
        typeof av === "string"
          ? av.localeCompare(bv as string)
          : (av as number) - (bv as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  function Th({ k, label }: { k: SortKey; label: string }) {
    return (
      <th
        className="px-3 py-2.5 font-medium cursor-pointer select-none whitespace-nowrap hover:text-ink transition-colors"
        onClick={() => toggleSort(k)}
      >
        {label}
        <SortIcon active={sortKey === k} dir={sortDir} />
      </th>
    );
  }

  return (
    <section className="card flex flex-col min-h-0 flex-1 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-[rgb(var(--border))] px-4 py-3">
        <h2 className="text-lg font-semibold">Catalyst</h2>
        <span className="text-xs text-ink-muted">
          {loading ? "Caricamento…" : `${rows.length} / ${total} righe`}
          {source ? ` · ${source.split("/").pop()}` : ""}
        </span>
        <input
          className="input ml-auto max-w-xs"
          placeholder="Filtra ticker…"
          value={filter}
          onChange={(e) => onFilter(e.target.value)}
        />
        {onRefresh && (
          <button
            type="button"
            className="btn text-xs px-3 py-1.5"
            disabled={refreshBusy || loading}
            onClick={onRefresh}
          >
            {refreshBusy ? "Aggiornando…" : "Refresh"}
          </button>
        )}
      </div>
      <div className="overflow-auto flex-1">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface-elevated text-left text-ink-muted text-xs">
            <tr>
              <Th k="ticker" label="Ticker" />
              <Th k="completionDate" label="CD" />
              <th className="px-3 py-2.5 font-medium">Signal</th>
              <th className="px-3 py-2.5 font-medium">Countdown</th>
              <Th k="modelD7Pct" label="Δ% D+7" />
              <Th k="runUp30d" label="Run-up 30g" />
              <Th k="confidence" label="Confidenza" />
              <th className="px-3 py-2.5 font-medium">Quality</th>
              <th className="px-3 py-2.5 font-medium">Flags</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const signal = TABLE_COLORS_ENABLED ? catalystSignalMeta(r) : null;
              const days = daysUntilCompletion(r.completionDate);
              const warnRow = TABLE_COLORS_ENABLED && days != null && days >= 0 && days <= 14;
              const qDot = TABLE_COLORS_ENABLED ? qualityDotClass(r.dataQualityScore) : null;
              const d7Color =
                !TABLE_COLORS_ENABLED || r.modelD7Pct === null
                  ? ""
                  : r.modelD7Pct > 0
                    ? "cell-up"
                    : "cell-down";
              const d7Icon =
                !TABLE_COLORS_ENABLED || r.modelD7Pct === null
                  ? ""
                  : r.modelD7Pct > 0.005
                    ? "▲ "
                    : r.modelD7Pct < -0.005
                      ? "▼ "
                      : "● ";
              return (
                <tr
                  key={r.id}
                  onClick={() => onSelect(r)}
                  className={`cursor-pointer border-t border-[rgb(var(--border))]/60 hover:bg-surface/80 transition-colors ${
                    warnRow ? "bg-[rgb(var(--warn))]/5" : ""
                  } ${selectedId === r.id ? "ring-1 ring-inset ring-accent/40" : ""}`}
                >
                  <td className="px-3 py-2 font-semibold tracking-tight">{r.ticker}</td>
                  <td className="px-3 py-2 text-ink-muted tabular-nums">
                    {r.completionDate
                      ? new Date(r.completionDate).toLocaleDateString("it-IT")
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-ink-muted">
                    {TABLE_COLORS_ENABLED && signal ? (
                      <span className={signal.className}>{signal.label}</span>
                    ) : (
                      r.direction || "—"
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-ink-muted">
                    {days == null
                      ? "—"
                      : TABLE_COLORS_ENABLED && days >= 0 && days <= 14
                        ? `⚡ ${days} gg`
                        : `${days} gg`}
                  </td>
                  <td className={`px-3 py-2 tabular-nums ${d7Color}`}>
                    {d7Icon}{fmtPctSigned(r.modelD7Pct)}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-ink-muted">
                    {fmtPctSigned(r.runUp30d)}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{fmtConf(r.confidence)}</td>
                  <td className="px-3 py-2">
                    {qDot ? <span className={qDot} title="Data quality" /> : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-muted">
                    {r.datiScarsi && <span className="mr-1">scarsi</span>}
                    {r.predIncomplete && <span className="mr-1">incompleto</span>}
                    {r.stars && <span>{r.stars}</span>}
                    {!r.datiScarsi && !r.predIncomplete && !r.stars && "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && rows.length === 0 && (
          <p className="p-8 text-center text-ink-muted">Nessuna riga corrisponde al filtro.</p>
        )}
      </div>
    </section>
  );
}
