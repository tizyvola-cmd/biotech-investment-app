"""
Thin client for sec-api.io — Form 4, Schedule 13D/13G, Form 8-K Item 5.02.

Used by Silent Money (strict sense: insider / specialist positioning that
moves before the catalyst is public). Display only — not Soft BUY/SELL.

Auth: SEC_API_KEY or SEC_API_IO_KEY in the environment (Authorization header,
no Bearer prefix). When the key is absent every call returns None and callers
fall back to FMP / clinical cache — never invent prints.
"""
from __future__ import annotations

import json
import logging
import os
import time
import urllib.error
import urllib.request
from datetime import date, timedelta
from typing import Any

logger = logging.getLogger("supernova.sec_api")

_TIMEOUT_S = 25
_UA = "SuperNovaSilentMoney/1.0 (biotech-desk; contact=local)"
# Free tier is ~100 queries; once we hit 429, skip further calls for a cool-down.
_RATE_LIMITED_UNTIL = 0.0
_RATE_LIMIT_COOLDOWN_S = 6 * 60 * 60


def sec_api_key() -> str | None:
    for env in ("SEC_API_KEY", "SEC_API_IO_KEY"):
        v = (os.environ.get(env) or "").strip()
        if v:
            return v
    return None


def sec_api_rate_limited() -> bool:
    return time.time() < _RATE_LIMITED_UNTIL


def _mark_rate_limited(*, seconds: float | None = None) -> None:
    global _RATE_LIMITED_UNTIL
    _RATE_LIMITED_UNTIL = time.time() + float(seconds or _RATE_LIMIT_COOLDOWN_S)
    logger.warning(
        "sec-api rate limited — pausing calls for %.0fh (fallback to EDGAR/FMP)",
        (_RATE_LIMITED_UNTIL - time.time()) / 3600.0,
    )


def _post(path: str, body: dict[str, Any]) -> dict[str, Any] | None:
    key = sec_api_key()
    if not key:
        return None
    if sec_api_rate_limited():
        return None
    url = f"https://api.sec-api.io{path}"
    raw = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=raw,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Accept-Encoding": "gzip",
            "Authorization": key,
            "User-Agent": _UA,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT_S) as resp:
            payload = resp.read()
            encoding = (resp.headers.get("Content-Encoding") or "").lower()
            if encoding == "gzip" or payload[:2] == b"\x1f\x8b":
                import gzip

                payload = gzip.decompress(payload)
            doc = json.loads(payload.decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code == 429:
            _mark_rate_limited()
        logger.warning("sec-api %s failed: %s", path, exc)
        return None
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
        logger.warning("sec-api %s failed: %s", path, exc)
        return None
    return doc if isinstance(doc, dict) else None


def _lookback_iso(days: int, *, today: date | None = None) -> tuple[str, str]:
    ref = today or date.today()
    start = (ref - timedelta(days=int(days))).isoformat()
    return start, ref.isoformat()


def fetch_insider_form4(
    ticker: str,
    *,
    lookback_days: int = 30,
    today: date | None = None,
    size: int = 50,
) -> list[dict[str, Any]] | None:
    """
    Open-market Form 4 activity for ``ticker`` (sec-api Insider Trading API).
    Returns None if no API key / request failed; [] if key ok but no hits.
    """
    if not sec_api_key():
        return None
    tk = ticker.strip().upper()
    start, end = _lookback_iso(lookback_days, today=today)
    # Prefer open-market purchases (code P); still pull sales so net can be computed
    # while excluding 10b5-1 via aff10b5One / footnotes downstream.
    query = (
        f"issuer.tradingSymbol:{tk} AND documentType:4 "
        f"AND periodOfReport:[{start} TO {end}]"
    )
    doc = _post(
        "/insider-trading",
        {
            "query": query,
            "from": "0",
            "size": str(size),
            "sort": [{"filedAt": {"order": "desc"}}],
        },
    )
    if doc is None:
        return None
    rows = doc.get("transactions") or doc.get("data") or []
    return [r for r in rows if isinstance(r, dict)]


def fetch_schedule_13d_13g(
    ticker: str,
    *,
    lookback_days: int = 90,
    today: date | None = None,
    size: int = 20,
) -> list[dict[str, Any]] | None:
    """Recent Schedule 13D / 13G (and amendments) naming ``ticker``."""
    if not sec_api_key():
        return None
    tk = ticker.strip().upper()
    start, end = _lookback_iso(lookback_days, today=today)
    # ticker field is indexed on many 13D/G records; also try nameOfIssuer fallbacks upstream.
    query = f"ticker:{tk} AND filedAt:[{start} TO {end}]"
    doc = _post(
        "/form-13d-13g",
        {
            "query": query,
            "from": "0",
            "size": str(size),
            "sort": [{"filedAt": {"order": "desc"}}],
        },
    )
    if doc is None:
        return None
    rows = doc.get("filings") or doc.get("data") or []
    return [r for r in rows if isinstance(r, dict)]


def fetch_8k_item_502(
    ticker: str,
    *,
    lookback_days: int = 60,
    today: date | None = None,
    size: int = 20,
) -> list[dict[str, Any]] | None:
    """
    Structured 8-K Item 5.02 personnel changes (appointments / departures).

    Queries the Form 8-K API for Item 5.02 — officer/director left or appointed.
    """
    if not sec_api_key():
        return None
    tk = ticker.strip().upper()
    start, end = _lookback_iso(lookback_days, today=today)
    # Prefer structured item5_02; fall back to items text match for sparse coverage.
    queries = (
        f'ticker:{tk} AND item5_02:* AND filedAt:[{start} TO {end}]',
        f'ticker:{tk} AND items:"5.02" AND filedAt:[{start} TO {end}]',
    )
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for query in queries:
        doc = _post(
            "/form-8k",
            {
                "query": query,
                "from": "0",
                "size": str(size),
                "sort": [{"filedAt": {"order": "desc"}}],
            },
        )
        if doc is None:
            # Rate-limit / transport failure — do not claim an empty successful scan.
            if sec_api_rate_limited():
                return None
            continue
        rows = doc.get("data") or doc.get("filings") or []
        for r in rows:
            if not isinstance(r, dict):
                continue
            key = str(r.get("accessionNo") or r.get("id") or r.get("filedAt") or "")
            if key and key in seen:
                continue
            if key:
                seen.add(key)
            out.append(r)
        if out:
            break
    return out
