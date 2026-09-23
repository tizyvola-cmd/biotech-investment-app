import { useT } from "../shared/i18n";
import { eisColor } from "../sheet/eventImpactScore";
import {
  formatManualNewsEisShort,
  manualNewsEisKindLabel,
  type ManualNewsEisKind,
} from "../sheet/manualNewsEis";
import { useInvestorArticleBrief } from "../hooks/useInvestorArticleBrief";
import { AppModal, AppModalCloseButton } from "./AppModal";
import { EisThermometerPanel } from "./EisThermometerPanel";
import { InvestorArticleBriefBody } from "./InvestorArticleBriefBody";
import { NewsCompanyProductDebrief } from "./NewsCompanyProductDebrief";

export type ManualNewsDetailPayload = {
  ticker?: string;
  eventDate: string | null;
  title: string;
  body: string;
  source?: string | null;
  link?: string | null;
  /** Market EIS (price/volume). */
  eisScore: number;
  /** News intrinsic EIS (clinical/financial/corporate) — not added into market. */
  eisNews?: number | null;
  newsKind?: ManualNewsEisKind | null;
};

function fmtDate(iso: string | null, it: boolean): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(it ? "it-IT" : "en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtEisScore(score: number): string {
  return `${score >= 0 ? "+" : ""}${score.toFixed(1)}`;
}

function isExternalUrl(link: string | null | undefined): boolean {
  const url = link?.trim();
  return Boolean(url && /^https?:\/\//i.test(url));
}

export function ManualNewsDetailModal({
  payload,
  it,
  onClose,
}: {
  payload: ManualNewsDetailPayload;
  it: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const kind = payload.newsKind ?? "corporate";
  const newsLabel = formatManualNewsEisShort(payload.eisNews, kind);
  const showMarket = Math.abs(payload.eisScore) >= 0.05;
  const link = payload.link?.trim() || null;

  const { brief, busy, error } = useInvestorArticleBrief({
    title: payload.title,
    url: link,
    summary: payload.body,
    ticker: payload.ticker,
    enabled: Boolean(link || (payload.body && payload.body.length > 40)),
  });

  return (
    <AppModal
      open
      onClose={onClose}
      aria-label={it ? "Dettaglio news" : "News detail"}
      panelClassName="w-full max-w-lg"
    >
      <div className="card w-full max-h-[85vh] overflow-y-auto shadow-xl flex flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-[rgb(var(--border))]/40 px-4 py-3 shrink-0">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
              {payload.ticker ? `${payload.ticker} · ` : ""}
              {fmtDate(payload.eventDate, it)}
            </p>
            <h3 className="text-sm font-bold text-ink leading-snug mt-0.5">{payload.title}</h3>
          </div>
          <div className="flex items-start gap-2 shrink-0">
            <div className="flex flex-col items-end gap-0.5">
              <span
                className="text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-md bg-surface/80"
                style={{ color: showMarket ? eisColor(payload.eisScore) : undefined }}
                title={it ? "EIS mercato (prezzo/volume)" : "Market EIS (price/volume)"}
              >
                {it ? "Mercato" : "Market"}{" "}
                {showMarket ? fmtEisScore(payload.eisScore) : "—"}
              </span>
              {newsLabel ? (
                <span
                  className="text-[10px] font-semibold tabular-nums px-2 py-0.5 rounded-md bg-[rgb(var(--accent))]/8"
                  style={{
                    color:
                      payload.eisNews != null ? eisColor(payload.eisNews) : undefined,
                  }}
                  title={
                    it
                      ? `EIS news (${manualNewsEisKindLabel(kind, true)}) — non sommato nel market`
                      : `News EIS (${manualNewsEisKindLabel(kind, false)}) — not added into market`
                  }
                >
                  {manualNewsEisKindLabel(kind, it)} {fmtEisScore(payload.eisNews!)}
                </span>
              ) : null}
            </div>
            <AppModalCloseButton onClose={onClose} />
          </div>
        </div>
        <div className="px-4 py-3 space-y-2 text-[12px] leading-relaxed min-h-0 overflow-y-auto">
          {payload.source ? (
            <p className="text-[11px] text-ink-muted">
              <span className="font-semibold">{it ? "Fonte" : "Source"}:</span> {payload.source}
            </p>
          ) : null}
          <NewsCompanyProductDebrief
            ticker={payload.ticker}
            title={payload.title || brief?.headline || null}
            productHint={brief?.product || null}
            indicationHint={brief?.indication || null}
            phaseHint={brief?.phase || null}
            it={it}
          />
          {brief?.taxonomy_dimensions ? (
            <EisThermometerPanel
              taxonomy={
                brief.taxonomy_dimensions as import("../sheet/eisThermometer").TaxonomyDimsInput
              }
              articleKey={
                String(link || payload.title || payload.ticker || "").trim() || null
              }
              it={it}
            />
          ) : null}
          <InvestorArticleBriefBody
            brief={brief}
            busy={busy}
            error={error}
            fallbackText={payload.body || payload.title}
            it={it}
          />
          {isExternalUrl(link) ? (
            <a
              href={link!}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex text-[11px] font-semibold text-accent hover:underline"
            >
              {t("manualFeed.detail.openFull")}
            </a>
          ) : null}
        </div>
      </div>
    </AppModal>
  );
}
