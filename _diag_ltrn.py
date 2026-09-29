"""Check what regulatory data is available for LTRN"""
import sys, json
from pathlib import Path
sys.path.insert(0, ".")

out = Path(__file__).resolve().parent / "_diag_ltrn_out.txt"
lines = []

def log(msg):
    lines.append(msg)
    out.write_text("\n".join(lines), encoding="utf-8")

try:
    from orchestrator_io_paths import DATA_DIR

    # 1. Check sec_k8_simulation_snapshot
    k8 = Path(DATA_DIR) / "sec_k8_simulation_snapshot.json"
    if k8.is_file():
        doc = json.loads(k8.read_text(encoding="utf-8"))
        rows = doc.get("rows", [])
        log(f"sec_k8: {len(rows)} total rows")
        ltrn_rows = [r for r in rows if str(r.get("Ticker","")).strip().upper() == "LTRN"]
        log(f"sec_k8 LTRN rows: {len(ltrn_rows)}")
        for r in ltrn_rows[:2]:
            cols = {k: str(v)[:100] for k, v in r.items() if isinstance(v, str) and len(str(v)) > 3}
            log(f"  columns: {list(cols.keys())}")
            log(f"  sample values: {list(cols.values())[:3]}")
    else:
        log("sec_k8_simulation_snapshot.json NOT FOUND")

    # 2. Check catalyst_feed_snapshot
    cf = Path(DATA_DIR) / "catalyst_feed_snapshot.json"
    if cf.is_file():
        doc = json.loads(cf.read_text(encoding="utf-8"))
        events = doc.get("events", [])
        log(f"\ncatalyst_feed: {len(events)} total events")
        ltrn_events = [e for e in events if str(e.get("ticker","")).strip().upper() == "LTRN"]
        log(f"catalyst_feed LTRN events: {len(ltrn_events)}")
        for e in ltrn_events[:2]:
            ext = e.get("extracted", {})
            log(f"  headline={ext.get('headline','')[:80]}")
            log(f"  catalyst_type={ext.get('catalyst_type','')}")
            log(f"  items_label={e.get('items_label','')[:80]}")
    else:
        log("catalyst_feed_snapshot.json NOT FOUND")

    # 3. Check catalyst_feed_cache
    cache = Path(DATA_DIR) / "catalyst_feed_cache.json"
    if cache.is_file():
        doc = json.loads(cache.read_text(encoding="utf-8"))
        log(f"\ncatalyst_feed_cache: {len(doc)} keys (type={type(doc).__name__})")
        if isinstance(doc, dict):
            ltrn_key = next((k for k in doc.keys() if k.strip().upper() == "LTRN"), None)
            if ltrn_key:
                entries = doc[ltrn_key]
                log(f"cache LTRN entries: {len(entries) if isinstance(entries, list) else 'not a list'}")
                if isinstance(entries, list):
                    for ce in entries[:2]:
                        log(f"  keys: {list(ce.keys()) if isinstance(ce, dict) else 'not dict'}")
                        if isinstance(ce, dict):
                            text = str(ce.get("text") or ce.get("content") or "")[:150]
                            log(f"  text: {text}")
            else:
                log(f"LTRN not in cache keys. Sample keys: {list(doc.keys())[:10]}")
    else:
        log("catalyst_feed_cache.json NOT FOUND")

    # 4. Try building snapshot for LTRN specifically
    from scripts.regulatory_risk_refresh import (
        _extract_from_catalyst_feed, _extract_from_sec_k8,
        _extract_from_catalyst_cache, _kw_match, PDUFA_KEYWORDS, CRL_KEYWORDS, CMC_KEYWORDS
    )
    tickers = {"LTRN"}
    feed_sig = _extract_from_catalyst_feed(tickers)
    cache_sig = _extract_from_catalyst_cache(tickers)
    k8_sig = _extract_from_sec_k8(tickers)
    log(f"\nExtraction for LTRN:")
    log(f"  feed signals: {list(feed_sig.keys())}")
    log(f"  cache signals: {list(cache_sig.keys())}")
    log(f"  k8 signals: {list(k8_sig.keys())}")
    if "LTRN" in feed_sig:
        log(f"  feed detail: {json.dumps(feed_sig['LTRN'], indent=2)[:500]}")
    if "LTRN" in cache_sig:
        log(f"  cache detail: {json.dumps(cache_sig['LTRN'], indent=2)[:500]}")
    if "LTRN" in k8_sig:
        log(f"  k8 detail: {json.dumps(k8_sig['LTRN'], indent=2)[:500]}")

except Exception as e:
    import traceback
    log(f"ERROR: {e}\n{traceback.format_exc()}")
