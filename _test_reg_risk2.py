import sys, json, traceback
sys.path.insert(0, ".")
try:
    from orchestrator_io_paths import REGULATORY_RISK_SNAPSHOT_JSON
    sys.stderr.write("PATH: " + REGULATORY_RISK_SNAPSHOT_JSON + "\n")
    from scripts.regulatory_risk_refresh import build_regulatory_risk_snapshot, save_snapshot
    snap = build_regulatory_risk_snapshot()
    sys.stderr.write("ticker_count: " + str(snap.get("ticker_count", 0)) + "\n")
    sys.stderr.write("signal_count: " + str(snap.get("signal_count", 0)) + "\n")
    save_snapshot(snap)
    from pathlib import Path
    p = Path(REGULATORY_RISK_SNAPSHOT_JSON)
    sys.stderr.write("file exists: " + str(p.is_file()) + "\n")
except Exception:
    traceback.print_exc(file=sys.stderr)
