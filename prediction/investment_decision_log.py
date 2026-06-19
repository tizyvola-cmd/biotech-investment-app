"""Decision log persistente: snapshot reale di entry/exit per ogni posizione.

Tracciamento event-driven delle decisioni d'investimento. A differenza di
``pre_cd_slope_*`` (che è uno snapshot dell'offset T-1 della CD = proxy
retrospettivo) e di ``latest_slope_*`` (snapshot più recente del ticker),
qui registriamo lo **stato esatto al momento in cui l'utente ha aperto o
chiuso una posizione**.

Schema file ``data/investment_decision_log.json``::

    {
      "schema_version": 1,
      "updated_at": "2026-05-25T15:30:00+00:00",
      "entries": {
        "ANIK|2026-05-31": {
          "current_open": true,
          "cycles": [
            {
              "entry": {
                "ts": "2026-05-15T09:30:00+00:00",
                "buy_price_usd": 12.50,
                "capital_eur": 10000.0,
                "current_price_usd": 12.50,
                "slope_5d": 0.21,
                "slope_20d": 0.05,
                "run_up_30d": 7.2,
                "slope_source": "ANIK|2027-10-01",
                "slope_asof": "2026-05-15",
                "pred5_pp": 1.34,
                "pred7_pp": 2.10,
                "affidabilita_pct": 69.0,
                "r2_fit": 0.51,
                "entry_was_existing": false
              },
              "exit": null
            }
          ]
        }
      }
    }

Detection logic (ad ogni run di ``build_investment_sim_outcomes``):

* per ogni position con ``capital > 0``:
    - se ``log.entries[row_key].current_open == False`` → registra ENTRY,
      appendi un nuovo cycle al log e marca ``current_open = True``.
* per ogni log entry con ``current_open == True`` che non è più nella lista
  di position attive (capital = 0 o riga sparita):
    - registra EXIT sull'ultimo cycle, ``current_open = False``.

Il log persiste cicli storici: se l'utente riapre la stessa posizione dopo
una chiusura, viene appeso un nuovo cycle (non sovrascritto).
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from orchestrator_io_paths import DATA_DIR

DECISION_LOG_PATH = Path(DATA_DIR) / "investment_decision_log.json"
SCHEMA_VERSION = 1


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ronr(v: Any, digits: int = 4) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return round(f, digits) if math.isfinite(f) else None


def load_decision_log(path: str | Path | None = None) -> dict[str, Any]:
    """Carica il decision log dal file. Restituisce struttura vuota se assente."""
    p = Path(path or DECISION_LOG_PATH)
    if not p.is_file():
        return {"schema_version": SCHEMA_VERSION, "updated_at": None, "entries": {}}
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"schema_version": SCHEMA_VERSION, "updated_at": None, "entries": {}}
    if not isinstance(doc, dict):
        return {"schema_version": SCHEMA_VERSION, "updated_at": None, "entries": {}}
    if "entries" not in doc or not isinstance(doc["entries"], dict):
        doc["entries"] = {}
    doc["schema_version"] = SCHEMA_VERSION
    return doc


def save_decision_log(doc: dict[str, Any], path: str | Path | None = None) -> None:
    """Salva il decision log su disco (atomic write)."""
    p = Path(path or DECISION_LOG_PATH)
    p.parent.mkdir(parents=True, exist_ok=True)
    doc["updated_at"] = _utcnow_iso()
    doc["schema_version"] = SCHEMA_VERSION
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(p)


def _build_snapshot(
    *,
    position: dict[str, Any],
    latest_slope: dict[str, Any] | None,
    is_existing_at_first_run: bool,
) -> dict[str, Any]:
    """Costruisce uno snapshot entry/exit dai dati correnti."""
    ls = latest_slope or {}
    return {
        "ts": _utcnow_iso(),
        "buy_price_usd": _ronr(position.get("buy_price_usd")),
        "capital_eur": _ronr(position.get("capital_eur"), 2),
        # current_price ricavato da pnl_pct se disponibile
        "current_price_usd": _ronr(
            position.get("buy_price_usd", 0) * (1 + (position.get("pnl_pct") or 0) / 100)
        ),
        # Slope al momento (dal histlib più recente del ticker)
        "slope_5d": _ronr(ls.get("slope_5d")),
        "slope_20d": _ronr(ls.get("slope_20d")),
        "run_up_30d": _ronr(ls.get("run_up_30d"), 2),
        "slope_source": ls.get("source_key"),
        "slope_asof": ls.get("asof"),
        # Predizioni del modello al momento
        "pred5_pp": _ronr(position.get("pred5_pp"), 3) if position.get("pred5_pp") is not None
                    else _ronr(position.get("pred7_pp"), 3),
        "pred7_pp": _ronr(position.get("pred7_pp"), 3),
        "affidabilita_pct": _ronr(position.get("affidabilita_pct"), 2),
        "r2_fit": _ronr(position.get("r2_fit"), 4),
        "pnl_pct_at_event": _ronr(position.get("pnl_pct"), 2),
        "pnl_eur_at_event": _ronr(position.get("pnl_eur"), 2),
        # Flag debug: True se al primo run dopo deploy abbiamo trovato la riga
        # già aperta e abbiamo registrato un entry "retroattivo" usando i
        # dati di oggi. Significa che lo slope dell'entry non è il vero
        # slope al momento della scelta — è il miglior proxy disponibile.
        "entry_was_existing": is_existing_at_first_run,
    }


def update_decision_log(
    *,
    positions: list[dict[str, Any]],
    latest_slope_by_ticker: dict[str, dict[str, Any]],
    log_path: str | Path | None = None,
) -> dict[str, Any]:
    """Aggiorna il decision log confrontando lo stato corrente con il salvato.

    Args:
        positions: lista di SimOutcomeRow-like (deve avere row_key, ticker,
            capital_eur, buy_price_usd, pnl_pct, pnl_eur, pred5_pp/pred7_pp,
            affidabilita_pct, r2_fit).
        latest_slope_by_ticker: dict ticker -> {slope_5d, slope_20d, ...}
            (output di ``_build_slope_indices`` in investment_sim_outcomes).
        log_path: path al file decision log (default: DECISION_LOG_PATH).

    Returns:
        Il decision log aggiornato (e salvato su disco).
    """
    log = load_decision_log(log_path)
    is_first_run = not log.get("entries")
    entries = log["entries"]

    # Indicizza positions per row_key per lookup veloce
    pos_by_key: dict[str, dict[str, Any]] = {}
    for p in positions:
        rk = p.get("row_key")
        if rk and (p.get("capital_eur") or 0) > 0:
            pos_by_key[rk] = p

    # ── ENTRY DETECTION ──────────────────────────────────────────────────
    # Per ogni position con capital>0, verifica se è una nuova entry.
    for rk, pos in pos_by_key.items():
        entry = entries.get(rk)
        if entry is None:
            entries[rk] = {"current_open": False, "cycles": []}
            entry = entries[rk]
        if not entry.get("current_open", False):
            # Nuova ENTRY → appendi cycle
            ticker = pos.get("ticker", rk.split("|")[0]).upper()
            snap = _build_snapshot(
                position=pos,
                latest_slope=latest_slope_by_ticker.get(ticker),
                is_existing_at_first_run=is_first_run,
            )
            cycles = entry.setdefault("cycles", [])
            cycles.append({"entry": snap, "exit": None})
            entry["current_open"] = True
            entry["last_event"] = "entry"
            entry["last_event_ts"] = snap["ts"]
        # Keep a rolling mark-to-market snapshot while the position is open.
        # This lets EXIT use real P&L even if the row is removed right after sell.
        ticker = pos.get("ticker", rk.split("|")[0]).upper()
        mtm_snap = _build_snapshot(
            position=pos,
            latest_slope=latest_slope_by_ticker.get(ticker),
            is_existing_at_first_run=False,
        )
        entry["last_open_snapshot"] = mtm_snap

    # ── EXIT DETECTION ───────────────────────────────────────────────────
    # Per ogni log entry attualmente aperta che NON è più in pos_by_key,
    # registra exit sull'ultimo cycle.
    for rk, entry in list(entries.items()):
        if not entry.get("current_open", False):
            continue
        if rk in pos_by_key:
            continue
        # La posizione era aperta ma ora capital=0 (o riga sparita).
        # Devo costruire uno snapshot exit. Non ho i dati di posizione
        # correnti (la riga è sparita) — uso l'ultimo snapshot open salvato
        # durante i run precedenti, fallback su cycle entry.
        cycles = entry.get("cycles", [])
        if not cycles:
            entry["current_open"] = False
            continue
        last_cycle = cycles[-1]
        ticker = rk.split("|")[0].upper()
        last_open = entry.get("last_open_snapshot") if isinstance(entry.get("last_open_snapshot"), dict) else {}
        # Snapshot exit "minimo": ts + slope corrente (non abbiamo P&L finale)
        ls = latest_slope_by_ticker.get(ticker) or {}
        exit_snap = {
            "ts": _utcnow_iso(),
            "buy_price_usd": (
                last_open.get("buy_price_usd")
                if last_open.get("buy_price_usd") is not None
                else last_cycle.get("entry", {}).get("buy_price_usd")
            ),
            "capital_eur": 0.0,
            "current_price_usd": last_open.get("current_price_usd"),
            "slope_5d": _ronr(ls.get("slope_5d")),
            "slope_20d": _ronr(ls.get("slope_20d")),
            "run_up_30d": _ronr(ls.get("run_up_30d"), 2),
            "slope_source": ls.get("source_key"),
            "slope_asof": ls.get("asof"),
            "pred5_pp": None,
            "pred7_pp": None,
            "affidabilita_pct": None,
            "r2_fit": None,
            "pnl_pct_at_event": _ronr(last_open.get("pnl_pct_at_event"), 2),
            "pnl_eur_at_event": _ronr(last_open.get("pnl_eur_at_event"), 2),
            "exit_reason": "capital_removed",
        }
        last_cycle["exit"] = exit_snap
        entry["current_open"] = False
        entry["last_event"] = "exit"
        entry["last_event_ts"] = exit_snap["ts"]
        entry["last_open_snapshot"] = None

    save_decision_log(log, log_path)
    return log


def enrich_position_with_log(
    position: dict[str, Any],
    log: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Aggiunge i campi entry_*/exit_* a una SimOutcomeRow leggendo dal log.

    I valori provengono dall'ultimo cycle (current se aperto, ultimo chiuso
    altrimenti). Restituisce un nuovo dict (non muta l'input).
    """
    if log is None:
        log = load_decision_log()
    rk = position.get("row_key", "")
    entry_blob = log.get("entries", {}).get(rk)
    out = dict(position)
    if not entry_blob:
        return out
    cycles = entry_blob.get("cycles", [])
    if not cycles:
        return out
    last = cycles[-1]
    e = last.get("entry") or {}
    x = last.get("exit") or {}

    def _days_between_iso(start_ts: Any, end_ts: Any) -> int | None:
        if not isinstance(start_ts, str) or not isinstance(end_ts, str):
            return None
        try:
            s = datetime.fromisoformat(start_ts.replace("Z", "+00:00"))
            e_dt = datetime.fromisoformat(end_ts.replace("Z", "+00:00"))
        except ValueError:
            return None
        delta_days = (e_dt - s).total_seconds() / 86400.0
        if not math.isfinite(delta_days):
            return None
        return max(0, int(round(delta_days)))
    # Entry fields
    out["entry_ts"] = e.get("ts")
    out["entry_slope_5d"] = e.get("slope_5d")
    out["entry_slope_20d"] = e.get("slope_20d")
    out["entry_run_up_30d"] = e.get("run_up_30d")
    out["entry_pred5_pp"] = e.get("pred5_pp")
    out["entry_pred7_pp"] = e.get("pred7_pp")
    out["entry_affidabilita_pct"] = e.get("affidabilita_pct")
    out["entry_r2_fit"] = e.get("r2_fit")
    out["entry_buy_price_usd"] = e.get("buy_price_usd")
    out["entry_was_existing"] = e.get("entry_was_existing", False)
    # Exit fields (None se ancora aperta)
    if x:
        out["exit_ts"] = x.get("ts")
        out["exit_current_price_usd"] = x.get("current_price_usd")
        out["exit_slope_5d"] = x.get("slope_5d")
        out["exit_slope_20d"] = x.get("slope_20d")
        out["exit_run_up_30d"] = x.get("run_up_30d")
        out["exit_pnl_pct_at_event"] = x.get("pnl_pct_at_event")
        out["exit_pnl_eur_at_event"] = x.get("pnl_eur_at_event")
        out["exit_reason"] = x.get("exit_reason")
        out["holding_days"] = _days_between_iso(e.get("ts"), x.get("ts"))
    # Meta cycle
    out["decision_cycles_count"] = len(cycles)
    out["decision_current_open"] = bool(entry_blob.get("current_open", False))
    return out
