"""Fill gaps from Phase B extraction (constants + orch delegate)."""
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "prediction" / "pipeline.py"
text = p.read_text(encoding="utf-8")

if "MODEL_RELIABILITY_CALIBRATION_DAYS" not in text.split("compute_price_predictions")[0]:
    anchor = "from prediction.types import PredictionRunConfig\n"
    insert = (
        anchor
        + "\n"
        + "# Legacy orchestrator constant (kept for reliability calibration window).\n"
        + "MODEL_RELIABILITY_CALIBRATION_DAYS = 60\n"
    )
    if anchor in text:
        text = text.replace(anchor, insert, 1)
    else:
        raise SystemExit("import anchor missing")

text = text.replace(
    "_app_live = model_input_applicability_report(",
    "_app_live = orch.model_input_applicability_report(",
)

p.write_text(text, encoding="utf-8")
print("patched pipeline gaps")
