"""Volume 24h/7d windows + trusted next-CD funnel (no Yahoo / CT.gov)."""
from __future__ import annotations

from datetime import date

from hype_volume_funnel import (
    HYPE_HOLD_DAYS,
    HYPE_PRICE_UP_GRACE_DAYS,
    VOLUME_SURGE_PCT,
    _default_relation,
    _surge_rank,
    build_sim_row_from_pick,
    funnel_nct_relation_ok,
    hype_price_up_grace_ok,
    is_hype_24h,
    is_hype_price_rising,
    load_portfolio_tickers,
    meets_hype_volume,
    order_hype_for_ctgov,
    pick_trusted_next_cd,
    retain_prior_hype_entries,
    select_hype_for_ctgov,
    load_snapshot_hype_entries,
    sync_hype_rows_into_simulation_snapshot,
)
from market_volume_history import volume_surge_windows


def test_volume_surge_24h_and_7d():
    sessions = [
        ("2026-08-24", 100_000),
        ("2026-08-25", 90_000),
        ("2026-08-26", 200_000),  # 222% — 7d
        ("2026-08-27", 110_000),
        ("2026-08-28", 100_000),
        ("2026-08-29", 95_000),
        ("2026-09-01", 90_000),
        ("2026-09-02", 88_000),  # last vs prev ~98%
    ]
    w = volume_surge_windows(sessions)
    assert w["surge_24h"] is False
    assert w["surge_7d"] is True
    assert w["max_pct_7d"] is not None and w["max_pct_7d"] >= 150


def test_volume_surge_24h_only_on_last_bar():
    sessions = [
        ("2026-09-01", 100_000),
        ("2026-09-02", 180_000),
    ]
    w = volume_surge_windows(sessions)
    assert w["surge_24h"] is True
    assert w["surge_7d"] is True


def test_funnel_rejects_unrestricted_relation():
    assert funnel_nct_relation_ok("direct sponsor") is True
    assert funnel_nct_relation_ok("collaborator") is True
    assert funnel_nct_relation_ok("indirect connections") is False
    assert funnel_nct_relation_ok("N/D") is False


def _study(
    *,
    sm: str,
    cd: str,
    nct: str = "NCT00000001",
    rel: str = "direct sponsor",
    lead: str = "PMV Pharmaceuticals, Inc.",
) -> dict:
    return {
        "ticker": "PMVP",
        "query_company": "PMV Pharmaceuticals, Inc.",
        "lead_sponsor": lead,
        "sponsor_match": sm,
        "completion_date": cd,
        "nct_id": nct,
        "nct_relation_type": rel,
        "brief_title": "PYNNACLE",
    }


def test_pick_prefers_exact_even_when_partial_is_sooner():
    today = date(2026, 9, 2)
    pick = pick_trusted_next_cd(
        [
            _study(sm="Partial", cd="2026-10-01", nct="NCT11111111", rel="collaborator"),
            _study(sm="Exact", cd="2028-01-15", nct="NCT22222222", rel="direct sponsor"),
        ],
        today=today,
        trusted_fn=lambda r: True,
        relation_fn=lambda r: str(r.get("nct_relation_type") or ""),
    )
    assert pick is not None
    assert pick["sponsor_match"] == "Exact"
    assert pick["cd"] == date(2028, 1, 15)
    assert pick["bucket"] == "off_book"


def test_pick_uses_partial_when_no_exact():
    today = date(2026, 9, 2)
    pick = pick_trusted_next_cd(
        [
            _study(sm="Partial", cd="2026-10-10", nct="NCT33333333", rel="collaborator"),
        ],
        today=today,
        trusted_fn=lambda r: True,
        relation_fn=lambda r: str(r.get("nct_relation_type") or ""),
    )
    assert pick is not None
    assert pick["sponsor_match"] == "Partial"
    assert pick["bucket"] == "sim"
    assert pick["days_to_cd"] == (date(2026, 10, 10) - today).days


def test_pick_drops_past_cd_and_unrestricted_relation():
    today = date(2026, 9, 2)
    pick = pick_trusted_next_cd(
        [
            _study(sm="Exact", cd="2026-08-01"),
            _study(
                sm="Exact",
                cd="2026-12-01",
                nct="NCT44444444",
                rel="indirect connections",
            ),
        ],
        today=today,
        trusted_fn=lambda r: True,
        relation_fn=lambda r: str(r.get("nct_relation_type") or ""),
    )
    assert pick is None


def test_build_sim_row_uses_sheet_cd_format():
    today = date(2026, 9, 2)
    pick = pick_trusted_next_cd(
        [_study(sm="Exact", cd="2026-11-04")],
        today=today,
        trusted_fn=lambda r: True,
        relation_fn=lambda r: "direct sponsor",
    )
    assert pick is not None
    row = build_sim_row_from_pick("pmvp", pick, volume_window="24h", company="PMV Pharmaceuticals")
    assert row["Ticker"] == "PMVP"
    assert row["Completion Date"] == "04/11/2026"
    assert row["hype_volume_funnel"] is True
    assert row["hype_cd_bucket"] == "sim"
    assert row["NCT"]["text"] == "NCT00000001"
    assert row["hype_first_seen"] == date.today().isoformat()


def test_candidate_tickers_skips_yf_dump_names(monkeypatch, tmp_path):
    import hype_volume_funnel as hv

    monkeypatch.setattr(hv, "_CLINICAL_SNAPSHOT", tmp_path / "clinical.json")
    (tmp_path / "clinical.json").write_text(
        '{"records":[{"ticker":"PMVP"},{"ticker":"CRDL"}]}',
        encoding="utf-8",
    )
    monkeypatch.setattr(
        hv,
        "candidate_tickers",
        hv.candidate_tickers,
    )

    import medtech_universe as mu

    monkeypatch.setattr(mu, "load_json_list", lambda _p: ["CERS"])
    monkeypatch.setattr(mu, "CURATED_MEDTECH", ("INBS",))
    monkeypatch.setattr(
        mu,
        "load_ticker_to_company",
        lambda: {
            "PMVP": "PMV Pharmaceuticals",
            "CRDL": "Cardiol",
            "CERS": "Cerus",
            "INBS": "Intelligent Bio",
            "ALLY": "Ally Financial",
            "JSPR": "Jasper",
        },
    )
    names = hv.candidate_tickers(already_on_sheet=["JSPR"])
    assert "ALLY" not in names
    assert "JSPR" not in names
    assert "PMVP" in names
    assert "CERS" in names


def test_surge_rank_prefers_highest_window():
    assert _surge_rank({"pct_of_prev": 120, "max_pct_7d": 410}) == 410.0
    assert _surge_rank({"pct_of_prev": 180, "max_pct_7d": None}) == 180.0


def test_ctgov_order_24h_before_7d_penny_tail():
    ordered = [
        tk
        for tk, _ in order_hype_for_ctgov(
            [
                ("PENNY", {"pct_of_prev": 80, "max_pct_7d": 245_000}),
                ("SPIKE", {"pct_of_prev": 610, "max_pct_7d": 610}),
                ("MID", {"pct_of_prev": 900, "max_pct_7d": 200}),
                ("TAIL", {"pct_of_prev": 120, "max_pct_7d": 800}),
            ]
        )
    ]
    assert ordered == ["MID", "SPIKE", "PENNY", "TAIL"]
    assert is_hype_24h({"pct_of_prev": 610, "max_pct_7d": 245_000}) is True
    assert is_hype_24h({"pct_of_prev": 80, "max_pct_7d": 245_000}) is False


def test_select_hype_for_ctgov_fills_leftover_slots_with_7d():
    surged = [
        ("CRNX", {"pct_of_prev": 727, "max_pct_7d": 727}),
        ("INAB", {"pct_of_prev": 619, "max_pct_7d": 619}),
        ("CANF", {"pct_of_prev": 80, "max_pct_7d": 132_000}),
        ("BIAF", {"pct_of_prev": 40, "max_pct_7d": 128_000}),
        ("TCRX", {"pct_of_prev": 20, "max_pct_7d": 1_000}),
    ]
    picked = [tk for tk, _ in select_hype_for_ctgov(surged, [], budget=4)]
    assert picked[:2] == ["CRNX", "INAB"]
    assert picked[2:] == ["CANF", "BIAF"]
    kept = select_hype_for_ctgov(surged, ["CRNX", "CANF"], budget=4)
    assert [tk for tk, _ in kept] == ["INAB", "BIAF", "TCRX"]


def test_load_snapshot_hype_entries_recovers_sidecar(tmp_path):
    import json

    snap = tmp_path / "simulation_sheet_snapshot.json"
    snap.write_text(
        json.dumps(
            {
                "rows": [
                    {"Ticker": "VNDA", "Completion Date": "01/12/2026"},
                    {
                        "Ticker": "canf",
                        "Completion Date": "31/08/2027",
                        "hype_volume_funnel": True,
                    },
                    {
                        "Ticker": "CANF",
                        "Completion Date": "01/04/2029",
                        "hype_volume_funnel": True,
                    },
                ]
            }
        ),
        encoding="utf-8",
    )
    rows = load_snapshot_hype_entries(snap)
    assert [r["Ticker"] for r in rows] == ["CANF"]
    assert rows[0]["hype_volume_funnel"] is True


def test_retain_holds_10_days_then_price_or_portfolio():
    today = date(2026, 9, 14)
    existing = [
        {
            "Ticker": "CANF",
            "hype_first_seen": "2026-09-10",
            "hype_entry_price": 1.2,
        },
        {
            "Ticker": "OLDX",
            "hype_first_seen": "2026-08-01",
            "hype_entry_price": 4.0,
        },
        {
            "Ticker": "RISE",
            "hype_first_seen": "2026-08-01",
            "hype_entry_price": 2.0,
        },
        {
            "Ticker": "BOOK",
            "hype_first_seen": "2026-08-01",
            "hype_entry_price": 3.0,
        },
        {
            "Ticker": "GRACE",
            "hype_first_seen": "2026-08-01",
            "hype_entry_price": 4.0,
            "hype_last_up_date": "2026-09-12",
        },
        {
            "Ticker": "STALEUP",
            "hype_first_seen": "2026-08-01",
            "hype_entry_price": 4.0,
            "hype_last_up_date": "2026-09-01",
        },
        {
            "Ticker": "HOT",
            "hype_first_seen": "2026-08-01",
        },
        {"Ticker": "VNDA", "hype_first_seen": "2026-09-10"},
        {"Ticker": "MISS"},
    ]
    vol_rows = {
        "CANF": {"pct_of_prev": 2, "last_close": 1.1, "prev_close": 1.15},
        "OLDX": {"pct_of_prev": 40, "last_close": 3.5, "prev_close": 3.6},
        "RISE": {"pct_of_prev": 50, "last_close": 2.4, "prev_close": 2.2},
        "BOOK": {"pct_of_prev": 10, "last_close": 2.5, "prev_close": 2.6},
        "GRACE": {"pct_of_prev": 20, "last_close": 3.5, "prev_close": 3.6},
        "STALEUP": {"pct_of_prev": 20, "last_close": 3.5, "prev_close": 3.6},
        "HOT": {"pct_of_prev": 520, "last_close": 5.0, "prev_close": 4.8},
        "VNDA": {"pct_of_prev": 80, "last_close": 10.0, "prev_close": 9.0},
    }
    kept, dropped = retain_prior_hype_entries(
        existing,
        vol_rows,
        on_sheet={"VNDA"},
        portfolio={"BOOK"},
        today=today,
    )
    kept_tks = {e["Ticker"] for e in kept}
    dropped_tks = {e["Ticker"] for e in dropped}
    assert HYPE_HOLD_DAYS == 10
    assert HYPE_PRICE_UP_GRACE_DAYS == 3
    assert hype_price_up_grace_ok(date(2026, 9, 12), today) is True
    assert hype_price_up_grace_ok(date(2026, 9, 1), today) is False
    assert kept_tks == {"CANF", "RISE", "BOOK", "HOT", "MISS", "GRACE"}
    assert dropped_tks == {"OLDX", "VNDA", "STALEUP"}
    assert next(e for e in kept if e["Ticker"] == "CANF")["hype_hold_reason"] == "hold"
    assert next(e for e in kept if e["Ticker"] == "RISE")["hype_hold_reason"] == "price_up"
    assert next(e for e in kept if e["Ticker"] == "BOOK")["hype_hold_reason"] == "portfolio"
    assert next(e for e in kept if e["Ticker"] == "HOT")["hype_hold_reason"] == "still_hot"
    assert next(e for e in kept if e["Ticker"] == "GRACE")["hype_hold_reason"] == "price_up_grace"
    assert next(e for e in dropped if e["Ticker"] == "OLDX")["drop_reason"] == "hold_expired"
    assert next(e for e in dropped if e["Ticker"] == "STALEUP")["drop_reason"] == "hold_expired"
    assert next(e for e in dropped if e["Ticker"] == "VNDA")["drop_reason"] == "now_on_sheet"


def test_hype_price_rising_session_or_vs_entry():
    assert is_hype_price_rising(entry_price=2.0, last_close=2.1, prev_close=2.05) is True
    assert is_hype_price_rising(entry_price=2.0, last_close=2.05, prev_close=1.9) is True
    assert is_hype_price_rising(entry_price=2.0, last_close=1.9, prev_close=2.0) is False
    assert is_hype_price_rising(entry_price=None, last_close=None, prev_close=1.0) is False


def test_load_portfolio_tickers(tmp_path):
    p = tmp_path / "invest_sim_inputs.json"
    p.write_text(
        '{"inputs":{"NSPR|20/11/2026":{"capital":5000,"buyPrice":2.1},'
        '"SKIP|01/01/2027":{"capital":0,"buyPrice":3}}}',
        encoding="utf-8",
    )
    assert load_portfolio_tickers(inputs_path=p) == {"NSPR"}


def test_hype_volume_gate_is_400_not_vol_column():
    assert VOLUME_SURGE_PCT == 400
    assert meets_hype_volume({"pct_of_prev": 150, "max_pct_7d": 268}) is False
    assert meets_hype_volume({"pct_of_prev": 399, "max_pct_7d": 80}) is False
    assert meets_hype_volume({"pct_of_prev": 400, "max_pct_7d": 80}) is True
    assert meets_hype_volume({"pct_of_prev": 80, "max_pct_7d": 410}) is True
    # Simulation VOL flags at 150% must not sneak in.
    assert (
        meets_hype_volume({"surge_24h": True, "surge_7d": True, "pct_of_prev": 220})
        is False
    )


def test_relation_nd_exact_lead_infers_direct_sponsor(monkeypatch):
    import data_orchestrator as orch

    monkeypatch.setattr(
        orch,
        "nct_relation_type_for_company_nct",
        lambda *_a, **_k: "N/D",
    )
    rel = _default_relation(
        {
            "nct_id": "NCT07392125",
            "query_company": "Achieve Life Sciences",
            "lead_sponsor": "Achieve Life Sciences",
            "sponsor_match": "Exact",
        }
    )
    assert rel == "direct sponsor"


def test_relation_keeps_indirect_connections(monkeypatch):
    import data_orchestrator as orch

    monkeypatch.setattr(
        orch,
        "nct_relation_type_for_company_nct",
        lambda *_a, **_k: "indirect connections",
    )
    rel = _default_relation(
        {
            "nct_id": "NCT00000001",
            "query_company": "Acadia Pharmaceuticals",
            "lead_sponsor": "New York State Psychiatric Institute",
            "sponsor_match": "Exact",
        }
    )
    assert rel == "indirect connections"
    assert funnel_nct_relation_ok(rel) is False


def test_sync_hype_rows_replaces_previous_hype_only(tmp_path):
    import json

    snap = tmp_path / "simulation_sheet_snapshot.json"
    snap.write_text(
        json.dumps(
            {
                "rows": [
                    {"Ticker": "VNDA", "Completion Date": "01/12/2026"},
                    {
                        "Ticker": "OLDH",
                        "Completion Date": "01/01/2027",
                        "hype_volume_funnel": True,
                    },
                ],
                "row_count": 2,
            }
        ),
        encoding="utf-8",
    )
    n = sync_hype_rows_into_simulation_snapshot(
        [
            {
                "Ticker": "CANF",
                "Completion Date": "01/04/2029",
                "hype_volume_funnel": True,
            }
        ],
        snapshot_path=snap,
    )
    assert n == 1
    doc = json.loads(snap.read_text(encoding="utf-8"))
    tickers = [r["Ticker"] for r in doc["rows"]]
    assert tickers == ["VNDA", "CANF"]
    assert doc["row_count"] == 2


def test_load_simulation_tickers_can_exclude_hype(tmp_path, monkeypatch):
    import json
    import hype_volume_funnel as hv

    snap = tmp_path / "simulation_sheet_snapshot.json"
    snap.write_text(
        json.dumps(
            {
                "rows": [
                    {"Ticker": "VNDA", "Completion Date": "01/12/2026"},
                    {
                        "Ticker": "CANF",
                        "Completion Date": "31/08/2027",
                        "hype_volume_funnel": True,
                    },
                ]
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(hv, "SIMULATION_SHEET_SNAPSHOT_JSON", snap)
    assert hv.load_simulation_tickers() == {"VNDA", "CANF"}
    assert hv.load_simulation_tickers(exclude_hype=True) == {"VNDA"}


def test_patch_hype_financials_from_enrich_cache(tmp_path, monkeypatch):
    import json
    import hype_volume_funnel as hv

    snap = tmp_path / "simulation_sheet_snapshot.json"
    cache_dir = tmp_path / "enrich_cache"
    cache_dir.mkdir()
    snap.write_text(
        json.dumps(
            {
                "rows": [
                    {
                        "Ticker": "CANF",
                        "Completion Date": "31/08/2027",
                        "hype_volume_funnel": True,
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    (cache_dir / "CANF.json").write_text(
        json.dumps(
            {
                "beta": -0.101,
                "liquidity_score": 1.0,
                "current_ratio": 3.45,
                "quick_ratio": 3.45,
                "cash_ratio": 4.22,
                "currentPrice": 2.38,
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(hv, "SIMULATION_SHEET_SNAPSHOT_JSON", snap)
    n = hv.patch_hype_financials_from_enrich_cache(
        snapshot_path=snap, cache_dir=cache_dir
    )
    assert n == 1
    row = json.loads(snap.read_text(encoding="utf-8"))["rows"][0]
    assert row["Beta (5Y vs mercato)"] == -0.101
    assert row["liquidity_score"] == 1.0
    assert "CR 3.45" in str(row.get("Liquidità (FY)") or "")
    assert row["Prezzo Corrente ($)"] == 2.38


def test_sync_hype_preserves_prior_live_fields(tmp_path, monkeypatch):
    import json
    import hype_volume_funnel as hv

    snap = tmp_path / "simulation_sheet_snapshot.json"
    snap.write_text(
        json.dumps(
            {
                "rows": [
                    {"Ticker": "VNDA", "Completion Date": "01/12/2026"},
                    {
                        "Ticker": "CANF",
                        "Completion Date": "31/08/2027",
                        "hype_volume_funnel": True,
                        "Prezzo Corrente ($)": 2.1,
                        "slope≈5g": 0.5,
                    },
                ],
                "row_count": 2,
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(hv, "SIMULATION_SHEET_SNAPSHOT_JSON", snap)
    n = hv.sync_hype_rows_into_simulation_snapshot(
        [
            {
                "Ticker": "CANF",
                "Completion Date": "31/08/2027",
                "hype_volume_funnel": True,
                "hype_volume_window": "24h",
            }
        ],
        snapshot_path=snap,
    )
    assert n == 1
    row = next(
        r
        for r in json.loads(snap.read_text(encoding="utf-8"))["rows"]
        if r["Ticker"] == "CANF"
    )
    assert row["Prezzo Corrente ($)"] == 2.1
    assert row["slope≈5g"] == 0.5
    assert row["hype_volume_window"] == "24h"
