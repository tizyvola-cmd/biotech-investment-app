"""
Preserva input/esiti P&L del foglio «Simulation» durante refresh rapidi.

Prima di cancellare il foglio, legge ``Prezzo Acquisto ($)`` e ``Capitale Investito ($)``
per chiave ``TICKER|YYYY-MM-DD`` (e fallback per solo ticker) e li riapplica alle nuove righe.
"""
from __future__ import annotations

import os
from datetime import date, datetime
from typing import Any

SIM_SHEET = "Simulation"
HDR_ROW = 3
DATA_ROW_START = 4

PRESERVE_COLS = (
    "Prezzo Acquisto ($)",
    "Capitale Investito ($)",
)


def _env_preserve_enabled() -> bool:
    v = os.environ.get("SIM_PRESERVE_OUTCOMES", "1").strip().lower()
    return v not in ("0", "false", "no", "off")


def row_key_from_parts(ticker: str, completion_date: Any) -> str | None:
    tk = str(ticker or "").strip().upper()
    if not tk:
        return None
    cd_s = _completion_iso(completion_date)
    if cd_s:
        return f"{tk}|{cd_s}"
    return tk


def _completion_iso(cdv: Any) -> str | None:
    if cdv is None:
        return None
    if isinstance(cdv, datetime):
        return cdv.date().isoformat()[:10]
    if isinstance(cdv, date):
        return cdv.isoformat()[:10]
    ss = str(cdv).strip()[:10]
    if not ss:
        return None
    try:
        return date.fromisoformat(ss).isoformat()
    except ValueError:
        return None


def _num_or_none(v: Any) -> float | None:
    if v is None:
        return None
    if isinstance(v, str) and v.strip() in ("", "—", "-", "n/d", "nd"):
        return None
    try:
        f = float(v)
        return f if f == f else None
    except (TypeError, ValueError):
        return None


def _header_col_map(ws, header_row: int = HDR_ROW) -> dict[str, int]:
    mc = int(ws.max_column or 0)
    out: dict[str, int] = {}
    for c in range(1, mc + 1):
        raw = ws.cell(row=header_row, column=c).value
        if raw is None:
            continue
        lab = str(raw).replace("\r", " ").replace("\n", " ").strip()
        if lab:
            out[lab] = c
    return out


def capture_simulation_outcomes(wb) -> dict[str, dict[str, float]]:
    """
    Legge esiti/input P&L dal foglio Simulation esistente.

    Ritorna ``{row_key: {"buy_price": …, "capital": …}}``.
    Chiavi ``TICKER|CD`` quando la colonna Completion Date è valorizzata;
    altrimenti solo ``TICKER`` (compatibilità righe senza CD).
    """
    out: dict[str, dict[str, float]] = {}
    if not _env_preserve_enabled():
        return out
    try:
        names = getattr(wb, "sheetnames", None) or []
    except Exception:
        return out
    if SIM_SHEET not in names:
        return out
    try:
        ws = wb[SIM_SHEET]
        mr = int(ws.max_row or 0)
    except Exception:
        return out
    if mr < DATA_ROW_START:
        return out

    cols = _header_col_map(ws)
    tk_c = cols.get("Ticker")
    cd_c = cols.get("Completion Date")
    buy_c = cols.get("Prezzo Acquisto ($)")
    cap_c = cols.get("Capitale Investito ($)")
    if tk_c is None or (buy_c is None and cap_c is None):
        return out

    n = 0
    for r in range(DATA_ROW_START, mr + 1):
        tk = ws.cell(row=r, column=tk_c).value
        cdv = ws.cell(row=r, column=cd_c).value if cd_c else None
        rk = row_key_from_parts(tk, cdv)
        if not rk:
            continue
        buy = _num_or_none(ws.cell(row=r, column=buy_c).value) if buy_c else None
        cap = _num_or_none(ws.cell(row=r, column=cap_c).value) if cap_c else None
        if buy is None and cap is None:
            continue
        slot = out.setdefault(rk, {})
        if buy is not None:
            slot["buy_price"] = buy
        if cap is not None:
            slot["capital"] = cap
        n += 1
    if n:
        print(
            f"[Simulation preserve] Catturati {n} righe con P&L/input "
            f"({len(out)} chiavi uniche).",
            flush=True,
        )
    return out


def portfolio_dict_from_preserved(
    preserved: dict[str, dict[str, float]],
) -> dict[str, dict[str, float]]:
    """Mappa per ticker (ultima chiave ``TICKER|CD`` vince) — compatibile con ``portfolio_for_fill``."""
    port: dict[str, dict[str, float]] = {}
    for rk, slot in preserved.items():
        tk = rk.split("|", 1)[0].strip().upper()
        if not tk:
            continue
        port[tk] = {
            "buy_price": slot.get("buy_price"),
            "capital": slot.get("capital"),
        }
    return port


def merge_preserved_into_sim_rows(
    rows: list[dict],
    preserved: dict[str, dict[str, float]] | None,
) -> int:
    """Applica buy_price/capital preservati; ritorna numero righe aggiornate."""
    if not preserved:
        return 0
    n = 0
    for r in rows:
        if not isinstance(r, dict):
            continue
        rk = row_key_from_parts(r.get("ticker"), r.get("completion_date"))
        if not rk:
            continue
        slot = preserved.get(rk)
        if slot is None and "|" in rk:
            slot = preserved.get(rk.split("|", 1)[0])
        if not slot:
            continue
        if r.get("buy_price") is None and slot.get("buy_price") is not None:
            r["buy_price"] = slot["buy_price"]
            n += 1
        if r.get("capital") is None and slot.get("capital") is not None:
            r["capital"] = slot["capital"]
            n += 1
    if n:
        print(
            f"[Simulation preserve] Ripristinati input P&L su {n} campi righe.",
            flush=True,
        )
    return n


def read_simulation_outcomes_from_workbook(xlsx_path: str) -> dict[str, dict[str, float]]:
    """Utility: apre il workbook in sola lettura e cattura gli esiti."""
    if not os.path.isfile(xlsx_path):
        return {}
    try:
        from openpyxl import load_workbook
    except ImportError:
        return {}
    try:
        wb = load_workbook(xlsx_path, read_only=True, data_only=True)
        out = capture_simulation_outcomes(wb)
        wb.close()
        return out
    except Exception as exc:
        print(f"[Simulation preserve] Lettura KO: {exc}", flush=True)
        return {}
