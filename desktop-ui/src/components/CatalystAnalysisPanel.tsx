/**
 * Catalyst Analysis Panel — structured session per asset with binary catalyst.
 *
 * Sections:
 *  1. Asset list with catalyst status
 *  2. Per-asset: Catalyst probability proxy (consensus + spread — NEVER a single %)
 *  3. Per-asset: Risk flags (legal/governance — kept separate from clinical proxy)
 *  4. Per-asset: Outcome history
 *  5. Add asset / add catalyst forms
 */
import { useState, useMemo } from "react";
import {
  listMonitoredAssets,
  addMonitoredAsset,
  addCatalyst,
  updateCatalystStatus,
  saveConsensusSnapshot,
  addRiskFlag,
  resolveRiskFlag,
  recordCatalystOutcome,
  listOutcomesForTicker,
  isStale,
  STALE_THRESHOLD_DAYS,
  type MonitoredAsset,
  type CatalystEntry,
  type RiskFlag,
  type CatalystStatus,
} from "../sheet/catalystAnalysisStore";
import type { AnalystTarget, AnalystRating } from "../sheet/catalystProbabilityProxy";
import { tierLabel, tierColorClass } from "../sheet/catalystProbabilityProxy";

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtPct(v: number | null | undefined, showPlus = false): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${showPlus && v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function fmtPrice(v: number | null | undefined): string {
  if (v == null) return "—";
  return `$${v.toFixed(2)}`;
}

function statusBadge(status: CatalystStatus): string {
  switch (status) {
    case "upcoming": return "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200";
    case "imminent": return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200";
    case "reported": return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200";
    case "stale": return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400";
  }
}

function ratingColor(r: AnalystRating | null): string {
  if (!r) return "text-ink-muted";
  if (r === "buy" || r === "outperform") return "text-emerald-700 dark:text-emerald-300";
  if (r === "sell" || r === "underperform") return "text-rose-700 dark:text-rose-300";
  return "text-amber-700 dark:text-amber-300";
}

// ── Sub-components ─────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] uppercase tracking-wider font-semibold text-ink-muted mb-2">
      {children}
    </h3>
  );
}

function ProxyDisclaimer({ it }: { it: boolean }) {
  return (
    <p className="text-[9px] text-ink-muted/70 italic border-t border-slate-200/40 dark:border-slate-700/30 pt-1.5 mt-1.5">
      {it
        ? "⚠ Proxy indicativo da dispersione analisti — non una probabilità calibrata. Epistemicamente diverso dalle probabilità shrinkate del Calibration Center."
        : "⚠ Indicative proxy from analyst dispersion — not a calibrated probability. Epistemically different from the Calibration Center's shrunk win rates."}
    </p>
  );
}

function SpreadBar({ min, max, mean, current }: { min: number; max: number; mean: number; current: number | null }) {
  const range = max - min;
  if (range <= 0) return null;
  const meanPct = ((mean - min) / range) * 100;
  const currPct = current ? Math.max(0, Math.min(100, ((current - min) / range) * 100)) : null;
  return (
    <div className="relative h-3 rounded-full bg-slate-100 dark:bg-slate-800 my-1.5" title={`Min $${min.toFixed(2)} — Max $${max.toFixed(2)}`}>
      <div className="absolute inset-y-0 bg-indigo-200/60 dark:bg-indigo-800/40 rounded-full" style={{ left: "0%", right: "0%" }} />
      <div className="absolute top-1 bottom-1 w-0.5 bg-indigo-600 dark:bg-indigo-400" style={{ left: `${meanPct}%` }} title={`Mean $${mean.toFixed(2)}`} />
      {currPct != null && (
        <div className="absolute top-0.5 bottom-0.5 w-1 rounded-full bg-slate-500 dark:bg-slate-300" style={{ left: `${currPct}%` }} title={`Current $${current?.toFixed(2)}`} />
      )}
    </div>
  );
}

function ConsensusPanel({ asset, it, onRefresh }: { asset: MonitoredAsset; it: boolean; onRefresh: () => void }) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({
    firm: "", rating: "" as AnalystRating | "", target: "", currentPrice: "", source: "manual",
  });

  const proxy = asset.proxyResult;
  const snapshot = asset.consensusSnapshot;

  function handleSaveConsensus() {
    const analysts: AnalystTarget[] = [];
    if (form.firm) {
      analysts.push({
        firm: form.firm,
        rating: (form.rating as AnalystRating) || null,
        pricetarget: form.target ? parseFloat(form.target) : null,
        asOf: new Date().toISOString(),
      });
    }
    saveConsensusSnapshot(asset.ticker, {
      ticker: asset.ticker,
      currentPrice: form.currentPrice ? parseFloat(form.currentPrice) : null,
      analysts: [...(snapshot?.analysts ?? []), ...analysts],
      snapshotAt: new Date().toISOString(),
      source: form.source,
    });
    setShowAddForm(false);
    setForm({ firm: "", rating: "", target: "", currentPrice: "", source: "manual" });
    onRefresh();
  }

  return (
    <div className="space-y-3">
      {proxy ? (
        <div className="rounded-xl border border-indigo-200/50 dark:border-indigo-800/40 bg-indigo-50/30 dark:bg-indigo-950/10 p-3 space-y-2">
          {/* Consensus label + tier */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-bold text-ink">{proxy.consensusLabel}</span>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${tierColorClass(proxy.uncertaintyTier)}`}>
              {tierLabel(proxy.uncertaintyTier, it ? "it" : "en")}
            </span>
            <span className="text-[9px] text-ink-muted ml-auto">{proxy.asOf.slice(0, 10)} · {proxy.source}</span>
          </div>

          {/* Rating counts */}
          <div className="flex flex-wrap gap-2 text-[11px]">
            {(["buy", "outperform", "hold", "underperform", "sell"] as AnalystRating[]).map((r) => (
              proxy.ratingCounts[r] > 0 && (
                <span key={r} className={`font-semibold capitalize ${ratingColor(r)}`}>
                  {proxy.ratingCounts[r]} {r}
                </span>
              )
            ))}
            <span className="text-ink-muted">({proxy.analystCount} targets)</span>
          </div>

          {/* Price target spread — explicit disagreement */}
          {proxy.meanTarget != null && (
            <div className="space-y-0.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-ink-muted">{it ? "Min target" : "Min target"}</span>
                <span className="tabular-nums font-mono">{fmtPrice(proxy.minTarget)}</span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-ink-muted font-semibold">{it ? "Media target" : "Mean target"}</span>
                <span className="tabular-nums font-mono font-semibold text-ink">{fmtPrice(proxy.meanTarget)}</span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-ink-muted">{it ? "Max target" : "Max target"}</span>
                <span className="tabular-nums font-mono">{fmtPrice(proxy.maxTarget)}</span>
              </div>
              {proxy.minTarget != null && proxy.maxTarget != null && (
                <SpreadBar
                  min={proxy.minTarget}
                  max={proxy.maxTarget}
                  mean={proxy.meanTarget}
                  current={snapshot?.currentPrice ?? null}
                />
              )}
              {proxy.spread != null && (
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-ink-muted font-semibold">
                    {it ? "Spread (disaccordo)" : "Spread (disagreement)"}
                  </span>
                  <span className={`tabular-nums font-mono font-semibold ${
                    (proxy.spreadPct ?? 0) > 50
                      ? "text-rose-600 dark:text-rose-400"
                      : (proxy.spreadPct ?? 0) > 20
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-emerald-600 dark:text-emerald-400"
                  }`}>
                    {fmtPrice(proxy.spread)} ({fmtPct(proxy.spreadPct)})
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Upside/downside from current */}
          {snapshot?.currentPrice && (
            <div className="flex flex-wrap gap-3 text-[11px] border-t border-indigo-200/30 dark:border-indigo-800/30 pt-2">
              <div className="flex items-center gap-1">
                <span className="text-ink-muted">{it ? "Upside medio" : "Mean upside"}</span>
                <span className={`font-semibold tabular-nums ${(proxy.upsidePct ?? 0) >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"}`}>
                  {fmtPct(proxy.upsidePct, true)}
                </span>
              </div>
              {proxy.downsideToMinPct != null && (
                <div className="flex items-center gap-1">
                  <span className="text-ink-muted">{it ? "Min target" : "Downside (min)"}</span>
                  <span className="font-semibold tabular-nums text-rose-700 dark:text-rose-300">
                    {fmtPct(proxy.downsideToMinPct, true)}
                  </span>
                </div>
              )}
              {proxy.upsideToMaxPct != null && (
                <div className="flex items-center gap-1">
                  <span className="text-ink-muted">{it ? "Max target" : "Upside (max)"}</span>
                  <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
                    {fmtPct(proxy.upsideToMaxPct, true)}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Tier rationale */}
          <p className="text-[10px] text-ink-muted italic">{proxy.tierRationale}</p>
          <ProxyDisclaimer it={it} />
        </div>
      ) : (
        <p className="text-[11px] text-ink-muted italic">
          {it ? "Nessun dato consensus ancora registrato." : "No consensus data recorded yet."}
        </p>
      )}

      {/* Add analyst target form */}
      {showAddForm ? (
        <div className="rounded-xl border border-slate-200/60 dark:border-slate-700/40 bg-white/40 dark:bg-surface/40 p-3 space-y-2">
          <p className="text-[11px] font-semibold text-ink">{it ? "Aggiungi analista / prezzo corrente" : "Add analyst / current price"}</p>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <input className="col-span-2 border border-slate-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-surface text-ink text-[11px]" placeholder={it ? "Prezzo corrente ($)" : "Current price ($)"} value={form.currentPrice} onChange={e => setForm(f => ({ ...f, currentPrice: e.target.value }))} />
            <input className="border border-slate-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-surface text-ink text-[11px]" placeholder={it ? "Firm / fonte" : "Firm / source"} value={form.firm} onChange={e => setForm(f => ({ ...f, firm: e.target.value }))} />
            <select className="border border-slate-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-surface text-ink text-[11px]" value={form.rating} onChange={e => setForm(f => ({ ...f, rating: e.target.value as AnalystRating | "" }))}>
              <option value="">{it ? "Rating" : "Rating"}</option>
              <option value="buy">Buy</option>
              <option value="outperform">Outperform</option>
              <option value="hold">Hold</option>
              <option value="underperform">Underperform</option>
              <option value="sell">Sell</option>
            </select>
            <input className="border border-slate-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-surface text-ink text-[11px]" placeholder={it ? "Price target ($)" : "Price target ($)"} value={form.target} onChange={e => setForm(f => ({ ...f, target: e.target.value }))} />
            <input className="border border-slate-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-surface text-ink text-[11px]" placeholder={it ? "Fonte dati" : "Data source"} value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))} />
          </div>
          <div className="flex gap-2">
            <button className="text-[11px] font-semibold px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white transition-colors" onClick={handleSaveConsensus}>{it ? "Salva" : "Save"}</button>
            <button className="text-[11px] px-3 py-1 rounded border border-slate-300 dark:border-slate-600 text-ink-muted hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors" onClick={() => setShowAddForm(false)}>{it ? "Annulla" : "Cancel"}</button>
          </div>
        </div>
      ) : (
        <button className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline" onClick={() => setShowAddForm(true)}>
          + {it ? "Aggiungi dato analista" : "Add analyst data"}
        </button>
      )}
    </div>
  );
}

function RiskFlagsSection({ asset, it, onRefresh }: { asset: MonitoredAsset; it: boolean; onRefresh: () => void }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ category: "legal" as RiskFlag["category"], description: "", source: "" });

  const active = asset.riskFlags.filter((f) => !f.resolved);
  const resolved = asset.riskFlags.filter((f) => f.resolved);

  function handleAdd() {
    if (!form.description) return;
    addRiskFlag(asset.ticker, { category: form.category, description: form.description, source: form.source });
    setShowForm(false);
    setForm({ category: "legal", description: "", source: "" });
    onRefresh();
  }

  return (
    <div className="space-y-2">
      <p className="text-[10px] text-ink-muted italic">
        {it
          ? "I flag di rischio non-clinico (legale, governance) sono separati dal proxy clinico — tipologia di rischio diversa."
          : "Non-clinical risk flags (legal, governance) are kept separate from the clinical proxy — different risk category."}
      </p>
      {active.length === 0 && resolved.length === 0 && (
        <p className="text-[11px] text-ink-muted">{it ? "Nessun flag registrato." : "No flags recorded."}</p>
      )}
      {active.map((f) => (
        <div key={f.id} className="flex items-start gap-2 rounded-lg border border-rose-200/50 dark:border-rose-800/40 bg-rose-50/30 dark:bg-rose-950/10 px-3 py-2">
          <span className="text-[10px] font-semibold uppercase text-rose-700 dark:text-rose-300 shrink-0 mt-0.5">{f.category}</span>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-ink">{f.description}</p>
            <p className="text-[9px] text-ink-muted">{f.source} · {f.flaggedAt.slice(0, 10)}</p>
          </div>
          <button className="text-[9px] text-emerald-600 dark:text-emerald-400 hover:underline shrink-0" onClick={() => { resolveRiskFlag(asset.ticker, f.id); onRefresh(); }}>
            {it ? "Risolto" : "Resolve"}
          </button>
        </div>
      ))}
      {resolved.length > 0 && (
        <p className="text-[10px] text-ink-muted">{resolved.length} {it ? "flag risolti" : "resolved flags"}</p>
      )}
      {showForm ? (
        <div className="rounded-xl border border-slate-200/60 dark:border-slate-700/40 bg-white/40 dark:bg-surface/40 p-3 space-y-2">
          <select className="w-full border border-slate-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-surface text-ink text-[11px]" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as RiskFlag["category"] }))}>
            <option value="legal">Legal</option>
            <option value="governance">Governance</option>
            <option value="reputational">Reputational</option>
            <option value="financial">Financial</option>
            <option value="other">Other</option>
          </select>
          <textarea className="w-full border border-slate-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-surface text-ink text-[11px] resize-none h-14" placeholder={it ? "Descrizione flag..." : "Flag description..."} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          <input className="w-full border border-slate-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-surface text-ink text-[11px]" placeholder={it ? "Fonte" : "Source"} value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))} />
          <div className="flex gap-2">
            <button className="text-[11px] font-semibold px-3 py-1 rounded bg-rose-600 hover:bg-rose-700 text-white transition-colors" onClick={handleAdd}>{it ? "Aggiungi" : "Add flag"}</button>
            <button className="text-[11px] px-3 py-1 rounded border border-slate-300 dark:border-slate-600 text-ink-muted hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors" onClick={() => setShowForm(false)}>{it ? "Annulla" : "Cancel"}</button>
          </div>
        </div>
      ) : (
        <button className="text-[11px] text-rose-600 dark:text-rose-400 hover:underline" onClick={() => setShowForm(true)}>
          + {it ? "Aggiungi flag di rischio" : "Add risk flag"}
        </button>
      )}
    </div>
  );
}

function CatalystList({ asset, it, onRefresh }: { asset: MonitoredAsset; it: boolean; onRefresh: () => void }) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ description: "", window: "", granularity: "broad" as CatalystEntry["windowGranularity"] });
  const [recordForm, setRecordForm] = useState<{ catalystId: string; summary: string; p1d: string; p5d: string } | null>(null);

  function handleAddCatalyst() {
    if (!form.description || !form.window) return;
    addCatalyst(asset.ticker, {
      description: form.description,
      estimatedWindow: form.window,
      windowGranularity: form.granularity,
      status: "upcoming",
      statusNote: null,
    });
    setShowAdd(false);
    setForm({ description: "", window: "", granularity: "broad" });
    onRefresh();
  }

  function handleRecordOutcome() {
    if (!recordForm || !recordForm.summary) return;
    recordCatalystOutcome({
      ticker: asset.ticker,
      catalystId: recordForm.catalystId,
      outcomeSummary: recordForm.summary,
      reportedAt: new Date().toISOString(),
      priceChangePct1d: recordForm.p1d ? parseFloat(recordForm.p1d) : null,
      priceChangePct5d: recordForm.p5d ? parseFloat(recordForm.p5d) : null,
      uncertaintyTierAtImminent: asset.proxyResult?.uncertaintyTier ?? null,
    });
    setRecordForm(null);
    onRefresh();
  }

  return (
    <div className="space-y-2">
      {asset.catalysts.length === 0 && (
        <p className="text-[11px] text-ink-muted">{it ? "Nessun catalyst registrato." : "No catalysts recorded."}</p>
      )}
      {asset.catalysts.map((c) => {
        const stale = isStale(c) && c.status !== "reported";
        const effectiveStatus: CatalystStatus = stale ? "stale" : c.status;
        return (
          <div key={c.id} className="rounded-xl border border-slate-200/50 dark:border-slate-700/30 bg-white/40 dark:bg-surface/40 px-3 py-2.5 space-y-1.5">
            <div className="flex flex-wrap items-start gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold text-ink">{c.description}</p>
                <p className="text-[10px] text-ink-muted">
                  {c.estimatedWindow}
                  <span className="ml-1 text-[9px] opacity-60">({c.windowGranularity})</span>
                </p>
              </div>
              <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${statusBadge(effectiveStatus)}`}>
                {effectiveStatus}
              </span>
            </div>
            {c.statusNote && (
              <p className="text-[10px] text-ink-muted italic">{c.statusNote}</p>
            )}
            {stale && (
              <p className="text-[9px] text-amber-700 dark:text-amber-300">
                ⚠ {it ? `Nessun controllo negli ultimi ${STALE_THRESHOLD_DAYS} giorni — verifica fonte.` : `No check in the last ${STALE_THRESHOLD_DAYS} days — verify source.`}
              </p>
            )}
            <div className="flex flex-wrap gap-2 text-[10px]">
              {(["upcoming", "imminent"] as CatalystStatus[]).map((s) => (
                c.status !== s && c.status !== "reported" && (
                  <button key={s} className="text-indigo-600 dark:text-indigo-400 hover:underline" onClick={() => { updateCatalystStatus(asset.ticker, c.id, s, null); onRefresh(); }}>
                    → {s}
                  </button>
                )
              ))}
              {c.status !== "reported" && (
                <button className="text-emerald-600 dark:text-emerald-400 hover:underline" onClick={() => setRecordForm({ catalystId: c.id, summary: "", p1d: "", p5d: "" })}>
                  {it ? "Registra esito" : "Record outcome"}
                </button>
              )}
            </div>
            {recordForm?.catalystId === c.id && (
              <div className="space-y-1.5 border-t border-slate-200/40 dark:border-slate-700/30 pt-2">
                <p className="text-[10px] font-semibold text-ink">{it ? "Esito (parafrasi — non testo verbatim della fonte)" : "Outcome (paraphrase — not verbatim source text)"}</p>
                <textarea className="w-full border border-slate-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-surface text-ink text-[11px] resize-none h-16" value={recordForm.summary} onChange={e => setRecordForm(f => f ? ({ ...f, summary: e.target.value }) : f)} />
                <div className="flex gap-2">
                  <input className="flex-1 border border-slate-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-surface text-ink text-[11px]" placeholder="Δ% 1d" value={recordForm.p1d} onChange={e => setRecordForm(f => f ? ({ ...f, p1d: e.target.value }) : f)} />
                  <input className="flex-1 border border-slate-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-surface text-ink text-[11px]" placeholder="Δ% 5d" value={recordForm.p5d} onChange={e => setRecordForm(f => f ? ({ ...f, p5d: e.target.value }) : f)} />
                </div>
                <div className="flex gap-2">
                  <button className="text-[11px] font-semibold px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white transition-colors" onClick={handleRecordOutcome}>{it ? "Salva esito" : "Save outcome"}</button>
                  <button className="text-[11px] px-3 py-1 rounded border border-slate-300 dark:border-slate-600 text-ink-muted hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors" onClick={() => setRecordForm(null)}>{it ? "Annulla" : "Cancel"}</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {showAdd ? (
        <div className="rounded-xl border border-slate-200/60 dark:border-slate-700/40 bg-white/40 dark:bg-surface/40 p-3 space-y-2">
          <input className="w-full border border-slate-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-surface text-ink text-[11px]" placeholder={it ? "Descrizione catalyst (es. VELA-TEEN primary endpoint readout)" : "Catalyst description (e.g. VELA-TEEN primary endpoint readout)"} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          <div className="flex gap-2">
            <input className="flex-1 border border-slate-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-surface text-ink text-[11px]" placeholder={it ? "Finestra stimata (es. mid 2026, Q3 2026)" : "Estimated window (e.g. mid 2026, Q3 2026)"} value={form.window} onChange={e => setForm(f => ({ ...f, window: e.target.value }))} />
            <select className="border border-slate-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-surface text-ink text-[11px]" value={form.granularity} onChange={e => setForm(f => ({ ...f, granularity: e.target.value as CatalystEntry["windowGranularity"] }))}>
              <option value="precise">Precise</option>
              <option value="quarter">Quarter</option>
              <option value="broad">Broad</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button className="text-[11px] font-semibold px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white transition-colors" onClick={handleAddCatalyst}>{it ? "Aggiungi" : "Add"}</button>
            <button className="text-[11px] px-3 py-1 rounded border border-slate-300 dark:border-slate-600 text-ink-muted hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors" onClick={() => setShowAdd(false)}>{it ? "Annulla" : "Cancel"}</button>
          </div>
        </div>
      ) : (
        <button className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline" onClick={() => setShowAdd(true)}>
          + {it ? "Aggiungi catalyst" : "Add catalyst"}
        </button>
      )}
    </div>
  );
}

function OutcomeHistory({ ticker, it }: { ticker: string; it: boolean }) {
  const outcomes = useMemo(() => listOutcomesForTicker(ticker), [ticker]);
  if (outcomes.length === 0) {
    return <p className="text-[11px] text-ink-muted">{it ? "Nessun esito registrato." : "No outcomes recorded yet."}</p>;
  }
  return (
    <div className="space-y-2">
      {outcomes.map((o) => (
        <div key={o.id} className="rounded-lg border border-slate-200/40 dark:border-slate-700/30 bg-white/30 dark:bg-surface/30 px-3 py-2 space-y-0.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-ink">{o.reportedAt.slice(0, 10)}</span>
            {o.uncertaintyTierAtImminent && (
              <span className={`text-[9px] px-1.5 py-0.5 rounded ${tierColorClass(o.uncertaintyTierAtImminent)}`}>
                {tierLabel(o.uncertaintyTierAtImminent, it ? "it" : "en")}
              </span>
            )}
          </div>
          <p className="text-[11px] text-ink">{o.outcomeSummary}</p>
          {(o.priceChangePct1d != null || o.priceChangePct5d != null) && (
            <div className="flex gap-3 text-[10px] text-ink-muted">
              {o.priceChangePct1d != null && <span>1d: <span className={o.priceChangePct1d >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>{fmtPct(o.priceChangePct1d, true)}</span></span>}
              {o.priceChangePct5d != null && <span>5d: <span className={o.priceChangePct5d >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>{fmtPct(o.priceChangePct5d, true)}</span></span>}
            </div>
          )}
        </div>
      ))}
      <p className="text-[9px] text-ink-muted/60 italic">
        {it
          ? "Lo storico esiti è la base per calibrare il proxy di incertezza nel tempo — richiede volume e tempo, obiettivo a lungo termine."
          : "Outcome history is the foundation for calibrating the uncertainty proxy over time — requires volume and time, long-term objective."}
      </p>
    </div>
  );
}

// ── Asset detail view ──────────────────────────────────────────────────────

type AssetSection = "catalysts" | "consensus" | "risks" | "history";

function AssetDetailView({ asset, it, onRefresh, onBack }: { asset: MonitoredAsset; it: boolean; onRefresh: () => void; onBack: () => void }) {
  const [section, setSection] = useState<AssetSection>("catalysts");
  const tabs: [AssetSection, string][] = [
    ["catalysts", it ? "Catalysts" : "Catalysts"],
    ["consensus", it ? "Consensus analisti" : "Analyst consensus"],
    ["risks", it ? "Flag rischio" : "Risk flags"],
    ["history", it ? "Storico esiti" : "Outcome history"],
  ];

  const activeFlags = asset.riskFlags.filter((f) => !f.resolved).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline" onClick={onBack}>← {it ? "Lista asset" : "Asset list"}</button>
        <span className="text-ink-muted">/</span>
        <span className="text-[12px] font-bold text-ink">{asset.ticker}</span>
        <span className="text-[11px] text-ink-muted">{asset.name}</span>
        {activeFlags > 0 && (
          <span className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
            ⚠ {activeFlags} {it ? "flag attivi" : "active flags"}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            className={`text-[11px] px-3 py-1 rounded-full border transition-colors ${
              section === id
                ? "bg-indigo-600 border-indigo-600 text-white"
                : "border-slate-300 dark:border-slate-600 text-ink-muted hover:bg-slate-50 dark:hover:bg-slate-800"
            }`}
            onClick={() => setSection(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div>
        {section === "catalysts" && <CatalystList asset={asset} it={it} onRefresh={onRefresh} />}
        {section === "consensus" && (
          <div className="space-y-2">
            <SectionTitle>{it ? "Proxy probabilità da consensus analisti" : "Probability proxy from analyst consensus"}</SectionTitle>
            <ConsensusPanel asset={asset} it={it} onRefresh={onRefresh} />
          </div>
        )}
        {section === "risks" && (
          <div className="space-y-2">
            <SectionTitle>{it ? "Flag rischio non-clinico" : "Non-clinical risk flags"}</SectionTitle>
            <RiskFlagsSection asset={asset} it={it} onRefresh={onRefresh} />
          </div>
        )}
        {section === "history" && (
          <div className="space-y-2">
            <SectionTitle>{it ? "Storico esiti catalyst" : "Catalyst outcome history"}</SectionTitle>
            <OutcomeHistory ticker={asset.ticker} it={it} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────────────

export function CatalystAnalysisPanel({
  lang = "en",
}: {
  lang?: "it" | "en";
}) {
  const it = lang === "it";
  const [assets, setAssets] = useState<MonitoredAsset[]>(() => listMonitoredAssets());
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [showAddAsset, setShowAddAsset] = useState(false);
  const [addForm, setAddForm] = useState({ ticker: "", name: "", source: "watchlist" as MonitoredAsset["source"] });

  function refresh() {
    setAssets(listMonitoredAssets());
  }

  function handleAddAsset() {
    if (!addForm.ticker) return;
    addMonitoredAsset(addForm.ticker.toUpperCase(), addForm.name, addForm.source);
    setShowAddAsset(false);
    setAddForm({ ticker: "", name: "", source: "watchlist" });
    refresh();
  }

  const selected = selectedTicker ? assets.find((a) => a.ticker === selectedTicker) ?? null : null;

  if (selected) {
    return (
      <div className="p-4">
        <AssetDetailView
          asset={selected}
          it={it}
          onRefresh={refresh}
          onBack={() => setSelectedTicker(null)}
        />
      </div>
    );
  }

  const upcomingCount = assets.reduce((n, a) => n + a.catalysts.filter((c) => c.status === "upcoming" || c.status === "imminent").length, 0);

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-[13px] font-semibold text-ink">
          {it ? "Catalyst Analysis" : "Catalyst Analysis"}
        </h2>
        <p className="text-[10px] text-ink-muted mt-0.5">
          {it
            ? `${assets.length} asset monitorati · ${upcomingCount} catalyst attivi/imminenti`
            : `${assets.length} monitored assets · ${upcomingCount} upcoming/imminent catalysts`}
        </p>
      </div>

      {/* Asset list */}
      <div className="space-y-2">
        {assets.length === 0 && (
          <p className="text-[12px] text-ink-muted italic py-4 text-center">
            {it ? "Nessun asset monitorato. Aggiungine uno qui sotto." : "No monitored assets. Add one below."}
          </p>
        )}
        {assets.map((a) => {
          const upcoming = a.catalysts.filter((c) => c.status === "upcoming" || c.status === "imminent");
          const staleCount = upcoming.filter((c) => isStale(c)).length;
          const activeFlags = a.riskFlags.filter((f) => !f.resolved).length;
          return (
            <button
              key={a.ticker}
              className="w-full text-left rounded-xl border border-slate-200/60 dark:border-slate-700/40 bg-white/40 dark:bg-surface/40 hover:bg-indigo-50/30 dark:hover:bg-indigo-950/10 px-4 py-3 transition-colors"
              onClick={() => setSelectedTicker(a.ticker)}
            >
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-bold text-ink">{a.ticker}</span>
                <span className="text-[11px] text-ink-muted">{a.name}</span>
                <span className={`text-[9px] ml-1 px-1.5 py-0.5 rounded ${a.source === "portfolio" ? "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"}`}>
                  {a.source}
                </span>
                {staleCount > 0 && (
                  <span className="ml-auto text-[9px] text-amber-700 dark:text-amber-300">⚠ {staleCount} stale</span>
                )}
                {activeFlags > 0 && (
                  <span className="text-[9px] text-rose-700 dark:text-rose-300">⚑ {activeFlags}</span>
                )}
              </div>
              {upcoming.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {upcoming.map((c) => (
                    <span key={c.id} className={`text-[10px] px-2 py-0.5 rounded-full ${statusBadge(isStale(c) ? "stale" : c.status)}`}>
                      {c.description} · {c.estimatedWindow}
                    </span>
                  ))}
                </div>
              )}
              {a.proxyResult && (
                <span className={`inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full font-semibold ${tierColorClass(a.proxyResult.uncertaintyTier)}`}>
                  {tierLabel(a.proxyResult.uncertaintyTier, it ? "it" : "en")}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Add asset */}
      {showAddAsset ? (
        <div className="rounded-xl border border-slate-200/60 dark:border-slate-700/40 bg-white/40 dark:bg-surface/40 p-3 space-y-2">
          <p className="text-[11px] font-semibold text-ink">{it ? "Aggiungi asset" : "Add asset"}</p>
          <div className="flex gap-2">
            <input className="w-24 border border-slate-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-surface text-ink text-[11px] uppercase" placeholder="TICKER" value={addForm.ticker} onChange={e => setAddForm(f => ({ ...f, ticker: e.target.value.toUpperCase() }))} />
            <input className="flex-1 border border-slate-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-surface text-ink text-[11px]" placeholder={it ? "Nome azienda" : "Company name"} value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} />
            <select className="border border-slate-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-surface text-ink text-[11px]" value={addForm.source} onChange={e => setAddForm(f => ({ ...f, source: e.target.value as MonitoredAsset["source"] }))}>
              <option value="watchlist">Watchlist</option>
              <option value="portfolio">Portfolio</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button className="text-[11px] font-semibold px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white transition-colors" onClick={handleAddAsset}>{it ? "Aggiungi" : "Add"}</button>
            <button className="text-[11px] px-3 py-1 rounded border border-slate-300 dark:border-slate-600 text-ink-muted hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors" onClick={() => setShowAddAsset(false)}>{it ? "Annulla" : "Cancel"}</button>
          </div>
        </div>
      ) : (
        <button className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline" onClick={() => setShowAddAsset(true)}>
          + {it ? "Monitora nuovo asset" : "Monitor new asset"}
        </button>
      )}

      {/* Sizing reminder */}
      <div className="rounded-xl border border-slate-200/40 dark:border-slate-700/30 bg-slate-50/30 dark:bg-slate-900/10 px-3 py-2 text-[10px] text-ink-muted">
        {it
          ? "💡 Il sizing non è calcolato qui. Porta i dati catalyst (fascia di incertezza, flag rischio) manualmente nel widget Break-even o nello Step 3 Sizing — con un passaggio esplicito. Vedi brief implementativo sezione 4."
          : "💡 Sizing is not calculated here. Bring catalyst data (uncertainty tier, risk flags) manually to the Break-even widget or Step 3 Sizing — with an explicit manual step. See brief section 4."}
      </div>
    </div>
  );
}
