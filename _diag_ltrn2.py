import sys, json, traceback
from pathlib import Path
sys.path.insert(0, ".")

out = Path(__file__).resolve().parent / "_diag_ltrn2_out.txt"

try:
    out.write_text("start\n", encoding="utf-8")
except Exception as e:
    sys.exit(1)

try:
    from orchestrator_io_paths import DATA_DIR
    out.write_text(f"DATA_DIR={DATA_DIR}\n", encoding="utf-8")
    
    k8 = Path(DATA_DIR) / "sec_k8_simulation_snapshot.json"
    result = f"k8 exists: {k8.is_file()}\n"
    
    if k8.is_file():
        doc = json.loads(k8.read_text(encoding="utf-8"))
        rows = doc.get("rows", [])
        result += f"k8 rows: {len(rows)}\n"
        ltrn_rows = [r for r in rows if str(r.get("Ticker","")).strip().upper() == "LTRN"]
        result += f"LTRN rows: {len(ltrn_rows)}\n"
        if ltrn_rows:
            r = ltrn_rows[0]
            for k, v in r.items():
                if isinstance(v, str) and len(v) >= 3:
                    result += f"  {k}: {v[:120]}\n"
    
    cf = Path(DATA_DIR) / "catalyst_feed_snapshot.json"
    result += f"\ncf exists: {cf.is_file()}\n"
    if cf.is_file():
        doc = json.loads(cf.read_text(encoding="utf-8"))
        events = doc.get("events", [])
        result += f"cf events: {len(events)}\n"
        ltrn = [e for e in events if str(e.get("ticker","")).strip().upper() == "LTRN"]
        result += f"LTRN events: {len(ltrn)}\n"
        for e in ltrn[:2]:
            ext = e.get("extracted", {})
            result += f"  headline: {ext.get('headline','')[:100]}\n"
            result += f"  type: {ext.get('catalyst_type','')}\n"
            result += f"  items: {e.get('items_label','')[:100]}\n"

    out.write_text(result, encoding="utf-8")
except Exception as e:
    out.write_text(f"ERROR: {traceback.format_exc()}", encoding="utf-8")
