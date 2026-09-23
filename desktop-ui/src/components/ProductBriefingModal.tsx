/**
 * Catalyst desk — click product name → modality / MoA / indication / SoC.
 * Sparse fields → on-demand Gemini lookup. Display only — not Soft BUY/SELL.
 */
import { useEffect, useRef, useState } from "react";
import { lookupDeskProductBriefing } from "../api/supernova";
import type { EisProductBriefing } from "../sheet/eisProductBriefing";
import {
  mergeProductBriefingWithAiLookup,
  productBriefingNeedsAiEnrichment,
} from "../sheet/eisProductBriefing";
import { AppModal, AppModalCloseButton } from "./AppModal";

export type ProductBriefingModalProps = {
  open: boolean;
  it: boolean;
  ticker: string;
  company?: string | null;
  designation?: string | null;
  briefing: EisProductBriefing;
  nctId?: string | null;
  onClose: () => void;
};

function Row({
  label,
  value,
  empty,
}: {
  label: string;
  value: string | null;
  empty: string;
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </p>
      <p className="text-[12px] text-ink leading-snug">
        {value?.trim() ? value : <span className="text-ink-muted">{empty}</span>}
      </p>
    </div>
  );
}

export function ProductBriefingModal({
  open,
  it,
  ticker,
  company,
  designation,
  briefing: initialBriefing,
  nctId,
  onClose,
}: ProductBriefingModalProps) {
  const [briefing, setBriefing] = useState(initialBriefing);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const lookupKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBriefing(initialBriefing);
    setAiError(null);
    setAiNote(null);
    lookupKeyRef.current = null;
  }, [open, initialBriefing]);

  useEffect(() => {
    if (!open) return;
    const product =
      initialBriefing.productName?.trim() || briefing.productName?.trim() || "";
    if (!product || !productBriefingNeedsAiEnrichment(initialBriefing)) return;

    const key = `${ticker}|${product}`;
    if (lookupKeyRef.current === key) return;
    lookupKeyRef.current = key;

    let cancelled = false;
    setAiLoading(true);
    setAiError(null);
    void lookupDeskProductBriefing({
      ticker,
      product_name: product,
      company: company ?? undefined,
      nct_id: nctId ?? undefined,
      interventions: initialBriefing.interventions ?? undefined,
      conditions: initialBriefing.indication ?? undefined,
    })
      .then((res) => {
        if (cancelled) return;
        if (!res.ok || !res.briefing) {
          setAiError(
            res.hint ||
              res.detail ||
              res.error ||
              (it ? "Ricerca non disponibile" : "Lookup unavailable"),
          );
          return;
        }
        setBriefing((prev) => mergeProductBriefingWithAiLookup(prev, res.briefing!));
        setAiNote(
          res.cached
            ? it
              ? "Da cache Gemini"
              : "From Gemini cache"
            : it
              ? "Da ricerca Gemini"
              : "From Gemini lookup",
        );
      })
      .catch(() => {
        if (!cancelled) {
          setAiError(it ? "Errore di rete" : "Network error");
        }
      })
      .finally(() => {
        if (!cancelled) setAiLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, ticker, company, nctId, initialBriefing, it]);

  const title = briefing.productName || (it ? "Prodotto" : "Product");
  const empty = it ? "Non ancora disponibile" : "Not available yet";
  const loadingEmpty = aiLoading
    ? it
      ? "In caricamento…"
      : "Loading…"
    : empty;

  return (
    <AppModal
      open={open}
      onClose={onClose}
      aria-label={it ? `Prodotto · ${ticker}` : `Product · ${ticker}`}
      panelClassName="w-full max-w-lg overflow-hidden rounded-2xl border border-[rgb(var(--border))]/50 bg-[rgb(var(--surface))] shadow-2xl flex flex-col"
    >
      <div className="flex shrink-0 items-start gap-3 border-b border-[rgb(var(--border))]/40 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
            {it ? "Scheda prodotto" : "Product card"}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-extrabold text-ink tabular-nums">
              {ticker}
            </span>
            {company ? (
              <span className="text-[11px] font-medium text-ink-muted truncate">
                {company}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[13px] font-bold text-ink leading-snug">{title}</p>
          {designation ? (
            <p className="mt-0.5 text-[10px] text-ink-muted leading-snug">
              {designation}
            </p>
          ) : null}
        </div>
        <AppModalCloseButton onClose={onClose} />
      </div>

      <div className="px-4 py-3 space-y-3.5 overflow-y-auto max-h-[70vh]">
        {aiLoading ? (
          <p className="text-[10px] text-ink-muted animate-pulse">
            {it ? "Ricerca Gemini in corso…" : "Gemini lookup in progress…"}
          </p>
        ) : null}
        {aiError ? (
          <p className="text-[10px] text-rose-600 dark:text-rose-400">{aiError}</p>
        ) : null}
        <Row
          label={it ? "Indicazione" : "Indication"}
          value={briefing.indication}
          empty={loadingEmpty}
        />
        <Row
          label={it ? "Prevalenza USA" : "USA prevalence"}
          value={briefing.usaPrevalence}
          empty={loadingEmpty}
        />
        <Row
          label={it ? "Standard of care" : "Standard of care"}
          value={briefing.standardOfCare}
          empty={loadingEmpty}
        />
        <Row
          label={
            it
              ? "Prodotti in Fase III e IV"
              : "Products currently in Phase III and IV"
          }
          value={briefing.phase3And4Products}
          empty={loadingEmpty}
        />
        <Row
          label={it ? "Modality" : "Modality"}
          value={briefing.modality || briefing.productTechnology}
          empty={empty}
        />
        <Row
          label={it ? "Meccanismo di azione (MoA)" : "Mechanism of action (MoA)"}
          value={briefing.mechanismOfAction}
          empty={
            aiLoading
              ? it
                ? "In caricamento…"
                : "Loading…"
              : it
                ? "Non estratto — arricchisci il feed clinico (Deep) o usa Gemini."
                : "Not extracted — enrich clinical feed (Deep) or use Gemini."
          }
        />
        <Row
          label={it ? "Target terapeutico" : "Therapeutic target"}
          value={briefing.therapeuticTarget}
          empty={empty}
        />
        {briefing.interventions &&
        briefing.interventions !== briefing.productName ? (
          <Row
            label={it ? "Interventi (CT.gov)" : "Interventions (CT.gov)"}
            value={briefing.interventions}
            empty={empty}
          />
        ) : null}
        <p className="text-[9px] text-ink-muted leading-snug pt-1">
          {aiNote
            ? aiNote
            : it
              ? "Da profilo clinico AI / CT.gov / Gemini. Solo display — non è Soft BUY/SELL."
              : "From clinical AI profile / CT.gov / Gemini. Display only — not Soft BUY/SELL."}
        </p>
      </div>
    </AppModal>
  );
}
