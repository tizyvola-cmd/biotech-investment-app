/**
 * InvestmentSignalsPanel — "Segnali Attivi" tab del Decision Lab.
 *
 * Calcola un punteggio composito (0-100) per ogni riga della Simulation sheet
 * combinando: Affidabilità, R² fit, direzione pred, prossimità CD.
 * Produce raccomandazioni operative: cosa comprare, quando, quanto.
 */

import { useMemo, useState } from "react";
import type { SheetTable } from "../types";

// ── helpers ────────────────────────────────────────────────────────────────

function findCol(cols: string[], kw: string): string | undefined {
  const lo = kw.toLowerCase();
  return cols.find((c) => c.toLowerCase().includes(lo));
}

function toNum(v: unknown): number | null {
  if (v == null || v === "" || v === "—" || v === "-" || v === "N/D") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseDMY(s: string): Date | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

function daysFromToday(s: string): number | null {
  const d = parseDMY(s);
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = v > 0 ? "+" : "";
  return `${s}${v.toFixed(digits)}%`;
}

// ── scoring ────────────────────────────────────────────────────────────────

/**
 * Score composito 0-100:
 *   35 pts  Affidabilità %
 *   20 pts  R² fit
 *   25 pts  Direzione pred empirica (intensità)
 *   20 pts  Timing (prossimità CD)
 */
function computeScore(
  affid: number | null,   // 0-1
  r2: number | null,      // 0-1
  pred5: number | null,   // pp (es. 6.5 = +6.5%)
  days: number | null     // giorni a CD (negativo = passata)
): number {
  const affidScore = affid != null ? Math.min(1, affid) * 35 : 0;
  const r2Score = r2 != null ? Math.min(1, Math.max(0, r2)) * 20 : 0;

  let dirScore = 0;
  if (pred5 != null) {
    const abs = Math.abs(pred5);
    if (abs >= 10) dirScore = 25;
    else if (abs >= 5) dirScore = 18;
    else if (abs >= 2) dirScore = 10;
    else dirScore = 3;
  }

  let timingScore = 0;
  if (days != null && days >= 0) {
    if (days <= 7) timingScore = 20;
    else if (days <= 14) timingScore = 17;
    else if (days <= 30) timingScore = 12;
    else if (days <= 60) timingScore = 6;
    else timingScore = 2;
  }

  return Math.round(affidScore + r2Score + dirScore + timingScore);
}

type ActionKind = "forte" | "watch" | "monitor" | "skip" | "short" | "exit";

function actionKind(
  score: number,
  pred5: number | null,
  days: number | null,
  pnlPct: number | null,
  hasPosition: boolean
): ActionKind {
  // Uscita su posizioni aperte vicino al CD con P&L positivo
  if (hasPosition && days != null && days <= 3 && pnlPct != null && pnlPct > 5) return "exit";
  if (hasPosition && days != null && days < 0) return "exit";

  if (days != null && days < 0) return "skip";

  const isLong = pred5 != null && pred5 > 0;
  const isShort = pred5 != null && pred5 < -2;

  if (score >= 68 && isLong) return "forte";
  if (score >= 50 && isLong) return "watch";
  if (score >= 55 && isShort) return "short";
  if (score >= 35) return "monitor";
  return "skip";
}

function timingLabel(days: number | null): string {
  if (days == null) return "—";
  if (days < 0) return "CD passata";
  if (days === 0) return "⚡ Oggi";
  if (days <= 3) return "🔴 Ultimi giorni";
  if (days <= 7) return "⚡ Ingresso urgente";
  if (days <= 14) return "✓ Zona ottimale";
  if (days <= 30) return "Finestra aperta";
  if (days <= 60) return "Pre-fase";
  return "Troppo presto";
}

function sizeHint(score: number, affid: number | null, r2: number | null): string {
  const a = affid ?? 0;
  const r = r2 ?? 0;
  if (score >= 68 && a >= 0.65 && r >= 0.5) return "8–15%";
  if (score >= 52 && a >= 0.50 && r >= 0.35) return "3–8%";
  if (score >= 38) return "1–3%";
  return "Evita";
}

// ── types ──────────────────────────────────────────────────────────────────

type SignalRow = {
  ticker: string;
  cd: string;
  days: number | null;
  affid: number | null;       // 0-1
  r2: number | null;
  pred5: number | null;
  inferenza: string;
  stars: string;
  score: number;
  action: ActionKind;
  timing: string;
  size: string;
  hasPosition: boolean;
  pnlPct: number | null;
};

// ── action badge ───────────────────────────────────────────────────────────

function ActionBadge({ kind }: { kind: ActionKind }) {
  const cfg: Record<ActionKind, { label: string; cls: string }> = {
    forte:   { label: "⚡ Segnale Forte", cls: "bg-[rgb(var(--signal-up))]/15 text-[rgb(var(--signal-up))] border-[rgb(var(--signal-up))]/40" },
    watch:   { label: "▲ Watch Long",    cls: "bg-[rgb(var(--accent))]/12 text-[rgb(var(--accent))] border-[rgb(var(--accent))]/35" },
    short:   { label: "▼ Watch Short",   cls: "bg-[rgb(var(--signal-down))]/12 text-[rgb(var(--signal-down))] border-[rgb(var(--signal-down))]/35" },
    monitor: { label: "● Monitor",       cls: "bg-[rgb(var(--warn))]/10 text-[rgb(var(--warn))] border-[rgb(var(--warn))]/30" },
    exit:    { label: "↩ Valuta uscita", cls: "bg-[rgb(var(--signal-down))]/12 text-[rgb(var(--signal-down))] border-[rgb(var(--signal-down))]/35" },
    skip:    { label: "— Skip",          cls: "text-ink-muted/50 border-[rgb(var(--border))]/30" },
  };
  const { label, cls } = cfg[kind];
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold tracking-wide ${cls}`}>
      {label}
    </span>
  );
}

// ── score bar ──────────────────────────────────────────────────────────────

function ScoreBar({ score }: { score: number }) {
  const color =
    score >= 68 ? "bg-[rgb(var(--signal-up))]" :
    score >= 50 ? "bg-[rgb(var(--accent))]" :
    score >= 35 ? "bg-[rgb(var(--warn))]" :
    "bg-ink-muted/30";
  return (
    <div className="flex items-center gap-1.5 w-full">
      <div className="flex-1 h-1.5 rounded-full bg-[rgb(var(--border))]/30 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-[10px] tabular-nums w-6 text-right font-semibold">{score}</span>
    </div>
  );
}

// ── legend ─────────────────────────────────────────────────────────────────

function Legend() {
  return (
    <details className="text-xs text-ink-muted">
      <summary className="cursor-pointer select-none font-medium text-ink-muted/80 hover:text-ink">
        Come si calcola il punteggio
      </summary>
      <div className="mt-2 grid sm:grid-cols-2 gap-2 text-[11px] leading-relaxed">
        <div className="rounded-md border border-[rgb(var(--border))]/40 p-2.5 space-y-1">
          <p className="font-semibold text-ink">Score composito (0–100)</p>
          <p>35 pt · <span className="text-[rgb(var(--accent))]">Affidabilità</span> — confidenza stimata dal modello</p>
          <p>20 pt · <span className="text-[rgb(var(--accent))]">R² fit</span> — qualità del fit della curva predittiva</p>
          <p>25 pt · <span className="text-[rgb(var(--accent))]">Direzione</span> — intensità pred empirica ±5gg</p>
          <p>20 pt · <span className="text-[rgb(var(--accent))]">Timing</span> — prossimità al Completion Date</p>
        </div>
        <div className="rounded-md border border-[rgb(var(--border))]/40 p-2.5 space-y-1">
          <p className="font-semibold text-ink">Soglie azione</p>
          <p><span className="text-[rgb(var(--signal-up))]">⚡ Segnale Forte</span> — score ≥ 68, pred Long</p>
          <p><span className="text-[rgb(var(--accent))]">▲ Watch Long</span> — score ≥ 50, pred Long</p>
          <p><span className="text-[rgb(var(--signal-down))]">▼ Watch Short</span> — score ≥ 55, pred Short</p>
          <p><span className="text-[rgb(var(--warn))]">● Monitor</span> — score ≥ 35</p>
          <p className="text-ink-muted">Sizing: % del capitale disponibile consigliata in base a score + R²</p>
        </div>
      </div>
    </details>
  );
}

// ── main component ─────────────────────────────────────────────────────────

type SortKey = "score" | "days" | "affid" | "ticker";

export function InvestmentSignalsPanel({
  simTable,
  simLoading,
}: {
  simTable: SheetTable | null;
  simLoading: boolean;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [showAll, setShowAll] = useState(false);
  const [filterAction, setFilterAction] = useState<ActionKind | "all">("all");

  const signals = useMemo((): SignalRow[] => {
    if (!simTable) return [];
    const cols = simTable.columns;

    const colTicker   = findCol(cols, "Ticker") ?? "Ticker";
    const colCD       = findCol(cols, "Completion Date") ?? "Completion Date";
    const colAffid    = findCol(cols, "Affidabilit") ?? "";
    const colR2       = findCol(cols, "R²") ?? findCol(cols, "R2") ?? "";
    const colPred5    = findCol(cols, "Pred empirica") ?? "";
    const colInfer    = findCol(cols, "Inferenza") ?? "";
    const colStars    = findCol(cols, "stelle") ?? findCol(cols, "segnale") ?? "";
    const colCapitale = findCol(cols, "Capitale Investito") ?? "";
    const colPnl      = findCol(cols, "P&L (%)") ?? "";

    return simTable.rows.map((row) => {
      const ticker = String(row[colTicker] ?? "");
      const cd = String(row[colCD] ?? "");
      const days = daysFromToday(cd);

      // Affidabilità: stored as fraction (0.51) or percentage (51)
      let affidRaw = toNum(row[colAffid]);
      if (affidRaw != null && affidRaw > 1) affidRaw = affidRaw / 100;

      const r2 = toNum(row[colR2]);

      // pred5: stored as fraction or pp — convert to pp
      let pred5 = toNum(row[colPred5]);
      if (pred5 != null && Math.abs(pred5) <= 1.5 && !String(row[colPred5] ?? "").includes("%")) {
        pred5 = pred5 * 100;
      }

      const inferenza = String(row[colInfer] ?? "");
      const stars = String(row[colStars] ?? "");
      const hasPosition = toNum(row[colCapitale]) != null && (toNum(row[colCapitale]) ?? 0) > 0;

      let pnlPct = toNum(row[colPnl]);
      if (pnlPct != null && Math.abs(pnlPct) <= 1.5) pnlPct = pnlPct * 100;

      const score = computeScore(affidRaw, r2, pred5, days);
      const action = actionKind(score, pred5, days, pnlPct, hasPosition);
      const timing = timingLabel(days);
      const size = sizeHint(score, affidRaw, r2);

      return {
        ticker, cd, days,
        affid: affidRaw, r2, pred5, inferenza, stars,
        score, action, timing, size,
        hasPosition, pnlPct,
      };
    }).filter((r) => r.ticker && r.cd && r.days != null && r.days >= -30);
  }, [simTable]);

  const filtered = useMemo(() => {
    let rows = signals;
    if (filterAction !== "all") rows = rows.filter((r) => r.action === filterAction);
    if (!showAll) rows = rows.filter((r) => r.action !== "skip");

    return [...rows].sort((a, b) => {
      if (sortKey === "score") return b.score - a.score;
      if (sortKey === "days") return (a.days ?? 999) - (b.days ?? 999);
      if (sortKey === "affid") return (b.affid ?? 0) - (a.affid ?? 0);
      return a.ticker.localeCompare(b.ticker);
    });
  }, [signals, sortKey, filterAction, showAll]);

  // Summary counts
  const counts = useMemo(() => {
    const c: Record<ActionKind, number> = { forte: 0, watch: 0, short: 0, monitor: 0, skip: 0, exit: 0 };
    signals.forEach((r) => { c[r.action]++; });
    return c;
  }, [signals]);

  if (simLoading) {
    return <p className="text-sm text-ink-muted py-8 text-center">Caricamento dati simulation…</p>;
  }
  if (!simTable) {
    return <p className="text-sm text-ink-muted py-8 text-center">Dati simulation non disponibili — ricarica dalla tab Simulation.</p>;
  }

  function SortBtn({ k, label }: { k: SortKey; label: string }) {
    return (
      <button
        type="button"
        onClick={() => setSortKey(k)}
        className={`text-[10px] px-2 py-0.5 rounded border transition ${
          sortKey === k
            ? "bg-accent/15 text-accent border-accent/30"
            : "text-ink-muted border-[rgb(var(--border))]/40 hover:text-ink"
        }`}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {(
          [
            ["forte",   "⚡ Segnale Forte", "text-[rgb(var(--signal-up))]"],
            ["watch",   "▲ Watch Long",     "text-[rgb(var(--accent))]"],
            ["short",   "▼ Watch Short",    "text-[rgb(var(--signal-down))]"],
            ["exit",    "↩ Valuta uscita",  "text-[rgb(var(--signal-down))]"],
            ["monitor", "● Monitor",        "text-[rgb(var(--warn))]"],
            ["skip",    "— Skip",           "text-ink-muted/60"],
          ] as [ActionKind, string, string][]
        ).map(([kind, label, cls]) => (
          <button
            key={kind}
            type="button"
            onClick={() => setFilterAction(filterAction === kind ? "all" : kind)}
            className={`rounded-lg border px-3 py-2 text-left transition ${
              filterAction === kind
                ? "border-[rgb(var(--accent))]/50 bg-[rgb(var(--accent))]/8"
                : "border-[rgb(var(--border))]/40 bg-surface/40 hover:border-[rgb(var(--border))]"
            }`}
          >
            <p className={`text-xl font-bold tabular-nums ${cls}`}>{counts[kind]}</p>
            <p className="text-[9px] text-ink-muted leading-tight mt-0.5">{label}</p>
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] text-ink-muted uppercase tracking-wide">Ordina:</span>
        <SortBtn k="score" label="Score ↓" />
        <SortBtn k="days" label="CD ↑" />
        <SortBtn k="affid" label="Affid ↓" />
        <SortBtn k="ticker" label="Ticker A→Z" />
        <label className="ml-auto flex items-center gap-1.5 text-xs text-ink-muted cursor-pointer select-none">
          <input
            type="checkbox"
            className="accent-[rgb(var(--accent))] w-3 h-3"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
          />
          Mostra tutti (inclusi Skip)
        </label>
      </div>

      {/* Table */}
      <div className="overflow-auto rounded-lg border border-[rgb(var(--border))]/50">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-[rgb(var(--surface-elevated))] z-10">
            <tr className="text-[10px] uppercase tracking-wide text-ink-muted">
              <th className="text-left px-3 py-2 font-medium">Ticker</th>
              <th className="text-left px-3 py-2 font-medium whitespace-nowrap">CD · Timing</th>
              <th className="text-right px-3 py-2 font-medium">Affid.</th>
              <th className="text-right px-3 py-2 font-medium">R²</th>
              <th className="text-right px-3 py-2 font-medium whitespace-nowrap">Pred +5</th>
              <th className="px-3 py-2 font-medium">Score</th>
              <th className="text-left px-3 py-2 font-medium">Azione</th>
              <th className="text-center px-3 py-2 font-medium">Sizing</th>
              <th className="text-right px-3 py-2 font-medium">P&L att.</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const isInvested = r.hasPosition;
              const pred5Color =
                r.pred5 == null ? "" :
                r.pred5 > 0 ? "text-[rgb(var(--signal-up))] font-semibold" :
                "text-[rgb(var(--signal-down))] font-semibold";
              const pnlColor =
                r.pnlPct == null ? "text-ink-muted" :
                r.pnlPct > 0 ? "text-[rgb(var(--signal-up))]" :
                "text-[rgb(var(--signal-down))]";

              return (
                <tr
                  key={r.ticker + r.cd}
                  className={`border-t border-[rgb(var(--border))]/30 hover:bg-[rgb(var(--surface-3))]/20 transition-colors ${
                    isInvested ? "bg-[rgb(var(--accent))]/[0.03]" : ""
                  }`}
                >
                  <td className="px-3 py-2.5 font-bold tracking-tight">
                    <div className="flex items-center gap-1.5">
                      {isInvested && (
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-[rgb(var(--accent))] shrink-0"
                          title="Posizione aperta"
                        />
                      )}
                      {r.ticker}
                      {r.stars && (
                        <span className="text-[rgb(var(--warn))] text-[10px]">{r.stars}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="text-ink-muted">{r.cd}</div>
                    <div className={`text-[10px] mt-0.5 ${
                      r.days != null && r.days <= 7 && r.days >= 0
                        ? "text-[rgb(var(--warn))] font-semibold"
                        : "text-ink-muted/70"
                    }`}>
                      {r.timing}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {r.affid != null ? `${Math.round(r.affid * 100)}%` : "—"}
                  </td>
                  <td className={`px-3 py-2.5 text-right tabular-nums ${
                    r.r2 != null && r.r2 < 0.3 ? "text-[rgb(var(--signal-down))]" : ""
                  }`}>
                    {r.r2 != null ? r.r2.toFixed(2) : "—"}
                  </td>
                  <td className={`px-3 py-2.5 text-right tabular-nums ${pred5Color}`}>
                    {r.pred5 != null ? `${r.pred5 > 0 ? "▲ " : "▼ "}${fmtPct(r.pred5)}` : "—"}
                  </td>
                  <td className="px-3 py-2.5 min-w-[90px]">
                    <ScoreBar score={r.score} />
                  </td>
                  <td className="px-3 py-2.5">
                    <ActionBadge kind={r.action} />
                  </td>
                  <td className={`px-3 py-2.5 text-center text-[11px] font-semibold ${
                    r.size === "Evita" ? "text-ink-muted/50" :
                    r.size === "8–15%" ? "text-[rgb(var(--signal-up))]" :
                    "text-[rgb(var(--accent))]"
                  }`}>
                    {r.size}
                  </td>
                  <td className={`px-3 py-2.5 text-right tabular-nums ${pnlColor}`}>
                    {isInvested && r.pnlPct != null ? fmtPct(r.pnlPct) : "—"}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-ink-muted">
                  Nessun segnale nel filtro selezionato.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Legend />
    </div>
  );
}
