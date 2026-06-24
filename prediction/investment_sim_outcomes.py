"""
Analisi esiti simulazioni investimento (portafoglio Simulation).

Legge ``simulation_sheet_snapshot.json`` (posizioni con capitale > 0), classifica
successo/insuccesso, timing vs CD, Affidabilità e allineamento predizione ↔ P&L.
Base per Fase B (suggerimenti investimento).
"""
from __future__ import annotations

import json
import math
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from orchestrator_io_paths import (
    INVESTMENT_SIM_OUTCOMES_JSON,
    INVEST_SIM_INPUTS_JSON,
    SIMULATION_SHEET_SNAPSHOT_JSON,
)
from prediction.investment_decision_log import (
    enrich_position_with_log,
    load_decision_log,
    update_decision_log,
)

# Histlib (libreria storica per offset T-X/T+X): contiene slope_5d, slope_20d,
# run_up_30d per ogni ticker|CD osservato. Lo usiamo per:
#   - posizioni con CD passata: prendiamo lo slope all'offset T-1 (giusto
#     prima dell'evento) come proxy della "pendenza pre-CD" della scelta.
#   - posizioni con CD futura (aperte): prendiamo lo snapshot più recente
#     per il ticker (qualsiasi CD/offset), così la UI può ragionare su slope
#     "corrente" anche se non c'è la chiave ticker|CD futura nel histlib.
HISTLIB_PATH = Path("data/model_historical_input_library.json")

PNL_FLAT_PCT = 1.0
PNL_FLAT_EUR = 25.0

# Slope BUY/SELL rule neutralized: walk-forward backtest showed slope_20d is
# non-predictive of forward returns (corr=-0.03; BUY momentum < take-all; SELL
# net-negative). The signal is kept for reference only, never graded/actioned.
_SLOPE_RULE_NEUTRALIZED_NOTE = (
    "slope non-predittivo (backtest walk-forward) — segnale neutralizzato"
)

PROTOCOL: dict[str, Any] = {
    "schema_version": 1,
    "title": "Simulazioni investimento — Analisi esiti",
    "position_rule": "Capitale > 0 e prezzo acquisto > 0 (input UI invest_sim_inputs.json, altrimenti foglio Simulation)",
    "outcome_rules": [
        "success: P&L > soglia flat (±1% o ±25€)",
        "failure: P&L < −soglia",
        "flat: |P&L| entro soglia",
        "open: Completion Date non ancora passata (esito provvisorio sul mark-to-market)",
    ],
    "timing_buckets": [
        "pre_cd_far (>30 gg al CD)",
        "pre_cd_mid (8–30 gg)",
        "pre_cd_near (1–7 gg)",
        "cd_today",
        "post_cd (CD passata)",
    ],
    "metrics": [
        "Win rate % e P&L medio per fascia temporale e Affidabilità",
        "Hit predizione: segno Pred +7 vs segno P&L %",
        "Segmenti per esito, timing, Affidabilità (preparazione modello suggerimenti)",
        "Slope curva latest_* (snapshot più recente del ticker) e pre_cd_* "
        "(offset T-1 della CD) per analisi correlazione pendenza→P&L "
        "e segnali di disinvestimento sulle posizioni aperte",
    ],
}


def _num(v: Any) -> float | None:
    if v is None or v == "" or v == "—":
        return None
    if isinstance(v, str):
        s = v.strip().replace("%", "").replace(",", ".")
        if not s or s.lower() in ("n/d", "nd", "nan", "-"):
            return None
        try:
            n = float(s)
        except ValueError:
            return None
    else:
        try:
            n = float(v)
        except (TypeError, ValueError):
            return None
    return n if math.isfinite(n) else None


def _parse_date(v: Any) -> date | None:
    if isinstance(v, date) and not isinstance(v, datetime):
        return v
    if isinstance(v, str) and v.strip():
        s = v.strip()[:10]
        if "/" in s[:6]:
            parts = s.split("/")
            if len(parts) == 3:
                try:
                    d, m, y = int(parts[0]), int(parts[1]), int(parts[2])
                    return date(y, m, d)
                except (ValueError, TypeError):
                    pass
        try:
            y, m, d = int(s[:4]), int(s[5:7]), int(s[8:10])
            return date(y, m, d)
        except (ValueError, TypeError):
            return None
    return None


def find_sim_column(columns: list[str], *parts: str) -> str:
    for col in columns:
        flat = col.replace("\n", " ").replace("\r", " ")
        if all(p.lower() in flat.lower() for p in parts):
            return col
    return ""


def _timing_bucket(days_to_cd: int | None, cd_passed: bool) -> str:
    if cd_passed:
        return "post_cd"
    if days_to_cd is None:
        return "timing n/d"
    if days_to_cd <= 0:
        return "cd_today" if days_to_cd == 0 else "post_cd"
    if days_to_cd <= 7:
        return "pre_cd_near"
    if days_to_cd <= 30:
        return "pre_cd_mid"
    return "pre_cd_far"


def _timing_label(bucket: str) -> str:
    return {
        "pre_cd_far": "Pre-CD >30 gg",
        "pre_cd_mid": "Pre-CD 8–30 gg",
        "pre_cd_near": "Pre-CD 1–7 gg",
        "cd_today": "CD oggi",
        "post_cd": "Post-CD",
        "timing n/d": "Timing n/d",
    }.get(bucket, bucket)


def _classify_outcome(pnl_eur: float | None, pnl_pct: float | None, cd_passed: bool) -> str:
    if pnl_eur is None and pnl_pct is None:
        return "unknown"
    pe = pnl_eur if pnl_eur is not None else 0.0
    pp = pnl_pct if pnl_pct is not None else 0.0
    if abs(pe) <= PNL_FLAT_EUR and abs(pp) <= PNL_FLAT_PCT:
        return "flat"
    if pe > PNL_FLAT_EUR or pp > PNL_FLAT_PCT:
        base = "success"
    elif pe < -PNL_FLAT_EUR or pp < -PNL_FLAT_PCT:
        base = "failure"
    else:
        base = "flat"
    if not cd_passed:
        return f"open_{base}"
    return base


def _outcome_label(code: str) -> str:
    return {
        "success": "Successo",
        "failure": "Insuccesso",
        "flat": "Piatto",
        "open_success": "Aperto · in gain",
        "open_failure": "Aperto · in loss",
        "open_flat": "Aperto · flat",
        "unknown": "Esito n/d",
    }.get(code, code)


def _aff_pct_from_row(row: dict[str, Any], col_aff: str, col_aff_cal: str) -> float | None:
    cal = _num(row.get(col_aff_cal)) if col_aff_cal else None
    if cal is not None:
        return cal if cal > 1.5 else cal * 100.0
    raw = _num(row.get(col_aff)) if col_aff else None
    if raw is not None:
        return raw if raw > 1.5 else raw * 100.0
    return None


def _pred_direction_hit(pred7_pp: float | None, pnl_pct: float | None) -> bool | None:
    if pred7_pp is None or pnl_pct is None:
        return None
    if abs(pnl_pct) <= 0.5:
        return abs(pred7_pp) <= 0.5
    return (pred7_pp > 0.5 and pnl_pct > 0.5) or (pred7_pp < -0.5 and pnl_pct < -0.5)


def _signal_result(delta_pct: float | None, *, expect: str) -> str:
    """Valuta successo/insuccesso di un suggerimento su movimento prezzo.

    expect:
      - "up"   -> BUY: successo se il prezzo sale dopo il segnale
      - "down" -> SELL: successo se il prezzo scende dopo il segnale
    """
    if delta_pct is None:
        return "pending"
    if abs(delta_pct) <= PNL_FLAT_PCT:
        return "flat"
    if expect == "up":
        return "success" if delta_pct > PNL_FLAT_PCT else "failure"
    if expect == "down":
        return "success" if delta_pct < -PNL_FLAT_PCT else "failure"
    return "pending"


def _days_between_iso(start_ts: Any, end_ts: Any) -> int | None:
    if not isinstance(start_ts, str) or not isinstance(end_ts, str):
        return None
    try:
        s = datetime.fromisoformat(start_ts.replace("Z", "+00:00"))
        e = datetime.fromisoformat(end_ts.replace("Z", "+00:00"))
    except ValueError:
        return None
    delta_days = (e - s).total_seconds() / 86400.0
    if not math.isfinite(delta_days):
        return None
    return max(0, int(round(delta_days)))


def _segment_agg(rows: list[dict], *, value_key: str = "pnl_eur") -> dict[str, Any]:
    n = len(rows)
    if n == 0:
        return {"n_positions": 0}
    wins = [r for r in rows if r.get("is_win")]
    pnls = [float(r[value_key]) for r in rows if r.get(value_key) is not None]
    pcts = [float(r["pnl_pct"]) for r in rows if r.get("pnl_pct") is not None]
    hits = [r for r in rows if r.get("pred_direction_hit") is not None]
    return {
        "n_positions": n,
        "win_rate_pct": round(100.0 * len(wins) / n, 1) if n else None,
        "total_pnl_eur": round(sum(pnls), 2) if pnls else None,
        "mean_pnl_eur": round(sum(pnls) / len(pnls), 2) if pnls else None,
        "mean_pnl_pct": round(sum(pcts) / len(pcts), 2) if pcts else None,
        "hit_pred_pct": (
            round(100.0 * sum(1 for r in hits if r["pred_direction_hit"]) / len(hits), 1)
            if hits
            else None
        ),
    }


def _build_segment_groups(rows: list[dict]) -> list[dict[str, Any]]:
    by_timing: dict[str, list[dict]] = {}
    by_outcome: dict[str, list[dict]] = {}
    by_aff: dict[str, list[dict]] = {}

    for r in rows:
        by_timing.setdefault(r.get("timing_bucket") or "timing n/d", []).append(r)
        by_outcome.setdefault(r.get("outcome") or "unknown", []).append(r)
        aff = r.get("affidabilita_pct")
        if aff is None:
            al = "Affid. n/d"
        elif aff >= 70:
            al = "Affid. ≥ 70%"
        elif aff >= 50:
            al = "Affid. 50–70%"
        else:
            al = "Affid. < 50%"
        by_aff.setdefault(al, []).append(r)

    timing_order = ["pre_cd_far", "pre_cd_mid", "pre_cd_near", "cd_today", "post_cd", "timing n/d"]
    aff_order = ["Affid. ≥ 70%", "Affid. 50–70%", "Affid. < 50%", "Affid. n/d"]

    groups: list[dict[str, Any]] = []

    def add(gid: str, title: str, buckets: dict[str, list[dict]], order: list[str] | None = None):
        segs = []
        keys = order if order else sorted(buckets.keys())
        for key in keys:
            chunk = buckets.get(key)
            if not chunk:
                continue
            label = _timing_label(key) if gid == "timing" else _outcome_label(key) if gid == "outcome" else key
            segs.append({"label": label, **_segment_agg(chunk)})
        if segs:
            groups.append({"id": gid, "title": title, "segments": segs})

    add("timing", "Quando (vs Completion Date)", by_timing, timing_order)
    add("outcome", "Esito simulazione", by_outcome, None)
    ordered_aff = {k: by_aff[k] for k in aff_order if k in by_aff}
    add("affidabilita", "Affidabilità alla simulazione", ordered_aff, None)
    return groups


def _aff_quintiles(rows: list[dict]) -> list[dict[str, Any]]:
    scored = [(r, r.get("affidabilita_pct")) for r in rows if r.get("affidabilita_pct") is not None]
    if len(scored) < 5:
        return []
    scored.sort(key=lambda t: t[1])
    n = len(scored)
    out: list[dict[str, Any]] = []
    for q in range(5):
        lo = round(q * n / 5)
        hi = round((q + 1) * n / 5)
        chunk = scored[lo:hi]
        if not chunk:
            continue
        pnls = [float(c[0]["pnl_eur"]) for c in chunk if c[0].get("pnl_eur") is not None]
        wins = [c[0] for c in chunk if c[0].get("is_win")]
        aff_lo = min(c[1] for c in chunk)
        aff_hi = max(c[1] for c in chunk)
        out.append(
            {
                "quintile": q + 1,
                "label": f"Q{q + 1}",
                "n": len(chunk),
                "aff_min": round(aff_lo, 1),
                "aff_max": round(aff_hi, 1),
                "mean_pnl_eur": round(sum(pnls) / len(pnls), 2) if pnls else None,
                "win_rate_pct": round(100.0 * len(wins) / len(chunk), 1) if chunk else None,
            }
        )
    return out


# ── Histlib slope lookup ────────────────────────────────────────────────────
#
# Carica una sola volta il histlib e costruisce due indici:
#   _LATEST_BY_TICKER[ticker] = {asof, slope_5d, slope_20d, run_up_30d, source}
#       → snapshot più recente del ticker, qualsiasi CD/offset. Usato per
#         posizioni con CD futura (la chiave ticker|CD non esiste ancora).
#   _AT_CD_BY_KEY[ticker|cd] = idem, ma fissato all'offset T-1 (preferito) o T-3
#       → snapshot pre-CD osservato. Usato per posizioni con CD passata
#         (analisi storica "slope all'entrata in catalyst vs P&L finale").

def _load_histlib(path: Path | None = None) -> dict[str, Any]:
    p = Path(path or HISTLIB_PATH)
    if not p.is_file():
        return {}
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return doc if isinstance(doc, dict) else {}


def _build_slope_indices(
    histlib: dict[str, Any],
) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    rows = histlib.get("rows") if isinstance(histlib, dict) else None
    if not isinstance(rows, dict):
        return {}, {}

    latest_by_ticker: dict[str, dict[str, Any]] = {}
    at_cd_by_key: dict[str, dict[str, Any]] = {}

    pre_cd_offsets_preferred = ("T-1", "T-3", "T-5", "T-7", "T-10")

    for key, blob in rows.items():
        if not isinstance(blob, dict):
            continue
        parts = str(key).split("|", 1)
        ticker = parts[0].strip().upper()
        snaps = blob.get("snapshots") if isinstance(blob, dict) else None
        if not isinstance(snaps, dict):
            continue

        # 1) Latest by ticker — scansiona TUTTI gli offset, tieni l'asof più
        #    recente con slope_20d non nullo.
        for offs, s in snaps.items():
            if not isinstance(s, dict):
                continue
            s20 = s.get("slope_20d")
            if s20 is None:
                continue
            asof = s.get("close_asof_date") or ""
            if not asof:
                continue
            prev = latest_by_ticker.get(ticker)
            if prev is None or asof > prev.get("asof", ""):
                latest_by_ticker[ticker] = {
                    "asof": asof,
                    "slope_5d": s.get("slope_5d"),
                    "slope_20d": s20,
                    "run_up_30d": s.get("run_up_30d"),
                    "source_key": key,
                    "source_offset": offs,
                }

        # 2) Pre-CD snapshot — usa offset preferito (T-1 → T-3 → ...).
        for offs in pre_cd_offsets_preferred:
            s = snaps.get(offs)
            if not isinstance(s, dict):
                continue
            s20 = s.get("slope_20d")
            if s20 is None:
                continue
            at_cd_by_key[key] = {
                "asof": s.get("close_asof_date") or "",
                "slope_5d": s.get("slope_5d"),
                "slope_20d": s20,
                "run_up_30d": s.get("run_up_30d"),
                "source_offset": offs,
            }
            break

    return latest_by_ticker, at_cd_by_key


def _load_invest_sim_inputs(path: str | Path | None = None) -> dict[str, dict[str, Any]]:
    """Normalizza chiavi ``TICKER|YYYY-MM-DD`` (allineato a UI / simulation_preserve)."""
    from simulation_preserve import row_key_from_parts

    p = Path(path or INVEST_SIM_INPUTS_JSON)
    if not p.is_file():
        return {}
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    raw = doc.get("inputs") if isinstance(doc, dict) else doc
    if not isinstance(raw, dict):
        return {}

    out: dict[str, dict[str, Any]] = {}
    for key, slot in raw.items():
        if not isinstance(slot, dict):
            continue
        parts = str(key).split("|", 1)
        tk = parts[0].strip().upper()
        cd_part = parts[1] if len(parts) > 1 else ""
        rk = row_key_from_parts(tk, cd_part) or str(key)
        prev = out.get(rk)
        if prev is None:
            out[rk] = dict(slot)
            continue
        merged = dict(prev)
        if slot.get("ignoreSheet"):
            merged["ignoreSheet"] = True
            cap_v = _num(slot.get("capital")) or 0.0
            buy_v = _num(slot.get("buyPrice")) or 0.0
            if cap_v <= 0 and buy_v <= 0:
                merged["buyPrice"] = 0.0
                merged["capital"] = 0.0
        for field in ("buyPrice", "capital"):
            v = _num(slot.get(field))
            if v is not None and v > 0:
                merged[field] = v
        if merged.get("ignoreSheet") and (_num(merged.get("capital")) or 0.0) <= 0:
            merged["buyPrice"] = 0.0
            merged["capital"] = 0.0
        out[rk] = merged
    return out


def _lookup_input_for_row(
    *,
    invest_inputs: dict[str, dict[str, Any]],
    row_key: str,
    ticker: str,
) -> dict[str, Any]:
    """Trova l'input UI più adatto anche se la CD del key non coincide.

    Priorità:
      1) match esatto TICKER|CD
      2) key puro ticker
      3) primo key prefissato TICKER| (fallback per mismatch CD)
    """
    if row_key:
        exact = invest_inputs.get(row_key)
        if isinstance(exact, dict):
            return exact
    by_ticker = invest_inputs.get(ticker)
    if isinstance(by_ticker, dict):
        return by_ticker
    pref = f"{ticker}|"
    for k, v in invest_inputs.items():
        if isinstance(k, str) and k.startswith(pref) and isinstance(v, dict):
            return v
    return {}


def _merged_capital_buy(
    row: dict[str, Any],
    inp: dict[str, Any],
    col_buy: str,
    col_cap: str,
) -> tuple[float, float]:
    if inp.get("ignoreSheet"):
        return 0.0, 0.0
    buy_local = _num(inp.get("buyPrice")) or 0.0
    cap_local = _num(inp.get("capital")) or 0.0
    has_local = buy_local > 0 or cap_local > 0
    if has_local:
        return cap_local, buy_local
    buy_sheet = _num(row.get(col_buy)) or 0.0
    cap_sheet = _num(row.get(col_cap)) or 0.0
    return cap_sheet, buy_sheet


def _effective_buy(buy: float, curr: float | None) -> float:
    if buy > 0:
        return buy
    if curr is not None and curr > 0:
        return curr
    return 0.0


def _compute_pnl(
    row: dict[str, Any],
    cap: float,
    buy_eff: float,
    col_pnl: str,
    col_pnl_pct: str,
    col_curr: str,
) -> tuple[float | None, float | None]:
    curr = _num(row.get(col_curr)) if col_curr else None
    if cap > 0 and buy_eff > 0:
        if curr is not None and curr > 0:
            shares = cap / buy_eff
            value = shares * curr
            pnl_eur = value - cap
            pnl_pct = ((curr - buy_eff) / buy_eff) * 100.0
            return round(pnl_eur, 2), round(pnl_pct, 2)
    pnl_eur = _num(row.get(col_pnl))
    pnl_pct_raw = _num(row.get(col_pnl_pct))
    if pnl_pct_raw is not None and abs(pnl_pct_raw) <= 1.5:
        pnl_pct = pnl_pct_raw * 100.0
    else:
        pnl_pct = pnl_pct_raw
    return (
        round(pnl_eur, 2) if pnl_eur is not None else None,
        round(pnl_pct, 2) if pnl_pct is not None else None,
    )


def build_investment_sim_outcomes(
    *,
    simulation_path: str | Path | None = None,
    invest_inputs_path: str | Path | None = None,
    today: date | None = None,
) -> dict[str, Any]:
    today = today or date.today()
    snap_path = Path(simulation_path or SIMULATION_SHEET_SNAPSHOT_JSON)
    if not snap_path.is_file():
        return {
            "schema_version": 1,
            "rows": [],
            "summary": {"n_positions": 0},
            "error": "simulation_snapshot_missing",
            "protocol": PROTOCOL,
        }

    try:
        doc = json.loads(snap_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return {
            "schema_version": 1,
            "rows": [],
            "summary": {"n_positions": 0},
            "error": str(exc),
            "protocol": PROTOCOL,
        }

    columns = list(doc.get("columns") or [])
    sim_rows = doc.get("rows") or []
    if not isinstance(sim_rows, list):
        sim_rows = []

    # In test/debug runs with a custom simulation snapshot, avoid leaking the
    # real project invest_sim_inputs.json unless explicitly provided.
    if simulation_path is not None and invest_inputs_path is None:
        invest_inputs = {}
    else:
        invest_inputs = _load_invest_sim_inputs(invest_inputs_path)
    # Indici slope dal histlib (best-effort: assenti → tutti i campi slope_* a None)
    latest_slope_by_ticker, slope_at_cd_by_key = _build_slope_indices(_load_histlib())

    col_cd = find_sim_column(columns, "Completion", "Date") or "Completion Date"
    col_cap = find_sim_column(columns, "Capitale", "Investito") or "Capitale Investito ($)"
    col_buy = find_sim_column(columns, "Prezzo", "Acquisto") or "Prezzo Acquisto ($)"
    col_curr = (
        find_sim_column(columns, "Prezzo", "Corrente")
        or "Prezzo Corrente ($)"
    )
    col_pnl = find_sim_column(columns, "P&L", "($)") or "P&L ($)"
    col_pnl_pct = find_sim_column(columns, "P&L", "(%)") or "P&L (%)"
    col_aff = find_sim_column(columns, "Affidabilit") or "Affidabilità\n%"
    col_aff_cal = find_sim_column(columns, "Affidabilit", "calib") or "Affidabilità\ncalib %"
    col_pred4 = find_sim_column(columns, "Pred", "+4")
    col_pred7 = find_sim_column(columns, "Pred", "+7") or find_sim_column(columns, "Pred", "7")
    col_r2 = find_sim_column(columns, "R²") or find_sim_column(columns, "R2")

    from simulation_preserve import row_key_from_parts

    market_price_by_key: dict[str, float] = {}
    market_price_by_ticker: dict[str, float] = {}
    positions: list[dict[str, Any]] = []
    for row in sim_rows:
        if not isinstance(row, dict):
            continue
        ticker = str(row.get("Ticker") or "").strip().upper()
        if not ticker or "TOTALE" in ticker:
            continue

        cd_raw = row.get(col_cd)
        rk = row_key_from_parts(ticker, cd_raw)
        curr = _num(row.get(col_curr)) if col_curr else None
        if rk and curr is not None and curr > 0:
            market_price_by_key[rk] = curr
        if ticker and curr is not None and curr > 0:
            market_price_by_ticker[ticker] = curr
        inp = _lookup_input_for_row(
            invest_inputs=invest_inputs,
            row_key=rk or "",
            ticker=ticker,
        )

        cap, buy = _merged_capital_buy(row, inp, col_buy, col_cap)
        buy_eff = _effective_buy(buy, curr)
        # Count committed capital even when buy price is missing (P&L will be n/d).
        if cap <= 0:
            continue

        cd = _parse_date(cd_raw)
        days_to_cd = (cd - today).days if cd else None
        cd_passed = cd is not None and cd < today

        pnl_eur, pnl_pct = _compute_pnl(row, cap, buy_eff, col_pnl, col_pnl_pct, col_curr)

        outcome = _classify_outcome(pnl_eur, pnl_pct, cd_passed)
        is_win = outcome in ("success", "open_success") or (
            pnl_eur is not None and pnl_eur > PNL_FLAT_EUR
        ) or (pnl_pct is not None and pnl_pct > PNL_FLAT_PCT)

        pred7 = _num(row.get(col_pred7)) if col_pred7 else None
        pred4 = _num(row.get(col_pred4)) if col_pred4 else None

        def _to_pp(v: float | None, raw: Any) -> float | None:
            if v is None:
                return None
            has_pct = isinstance(raw, str) and "%" in raw
            return v * 100.0 if abs(v) <= 1.5 and not has_pct else v

        pred4_pp = _to_pp(pred4, row.get(col_pred4)) if col_pred4 else None
        pred7_pp = _to_pp(pred7, row.get(col_pred7)) if col_pred7 else None
        # Interpolazione lineare a +5gg (stessa logica UI)
        if pred4_pp is not None and pred7_pp is not None:
            pred5_pp = pred4_pp + (pred7_pp - pred4_pp) * (1.0 / 3.0)
        elif pred7_pp is not None:
            pred5_pp = pred7_pp
        elif pred4_pp is not None:
            pred5_pp = pred4_pp
        else:
            pred5_pp = None

        r2_fit = _num(row.get(col_r2)) if col_r2 else None

        aff = _aff_pct_from_row(row, col_aff, col_aff_cal)
        tb = _timing_bucket(days_to_cd, cd_passed)

        # Slope dal histlib:
        #  - latest_*: snapshot più recente del ticker (qualsiasi CD/offset) →
        #    usato dalla UI come "slope corrente" per posizioni aperte.
        #  - pre_cd_*: slope all'offset T-1/T-3 della CD passata di QUESTA
        #    posizione → usato per analizzare storicamente "scelta vs esito".
        rk_key = f"{ticker}|{cd.isoformat() if cd else ''}"
        latest_slope = latest_slope_by_ticker.get(ticker) or {}
        pre_cd_slope = slope_at_cd_by_key.get(rk_key) or {}

        def _ronr(v: Any, digits: int = 4) -> float | None:
            if v is None:
                return None
            try:
                f = float(v)
            except (TypeError, ValueError):
                return None
            return round(f, digits) if math.isfinite(f) else None

        universe = inp.get("universe") or "simloop"
        positions.append(
            {
                "row_key": rk_key,
                "ticker": ticker,
                "universe": universe,
                "completion_date": cd.isoformat() if cd else "",
                "days_to_cd": days_to_cd,
                "cd_passed": cd_passed,
                "timing_bucket": tb,
                "timing_label": _timing_label(tb),
                "capital_eur": round(cap, 2),
                "buy_price_usd": round(buy_eff, 4) if buy_eff > 0 else 0.0,
                "pnl_eur": round(pnl_eur, 2) if pnl_eur is not None else None,
                "pnl_pct": round(pnl_pct, 2) if pnl_pct is not None else None,
                "outcome": outcome,
                "outcome_label": _outcome_label(outcome),
                "is_win": is_win,
                "affidabilita_pct": round(aff, 2) if aff is not None else None,
                "pred7_pp": round(pred7_pp, 2) if pred7_pp is not None else None,
                "pred4_pp": round(pred4_pp, 2) if pred4_pp is not None else None,
                "pred5_pp": round(pred5_pp, 2) if pred5_pp is not None else None,
                "r2_fit": _ronr(r2_fit, 4),
                "pred_direction_hit": _pred_direction_hit(pred7_pp, pnl_pct),
                # Slope "corrente" (più recente nel histlib per il ticker)
                "latest_slope_5d": _ronr(latest_slope.get("slope_5d")),
                "latest_slope_20d": _ronr(latest_slope.get("slope_20d")),
                "latest_run_up_30d": _ronr(latest_slope.get("run_up_30d"), digits=2),
                "latest_slope_asof": latest_slope.get("asof") or None,
                "latest_slope_source": latest_slope.get("source_key") or None,
                # Slope pre-CD (offset T-1 di QUESTA CD) — disponibile solo se
                # la CD è già passata o il histlib ha già snapshot pre-evento.
                "pre_cd_slope_5d": _ronr(pre_cd_slope.get("slope_5d")),
                "pre_cd_slope_20d": _ronr(pre_cd_slope.get("slope_20d")),
                "pre_cd_run_up_30d": _ronr(pre_cd_slope.get("run_up_30d"), digits=2),
                "pre_cd_slope_offset": pre_cd_slope.get("source_offset") or None,
            }
        )

    # ── Decision log: aggiorna lo storico entry/exit ─────────────────────
    # Confronto il decision log salvato con le positions correnti:
    #   - capitale era 0 e ora > 0 → registra ENTRY snapshot
    #   - capitale era > 0 e ora 0 (o riga sparita) → registra EXIT snapshot
    # Poi arricchisco ogni position con i campi entry_*/exit_* dal log,
    # così la UI può mostrare il vero slope/pred al momento della scelta.
    # Attach the recommendation-engine state (SDS score + market regime) to each
    # position so the decision log captures the real action/sizing lever at
    # entry. Current SDS is the best available proxy for entry-time SDS (same as
    # how slope is logged). Best-effort: never blocks the sim build.
    try:
        from prediction.sds_data import _market_regime, load_sds_snapshot

        _sds_doc = load_sds_snapshot()
        _sds_by_tk = {
            str(r.get("ticker", "")).upper(): r.get("sds")
            for r in (_sds_doc.get("rows") or [])
            if r.get("ticker") is not None
        }
        _regime_now = _market_regime()
    except Exception as _se:  # pragma: no cover - best-effort
        print(f"[decision_log] lookup SDS/regime fallito (non bloccante): {_se}")
        _sds_by_tk, _regime_now = {}, None
    for _p in positions:
        _tk = str(_p.get("ticker", "")).upper()
        if _p.get("sds_score") is None and _sds_by_tk.get(_tk) is not None:
            _p["sds_score"] = float(_sds_by_tk[_tk])
        if _p.get("market_regime") is None and _regime_now:
            _p["market_regime"] = _regime_now

    decision_log: dict[str, Any] | None = None
    try:
        decision_log = update_decision_log(
            positions=positions,
            latest_slope_by_ticker=latest_slope_by_ticker,
        )
        positions = [enrich_position_with_log(p, decision_log) for p in positions]
    except Exception as exc:  # pragma: no cover - best-effort
        print(f"[decision_log] update fallito (non bloccante): {exc}")
        decision_log = load_decision_log()

    # Include closed cycles from decision_log even when capital is now 0.
    # This makes realized gain/loss visible in "Closed positions" after sell.
    # Restrict to default snapshot flow to avoid mixing real log data in tests
    # or ad-hoc debug runs using custom simulation_path.
    include_log_history = Path(simulation_path or SIMULATION_SHEET_SNAPSHOT_JSON) == Path(
        SIMULATION_SHEET_SNAPSHOT_JSON
    )
    active_keys = {str(p.get("row_key", "")) for p in positions}
    if include_log_history and isinstance(decision_log, dict):
        for rk, entry_blob in (decision_log.get("entries") or {}).items():
            if not isinstance(entry_blob, dict):
                continue
            cycles = entry_blob.get("cycles") or []
            if not isinstance(cycles, list):
                continue
            ticker = str(rk).split("|", 1)[0].upper()
            cd_part = str(rk).split("|", 1)[1] if "|" in str(rk) else ""
            cd = _parse_date(cd_part)
            days_to_cd = (cd - today).days if cd else None
            for i, cyc in enumerate(cycles, start=1):
                if not isinstance(cyc, dict):
                    continue
                e = cyc.get("entry") if isinstance(cyc.get("entry"), dict) else {}
                x = cyc.get("exit") if isinstance(cyc.get("exit"), dict) else {}
                if not x:
                    continue
                hist_key = f"{rk}#cycle{i}"
                if hist_key in active_keys:
                    continue
                pnl_eur = _num(x.get("pnl_eur_at_event"))
                pnl_pct = _num(x.get("pnl_pct_at_event"))
                outcome = _classify_outcome(pnl_eur, pnl_pct, True)
                positions.append(
                    {
                        "row_key": hist_key,
                        "ticker": ticker,
                        "completion_date": cd.isoformat() if cd else cd_part,
                        "days_to_cd": days_to_cd,
                        "cd_passed": True,
                        "timing_bucket": "post_cd",
                        "timing_label": _timing_label("post_cd"),
                        "capital_eur": _num(e.get("capital_eur")) or 0.0,
                        "buy_price_usd": _num(e.get("buy_price_usd")) or 0.0,
                        "pnl_eur": round(pnl_eur, 2) if pnl_eur is not None else None,
                        "pnl_pct": round(pnl_pct, 2) if pnl_pct is not None else None,
                        "outcome": outcome,
                        "outcome_label": _outcome_label(outcome),
                        "is_win": bool(
                            (pnl_eur is not None and pnl_eur > PNL_FLAT_EUR)
                            or (pnl_pct is not None and pnl_pct > PNL_FLAT_PCT)
                        ),
                        "affidabilita_pct": _num(e.get("affidabilita_pct")),
                        "pred7_pp": _num(e.get("pred7_pp")),
                        "pred5_pp": _num(e.get("pred5_pp")),
                        "pred_direction_hit": _pred_direction_hit(_num(e.get("pred7_pp")), pnl_pct),
                        "entry_ts": e.get("ts"),
                        "entry_slope_5d": _num(e.get("slope_5d")),
                        "entry_slope_20d": _num(e.get("slope_20d")),
                        "entry_run_up_30d": _num(e.get("run_up_30d")),
                        "entry_pred5_pp": _num(e.get("pred5_pp")),
                        "entry_pred7_pp": _num(e.get("pred7_pp")),
                        "entry_affidabilita_pct": _num(e.get("affidabilita_pct")),
                        "entry_r2_fit": _num(e.get("r2_fit")),
                        "entry_sds_score": _num(e.get("sds_score")),
                        "entry_regime": e.get("market_regime"),
                        "entry_buy_price_usd": _num(e.get("buy_price_usd")),
                        "entry_was_existing": bool(e.get("entry_was_existing", False)),
                        "exit_ts": x.get("ts"),
                        "exit_current_price_usd": _num(x.get("current_price_usd")),
                        "exit_slope_5d": _num(x.get("slope_5d")),
                        "exit_slope_20d": _num(x.get("slope_20d")),
                        "exit_run_up_30d": _num(x.get("run_up_30d")),
                        "exit_pnl_pct_at_event": round(pnl_pct, 2) if pnl_pct is not None else None,
                        "exit_pnl_eur_at_event": round(pnl_eur, 2) if pnl_eur is not None else None,
                        "exit_reason": x.get("exit_reason"),
                        "holding_days": _days_between_iso(e.get("ts"), x.get("ts")),
                        "decision_cycles_count": len(cycles),
                        # Historical closed cycle row must not appear as open.
                        "decision_current_open": False,
                    }
                )

    # ── Fase B: calibrazione soglie buy/sell dai trade reali ─────────────────
    trade_calib: dict[str, Any] = {}
    try:
        from prediction.investment_trade_calib import (
            get_threshold,
            write_investment_trade_calibration,
        )

        trade_calib = write_investment_trade_calibration(positions)
        _buy_thr = get_threshold("buy_slope20d_min_pp_per_day", trade_calib)
        _sell_thr = get_threshold("sell_slope20d_max_pp_per_day", trade_calib)
    except Exception as _tce:
        print(f"[TradeCalib] calibrazione trade fallita (non bloccante): {_tce}")
        _buy_thr = 0.10
        _sell_thr = -0.30

    # ── Recommendation QA: BUY/SELL success after calibrated thresholds ─────
    for p in positions:
        # BUY side: from entry to now/final P&L%
        entry_s20 = p.get("entry_slope_20d")
        if entry_s20 is None:
            entry_s20 = p.get("pre_cd_slope_20d")
        if entry_s20 is None:
            entry_s20 = p.get("latest_slope_20d")
        # Slope BUY/SELL rule neutralized: a walk-forward backtest proved slope_20d
        # is non-predictive (corr=-0.03; momentum < take-all; SELL net-negative).
        # We keep the basis slope for reference but no longer emit an actionable
        # signal or grade it.
        p["buy_signal_suggested"] = False
        p["buy_signal_basis_slope_20d"] = round(float(entry_s20), 4) if entry_s20 is not None else None
        p["buy_signal_result"] = "not_applicable"
        p["buy_signal_note"] = _SLOPE_RULE_NEUTRALIZED_NOTE

        # SELL side: the slope SUGGESTION is neutralized (slope_20d is non-
        # predictive — walk-forward backtest), but the post-exit move is still
        # scored for every closed exit as an exit-quality diagnostic, with the
        # robust exit/current price fallbacks from the P&L fix.
        exit_s20 = p.get("exit_slope_20d")
        p["sell_signal_suggested"] = False
        p["sell_signal_basis_slope_20d"] = round(float(exit_s20), 4) if exit_s20 is not None else None
        p["sell_signal_note"] = _SLOPE_RULE_NEUTRALIZED_NOTE
        has_exit = bool(p.get("exit_ts") or p.get("cd_passed"))
        exit_px = _num(p.get("exit_current_price_usd"))
        if (exit_px is None or exit_px <= 0) and has_exit:
            buy_px = _num(p.get("buy_price_usd")) or _num(p.get("entry_buy_price_usd"))
            pnl_pct = _num(p.get("exit_pnl_pct_at_event"))
            if pnl_pct is None:
                pnl_pct = _num(p.get("pnl_pct"))
            if buy_px is not None and buy_px > 0 and pnl_pct is not None:
                exit_px = buy_px * (1.0 + pnl_pct / 100.0)
        base_key = str(p.get("row_key", "")).split("#cycle", 1)[0]
        ticker_up = str(p.get("ticker", "")).strip().upper()
        current_px = _num(market_price_by_key.get(base_key))
        if current_px is None and ticker_up:
            current_px = _num(market_price_by_ticker.get(ticker_up))
        if has_exit and exit_px is not None and exit_px > 0 and current_px is not None and current_px > 0:
            after_sell_pct = ((current_px - exit_px) / exit_px) * 100.0
            p["sell_signal_after_move_pct"] = round(after_sell_pct, 2)
            p["sell_signal_result"] = _signal_result(after_sell_pct, expect="down")
        elif has_exit:
            p["sell_signal_after_move_pct"] = None
            p["sell_signal_result"] = "pending"
        else:
            p["sell_signal_after_move_pct"] = None
            p["sell_signal_result"] = "not_applicable"

    closed = [p for p in positions if p.get("cd_passed")]
    open_pos = [p for p in positions if not p.get("cd_passed")]
    wins = [p for p in positions if p.get("is_win")]

    total_cap = sum(float(p["capital_eur"]) for p in positions)
    pnls_all = [float(p["pnl_eur"]) for p in positions if p.get("pnl_eur") is not None]
    total_pnl = sum(pnls_all) if pnls_all else None

    return {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": str(snap_path),
        "invest_inputs_source": str(Path(invest_inputs_path or INVEST_SIM_INPUTS_JSON)),
        "n_invest_input_keys": len(invest_inputs),
        "protocol": PROTOCOL,
        "summary": {
            "n_positions": len(positions),
            "n_closed": len(closed),
            "n_open": len(open_pos),
            "win_rate_pct": round(100.0 * len(wins) / len(positions), 1) if positions else None,
            "win_rate_closed_pct": round(100.0 * sum(1 for p in closed if p.get("is_win")) / len(closed), 1)
            if closed
            else None,
            "total_capital_eur": round(total_cap, 2) if total_cap else None,
            "total_pnl_eur": round(total_pnl, 2) if total_pnl is not None else None,
            "mean_pnl_eur": round(total_pnl / len(pnls_all), 2) if pnls_all else None,
            "hit_pred_direction_pct": _segment_agg(positions).get("hit_pred_pct"),
        },
        "aff_quintiles": _aff_quintiles(positions),
        "segment_groups": _build_segment_groups(positions),
        "trade_calibration": trade_calib,
        "rows": sorted(
            positions,
            key=lambda p: (p.get("days_to_cd") if p.get("days_to_cd") is not None else 9999),
        ),
    }


def write_investment_sim_outcomes(
    path: str | Path | None = None,
    **kwargs: Any,
) -> dict[str, Any]:
    payload = build_investment_sim_outcomes(**kwargs)
    out = Path(path or INVESTMENT_SIM_OUTCOMES_JSON)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload


def read_investment_sim_outcomes(path: str | Path | None = None) -> dict[str, Any]:
    p = Path(path or INVESTMENT_SIM_OUTCOMES_JSON)
    if not p.is_file():
        return {"schema_version": 1, "rows": [], "summary": {"n_positions": 0}, "error": "file_missing"}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return {"schema_version": 1, "rows": [], "summary": {"n_positions": 0}, "error": str(exc)}
