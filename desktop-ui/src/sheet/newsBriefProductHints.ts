/**
 * Prefer the *article* product / indication over the ticker's simulation
 * pipeline row. Multi-asset names (e.g. BIIB) otherwise show the wrong drug
 * when the headline is about a different franchise.
 */

import { usableProductName } from "./simRowClinicalMeta";

const TITLE_STOP = new Set([
  "journal",
  "original",
  "research",
  "american",
  "clinical",
  "trial",
  "efficacy",
  "safety",
  "phase",
  "study",
  "results",
  "weekly",
  "treatment",
  "approval",
  "approved",
  "wins",
  "biogen",
  "company",
  "press",
]);

/** Disease labels commonly named in biotech headlines. */
const TITLE_INDICATIONS: Array<{ label: string; re: RegExp }> = [
  { label: "Alzheimer's disease", re: /\balzheimer'?s?\b/i },
  { label: "Dravet syndrome", re: /\bdravet\b/i },
  { label: "Parkinson's disease", re: /\bparkinson'?s?\b/i },
  { label: "multiple sclerosis", re: /\bmultiple\s+sclerosis\b|\b\bms\b(?=\s+treatment)/i },
  { label: "SMA", re: /\bspinal\s+muscular\s+atrophy\b|\b\bsma\b/i },
  { label: "Molluscum contagiosum", re: /\bmolluscum(\s+contagiosum)?\b/i },
];

/** Brand / INN → labeled indication when the brief omits it. */
const KNOWN_PRODUCT_INDICATIONS: Array<{ re: RegExp; indication: string }> = [
  {
    re: /\b(zelsuvmi|berdazimer)\b/i,
    indication: "Molluscum contagiosum",
  },
  {
    re: /\bgalleri\b/i,
    indication:
      "Multi-cancer early detection (MCED) screening in adults 50+; Cancer Signal Origin when positive",
  },
];

/** Resolve indication from a known product name when brief/sim omit it. */
export function indicationFromKnownProduct(product: string | null | undefined): string | null {
  const blob = String(product || "").trim();
  if (!blob) return null;
  for (const row of KNOWN_PRODUCT_INDICATIONS) {
    if (row.re.test(blob)) return row.indication;
  }
  return null;
}

const BRAND_BLOCK = new Set([
  "FDA",
  "EMA",
  "NMPA",
  "MHRA",
  "PMDA",
  "PDUFA",
  "NASDAQ",
  "NYSE",
  "CEO",
  "USA",
  "BIIB",
  "PR",
  "LLC",
  "INC",
  "SHAREHOLDER",
  "ALERT",
  "ANNO",
  "ANNOUNCES",
  "INVESTIGATION",
  "INVESTORS",
  "INVESTOR",
  "GROSSMAN",
  "BRONSTEIN",
  "GEWIRTZ",
  "REVIEW",
  "NATIONAL",
  "CLASS",
  "ACTION",
  "SECURITIES",
  "LAWSUIT",
]);

export type NewsProductHints = {
  product: string | null;
  indication: string | null;
};

function titleTopicTokens(title: string): Set<string> {
  const out = new Set<string>();
  for (const w of title.match(/[A-Za-z]{5,}/g) || []) {
    const wl = w.toLowerCase();
    if (TITLE_STOP.has(wl)) continue;
    out.add(wl);
  }
  return out;
}

/** True when content shares enough topic tokens with the headline. */
export function contentMatchesNewsTitle(content: string, title: string): boolean {
  const tokens = titleTopicTokens(title);
  if (tokens.size < 2) return true;
  const low = (content || "").toLowerCase();
  let hits = 0;
  for (const t of tokens) {
    if (low.includes(t)) hits += 1;
  }
  // Disease tokens are high-signal (Alzheimer / Dravet / …) — one hit is enough.
  const diseaseHit = ["alzheimer", "dravet", "parkinson", "sclerosis"].some(
    (d) => tokens.has(d) && low.includes(d),
  );
  if (diseaseHit) return true;
  return hits >= Math.max(1, Math.min(2, Math.floor(tokens.size / 2)));
}

export function extractIndicationFromNewsTitle(title: string): string | null {
  const t = title || "";
  for (const row of TITLE_INDICATIONS) {
    if (row.re.test(t)) return row.label;
  }
  const m = t.match(
    /\bfor(?:\s+the)?\s+(?:treatment\s+of\s+)?([A-Za-z][A-Za-z0-9' /-]{3,40}?)(?=\s*[-–—]|$|\s+-\s)/i,
  );
  if (m) {
    const ind = m[1].replace(/\s+/g, " ").trim().replace(/\s+treatment$/i, "");
    if (ind.length >= 4 && !/\b(phase|press|nasdaq|china|home)\b/i.test(ind)) {
      return ind.slice(0, 80);
    }
  }
  return null;
}

/** Brand / drug token from the headline (LEQEMBI, lecanemab, …). */
export function extractProductFromNewsTitle(title: string): string | null {
  const t = title || "";
  const brand = t.match(/\b([A-Z]{4,}(?:[A-Z0-9-]{0,8})?)\b/g) || [];
  for (const b of brand) {
    if (BRAND_BLOCK.has(b)) continue;
    if (/^[A-Z]{1,5}$/.test(b) && b.length <= 5 && !/[aeiou]/i.test(b)) {
      // Likely ticker (BIIB) — skip short all-consonant tickers already blocked
    }
    if (b.length >= 5 && !BRAND_BLOCK.has(b)) {
      // Prefer trade-dress brands (mostly consonants + vowels, not pure tickers)
      if (!/^(BIIB|AMGN|MRNA|REGN|VRTX)$/.test(b)) return b;
    }
  }
  const inn = t.match(
    /\b([a-z][a-z0-9-]{5,}(?:umab|mab|ciclib|tinib|fenib|ersen|otide))\b/i,
  );
  if (inn) return inn[1];
  return null;
}

export function isShareholderAlertTitle(title: string): boolean {
  return /\bshareholder\s+alert\b|\bclass\s+action\b|\bsecurities\s+(?:class\s+action|investigation)\b/i.test(
    title || "",
  );
}

/**
 * Resolve product + indication for the news debrief.
 * Article/title win; sim pipeline is used only when it does not conflict.
 */
export function resolveNewsProductHints(opts: {
  title?: string | null;
  briefProduct?: string | null;
  briefIndication?: string | null;
  itemProduct?: string | null;
  simProduct?: string | null;
  simIndication?: string | null;
}): NewsProductHints {
  const title = (opts.title || "").trim();
  const titleProduct = isShareholderAlertTitle(title)
    ? null
    : extractProductFromNewsTitle(title);
  const titleInd = isShareholderAlertTitle(title)
    ? null
    : extractIndicationFromNewsTitle(title);

  let product =
    usableProductName(opts.briefProduct) ||
    usableProductName(opts.itemProduct) ||
    usableProductName(titleProduct) ||
    "";
  if (/^(SHAREHOLDER|ALERT|INVESTORS?|INVESTIGATION)$/i.test(product)) {
    product = "";
  }
  let indication =
    (opts.briefIndication || "").trim() || titleInd || "";

  if (isShareholderAlertTitle(title)) {
    // Law-firm solicitation is not a product story — show pipeline context.
    return {
      product: usableProductName(opts.simProduct) || null,
      indication: (opts.simIndication || "").trim() || null,
    };
  }

  const articleBlob = `${product} ${indication}`.trim();
  if (title && articleBlob && !contentMatchesNewsTitle(articleBlob, title)) {
    // Brief/item drifted to another franchise — reset to title signals.
    product = usableProductName(titleProduct) || "";
    indication = titleInd || "";
  }

  if (!product) {
    const simP = usableProductName(opts.simProduct) || "";
    const simI = (opts.simIndication || "").trim();
    const simBlob = `${simP} ${simI}`.trim();
    if (simP) {
      if (!title || !simBlob || contentMatchesNewsTitle(simBlob, title)) {
        product = simP;
      }
      // else: suppress sim product (wrong asset for this headline)
    }
  }

  if (!indication) {
    const simI = (opts.simIndication || "").trim();
    if (simI) {
      if (!title || contentMatchesNewsTitle(simI, title) || !product) {
        // Only use sim indication when it fits the headline, or we have no
        // article product conflict left to protect.
        if (!title || contentMatchesNewsTitle(`${product} ${simI}`, title)) {
          indication = simI;
        }
      }
    }
    if (!indication && titleInd) indication = titleInd;
  }

  if (!indication) {
    indication = indicationFromKnownProduct(product) || "";
  }

  return {
    product: product || null,
    indication: indication || null,
  };
}
