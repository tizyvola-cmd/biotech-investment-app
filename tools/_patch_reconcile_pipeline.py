"""One-off: wire reconcile into prediction/pipeline.py."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
p = ROOT / "prediction" / "pipeline.py"
text = p.read_text(encoding="utf-8")

old_imp = (
    "from prediction.market_data import close_series_from_raw, options_signals\n"
    "from prediction.seq_calib import"
)
new_imp = (
    "from prediction.market_data import close_series_from_raw, options_signals\n"
    "from prediction.reconcile import reconcile_direction_and_curve\n"
    "from prediction.seq_calib import"
)
if "reconcile_direction_and_curve" not in text:
    if old_imp not in text:
        raise SystemExit("import anchor missing")
    text = text.replace(old_imp, new_imp, 1)

start = (
    "        # ── Allineamento direzione ↔ percentuali ─────────────────────────────\n"
)
end = "        # ↑ bull → lascia le % così come sono (la curva è già positiva)\n\n"
i0 = text.find(start)
i1 = text.find(end)
if i0 < 0 or i1 < 0:
    raise SystemExit(f"align block not found {i0=} {i1=}")
if "_is_bull" in text[i0 : i1 + len(end)]:
    text = text[:i0] + text[i1 + len(end) :]

anchor = (
    '        _mag_note = (\n'
    '            "mag-bucket: " + ",".join(_mag_applied_h)\n'
    "            if _mag_applied_h\n"
    "            else None\n"
    "        )\n"
    "\n"
    "        _aff_days = ("
)
insert = (
    '        _mag_note = (\n'
    '            "mag-bucket: " + ",".join(_mag_applied_h)\n'
    "            if _mag_applied_h\n"
    "            else None\n"
    "        )\n"
    "\n"
    "        # Riconciliazione direzione ↔ curva (dopo post-hoc / mag-bucket, prima del save)\n"
    "        _dir_ens.direction_label = direction_adj\n"
    "        _recon_pcts = {\n"
    '            "model_dm7_pct": model_dm7_pct,\n'
    '            "model_dm5_pct": model_dm5_pct,\n'
    '            "model_dm3_pct": model_dm3_pct,\n'
    '            "model_dm10_pct": model_dm10_pct,\n'
    '            "model_dm30_pct": model_dm30_pct,\n'
    '            "model_dm60_pct": model_dm60_pct,\n'
    '            "d3_pct": d3_pct,\n'
    '            "d5_pct": d5_pct,\n'
    '            "d10_pct": d10_pct,\n'
    '            "d30_pct": d30_pct,\n'
    '            "model_d4_pct": model_d4_pct,\n'
    '            "model_d7_pct": model_d7_pct,\n'
    "        }\n"
    "        _recon_out = reconcile_direction_and_curve(_dir_ens, _recon_pcts)\n"
    "        _dir_ens = _recon_out.direction_result\n"
    "        direction_adj = _dir_ens.direction_label\n"
    "        _direction_confidence = _dir_ens.confidence\n"
    '        model_dm7_pct = _recon_pcts["model_dm7_pct"]\n'
    '        model_dm5_pct = _recon_pcts["model_dm5_pct"]\n'
    '        model_dm3_pct = _recon_pcts["model_dm3_pct"]\n'
    '        model_dm10_pct = _recon_pcts["model_dm10_pct"]\n'
    '        model_dm30_pct = _recon_pcts["model_dm30_pct"]\n'
    '        model_dm60_pct = _recon_pcts["model_dm60_pct"]\n'
    '        d3_pct = _recon_pcts["d3_pct"]\n'
    '        d5_pct = _recon_pcts["d5_pct"]\n'
    '        d10_pct = _recon_pcts["d10_pct"]\n'
    '        d30_pct = _recon_pcts["d30_pct"]\n'
    '        model_d4_pct = _recon_pcts["model_d4_pct"]\n'
    '        model_d7_pct = _recon_pcts["model_d7_pct"]\n'
    "        _direction_curve_aligned = _recon_out.direction_curve_aligned\n"
    "        _direction_curve_mismatch = _recon_out.direction_curve_mismatch\n"
    "        _curve_direction_implied = _recon_out.curve_direction_implied\n"
    "\n"
    "        _aff_days = ("
)
if "reconcile_direction_and_curve(_dir_ens" not in text:
    if anchor not in text:
        raise SystemExit("mag anchor missing")
    text = text.replace(anchor, insert, 1)

row_old = (
    '            "direction_confidence": _direction_confidence,\n'
    '            "livello":        livello,'
)
row_new = (
    '            "direction_confidence": _direction_confidence,\n'
    '            "direction_curve_aligned": _direction_curve_aligned,\n'
    '            "direction_curve_mismatch": _direction_curve_mismatch,\n'
    '            "curve_direction_implied": _curve_direction_implied,\n'
    '            "livello":        livello,'
)
if "direction_curve_aligned" not in text:
    if row_old not in text:
        raise SystemExit("pred_row anchor missing")
    text = text.replace(row_old, row_new, 1)

p.write_text(text, encoding="utf-8")
print("patched", p)
