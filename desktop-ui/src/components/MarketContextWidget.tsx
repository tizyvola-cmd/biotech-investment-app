import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildMarketContextDecisionCtx,
  loadMarketContextSnapshot,
  mcsBandLabel,
  mcsBandWeatherIcon,
  mcsStaleWarning,
  type MarketContextSnapshotDoc,
  type McsBand,
} from "../sheet/marketContextScore";
import { buildMcsBannerSummary } from "../sheet/marketContextBannerSummary";
import { AppModal, AppModalCloseButton } from "./AppModal";

function bandColors(band: McsBand): { bar: string; text: string; bg: string } {
  if (band === "favorable") {
    return { bar: "bg-emerald-500", text: "text-emerald-800", bg: "bg-emerald-50/80 border-emerald-200/70" };
  }
  if (band === "adverse") {
    return { bar: "bg-rose-500", text: "text-rose-800", bg: "bg-rose-50/80 border-rose-200/70" };
  }
  if (band === "ambiguous") {
    return { bar: "bg-amber-400", text: "text-amber-900", bg: "bg-amber-50/80 border-amber-200/70" };
  }
  return { bar: "bg-slate-300", text: "text-slate-600", bg: "bg-slate-50/80 border-slate-200/70" };
}

type ComponentPalette = {
  bar: string;
  swatch: string;
  labelText: string;
  scoreText: string;
};

const COMPONENT_PALETTES: Record<"sector" | "macro" | "breadth" | "fda", ComponentPalette> = {
  sector: {
    bar: "bg-emerald-500/85",
    swatch: "bg-emerald-500",
    labelText: "text-emerald-800",
    scoreText: "text-emerald-800",
  },
  macro: {
    bar: "bg-violet-500/85",
    swatch: "bg-violet-500",
    labelText: "text-violet-800",
    scoreText: "text-violet-800",
  },
  breadth: {
    bar: "bg-sky-500/85",
    swatch: "bg-sky-500",
    labelText: "text-sky-800",
    scoreText: "text-sky-800",
  },
  fda: {
    bar: "bg-amber-500/90",
    swatch: "bg-amber-500",
    labelText: "text-amber-800",
    scoreText: "text-amber-800",
  },
};

function ComponentBar({
  label,
  value,
  quality,
  weightPct,
  tooltip,
  palette,
}: {
  label: string;
  value: number | null | undefined;
  quality?: string;
  weightPct: number;
  tooltip: string;
  palette: ComponentPalette;
}) {
  const v = value != null && Number.isFinite(value) ? value : null;
  return (
    <div className="min-w-0" title={tooltip}>
      <div className="flex items-center justify-between gap-1 text-[10px]">
        <span className="flex items-center gap-1.5 min-w-0">
          <span aria-hidden className={`h-2 w-2 rounded-full shrink-0 ${palette.swatch}`} />
          <span className={`font-medium truncate ${palette.labelText}`}>{label}</span>
          <span className="text-ink-muted/70 text-[9px] tabular-nums shrink-0">· {weightPct}%</span>
        </span>
        <span className={`tabular-nums font-bold ${palette.scoreText}`}>
          {v != null ? Math.round(v) : "—"}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-100/90 mt-1 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${palette.bar}`}
          style={{ width: v != null ? `${Math.max(4, Math.min(100, v))}%` : "0%" }}
        />
      </div>
      {quality && quality !== "full_data" ? (
        <p className="text-[8px] text-amber-700/80 mt-0.5 truncate" title={quality}>
          {quality}
        </p>
      ) : null}
    </div>
  );
}

function McsDetailModal({
  open,
  onClose,
  it,
  doc,
  ctx,
  colors,
  staleWarn,
  err,
}: {
  open: boolean;
  onClose: () => void;
  it: boolean;
  doc: MarketContextSnapshotDoc | null;
  ctx: ReturnType<typeof buildMarketContextDecisionCtx>;
  colors: ReturnType<typeof bandColors>;
  staleWarn: string | null;
  err: string | null;
}) {
  const latest = doc?.latest;
  const comps = latest?.components;
  const mcs = ctx.mcs;

  const sectorTip = it
    ? "Impatto diretto sul verticale: ETF XBI (biotech). Alto = il settore salute/biotech sta scendendo. Basso = il settore tiene."
    : "Direct vertical impact: XBI biotech ETF. High = healthcare/biotech sector is falling. Low = sector holding up.";
  const macroTip = it
    ? "Crisi di mercato generali (agnostiche): paura (VIX) e credito. Colpiscono quasi tutti i titoli, non solo biotech."
    : "Market-wide crises (agnostic): fear (VIX) and credit. Hits almost all stocks, not only biotech.";
  const breadthTip = it
    ? "Salute generale del listino: quanti titoli partecipano al rialzo. Stress ampio = marea che trascina anche biotech/medtech."
    : "Broad tape health: how many stocks join the rally. Wide stress = a tide that can drag biotech/medtech too.";
  const fdaTip = it
    ? "Impatto diretto regolatorio: quante CRL FDA recenti. Riguarda soprattutto biotech/medtech, non il mercato intero."
    : "Direct regulatory hit: recent FDA CRLs. Mainly biotech/medtech — not the whole market.";

  if (!open) return null;

  return (
    <AppModal
      open={open}
      onClose={onClose}
      panelClassName="w-full max-w-lg rounded-xl border border-[rgb(var(--border))]/60 bg-surface shadow-xl overflow-hidden flex flex-col"
      aria-label={it ? "Dettaglio contesto di mercato MCS" : "MCS market context details"}
    >
      <div className={`px-4 py-3 border-b border-[rgb(var(--border))]/40 ${colors.bg}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">
              {it ? "Contesto di mercato (MCS)" : "Market Context (MCS)"}
            </p>
            <p className="text-[10px] text-ink-muted mt-0.5">{mcsBandLabel(ctx.mcsBand, it)}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`text-2xl font-bold tabular-nums ${colors.text}`}>
              {mcsBandWeatherIcon(ctx.mcsBand)} {mcs != null ? Math.round(mcs) : "—"}
            </span>
            <AppModalCloseButton onClose={onClose} />
          </div>
        </div>
      </div>

      <div className="px-4 py-3 overflow-y-auto max-h-[min(70vh,520px)] space-y-3">
        <p className="text-[11px] text-ink-muted leading-snug">
          {it
            ? "Punteggio 0–100 di pressione esterna. Alto (>65) = tempesta fuori → spesso HOLD. Basso (<35) = mare calmo → se scende, guarda la società (EXIT più plausibile). 35–65 = incerto."
            : "Score 0–100 of outside pressure. High (>65) = storm outside → often HOLD. Low (<35) = calm seas → if it drops, look at the company (EXIT more plausible). 35–65 = unclear."}
        </p>

        {mcs != null ? (
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden border border-slate-200/60">
            <div
              className={`h-full ${colors.bar}`}
              style={{ width: `${Math.max(2, Math.min(100, mcs))}%` }}
            />
          </div>
        ) : null}

        <div className="rounded-md border border-[rgb(var(--border))]/40 bg-[rgb(var(--surface-2))]/40 px-3 py-2 text-[10px] leading-snug text-ink-muted space-y-2">
          <div>
            <p className="font-semibold text-violet-900 text-[10.5px]">
              {it ? "1) Crisi che modulano tutto il mercato" : "1) Crises that move the whole market"}
            </p>
            <ul className="mt-1 list-none space-y-1">
              <li>
                <span className="font-semibold text-violet-800">Macro (30%)</span>
                {" — "}
                {it ? "VIX e credito — paura generalizzata." : "VIX and credit — generalized fear."}
              </li>
              <li>
                <span className="font-semibold text-sky-800">Breadth (20%)</span>
                {" — "}
                {it ? "Partecipazione ampia del listino." : "Broad market participation."}
              </li>
            </ul>
          </div>
          <div>
            <p className="font-semibold text-emerald-900 text-[10.5px]">
              {it ? "2) Impatto diretto biotech / medtech" : "2) Direct biotech / medtech impact"}
            </p>
            <ul className="mt-1 list-none space-y-1">
              <li>
                <span className="font-semibold text-emerald-800">
                  {it ? "Settore (40%)" : "Sector (40%)"}
                </span>
                {" — "}
                {it ? "ETF XBI e ratio vs mercato." : "XBI ETF and ratio vs market."}
              </li>
              <li>
                <span className="font-semibold text-amber-800">FDA (10%)</span>
                {" — "}
                {it ? "CRL regolatorie recenti." : "Recent regulatory CRLs."}
              </li>
            </ul>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <ComponentBar
            label={it ? "Settore" : "Sector"}
            value={comps?.sector?.score}
            quality={latest?.data_quality?.sector}
            weightPct={40}
            tooltip={sectorTip}
            palette={COMPONENT_PALETTES.sector}
          />
          <ComponentBar
            label="Macro"
            value={comps?.macro?.score}
            quality={latest?.data_quality?.macro}
            weightPct={30}
            tooltip={macroTip}
            palette={COMPONENT_PALETTES.macro}
          />
          <ComponentBar
            label="Breadth"
            value={comps?.breadth?.score}
            quality={latest?.data_quality?.breadth}
            weightPct={20}
            tooltip={breadthTip}
            palette={COMPONENT_PALETTES.breadth}
          />
          <ComponentBar
            label="FDA"
            value={comps?.fda?.score}
            quality={latest?.data_quality?.fda}
            weightPct={10}
            tooltip={fdaTip}
            palette={COMPONENT_PALETTES.fda}
          />
        </div>

        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-ink-muted tabular-nums">
          {comps?.macro?.vix_level != null ? <span>VIX {comps.macro.vix_level}</span> : null}
          {comps?.sector?.xbi_slope_5d_pct != null ? (
            <span>
              XBI 5d {comps.sector.xbi_slope_5d_pct > 0 ? "+" : ""}
              {comps.sector.xbi_slope_5d_pct}%
            </span>
          ) : null}
          {doc?.last_successful_update ? (
            <span>
              {it ? "Agg." : "Upd."}{" "}
              {new Date(doc.last_successful_update).toLocaleString(it ? "it-IT" : "en-US", {
                month: "short",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          ) : null}
          {doc?.update_status ? <span>{doc.update_status}</span> : null}
        </div>

        {staleWarn ? (
          <p className="text-[10px] font-medium text-amber-800 leading-snug">{staleWarn}</p>
        ) : null}
        {err ? <p className="text-[10px] text-rose-600">{err}</p> : null}

        <div className="pt-2 border-t border-[rgb(var(--border))]/30">
          <button
            type="button"
            className="w-full rounded-lg border border-[rgb(var(--border))]/50 bg-[rgb(var(--surface-3))]/40 px-3 py-2 text-xs font-semibold text-ink hover:bg-[rgb(var(--surface-3))]/70"
            onClick={onClose}
          >
            {it ? "Chiudi" : "Close"}
          </button>
        </div>
      </div>
    </AppModal>
  );
}

export function MarketContextWidget({ lang }: { lang: "it" | "en" }) {
  const it = lang === "it";
  const [doc, setDoc] = useState<MarketContextSnapshotDoc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const suppressOpenUntilRef = useRef(0);

  const closeModal = useCallback(() => {
    suppressOpenUntilRef.current = Date.now() + 450;
    setModalOpen(false);
  }, []);

  const openModal = useCallback(() => {
    if (Date.now() < suppressOpenUntilRef.current) return;
    setModalOpen(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadMarketContextSnapshot()
      .then((d) => {
        if (!cancelled) setDoc(d);
      })
      .catch((e) => {
        if (!cancelled) setErr(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const ctx = buildMarketContextDecisionCtx(doc);
  const mcs = ctx.mcs;
  const colors = bandColors(ctx.mcsBand);
  const staleWarn = mcsStaleWarning(ctx.mcsStaleDays, it);
  const summary = buildMcsBannerSummary(doc, ctx);
  const headline = it ? summary.headlineIt : summary.headlineEn;
  const attribution = it ? summary.attributionIt : summary.attributionEn;

  return (
    <>
      <div className={`rounded-xl border px-3 py-2.5 shrink-0 ${colors.bg}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-ink leading-snug">
              {it ? "Contesto di mercato" : "Market context"}
            </p>
            <p className="text-[11px] font-semibold text-ink mt-1 leading-snug">{headline}</p>
            <p className="text-[10px] text-ink-muted mt-1 leading-snug max-w-[640px]">{attribution}</p>
            {err ? <p className="mt-1 text-[9px] text-rose-600">{err}</p> : null}
          </div>

          <button
            type="button"
            onClick={openModal}
            aria-expanded={modalOpen}
            className={`shrink-0 rounded-lg border border-white/60 bg-white/50 px-2 py-1.5 text-right transition hover:bg-white/80 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent))]/40 ${colors.text}`}
            title={
              it
                ? "Apri dettaglio MCS (punteggio, componenti, VIX…)"
                : "Open MCS details (score, components, VIX…)"
            }
            aria-label={
              it
                ? `Dettaglio MCS — ${mcsBandLabel(ctx.mcsBand, it)}${mcs != null ? `, ${Math.round(mcs)}` : ""}`
                : `MCS details — ${mcsBandLabel(ctx.mcsBand, it)}${mcs != null ? `, ${Math.round(mcs)}` : ""}`
            }
          >
            <p className="text-2xl font-bold tabular-nums leading-none inline-flex items-center justify-end gap-1">
              <span className="text-[1.45rem] leading-none font-normal" aria-hidden>
                {mcsBandWeatherIcon(ctx.mcsBand)}
              </span>
              <span>{mcs != null ? Math.round(mcs) : "—"}</span>
            </p>
            <p className="text-[9px] font-semibold mt-0.5">{mcsBandLabel(ctx.mcsBand, it)}</p>
          </button>
        </div>
      </div>

      <McsDetailModal
        open={modalOpen}
        onClose={closeModal}
        it={it}
        doc={doc}
        ctx={ctx}
        colors={colors}
        staleWarn={staleWarn}
        err={err}
      />
    </>
  );
}
