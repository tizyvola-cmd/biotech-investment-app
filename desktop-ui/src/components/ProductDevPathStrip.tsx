/**
 * Compact IND→Approval stage strip for Product Summary / Ongoing trials.
 * Same model as ClinicalDevelopmentLaneChart PathStageStrip.
 */
import { useMemo } from "react";
import type { ClinicalPreCdRecord, GuidanceCalendarEvent } from "../api/supernova";
import {
  buildClinicalDevelopmentLane,
  defaultClinicalProgramId,
  fmtLaneDate,
  listTopClinicalPrograms,
  type ClinicalDevProgram,
  type DevPathStage,
  type DevPathTopology,
} from "../sheet/clinicalDevelopmentLane";

function programIdForProduct(
  programs: ClinicalDevProgram[],
  productName: string,
  cdIso?: string | null,
): string | null {
  const key = productName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (key.length >= 4) {
    const hit = programs.find((p) => {
      const d = (p.drug || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
      return d.length >= 4 && (d.includes(key) || key.includes(d));
    });
    if (hit) return hit.id;
  }
  return defaultClinicalProgramId(programs, cdIso);
}

function PathStageStrip({
  stages,
  it,
  topology,
  confirmatory,
  nctId = null,
}: {
  stages: DevPathStage[];
  it: boolean;
  topology: DevPathTopology;
  confirmatory: DevPathStage | null;
  nctId?: string | null;
}) {
  const nct = (nctId || "").trim().toUpperCase();
  return (
    <div className="min-w-0">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-[#97A2BA] mb-1">
        {it
          ? nct
            ? `Percorso di sviluppo · ${nct} (solo date pubbliche)`
            : "Percorso di sviluppo (solo date pubbliche)"
          : nct
            ? `Development path · ${nct} (filled only when a public date exists)`
            : "Development path (filled only when a public date exists)"}
      </p>
      <ol className="flex flex-wrap items-center gap-x-0.5 gap-y-1">
        {stages.map((s, i) => {
          const dateLbl =
            s.dateMs != null ? fmtLaneDate(s.dateMs, it, s.dateImprecise) : null;
          const cls =
            s.status === "done"
              ? "bg-[#7C6CF3] text-white border-[#7C6CF3]"
              : s.status === "current"
                ? "bg-[#FFF8E1] text-[#0B0D17] border-[#F3C451] font-bold"
                : s.status === "next"
                  ? "bg-white text-[#7C6CF3] border-[#7C6CF3] border-dashed"
                  : "bg-[#F3F5FA] text-[#5B6580] border-[#D5DBE8]";
          return (
            <li key={s.id} className="inline-flex items-center gap-0.5">
              {i > 0 ? (
                <span className="text-[9px] text-[#97A2BA]/50 px-0.5">→</span>
              ) : null}
              <span
                className={`inline-flex flex-col items-center justify-center rounded px-1.5 py-0.5 border text-[9px] leading-tight min-w-[2.6rem] ${cls}`}
                title={`${s.label}${dateLbl ? ` · ${dateLbl}` : ""} · ${s.status}`}
              >
                <span>{s.label}</span>
                {dateLbl ? <span className="opacity-80 font-normal">{dateLbl}</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
      {topology === "accelerated" && confirmatory ? (
        <p className="text-[9px] text-[#97A2BA] mt-1 leading-snug">
          <span className="mr-1">↳</span>
          {confirmatory.label}
          {confirmatory.dateMs != null
            ? ` · ${fmtLaneDate(confirmatory.dateMs, it, confirmatory.dateImprecise)}`
            : ""}
          <span className="opacity-80">
            {it
              ? " — parallela alla submission, non un gate in serie"
              : " — parallel to submission, not a serial gate"}
          </span>
        </p>
      ) : null}
    </div>
  );
}

export function ProductDevPathStrip({
  ticker,
  productName,
  cdIso = null,
  nctId = null,
  phaseOverride = null,
  clinicalRecords = null,
  guidanceEvents = null,
  it = false,
  embedded = false,
}: {
  ticker: string;
  productName: string;
  cdIso?: string | null;
  /** Pin path to one NCT (per-study strip under Ongoing trials). */
  nctId?: string | null;
  /** CT.gov phase when clinical feed has no row for this NCT. */
  phaseOverride?: string | null;
  clinicalRecords?: ClinicalPreCdRecord[] | null;
  guidanceEvents?: GuidanceCalendarEvent[] | null;
  it?: boolean;
  /** Drop outer card chrome when nested inside a Study card. */
  embedded?: boolean;
}) {
  const model = useMemo(() => {
    try {
      const tk = ticker.trim().toUpperCase();
      const product = productName.trim();
      if (!tk || !product) return null;
      const programs = listTopClinicalPrograms({
        ticker: tk,
        records: clinicalRecords,
        guidanceEvents,
        completionDate: cdIso,
        limit: 20,
      });
      const programId = programIdForProduct(programs, product, cdIso);
      return buildClinicalDevelopmentLane({
        ticker: tk,
        completionDate: cdIso,
        records: clinicalRecords,
        guidanceEvents,
        lang: it ? "it" : "en",
        programId,
        nctId,
        phaseOverride,
      });
    } catch (err) {
      console.error("[ProductDevPathStrip] build failed", err);
      return null;
    }
  }, [ticker, productName, cdIso, nctId, phaseOverride, clinicalRecords, guidanceEvents, it]);

  if (!model?.pathStages?.length) {
    return (
      <p className="text-[11px] text-[#97A2BA] leading-snug">
        {it
          ? "Percorso di sviluppo non ancora disponibile per questo studio."
          : "Development path not available yet for this study."}
      </p>
    );
  }

  const body = (
    <>
      <PathStageStrip
        stages={model.pathStages}
        it={it}
        topology={model.pathTopology}
        confirmatory={model.confirmatoryPhase3}
        nctId={nctId}
      />
      {model.pathNote ? (
        <p className="text-[10px] leading-snug text-[#C5CDDC]">{model.pathNote}</p>
      ) : null}
    </>
  );

  if (embedded) {
    return <div className="space-y-1.5 py-1">{body}</div>;
  }

  return (
    <div className="space-y-1.5 rounded-lg border border-white/[0.08] bg-[#121729] px-2.5 py-2">
      {body}
    </div>
  );
}
