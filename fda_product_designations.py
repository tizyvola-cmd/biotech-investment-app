"""
FDA product designations lookup
================================
Top KPI Designation column: prefer Discovery (calendar identity), then
FDA-site hits for the product name (Google News RSS scoped to fda.gov +
OOPD orphan search page when reachable).

Display / enrichment only — does not change Soft BUY/SELL.
"""

from __future__ import annotations

import json
import logging
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger("supernova.fda_product_designations")

_CACHE_DIR = Path("data") / "cache"
_PATH = _CACHE_DIR / "fda_product_designations.json"
_CACHE_TTL_SEC = int(3600 * 24 * 7)  # 7 days
_MAX_BATCH = 40
_UA = "SuperNova/1.0 (biotech designation research; +https://localhost)"

# Same labels as calendar_identity / calendarPhase1
_DESIGNATION_MAP: list[tuple[str, str]] = [
    ("breakthrough therapy", "Breakthrough Therapy"),
    ("fast track", "Fast Track"),
    ("orphan drug", "Orphan Drug"),
    ("orphan designation", "Orphan Drug"),
    ("rmat", "RMAT"),
    ("regenerative medicine advanced therapy", "RMAT"),
    ("accelerated approval", "Accelerated Approval"),
    ("priority review", "Priority Review"),
    ("rare pediatric", "Rare Pediatric Disease"),
]

_NULLISH = re.compile(r"^(n/?d|nd|none|null|unknown|—|-)$", re.I)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_cache() -> dict[str, Any]:
    try:
        if _PATH.is_file():
            doc = json.loads(_PATH.read_text(encoding="utf-8"))
            return doc if isinstance(doc, dict) else {}
    except Exception:
        pass
    return {"updated_at": None, "by_product": {}}


def _write_cache(doc: dict[str, Any]) -> None:
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    doc["updated_at"] = _now_iso()
    _PATH.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _norm_product(raw: str | None) -> str:
    s = re.sub(r"\s+", " ", str(raw or "").strip())
    if not s or _NULLISH.match(s):
        return ""
    # Drop placebo / control tokens
    if re.match(r"^(placebo|vehicle|sham|control|saline)$", s, re.I):
        return ""
    return s


def _product_key(product: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", product.lower())


def designations_from_blob(blob: str) -> list[str]:
    low = (blob or "").lower()
    out: list[str] = []
    for needle, label in _DESIGNATION_MAP:
        if needle in low and label not in out:
            out.append(label)
    return out


def normalize_ai_designation(raw: str | None) -> str | None:
    """BreakthroughTherapy → Breakthrough Therapy; keep known labels only when possible."""
    s = str(raw or "").strip()
    if not s or _NULLISH.match(s):
        return None
    spaced = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", s)
    spaced = re.sub(r"[_-]+", " ", spaced)
    spaced = re.sub(r"\s+", " ", spaced).strip()
    found = designations_from_blob(spaced)
    if found:
        return found[0]
    # Allow already-canonical labels
    for _, label in _DESIGNATION_MAP:
        if spaced.lower() == label.lower():
            return label
    return spaced if len(spaced) <= 48 else None


def _http_get(url: str, *, timeout: float = 14.0) -> bytes | None:
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except Exception as exc:
        logger.debug("GET failed %s: %s", url[:80], exc)
        return None


def _search_fda_google_news(product: str) -> tuple[list[str], list[dict[str, str]]]:
    """site:fda.gov headlines mentioning product + designation language."""
    from press_release_fetch import _fetch_google_news_rss

    q = (
        f'site:fda.gov "{product}" '
        f'(orphan OR breakthrough OR "fast track" OR RMAT OR '
        f'"priority review" OR "accelerated approval" OR designation)'
    )
    items = _fetch_google_news_rss(q, max_items=8)
    found: list[str] = []
    sources: list[dict[str, str]] = []
    for it in items:
        title = str(it.get("title") or "")
        summary = str(it.get("summary") or "")
        link = str(it.get("link") or it.get("url") or "").strip()
        # Prefer hits that mention the product (avoid loose site noise)
        blob = f"{title} {summary}"
        if product.lower() not in blob.lower() and len(product) > 3:
            # Still accept if designation language is strong and title cites FDA
            if "fda" not in blob.lower():
                continue
        for d in designations_from_blob(blob):
            if d not in found:
                found.append(d)
                sources.append(
                    {
                        "label": d,
                        "title": title[:160],
                        "url": link,
                        "via": "fda.gov_news",
                    }
                )
    return found, sources


def _search_oopd_orphan(product: str) -> tuple[list[str], list[dict[str, str]]]:
    """
    FDA Orphan Drug Designations searchable DB (form GET fallback).
    https://www.accessdata.fda.gov/scripts/opdlisting/oopd/
    """
    # Historical CFM endpoints accept Product_Name / Search as query params on some builds.
    base = "https://www.accessdata.fda.gov/scripts/opdlisting/oopd/index.cfm"
    params = urllib.parse.urlencode(
        {
            "Product_Name": product,
            "Output_Format": "1",  # condensed list when supported
        }
    )
    raw = _http_get(f"{base}?{params}")
    if not raw:
        # Alternate query shape
        params2 = urllib.parse.urlencode({"SearchTerm": product, "SearchField": "Product"})
        raw = _http_get(f"{base}?{params2}")
    if not raw:
        return [], []
    text = raw.decode("utf-8", "replace")
    # Must look like a result page mentioning the product or "orphan"
    low = text.lower()
    if product.lower() not in low and "orphan" not in low:
        return [], []
    # Heuristic: presence of result rows + orphan wording near product
    window = 0
    pl = product.lower()
    idx = low.find(pl)
    if idx >= 0:
        window_blob = low[max(0, idx - 400) : idx + 800]
    else:
        window_blob = low[:5000]
    found: list[str] = []
    sources: list[dict[str, str]] = []
    if "orphan" in window_blob or "designation" in window_blob:
        # If product appears on OOPD results, treat as Orphan Drug
        if pl in low and ("no records" not in low and "0 records" not in low):
            found.append("Orphan Drug")
            sources.append(
                {
                    "label": "Orphan Drug",
                    "title": f"OOPD hit for {product}",
                    "url": f"{base}?{params}",
                    "via": "fda_oopd",
                }
            )
    for d in designations_from_blob(window_blob):
        if d not in found:
            found.append(d)
    return found, sources


def lookup_product_fda(product: str, *, force: bool = False) -> dict[str, Any]:
    """Live FDA-site search for one product name (cached)."""
    product = _norm_product(product)
    if not product:
        return {
            "product": None,
            "designations": [],
            "sources": [],
            "status": "empty_product",
        }

    key = _product_key(product)
    cache = _read_cache()
    by_product = cache.setdefault("by_product", {})
    prev = by_product.get(key) if isinstance(by_product, dict) else None
    if (
        not force
        and isinstance(prev, dict)
        and prev.get("checked_at")
        and (time.time() - float(prev.get("checked_ts") or 0)) < _CACHE_TTL_SEC
    ):
        return {
            "product": product,
            "designations": list(prev.get("designations") or []),
            "sources": list(prev.get("sources") or []),
            "status": "cache",
            "checked_at": prev.get("checked_at"),
        }

    designations: list[str] = []
    sources: list[dict[str, str]] = []

    try:
        d1, s1 = _search_fda_google_news(product)
        for d in d1:
            if d not in designations:
                designations.append(d)
        sources.extend(s1)
    except Exception as exc:
        logger.info("FDA news search failed for %s: %s", product, exc)

    # OOPD only if still missing Orphan — avoid unnecessary FDA hits
    if "Orphan Drug" not in designations:
        try:
            d2, s2 = _search_oopd_orphan(product)
            for d in d2:
                if d not in designations:
                    designations.append(d)
            sources.extend(s2)
        except Exception as exc:
            logger.debug("OOPD search failed for %s: %s", product, exc)

    entry = {
        "product": product,
        "designations": designations,
        "sources": sources[:12],
        "checked_at": _now_iso(),
        "checked_ts": time.time(),
    }
    by_product[key] = entry
    cache["by_product"] = by_product
    try:
        _write_cache(cache)
    except Exception:
        pass
    return {
        "product": product,
        "designations": designations,
        "sources": sources[:12],
        "status": "live",
        "checked_at": entry["checked_at"],
    }


def discovery_designations_for_ticker(ticker: str) -> list[str]:
    """Regulatory designations already mined from Discovery → calendar identity."""
    tk = str(ticker or "").strip().upper()
    if not tk:
        return []
    try:
        from calendar_identity import load_identity_index

        idx = load_identity_index()
        row = (idx.get("by_ticker") or {}).get(tk) or {}
        out: list[str] = []
        for d in row.get("regulatory_designations") or []:
            s = str(d).strip()
            if s and s not in out:
                out.append(s)
        return out
    except Exception:
        return []


def lookup_batch(
    items: list[dict[str, Any]] | None,
    *,
    force: bool = False,
) -> dict[str, Any]:
    """
    items: [{ticker, product?}]
    Returns by_ticker with merged Discovery + FDA product hits.
    """
    clean: list[tuple[str, str]] = []
    seen: set[str] = set()
    for it in items or []:
        if not isinstance(it, dict):
            continue
        tk = str(it.get("ticker") or "").strip().upper()
        if not tk or tk in seen:
            continue
        seen.add(tk)
        product = _norm_product(str(it.get("product") or it.get("asset") or ""))
        clean.append((tk, product))
        if len(clean) >= _MAX_BATCH:
            break

    by_ticker: dict[str, Any] = {}
    for tk, product in clean:
        disc = discovery_designations_for_ticker(tk)
        fda: list[str] = []
        sources: list[dict[str, str]] = []
        status = "discovery_only"
        if product:
            hit = lookup_product_fda(product, force=force)
            fda = list(hit.get("designations") or [])
            sources = list(hit.get("sources") or [])
            status = str(hit.get("status") or "live")
        merged: list[str] = []
        for d in disc + fda:
            if d and d not in merged:
                merged.append(d)
        by_ticker[tk] = {
            "ticker": tk,
            "product": product or None,
            "designations": merged,
            "discovery_designations": disc,
            "fda_designations": fda,
            "sources": sources,
            "status": status,
        }
        # Be polite between live FDA/Google hits
        if status == "live":
            time.sleep(0.15)

    return {
        "updated_at": _now_iso(),
        "count": len(by_ticker),
        "by_ticker": by_ticker,
    }
