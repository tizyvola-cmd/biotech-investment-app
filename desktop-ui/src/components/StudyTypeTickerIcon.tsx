import { useMemo } from "react";
import {
  classifyStudy,
  classifyStudyFromSimRow,
  formatStudyTypeTooltip,
  type ClinicalStudyTextMeta,
  type StudyClassification,
} from "../sheet/studyClassifier";
import { isMedtechTicker } from "../sheet/medtechSymbols";
import { useLang } from "../shared/i18n";

/** Grid column width — device ECG is rendered at this size. */
export const STUDY_TYPE_ICON_SLOT_PX = 20;
export const STUDY_DRUG_ICON_PX = 14;

export function studyIconRenderSize(
  klass: StudyClassification["klass"],
  baseSize = STUDY_DRUG_ICON_PX,
): number {
  if (klass === "device") return STUDY_TYPE_ICON_SLOT_PX;
  if (klass === "uncertain") return STUDY_TYPE_ICON_SLOT_PX;
  return baseSize;
}

function DrugPillIcon({ size = STUDY_DRUG_ICON_PX }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden
      className="shrink-0"
    >
      <rect x="1.5" y="5" width="13" height="6" rx="3" fill="#ef4444" />
      <rect x="1.5" y="5" width="6.5" height="6" rx="3" fill="#ef4444" />
      <rect x="8" y="5" width="6.5" height="6" rx="3" fill="#facc15" />
      <line x1="8" y1="5" x2="8" y2="11" stroke="white" strokeWidth="0.6" opacity="0.85" />
    </svg>
  );
}

function DeviceEcgMonitorIcon({ size = STUDY_TYPE_ICON_SLOT_PX }: { size?: number }) {
  /* Monitor diagnostico + traccia ECG — colori pieni, leggibile a ~20px. */
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden
      className="shrink-0"
    >
      <rect x="1.5" y="2" width="13" height="10.5" rx="1.8" fill="#0d9488" />
      <rect x="2.2" y="2.7" width="11.6" height="7.2" rx="1" fill="#134e4a" />
      <polyline
        points="3,7.2 4.6,7.2 5.2,4.8 6.1,9.6 7.2,5.8 8.3,7.2 9.4,7.2 10.2,6.2 11,7.2 12.6,7.2"
        fill="none"
        stroke="#5eead4"
        strokeWidth="1.15"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="6.2" y="12.8" width="3.6" height="1.2" rx="0.4" fill="#0d9488" />
      <rect x="5.4" y="13.6" width="5.2" height="0.8" rx="0.3" fill="#14b8a6" />
    </svg>
  );
}

export function applyMedtechStudyOverride(
  classification: StudyClassification,
  ticker: string | null | undefined,
): StudyClassification {
  if (!isMedtechTicker(ticker)) return classification;
  return {
    klass: "device",
    confidence: "high",
    drugScore: classification.drugScore,
    deviceScore: Math.max(classification.deviceScore, 8),
    matchedDrug: classification.matchedDrug,
    matchedDevice: classification.matchedDevice.length
      ? classification.matchedDevice
      : ["medtech universe"],
  };
}

function tickerFromSimRow(simRow?: Record<string, unknown> | null): string {
  if (!simRow) return "";
  return String(simRow.Ticker ?? simRow.ticker ?? "").trim();
}

export function resolveStudyClassification(args: {
  simRow?: Record<string, unknown> | null;
  studyText?: string | null;
  clinicalMeta?: ClinicalStudyTextMeta | null;
  ticker?: string | null;
}): StudyClassification {
  let base: StudyClassification;
  if (args.studyText != null && String(args.studyText).trim()) {
    base = classifyStudy(args.studyText);
  } else {
    base = classifyStudyFromSimRow(args.simRow, args.clinicalMeta);
  }
  const ticker = String(args.ticker ?? "").trim() || tickerFromSimRow(args.simRow);
  return applyMedtechStudyOverride(base, ticker);
}

export function StudyTypeTickerIcon({
  ticker,
  simRow,
  studyText,
  clinicalMeta,
  size = STUDY_DRUG_ICON_PX,
  className = "",
}: {
  ticker?: string | null;
  simRow?: Record<string, unknown> | null;
  studyText?: string | null;
  clinicalMeta?: ClinicalStudyTextMeta | null;
  size?: number;
  className?: string;
}) {
  const { lang } = useLang();
  const classification = useMemo(
    () =>
      resolveStudyClassification({
        ticker,
        simRow,
        studyText,
        clinicalMeta,
      }),
    [ticker, simRow, studyText, clinicalMeta],
  );

  const renderSize = studyIconRenderSize(
    classification.klass === "uncertain" ? "drug" : classification.klass,
    size,
  );

  // Never leave an empty slot: medtech→device already applied; remaining uncertain = biotech default drug.
  const displayKlass: "drug" | "device" =
    classification.klass === "device" ? "device" : "drug";
  const tip =
    classification.klass === "uncertain"
      ? lang === "it"
        ? `Tipo non classificato — default farmaco/biotech. ${formatStudyTypeTooltip(classification, "it")}`
        : `Unclassified — default drug/biotech. ${formatStudyTypeTooltip(classification, "en")}`
      : formatStudyTypeTooltip(classification, lang === "it" ? "it" : "en");
  const label =
    displayKlass === "drug"
      ? lang === "it"
        ? "Farmaco"
        : "Drug"
      : lang === "it"
        ? "Medical device"
        : "Medical device";

  return (
    <span
      className={`inline-flex items-center justify-center shrink-0 ${className}`}
      style={{ width: renderSize, height: renderSize, minWidth: renderSize }}
      title={tip}
      aria-label={`${label}: ${tip}`}
    >
      {displayKlass === "drug" ? (
        <DrugPillIcon size={renderSize} />
      ) : (
        <DeviceEcgMonitorIcon size={renderSize} />
      )}
    </span>
  );
}
