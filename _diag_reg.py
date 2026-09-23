"""Diagnostica Regulatory Risk — scrive risultato in _diag_reg_out.txt"""
import sys, json, traceback
from pathlib import Path
sys.path.insert(0, ".")

out_lines = []
_out = Path(__file__).resolve().parent / "_diag_reg_out.txt"

def log(msg):
    out_lines.append(msg)
    _out.write_text("\n".join(out_lines), encoding="utf-8")

try:
    log("step: importing orchestrator_io_paths")
    from orchestrator_io_paths import INVEST_SIM_INPUTS_JSON, SIMULATION_SHEET_SNAPSHOT_JSON, DATA_DIR
    log("step: importing scripts.regulatory_risk_refresh")
    from scripts.regulatory_risk_refresh import _portfolio_tickers, _simulation_tickers
    log("step: imports OK")
except Exception:
    log("IMPORT ERROR:\n" + traceback.format_exc())
    sys.exit(1)

# 1. Check tickers

pt = _portfolio_tickers()
st = _simulation_tickers()
log(f"Portfolio tickers ({len(pt)}): {sorted(pt)[:15]}")
log(f"Simulation tickers ({len(st)}): {sorted(st)[:15]}")
all_tk = pt | st
log(f"Total unique tickers: {len(all_tk)}")

# 2. Check catalyst feed snapshot
cf_path = Path(DATA_DIR) / "catalyst_feed_snapshot.json"
if cf_path.is_file():
    cf = json.loads(cf_path.read_text(encoding="utf-8"))
    events = cf.get("events", [])
    log(f"\nCatalyst feed events: {len(events)}")
    types = {}
    for e in events:
        ct = (e.get("extracted") or {}).get("catalyst_type", "unknown")
        types[ct] = types.get(ct, 0) + 1
    log(f"Event types: {types}")
    tickers_in_feed = set(str(e.get("ticker","")).strip().upper() for e in events)
    overlap = tickers_in_feed & all_tk
    log(f"Tickers in feed: {sorted(tickers_in_feed)[:15]}")
    log(f"Overlap with portfolio/sim: {sorted(overlap)[:15]}")
    # Show sample events
    for e in events[:3]:
        ext = e.get("extracted", {})
        log(f"  Sample: ticker={e.get('ticker')} type={ext.get('catalyst_type')} headline={str(ext.get('headline',''))[:80]}")
else:
    log("catalyst_feed_snapshot.json NOT FOUND")

# 3. Check sec_k8 snapshot
k8_path = Path(DATA_DIR) / "sec_k8_simulation_snapshot.json"
if k8_path.is_file():
    k8 = json.loads(k8_path.read_text(encoding="utf-8"))
    rows = k8.get("rows", [])
    log(f"\nSEC K8 rows: {len(rows)}")
    k8_tickers = set()
    for r in rows:
        tk = str(r.get("Ticker","")).strip().upper()
        if tk:
            k8_tickers.add(tk)
    log(f"K8 tickers: {sorted(k8_tickers)[:15]}")
    overlap_k8 = k8_tickers & all_tk
    log(f"Overlap with portfolio/sim: {sorted(overlap_k8)[:15]}")
    # Keyword scan sample
    kw = ["pdufa","crl","complete response","cmc","manufacturing","nda","bla","fda"]
    hits = 0
    for r in rows:
        content = " ".join(str(v) for v in r.values() if isinstance(v, str) and len(str(v)) > 20)
        lower = content.lower()
        matched = [k for k in kw if k in lower]
        if matched:
            hits += 1
            tk = str(r.get("Ticker",""))
            log(f"  K8 hit: {tk} -> {matched} (sample: {content[:100]})")
            if hits >= 5:
                break
    log(f"Total K8 rows with keyword hits (sampled): {hits}")
else:
    log("sec_k8_simulation_snapshot.json NOT FOUND")

# 4. Build snapshot
from scripts.regulatory_risk_refresh import build_regulatory_risk_snapshot
snap = build_regulatory_risk_snapshot()
log(f"\nSnapshot result: ticker_count={snap.get('ticker_count',0)} signal_count={snap.get('signal_count',0)}")
for tk, entry in list(snap.get("tickers", {}).items())[:5]:
    log(f"  {tk}: score={entry.get('score',0)} crl={entry['crl']['detected']} pdufa={entry['pdufa']['detected']} cmc={entry['cmc']['detected']}")

Path("_diag_reg_out.txt").write_text("\n".join(out_lines), encoding="utf-8")
