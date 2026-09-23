import {
  FDA_ADCOM_MATERIALS_URL,
  fdaBriefingFileAvailable,
  formatFdaScore,
  verifyFdaBriefingMatchesCompany,
  type FdaAdcomRow,
} from "../sheet/fdaAdcomCalendar";
import { AppModal, AppModalCloseButton } from "./AppModal";

function kindLabel(kind: FdaAdcomRow["kind"], it: boolean): string {
  if (kind === "safety_review") return it ? "Revisione di sicurezza" : "Safety review";
  return it ? "Voto / recommendation" : "Vote / recommendation";
}

export function FdaAdcomBriefingModal({
  row,
  it,
  onClose,
}: {
  row: FdaAdcomRow;
  it: boolean;
  onClose: () => void;
}) {
  const brief = row.briefing;
  const summary = it ? brief?.summaryIt || brief?.summaryEn : brief?.summaryEn || brief?.summaryIt;
  const bullets = (it ? brief?.bulletsIt : brief?.bulletsEn) ?? [];
  const match = verifyFdaBriefingMatchesCompany(row);
  const meetingHref = (row.href || "").trim();
  const pageHref =
    (brief?.materialsUrl || "").trim() &&
    (brief?.materialsUrl || "").trim() !== FDA_ADCOM_MATERIALS_URL
      ? (brief?.materialsUrl || "").trim()
      : meetingHref || FDA_ADCOM_MATERIALS_URL;
  const pdfHref = (brief?.pdfUrl || "").trim();
  const fileOk = fdaBriefingFileAvailable(brief);
  const meetingTitle =
    (brief?.title || "").trim() ||
    row.committee ||
    (it ? row.eventIt : row.eventEn);
  const objectText = it ? row.eventIt || row.eventEn : row.eventEn || row.eventIt;
  const dateLabel = row.date.slice(0, 10);

  return (
    <AppModal
      open
      onClose={onClose}
      aria-label={it ? `Meeting FDA · ${row.ticker}` : `FDA meeting · ${row.ticker}`}
      panelClassName="w-full max-w-xl overflow-hidden rounded-2xl border border-white/[0.12] bg-[#121729] shadow-2xl flex flex-col"
    >
      <div className="flex shrink-0 items-start gap-3 border-b border-white/[0.08] px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#97A2BA]">
            {it ? "Riepilogo meeting FDA" : "FDA meeting summary"}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-extrabold text-[#F3F5FA] tabular-nums">
              {row.ticker}
            </span>
            <span className="text-[11px] font-medium text-[#97A2BA] truncate">{row.company}</span>
          </div>
        </div>
        <AppModalCloseButton
          onClose={onClose}
          className="text-[#97A2BA] hover:text-[#F3F5FA] hover:bg-white/10"
        />
      </div>

      <div className="px-4 py-3 space-y-3.5 overflow-y-auto max-h-[72vh]">
        <section>
          <h4 className="text-[9px] font-bold uppercase tracking-wide text-[#97A2BA]">
            {it ? "Titolo del meeting" : "Meeting title"}
          </h4>
          <p className="mt-1 text-[13px] font-semibold text-[#F3F5FA] leading-snug">{meetingTitle}</p>
          <p className="mt-1 text-[11px] text-[#97A2BA] tabular-nums">
            {dateLabel}
            {row.committee && row.committee !== meetingTitle ? ` · ${row.committee}` : ""}
          </p>
        </section>

        <section>
          <h4 className="text-[9px] font-bold uppercase tracking-wide text-[#97A2BA]">
            {it ? "Oggetto" : "Subject"}
          </h4>
          <p className="mt-1 text-[12px] leading-relaxed text-[#F3F5FA]">{objectText}</p>
          <p className="mt-1 text-[11px] text-[#97A2BA]">
            {kindLabel(row.kind, it)}
            {row.product ? ` · ${row.product}` : ""}
          </p>
        </section>

        <section className="rounded-xl border border-white/[0.1] bg-[#1A2136] px-3 py-2.5 space-y-2">
          <h4 className="text-[9px] font-bold uppercase tracking-wide text-[#97A2BA]">
            {it ? "Materiali / file" : "Materials / files"}
          </h4>
          {fileOk ? (
            <>
              <p className="text-[12px] font-semibold text-[#34D399]">
                {it ? "File briefing pubblicato" : "Briefing file published"}
                {match.ok ? (it ? " · abbinato a questa società" : " · matched to this company") : ""}
              </p>
              {brief?.title && brief.title !== meetingTitle ? (
                <p className="text-[11px] text-[#F3F5FA] leading-snug">{brief.title}</p>
              ) : null}
              {summary ? (
                <p className="text-[12px] leading-relaxed text-[#F3F5FA]">{summary}</p>
              ) : null}
              {(() => {
                const results = (it ? brief?.resultsIt : brief?.resultsEn) ?? [];
                const stats = (it ? brief?.statisticsIt : brief?.statisticsEn) ?? [];
                const conclusions =
                  (it ? brief?.conclusionsIt : brief?.conclusionsEn) ?? [];
                return (
                  <>
                    {results.length > 0 ? (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wide text-[#97A2BA]">
                          {it ? "Risultati" : "Results"}
                        </p>
                        <ul className="mt-1 list-disc pl-4 space-y-1 text-[11px] text-[#F3F5FA] leading-snug">
                          {results.slice(0, 12).map((b) => (
                            <li key={`r-${b.slice(0, 40)}`}>{b}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {stats.length > 0 ? (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wide text-[#97A2BA]">
                          {it ? "Statistiche" : "Statistics"}
                        </p>
                        <ul className="mt-1 list-disc pl-4 space-y-1 text-[11px] text-[#F3F5FA] leading-snug">
                          {stats.slice(0, 12).map((b) => (
                            <li key={`s-${b.slice(0, 40)}`}>{b}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {conclusions.length > 0 ? (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wide text-[#97A2BA]">
                          {it ? "Conclusioni" : "Conclusions"}
                        </p>
                        <ul className="mt-1 list-disc pl-4 space-y-1 text-[11px] text-[#F3F5FA] leading-snug">
                          {conclusions.slice(0, 8).map((b) => (
                            <li key={`c-${b.slice(0, 40)}`}>{b}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </>
                );
              })()}
              {bullets.length > 0 ? (
                <ul className="list-disc pl-4 space-y-1 text-[11px] text-[#F3F5FA] leading-snug">
                  {bullets.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              ) : null}
              {brief?.score != null && Number.isFinite(brief.score) ? (
                <p className="text-[11px] font-semibold tabular-nums text-[#F3F5FA]">
                  FDA score {formatFdaScore(brief.score)}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-[12px] leading-relaxed text-[#F3F5FA]">
              {it
                ? "Nessun file briefing pubblicato (o non ancora abbinato). I documenti FDA escono di solito ~2 giorni prima del meeting."
                : "No briefing file published yet (or not matched). FDA documents usually post about 2 days before the meeting."}
            </p>
          )}
          <div className="flex flex-wrap gap-3 pt-1">
            {pdfHref ? (
              <a
                href={pdfHref}
                target="_blank"
                rel="noreferrer"
                className="text-[12px] font-semibold text-[#A79AFF] hover:underline"
              >
                {it ? "Apri il documento →" : "Open document →"}
              </a>
            ) : null}
            {pageHref ? (
              <a
                href={pageHref}
                target="_blank"
                rel="noreferrer"
                className="text-[12px] font-semibold text-[#A79AFF] hover:underline"
              >
                {it ? "Pagina meeting FDA →" : "FDA meeting page →"}
              </a>
            ) : null}
            {meetingHref && meetingHref !== pageHref ? (
              <a
                href={meetingHref}
                target="_blank"
                rel="noreferrer"
                className="text-[12px] font-semibold text-[#A79AFF] hover:underline"
              >
                {it ? "Annuncio in calendario →" : "Calendar announcement →"}
              </a>
            ) : null}
            {!fileOk ? (
              <a
                href={FDA_ADCOM_MATERIALS_URL}
                target="_blank"
                rel="noreferrer"
                className="text-[12px] font-semibold text-[#A79AFF] hover:underline"
              >
                {it ? "Materiali aggiornati FDA →" : "FDA recently updated materials →"}
              </a>
            ) : null}
          </div>
        </section>
      </div>
    </AppModal>
  );
}

export function FdaBriefingCell({
  row,
  days: _days,
  it,
  onOpen,
}: {
  row: FdaAdcomRow | null;
  days: number | null;
  it: boolean;
  onOpen: () => void;
}) {
  if (!row) return <span className="text-[11px] text-[#C5CDDC]">—</span>;
  const brief = row.briefing;
  const score =
    brief?.score != null && Number.isFinite(brief.score) ? brief.score : null;
  const fileAvailable = fdaBriefingFileAvailable(brief);
  const match = verifyFdaBriefingMatchesCompany(row);
  /** Green only when a real file exists AND it matches this scheduled company. */
  const showGreen = fileAvailable && match.ok;

  if (showGreen) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
        className="text-[11px] font-semibold text-[#34D399] hover:underline tabular-nums"
        title={
          it
            ? "Briefing FDA pubblicato — dettagli anche nella finestra Event"
            : "FDA briefing published — details also in the Event window"
        }
      >
        {score != null ? formatFdaScore(score) : it ? "File" : "File"}
      </button>
    );
  }

  // No T−2 countdown in this column — open Event for briefing link / summary.
  return <span className="text-[11px] text-[#C5CDDC]">—</span>;
}
