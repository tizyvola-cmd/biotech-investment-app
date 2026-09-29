import sys, json, traceback
from pathlib import Path
sys.path.insert(0, ".")
log = Path("_test_reg_risk3_log.txt")
try:
    from orchestrator_io_paths import REGULATORY_RISK_SNAPSHOT_JSON
    log.write_text(f"PATH: {REGULATORY_RISK_SNAPSHOT_JSON}\n", encoding="utf-8")
    from scripts.regulatory_risk_refresh import build_regulatory_risk_snapshot, save_snapshot
    snap = build_regulatory_risk_snapshot()
    out = f"ticker_count: {snap.get('ticker_count', 0)}\nsignal_count: {snap.get('signal_count', 0)}\ntickers: {list(snap.get('tickers', {}).keys())[:10]}\n"
    save_snapshot(snap)
    p = Path(REGULATORY_RISK_SNAPSHOT_JSON)
    out += f"file exists: {p.is_file()}\n"
    log.write_text(out, encoding="utf-8")
except Exception:
    log.write_text(traceback.format_exc(), encoding="utf-8")
