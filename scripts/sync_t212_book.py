"""Calibrate invest_sim_inputs buy+capital to match Trading 212 EUR P&L display."""
from __future__ import annotations

import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# Latest T212: qty, current USD, P&L EUR
POSITIONS = [
    ("GILD|2026-08-28", 42.0390562, 136.98, -4.40),
    ("HAE|2026-10-01", 62.939251, 90.64, -57.62),
    ("NRIX|2026-08-31", 214.454663, 26.75, -29.92),
    ("SRPT|2026-10-31", 156.88248, 18.42, 5.41),
    ("VRTX|2026-09-17", 10.9638611, 523.12, -25.14),
]

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "data" / "invest_sim_inputs.json"
VPS_API = "http://91.99.15.48:8765/api/investment/sim-inputs"


def fetch_vps_book() -> dict:
    with urllib.request.urlopen(VPS_API, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def apply_t212_calibration(inputs: dict) -> None:
    for key, qty, curr, pnl_eur in POSITIONS:
        buy = curr - (pnl_eur / qty)
        cap = round(qty * buy, 2)
        buy = round(buy, 4)
        if key not in inputs:
            print(f"MISSING {key}")
            continue
        entry = inputs[key]
        old_b, old_c = entry.get("buyPrice"), entry.get("capital")
        entry["buyPrice"] = buy
        entry["capital"] = cap
        calc = round((cap / buy) * curr - cap, 2)
        tk = key.split("|")[0]
        print(
            f"{tk}: buy {old_b} -> {buy} | cap {old_c} -> {cap} | "
            f"sn_pnl={calc} t212={pnl_eur}"
        )


def push_to_vps(payload: dict) -> None:
    """Force-replace VPS book so merge(max capital) cannot revert T212 calibration."""
    body = json.dumps({"replace": True, "inputs": payload["inputs"]}).encode("utf-8")
    req = urllib.request.Request(
        VPS_API,
        data=body,
        method="PUT",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.loads(resp.read().decode("utf-8"))
    print("vps", result.get("updated_at"), result.get("ok"))


def main() -> None:
    # Prefer live VPS book as base (keeps closed rows / other keys intact).
    try:
        raw = fetch_vps_book()
        print("base: VPS API")
    except Exception as exc:
        print("VPS fetch failed, using local file:", exc)
        raw = json.loads(PATH.read_text(encoding="utf-8"))

    inputs = raw.get("inputs") if isinstance(raw, dict) and "inputs" in raw else raw
    if not isinstance(inputs, dict):
        raise SystemExit("invalid book shape")

    apply_t212_calibration(inputs)

    out = {
        "version": raw.get("version", 1) if isinstance(raw, dict) else 1,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "inputs": inputs,
    }
    PATH.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("saved", PATH)
    push_to_vps(out)


if __name__ == "__main__":
    main()
