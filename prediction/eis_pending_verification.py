"""
Pending-verification registry for anticipated EIS events.

The clinical AI passes emit plausible-but-unconfirmed milestones ("Potential
ESMO 2026 presentation", "AASLD abstract submission window"). Those rows carry
no EIS (see ``prediction.eis_feed_quality.gate_event_confirmation``), but the
lead itself is worth keeping: when the expected window opens the system goes
looking for the real abstract or paper, and only then does the event get a
score.

Lifecycle:  pending → confirmed (hard source found)
                    → expired   (window closed, nothing found)
                    → dismissed (manual)
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

_DATA_DIR = Path(__file__).resolve().parent.parent / "data"
_STORE_PATH = _DATA_DIR / "eis_pending_verification.json"

STATUS_PENDING = "pending"
STATUS_CONFIRMED = "confirmed"
STATUS_EXPIRED = "expired"
STATUS_DISMISSED = "dismissed"

# A hypothesis is re-checked from this many days before its window opens…
CHECK_LEAD_DAYS = 14
# …and stays open this long after the window closes before expiring.
EXPIRY_GRACE_DAYS = 45
# Never re-check the same hypothesis more often than this.
MIN_DAYS_BETWEEN_CHECKS = 7


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _as_date(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value or "").strip()[:10]
    if not text:
        return None
    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError:
        return None


def hypothesis_id(ticker: str, title: str) -> str:
    """Stable id — the same hypothesis re-emitted by a later refresh must not duplicate."""
    norm = re.sub(r"[^a-z0-9]+", " ", str(title or "").lower()).strip()
    raw = f"{str(ticker or '').upper()}|{norm}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def load_registry() -> dict[str, Any]:
    try:
        data = json.loads(_STORE_PATH.read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("items"), list):
            return data
    except FileNotFoundError:
        pass
    except Exception as exc:  # noqa: BLE001 — a corrupt store must not break refresh
        print(f"[EISPending][WARN] registry unreadable, starting empty: {exc}", flush=True)
    return {"updated_at": None, "items": []}


def save_registry(items: list[dict[str, Any]]) -> None:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(
        {"updated_at": _now_iso(), "count": len(items), "items": items},
        ensure_ascii=False,
        indent=2,
        default=str,
    )
    tmp_path = _STORE_PATH.with_suffix(".json.tmp")
    tmp_path.write_text(payload, encoding="utf-8")
    last_exc: BaseException | None = None
    for attempt in range(5):
        try:
            os.replace(str(tmp_path), str(_STORE_PATH))
            last_exc = None
            break
        except OSError as exc:  # Windows: AV / concurrent readers
            last_exc = exc
            time.sleep(0.15 * (attempt + 1))
    if last_exc is not None:
        raise last_exc


def _hypothesis_from_event(
    ev: dict[str, Any],
    *,
    ticker: str,
    company: str = "",
    nct_id: str = "",
) -> dict[str, Any]:
    title = str(ev.get("event_title") or "").strip()
    return {
        "id": hypothesis_id(ticker, title),
        "ticker": str(ticker or "").upper(),
        "company": str(company or "").strip(),
        "drug": str(ev.get("drug") or ev.get("asset") or "").strip(),
        "nct_id": str(nct_id or "").strip().upper(),
        "title": title,
        "summary": str(ev.get("summary") or "").strip()[:800],
        "venue": str(ev.get("publication_venue") or ev.get("link_label") or "").strip(),
        "source_type": str(ev.get("source_type") or "").strip(),
        "verification_hint": str(ev.get("verification_hint") or "").strip(),
        "expected_window_start": ev.get("expected_window_start"),
        "expected_window_end": ev.get("expected_window_end"),
        "hypothesis_date": str(ev.get("event_date") or "")[:10] or None,
        "confirmation_reason": ev.get("confirmation_reason"),
        "status": STATUS_PENDING,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        "last_checked_at": None,
        "check_count": 0,
        "resolution": None,
    }


def upsert_hypotheses(
    events: list[dict[str, Any]],
    *,
    ticker: str,
    company: str = "",
    nct_id: str = "",
) -> dict[str, int]:
    """Queue every anticipated event of a record. Idempotent across refreshes."""
    from prediction.eis_feed_quality import ANTICIPATED, classify_event_confirmation

    reg = load_registry()
    items: list[dict[str, Any]] = list(reg.get("items") or [])
    by_id = {str(it.get("id")): it for it in items if isinstance(it, dict)}
    added = updated = 0

    for ev in events:
        if not isinstance(ev, dict):
            continue
        verdict = classify_event_confirmation(ev)
        if verdict["status"] != ANTICIPATED:
            continue
        row = dict(ev)
        row.setdefault("expected_window_start", verdict.get("expected_window_start"))
        row.setdefault("expected_window_end", verdict.get("expected_window_end"))
        row.setdefault("confirmation_reason", verdict.get("reason"))
        cand = _hypothesis_from_event(row, ticker=ticker, company=company, nct_id=nct_id)
        prev = by_id.get(cand["id"])
        if prev is None:
            by_id[cand["id"]] = cand
            added += 1
            continue
        # Already tracked: refresh the descriptive fields, keep lifecycle state.
        if prev.get("status") in (STATUS_CONFIRMED, STATUS_DISMISSED):
            continue
        for field in (
            "company",
            "drug",
            "nct_id",
            "summary",
            "venue",
            "source_type",
            "verification_hint",
            "expected_window_start",
            "expected_window_end",
        ):
            if cand.get(field) and not prev.get(field):
                prev[field] = cand[field]
        prev["updated_at"] = _now_iso()
        updated += 1

    save_registry(list(by_id.values()))
    return {"added": added, "updated": updated, "total": len(by_id)}


def is_due_for_check(
    item: dict[str, Any],
    *,
    as_of: date | None = None,
    force: bool = False,
) -> bool:
    """True when the window is open (minus lead) and the cooldown has elapsed."""
    if str(item.get("status")) != STATUS_PENDING:
        return False
    today = as_of or date.today()
    start = _as_date(item.get("expected_window_start")) or _as_date(item.get("hypothesis_date"))
    if start and today < start - timedelta(days=CHECK_LEAD_DAYS):
        return False
    if force:
        return True
    last = item.get("last_checked_at")
    if last:
        last_day = _as_date(str(last)[:10])
        if last_day and (today - last_day).days < MIN_DAYS_BETWEEN_CHECKS:
            return False
    return True


def is_expired(item: dict[str, Any], *, as_of: date | None = None) -> bool:
    today = as_of or date.today()
    end = _as_date(item.get("expected_window_end")) or _as_date(item.get("hypothesis_date"))
    if not end:
        return False
    return today > end + timedelta(days=EXPIRY_GRACE_DAYS)


def due_hypotheses(
    *,
    as_of: date | None = None,
    tickers: set[str] | None = None,
    force: bool = False,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    items = [it for it in (load_registry().get("items") or []) if isinstance(it, dict)]
    out = []
    for it in items:
        if tickers and str(it.get("ticker") or "").upper() not in tickers:
            continue
        if is_due_for_check(it, as_of=as_of, force=force):
            out.append(it)
    out.sort(key=lambda it: str(it.get("expected_window_start") or it.get("hypothesis_date") or ""))
    return out[:limit] if limit else out


def apply_outcomes(outcomes: dict[str, dict[str, Any]]) -> dict[str, int]:
    """Persist the result of a verification round.

    ``outcomes`` maps hypothesis id → ``{"status", "resolution"}``. Ids left out
    are only stamped as checked when present in ``checked_ids``.
    """
    reg = load_registry()
    items = [it for it in (reg.get("items") or []) if isinstance(it, dict)]
    counts = {STATUS_CONFIRMED: 0, STATUS_EXPIRED: 0, STATUS_PENDING: 0}
    for it in items:
        res = outcomes.get(str(it.get("id")))
        if not res:
            continue
        status = str(res.get("status") or STATUS_PENDING)
        it["status"] = status
        it["last_checked_at"] = _now_iso()
        it["check_count"] = int(it.get("check_count") or 0) + 1
        it["updated_at"] = _now_iso()
        if res.get("resolution"):
            it["resolution"] = res["resolution"]
        counts[status] = counts.get(status, 0) + 1
    save_registry(items)
    return counts


def registry_summary() -> dict[str, Any]:
    items = [it for it in (load_registry().get("items") or []) if isinstance(it, dict)]
    by_status: dict[str, int] = {}
    for it in items:
        st = str(it.get("status") or STATUS_PENDING)
        by_status[st] = by_status.get(st, 0) + 1
    return {"total": len(items), "by_status": by_status, "path": str(_STORE_PATH)}


__all__ = [
    "CHECK_LEAD_DAYS",
    "EXPIRY_GRACE_DAYS",
    "MIN_DAYS_BETWEEN_CHECKS",
    "STATUS_CONFIRMED",
    "STATUS_DISMISSED",
    "STATUS_EXPIRED",
    "STATUS_PENDING",
    "apply_outcomes",
    "due_hypotheses",
    "hypothesis_id",
    "is_due_for_check",
    "is_expired",
    "load_registry",
    "registry_summary",
    "save_registry",
    "upsert_hypotheses",
]
