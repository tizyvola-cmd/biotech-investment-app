"""
Volume-hype → Simulation funnel.

Prefilter: share-volume ≥400% vs the prior session. CT.gov budget goes to
**24h first** (same number as the VOL VS PREV column); 7d-only names are a
tail. The Simulation VOL column stays at 150%.

Then search CT.gov backwards (ticker → company name → sponsor) and keep the
study only if the Simulation harvest locks still hold:

  - sponsor_match Exact or Partial
  - if any future Exact exists, ignore Partial (LCTX / far-pivot rule)
  - nct_relation in the restricted set (direct sponsor / collaborator /
    correlated company/subsidiary)
  - next CD is in the future (past CD is not a hook)

Accepted rows are written to ``data/hype_volume_funnel_entries.json`` and merged
into the Simulation snapshot at read time (same sidecar pattern as manual
entries). CD 0–120d behaves like a normal sheet row; CD >120d is Off Book.

The morning research job (Lun–Ven 07:00 on the server) re-runs this scan.
New admits need last-session volume ≥400% (same number as VOL VS PREV).
Once in, a name stays **10 days**. After that it stays while the price is
still rising (last close > prior close, or ≥1% above the entry print),
then **3 more days** after the rise stops. Open portfolio positions stay
in the pipeline (no 10-day expiry). A Yahoo miss does not wipe the list.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterable

from orchestrator_io_paths import (
    DATA_DIR,
    INVEST_SIM_INPUTS_JSON,
    SIMULATION_SHEET_SNAPSHOT_JSON,
)
from prediction.nct_cohort import is_restricted_nct_relation

logger = logging.getLogger("supernova.hype_volume_funnel")

HYPE_ENTRIES_PATH = Path(DATA_DIR) / "hype_volume_funnel_entries.json"
VOLUME_SURGE_PCT = 400
HYPE_HOLD_DAYS = 10
HYPE_PRICE_UP_GRACE_DAYS = 3
HYPE_PRICE_UP_EPS = 0.01  # 1% above the first-print to count as "risen"
FUNNEL_HORIZON_DAYS = 3650  # see far Exact so Partial-in-window cannot sneak in
SIM_DISPLAY_HORIZON_DAYS = 120
MAX_VOLUME_TICKERS = 80
MAX_CTGOV_PER_SCAN = 12
_CLINICAL_SNAPSHOT = Path(DATA_DIR) / "clinical_pre_cd_enrichment_snapshot.json"
_STATUS_LOCK = threading.Lock()
_STATUS: dict[str, Any] = {
    "running": False,
    "updated_at": None,
    "last": None,
}


def get_status() -> dict[str, Any]:
    with _STATUS_LOCK:
        return dict(_STATUS)


def _set_status(**kwargs: Any) -> None:
    with _STATUS_LOCK:
        _STATUS.update(kwargs)
        _STATUS["updated_at"] = datetime.now(timezone.utc).astimezone().isoformat()


def funnel_nct_relation_ok(v: object) -> bool:
    if is_restricted_nct_relation(v):
        return True
    return str(v or "").strip().lower() in {"subsidiary"}


def _parse_cd(raw: object) -> date | None:
    s = str(raw or "").strip()[:10]
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    try:
        ts = datetime.fromisoformat(s)
        return ts.date()
    except ValueError:
        return None


def _cd_display(d: date) -> str:
    return f"{d.day:02d}/{d.month:02d}/{d.year}"


def _today() -> date:
    return date.today()


def load_hype_entries() -> list[dict[str, Any]]:
    if not HYPE_ENTRIES_PATH.is_file():
        return []
    try:
        doc = json.loads(HYPE_ENTRIES_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    if not isinstance(doc, dict):
        return []
    raw = doc.get("entries") or []
    if not isinstance(raw, list):
        return []
    return [e for e in raw if isinstance(e, dict) and e.get("Ticker")]


def load_snapshot_hype_entries(
    snapshot_path: Path | None = None,
) -> list[dict[str, Any]]:
    """Hype rows already planted on the Simulation snapshot.

    Used when the sidecar JSON was emptied (failed 24h-only scan) but the
    snapshot still has CANF/BIAF/… so Evaluation Lab can keep them.
    """
    path = Path(snapshot_path or SIMULATION_SHEET_SNAPSHOT_JSON)
    if not path.is_file():
        return []
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    rows = doc.get("rows") if isinstance(doc, dict) else None
    if not isinstance(rows, list):
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for r in rows:
        if not isinstance(r, dict) or not r.get("hype_volume_funnel"):
            continue
        tk = str(r.get("Ticker") or "").strip().upper()
        if not tk or tk in seen:
            continue
        seen.add(tk)
        row = dict(r)
        row["Ticker"] = tk
        row["hype_volume_funnel"] = True
        out.append(row)
    return out


def select_hype_for_ctgov(
    surged_all: list[tuple[str, dict[str, Any]]],
    kept_tks: Iterable[str],
    *,
    budget: int = MAX_CTGOV_PER_SCAN,
) -> list[tuple[str, dict[str, Any]]]:
    """24h spikes first; leftover CT.gov slots go to the 7d-only tail."""
    skip = {str(t).strip().upper() for t in kept_tks if str(t).strip()}
    out: list[tuple[str, dict[str, Any]]] = []
    for tk, row in order_hype_for_ctgov(list(surged_all)):
        if tk in skip:
            continue
        out.append((tk, row))
        if len(out) >= max(0, int(budget)):
            break
    return out


def _write_hype_doc(
    entries: list[dict[str, Any]],
    *,
    rejected: list[dict[str, Any]] | None = None,
    meta: dict[str, Any] | None = None,
) -> None:
    HYPE_ENTRIES_PATH.parent.mkdir(parents=True, exist_ok=True)
    doc = {
        "updated_at": datetime.now(timezone.utc).astimezone().isoformat(),
        "entries": entries,
        "rejected": rejected or [],
        "meta": meta or {},
    }
    HYPE_ENTRIES_PATH.write_text(
        json.dumps(doc, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    try:
        sync_hype_rows_into_simulation_snapshot(entries)
    except Exception:  # noqa: BLE001
        logger.exception("hype snapshot sync failed")


def sync_hype_rows_into_simulation_snapshot(
    entries: list[dict[str, Any]],
    *,
    snapshot_path: Path | None = None,
) -> int:
    """Replace ``hype_volume_funnel`` rows in the Simulation snapshot JSON.

    Evaluation Lab loads this file first and never hits the API merge, so the
    sidecar alone is invisible until the next Orchestrator rewrite.

    Preserves live-signal / enrich fields already on a prior hype row for the
    same ticker (price, slopes, beta) so a resync does not blank the KPI cards.
    """
    path = Path(snapshot_path or SIMULATION_SHEET_SNAPSHOT_JSON)
    if not path.is_file():
        return 0
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return 0
    if not isinstance(doc, dict):
        return 0
    rows = [r for r in (doc.get("rows") or []) if isinstance(r, dict)]
    prev_hype: dict[str, dict[str, Any]] = {}
    for r in rows:
        if not r.get("hype_volume_funnel"):
            continue
        tk = str(r.get("Ticker") or "").strip().upper()
        if tk:
            prev_hype[tk] = r
    kept = [r for r in rows if not r.get("hype_volume_funnel")]
    existing = {
        str(r.get("Ticker") or "").strip().upper()
        for r in kept
        if str(r.get("Ticker") or "").strip()
    }
    added = 0
    for e in entries:
        if not isinstance(e, dict):
            continue
        tk = str(e.get("Ticker") or "").strip().upper()
        if not tk or tk in existing:
            continue
        row = dict(e)
        prior = prev_hype.get(tk)
        if prior:
            # Keep price/slope/beta/liq from a prior live-signals pass.
            for k, v in prior.items():
                if k in row and row.get(k) not in (None, "", "—", "-"):
                    continue
                if k.startswith("hype_"):
                    continue
                if v in (None, "", "—", "-"):
                    continue
                row.setdefault(k, v)
        row["hype_volume_funnel"] = True
        kept.append(row)
        existing.add(tk)
        added += 1
    doc = dict(doc)
    doc["rows"] = kept
    if "row_count" in doc:
        doc["row_count"] = len(kept)
    tmp = path.with_suffix(".json.hype-tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)
    n_fin = patch_hype_financials_from_enrich_cache(snapshot_path=path)
    if n_fin:
        logger.info("hype enrich_cache financials patched on %d row(s)", n_fin)
    return added


def patch_hype_financials_from_enrich_cache(
    *,
    snapshot_path: Path | None = None,
    cache_dir: Path | None = None,
) -> int:
    """Fill Beta + Liquidità FY on hype rows from ``data/enrich_cache/{TICKER}.json``.

    Hype names skip the Orchestrator financial pass; the cache often already
    has Yahoo beta/ratios from clinical-pre-CD / prior enrich.
    """
    path = Path(snapshot_path or SIMULATION_SHEET_SNAPSHOT_JSON)
    if not path.is_file():
        return 0
    cdir = Path(cache_dir or (Path(DATA_DIR) / "enrich_cache"))
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return 0
    if not isinstance(doc, dict):
        return 0
    rows = [r for r in (doc.get("rows") or []) if isinstance(r, dict)]
    try:
        from prediction.financial_liquidity import format_liquidity_display
    except Exception:  # noqa: BLE001
        format_liquidity_display = None  # type: ignore[assignment]

    changed = 0
    for r in rows:
        if not r.get("hype_volume_funnel"):
            continue
        tk = str(r.get("Ticker") or "").strip().upper()
        if not tk:
            continue
        cache_path = cdir / f"{tk}.json"
        if not cache_path.is_file():
            continue
        try:
            cache = json.loads(cache_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not isinstance(cache, dict):
            continue
        patched = False
        beta = cache.get("beta")
        if beta is not None and r.get("Beta (5Y vs mercato)") in (None, "", "—", "-"):
            try:
                r["Beta (5Y vs mercato)"] = round(float(beta), 3)
                patched = True
            except (TypeError, ValueError):
                pass
        liq_score = cache.get("liquidity_score")
        if liq_score is not None and r.get("liquidity_score") in (None, "", "—", "-"):
            try:
                r["liquidity_score"] = float(liq_score)
                patched = True
            except (TypeError, ValueError):
                pass
        fy = r.get("Liquidità (FY)")
        if fy in (None, "", "—", "-") and format_liquidity_display is not None:
            try:
                disp = format_liquidity_display(
                    current_ratio=cache.get("current_ratio"),
                    quick_ratio=cache.get("quick_ratio"),
                    cash_ratio=cache.get("cash_ratio"),
                    liquidity_score=cache.get("liquidity_score"),
                )
            except Exception:  # noqa: BLE001
                disp = None
            if disp:
                r["Liquidità (FY)"] = disp
                patched = True
        price = cache.get("currentPrice")
        if (
            price is not None
            and r.get("Prezzo Corrente ($)") in (None, "", "—", "-")
        ):
            try:
                r["Prezzo Corrente ($)"] = float(price)
                patched = True
            except (TypeError, ValueError):
                pass
        if patched:
            changed += 1

    if not changed:
        return 0
    doc = dict(doc)
    doc["rows"] = rows
    tmp = path.with_suffix(".json.hype-fin-tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)
    return changed

def load_simulation_tickers(*, exclude_hype: bool = False) -> set[str]:
    """Tickers on the Simulation snapshot.

    ``exclude_hype=True`` skips rows planted by this funnel. A later daily
    rescan must not treat those as “already on sheet” or it drops them from
    the sidecar and ``sync_hype_rows_into_simulation_snapshot`` wipes them.
    """
    p = Path(SIMULATION_SHEET_SNAPSHOT_JSON)
    if not p.is_file():
        return set()
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return set()
    rows = doc.get("rows") if isinstance(doc, dict) else None
    if not isinstance(rows, list):
        return set()
    out: set[str] = set()
    for r in rows:
        if not isinstance(r, dict):
            continue
        if exclude_hype and r.get("hype_volume_funnel"):
            continue
        tk = str(r.get("Ticker") or "").strip().upper()
        if tk:
            out.add(tk)
    return out


def _clinical_feed_tickers() -> set[str]:
    """Tickers SuperNova already harvested (clinical-pre-CD) — not the raw yf dump."""
    if not _CLINICAL_SNAPSHOT.is_file():
        return set()
    try:
        doc = json.loads(_CLINICAL_SNAPSHOT.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return set()
    recs = doc.get("records") if isinstance(doc, dict) else None
    if not isinstance(recs, list):
        return set()
    out: set[str] = set()
    for r in recs:
        if not isinstance(r, dict):
            continue
        tk = str(r.get("ticker") or r.get("Ticker") or "").strip().upper()
        if tk:
            out.add(tk)
    return out


def candidate_tickers(
    *,
    already_on_sheet: Iterable[str] | None = None,
    limit: int | None = None,
    today: date | None = None,
) -> list[str]:
    """Off-sheet clinical-feed ∪ medtech names with a known company.

    Does **not** scan the full yf.json dump (ALLY / ALLT noise).
    """
    del today  # full universe each scan — no daily ALL* rotation
    from medtech_universe import (
        CURATED_MEDTECH,
        MEDTECH_SYMBOLS_JSON,
        load_json_list,
        load_ticker_to_company,
    )

    skip = {str(t).strip().upper() for t in (already_on_sheet or []) if str(t).strip()}
    t2c = load_ticker_to_company()
    pool = _clinical_feed_tickers()
    pool |= set(load_json_list(MEDTECH_SYMBOLS_JSON))
    pool |= set(CURATED_MEDTECH)
    names = sorted(t for t in pool if t and t not in skip and t in t2c)
    if limit is None:
        return names
    return names[: max(1, int(limit))]


def pick_trusted_next_cd(
    studies: list[dict[str, Any]],
    *,
    today: date | None = None,
    trusted_fn: Callable[[dict[str, Any]], bool] | None = None,
    relation_fn: Callable[[dict[str, Any]], str] | None = None,
) -> dict[str, Any] | None:
    """Earliest future trusted CD; Exact pool wins over Partial (even if Exact is far)."""
    day = today or _today()

    def _trusted(row: dict[str, Any]) -> bool:
        if trusted_fn is not None:
            return bool(trusted_fn(row))
        return _default_trusted(row)

    def _relation(row: dict[str, Any]) -> str:
        if relation_fn is not None:
            return str(relation_fn(row) or "").strip()
        cached = str(row.get("nct_relation_type") or "").strip()
        if cached:
            return cached
        return _default_relation(row)

    future: list[tuple[date, dict[str, Any], str]] = []
    for row in studies:
        if not isinstance(row, dict):
            continue
        sm = str(row.get("sponsor_match") or "").strip().lower()
        if sm not in ("exact", "partial"):
            continue
        cd = _parse_cd(row.get("completion_date") or row.get("cd_date"))
        if cd is None or cd < day:
            continue
        if not _trusted(row):
            continue
        rel = _relation(row)
        if not funnel_nct_relation_ok(rel):
            continue
        future.append((cd, row, sm))

    if not future:
        return None
    exact = [(cd, row, sm) for cd, row, sm in future if sm == "exact"]
    pool = exact if exact else future
    pool.sort(key=lambda t: t[0])
    cd, row, sm = pool[0]
    days = (cd - day).days
    bucket = "sim" if days <= SIM_DISPLAY_HORIZON_DAYS else "off_book"
    return {
        "row": row,
        "cd": cd,
        "sponsor_match": "Exact" if sm == "exact" else "Partial",
        "nct_relation_type": _relation(row),
        "days_to_cd": days,
        "bucket": bucket,
    }


def _default_trusted(row: dict[str, Any]) -> bool:
    try:
        from prediction.eis_feed_quality import is_study_sponsor_trusted
    except Exception:
        sm = str(row.get("sponsor_match") or "").strip().lower()
        return sm in ("exact", "partial")
    rec = {
        "ticker": row.get("ticker"),
        "company": row.get("query_company") or row.get("company"),
        "lead_sponsor": row.get("lead_sponsor"),
        "sponsor_match": row.get("sponsor_match"),
        "meta": {
            "lead_sponsor": row.get("lead_sponsor"),
            "responsible_party_org": row.get("responsible_party_org") or "",
            "collaborators": row.get("collaborators") or "",
        },
    }
    return bool(is_study_sponsor_trusted(rec))


def _infer_restricted_relation(row: dict[str, Any]) -> str | None:
    """Map discover Exact/Partial + lead onto the Simulation relation lock.

    Used only when the orchestrator NCT network cache has never seen this study
    (returns N/D). Does not override a real ``indirect connections`` label.
    """
    sm = str(row.get("sponsor_match") or "").strip().lower()
    lead = str(row.get("lead_sponsor") or "").strip()
    if sm in ("exact", "direct match") and lead:
        return "direct sponsor"
    if sm == "partial":
        return "collaborator"
    return None


def _default_relation(row: dict[str, Any]) -> str:
    cached = str(row.get("nct_relation_type") or "").strip()
    if cached:
        return cached
    nct = str(row.get("nct_id") or "").strip().upper()
    company = str(row.get("query_company") or row.get("company") or "").strip()
    if not nct.startswith("NCT") or not company:
        inferred = _infer_restricted_relation(row)
        return inferred or "N/D"
    rel = "N/D"
    try:
        from data_orchestrator import nct_relation_type_for_company_nct

        rel = str(nct_relation_type_for_company_nct(company, nct) or "N/D").strip() or "N/D"
    except Exception:
        rel = "N/D"
    if funnel_nct_relation_ok(rel):
        return rel
    if str(rel).strip().upper() in {"", "N/D"}:
        inferred = _infer_restricted_relation(row)
        if inferred:
            return inferred
    return rel


def build_sim_row_from_pick(
    ticker: str,
    pick: dict[str, Any],
    *,
    volume_window: str,
    company: str = "",
) -> dict[str, Any]:
    row = pick["row"] if isinstance(pick.get("row"), dict) else {}
    cd: date = pick["cd"]
    nct = str(row.get("nct_id") or "").strip().upper()
    href = f"https://clinicaltrials.gov/study/{nct}" if nct.startswith("NCT") else ""
    company_name = (
        str(company or row.get("query_company") or row.get("company") or ticker).strip()
    )
    lead = str(row.get("lead_sponsor") or "").strip()
    sm = str(pick.get("sponsor_match") or "Partial")
    rel = str(pick.get("nct_relation_type") or "")
    phase = str(row.get("phase") or row.get("Studio Phase") or "").strip()
    title = str(row.get("brief_title") or "").strip()
    return {
        "Ticker": ticker.strip().upper(),
        "Società": company_name,
        "Completion Date": _cd_display(cd),
        "Exact·Partial vs Unmatch": sm,
        "Lead sponsor": lead,
        "Società (full name)": company_name,
        "NCT": {"text": nct, "href": href} if href else nct,
        "Sponsor (da NCT)": lead,
        "Relazione sponsor": rel,
        "Link studio": {"text": "CT.gov ↗", "href": href} if href else "",
        "Studio Phase": phase or title,
        "hype_volume_funnel": True,
        "hype_volume_window": volume_window,
        "hype_days_to_cd": pick.get("days_to_cd"),
        "hype_cd_bucket": pick.get("bucket"),
        "hype_first_seen": _today().isoformat(),
    }


def _volume_pct(row: dict[str, Any], key: str) -> float:
    raw = row.get(key)
    try:
        if raw is not None:
            return float(raw)
    except (TypeError, ValueError):
        return 0.0
    return 0.0


def _surge_rank(row: dict[str, Any]) -> float:
    """Highest of last-session % and 7d max % — eligibility, not CT.gov order."""
    return max(_volume_pct(row, "pct_of_prev"), _volume_pct(row, "max_pct_7d"))


def is_hype_24h(row: dict[str, Any] | None) -> bool:
    """VOL VS PREV (last session vs prior) ≥ 400%."""
    if not isinstance(row, dict):
        return False
    return _volume_pct(row, "pct_of_prev") >= VOLUME_SURGE_PCT


def meets_hype_volume(row: dict[str, Any] | None) -> bool:
    """24h or 7d volume vs the prior session ≥ 400%. Ignores the 150% VOL flags."""
    if not isinstance(row, dict):
        return False
    return _surge_rank(row) >= VOLUME_SURGE_PCT


def parse_hype_first_seen(raw: object) -> date | None:
    s = str(raw or "").strip()[:10]
    if not s:
        return None
    try:
        return date.fromisoformat(s)
    except ValueError:
        return _parse_cd(s)


def _float_price(raw: object) -> float | None:
    try:
        v = float(raw)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    if v != v or v <= 0:
        return None
    return v


def is_hype_price_rising(
    *,
    entry_price: float | None,
    last_close: float | None,
    prev_close: float | None,
) -> bool:
    """True when the tape has started moving up since the hype print."""
    if last_close is None:
        return False
    if prev_close is not None and last_close > prev_close:
        return True
    if entry_price is not None and last_close >= entry_price * (1.0 + HYPE_PRICE_UP_EPS):
        return True
    return False


def hype_price_up_grace_ok(last_up: date | None, today: date) -> bool:
    """Keep 3 days after the last up-day (cessazione dell'aumento)."""
    if last_up is None:
        return False
    return (today - last_up).days <= HYPE_PRICE_UP_GRACE_DAYS


def load_portfolio_tickers(
    *,
    inputs_path: Path | None = None,
) -> set[str]:
    """Tickers with an open book (capital > 0 and buy price > 0)."""
    p = Path(inputs_path or INVEST_SIM_INPUTS_JSON)
    if not p.is_file():
        return set()
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return set()
    raw = doc.get("inputs") if isinstance(doc, dict) else doc
    if not isinstance(raw, dict):
        return set()
    out: set[str] = set()
    for key, slot in raw.items():
        if not isinstance(slot, dict):
            continue
        try:
            capital = float(slot.get("capital") or 0)
            buy = float(slot.get("buyPrice") or 0)
        except (TypeError, ValueError):
            continue
        if capital <= 0 or buy <= 0:
            continue
        tk = str(key).split("|", 1)[0].strip().upper()
        if tk:
            out.add(tk)
    return out


def retain_prior_hype_entries(
    existing: list[dict[str, Any]],
    vol_rows: dict[str, Any],
    *,
    on_sheet: Iterable[str] | None = None,
    portfolio: Iterable[str] | None = None,
    today: date | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Keep prior hype names for 10 days, or longer if price is rising / portfolio.

    After the 10-day floor: keep while the tape is still up, then 3 days after
    the last up-day. Missing volume data → keep. Core-sheet harvest (not this
    funnel) → drop. Returns ``(kept, dropped)``.
    """
    skip = {str(t).strip().upper() for t in (on_sheet or []) if str(t).strip()}
    book = {str(t).strip().upper() for t in (portfolio or []) if str(t).strip()}
    day = today or _today()
    kept: list[dict[str, Any]] = []
    dropped: list[dict[str, Any]] = []
    for prev in existing:
        if not isinstance(prev, dict):
            continue
        tk = str(prev.get("Ticker") or "").strip().upper()
        if not tk:
            continue
        if tk in skip:
            dropped.append({**prev, "drop_reason": "now_on_sheet"})
            continue
        row = dict(prev)
        first = parse_hype_first_seen(row.get("hype_first_seen"))
        if first is None:
            first = day
            row["hype_first_seen"] = day.isoformat()
        age = (day - first).days
        vrow = vol_rows.get(tk) or vol_rows.get(tk.upper())
        last_close = _float_price(vrow.get("last_close") if isinstance(vrow, dict) else None)
        prev_close = _float_price(vrow.get("prev_close") if isinstance(vrow, dict) else None)
        entry = _float_price(row.get("hype_entry_price"))
        if entry is None and last_close is not None:
            row["hype_entry_price"] = last_close
            entry = last_close
        if last_close is not None:
            row["hype_last_price"] = last_close

        rising = is_hype_price_rising(
            entry_price=entry, last_close=last_close, prev_close=prev_close
        )
        last_up = parse_hype_first_seen(row.get("hype_last_up_date"))
        if rising:
            row["hype_last_up_date"] = day.isoformat()
            last_up = day
            if last_close is not None:
                peak = _float_price(row.get("hype_peak_price"))
                if peak is None or last_close > peak:
                    row["hype_peak_price"] = last_close
        grace_ok = hype_price_up_grace_ok(last_up, day)

        if tk in book:
            row["hype_hold_reason"] = "portfolio"
            kept.append(row)
            continue
        if isinstance(vrow, dict) and is_hype_24h(vrow):
            row["hype_volume_window"] = "24h"
            row["hype_hold_reason"] = "still_hot"
            kept.append(row)
            continue
        if not isinstance(vrow, dict):
            row["hype_hold_reason"] = "hold" if age <= HYPE_HOLD_DAYS else "yahoo_miss"
            kept.append(row)
            continue
        if age <= HYPE_HOLD_DAYS:
            row["hype_hold_reason"] = "hold"
            kept.append(row)
            continue
        if rising:
            row["hype_hold_reason"] = "price_up"
            kept.append(row)
            continue
        if grace_ok:
            row["hype_hold_reason"] = "price_up_grace"
            kept.append(row)
            continue
        dropped.append({**row, "drop_reason": "hold_expired"})
    return kept, dropped


def hype_ctgov_sort_key(row: dict[str, Any]) -> tuple[int, float]:
    """24h spikes first (0), then 7d-only tail (1); higher % first within each."""
    if is_hype_24h(row):
        return (0, -_volume_pct(row, "pct_of_prev"))
    return (1, -_volume_pct(row, "max_pct_7d"))


def order_hype_for_ctgov(
    items: list[tuple[str, dict[str, Any]]],
) -> list[tuple[str, dict[str, Any]]]:
    """Spend CT.gov on 24h VOL VS PREV; 7d-only names fill leftover slots."""
    return sorted(items, key=lambda t: hype_ctgov_sort_key(t[1]))


def _volume_window_label(row: dict[str, Any]) -> str:
    return "24h" if is_hype_24h(row) else "7d"


def _funnel_reject(ticker: str, studies: list[dict[str, Any]]) -> dict[str, Any]:
    if not studies:
        return {"ticker": ticker, "reason": "funnel_no_studies"}
    sample = studies[0] if isinstance(studies[0], dict) else {}
    return {
        "ticker": ticker,
        "reason": "funnel_no_trusted_cd",
        "studies": len(studies),
        "sample_sm": sample.get("sponsor_match"),
        "sample_rel": _default_relation(sample) if sample else None,
        "sample_trusted": _default_trusted(sample) if sample else None,
    }


def _discover_studies(ticker: str) -> list[dict[str, Any]]:
    from medtech_universe import discover_ctgov_sponsor_studies

    _, rows = discover_ctgov_sponsor_studies(
        tickers=[ticker],
        horizon_days=FUNNEL_HORIZON_DAYS,
        per_ticker_limit=20,
    )
    return list(rows or [])


def _try_begin_scan() -> bool:
    with _STATUS_LOCK:
        if _STATUS.get("running"):
            return False
        _STATUS["running"] = True
        _STATUS["last"] = None
        _STATUS["updated_at"] = datetime.now(timezone.utc).astimezone().isoformat()
        return True


def run_hype_volume_funnel_scan(
    tickers: list[str] | None = None,
    *,
    force: bool = False,
) -> dict[str, Any]:
    """Volume-gate off-sheet names, then CT.gov funnel. Persists accepted rows."""
    del force  # reserved — scan always uses live volume
    if not _try_begin_scan():
        return {"started": False, "message": "Already running"}
    t0 = time.time()
    try:
        # Core sheet only — hype rows live in the snapshot after sync and must
        # stay eligible for keep/refresh on the next daily scan.
        on_sheet = load_simulation_tickers(exclude_hype=True)
        requested = [
            str(t).strip().upper()
            for t in (tickers or [])
            if str(t).strip()
        ]
        prior_entries = load_hype_entries() or load_snapshot_hype_entries()
        prior_tks = {
            str(e.get("Ticker") or "").strip().upper()
            for e in prior_entries
            if str(e.get("Ticker") or "").strip()
        }
        vol_targets = [t for t in requested if t not in on_sheet] if requested else candidate_tickers(
            already_on_sheet=on_sheet
        )
        seen_vol = {str(t).strip().upper() for t in vol_targets}
        for tk in sorted(prior_tks):
            if tk and tk not in on_sheet and tk not in seen_vol:
                vol_targets.append(tk)
                seen_vol.add(tk)
        from market_volume_history import fetch_volume_vs_prev_session

        vol_rows: dict[str, Any] = {}
        for i in range(0, len(vol_targets), MAX_VOLUME_TICKERS):
            batch = vol_targets[i : i + MAX_VOLUME_TICKERS]
            vol = fetch_volume_vs_prev_session(batch, force=True)
            chunk = vol.get("rows") if isinstance(vol, dict) else {}
            if isinstance(chunk, dict):
                vol_rows.update(chunk)

        surged: list[tuple[str, dict[str, Any]]] = []
        for tk in vol_targets:
            row = vol_rows.get(tk) or vol_rows.get(tk.upper())
            if not isinstance(row, dict):
                continue
            if meets_hype_volume(row):
                surged.append((tk, row))

        surged.sort(key=lambda t: hype_ctgov_sort_key(t[1]))
        surged_all = list(surged)
        n_24h = sum(1 for _, row in surged_all if is_hype_24h(row))
        existing_keep, dropped_stale = retain_prior_hype_entries(
            prior_entries,
            vol_rows,
            on_sheet=on_sheet,
            portfolio=load_portfolio_tickers(),
        )
        kept_tks = {
            str(e.get("Ticker") or "").strip().upper()
            for e in existing_keep
            if str(e.get("Ticker") or "").strip()
        }
        surged = select_hype_for_ctgov(surged_all, kept_tks)
        from medtech_universe import load_ticker_to_company

        t2c = load_ticker_to_company()
        accepted: list[dict[str, Any]] = []
        rejected: list[dict[str, Any]] = []

        for tk, vrow in surged:
            if tk in on_sheet:
                rejected.append({"ticker": tk, "reason": "already_on_sheet"})
                continue
            company = str(t2c.get(tk) or "").strip()
            if len(company) < 3:
                rejected.append({"ticker": tk, "reason": "no_company_name"})
                continue
            try:
                studies = _discover_studies(tk)
            except Exception as exc:  # noqa: BLE001
                logger.warning("CT.gov discover %s: %s", tk, exc)
                rejected.append({"ticker": tk, "reason": "ctgov_error"})
                continue
            pick = pick_trusted_next_cd(studies)
            if not pick:
                rejected.append(_funnel_reject(tk, studies))
                continue
            row = build_sim_row_from_pick(
                tk,
                pick,
                volume_window=_volume_window_label(vrow),
                company=company,
            )
            entry_px = _float_price(vrow.get("last_close"))
            if entry_px is not None:
                row["hype_entry_price"] = entry_px
                row["hype_last_price"] = entry_px
            row["hype_hold_reason"] = "hold"
            accepted.append(row)

        merged: list[dict[str, Any]] = []
        seen: set[str] = set()
        for e in accepted + existing_keep:
            tk = str(e.get("Ticker") or "").strip().upper()
            if not tk or tk in seen or tk in on_sheet:
                continue
            seen.add(tk)
            merged.append(e)

        meta = {
            "volume_scanned": len(vol_targets),
            "surged": len(surged_all),
            "n_24h": n_24h,
            "n_7d_tail": len(surged_all) - n_24h,
            "surge_pct": VOLUME_SURGE_PCT,
            "ctgov_budget": len(surged),
            "accepted": len(accepted),
            "rejected": len(rejected),
            "dropped_stale": len(dropped_stale),
            "kept_prior": len(existing_keep),
            "elapsed_s": round(time.time() - t0, 1),
            "surged_top": [
                {
                    "ticker": tk,
                    "pct": (
                        _volume_pct(row, "pct_of_prev")
                        if is_hype_24h(row)
                        else _volume_pct(row, "max_pct_7d")
                    ),
                    "window": _volume_window_label(row),
                }
                for tk, row in surged_all[:20]
            ],
        }
        if not merged and not dropped_stale:
            restored = load_snapshot_hype_entries()
            if restored:
                merged = restored
                meta["restored_from_snapshot"] = [
                    str(e.get("Ticker") or "").strip().upper()
                    for e in restored
                    if str(e.get("Ticker") or "").strip()
                ]
        _write_hype_doc(merged, rejected=rejected, meta=meta)
        last = {**meta, "tickers": [e.get("Ticker") for e in accepted]}
        _set_status(running=False, last=last)
        return {"started": False, "done": True, **last}
    except Exception as exc:  # noqa: BLE001
        logger.exception("hype volume funnel scan failed")
        last = {"error": str(exc)[:300]}
        _set_status(running=False, last=last)
        return {"started": False, "done": True, **last}


def start_hype_volume_funnel_scan(
    tickers: list[str] | None = None,
) -> dict[str, Any]:
    if get_status().get("running"):
        return {"started": False, "message": "Already running"}

    def _target() -> None:
        run_hype_volume_funnel_scan(tickers)

    threading.Thread(target=_target, name="hype-volume-funnel", daemon=True).start()
    return {"started": True, "tickers": tickers or []}
