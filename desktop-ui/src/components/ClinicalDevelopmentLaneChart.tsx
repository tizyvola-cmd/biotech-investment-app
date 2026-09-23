import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ClinicalPreCdRecord,
  GuidanceCalendarEvent,
  SdsRow,
} from "../api/supernova";
import {
  COMPANY_CATALYST_HORIZON_DAYS,
  LANE_BLOCK_H,
  LANE_SUBTITLE_CHARS,
  LANE_TITLE_CHARS,
  PRODUCT_CATALYST_HORIZON_MONTHS,
  buildClinicalDevelopmentLane,
  buildCompanyCatalystHorizon,
  estimateLaneLabelWidthPx,
  fmtLaneDate,
  forwardHorizonAxis,
  laneAxisTicks,
  layoutClinicalDevelopmentLaneChart,
  listTopClinicalPrograms,
  defaultClinicalProgramId,
  programIdentityColor,
  devPathStageLabel,
  type ClinicalLaneHeader,
  type ClinicalLaneMarker,
  type CompanyHorizonCatalyst,
  type DevPathStage,
  type DevPathTopology,
  type LaneCertainty,
} from "../sheet/clinicalDevelopmentLane";
import { nctClinicalTrialsUrl } from "../sheet/cellLinks";
import {
  type DeskReferenceDoc,
} from "../sheet/deskReferenceExplain";
import { DeskReferenceModal } from "./DeskReferenceModal";
import { NewsCompanyProductDebrief } from "./NewsCompanyProductDebrief";
import { useLang, useT } from "../shared/i18n";
import { localizeStudyPhase } from "../sheet/clinicalIndicators";

const INK = "#0B0D17";
const INK_MUTED = "#5B6580";
const ACCENT = "#7C6CF3";
const ACCENT_SOFT = "rgba(124, 108, 243, 0.32)";
const AXIS = "rgba(11, 13, 23, 0.16)";
const TODAY = "#C9A227";

function diamondPts(cx: number, cy: number, r: number): string {
  return `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`;
}

function clipLabel(s: string, max = LANE_TITLE_CHARS): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function laneCertaintyLabel(certainty: LaneCertainty, it: boolean): string {
  if (certainty === "occurred") {
    return it ? "Avvenuta — fonte" : "Occurred — sourced";
  }
  if (certainty === "expected") {
    return it ? "Attesa — guidance aziendale" : "Expected — company guidance";
  }
  return it ? "Inferita — non sorgente" : "Inferred — not sourced";
}

function isoDayFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function formatLaneDateLong(ms: number, it: boolean, monthImputed?: boolean): string {
  if (monthImputed) {
    return new Date(ms).toLocaleDateString(it ? "it-IT" : "en-GB", {
      month: "long",
      year: "numeric",
    });
  }
  return new Date(ms).toLocaleDateString(it ? "it-IT" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function studyFieldFromHeader(header: ClinicalLaneHeader): {
  study: string;
  href: string | null;
  nct: string | null;
} {
  const nct = header.nctId?.trim() || null;
  const href = nct ? nctClinicalTrialsUrl(nct) : null;
  let study = String(header.studyShort || "").trim();
  if (nct && study && !study.toUpperCase().includes(nct.toUpperCase())) {
    study = `${study} · ${nct}`;
  } else if (!study && nct) {
    study = nct;
  }
  return { study: study || "—", href, nct };
}

/** Detail card opened from a Development Path Gantt label (Readout chip, etc.). */
export function clinicalLaneMarkerReferenceDoc(
  marker: ClinicalLaneMarker,
  header: ClinicalLaneHeader,
  it: boolean,
): DeskReferenceDoc {
  const stageLabel = marker.stageId ? devPathStageLabel(marker.stageId, it) : null;
  const titleBits = marker.title.split(/\s*·\s*/).map((s) => s.trim()).filter(Boolean);
  const typeName =
    stageLabel ||
    titleBits[0] ||
    (marker.kind === "market"
      ? it
        ? "Reazione di mercato"
        : "Market reaction"
      : it
        ? "Evento"
        : "Event");
  const productFromTitle =
    titleBits.length > 1 ? titleBits.slice(1).join(" · ") : "";
  const product = String(header.drug || productFromTitle || "").trim() || "—";
  const { study, href, nct } = studyFieldFromHeader(header);
  const phase = String(header.phase || "").trim() || "—";
  const dateIso = isoDayFromMs(marker.plotMs);
  const dateLbl = formatLaneDateLong(marker.plotMs, it, marker.monthImputed);
  const certainty = laneCertaintyLabel(marker.certainty, it);
  const windowLbl =
    marker.windowStartMs != null &&
    marker.windowEndMs != null &&
    marker.windowEndMs - marker.windowStartMs > 3 * 86_400_000
      ? `${formatLaneDateLong(marker.windowStartMs, it)} → ${formatLaneDateLong(marker.windowEndMs, it)}`
      : null;

  const fields = [
    {
      id: "type",
      label: it ? "Tipo di evento" : "Event type",
      value: typeName,
    },
    {
      id: "product",
      label: it ? "Prodotto" : "Product",
      value: product,
    },
    {
      id: "study",
      label: it ? "Studio clinico" : "Clinical study",
      value: study,
      href: study !== "—" ? href : null,
    },
    {
      id: "phase",
      label: it ? "Tipo / fase di studio" : "Study type / phase",
      value: phase,
    },
    {
      id: "date",
      label: it ? "Data" : "Date",
      value: marker.monthImputed
        ? it
          ? `${dateLbl} (mese stimato)`
          : `${dateLbl} (month-level)`
        : dateLbl,
    },
    ...(windowLbl
      ? [
          {
            id: "window",
            label: it ? "Finestra" : "Window",
            value: windowLbl,
          },
        ]
      : []),
    {
      id: "certainty",
      label: it ? "Stato data" : "Date status",
      value: certainty,
    },
    ...(header.condition
      ? [
          {
            id: "condition",
            label: it ? "Indicazione" : "Indication",
            value: header.condition,
          },
        ]
      : []),
    ...(header.studyDesign
      ? [
          {
            id: "design",
            label: it ? "Disegno studio" : "Study design",
            value: header.studyDesign,
          },
        ]
      : []),
  ];

  const notes: string[] = [];
  if (marker.detail.trim()) notes.push(marker.detail.trim());
  if (header.company) {
    notes.push(
      it
        ? `Società: ${header.company}.`
        : `Company: ${header.company}.`,
    );
  }
  if (marker.kind === "clinical" && typeName.toLowerCase().includes("readout")) {
    notes.push(
      it
        ? "Readout: pubblicazione o presentazione dei risultati del trial (comunicato, 8-K o congresso)."
        : "Readout: publication or presentation of trial results (press release, 8-K, or congress).",
    );
  }
  if (!notes.length) {
    notes.push(
      it
        ? "Dettaglio da Development Path / calendario catalyst per questo prodotto."
        : "Detail from the Development Path / catalyst calendar for this product.",
    );
  }

  return {
    kicker: it ? "Evento Development Path" : "Development Path event",
    title: `${header.ticker} · ${typeName}${product !== "—" ? ` · ${product}` : ""}`,
    meta: [dateLbl, certainty, phase !== "—" ? phase : null].filter(Boolean).join(" · "),
    href,
    hrefLabel: href
      ? nct
        ? `CT.gov · ${nct}`
        : "CT.gov"
      : it
        ? "Nessun link studio"
        : "No study link",
    highlightId: "details",
    fields,
    sections: [
      {
        id: "details",
        title: it ? "Cosa stiamo guardando" : "What this is",
        body: notes,
      },
    ],
    ctgovEnrich:
      study === "—" || !href
        ? {
            ticker: header.ticker,
            company: header.company,
            eventDate: dateIso,
          }
        : null,
  };
}

export function companyHorizonCatalystReferenceDoc(
  item: CompanyHorizonCatalyst,
  ticker: string,
  it: boolean,
): DeskReferenceDoc {
  const typeName = item.catalystType || (item.stageId ? devPathStageLabel(item.stageId, it) : it ? "Evento" : "Event");
  const product = item.drug?.trim() || "—";
  const nct = item.nctId?.trim() || null;
  const href = nct ? nctClinicalTrialsUrl(nct) : null;
  const phase = item.phase ? localizeStudyPhase(String(item.phase), it) : "—";
  const dateLbl = formatLaneDateLong(item.plotMs, it);
  const certainty = laneCertaintyLabel(item.certainty, it);
  const study = nct || "—";

  return {
    kicker: it ? "Catalyst società" : "Company catalyst",
    title: `${ticker.trim().toUpperCase()} · ${typeName}${product !== "—" ? ` · ${product}` : ""}`,
    meta: [dateLbl, certainty, phase !== "—" ? phase : null].filter(Boolean).join(" · "),
    href,
    hrefLabel: href
      ? nct
        ? `CT.gov · ${nct}`
        : "CT.gov"
      : it
        ? "Nessun link studio"
        : "No study link",
    highlightId: "details",
    fields: [
      {
        id: "type",
        label: it ? "Tipo di evento" : "Event type",
        value: typeName,
      },
      {
        id: "product",
        label: it ? "Prodotto" : "Product",
        value: product,
      },
      {
        id: "study",
        label: it ? "Studio clinico" : "Clinical study",
        value: study,
        href: study !== "—" ? href : null,
      },
      {
        id: "phase",
        label: it ? "Tipo / fase di studio" : "Study type / phase",
        value: phase,
      },
      {
        id: "date",
        label: it ? "Data" : "Date",
        value: dateLbl,
      },
      {
        id: "certainty",
        label: it ? "Stato data" : "Date status",
        value: certainty,
      },
    ],
    sections: [
      {
        id: "details",
        title: it ? "Cosa stiamo guardando" : "What this is",
        body: [
          item.title?.trim() ||
            (it
              ? "Evento dal calendario catalyst della società (finestra 12 mesi)."
              : "Event from the company catalyst calendar (12-month window)."),
          typeName.toLowerCase().includes("readout")
            ? it
              ? "Readout: pubblicazione o presentazione dei risultati del trial."
              : "Readout: publication or presentation of trial results."
            : "",
        ].filter(Boolean),
      },
    ],
    ctgovEnrich:
      study === "—" || !href
        ? {
            ticker: ticker.trim().toUpperCase(),
            eventDate: isoDayFromMs(item.plotMs),
          }
        : null,
  };
}

function tickCaption(
  tk: { ms: number; year: number; quarter: number },
  spanMs: number,
  it: boolean,
): { main: string; year: boolean } {
  const d = new Date(tk.ms);
  const loc = it ? "it-IT" : "en-GB";
  if (spanMs <= 18 * 86_400_000) {
    return {
      main: d.toLocaleDateString(loc, { day: "numeric", month: "short" }),
      year: false,
    };
  }
  if (spanMs <= 400 * 86_400_000) {
    return {
      main: d.toLocaleDateString(loc, { month: "short" }),
      year: true,
    };
  }
  return { main: `Q${tk.quarter}`, year: true };
}

function MarkerGlyph({
  cx,
  cy,
  certainty,
  fill = ACCENT,
}: {
  cx: number;
  cy: number;
  certainty: LaneCertainty;
  fill?: string;
}) {
  const r = 5.5;
  if (certainty === "occurred") {
    return <polygon points={diamondPts(cx, cy, r)} fill={fill} />;
  }
  if (certainty === "expected") {
    return (
      <polygon points={diamondPts(cx, cy, r)} fill="#fff" stroke={fill} strokeWidth={1.6} />
    );
  }
  return (
    <g>
      <polygon
        points={diamondPts(cx, cy, r)}
        fill="#fff"
        stroke={fill}
        strokeWidth={1.4}
        strokeDasharray="2 1.5"
      />
      <path d={`M ${cx + r + 2} ${cy - 3} L ${cx + r + 7} ${cy} L ${cx + r + 2} ${cy + 3}`} fill={fill} />
    </g>
  );
}

function PathStageStrip({
  stages,
  it,
  caption,
  topology = "serial",
  confirmatory = null,
}: {
  stages: DevPathStage[];
  it: boolean;
  caption: string;
  topology?: DevPathTopology;
  confirmatory?: DevPathStage | null;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-ink-muted mb-1">{caption}</p>
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
              {i > 0 ? <span className="text-[9px] text-ink-muted/50 px-0.5">→</span> : null}
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
        <p className="text-[9px] text-ink-muted mt-1 leading-snug">
          <span className="mr-1">↳</span>
          {confirmatory.label}
          {confirmatory.dateMs != null
            ? ` · ${fmtLaneDate(confirmatory.dateMs, it, confirmatory.dateImprecise)}`
            : ""}
          <span className="opacity-80">
            {it ? " — parallela alla submission, non un gate in serie" : " — parallel to submission, not a serial gate"}
          </span>
        </p>
      ) : null}
    </div>
  );
}

function Company30dSummaryChart({
  items,
  axisStartMs,
  axisEndMs,
  todayMs,
  programs,
  it,
  viewportPx,
  horizonDays = COMPANY_CATALYST_HORIZON_DAYS,
  onOpenItem,
}: {
  items: CompanyHorizonCatalyst[];
  axisStartMs: number;
  axisEndMs: number;
  todayMs: number;
  programs: { id: string; drug: string; phaseRank: number; phase: string | null }[];
  it: boolean;
  viewportPx?: number;
  horizonDays?: number;
  onOpenItem?: (item: CompanyHorizonCatalyst) => void;
}) {
  const left = 72;
  const plotW = Math.max(240, Math.round((viewportPx || 720) - left - 24));
  const spanMs = Math.max(1, axisEndMs - axisStartMs);
  const xOf = (ms: number) => left + ((ms - axisStartMs) / spanMs) * plotW;
  const packed = items.map((m) => ({
    id: m.id,
    x: xOf(m.plotMs),
    widthPx: estimateLaneLabelWidthPx(m.catalystType, m.drug),
    priority: m.certainty === "expected" ? 1 : 2,
  }));
  const rightEdge: number[] = [];
  const levels = new Map<string, number>();
  for (const itRow of [...packed].sort((a, b) => a.x - b.x || a.id.localeCompare(b.id))) {
    let lane = 0;
    while (lane < rightEdge.length && itRow.x < (rightEdge[lane] ?? 0) + 8) lane += 1;
    if (lane >= 5) continue;
    if (lane === rightEdge.length) rightEdge.push(Number.NEGATIVE_INFINITY);
    rightEdge[lane] = Math.max(rightEdge[lane] ?? 0, itRow.x + itRow.widthPx);
    levels.set(itRow.id, lane);
  }
  const used = Math.max(1, rightEdge.length);
  const midY = 28 + used * LANE_BLOCK_H;
  const svgH = midY + 48;
  const svgW = left + plotW + 28;
  const todayX = xOf(todayMs);
  const ticks = laneAxisTicks(axisStartMs, axisEndMs);
  const todayLbl = new Date(todayMs).toLocaleDateString(it ? "it-IT" : "en-GB", {
    day: "numeric",
    month: "short",
  });

  return (
    <div className="space-y-1.5 min-w-0">
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-ink-muted">
        {programs.map((p) => (
          <span key={p.id} className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-sm"
              style={{ background: programIdentityColor(p.id) }}
            />
            <span className="font-medium text-ink">{p.drug}</span>
            {p.phase ? (
              <span className="opacity-80">{localizeStudyPhase(String(p.phase), it)}</span>
            ) : null}
          </span>
        ))}
      </div>
      <div className="w-full overflow-x-auto overflow-y-hidden">
        <svg
          width="100%"
          height={svgH}
          viewBox={`0 0 ${svgW} ${svgH}`}
          preserveAspectRatio="xMinYMid meet"
          className="block w-full"
          role="img"
          aria-label={
            it
              ? `Catalyst ${horizonDays} giorni`
              : `${horizonDays}-day catalysts`
          }
        >
          <text x={8} y={midY + 3} fill={INK} fontSize="9" fontWeight={800}>
            {horizonDays >= 360
              ? it
                ? "12 MESI"
                : "12 MONTHS"
              : it
                ? `${horizonDays} GIORNI`
                : `${horizonDays} DAYS`}
          </text>
          <line x1={left} y1={midY} x2={left + plotW} y2={midY} stroke={ACCENT} strokeWidth={1.5} />
          {ticks.map((tk) => {
            const x = xOf(tk.ms);
            if (x < left - 4 || x > left + plotW + 4) return null;
            const cap = tickCaption(tk, spanMs, it);
            return (
              <g key={tk.ms}>
                <line x1={x} y1={midY} x2={x} y2={midY + 4} stroke={AXIS} strokeWidth={1} />
                <text x={x + 1} y={svgH - 10} fill={INK_MUTED} fontSize="8.5">
                  {cap.main}
                </text>
              </g>
            );
          })}
          <line
            x1={todayX}
            y1={12}
            x2={todayX}
            y2={svgH - 22}
            stroke={TODAY}
            strokeWidth={1.1}
            strokeDasharray="3 2"
          />
          <text x={Math.min(todayX + 4, left + plotW - 80)} y={14} fill={TODAY} fontSize="8.5" fontWeight={800}>
            {it ? "OGGI" : "TODAY"} · {todayLbl}
          </text>
          {items
            .filter((m) => levels.has(m.id))
            .map((m) => {
              const cx = xOf(m.plotMs);
              const lvl = levels.get(m.id) ?? 0;
              const labelY = midY - (18 + lvl * LANE_BLOCK_H);
              const title = clipLabel(m.catalystType, 18);
              const sub = clipLabel(m.drug, 16);
              const detailCue = it ? "Dettagli ›" : "Details ›";
              const open = onOpenItem
                ? () => onOpenItem(m)
                : undefined;
              return (
                <g key={m.id}>
                  <line x1={cx} y1={midY} x2={cx} y2={labelY + 8} stroke={m.color} strokeOpacity={0.35} />
                  <MarkerGlyph cx={cx} cy={midY} certainty={m.certainty} fill={m.color} />
                  <foreignObject x={cx + 4} y={labelY - 12} width={118} height={26}>
                    <button
                      type="button"
                      disabled={!open}
                      className={
                        open
                          ? "box-border h-full w-full rounded border border-[#7C6CF3]/70 bg-white px-1 py-0.5 text-left leading-tight hover:bg-[#F5F3FF] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#7C6CF3]"
                          : "box-border h-full w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-left leading-tight"
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        open?.();
                      }}
                      aria-label={
                        open
                          ? it
                            ? `Apri dettaglio: ${m.catalystType} · ${m.drug}`
                            : `Open detail: ${m.catalystType} · ${m.drug}`
                          : undefined
                      }
                    >
                      <span className="block truncate text-[9px] font-bold text-[#0B0D17] underline decoration-[#7C6CF3]/70 underline-offset-2">
                        {title}
                      </span>
                      <span className="block truncate text-[8px] font-semibold" style={{ color: m.color }}>
                        {sub}
                        {open ? (
                          <span className="ml-1 font-semibold text-[#7C6CF3]">{detailCue}</span>
                        ) : null}
                      </span>
                    </button>
                  </foreignObject>
                </g>
              );
            })}
        </svg>
      </div>
      {items.length === 0 ? (
        <p className="text-[10px] text-ink-muted">
          {it
            ? "Nessuna catalyst in calendario nei prossimi 12 mesi per i prodotti di questa società."
            : "No calendar catalysts in the next 12 months for this company’s products."}
        </p>
      ) : (
        <ul className="space-y-1 max-h-36 overflow-y-auto">
          {items.map((m) => (
            <li key={`row-${m.id}`}>
              <button
                type="button"
                className="w-full text-left flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[10px] leading-snug rounded px-0.5 py-0.5 hover:bg-[#F3F5FA] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#7C6CF3]/50"
                onClick={() => onOpenItem?.(m)}
                title={
                  it
                    ? "Apri dettaglio evento"
                    : "Open event detail"
                }
              >
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-sm"
                  style={{ background: m.color }}
                />
                <span className="font-semibold tabular-nums text-ink">
                  {fmtLaneDate(m.plotMs, it, false)}
                </span>
                <span className="font-semibold text-ink underline-offset-2 hover:underline">
                  {m.catalystType}
                </span>
                <span style={{ color: m.color }} className="font-medium">
                  {m.drug}
                </span>
                {m.phase ? <span className="text-ink-muted">{m.phase}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Compact company Gantt: catalysts in the next 30 days + product labels.
 * Used as the Clinical news hero instead of an ancient primary CD event.
 */
export function TickerCompany30dCatalystPanel({
  ticker,
  completionDate,
  records,
  guidanceEvents,
  sdsRow,
  clinicalKpi,
  simRow = null,
  it = false,
}: {
  ticker: string;
  completionDate?: string | null;
  records?: ClinicalPreCdRecord[] | null;
  guidanceEvents?: GuidanceCalendarEvent[] | null;
  sdsRow?: SdsRow | null;
  clinicalKpi?: number | null;
  simRow?: Record<string, unknown> | null;
  it?: boolean;
}) {
  const widthHostRef = useRef<HTMLDivElement>(null);
  const [viewportPx, setViewportPx] = useState(0);
  const [refDoc, setRefDoc] = useState<DeskReferenceDoc | null>(null);

  useEffect(() => {
    const el = widthHostRef.current;
    if (!el) return;
    const measure = () => setViewportPx(el.clientWidth || 0);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ticker]);

  const companyHorizon = useMemo(
    () =>
      buildCompanyCatalystHorizon({
        ticker,
        completionDate,
        records,
        guidanceEvents,
        sdsRow,
        clinicalKpi,
        simRow,
        lang: it ? "it" : "en",
      }),
    [ticker, completionDate, records, guidanceEvents, sdsRow, clinicalKpi, simRow, it],
  );

  if (!companyHorizon) {
    return (
      <p className="text-[11px] text-ink-muted">
        {it
          ? "Nessun programma clinico trovato per questo ticker."
          : "No clinical programs found for this ticker."}
      </p>
    );
  }

  return (
    <div ref={widthHostRef} className="min-w-0 space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wide text-[#F3C451]">
          {companyHorizon.horizonDays >= 360
            ? it
              ? "Prossime catalyst (fino a 12 mesi)"
              : "Upcoming catalysts (up to 12 months)"
            : it
              ? `Catalyst prossimi ${companyHorizon.horizonDays} giorni`
              : `Next ${companyHorizon.horizonDays}-day catalysts`}
        </p>
        <p className="text-[10px] text-ink-muted">
          {companyHorizon.horizonDays >= 360
            ? it
              ? "Nessuna entro 30g — mostro il calendario fino a un anno"
              : "None within 30d — showing calendar up to one year"
            : it
              ? "Prodotti e milestone datate sul calendario società"
              : "Products and dated milestones on the company calendar"}
        </p>
      </div>
      <Company30dSummaryChart
        items={companyHorizon.items}
        axisStartMs={companyHorizon.axisStartMs}
        axisEndMs={companyHorizon.axisEndMs}
        todayMs={companyHorizon.todayMs}
        programs={companyHorizon.programs}
        it={it}
        viewportPx={viewportPx}
        horizonDays={companyHorizon.horizonDays}
        onOpenItem={(item) =>
          setRefDoc(companyHorizonCatalystReferenceDoc(item, ticker, it))
        }
      />
      <DeskReferenceModal doc={refDoc} it={it} onClose={() => setRefDoc(null)} />
    </div>
  );
}

export function ClinicalDevelopmentLaneChart({
  ticker,
  completionDate,
  records,
  guidanceEvents,
  sdsRow,
  clinicalKpi,
  simRow = null,
  onAlignToCal6M,
}: {
  ticker: string;
  completionDate?: string | null;
  records?: ClinicalPreCdRecord[] | null;
  guidanceEvents?: GuidanceCalendarEvent[] | null;
  sdsRow?: SdsRow | null;
  clinicalKpi?: number | null;
  simRow?: Record<string, unknown> | null;
  /** Switch the price/volume pair to Cal 6M so the X-axes share a window. */
  onAlignToCal6M?: () => void;
}) {
  const { lang } = useLang();
  const t = useT();
  const it = lang === "it";
  const widthHostRef = useRef<HTMLDivElement>(null);
  const [viewportPx, setViewportPx] = useState(0);
  const [refDoc, setRefDoc] = useState<DeskReferenceDoc | null>(null);

  useEffect(() => {
    onAlignToCal6M?.();
    // Intentionally not depending on the callback identity — parent may pass an inline setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  const programs = useMemo(
    () =>
      listTopClinicalPrograms({
        ticker,
        records,
        guidanceEvents,
        simRow,
        completionDate,
        limit: 20,
      }),
    [ticker, records, guidanceEvents, simRow, completionDate],
  );
  /** null = auto (completing CD). "company" = all-products 30d. string = product id. */
  const [picked, setPicked] = useState<string | "company" | null>(null);
  useEffect(() => {
    setPicked(null);
  }, [ticker]);

  const selectedProgramId =
    picked === "company" ? null : picked ?? defaultClinicalProgramId(programs, completionDate);
  const showCompany = picked === "company";

  const companyHorizon = useMemo(
    () =>
      buildCompanyCatalystHorizon({
        ticker,
        completionDate,
        records,
        guidanceEvents,
        sdsRow,
        clinicalKpi,
        simRow,
        lang: it ? "it" : "en",
      }),
    [ticker, completionDate, records, guidanceEvents, sdsRow, clinicalKpi, simRow, it],
  );

  const model = useMemo(() => {
    if (showCompany) return null;
    const nowMs = Date.now();
    return buildClinicalDevelopmentLane({
      ticker,
      completionDate,
      records,
      guidanceEvents,
      sdsRow,
      clinicalKpi,
      simRow,
      lang: it ? "it" : "en",
      programId: selectedProgramId,
      nowMs,
      axisOverride: forwardHorizonAxis(nowMs, PRODUCT_CATALYST_HORIZON_MONTHS),
    });
  }, [
    showCompany,
    selectedProgramId,
    ticker,
    completionDate,
    records,
    guidanceEvents,
    sdsRow,
    clinicalKpi,
    simRow,
    it,
  ]);

  const layout = useMemo(
    () =>
      model
        ? layoutClinicalDevelopmentLaneChart(model, {
            fitViewportPx: viewportPx || 720,
          })
        : null,
    [model, viewportPx],
  );

  useEffect(() => {
    const el = widthHostRef.current;
    if (!el) return;
    let frame = 0;
    const apply = (w: number) => {
      const next = Math.round(Math.min(2200, Math.max(320, w)));
      setViewportPx((prev) => (Math.abs(prev - next) < 8 ? prev : next));
    };
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => apply(el.clientWidth));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [ticker, Boolean(model), Boolean(companyHorizon)]);

  const showProduct = Boolean(!showCompany && model);
  const showTimeline = Boolean(showProduct && layout);

  const { svgW, svgH, left, plotW, midY, todayX, plotTop, plotBottom } = layout ?? {
    svgW: 0,
    svgH: 0,
    left: 0,
    plotW: 1,
    midY: 0,
    todayX: 0,
    plotTop: 0,
    plotBottom: 0,
  };
  const ticks = model && layout ? laneAxisTicks(model.axisStartMs, model.axisEndMs) : [];
  const spanMs = model ? Math.max(1, model.axisEndMs - model.axisStartMs) : 1;
  const todayLbl = model
    ? new Date(model.todayMs).toLocaleDateString(it ? "it-IT" : "en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "";

  const selectedProgram = selectedProgramId
    ? programs.find((p) => p.id === selectedProgramId) ?? null
    : null;

  /** Study line always follows the active product chip (not the deep-dive primary NCT). */
  const headerBits =
    showProduct && model
      ? [
          model.header.ticker,
          (() => {
            const d = selectedProgram?.drug || model.header.drug;
            const n = selectedProgram?.nctId || model.header.nctId;
            // Never repeat NCT as both product and study id.
            if (d && n && d.replace(/\s+/g, "").toUpperCase() === n.replace(/\s+/g, "").toUpperCase()) {
              return null;
            }
            if (d && /^nct\d{8}$/i.test(d.trim())) return null;
            return d;
          })(),
          selectedProgram?.nctId || model.header.nctId,
          model.header.studyShort,
          selectedProgram?.phase
            ? localizeStudyPhase(String(selectedProgram.phase), it)
            : model.header.phase,
          selectedProgram?.indication || model.header.condition,
          (selectedProgram?.enrollment ?? model.header.enrollment) != null
            ? it
              ? `${selectedProgram?.enrollment ?? model.header.enrollment} pz`
              : `${selectedProgram?.enrollment ?? model.header.enrollment} pts`
            : null,
          model.header.status,
        ].filter(Boolean)
      : [];

  const proximity =
    model?.timingProximityDays != null
      ? t(
          model.timingProximityUncertain
            ? "sim.lossAnalysis.devLane.proximityUncertain"
            : "sim.lossAnalysis.devLane.proximity",
          { days: String(model.timingProximityDays) },
        )
      : null;
  const hiddenN = layout?.hiddenMarkerCount ?? 0;

  const xOf = (ms: number) =>
    model
      ? left +
        ((ms - model.axisStartMs) / Math.max(1, model.axisEndMs - model.axisStartMs)) * plotW
      : left;

  const todayTextX = Math.min(Math.max(todayX + 6, left), left + plotW - 118);

  return (
    <section className="invest-trend-chart-panel rounded-xl border px-3 py-2.5 space-y-2 min-w-0">
      <NewsCompanyProductDebrief
        ticker={ticker}
        simRows={simRow ? [simRow] : null}
        companyHint={model?.header.company ?? null}
        productHint={
          showCompany
            ? null
            : (() => {
                const d = selectedProgram?.drug ?? model?.header.drug ?? null;
                if (d && /^nct\d{8}$/i.test(String(d).trim())) return null;
                // Never treat the ticker as the product name.
                if (d && String(d).trim().toUpperCase() === ticker.trim().toUpperCase()) {
                  return null;
                }
                return d;
              })()
        }
        indicationHint={
          showCompany
            ? null
            : selectedProgram?.indication ?? model?.header.condition ?? null
        }
        phaseHint={
          showCompany
            ? null
            : selectedProgram?.phase
              ? localizeStudyPhase(String(selectedProgram.phase), it)
              : model?.header.phase ?? null
        }
        companyMode={showCompany}
        it={it}
      />
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-ink">{t("sim.lossAnalysis.devLane.title")}</p>
          {showCompany ? (
            <p className="text-[10px] text-ink-muted leading-snug mt-0.5">
              {t("sim.lossAnalysis.devLane.leadCompany", {
                days: String(companyHorizon?.horizonDays ?? COMPANY_CATALYST_HORIZON_DAYS),
              })}
            </p>
          ) : null}
        </div>
      </div>

      <div className="min-w-0">
        <p className="text-[9px] font-semibold uppercase tracking-wide text-ink-muted mb-1">
          {t("sim.lossAnalysis.devLane.programsCaption")}
        </p>
        <div
          className="flex flex-wrap gap-1.5"
          role="tablist"
          aria-label={t("sim.lossAnalysis.devLane.programsCaption")}
        >
          <button
            type="button"
            role="tab"
            aria-selected={showCompany}
            onClick={() => setPicked("company")}
            className={
              showCompany
                ? "rounded-md border border-[#7C6CF3] bg-[#7C6CF3] px-2 py-1.5 text-left text-[10px] font-semibold leading-tight text-white"
                : "rounded-md border border-[#D5DBE8] bg-white px-2 py-1.5 text-left text-[10px] font-medium leading-tight text-[#0B0D17] hover:border-[#7C6CF3]/60"
            }
          >
            <span className="block">{t("sim.lossAnalysis.devLane.companyTab")}</span>
            <span
              className={`block text-[9px] ${showCompany ? "opacity-90" : "text-ink-muted"}`}
            >
              {(companyHorizon?.horizonDays ?? COMPANY_CATALYST_HORIZON_DAYS) >= 360
                ? it
                  ? "fino a 12 mesi"
                  : "up to 12 months"
                : it
                  ? `${companyHorizon?.horizonDays ?? COMPANY_CATALYST_HORIZON_DAYS} giorni`
                  : `${companyHorizon?.horizonDays ?? COMPANY_CATALYST_HORIZON_DAYS} days`}
            </span>
          </button>
          {programs.map((p) => {
            const active = !showCompany && p.id === selectedProgramId;
            const phaseLbl = p.phase ? localizeStudyPhase(String(p.phase), it) : null;
            const color = programIdentityColor(p.id);
            const tip = [p.drug, phaseLbl, p.nctId, p.indication].filter(Boolean).join(" · ");
            return (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={tip || p.drug}
                onClick={() => setPicked(p.id)}
                className={
                  active
                    ? "rounded-md border px-2 py-1.5 text-left text-[10px] font-semibold leading-tight text-white"
                    : "rounded-md border border-[#D5DBE8] bg-white px-2 py-1.5 text-left text-[10px] font-medium leading-tight text-[#0B0D17] hover:border-[#7C6CF3]/50"
                }
                style={
                  active
                    ? { background: color, borderColor: color }
                    : { borderLeftWidth: 3, borderLeftColor: color }
                }
                title={tip}
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: active ? "#fff" : color }}
                  />
                  <span className="block max-w-[11rem] truncate">
                    {p.drug && /^nct\d{8}$/i.test(p.drug.trim())
                      ? it
                        ? "Studio CD"
                        : "CD study"
                      : p.drug}
                  </span>
                </span>
                {phaseLbl ? (
                  <span className={`block text-[9px] ${active ? "opacity-90" : "text-ink-muted"}`}>
                    {phaseLbl}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        {showProduct && headerBits.length > 0 ? (
          <div key={selectedProgramId ?? "none"} className="mt-1.5 space-y-0.5">
            <p
              className="text-[10px] text-ink leading-snug font-medium break-words"
              title={headerBits.join(" · ")}
            >
              {headerBits.join(" · ")}
            </p>
            <p className="text-[10px] text-ink-muted/90 leading-snug">
              {t("sim.lossAnalysis.devLane.leadProduct")}
              {proximity ? ` ${proximity}` : ""}
              {showTimeline && hiddenN > 0
                ? ` ${t(
                    (layout?.hiddenPackedCount ?? 0) > 0
                      ? "sim.lossAnalysis.devLane.hiddenPacked"
                      : "sim.lossAnalysis.devLane.hiddenOffAxis",
                    { n: String(hiddenN) },
                  )}`
                : ""}
            </p>
          </div>
        ) : null}
      </div>

      <div ref={widthHostRef} className="w-full min-w-0">
        {showCompany && companyHorizon ? (
          <Company30dSummaryChart
            items={companyHorizon.items}
            axisStartMs={companyHorizon.axisStartMs}
            axisEndMs={companyHorizon.axisEndMs}
            todayMs={companyHorizon.todayMs}
            programs={companyHorizon.programs}
            it={it}
            viewportPx={viewportPx}
            horizonDays={companyHorizon.horizonDays}
            onOpenItem={(item) =>
              setRefDoc(companyHorizonCatalystReferenceDoc(item, ticker, it))
            }
          />
        ) : null}

        {showProduct && model ? (
          <div key={selectedProgramId ?? "product"} className="min-w-0 space-y-1.5">
            <PathStageStrip
              stages={model.pathStages}
              it={it}
              caption={
                model.pathTopology === "accelerated"
                  ? t("sim.lossAnalysis.devLane.templateCaptionAccel")
                  : t("sim.lossAnalysis.devLane.templateCaption")
              }
              topology={model.pathTopology}
              confirmatory={model.confirmatoryPhase3}
            />
            {model.pathNote ? (
              <p className="text-[10px] leading-snug rounded-md border border-[#D5DBE8] bg-[#F3F5FA] px-2 py-1.5 text-[#0B0D17] mt-1.5">
                {model.pathNote}
              </p>
            ) : null}
            <p className="text-[9px] font-semibold uppercase tracking-wide text-ink-muted mt-2 mb-1">
              {t("sim.lossAnalysis.devLane.forwardCaption", {
                months: String(PRODUCT_CATALYST_HORIZON_MONTHS),
              })}
            </p>

            {showTimeline && layout ? (
              <>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] text-ink-muted">
                  <span className="inline-flex items-center gap-1">
                    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                      <polygon points="6,1 11,6 6,11 1,6" fill={ACCENT} />
                    </svg>
                    {t("sim.lossAnalysis.devLane.legend.occurred")}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                      <polygon points="6,1 11,6 6,11 1,6" fill="#fff" stroke={ACCENT} strokeWidth="1.4" />
                    </svg>
                    {t("sim.lossAnalysis.devLane.legend.expected")}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden>
                      <polygon
                        points="6,1 11,6 6,11 1,6"
                        fill="#fff"
                        stroke={ACCENT}
                        strokeWidth="1.3"
                        strokeDasharray="2 1.4"
                      />
                      <path d="M12 3.5 L15 6 L12 8.5" fill={ACCENT} />
                    </svg>
                    {t("sim.lossAnalysis.devLane.legend.inferred")}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden>
                      <line
                        x1="7"
                        y1="0"
                        x2="7"
                        y2="10"
                        stroke={TODAY}
                        strokeWidth="1.2"
                        strokeDasharray="2 2"
                      />
                    </svg>
                    {t("sim.lossAnalysis.devLane.legend.today")}
                  </span>
                </div>

                <div className="w-full overflow-x-auto overflow-y-hidden overscroll-x-contain">
                  <svg
                    width="100%"
                    height={svgH}
                    viewBox={`0 0 ${svgW} ${svgH}`}
                    preserveAspectRatio="xMinYMid meet"
                    className="block w-full"
                    role="img"
                    aria-label={t("sim.lossAnalysis.devLane.title")}
                  >
                    <text
                      x={10}
                      y={Math.max(42, midY - 36)}
                      fill={INK}
                      fontSize="9"
                      fontWeight={800}
                      letterSpacing="0.08em"
                    >
                      {t("sim.lossAnalysis.devLane.lane.clinical")}
                    </text>
                    <text
                      x={10}
                      y={Math.min(svgH - 48, midY + 48)}
                      fill={INK}
                      fontSize="9"
                      fontWeight={800}
                      letterSpacing="0.06em"
                    >
                      {t("sim.lossAnalysis.devLane.lane.market")}
                    </text>

                    <line
                      x1={left}
                      y1={midY}
                      x2={left + plotW}
                      y2={midY}
                      stroke={ACCENT}
                      strokeWidth={1.6}
                    />
                    <line
                      x1={left}
                      y1={midY - 5}
                      x2={left}
                      y2={midY + 5}
                      stroke={ACCENT}
                      strokeWidth={1.6}
                    />
                    <line
                      x1={left + plotW}
                      y1={midY - 5}
                      x2={left + plotW}
                      y2={midY + 5}
                      stroke={ACCENT}
                      strokeWidth={1.6}
                    />

                    {ticks.map((tk, i) => {
                      const x = xOf(tk.ms);
                      if (x < left - 8 || x > left + plotW + 8) return null;
                      const cap = tickCaption(tk, spanMs, it);
                      const showYear = cap.year && (i === 0 || ticks[i - 1]?.year !== tk.year);
                      return (
                        <g key={tk.ms}>
                          <line
                            x1={x}
                            y1={midY}
                            x2={x}
                            y2={midY + 5}
                            stroke={AXIS}
                            strokeWidth={1}
                          />
                          <text x={x + 2} y={svgH - 8} fill={INK_MUTED} fontSize="9">
                            {cap.main}
                          </text>
                          {showYear ? (
                            <text
                              x={x + 2}
                              y={svgH - 20}
                              fill={INK}
                              fontSize="10"
                              fontWeight={700}
                            >
                              {tk.year}
                            </text>
                          ) : null}
                        </g>
                      );
                    })}

                    <line
                      x1={todayX}
                      y1={plotTop}
                      x2={todayX}
                      y2={plotBottom}
                      stroke={TODAY}
                      strokeWidth={1.15}
                      strokeDasharray="3.5 2.5"
                    />
                    <text x={todayTextX} y={14} fill={TODAY} fontSize="9" fontWeight={800}>
                      {it ? "OGGI" : "TODAY"} · {todayLbl.toUpperCase()}
                    </text>

                    {model.markers
                      .filter((m) => layout.visibleMarkerIds.has(m.id))
                      .map((m: ClinicalLaneMarker) => {
                        const cx = xOf(m.plotMs);
                        const lvl =
                          (m.kind === "clinical"
                            ? layout.clinicalLevels
                            : layout.marketLevels
                          ).get(m.id) ?? 0;
                        const up = m.kind === "clinical";
                        const stem = 18 + lvl * LANE_BLOCK_H;
                        const cy = midY;
                        const labelY = up ? cy - stem : cy + stem;
                        const hasWin =
                          m.windowStartMs != null &&
                          m.windowEndMs != null &&
                          m.windowEndMs - m.windowStartMs > 3 * 86_400_000;
                        const x0 = hasWin ? xOf(m.windowStartMs!) : cx;
                        const x1 = hasWin ? xOf(m.windowEndMs!) : cx;
                        const title = clipLabel(m.title, LANE_TITLE_CHARS);
                        const subtitle = clipLabel(m.subtitle, LANE_SUBTITLE_CHARS);
                        const detailCue = it ? "Dettagli ›" : "Details ›";
                        const labelW = Math.max(
                          estimateLaneLabelWidthPx(title, `${subtitle} · ${detailCue}`),
                          108,
                        );
                        const labelTop = up ? labelY - 12 : labelY - 2;
                        const openDetail = () =>
                          setRefDoc(clinicalLaneMarkerReferenceDoc(m, model.header, it));
                        return (
                          <g key={`${m.id}-${m.plotMs}`}>
                            {hasWin ? (
                              <g>
                                <line
                                  x1={x0}
                                  y1={cy}
                                  x2={x1}
                                  y2={cy}
                                  stroke={INK}
                                  strokeWidth={1.5}
                                />
                                <line
                                  x1={x0}
                                  y1={cy - 4}
                                  x2={x0}
                                  y2={cy + 4}
                                  stroke={INK}
                                  strokeWidth={1.5}
                                />
                                <line
                                  x1={x1}
                                  y1={cy - 4}
                                  x2={x1}
                                  y2={cy + 4}
                                  stroke={INK}
                                  strokeWidth={1.5}
                                />
                              </g>
                            ) : null}
                            <line
                              x1={cx}
                              y1={cy}
                              x2={cx}
                              y2={labelY + (up ? 8 : -8)}
                              stroke={ACCENT_SOFT}
                              strokeWidth={1}
                            />
                            {m.kind === "market" ? (
                              <rect
                                x={cx - 3.5}
                                y={cy + 1}
                                width={7}
                                height={Math.max(10, Math.abs(labelY - cy) - 16)}
                                fill={ACCENT}
                                opacity={0.32}
                                rx={1}
                              />
                            ) : null}
                            <MarkerGlyph cx={cx} cy={cy} certainty={m.certainty} />
                            <foreignObject
                              x={cx + 5}
                              y={labelTop}
                              width={labelW}
                              height={26}
                            >
                              <button
                                type="button"
                                className="box-border h-full w-full rounded border border-[#7C6CF3] bg-white px-1 py-0.5 text-left leading-tight shadow-sm hover:bg-[#F5F3FF] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#7C6CF3]"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openDetail();
                                }}
                                title={
                                  it
                                    ? `Apri dettaglio: ${m.title}`
                                    : `Open detail: ${m.title}`
                                }
                                aria-label={
                                  it
                                    ? `Apri dettaglio: ${m.title}`
                                    : `Open detail: ${m.title}`
                                }
                              >
                                <span className="block truncate text-[9.5px] font-bold text-[#0B0D17] underline decoration-[#7C6CF3]/70 underline-offset-2">
                                  {title}
                                </span>
                                <span className="block truncate text-[8px] text-[#5B6580]">
                                  {subtitle}
                                  <span className="ml-1 font-semibold text-[#7C6CF3] no-underline">
                                    {detailCue}
                                  </span>
                                </span>
                              </button>
                            </foreignObject>
                          </g>
                        );
                      })}
                  </svg>
                </div>
              </>
            ) : (
              <div className="rounded-md border border-[#D5DBE8] bg-[#F3F5FA] px-3 py-3">
                <div className="h-2 rounded-full bg-[#7C6CF3]/25 mb-2" />
                <p className="text-[10px] text-[#5B6580]">
                {it
                  ? "Nessuna catalyst datata nei prossimi 12 mesi per questo prodotto (path e Gantt sono per-prodotto)."
                  : "No dated catalysts in the next 12 months for this product (path and Gantt are per-product)."}
                </p>
              </div>
            )}
          </div>
        ) : null}
      </div>
      <DeskReferenceModal doc={refDoc} it={it} onClose={() => setRefDoc(null)} />
    </section>
  );
}
