import type { ClinicalPreCdRecord, ClinicalPublicationEvent } from "./api";
import type { MobileDashboardAiFeedRow } from "./dashboardTypes";
import { resolveEventEis } from "./eis/eventImpactScore";
import { isClinicalPreCdRecordTrusted, trustedRecordEvents } from "./eis/referenceVerification";
import type { InvestSimInputs, SheetTable } from "./types";

function eventDateMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function isSecK8(ev: ClinicalPublicationEvent): boolean {
  return String(ev.source_type ?? "").toLowerCase() === "sec_8k";
}

function includeInFeed(item: MobileDashboardAiFeedRow, now: number): boolean {
  const ms = eventDateMs(item.eventDate);
  if (String(item.id).includes("cd_milestone") || ms > now) {
    const impact = Math.abs(item.eis ?? 0);
    return impact >= 0.5 || item.delta1d != null;
  }
  return true;
}

function feedRank(item: MobileDashboardAiFeedRow, now: number, past30: number): number {
  const ms = eventDateMs(item.eventDate);
  const isPast = ms <= now;
  const isRecentPast = isPast && ms >= past30;
  let rank = 0;
  if (isRecentPast) rank += 10_000;
  else if (isPast) rank += 5_000;
  rank += Math.abs(item.eis ?? 0) * 100;
  if (item.delta1d != null) rank += Math.abs(item.delta1d) * 10;
  rank += isPast ? ms / 1e10 : -ms / 1e10;
  return rank;
}

export function buildMobileAiFeedFromClinical(
  records: ClinicalPreCdRecord[],
  sheet: SheetTable | null,
  inputs: InvestSimInputs,
  limit = 10,
): { feed: MobileDashboardAiFeedRow[]; recentCount: number } {
  const scopeTickers = new Set<string>();
  for (const r of sheet?.rows ?? []) {
    const tk = String(r.Ticker ?? "")
      .trim()
      .toUpperCase();
    if (tk && !tk.includes("TOTALE")) scopeTickers.add(tk);
  }

  const out: MobileDashboardAiFeedRow[] = [];
  for (const rec of records) {
    const ticker = String(rec.ticker ?? "")
      .trim()
      .toUpperCase();
    if (!ticker || !scopeTickers.has(ticker)) continue;
    if (!isClinicalPreCdRecordTrusted(rec)) continue;

    for (const ev of trustedRecordEvents(rec)) {
      if (isSecK8(ev)) continue;
      const ms = eventDateMs(ev.event_date);
      if (!ms) continue;
      const indicators = ev.indicators?.length ? ev.indicators : rec.clinical_indicators;
      const resolved = resolveEventEis(ev, indicators);
      const delta1dRaw = ev.price?.delta_p_1d ?? resolved?.delta_p_1d ?? null;
      const delta1d =
        delta1dRaw != null && Number.isFinite(delta1dRaw) ? delta1dRaw : null;
      const eis =
        resolved?.score != null && Number.isFinite(resolved.score) ? resolved.score : null;

      out.push({
        id: `${ticker}_${ev.event_date}_${ev.event_title ?? ""}`,
        ticker,
        eventDate: String(ev.event_date ?? ""),
        title: String(ev.event_title ?? "—"),
        delta1d,
        eis,
        verified: Boolean(ev.link?.trim()),
      });
    }
  }

  const now = Date.now();
  const past30 = now - 30 * 86400000;
  const ranked = [...out]
    .filter((item) => includeInFeed(item, now))
    .sort((a, b) => feedRank(b, now, past30) - feedRank(a, now, past30))
    .slice(0, limit);

  const recentCount = out.filter((r) => {
    const ms = eventDateMs(r.eventDate);
    return ms >= past30 && ms <= now && includeInFeed(r, now);
  }).length;

  return { feed: ranked, recentCount };
}
