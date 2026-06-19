import type { CoherenceCriticalIssue, CoherenceMetricId } from "../sheet/crossTabCoherenceHealth";
import { useT } from "../shared/i18n";

function primaryNavForIssue(
  id: CoherenceMetricId,
): "dashboard" | "simulation" | null {
  if (id === "buyPriceInputs") return "simulation";
  if (
    id === "storeFreshness" ||
    id === "storeAlignment" ||
    id === "publishSource" ||
    id === "relaxedDrift"
  ) {
    return "dashboard";
  }
  return "dashboard";
}

export function CoherenceAlertModal({
  open,
  issues,
  onClose,
  onOpenSystem,
  onOpenDashboard,
  onOpenSimulation,
}: {
  open: boolean;
  issues: CoherenceCriticalIssue[];
  onClose: () => void;
  onOpenSystem?: () => void;
  onOpenDashboard?: () => void;
  onOpenSimulation?: () => void;
}) {
  const t = useT();
  if (!open || issues.length === 0) return null;

  const lead = issues[0]!;
  const primaryNav = primaryNavForIssue(lead.id);
  const primaryHandler =
    primaryNav === "simulation" ? onOpenSimulation : onOpenDashboard;

  return (
    <div
      className="fixed inset-0 z-[65] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="coherence-alert-modal w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden shadow-2xl rounded-xl"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-labelledby="coherence-alert-title"
        aria-modal="true"
      >
        <div className="coherence-alert-modal-header flex items-start gap-3 px-4 py-4 shrink-0">
          <span className="text-2xl leading-none" aria-hidden>
            ⚠
          </span>
          <div className="flex-1 min-w-0">
            <h2 id="coherence-alert-title" className="text-base font-bold">
              {t("coherenceAlert.modal.title")}
            </h2>
            <p className="text-xs mt-1 leading-snug opacity-95">
              {t("coherenceAlert.modal.subtitle")}
            </p>
            <p className="text-[11px] mt-2 font-semibold">
              {t("coherenceAlert.modal.count", { n: issues.length })}
            </p>
          </div>
          <button
            type="button"
            className="coherence-alert-modal-close shrink-0 px-2 py-1 text-sm rounded-md"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0 bg-white space-y-3">
          <ul className="space-y-2">
            {issues.map((issue) => (
              <li
                key={issue.id}
                className="rounded-lg border-2 border-[rgb(var(--signal-down))]/45 bg-[rgb(var(--signal-down))]/6 px-3 py-2.5"
              >
                <p className="text-sm font-semibold text-[rgb(var(--signal-down))]">
                  {t(issue.titleKey, issue.detailVars)}
                </p>
                <p className="text-xs text-ink mt-1.5 leading-snug">
                  {t(issue.detailKey, issue.detailVars)}
                </p>
                {issue.actionKey ? (
                  <p className="text-xs font-medium text-[rgb(var(--panel-feed-accent-strong))] mt-2 leading-snug rounded-md bg-[rgb(var(--accent))]/8 px-2 py-1.5 border border-[rgb(var(--accent))]/20">
                    {t(issue.actionKey, issue.detailVars)}
                  </p>
                ) : null}
                {issue.tickers && issue.tickers.length > 0 ? (
                  <p className="text-[11px] font-mono mt-2 text-ink-muted break-all">
                    {issue.tickers.join(", ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>

        <div className="coherence-alert-modal-footer px-4 py-3 shrink-0 flex flex-col gap-2 bg-white border-t border-[rgb(var(--panel-feed-border))]/60">
          <div className="flex flex-wrap justify-end gap-2">
            {primaryHandler ? (
              <button
                type="button"
                className="coherence-alert-modal-btn text-sm px-4 py-2 rounded-lg font-semibold"
                onClick={() => {
                  primaryHandler();
                  onClose();
                }}
              >
                {primaryNav === "simulation"
                  ? t("coherenceAlert.modal.goSimulation")
                  : t("coherenceAlert.modal.goDashboard")}
              </button>
            ) : null}
            {onOpenSystem ? (
              <button
                type="button"
                className="btn-ghost text-sm px-3 text-[rgb(var(--panel-feed-accent-strong))]"
                onClick={() => {
                  onOpenSystem();
                  onClose();
                }}
              >
                {t("coherenceAlert.modal.openSystem")}
              </button>
            ) : null}
            <button
              type="button"
              className="btn-ghost text-sm px-3 text-ink-muted"
              onClick={onClose}
            >
              {t("coherenceAlert.modal.gotIt")}
            </button>
          </div>
          <p className="text-[10px] text-ink-muted leading-snug text-right">
            {t("coherenceAlert.modal.dismissHint")}
          </p>
        </div>
      </div>
    </div>
  );
}
