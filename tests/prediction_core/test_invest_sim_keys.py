"""Allineamento chiavi simulazione investimento (UI ↔ simulation_preserve ISO)."""
from __future__ import annotations

from datetime import date


def _norm_cd(cdv) -> str:
    if cdv is None or cdv in ("", "—", "-"):
        return "—"
    if isinstance(cdv, date):
        return cdv.isoformat()[:10]
    s = str(cdv).strip()
    if not s:
        return "—"
    head = s[:10]
    if len(head) == 10 and head[4] == "-" and head[7] == "-":
        return head
    parts = s.replace(".", "/").replace("-", "/").split("/")
    if len(parts) == 3 and len(parts[2]) == 4:
        d, m, y = parts
        return f"{y}-{int(m):02d}-{int(d):02d}"
    return s


def _row_key(ticker: str, cd) -> str:
    tk = str(ticker or "").strip().upper()
    return f"{tk}|{_norm_cd(cd)}"


def test_row_key_iso_and_italian_match():
    assert _row_key("ANIK", "2026-05-31") == "ANIK|2026-05-31"
    assert _row_key("ANIK", "31/05/2026") == "ANIK|2026-05-31"
    assert _row_key("anik", date(2026, 5, 31)) == "ANIK|2026-05-31"


def test_reconcile_merges_legacy_key():
    rows = [{"Ticker": "ANIK", "Completion Date": "2026-05-31"}]
    inputs = {"ANIK|31/05/2026": {"buyPrice": 18.0, "capital": 5000.0}}
    canon = _row_key("ANIK", rows[0]["Completion Date"])
    legacy = "ANIK|31/05/2026"
    assert legacy != canon
    out = {}
    alias = {legacy: canon, canon: canon}
    for k, v in inputs.items():
        out[alias.get(k, _row_key(k.split("|")[0], k.split("|", 1)[-1]))] = v
    assert out[canon]["capital"] == 5000.0
