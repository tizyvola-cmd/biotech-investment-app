import { useEffect, useRef, useState } from "react";
import {
  lookupDeskTicker8kDossier,
  type Ticker8kDossierFiling,
  type UsProductRevenueLookupResult,
  type UsProductRevenueRow,
} from "../api/supernova";
import {
  invalidateUsProductRevenueCache,
  peekUsProductRevenueCache,
  prefetchUsProductRevenue,
} from "../sheet/usProductRevenuePrefetch";
import { formatNewsDimScore } from "../sheet/newsDimensionScores";
import { openExternalUrl } from "../sheet/k8ChartLinks";
import {
  dismissEisNews,
  eisFinancialNewsStableId,
  useDismissedEisNewsIds,
} from "../sheet/eisNewsDismiss";
import { eisScoreLegendCopy, ScoreChipTip } from "./EisScoreLegendHover";
import { eisColor } from "../sheet/eventImpactScore";

function fmtDate(iso: string | null | undefined, it: boolean): string {
  if (!iso) return "—";
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(it ? "it-IT" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function dimTone(n: number | null | undefined): { color: string; border: string; bg: string } {
  if (n == null || !Number.isFinite(n) || Math.abs(n) < 0.15) {
    return { color: "#F3F5FA", border: "rgba(243,245,250,0.28)", bg: "rgba(243,245,250,0.08)" };
  }
  if (n > 0) {
    return { color: "#34D399", border: "rgba(52,211,153,0.45)", bg: "rgba(52,211,153,0.14)" };
  }
  return { color: "#F87185", border: "rgba(248,113,133,0.45)", bg: "rgba(248,113,133,0.14)" };
}

function DimBadge({
  label,
  score,
  title,
}: {
  label: string;
  score: number | null | undefined;
  title: string;
}) {
  if (score == null || !Number.isFinite(score) || Math.abs(score) < 0.15) return null;
  const tone = dimTone(score);
  return (
    <ScoreChipTip tip={title} align="right">
      <span
        className="inline-flex items-center text-[11px] font-bold px-1.5 py-0.5 rounded-full tabular-nums cursor-help"
        style={{ color: tone.color, border: `1px solid ${tone.border}`, background: tone.bg }}
      >
        {label} {formatNewsDimScore(score)}
      </span>
    </ScoreChipTip>
  );
}

function FilingCard({
  filing,
  it,
  ticker,
}: {
  filing: Ticker8kDossierFiling;
  it: boolean;
  ticker: string;
}) {
  const dismissedNews = useDismissedEisNewsIds();
  const [removed, setRemoved] = useState(false);
  const finToneStyle = dimTone(filing.financial_score);
  const sessions = filing.sessions ?? [];
  const href = (filing.link || "").trim();
  const stubTitleRe =
    /^(?:8-K|6-K|424B\d?|DEF\s*14A)?\s*:?\s*(earnings reported|competitor approval|positive topline|trial discontinued|key executive hire)\b/i;
  const rawTitle = (filing.title || "").trim();
  const sessionHeading = (sessions[0]?.title || "").trim();
  const displayTitle =
    stubTitleRe.test(rawTitle) && sessionHeading ? sessionHeading : rawTitle || "SEC filing";
  const dismissId = eisFinancialNewsStableId({
    ticker,
    filingDate: filing.filing_date || filing.event_date,
    title: filing.title,
    link: filing.link,
    form: filing.form,
  });
  if (removed || dismissedNews.has(dismissId)) return null;
  return (
    <article className="relative rounded-xl border border-white/[0.1] bg-[#121729] px-3 py-2.5 pt-6 space-y-2">
      <button
        type="button"
        className="absolute left-1.5 top-1.5 z-20 flex h-5 w-5 items-center justify-center rounded border border-white/15 bg-[#1A2136] text-[12px] leading-none text-[#97A2BA] hover:bg-rose-500/20 hover:text-rose-400 hover:border-rose-500/40 transition-colors cursor-pointer"
        aria-label={it ? "Elimina questa news" : "Delete this news"}
        title={it ? "Elimina dalla lista" : "Remove from list"}
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setRemoved(true);
          dismissEisNews(dismissId);
        }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setRemoved(true);
          dismissEisNews(dismissId);
        }}
      >
        ×
      </button>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-md border border-[#F3C451]/50 bg-[#F3C451]/15 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-[#F3C451]">
              {filing.form || "8-K"}
            </span>
            <span className="text-[11px] tabular-nums text-[#97A2BA]">
              {fmtDate(filing.filing_date || filing.event_date, it)}
            </span>
            {filing.items_raw ? (
              <span className="text-[10px] font-mono text-[#97A2BA]">Item {filing.items_raw}</span>
            ) : null}
          </div>
          <h4 className="mt-1 text-[13px] font-semibold text-[#F3F5FA] leading-snug">
            {displayTitle}
          </h4>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1">
          <ScoreChipTip tip={eisScoreLegendCopy(it).fin} align="right">
            <span
              className="inline-flex items-center text-[12px] font-bold px-2 py-0.5 rounded-full tabular-nums cursor-help"
              style={{
                color: finToneStyle.color,
                border: `1px solid ${finToneStyle.border}`,
                background: finToneStyle.bg,
              }}
            >
              Fin {formatNewsDimScore(filing.financial_score ?? null)}
            </span>
          </ScoreChipTip>
          <div className="flex flex-wrap justify-end gap-1">
            <DimBadge
              label="Clin"
              score={filing.clinical_score}
              title={eisScoreLegendCopy(it).clin}
            />
            <DimBadge
              label="Corp"
              score={filing.corporate_score}
              title={eisScoreLegendCopy(it).corp}
            />
            <DimBadge
              label="Access"
              score={filing.market_access_score}
              title={eisScoreLegendCopy(it).acc}
            />
          </div>
          <ScoreChipTip tip={eisScoreLegendCopy(it).eis} align="right">
            <span
              className="inline-flex items-center gap-1 cursor-help text-[10px] font-bold tabular-nums"
              aria-label={eisScoreLegendCopy(it).eis}
            >
              <span className="text-[9px] uppercase tracking-wide text-[#97A2BA]">EIS</span>
              {filing.eis_score != null && Number.isFinite(filing.eis_score) ? (
                <span
                  className="rounded border px-1.5 py-0.5"
                  style={{
                    color: eisColor(filing.eis_score),
                    borderColor: `${eisColor(filing.eis_score)}55`,
                    background: `${eisColor(filing.eis_score)}14`,
                  }}
                >
                  {formatNewsDimScore(filing.eis_score)}
                </span>
              ) : (
                <span className="rounded border border-white/25 bg-white/[0.04] px-1.5 py-0.5 text-[#97A2BA]">
                  —
                </span>
              )}
            </span>
          </ScoreChipTip>
        </div>
      </div>
      {sessions.length ? (
        <div className="space-y-2">
          {sessions.map((s, i) => {
            const official = (s.item_title || "").trim();
            const heading = (s.title || "").trim();
            const showHeading = Boolean(heading && heading !== official);
            return (
            <div
              key={`${s.item}-${i}`}
              className="rounded-md border border-white/[0.08] bg-[#1A2136] px-2.5 py-1.5"
            >
              <p className="text-[9px] font-bold uppercase tracking-wide text-[#F3C451]">
                Item {s.item || "—"}
                {official ? ` · ${official}` : ""}
              </p>
              {showHeading ? (
                <p className="mt-0.5 text-[13px] font-semibold text-[#F3F5FA] leading-snug">
                  {heading}
                </p>
              ) : null}
              <p className="mt-0.5 text-[12px] leading-relaxed text-[#F3F5FA]">
                {s.summary || (it ? "Nessun testo sostanziale in questa sessione." : "No substantive text in this session.")}
              </p>
            </div>
            );
          })}
        </div>
      ) : (
        <p className="text-[11px] italic text-[#97A2BA]">
          {it
            ? "File letto, ma nessuna sessione Item segmentata."
            : "Filing read, but no Item sessions were segmented."}
        </p>
      )}
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex text-[11px] font-semibold text-[#A79AFF] hover:underline"
          onClick={(e) => openExternalUrl(href, e)}
        >
          {it ? "Apri 8-K SEC →" : "Open SEC 8-K →"}
        </a>
      ) : null}
    </article>
  );
}

function readableDeskError(raw: string, it: boolean): string {
  const s = String(raw || "").trim();
  if (!s) return s;
  if (/<!doctype|<html[\s>]|cloudflare|origin_timeout/i.test(s)) {
    return it
      ? "Il server non ha risposto in tempo. Riapri la tab tra un minuto."
      : "The server did not answer in time. Reopen this tab in a minute.";
  }
  return s.slice(0, 280);
}

export function TickerFinancial8kPanel({
  ticker,
  company,
  it,
}: {
  ticker: string;
  company?: string | null;
  clinicalRecords?: unknown;
  it: boolean;
}) {
  const tk = ticker.trim().toUpperCase();
  const dismissedNews = useDismissedEisNewsIds();
  const [filings, setFilings] = useState<Ticker8kDossierFiling[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [nextRefresh, setNextRefresh] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const [revRows, setRevRows] = useState<UsProductRevenueRow[]>([]);
  const [revPeriod, setRevPeriod] = useState<string | null>(null);
  const [revPeriodHalf, setRevPeriodHalf] = useState<string | null>(null);
  const [revPeriodYear, setRevPeriodYear] = useState<string | null>(null);
  const [revLoading, setRevLoading] = useState(false);
  const [revErr, setRevErr] = useState<string | null>(null);
  const [revNote, setRevNote] = useState<string | null>(null);
  const revLookupTkRef = useRef<string | null>(null);
  const companyRef = useRef(company);
  companyRef.current = company;

  useEffect(() => {
    if (!tk) {
      setFilings([]);
      return;
    }
    let alive = true;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    const friendly = (raw: string) => {
      if (raw === "building") {
        return it ? "Lettura filing SEC in corso…" : "Reading SEC filings…";
      }
      return readableDeskError(raw, it);
    };
    const pull = () => {
      void lookupDeskTicker8kDossier({ ticker: tk })
        .then((res) => {
          if (!alive) return;
          if (res?.error === "building" && attempts < 20) {
            attempts += 1;
            setLoading(true);
            setErr(null);
            pollTimer = setTimeout(pull, 8_000);
            return;
          }
          if (!res?.ok) {
            setErr(friendly(res?.error || res?.hint || "8k_dossier_failed"));
            setFilings([]);
            setLoading(false);
            return;
          }
          setFilings(res.dossier?.filings ?? []);
          setNextRefresh(res.next_refresh || res.dossier?.next_refresh || null);
          setCached(Boolean(res.cached));
          setErr(null);
          setLoading(false);
        })
        .catch((e) => {
          if (!alive) return;
          const name = e instanceof Error ? e.name : "";
          const msg = e instanceof Error ? e.message : String(e);
          if (name === "AbortError" || /aborted/i.test(msg)) {
            setErr(
              it
                ? "Timeout dossier 8-K — riprova tra poco."
                : "8-K dossier timed out — try again shortly.",
            );
          } else {
            setErr(friendly(msg));
          }
          setFilings([]);
          setLoading(false);
        });
    };
    setLoading(true);
    setErr(null);
    pull();
    return () => {
      alive = false;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [tk, it]);

  // US revenue — prefetch on mount (Deep Dive keeps this panel mounted hidden
  // so Gemini starts before Financial is opened). Poll while backend builds.
  useEffect(() => {
    if (!tk) {
      setRevRows([]);
      setRevPeriod(null);
      setRevPeriodHalf(null);
      setRevPeriodYear(null);
      revLookupTkRef.current = null;
      return;
    }

    let alive = true;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();
    const MAX_POLL_MS = 4 * 60_000;

    const applyRes = (res: UsProductRevenueLookupResult) => {
      const products = Array.isArray(res.products) ? res.products.filter((p) => p.name) : [];
      setRevRows(products);
      setRevPeriod(res.period?.trim() || null);
      setRevPeriodHalf(res.period_half?.trim() || null);
      setRevPeriodYear(res.period_year?.trim() || null);
      const building =
        res.error === "building" ||
        /background/i.test(String(res.hint || "")) ||
        /background/i.test(String(res.detail || ""));
      if (products.length || (res.ok && !building)) {
        revLookupTkRef.current = tk;
      }
      if (!res.ok && !products.length) {
        if (building) {
          setRevErr(null);
          setRevNote(
            it
              ? "Ricerca tabella USA in corso (avviata con la scheda)…"
              : "Building US table (started with this card)…",
          );
          return true;
        }
        setRevErr(readableDeskError(res.hint || res.detail || res.error || "", it));
        setRevNote(null);
        return false;
      }
      setRevErr(null);
      const stale = Boolean((res as { stale_schema?: boolean }).stale_schema);
      setRevNote(
        stale
          ? it
            ? "Cache precedente · solo mercato USA"
            : "Prior cache · US market only"
          : res.cached
            ? it
              ? "Cache · solo mercato USA"
              : "Cached · US market only"
            : it
              ? "Gemini · solo mercato USA"
              : "Gemini · US market only",
      );
      return false;
    };

    const schedulePoll = () => {
      if (!alive) return;
      if (Date.now() - startedAt > MAX_POLL_MS) {
        setRevLoading(false);
        setRevNote(
          it
            ? "Nessun breakdown revenue USA trovato (o Gemini ancora in corso)."
            : "No US product revenue breakdown found (or Gemini still running).",
        );
        return;
      }
      pollTimer = setTimeout(() => {
        if (!alive) return;
        invalidateUsProductRevenueCache(tk);
        void prefetchUsProductRevenue({
          ticker: tk,
          company: companyRef.current ?? undefined,
        })
          .then((res) => {
            if (!alive) return;
            const stillBuilding = applyRes(res);
            if (stillBuilding) schedulePoll();
            else setRevLoading(false);
          })
          .catch(() => {
            if (alive) schedulePoll();
          });
      }, 12_000);
    };

    const cached = peekUsProductRevenueCache({ ticker: tk });
    if (cached && (cached.ok || (cached.products?.length ?? 0) > 0)) {
      applyRes(cached);
      setRevLoading(false);
      revLookupTkRef.current = tk;
      return () => {
        alive = false;
      };
    }

    setRevLoading(true);
    setRevErr(null);
    if (!cached) {
      setRevRows([]);
      setRevPeriod(null);
      setRevPeriodHalf(null);
      setRevPeriodYear(null);
      setRevNote(null);
    } else {
      applyRes(cached);
    }

    void prefetchUsProductRevenue({
      ticker: tk,
      company: companyRef.current ?? undefined,
    })
      .then((res) => {
        if (!alive) return;
        const stillBuilding = applyRes(res);
        if (stillBuilding) {
          setRevLoading(true);
          schedulePoll();
        } else {
          setRevLoading(false);
        }
      })
      .catch((e) => {
        if (!alive) return;
        const name = e instanceof Error ? e.name : "";
        const msg = e instanceof Error ? e.message : String(e);
        if (name === "AbortError" || /aborted/i.test(msg)) {
          setRevErr(
            it
              ? "Timeout ricerca revenue USA — riprova tra poco."
              : "US revenue lookup timed out — try again shortly.",
          );
        } else {
          setRevErr(readableDeskError(msg, it));
        }
        setRevLoading(false);
      });

    return () => {
      alive = false;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [tk, it]);

  const visibleFilings = filings.filter(
    (f) =>
      !dismissedNews.has(
        eisFinancialNewsStableId({
          ticker: tk,
          filingDate: f.filing_date || f.event_date,
          title: f.title,
          link: f.link,
          form: f.form,
        }),
      ),
  );

  let finSum: number | null = null;
  {
    let s = 0;
    let n = 0;
    for (const f of visibleFilings) {
      const v = f.financial_score;
      if (v == null || !Number.isFinite(v)) continue;
      s += v;
      n += 1;
    }
    if (n > 0) finSum = Math.round(s * 10) / 10;
  }
  const finSumTone = dimTone(finSum);

  return (
    <section className="space-y-4" aria-label={it ? "Financial" : "Financial"}>
      <div className="rounded-xl border border-white/[0.12] bg-[#121729] px-3 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide font-semibold text-[#97A2BA]">
            {it ? "Financial" : "Financial"}
          </p>
          <h2 className="text-lg font-bold text-[#F3F5FA]">{tk || "—"}</h2>
          <p className="text-[10px] text-[#97A2BA] mt-0.5">
            {it
              ? visibleFilings.length
                ? `Somma score Fin di ${visibleFilings.length} filing`
                : "Nessun filing in lista"
              : visibleFilings.length
                ? `Sum of Fin scores across ${visibleFilings.length} filings`
                : "No filings in list"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <ScoreChipTip tip={eisScoreLegendCopy(it).eis} align="right">
            <span
              className="inline-flex items-center gap-1 cursor-help rounded-full border border-white/20 bg-white/[0.04] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[#97A2BA]"
              aria-label={eisScoreLegendCopy(it).eis}
            >
              EIS
            </span>
          </ScoreChipTip>
          {finSum != null ? (
            <ScoreChipTip tip={eisScoreLegendCopy(it).fin} align="right">
              <span
                className="inline-flex items-center text-lg font-bold px-3 py-1 rounded-full tabular-nums cursor-help"
                style={{
                  color: finSumTone.color,
                  border: `1px solid ${finSumTone.border}`,
                  background: finSumTone.bg,
                }}
              >
                Σ Fin {formatNewsDimScore(finSum)}
              </span>
            </ScoreChipTip>
          ) : (
            <span className="text-sm text-[#97A2BA] px-2">Σ Fin —</span>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-white/[0.12] bg-[#1A2136] px-3 py-3 space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[10px] uppercase tracking-wide font-bold text-[#F3C451]">
            {it ? "Ricavi prodotto (USA)" : "Product revenue (US)"}
          </p>
          {revNote ? (
            <p className="text-[9px] text-[#97A2BA]">{revNote}</p>
          ) : revLoading ? (
            <p className="text-[9px] text-[#97A2BA] animate-pulse">
              {it
                ? "Prima volta: ricerca Gemini in corso…"
                : "First load: Gemini lookup in progress…"}
            </p>
          ) : null}
        </div>
        <p className="text-[11px] text-[#C5CDDC] leading-snug">
          {it
            ? "Tabella brand USA: indication, therapeutic area, MoA/target, modality, prevalenza, anno approvazione FDA, patent cliff, linea, earnings Q / semestre / anno. Include anche brand mid-tier (FY fino a ~$350M). Ordinata per revenue trimestre."
            : "US brand table: indication, therapeutic area, MoA/target, modality, prevalence, US FDA approval year, patent cliff, line of therapy, Q / half / year earnings. Includes mid-tier brands (FY up to ~$350M). Ranked by quarter revenue."}
        </p>
        {(revPeriod || revPeriodHalf || revPeriodYear) ? (
          <p className="text-[11px] font-semibold text-[#A79AFF] flex flex-wrap gap-x-3 gap-y-0.5">
            {revPeriod ? <span>{it ? "Q: " : "Q: "}{revPeriod}</span> : null}
            {revPeriodHalf ? <span>{it ? "Semestre: " : "Half: "}{revPeriodHalf}</span> : null}
            {revPeriodYear ? <span>{it ? "Anno: " : "Year: "}{revPeriodYear}</span> : null}
          </p>
        ) : null}
        {revErr ? <p className="text-[10px] text-[#F87185]">{revErr}</p> : null}
        {revRows.length ? (
          <div className="rounded-lg border border-white/[0.08] overflow-hidden">
            <table className="w-full table-fixed text-left border-collapse">
              <colgroup>
                <col style={{ width: "2.5%" }} />
                <col style={{ width: "8.5%" }} />
                <col style={{ width: "11%" }} />
                <col style={{ width: "9%" }} />
                <col style={{ width: "11%" }} />
                <col style={{ width: "6.5%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "5%" }} />
                <col style={{ width: "7.5%" }} />
                <col style={{ width: "5.5%" }} />
                <col style={{ width: "7%" }} />
                <col style={{ width: "7%" }} />
                <col style={{ width: "7%" }} />
              </colgroup>
              <thead>
                <tr className="bg-[#121729] text-[8px] uppercase tracking-wide text-[#97A2BA]">
                  <th className="px-0.5 py-1 font-bold text-center">#</th>
                  <th className="px-1 py-1 font-bold">{it ? "Prodotto" : "Product"}</th>
                  <th className="px-1 py-1 font-bold">Indication</th>
                  <th className="px-1 py-1 font-bold">{it ? "Area" : "Area"}</th>
                  <th className="px-1 py-1 font-bold">MoA</th>
                  <th className="px-1 py-1 font-bold">Mod.</th>
                  <th className="px-1 py-1 font-bold">{it ? "Prev. USA" : "USA prev."}</th>
                  <th className="px-1 py-1 font-bold">{it ? "Appr. USA" : "FDA yr"}</th>
                  <th className="px-1 py-1 font-bold">Patent</th>
                  <th className="px-1 py-1 font-bold">{it ? "Linea" : "Line"}</th>
                  <th className="px-1 py-1 font-bold tabular-nums text-right">
                    {revPeriod || "Q"}
                  </th>
                  <th className="px-1 py-1 font-bold tabular-nums text-right">
                    {revPeriodHalf || (it ? "Sem." : "Half")}
                  </th>
                  <th className="px-1 py-1 font-bold tabular-nums text-right">
                    {revPeriodYear || (it ? "Anno" : "Year")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {revRows.map((row, i) => {
                  const indication = row.indication?.trim() || "—";
                  const ta = row.therapeutic_area?.trim() || "—";
                  const moa = row.moa_target?.trim() || "—";
                  const modality = row.modality?.trim() || "—";
                  const prev = row.usa_prevalence?.trim() || "—";
                  const approved = row.us_approval_year?.trim() || "—";
                  const patent = row.patent_cliff?.trim() || "—";
                  const line = row.line_of_therapy?.trim() || "—";
                  const q =
                    row.us_revenue_q_label ||
                    (row.us_revenue_q_usd_m != null
                      ? `$${Number(row.us_revenue_q_usd_m).toLocaleString(it ? "it-IT" : "en-US")}M`
                      : "—");
                  const h =
                    row.us_revenue_h_label ||
                    (row.us_revenue_h_usd_m != null
                      ? `$${Number(row.us_revenue_h_usd_m).toLocaleString(it ? "it-IT" : "en-US")}M`
                      : "—");
                  const y =
                    row.us_revenue_y_label ||
                    (row.us_revenue_y_usd_m != null
                      ? `$${Number(row.us_revenue_y_usd_m).toLocaleString(it ? "it-IT" : "en-US")}M`
                      : "—");
                  return (
                    <tr
                      key={`${row.name}-${i}`}
                      className="border-t border-white/[0.06] text-[10px] text-[#F3F5FA] align-top"
                    >
                      <td className="px-0.5 py-1 tabular-nums text-center text-[#5B6580]">{i + 1}</td>
                      <td className="px-1 py-1 leading-snug" title={row.notes?.trim() || row.name || undefined}>
                        <span className="font-semibold text-[#A79AFF] line-clamp-2 break-words">
                          {row.name}
                        </span>
                      </td>
                      <td className="px-1 py-1 text-[#C5CDDC] leading-snug" title={indication}>
                        <span className="line-clamp-2 break-words">{indication}</span>
                      </td>
                      <td className="px-1 py-1 text-[#C5CDDC] leading-snug" title={ta}>
                        <span className="line-clamp-2 break-words">{ta}</span>
                      </td>
                      <td className="px-1 py-1 text-[#A79AFF]/95 leading-snug" title={moa}>
                        <span className="line-clamp-2 break-words">{moa}</span>
                      </td>
                      <td className="px-1 py-1 text-[#C5CDDC] leading-snug" title={modality}>
                        <span className="line-clamp-2 break-words">{modality}</span>
                      </td>
                      <td className="px-1 py-1 text-[#97A2BA] leading-snug" title={prev}>
                        <span className="line-clamp-2 break-words">{prev}</span>
                      </td>
                      <td className="px-1 py-1 text-[#86EFAC] leading-snug tabular-nums" title={approved}>
                        <span className="line-clamp-2 break-words">{approved}</span>
                      </td>
                      <td className="px-1 py-1 text-[#FBBF24] leading-snug" title={patent}>
                        <span className="line-clamp-2 break-words">{patent}</span>
                      </td>
                      <td className="px-1 py-1 leading-snug" title={line}>
                        <span className="line-clamp-2 break-words">{line}</span>
                      </td>
                      <td className="px-1 py-1 tabular-nums text-right font-semibold text-[#34D399] whitespace-nowrap">
                        {q}
                      </td>
                      <td className="px-1 py-1 tabular-nums text-right text-[#34D399]/90 whitespace-nowrap">
                        {h}
                      </td>
                      <td className="px-1 py-1 tabular-nums text-right text-[#34D399]/80 whitespace-nowrap">
                        {y}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        {revLoading && !revRows.length ? (
          <p className="text-[11px] text-[#97A2BA] animate-pulse">
            {it
              ? "Ricerca tabella USA (Gemini) — le aperture successive useranno la cache…"
              : "Building US table (Gemini) — later opens use cache…"}
          </p>
        ) : null}
        {!revLoading && !revErr && !revRows.length ? (
          <p className="text-[11px] text-[#97A2BA]">
            {it
              ? "Nessun breakdown revenue USA per prodotto trovato (tipico se la società non pubblica brand-level US sales)."
              : "No US product revenue breakdown found (typical when the company does not disclose brand-level US sales)."}
          </p>
        ) : null}
      </div>

      <header className="space-y-0.5">
        <p className="text-[11px] uppercase tracking-wide font-semibold text-ink-muted">
          {it ? "News finanziarie" : "Financial news"}
        </p>
        <h2 className="text-lg font-bold text-ink">{tk || "—"}</h2>
        <p className="text-[11px] text-ink-muted leading-snug">
          {it
            ? "8-K / 6-K, 424B (prospectus) e DEF 14A (proxy) EDGAR degli ultimi 2 mesi. Riassunto concettuale ~65 parole; score Fin/Clin/Corp a destra. Refresh ogni mercoledì mattina."
            : "EDGAR 8-K / 6-K, 424B prospectus supplements, and DEF 14A proxies from the last 2 months. ~65-word conceptual summaries; Fin/Clin/Corp scores on the right. Refresh every Wednesday morning."}
        </p>
        {nextRefresh ? (
          <p className="text-[10px] text-ink-muted">
            {cached ? (it ? "Cache · " : "Cached · ") : ""}
            {it ? "Prossimo refresh: " : "Next refresh: "}
            {fmtDate(nextRefresh, it)}
          </p>
        ) : null}
      </header>
      {loading ? (
        <p className="text-[12px] text-ink-muted">
          {it
            ? "Lettura filing SEC su EDGAR (8-K / 6-K / 424B / DEF 14A, ultimi 2 mesi)…"
            : "Reading EDGAR filings (8-K / 6-K / 424B / DEF 14A, last 2 months)…"}
        </p>
      ) : null}
      {err ? <p className="text-[12px] text-[rgb(var(--negative))]">{err}</p> : null}
      {!loading && visibleFilings.length ? (
        <div className="space-y-2">
          {visibleFilings.map((f, i) => (
            <FilingCard
              key={f.link || `${f.filing_date}-${f.title}-${i}`}
              filing={f}
              it={it}
              ticker={tk}
            />
          ))}
        </div>
      ) : null}
      {!loading && !err && !visibleFilings.length ? (
        <p className="text-[12px] text-ink-muted text-center py-8 border border-dashed rounded-lg border-[rgb(var(--border))]/50">
          {it
            ? "Nessun 8-K / 6-K / 424B / DEF 14A EDGAR negli ultimi 2 mesi per questo ticker."
            : "No EDGAR 8-K / 6-K / 424B / DEF 14A filings in the last 2 months for this ticker."}
        </p>
      ) : null}
    </section>
  );
}
