"""
MedTech ticker universe — ETF holdings + curated small/mid-cap + CT.gov device CD discovery.

Files:
  data/medtech_symbols.json   — master medtech list
  data/biotech_symbols.json   — optional sync (union) for yfinance / clinical fetch
"""
from __future__ import annotations

import json
import os
import re
import time
from datetime import date, timedelta
from typing import Iterable

import requests

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
MEDTECH_SYMBOLS_JSON = os.path.join(DATA_DIR, "medtech_symbols.json")
BIOTECH_SYMBOLS_JSON = os.path.join(DATA_DIR, "biotech_symbols.json")
YF_JSON = os.path.join(DATA_DIR, "yf.json")
SEC_TICKERS_JSON = os.path.join(DATA_DIR, "sec_company_tickers.json")
CT_URL = "https://clinicaltrials.gov/api/v2/studies"

MEDTECH_ETFS: tuple[str, ...] = ("IHI", "XHE")

# iShares IHI (~52) + SPDR XHE (~50) reference constituents (refresh quarterly from fund sheets).
REFERENCE_IHI: tuple[str, ...] = (
    "ABT", "ALGN", "ATEC", "ANGO", "AORT", "ATRC", "AXGN", "AVNS", "BAX", "BDX",
    "BFLY", "BIO", "BLCO", "BSX", "BWAY", "CNMD", "COO", "DXCM", "EKSO", "EW",
    "GEHC", "GKOS", "GMED", "HAE", "HOLX", "IART", "ICUI", "IDXX", "INSP", "IRTC",
    "ISRG", "ITGR", "LIVN", "LMAT", "LNTH", "LUNG", "MASI", "MDT", "MMSI", "MTD",
    "NARI", "NOVT", "NVCR", "NVST", "OFIX", "OMCL", "PEN", "PODD", "PRCT", "PROK",
    "QDEL", "RMD", "SHC", "SIBN", "SILK", "STAA", "STE", "STIM", "SWAV", "SYK",
    "TFX", "TMDX", "TNDM", "TRNS", "VREX", "WST", "XRAY", "ZBH", "ZIMV",
)

REFERENCE_XHE: tuple[str, ...] = (
    "STAA", "NVCR", "IART", "AXGN", "AVNS", "LNTH", "BFLY", "LIVN", "OMCL", "TFX",
    "ATRC", "GKOS", "INSP", "IRTC", "NVST", "TNDM", "SWAV", "STIM", "PEN", "PODD",
    "PROK", "TMDX", "GMED", "LMAT", "MMSI", "PRCT", "EKSO", "TELA", "NSPR", "INBS",
    "LUNG", "MASI", "NUVA", "OFIX", "SIBN", "SILK", "KIDS", "IRMD", "UTMD", "VMD",
    "PLSE", "RCEL", "SENS", "SRTS", "SMTI", "RBOT", "BDSX", "NOTV", "MDXG", "OSUR",
)

# Small/mid-cap device + reg-catalyst names (often outside mega-cap ETF weightings).
REFERENCE_SMALL_CAP: tuple[str, ...] = (
    # LCTX excluded — cell therapy / biotech (OpRegen); not device medtech.
    "INBS", "NSPR", "GUTS", "OBIO", "CERS", "ORGO", "HUMA", "KMTS", "BCAX",
    "CDIO", "BJDX", "LUCD", "CODX", "IMDX", "VRHI", "ADGM", "SER", "ZD", "TELA", "GH",
)

# Pharma / CRO giants — skip when CT.gov maps a device trial to a drug company.
EXCLUDE_CTGOV_TICKERS: frozenset[str] = frozenset(
    {
        "LLY", "JNJ", "ABBV", "UNH", "MRK", "TMO", "AMGN", "GILD", "PFE", "BMY",
        "VRTX", "REGN", "ALNY", "ARGX", "BIIB", "RVMD", "AZN",
    }
)


# CT.gov lead sponsor substring → ticker (when SEC/yf fuzzy match fails).
SPONSOR_TICKER_ALIASES: dict[str, str] = {
    "cerus corporation": "CERS",
    "organogenesis": "ORGO",
    "intelligent bio solutions": "INBS",
    "lineage cell therapeutics": "LCTX",
    "inspiremd": "NSPR",
    "fractyl health": "GUTS",
    "orchestra biomed": "OBIO",
    "humacyte": "HUMA",
    "procept biorobotics": "PRCT",
    "teleflex": "TFX",
    "dexcom": "DXCM",
    "edwards lifesciences": "EW",
    "intuitive surgical": "ISRG",
    "pulmonx": "LUNG",
    "masimo": "MASI",
    "guardant health": "GH",
    "organogenesis holdings": "ORGO",
    "dentsply sirona": "XRAY",
    "dentsply": "XRAY",
    "sirona dental": "XRAY",
}


def norm_name(s: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9 ]", "", (s or "").lower()).split())


def _valid_ticker(sym: str) -> bool:
    s = str(sym or "").strip().upper()
    if not s or len(s) > 6:
        return False
    return bool(re.match(r"^[A-Z][A-Z0-9.-]{0,5}$", s))


def load_json_list(path: str) -> list[str]:
    if not os.path.exists(path):
        return []
    try:
        with open(path, encoding="utf-8") as fh:
            raw = json.load(fh)
    except Exception:
        return []
    if not isinstance(raw, list):
        return []
    return sorted({_valid_ticker_and_keep(t) for t in raw if _valid_ticker_and_keep(t)})


def _valid_ticker_and_keep(t: object) -> str:
    s = str(t or "").strip().upper()
    return s if _valid_ticker(s) else ""


def reference_medtech_symbols() -> tuple[str, ...]:
    """Static seed: IHI + XHE + small-cap union (sorted, validated)."""
    merged = {
        t
        for t in (*REFERENCE_IHI, *REFERENCE_XHE, *REFERENCE_SMALL_CAP)
        if _valid_ticker(t)
    }
    return tuple(sorted(merged))


# Backward-compatible alias used across build scripts and desktop fallback sync.
CURATED_MEDTECH: tuple[str, ...] = reference_medtech_symbols()


def save_json_list(path: str, tickers: Iterable[str]) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    cleaned = sorted({t for t in (_valid_ticker_and_keep(x) for x in tickers) if t})
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(cleaned, fh, indent=2, ensure_ascii=False)


def fetch_etf_holdings() -> set[str]:
    """
    ETF constituent tickers.

    yfinance exposes only ~10 top holdings per fund; we merge those with the
    static IHI/XHE reference lists (full fund composition from public sheets).
    """
    out: set[str] = set(reference_medtech_symbols())

    yf_extra: set[str] = set()
    try:
        import yfinance as yf
    except ImportError:
        print("[medtech] yfinance non disponibile — uso solo reference IHI/XHE")
        print(f"[medtech] ETF reference union: {len(out)} ticker")
        return out

    for etf in MEDTECH_ETFS:
        try:
            th = yf.Ticker(etf).funds_data.top_holdings
            if th is None or getattr(th, "empty", True):
                print(f"[medtech] {etf}: nessun holding top da yfinance")
                continue
            for sym in th.index:
                tk = _valid_ticker_and_keep(sym)
                if tk:
                    yf_extra.add(tk)
            print(f"[medtech] {etf}: {len(th.index)} top holdings (yfinance)")
        except Exception as exc:
            print(f"[medtech] {etf} holdings error: {exc}")

    new_from_yf = yf_extra - out
    out.update(yf_extra)
    print(
        f"[medtech] ETF union: {len(out)} ticker "
        f"(reference {len(reference_medtech_symbols())}, +{len(new_from_yf)} da yfinance top-10)"
    )
    return out


def load_ticker_to_company() -> dict[str, str]:
    """Ticker → company name for CT.gov query.term (same source as biotech fetch)."""
    out: dict[str, str] = {}

    if os.path.exists(YF_JSON):
        try:
            with open(YF_JSON, encoding="utf-8") as fh:
                rows = json.load(fh)
            for item in rows or []:
                if not isinstance(item, dict):
                    continue
                sym = _valid_ticker_and_keep(item.get("symbol"))
                nm = str(item.get("companyName") or "").strip()
                if sym and nm:
                    out[sym] = nm
        except Exception as exc:
            print(f"[medtech] yf.json ticker→company skip: {exc}")

    if os.path.exists(SEC_TICKERS_JSON):
        try:
            with open(SEC_TICKERS_JSON, encoding="utf-8") as fh:
                sec = json.load(fh)
            for _k, rec in (sec or {}).items():
                if not isinstance(rec, dict):
                    continue
                sym = _valid_ticker_and_keep(rec.get("ticker"))
                title = str(rec.get("title") or "").strip()
                if sym and title and sym not in out:
                    out[sym] = title
        except Exception as exc:
            print(f"[medtech] sec ticker→company skip: {exc}")

    for alias, sym in SPONSOR_TICKER_ALIASES.items():
        sym_u = sym.upper()
        if sym_u not in out:
            out[sym_u] = alias.title()

    return out


def resolve_sponsor_study_targets(tickers: Iterable[str] | None = None) -> list[str]:
    """
    Tickers to query via CT.gov sponsor search.
    Explicit tickers are honored directly (e.g. XRAY) — not limited to alias list.
    Default: all medtech with a known company name + alias tickers.
    """
    alias_tickers = sorted({sym.upper() for sym in SPONSOR_TICKER_ALIASES.values() if _valid_ticker(sym)})
    medtech_set = set(load_json_list(MEDTECH_SYMBOLS_JSON)) | set(CURATED_MEDTECH)
    t2c = load_ticker_to_company()

    if tickers is not None:
        return sorted({t.upper() for t in tickers if _valid_ticker(t)})

    return sorted(set(alias_tickers) | {t for t in medtech_set if t in t2c})


def sponsor_search_terms_for_ticker(ticker: str, ticker_to_company: dict[str, str]) -> list[str]:
    """Company-name queries for CT.gov — mirrors biotech BiotechClinicalTrialDataFetcher."""
    tk = ticker.upper()
    terms: list[str] = []
    company = ticker_to_company.get(tk, "").strip()
    if company and len(company) >= 3:
        terms.append(company)
        # Shorter form without legal suffix noise (Dentsply Sirona Inc. → Dentsply Sirona)
        short = re.sub(
            r"\b(inc|incorporated|corp|corporation|ltd|llc|plc|co|company)\b\.?",
            "",
            company,
            flags=re.I,
        )
        short = " ".join(short.split()).strip()
        if short and short.lower() != company.lower() and len(short) >= 4:
            terms.append(short)

    for alias, sym in SPONSOR_TICKER_ALIASES.items():
        if sym.upper() == tk:
            terms.append(alias)

    return list(dict.fromkeys(t for t in terms if t and len(t) >= 3))


def build_name_ticker_map() -> dict[str, str]:
    """Normalized company name → ticker (yf.json + SEC EDGAR)."""
    mapping: dict[str, str] = {}

    if os.path.exists(YF_JSON):
        try:
            with open(YF_JSON, encoding="utf-8") as fh:
                rows = json.load(fh)
            for item in rows or []:
                if not isinstance(item, dict):
                    continue
                sym = _valid_ticker_and_keep(item.get("symbol"))
                nm = str(item.get("companyName") or "").strip()
                if sym and nm:
                    mapping[norm_name(nm)] = sym
        except Exception as exc:
            print(f"[medtech] yf.json map skip: {exc}")

    if os.path.exists(SEC_TICKERS_JSON):
        try:
            with open(SEC_TICKERS_JSON, encoding="utf-8") as fh:
                sec = json.load(fh)
            for _k, rec in (sec or {}).items():
                if not isinstance(rec, dict):
                    continue
                sym = _valid_ticker_and_keep(rec.get("ticker"))
                title = str(rec.get("title") or "").strip()
                if sym and title:
                    nk = norm_name(title)
                    if nk not in mapping:
                        mapping[nk] = sym
        except Exception as exc:
            print(f"[medtech] sec map skip: {exc}")

    for alias, sym in SPONSOR_TICKER_ALIASES.items():
        if _valid_ticker(sym):
            mapping[norm_name(alias)] = sym.upper()

    return mapping


def match_sponsor_to_ticker(lead_sponsor: str, name_map: dict[str, str]) -> str:
    nk = norm_name(lead_sponsor)
    if not nk:
        return ""
    if nk in name_map:
        return name_map[nk]
    for alias, sym in SPONSOR_TICKER_ALIASES.items():
        if alias in nk or nk in alias:
            return sym.upper()
    best = ""
    best_len = 0
    for k, sym in name_map.items():
        if len(k) < 10:
            continue
        if k in nk or nk in k:
            if len(k) > best_len:
                best = sym
                best_len = len(k)
    return best


def _parse_iso_date(raw: str) -> date | None:
    if not raw:
        return None
    parts = str(raw).split("-")
    if len(parts) < 3:
        return None
    try:
        return date(int(parts[0]), int(parts[1]), int(parts[2]))
    except ValueError:
        return None


def discover_ctgov_sponsor_studies(
    tickers: Iterable[str] | None = None,
    *,
    horizon_days: int = 120,
    per_ticker_limit: int = 10,
    align_cd: str | None = None,
    align_cd_tolerance_days: int = 120,
) -> tuple[list[str], list[dict]]:
    """
    Query CT.gov by company name for medtech sponsors (catches BIOLOGICAL+DEVICE studies).
    Same query.term pattern as BiotechClinicalTrialDataFetcher.fetch_clinicaltrials.
    Complements the InterventionType=DEVICE paginated scan.
    """
    today = date.today()
    end = today + timedelta(days=horizon_days)
    align_dt = _parse_iso_date(align_cd) if align_cd else None
    target = resolve_sponsor_study_targets(tickers)
    if not target:
        return [], []

    ticker_to_company = load_ticker_to_company()
    name_map = build_name_ticker_map()

    rows: list[dict] = []
    tickers_found: set[str] = set()

    def _collaborator_names(sponsor_mod: dict) -> str:
        parts: list[str] = []
        for c in sponsor_mod.get("collaborators") or []:
            if isinstance(c, dict):
                nm = str(c.get("name") or "").strip()
                if nm:
                    parts.append(nm)
        return " | ".join(parts)

    def _sponsor_trusted(tk: str, query_company: str, sponsor_mod: dict) -> tuple[bool, str, str]:
        lead = (sponsor_mod.get("leadSponsor") or {}).get("name", "")
        mapped = match_sponsor_to_ticker(lead, name_map)
        sponsor_match = ""
        try:
            from fetch_edgar import _compute_sponsor_match

            sponsor_match = _compute_sponsor_match(
                query_company,
                lead_sponsor=lead,
                collaborators=_collaborator_names(sponsor_mod),
            )
        except Exception:
            sponsor_match = "Partial" if mapped == tk else "No match"
        trusted = mapped == tk or sponsor_match in ("Exact", "Partial")
        return trusted, sponsor_match, lead

    for tk in target:
        terms = sponsor_search_terms_for_ticker(tk, ticker_to_company)
        if not terms:
            continue
        seen_nct: set[str] = set()
        query_company = ticker_to_company.get(tk, terms[0])
        for term in terms[:4]:
            query_variants = (
                ("query.spons", term),
                ("query.lead", term),
                ("query.term", term),
            )
            for query_key, query_val in query_variants:
                try:
                    r = requests.get(
                        CT_URL,
                        params={query_key: query_val, "pageSize": per_ticker_limit},
                        timeout=45,
                    )
                    r.raise_for_status()
                    data = r.json()
                except requests.RequestException as exc:
                    print(f"[medtech] CT.gov {query_key} '{query_val}' ({tk}): {exc}")
                    continue

                for study in data.get("studies") or []:
                    p = study.get("protocolSection") or {}
                    ident = p.get("identificationModule") or {}
                    nct = str(ident.get("nctId") or "").strip().upper()
                    if not nct or nct in seen_nct:
                        continue
                    status = p.get("statusModule") or {}
                    sponsor = p.get("sponsorCollaboratorsModule") or {}
                    trusted, sponsor_match, lead = _sponsor_trusted(tk, query_company, sponsor)
                    if not trusted:
                        continue
                    pc = (status.get("primaryCompletionDateStruct") or {}).get("date", "")
                    cd = (status.get("completionDateStruct") or {}).get("date", "")
                    use_date = pc or cd
                    dt = _parse_iso_date(use_date)
                    if dt is None:
                        continue
                    if align_dt is not None:
                        if abs((dt - align_dt).days) > align_cd_tolerance_days:
                            continue
                    elif dt < today or dt > end:
                        continue
                    seen_nct.add(nct)
                    tickers_found.add(tk)
                    rows.append(
                        {
                            "ticker": tk,
                            "days_to_cd": (dt - today).days,
                            "completion_date": use_date,
                            "nct_id": nct,
                            "lead_sponsor": lead,
                            "brief_title": ident.get("briefTitle", ""),
                            "query_company": query_company,
                            "sponsor_match": sponsor_match,
                            "source": "sponsor_query",
                        }
                    )
                time.sleep(0.15)

    rows.sort(key=lambda x: (x["days_to_cd"], x["ticker"]))
    return sorted(tickers_found), rows


def discover_ctgov_device_tickers(
    *,
    horizon_days: int = 120,
    max_pages: int = 15,
    medtech_only: bool = True,
) -> tuple[list[str], list[dict]]:
    """
    Scan CT.gov INDUSTRY + DEVICE studies with completion in horizon.
    Returns (tickers, detail_rows).
    """
    today = date.today()
    end = today + timedelta(days=horizon_days)
    medtech_set = set(load_json_list(MEDTECH_SYMBOLS_JSON)) | set(CURATED_MEDTECH)
    name_map = build_name_ticker_map()

    rows: list[dict] = []
    tickers: set[str] = set()
    page_token: str | None = None
    pages = 0

    while pages < max_pages:
        params: dict = {
            "filter.advanced": "AREA[LeadSponsorClass]INDUSTRY AND AREA[InterventionType]DEVICE",
            "pageSize": 100,
        }
        if page_token:
            params["pageToken"] = page_token
        try:
            r = requests.get(CT_URL, params=params, timeout=45)
            r.raise_for_status()
            data = r.json()
        except requests.RequestException as exc:
            print(f"[medtech] CT.gov scan error: {exc}")
            break

        for study in data.get("studies") or []:
            p = study.get("protocolSection") or {}
            ident = p.get("identificationModule") or {}
            status = p.get("statusModule") or {}
            sponsor = p.get("sponsorCollaboratorsModule") or {}
            arms = p.get("armsInterventionsModule") or {}

            pc = (status.get("primaryCompletionDateStruct") or {}).get("date", "")
            cd = (status.get("completionDateStruct") or {}).get("date", "")
            use_date = pc or cd
            dt = _parse_iso_date(use_date)
            if dt is None or dt < today or dt > end:
                continue

            lead = (sponsor.get("leadSponsor") or {}).get("name", "")
            tk = match_sponsor_to_ticker(lead, name_map)
            if not tk or tk in EXCLUDE_CTGOV_TICKERS:
                continue
            if medtech_only and tk not in medtech_set and tk not in set(CURATED_MEDTECH):
                # Still collect if we can map — may expand universe
                pass

            tickers.add(tk)
            rows.append(
                {
                    "ticker": tk,
                    "days_to_cd": (dt - today).days,
                    "completion_date": use_date,
                    "nct_id": ident.get("nctId", ""),
                    "lead_sponsor": lead,
                    "brief_title": ident.get("briefTitle", ""),
                }
            )

        pages += 1
        page_token = data.get("nextPageToken")
        if not page_token:
            break
        time.sleep(0.25)

    rows.sort(key=lambda x: (x["days_to_cd"], x["ticker"]))
    # Sponsor-name pass: catches BIOLOGICAL-tagged device studies (e.g. CERS INTERCEPT)
    _, sponsor_rows = discover_ctgov_sponsor_studies(
        horizon_days=horizon_days,
        per_ticker_limit=8,
    )
    seen_nct = {r["nct_id"] for r in rows if r.get("nct_id")}
    for r in sponsor_rows:
        nct = r.get("nct_id")
        if nct and nct not in seen_nct:
            rows.append(r)
            tickers.add(r["ticker"])
            seen_nct.add(nct)
    rows.sort(key=lambda x: (x["days_to_cd"], x["ticker"]))
    return sorted(tickers), rows


def build_medtech_universe(
    *,
    include_etf: bool = True,
    include_curated: bool = True,
    include_ctgov: bool = True,
    ctgov_horizon_days: int = 120,
    ctgov_max_pages: int = 15,
) -> list[str]:
    symbols: set[str] = set()

    if include_curated:
        symbols.update(reference_medtech_symbols())

    if include_etf:
        symbols.update(fetch_etf_holdings())

    existing = set(load_json_list(MEDTECH_SYMBOLS_JSON))
    symbols.update(existing)

    if include_ctgov:
        discovered, details = discover_ctgov_device_tickers(
            horizon_days=ctgov_horizon_days,
            max_pages=ctgov_max_pages,
            medtech_only=False,
        )
        symbols.update(discovered)
        if details:
            preview = ", ".join(f"{d['ticker']} T-{d['days_to_cd']}d" for d in details[:8])
            print(f"[medtech] CT.gov device CD discovery: {len(discovered)} ticker — {preview}")

    return sorted(symbols)


def sync_medtech_to_biotech_symbols(medtech: Iterable[str]) -> int:
    """Append medtech tickers to biotech_symbols.json. Returns count added."""
    med = sorted({t for t in (_valid_ticker_and_keep(x) for x in medtech) if t})
    save_json_list(MEDTECH_SYMBOLS_JSON, med)

    existing = set(load_json_list(BIOTECH_SYMBOLS_JSON))
    nuovi = [t for t in med if t not in existing]
    if nuovi:
        updated = sorted(existing | set(med))
        save_json_list(BIOTECH_SYMBOLS_JSON, updated)
        print(
            f"[medtech] Sync biotech_symbols.json: +{len(nuovi)} ticker "
            f"(totale {len(updated)})"
        )
    else:
        print(f"[medtech] biotech_symbols.json già contiene tutti i {len(med)} medtech")
    return len(nuovi)


def load_universe_symbols_for_yfinance() -> list[str]:
    """Union biotech + medtech for fetch_yfinance.py."""
    bio = load_json_list(BIOTECH_SYMBOLS_JSON)
    med = load_json_list(MEDTECH_SYMBOLS_JSON)
    return sorted(set(bio) | set(med))
