#!/usr/bin/env python3
"""
mobile_dashboard_snapshot_refresh.py — Build mobile dashboard snapshot server-side.

Uses the same TypeScript builder as desktop MainDashboardView, reading JSON
snapshots from ``data/`` (simulation sheet, charts, invest_sim_inputs, SDS, clinical feed).

Called automatically after ``export_desktop_snapshots`` (refresh fast / orchestrator).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from orchestrator_io_paths import DATA_DIR, MOBILE_DASHBOARD_SNAPSHOT_JSON


def _resolve_npx() -> str:
    desktop_ui = _ROOT / "desktop-ui"
    local = desktop_ui / "node_modules" / ".bin" / ("npx.cmd" if os.name == "nt" else "npx")
    if local.is_file():
        return str(local)
    found = shutil.which("npx")
    return found or "npx"


def refresh_mobile_dashboard_snapshot(
    *,
    data_dir: str | Path | None = None,
    out_path: str | Path | None = None,
    lang: str = "it",
    quiet: bool = False,
    timeout_sec: int = 180,
) -> dict[str, Any]:
    """Run TS builder and return summary metadata."""
    data = Path(data_dir or DATA_DIR)
    out = Path(out_path or MOBILE_DASHBOARD_SNAPSHOT_JSON)
    desktop_ui = _ROOT / "desktop-ui"
    script = desktop_ui / "scripts" / "build-mobile-dashboard-snapshot.ts"
    if not script.is_file():
        raise FileNotFoundError(f"Missing {script}")
    if not (data / "simulation_sheet_snapshot.json").is_file():
        return {"ok": False, "error": "simulation_sheet_snapshot.json missing", "path": str(out)}

    cmd = [
        _resolve_npx(),
        "tsx",
        str(script),
        "--data-dir",
        str(data),
        "--out",
        str(out),
        "--lang",
        lang if lang in ("it", "en") else "it",
    ]
    if not quiet:
        print(f"[MobileSnapshot] Building -> {out}", flush=True)

    proc = subprocess.run(
        cmd,
        cwd=str(desktop_ui),
        capture_output=True,
        text=True,
        timeout=timeout_sec,
    )
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip() or f"exit {proc.returncode}"
        if not quiet:
            print(f"[MobileSnapshot] ERRORE: {err}", flush=True)
        return {"ok": False, "error": err[:500], "path": str(out)}

    if not quiet and proc.stdout.strip():
        print(proc.stdout.strip(), flush=True)

    # Split heavy curve charts out of the poll file (scale: ~1.7MB saved on every GET).
    split_info: dict[str, Any] = {}
    try:
        import mobile_snapshot_io as msi

        if out.resolve() == Path(MOBILE_DASHBOARD_SNAPSHOT_JSON).resolve():
            split_info = msi.ensure_split_on_disk()
        else:
            raw = json.loads(out.read_text(encoding="utf-8"))
            if isinstance(raw, dict) and isinstance(raw.get("curveChartsByKey"), dict):
                slim, charts = msi.split_snapshot(raw)
                out.write_text(
                    json.dumps(slim, ensure_ascii=False, separators=(",", ":")),
                    encoding="utf-8",
                )
                charts_path = out.with_name("mobile_curve_charts.json")
                charts_path.write_text(
                    json.dumps(charts, ensure_ascii=False, separators=(",", ":")),
                    encoding="utf-8",
                )
                split_info = {
                    "ok": True,
                    "split": True,
                    "snapshot_bytes": out.stat().st_size,
                    "charts_bytes": charts_path.stat().st_size,
                }
    except Exception as exc:
        split_info = {"ok": False, "error": str(exc)[:200]}

    summary: dict[str, Any] = {"ok": True, "path": str(out), "split": split_info}
    if out.is_file():
        try:
            doc = json.loads(out.read_text(encoding="utf-8"))
            summary["updated_at"] = doc.get("updated_at")
            summary["bytes"] = out.stat().st_size
            hero = doc.get("hero") if isinstance(doc.get("hero"), dict) else {}
            summary["recommendation_count"] = len(doc.get("recommendations") or [])
            summary["portfolio_count"] = hero.get("portfolioCount")
            summary["opportunity_count"] = hero.get("opportunityCount")
        except (OSError, json.JSONDecodeError):
            pass
    return summary


def main() -> int:
    ap = argparse.ArgumentParser(description="Build mobile dashboard snapshot JSON")
    ap.add_argument("--data-dir", default=DATA_DIR)
    ap.add_argument("--out", default=MOBILE_DASHBOARD_SNAPSHOT_JSON)
    ap.add_argument("--lang", default="it", choices=("it", "en"))
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    result = refresh_mobile_dashboard_snapshot(
        data_dir=args.data_dir,
        out_path=args.out,
        lang=args.lang,
        quiet=args.quiet,
    )
    if not result.get("ok"):
        return 1
    if not args.quiet:
        print(
            f"[MobileSnapshot] Done - {result.get('recommendation_count', '?')} recs "
            f"({result.get('portfolio_count', '?')} port / {result.get('opportunity_count', '?')} opp) "
            f"-> {result['path']}",
            flush=True,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
