import sys, json, traceback, os
from pathlib import Path

OUT = r"c:\coding\Biotech_Investment app 6\desktop-ui\_diag_out.txt"
sys.path.insert(0, r"c:\coding\Biotech_Investment app 6")

try:
    Path(OUT).write_text("step1\n", encoding="utf-8")
    from orchestrator_io_paths import DATA_DIR
    Path(OUT).write_text(f"step2 DATA_DIR={DATA_DIR}\n", encoding="utf-8")
    
    k8 = os.path.join(DATA_DIR, "sec_k8_simulation_snapshot.json")
    lines = [f"k8 path: {k8}", f"k8 exists: {os.path.isfile(k8)}"]
    
    if os.path.isfile(k8):
        with open(k8, "r", encoding="utf-8") as f:
            doc = json.load(f)
        rows = doc.get("rows", [])
        lines.append(f"k8 rows: {len(rows)}")
        ltrn_rows = [r for r in rows if str(r.get("Ticker","")).strip().upper() == "LTRN"]
        lines.append(f"LTRN rows: {len(ltrn_rows)}")
        if ltrn_rows:
            r = ltrn_rows[0]
            for k, v in r.items():
                if isinstance(v, str) and len(v) >= 3:
                    lines.append(f"  col[{k}]: {v[:150]}")
        else:
            # Show sample tickers
            sample_tk = sorted(set(str(r.get("Ticker","")).strip().upper() for r in rows[:30]))
            lines.append(f"  Sample tickers: {sample_tk}")
    
    cf = os.path.join(DATA_DIR, "catalyst_feed_snapshot.json")
    lines.append(f"\ncf exists: {os.path.isfile(cf)}")
    if os.path.isfile(cf):
        with open(cf, "r", encoding="utf-8") as f:
            doc = json.load(f)
        events = doc.get("events", [])
        lines.append(f"cf events: {len(events)}")
        ltrn_ev = [e for e in events if str(e.get("ticker","")).strip().upper() == "LTRN"]
        lines.append(f"LTRN events: {len(ltrn_ev)}")
        for e in ltrn_ev[:3]:
            ext = e.get("extracted", {})
            lines.append(f"  headline: {ext.get('headline','')[:120]}")
            lines.append(f"  catalyst_type: {ext.get('catalyst_type','')}")
            lines.append(f"  items_label: {e.get('items_label','')[:120]}")

    Path(OUT).write_text("\n".join(lines), encoding="utf-8")
except Exception:
    Path(OUT).write_text(traceback.format_exc(), encoding="utf-8")
