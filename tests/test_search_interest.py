from search_interest import (
    _interest_delta_pct,
    fetch_search_interest,
    fetch_search_interest_leaders,
    leaders_from_cache,
    refresh_search_interest_universe,
    row_from_series,
)
import search_interest as si
import supernova_config as cfg


def test_interest_delta_pct_handles_zero_previous():
    assert _interest_delta_pct(0, 0) == 0.0
    assert _interest_delta_pct(20, 0) == 999.0
    assert _interest_delta_pct(8, 10) == -20.0


def test_row_from_series_spike_and_baseline():
    prior = [10.0] * 20
    row = row_from_series("INSP", prior + [40.0])
    assert row["interest_score"] == 40.0
    assert row["prev_interest_score"] == 10.0
    assert row["interest_delta_pct"] == 300.0
    assert row["rolling_baseline_20d"] == 10.0
    assert row["zscore_vs_baseline"] >= 2.0
    assert row["search_spike"] is True
    assert row["stale"] is False


def test_search_interest_disabled_when_off(monkeypatch):
    cfg.reset_supernova_config()
    monkeypatch.setenv("SUPERNOVA_TRENDS", "0")
    monkeypatch.delenv("SUPERNOVA_TRENDS_TICKERS", raising=False)
    cfg.reset_supernova_config()
    out = fetch_search_interest("BDSX,ETON")
    assert out["enabled"] is False
    assert out["error"] == "trends_disabled"
    assert out["rows"] == {}


def test_search_interest_allowlist_filters(monkeypatch, tmp_path):
    cfg.reset_supernova_config()
    monkeypatch.setenv("SUPERNOVA_TRENDS", "1")
    monkeypatch.setenv("SUPERNOVA_TRENDS_TICKERS", "BDSX,ETON,GRCE")
    monkeypatch.setattr(si, "_CACHE_DIR", tmp_path)
    monkeypatch.setattr(si, "_LIVE_GAP_S", 0.0)
    monkeypatch.setattr(si, "_WARMER_ENABLED", False)
    monkeypatch.setattr(si, "_trends_alias_catalog", lambda: {})
    monkeypatch.setattr(si, "_live_fetch_series", lambda *_a, **_k: [10.0] * 20 + [12.0])
    cfg.reset_supernova_config()
    out = fetch_search_interest("BDSX,CANF")
    assert out["enabled"] is True
    assert "BDSX" in out["rows"]
    assert "CANF" not in out["rows"]
    assert out["rows"]["BDSX"]["interest_score"] == 12.0
    assert out["method"] == "pytrends"


def test_search_interest_live_for_desk_tickers(monkeypatch, tmp_path):
    cfg.reset_supernova_config()
    monkeypatch.delenv("SUPERNOVA_TRENDS", raising=False)
    monkeypatch.delenv("SUPERNOVA_TRENDS_TICKERS", raising=False)
    monkeypatch.setattr(si, "_CACHE_DIR", tmp_path)
    monkeypatch.setattr(si, "_LIVE_GAP_S", 0.0)
    monkeypatch.setattr(si, "_WARMER_ENABLED", False)
    monkeypatch.setattr(si, "_trends_alias_catalog", lambda: {})
    monkeypatch.setattr(si, "_live_fetch_series", lambda *_a, **_k: [20.0] * 20 + [22.0])
    cfg.reset_supernova_config()
    out = fetch_search_interest("INSP,VRTX")
    assert out["enabled"] is True
    assert out["error"] is None
    assert set(out["rows"]) == {"INSP", "VRTX"}
    assert out["rows"]["INSP"]["stale"] is False
    assert out["method"] == "pytrends"


def test_search_interest_uses_cache(monkeypatch, tmp_path):
    cfg.reset_supernova_config()
    monkeypatch.setenv("SUPERNOVA_TRENDS", "1")
    monkeypatch.delenv("SUPERNOVA_TRENDS_TICKERS", raising=False)
    monkeypatch.setattr(si, "_CACHE_DIR", tmp_path)
    monkeypatch.setattr(si, "_LIVE_GAP_S", 0.0)
    monkeypatch.setattr(si, "_WARMER_ENABLED", False)
    monkeypatch.setattr(si, "_trends_alias_catalog", lambda: {})
    calls = {"n": 0}

    def _live(_tk: str, timeframe: str = "today 3-m") -> list[float]:
        calls["n"] += 1
        return [8.0] * 20 + [9.0]

    monkeypatch.setattr(si, "_live_fetch_series", _live)
    cfg.reset_supernova_config()
    first = fetch_search_interest("ZNTL")
    second = fetch_search_interest("ZNTL")
    assert first["rows"]["ZNTL"]["interest_score"] == 9.0
    assert first["rows"]["ZNTL"]["interest_1d_score"] == 9.0
    assert second["rows"]["ZNTL"]["interest_score"] == 9.0
    # Baseline + ~24h window on first live fill; second request is cache-only.
    assert calls["n"] == 2
    assert second["method"] == "cache"


def test_leaders_from_cache_ranks_spike_then_z(monkeypatch, tmp_path):
    monkeypatch.setattr(si, "_CACHE_DIR", tmp_path)
    monkeypatch.setattr(si, "_HISTORY_DIR", tmp_path / "history")
    si._write_cache(
        tmp_path / "COLD.json",
        {"ticker": "COLD", "zscore_vs_baseline": -0.4, "interest_score": 10, "search_spike": False},
    )
    si._write_cache(
        tmp_path / "HOT.json",
        {"ticker": "HOT", "zscore_vs_baseline": 2.4, "interest_score": 80, "search_spike": True},
    )
    si._write_cache(
        tmp_path / "MID.json",
        {"ticker": "MID", "zscore_vs_baseline": 1.2, "interest_score": 40, "search_spike": False},
    )
    si._write_cache(
        tmp_path / "JSPRW.json",
        {"ticker": "JSPRW", "zscore_vs_baseline": 9.0, "interest_score": 99, "search_spike": True},
    )
    ranked = leaders_from_cache(limit=10)
    assert [r["ticker"] for r in ranked] == ["HOT", "MID", "COLD"]


def test_weekend_delta_uses_last_nasdaq_print(monkeypatch, tmp_path):
    monkeypatch.setattr(si, "_CACHE_DIR", tmp_path)
    monkeypatch.setattr(si, "_HISTORY_DIR", tmp_path / "history")
    monkeypatch.setattr(si, "_nyse_closed", lambda today=None: True)
    monkeypatch.setattr(si, "_last_nasdaq_session_date", lambda today=None: __import__("datetime").date(2026, 9, 4))
    si._write_json(
        tmp_path / "history" / "GRAL.json",
        {
            "ticker": "GRAL",
            "prints": [
                {"at": "2026-09-03T16:00:00+00:00", "interest_score": 8},
                {"at": "2026-09-04T21:00:00+00:00", "interest_score": 10},
            ],
        },
    )
    out = si._apply_closed_session_delta(
        {"ticker": "GRAL", "interest_score": 16, "prev_interest_score": 10, "interest_delta_pct": 60.0},
        "GRAL",
    )
    assert out["prev_interest_score"] == 10
    assert out["interest_delta_pct"] == 60.0
    assert out["delta_basis"] == "weekend_vs_last_nasdaq"
    assert out["nasdaq_session_date"] == "2026-09-04"


def test_weekend_serves_stale_cache(monkeypatch, tmp_path):
    cfg.reset_supernova_config()
    monkeypatch.setenv("SUPERNOVA_TRENDS", "1")
    monkeypatch.delenv("SUPERNOVA_TRENDS_TICKERS", raising=False)
    monkeypatch.setattr(si, "_CACHE_DIR", tmp_path)
    monkeypatch.setattr(si, "_HISTORY_DIR", tmp_path / "history")
    monkeypatch.setattr(si, "_WARMER_ENABLED", False)
    monkeypatch.setattr(si, "_nyse_closed", lambda today=None: True)
    monkeypatch.setattr(si, "_last_nasdaq_session_date", lambda today=None: __import__("datetime").date(2026, 9, 4))
    monkeypatch.setattr(si, "_trends_alias_catalog", lambda: {})
    si._write_cache(
        tmp_path / "INSP.json",
        {"ticker": "INSP", "interest_score": 22, "zscore_vs_baseline": 0.4, "search_spike": False},
    )
    si._write_json(
        tmp_path / "history" / "INSP.json",
        {"ticker": "INSP", "prints": [{"at": "2026-09-04T17:00:00+00:00", "interest_score": 20}]},
    )
    calls = {"n": 0}
    monkeypatch.setattr(si, "_live_fetch_series", lambda *_a, **_k: calls.__setitem__("n", calls["n"] + 1) or [1.0] * 21)
    cfg.reset_supernova_config()
    out = fetch_search_interest("INSP")
    assert out["rows"]["INSP"]["interest_score"] == 22
    assert out["rows"]["INSP"]["prev_interest_score"] == 20
    assert out["rows"]["INSP"]["interest_delta_pct"] == 10.0
    assert out["session"] == "closed"
    assert calls["n"] == 0


def test_hydrate_delta_from_history(monkeypatch, tmp_path):
    monkeypatch.setattr(si, "_CACHE_DIR", tmp_path)
    monkeypatch.setattr(si, "_HISTORY_DIR", tmp_path / "history")
    si._write_json(
        tmp_path / "history" / "ETON.json",
        {
            "ticker": "ETON",
            "prints": [
                {"interest_score": 10},
                {"interest_score": 15},
            ],
        },
    )
    out = si._hydrate_interest_delta(
        {"ticker": "ETON", "interest_score": 15, "zscore_vs_baseline": 0.4},
        "ETON",
    )
    assert out["prev_interest_score"] == 10
    assert out["interest_delta_pct"] == 50.0


def test_hydrate_delta_from_baseline_when_no_history(monkeypatch, tmp_path):
    monkeypatch.setattr(si, "_CACHE_DIR", tmp_path)
    monkeypatch.setattr(si, "_HISTORY_DIR", tmp_path / "history")
    out = si._hydrate_interest_delta(
        {
            "ticker": "ETON",
            "interest_score": 22,
            "rolling_baseline_20d": 20,
            "zscore_vs_baseline": 0.4,
        },
        "ETON",
    )
    assert out["prev_interest_score"] == 20
    assert out["interest_delta_pct"] == 10.0
    assert out["delta_basis"] == "vs_baseline_20d"


def test_warming_false_when_scores_present_but_legs_incomplete(monkeypatch, tmp_path):
    cfg.reset_supernova_config()
    monkeypatch.setenv("SUPERNOVA_TRENDS", "1")
    monkeypatch.delenv("SUPERNOVA_TRENDS_TICKERS", raising=False)
    monkeypatch.setattr(si, "_CACHE_DIR", tmp_path)
    monkeypatch.setattr(si, "_HISTORY_DIR", tmp_path / "history")
    monkeypatch.setattr(si, "_WARMER_ENABLED", False)
    monkeypatch.setattr(si, "_nyse_closed", lambda today=None: True)
    monkeypatch.setattr(si, "_last_nasdaq_session_date", lambda today=None: __import__("datetime").date(2026, 9, 4))
    monkeypatch.setattr(
        si,
        "_trends_alias_catalog",
        lambda: {"INSP": {"company": "Inspire Medical Systems", "molecule": "SofPulse"}},
    )
    si._write_cache(
        tmp_path / "INSP.json",
        {
            "ticker": "INSP",
            "query_kind": "ticker",
            "interest_score": 22,
            "rolling_baseline_20d": 20,
            "zscore_vs_baseline": 0.4,
            "legs": [{"kind": "ticker", "term": "INSP", "interest_score": 22}],
        },
    )
    cfg.reset_supernova_config()
    out = fetch_search_interest("INSP")
    assert out["rows"]["INSP"]["interest_score"] == 22
    assert out["rows"]["INSP"]["interest_delta_pct"] == 10.0
    assert out["warming"] is False


def test_persist_live_row_records_z_delta(monkeypatch, tmp_path):
    monkeypatch.setattr(si, "_CACHE_DIR", tmp_path)
    monkeypatch.setattr(si, "_HISTORY_DIR", tmp_path / "history")
    first = si._persist_live_row("INSP", row_from_series("INSP", [10.0] * 20 + [12.0]))
    assert first["zscore_delta"] is None
    assert first["interest_delta_pct"] == 20.0
    second = si._persist_live_row("INSP", row_from_series("INSP", [10.0] * 20 + [40.0]))
    assert second["search_spike"] is True
    assert second["interest_delta_pct"] == 300.0
    assert second["zscore_delta"] is not None
    assert second["zscore_delta"] > 0


def test_refresh_universe_force_refetches(monkeypatch, tmp_path):
    cfg.reset_supernova_config()
    monkeypatch.setenv("SUPERNOVA_TRENDS", "1")
    monkeypatch.delenv("SUPERNOVA_TRENDS_TICKERS", raising=False)
    monkeypatch.setattr(si, "_CACHE_DIR", tmp_path)
    monkeypatch.setattr(si, "_HISTORY_DIR", tmp_path / "history")
    monkeypatch.setattr(si, "_LIVE_GAP_S", 0.0)
    monkeypatch.setattr(si, "_trends_alias_catalog", lambda: {})
    calls = {"n": 0}

    def _live(_tk: str, timeframe: str = "today 3-m") -> list[float]:
        calls["n"] += 1
        return [10.0] * 20 + [11.0]

    monkeypatch.setattr(si, "_live_fetch_series", _live)
    cfg.reset_supernova_config()
    first = refresh_search_interest_universe(["INSP"], force=True)
    second = refresh_search_interest_universe(["INSP"], force=False)
    third = refresh_search_interest_universe(["INSP"], force=True)
    assert first["fetched"] == 1
    assert second["skipped_fresh"] == 1
    assert third["fetched"] == 1
    # Each forced refresh: today 3-m + now 1-d.
    assert calls["n"] == 4


def test_leaders_payload_disabled(monkeypatch, tmp_path):
    cfg.reset_supernova_config()
    monkeypatch.setenv("SUPERNOVA_TRENDS", "0")
    monkeypatch.setattr(si, "_CACHE_DIR", tmp_path)
    cfg.reset_supernova_config()
    out = fetch_search_interest_leaders(8)
    assert out["enabled"] is False
    assert out["error"] == "trends_disabled"
    assert out["leaders"] == []


def test_queries_include_company_and_product():
    aliases = {
        "INSP": {"company": "Inspire Medical Systems, Inc.", "molecule": "SofPulse"},
    }
    assert si.queries_for_ticker("INSP", aliases=aliases) == [
        ("ticker", "INSP"),
        ("company", "Inspire Medical Systems"),
        ("product", "SofPulse"),
    ]
    assert si.queries_for_ticker("X", aliases={"X": {"molecule": "X"}}) == [("ticker", "X")]
    assert si.queries_for_ticker("Y", aliases={"Y": {}}) == [("ticker", "Y")]


def test_fetch_falls_back_to_ticker_when_molecule_has_no_series(monkeypatch, tmp_path):
    cfg.reset_supernova_config()
    monkeypatch.setenv("SUPERNOVA_TRENDS", "1")
    monkeypatch.delenv("SUPERNOVA_TRENDS_TICKERS", raising=False)
    monkeypatch.setattr(si, "_CACHE_DIR", tmp_path)
    monkeypatch.setattr(si, "_HISTORY_DIR", tmp_path / "history")
    monkeypatch.setattr(si, "_LIVE_GAP_S", 0.0)
    monkeypatch.setattr(si, "_WARMER_ENABLED", False)
    monkeypatch.setattr(
        si,
        "_trends_alias_catalog",
        lambda: {"BBNX": {"molecule": "ObscureINN999", "indication": "rare zyx disease"}},
    )

    def _live(term: str, timeframe: str = "today 3-m") -> list[float] | None:
        if term == "BBNX":
            return [15.0] * 20 + [18.0]
        return None

    monkeypatch.setattr(si, "_live_fetch_series", _live)
    cfg.reset_supernova_config()
    out = fetch_search_interest("BBNX")
    row = out["rows"]["BBNX"]
    assert row["query_kind"] == "ticker"
    assert row["query_term"] == "BBNX"
    assert row["interest_score"] == 18.0


def test_ticker_cache_is_kept_when_molecule_alias_exists(monkeypatch, tmp_path):
    cfg.reset_supernova_config()
    monkeypatch.setenv("SUPERNOVA_TRENDS", "1")
    monkeypatch.delenv("SUPERNOVA_TRENDS_TICKERS", raising=False)
    monkeypatch.setattr(si, "_CACHE_DIR", tmp_path)
    monkeypatch.setattr(si, "_WARMER_ENABLED", False)
    monkeypatch.setattr(
        si,
        "_trends_alias_catalog",
        lambda: {"CCCC": {"molecule": "UnknownDrug"}},
    )
    si._write_cache(
        tmp_path / "CCCC.json",
        {
            "ticker": "CCCC",
            "query_kind": "ticker",
            "query_term": "CCCC",
            "interest_score": 22,
            "zscore_vs_baseline": 0.4,
            "search_spike": False,
        },
    )
    calls = {"n": 0}

    def _live(_term: str, timeframe: str = "today 3-m") -> list[float]:
        calls["n"] += 1
        return [1.0] * 21

    monkeypatch.setattr(si, "_live_fetch_series", _live)
    cfg.reset_supernova_config()
    out = fetch_search_interest("CCCC")
    assert out["rows"]["CCCC"]["interest_score"] == 22
    assert calls["n"] == 0
    assert out["method"] == "cache"


def test_fetch_uses_ticker_even_when_molecule_alias_exists(monkeypatch, tmp_path):
    """HTTP path is ticker-only; company/product legs warm separately."""
    cfg.reset_supernova_config()
    monkeypatch.setenv("SUPERNOVA_TRENDS", "1")
    monkeypatch.delenv("SUPERNOVA_TRENDS_TICKERS", raising=False)
    monkeypatch.setattr(si, "_CACHE_DIR", tmp_path)
    monkeypatch.setattr(si, "_HISTORY_DIR", tmp_path / "history")
    monkeypatch.setattr(si, "_LIVE_GAP_S", 0.0)
    monkeypatch.setattr(si, "_WARMER_ENABLED", False)
    monkeypatch.setattr(
        si,
        "_trends_alias_catalog",
        lambda: {
            "INSP": {
                "company": "Inspire Medical Systems, Inc.",
                "molecule": "SofPulse",
                "indication": "lung cancer",
            }
        },
    )
    calls: list[str] = []

    def _live(term: str, timeframe: str = "today 3-m") -> list[float] | None:
        calls.append(f"{term}|{timeframe}")
        if term == "INSP":
            if timeframe == "now 1-d":
                return [30.0, 40.0, 50.0]
            return [10.0] * 20 + [12.0]
        if term == "Inspire Medical Systems":
            return [6.0] * 20 + [9.0]
        if term == "SofPulse":
            return [8.0] * 20 + [20.0]
        return None

    monkeypatch.setattr(si, "_live_fetch_series", _live)
    cfg.reset_supernova_config()
    out = fetch_search_interest("INSP")
    row = out["rows"]["INSP"]
    assert row["query_kind"] == "ticker"
    assert row["query_term"] == "INSP"
    assert row["interest_score"] == 12.0
    assert row["interest_1d_score"] == 50.0
    assert row["interest_1d_delta_pct"] == 25.0
    assert [leg["kind"] for leg in row["legs"]] == ["ticker"]
    assert calls == ["INSP|today 3-m", "INSP|now 1-d"]


def test_fetch_best_for_ticker_builds_all_legs(monkeypatch, tmp_path):
    monkeypatch.setattr(si, "_CACHE_DIR", tmp_path)
    monkeypatch.setattr(si, "_HISTORY_DIR", tmp_path / "history")
    monkeypatch.setattr(si, "_LIVE_GAP_S", 0.0)
    monkeypatch.setattr(
        si,
        "_trends_alias_catalog",
        lambda: {
            "INSP": {
                "company": "Inspire Medical Systems, Inc.",
                "molecule": "SofPulse",
                "indication": "lung cancer",
            }
        },
    )

    def _live(term: str, timeframe: str = "today 3-m") -> list[float] | None:
        if term == "INSP":
            if timeframe == "now 1-d":
                return [11.0, 22.0]
            return [10.0] * 20 + [12.0]
        if term == "Inspire Medical Systems":
            return [6.0] * 20 + [9.0]
        if term == "SofPulse":
            return [8.0] * 20 + [20.0]
        return None

    monkeypatch.setattr(si, "_live_fetch_series", _live)
    row = si._fetch_best_for_ticker("INSP")
    assert row is not None
    kinds = [leg["kind"] for leg in row["legs"]]
    assert kinds == ["ticker", "company", "product"]
    by_kind = {leg["kind"]: leg for leg in row["legs"]}
    assert by_kind["company"]["term"] == "Inspire Medical Systems"
    assert by_kind["company"]["interest_score"] == 9.0
    assert by_kind["product"]["term"] == "SofPulse"
    assert by_kind["product"]["interest_score"] == 20.0
    assert row["interest_1d_score"] == 22.0
    assert row["interest_1d_delta_pct"] == 100.0
    assert row["interest_1d_timeframe"] == "now 1-d"


def test_fetch_live_budget_fills_more_than_two(monkeypatch, tmp_path):
    cfg.reset_supernova_config()
    monkeypatch.setenv("SUPERNOVA_TRENDS", "1")
    monkeypatch.delenv("SUPERNOVA_TRENDS_TICKERS", raising=False)
    monkeypatch.setattr(si, "_CACHE_DIR", tmp_path)
    monkeypatch.setattr(si, "_HISTORY_DIR", tmp_path / "history")
    monkeypatch.setattr(si, "_LIVE_GAP_S", 0.0)
    monkeypatch.setattr(si, "_WARMER_ENABLED", False)
    monkeypatch.setattr(si, "_nyse_closed", lambda today=None: False)
    monkeypatch.setattr(si, "_trends_alias_catalog", lambda: {})
    calls = {"n": 0}

    def _live(_term: str, timeframe: str = "today 3-m") -> list[float]:
        calls["n"] += 1
        return [10.0] * 20 + [14.0]

    monkeypatch.setattr(si, "_live_fetch_series", _live)
    cfg.reset_supernova_config()
    tickers = "A,B,C,D,E,F"
    out = fetch_search_interest(tickers)
    # 6 tickers × (today 3-m + now 1-d)
    assert calls["n"] == 12
    assert all(out["rows"][tk]["interest_score"] == 14.0 for tk in tickers.split(","))
    assert all(out["rows"][tk]["interest_1d_score"] == 14.0 for tk in tickers.split(","))
    assert out["warming"] is False


def test_fetch_serves_hot_zone_from_cache_beyond_old_16_cap(monkeypatch, tmp_path):
    """Morning desk has ~48 tickers; cache hits must all land in rows (not truncate at 16)."""
    cfg.reset_supernova_config()
    monkeypatch.setenv("SUPERNOVA_TRENDS", "1")
    monkeypatch.delenv("SUPERNOVA_TRENDS_TICKERS", raising=False)
    monkeypatch.setattr(si, "_CACHE_DIR", tmp_path)
    monkeypatch.setattr(si, "_HISTORY_DIR", tmp_path / "history")
    monkeypatch.setattr(si, "_WARMER_ENABLED", False)
    monkeypatch.setattr(si, "_nyse_closed", lambda today=None: False)
    monkeypatch.setattr(si, "_trends_alias_catalog", lambda: {})
    monkeypatch.setattr(si, "_live_fetch_series", lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("no live")))
    cfg.reset_supernova_config()

    tickers = [f"T{i:02d}" for i in range(40)]
    for i, tk in enumerate(tickers):
        si._write_cache(
            tmp_path / f"{tk}.json",
            {
                "ticker": tk,
                "interest_score": float(10 + i),
                "prev_interest_score": float(10 + i - 1),
                "interest_delta_pct": 5.0,
                "query": tk,
                "legs": [{"kind": "ticker", "term": tk, "interest_score": float(10 + i)}],
            },
        )

    out = fetch_search_interest(tickers)
    assert len(out["rows"]) == 40
    assert out["rows"]["T00"]["interest_score"] == 10.0
    assert out["rows"]["T39"]["interest_score"] == 49.0
    assert out["rows"]["T20"]["interest_delta_pct"] == 5.0


def test_short_fields_from_series_delta():
    fields = si.short_fields_from_series([10.0, 12.0, 15.0])
    assert fields["interest_1d_score"] == 15.0
    assert fields["interest_1d_prev"] == 12.0
    assert fields["interest_1d_delta_pct"] == 25.0
    assert fields["interest_1d_samples"] == 3
    assert fields["interest_1d_timeframe"] == "now 1-d"
    empty = si.short_fields_from_series([])
    assert empty["interest_1d_score"] is None
    assert empty["interest_1d_samples"] == 0


def test_request_path_does_not_wait_when_google_lock_is_held(monkeypatch, tmp_path):
    """Many desks must get cache immediately while one Trends fetch is in flight."""
    import time

    cfg.reset_supernova_config()
    monkeypatch.setenv("SUPERNOVA_TRENDS", "1")
    monkeypatch.delenv("SUPERNOVA_TRENDS_TICKERS", raising=False)
    monkeypatch.setattr(si, "_CACHE_DIR", tmp_path)
    monkeypatch.setattr(si, "_WARMER_ENABLED", False)
    monkeypatch.setattr(si, "_trends_alias_catalog", lambda: {})
    monkeypatch.setattr(si, "_circuit_until", 0.0)
    called = {"n": 0}

    def _boom(*_a, **_k):
        called["n"] += 1
        return [10.0] * 21

    monkeypatch.setattr(si, "_live_fetch_series", _boom)
    cfg.reset_supernova_config()
    assert si._live_lock.acquire(timeout=2)
    try:
        t0 = time.monotonic()
        out = fetch_search_interest("INSP")
        elapsed = time.monotonic() - t0
    finally:
        si._live_lock.release()
    assert elapsed < 0.5
    assert called["n"] == 0
    assert out["rows"]["INSP"].get("interest_score") is None
    assert out["rows"]["INSP"].get("stale") is True
