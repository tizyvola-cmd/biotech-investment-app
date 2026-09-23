import { useEffect, useMemo, useState } from "react";
import { fetchClinicalPreCdSnapshot, type ClinicalPreCdRecord } from "../api";
import { eisColor } from "../eis/eventImpactScore";
import { impactKindBadge } from "../eis/tickerImpactEvents";
import { useMobileLang } from "../hooks/useMobileLang";
import {
  buildPortfolioImpactNews,
  type PortfolioImpactEventRow,
  type PortfolioImpactWindow,
} from "../mobilePortfolioImpactNews";
import type { InvestSimInputs, SheetTable } from "../types";

type Props = {
  sheet: SheetTable | null;
  inputs: InvestSimInputs;
  onOpenRow?: (key: string) => void;
};

function fmtShortDate(iso: string | null, it: boolean): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString(it ? "it-IT" : "en-GB", { day: "2-digit", month: "short" });
}

function NewsEventRow({
  row,
  it,
  onOpen,
}: {
  row: PortfolioImpactEventRow;
  it: boolean;
  onOpen?: () => void;
}) {
  const ev = row.event;
  const badge = impactKindBadge(row.kind, it);
  const href = ev.link?.trim() || ev.studyUrl?.trim() || null;
  const score = ev.breakdown.score;

  return (
    <li className="mob-impact-event mob-portfolio-news-event">
      {onOpen ? (
        <button type="button" className="mob-portfolio-news-ticker" onClick={onOpen}>
          {row.ticker}
        </button>
      ) : (
        <span className="mob-portfolio-news-ticker mob-portfolio-news-ticker--static">{row.ticker}</span>
      )}
      <div className="mob-impact-event-main">
        <div className="mob-impact-event-meta">
          <span className={`mob-impact-badge ${badge.className}`}>{badge.label}</span>
          <span className="mob-impact-date">{fmtShortDate(ev.eventDate, it)}</span>
        </div>
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="mob-impact-title mob-impact-title--link">
            {ev.title}
          </a>
        ) : (
          <p className="mob-impact-title">{ev.title}</p>
        )}
      </div>
      <span className="mob-impact-score" style={{ color: eisColor(score) }}>
        {score >= 0 ? "+" : ""}
        {score.toFixed(1)}
      </span>
    </li>
  );
}

function NewsLane({
  label,
  rows,
  emptyLabel,
  it,
  onOpenRow,
}: {
  label: string;
  rows: PortfolioImpactEventRow[];
  emptyLabel: string;
  it: boolean;
  onOpenRow?: (key: string) => void;
}) {
  return (
    <div className="mob-impact-lane mob-portfolio-news-lane">
      <p className="mob-impact-lane-label">{label}</p>
      {rows.length ? (
        <ul className="mob-impact-events">
          {rows.map((row, i) => (
            <NewsEventRow
              key={`${row.key}-${row.event.eventDate}-${row.event.title}-${i}`}
              row={row}
              it={it}
              onOpen={onOpenRow ? () => onOpenRow(row.key) : undefined}
            />
          ))}
        </ul>
      ) : (
        <p className="hint mob-impact-empty">{emptyLabel}</p>
      )}
    </div>
  );
}

function NewsWindowBlock({
  title,
  window,
  it,
  emptyEis,
  emptyReg,
  onOpenRow,
}: {
  title: string;
  window: PortfolioImpactWindow;
  it: boolean;
  emptyEis: string;
  emptyReg: string;
  onOpenRow?: (key: string) => void;
}) {
  return (
    <div className="mob-portfolio-news-window">
      <h3 className="mob-portfolio-news-window-title">{title}</h3>
      <div className="mob-impact-grid mob-portfolio-news-grid">
        <NewsLane label="EIS" rows={window.eis} emptyLabel={emptyEis} it={it} onOpenRow={onOpenRow} />
        <NewsLane
          label={it ? "Regolatorio" : "Regulatory"}
          rows={window.regulatory}
          emptyLabel={emptyReg}
          it={it}
          onOpenRow={onOpenRow}
        />
      </div>
    </div>
  );
}

export function MobilePortfolioImpactNewsPanel({ sheet, inputs, onOpenRow }: Props) {
  const { t, lang } = useMobileLang();
  const it = lang === "it";
  const [clinicalRecords, setClinicalRecords] = useState<ClinicalPreCdRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchClinicalPreCdSnapshot()
      .then((snap) => {
        if (!cancelled) setClinicalRecords(snap.records ?? []);
      })
      .catch(() => {
        if (!cancelled) setClinicalRecords([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const news = useMemo(
    () => buildPortfolioImpactNews(sheet, inputs, clinicalRecords, lang),
    [sheet, inputs, clinicalRecords, lang],
  );

  const hasAny =
    news.h24.eis.length +
      news.h24.regulatory.length +
      news.d7.eis.length +
      news.d7.regulatory.length >
    0;

  return (
    <section className="card portfolio-impact-panel">
      <h2>{t("portfolioNews.title")}</h2>
      <p className="hint portfolio-impact-sub">
        {news.portfolioCount
          ? t("portfolioNews.sub", { n: String(news.portfolioCount) })
          : t("portfolioNews.noPortfolio")}
      </p>

      {loading ? (
        <p className="hint">{t("portfolioNews.loading")}</p>
      ) : news.portfolioCount === 0 ? (
        <p className="hint">{t("portfolioNews.noPortfolio")}</p>
      ) : !hasAny ? (
        <p className="hint">{t("portfolioNews.emptyAll")}</p>
      ) : (
        <>
          <NewsWindowBlock
            title={t("portfolioNews.window24h")}
            window={news.h24}
            it={it}
            emptyEis={t("portfolioNews.emptyEis")}
            emptyReg={t("portfolioNews.emptyReg")}
            onOpenRow={onOpenRow}
          />
          <NewsWindowBlock
            title={t("portfolioNews.window7d")}
            window={news.d7}
            it={it}
            emptyEis={t("portfolioNews.emptyEis")}
            emptyReg={t("portfolioNews.emptyReg")}
            onOpenRow={onOpenRow}
          />
        </>
      )}
    </section>
  );
}
