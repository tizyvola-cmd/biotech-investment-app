import { useState } from "react";
import {
  FIN_LEGEND,
  formatFinancialColumnHeader,
} from "../sheet/financialStyles";
import {
  financialIndicatorSections,
  FIN_LEGEND_COMPACT_EN,
  FIN_LEGEND_COMPACT_IT,
} from "../sheet/financialIndicatorGuide";

function translateLegendHint(hint: string, it: boolean): string {
  if (!it) return hint;
  const map: Record<string, string> = {
    "green ▲ rise · red ▼ decline (no fill blocks)":
      "verde ▲ rialzo · rosso ▼ ribasso (senza blocchi colore)",
    "$ + log bar (EV/cap) vs column min–max":
      "$ + barra log (EV/cap) vs min–max colonna; prezzo lineare",
    "★ if current ≥+5% vs last close · ⚡ if ≤−5% · High/Low vs price":
      "★ se prezzo ≥+5% vs chiusura · ⚡ se ≤−5% · High/Low vs prezzo",
    "CR · QR · Cash FY":
      "CR/QR/Cash FY: rosso sotto soglia · ambra · verde (barra = intensità)",
    "0–1 bar: green high · amber mid · navy low · beta ⚡ if >2":
      "barra 0–1: verde alto · ambra medio · navy basso · beta ⚡ se >2",
    "P portfolio · W watchlist": "P portfolio · W watchlist",
  };
  return map[hint] ?? hint;
}

export function FinancialIndicatorGuide({ it }: { it: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b sheet-feed-guide text-[10px]">
      <div className="px-4 py-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {FIN_LEGEND.map((g) => (
          <span key={g.label} className="inline-flex items-center gap-1.5 sheet-feed-muted">
            <span className="font-semibold sheet-feed-text-accent">{g.label}</span>
            <span className="opacity-80">— {translateLegendHint(g.hint, it)}</span>
          </span>
        ))}
      </div>
      <div className="px-4 pb-2">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold sheet-feed-text-accent hover:opacity-80 transition"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="text-[9px] opacity-70" aria-hidden>
            {open ? "▼" : "▶"}
          </span>
          {it ? "Guida indicatori (tutti i campi)" : "Indicator guide (all fields)"}
        </button>
        <p className="mt-1 sheet-feed-muted leading-snug max-w-[52rem]">
          {it ? FIN_LEGEND_COMPACT_IT : FIN_LEGEND_COMPACT_EN}
        </p>
      </div>
      {open ? (
        <div className="px-4 pb-3 max-h-[min(42vh,320px)] overflow-y-auto border-t border-[rgb(var(--panel-feed-border-soft))]/60 bg-[rgb(var(--panel-feed-bg)/0.35)]">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 pt-2">
            {financialIndicatorSections(it).map((sec) => (
              <section
                key={sec.id}
                className="rounded-lg border border-[rgb(var(--panel-feed-border-soft))] bg-[rgb(var(--panel-mint-bg-elevated))] px-2.5 py-2 shadow-sm"
              >
                <h4 className="text-[10px] font-bold uppercase tracking-wide sheet-feed-text-accent mb-1.5">
                  {sec.title}
                </h4>
                <ul className="space-y-1.5">
                  {sec.entries.map((e) => (
                    <li key={e.id}>
                      <span className="font-semibold text-[rgb(var(--panel-feed-accent-strong))]">
                        {formatFinancialColumnHeader(e.id) !== e.id
                          ? formatFinancialColumnHeader(e.id)
                          : e.title}
                      </span>
                      <span className="sheet-feed-muted"> — {e.body}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
