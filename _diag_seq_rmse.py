"""Compare daily knot path vs seq_curve RMSE."""
from past_pred_io import load_past_pred_document, rows_map_from_doc
import data_orchestrator as orch
from prediction.pre_cd_curve_impact import PATH_OFFSETS, _actual_path_pct, _path_rmse, _model_raw_path_pct

rows = rows_map_from_doc(load_past_pred_document("data/past_catalyst_predictions.json"))
diffs = []
for r in rows.values():
    actual = _actual_path_pct(r)
    raw = _model_raw_path_pct(r)
    seq = r.get("seq_curve_pct_vs_m60")
    if not actual or not raw or not seq:
        continue
    daily = [
        round(float(v), 3) if v is not None else None
        for v in [
            orch._seq_curve_pct_at_cal_offset(seq, off) if off != -60 else 0.0
            for off in PATH_OFFSETS
        ]
    ]
    rb = _path_rmse(raw, actual)
    rd = _path_rmse(daily, actual)
    if rb and rd:
        diffs.append((rd - rb, r.get("ticker")))
print("n", len(diffs))
print("avg delta daily vs base", sum(d[0] for d in diffs) / len(diffs))
print("daily better count", sum(1 for d in diffs if d[0] < -0.5))
print("sample", sorted(diffs)[:5], sorted(diffs, reverse=True)[:5])
