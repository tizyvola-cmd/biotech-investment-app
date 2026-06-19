from pathlib import Path

p = Path(__file__).resolve().parents[1] / "prediction" / "seq_calib.py"
t = p.read_text(encoding="utf-8")

bad = """from prediction.config import (
    CURVE_SEQ_STATE_PATH,
    pred_curve_k8_seq_merge_enabled,
    pred_curve_seq_env_enabled,
    pred_curve_seq_load,
    pred_curve_seq_save,
    pred_curve_seq_snap_cal_day_to_offset_index,
)"""

good = """import json
import pathlib

from prediction.config import (
    CURVE_SEQ_STATE_PATH,
    pred_curve_k8_seq_merge_enabled,
    pred_curve_seq_env_enabled,
)"""

t = t.replace("import os\n\n" + bad, good)

helpers = '''

def pred_curve_seq_snap_cal_day_to_offset_index(
    off_cal: int,
    offsets: tuple[int, ...],
    *,
    max_slack_days: int = 7,
) -> int | None:
    """Indice del nodo la cui distanza |offset−off_cal| è minima, con slack massima."""
    best_i: int | None = None
    best_d: int | None = None
    for i, o in enumerate(offsets):
        d = abs(int(o) - int(off_cal))
        if d > int(max_slack_days):
            continue
        if best_d is None or d < best_d:
            best_d, best_i = d, i
        elif d == best_d and best_i is not None:
            if abs(int(o)) < abs(int(offsets[best_i])):
                best_i = i
    return best_i


def pred_curve_seq_load(path: pathlib.Path | str | None = None) -> dict:
    p = pathlib.Path(path or CURVE_SEQ_STATE_PATH)
    if not p.is_file():
        return {"version": 1, "events": {}}
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(d, dict):
            return {"version": 1, "events": {}}
        d.setdefault("version", 1)
        if not isinstance(d.get("events"), dict):
            d["events"] = {}
        return d
    except Exception:
        return {"version": 1, "events": {}}


def pred_curve_seq_save(doc: dict, path: pathlib.Path | str | None = None) -> None:
    p = pathlib.Path(path or CURVE_SEQ_STATE_PATH)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(
        json.dumps(doc, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )


'''

if "def pred_curve_seq_load" not in t:
    t = t.replace("DEFAULT_CAL_OFFSETS", helpers + "DEFAULT_CAL_OFFSETS", 1)

all_block = """
__all__ = [
    "DEFAULT_CAL_OFFSETS",
    "pred_curve_close_cal",
    "pred_curve_k8_seq_merge_enabled",
    "pred_curve_knot_metrics_asof",
    "pred_curve_seq_apply_to_predictions",
    "pred_curve_seq_env_enabled",
    "pred_curve_seq_load",
    "pred_curve_seq_save",
    "pred_curve_seq_snap_cal_day_to_offset_index",
    "pred_curve_series_upto_trade_date",
    "pred_curve_trade_date_at_offset",
]
"""
if "__all__" in t:
    import re
    t = re.sub(r"\n__all__ = \[.*?\]\n", "\n" + all_block + "\n", t, flags=re.S)
else:
    t = t.rstrip() + "\n" + all_block + "\n"

p.write_text(t, encoding="utf-8")
print("fixed seq_calib.py")
