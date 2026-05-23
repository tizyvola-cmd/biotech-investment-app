"""
API HTTP locale per SuperNova Electron (e UI web).

Avvio (bind localhost di default)::

    .venv\\Scripts\\python.exe -m supernova_api

Oppure::

    .venv\\Scripts\\python.exe -m uvicorn supernova_api:app --host 127.0.0.1 --port 8765

Sicurezza (variabili d'ambiente)
================================

+-----------------------------+----------+-----------------------------------------------+
| Variabile                   | Default  | Effetto                                       |
+=============================+==========+===============================================+
| SUPERNOVA_CORS_PERMISSIVE   | (off)    | ``1`` → CORS ``allow_origins=["*"]`` (WARNING)|
| SUPERNOVA_BIND_ALL          | (off)    | ``1`` → uvicorn su ``0.0.0.0`` (WARNING)      |
| SUPERNOVA_API_TOKEN         | (unset)  | Se impostato, richiede header                 |
|                             |          | ``X-SuperNova-Token`` su POST/PUT/PATCH/DELETE|
| SUPERNOVA_PORT              | 8765     | Porta per ``python -m supernova_api``         |
+-----------------------------+----------+-----------------------------------------------+

CORS di default: ``http://127.0.0.1:*``, ``http://localhost:*`` (regex) e ``Origin: null``
(Electron ``file://``). Non include origini web arbitrarie.
Senza token configurato viene loggato un avviso una tantum; le richieste mutanti restano
aperte (comodo in sviluppo). Impostare ``SUPERNOVA_API_TOKEN`` in produzione locale se
l'API può essere raggiunta da altri processi sulla macchina.
"""
from __future__ import annotations

import json
import logging
import os
import subprocess
import threading
from datetime import date, datetime
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

import orchestrator_io_paths as _paths
from orchestrator_io_paths import (
    DATA_DIR,
    FINAL_XLSX,
    LAST_ORCH_LOG,
    ORCHESTRATOR_SCRIPT,
    PYTHON_VENV_EXE,
)
from supernova_config import (
    LOCALHOST_ORIGIN_REGEX,
    TOKEN_HEADER,
    SupernovaConfig,
    get_supernova_config,
)

logger = logging.getLogger("supernova.api")

ROOT = Path(_paths.project_root())
PYTHON = Path(PYTHON_VENV_EXE)
ORCHESTRATOR = Path(ORCHESTRATOR_SCRIPT)

_MUTATING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
_startup_logged = False

_run_lock = threading.Lock()
_proc: subprocess.Popen | None = None
_refresh_proc: subprocess.Popen | None = None

REFRESH_FAST_SCRIPT = ROOT / "launch_refresh_fast.py"
LAST_REFRESH_LOG = Path(DATA_DIR) / "last_refresh_fast_log.txt"


def _background_job_running() -> bool:
    return bool(
        (_proc is not None and _proc.poll() is None)
        or (_refresh_proc is not None and _refresh_proc.poll() is None)
    )


def _apply_daily_refresh_env(env: dict[str, str]) -> dict[str, str]:
    """Env profilo giornaliero (Simulation + Accuracy, storico incrementale)."""
    out = dict(env)
    for key, val in (
        ("HISTLIB_INCREMENTAL_ONLY", "1"),
        ("HISTLIB_MIN_LAG_DAYS", "3"),
        ("HISTLIB_REFRESH_ON_ENRICH", "1"),
        ("PRED_CURVE_SEQ_CALIB", "1"),
        ("SEC_K8_LOOKBACK_DAYS", "180"),
        ("PRED_K8_DISPLAY_OVERLAY", "1"),
        ("REFRESH_K8_LIVE_FALLBACK", "1"),
        ("ACCURACY_REFRESH_FAST", "0"),
        ("ACC_SIM_BULK_PAST_WRITE", "0"),
        ("SIM_PRESERVE_OUTCOMES", "1"),
        ("YF_CACHE_STICKY", "1"),
        ("ORCH_SKIP_LIQUIDITY_YF", "1"),
    ):
        out.setdefault(key, val)
    return out


def _read_refresh_fast_status_file() -> dict[str, str]:
    from refresh_fast_status import REFRESH_FAST_STATUS_PATH

    p = Path(REFRESH_FAST_STATUS_PATH)
    if not p.is_file():
        return {}
    out: dict[str, str] = {}
    try:
        for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
            if "=" not in line:
                continue
            k, _, v = line.partition("=")
            out[k.strip()] = v.strip()
    except OSError:
        return {}
    return out


def _sheet_json_safe(fn: Any) -> dict[str, Any]:
    """Esegue lettura foglio Excel; errori I/O → HTTP 503/409 invece di 500."""
    from excel_sheet_reader import WorkbookReadError

    try:
        return _json_safe(fn())
    except WorkbookReadError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.as_detail()) from exc


def _json_safe(obj: Any) -> Any:
    if isinstance(obj, (date, datetime)):
        return obj.isoformat()
    if isinstance(obj, dict):
        return {k: _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_json_safe(v) for v in obj]
    return obj


def _log_startup_security(cfg: SupernovaConfig) -> None:
    global _startup_logged
    if _startup_logged:
        return
    _startup_logged = True
    if cfg.cors_permissive:
        logger.warning(
            "SUPERNOVA_CORS_PERMISSIVE=1: CORS allow_origins=['*'] — "
            "non usare su reti non fidate."
        )
    if cfg.bind_all:
        logger.warning(
            "SUPERNOVA_BIND_ALL=1: API in ascolto su 0.0.0.0 — "
            "esposta sulla rete locale."
        )
    if cfg.api_token:
        logger.info("SUPERNOVA_API_TOKEN configurato: richiesto su route mutanti.")
    else:
        logger.warning(
            "SUPERNOVA_API_TOKEN non configurato: route mutanti senza autenticazione."
        )


class _LocalTokenMiddleware:
    """Require X-SuperNova-Token on mutating requests when SUPERNOVA_API_TOKEN is set."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        method = scope.get("method", "GET")
        if method in _MUTATING_METHODS:
            cfg = get_supernova_config()
            if cfg.api_token:
                token: str | None = None
                for key, value in scope.get("headers", ()):
                    if key.lower() == TOKEN_HEADER.lower().encode():
                        token = value.decode("latin-1")
                        break
                if token != cfg.api_token:
                    response = JSONResponse(
                        {"detail": "Missing or invalid API token"},
                        status_code=401,
                    )
                    await response(scope, receive, send)
                    return
        await self.app(scope, receive, send)


def _configure_cors(app: FastAPI, cfg: SupernovaConfig) -> None:
    if cfg.cors_permissive:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_methods=["*"],
            allow_headers=["*"],
        )
    else:
        # "null" = renderer Electron (file://) verso API su 127.0.0.1
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["null"],
            allow_origin_regex=LOCALHOST_ORIGIN_REGEX,
            allow_methods=["*"],
            allow_headers=["*"],
        )


def build_app(cfg: SupernovaConfig | None = None) -> FastAPI:
    """Create FastAPI app (used by tests and ``app`` module export)."""
    from contextlib import asynccontextmanager

    c = cfg or get_supernova_config()

    @asynccontextmanager
    async def _lifespan(_app: FastAPI):
        _log_startup_security(c)
        yield

    application = FastAPI(title="SuperNova API", version="0.1.0", lifespan=_lifespan)

    _configure_cors(application, c)
    application.add_middleware(_LocalTokenMiddleware)

    @application.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "root": str(ROOT)}

    @application.get("/api/status")
    def status() -> dict[str, Any]:
        xlsx = Path(FINAL_XLSX)
        return {
            "workbook": xlsx.name if xlsx.is_file() else None,
            "workbook_path": str(xlsx) if xlsx.is_file() else None,
            "workbook_mtime": (
                datetime.fromtimestamp(xlsx.stat().st_mtime).isoformat()
                if xlsx.is_file()
                else None
            ),
            "orchestrator_running": _proc is not None and _proc.poll() is None,
            "refresh_running": _refresh_proc is not None and _refresh_proc.poll() is None,
            "refresh_status": _read_refresh_fast_status_file(),
        }

    @application.post("/api/orchestrator/run")
    def run_orchestrator(profile: str = Query("quick")) -> dict[str, str]:
        global _proc
        if not PYTHON.is_file():
            return {"error": f"Python non trovato: {PYTHON}"}
        if not ORCHESTRATOR.is_file():
            return {"error": f"Orchestrator non trovato: {ORCHESTRATOR}"}
        with _run_lock:
            if _background_job_running():
                return {"error": "Un job è già in corso (orchestrator o refresh)"}
            cmd = [str(PYTHON), "-u", str(ORCHESTRATOR)]
            if profile == "quick":
                cmd.append("--quick")
            elif profile == "skip_fetch":
                os.environ["ORCH_SKIP_FETCH"] = "1"
            env = os.environ.copy()
            env["PYTHONUNBUFFERED"] = "1"
            Path(DATA_DIR).mkdir(parents=True, exist_ok=True)
            _proc = subprocess.Popen(
                cmd,
                cwd=str(ROOT),
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        return {"started": "true", "profile": profile}

    @application.post("/api/refresh/run")
    def run_refresh_fast(profile: str = Query("daily")) -> dict[str, str]:
        """
        Refresh giornaliero: ``launch_refresh_fast.py`` (Simulation + Accuracy).

        ``profile``: ``daily`` (default) | ``accuracy_only`` | ``dry_run``
        """
        global _refresh_proc
        if not PYTHON.is_file():
            return {"error": f"Python non trovato: {PYTHON}"}
        if not REFRESH_FAST_SCRIPT.is_file():
            return {"error": f"Script non trovato: {REFRESH_FAST_SCRIPT}"}
        prof = (profile or "daily").strip().lower()
        cmd = [str(PYTHON), "-u", str(REFRESH_FAST_SCRIPT)]
        if prof == "accuracy_only":
            cmd.append("--skip-simulation")
        elif prof == "dry_run":
            cmd.append("--dry-run")
        elif prof not in ("daily", ""):
            return {"error": f"Profilo refresh sconosciuto: {profile}"}

        with _run_lock:
            if _background_job_running():
                return {"error": "Un job è già in corso (orchestrator o refresh)"}
            Path(DATA_DIR).mkdir(parents=True, exist_ok=True)
            log_fh = open(LAST_REFRESH_LOG, "w", encoding="utf-8")
            env = _apply_daily_refresh_env(os.environ.copy())
            env["PYTHONUNBUFFERED"] = "1"
            _refresh_proc = subprocess.Popen(
                cmd,
                cwd=str(ROOT),
                env=env,
                stdout=log_fh,
                stderr=subprocess.STDOUT,
            )
        return {
            "started": "true",
            "profile": prof or "daily",
            "hint": "Chiudi Excel sul workbook prima del run; preserva Prezzo acquisto/Capitale.",
        }

    @application.get("/api/refresh/status")
    def refresh_status() -> dict[str, Any]:
        st = _read_refresh_fast_status_file()
        running = _refresh_proc is not None and _refresh_proc.poll() is None
        return {"running": running, **st}

    @application.get("/api/refresh/log")
    def refresh_log(tail: int = Query(4000, ge=0, le=200_000)) -> dict[str, str]:
        p = LAST_REFRESH_LOG
        if not p.is_file():
            return {"log": ""}
        text = p.read_text(encoding="utf-8", errors="replace")
        if tail and len(text) > tail:
            text = text[-tail:]
        return {"log": text}

    @application.get("/api/orchestrator/log")
    def orchestrator_log(tail: int = Query(4000, ge=0, le=200_000)) -> dict[str, str]:
        p = Path(LAST_ORCH_LOG)
        if not p.is_file():
            return {"log": ""}
        text = p.read_text(encoding="utf-8", errors="replace")
        if tail and len(text) > tail:
            text = text[-tail:]
        return {"log": text}

    @application.get("/api/charts/simulation")
    def charts_simulation() -> dict[str, Any]:
        from dpg_lab_data import build_simulation_lab_bundle

        return _json_safe(build_simulation_lab_bundle())

    @application.get("/api/charts/ristretta")
    def charts_ristretta() -> dict[str, Any]:
        from dpg_lab_data import build_ristretta_dpg_bundle

        return _json_safe(build_ristretta_dpg_bundle())

    @application.get("/api/sheets")
    def sheets_list() -> dict[str, Any]:
        from excel_sheet_reader import list_workbook_sheets

        return _sheet_json_safe(list_workbook_sheets)

    @application.get("/api/sheets/simulation")
    def sheet_simulation() -> dict[str, Any]:
        from excel_sheet_reader import read_simulation_table

        return _sheet_json_safe(read_simulation_table)

    @application.get("/api/sheets/accuracy")
    def sheet_accuracy() -> dict[str, Any]:
        from excel_sheet_reader import read_accuracy_table

        return _sheet_json_safe(read_accuracy_table)

    @application.get("/api/sheets/accuracy/v4-v5-summary")
    def sheet_accuracy_v4_v5_summary() -> dict[str, Any]:
        from excel_sheet_reader import read_accuracy_v4_v5_summary

        return _json_safe(read_accuracy_v4_v5_summary())

    @application.get("/api/sheets/financial")
    def sheet_financial() -> dict[str, Any]:
        from excel_sheet_reader import read_financial_table

        return _sheet_json_safe(read_financial_table)

    @application.get("/api/sheets/{sheet_name}")
    def sheet_by_name(sheet_name: str) -> dict[str, Any]:
        from excel_sheet_reader import read_sheet_table

        return _sheet_json_safe(lambda: read_sheet_table(sheet_name))

    return application


app = build_app()


def main() -> None:
    """Run uvicorn with host/port from SUPERNOVA_* env."""
    import uvicorn

    logging.basicConfig(level=logging.INFO)
    cfg = get_supernova_config()
    _log_startup_security(cfg)
    uvicorn.run(
        "supernova_api:app",
        host=cfg.uvicorn_host,
        port=cfg.uvicorn_port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
