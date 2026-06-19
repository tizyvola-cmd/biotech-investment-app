"""new_bio_ipo — fetch new biotech IPOs and add them to the local universe.

Pipeline (called from the desktop UI button or the monthly scheduler):

1. Carica ``data/biotech_symbols.json`` (lista master dei ticker biotech).
2. Interroga Finnhub ``/calendar/ipo?from=...&to=...`` per la finestra
   ``[first_day_of_previous_month .. today]`` (default).
3. Filtra le IPO biotech: per ogni candidato chiama yfinance
   ``Ticker(symbol).info`` e mantiene quelli con
   ``sector ∈ {"Healthcare"}`` e ``industry`` che inizia per "Biotechnology",
   "Drug Manufacturers", "Diagnostics & Research" o "Medical Devices".
4. Aggiunge i nuovi simboli alla lista master (deduplicata, ordinata).
5. Esegue ``fetch_yfinance.run_fetch`` solo sui nuovi → ``yf.json`` viene
   aggiornato in modo incrementale.
6. Salva un report ``data/new_bio_ipo_last_run.json`` con timestamp, finestra
   e lista delle nuove società (symbol, name, ipo_date, exchange,
   industry, market_cap, current_price).

Tutto è eseguibile sia da CLI (``python new_bio_ipo.py``) sia importato e
chiamato come funzione ``run_new_bio_ipo()`` dall'API server.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import requests

# ── Paths and configuration ──────────────────────────────────────────────────

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

SYMBOLS_PATH = DATA_DIR / "biotech_symbols.json"
LAST_RUN_PATH = DATA_DIR / "new_bio_ipo_last_run.json"

# Finnhub API key — same one used by fetch_finnhub.py.
FINNHUB_API_KEY = os.environ.get(
    "FINNHUB_API_KEY", "d7jh0jpr01qhf13er8bgd7jh0jpr01qhf13er8c0"
)

# Industries we consider "biotech" for the purposes of this universe.
BIOTECH_INDUSTRIES = (
    "Biotechnology",
    "Drug Manufacturers",
    "Diagnostics & Research",
    "Medical Devices",
)

# Heuristic name match fallback when yfinance has no info yet (very fresh IPO).
# IMPORTANT: matched as WHOLE WORDS (or with a configurable suffix) to avoid the
# kind of false positives we saw in early runs — e.g. "Lincoln INTE**RNA**TIONAL"
# matching "rna", "Web3**LABS**" matching "labs", "GE**NE**RAL Catalyst" matching
# "gene". Each entry is a regex stem; ``\b`` is enforced around it. Use ``.*`` to
# match a prefix family (e.g. ``therap.*`` covers therapy/therapeutic/therapies).
BIOTECH_NAME_HINT_PATTERNS = (
    r"therap\w*",          # therapy, therapeutic(s), therapies
    r"biosc\w*",           # bioscience(s)
    r"biotech\w*",
    r"pharma\w*",          # pharma, pharmaceuticals
    r"medicin\w*",         # medicine(s)
    r"oncolog\w*",
    r"antibod\w*",         # antibody, antibodies
    r"vaccin\w*",
    r"diagnost\w*",
    r"clinical",
    r"immunolog\w*",
    r"neurolog\w*",
    r"genomic\w*",
    r"genetics?",
    r"cell\s*therap\w*",
    r"gene\s*therap\w*",
    r"rna\s*therap\w*",
    r"crispr",
    r"oncolytic\w*",
)

# Companies whose name *strongly* indicates they are NOT biotech, even if yfinance
# returns nothing (SPACs, financial vehicles, shell companies). Whole-word match.
NON_BIOTECH_NAME_PATTERNS = (
    r"acquisition\s+corp",
    r"merger\s+corp",
    r"capital\s+corp",
    r"shell\s+compan\w*",
    r"holding\w*",
    r"\bspac\b",
    r"royalt(?:y|ies)",
    r"asset\s+management",
)

# yfinance sectors that should hard-exclude even if the name looks bio.
NON_BIOTECH_SECTORS = {
    "Financial Services",
    "Technology",
    "Communication Services",
    "Real Estate",
    "Energy",
    "Utilities",
    "Industrials",
    "Consumer Cyclical",
    "Consumer Defensive",
    "Basic Materials",
}

# yfinance industries inside Healthcare that we still don't want (e.g. hospitals,
# health insurance, retail pharmacies — not the kind of catalysts our model targets).
NON_BIOTECH_HEALTHCARE_INDUSTRIES = (
    "Health Information Services",
    "Healthcare Plans",
    "Medical Care Facilities",
    "Medical Distribution",
    "Pharmaceutical Retailers",
)


def _matches_any(text: str, patterns: tuple[str, ...]) -> bool:
    """Return True if ``text`` contains any pattern, matched on word boundaries."""
    if not text:
        return False
    for pat in patterns:
        # Anchor on a leading word boundary; trailing boundary is implied by the
        # ``\w*``/explicit terminators in the patterns themselves.
        if re.search(rf"\b{pat}\b", text, flags=re.IGNORECASE):
            return True
    return False


# ── Helpers ─────────────────────────────────────────────────────────────────


def _today() -> date:
    return date.today()


def _first_day_of_previous_month(today: date | None = None) -> date:
    today = today or _today()
    first_this = today.replace(day=1)
    last_prev = first_this - timedelta(days=1)
    return last_prev.replace(day=1)


def _load_symbol_set() -> set[str]:
    if not SYMBOLS_PATH.exists():
        return set()
    try:
        raw = json.loads(SYMBOLS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return set()
    return {str(s).strip().upper() for s in raw if isinstance(s, str) and s.strip()}


def _save_symbol_set(symbols: set[str]) -> None:
    sorted_syms = sorted({s.strip().upper() for s in symbols if s and s.strip()})
    SYMBOLS_PATH.write_text(
        json.dumps(sorted_syms, indent=2, ensure_ascii=False), encoding="utf-8"
    )


def _save_last_run(payload: dict[str, Any]) -> None:
    LAST_RUN_PATH.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False, default=str),
        encoding="utf-8",
    )


def load_last_run() -> dict[str, Any] | None:
    if not LAST_RUN_PATH.exists():
        return None
    try:
        return json.loads(LAST_RUN_PATH.read_text(encoding="utf-8"))
    except Exception:
        return None


# ── Data sources ────────────────────────────────────────────────────────────


def fetch_finnhub_ipos(date_from: date, date_to: date) -> list[dict[str, Any]]:
    """Query Finnhub for IPOs in the window. Returns the raw ``ipoCalendar`` list."""
    if not FINNHUB_API_KEY:
        return []
    url = "https://finnhub.io/api/v1/calendar/ipo"
    params = {
        "from": date_from.isoformat(),
        "to": date_to.isoformat(),
        "token": FINNHUB_API_KEY,
    }
    try:
        r = requests.get(url, params=params, timeout=20)
        if r.status_code != 200:
            print(
                f"[new_bio_ipo] Finnhub IPO calendar HTTP {r.status_code}: "
                f"{r.text[:160]}",
                flush=True,
            )
            return []
        data = r.json() or {}
        items = data.get("ipoCalendar") or []
        return [it for it in items if isinstance(it, dict)]
    except Exception as exc:  # noqa: BLE001
        print(f"[new_bio_ipo] Finnhub error: {exc}", flush=True)
        return []


def _yf_info(symbol: str) -> dict[str, Any] | None:
    """Best-effort ``yf.Ticker(symbol).info`` with a single try."""
    try:
        import yfinance as yf  # local import keeps the module light at startup

        tk = yf.Ticker(symbol)
        info = tk.info or {}
        # yfinance sometimes returns a non-dict (Mapping subclass); coerce.
        return dict(info) if info else None
    except Exception as exc:  # noqa: BLE001
        print(f"[new_bio_ipo] yfinance.info({symbol}) failed: {exc}", flush=True)
        return None


def _looks_biotech(info: dict[str, Any] | None, name: str) -> bool:
    """Decide whether the candidate looks like a biotech / drug developer.

    Decision order:

    1. Hard exclusion on company name (SPACs, holdings, "Acquisition Corp", …)
       regardless of what yfinance says. Avoids the most common false positives
       in IPO calendars.
    2. If yfinance returned info:
         - sector ∈ NON_BIOTECH_SECTORS → False (no fallback to name).
         - sector == "Healthcare" + industry in BIOTECH_INDUSTRIES → True.
         - sector == "Healthcare" but industry in NON_BIOTECH_HEALTHCARE_… → False.
         - sector == "Healthcare" with empty/unknown industry → fall through to name.
       Other (unknown) sectors fall through to name.
    3. Whole-word match against ``BIOTECH_NAME_HINT_PATTERNS``.
    """
    name_norm = (name or "").strip()

    if _matches_any(name_norm, NON_BIOTECH_NAME_PATTERNS):
        return False

    if info:
        sector = (info.get("sector") or "").strip()
        industry = (info.get("industry") or "").strip()
        if sector in NON_BIOTECH_SECTORS:
            return False
        if sector == "Healthcare":
            if any(industry.startswith(bad) for bad in NON_BIOTECH_HEALTHCARE_INDUSTRIES):
                return False
            for prefix in BIOTECH_INDUSTRIES:
                if industry.startswith(prefix):
                    return True
            # Empty / unrecognised industry but still Healthcare → fall back to name.
            if not industry:
                return _matches_any(name_norm, BIOTECH_NAME_HINT_PATTERNS)
            return False

    return _matches_any(name_norm, BIOTECH_NAME_HINT_PATTERNS)


# ── Main pipeline ───────────────────────────────────────────────────────────


def run_new_bio_ipo(
    date_from: date | None = None,
    date_to: date | None = None,
    update_yfinance: bool = True,
) -> dict[str, Any]:
    """Pipeline end-to-end. Returns a summary dict (also persisted on disk).

    Args:
        date_from: inizio finestra IPO (default = 1° del mese precedente).
        date_to:   fine finestra IPO  (default = oggi).
        update_yfinance: se True, esegue ``fetch_yfinance.run_fetch`` sui
            nuovi simboli (così appaiono subito in ``yf.json``/Financial sheet).
    """
    date_from = date_from or _first_day_of_previous_month()
    date_to = date_to or _today()

    started_at = datetime.now()
    existing = _load_symbol_set()

    ipos = fetch_finnhub_ipos(date_from, date_to)
    print(
        f"[new_bio_ipo] Finnhub returned {len(ipos)} IPOs in "
        f"[{date_from}..{date_to}]",
        flush=True,
    )

    added: list[dict[str, Any]] = []
    skipped_existing: list[str] = []
    skipped_non_biotech: list[str] = []
    skipped_no_symbol: list[str] = []

    for ipo in ipos:
        symbol = (ipo.get("symbol") or "").strip().upper()
        name = (ipo.get("name") or "").strip()
        if not symbol:
            skipped_no_symbol.append(name or "<no-name>")
            continue
        if symbol in existing:
            skipped_existing.append(symbol)
            continue

        info = _yf_info(symbol)
        if not _looks_biotech(info, name):
            skipped_non_biotech.append(symbol)
            continue

        added.append(
            {
                "symbol": symbol,
                "name": name,
                "ipo_date": ipo.get("date"),
                "exchange": ipo.get("exchange"),
                "price": ipo.get("price"),
                "shares": ipo.get("numberOfShares") or ipo.get("totalSharesValue"),
                "industry": (info or {}).get("industry"),
                "sector": (info or {}).get("sector"),
                "market_cap": (info or {}).get("marketCap"),
                "current_price": (info or {}).get("currentPrice"),
                "website": (info or {}).get("website"),
                "country": (info or {}).get("country"),
            }
        )
        # Be polite to yfinance / avoid throttling.
        time.sleep(0.2)

    new_symbols = [row["symbol"] for row in added]
    if new_symbols:
        merged = existing | set(new_symbols)
        _save_symbol_set(merged)
        print(
            f"[new_bio_ipo] Added {len(new_symbols)} new tickers to {SYMBOLS_PATH.name}",
            flush=True,
        )

    yfinance_update: dict[str, Any] = {"ran": False}
    if update_yfinance:
        try:
            import fetch_yfinance  # type: ignore

            # Idempotency guard: on every run, look for any ticker that's in
            # ``biotech_symbols.json`` but missing from ``yf.json`` (could be
            # this run's IPO additions OR remnants from a previous run that
            # didn't finish the fetch step). Always sync these too — so the
            # button is self-healing.
            existing_yf = fetch_yfinance.load_existing_yf_json()
            full_universe = _load_symbol_set()
            to_fetch = sorted(
                (full_universe - set(existing_yf.keys())) | set(new_symbols)
            )

            if not to_fetch:
                yfinance_update = {"ran": True, "fetched": 0, "skipped_reason": "yf.json already covers the universe"}
                print(
                    "[new_bio_ipo] yfinance already in sync with biotech_symbols.json",
                    flush=True,
                )
            else:
                records = fetch_yfinance.run_fetch(to_fetch)
                for rec in records:
                    sym = str(rec.get("symbol", "")).strip().upper()
                    if sym:
                        existing_yf[sym] = rec
                fetch_yfinance.save_outputs(list(existing_yf.values()))
                yfinance_update = {
                    "ran": True,
                    "fetched": len(records),
                    "fetched_symbols": to_fetch,
                    "new_from_this_run": len(new_symbols),
                    "backfilled_from_previous_runs": len(to_fetch) - len(new_symbols),
                }
                print(
                    f"[new_bio_ipo] yfinance refresh OK: {len(records)} records "
                    f"({len(new_symbols)} new IPOs + "
                    f"{len(to_fetch) - len(new_symbols)} backfilled from previous runs)",
                    flush=True,
                )
        except Exception as exc:  # noqa: BLE001
            yfinance_update = {"ran": False, "error": str(exc)}
            print(f"[new_bio_ipo] yfinance refresh failed: {exc}", flush=True)

    finished_at = datetime.now()
    summary = {
        "started_at": started_at.isoformat(timespec="seconds"),
        "finished_at": finished_at.isoformat(timespec="seconds"),
        "elapsed_sec": int((finished_at - started_at).total_seconds()),
        "window_from": date_from.isoformat(),
        "window_to": date_to.isoformat(),
        "finnhub_total": len(ipos),
        "added_count": len(added),
        "added": added,
        "skipped_existing_count": len(skipped_existing),
        "skipped_non_biotech_count": len(skipped_non_biotech),
        "skipped_no_symbol_count": len(skipped_no_symbol),
        "skipped_existing_sample": sorted(skipped_existing)[:10],
        "skipped_non_biotech_sample": sorted(skipped_non_biotech)[:10],
        "yfinance_update": yfinance_update,
        "source": "finnhub.io/api/v1/calendar/ipo",
    }
    _save_last_run(summary)
    return summary


def needs_monthly_run(today: date | None = None) -> bool:
    """Return True if the monthly scheduler should fire.

    Logic: we want to refresh as soon as we enter a new month and we haven't
    already run for that month. Concretely: if ``last_run.window_to`` is in a
    different (year, month) than today's, or there is no last run, return True.
    """
    today = today or _today()
    last = load_last_run()
    if not last:
        return True
    try:
        win_to = last.get("window_to")
        if not isinstance(win_to, str):
            return True
        last_d = date.fromisoformat(win_to)
    except Exception:
        return True
    return (last_d.year, last_d.month) != (today.year, today.month)


def main() -> int:
    """CLI entrypoint. Output: prints summary as JSON on stdout."""
    summary = run_new_bio_ipo()
    print("---SUMMARY-JSON---")
    print(json.dumps(summary, indent=2, ensure_ascii=False, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
