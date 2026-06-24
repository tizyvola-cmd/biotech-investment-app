import {
  buildMiiAngleReferenceRows,
  fmtDeltaPct,
  fmtVol,
} from "../sheet/miiAngleReference";
import { DEFAULT_MIG_CONFIG } from "../sheet/marketInterestGate";
import { useLang, useT } from "../shared/i18n";
import { AppModal, AppModalCloseButton } from "./AppModal";

export function MiiAngleGuideModal({
  open,
  onClose,
  currentMinAngle,
}: {
  open: boolean;
  onClose: () => void;
  currentMinAngle: number;
}) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";
  const rows = buildMiiAngleReferenceRows();

  if (!open) return null;

  const behaviorFor = (deg: number): string => {
    switch (deg) {
      case 15:
        return t("signals.mig.angleGuide.behavior.15");
      case 20:
        return t("signals.mig.angleGuide.behavior.20");
      case 23:
        return t("signals.mig.angleGuide.behavior.23");
      case 28:
        return t("signals.mig.angleGuide.behavior.28");
      case 35:
        return t("signals.mig.angleGuide.behavior.35");
      default:
        return "";
    }
  };

  return (
    <AppModal
      open={open}
      onClose={onClose}
      aria-labelledby="mii-angle-guide-title"
      panelClassName="w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-slate-900"
    >
      <div className="shrink-0 border-b border-[rgb(var(--border))]/40 px-4 py-3 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <h2 id="mii-angle-guide-title" className="text-base font-bold text-ink">
            {t("signals.mig.angleGuide.title")}
          </h2>
          <p className="text-[11px] text-ink-muted mt-1 leading-snug">
            {t("signals.mig.angleGuide.subtitle", {
              norm: String(DEFAULT_MIG_CONFIG.normalizationFactor),
            })}
          </p>
        </div>
        <AppModalCloseButton onClose={onClose} />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
        <div className="overflow-x-auto rounded-lg border border-[rgb(var(--border))]/40">
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr className="bg-[rgb(var(--surface-3))]/40 text-[10px] uppercase tracking-wide text-ink-muted">
                <th className="text-left px-3 py-2 font-semibold">{t("signals.mig.angleGuide.col.threshold")}</th>
                <th className="text-left px-3 py-2 font-semibold">{t("signals.mig.angleGuide.col.behavior")}</th>
                <th className="text-left px-3 py-2 font-semibold">{t("signals.mig.angleGuide.col.priceVol")}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-[rgb(var(--border))]/30 text-ink-muted">
                <td className="px-3 py-2.5 font-semibold tabular-nums">&lt; 15°</td>
                <td className="px-3 py-2.5 leading-snug">{t("signals.mig.angleGuide.behavior.below15")}</td>
                <td className="px-3 py-2.5 tabular-nums">—</td>
              </tr>
              {rows.map((row) => {
                const isCurrent = Math.abs(row.angleDeg - currentMinAngle) < 0.5;
                const isDefault20 = row.angleDeg === 20;
                return (
                  <tr
                    key={row.angleDeg}
                    className={`border-t border-[rgb(var(--border))]/30 ${
                      isCurrent
                        ? "bg-[rgb(var(--accent))]/8"
                        : isDefault20
                          ? "bg-[rgb(var(--signal-up))]/5"
                          : ""
                    }`}
                  >
                    <td className="px-3 py-2.5 font-bold tabular-nums whitespace-nowrap">
                      {row.angleDeg}°
                      {isCurrent ? (
                        <span className="ml-1.5 text-[9px] font-bold uppercase text-[rgb(var(--accent))]">
                          {t("signals.mig.angleGuide.currentBadge")}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 leading-snug">
                      <span className={isDefault20 || row.angleDeg === 23 ? "font-semibold text-ink" : ""}>
                        {behaviorFor(row.angleDeg)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 leading-snug tabular-nums">
                      <div>{fmtDeltaPct(row.deltaAtVol1)} @ {fmtVol(1.0)}</div>
                      <div className="text-ink-muted">
                        {fmtDeltaPct(row.deltaAtVol15)} @ {fmtVol(1.5)}
                        {" · "}
                        {fmtDeltaPct(row.deltaAtVol2)} @ {fmtVol(2.0)}
                      </div>
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t border-[rgb(var(--border))]/30 text-ink-muted">
                <td className="px-3 py-2.5 font-semibold tabular-nums">&gt; 35°</td>
                <td className="px-3 py-2.5 leading-snug">{t("signals.mig.angleGuide.behavior.above35")}</td>
                <td className="px-3 py-2.5 tabular-nums">—</td>
              </tr>
            </tbody>
          </table>
        </div>

        <section className="rounded-lg border border-[rgb(var(--border))]/35 bg-[rgb(var(--surface-3))]/20 px-3 py-2.5 text-[11px] leading-relaxed text-ink">
          <p className="font-bold text-ink mb-1">{t("signals.mig.angleGuide.why23Title")}</p>
          <ul className="list-disc pl-4 space-y-1 text-ink-muted">
            <li>{t("signals.mig.angleGuide.why23a")}</li>
            <li>{t("signals.mig.angleGuide.why23b")}</li>
            <li>{t("signals.mig.angleGuide.why23c")}</li>
          </ul>
        </section>

        <p className="text-[10px] text-ink-muted leading-snug">
          {it
            ? `Gate attuale: PASS se |MII°| ≥ ${currentMinAngle}° · WATCH ≥ ${currentMinAngle - DEFAULT_MIG_CONFIG.watchBandDeg}° · ΔP da Var.1M→5d o Var.giorn×5 · Vol× da SDS.`
            : `Current gate: PASS if |MII°| ≥ ${currentMinAngle}° · WATCH ≥ ${currentMinAngle - DEFAULT_MIG_CONFIG.watchBandDeg}° · ΔP from Var.1M→5d or daily×5 · Vol× from SDS.`}
        </p>
      </div>

      <div className="shrink-0 border-t border-[rgb(var(--border))]/40 px-4 py-3 flex justify-end">
        <button type="button" className="btn-primary text-xs" onClick={onClose}>
          {t("common.close")}
        </button>
      </div>
    </AppModal>
  );
}
