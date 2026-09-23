import type { CompanyProfileOverview, CompanyProfileProgram } from "../sheet/companyProfileOverview";
import { AppModal, AppModalCloseButton } from "./AppModal";

function ProgramList({
  items,
  empty,
  it,
}: {
  items: CompanyProfileProgram[];
  empty: string;
  it: boolean;
}) {
  if (!items.length) {
    return <p className="text-[11px] text-ink-muted leading-snug">{empty}</p>;
  }
  return (
    <ul className="space-y-1.5">
      {items.map((p, i) => (
        <li
          key={`${p.name}-${p.nctId ?? i}`}
          className="rounded-md border border-[rgb(var(--border))]/40 bg-[rgb(var(--surface))] px-2.5 py-1.5"
        >
          <p className="text-[12px] font-semibold text-ink leading-snug">{p.name}</p>
          <p className="text-[10px] text-ink-muted leading-snug mt-0.5">
            {[p.indication, p.phase, p.nctId].filter(Boolean).join(" · ")}
          </p>
          <p className="text-[9px] text-ink-muted/80 mt-0.5">
            {p.source === "sheet"
              ? it
                ? "Foglio Simulation"
                : "Simulation sheet"
              : p.source === "guidance"
                ? "Guidance"
                : it
                  ? "Feed clinico"
                  : "Clinical feed"}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function CompanyProfileModal({
  open,
  onClose,
  profile,
  it = false,
}: {
  open: boolean;
  onClose: () => void;
  profile: CompanyProfileOverview | null;
  it?: boolean;
}) {
  if (!profile) return null;
  return (
    <AppModal
      open={open}
      onClose={onClose}
      aria-labelledby="company-profile-title"
      panelClassName="w-full max-w-lg overflow-hidden rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface-elevated))] shadow-2xl"
    >
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-[rgb(var(--border))]/50">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted">
            {profile.ticker}
          </p>
          <h2 id="company-profile-title" className="text-base font-bold text-ink leading-snug">
            {profile.company}
          </h2>
        </div>
        <AppModalCloseButton onClose={onClose} />
      </div>
      <div className="px-4 py-3 space-y-3 overflow-y-auto max-h-[70vh]">
        <section>
          <h3 className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted mb-1">
            {it ? "Mission" : "Mission"}
          </h3>
          <p className="text-[12px] text-ink leading-snug">
            {profile.mission ||
              (it
                ? "Mission non in foglio — manca il Business Summary Yahoo."
                : "Mission not on the sheet — Yahoo Business Summary missing.")}
          </p>
        </section>
        <section>
          <h3 className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted mb-1">
            {it ? "Pipeline in sviluppo" : "Pipeline in development"}
          </h3>
          <ProgramList
            items={profile.pipeline}
            it={it}
            empty={
              it
                ? "Nessun programma in sviluppo nel foglio / feed."
                : "No development programs in the sheet / feed."
            }
          />
        </section>
        <section>
          <h3 className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted mb-1">
            {it ? "Prodotti approvati" : "Approved products"}
          </h3>
          <ProgramList
            items={profile.approved}
            it={it}
            empty={
              it
                ? "Nessun prodotto approvato trovato (foglio, guidance o feed)."
                : "No approved product found (sheet, guidance, or feed)."
            }
          />
        </section>
        <p className="text-[9px] text-ink-muted leading-snug">
          {it
            ? "Da foglio Simulation, feed clinico e Guidance Calendar — non è un 10-K."
            : "From Simulation sheet, clinical feed and Guidance Calendar — not a 10-K."}
        </p>
      </div>
    </AppModal>
  );
}
