/** MedTech ticker universe — mirrors desktop `medtechSymbols.ts` / data/medtech_symbols.json. */

export const CURATED_MEDTECH_SYMBOLS: readonly string[] = [
  "ABT", "ADGM", "ALGN", "ANGO", "AORT", "ATRC", "AVNS", "AXGN", "BAX", "BCAX", "BDSX", "BDX",
  "BFLY", "BIO", "BJDX", "BLCO", "BSX", "BWAY", "CDIO", "CERS", "CNMD", "CODX", "COO", "DXCM",
  "EKSO", "EW", "GEHC", "GH", "GKOS", "GMED", "GUTS", "HAE", "HOLX", "HUMA", "IART", "ICUI",
  "IDXX", "IMDX", "INBS", "INSP", "IRMD", "IRTC", "ISRG", "ITGR", "KIDS", "KMTS", "LCTX",
  "LIVN", "LMAT", "LNTH", "LUCD", "LUNG", "MASI", "MDT", "MDXG", "MMSI", "MTD", "NARI", "NOTV",
  "NOVT", "NSPR", "NUVA", "NVCR", "NVST", "OBIO", "OFIX", "OMCL", "ORGO", "OSUR", "PEN", "PLSE",
  "PODD", "PRCT", "PROK", "QDEL", "RBOT", "RCEL", "RMD", "SENS", "SER", "SHC", "SIBN", "SILK",
  "SMTI", "STAA", "STE", "STIM", "SWAV", "SYK", "TELA", "TFX", "TMDX", "TNDM", "TRNS", "UTMD",
  "VMD", "VREX", "VRHI", "WST", "XRAY", "ZBH", "ZD", "ZIMV",
];

let medtechSet: Set<string> | null = null;

function normalizeTicker(ticker: string): string {
  return String(ticker ?? "").trim().toUpperCase();
}

function curatedSet(): Set<string> {
  return new Set(CURATED_MEDTECH_SYMBOLS.map(normalizeTicker).filter(Boolean));
}

export function getMedtechSymbolSet(): ReadonlySet<string> {
  if (!medtechSet) medtechSet = curatedSet();
  return medtechSet;
}

export function isMedtechTicker(ticker: string | null | undefined): boolean {
  const tk = normalizeTicker(ticker ?? "");
  return tk.length > 0 && getMedtechSymbolSet().has(tk);
}

export async function hydrateMedtechSymbolsFromApi(apiBase: string): Promise<void> {
  const base = apiBase.replace(/\/$/, "");
  const url = base ? `${base}/project-data/medtech_symbols_snapshot.json` : "/project-data/medtech_symbols_snapshot.json";
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as string[] | { tickers?: string[] };
    const list = Array.isArray(data) ? data : Array.isArray(data?.tickers) ? data.tickers : null;
    if (list?.length) {
      medtechSet = new Set(list.map(normalizeTicker).filter((t) => t.length > 0 && t.length <= 6));
    }
  } catch {
    medtechSet = curatedSet();
  }
}

export function medtechTickersForSnapshot(): string[] {
  return [...getMedtechSymbolSet()].sort();
}
