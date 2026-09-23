/**
 * Keep CD study-outcome boxes on the completing product — not the whole company pipeline.
 */
import type { ClinicalPreCdRecord, GuidanceCalendarEvent } from "../api/supernova";
import { usableProductName } from "./simRowClinicalMeta";
import { resolveTickerPipeline } from "./tickerAssetTagging";
import { normalizeCompletionDateForKey } from "./investSimKeys";

function clean(raw: unknown): string | null {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (/^(n\/d|nd|none|null|unknown|—|-)$/i.test(s)) return null;
  return s;
}

function isNoiseToken(token: string): boolean {
  return /^(placebo|vehicle|sham|control|saline|standard\s+of\s+care|soc|best\s+supportive\s+care|bsc|no\s+intervention|observation|usual\s+care|drug|study|trial|combination|plus|with|and|the|for|in|of)$/i.test(
    token,
  );
}

function pushToken(out: Set<string>, raw: string | null | undefined) {
  const usable = usableProductName(raw);
  if (!usable) return;
  const stripped = usable.replace(/\([^)]*\)/g, " ");
  for (const part of stripped.split(/[,;|/+/]+/)) {
    const tok = part.replace(/\s+/g, " ").trim();
    if (tok.length < 4 || isNoiseToken(tok)) continue;
    out.add(tok.toLowerCase());
    const first = tok.split(/\s+/)[0] ?? "";
    if (first.length >= 5 && !isNoiseToken(first)) out.add(first.toLowerCase());
  }
}

export function productLinkTokensFromRecord(
  rec: ClinicalPreCdRecord | null | undefined,
  extraNames: Array<string | null | undefined> = [],
): string[] {
  const out = new Set<string>();
  for (const name of extraNames) pushToken(out, name);
  // Named product from the CD — do not merge another record's drug (e.g. natalizumab
  // from the oldest ticker study when the CD is litifilimab).
  if (extraNames.some((n) => Boolean(usableProductName(n)))) {
    return [...out];
  }
  if (!rec) return [...out];
  pushToken(out, rec.ai?.study_clinical_profile?.product_name);
  pushToken(out, rec.meta?.interventions);
  for (const ev of rec.clinical_events ?? []) {
    pushToken(out, ev.drug);
    pushToken(out, ev.asset);
  }
  for (const tok of rec.publication_context?.drug_tokens_searched ?? []) {
    pushToken(out, tok);
  }
  return [...out];
}

export function clinicalRecordProductBlob(rec: ClinicalPreCdRecord): string {
  const bits: string[] = [
    rec.meta?.brief_title ?? "",
    rec.meta?.interventions ?? "",
    rec.ai?.study_clinical_profile?.product_name ?? "",
    rec.ai?.executive_summary ?? "",
  ];
  for (const ev of rec.clinical_events ?? []) {
    bits.push(ev.drug ?? "", ev.asset ?? "", ev.event_title ?? "");
  }
  for (const tok of rec.publication_context?.drug_tokens_searched ?? []) {
    bits.push(tok);
  }
  return bits.join(" ").toLowerCase();
}

export function blobMentionsProduct(
  blob: string,
  productName: string,
  aliases: Array<string | null | undefined> = [],
): boolean {
  const hay = (blob || "").toLowerCase();
  const compactHay = hay.replace(/[^a-z0-9]/g, "");
  const needles = [productName, ...aliases]
    .map((s) => String(s || "").trim().toLowerCase())
    .filter((s) => s.length >= 4);
  for (const n of needles) {
    if (hay.includes(n)) return true;
    const compact = n.replace(/[^a-z0-9]/g, "");
    if (compact.length >= 5 && compactHay.includes(compact)) return true;
  }
  return false;
}

export type PipelineProductGroup = {
  name: string;
  key: string;
  nctId: string | null;
  isCompletingCd: boolean;
};

const MAX_PIPELINE_PRODUCTS = 12;

/** Best guidance row for a ticker CD day (calendar / interest enroll). */
export function findGuidanceEventForCd(
  ticker: string,
  cdIso: string | null | undefined,
  events: GuidanceCalendarEvent[] | null | undefined,
): GuidanceCalendarEvent | null {
  const tk = (ticker || "").trim().toUpperCase();
  const day = normalizeCompletionDateForKey(cdIso);
  if (!tk || !day || day === "—") return null;
  const pool = (events ?? []).filter((ev) => clean(ev.ticker)?.toUpperCase() === tk);
  const onDay = pool.filter((ev) => {
    const anchors = [
      normalizeCompletionDateForKey(ev.sim_cd_date),
      normalizeCompletionDateForKey(ev.window_start),
      normalizeCompletionDateForKey(ev.window_end),
    ].filter((d): d is string => Boolean(d && d !== "—"));
    return anchors.includes(day);
  });
  if (!onDay.length) return null;
  const preferCd = onDay.find((ev) => String(ev.event_type || "").toLowerCase() === "cd");
  const withAsset = onDay.find((ev) => Boolean(usableProductName(ev.asset_name)));
  return preferCd ?? withAsset ?? onDay[0] ?? null;
}

export function nctFromGuidanceEvent(ev: GuidanceCalendarEvent | null | undefined): string | null {
  if (!ev) return null;
  const direct = String((ev as { nct_id?: string }).nct_id || "").trim().toUpperCase();
  if (/^NCT\d{8}$/.test(direct)) return direct;
  const blob = [ev.timing_quote, ev.asset_name, ev.indication].filter(Boolean).join(" ");
  const m = blob.match(/\bNCT\d{8}\b/i);
  return m ? m[0]!.toUpperCase() : null;
}

/**
 * One group per pipeline asset (from ticker map, clinical feed, or guidance calendar).
 * Completing CD product is first.
 */
export function collectTickerPipelineProducts(
  records: ClinicalPreCdRecord[] | null | undefined,
  opts: {
    ticker: string;
    primaryNctId?: string | null;
    completingProduct?: string | null;
    /** When clinical feed is thin (interest enroll), seed products from calendar assets. */
    guidanceEvents?: GuidanceCalendarEvent[] | null;
    cdIso?: string | null;
  },
): PipelineProductGroup[] {
  const tk = (opts.ticker || "").trim().toUpperCase();
  const primary = clean(opts.primaryNctId)?.toUpperCase() ?? "";
  const completing = usableProductName(opts.completingProduct);
  const completingKey = completing.toLowerCase().replace(/[^a-z0-9]+/g, "");

  const byKey = new Map<string, PipelineProductGroup>();
  const add = (name: string, nctId?: string | null, forceCd = false) => {
    const usable = usableProductName(name);
    if (!usable || usable.length < 4) return;
    if (/^nct\d+/i.test(usable)) return;
    const key = usable.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 48);
    if (key.length < 4) return;
    const existing = byKey.get(key);
    const isCd = forceCd || (completingKey.length >= 4 && key === completingKey);
    if (existing) {
      if (isCd) {
        existing.isCompletingCd = true;
        if (completing && usableProductName(completing)) existing.name = usableProductName(completing);
      }
      if (nctId && !existing.nctId) existing.nctId = nctId;
      return;
    }
    byKey.set(key, {
      name: isCd && completing && usableProductName(completing) ? usableProductName(completing) : usable,
      key,
      nctId: nctId ? nctId.toUpperCase() : null,
      isCompletingCd: Boolean(isCd),
    });
  };

  const pipe = resolveTickerPipeline(tk, {
    records,
    cdAssetIdHint: completing || null,
  });
  for (const rec of records ?? []) {
    if (clean(rec.ticker)?.toUpperCase() !== tk) continue;
    const fromAi = usableProductName(rec.ai?.study_clinical_profile?.product_name);
    const nct = clean(rec.nct_id)?.toUpperCase() ?? "";
    if (fromAi) add(fromAi, nct || null, Boolean(primary && nct === primary));
  }
  for (const p of pipe.programs) {
    add(p.name, p.nctId || null, Boolean(p.isCdAsset));
  }

  const guidHit = findGuidanceEventForCd(tk, opts.cdIso, opts.guidanceEvents);
  const guidNct = nctFromGuidanceEvent(guidHit) || primary || null;
  if (guidHit) {
    const asset = usableProductName(guidHit.asset_name);
    if (asset) add(asset, guidNct, true);
  }
  for (const ev of opts.guidanceEvents ?? []) {
    if (clean(ev.ticker)?.toUpperCase() !== tk) continue;
    const asset = usableProductName(ev.asset_name);
    if (!asset) continue;
    add(asset, nctFromGuidanceEvent(ev), false);
  }

  if (completing) add(completing, guidNct || primary || null, true);

  // Completing CD with NCT but no usable product name: still mount one card
  // keyed by the study so CT.gov loads — label is never the NCT itself.
  if (!byKey.size) {
    const nct = (primary || guidNct || "").toUpperCase();
    if (/^NCT\d{8}$/.test(nct)) {
      byKey.set(`nct:${nct}`, {
        name: "CD study",
        key: `nct:${nct}`,
        nctId: nct,
        isCompletingCd: true,
      });
    }
  }

  const list = [...byKey.values()];
  list.sort((a, b) => {
    if (a.isCompletingCd !== b.isCompletingCd) return a.isCompletingCd ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return list.slice(0, MAX_PIPELINE_PRODUCTS);
}

export function clinicalRecordMatchesProduct(
  rec: ClinicalPreCdRecord,
  tokens: string[],
  primaryNctId?: string | null,
): boolean {
  const nct = clean(rec.nct_id)?.toUpperCase() ?? "";
  const primary = clean(primaryNctId)?.toUpperCase() ?? "";
  if (!tokens.length) return Boolean(primary && nct === primary);
  const blob = clinicalRecordProductBlob(rec);
  const hit = blob.trim()
    ? tokens.some((tok) => tok.length >= 4 && blob.includes(tok))
    : false;
  if (hit) return true;
  // Completing NCT with an empty blob can still be the CD study being filled.
  if (primary && nct === primary && !blob.trim()) return true;
  return false;
}
