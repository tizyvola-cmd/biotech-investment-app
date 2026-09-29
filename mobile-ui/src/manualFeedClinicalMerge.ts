import type { ClinicalPreCdRecord, ClinicalPublicationEvent } from "./api";
import {
  buildManualEisByTicker,
  type ManualFeedEventDraft,
  type ManualFeedStoreFile,
} from "./manualFeedStore";

function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

function eisScoreForDraft(
  draft: ManualFeedEventDraft,
  store: ManualFeedStoreFile | null | undefined,
): number {
  const tk = normalizeTicker(draft.ticker);
  const fromMap = buildManualEisByTicker(store)[tk]?.score;
  if (fromMap != null && Number.isFinite(fromMap)) return fromMap;
  const move = draft.priceDropPct ?? draft.deltaP1d ?? null;
  const outcome = draft.investigationOutcome;
  if (outcome === "positive_catalyst") return Math.max(3, move != null && move > 0 ? Math.min(12, 4 + move * 0.4) : 5);
  if (outcome === "negative_catalyst") return Math.min(-3, move != null && move < 0 ? Math.max(-12, move * 0.5) : -5);
  if (draft.sentiment != null && Number.isFinite(draft.sentiment)) return draft.sentiment * 3;
  if (move != null && Number.isFinite(move)) return move >= 0 ? 2 : -2;
  return 0;
}

export function manualDraftToClinicalEvent(
  draft: ManualFeedEventDraft,
  store: ManualFeedStoreFile | null | undefined,
): ClinicalPublicationEvent {
  const score = eisScoreForDraft(draft, store);
  const d1 = draft.priceDropPct ?? draft.deltaP1d ?? null;
  const sentiment = draft.sentiment ?? (score > 0 ? 0.5 : score < 0 ? -0.5 : 0);
  return {
    event_date: draft.eventDate,
    event_title: draft.title?.trim() || draft.body.slice(0, 160) || draft.ticker,
    summary: draft.body,
    drug: null,
    source_type: "manual",
    event_type: "manual",
    link: draft.link ?? null,
    link_label: draft.source?.trim() || "Manual",
    sentiment,
    reference_verified: true,
    reference_match: "stored",
    price:
      d1 != null || draft.deltaP3d != null
        ? { delta_p_1d: d1, delta_p_3d: draft.deltaP3d ?? null }
        : undefined,
    eis: {
      score,
      delta_p_1d: d1,
      delta_p_3d: draft.deltaP3d ?? null,
      vol_ratio: 1,
      vol_term: 0,
      sentiment,
      sent_term: sentiment * 3,
      weights: { w1: 0.35, w2: 0.35, w3: 0.15, w4: 0.15 },
    },
    impact_note: `Manual feed · id:${draft.id} · ${draft.source || "Manual"}`,
  };
}

function cloneRecord(rec: ClinicalPreCdRecord): ClinicalPreCdRecord {
  return {
    ...rec,
    clinical_events: [...(rec.clinical_events ?? rec.timeline_events ?? [])],
    timeline_events: undefined,
  };
}

function syntheticManualRecord(ticker: string, event: ClinicalPublicationEvent): ClinicalPreCdRecord {
  return {
    ticker,
    company: ticker,
    nct_id: `MANUAL-${ticker}`,
    sponsor_match: "Exact",
    clinical_events: [event],
    meta: {
      brief_title: `Manual news feed · ${ticker}`,
      phase: "—",
      overall_status: "Manual",
    },
  };
}

function sameManualEvent(
  ev: ClinicalPublicationEvent,
  pub: ClinicalPublicationEvent,
  draftId: string,
): boolean {
  if (String(ev.source_type ?? "").toLowerCase() !== "manual") return false;
  const note = String(ev.impact_note ?? "");
  return (
    note.includes(draftId) ||
    (ev.event_date === pub.event_date && ev.event_title === pub.event_title)
  );
}

/** Merge manual feed store events into clinical snapshot records (mirrors desktop feed). */
export function mergeManualStoreIntoClinicalRecords(
  baseRecords: ClinicalPreCdRecord[],
  store: ManualFeedStoreFile | null | undefined,
): ClinicalPreCdRecord[] {
  const drafts = store?.events ?? [];
  if (!drafts.length) return baseRecords;

  const result = baseRecords.map(cloneRecord);
  const indexByTicker = new Map<string, number>();
  for (let i = 0; i < result.length; i += 1) {
    const tk = normalizeTicker(String(result[i]?.ticker ?? ""));
    if (tk && !indexByTicker.has(tk)) indexByTicker.set(tk, i);
  }

  for (const draft of drafts) {
    const tk = normalizeTicker(draft.ticker);
    if (!tk || !draft.eventDate) continue;
    const pub = manualDraftToClinicalEvent(draft, store);
    const idx = indexByTicker.get(tk);
    if (idx != null) {
      const rec = result[idx]!;
      const events = rec.clinical_events ?? [];
      if (!events.some((e) => sameManualEvent(e, pub, draft.id))) {
        rec.clinical_events = [...events, pub];
      }
    } else {
      result.push(syntheticManualRecord(tk, pub));
      indexByTicker.set(tk, result.length - 1);
    }
  }

  return result;
}
