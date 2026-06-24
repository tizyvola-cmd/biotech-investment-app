import {
  fmtStockUsdShort,
  todayModelRealTone,
} from "../sheet/priceVariationHorizons";
import {
  fmtPortfolioPnlPct,
  portfolioPnlAccentClass,
} from "../sheet/portfolioGainLossStyle";
import { useT } from "../shared/i18n";

/** Prezzo implicito curva ricalibrata a oggi — tono neutro (non è P&L). */
export function CurveModelPriceCell({ modelUsd }: { modelUsd: number | null }) {
  return (
    <span className="font-medium tabular-nums text-ink text-xs">
      {fmtStockUsdShort(modelUsd)}
    </span>
  );
}

/** Prezzo di mercato corrente — tono neutro. */
export function CurveRealPriceCell({ realUsd }: { realUsd: number | null }) {
  return (
    <span className="font-semibold tabular-nums text-ink text-xs">
      {fmtStockUsdShort(realUsd)}
    </span>
  );
}

/** Scostamento reale vs modello oggi — non confondere con P&L vs acquisto. */
export function CurveGapVsModelCell({
  gapPct,
  gapUsd,
  hideLabel = false,
  valueClassName = "text-xs font-semibold",
}: {
  gapPct: number | null;
  gapUsd: number | null;
  /** Column header already shows the title — value only in table cells. */
  hideLabel?: boolean;
  valueClassName?: string;
}) {
  const t = useT();
  const toneCls =
    gapPct != null ? todayModelRealTone(gapPct) : "text-ink-muted/60";
  const tip =
    gapPct != null && gapUsd != null
      ? t("sim.workspace.table.gapVsCurveTipDetail", {
          pct: `${gapPct >= 0 ? "+" : ""}${gapPct.toFixed(2)}`,
          usd: gapUsd >= 0 ? `+$${Math.abs(gapUsd).toFixed(2)}` : `−$${Math.abs(gapUsd).toFixed(2)}`,
        })
      : t("sim.workspace.table.gapVsCurveTip");

  return (
    <div className="leading-snug text-center" title={tip}>
      {!hideLabel ? (
        <div className="text-[8px] font-semibold uppercase tracking-wide text-ink-muted/80">
          {t("sim.workspace.table.gapVsCurve")}
        </div>
      ) : null}
      <div className={`tabular-nums ${valueClassName} ${toneCls}`}>
        {gapPct != null ? (
          <>
            {gapPct >= 0 ? "+" : ""}
            {gapPct.toFixed(2)}%
          </>
        ) : (
          "—"
        )}
      </div>
    </div>
  );
}

/** P&L mark-to-market dall'ingresso — separato da Δ vs curva. */
export function PortfolioBuyPnlBadge({
  pnlPct,
  pnlEur,
}: {
  pnlPct: number | null;
  pnlEur: number | null;
}) {
  const t = useT();
  if (pnlPct == null && pnlEur == null) return null;
  const accent = portfolioPnlAccentClass(pnlEur ?? pnlPct ?? 0);

  return (
    <div
      className={`mt-0.5 text-[9px] font-semibold tabular-nums leading-tight ${accent}`}
      title={t("sim.workspace.table.pnlVsBuyTip")}
    >
      <span className="text-ink-muted/75 font-medium normal-case">
        {t("sim.workspace.table.pnlVsBuy")}{" "}
      </span>
      {pnlPct != null ? fmtPortfolioPnlPct(pnlPct) : "—"}
    </div>
  );
}

/** Var. giorno (vs chiusura precedente) — distinta da P&L totale e da ROI target. */
export function PortfolioDailyPnlBadge({
  pnlPct,
  pnlEur,
}: {
  pnlPct: number | null;
  pnlEur?: number | null;
}) {
  const t = useT();
  if (pnlPct == null) return null;
  const accent = portfolioPnlAccentClass(pnlEur ?? pnlPct);

  return (
    <div
      className={`text-[9px] font-semibold tabular-nums leading-tight ${accent}`}
      title={t("sim.workspace.table.pnlDayTip")}
    >
      <span className="text-ink-muted/75 font-medium normal-case">
        {t("sim.workspace.table.pnlDay")}{" "}
      </span>
      {fmtPortfolioPnlPct(pnlPct)}
    </div>
  );
}
