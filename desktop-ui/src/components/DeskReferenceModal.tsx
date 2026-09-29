import { useEffect, useState } from "react";
import { AppModal, AppModalCloseButton } from "./AppModal";
import { openExternalUrl } from "../sheet/k8ChartLinks";
import {
  applyCtgovStudyToReferenceDoc,
  type DeskReferenceDoc,
} from "../sheet/deskReferenceExplain";
import { resolveCtgovStudyNearCd } from "../sheet/ctgovStudyMeta";

export function DeskReferenceModal({
  doc,
  it,
  onClose,
}: {
  doc: DeskReferenceDoc | null;
  it: boolean;
  onClose: () => void;
}) {
  const open = Boolean(doc);
  const [liveDoc, setLiveDoc] = useState<DeskReferenceDoc | null>(doc);
  const [ctgovLoading, setCtgovLoading] = useState(false);

  useEffect(() => {
    setLiveDoc(doc);
  }, [doc]);

  useEffect(() => {
    if (!doc?.ctgovEnrich?.ticker) return;
    const study = doc.fields?.find((f) => f.id === "study");
    const needsStudy = !study?.value || study.value === "—";
    const needsLink = !doc.href;
    if (!needsStudy && !needsLink) return;
    let cancelled = false;
    setCtgovLoading(true);
    void resolveCtgovStudyNearCd({
      ticker: doc.ctgovEnrich.ticker,
      company: doc.ctgovEnrich.company,
      targetCd: doc.ctgovEnrich.eventDate,
    })
      .then((hit) => {
        if (cancelled || !hit) return;
        setLiveDoc((prev) =>
          prev ? applyCtgovStudyToReferenceDoc(prev, hit, it) : prev,
        );
      })
      .finally(() => {
        if (!cancelled) setCtgovLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [doc, it]);

  const view = liveDoc;
  return (
    <AppModal
      open={open}
      onClose={onClose}
      aria-label={view?.title || (it ? "Riferimento" : "Reference")}
      panelClassName="w-[min(94vw,36rem)]"
    >
      {view ? (
        <div className="card w-full max-h-[85vh] overflow-hidden shadow-xl flex flex-col">
          <header className="flex items-start justify-between gap-3 px-4 py-3 border-b border-[rgb(var(--border))]/40 shrink-0">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wide text-ink-muted font-semibold">
                {view.kicker}
              </p>
              <h3 className="text-sm font-bold text-ink mt-0.5 break-words whitespace-normal">
                {view.title}
              </h3>
              {view.meta ? (
                <p className="text-[11px] text-ink-muted mt-0.5 tabular-nums">{view.meta}</p>
              ) : null}
            </div>
            <AppModalCloseButton onClose={onClose} />
          </header>
          <div className="px-4 py-3 overflow-y-auto text-[12px] text-ink leading-snug space-y-3">
            {view.fields?.length ? (
              <dl className="rounded-md border border-[rgb(var(--accent))]/35 bg-[rgb(var(--accent))]/6 px-2.5 py-2 space-y-2">
                {view.fields.map((f) => (
                  <div key={f.id} className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-2 gap-y-0.5">
                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted pt-0.5">
                      {f.label}
                    </dt>
                    <dd className="text-[12px] text-ink break-words whitespace-normal min-w-0">
                      {f.href ? (
                        <button
                          type="button"
                          className="text-left text-[rgb(var(--accent))] font-semibold hover:underline break-all"
                          onClick={(e) => openExternalUrl(f.href!, e)}
                          title={f.href}
                        >
                          {f.value}
                        </button>
                      ) : (
                        f.value
                      )}
                    </dd>
                  </div>
                ))}
                {ctgovLoading ? (
                  <p className="text-[10px] text-ink-muted pt-1">
                    {it
                      ? "Cerco titolo studio su ClinicalTrials.gov…"
                      : "Looking up study title on ClinicalTrials.gov…"}
                  </p>
                ) : null}
              </dl>
            ) : null}

            {view.href ? (
              <button
                type="button"
                className="inline-flex items-center rounded-md border border-[rgb(var(--accent))]/40 bg-[rgb(var(--accent))]/10 px-2.5 py-1 text-[11px] font-semibold text-[rgb(var(--accent))] hover:bg-[rgb(var(--accent))]/16"
                onClick={(e) => openExternalUrl(view.href!, e)}
              >
                {view.hrefLabel ||
                  (it ? "Apri dettaglio catalyst day" : "Open catalyst day detail")}
              </button>
            ) : !view.fields?.length ? (
              <p className="text-ink-muted">
                {it
                  ? "Nessun link originale su questo evento. La spiegazione resta qui sotto."
                  : "No original link on this event. The explanation is below."}
              </p>
            ) : null}

            {view.sections.map((sec) => {
              const hi = sec.id === view.highlightId && !view.fields?.length;
              return (
                <section
                  key={sec.id}
                  className={
                    hi
                      ? "rounded-md border border-[rgb(var(--accent))]/35 bg-[rgb(var(--accent))]/6 px-2.5 py-2"
                      : ""
                  }
                >
                  <h4 className="text-[12px] font-bold text-ink">{sec.title}</h4>
                  {sec.body.map((p) => (
                    <p
                      key={p.slice(0, 48)}
                      className="mt-1.5 text-ink-muted break-words whitespace-normal"
                    >
                      {p}
                    </p>
                  ))}
                </section>
              );
            })}
          </div>
        </div>
      ) : null}
    </AppModal>
  );
}
