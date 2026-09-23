"""
Monitor delle simulazioni d'investimento dei tester mobile.

Aggrega i file ``data/tester_sim_inputs/<tester_id>.json`` con:

- prezzo corrente e signal (pred5_live / direction_live) dallo snapshot Simulation
- meta tester (email, display_name, status) da ``tester_feedback_store.json``

Espone ``build_sim_monitor()`` — usato dall'endpoint
``GET /api/tester-feedback/sim-monitor`` e visualizzato nel pannello desktop
"Feedback tester".

Definizione **follow-rate**: acquisti (posizioni aperte + chiuse) su ticker che
oggi hanno segnale allineato "buy" (``direction_live == 'up'`` **e**
``pred5_live > 0``). È una proxy: senza storico giornaliero non si può sapere
la raccomandazione al momento esatto del BUY, ma il segnale corrente dà una
misura ragionevole di quanto i tester seguano il modello.
"""
from __future__ import annotations

import json
import logging
import os
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any

from orchestrator_io_paths import SIMULATION_SHEET_SNAPSHOT_JSON
from tester_feedback_io import _resolve_status, load_store
from tester_sim_inputs_io import TESTER_SIM_INPUTS_DIR, load_sim_inputs

_log = logging.getLogger(__name__)

# When set (typically on a developer's local Electron), the sim-monitor endpoint
# proxies to the upstream host instead of reading local `data/tester_sim_inputs/`.
# This lets the local desktop UI show mobile testers who submit to the VPS
# without needing a periodic file sync.
UPSTREAM_ENV = "SUPERNOVA_TESTER_MONITOR_UPSTREAM"
UPSTREAM_TIMEOUT_SECS = 6.0


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _fetch_upstream(base_url: str) -> dict[str, Any] | None:
    """Prova a scaricare il sim-monitor dall'host upstream (VPS). None se fallisce."""
    base = base_url.strip().rstrip("/")
    if not base:
        return None
    url = f"{base}/api/tester-feedback/sim-monitor"
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=UPSTREAM_TIMEOUT_SECS) as resp:
            body = resp.read()
        payload = json.loads(body)
        if not isinstance(payload, dict):
            return None
        payload["upstream_url"] = base
        payload["upstream_fetched_at"] = _now_iso()
        return payload
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
        _log.warning(
            "Upstream tester monitor fetch fallito (%s): %s — fallback su dati locali.",
            url,
            exc,
        )
        return None


def _load_sim_sheet_rows() -> list[dict[str, Any]]:
    p = SIMULATION_SHEET_SNAPSHOT_JSON
    if not os.path.isfile(p):
        return []
    try:
        with open(p, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return []
    rows = data.get("rows") if isinstance(data, dict) else None
    if not isinstance(rows, list):
        return []
    return [r for r in rows if isinstance(r, dict)]


def _num(v: Any) -> float | None:
    if v is None or v == "" or v == "—" or v == "-":
        return None
    try:
        if isinstance(v, (int, float)):
            return float(v)
        s = str(v).strip().replace(" ", "").replace(",", ".").replace("%", "")
        f = float(s)
        return f if f == f else None
    except (TypeError, ValueError):
        return None


def _row_price(row: dict[str, Any]) -> float | None:
    for k in ("Prezzo Corrente ($)", "Prezzo Corrente", "Prezzo Attuale"):
        v = _num(row.get(k))
        if v is not None and v > 0:
            return v
    return None


def _row_signal_up(row: dict[str, Any]) -> bool:
    direction = str(row.get("direction_live") or "").strip().lower()
    pred5 = _num(row.get("pred5_live"))
    if pred5 is None:
        # Fallback: colonna "Pred +5" (sheet formula) in caso di snapshot vecchio
        for k in row.keys():
            k_lo = str(k).lower()
            if "pred" in k_lo and "+5" in k_lo:
                v = _num(row.get(k))
                if v is not None:
                    pred5 = v * 100 if abs(v) <= 1.5 else v
                    break
    if direction == "up" and (pred5 is None or pred5 > 0):
        return True
    if direction != "down" and pred5 is not None and pred5 > 0:
        return True
    return False


def _normalize_cd_key(cd: Any) -> str:
    if cd is None:
        return "—"
    s = str(cd).strip()
    if not s or s in ("—", "-"):
        return "—"
    iso = re.match(r"^(\d{4}-\d{2}-\d{2})", s)
    if iso:
        return iso.group(1)
    it = re.match(r"^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$", s)
    if it:
        d, m, y = it.groups()
        return f"{y}-{m.zfill(2)}-{d.zfill(2)}"
    try:
        dt = datetime.fromisoformat(s)
        return dt.strftime("%Y-%m-%d")
    except ValueError:
        return s


def _row_key(row: dict[str, Any]) -> str:
    ticker = str(row.get("Ticker") or "").strip().upper()
    cd = _normalize_cd_key(row.get("Completion Date"))
    return f"{ticker}|{cd}"


def _split_key(key: str) -> tuple[str, str]:
    if "|" not in key:
        return key.strip().upper(), "—"
    tk, cd = key.split("|", 1)
    return tk.strip().upper(), cd.strip() or "—"


def _iter_tester_files() -> list[str]:
    if not os.path.isdir(TESTER_SIM_INPUTS_DIR):
        return []
    out: list[str] = []
    for name in os.listdir(TESTER_SIM_INPUTS_DIR):
        if name.lower().endswith(".json"):
            out.append(os.path.splitext(name)[0])
    return sorted(out)


def _resolve_position(
    key: str,
    entry: dict[str, Any],
    row: dict[str, Any] | None,
) -> dict[str, Any] | None:
    ticker, cd = _split_key(key)
    if not ticker or "TOTALE" in ticker:
        return None

    buy_price = float(entry.get("buyPrice") or 0)
    capital = float(entry.get("capital") or 0)
    ignore_sheet = bool(entry.get("ignoreSheet"))
    closed_pnl = entry.get("closedPnlEur")
    closed_capital = entry.get("closedCapital")
    closed_value = entry.get("closedValue")
    invested_at = entry.get("investedAt") or entry.get("purchaseDate") or None
    sold_at = entry.get("soldAt") or None

    is_closed = ignore_sheet or (closed_pnl is not None) or (sold_at is not None)

    name = None
    price_now = None
    signal_up = False
    if row is not None:
        name = str(row.get("Società") or row.get("Societa") or "").strip() or None
        price_now = _row_price(row)
        signal_up = _row_signal_up(row)

    if is_closed:
        cap_eff = float(closed_capital or capital or 0)
        pnl_eur = float(closed_pnl if closed_pnl is not None else 0)
        value_eur = (
            float(closed_value)
            if closed_value is not None
            else round(cap_eff + pnl_eur, 2)
        )
        pnl_pct = (pnl_eur / cap_eff * 100.0) if cap_eff > 0 else None
        return {
            "ticker": ticker,
            "name": name,
            "completion_date": cd,
            "state": "closed",
            "invested_at": invested_at,
            "sold_at": sold_at,
            "buy_price_usd": buy_price if buy_price > 0 else None,
            "capital_eur": round(cap_eff, 2),
            "closed_value_eur": round(value_eur, 2),
            "closed_pnl_eur": round(pnl_eur, 2),
            "closed_pnl_pct": round(pnl_pct, 2) if pnl_pct is not None else None,
            "current_price_usd": price_now,
            "signal_up_now": signal_up,
        }

    if capital <= 0:
        return None

    unavailable = False
    value_eur = 0.0
    pnl_eur = 0.0
    pnl_pct: float | None = None
    if buy_price > 0 and price_now is not None and price_now > 0:
        shares = capital / buy_price
        value_eur = shares * price_now
        pnl_eur = value_eur - capital
        pnl_pct = (pnl_eur / capital * 100.0) if capital > 0 else None
    else:
        unavailable = True
        value_eur = capital

    return {
        "ticker": ticker,
        "name": name,
        "completion_date": cd,
        "state": "open",
        "invested_at": invested_at,
        "sold_at": None,
        "buy_price_usd": buy_price if buy_price > 0 else None,
        "capital_eur": round(capital, 2),
        "current_price_usd": price_now,
        "value_eur": round(value_eur, 2),
        "open_pnl_eur": round(pnl_eur, 2),
        "open_pnl_pct": round(pnl_pct, 2) if pnl_pct is not None else None,
        "signal_up_now": signal_up,
        "unavailable": unavailable,
    }


def build_sim_monitor() -> dict[str, Any]:
    """Costruisce l'aggregato per la sezione "Simulazioni tester" del desktop.

    Se ``SUPERNOVA_TESTER_MONITOR_UPSTREAM`` è settata (es. host locale che punta
    al VPS), scarica l'aggregato dall'upstream. Fallback trasparente sui dati
    locali se l'upstream non risponde.
    """
    upstream = os.environ.get(UPSTREAM_ENV, "").strip()
    if upstream:
        payload = _fetch_upstream(upstream)
        if payload is not None:
            return payload

    rows = _load_sim_sheet_rows()
    by_key: dict[str, dict[str, Any]] = {}
    by_ticker: dict[str, dict[str, Any]] = {}
    for r in rows:
        key = _row_key(r)
        by_key[key] = r
        tk = str(r.get("Ticker") or "").strip().upper()
        if tk:
            by_ticker.setdefault(tk, r)

    store = load_store()
    testers_meta = store.get("testers", {}) if isinstance(store.get("testers"), dict) else {}

    testers_out: list[dict[str, Any]] = []
    total_open_cap = 0.0
    total_open_gain = 0.0
    total_closed_gain = 0.0
    total_open_pos = 0
    total_closed_pos = 0
    total_aligned_buys = 0
    total_buys = 0

    for tid in _iter_tester_files():
        try:
            doc = load_sim_inputs(tid)
        except (OSError, ValueError):
            continue
        inputs = doc.get("inputs") if isinstance(doc.get("inputs"), dict) else {}
        meta = testers_meta.get(tid) if isinstance(testers_meta.get(tid), dict) else {}

        positions: list[dict[str, Any]] = []
        open_cap = 0.0
        open_gain = 0.0
        closed_gain = 0.0
        buys_count = 0
        aligned_buys = 0
        open_count = 0
        closed_count = 0
        last_activity = doc.get("updated_at")

        for key, entry in inputs.items():
            if not isinstance(entry, dict):
                continue
            row = by_key.get(key)
            if row is None:
                tk, _ = _split_key(key)
                row = by_ticker.get(tk)
            pos = _resolve_position(key, entry, row)
            if pos is None:
                continue
            positions.append(pos)
            buys_count += 1
            if pos.get("signal_up_now"):
                aligned_buys += 1
            if pos["state"] == "open":
                open_count += 1
                open_cap += float(pos.get("capital_eur") or 0)
                open_gain += float(pos.get("open_pnl_eur") or 0)
            else:
                closed_count += 1
                closed_gain += float(pos.get("closed_pnl_eur") or 0)

        positions.sort(
            key=lambda p: (0 if p["state"] == "open" else 1, p.get("ticker") or "")
        )

        follow_rate = (
            round(aligned_buys * 100.0 / buys_count, 1) if buys_count > 0 else None
        )
        open_gain_pct = (
            round(open_gain / open_cap * 100.0, 2) if open_cap > 0 else None
        )
        status = _resolve_status(meta) if meta else "unknown"

        testers_out.append(
            {
                "tester_id": tid,
                "email": meta.get("email") or "",
                "display_name": meta.get("display_name") or tid,
                "status": status,
                "sim_updated_at": doc.get("updated_at"),
                "last_seen_at": meta.get("last_seen_at"),
                "totals": {
                    "buys_count": buys_count,
                    "open_count": open_count,
                    "closed_count": closed_count,
                    "open_capital_eur": round(open_cap, 2),
                    "open_gain_eur": round(open_gain, 2),
                    "open_gain_pct": open_gain_pct,
                    "closed_gain_eur": round(closed_gain, 2),
                    "total_gain_eur": round(open_gain + closed_gain, 2),
                    "aligned_buys": aligned_buys,
                    "follow_rate_pct": follow_rate,
                },
                "positions": positions,
            }
        )

        total_open_cap += open_cap
        total_open_gain += open_gain
        total_closed_gain += closed_gain
        total_open_pos += open_count
        total_closed_pos += closed_count
        total_aligned_buys += aligned_buys
        total_buys += buys_count

    testers_out.sort(
        key=lambda t: (
            0 if (t["totals"]["open_count"] + t["totals"]["closed_count"]) > 0 else 1,
            -(t["totals"]["total_gain_eur"] or 0),
        )
    )

    aggregate = {
        "tester_count": len(testers_out),
        "testers_with_activity": sum(
            1
            for t in testers_out
            if (t["totals"]["open_count"] + t["totals"]["closed_count"]) > 0
        ),
        "total_open_positions": total_open_pos,
        "total_closed_positions": total_closed_pos,
        "total_open_capital_eur": round(total_open_cap, 2),
        "total_open_gain_eur": round(total_open_gain, 2),
        "total_open_gain_pct": (
            round(total_open_gain / total_open_cap * 100.0, 2)
            if total_open_cap > 0
            else None
        ),
        "total_closed_gain_eur": round(total_closed_gain, 2),
        "total_gain_eur": round(total_open_gain + total_closed_gain, 2),
        "avg_follow_rate_pct": (
            round(total_aligned_buys * 100.0 / total_buys, 1)
            if total_buys > 0
            else None
        ),
    }

    return {
        "generated_at": _now_iso(),
        "sim_snapshot_available": len(rows) > 0,
        "aggregate": aggregate,
        "testers": testers_out,
    }
