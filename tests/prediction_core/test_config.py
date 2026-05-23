"""Tests for prediction.config central env loading."""
from __future__ import annotations

import prediction.config as cfg


def test_from_env_defaults(monkeypatch):
    cfg.reset_config()
    for name in cfg.PredictionConfig._ENV_BY_FIELD.values():
        monkeypatch.delenv(name, raising=False)
    c = cfg.PredictionConfig.from_env()
    assert c.pred_curve_seq_calib is True
    assert c.pred_require_price is True
    assert c.pred_require_options is False
    assert c.pred_nct_strict is False
    assert c.pred_curve_align_epsilon == 0.5
    assert c.pred_curve_align_mode == "hybrid"
    assert c.past_pred_yf_period == "10y"
    assert c.price_tail_trim_days == 120


def test_monkeypatch_overrides_singleton(monkeypatch):
    cfg.reset_config()
    monkeypatch.setenv("PRED_CURVE_ALIGN_EPSILON", "1.5")
    monkeypatch.setenv("PRED_NCT_STRICT", "1")
    monkeypatch.setenv("PRED_REQUIRE_OPTIONS", "1")
    c = cfg.get_config(reload=True)
    assert c.pred_curve_align_epsilon == 1.5
    assert c.pred_nct_strict is True
    assert c.pred_require_options is True
    cfg.reset_config()


def test_wrapper_pred_curve_align_epsilon(monkeypatch):
    cfg.reset_config()
    monkeypatch.setenv("PRED_CURVE_ALIGN_EPSILON", "2.0")
    assert cfg.pred_curve_align_epsilon() == 2.0
    cfg.reset_config()


def test_pred_curve_align_strong_pp_auto(monkeypatch):
    cfg.reset_config()
    monkeypatch.delenv("PRED_CURVE_ALIGN_STRONG_PP", raising=False)
    monkeypatch.setenv("PRED_CURVE_ALIGN_EPSILON", "1.0")
    c = cfg.PredictionConfig.from_env()
    assert c.pred_curve_align_strong_pp() == 3.0
    cfg.reset_config()


def test_orch_skip_sec_k8_disables_k8_merge(monkeypatch):
    cfg.reset_config()
    monkeypatch.setenv("ORCH_SKIP_SEC_K8", "1")
    c = cfg.get_config(reload=True)
    assert c.pred_curve_k8_seq_merge_enabled() is False
    cfg.reset_config()
