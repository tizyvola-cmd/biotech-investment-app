/**
 * Decision-desk Silent money column — headline + original filing link.
 * Display only. Does not change deriveSuggestedAction / Soft BUY-SELL.
 */
import type { ClinicalPreCdRecord, SdsRow } from "../api/supernova";

export type SmartMoneyKind =
  | "form4"
  | "13d"
  | "13f"
  | "call_skew"
  | "short_cover"
  | "ceo_appointed"
  | "cmo_appointed"
  | "officer_appointed"
  | "cdmo";

export type SmartMoneyEvent = {
  kind: SmartMoneyKind | string;
  label: string;
  date?: string | null;
  detail?: string | null;
  rank?: number;
  href?: string | null;
  href_label?: string | null;
  /** Person or fund name when the filing states one. */
  who?: string | null;
};

export type SmartMoneyRow = {
  ticker: string;
  event?: SmartMoneyEvent | null;
  traces?: SmartMoneyEvent[];
  form4?: {
    cluster?: boolean;
    lead_role?: string | null;
    event_date?: string | null;
    buy_count?: number;
    status?: string | null;
  };
};

export function formatSmartMoneyDate(iso: string | null | undefined): string {
  const s = String(iso ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return "";
  return `${m[3]}/${m[2]}`;
}

export function edgarBrowseUrl(ticker: string, form: string): string {
  const tk = encodeURIComponent(ticker.trim().toUpperCase());
  const f = encodeURIComponent(form);
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&ticker=${tk}&type=${f}&owner=include&count=10`;
}

export function formatSilentMoneyTitle(
  ev: SmartMoneyEvent | null | undefined,
  it: boolean,
): string {
  if (!ev) return "";
  const kind = String(ev.kind ?? "");
  const raw = String(ev.label ?? "").trim();
  if (kind === "form4") {
    if (/CMO/i.test(raw)) {
      return /cluster/i.test(raw)
        ? it
          ? "CMO: cluster di acquisti"
          : "CMO cluster bought shares"
        : it
          ? "CMO ha acquistato azioni"
          : "CMO bought shares";
    }
    if (/CEO/i.test(raw)) {
      return /cluster/i.test(raw)
        ? it
          ? "CEO: cluster di acquisti"
          : "CEO cluster bought shares"
        : it
          ? "CEO ha acquistato azioni"
          : "CEO bought shares";
    }
    return it ? "Insider hanno acquistato azioni" : "Insiders bought shares";
  }
  if (kind === "13d") {
    return /amend/i.test(raw)
      ? it
        ? "13D aggiornato (ownership)"
        : "13D amended"
      : it
        ? "Nuovo 13D (ownership >5%)"
        : "New 13D beneficial owner";
  }
  if (kind === "13f") {
    const fund = raw.replace(/\s+accumulated$/i, "").trim();
    if (fund && !/^specialist/i.test(fund) && !/^13f/i.test(fund)) {
      return it ? `${fund} ha accumulato` : `${fund} accumulated`;
    }
    return it ? "Fondi specialist hanno accumulato" : "Specialist funds accumulated";
  }
  if (kind === "call_skew") {
    return it ? "Call in aumento pre-evento" : "Call interest rising into event";
  }
  if (kind === "short_cover") {
    return it ? "Short in covering" : "Shorts covering";
  }
  if (kind === "ceo_appointed") {
    if (ev.who) {
      return it ? `${ev.who} nominato CEO` : `${ev.who} appointed CEO`;
    }
    return it ? "Nuovo CEO nominato" : "New CEO appointed";
  }
  if (kind === "cmo_appointed") {
    if (ev.who) {
      return it ? `${ev.who} nominato CMO` : `${ev.who} appointed CMO`;
    }
    return it ? "Nuovo CMO nominato" : "New CMO appointed";
  }
  if (kind === "officer_appointed") {
    if (ev.who) {
      return /left|uscita|lasciat/i.test(raw)
        ? it
          ? `${ev.who} ha lasciato`
          : `${ev.who} left`
        : it
          ? `${ev.who} nominato dirigente`
          : `${ev.who} appointed`;
    }
    return /left|uscita|lasciat/i.test(raw)
      ? it
        ? "Un dirigente ha lasciato"
        : "An officer left"
      : it
        ? "Nuovo dirigente nominato"
        : "New officer appointed";
  }
  if (kind === "cdmo") {
    return it ? "Nuovo CDMO" : "New CDMO";
  }
  return raw;
}

export function formatSmartMoneyCell(
  ev: SmartMoneyEvent | null | undefined,
  it = false,
): { label: string; date: string; tone: "up" | "none"; href: string; hrefLabel: string } {
  if (!ev?.label && !ev?.kind) {
    return { label: "—", date: "", tone: "none", href: "", hrefLabel: "" };
  }
  const date = formatSmartMoneyDate(ev.date) || (ev.detail ?? "");
  return {
    label: formatSilentMoneyTitle(ev, it) || ev.label || "—",
    date,
    tone: "up",
    href: ev.href?.trim() || "",
    hrefLabel: ev.href_label?.trim() || (ev.href ? "SEC" : ""),
  };
}

export function smartMoneyFromSds(
  row: SdsRow | null | undefined,
  ticker = "",
): SmartMoneyEvent | null {
  const tk = ticker || String(row?.ticker ?? "").trim().toUpperCase();
  const inst = row?.cluster_b?.institutional_delta;
  const short = row?.cluster_b?.short_interest;
  const delta = inst?.delta_pct;
  const premium = inst?.premium_fund_present === true;
  const funds = inst?.premium_funds ?? [];
  const fund = funds.length
    ? String(funds[0]).split(",")[0].trim().split(/\s+/).slice(0, 2).join(" ")
    : "";
  const instOk =
    premium || (delta != null && Number.isFinite(delta) && delta > 0) || (inst?.score ?? 0) > 0;
  if (instOk) {
    return {
      kind: "13f",
      label: fund ? `${fund} accumulated` : "Specialist funds accumulated",
      date: inst?.latest_quarter ?? null,
      detail: delta != null && Number.isFinite(delta) ? `${delta > 0 ? "+" : ""}${Math.round(delta)}%` : null,
      rank: premium ? 80 : 65,
      href: tk ? edgarBrowseUrl(tk, "13F-HR") : null,
      href_label: "SEC",
    };
  }
  const dtc = short?.days_to_cover;
  const squeeze =
    short?.squeeze_setup === true || (dtc != null && Number.isFinite(dtc) && dtc >= 5);
  if (squeeze) {
    return {
      kind: "short_cover",
      label: "Shorts covering",
      date: null,
      detail: dtc != null && Number.isFinite(dtc) ? `DTC ${Math.round(dtc)}g` : null,
      rank: 55,
      href: "https://www.finra.org/finra-data/browse-catalog/equity-short-interest/current",
      href_label: "FINRA",
    };
  }
  return null;
}

const APPOINT_RE =
  /\b(appoint(?:ed|s)?|names?|nominat|new)\b[\s\S]{0,48}\b(ceo|cmo|cfo|coo|chief (?:executive|medical|financial|operating)|director|officer)\b/i;
const CDMO_RE =
  /\b(cdmo|contract (?:develop(?:ment)?|manufactur(?:er|ing))|lonza|catalent|wu?xi|samsung biologics|patheon|thermo fisher|fujifilm diosynth)\b/i;
const GENERIC_8K_TITLE =
  /^(officer\/?director departure or appointment|uscita\/?nomina dirigente|item\s*5\.02)\b/i;
const ROLE_WORDS =
  /Chief|Executive|Medical|Financial|Operating|Officer|Director|President|Chairman|Board|Company|Corporation|Inc|Ltd|New|Appointment|Departure/i;
const PERSON_NAME =
  /(?:Dr\.?\s+|Mr\.?\s+|Ms\.?\s+|Mrs\.?\s+)?([A-Z][a-z]+(?:\s+(?:[A-Z]\.\s+)?[A-Z][a-z]+){1,3})/;

export function isGenericSecItemTitle(raw: string | null | undefined): boolean {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim();
  return !s || GENERIC_8K_TITLE.test(s);
}

export function parseOfficerWho(blob: string): string | null {
  const text = String(blob ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const patterns = [
    new RegExp(
      `(?:appoint(?:s|ed)|names?|nominat(?:es|ed)|hires?)\\s+${PERSON_NAME.source}\\s+as`,
      "i",
    ),
    new RegExp(
      `${PERSON_NAME.source}\\s+(?:has been\\s+)?(?:appointed|named|hired)\\s+as`,
      "i",
    ),
    new RegExp(
      `(?:departure|resignation|retirement)\\s+of\\s+${PERSON_NAME.source}`,
      "i",
    ),
    new RegExp(
      `${PERSON_NAME.source}\\s+(?:has\\s+)?(?:resigned|retired|departed|steps down|stepped down)`,
      "i",
    ),
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    const name = m?.[1]?.replace(/\s+/g, " ").trim();
    if (name && !ROLE_WORDS.test(name) && name.split(" ").length >= 2) return name;
  }
  return null;
}

export function officerAction(blob: string): "appointed" | "left" | "changed" {
  const t = blob.toLowerCase();
  const left = /\b(resign|retir|depart|steps? down|left|departure)\b/i.test(t);
  const joined = /\b(appoint|name[ds]?|nominat|hire[ds]?|join)\b/i.test(t);
  if (left && !joined) return "left";
  if (joined && !left) return "appointed";
  return "changed";
}

function isoFromClinical(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** 8-K appointments / CDMO deals already on the clinical feed — headline + filing link. */
export function silentCorporateFromClinical(
  records: ClinicalPreCdRecord[] | null | undefined,
  ticker: string,
  today = new Date(),
): SmartMoneyEvent | null {
  const tk = ticker.trim().toUpperCase();
  if (!tk) return null;
  const todayIso = today.toISOString().slice(0, 10);
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - 180);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  let best: SmartMoneyEvent | null = null;
  for (const rec of records ?? []) {
    if (String(rec.ticker ?? "").trim().toUpperCase() !== tk) continue;
    const events = [...(rec.clinical_events ?? []), ...(rec.timeline_events ?? [])];
    for (const ev of events) {
      const title = String(ev.event_title ?? "").replace(/\s+/g, " ").trim();
      const summary = String(ev.summary ?? ev.impact_note ?? "")
        .replace(/\s+/g, " ")
        .trim();
      const blob = `${title} ${summary} ${ev.items_raw ?? ""}`;
      const date =
        isoFromClinical(ev.event_date) || isoFromClinical(ev.expected_window_start);
      if (date && (date < cutoffIso || date > todayIso)) continue;
      const href = String(ev.link ?? "").trim() || null;
      const items = String(ev.items_raw ?? "");
      const appoint = /\b5\.02\b/.test(items) || APPOINT_RE.test(blob);
      const cdmo = CDMO_RE.test(blob);
      if (!appoint && !cdmo) continue;
      const who = parseOfficerWho(`${title} ${summary}`);
      const action = officerAction(blob);
      let kind: SmartMoneyKind = "officer_appointed";
      let label = "New officer appointed";
      let rank = 86;
      if (cdmo && !appoint) {
        kind = "cdmo";
        label = "New CDMO";
        rank = 76;
      } else if (/\bceo|chief executive\b/i.test(blob)) {
        kind = action === "left" ? "officer_appointed" : "ceo_appointed";
        label =
          action === "left"
            ? "CEO left"
            : "New CEO appointed";
        rank = 88;
      } else if (/\bcmo|chief medical\b/i.test(blob)) {
        kind = action === "left" ? "officer_appointed" : "cmo_appointed";
        label =
          action === "left"
            ? "CMO left"
            : "New CMO appointed";
        rank = 87;
      } else if (action === "left") {
        label = "Officer left";
      }
      if (who) {
        label =
          action === "left"
            ? `${who} left`
            : `${who} appointed`;
        rank += 8;
      }
      const excerpt = [!isGenericSecItemTitle(title) ? title : "", summary]
        .filter(Boolean)
        .join(" — ");
      const cand: SmartMoneyEvent = {
        kind,
        label,
        date,
        detail: excerpt || null,
        who,
        rank,
        href,
        href_label: href ? "8-K" : null,
      };
      const bestScore = (best?.rank ?? 0) + (best?.who ? 10 : 0);
      const candScore = (cand.rank ?? 0) + (who ? 10 : 0);
      if (!best || candScore > bestScore) best = cand;
    }
  }
  return best;
}

function inferredRank(ev: SmartMoneyEvent): number {
  if (ev.rank != null && Number.isFinite(ev.rank)) return ev.rank;
  const k = String(ev.kind ?? "");
  if (k === "form4") return 100;
  if (k === "13d") return 90;
  if (k === "ceo_appointed") return 88;
  if (k === "cmo_appointed") return 87;
  if (k === "officer_appointed") return 86;
  if (k === "13f") return 80;
  if (k === "cdmo") return 76;
  if (k === "call_skew") return 70;
  if (k === "short_cover") return 55;
  return 0;
}

export function resolveDeskSmartMoney(
  apiRow: SmartMoneyRow | null | undefined,
  sdsRow: SdsRow | null | undefined,
  corp?: SmartMoneyEvent | null,
): SmartMoneyEvent | null {
  const pool = [apiRow?.event, corp, smartMoneyFromSds(sdsRow, apiRow?.ticker || sdsRow?.ticker)]
    .filter((e): e is SmartMoneyEvent => Boolean(e?.label || e?.kind));
  if (!pool.length) return null;
  pool.sort((a, b) => inferredRank(b) - inferredRank(a));
  const top = pool[0]!;
  if (!top.href && apiRow?.ticker) {
    if (top.kind === "form4") {
      return { ...top, href: edgarBrowseUrl(apiRow.ticker, "4"), href_label: top.href_label || "SEC" };
    }
    if (top.kind === "13d") {
      return { ...top, href: edgarBrowseUrl(apiRow.ticker, "SC 13D"), href_label: top.href_label || "SEC" };
    }
  }
  return top;
}

export function formatSmartMoneyTooltip(
  traces: SmartMoneyEvent[] | null | undefined,
  primary: SmartMoneyEvent | null | undefined,
  it: boolean,
): string {
  const list = (traces?.length ? traces : primary?.label || primary?.kind ? [primary!] : []).filter(
    (t) => t?.label || t?.kind,
  );
  if (!list.length) {
    return it
      ? "Nessun tell di denaro silenzioso. Non è Soft BUY/SELL."
      : "No silent-money tell. Not Soft BUY/SELL.";
  }
  const parts = list.map((t) => {
    const title = formatSilentMoneyTitle(t, it);
    const d = formatSmartMoneyDate(t.date) || t.detail || "";
    return d ? `${title} · ${d}` : title;
  });
  const head = it
    ? "Denaro silenzioso (precede prezzo e Trends): "
    : "Silent money (ahead of price and Trends): ";
  const tail = it ? " Non è un ordine." : " Not an order.";
  return `${head}${parts.join(" · ")}.${tail}`;
}
