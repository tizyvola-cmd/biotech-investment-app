"""
Gemini + web snippets: clinical-stage competitors targeting the same disease.
Display-only — not Soft BUY/SELL.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import ai_provider
from orchestrator_io_paths import DATA_DIR

_CACHE_PATH = Path(DATA_DIR) / "competition_landscape_cache.json"
_CACHE_LOCK = threading.Lock()
# Competition peers change slowly — keep Gemini results for 90 days unless force.
_CACHE_TTL_H = 24 * 90
_MAX_COMPETITORS = 10
# Flash-Lite: same peers list, a fraction of the quota and of the latency.
_DEFAULT_MODEL = "gemini-flash-lite-latest"
_WEB_TIMEOUT_S = 6.0
# A quota/credit error is not per-request: pause the whole section instead of
# making every card wait for the provider to fail again.
_AI_COOLDOWN_S = 300.0
_AI_COOLDOWN_LOCK = threading.Lock()
_ai_cooldown_until = 0.0
_ai_cooldown_detail = ""


def _env_flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, "").strip() or default)
    except ValueError:
        return default


def _ai_cooldown_left() -> float:
    with _AI_COOLDOWN_LOCK:
        return max(0.0, _ai_cooldown_until - time.time())


def _start_ai_cooldown(detail: str) -> None:
    global _ai_cooldown_until, _ai_cooldown_detail
    with _AI_COOLDOWN_LOCK:
        _ai_cooldown_until = time.time() + _env_float(
            "COMPETITION_AI_COOLDOWN_S", _AI_COOLDOWN_S
        )
        _ai_cooldown_detail = detail


def _clear_ai_cooldown() -> None:
    global _ai_cooldown_until, _ai_cooldown_detail
    with _AI_COOLDOWN_LOCK:
        _ai_cooldown_until = 0.0
        _ai_cooldown_detail = ""


_SYSTEM = (
    "You are a biotech competitive-intelligence analyst. "
    "Use well-established public pipeline facts (ClinicalTrials.gov, company pipelines, "
    "recent 2025–2026 conference / IR materials) plus the web snippets. "
    "List EXTERNAL clinical-stage products that target the SAME disease / indication as the "
    "focal asset — not the focal product itself, not other pipeline assets from the same "
    "issuer/company (those belong on the issuer news card), not approved SoC unless still "
    "in new trials. If uncertain, use null. Return strict JSON only — no markdown."
)


_PLACEHOLDER_PRODUCT_RE = re.compile(
    r"^(cd study|studio cd|study|trial|nct\d{8}|study\s+nct\d{8})$",
    re.I,
)


def _clean_product(product: str | None) -> str:
    """Drop tab labels that are not a drug (CD study, NCT id)."""
    pr = re.sub(r"\s+", " ", (product or "").strip())
    if not pr or _PLACEHOLDER_PRODUCT_RE.match(pr):
        return ""
    if re.search(r"\b(cd study|studio cd|study nct|nct\d{8})\b", pr, re.I) and len(pr) < 28:
        return ""
    return pr


def _norm_text(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def _product_key_part(product: str | None) -> str:
    pr = _clean_product(product)
    pr = re.sub(r"\s*\([^)]*\)\s*", " ", pr)
    return _norm_text(pr)


def _cache_key(ticker: str, product: str, indication: str) -> str:
    tk = (ticker or "").strip().upper()
    pr = _product_key_part(product)
    ind = _norm_text(indication)[:80]
    return f"{tk}|{pr}|{ind}"


def _products_match(a: str, b: str) -> bool:
    aa, bb = _product_key_part(a), _product_key_part(b)
    if not aa or not bb:
        return False
    if aa == bb or aa in bb or bb in aa:
        return min(len(aa), len(bb)) >= 4
    return False


def _indications_match(a: str, b: str) -> bool:
    aa, bb = _norm_text(a)[:80], _norm_text(b)[:80]
    if len(aa) < 8 or len(bb) < 8:
        return False
    return aa == bb or aa in bb or bb in aa


def _load_cache() -> dict[str, Any]:
    if not _CACHE_PATH.is_file():
        return {"entries": {}}
    try:
        raw = json.loads(_CACHE_PATH.read_text(encoding="utf-8"))
        if isinstance(raw, dict) and isinstance(raw.get("entries"), dict):
            return raw
    except Exception:
        pass
    return {"entries": {}}


def _save_cache(doc: dict[str, Any]) -> None:
    _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    _CACHE_PATH.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")


def _parse_ai_json(raw: str) -> dict[str, Any] | None:
    text = (raw or "").strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"\s*```$", "", text, flags=re.MULTILINE)
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


def _clean_field(raw: Any, *, max_len: int = 420) -> str | None:
    s = re.sub(r"\s+", " ", str(raw or "")).strip()
    if not s or re.match(r"^(n/?d|null|none|unknown|—|-)$", s, re.I):
        return None
    if len(s) > max_len:
        s = s[: max_len - 1].rstrip() + "…"
    return s


def _fmt_mcap(usd: Any, display: str | None) -> str | None:
    if display:
        return display
    try:
        n = float(usd)
    except (TypeError, ValueError):
        return None
    if not (n > 0):
        return None
    if n >= 1e12:
        return f"${n / 1e12:.1f}T"
    if n >= 1e9:
        return f"${n / 1e9:.1f}B"
    if n >= 1e6:
        return f"${n / 1e6:.0f}M"
    return f"${n:,.0f}"


def _parse_usd(raw: Any) -> float | None:
    if isinstance(raw, (int, float)) and raw > 0:
        return float(raw)
    s = str(raw or "").strip().upper().replace(",", "")
    if not s:
        return None
    m = re.search(r"([0-9]+(?:\.[0-9]+)?)\s*([TBM])?\b", s.replace("$", ""))
    if not m:
        return None
    n = float(m.group(1))
    unit = m.group(2) or ""
    if unit == "T":
        n *= 1e12
    elif unit == "B":
        n *= 1e9
    elif unit == "M":
        n *= 1e6
    return n if n > 0 else None


def _norm_ticker(raw: Any) -> str | None:
    s = re.sub(r"[^A-Za-z0-9.\-]", "", str(raw or "")).upper()
    if not s or s in {"NA", "NONE", "NULL", "PRIVATE", "N/A"}:
        return None
    return s[:12]


def _same_product(name: str, focal: str) -> bool:
    a = re.sub(r"[^a-z0-9]+", "", (name or "").lower())
    b = re.sub(r"[^a-z0-9]+", "", (focal or "").lower())
    if not a or not b or len(a) < 4 or len(b) < 4:
        return False
    return a == b or a in b or b in a


def _same_company(name: str, focal: str) -> bool:
    a = re.sub(r"[^a-z0-9]+", "", (name or "").lower())
    b = re.sub(r"[^a-z0-9]+", "", (focal or "").lower())
    if not a or not b or len(a) < 4 or len(b) < 4:
        return False
    # Strip common legal suffixes so "Structure Therapeutics Inc" ≈ "Structure Therapeutics"
    for suf in ("incorporated", "inc", "corp", "corporation", "ltd", "limited", "plc", "co", "company"):
        if a.endswith(suf) and len(a) > len(suf) + 3:
            a = a[: -len(suf)]
        if b.endswith(suf) and len(b) > len(suf) + 3:
            b = b[: -len(suf)]
    return a == b or a in b or b in a


def _normalize_competitor(
    raw: dict[str, Any],
    *,
    focal_product: str,
    focal_ticker: str,
    focal_company: str = "",
) -> dict[str, Any] | None:
    product = _clean_field(raw.get("product") or raw.get("drug") or raw.get("asset"), max_len=80)
    if not product:
        return None
    if _same_product(product, focal_product):
        return None
    ticker = _norm_ticker(raw.get("ticker") or raw.get("symbol"))
    if ticker and ticker == (focal_ticker or "").strip().upper():
        return None
    company = _clean_field(raw.get("company") or raw.get("sponsor"), max_len=80)
    # Sibling pipeline assets of the same issuer belong on the main news card — not here.
    if focal_company and company and _same_company(company, focal_company):
        return None
    usd = _parse_usd(raw.get("market_cap_usd") or raw.get("marketCapUsd"))
    display = _clean_field(
        raw.get("market_cap") or raw.get("market_cap_display") or raw.get("marketCap"),
        max_len=24,
    )
    return {
        "product": product,
        "company": company,
        "ticker": ticker,
        "market_cap": _fmt_mcap(usd, display),
        "market_cap_usd": usd,
        "phase": _clean_field(raw.get("phase") or raw.get("clinical_phase"), max_len=40),
        "mechanism_of_action": _clean_field(
            raw.get("mechanism_of_action") or raw.get("moa") or raw.get("mechanism"),
            max_len=280,
        ),
        "modality": _clean_field(raw.get("modality"), max_len=48),
        "value_proposition": _clean_field(
            raw.get("value_proposition")
            or raw.get("valueProposition")
            or raw.get("positioning"),
            max_len=420,
        ),
        "nct_id": _clean_field(raw.get("nct_id") or raw.get("nctId"), max_len=16),
        "status": _clean_field(raw.get("status"), max_len=40),
    }


def _normalize_landscape(
    parsed: dict[str, Any],
    *,
    focal_product: str,
    focal_ticker: str,
    indication_fallback: str | None,
    focal_company: str = "",
) -> dict[str, Any]:
    rows_raw = parsed.get("competitors") or parsed.get("products") or parsed.get("peers") or []
    if not isinstance(rows_raw, list):
        rows_raw = []
    seen: set[str] = set()
    competitors: list[dict[str, Any]] = []
    for item in rows_raw:
        if not isinstance(item, dict):
            continue
        row = _normalize_competitor(
            item,
            focal_product=focal_product,
            focal_ticker=focal_ticker,
            focal_company=focal_company,
        )
        if not row:
            continue
        key = re.sub(r"[^a-z0-9]+", "", row["product"].lower())
        if key in seen:
            continue
        seen.add(key)
        competitors.append(row)
        if len(competitors) >= _MAX_COMPETITORS:
            break
    return {
        "indication": _clean_field(parsed.get("indication"), max_len=120) or indication_fallback,
        "standard_of_care": _clean_field(parsed.get("standard_of_care") or parsed.get("soc"), max_len=200),
        "summary": _clean_field(parsed.get("summary") or parsed.get("notes"), max_len=420),
        "competitors": competitors,
    }


def _strip_html(raw: str) -> str:
    text = re.sub(r"<[^>]+>", " ", raw or "")
    return re.sub(r"\s+", " ", text).strip()


def _ddg_snippets(query: str, *, limit: int = 6) -> list[str]:
    import urllib.parse
    import urllib.request

    url = "https://html.duckduckgo.com/html/?" + urllib.parse.urlencode({"q": query})
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 SuperNovaCompetition/1.0"},
    )
    try:
        with urllib.request.urlopen(
            req, timeout=_env_float("COMPETITION_WEB_TIMEOUT_S", _WEB_TIMEOUT_S)
        ) as resp:
            html = resp.read().decode("utf-8", errors="replace")
    except Exception:
        return []
    titles = re.findall(r'class="result__a"[^>]*>(.*?)</a>', html, flags=re.I | re.S)
    snips = re.findall(
        r'class="result__snippet"[^>]*>(.*?)</(?:a|td|div|span)>',
        html,
        flags=re.I | re.S,
    )
    out: list[str] = []
    for i in range(max(len(titles), len(snips))):
        title = _strip_html(titles[i]) if i < len(titles) else ""
        snip = _strip_html(snips[i]) if i < len(snips) else ""
        line = " — ".join(p for p in (title, snip) if p)
        if line:
            out.append(line[:420])
        if len(out) >= limit:
            break
    return out


def _cache_fresh(hit: dict[str, Any]) -> bool:
    stamp = str(hit.get("updated_at") or "")
    try:
        dt = datetime.strptime(stamp.replace("Z", ""), "%Y-%m-%dT%H:%M:%S").replace(
            tzinfo=timezone.utc
        )
    except ValueError:
        return False
    age_h = (datetime.now(timezone.utc) - dt).total_seconds() / 3600
    return 0 <= age_h < _CACHE_TTL_H


def read_cached_competition_landscape(
    *,
    ticker: str,
    product_name: str | None = None,
    indication: str | None = None,
) -> dict[str, Any]:
    """Disk cache only. Opening the tab must not call Gemini."""
    tk = (ticker or "").strip().upper()
    product = (product_name or "").strip()
    disease = (indication or "").strip()
    if not tk:
        return {"ok": False, "error": "ticker required", "cached": False}
    if not product and not disease:
        return {"ok": False, "error": "product_name or indication required", "cached": False}
    key = _cache_key(tk, product, disease)
    with _CACHE_LOCK:
        entries = (_load_cache().get("entries") or {})
        hit = entries.get(key)
        if not (isinstance(hit, dict) and isinstance(hit.get("landscape"), dict)):
            hit = _match_cached_entry(entries, tk, product, disease)
    if isinstance(hit, dict) and isinstance(hit.get("landscape"), dict):
        return {
            "ok": True,
            "cached": True,
            "provider": hit.get("provider"),
            "updated_at": hit.get("updated_at"),
            "web_hits": hit.get("web_hits") or [],
            "landscape": hit["landscape"],
        }
    return {
        "ok": False,
        "cached": False,
        "error": "not_prepared",
        "hint": "Competition is built on request — load it from the card.",
    }


_WARM_LOCK = threading.Lock()
_warm_running = False


def _match_cached_entry(
    entries: dict[str, Any],
    ticker: str,
    product: str,
    indication: str,
) -> dict[str, Any] | None:
    """Same drug under another label (CD study vs ivonescimab) still opens the landscape."""
    prefix = f"{(ticker or '').strip().upper()}|"
    product_hit: dict[str, Any] | None = None
    indication_hit: dict[str, Any] | None = None
    for key, hit in entries.items():
        if not str(key).startswith(prefix):
            continue
        if not isinstance(hit, dict) or not isinstance(hit.get("landscape"), dict):
            continue
        landscape = hit["landscape"]
        stored_product = str(landscape.get("product") or landscape.get("product_name") or "")
        stored_indication = str(landscape.get("indication") or "")
        parts = str(key).split("|", 2)
        key_product = parts[1] if len(parts) > 1 else ""
        key_indication = parts[2] if len(parts) > 2 else ""
        if _products_match(product, stored_product) or _products_match(product, key_product):
            product_hit = hit
            break
        if _indications_match(indication, stored_indication) or _indications_match(
            indication, key_indication
        ):
            indication_hit = indication_hit or hit
    return product_hit or indication_hit


def desk_competition_targets(*, limit: int = 180) -> list[dict[str, str]]:
    """Products already on the clinical desk — warmed before anyone opens the tab."""
    out: list[dict[str, str]] = []
    seen: set[str] = set()

    def _add(ticker: str, product: str, company: str, indication: str, nct_id: str) -> None:
        tk = (ticker or "").strip().upper()
        pr = _clean_product(product)
        ind = re.sub(r"\s+", " ", (indication or "").strip())
        if not tk or (not pr and not ind):
            return
        key = _cache_key(tk, pr, ind)
        if key in seen:
            return
        seen.add(key)
        out.append(
            {
                "ticker": tk,
                "product_name": pr,
                "company": (company or "").strip(),
                "indication": ind,
                "nct_id": (nct_id or "").strip(),
            }
        )

    try:
        from orchestrator_io_paths import SIMULATION_SHEET_SNAPSHOT_JSON

        sim_path = Path(SIMULATION_SHEET_SNAPSHOT_JSON)
        if sim_path.is_file():
            snap = json.loads(sim_path.read_text(encoding="utf-8"))
            for row in snap.get("rows") or []:
                if not isinstance(row, dict):
                    continue
                _add(
                    str(row.get("Ticker") or row.get("ticker") or ""),
                    str(
                        row.get("Drug")
                        or row.get("Farmaco")
                        or row.get("Product")
                        or row.get("Prodotto")
                        or ""
                    ),
                    str(row.get("Società") or row.get("Company") or row.get("Societa") or ""),
                    str(
                        row.get("Indication")
                        or row.get("Indicazione")
                        or row.get("Condition")
                        or ""
                    ),
                    str(row.get("NCT") or row.get("nct_id") or ""),
                )
                if len(out) >= limit:
                    return out
    except Exception:
        pass

    try:
        from clinical_pre_cd_enrichment import load_snapshot

        for rec in load_snapshot().get("records") or []:
            if not isinstance(rec, dict):
                continue
            ai = rec.get("ai") if isinstance(rec.get("ai"), dict) else {}
            prof = ai.get("study_clinical_profile") if isinstance(ai.get("study_clinical_profile"), dict) else {}
            _add(
                str(rec.get("ticker") or ""),
                str(prof.get("product_name") or rec.get("product_name") or ""),
                str(rec.get("company") or prof.get("sponsor") or ""),
                str(prof.get("indication") or rec.get("indication") or rec.get("condition") or ""),
                str(rec.get("nct_id") or rec.get("nct") or ""),
            )
            if len(out) >= limit:
                return out
    except Exception:
        pass
    return out


def warm_desk_competition(*, limit: int = 180) -> None:
    """Optional background pass, off by default: one AI call per desk product
    burns the daily quota for cards nobody opens. Set COMPETITION_WARM=1 to
    pre-build the cache anyway."""
    global _warm_running
    if not _env_flag("COMPETITION_WARM", False):
        return
    with _WARM_LOCK:
        if _warm_running:
            return
        _warm_running = True

    def _run() -> None:
        global _warm_running
        try:
            import logging

            log = logging.getLogger("supernova.competition")
            from concurrent.futures import ThreadPoolExecutor

            targets = desk_competition_targets(limit=limit)
            pending: list[dict[str, str]] = []
            for row in targets:
                with _CACHE_LOCK:
                    entries = _load_cache().get("entries") or {}
                    hit = entries.get(
                        _cache_key(row["ticker"], row["product_name"], row["indication"])
                    )
                    if not (isinstance(hit, dict) and isinstance(hit.get("landscape"), dict)):
                        hit = _match_cached_entry(
                            entries,
                            row["ticker"],
                            row["product_name"],
                            row["indication"],
                        )
                if isinstance(hit, dict) and isinstance(hit.get("landscape"), dict):
                    continue
                pending.append(row)
            log.info(
                "competition warm start targets=%s pending=%s",
                len(targets),
                len(pending),
            )

            def _one(row: dict[str, str]) -> dict[str, Any]:
                return lookup_competition_landscape(
                    ticker=row["ticker"],
                    product_name=row["product_name"] or None,
                    company=row["company"] or None,
                    indication=row["indication"] or None,
                    nct_id=row["nct_id"] or None,
                    force=False,
                )

            # One at a time. Stop the pass if the provider is down so a quota
            # error does not walk the whole desk.
            fails = 0
            with ThreadPoolExecutor(max_workers=1, thread_name_prefix="comp-warm") as pool:
                for row in pending:
                    try:
                        result = pool.submit(_one, row).result()
                    except Exception as exc:
                        log.warning("competition warm %s failed: %s", row.get("ticker"), exc)
                        fails += 1
                        result = None
                    if isinstance(result, dict) and result.get("ok"):
                        fails = 0
                        continue
                    fails += 1
                    if fails >= 3:
                        log.warning(
                            "competition warm stopped after %s AI failures (pending was %s)",
                            fails,
                            len(pending),
                        )
                        break
            log.info("competition warm done")
        finally:
            with _WARM_LOCK:
                _warm_running = False

    threading.Thread(target=_run, name="competition-warm", daemon=True).start()


def lookup_competition_landscape(
    *,
    ticker: str,
    product_name: str | None = None,
    company: str | None = None,
    indication: str | None = None,
    nct_id: str | None = None,
    force: bool = False,
    cache_only: bool = False,
) -> dict[str, Any]:
    tk = (ticker or "").strip().upper()
    product = _clean_product(product_name)
    disease = (indication or "").strip()
    if not tk:
        return {"ok": False, "error": "ticker required"}
    if not product and not disease:
        return {"ok": False, "error": "product_name or indication required"}

    key = _cache_key(tk, product, disease)
    with _CACHE_LOCK:
        cache_doc = _load_cache()
        hit = cache_doc.get("entries", {}).get(key)
        # Serve disk cache whenever present (TTL only gates "fresh" label via age).
        if hit and not force and isinstance(hit.get("landscape"), dict):
            return {
                "ok": True,
                "cached": True,
                "provider": hit.get("provider"),
                "updated_at": hit.get("updated_at"),
                "web_hits": hit.get("web_hits") or [],
                "landscape": hit["landscape"],
            }

    if cache_only or not force:
        # Tab reads never call Gemini. Preparation is warm_desk_competition().
        if cache_only:
            return read_cached_competition_landscape(
                ticker=tk, product_name=product, indication=disease
            )

    cooldown_left = _ai_cooldown_left()
    if cooldown_left > 0:
        with _AI_COOLDOWN_LOCK:
            detail = _ai_cooldown_detail
        return {
            "ok": False,
            "error": "ai_cooldown",
            "retry_after_s": int(cooldown_left),
            "web_hits": [],
            "detail": detail,
        }

    co = (company or "").strip()
    disease_q = disease or product or tk
    queries = [
        f"{disease_q} clinical pipeline competitors Phase 2 Phase 3 2026",
        f"{disease_q} drugs in development ClinicalTrials.gov {product}".strip(),
        f"{disease_q} {co} competitive landscape market cap",
    ]
    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=len(queries), thread_name_prefix="comp-web") as pool:
        batches = list(pool.map(lambda q: _ddg_snippets(q, limit=4), queries))
    snippets: list[str] = []
    for batch in batches:
        snippets.extend(batch)
        if len(snippets) >= 10:
            break

    if not ai_provider.is_available():
        return {
            "ok": False,
            "error": "no_ai_provider",
            "web_hits": snippets[:10],
            "hint": ai_provider.provider_info().get("hint_it"),
        }

    lines = [
        "Identify EXTERNAL products in CLINICAL DEVELOPMENT that target the SAME disease.",
        "Focus ONLY on the focal product's indication — ignore sibling pipeline assets from",
        "the same company (those are summarized on the issuer news card).",
        "For each competitor include phase, mechanism of action, modality, the company's",
        "stated value proposition, company name, ticker if public, and market cap.",
        "",
        f"Focal ticker: {tk}",
        f"Focal company: {co or '(unknown)'}",
        f"Focal product: {product or '(unknown)'}",
        f"Disease / indication: {disease or '(infer from product)'}",
    ]
    if nct_id:
        lines.append(f"Focal NCT (context): {nct_id.upper()}")
    if snippets:
        lines.append("")
        lines.append("Web search snippets:")
        for sn in snippets[:10]:
            lines.append(f"- {sn}")
    lines.extend(
        [
            "",
            "Return JSON with EXACTLY these keys:",
            "{",
            '  "indication": "canonical disease name",',
            '  "standard_of_care": "current SoC or none",',
            '  "summary": "2 sentences on how crowded / differentiated the space is",',
            '  "competitors": [',
            "    {",
            '      "product": "drug / asset name",',
            '      "company": "developer name",',
            '      "ticker": "NYSE/NASDAQ ticker or null if private",',
            '      "market_cap": "$1.2B or private / $—",',
            '      "market_cap_usd": 1200000000,',
            '      "phase": "Phase 1 | Phase 2 | Phase 3 | Filed | Approved (new indication)",',
            '      "mechanism_of_action": "1-2 sentences",',
            '      "modality": "small molecule | mAb | cell therapy | gene therapy | device | ...",',
            '      "value_proposition": "how the company positions the asset vs SoC / peers",',
            '      "nct_id": "NCT######## or null",',
            '      "status": "recruiting | active | completed | ..."',
            "    }",
            "  ]",
            "}",
            "Do NOT include the focal product OR any other product from the same company/issuer.",
            "Prefer 6–10 of the most relevant EXTERNAL clinical-stage peers.",
        ]
    )
    prompt = "\n".join(lines)

    model = os.environ.get("COMPETITION_GEMINI_MODEL", "").strip() or _DEFAULT_MODEL
    provider_used = "gemini"
    raw: str | None = None
    if ai_provider.get_api_key("gemini"):
        raw = ai_provider._call_provider(  # noqa: SLF001
            "gemini",
            prompt,
            system=_SYSTEM,
            max_tokens=2200,
            model_override=model,
            task="catalyst",
        )
        # Walking the other providers after a Gemini failure means one card can
        # wait minutes for every provider to reject it in turn.
        if not raw and _env_flag("COMPETITION_AI_FALLBACK", False):
            provider_used = "fallback"
            raw = ai_provider.call_ai(prompt, system=_SYSTEM, max_tokens=2200, task="clinical_kpi")
    else:
        provider_used = "active"
        raw = ai_provider.call_ai(prompt, system=_SYSTEM, max_tokens=2200, task="clinical_kpi")

    if not raw:
        detail = ai_provider.friendly_error_message(lang="it")
        _start_ai_cooldown(detail)
        return {
            "ok": False,
            "error": "ai_empty",
            "retry_after_s": int(_ai_cooldown_left()),
            "web_hits": snippets[:10],
            "detail": detail,
        }
    _clear_ai_cooldown()

    parsed = _parse_ai_json(raw)
    if not parsed:
        return {"ok": False, "error": "ai_parse", "web_hits": snippets[:10]}

    landscape = _normalize_landscape(
        parsed,
        focal_product=product,
        focal_ticker=tk,
        indication_fallback=disease or None,
        focal_company=co,
    )
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    entry = {
        "ticker": tk,
        "product_name": product,
        "indication": disease,
        "provider": provider_used,
        "updated_at": stamp,
        "web_hits": snippets[:10],
        "landscape": landscape,
    }
    with _CACHE_LOCK:
        cache_doc = _load_cache()
        cache_doc.setdefault("entries", {})[key] = entry
        _save_cache(cache_doc)

    return {
        "ok": True,
        "cached": False,
        "provider": provider_used,
        "updated_at": stamp,
        "web_hits": snippets[:10],
        "landscape": landscape,
    }
