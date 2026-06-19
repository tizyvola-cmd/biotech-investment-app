from past_pred_io import load_past_pred_document, rows_map_from_doc

rows = rows_map_from_doc(load_past_pred_document("data/past_catalyst_predictions.json"))
n_seq = n_eis = n_k8 = n_k8snap = 0
for r in rows.values():
    if r.get("seq_curve_pct_vs_m60"):
        n_seq += 1
    if abs(float(r.get("eis_poly_shift_pp") or 0)) > 0.01:
        n_eis += 1
    snaps = r.get("seq_curve_knot_snapshots") or []
    if snaps:
        n_k8snap += 1
    for s in snaps:
        if isinstance(s, dict):
            note = str(s.get("source") or s.get("knot_type") or "").lower()
            if "k8" in note or "8-k" in note or "sec" in note:
                n_k8 += 1
                break
print("total", len(rows), "seq_curve", n_seq, "eis", n_eis, "knot_snaps", n_k8snap, "with_k8", n_k8)

from pathlib import Path
import json

p = Path("data/simulation_charts_snapshot.json")
if p.exists():
    b = json.loads(p.read_text(encoding="utf-8"))
    series = b.get("series") or {}
    print("chart series", len(series))
    sk = next(iter(series.keys()), None)
    if sk:
        pts = series[sk][:3]
        print("sample key", sk, "pts", pts)
else:
    print("no simulation_charts_snapshot.json")
