"""
Google Trends search-interest — early-warning index (display only).

Default ON (SUPERNOVA_TRENDS=0 to disable). Not a Soft BUY/SELL input.

Live fetch uses pytrends with two windows:
* ``today 3-m`` — daily series for baseline / spike / primary Δ% (unchanged).
* ``now 1-d`` — ~24h intraday samples for a secondary Δ% (display only).

HTTP reads a ~4h disk cache for up to ``_MAX_UNIVERSE`` tickers per call
(6 ticker-only live fills on open days, 12 when NYSE closed; the rest are
served from disk). Company/product legs warm in the background. The
scheduler force-refreshes the Simulation universe 3× on NYSE open days
(10:00 / 16:00 / 21:00 Rome) and twice on weekends / holidays (11:30, 17:00).
"""
from __future__ import annotations

import json
import logging
import math
import re
import statistics
import threading
import time
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from supernova_config import get_supernova_config

logger = logging.getLogger("supernova.search_interest")

_CACHE_DIR = Path("data") / "cache" / "search_interest"
_HISTORY_DIR = _CACHE_DIR / "history"
# Align with ~3 scheduler slots/day — avoid live Google spam between polls.
_TTL_S = 4 * 60 * 60
# Cap on names returned per HTTP/desk call. Must cover the Catalyst hot-zone
# (~40–60 tickers): morning desk used to truncate at 16 and left most G-Trends as "—".
# Live Google fills stay budgeted separately (_MAX_LIVE_*); excess names are cache-only.
_MAX_TICKERS = 80
# Open-session HTTP budget: ticker-only live fills (company/product warm in background).
_MAX_LIVE_PER_CALL = 6
_MAX_LIVE_CLOSED = 12
_MAX_UNIVERSE = 80
_HISTORY_MAX = 48
_LIVE_GAP_S = 1.1
_SPIKE_Z = 2.0
_BASELINE_DAYS = 20
_WARMER_ENABLED = True
# Primary: daily interest over ~3 months. Secondary: ~24h intraday (Google has no 12h preset).
_TF_BASELINE = "today 3-m"
_TF_1D = "now 1-d"
_SHORT_KEYS = (
    "interest_1d_score",
    "interest_1d_prev",
    "interest_1d_delta_pct",
    "interest_1d_samples",
    "interest_1d_timeframe",
)

_live_lock = threading.Lock()
_last_live_at = 0.0
_warm_lock = threading.Lock()
_warming: set[str] = set()
_warm_queue: list[str] = []
_warm_thread_started = False
# After Google 429/503/timeout, request threads must not keep calling Trends.
_circuit_until = 0.0
_CIRCUIT_S = 10 * 60


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


def _allowlist() -> set[str]:
    raw = get_supernova_config().trends_pilot_tickers
    return {p.strip().upper() for p in raw.split(",") if p.strip()}


def _empty_row(ticker: str, *, stale: bool = True) -> dict[str, Any]:
    return {
        "ticker": ticker,
        "query_term": ticker,
        "date": datetime.now(timezone.utc).date().isoformat(),
        "interest_score": None,
        "prev_interest_score": None,
        "interest_delta_pct": None,
        "rolling_baseline_20d": None,
        "zscore_vs_baseline": None,
        "search_spike": False,
        "zscore_delta": None,
        "query_kind": "ticker",
        "stale": stale,
        "interest_1d_score": None,
        "interest_1d_prev": None,
        "interest_1d_delta_pct": None,
        "interest_1d_samples": None,
        "interest_1d_timeframe": _TF_1D,
    }


def _interest_delta_pct(last: Any, prev: Any) -> float | None:
    """(last − prev) / prev as percent. 0→positive is +999 (capped)."""
    try:
        last_f = float(last)
        prev_f = float(prev)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(last_f) or not math.isfinite(prev_f):
        return None
    if abs(prev_f) < 1e-9:
        if abs(last_f) < 1e-9:
            return 0.0
        return 999.0 if last_f > 0 else -999.0
    return round(max(-999.0, min(999.0, (last_f - prev_f) / prev_f * 100.0)), 1)


def _is_warrant_ticker(ticker: str) -> bool:
    t = ticker.strip().upper()
    return len(t) >= 2 and t.endswith("W") and not t.endswith("WW")


_REGULATORY_QUERY = re.compile(
    r"^(pdufa(?:\s+date)?|nda|bla|snda|sbla|crl|adcom|ad com|advisory committee|"
    r"ind|filing|submission|readout|approval)$",
    re.I,
)
_GENERIC_DISEASE = {
    "cancer",
    "tumor",
    "tumour",
    "disease",
    "syndrome",
    "pain",
    "infection",
    "inflammation",
    "disorder",
    "condition",
    "solid tumor",
    "solid tumors",
    "oncology",
}
_SHORT_DISEASE = {"NASH", "SMA", "ALS", "AML", "NSCLC", "SCLC", "COPD", "IPF", "MS"}


def _cell_text(value: Any) -> str:
    if value is None or value == "" or value == "—":
        return ""
    if isinstance(value, dict):
        return str(value.get("text") or "").strip()
    return str(value).strip()


def _clean_molecule_query(raw: str) -> str | None:
    s = re.split(r"[|;,/]", _cell_text(raw), maxsplit=1)[0].strip()
    if not s or _REGULATORY_QUERY.match(s):
        return None
    if re.fullmatch(r"[A-Z]{1,5}", s):
        return None
    if len(s) < 3 or len(s) > 48:
        return None
    return s


def _clean_company_query(raw: str) -> str | None:
    s = re.split(r"[,;(]", _cell_text(raw), maxsplit=1)[0].strip()
    s = re.sub(
        r"\b(incorporated|inc|corporation|corp|limited|ltd|plc|llc|s\.?a\.?|n\.?v\.?|ag|co)\.?\s*$",
        "",
        s,
        flags=re.I,
    ).strip()
    if len(s) < 3 or len(s) > 48:
        return None
    if re.fullmatch(r"[A-Z]{1,5}", s):
        return None
    return s


def _clean_indication_query(raw: str) -> str | None:
    s = re.split(r"[|;]", _cell_text(raw), maxsplit=1)[0].strip()
    s = s.split(",")[0].strip()
    if not s or _REGULATORY_QUERY.match(s):
        return None
    if s.lower() in _GENERIC_DISEASE:
        return None
    if len(s) <= 4:
        return s.upper() if s.upper() in _SHORT_DISEASE else None
    if len(s) > 40:
        s = s[:40].rstrip()
    return s


def queries_for_ticker(
    ticker: str,
    aliases: dict[str, dict[str, str]] | None = None,
) -> list[tuple[str, str]]:
    """Ticker + company name + product (when known)."""
    tk = ticker.strip().upper()
    if not tk:
        return []
    slot = (aliases if aliases is not None else _trends_alias_catalog()).get(tk) or {}
    out: list[tuple[str, str]] = [("ticker", tk)]
    seen = {tk.lower()}
    company = _clean_company_query(str(slot.get("company") or ""))
    product = _clean_molecule_query(str(slot.get("molecule") or slot.get("product") or ""))
    if company and company.lower() not in seen:
        seen.add(company.lower())
        out.append(("company", company))
    if product and product.lower() not in seen:
        out.append(("product", product))
    return out


_alias_cache: dict[str, dict[str, str]] | None = None
_alias_cache_at = 0.0


def _trends_alias_catalog() -> dict[str, dict[str, str]]:
    """Ticker → molecule / indication from Simulation + guidance snapshots."""
    global _alias_cache, _alias_cache_at
    now = time.time()
    if _alias_cache is not None and now - _alias_cache_at < 300:
        return _alias_cache
    catalog: dict[str, dict[str, str]] = {}

    def _put(tk: str, *, molecule: str = "", indication: str = "", company: str = "") -> None:
        t = tk.strip().upper()
        if not t or _is_warrant_ticker(t):
            return
        slot = catalog.setdefault(t, {})
        mol = _clean_molecule_query(molecule)
        ind = _clean_indication_query(indication)
        co = _clean_company_query(company)
        if mol and not slot.get("molecule"):
            slot["molecule"] = mol
        if ind and not slot.get("indication"):
            slot["indication"] = ind
        if co and not slot.get("company"):
            slot["company"] = co

    try:
        from orchestrator_io_paths import SIMULATION_SHEET_SNAPSHOT_JSON

        p = Path(SIMULATION_SHEET_SNAPSHOT_JSON)
        if p.is_file():
            doc = json.loads(p.read_text(encoding="utf-8"))
            if isinstance(doc, dict):
                for row in doc.get("rows") or []:
                    if not isinstance(row, dict):
                        continue
                    tk = str(row.get("Ticker") or row.get("ticker") or "").strip().upper()
                    _put(
                        tk,
                        molecule=str(
                            row.get("guidance_asset_name")
                            or row.get("Drug")
                            or row.get("Farmaco")
                            or row.get("Asset")
                            or ""
                        ),
                        indication=str(
                            row.get("guidance_indication")
                            or row.get("Indication")
                            or row.get("Indicazione")
                            or ""
                        ),
                        company=str(
                            row.get("Company")
                            or row.get("Società")
                            or row.get("company")
                            or ""
                        ),
                    )
    except (OSError, json.JSONDecodeError, TypeError, ImportError):
        pass

    guidance_path = Path("data") / "guidance_calendar_snapshot.json"
    if guidance_path.is_file():
        try:
            gdoc = json.loads(guidance_path.read_text(encoding="utf-8"))
            events = gdoc.get("events") if isinstance(gdoc, dict) else None
            for ev in events or []:
                if not isinstance(ev, dict):
                    continue
                _put(
                    str(ev.get("ticker") or ""),
                    molecule=str(ev.get("asset_name") or ""),
                    indication=str(ev.get("indication") or ""),
                    company=str(ev.get("company") or ""),
                )
        except (OSError, json.JSONDecodeError, TypeError):
            pass
    fda_path = Path("data") / "fda_adcom_calendar_snapshot.json"
    if fda_path.is_file():
        try:
            fdoc = json.loads(fda_path.read_text(encoding="utf-8"))
            for row in (fdoc.get("rows") if isinstance(fdoc, dict) else None) or []:
                if not isinstance(row, dict):
                    continue
                _put(
                    str(row.get("ticker") or ""),
                    molecule=str(row.get("product") or ""),
                    company=str(row.get("company") or ""),
                )
        except (OSError, json.JSONDecodeError, TypeError):
            pass
    _alias_cache = catalog
    _alias_cache_at = now
    return catalog


def row_from_series(ticker: str, values: list[float]) -> dict[str, Any]:
    """Last print vs prior 20-day baseline. Spike at z >= 2.0."""
    row = _empty_row(ticker, stale=False)
    if not values:
        row["stale"] = True
        return row
    last = float(values[-1])
    prev = float(values[-2]) if len(values) >= 2 else None
    prior = values[-1 - _BASELINE_DAYS : -1] if len(values) > 1 else []
    if len(prior) < 5:
        prior = values[:-1] if len(values) > 1 else values
    baseline = float(statistics.fmean(prior)) if prior else last
    if len(prior) >= 2:
        std = float(statistics.stdev(prior))
    else:
        std = 0.0
    # Trends is 0–100; a flat 20-day window has std=0, so a real jump must still score.
    std = max(std, 1.0)
    z = (last - baseline) / std
    row["interest_score"] = last
    row["prev_interest_score"] = prev
    row["interest_delta_pct"] = _interest_delta_pct(last, prev)
    row["rolling_baseline_20d"] = round(baseline, 3)
    row["zscore_vs_baseline"] = round(z, 3)
    row["search_spike"] = z >= _SPIKE_Z
    return row


def short_fields_from_series(values: list[float]) -> dict[str, Any]:
    """~24h window (``now 1-d``): last sample vs previous sample — display only."""
    if not values:
        return {
            "interest_1d_score": None,
            "interest_1d_prev": None,
            "interest_1d_delta_pct": None,
            "interest_1d_samples": 0,
            "interest_1d_timeframe": _TF_1D,
        }
    last = float(values[-1])
    prev = float(values[-2]) if len(values) >= 2 else None
    return {
        "interest_1d_score": last,
        "interest_1d_prev": prev,
        "interest_1d_delta_pct": _interest_delta_pct(last, prev) if prev is not None else None,
        "interest_1d_samples": len(values),
        "interest_1d_timeframe": _TF_1D,
    }


def _copy_short_fields(src: dict[str, Any] | None, dest: dict[str, Any]) -> None:
    if not src:
        return
    for key in _SHORT_KEYS:
        if src.get(key) is not None:
            dest[key] = src[key]


def _read_cache(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def _write_cache(path: Path, row: dict[str, Any]) -> None:
    _write_json(path, row)


def _print_date(print_row: dict[str, Any]) -> date | None:
    raw = print_row.get("at") or print_row.get("date")
    if not raw:
        return None
    text = str(raw).replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(text).date()
    except ValueError:
        try:
            return date.fromisoformat(text[:10])
        except ValueError:
            return None


def _history_prints(ticker: str) -> list[dict[str, Any]]:
    existing = _read_cache(_HISTORY_DIR / f"{ticker}.json")
    prints = existing.get("prints") if existing else None
    if not isinstance(prints, list):
        return []
    return [p for p in prints if isinstance(p, dict)]


def _nyse_closed(today: date | None = None) -> bool:
    try:
        from us_equity_session import is_nyse_trading_day

        ok, _ = is_nyse_trading_day(today)
        return not ok
    except Exception:
        return False


def _last_nasdaq_session_date(today: date | None = None) -> date:
    try:
        from us_equity_session import last_regular_session_close, ny_now

        ref = None
        if today is not None:
            ref = datetime(today.year, today.month, today.day, 12, 0, tzinfo=timezone.utc)
            ref = ny_now(ref)
        return last_regular_session_close(ref).date()
    except Exception:
        d = today or datetime.now().date()
        step = 1
        while step <= 7:
            cand = date.fromordinal(d.toordinal() - step)
            if cand.weekday() < 5:
                return cand
            step += 1
        return d


def _score_on_or_before(prints: list[dict[str, Any]], session: date) -> float | None:
    for p in reversed(prints):
        d = _print_date(p)
        if d is None or d > session:
            continue
        try:
            val = float(p.get("interest_score"))
        except (TypeError, ValueError):
            continue
        if math.isfinite(val):
            return val
    return None


def _has_print_after(prints: list[dict[str, Any]], session: date) -> bool:
    return any((d := _print_date(p)) is not None and d > session for p in prints)


def _apply_closed_session_delta(row: dict[str, Any], ticker: str) -> dict[str, Any]:
    """On weekend/holiday: now vs last print from the last NASDAQ session."""
    out = _hydrate_interest_delta(row, ticker)
    if not _nyse_closed():
        return out
    prints = _history_prints(ticker)
    session = _last_nasdaq_session_date()
    prev = _score_on_or_before(prints, session)
    if prev is None:
        out["delta_basis"] = "previous_print"
        return out
    last = out.get("interest_score")
    out["prev_interest_score"] = prev
    out["interest_delta_pct"] = _interest_delta_pct(last, prev)
    out["delta_basis"] = "weekend_vs_last_nasdaq"
    out["nasdaq_session_date"] = session.isoformat()
    return out


def _hydrate_interest_delta(row: dict[str, Any], ticker: str) -> dict[str, Any]:
    """Fill % vs previous print on older cache that only stored the z-score."""
    out = dict(row)
    if out.get("interest_delta_pct") is not None and out.get("prev_interest_score") is not None:
        return out
    prev = out.get("prev_interest_score")
    basis = out.get("delta_basis") or "previous_print"
    if prev is None:
        prints = _history_prints(ticker)
        if len(prints) >= 2:
            prev = prints[-2].get("interest_score")
        elif prints:
            last_hist = prints[-1].get("interest_score")
            if last_hist != out.get("interest_score"):
                prev = last_hist
    # Older caches often have a single print and no prev — use 20d baseline so the UI
    # can still show a % instead of a blank cell.
    if prev is None:
        bas = out.get("rolling_baseline_20d")
        try:
            bas_f = float(bas)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            bas_f = None
        if bas_f is not None and math.isfinite(bas_f):
            prev = bas_f
            basis = "vs_baseline_20d"
    out["prev_interest_score"] = prev
    out["interest_delta_pct"] = _interest_delta_pct(out.get("interest_score"), prev)
    if out.get("interest_delta_pct") is not None and out.get("delta_basis") is None:
        out["delta_basis"] = basis
    elif basis == "vs_baseline_20d" and out.get("interest_delta_pct") is not None:
        out["delta_basis"] = basis
    return out


def _persist_live_row(ticker: str, row: dict[str, Any]) -> dict[str, Any]:
    """Write ticker cache and append a history print (Δ z vs last poll)."""
    stored = dict(row)
    hist_path = _HISTORY_DIR / f"{ticker}.json"
    prints: list[dict[str, Any]] = []
    existing = _read_cache(hist_path)
    if existing and isinstance(existing.get("prints"), list):
        prints = [p for p in existing["prints"] if isinstance(p, dict)]
    prev_z = prints[-1].get("zscore_vs_baseline") if prints else None
    z = stored.get("zscore_vs_baseline")
    delta: float | None = None
    if z is not None and prev_z is not None:
        try:
            delta = round(float(z) - float(prev_z), 3)
        except (TypeError, ValueError):
            delta = None
    stored["zscore_delta"] = delta
    if stored.get("prev_interest_score") is None and prints:
        stored["prev_interest_score"] = prints[-1].get("interest_score")
    if stored.get("interest_delta_pct") is None:
        stored["interest_delta_pct"] = _interest_delta_pct(
            stored.get("interest_score"),
            stored.get("prev_interest_score"),
        )
    stored = _apply_closed_session_delta(stored, ticker)
    prints.append(
        {
            "at": _now_iso(),
            "interest_score": stored.get("interest_score"),
            "prev_interest_score": stored.get("prev_interest_score"),
            "interest_delta_pct": stored.get("interest_delta_pct"),
            "zscore_vs_baseline": z,
            "search_spike": bool(stored.get("search_spike")),
            "zscore_delta": delta,
        }
    )
    _write_json(hist_path, {"ticker": ticker, "prints": prints[-_HISTORY_MAX:]})
    _write_cache(_CACHE_DIR / f"{ticker}.json", stored)
    return stored


def _google_blocked() -> bool:
    return time.time() < _circuit_until


def _trip_circuit(exc: BaseException) -> None:
    """Pause live Google calls so one 429 cannot pin every user request."""
    global _circuit_until
    msg = str(exc).lower()
    if any(s in msg for s in ("429", "503", "timeout", "timed out", "too many")):
        _circuit_until = time.time() + _CIRCUIT_S
        logger.warning("search-interest circuit open for %ss (%s)", _CIRCUIT_S, exc)


def _live_fetch_series(query: str, timeframe: str = _TF_BASELINE) -> list[float] | None:
    """Unofficial Google Trends series (0–100). Isolated so tests can mock."""
    try:
        from pytrends.request import TrendReq
    except ImportError:
        raise RuntimeError("pytrends_missing") from None
    term = str(query).strip()
    if not term:
        return None
    tf = str(timeframe or _TF_BASELINE).strip() or _TF_BASELINE
    # Short timeouts, no retries: a hung Trends call must not occupy a request thread.
    pt = TrendReq(hl="en-US", tz=360, timeout=(2, 4), retries=0, backoff_factor=0)
    pt.build_payload([term], cat=0, timeframe=tf, geo="US")
    df = pt.interest_over_time()
    if df is None or getattr(df, "empty", True):
        return None
    cols = [c for c in df.columns if str(c) != "isPartial"]
    if not cols:
        return None
    col = term if term in df.columns else cols[0]
    return [float(v) for v in df[col].tolist() if v is not None]


def _row_from_query(ticker: str, kind: str, term: str, series: list[float]) -> dict[str, Any]:
    row = row_from_series(ticker, series)
    row["query_term"] = term
    row["query_kind"] = kind
    return row


def _leg_payload(kind: str, term: str, series: list[float], ticker: str) -> dict[str, Any]:
    row = _row_from_query(ticker, kind, term, series)
    return {
        "kind": kind,
        "term": term,
        "interest_score": row.get("interest_score"),
        "prev_interest_score": row.get("prev_interest_score"),
        "interest_delta_pct": row.get("interest_delta_pct"),
        "zscore_vs_baseline": row.get("zscore_vs_baseline"),
        "search_spike": bool(row.get("search_spike")),
    }


def _attach_1d_window(
    row: dict[str, Any],
    term: str,
    *,
    cached: dict[str, Any] | None = None,
    wait: bool = True,
) -> dict[str, Any]:
    """Add ``now 1-d`` Δ% next to the 3-m baseline. Soft BUY/SELL untouched."""
    series: list[float] | None = None
    try:
        series = _fetch_one_live(term, _TF_1D, wait=wait)
    except Exception as exc:
        logger.warning("search-interest 1d %s: %s", term, exc)
        series = None
    if series:
        row.update(short_fields_from_series(series))
    else:
        _copy_short_fields(cached, row)
    return row


def _fetch_best_for_ticker(ticker: str) -> dict[str, Any] | None:
    """Live-fetch ticker + company + product Trends when aliases exist."""
    tk = ticker.strip().upper()
    if not tk:
        return None
    cached = _read_cache(_CACHE_DIR / f"{tk}.json")
    queries = queries_for_ticker(tk)
    legs: list[dict[str, Any]] = []
    primary: dict[str, Any] | None = None
    for kind, term in queries:
        try:
            series = _fetch_one_live(term, _TF_BASELINE)
        except Exception as exc:
            logger.warning("search-interest %s %s: %s", tk, term, exc)
            series = None
        if not series:
            continue
        legs.append(_leg_payload(kind, term, series, tk))
        row = _row_from_query(tk, kind, term, series)
        if primary is None or kind == "ticker":
            primary = row
    if primary is None:
        return None
    # Prefer a scored ticker print; accept company/product if ticker series was empty.
    if _finite_z(primary) is None and primary.get("interest_score") is None:
        return None
    primary["legs"] = legs
    _attach_1d_window(primary, str(primary.get("query_term") or tk), cached=cached)
    return primary


def _fetch_ticker_fast(ticker: str, *, wait: bool = False) -> dict[str, Any] | None:
    """One Google Trends query on the symbol — request path never waits.

    The 1-day window is filled by the background warmer. Doing it inline
    doubled the time a user request held the shared Google lock.
    """
    tk = ticker.strip().upper()
    if not tk or _google_blocked():
        return None
    cached = _read_cache(_CACHE_DIR / f"{tk}.json")
    try:
        series = _fetch_one_live(tk, _TF_BASELINE, wait=wait)
    except Exception as exc:
        logger.warning("search-interest %s ticker-fast: %s", tk, exc)
        return None
    if not series:
        return None
    row = _row_from_query(tk, "ticker", tk, series)
    if row.get("interest_score") is None and _finite_z(row) is None:
        return None
    row["legs"] = [_leg_payload("ticker", tk, series, tk)]
    _attach_1d_window(row, tk, cached=cached, wait=wait)
    return row


def _legs_incomplete(cached: dict[str, Any] | None, ticker: str) -> bool:
    wanted = {k for k, _ in queries_for_ticker(ticker)}
    have = {
        str(leg.get("kind") or "")
        for leg in (cached.get("legs") if cached else None) or []
        if isinstance(leg, dict)
    }
    return bool(wanted - have)


def _cache_covers_preferred_query(cached: dict[str, Any] | None, ticker: str) -> bool:
    """Any scored print is usable. Molecule/disease can warm in the background."""
    if not cached:
        return False
    score = cached.get("interest_score")
    z = cached.get("zscore_vs_baseline")
    try:
        if score is not None and float(score) == float(score):
            return True
    except (TypeError, ValueError):
        pass
    try:
        return z is not None and float(z) == float(z)
    except (TypeError, ValueError):
        return False


def _wants_richer_query(cached: dict[str, Any] | None, ticker: str) -> bool:
    """Ticker-only cache while a molecule/disease alias exists — keep showing, re-warm."""
    if not cached:
        return False
    kind = str(cached.get("query_kind") or "ticker")
    if kind != "ticker":
        return False
    return any(k != "ticker" for k, _ in queries_for_ticker(ticker))


def _warm_one(tk: str) -> None:
    if _google_blocked():
        return
    cache_path = _CACHE_DIR / f"{tk}.json"
    cached = _read_cache(cache_path)
    if (
        cached
        and cache_path.is_file()
        and time.time() - cache_path.stat().st_mtime < _TTL_S
        and cached.get("interest_score") is not None
        and not _legs_incomplete(cached, tk)
    ):
        return
    try:
        row = _fetch_best_for_ticker(tk)
    except Exception as exc:  # pytrends / Google flake
        logger.warning("search-interest warm %s: %s", tk, exc)
        row = None
    if row:
        _persist_live_row(tk, row)


def _warm_loop() -> None:
    """One background thread for the whole process — not one thread per desk load."""
    while True:
        tk: str | None = None
        with _warm_lock:
            if _warm_queue:
                tk = _warm_queue.pop(0)
        if tk is None:
            time.sleep(0.4)
            continue
        if _google_blocked():
            with _warm_lock:
                _warming.discard(tk)
            time.sleep(2.0)
            continue
        try:
            _warm_one(tk)
        finally:
            with _warm_lock:
                _warming.discard(tk)


def _schedule_warm(tickers: list[str]) -> None:
    global _warm_thread_started
    if not _WARMER_ENABLED or not tickers or _google_blocked():
        return
    with _warm_lock:
        queued = set(_warm_queue)
        for tk in tickers:
            if tk in _warming or tk in queued:
                continue
            _warming.add(tk)
            _warm_queue.append(tk)
            queued.add(tk)
        if not _warm_thread_started:
            _warm_thread_started = True
            threading.Thread(
                target=_warm_loop, name="search-interest-warm", daemon=True
            ).start()


def _fetch_one_live(
    ticker: str,
    timeframe: str = _TF_BASELINE,
    *,
    wait: bool = True,
) -> list[float] | None:
    """One paced Trends call.

    Request handlers pass ``wait=False`` and return cache immediately when
    another fetch (or the background warmer) already holds the lock. Waiting
    here used to fill the API thread pool and surface Cloudflare 524.
    """
    global _last_live_at
    if _google_blocked():
        return None
    if not _live_lock.acquire(timeout=8.0 if wait else 0.0):
        return None
    try:
        if _google_blocked():
            return None
        gap = _LIVE_GAP_S - (time.time() - _last_live_at)
        if gap > 0:
            if not wait:
                return None
            time.sleep(gap)
        try:
            return _live_fetch_series(ticker, timeframe)
        except Exception as exc:
            _trip_circuit(exc)
            raise
        finally:
            _last_live_at = time.time()
    finally:
        _live_lock.release()


def fetch_search_interest(tickers: list[str] | str) -> dict[str, Any]:
    cfg = get_supernova_config()
    parts = tickers.replace(";", ",").split(",") if isinstance(tickers, str) else list(tickers)
    wanted: list[str] = []
    seen: set[str] = set()
    for p in parts:
        tk = str(p).strip().upper()
        if not tk or tk in seen:
            continue
        seen.add(tk)
        wanted.append(tk)
    wanted = wanted[:_MAX_TICKERS]
    payload: dict[str, Any] = {
        "updated_at": _now_iso(),
        "enabled": bool(cfg.trends_enabled),
        "method": None,
        "rows": {},
        "error": None,
    }
    if not cfg.trends_enabled:
        payload["error"] = "trends_disabled"
        return payload
    if not wanted:
        payload["error"] = "empty_tickers"
        return payload

    allowed = _allowlist()
    tks = [t for t in wanted if t in allowed] if allowed else wanted
    if not tks:
        payload["error"] = "no_pilot_tickers"
        return payload

    rows: dict[str, Any] = {}
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    now = time.time()
    live_used = 0
    cache_hits = 0
    live_ok = 0
    missing_lib = False
    closed = _nyse_closed()
    live_budget = _MAX_LIVE_CLOSED if closed else _MAX_LIVE_PER_CALL
    session = _last_nasdaq_session_date() if closed else None
    want_now: list[str] = []

    # Prefer uncached / expired names for the live budget so desks fill sooner.
    serve_now: list[str] = []
    need_live: list[str] = []
    for tk in tks:
        cache_path = _CACHE_DIR / f"{tk}.json"
        cached = _read_cache(cache_path)
        has_score = _cache_covers_preferred_query(cached, tk)
        fresh = (
            cached is not None
            and cache_path.is_file()
            and now - cache_path.stat().st_mtime < _TTL_S
            and has_score
        )
        # Always paint desks from the last scored print — never leave Calendar
        # empty while waiting on Google / live budget. Stale rows refresh via warmer.
        if has_score:
            serve_now.append(tk)
            if not fresh:
                want_now.append(tk)
        else:
            need_live.append(tk)

    for tk in serve_now:
        cache_path = _CACHE_DIR / f"{tk}.json"
        cached = _read_cache(cache_path) or {}
        rows[tk] = _apply_closed_session_delta(cached, tk)
        cache_hits += 1
        if closed and session is not None and not _has_print_after(_history_prints(tk), session):
            want_now.append(tk)
        elif _legs_incomplete(cached, tk) or _wants_richer_query(cached, tk):
            want_now.append(tk)

    for tk in need_live:
        cache_path = _CACHE_DIR / f"{tk}.json"
        cached = _read_cache(cache_path)
        if live_used >= live_budget:
            fallback = cached if cached else _empty_row(tk, stale=True)
            fallback["stale"] = True
            rows[tk] = _apply_closed_session_delta(fallback, tk) if cached else fallback
            continue

        live_used += 1
        try:
            # Request path: ticker symbol only (1 Google call). Legs warm in background.
            row = _fetch_ticker_fast(tk)
        except RuntimeError as exc:
            if str(exc) == "pytrends_missing":
                missing_lib = True
            logger.warning("search-interest %s: %s", tk, exc)
            row = None
        except Exception as exc:  # pytrends / Google flake
            logger.warning("search-interest %s failed: %s", tk, exc)
            row = None

        if row:
            rows[tk] = _persist_live_row(tk, row)
            live_ok += 1
            if _legs_incomplete(row, tk) or _wants_richer_query(row, tk):
                want_now.append(tk)
            continue

        if cached:
            cached = _apply_closed_session_delta(cached, tk)
            cached["stale"] = True
            rows[tk] = cached
        else:
            rows[tk] = _empty_row(tk, stale=True)

    missing = [tk for tk in tks if rows.get(tk, {}).get("interest_score") is None]
    # Legs / richer aliases can warm in the background without flagging the HTTP
    # response as "still warming" — otherwise desks retry forever while cells look empty.
    # Skip while Google is rate-limiting: extra warmers were pinning every worker.
    warm = list(dict.fromkeys([*missing, *want_now]))
    if warm and not missing_lib and not _google_blocked():
        _schedule_warm(warm)
    payload["rows"] = rows
    payload["warming"] = bool(missing) and not missing_lib
    if closed:
        payload["session"] = "closed"
        payload["nasdaq_session_date"] = session.isoformat() if session else None
    if missing_lib and live_ok == 0:
        payload["error"] = "pytrends_missing"
        payload["method"] = None
    elif live_ok and cache_hits:
        payload["method"] = "pytrends+cache"
    elif live_ok:
        payload["method"] = "pytrends"
    elif cache_hits:
        payload["method"] = "cache"
    else:
        payload["method"] = "stale"
    return payload


def simulation_tickers_for_trends() -> list[str]:
    """Simulation-universe tickers (no warrants). Empty allowlist = all names."""
    from excel_sheet_reader import tickers_from_simulation_payload
    from orchestrator_io_paths import SIMULATION_SHEET_SNAPSHOT_JSON

    p = Path(SIMULATION_SHEET_SNAPSHOT_JSON)
    raw: list[str] = []
    if p.is_file():
        try:
            doc = json.loads(p.read_text(encoding="utf-8"))
            raw = tickers_from_simulation_payload(doc if isinstance(doc, dict) else {})
        except (OSError, json.JSONDecodeError, TypeError):
            raw = []
    allowed = _allowlist()
    out: list[str] = []
    seen: set[str] = set()
    for tk in raw:
        t = str(tk).strip().upper()
        if not t or t in seen or _is_warrant_ticker(t):
            continue
        if allowed and t not in allowed:
            continue
        seen.add(t)
        out.append(t)
        if len(out) >= _MAX_UNIVERSE:
            break
    return out


def refresh_search_interest_universe(
    tickers: list[str] | None = None,
    *,
    force: bool = True,
) -> dict[str, Any]:
    """Serial live refresh for the Simulation universe (scheduler / boot warm)."""
    cfg = get_supernova_config()
    out: dict[str, Any] = {
        "ok": False,
        "enabled": bool(cfg.trends_enabled),
        "fetched": 0,
        "attempted": 0,
        "skipped_fresh": 0,
        "error": None,
    }
    if not cfg.trends_enabled:
        out["error"] = "trends_disabled"
        return out
    tks = list(tickers) if tickers is not None else simulation_tickers_for_trends()
    out["attempted"] = len(tks)
    if not tks:
        out["error"] = "empty_universe"
        return out
    now = time.time()
    fetched = 0
    skipped = 0
    for tk in tks:
        cache_path = _CACHE_DIR / f"{tk}.json"
        cached = _read_cache(cache_path)
        fresh = (
            not force
            and cached is not None
            and cache_path.is_file()
            and now - cache_path.stat().st_mtime < _TTL_S
            and _cache_covers_preferred_query(cached, tk)
        )
        if fresh:
            skipped += 1
            continue
        try:
            row = _fetch_best_for_ticker(tk)
        except Exception as exc:
            logger.warning("search-interest refresh %s: %s", tk, exc)
            continue
        if not row:
            continue
        _persist_live_row(tk, row)
        fetched += 1
    out["ok"] = True
    out["fetched"] = fetched
    out["skipped_fresh"] = skipped
    return out


def _finite_z(row: dict[str, Any]) -> float | None:
    z = row.get("zscore_vs_baseline")
    try:
        zf = float(z)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return zf if math.isfinite(zf) else None


def leaders_from_cache(
    *,
    limit: int = 10,
    universe: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Highest Trends z-score / spike first. Cache only — no live Google calls."""
    allowed = {t.strip().upper() for t in universe} if universe else None
    ranked: list[dict[str, Any]] = []
    if not _CACHE_DIR.is_dir():
        return []
    for path in _CACHE_DIR.glob("*.json"):
        tk = path.stem.strip().upper()
        if not tk or _is_warrant_ticker(tk):
            continue
        if allowed is not None and tk not in allowed:
            continue
        cached = _read_cache(path)
        if not cached:
            continue
        z = _finite_z(cached)
        if z is None:
            continue
        row = _hydrate_interest_delta(cached, tk)
        row["ticker"] = str(row.get("ticker") or tk).strip().upper() or tk
        ranked.append(row)
    ranked.sort(
        key=lambda r: (
            0 if r.get("search_spike") else 1,
            -(_finite_z(r) or 0.0),
            -float(r.get("interest_score") or 0.0),
        )
    )
    cap = max(1, min(int(limit), 20))
    return ranked[:cap]


def fetch_search_interest_leaders(limit: int = 10) -> dict[str, Any]:
    """Decision-desk payload: Simulation names with the highest Trends scores."""
    cfg = get_supernova_config()
    payload: dict[str, Any] = {
        "updated_at": _now_iso(),
        "enabled": bool(cfg.trends_enabled),
        "method": "cache",
        "rows": {},
        "leaders": [],
        "universe_size": 0,
        "error": None,
        "warming": False,
    }
    if not cfg.trends_enabled:
        payload["error"] = "trends_disabled"
        return payload
    universe = simulation_tickers_for_trends()
    payload["universe_size"] = len(universe)
    leaders = leaders_from_cache(
        limit=limit,
        universe=universe or None,
    )
    rows = {str(r.get("ticker") or "").upper(): r for r in leaders if r.get("ticker")}
    payload["leaders"] = [
        {
            "ticker": r.get("ticker"),
            "interest_score": r.get("interest_score"),
            "prev_interest_score": r.get("prev_interest_score"),
            "interest_delta_pct": r.get("interest_delta_pct"),
            "zscore_vs_baseline": r.get("zscore_vs_baseline"),
            "zscore_delta": r.get("zscore_delta"),
            "search_spike": bool(r.get("search_spike")),
            "stale": bool(r.get("stale")),
        }
        for r in leaders
    ]
    payload["rows"] = rows
    payload["warming"] = bool(universe) and not leaders
    return payload
