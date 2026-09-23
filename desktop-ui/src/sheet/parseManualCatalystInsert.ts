/**
 * Free-text → Calendar / Simulation catalyst insert.
 * Extracts ticker, company, NCT, CD day. Display-only helper — not Soft BUY/SELL.
 */

export type ManualCatalystInsert = {
  ticker: string;
  company: string;
  nctId: string;
  cdIso: string;
  drug: string;
  phase: string;
  indication: string;
  raw: string;
};

const LABEL_RE =
  /^(TICKER|SYMBOL|COMPANY|SOCIET[AÀ]|NAME|NOME|NCT|NCT_ID|TRIAL|CD|COMPLETION|COMPLETION_DATE|DATE|DATA|DRUG|ASSET|PHASE|FASE|INDICATION|INDICAZIONE)\s*[:=]\s*(.+)$/i;

function normalizeIso(raw: string): string | null {
  const s = raw.trim();
  if (/^20\d{2}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dmy = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](20\d{2})$/.exec(s);
  if (dmy) {
    return `${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}`;
  }
  const mdy = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s+(20\d{2})$/i.exec(
    s,
  );
  if (mdy) {
    const months: Record<string, string> = {
      jan: "01",
      feb: "02",
      mar: "03",
      apr: "04",
      may: "05",
      jun: "06",
      jul: "07",
      aug: "08",
      sep: "09",
      oct: "10",
      nov: "11",
      dec: "12",
    };
    const mo = months[mdy[1]!.slice(0, 3).toLowerCase()];
    if (mo) return `${mdy[3]}-${mo}-${mdy[2]!.padStart(2, "0")}`;
  }
  // YYYY-MM → month end
  const ym = /^(20\d{2})-(\d{2})$/.exec(s);
  if (ym) {
    const y = Number(ym[1]);
    const m = Number(ym[2]);
    if (m >= 1 && m <= 12) {
      const end = m === 12 ? 31 : new Date(y, m, 0).getDate();
      return `${ym[1]}-${ym[2]}-${String(end).padStart(2, "0")}`;
    }
  }
  return null;
}

function looksLikeTicker(token: string): boolean {
  const t = token.trim().toUpperCase();
  return /^[A-Z]{1,5}$/.test(t) && t !== "NCT" && t !== "PHASE" && t !== "FDA";
}

/** Convert ISO → Simulation display CD ``DD/MM/YYYY``. */
export function isoToManualSimCd(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return iso.trim();
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * Parse free text / labeled block into a Calendar catalyst insert.
 * Returns null when ticker or CD cannot be resolved.
 */
export function parseManualCatalystInsert(raw: string): ManualCatalystInsert | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;

  const fields: Record<string, string> = {};
  const unlabeled: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = LABEL_RE.exec(trimmed);
    if (m) {
      const key = m[1]!
        .toUpperCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      const canon =
        key.startsWith("TICKER") || key === "SYMBOL"
          ? "TICKER"
          : key.startsWith("COMPANY") || key.startsWith("SOCIET") || key === "NAME" || key === "NOME"
            ? "COMPANY"
            : key.startsWith("NCT") || key === "TRIAL"
              ? "NCT"
              : key.startsWith("CD") ||
                  key.startsWith("COMPLETION") ||
                  key === "DATE" ||
                  key === "DATA"
                ? "CD"
                : key.startsWith("DRUG") || key === "ASSET"
                  ? "DRUG"
                  : key.startsWith("PHASE") || key === "FASE"
                    ? "PHASE"
                    : key.startsWith("INDIC")
                      ? "INDICATION"
                      : key;
      fields[canon] = m[2]!.trim();
    } else {
      unlabeled.push(trimmed);
    }
  }

  const blob = unlabeled.join("\n") || text;

  let nctId = (fields.NCT || "").trim().toUpperCase();
  if (!nctId) {
    const nct = /\b(NCT\d{8})\b/i.exec(blob);
    if (nct) nctId = nct[1]!.toUpperCase();
  } else if (!nctId.startsWith("NCT") && /^\d{8}$/.test(nctId)) {
    nctId = `NCT${nctId}`;
  }

  let cdIso = fields.CD ? normalizeIso(fields.CD) : null;
  if (!cdIso) {
    const isoHit = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(blob);
    if (isoHit) cdIso = isoHit[1]!;
  }
  if (!cdIso) {
    const dmyHit = /\b(\d{1,2}[\/.\-]\d{1,2}[\/.\-]20\d{2})\b/.exec(blob);
    if (dmyHit) cdIso = normalizeIso(dmyHit[1]!);
  }
  if (!cdIso) {
    const mdyHit =
      /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+20\d{2})\b/i.exec(
        blob,
      );
    if (mdyHit) cdIso = normalizeIso(mdyHit[1]!);
  }

  let ticker = (fields.TICKER || "").trim().toUpperCase().replace(/^\$/, "");
  if (!ticker) {
    const dollar = /\$([A-Z]{1,5})\b/.exec(blob.toUpperCase());
    if (dollar && looksLikeTicker(dollar[1]!)) ticker = dollar[1]!;
  }
  if (!ticker) {
    // Pipe / comma quick line: TICKER | COMPANY | NCT | CD
    const parts = blob.split(/[|]/).map((p) => p.trim()).filter(Boolean);
    if (parts[0] && looksLikeTicker(parts[0]!)) ticker = parts[0]!.toUpperCase();
  }
  if (!ticker) {
    const bare = /\b([A-Z]{2,5})\b/.exec(blob.toUpperCase());
    if (bare && looksLikeTicker(bare[1]!)) ticker = bare[1]!;
  }

  let company = (fields.COMPANY || "").trim();
  if (!company) {
    const parts = blob.split(/[|]/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2 && looksLikeTicker(parts[0]!)) {
      const cand = parts[1]!;
      if (!/^NCT\d{8}$/i.test(cand) && !normalizeIso(cand)) company = cand;
    }
  }
  if (!company) {
    const co =
      /\b([A-Z][A-Za-z0-9&.\-]*(?:\s+[A-Z][A-Za-z0-9&.\-]*){0,5}\s+(?:Inc\.?|Corp\.?|Corporation|Ltd\.?|Limited|PLC|N\.?V\.?|AG|Therapeutics|Pharma(?:ceuticals)?|Biosciences?|Biotech))\b/.exec(
        blob,
      );
    if (co) company = co[1]!.trim();
  }
  if (!company) company = ticker;

  const drug = (fields.DRUG || "").trim();
  const phase = (fields.PHASE || "").trim();
  const indication = (fields.INDICATION || "").trim();

  if (!ticker || !cdIso) return null;

  return {
    ticker,
    company: company || ticker,
    nctId: nctId || "",
    cdIso,
    drug,
    phase,
    indication,
    raw: text,
  };
}

export function manualCatalystInsertReady(parsed: ManualCatalystInsert | null): boolean {
  return Boolean(parsed?.ticker && parsed?.cdIso);
}
