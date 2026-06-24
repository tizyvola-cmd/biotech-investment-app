"""
FY balance-sheet liquidity ratios (Yahoo Finance annual).

Ratios (latest annual column on ``ticker.balance_sheet``):
  - Current Ratio = Current Assets / Current Liabilities
  - Quick Ratio = (Current Assets - Inventory) / Current Liabilities
  - Cash Ratio = (Cash + Marketable Securities) / Current Liabilities

``liquidity_score`` (0–1, higher = stronger liquidity) for prediction hooks::

    score = 0.4 * clip(current/2, 0, 1)
          + 0.35 * clip(quick/1.5, 0, 1)
          + 0.25 * clip(cash/0.5, 0, 1)

Uses only ratios present; if all three are missing → ``liquidity_score = 1.0``
(identity: no curve magnitude change).

Historical ``data/enrich_cache/{TICKER}.json`` files lack FY liquidity until
the next financial enrich run (or delete cache entry to force refresh).

Known regression (HURA, ~2025): ``_match_row_label`` used ``nl in pat``, so a bare
``Assets`` row matched the ``current assets`` pattern and Total Assets (~263M) was
divided by Current Liabilities (~5.9M) → CR ≈ 45 instead of ~0.78. Fixes:
explicit ``current`` in row label, blocklist for aggregate lines, sanity bounds
on CR/QR, and refusing to persist or merge implausible ratios (re-fetch on enrich).
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Mapping

_LOG = logging.getLogger(__name__)

LIQUIDITY_DF_COLUMNS = (
    "current_ratio",
    "quick_ratio",
    "cash_ratio",
    "liquidity_fy_date",
    "liquidity_score",
)

# ``fy_date`` mirrors ``liquidity_fy_date`` in enrich_cache JSON (legacy-friendly key).
LIQUIDITY_CACHE_KEYS = LIQUIDITY_DF_COLUMNS + ("fy_date", "liquidity_sanity_failed")

# FY ratio bands (biotech; Yahoo line items in thousands do not affect ratios).
# Cash-rich biotech often has CR 5–30 (strong liquidity); old cap at 5.0 flooded enrich logs.
CR_SANITY_MIN = 0.05
CR_SANITY_MAX = 50.0          # accept without CA/CL cross-check (cache-only CR)
CR_SOFT_WARN_ABOVE = 50.0     # log summary only when LIQUIDITY_LOG_REJECTS=1
CR_HARD_REJECT_ABOVE = 100.0  # likely wrong row (e.g. Total Assets / CL)
CR_HARD_REJECT_BELOW = 0.02
QR_SANITY_MAX = 50.0
CASH_RATIO_SANITY_MAX = 50.0
_CR_CROSSCHECK_REL_TOL = 0.02

# Batch reject counters (enrich); flushed via log_liquidity_reject_summary().
_reject_counts: dict[str, int] = {}

_CURRENT_ASSETS_PATS = (
    "total current assets",
    "current assets",
)
_CURRENT_LIAB_PATS = (
    "total current liabilities",
    "current liabilities",
)
_INVENTORY_PATS = (
    "inventory",
    "inventories",
)
_CASH_PATS = (
    "cash and cash equivalents",
    "cash cash equivalents and short term investments",
    "cash equivalents",
)
_MARKETABLE_PATS = (
    "short term investments",
    "other short term investments",
    "marketable securities",
    "available for sale securities current",
)

# Rows that must never map to current assets / current liabilities.
_BLOCKED_BALANCE_LABELS = frozenset({
    "assets",
    "total assets",
    "liabilities",
    "total liabilities",
    "total liabilities net minority interest",
    "net assets",
    "total equity",
    "stockholders equity",
    "total stockholders equity",
    "total debt",
    "net debt",
    "total non current liabilities",
    "non current liabilities",
})


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw.replace(",", "."))
    except ValueError:
        return default


def cr_sanity_min() -> float:
    return _env_float("LIQUIDITY_CR_SANITY_MIN", CR_SANITY_MIN)


def cr_sanity_max() -> float:
    return _env_float("LIQUIDITY_CR_SANITY_MAX", CR_SANITY_MAX)


def qr_sanity_max() -> float:
    return _env_float("LIQUIDITY_QR_SANITY_MAX", QR_SANITY_MAX)


def cash_ratio_sanity_max() -> float:
    return _env_float("LIQUIDITY_CASH_RATIO_SANITY_MAX", CASH_RATIO_SANITY_MAX)


def cr_hard_reject_above() -> float:
    return _env_float("LIQUIDITY_CR_HARD_REJECT_ABOVE", CR_HARD_REJECT_ABOVE)


def liquidity_log_rejects() -> bool:
    """Per-ticker reject warnings when ``1``/``true``; default off (summary only)."""
    raw = os.environ.get("LIQUIDITY_LOG_REJECTS", "0").strip().lower()
    return raw in ("1", "true", "yes", "on")


def reset_liquidity_reject_counts() -> None:
    _reject_counts.clear()


def record_liquidity_reject(reason: str) -> None:
    key = reason.split(":", 1)[0].strip() or reason[:48]
    _reject_counts[key] = _reject_counts.get(key, 0) + 1


def log_liquidity_reject_summary(*, logger: logging.Logger | None = None) -> None:
    """Emit one summary line after a batch enrich if any rejects were recorded."""
    if not _reject_counts:
        return
    log = logger or _LOG
    parts = ", ".join(f"{k}={v}" for k, v in sorted(_reject_counts.items()))
    log.info("[liquidity] batch reject summary: %s", parts)
    _reject_counts.clear()


def _norm_label(s: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(s).strip().lower()).strip()


def _is_non_current_row(norm_label: str) -> bool:
    return "non current" in norm_label or "noncurrent" in norm_label.replace(" ", "")


def _is_current_fy_pattern(pattern: str) -> bool:
    return "current assets" in pattern or "current liabilities" in pattern


def _row_allowed_for_current_patterns(norm_label: str) -> bool:
    if not norm_label or norm_label in _BLOCKED_BALANCE_LABELS:
        return False
    if _is_non_current_row(norm_label):
        return False
    return "current" in norm_label


def _match_row_label(labels: list[Any], patterns: tuple[str, ...]) -> Any | None:
    """
    Return original index label for the best-matching row name.

    Prefers exact normalized equality (Yahoo keys), then longest substring match
    where the pattern appears inside the row label (``pat in nl``). Never uses
    ``nl in pat`` (that mapped bare ``Assets`` → ``current assets`` and inflated
    CR ~45 for HURA). Aggregate rows (Total Assets, Total Liabilities without
    ``current``) are blocklisted.
    """
    require_current = any(_is_current_fy_pattern(p) for p in patterns)
    # Pass 1: exact normalized label match (longest pattern wins on ties).
    exact_best: Any | None = None
    exact_pat_len = -1
    for raw in labels:
        nl = _norm_label(raw)
        if not nl:
            continue
        if require_current and not _row_allowed_for_current_patterns(nl):
            continue
        for pat in patterns:
            if pat == nl and len(pat) > exact_pat_len:
                exact_best = raw
                exact_pat_len = len(pat)
    if exact_best is not None:
        return exact_best

    best_raw: Any | None = None
    best_pat_len = -1
    for raw in labels:
        nl = _norm_label(raw)
        if not nl:
            continue
        if require_current and not _row_allowed_for_current_patterns(nl):
            continue
        for pat in patterns:
            if _is_non_current_row(nl) and _is_current_fy_pattern(pat):
                continue
            if pat in nl:
                if len(pat) > best_pat_len:
                    best_raw = raw
                    best_pat_len = len(pat)
    return best_raw


def _to_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f != f:  # NaN
        return None
    return f


def _safe_ratio(num: float | None, den: float | None) -> float | None:
    if num is None or den is None:
        return None
    if den <= 0:
        return None
    return float(num) / float(den)


def _cr_crosscheck_ok(
    cr: float,
    current_assets: float,
    current_liabilities: float,
) -> bool:
    if current_liabilities <= 0:
        return False
    if current_assets <= 0 and current_liabilities > 0:
        return False
    recomputed = current_assets / current_liabilities
    return abs(recomputed - cr) / max(abs(cr), 1e-9) <= _CR_CROSSCHECK_REL_TOL


def current_ratio_reject_reason(
    current_ratio: float | None,
    *,
    current_assets: float | None = None,
    current_liabilities: float | None = None,
) -> str | None:
    """
    None if CR is acceptable; else a short reason key for batch counters.

    Rules:
    - Hard reject: CR > 100, CR < 0.02, CL<=0, CA=0 with CL>0, cross-check fail.
    - Without CA/CL: accept only CR in [0.05, 50] (cache-only legacy guard).
    - With CA/CL cross-check: accept CR in [0.05, 100]; soft-warn band 50–100.
    """
    if current_ratio is None:
        return "missing_cr"
    try:
        cr = float(current_ratio)
    except (TypeError, ValueError):
        return "invalid_cr"
    hard_hi = cr_hard_reject_above()
    if cr > hard_hi:
        return f"cr_above_{hard_hi:g}"
    if cr < CR_HARD_REJECT_BELOW:
        return "cr_below_hard_min"
    if cr < cr_sanity_min():
        return "cr_below_band"
    has_bs = current_assets is not None and current_liabilities is not None
    if has_bs:
        ca, cl = float(current_assets), float(current_liabilities)  # type: ignore[arg-type]
        if cl <= 0:
            return "cl_non_positive"
        if ca <= 0 and cl > 0:
            return "ca_zero_cl_positive"
        if not _cr_crosscheck_ok(cr, ca, cl):
            return "crosscheck_fail"
        return None
    if cr > cr_sanity_max():
        return "cr_above_cache_max"
    return None


def is_plausible_current_ratio(
    current_ratio: float | None,
    *,
    current_assets: float | None = None,
    current_liabilities: float | None = None,
) -> bool:
    """False when CR is missing, hard-reject, fails cross-check, or cache band exceeded."""
    return current_ratio_reject_reason(
        current_ratio,
        current_assets=current_assets,
        current_liabilities=current_liabilities,
    ) is None


def liquidity_ratios_sane(liq: Mapping[str, Any] | None) -> bool:
    """True if liquidity dict has trustworthy FY ratios for merge/cache."""
    if not liq:
        return False
    if liq.get("liquidity_sanity_failed"):
        return False
    cr = _to_float(liq.get("current_ratio"))
    if cr is None:
        return False
    ca = _to_float(liq.get("_current_assets"))
    cl = _to_float(liq.get("_current_liabilities"))
    if not is_plausible_current_ratio(cr, current_assets=ca, current_liabilities=cl):
        return False
    qr = _to_float(liq.get("quick_ratio"))
    if qr is not None and not (0.0 <= qr <= qr_sanity_max()):
        return False
    car = _to_float(liq.get("cash_ratio"))
    if car is not None and not (0.0 <= car <= cash_ratio_sanity_max()):
        return False
    return True


def sanitize_liquidity_payload(
    liq: Mapping[str, Any] | None,
    *,
    ticker: str = "",
    source: str = "",
    current_assets: float | None = None,
    current_liabilities: float | None = None,
) -> dict[str, Any]:
    """
    Drop or neutralize implausible ratios.

    On failure: ratios → None, ``liquidity_score`` = 1.0, ``liquidity_sanity_failed`` = True.
    """
    base = _empty_liquidity()
    if not liq:
        return base
    cr = _to_float(liq.get("current_ratio"))
    qr = _to_float(liq.get("quick_ratio"))
    car = _to_float(liq.get("cash_ratio"))
    ca = current_assets if current_assets is not None else _to_float(liq.get("_current_assets"))
    cl = (
        current_liabilities
        if current_liabilities is not None
        else _to_float(liq.get("_current_liabilities"))
    )
    failed = False
    fail_reason = ""
    reject_key = (
        current_ratio_reject_reason(cr, current_assets=ca, current_liabilities=cl)
        if cr is not None
        else None
    )
    if cr is not None and reject_key is not None:
        failed = True
        if reject_key == "crosscheck_fail" and ca is not None and cl is not None and cl > 0:
            fail_reason = f"CR={cr:.4g} vs CA/CL={ca / cl:.4g} (CA={ca}, CL={cl})"
        elif reject_key.startswith("cr_above_"):
            fail_reason = f"CR={cr:.4g} above hard max {cr_hard_reject_above():.0f}"
        elif reject_key == "cr_above_cache_max":
            fail_reason = (
                f"CR={cr:.4g} above cache max {cr_sanity_max():.0f} "
                "(no CA/CL cross-check)"
            )
        else:
            fail_reason = f"current_ratio={cr:.4g} ({reject_key})"
    if qr is not None and not (0.0 <= qr <= qr_sanity_max()):
        failed = True
        fail_reason = fail_reason or f"quick_ratio={qr:.4g}"
        qr = None
    if car is not None and not (0.0 <= car <= cash_ratio_sanity_max()):
        failed = True
        fail_reason = fail_reason or f"cash_ratio={car:.4g}"
        car = None
    if failed:
        sym = str(ticker or "").strip().upper() or "?"
        msg = fail_reason or reject_key or "ratio out of band"
        record_liquidity_reject(reject_key or msg)
        if liquidity_log_rejects():
            _LOG.warning(
                "[liquidity] %s%s: sanity failed — %s (neutral score 1.0)",
                sym,
                f" ({source})" if source else "",
                msg,
            )
        return _empty_liquidity(sanity_failed=True)
    if (
        cr is not None
        and ca is not None
        and cl is not None
        and cr > CR_SOFT_WARN_ABOVE
        and liquidity_log_rejects()
    ):
        sym = str(ticker or "").strip().upper() or "?"
        _LOG.info(
            "[liquidity] %s%s: high CR %.2f (cash-rich; score capped at 1.0)",
            sym,
            f" ({source})" if source else "",
            cr,
        )
    fy = liq.get("liquidity_fy_date") or liq.get("fy_date")
    return {
        "current_ratio": cr,
        "quick_ratio": qr,
        "cash_ratio": car,
        "liquidity_fy_date": str(fy)[:10] if fy else None,
        "liquidity_score": liquidity_score(cr, qr, car),
        "liquidity_sanity_failed": False,
    }


def compute_liquidity_ratios(
    *,
    current_assets: float | None,
    current_liabilities: float | None,
    inventory: float | None = None,
    cash: float | None = None,
    marketable_securities: float | None = None,
    fy_date: str | None = None,
) -> dict[str, Any]:
    """
    Compute FY liquidity ratios from balance-sheet line items (same units).

    Missing liabilities → all ratios ``None``. Negative inventory is clipped to 0
    for the quick ratio numerator. Yahoo reports line items in thousands; ratios are
    scale-invariant when numerator and denominator share the same unit.
    """
    inv = inventory
    if inv is not None and inv < 0:
        inv = 0.0

    current_ratio = _safe_ratio(current_assets, current_liabilities)

    quick_num: float | None = None
    if current_assets is not None and current_liabilities is not None:
        quick_num = current_assets - (inv or 0.0)
    quick_ratio = _safe_ratio(quick_num, current_liabilities)

    cash_like: float | None = None
    if cash is not None or marketable_securities is not None:
        cash_like = (cash or 0.0) + (marketable_securities or 0.0)
    cash_ratio = _safe_ratio(cash_like, current_liabilities)

    raw = {
        "current_ratio": current_ratio,
        "quick_ratio": quick_ratio,
        "cash_ratio": cash_ratio,
        "liquidity_fy_date": fy_date,
        "_current_assets": current_assets,
        "_current_liabilities": current_liabilities,
    }
    out = sanitize_liquidity_payload(
        raw,
        ticker="",
        source="compute",
        current_assets=current_assets,
        current_liabilities=current_liabilities,
    )
    out.pop("_current_assets", None)
    out.pop("_current_liabilities", None)
    return out


def liquidity_score(
    current_ratio: float | None,
    quick_ratio: float | None,
    cash_ratio: float | None,
) -> float:
    """
    Composite liquidity score in [0, 1].

    Weights apply only to available ratios; weights are renormalized over the subset.
    If no ratio is available, returns ``1.0`` (neutral / no adjustment).
    """
    parts: list[tuple[float, float]] = []
    if current_ratio is not None:
        parts.append((0.4, _clip01(current_ratio / 2.0)))
    if quick_ratio is not None:
        parts.append((0.35, _clip01(quick_ratio / 1.5)))
    if cash_ratio is not None:
        parts.append((0.25, _clip01(cash_ratio / 0.5)))
    if not parts:
        return 1.0
    w_sum = sum(w for w, _ in parts)
    return sum(w * v for w, v in parts) / w_sum if w_sum > 0 else 1.0


def _clip01(x: float) -> float:
    return max(0.0, min(1.0, float(x)))


def parse_balance_sheet_values(
    row_values: Mapping[Any, Any],
    *,
    fy_date: str | None = None,
    ticker: str = "",
) -> dict[str, Any]:
    """
    Parse one FY column from a balance sheet (row label → scalar).

    ``row_values``: mapping of row index → numeric value for the latest annual period.
    """
    labels = list(row_values.keys())

    def _val(patterns: tuple[str, ...]) -> float | None:
        key = _match_row_label(labels, patterns)
        if key is None:
            return None
        return _to_float(row_values.get(key))

    ca = _val(_CURRENT_ASSETS_PATS)
    cl = _val(_CURRENT_LIAB_PATS)
    inv = _val(_INVENTORY_PATS)
    cash = _val(_CASH_PATS)
    ms = _val(_MARKETABLE_PATS)
    if (
        cash is not None
        and ms is not None
        and abs(cash - ms) < 1e-6 * max(1.0, abs(cash), abs(ms))
    ):
        ms = None

    out = compute_liquidity_ratios(
        current_assets=ca,
        current_liabilities=cl,
        inventory=inv,
        cash=cash,
        marketable_securities=ms,
        fy_date=fy_date,
    )
    if not liquidity_ratios_sane(out) and ca is not None and cl is not None:
        record_liquidity_reject("parse_rejected")
        if liquidity_log_rejects():
            _LOG.warning(
                "[liquidity] %s: rejected parsed ratios CA=%s CL=%s → CR=%s",
                str(ticker or "?").upper(),
                ca,
                cl,
                out.get("current_ratio"),
            )
        return _empty_liquidity(sanity_failed=True)
    return out


def parse_yfinance_balance_sheet(bs: Any, *, ticker: str = "") -> dict[str, Any]:
    """
    Latest annual column from ``yfinance.Ticker(...).balance_sheet`` (DataFrame).

    Returns empty ratios dict if frame missing or empty.
    """
    if bs is None:
        return _empty_liquidity()
    try:
        empty = getattr(bs, "empty", None)
        if empty is True:
            return _empty_liquidity()
    except Exception:
        return _empty_liquidity()

    try:
        cols = list(bs.columns)
        if not cols:
            return _empty_liquidity()
        col0 = cols[0]
        if hasattr(col0, "strftime"):
            fy_date = col0.strftime("%Y-%m-%d")
        else:
            fy_date = str(col0)[:10]
        series = bs[col0]
        row_values = {idx: series.loc[idx] for idx in series.index}
        return parse_balance_sheet_values(row_values, fy_date=fy_date, ticker=ticker)
    except Exception:
        return _empty_liquidity()


def _empty_liquidity(*, sanity_failed: bool = False) -> dict[str, Any]:
    return {
        "current_ratio": None,
        "quick_ratio": None,
        "cash_ratio": None,
        "liquidity_fy_date": None,
        "liquidity_score": 1.0,
        "liquidity_sanity_failed": bool(sanity_failed),
    }


def clear_liquidity_fields(target: dict[str, Any]) -> dict[str, Any]:
    """Remove FY liquidity keys from enrich cache / df row (keeps unrelated fields)."""
    for k in (*LIQUIDITY_DF_COLUMNS, "fy_date", "liquidity_sanity_failed"):
        target.pop(k, None)
    return target


def strip_untrusted_liquidity_from_enrich_dict(
    data: Mapping[str, Any],
    *,
    ticker: str = "",
) -> dict[str, Any]:
    """
    Drop insane cached liquidity so enrich cache-hits do not re-poison the df.

    Leaves non-liquidity enrich fields untouched.
    """
    if not isinstance(data, dict):
        return {}
    out = dict(data)
    subset = {k: out.get(k) for k in LIQUIDITY_CACHE_KEYS if k in out}
    if not any(v is not None for v in subset.values()):
        return out
    sane = sanitize_liquidity_payload(
        subset,
        ticker=ticker or str(out.get("symbol") or out.get("ticker") or ""),
        source="enrich_cache",
    )
    if liquidity_ratios_sane(sane):
        merge_liquidity_dict(out, sane)
        out["liquidity_sanity_failed"] = False
    else:
        clear_liquidity_fields(out)
        if sane.get("liquidity_sanity_failed"):
            out["liquidity_sanity_failed"] = True
    return out


def fetch_liquidity_yfinance(ticker: str, yf_module: Any | None = None) -> dict[str, Any]:
    """Fetch annual balance sheet via yfinance and compute liquidity fields."""
    sym = str(ticker or "").strip().upper()
    if not sym:
        return _empty_liquidity()
    try:
        if yf_module is None:
            import yfinance as yf_module  # type: ignore
        t = yf_module.Ticker(sym)
        bs = getattr(t, "balance_sheet", None)
        if bs is None or (hasattr(bs, "empty") and bs.empty):
            bs = getattr(t, "get_balance_sheet", lambda freq="yearly": None)(freq="yearly")
        return parse_yfinance_balance_sheet(bs, ticker=sym)
    except Exception:
        return _empty_liquidity()


def load_liquidity_from_enrich_cache(
    ticker: str,
    *,
    cache_dir: str | os.PathLike[str],
) -> dict[str, Any] | None:
    """Load liquidity keys from ``{cache_dir}/{TICKER}.json`` if present and sane."""
    sym = str(ticker or "").strip().upper()
    if not sym:
        return None
    path = os.path.join(os.fspath(cache_dir), f"{sym}.json")
    if not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    if not any(k in data for k in LIQUIDITY_CACHE_KEYS):
        return None
    out = _empty_liquidity()
    for k in LIQUIDITY_DF_COLUMNS:
        if k in data:
            out[k] = data[k]
    if out.get("liquidity_fy_date") is None and data.get("fy_date") is not None:
        out["liquidity_fy_date"] = data["fy_date"]
    if out.get("liquidity_score") is None:
        out["liquidity_score"] = liquidity_score(
            _to_float(out.get("current_ratio")),
            _to_float(out.get("quick_ratio")),
            _to_float(out.get("cash_ratio")),
        )
    sane = sanitize_liquidity_payload(out, ticker=sym, source="enrich_cache")
    if not liquidity_ratios_sane(sane):
        return None
    return sane


def resolve_liquidity_score(
    ticker: str,
    financial_row: Mapping[str, Any] | None = None,
    *,
    cache_dir: str | os.PathLike[str] | None = None,
) -> float:
    """
    Resolve ``liquidity_score`` for prediction: financial row, then enrich cache, else 1.0.
    """
    if financial_row is not None:
        row_sane = sanitize_liquidity_payload(financial_row, ticker=ticker, source="financial_row")
        if liquidity_ratios_sane(row_sane):
            raw = row_sane.get("liquidity_score")
            if raw is not None:
                try:
                    return float(raw)
                except (TypeError, ValueError):
                    pass
            cr = _to_float(row_sane.get("current_ratio"))
            qr = _to_float(row_sane.get("quick_ratio"))
            car = _to_float(row_sane.get("cash_ratio"))
            if cr is not None or qr is not None or car is not None:
                return liquidity_score(cr, qr, car)

    if cache_dir is not None:
        cached = load_liquidity_from_enrich_cache(ticker, cache_dir=cache_dir)
        if cached is not None and cached.get("liquidity_score") is not None:
            try:
                return float(cached["liquidity_score"])
            except (TypeError, ValueError):
                pass

    return 1.0


def apply_liquidity_risk_shrink(pct: float | None, liq_score: float) -> float | None:
    """
    Dampen extrapolated %% when FY liquidity is weak (``PRED_CURVE_FY_LIQ`` hook).

    ``liq_score`` 1.0 → unchanged; lower scores pull magnitudes toward 0 (floor 0.35×).
    """
    if pct is None:
        return None
    try:
        score = float(liq_score)
    except (TypeError, ValueError):
        score = 1.0
    if not (0.0 <= score <= 1.0) or score != score:
        score = 1.0
    factor = max(0.35, min(1.0, score))
    return round(float(pct) * factor, 1)


LIQUIDITY_DISPLAY_SANITY_FAIL = "N/D (sanity)"
LIQUIDITY_DISPLAY_MISSING = "—"


def format_liquidity_display(
    *,
    current_ratio: float | None = None,
    quick_ratio: float | None = None,
    cash_ratio: float | None = None,
    liquidity_score: float | None = None,
    row: Mapping[str, Any] | None = None,
    sanity_failed: bool | None = None,
) -> str | None:
    """
    Human-readable FY liquidity for Financial sheet / UI.

    Examples: ``CR 1.44 | QR 0.90``, ``CR 2.10``, ``N/D (sanity)`` when rejected.
    """
    if row is not None:
        if sanity_failed is None:
            sanity_failed = bool(row.get("liquidity_sanity_failed"))
        row_sane = sanitize_liquidity_payload(row, source="display")
        if row_sane.get("liquidity_sanity_failed"):
            sanity_failed = True
        current_ratio = _to_float(row_sane.get("current_ratio")) if current_ratio is None else current_ratio
        quick_ratio = _to_float(row_sane.get("quick_ratio")) if quick_ratio is None else quick_ratio
        cash_ratio = _to_float(row_sane.get("cash_ratio")) if cash_ratio is None else cash_ratio
        if liquidity_score is None:
            liquidity_score = _to_float(row_sane.get("liquidity_score"))

    if sanity_failed:
        return LIQUIDITY_DISPLAY_SANITY_FAIL

    parts: list[str] = []
    if current_ratio is not None and is_plausible_current_ratio(current_ratio):
        parts.append(f"CR {current_ratio:.2f}")
    if quick_ratio is not None:
        parts.append(f"QR {quick_ratio:.2f}")
    if cash_ratio is not None:
        parts.append(f"Cash {cash_ratio:.2f}")
    if parts:
        return " | ".join(parts)
    if liquidity_score is not None and liquidity_score != 1.0:
        return f"score {liquidity_score:.2f}"
    return None


def financial_row_liquidity_keys(row: Mapping[str, Any]) -> dict[str, Any]:
    """Subset of liquidity fields for API / tests."""
    keys = (
        "current_ratio",
        "quick_ratio",
        "cash_ratio",
        "liquidity_score",
        "liquidity_fy_date",
        "fy_date",
        "liquidita_fy",
        "liquidity_sanity_failed",
        "beta",
    )
    return {k: row.get(k) for k in keys if k in row}


def merge_liquidity_dict(target: dict[str, Any], liq: dict[str, Any]) -> dict[str, Any]:
    """Merge non-None, sanity-checked liquidity fields into *target* (enrich cache / df)."""
    sym = str(target.get("symbol") or target.get("ticker") or "").strip().upper()
    sane = sanitize_liquidity_payload(liq, ticker=sym, source="merge")
    if not liquidity_ratios_sane(sane):
        if sane.get("liquidity_sanity_failed"):
            clear_liquidity_fields(target)
            target["liquidity_sanity_failed"] = True
        return target
    target["liquidity_sanity_failed"] = False
    for k in LIQUIDITY_DF_COLUMNS:
        v = sane.get(k)
        if v is not None:
            target[k] = v
    fy = sane.get("liquidity_fy_date") or sane.get("fy_date")
    if fy is not None:
        target["liquidity_fy_date"] = fy
        target["fy_date"] = fy
    return target


def scan_enrich_cache_insane_ratios(
    cache_dir: str | os.PathLike[str],
    *,
    min_cr: float | None = None,
) -> list[tuple[str, float]]:
    """
    Return (ticker, current_ratio) pairs in cache needing revalidation.

  By default flags CR above hard max (100) or below ``cr_sanity_min()``; pass a lower
  *min_cr* (e.g. 50) to list cash-rich names for optional refresh.
    """
    if min_cr is None:
        min_cr = cr_hard_reject_above()
    bad: list[tuple[str, float]] = []
    root = os.fspath(cache_dir)
    if not os.path.isdir(root):
        return bad
    for name in os.listdir(root):
        if not name.lower().endswith(".json"):
            continue
        sym = name[:-5].upper()
        try:
            with open(os.path.join(root, name), encoding="utf-8") as fh:
                data = json.load(fh)
        except Exception:
            continue
        if not isinstance(data, dict):
            continue
        cr = _to_float(data.get("current_ratio"))
        if cr is None:
            continue
        if cr > min_cr or cr < cr_sanity_min():
            bad.append((sym, cr))
    return sorted(bad, key=lambda x: -x[1])


def revalidate_enrich_cache_file(
    path: str | os.PathLike[str],
    *,
    yf_module: Any | None = None,
    rewrite: bool = True,
) -> dict[str, Any]:
    """
    Re-fetch balance sheet for one ``enrich_cache/{TICKER}.json`` and fix liquidity keys.

    Returns summary dict: ``ticker``, ``action`` (``ok`` | ``cleared`` | ``skipped``), ``cr``.
    """
    p = os.fspath(path)
    sym = os.path.splitext(os.path.basename(p))[0].upper()
    if not sym or not os.path.isfile(p):
        return {"ticker": sym, "action": "skipped", "cr": None}
    try:
        with open(p, encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        return {"ticker": sym, "action": "skipped", "cr": None}
    if not isinstance(data, dict):
        return {"ticker": sym, "action": "skipped", "cr": None}
    old_cr = _to_float(data.get("current_ratio"))
    fresh = fetch_liquidity_yfinance(sym, yf_module=yf_module)
    if liquidity_ratios_sane(fresh):
        merge_liquidity_dict(data, fresh)
        action = "ok"
        new_cr = _to_float(data.get("current_ratio"))
    else:
        clear_liquidity_fields(data)
        if fresh and sanitize_liquidity_payload(fresh).get("liquidity_sanity_failed"):
            data["liquidity_sanity_failed"] = True
        action = "cleared"
        new_cr = None
    if rewrite:
        try:
            with open(p, "w", encoding="utf-8") as fh:
                json.dump(data, fh)
        except Exception:
            pass
    return {"ticker": sym, "action": action, "cr": new_cr, "old_cr": old_cr}
