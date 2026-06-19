import { useMemo, useState } from "react";
import { AppModal } from "./AppModal";
import { CapitalNumberInput } from "./CapitalNumberInput";
import { useLang, useT } from "../shared/i18n";
import {
  GAP_INVESTIGATION_ADD_SIZE_DEFAULT_PCT,
  type GapContextFinding,
  type GapEvent,
  type GapInvestigationUserDecision,
  type GapNewsType,
} from "../sheet/gapInvestigationTypes";

export type GapInvestigationModalProps = {
  recordId: string;
  event: GapEvent;
  finding: GapContextFinding;
  onClose: () => void;
  onCommit: (recordId: string, decision: GapInvestigationUserDecision) => void;
};

type ActionChoice = "reduce" | "add" | "dismiss" | null;

function fmtTs(iso: string, locale: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString(locale, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function newsTypeLabel(
  newsType: GapNewsType | null,
  t: ReturnType<typeof useT>,
): string {
  if (!newsType) return "—";
  switch (newsType) {
    case "clinical_data":
      return t("gapInvestigation.newsType.clinical_data");
    case "regulatory_8k":
      return t("gapInvestigation.newsType.regulatory_8k");
    case "analyst_action":
      return t("gapInvestigation.newsType.analyst_action");
    case "sector_wide":
      return t("gapInvestigation.newsType.sector_wide");
    default:
      return t("gapInvestigation.newsType.unknown");
  }
}

export function GapInvestigationModal({
  recordId,
  event,
  finding,
  onClose,
  onCommit,
}: GapInvestigationModalProps) {
  const { lang } = useLang();
  const t = useT();
  const locale = lang === "it" ? "it-IT" : "en-US";
  const [choice, setChoice] = useState<ActionChoice>(null);
  const [reduceEur, setReduceEur] = useState(Math.round(event.positionCapitalEur * 0.25));
  const [addEur, setAddEur] = useState(
    Math.max(
      100,
      Math.round((event.positionCapitalEur * GAP_INVESTIGATION_ADD_SIZE_DEFAULT_PCT) / 100),
    ),
  );

  const gapSign = event.gapPct >= 0 ? "+" : "";
  const title = t("gapInvestigation.title", { ticker: event.ticker });

  const contextLine = useMemo(() => {
    if (finding.hasSpecificNews && finding.summary) {
      return finding.summary;
    }
    return t("gapInvestigation.noNewsBody");
  }, [finding, t]);

  const canConfirm =
    choice === "dismiss" ||
    (choice === "reduce" && reduceEur > 0) ||
    (choice === "add" && addEur > 0);

  const handleConfirm = () => {
    if (!choice) return;
    if (choice === "dismiss") {
      onCommit(recordId, { kind: "dismiss" });
      return;
    }
    if (choice === "reduce") {
      onCommit(recordId, { kind: "reduce", amountEur: reduceEur });
      return;
    }
    onCommit(recordId, { kind: "add", amountEur: addEur });
  };

  return (
    <AppModal
      open
      onClose={onClose}
      aria-labelledby="gap-investigation-title"
      panelClassName="max-w-lg w-full"
    >
      <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-surface shadow-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[rgb(var(--border))]/40 bg-amber-50/80 dark:bg-amber-950/30">
          <h2 id="gap-investigation-title" className="text-sm font-semibold text-ink">
            {title}
          </h2>
          <p className="text-[10px] text-ink-muted mt-0.5">
            {t("gapInvestigation.subtitle", { when: fmtTs(event.tickTimestamp, locale) })}
          </p>
        </div>

        <div className="px-4 py-3 space-y-3 text-[11px] leading-relaxed text-ink">
          <div className="flex flex-wrap gap-x-4 gap-y-1 tabular-nums text-[10px]">
            <span>
              {t("gapInvestigation.gap")}:{" "}
              <strong className={event.gapPct >= 0 ? "text-emerald-700" : "text-rose-700"}>
                {gapSign}
                {event.gapPct.toFixed(1)}%
              </strong>
            </span>
            <span>
              {t("gapInvestigation.size")}:{" "}
              <strong>{Math.round(event.positionCapitalEur).toLocaleString(locale)} €</strong>
            </span>
            {event.daysSinceCD != null ? (
              <span>
                {t("gapInvestigation.daysToCd")}: <strong>{event.daysSinceCD}d</strong>
              </span>
            ) : null}
          </div>

          <div className="rounded-md border border-[rgb(var(--border))]/40 bg-[rgb(var(--surface-muted))]/40 px-3 py-2 space-y-1">
            {finding.hasSpecificNews ? (
              <>
                <p className="text-[10px] font-semibold text-ink">
                  {newsTypeLabel(finding.newsType, t)}
                  {finding.confidence === "high" ? ` · ${t("gapInvestigation.confidenceHigh")}` : ""}
                </p>
                <p className="text-[11px] text-ink">{contextLine}</p>
                {finding.sourceUrl ? (
                  <a
                    href={finding.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-indigo-700 dark:text-indigo-300 underline"
                  >
                    {t("gapInvestigation.sourceLink")}
                  </a>
                ) : null}
              </>
            ) : (
              <p className="text-[11px] text-ink-muted">{contextLine}</p>
            )}
          </div>

          <p className="text-[10px] text-ink-muted">{t("gapInvestigation.chooseHint")}</p>

          <div className="space-y-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name={`gap-action-${recordId}`}
                checked={choice === "reduce"}
                onChange={() => setChoice("reduce")}
                className="mt-0.5"
              />
              <span className="flex-1">
                <span className="font-semibold">{t("gapInvestigation.optionReduce")}</span>
                {choice === "reduce" ? (
                  <span className="ml-2 inline-flex items-center gap-1">
                    <CapitalNumberInput value={reduceEur} onCommit={setReduceEur} step={100} />
                    <span className="text-[10px] text-ink-muted">€</span>
                  </span>
                ) : null}
              </span>
            </label>

            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name={`gap-action-${recordId}`}
                checked={choice === "add"}
                onChange={() => setChoice("add")}
                className="mt-0.5"
              />
              <span className="flex-1">
                <span className="font-semibold">{t("gapInvestigation.optionAdd")}</span>
                {choice === "add" ? (
                  <span className="ml-2 inline-flex items-center gap-1">
                    <CapitalNumberInput value={addEur} onCommit={setAddEur} step={100} />
                    <span className="text-[10px] text-ink-muted">€</span>
                  </span>
                ) : null}
              </span>
            </label>

            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name={`gap-action-${recordId}`}
                checked={choice === "dismiss"}
                onChange={() => setChoice("dismiss")}
                className="mt-0.5"
              />
              <span className="font-semibold">{t("gapInvestigation.optionDismiss")}</span>
            </label>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-[rgb(var(--border))]/40 flex justify-end gap-2">
          <button type="button" className="btn-ghost text-xs" onClick={onClose}>
            {t("gapInvestigation.closePending")}
          </button>
          <button
            type="button"
            className="btn-primary text-xs disabled:opacity-40"
            disabled={!canConfirm}
            onClick={handleConfirm}
          >
            {t("gapInvestigation.confirm")}
          </button>
        </div>
      </div>
    </AppModal>
  );
}
