from datetime import date, timedelta

from catalyst_uoa import (
    append_vol_history_day,
    avg_vol_from_history,
    build_uoa_row,
    classify_uoa_from_chain,
    options_vol_ratio,
    uoa_flag,
)


def test_vol_ratio_formula():
    assert options_vol_ratio(500, 50) == 10.0
    assert options_vol_ratio(500, None) is None
    assert options_vol_ratio(None, 50) is None
    assert options_vol_ratio(500, 0) is None


def test_uoa_flag_requires_all_inputs():
    assert uoa_flag(6.0, 600, 100) is True
    assert uoa_flag(4.0, 600, 100) is False
    assert uoa_flag(6.0, 50, 100) is False
    assert uoa_flag(None, 600, 100) is None
    assert uoa_flag(6.0, 600, None) is None


def test_no_avg_feed_returns_none_not_false():
    out = classify_uoa_from_chain(
        [{"strike": 20, "volume": 1000, "openInterest": 50}],
        [],
        avg_vol_by_strike=None,
    )
    assert out["uoa_flag"] is None
    assert out["status"] == "no_avg_vol_feed"


def test_hit_with_avg_and_prior_oi():
    out = classify_uoa_from_chain(
        [{"strike": 20, "volume": 600, "openInterest": 80, "lastPrice": 1.5}],
        [],
        prior_oi_by_strike={"C": {"20": 100}, "P": {}},
        avg_vol_by_strike={"C": {"20": 50}, "P": {}},
    )
    assert out["uoa_flag"] is True
    assert out["side"] == "call"
    assert out["vol_ratio"] == 12.0


def test_row_builder_marks_building_history():
    row = build_uoa_row("GRAL", history_days=3, history_needed=20)
    assert row["sweep_flag"] is None
    assert row["uoa_flag"] is None
    assert row["status"] == "building_history"
    assert row["history_days"] == 3
    assert row["history_needed"] == 20


def test_avg_vol_from_history_needs_20_days(tmp_path, monkeypatch):
    monkeypatch.setattr("catalyst_uoa._VOL_HIST_DIR", tmp_path)
    monkeypatch.setattr("catalyst_uoa._CACHE_DIR", tmp_path)
    start = date(2026, 8, 1)
    for i in range(20):
        d = (start + timedelta(days=i)).isoformat()
        append_vol_history_day(
            "GRAL",
            asof=d,
            vol={"C": {"20": 50.0 + i}, "P": {}},
            oi={"C": {"20": 100.0}, "P": {}},
        )
    today = (start + timedelta(days=20)).isoformat()
    # 20 prior days relative to today
    hist = {"prints": []}
    for i in range(20):
        d = (start + timedelta(days=i)).isoformat()
        hist["prints"].append(
            {
                "asof": d,
                "C": {"20": 50.0},
                "P": {},
                "oi_C": {"20": 90.0},
                "oi_P": {},
            }
        )
    derived = avg_vol_from_history(hist, asof=today, window=20, min_obs=5)
    assert derived["ready"] is True
    assert derived["history_days"] == 20
    assert derived["avg_vol_by_strike"]["C"]["20"] == 50.0
    assert derived["prior_oi_by_strike"]["C"]["20"] == 90.0

    # Include today in the file → history_days counts all sessions; ready still needs 20 priors.
    hist_with_today = {
        "prints": hist["prints"]
        + [
            {
                "asof": today,
                "C": {"20": 999.0},
                "P": {},
                "oi_C": {"20": 1.0},
                "oi_P": {},
            }
        ]
    }
    derived2 = avg_vol_from_history(hist_with_today, asof=today, window=20, min_obs=5)
    assert derived2["ready"] is True
    assert derived2["history_days"] == 21
    assert derived2["avg_vol_by_strike"]["C"]["20"] == 50.0  # today excluded from avg

    short = avg_vol_from_history({"prints": hist["prints"][:7]}, asof=today, window=20)
    assert short["ready"] is False
    assert short["history_days"] == 7
    assert short["avg_vol_by_strike"] is None
