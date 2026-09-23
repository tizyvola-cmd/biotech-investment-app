import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { fetchRegulatoryRiskSnapshot, type RegulatoryRiskSignal, type RegulatoryRiskSnapshot } from "../api";
import { useMobileLang } from "../hooks/useMobileLang";
import {
  formatRegulatoryScoreDisplay,
  regulatoryScoreColor,
  regulatoryScoreSummaryLabel,
} from "../mobileRegulatoryDisplay";
import {
  buildRegulatoryScoreExplain,
  formatScoreDelta,
} from "../regulatoryScoreExplain";

type Props = {
  open: boolean;
  ticker: string | null;
  signedScore: number | null;
  clinicalPhase?: string | null;
  initialSnap?: RegulatoryRiskSnapshot | null;
  onClose: () => void;
};

type SignalSection = {
  id: string;
  label: string;
  bucket: NonNullable<RegulatoryRiskSignal["crl"]>;
};

function fmtFilingDate(iso: string | undefined, locale: string): string {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
}

function SignalBlock({ section, locale }: { section: SignalSection; locale: string }) {
  const { bucket, label } = section;
  if (!bucket.detected && !bucket.hits.length && !bucket.sources.length) return null;

  return (
    <article className="reg-sheet-signal">
      <h4 className="reg-sheet-signal-title">{label}</h4>
      {bucket.hits.length ? (
        <ul className="reg-sheet-hits">
          {bucket.hits.map((hit, i) => (
            <li key={`${hit}-${i}`}>{hit}</li>
          ))}
        </ul>
      ) : null}
      {bucket.sources.length ? (
        <ul className="reg-sheet-sources">
          {bucket.sources.map((src, i) => (
            <li key={`${src.headline}-${src.filing_date ?? ""}-${i}`}>
              <p className="reg-sheet-source-headline">{src.headline || "—"}</p>
              <p className="reg-sheet-source-meta">
                {[fmtFilingDate(src.filing_date, locale), src.source, src.type].filter(Boolean).join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

export function MobileRegulatorySheet({
  open,
  ticker,
  signedScore,
  clinicalPhase,
  initialSnap,
  onClose,
}: Props) {
  const { lang, t, locale } = useMobileLang();
  const it = lang === "it";
  const [snap, setSnap] = useState<RegulatoryRiskSnapshot | null>(initialSnap ?? null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !ticker) return;
    if (initialSnap?.tickers?.[ticker.trim().toUpperCase()]) {
      setSnap(initialSnap);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErr(null);
    void fetchRegulatoryRiskSnapshot()
      .then((data) => {
        if (!cancelled) setSnap(data);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, ticker, initialSnap]);

  const signal = useMemo(() => {
    if (!ticker || !snap?.tickers) return null;
    return snap.tickers[ticker.trim().toUpperCase()] ?? null;
  }, [ticker, snap]);

  const displayScore = signal?.score ?? signedScore;
  const scoreExplain = useMemo(
    () => buildRegulatoryScoreExplain(signal, clinicalPhase, lang),
    [signal, clinicalPhase, lang],
  );
  const sections = useMemo((): SignalSection[] => {
    if (!signal) return [];
    return [
      { id: "positive", label: it ? "Catalizzatori positivi" : "Positive catalysts", bucket: signal.positive ?? emptyBucket() },
      { id: "approved", label: it ? "Approvazioni FDA" : "FDA approvals", bucket: signal.approved ?? emptyBucket() },
      { id: "pdufa", label: "PDUFA / NDA / BLA", bucket: signal.pdufa ?? emptyBucket() },
      { id: "cmc", label: "CMC / manufacturing", bucket: signal.cmc ?? emptyBucket() },
      { id: "crl", label: "CRL / regulatory risk", bucket: signal.crl ?? emptyBucket() },
    ].filter((s) => s.bucket.detected || s.bucket.hits.length > 0 || s.bucket.sources.length > 0);
  }, [signal, it]);

  if (!open || !ticker || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="sheet-root reg-sheet-root"
      role="dialog"
      aria-modal="true"
      aria-label={t("regulatory.detailTitle", { ticker: ticker.toUpperCase() })}
    >
      <button type="button" className="sheet-backdrop" aria-label={t("common.close")} onClick={onClose} />
      <div className="sheet-panel reg-sheet-panel">
        <div className="sheet-handle" aria-hidden />
        <div className="sheet-header">
          <div>
            <h2>{t("regulatory.detailTitle", { ticker: ticker.toUpperCase() })}</h2>
            <p className="reg-sheet-subtitle">{t("regulatory.detailSubtitle")}</p>
          </div>
          <button type="button" className="sheet-close" onClick={onClose} aria-label={t("common.close")}>
            ✕
          </button>
        </div>
        <div className="sheet-body reg-sheet-body">
          {loading ? (
            <p className="hint">{t("common.loading")}</p>
          ) : err ? (
            <p className="msg err">{err}</p>
          ) : (
            <>
              <div className="reg-sheet-hero">
                {displayScore != null && Number.isFinite(displayScore) ? (
                  <>
                    <span
                      className="reg-sheet-score"
                      style={{ color: regulatoryScoreColor(displayScore) }}
                    >
                      {formatRegulatoryScoreDisplay(displayScore)}
                    </span>
                    <p className="reg-sheet-summary">{regulatoryScoreSummaryLabel(displayScore, lang)}</p>
                  </>
                ) : (
                  <p className="hint">—</p>
                )}
                {signal?.no_signals ? (
                  <p className="hint reg-sheet-no-signals">{t("regulatory.noSignals")}</p>
                ) : null}
                {snap?.updated_at ? (
                  <p className="hint reg-sheet-updated">
                    {t("regulatory.snapshotUpdated", {
                      date: fmtFilingDate(snap.updated_at.slice(0, 10), locale),
                    })}
                  </p>
                ) : null}
              </div>

              {scoreExplain && scoreExplain.components.length ? (
                <section className="reg-sheet-breakdown" aria-label={t("regulatory.scoreExplainTitle")}>
                  <h3>{t("regulatory.scoreExplainTitle")}</h3>
                  <p className="hint reg-sheet-scale">{t("regulatory.scoreExplainScale")}</p>
                  <ul className="reg-sheet-breakdown-list">
                    {scoreExplain.components.map((comp) => (
                      <li key={comp.id} className="reg-sheet-breakdown-row">
                        <div className="reg-sheet-breakdown-main">
                          <span className="reg-sheet-breakdown-label">{comp.label}</span>
                          <span
                            className="reg-sheet-breakdown-delta"
                            style={{ color: regulatoryScoreColor(comp.delta) }}
                          >
                            {formatScoreDelta(comp.delta)}
                          </span>
                        </div>
                        <p className="hint reg-sheet-breakdown-detail">{comp.detail}</p>
                        <p className="hint reg-sheet-breakdown-source">
                          {t("regulatory.scoreSource")}: {comp.source}
                        </p>
                      </li>
                    ))}
                    <li className="reg-sheet-breakdown-total">
                      <span>{it ? "Totale score" : "Total score"}</span>
                      <span
                        className="reg-sheet-breakdown-delta"
                        style={{ color: regulatoryScoreColor(scoreExplain.total) }}
                      >
                        {formatRegulatoryScoreDisplay(scoreExplain.total)}
                      </span>
                    </li>
                  </ul>
                  <p className="hint reg-sheet-impact">
                    {t("regulatory.scoreExplainImpact", { impact: scoreExplain.impactDisplay })}
                  </p>
                  <p className="hint reg-sheet-primary-source">
                    {t("regulatory.scorePrimarySource", { source: scoreExplain.primarySource })}
                  </p>
                </section>
              ) : null}

              {sections.length ? (
                <section className="reg-sheet-signals">
                  <h3>{t("regulatory.signalsTitle")}</h3>
                  {sections.map((section) => (
                    <SignalBlock key={section.id} section={section} locale={locale} />
                  ))}
                </section>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function emptyBucket(): NonNullable<RegulatoryRiskSignal["crl"]> {
  return { detected: false, hits: [], sources: [] };
}
