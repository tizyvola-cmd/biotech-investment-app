/**
 * Popup dopo refresh schedulato feed clinico / EIS (Lun–Ven 10:00).
 */

import { fetchClinicalFeedRefreshReport, ackClinicalFeedRefreshReport } from "../api/supernova";
import type { TranslationKey } from "../shared/i18n";
import type { PortfolioRefreshAlert } from "./portfolioRefreshAlerts";

const ACK_KEY = "supernova_clinical_feed_refresh_ack_v1";

export type ClinicalFeedRefreshReport = {
  finished_at?: string;
  report_id?: string;
  run_type?: string;
  success?: boolean;
  change_count?: number;
  changes?: Array<{
    kind?: string;
    ticker?: string;
    cd?: string;
    headline?: string;
    ai_summary?: string;
    source_link?: string;
    source_link_label?: string;
    eis_event_count?: number;
    top_eis?: number | null;
    ai_ok?: boolean;
  }>;
  stats?: {
    ai_label?: string;
    ai_active?: string;
  };
};

export type ClinicalFeedRefreshModalCopy = {
  titleKey: TranslationKey;
  subtitleKey: TranslationKey;
};

export const CLINICAL_FEED_REFRESH_COPY: ClinicalFeedRefreshModalCopy = {
  titleKey: "clinicalFeedRefresh.modal.title",
  subtitleKey: "clinicalFeedRefresh.modal.subtitle",
};

function loadLocalAck(): string {
  try {
    const raw = localStorage.getItem(ACK_KEY);
    if (!raw) return "";
    const doc = JSON.parse(raw) as { reportId?: string };
    return String(doc.reportId ?? "");
  } catch {
    return "";
  }
}

function saveLocalAck(reportId: string): void {
  localStorage.setItem(
    ACK_KEY,
    JSON.stringify({ reportId, shownAt: new Date().toISOString() }),
  );
}

function feedSummaryText(
  ch: NonNullable<ClinicalFeedRefreshReport["changes"]>[number],
  lang: "it" | "en",
): string {
  const ai = String(ch.ai_summary ?? "").trim();
  const headline = String(ch.headline ?? "").trim();
  if (ai) return ai;
  if (headline) return headline;
  const n = ch.eis_event_count ?? 0;
  return lang === "it"
    ? `${n} eventi EIS nel feed pre-CD`
    : `${n} pre-CD EIS-scored feed events`;
}

export function buildClinicalFeedModalSummary(
  report: ClinicalFeedRefreshReport,
  lang: "it" | "en",
): string {
  const n = report.change_count ?? report.changes?.length ?? 0;
  const ai = String(report.stats?.ai_label ?? "").trim();
  if (lang === "it") {
    return `${n} ticker aggiornati nel feed clinico${ai ? ` · ${ai}` : ""}.`;
  }
  return `${n} tickers updated in the clinical feed${ai ? ` · ${ai}` : ""}.`;
}

export function buildClinicalFeedRefreshAlerts(
  report: ClinicalFeedRefreshReport,
  lang: "it" | "en" = "en",
): PortfolioRefreshAlert[] {
  const changes = report.changes ?? [];
  if (!changes.length) return [];

  const alerts: PortfolioRefreshAlert[] = [];
  const seen = new Set<string>();

  for (const ch of changes.slice(0, 12)) {
    const ticker = String(ch.ticker ?? "").trim().toUpperCase();
    const cd = String(ch.cd ?? "").trim();
    if (!ticker) continue;
    const id = `clinical_feed_${ticker}_${cd}_${ch.kind ?? "upd"}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const isNew = ch.kind === "new";
    const summary = feedSummaryText(ch, lang);
    const sourceLink = String(ch.source_link ?? "").trim();
    alerts.push({
      id,
      severity: isNew ? "warning" : "info",
      category: "clinical_feed",
      ticker,
      cd: cd || "—",
      titleKey: isNew
        ? "clinicalFeedRefresh.alert.new.title"
        : "clinicalFeedRefresh.alert.updated.title",
      titleVars: { ticker },
      detailKey: isNew
        ? "clinicalFeedRefresh.alert.new.detail"
        : "clinicalFeedRefresh.alert.updated.detail",
      detailVars: {
        ticker,
        cd,
        eisCount: String(ch.eis_event_count ?? 0),
        topEis:
          ch.top_eis != null && Number.isFinite(ch.top_eis)
            ? ch.top_eis.toFixed(1)
            : "—",
      },
      feedSummary: summary,
      clinicalFeedTicker: ticker,
      linkUrl: sourceLink.startsWith("http") ? sourceLink : undefined,
      linkLabel: String(ch.source_link_label ?? "").trim() || undefined,
    });
  }

  if (changes.length > 12) {
    alerts.push({
      id: "clinical_feed_more",
      severity: "info",
      category: "clinical_feed",
      ticker: "—",
      cd: "—",
      titleKey: "clinicalFeedRefresh.alert.more.title",
      detailKey: "clinicalFeedRefresh.alert.more.detail",
      detailVars: { n: String(changes.length - 12) },
    });
  }

  return alerts;
}

export async function checkClinicalFeedRefreshPopup(
  lang: "it" | "en" = "en",
): Promise<{
  show: boolean;
  report: ClinicalFeedRefreshReport | null;
  alerts: PortfolioRefreshAlert[];
  modalSummary: string | null;
}> {
  try {
    const res = await fetchClinicalFeedRefreshReport();
    const report = (res.report ?? null) as ClinicalFeedRefreshReport | null;
    if (!report?.success || !res.should_show) {
      return { show: false, report: null, alerts: [], modalSummary: null };
    }
    const rid = String(report.report_id ?? report.finished_at ?? "");
    if (rid && loadLocalAck() === rid) {
      return { show: false, report, alerts: [], modalSummary: null };
    }
    const alerts = buildClinicalFeedRefreshAlerts(report, lang);
    if (!alerts.length) {
      return { show: false, report, alerts: [], modalSummary: null };
    }
    return {
      show: true,
      report,
      alerts,
      modalSummary: buildClinicalFeedModalSummary(report, lang),
    };
  } catch {
    return { show: false, report: null, alerts: [], modalSummary: null };
  }
}

export async function acknowledgeClinicalFeedRefresh(
  report: ClinicalFeedRefreshReport | null,
): Promise<void> {
  const rid = String(report?.report_id ?? report?.finished_at ?? "");
  if (rid) {
    saveLocalAck(rid);
    try {
      await ackClinicalFeedRefreshReport(rid);
    } catch {
      /* server ack best-effort */
    }
  }
}
