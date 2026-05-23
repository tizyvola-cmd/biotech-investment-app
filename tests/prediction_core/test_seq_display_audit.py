"""Audit codici display seq vs modello (HURA / celle mancanti)."""
from __future__ import annotations

import pytest

from prediction.extrap_safeguards import blend_sheet_display_seq_model
from prediction.seq_display_audit import (
    SEQ_FLATLINE_PLATEAU,
    SEQ_RUNUP_ANCHORING,
    audit_pred_display_curve,
    detect_seq_flatline_plateau,
    detect_seq_runup_anchoring,
)


def test_detect_hura_runup_anchoring():
    seq = [0.0, 43.2, 43.1, 43.1, 43.1, 43.1, 43.1, 43.0]
    model = [0.0, -1.0, -2.7, -2.9, -2.9, -3.0, -3.6, -3.6]
    info = detect_seq_runup_anchoring(seq, model, pred_row={"run_up_30d": 35})
    assert info is not None
    assert info["code"] == SEQ_RUNUP_ANCHORING


def test_detect_hura_flatline_plateau():
    seq = [0.0, 43.2, 43.1, 43.1, 43.1, 43.1, 43.1, 43.0]
    assert detect_seq_flatline_plateau(seq) is True


def test_plateau_forces_model_curve():
    seq = [0.0, 43.2, 43.1, 43.1, 43.1, 43.1, 43.1, 43.0]
    model = [0.0, -1.0, -2.7, -2.9, -2.9, -3.0, -3.6, -3.6]
    out = blend_sheet_display_seq_model(seq, model, pred_row={"run_up_30d": 35})
    assert out[1] == pytest.approx(-1.0, abs=0.2)


def test_audit_flags_incomplete_cells():
    audit = audit_pred_display_curve(
        [0.0, 1.0], [0.0, 2.0], [0.0, None], row_key="X|2026-01-01",
    )
    assert "pred_display_incomplete" in audit["codes"]
