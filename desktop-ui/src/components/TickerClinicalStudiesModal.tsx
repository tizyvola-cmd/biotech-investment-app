import type { DeskClinicalStudyListItem } from "../sheet/deskClinicalStudies";
import { localizeStudyPhase } from "../sheet/clinicalIndicators";
import { AppModal, AppModalCloseButton } from "./AppModal";

export type TickerClinicalStudiesModalProps = {
  open: boolean;
  it: boolean;
  ticker: string;
  company?: string | null;
  studies: DeskClinicalStudyListItem[];
  primaryNctId?: string | null;
  onClose: () => void;
};

export function TickerClinicalStudiesModal({
  open,
  it,
  ticker,
  company,
  studies,
  primaryNctId,
  onClose,
}: TickerClinicalStudiesModalProps) {
  const primaryKey = primaryNctId?.trim().toUpperCase() || "";

  return (
    <AppModal
      open={open}
      onClose={onClose}
      aria-label={
        it ? `Studi clinici · ${ticker}` : `Clinical studies · ${ticker}`
      }
      panelClassName="w-full max-w-xl overflow-hidden rounded-2xl border border-[rgb(var(--border))]/50 bg-[rgb(var(--surface))] shadow-2xl flex flex-col"
    >
      <div className="flex shrink-0 items-start gap-3 border-b border-[rgb(var(--border))]/40 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
            {it ? "Studi clinici (CT.gov)" : "Clinical studies (CT.gov)"}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-extrabold text-ink tabular-nums">
              {ticker}
            </span>
            {company ? (
              <span className="text-[11px] font-medium text-ink-muted truncate">
                {company}
              </span>
            ) : null}
          </div>
        </div>
        <AppModalCloseButton onClose={onClose} />
      </div>

      <ul className="px-4 py-3 space-y-2 overflow-y-auto max-h-[70vh]">
        {studies.map((s) => {
          const isPrimary = Boolean(primaryKey && s.nctId === primaryKey);
          const phase = s.phaseRaw
            ? localizeStudyPhase(s.phaseRaw, it)
            : it
              ? "Fase n/d"
              : "Phase n/a";
          return (
            <li
              key={s.nctId || `${s.cdDate}|${s.title}`}
              className={`rounded-lg border px-3 py-2 ${
                isPrimary
                  ? "border-[rgb(var(--accent))]/45 bg-[rgb(var(--accent))]/[0.06]"
                  : "border-[rgb(var(--border))]/40"
              }`}
            >
              <p className="text-[11px] font-semibold text-ink leading-snug">
                {s.title}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-ink-muted">
                <span>{phase}</span>
                {s.nctId ? (
                  s.href ? (
                    <a
                      href={s.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-[rgb(var(--accent))] hover:underline tabular-nums"
                    >
                      {s.nctId}
                    </a>
                  ) : (
                    <span className="tabular-nums">{s.nctId}</span>
                  )
                ) : null}
                {isPrimary ? (
                  <span className="text-[9px] font-bold uppercase text-[rgb(var(--accent))]">
                    {it ? "Catalyst" : "Catalyst"}
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </AppModal>
  );
}
