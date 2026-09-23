from datetime import date, datetime, time
from zoneinfo import ZoneInfo

import fda_adcom_calendar as fac


def test_horizon_is_three_months():
    start, end = fac.horizon_window(date(2026, 9, 6))
    assert start == date(2026, 9, 6)
    assert end == date(2026, 12, 6)
    assert fac._horizon_months(start, end) == [
        (2026, 9),
        (2026, 10),
        (2026, 11),
        (2026, 12),
    ]


def test_rows_in_horizon_drops_past_and_far_future():
    rows = [
        {"id": "a", "date": "2026-07-29"},
        {"id": "b", "date": "2026-09-16"},
        {"id": "c", "date": "2027-03-01"},
    ]
    out = fac.rows_in_horizon(rows, date(2026, 9, 6), date(2026, 12, 6))
    assert [r["id"] for r in out] == ["b"]


def test_extract_meeting_dates():
    text = "The meeting will be held on October 15, 2026. Docket closes 2026-10-08."
    dates = fac.extract_meeting_dates(text)
    assert date(2026, 10, 15) in dates
    assert date(2026, 10, 8) in dates


def test_match_nasdaq_sponsor():
    hits = fac.match_nasdaq_sponsor("BLA from GRAIL, Inc. for the Galleri test")
    assert hits[0][0] == "GRAL"


def test_should_run_on_first_of_month():
    rome = ZoneInfo("Europe/Rome")
    first = datetime(2026, 10, 1, 7, 20, tzinfo=rome)
    assert fac.should_run_fda_adcom_refresh(first, last_month=None, at=time(7, 15))
    assert not fac.should_run_fda_adcom_refresh(first, last_month="2026-10", at=time(7, 15))
    before = datetime(2026, 10, 1, 7, 10, tzinfo=rome)
    assert not fac.should_run_fda_adcom_refresh(before, last_month=None, at=time(7, 15))
    later = datetime(2026, 10, 1, 18, 0, tzinfo=rome)
    assert fac.should_run_fda_adcom_refresh(later, last_month=None, at=time(7, 15))
    second = datetime(2026, 10, 2, 7, 20, tzinfo=rome)
    assert not fac.should_run_fda_adcom_refresh(second, last_month=None, at=time(7, 15))


def test_missing_snapshot_is_stale(tmp_path, monkeypatch):
    monkeypatch.setattr(fac, "_SNAPSHOT_PATH", tmp_path / "missing.json")
    assert fac.snapshot_month_stale(date(2026, 10, 1)) is True


def test_http_get_retries_certificate_urlerror(monkeypatch):
    calls = {"n": 0}

    class _Resp:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return b"ok"

    def fake_urlopen(req, timeout=20, context=None):
        calls["n"] += 1
        if context is None:
            raise fac.urllib.error.URLError("CERTIFICATE_VERIFY_FAILED")
        return _Resp()

    monkeypatch.setattr(fac.urllib.request, "urlopen", fake_urlopen)
    assert fac._http_get("https://example.test") == "ok"
    assert calls["n"] == 2


def test_rows_including_seed_keeps_amgn_when_snapshot_omits_it(monkeypatch):
    monkeypatch.setattr(
        fac,
        "load_snapshot",
        lambda: {
            "rows": [
                {
                    "id": "2026-09-16-GILD",
                    "date": "2026-09-16",
                    "ticker": "GILD",
                    "company": "Gilead Sciences, Inc.",
                    "product": "Veklury",
                    "kind": "safety_review",
                }
            ]
        },
    )
    out = fac.rows_including_seed(date(2026, 9, 6))
    tickers = {r["ticker"] for r in out}
    assert "AMGN" in tickers
    assert "GILD" in tickers


def test_refresh_seed_only_writes_horizon(tmp_path, monkeypatch):
    monkeypatch.setattr(fac, "_SNAPSHOT_PATH", tmp_path / "snap.json")
    out = fac.refresh_fda_adcom_calendar(today=date(2026, 9, 6), live=False)
    assert out["horizon_start"] == "2026-09-06"
    assert out["horizon_end"] == "2026-12-06"
    dates = {r["date"] for r in out["rows"]}
    assert "2026-09-16" in dates
    assert "2026-09-23" in dates
    assert all(d >= "2026-09-06" for d in dates)
