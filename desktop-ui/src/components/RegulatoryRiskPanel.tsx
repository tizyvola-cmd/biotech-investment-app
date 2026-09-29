/**
 * RegulatoryRiskPanel — CMC/CRL documentary signal index for a given ticker.
 *
 * DOES NOT produce a probability score or predict whether a CRL will occur.
 * Shows three factual signals: PDUFA date present, CMC keyword hits, prior CRL history.
 * All data is manually entered by the user — no AI inference.
 */
import { useState, useCallback } from "react";
import {
  getMonitoredAsset,
  addMonitoredAsset,
  addCatalyst,
  addRiskFlag,
  type CatalystEntry,
} from "../sheet/catalystAnalysisStore";
import {
  buildRegulatoryRiskIndex,
  type RegulatoryRiskIndex,
} from "../sheet/regulatoryRiskIndex";
import { useLang } from "../shared/i18n";

// ── Helpers ────────────────────────────────────────────────────────────────

function SignalDot({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full shrink-0 mt-[3px] ${
        active
          ? "bg-amber-500"
          : "bg-slate-300 dark:bg-slate-600"
      }`}
    />
  );
}

function SectionRow({
  label,
  active,
  children,
}: {
  label: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <SignalDot active={active} />
      <div className="flex-1 min-w-0">
        <span className="text-[11px] font-semibold text-ink">{label}</span>
        <div className="text-[10px] text-ink-muted mt-0.5 space-y-0.5">{children}</div>
      </div>
    </div>
  );
}

// ── Add PDUFA form ─────────────────────────────────────────────────────────

function AddPdufaForm({
  ticker,
  onDone,
}: {
  ticker: string;
  onDone: () => void;
}) {
  const { lang } = useLang();
  const it = lang === "it";
  const [kind, setKind] = useState<"pdufa_nda" | "pdufa_bla">("pdufa_nda");
  const [window, setWindow] = useState("");
  const [granularity, setGranularity] = useState<CatalystEntry["windowGranularity"]>("precise");
  const [note, setNote] = useState("");

  function handleSave() {
    if (!window.trim()) return;
    let asset = getMonitoredAsset(ticker);
    if (!asset) asset = addMonitoredAsset(ticker, ticker, "watchlist");
    addCatalyst(ticker, {
      description: kind === "pdufa_nda" ? "PDUFA date NDA" : "PDUFA date BLA",
      estimatedWindow: window.trim(),
      windowGranularity: granularity,
      status: "upcoming",
      statusNote: note.trim() || null,
      catalystKind: kind,
    });
    onDone();
  }

  return (
    <div className="mt-2 rounded-lg border border-amber-200/60 dark:border-amber-800/40 bg-amber-50/30 dark:bg-amber-950/10 p-2.5 space-y-2">
      <p className="text-[10px] font-semibold text-ink">{it ? "Aggiungi data PDUFA" : "Add PDUFA date"}</p>
      <div className="flex gap-2">
        <select
          className="border border-slate-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-surface text-ink text-[10px]"
          value={kind}
          onChange={(e) => setKind(e.target.value as "pdufa_nda" | "pdufa_bla")}
        >
          <option value="pdufa_nda">NDA</option>
          <option value="pdufa_bla">BLA</option>
        </select>
        <input
          className="flex-1 border border-slate-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-surface text-ink text-[10px]"
          placeholder={it ? "Data / finestra (es. 2026-09-15)" : "Date / window (e.g. 2026-09-15)"}
          value={window}
          onChange={(e) => setWindow(e.target.value)}
        />
        <select
          className="border border-slate-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-surface text-ink text-[10px]"
          value={granularity}
          onChange={(e) => setGranularity(e.target.value as CatalystEntry["windowGranularity"])}
        >
          <option value="precise">{it ? "Precisa" : "Precise"}</option>
          <option value="quarter">{it ? "Trimestre" : "Quarter"}</option>
          <option value="broad">{it ? "Approssimativa" : "Approximate"}</option>
        </select>
      </div>
      <input
        className="w-full border border-slate-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-surface text-ink text-[10px]"
        placeholder={it ? "Nota fonte (opzionale)" : "Source note (optional)"}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex gap-2">
        <button
          type="button"
          className="text-[10px] font-semibold px-3 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white transition-colors"
          onClick={handleSave}
        >
          {it ? "Salva" : "Save"}
        </button>
        <button
          type="button"
          className="text-[10px] px-3 py-1 rounded border border-slate-300 dark:border-slate-600 text-ink-muted hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          onClick={onDone}
        >
          {it ? "Annulla" : "Cancel"}
        </button>
      </div>
    </div>
  );
}

// ── Add CRL flag form ──────────────────────────────────────────────────────

function AddCrlFlagForm({
  ticker,
  onDone,
}: {
  ticker: string;
  onDone: () => void;
}) {
  const { lang } = useLang();
  const it = lang === "it";
  const [description, setDescription] = useState("");
  const [source, setSource] = useState("");

  function handleSave() {
    if (!description.trim()) return;
    let asset = getMonitoredAsset(ticker);
    if (!asset) asset = addMonitoredAsset(ticker, ticker, "watchlist");
    addRiskFlag(ticker, {
      category: "regulatory",
      description: description.trim(),
      source: source.trim() || "manual",
    });
    onDone();
  }

  return (
    <div className="mt-2 rounded-lg border border-rose-200/60 dark:border-rose-800/40 bg-rose-50/30 dark:bg-rose-950/10 p-2.5 space-y-2">
      <p className="text-[10px] font-semibold text-ink">
        {it ? "Aggiungi precedente CRL / CMC" : "Add prior CRL / CMC"}
      </p>
      <textarea
        className="w-full border border-slate-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-surface text-ink text-[10px] resize-none h-14"
        placeholder={
          it
            ? "Descrizione (es. CRL giugno 2024 per deficienze CMC su NDA XXXX)"
            : "Description (e.g. CRL June 2024 for CMC deficiencies on NDA XXXX)"
        }
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <input
        className="w-full border border-slate-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-surface text-ink text-[10px]"
        placeholder={
          it
            ? "Fonte (es. 8-K 2024-06-15, FDA press release)"
            : "Source (e.g. 8-K 2024-06-15, FDA press release)"
        }
        value={source}
        onChange={(e) => setSource(e.target.value)}
      />
      <div className="flex gap-2">
        <button
          type="button"
          className="text-[10px] font-semibold px-3 py-1 rounded bg-rose-600 hover:bg-rose-700 text-white transition-colors"
          onClick={handleSave}
        >
          {it ? "Salva" : "Save"}
        </button>
        <button
          type="button"
          className="text-[10px] px-3 py-1 rounded border border-slate-300 dark:border-slate-600 text-ink-muted hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          onClick={onDone}
        >
          {it ? "Annulla" : "Cancel"}
        </button>
      </div>
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────

export function RegulatoryRiskPanel({ ticker }: { ticker: string }) {
  const { lang } = useLang();
  const it = lang === "it";
  const [_rev, setRev] = useState(0);
  const refresh = useCallback(() => setRev((n) => n + 1), []);
  const [showPdufaForm, setShowPdufaForm] = useState(false);
  const [showCrlForm, setShowCrlForm] = useState(false);

  const asset = getMonitoredAsset(ticker);
  const index: RegulatoryRiskIndex = asset
    ? buildRegulatoryRiskIndex(asset)
    : {
        pdufaSignal: { present: false },
        cmcSignal: { present: false, hits: [] },
        crlSignal: { hasActive: false, entries: [] },
        approvedSignal: { present: false, hits: [] },
        positiveSignal: { present: false, hits: [] },
        hasAnySignal: false,
      };

  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-white/60 dark:bg-surface/40 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-[11px] font-semibold text-ink">
          {it ? "Segnali CMC / CRL" : "CMC / CRL signals"}
        </p>
        <span className="text-[9px] text-ink-muted/70 italic">
          {it ? "— documentale, non predittivo" : "— documentary, not predictive"}
        </span>
      </div>

      <div className="space-y-2.5">
        {/* Signal 1 — PDUFA */}
        <SectionRow label={it ? "Data PDUFA" : "PDUFA date"} active={index.pdufaSignal.present}>
          {index.pdufaSignal.present ? (
            <span>
              {index.pdufaSignal.kind === "pdufa_nda" ? "NDA" : "BLA"} ·{" "}
              {index.pdufaSignal.estimatedWindow}{" "}
              <span className="opacity-60">({index.pdufaSignal.granularity})</span>{" "}
              · {index.pdufaSignal.status}
            </span>
          ) : (
            <span>{it ? "Non registrata" : "Not registered"}</span>
          )}
          {!index.pdufaSignal.present && !showPdufaForm && (
            <button
              type="button"
              className="ml-1 text-[9px] text-amber-600 dark:text-amber-400 hover:underline"
              onClick={() => { setShowPdufaForm(true); setShowCrlForm(false); }}
            >
              {it ? "+ Aggiungi" : "+ Add"}
            </button>
          )}
          {showPdufaForm && (
            <AddPdufaForm
              ticker={ticker}
              onDone={() => { setShowPdufaForm(false); refresh(); }}
            />
          )}
        </SectionRow>

        {/* Signal 2 — CMC keywords */}
        <SectionRow
          label={it ? "Menzioni CMC / manufacturing" : "CMC / manufacturing mentions"}
          active={index.cmcSignal.present}
        >
          {index.cmcSignal.present ? (
            <div className="space-y-0.5">
              {index.cmcSignal.hits.map((h, i) => (
                <p key={i} className="truncate">
                  <span className="opacity-50">
                    {h.source === "catalyst_desc"
                      ? "catalyst"
                      : h.source === "catalyst_note"
                      ? (it ? "nota" : "note")
                      : "flag"}
                    :{" "}
                  </span>
                  {h.text}
                </p>
              ))}
            </div>
          ) : (
            <span>{it ? "Nessuna menzione in catalyst o flag" : "No mentions in catalyst or flag"}</span>
          )}
        </SectionRow>

        {/* Signal 3 — CRL history */}
        <SectionRow
          label={it ? "Storico CRL / precedenti regolatori" : "CRL history / regulatory precedents"}
          active={index.crlSignal.hasActive}
        >
          {index.crlSignal.entries.length > 0 ? (
            <div className="space-y-1">
              {index.crlSignal.entries.map((e, i) => (
                <p key={i} className={e.resolved ? "line-through opacity-50" : ""}>
                  {e.description.slice(0, 100)}
                  {e.description.length > 100 ? "…" : ""}
                  <span className="opacity-50 ml-1">· {e.flaggedAt.slice(0, 10)}</span>
                </p>
              ))}
            </div>
          ) : (
            <span>{it ? "Nessun precedente registrato" : "No prior events recorded"}</span>
          )}
          {!showCrlForm && (
            <button
              type="button"
              className="mt-0.5 text-[9px] text-rose-600 dark:text-rose-400 hover:underline"
              onClick={() => { setShowCrlForm(true); setShowPdufaForm(false); }}
            >
              {it ? "+ Aggiungi CRL / CMC precedente" : "+ Add prior CRL / CMC"}
            </button>
          )}
          {showCrlForm && (
            <AddCrlFlagForm
              ticker={ticker}
              onDone={() => { setShowCrlForm(false); refresh(); }}
            />
          )}
        </SectionRow>
      </div>

      <p className="text-[9px] text-ink-muted/60 italic border-t border-slate-200/40 dark:border-slate-700/30 pt-2">
        Indice documentale — riporta fatti registrati manualmente. Non è una stima di probabilità
        e non modifica P(plan), SDS o altri score esistenti.
      </p>
    </div>
  );
}
