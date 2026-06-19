"""Per-tester mobile portfolio storage."""
from __future__ import annotations

from pathlib import Path

import pytest

import tester_feedback_io as tf
import tester_sim_inputs_io as tsi


@pytest.fixture
def isolated_stores(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    fb = tmp_path / "tester_feedback_store.json"
    sim_dir = tmp_path / "tester_sim_inputs"
    monkeypatch.setattr(tf, "STORE_PATH", fb)
    monkeypatch.setattr(tsi, "TESTER_SIM_INPUTS_DIR", str(sim_dir))
    return tmp_path


def test_tester_sim_inputs_isolated_per_id(isolated_stores: Path) -> None:
    tf.register_tester("", email="a@test.com", display_name="A", source="mobile")
    tf.register_tester("", email="b@test.com", display_name="B", source="mobile")
    tf.set_tester_status("a_at_test.com", "approved")
    tf.set_tester_status("b_at_test.com", "approved")

    tsi.save_sim_inputs(
        "a_at_test.com",
        {"TKR|2026-01-01": {"buyPrice": 10, "capital": 1000, "ignoreSheet": False}},
    )
    tsi.save_sim_inputs(
        "b_at_test.com",
        {"TKR|2026-01-01": {"buyPrice": 20, "capital": 500, "ignoreSheet": False}},
    )

    a = tsi.load_sim_inputs("a_at_test.com")["inputs"]
    b = tsi.load_sim_inputs("b_at_test.com")["inputs"]
    assert a["TKR|2026-01-01"]["capital"] == 1000
    assert b["TKR|2026-01-01"]["capital"] == 500


def test_pending_tester_cannot_save_sim(isolated_stores: Path) -> None:
    tf.register_tester("", email="pending@test.com", source="mobile")
    with pytest.raises(ValueError, match="approvazione"):
        tsi.save_sim_inputs("pending_at_test.com", {})
