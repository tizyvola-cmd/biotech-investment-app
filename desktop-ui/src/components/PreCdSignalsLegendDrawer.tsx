import { useEffect, type ReactNode } from "react";
import { useLang, useT } from "../shared/i18n";

function LegendSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs font-semibold text-ink uppercase tracking-wide">{title}</h3>
      <div className="text-[11px] text-ink-muted leading-relaxed space-y-1">{children}</div>
    </section>
  );
}

function LegendRow({ label, desc }: { label: string; desc: string }) {
  return (
    <p>
      <span className="font-semibold text-ink">{label}</span>
      {" — "}
      {desc}
    </p>
  );
}

export function PreCdSignalsLegendDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { lang } = useLang();
  const t = useT();
  const it = lang === "it";

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={t("preCd.legend.title")}
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />

      <div className="relative z-10 flex h-full w-full max-w-lg flex-col overflow-hidden border-l border-[rgb(var(--border))]/60 bg-[rgb(var(--surface))] shadow-2xl">
        <div className="flex shrink-0 items-center gap-3 border-b border-[rgb(var(--border))]/40 bg-[rgb(var(--accent))]/8 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">{t("preCd.legend.title")}</p>
            <p className="text-[11px] text-ink-muted leading-snug">{t("preCd.legend.subtitle")}</p>
          </div>
          <button
            type="button"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-[rgb(var(--surface-3))] hover:text-ink"
            onClick={onClose}
            aria-label={t("preCd.legend.close")}
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-5">
          <LegendSection title={t("preCd.legend.overviewTitle")}>
            <p>{t("preCd.legend.overviewBody")}</p>
          </LegendSection>

          <LegendSection title={t("preCd.legend.kpiTitle")}>
            <LegendRow label="Raw (direzionale)" desc={t("preCd.legend.kpiRaw")} />
            <LegendRow label="Useful" desc={t("preCd.legend.kpiUseful")} />
            <LegendRow label="Strong" desc={t("preCd.legend.kpiStrong")} />
            <p className="text-[10px] opacity-80">{t("preCd.legend.kpiHitNote")}</p>
          </LegendSection>

          <LegendSection title={t("preCd.legend.chartsTitle")}>
            <LegendRow
              label={it ? "Learning curve" : "Learning curve"}
              desc={t("preCd.legend.chartLearning")}
            />
            <LegendRow
              label={it ? "Pred5 calibration" : "Pred5 calibration"}
              desc={t("preCd.legend.chartScatter")}
            />
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[10px] text-amber-900 dark:text-amber-100">
              {t("preCd.legend.chartsEmptyWhy")}
            </div>
          </LegendSection>

          <LegendSection title={t("preCd.legend.tableTitle")}>
            <LegendRow label="Ticker" desc={t("preCd.legend.colTicker")} />
            <LegendRow label={it ? "Giorni CD" : "Days to CD"} desc={t("preCd.legend.colDays")} />
            <LegendRow label="Dir" desc={t("preCd.legend.colDir")} />
            <LegendRow label="Pred5" desc={t("preCd.legend.colPred5")} />
            <LegendRow label="Affid" desc={t("preCd.legend.colAffid")} />
            <LegendRow label={it ? "Actual +5g" : "Actual +5d"} desc={t("preCd.legend.colActual")} />
            <LegendRow label="Hit" desc={t("preCd.legend.colHit")} />
          </LegendSection>

          <LegendSection title={t("preCd.legend.colorsTitle")}>
            <p>{t("preCd.legend.colorsBody")}</p>
            <ul className="list-disc pl-4 space-y-0.5 mt-1">
              <li>
                <span className="text-[rgb(var(--signal-up))] font-bold">▲ Long</span> /{" "}
                <span className="text-[rgb(var(--signal-down))] font-bold">▼ Short</span>
              </li>
              <li>{t("preCd.legend.colorCd")}</li>
              <li>{t("preCd.legend.colorAffid")}</li>
              <li>{t("preCd.legend.colorHit")}</li>
            </ul>
          </LegendSection>

          <LegendSection title={t("preCd.legend.workflowTitle")}>
            <ol className="list-decimal pl-4 space-y-1">
              <li>{t("preCd.legend.stepLive")}</li>
              <li>{t("preCd.legend.stepWait")}</li>
              <li>{t("preCd.legend.stepRebuild")}</li>
              <li>{t("preCd.legend.stepReload")}</li>
            </ol>
          </LegendSection>
        </div>
      </div>
    </div>
  );
}
