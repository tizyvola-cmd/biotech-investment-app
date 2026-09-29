from eis_pattern_research.src.catalyst_alerts import build_live_feature_row


def test_live_dump_proxy_falls_back_to_run_up_30d():
    live = build_live_feature_row("BDSX", "2026-07-31")
    run30 = live.get("run_up_30d")
    dump = live.get("dump_proxy_pct")
    if run30 is None:
        assert dump is None
    else:
        assert dump == run30
