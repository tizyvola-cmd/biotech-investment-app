/**
 * Synthetic regulatory KPIs for approval / CRL / clinical hold when the event
 * has no quantitative clinical indicators. Used by EIS_intrinsic (not a new type).
 */

import type { ClinicalPublicationEvent, ClinicalStudyIndicator } from "../api/supernova";

export type RegulatoryKpiEventText = Pick<
  ClinicalPublicationEvent,
  "event_title" | "summary" | "source_type" | "event_type" | "items_raw"
> & {
  title?: string | null;
  sourceType?: string | null;
  itemsRaw?: string | null;
};

const PENDING_RE =
  /\b(seeking|pending|plans? to (?:file|submit|seek)|will (?:file|submit)|awaiting|application (?:for|to) (?:fda|ema)|submitted an? (?:n[db]a|bla))\b/i;

const HOLD_LIFTED_RE = /\b(clinical hold (?:lifted|removed|released)|lifted (?:the )?clinical hold)\b/i;

const HOLD_RE = /\bclinical hold\b/i;

/** CRL / refuse-to-file — not oncology “complete response rate”. */
const CRL_RE =
  /\b(complete response letter|\bcrl\b|(?:fda|ema) (?:complete response|reject(?:ed|s|ion)|refused to file))\b/i;

const DENIED_RE =
  /\b((?:fda|ema) (?:did not|does not|declined to) approv|approval denied|not approved by (?:the )?(?:fda|ema))\b/i;

const APPROVAL_RE =
  /\b((?:fda|ema|mhra|pmda)\s+approv(?:ed|es|al)|approval granted|accelerated approval|full approval|granted (?:an? )?(?:nda |bla |snda )?approval|approved (?:the )?(?:nda|bla|snda|indication|drug))\b/i;

function eventBlob(ev: RegulatoryKpiEventText): string {
  return [ev.event_title, ev.title, ev.summary].filter(Boolean).join("\n");
}

function hasRealOutcomeKpi(indicators: ClinicalStudyIndicator[]): boolean {
  return indicators.some((i) => {
    const kt = String(i.kpi_type ?? "").toLowerCase();
    if (kt === "efficacy" || kt === "regulatory") return true;
    if (i.endpoint_met != null && kt !== "enrollment") return true;
    return false;
  });
}

function isEarningsOnly(ev: RegulatoryKpiEventText, blob: string): boolean {
  const items = String(ev.items_raw ?? ev.itemsRaw ?? "");
  const st = String(ev.source_type ?? ev.event_type ?? ev.sourceType ?? "").toLowerCase();
  if (!/\b2\.02\b/.test(items) && st !== "sec_8k") return false;
  if (
    HOLD_LIFTED_RE.test(blob) ||
    HOLD_RE.test(blob) ||
    CRL_RE.test(blob) ||
    DENIED_RE.test(blob) ||
    APPROVAL_RE.test(blob)
  ) {
    return false;
  }
  return /\b(earnings|results of operations|financial results|quarterly)\b/i.test(blob) || /\b2\.02\b/.test(items);
}

export function virtualRegulatoryIndicator(
  ev: RegulatoryKpiEventText,
  existing?: ClinicalStudyIndicator[] | null,
): ClinicalStudyIndicator | null {
  const base = existing ?? [];
  if (hasRealOutcomeKpi(base)) return null;
  const blob = eventBlob(ev);
  if (!blob.trim() || PENDING_RE.test(blob)) return null;
  if (isEarningsOnly(ev, blob)) return null;

  if (HOLD_LIFTED_RE.test(blob)) {
    return {
      label: "Clinical hold lifted",
      value: "lifted",
      kpi_type: "regulatory",
      endpoint_met: true,
      direction: "up",
      source: "virtual",
    };
  }
  if (HOLD_RE.test(blob)) {
    return {
      label: "Clinical hold",
      value: "issued",
      kpi_type: "regulatory",
      endpoint_met: false,
      direction: "down",
      source: "virtual",
    };
  }
  if (CRL_RE.test(blob)) {
    return {
      label: "Complete response letter",
      value: "issued",
      kpi_type: "regulatory",
      endpoint_met: false,
      direction: "down",
      source: "virtual",
    };
  }
  if (DENIED_RE.test(blob)) {
    return {
      label: "Approval denied",
      value: "denied",
      kpi_type: "regulatory",
      endpoint_met: false,
      direction: "down",
      source: "virtual",
    };
  }
  if (APPROVAL_RE.test(blob)) {
    return {
      label: "Regulatory approval",
      value: "granted",
      kpi_type: "regulatory",
      endpoint_met: true,
      direction: "up",
      source: "virtual",
    };
  }
  return null;
}

export function mergeVirtualRegulatoryIndicators(
  ev: RegulatoryKpiEventText,
  indicators: ClinicalStudyIndicator[] | undefined | null,
): ClinicalStudyIndicator[] {
  const base = indicators ?? [];
  const v = virtualRegulatoryIndicator(ev, base);
  return v ? [...base, v] : base;
}
