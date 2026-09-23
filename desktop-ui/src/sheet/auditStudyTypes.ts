import {
  classifyStudy,
  type StudyClassification,
  type StudyClass,
} from "./studyClassifier";

export type AuditedStudyRow<T = unknown> = {
  ticker: string;
  text: string;
  classification: StudyClassification;
  reviewReason?: string;
  source?: T;
};

export type StudyTypeAuditReport<T = unknown> = {
  total: number;
  byClass: Record<StudyClass, AuditedStudyRow<T>[]>;
  needsReview: AuditedStudyRow<T>[];
  /** True when portfolio contains both drug and device classifications. */
  hasMixedPortfolio: boolean;
  summary: Record<StudyClass, number>;
};

function needsManualReview(row: AuditedStudyRow): boolean {
  const c = row.classification;
  if (c.klass === "uncertain") return true;
  if (c.confidence === "low") return true;
  if (c.confidence === "medium" && Math.abs(c.drugScore - c.deviceScore) <= 2) return true;
  return false;
}

function reviewReason(row: AuditedStudyRow): string {
  const c = row.classification;
  if (c.klass === "uncertain") return "class uncertain";
  if (c.confidence === "low") return "low confidence";
  if (c.confidence === "medium" && Math.abs(c.drugScore - c.deviceScore) <= 2) {
    return "drug/device scores close";
  }
  return "review";
}

/** Audit a list — answers: "do we have both drugs and devices?" */
export function auditStudyTypes<T>(
  items: T[],
  getTicker: (item: T) => string,
  getStudyText: (item: T) => string | null | undefined,
): StudyTypeAuditReport<T> {
  const byClass: StudyTypeAuditReport<T>["byClass"] = {
    drug: [],
    device: [],
    uncertain: [],
  };
  const needsReview: AuditedStudyRow<T>[] = [];

  for (const item of items) {
    const text = String(getStudyText(item) ?? "").trim();
    const classification = classifyStudy(text);
    const row: AuditedStudyRow<T> = {
      ticker: getTicker(item),
      text,
      classification,
      source: item,
    };
    byClass[classification.klass].push(row);
    if (needsManualReview(row)) {
      needsReview.push({ ...row, reviewReason: reviewReason(row) });
    }
  }

  const summary: Record<StudyClass, number> = {
    drug: byClass.drug.length,
    device: byClass.device.length,
    uncertain: byClass.uncertain.length,
  };

  return {
    total: items.length,
    byClass,
    needsReview,
    hasMixedPortfolio: summary.drug > 0 && summary.device > 0,
    summary,
  };
}

export function formatAuditReport<T>(report: StudyTypeAuditReport<T>, lang: "it" | "en" = "it"): string {
  const it = lang === "it";
  const lines: string[] = [];
  lines.push(it ? `Audit tipi studio (${report.total} titoli)` : `Study type audit (${report.total} tickers)`);
  lines.push(
    it
      ? `Drug: ${report.summary.drug} · Device: ${report.summary.device} · Uncertain: ${report.summary.uncertain}`
      : `Drug: ${report.summary.drug} · Device: ${report.summary.device} · Uncertain: ${report.summary.uncertain}`,
  );
  lines.push(
    report.hasMixedPortfolio
      ? it
        ? "⚠ Portfolio misto farmaci + dispositivi"
        : "⚠ Mixed drug + device portfolio"
      : it
        ? "Portfolio omogeneo (solo drug, solo device, o solo uncertain)"
        : "Homogeneous portfolio (drug-only, device-only, or uncertain-only)",
  );

  if (report.needsReview.length) {
    lines.push("");
    lines.push(it ? "Da rivedere:" : "Needs review:");
    for (const row of report.needsReview) {
      const c = row.classification;
      lines.push(
        `  ${row.ticker.padEnd(6)} ${c.klass}/${c.confidence} (drug ${c.drugScore}, device ${c.deviceScore}) — ${row.reviewReason ?? reviewReason(row)}`,
      );
    }
  }

  return lines.join("\n");
}
