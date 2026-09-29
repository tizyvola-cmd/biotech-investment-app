/**
 * MedTech ticker universe — mirrors data/medtech_symbols.json (build_medtech_symbols.py).
 * Medtech tickers always show the ECG monitor icon in Simulation / Dashboard / KPI / Feed.
 */
import { fetchProjectJson } from "../data/projectData";

/** Fallback when snapshot not yet exported (IHI/XHE curated + small-cap device). */
export const CURATED_MEDTECH_SYMBOLS: readonly string[] = [
  "ABT",
  "ADGM",
  "ALGN",
  "ANGO",
  "AORT",
  "ATEC",
  "ATRC",
  "AVNS",
  "AXGN",
  "BAX",
  "BCAX",
  "BDSX",
  "BDX",
  "BFLY",
  "BIO",
  "BJDX",
  "BLCO",
  "BSX",
  "BWAY",
  "CDIO",
  "CERS",
  "CNMD",
  "CODX",
  "COO",
  "DXCM",
  "EKSO",
  "EW",
  "GEHC",
  "GH",
  "GKOS",
  "GMED",
  "GRAL",
  "GUTS",
  "HAE",
  "HOLX",
  "HUMA",
  "IART",
  "ICU",
  "ICUI",
  "IDXX",
  "IMDX",
  "INBS",
  "INSP",
  "IRMD",
  "IRTC",
  "ISRG",
  "ITGR",
  "KIDS",
  "KMTS",
  "LCTX",
  "LIVN",
  "LMAT",
  "LNTH",
  "LUCD",
  "LUNG",
  "MASI",
  "MDLN",
  "MDT",
  "MDXG",
  "MMSI",
  "MTD",
  "NARI",
  "NOTV",
  "NOVT",
  "NSPR",
  "NUVA",
  "NVCR",
  "NVST",
  "OBIO",
  "OFIX",
  "OMCL",
  "ORGO",
  "OSUR",
  "PEN",
  "PLSE",
  "PODD",
  "PRCT",
  "PROF",
  "PROK",
  "QDEL",
  "RBOT",
  "RCEL",
  "RMD",
  "SENS",
  "SER",
  "SHC",
  "SIBN",
  "SILK",
  "SMTI",
  "SRTS",
  "STAA",
  "STE",
  "STIM",
  "SWAV",
  "SYK",
  "TELA",
  "TFX",
  "TMDX",
  "TNDM",
  "TRNS",
  "UFPT",
  "UTMD",
  "VMD",
  "VREX",
  "VRHI",
  "WST",
  "XRAY",
  "ZBH",
  "ZD",
  "ZIMV",
];

const SNAPSHOT_FILE = "medtech_symbols_snapshot.json";

let medtechSet: Set<string> | null = null;
let hydratePromise: Promise<void> | null = null;

function normalizeTicker(ticker: string): string {
  return String(ticker ?? "")
    .trim()
    .toUpperCase();
}

function curatedSet(): Set<string> {
  return new Set(CURATED_MEDTECH_SYMBOLS.map(normalizeTicker).filter(Boolean));
}

/** Current medtech set (curated until snapshot hydrates). */
export function getMedtechSymbolSet(): ReadonlySet<string> {
  if (!medtechSet) {
    medtechSet = curatedSet();
  }
  return medtechSet;
}

export function isMedtechTicker(ticker: string | null | undefined): boolean {
  const tk = normalizeTicker(ticker ?? "");
  if (!tk) return false;
  return getMedtechSymbolSet().has(tk);
}

/** Load server snapshot produced by export_desktop_snapshots / build_medtech_symbols. */
export async function hydrateMedtechSymbolsFromSnapshot(): Promise<void> {
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    try {
      const { data } = await fetchProjectJson<string[] | { tickers?: string[] }>(
        SNAPSHOT_FILE,
      );
      const list = Array.isArray(data)
        ? data
        : Array.isArray(data?.tickers)
          ? data.tickers
          : null;
      if (list?.length) {
        medtechSet = new Set(
          list.map(normalizeTicker).filter((t) => t.length > 0 && t.length <= 6),
        );
      }
    } catch {
      medtechSet = curatedSet();
    }
  })();
  return hydratePromise;
}

/** Test helper — reset module cache. */
export function resetMedtechSymbolCacheForTests(): void {
  medtechSet = null;
  hydratePromise = null;
}
