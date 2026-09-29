import { useEffect, useMemo, useRef, useState, type WheelEvent } from "react";
import {
  lookupDeskCompetitionLandscape,
  type CompetitionLandscape,
  type CompetitionPeer,
} from "../api/supernova";
import { looksLikeNctOrStudyLabel, usableProductName } from "../sheet/simRowClinicalMeta";
import {
  getEisDeepDiveNote,
  setEisDeepDiveOtherText,
  subscribeEisDeepDiveNotes,
} from "../sheet/eisDeepDiveNotesStore";
import {
  freeNotesBandLabel,
  scoreFreeNotes,
  type FreeNotesBand,
} from "../sheet/freeNotesScore";

const PERSIST_DEBOUNCE_MS = 450;

function containTextareaWheel(e: WheelEvent<HTMLTextAreaElement>) {
  const el = e.currentTarget;
  const { scrollTop, scrollHeight, clientHeight } = el;
  if (scrollHeight <= clientHeight + 1) return;
  const delta = e.deltaY;
  const atTop = scrollTop <= 0 && delta < 0;
  const atBottom = scrollTop + clientHeight >= scrollHeight - 1 && delta > 0;
  if (!atTop && !atBottom) e.stopPropagation();
}

function previewText(text: string, max = 140): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max).trim()}…`;
}

function notesBandColor(band: FreeNotesBand): string {
  switch (band) {
    case "bullish":
      return "text-emerald-800 dark:text-emerald-300 bg-emerald-50/90 border-emerald-300/70";
    case "constructive":
      return "text-emerald-800/90 dark:text-emerald-200 bg-emerald-50/70 border-emerald-300/50";
    case "mixed":
      return "text-amber-900 dark:text-amber-200 bg-amber-50/90 border-amber-300/70";
    case "cautious":
      return "text-orange-900 dark:text-orange-200 bg-orange-50/90 border-orange-300/70";
    case "bearish":
      return "text-rose-800 dark:text-rose-300 bg-rose-50/90 border-rose-300/70";
    default:
      return "text-ink-muted bg-[rgb(var(--surface-2))] border-[rgb(var(--border))]/50";
  }
}

function phaseTone(phase: string | null | undefined): string {
  const p = (phase || "").toLowerCase();
  if (/approv|launch|market|filed|nda|bla/.test(p)) {
    return "bg-[#34D399]/20 text-[#0B8F62] border-[#34D399]/50";
  }
  if (/phase\s*3|pivotal|fase\s*3/.test(p)) {
    return "bg-[#7C6CF3]/20 text-[#A79AFF] border-[#7C6CF3]/50";
  }
  if (/phase\s*2|fase\s*2/.test(p)) {
    return "bg-[#F3C451]/20 text-[#C4841A] border-[#F3C451]/50";
  }
  return "bg-white/10 text-[#97A2BA] border-white/15";
}

function PeerCard({ peer, it }: { peer: CompetitionPeer; it: boolean }) {
  return (
    <article className="rounded-lg border border-white/[0.12] bg-[#1A2136] px-2.5 py-2 space-y-1.5 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-1.5">
        <div className="min-w-0">
          <p className="text-[12px] font-bold text-[#F3F5FA] leading-snug">
            {peer.product || "—"}
          </p>
          <p className="text-[10px] text-[#97A2BA] leading-snug mt-0.5">
            {[peer.company, peer.ticker].filter(Boolean).join(" · ") || "—"}
            {peer.market_cap ? ` · ${peer.market_cap}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1 justify-end">
          {peer.phase ? (
            <span
              className={`inline-flex rounded-md border px-1.5 py-0.5 text-[9px] font-bold ${phaseTone(peer.phase)}`}
            >
              {peer.phase}
            </span>
          ) : null}
          {peer.modality ? (
            <span className="inline-flex rounded-md border border-white/15 bg-white/5 px-1.5 py-0.5 text-[9px] font-semibold text-[#F3F5FA]">
              {peer.modality}
            </span>
          ) : null}
        </div>
      </div>
      {peer.mechanism_of_action ? (
        <p className="text-[11px] text-[#F3F5FA] leading-snug">
          <span className="font-semibold text-[#97A2BA]">
            {it ? "MoA" : "MoA"}:{" "}
          </span>
          {peer.mechanism_of_action}
        </p>
      ) : null}
      {peer.value_proposition ? (
        <p className="text-[11px] text-[#C5CDDC] leading-snug">
          <span className="font-semibold text-[#97A2BA]">
            {it ? "Value proposition" : "Value proposition"}:{" "}
          </span>
          {peer.value_proposition}
        </p>
      ) : null}
      {peer.nct_id ? (
        <p className="text-[9px] font-mono text-[#5B6580]">{peer.nct_id}</p>
      ) : null}
    </article>
  );
}

/**
 * Gemini competition landscape for the Deep Dive product / indication.
 */
export function EisCompetitionNotesBox({
  ticker,
  it = false,
  productName = null,
  company = null,
  indication = null,
  nctId = null,
}: {
  ticker: string;
  it?: boolean;
  productName?: string | null;
  company?: string | null;
  indication?: string | null;
  nctId?: string | null;
}) {
  const tk = ticker.trim().toUpperCase();
  const productForSearch =
    usableProductName(productName) ||
    (!looksLikeNctOrStudyLabel(productName) ? String(productName || "").trim() : "") ||
    "";
  const indicationForSearch = String(indication || "").trim();
  const searchBody = {
    ticker: tk,
    product_name: productForSearch || undefined,
    company: company || undefined,
    indication: indicationForSearch || undefined,
    nct_id: nctId || undefined,
  };
  const [landscape, setLandscape] = useState<CompetitionLandscape | null>(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const searchGen = useRef(0);

  useEffect(() => {
    if (!tk || (!productForSearch && !indicationForSearch)) {
      setLandscape(null);
      setLoading(false);
      setError(null);
      return;
    }
    let alive = true;
    const gen = ++searchGen.current;
    setLoading(true);
    setError(null);
    void lookupDeskCompetitionLandscape({ ...searchBody, cache_only: true })
      .then((res) => {
        if (!alive || gen !== searchGen.current) return;
        if (!res?.ok || !res.landscape) {
          setLandscape(null);
          setCached(false);
          setUpdatedAt(null);
          if (res?.error && res.error !== "not_prepared") {
            setError(res.detail || res.hint || res.error);
          }
          return;
        }
        setLandscape(res.landscape);
        setUpdatedAt(res.updated_at || null);
        setCached(true);
        setError(null);
      })
      .catch(() => {
        if (!alive || gen !== searchGen.current) return;
        setLandscape(null);
      })
      .finally(() => {
        if (alive && gen === searchGen.current) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // Prepared landscape for this product / disease. No live Gemini.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tk, productForSearch, indicationForSearch, nctId]);

  function buildNow() {
    if (building) return;
    const gen = ++searchGen.current;
    setBuilding(true);
    setError(null);
    void lookupDeskCompetitionLandscape(searchBody)
      .then((res) => {
        if (gen !== searchGen.current) return;
        if (!res?.ok || !res.landscape) {
          const wait = res?.retry_after_s
            ? ` ${it ? "Riprova tra" : "Retry in"} ${Math.ceil(res.retry_after_s / 60)} min.`
            : "";
          setError(`${res?.detail || res?.hint || res?.error || "lookup failed"}${wait}`);
          return;
        }
        setLandscape(res.landscape);
        setUpdatedAt(res.updated_at || null);
        setCached(Boolean(res.cached));
        setError(null);
      })
      .catch((e: unknown) => {
        if (gen !== searchGen.current) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (gen === searchGen.current) setBuilding(false);
      });
  }

  const peers = landscape?.competitors ?? [];
  const canBuild = Boolean(tk) && Boolean(productForSearch || indicationForSearch);
  const contextBits = [productForSearch, indicationForSearch, company].filter((x) =>
    String(x || "").trim(),
  );

  return (
    <section className="rounded-lg border-2 border-[rgb(var(--border))]/55 bg-[rgb(var(--surface))] p-3.5 space-y-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide font-bold text-ink">
            {it ? "Competition" : "Competition"}
          </p>
          <p className="text-[10px] text-ink-muted leading-snug mt-0.5">
            {it
              ? "Competitor clinici esterni sulla stessa malattia — fase, MoA, modality, value proposition, società e market cap. Caricati su richiesta."
              : "External clinical-stage peers on the same disease — phase, MoA, modality, value proposition, company and market cap. Loaded on request."}
          </p>
          {contextBits.length ? (
            <p className="text-[10px] text-[#A79AFF] mt-1 leading-snug">
              {contextBits.join(" · ")}
            </p>
          ) : null}
        </div>
        {canBuild ? (
          <button
            type="button"
            onClick={buildNow}
            disabled={building || loading}
            className="shrink-0 rounded-md border border-[#7C6CF3]/60 bg-[#7C6CF3]/15 px-2 py-1 text-[10px] font-bold text-[#A79AFF] hover:bg-[#7C6CF3]/25 disabled:opacity-50"
          >
            {building
              ? it
                ? "Ricerca in corso…"
                : "Searching…"
              : peers.length
                ? it
                  ? "Aggiorna"
                  : "Refresh"
                : it
                  ? "Carica competition"
                  : "Load competition"}
          </button>
        ) : null}
      </div>

      {landscape?.indication || landscape?.standard_of_care || landscape?.summary ? (
        <div className="rounded-md border border-white/[0.08] bg-[#121729] px-2.5 py-2 space-y-1">
          {landscape.indication ? (
            <p className="text-[11px] text-ink leading-snug">
              <span className="font-semibold text-ink-muted">
                {it ? "Malattia" : "Disease"}:{" "}
              </span>
              {landscape.indication}
            </p>
          ) : null}
          {landscape.standard_of_care ? (
            <p className="text-[11px] text-ink leading-snug">
              <span className="font-semibold text-ink-muted">SoC: </span>
              {landscape.standard_of_care}
            </p>
          ) : null}
          {landscape.summary ? (
            <p className="text-[11px] text-ink-muted leading-snug">{landscape.summary}</p>
          ) : null}
          {updatedAt ? (
            <p className="text-[9px] text-ink-muted/80">
              {cached ? (it ? "Cache" : "Cached") : "Gemini"}
              {` · ${updatedAt.replace("T", " ").replace("Z", " UTC")}`}
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="text-[11px] text-[#F87185] leading-snug">{error}</p>
      ) : null}

      {loading && !peers.length ? (
        <p className="text-[11px] text-ink-muted">
          {it ? "Lettura competition già preparata…" : "Reading the prepared competition…"}
        </p>
      ) : null}

      {building ? (
        <p className="text-[11px] text-ink-muted">
          {it
            ? "Ricerca peer clinici in corso — circa 20 secondi."
            : "Searching clinical peers — about 20 seconds."}
        </p>
      ) : null}

      {peers.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {peers.map((peer, i) => (
            <PeerCard
              key={`${peer.ticker || peer.product || "p"}-${i}`}
              peer={peer}
              it={it}
            />
          ))}
        </div>
      ) : !loading && !building && !error ? (
        <div className="rounded-md border border-dashed border-[rgb(var(--border))]/45 bg-[rgb(var(--surface-2))]/20 px-2.5 py-2">
          <p className="text-[11px] text-ink-muted leading-snug">
            {!canBuild
              ? it
                ? "Serve il farmaco o la malattia per cercare i competitor: questa scheda non li ha ancora risolti."
                : "The search needs the drug or the disease: this card has not resolved them yet."
              : it
                ? "Competition non ancora scritta per questo prodotto. Premi «Carica competition» per cercarla ora."
                : "Competition is not written for this product yet. Press “Load competition” to build it now."}
          </p>
        </div>
      ) : null}
    </section>
  );
}

/** Local free notes — sits at the end of the clinical Deep Dive window. */
export function EisFreeNotesBox({ ticker, it = false }: { ticker: string; it?: boolean }) {
  const tk = ticker.trim().toUpperCase();
  const [otherText, setOtherText] = useState("");
  const [committedOtherText, setCommittedOtherText] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [analysisFlash, setAnalysisFlash] = useState(false);
  const otherPersistTimer = useRef<number | null>(null);
  const otherDraftRef = useRef("");
  const savedFlashTimer = useRef<number | null>(null);
  const analysisFlashTimer = useRef<number | null>(null);

  useEffect(() => {
    const note = getEisDeepDiveNote(tk);
    setOtherText(note.otherText);
    otherDraftRef.current = note.otherText;
    setCommittedOtherText(note.otherText.trim() ? note.otherText : null);
    return subscribeEisDeepDiveNotes(() => {
      const n = getEisDeepDiveNote(tk);
      setOtherText((prev) => (prev === n.otherText ? prev : n.otherText));
      otherDraftRef.current = n.otherText;
    });
  }, [tk]);

  useEffect(
    () => () => {
      if (otherPersistTimer.current != null) window.clearTimeout(otherPersistTimer.current);
      if (savedFlashTimer.current != null) window.clearTimeout(savedFlashTimer.current);
      if (analysisFlashTimer.current != null) window.clearTimeout(analysisFlashTimer.current);
      if (tk) setEisDeepDiveOtherText(tk, otherDraftRef.current);
    },
    [tk],
  );

  const otherDirty =
    committedOtherText != null && otherText.trim() !== committedOtherText.trim();
  const notesScore = useMemo(
    () =>
      committedOtherText != null
        ? scoreFreeNotes(committedOtherText, it)
        : scoreFreeNotes("", it),
    [committedOtherText, it],
  );

  const scheduleOtherPersist = (value: string) => {
    otherDraftRef.current = value;
    setOtherText(value);
    if (otherPersistTimer.current != null) {
      window.clearTimeout(otherPersistTimer.current);
    }
    otherPersistTimer.current = window.setTimeout(() => {
      otherPersistTimer.current = null;
      setEisDeepDiveOtherText(tk, otherDraftRef.current);
      setSavedFlash(true);
      if (savedFlashTimer.current != null) window.clearTimeout(savedFlashTimer.current);
      savedFlashTimer.current = window.setTimeout(() => setSavedFlash(false), 900);
    }, PERSIST_DEBOUNCE_MS);
  };

  const commitOtherNotes = () => {
    const text = otherText;
    if (otherPersistTimer.current != null) {
      window.clearTimeout(otherPersistTimer.current);
      otherPersistTimer.current = null;
    }
    otherDraftRef.current = text;
    setEisDeepDiveOtherText(tk, text);
    setCommittedOtherText(text.trim() ? text : null);
    setAnalysisFlash(true);
    if (analysisFlashTimer.current != null) window.clearTimeout(analysisFlashTimer.current);
    analysisFlashTimer.current = window.setTimeout(() => setAnalysisFlash(false), 1200);
  };

  return (
    <section className="rounded-lg border-2 border-[rgb(var(--border))]/55 bg-[rgb(var(--surface))] p-3.5 space-y-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-wide font-bold text-ink">
            {it ? "Altro (note libere)" : "Other (free notes)"}
          </p>
          <p className="text-[10px] text-ink-muted leading-snug mt-0.5">
            {it
              ? "Note tue sul caso clinico. Salvato per ticker (locale)."
              : "Your notes on this clinical case. Saved per ticker (local)."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {savedFlash ? (
            <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
              {it ? "Salvato" : "Saved"}
            </span>
          ) : null}
          {analysisFlash ? (
            <span className="text-[10px] font-semibold text-[rgb(var(--accent))]">
              {it ? "Note aggiornate" : "Notes updated"}
            </span>
          ) : null}
          {committedOtherText != null && notesScore.score != null ? (
            <span
              className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold tabular-nums ${notesBandColor(notesScore.band)}`}
            >
              {freeNotesBandLabel(notesScore.band, it)} {notesScore.score >= 0 ? "+" : ""}
              {notesScore.score}
            </span>
          ) : null}
        </div>
      </div>
      <label className="block space-y-1">
        <textarea
          className="w-full max-h-[10rem] min-h-[4.5rem] overflow-y-auto overscroll-contain resize-y rounded-md border border-[rgb(var(--border))]/60 bg-[rgb(var(--surface-2))]/40 px-2.5 py-2 text-[12px] leading-snug text-ink placeholder:text-ink-muted/70 focus:outline-none focus:ring-1 focus:ring-[rgb(var(--accent))]/50"
          value={otherText}
          onChange={(e) => scheduleOtherPersist(e.target.value)}
          onWheel={containTextareaWheel}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              commitOtherNotes();
            }
          }}
          placeholder={it ? "Qualsiasi altra nota…" : "Any other note…"}
          spellCheck
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-primary text-[11px] font-semibold px-3 py-1.5"
          onClick={commitOtherNotes}
          disabled={!otherText.trim()}
        >
          {it ? "Inserisci note ↵" : "Commit notes ↵"}
        </button>
        <span className="text-[10px] text-ink-muted">
          {it ? "Ctrl+Invio nella casella" : "Ctrl+Enter in the box"}
        </span>
        {otherDirty ? (
          <span className="text-[10px] font-medium text-amber-800 dark:text-amber-200">
            {it ? "Testo modificato — reinserisci" : "Text changed — commit again"}
          </span>
        ) : null}
      </div>
      {committedOtherText != null && committedOtherText.trim() ? (
        <div className="rounded-md border border-[rgb(var(--border))]/35 bg-[rgb(var(--surface-2))]/30 px-2.5 py-2 space-y-1">
          <ul className="text-[11px] text-ink-muted list-disc pl-4 space-y-0.5">
            {notesScore.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <p className="text-[12px] text-ink leading-snug">{previewText(committedOtherText)}</p>
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-[rgb(var(--border))]/45 bg-[rgb(var(--surface-2))]/20 px-2.5 py-2">
          <p className="text-[11px] text-ink-muted leading-snug">
            {it
              ? "Il summary + score delle note compare qui dopo Inserisci note."
              : "Note summary + score appears here after Commit notes."}
          </p>
        </div>
      )}
    </section>
  );
}
