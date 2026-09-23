"""
Web Push for SuperNova Mobile Soft/Urgent SELL action alerts (Soft BUY removed).

Env (generate once on the VPS):
  SUPERNOVA_VAPID_PUBLIC   — URL-safe base64 public key
  SUPERNOVA_VAPID_PRIVATE  — URL-safe base64 private key
  SUPERNOVA_VAPID_SUBJECT  — mailto:you@example.com (or https://…)

Generate with:
  python -c "from pywebpush import webpush; from py_vapid import Vapid; v=Vapid(); v.generate_keys(); print(v.public_key); print(v.private_key)"
or:
  npx web-push generate-vapid-keys

Subscriptions: data/mobile_push_subscriptions.json
Last-sent signature: data/mobile_push_last_sig.json
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

from orchestrator_io_paths import DATA_DIR

logger = logging.getLogger("mobile_push")

SUBS_PATH = Path(DATA_DIR) / "mobile_push_subscriptions.json"
LAST_SIG_PATH = Path(DATA_DIR) / "mobile_push_last_sig.json"


def vapid_public_key() -> str | None:
    key = (os.environ.get("SUPERNOVA_VAPID_PUBLIC") or "").strip()
    return key or None


def vapid_private_key() -> str | None:
    key = (os.environ.get("SUPERNOVA_VAPID_PRIVATE") or "").strip()
    return key or None


def vapid_subject() -> str:
    sub = (os.environ.get("SUPERNOVA_VAPID_SUBJECT") or "").strip()
    return sub or "mailto:supernova@localhost"


def vapid_configured() -> bool:
    return bool(vapid_public_key() and vapid_private_key())


def _load_json(path: Path, default: Any) -> Any:
    if not path.is_file():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def load_subscriptions() -> list[dict[str, Any]]:
    raw = _load_json(SUBS_PATH, {"subscriptions": []})
    subs = raw.get("subscriptions") if isinstance(raw, dict) else None
    if not isinstance(subs, list):
        return []
    out: list[dict[str, Any]] = []
    for s in subs:
        if isinstance(s, dict) and isinstance(s.get("endpoint"), str):
            out.append(s)
    return out


def save_subscriptions(subs: list[dict[str, Any]]) -> None:
    _write_json(SUBS_PATH, {"subscriptions": subs})


def upsert_subscription(body: dict[str, Any]) -> dict[str, Any]:
    endpoint = body.get("endpoint")
    keys = body.get("keys")
    if not isinstance(endpoint, str) or not endpoint.strip():
        raise ValueError("endpoint required")
    if not isinstance(keys, dict) or not keys.get("p256dh") or not keys.get("auth"):
        raise ValueError("keys.p256dh and keys.auth required")
    row = {
        "endpoint": endpoint.strip(),
        "keys": {
            "p256dh": str(keys["p256dh"]),
            "auth": str(keys["auth"]),
        },
        "expirationTime": body.get("expirationTime"),
    }
    subs = load_subscriptions()
    found = False
    for i, s in enumerate(subs):
        if s.get("endpoint") == row["endpoint"]:
            subs[i] = row
            found = True
            break
    if not found:
        subs.append(row)
    save_subscriptions(subs)
    return {"ok": True, "count": len(subs)}


def remove_subscription(endpoint: str) -> dict[str, Any]:
    ep = (endpoint or "").strip()
    subs = [s for s in load_subscriptions() if s.get("endpoint") != ep]
    save_subscriptions(subs)
    return {"ok": True, "count": len(subs)}


def _norm_side(action: str) -> str | None:
    u = (action or "").strip().upper()
    if not u:
        return None
    if u in ("BUY", "COMPRA") or "BUY" in u or "COMPRA" in u:
        if "SELL" in u or "VENDI" in u:
            return "SELL"
        return "BUY"
    if u in ("SELL", "VENDI") or "SELL" in u or "VENDI" in u:
        return "SELL"
    return None


def extract_soft_rec_sets(snapshot: dict[str, Any]) -> tuple[list[str], list[str]]:
    """Return ([], sell_tickers) — Soft BUY alerts removed.

    ``softSells`` from Home ``buildOperationalRecResult`` is authoritative:
    present (even empty) ⇒ Suggested SELL list; do not invent from
    ``recommendations`` (those include review/hold labels and caused false
    Soft SELL push while desktop showed «None now»).
    """
    sell: set[str] = set()
    soft_sells = snapshot.get("softSells")
    if isinstance(soft_sells, list):
        for r in soft_sells:
            if not isinstance(r, dict):
                continue
            ticker = str(r.get("ticker") or "").strip().upper()
            if ticker:
                sell.add(ticker)
        return [], sorted(sell)

    # Legacy snapshots without softSells — last-resort recommendations scan.
    recs = snapshot.get("recommendations")
    if not isinstance(recs, list):
        return [], []
    for r in recs:
        if not isinstance(r, dict):
            continue
        side = _norm_side(str(r.get("action") or ""))
        ticker = str(r.get("ticker") or "").strip().upper()
        if not ticker or side != "SELL":
            continue
        sell.add(ticker)
    return [], sorted(sell)


def signature_for_sets(buy: list[str], sell: list[str]) -> str:
    # buy ignored (Soft BUY alerts removed); keep param for call-site compatibility
    _ = buy
    return f"s:{','.join(sell)}"


def format_push_payload(
    buy: list[str],
    sell: list[str],
    *,
    lang: str = "en",
) -> dict[str, Any]:
    _ = buy  # Soft BUY alerts removed
    it = lang.startswith("it")
    n_sell = len(sell)
    sell_s = ", ".join(sell[:4])
    title = f"Soft SELL · {n_sell}"
    body = (
        f"Nuovi SELL consigliati{f': {sell_s}' if sell_s else ''}. Tocca per aprire."
        if it
        else f"New suggested SELL{f': {sell_s}' if sell_s else ''}. Tap to open."
    )
    return {
        "title": title,
        "body": body,
        "tag": "supernova-soft-sell",
        "sellTickers": sell,
        "buyTickers": [],
        "url": "/mobile/",
    }


def _load_last_sig() -> str | None:
    raw = _load_json(LAST_SIG_PATH, {})
    if isinstance(raw, dict):
        sig = raw.get("sig")
        return sig if isinstance(sig, str) else None
    return None


def _save_last_sig(sig: str) -> None:
    _write_json(LAST_SIG_PATH, {"sig": sig})


def send_web_push(subscription: dict[str, Any], payload: dict[str, Any]) -> str:
    """Send one push. Returns 'ok', 'gone', or 'error'."""
    try:
        from pywebpush import WebPushException, webpush
    except ImportError:
        logger.warning("pywebpush not installed — cannot send mobile push")
        return "error"

    pub = vapid_public_key()
    priv = vapid_private_key()
    if not pub or not priv:
        return "error"

    info = {
        "endpoint": subscription["endpoint"],
        "keys": subscription.get("keys") or {},
    }
    try:
        webpush(
            subscription_info=info,
            data=json.dumps(payload, ensure_ascii=False),
            vapid_private_key=priv,
            vapid_claims={"sub": vapid_subject()},
            vapid_public_key=pub,
            ttl=86_400,
        )
        return "ok"
    except WebPushException as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        if status in (404, 410):
            return "gone"
        logger.warning("webpush failed: %s", exc)
        return "error"
    except Exception as exc:  # noqa: BLE001
        logger.warning("webpush unexpected: %s", exc)
        return "error"


def maybe_notify_soft_rec_change(
    snapshot: dict[str, Any],
    *,
    lang: str = "en",
    force: bool = False,
) -> dict[str, Any]:
    """
    Diff Soft SELL sets vs last sent signature; push to all subscriptions on change.
    Soft BUY alerts are never sent. No-op when VAPID unset, no subs, or empty sells.
    """
    if not vapid_configured():
        return {"ok": False, "skipped": "vapid_not_configured"}

    buy, sell = extract_soft_rec_sets(snapshot)
    buy = []  # Soft BUY alerts removed
    sig = signature_for_sets(buy, sell)
    if not sell:
        # Clear sticky alerts only when signature changes to empty
        prev = _load_last_sig()
        if prev == sig and not force:
            return {"ok": True, "skipped": "unchanged_empty"}
        _save_last_sig(sig)
        return {"ok": True, "skipped": "empty_sets", "sig": sig}

    prev = _load_last_sig()
    if prev == sig and not force:
        return {"ok": True, "skipped": "unchanged", "sig": sig}

    payload = format_push_payload(buy, sell, lang=lang)
    subs = load_subscriptions()
    if not subs:
        _save_last_sig(sig)
        return {"ok": True, "skipped": "no_subscribers", "sig": sig, "payload": payload}

    kept: list[dict[str, Any]] = []
    sent = 0
    gone = 0
    errors = 0
    for sub in subs:
        result = send_web_push(sub, payload)
        if result == "ok":
            sent += 1
            kept.append(sub)
        elif result == "gone":
            gone += 1
        else:
            errors += 1
            kept.append(sub)
    if gone:
        save_subscriptions(kept)
    _save_last_sig(sig)
    return {
        "ok": True,
        "sig": sig,
        "sent": sent,
        "gone": gone,
        "errors": errors,
        "buy": buy,
        "sell": sell,
    }
