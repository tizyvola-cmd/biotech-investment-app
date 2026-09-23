#!/usr/bin/env python3
"""Gate 1B — benchmark read-only degli endpoint backend Catalyst / Learning Lab.

Misura tempi HTTP + dimensioni risposta per decidere se attaccare leva #1 (cache).

Uso::

    .venv\\Scripts\\python.exe scripts\\phase1b_api_gate.py
    .venv\\Scripts\\python.exe scripts\\phase1b_api_gate.py --base http://127.0.0.1:8765
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from orchestrator_io_paths import DATA_DIR

# Soglie Gate 1B (ms) — oltre queste → candidato leva #1
_THRESH_MS = {
    "warn": 2_000,
    "hot": 5_000,
}

_GATE1B_ENDPOINTS: tuple[tuple[str, str], ...] = (
    ("GET", "/api/health"),
    ("GET", "/api/clinical-pre-cd/snapshot"),
    ("GET", "/api/clinical-pre-cd/status"),
    ("GET", "/api/clinical-pre-cd/feed-refresh-report"),
    ("GET", "/api/models/learning-lab/overview"),
    ("GET", "/api/models/learning-lab/overview?force=1"),
    ("GET", "/api/learning/pipeline-overview"),
    ("GET", "/api/models/eis-cohort-comparison"),
    ("GET", "/api/sds/cohort"),
    ("GET", "/api/charts/simulation"),
)


def _fmt_bytes(n: int) -> str:
    if n >= 1_048_576:
        return f"{n / 1_048_576:.2f} MB"
    if n >= 1024:
        return f"{n / 1024:.1f} KB"
    return f"{n} B"


def _local_snapshot_sizes() -> list[tuple[str, int]]:
    names = (
        "clinical_pre_cd_enrichment_snapshot.json",
        "cd_pattern_polygon_accuracy.json",
        "signal_calibration.json",
        "sds_snapshot.json",
        "simulation_charts_snapshot.json",
    )
    rows: list[tuple[str, int]] = []
    root = Path(DATA_DIR)
    for name in names:
        p = root / name
        if p.is_file():
            rows.append((name, p.stat().st_size))
    rows.sort(key=lambda x: x[1], reverse=True)
    return rows


def _fetch(base: str, method: str, path: str, timeout: float) -> dict[str, object]:
    url = f"{base.rstrip('/')}{path}"
    req = urllib.request.Request(url, method=method)
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read()
            elapsed_ms = (time.perf_counter() - t0) * 1000.0
            return {
                "ok": True,
                "status": resp.status,
                "ms": elapsed_ms,
                "bytes": len(body),
                "server_ms": resp.headers.get("X-Response-Time-Ms"),
            }
    except urllib.error.HTTPError as exc:
        body = exc.read()
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        return {
            "ok": False,
            "status": exc.code,
            "ms": elapsed_ms,
            "bytes": len(body),
            "error": body[:200].decode("utf-8", errors="replace"),
        }
    except Exception as exc:
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        return {"ok": False, "status": 0, "ms": elapsed_ms, "bytes": 0, "error": str(exc)}


def main() -> int:
    parser = argparse.ArgumentParser(description="Gate 1B API benchmark (read-only)")
    parser.add_argument("--base", default="http://127.0.0.1:8765", help="API base URL")
    parser.add_argument("--timeout", type=float, default=120.0, help="Per-request timeout sec")
    parser.add_argument("--json", action="store_true", help="Machine-readable output")
    args = parser.parse_args()

    health = _fetch(args.base, "GET", "/api/health", timeout=5.0)
    if not health.get("ok"):
        print(f"API non raggiungibile su {args.base}: {health.get('error', health)}")
        print("Avvia: .venv\\Scripts\\python.exe -m supernova_api")
        return 1

    results: list[dict[str, object]] = []
    for method, path in _GATE1B_ENDPOINTS:
        if path == "/api/health":
            results.append({"method": method, "path": path, **health})
            continue
        row = _fetch(args.base, method, path, timeout=args.timeout)
        results.append({"method": method, "path": path, **row})

    hot = [
        r
        for r in results
        if float(r.get("ms", 0)) >= _THRESH_MS["warn"] or int(r.get("bytes", 0)) >= 5_000_000
    ]

    if args.json:
        print(
            json.dumps(
                {
                    "base": args.base,
                    "thresholds_ms": _THRESH_MS,
                    "local_snapshots": [
                        {"file": n, "bytes": b, "size": _fmt_bytes(b)}
                        for n, b in _local_snapshot_sizes()
                    ],
                    "results": results,
                    "hot": [r["path"] for r in hot],
                },
                indent=2,
            )
        )
        return 0

    print("=" * 78)
    print("GATE 1B — BACKEND COMPUTE / TRANSFER (read-only)")
    print(f"API: {args.base}")
    print("=" * 78)
    print(f"{'MS':>10}  {'SIZE':>12}  {'ST':>4}  PATH")
    print("-" * 78)
    for r in results:
        ms = float(r.get("ms", 0))
        flag = "!!" if ms >= _THRESH_MS["hot"] else ("!" if ms >= _THRESH_MS["warn"] else " ")
        size = _fmt_bytes(int(r.get("bytes", 0)))
        st = r.get("status", "?")
        path = r.get("path", "")
        srv = r.get("server_ms")
        srv_s = f" (srv {srv})" if srv else ""
        print(f"{ms:>9.1f}  {size:>12}  {st!s:>4}  {flag}{path}{srv_s}")
        if not r.get("ok") and r.get("error"):
            print(f"             error: {r['error']}")
    print("-" * 78)
    print("Legenda: ! >= 2s warn   !! >= 5s hot")
    print()
    print("Snapshot locali (data/):")
    for name, nbytes in _local_snapshot_sizes():
        print(f"  {_fmt_bytes(nbytes):>12}  {name}")
    print()
    if hot:
        print("CANDIDATI leva #1 (cache / snapshot-first):")
        for r in hot:
            print(f"  - {r['path']} ({float(r['ms']):.0f} ms, {_fmt_bytes(int(r['bytes']))})")
    else:
        print("Nessun endpoint oltre soglia warn — backend Gate 1B OK.")
        print("Se l'UI lagga ancora, passa a Gate 2B (rendering Financial/Simulation).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
