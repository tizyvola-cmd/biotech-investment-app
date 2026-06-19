import { BackButton } from "./BackButton";
import { useMobileLang } from "../hooks/useMobileLang";
import { fmtPct, fmtUsd, pred5FromRow, type SimulationPosition } from "../simLogic";

type Props = {
  row: Record<string, unknown>;
  pos: SimulationPosition | undefined;
  detailBuy: string;
  detailCap: string;
  setDetailBuy: (v: string) => void;
  setDetailCap: (v: string) => void;
  busy: boolean;
  err: string | null;
  msg: string | null;
  backLabel?: string;
  onBack: () => void;
  onSave: () => void;
  onClose: () => void;
};

function findNum(r: Record<string, unknown>, kws: string[]): number | null {
  for (const kw of kws) {
    const col = Object.keys(r).find((c) => c.toLowerCase().includes(kw.toLowerCase()));
    if (!col) continue;
    const raw = r[col];
    if (raw == null || raw === "") continue;
    const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", ".").replace(/%/g, ""));
    if (Number.isFinite(n)) return Math.abs(n) <= 1.5 ? n * 100 : n;
  }
  return null;
}

function verdictFrom(pnlPct: number, mv24: number | null): string {
  if (mv24 != null && mv24 <= -2) return "DROP";
  if (mv24 != null && mv24 >= 2) return "RISE";
  if (Math.abs(pnlPct) < 0.5) return "FLAT";
  return "WATCH";
}

export function DetailScreen({
  row,
  pos,
  detailBuy,
  detailCap,
  setDetailBuy,
  setDetailCap,
  busy,
  err,
  msg,
  backLabel,
  onBack,
  onSave,
  onClose,
}: Props) {
  const { t } = useMobileLang();
  const p = pos;
  const hasPosition = (p?.capital ?? 0) > 0;
  const currPrice = p?.currPrice ?? null;
  const pred5 = pred5FromRow(row);
  const prob = findNum(row, ["recovery", "p(rec", "prob rec"]);
  const ppi = findNum(row, ["ppi", "plan prob"]);
  const roiTarget = findNum(row, ["roi target", "target roi"]);
  const mv24 = findNum(row, ["var. giorn", "var giorn"]);
  const verdict = p ? verdictFrom(p.pnlPct, mv24) : "—";
  const slope = findNum(row, ["mii slope", "slope"]);

  const useCurrentPrice = () => {
    if (currPrice != null && currPrice > 0) setDetailBuy(String(currPrice));
  };

  return (
    <main className="app-main detail-screen">
      <BackButton label={backLabel} onClick={onBack} />

      <div className="detail-header-block">
        <h1 className="detail-ticker">{p?.ticker ?? String(row.Ticker)}</h1>
        <p className="detail-company">{hasPosition ? p?.name || String(row.Nome ?? "") : `CD ${p?.completionDate ?? "—"}`}</p>
        {hasPosition ? <span className={`verdict-badge verdict-${verdict.toLowerCase()}`}>{verdict}</span> : null}
      </div>

      {err ? <p className="msg err">{err}</p> : null}
      {msg ? <p className="msg ok">{msg}</p> : null}

      {hasPosition ? (
        <>
          <div className="detail-metrics-row">
            <div>
              <span className="detail-metric-label">P(recovery)</span>
              <strong>{prob != null ? `${Math.round(prob)}%` : "—"}</strong>
            </div>
            <div>
              <span className="detail-metric-label">{t("detail.action")}</span>
              <strong>HOLD</strong>
            </div>
          </div>

          <div className="detail-reading-grid card">
            <div>
              <span>Portfolio entry</span>
              <strong className={p!.pnlPct >= 0 ? "tone-up" : "tone-down"}>{fmtPct(p!.pnlPct)}</strong>
            </div>
            <div>
              <span>Last reading</span>
              <strong>{mv24 != null ? `${fmtPct(mv24)} / ${fmtUsd((p!.capital * mv24) / 100)}` : "—"}</strong>
            </div>
            <div>
              <span>Trading day</span>
              <strong className={p!.pnlPct >= 0 ? "tone-up" : "tone-down"}>
                {fmtPct(p!.pnlPct)} / {fmtUsd(p!.pnlEur)}
              </strong>
            </div>
          </div>

          <section className="card detail-section">
            <h2>Gain idea</h2>
            <p className="detail-gain-idea">
              {t("detail.gainInProgress", {
                amount: `${p!.pnlEur >= 0 ? "+" : ""}${fmtUsd(Math.abs(p!.pnlEur)).replace("$ ", "€ ")}`,
              })}
            </p>
            <p className="hint">
              Target ROI {fmtPct(roiTarget)} · PPI {ppi != null ? Math.round(ppi) : "—"} · {fmtUsd(p!.capital, 0)} invested
            </p>
          </section>

          <section className="card detail-section">
            <h2>Slope &amp; Model</h2>
            <p className="detail-slope-line">
              MII slope: {slope != null ? `${slope.toFixed(1)}°` : "—"} · PPI: {ppi != null ? Math.round(ppi) : "—"} · ROI
              target: {fmtPct(roiTarget)}
            </p>
          </section>
        </>
      ) : null}

      <div className="card detail-form-card">
        <h2>{hasPosition ? t("detail.editSim") : t("detail.addSim")}</h2>
        {!hasPosition ? <p className="hint detail-form-hint">{t("detail.formHint")}</p> : null}
        <div className="field detail-field">
          <label>{t("detail.buyPrice")}</label>
          <input
            className="detail-touch-input"
            inputMode="decimal"
            value={detailBuy}
            onChange={(e) => setDetailBuy(e.target.value)}
            placeholder={currPrice ? String(currPrice) : "0"}
          />
          {!hasPosition && currPrice != null && currPrice > 0 ? (
            <button type="button" className="link-btn detail-quick-fill" onClick={useCurrentPrice}>
              {t("detail.useCurrentPrice", { price: fmtUsd(currPrice) })}
            </button>
          ) : null}
        </div>
        <div className="field detail-field">
          <label>{t("detail.capital")}</label>
          <input
            className="detail-touch-input"
            inputMode="decimal"
            value={detailCap}
            onChange={(e) => setDetailCap(e.target.value)}
            placeholder={t("detail.capitalPlaceholder")}
          />
        </div>
        <div className="btn-row detail-btn-row">
          <button type="button" className="btn btn-primary btn-lg" disabled={busy} onClick={onSave}>
            {busy ? "…" : hasPosition ? t("detail.saveChanges") : t("detail.addSim")}
          </button>
          {hasPosition ? (
            <button type="button" className="btn btn-outline btn-lg" disabled={busy} onClick={onClose}>
              {t("detail.closePosition")}
            </button>
          ) : null}
        </div>
      </div>

      {!hasPosition ? (
        <div className="card">
          <h2>{t("detail.summary")}</h2>
          <div className="metric-grid metric-grid-compact">
            <div>
              <span>{t("detail.marketPrice")}</span>
              <strong>{fmtUsd(currPrice)}</strong>
            </div>
            <div>
              <span>Pred +5</span>
              <strong className={pred5 != null && pred5 >= 0 ? "tone-up" : "tone-down"}>
                {pred5 != null ? fmtPct(pred5) : "N/D"}
              </strong>
            </div>
          </div>
        </div>
      ) : null}

      <section className="card detail-section detail-desktop-note">
        <p className="hint">{t("detail.desktopNote")}</p>
      </section>

      <BackButton variant="bottom" onClick={onBack} />
    </main>
  );
}
