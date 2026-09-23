from datetime import date
from pathlib import Path

from event_vol_index import (
    _nearest_cached_for_ticker,
    compute_event_vol_metrics,
    parse_pairs,
    pick_expiries,
)


def _opt(strike: float, iv: float, last: float = 1.0, volume: float = 10, oi: float = 20) -> dict:
    return {
        "strike": strike,
        "impliedVolatility": iv,
        "lastPrice": last,
        "bid": last * 0.95,
        "ask": last * 1.05,
        "volume": volume,
        "openInterest": oi,
    }


def test_pick_expiries_splits_event_vs_background():
    ev, bg = pick_expiries(["2026-09-12", "2026-09-19", "2026-10-17"], "2026-09-16")
    assert ev == "2026-09-19"
    assert bg == "2026-09-12"


def test_parse_pairs_dedupes():
    assert parse_pairs("GRAL:2026-09-23,gral:2026-09-23,ETON:2026-09-12") == [
        ("GRAL", "2026-09-23"),
        ("ETON", "2026-09-12"),
    ]


def test_ivr_and_bullish_rr_from_synthetic_chain():
    spot = 20.0
    calls_ev = [_opt(20, 0.80, last=2.0, volume=80, oi=100), _opt(22, 0.70, last=1.2)]
    puts_ev = [_opt(20, 0.70, last=1.6, volume=20, oi=40), _opt(18, 0.55, last=0.8)]
    calls_bg = [_opt(20, 0.40, last=0.8)]
    puts_bg = [_opt(20, 0.40, last=0.8)]
    row = compute_event_vol_metrics(
        spot=spot,
        asof=date(2026, 9, 6),
        event_iso="2026-09-16",
        expiry_ev="2026-09-19",
        expiry_bg="2026-09-12",
        calls_ev=calls_ev,
        puts_ev=puts_ev,
        calls_bg=calls_bg,
        puts_bg=puts_bg,
    )
    assert row["ivr"] is not None and row["ivr"] > 1.5
    assert row["em_straddle"] is not None and row["em_straddle"] > 0
    assert row["rr10"] is not None
    assert row["pcr_vol"] is not None and row["pcr_vol"] < 1


def test_nearest_cached_for_ticker_reuses_nearby_event_date(tmp_path, monkeypatch):
    import event_vol_index as evi

    monkeypatch.setattr(evi, "_CACHE_DIR", Path(tmp_path))
    (tmp_path / "GPCR_2026-09-30.json").write_text(
        '{"ticker":"GPCR","event_date":"2026-09-30","ivr":1.25,"em_straddle":0.11,"rr10":-0.05,"pcr_vol":0.8}\n',
        encoding="utf-8",
    )
    hit = _nearest_cached_for_ticker("GPCR", "2026-10-15")
    assert hit is not None
    assert hit["ivr"] == 1.25
    assert hit["event_date"] == "2026-10-15"
    assert hit.get("reused_from") == "GPCR|2026-09-30"
