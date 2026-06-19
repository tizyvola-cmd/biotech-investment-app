"""
Audit integrazione v5 vs motore v4 (perche Accuratezza temporale puo mostrare v5 debole).

Eseguire:
  py -3 -m prediction.v5_integration_check
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from prediction.accuracy_v4_v5 import ACCURACY_V4_DISPLAY_OFFSETS
from prediction.config import (
    get_config,
    pred_engine,
    pred_v5_align_sign_v4_enabled,
    pred_v5_anchor_q50_v4_enabled,
    pred_v5_calib_enabled,
    pred_v5_cohort_prior_enabled,
    pred_v5_excel_fan_enabled,
    pred_v5_fund_risk_enabled,
    pred_v5_grafici_fan_enabled,
    pred_v5_sim_display_mode,
)
from prediction.pipeline import (
    SIMULATION_V5_Q50_OFFSETS,
    predict_v5_fan_offsets,
    predict_v5_q50_offsets,
)


@dataclass
class CheckItem:
    id: str
    status: str  # ok | partial | missing | bug
    title_it: str
    detail_it: str


@dataclass
class V5IntegrationReport:
    items: list[CheckItem] = field(default_factory=list)
    summary_ok: int = 0
    summary_partial: int = 0
    summary_missing: int = 0
    summary_bug: int = 0

    def add(self, item: CheckItem) -> None:
        self.items.append(item)
        k = f"summary_{item.status}"
        if hasattr(self, k):
            setattr(self, k, getattr(self, k) + 1)

    def print_report(self) -> None:
        print("=" * 72, flush=True)
        print("AUDIT INTEGRAZIONE v5 (MRM+PCG) vs v4", flush=True)
        print("=" * 72, flush=True)
        print(
            f"PRED_ENGINE={pred_engine()}  "
            f"PRED_V5_FUND_RISK={pred_v5_fund_risk_enabled()}  "
            f"PRED_V5_COHORT_PRIOR={pred_v5_cohort_prior_enabled()}  "
            f"PRED_V5_ANCHOR_Q50_V4={pred_v5_anchor_q50_v4_enabled()}  "
            f"PRED_V5_ALIGN_SIGN_V4={pred_v5_align_sign_v4_enabled()}  "
            f"PRED_V5_CALIB={pred_v5_calib_enabled()}  "
            f"PRED_V5_SIM_DISPLAY={pred_v5_sim_display_mode()}  "
            f"PRED_V5_EXCEL_FAN={pred_v5_excel_fan_enabled()}  "
            f"PRED_V5_GRAFICI_FAN={pred_v5_grafici_fan_enabled()}",
            flush=True,
        )
        print(f"Orizzonti v5 q50: {SIMULATION_V5_Q50_OFFSETS}", flush=True)
        _v4_offs = tuple(ACCURACY_V4_DISPLAY_OFFSETS)
        if set(SIMULATION_V5_Q50_OFFSETS) == set(_v4_offs):
            print(
                f"Griglia Accuratezza: v4 e v5 allineati su {_v4_offs} (8 orizzonti, incl. T-5).",
                flush=True,
            )
        else:
            print(
                f"Griglia v4 {_v4_offs} vs v5 {SIMULATION_V5_Q50_OFFSETS} "
                "(MAE temporale non simmetrico finche divergono).",
                flush=True,
            )
        print("-" * 72, flush=True)
        for it in self.items:
            tag = it.status.upper().ljust(7)
            print(f"[{tag}] {it.title_it}", flush=True)
            print(f"        {it.detail_it}", flush=True)
        print("-" * 72, flush=True)
        print(
            f"Riepilogo: {self.summary_ok} ok, {self.summary_partial} parziale, "
            f"{self.summary_missing} mancante, {self.summary_bug} bug",
            flush=True,
        )
        if self.summary_missing > 0:
            print(
                "Nota: [MISSING] su funzioni v4 e atteso — v5 non le sostituisce; "
                "usa v4 per Simulation e v5 q50 (ancorato) per confronto Accuracy.",
                flush=True,
            )
        print("=" * 72, flush=True)


def _beta_liquidity_wired_in_pipeline() -> bool:
    """Verifica che predict_v5_fan_offsets passi beta/liq a predict_v5_curve."""
    import inspect

    src = inspect.getsource(predict_v5_fan_offsets)
    return "liquidity_score=_liq" in src or (
        "liquidity_score=" in src and "predict_v5_curve(" in src
    )


def run_v5_integration_audit() -> V5IntegrationReport:
    r = V5IntegrationReport()
    cfg = get_config()

    # ── Motore principale ──
    if pred_engine() == "v4":
        r.add(
            CheckItem(
                "pred_engine",
                "partial",
                "Motore foglio Simulation = v4",
                "PRED_ENGINE=v4 (default): direzione, curva d% Pred e calibrazione "
                "restano sull'orchestratore. v5 serve solo colonne Pred v5 q50 su Accuracy.",
            )
        )
    else:
        r.add(
            CheckItem(
                "pred_engine",
                "partial",
                "PRED_ENGINE=v5",
                "Aggiunge v5_curves in JSON ma NON sostituisce le predizioni v4 in Simulation.",
            )
        )

    # ── Pipeline v4 features ──
    v4_features = [
        ("direction_ensemble", "Ensemble direzione + penalita liq/beta", "ok"),
        ("clinical_overlay", "Overlay testo clinico / polarity", "ok"),
        ("poly_extrap", "Estrapolazione polinomiale precatalyst (model_dm*)", "ok"),
        ("calibration", "pred_calibration.json / shrink empirico", "ok"),
        ("fundamental_shrink", "Riduzione curva v4 da FY liq + beta", "ok"),
        ("seq_curve", "seq_curve_pct_vs_m60 (display Simulation)", "ok"),
        ("posthoc_struct", "Blend strutturale / cap extrap", "ok"),
    ]
    for _id, title, _st in v4_features:
        r.add(
            CheckItem(
                f"v4_{_id}",
                "missing",
                f"v4: {title}",
                "Non replicato in v5 MRM+PCG (solo regole trend/mean_revert/high_vol + MC).",
            )
        )

    # ── v5 implementato ──
    r.add(
        CheckItem(
            "v5_mrm_pcg",
            "ok",
            "Core v5: MRM + Monte Carlo (PCG)",
            "classify_regime / drift_sigma_from_prices + fan q05/q50/q95 su NODE_OFFSETS.",
        )
    )
    r.add(
        CheckItem(
            "v5_accuracy_columns",
            "ok",
            "Colonne Excel Pred v5 q50",
            "Calcolate in _compute_price_predictions (sempre, anche con PRED_ENGINE=v4).",
        )
    )

    if pred_v5_anchor_q50_v4_enabled():
        r.add(
            CheckItem(
                "v5_sign_align",
                "ok",
                "Segno q50 (fallback se anchor off)",
                "Con PRED_V5_ANCHOR_Q50_V4=1 il q50 e gia v4; align_sign serve solo se anchor=0.",
            )
        )
    elif pred_v5_align_sign_v4_enabled():
        r.add(
            CheckItem(
                "v5_sign_align",
                "partial",
                "Allineamento segno q50 verso v4",
                "Solo flip di segno se |q50|>0.5 pp; magnitudine resta MC. "
                "Richiede model_dm* / direction sulla riga.",
            )
        )
    else:
        r.add(
            CheckItem(
                "v5_sign_align",
                "missing",
                "PRED_V5_ALIGN_SIGN_V4 disattivo",
                "v5 puo avere segno opposto a v4 -> Hit% peggiora.",
            )
        )

    if pred_v5_fund_risk_enabled():
        if _beta_liquidity_wired_in_pipeline():
            r.add(
                CheckItem(
                    "v5_fund_sigma",
                    "ok",
                    "Sigma v5 da beta / liquidità FY",
                    "apply_fundamental_sigma_adjustments passato a predict_v5_curve.",
                )
            )
        else:
            r.add(
                CheckItem(
                    "v5_fund_sigma",
                    "bug",
                    "PRED_V5_FUND_RISK attivo ma beta/liq non usati",
                    "beta e liquidity_score non venivano passati a predict_v5_curve "
                    "(solo metadata post-hoc) — correzione in pipeline.",
                )
            )
    else:
        r.add(
            CheckItem(
                "v5_fund_sigma",
                "missing",
                "PRED_V5_FUND_RISK=0",
                "Fan v5 senza allargamento σ da fondamentali.",
            )
        )

    if pred_v5_cohort_prior_enabled():
        r.add(
            CheckItem(
                "v5_clinical_cohort",
                "ok",
                "Prior coorte NCT (past_catalyst JSON)",
                "build_nct_cohort_mu + filter_past_pred_by_restricted_nct in predict_v5_q50_offsets.",
            )
        )
    else:
        r.add(
            CheckItem(
                "v5_clinical_cohort",
                "missing",
                "PRED_V5_COHORT_PRIOR=0",
                "Prior PCG disattivato.",
            )
        )
    if pred_v5_anchor_q50_v4_enabled():
        r.add(
            CheckItem(
                "v5_anchor_q50_v4",
                "ok",
                "q50 v5 ancorato a v4 (banda MC)",
                "anchor_v5_distribution_q50_to_v4: q50=v4, q05/q95 = semi-larghezza Monte Carlo.",
            )
        )
    else:
        r.add(
            CheckItem(
                "v5_anchor_q50_v4",
                "missing",
                "PRED_V5_ANCHOR_Q50_V4=0",
                "q50 v5 resta mediana MC grezza (confronto MAE sfavorevole vs v4).",
            )
        )
    if pred_v5_calib_enabled():
        from prediction.v5.calibration import V5_CALIB_PATH, load_v5_calibration

        _cal = load_v5_calibration()
        if _cal and _cal.get("sigma_scale") is not None:
            r.add(
                CheckItem(
                    "v5_calibration",
                    "ok",
                    "Calibrazione retroattiva v5",
                    f"pred_v5_calibration.json sigma_scale={_cal.get('sigma_scale')} "
                    f"(n_samples={_cal.get('n_ratio_samples')}).",
                )
            )
        else:
            r.add(
                CheckItem(
                    "v5_calibration",
                    "partial",
                    "Calibrazione retroattiva v5",
                    f"PRED_V5_CALIB=1 ma file assente ({V5_CALIB_PATH.name}); "
                    "verra creato al prossimo _compute_price_predictions.",
                )
            )
    else:
        r.add(
            CheckItem(
                "v5_calibration",
                "missing",
                "Calibrazione retroattiva v5",
                "PRED_V5_CALIB=0: fan MC non scalata su MAE storico.",
            )
        )
    _sim_disp = pred_v5_sim_display_mode()
    if _sim_disp == "v4":
        r.add(
            CheckItem(
                "v5_sim_display",
                "partial",
                "Simulation d% Pred = v4",
                "PRED_V5_SIM_DISPLAY=v4 (default). Imposta v5 o blend per curva Simulation da fan.",
            )
        )
    else:
        r.add(
            CheckItem(
                "v5_sim_display",
                "ok",
                f"Simulation d% Pred = {_sim_disp}",
                "Curva foglio Simulation da q50 v5 (o blend 50/50 con v4).",
            )
        )
    r.add(
        CheckItem(
            "v5_excel_fan",
            "ok",
            "Accuracy: solo Pred v5 q50 (8 colonne)",
            "q05/q95 non esportati su Excel; fan completo in JSON (v5_fan_offsets) e opz. Grafici.",
        )
    )
    if set(SIMULATION_V5_Q50_OFFSETS) == set(ACCURACY_V4_DISPLAY_OFFSETS):
        r.add(
            CheckItem(
                "v5_horizon_grid",
                "ok",
                "Griglia Accuratezza temporale",
                f"v4 Storico/Err e v5 q50 sugli stessi 8 offset {ACCURACY_V4_DISPLAY_OFFSETS}.",
            )
        )
    else:
        r.add(
            CheckItem(
                "v5_horizon_grid",
                "partial",
                "Griglia Accuratezza temporale",
                f"v4 {ACCURACY_V4_DISPLAY_OFFSETS} vs v5 {SIMULATION_V5_Q50_OFFSETS}.",
            )
        )

    if getattr(cfg, "pred_fundamental_shrink", True):
        if pred_v5_anchor_q50_v4_enabled():
            r.add(
                CheckItem(
                    "v4_shrink_vs_v5",
                    "ok",
                    "MAE q50 v5 vs v4 (dopo refresh Accuracy)",
                    "sync_v5_q50_to_accuracy_display_pred: q50 v5 = colonna Pred % (non solo model_dm*). "
                    "Serve un nuovo run che riscrive accuracy_v4_v5_summary.json — "
                    "refresh_accuratezza_nel_tempo.py da solo non ricalcola i numeri.",
                )
            )
        else:
            r.add(
                CheckItem(
                    "v4_shrink_vs_v5",
                    "partial",
                    "v4 curva stretta dopo shrink",
                    "Senza PRED_V5_ANCHOR_Q50_V4 il q50 MC resta piu largo di v4 -> MAE piu alta.",
                )
            )

    return r


def main() -> None:
    run_v5_integration_audit().print_report()


if __name__ == "__main__":
    main()
