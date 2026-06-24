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
| SUPERNOVA_SERVE_DESKTOP     | (off)    | ``1`` → UI web da ``desktop-ui/dist`` +       |
|                             |          | ``/project-data/`` da ``data/``               |
| SUPERNOVA_DESKTOP_DIST      | (auto)   | Path build UI (default ``desktop-ui/dist``)   |
| SUPERNOVA_SCHEDULED_REFRESH_| 0        | Legacy: minuti tra live refresh               |
| MINUTES                     |          | (disattivato se hourly financial on)          |
| SUPERNOVA_DAILY_REFRESH_    | -1       | Legacy: ora locale daily fast refresh         |
| HOUR                        |          |                                               |
| SUPERNOVA_SCHEDULE_TIMEZONE | Europe/  | Fuso orario scheduler (CET/CEST)              |
|                             | Rome     |                                               |
| SUPERNOVA_HOURLY_FINANCIAL  | (off)    | ``1`` → Lun–Ven 15:30–22:00 quote + Financial |
| SUPERNOVA_MORNING_REFRESH   | (off)    | ``1`` → Lun–Ven 07:00 CD + IPO                |
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

# Load .env file before anything else reads os.environ
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env", override=False)
except ImportError:
    pass

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

import orchestrator_io_paths as _paths
from orchestrator_io_paths import (
    DATA_DIR,
    DESKTOP_DATA_MANIFEST_JSON,
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
# Mobile tester flows — no admin token (external testers must not need SUPERNOVA_API_TOKEN).
_TOKEN_EXEMPT_PATHS = frozenset({
    "/api/tester-feedback/testers/register",
    "/api/tester-feedback/events",
    "/api/investment/sim-inputs",
})


def _token_exempt_path(path: str) -> bool:
    if path in _TOKEN_EXEMPT_PATHS:
        return True
    # Per-tester portfolio (mobile) — GET/PUT without admin token.
    if path.startswith("/api/tester-feedback/testers/") and path.endswith("/sim-inputs"):
        return True
    return False
_startup_logged = False

_run_lock = threading.Lock()
_proc: subprocess.Popen | None = None
_refresh_proc: subprocess.Popen | None = None
_refresh_profile: str = "daily"
_refresh_exit_code: int | None = None
_cd_scan_proc: subprocess.Popen | None = None
_cd_scan_exit_code: int | None = None

REFRESH_FAST_SCRIPT = ROOT / "launch_refresh_fast.py"
SIMULATION_CD_SCAN_SCRIPT = ROOT / "launch_simulation_cd_scan.py"
LAST_REFRESH_LOG = Path(DATA_DIR) / "last_refresh_fast_log.txt"
LAST_SIMULATION_CD_SCAN_LOG = Path(DATA_DIR) / "last_simulation_cd_scan.log"
INVEST_SIM_INPUTS_PATH = Path(DATA_DIR) / "invest_sim_inputs.json"
INVEST_SIM_HISTORY_PATH = Path(DATA_DIR) / "invest_sim_history.json"
MOBILE_DASHBOARD_SNAPSHOT_PATH = Path(DATA_DIR) / "mobile_dashboard_snapshot.json"


def _background_job_running() -> bool:
    return bool(
        (_proc is not None and _proc.poll() is None)
        or (_refresh_proc is not None and _refresh_proc.poll() is None)
        or (_cd_scan_proc is not None and _cd_scan_proc.poll() is None)
    )


def _refresh_proc_watcher(proc: subprocess.Popen, profile: str) -> None:
    """Attende fine refresh/orchestrator e salva exit code per la UI."""
    global _refresh_proc, _refresh_exit_code
    code = -1
    try:
        code = proc.wait()
    except Exception:
        pass
    with _run_lock:
        if _refresh_proc is proc:
            _refresh_exit_code = code
            _refresh_proc = None
    # Se il child è terminato senza aggiornare refresh_fast_status.txt (kill, crash),
    # allinea il file così polling/UI non restano bloccati su state=running.
    if profile != "sunday":
        try:
            from refresh_fast_status import REFRESH_FAST_STATUS_PATH, write_refresh_fast_status

            st = _read_refresh_fast_status_file()
            if st.get("state") in ("running", "starting", ""):
                write_refresh_fast_status(
                    state="ok" if code == 0 else "error",
                    ok=code == 0,
                    message=(
                        st.get("message")
                        or (
                            "Refresh completato."
                            if code == 0
                            else f"Refresh terminato con exit {code} (stato file ripristinato)."
                        )
                    ),
                    workbook=st.get("workbook") or None,
                    staged_workbook=st.get("staged_workbook") or None,
                    snapshots_exported=(
                        True
                        if st.get("snapshots_exported") == "1"
                        else False
                        if st.get("snapshots_exported") == "0"
                        else None
                    ),
                )
        except Exception:
            pass


def _cd_scan_proc_watcher(proc: subprocess.Popen) -> None:
    """Attende fine scan CD Simulation e salva exit code per la UI."""
    global _cd_scan_proc, _cd_scan_exit_code
    code = -1
    try:
        code = proc.wait()
    except Exception:
        pass
    with _run_lock:
        if _cd_scan_proc is proc:
            _cd_scan_exit_code = code
            _cd_scan_proc = None


def _apply_daily_refresh_env(env: dict[str, str]) -> dict[str, str]:
    """Env profilo giornaliero (Simulation + Accuracy incrementale, target <30 min)."""
    from refresh_desktop_app import daily_refresh_env_patch

    out = dict(env)
    out.update(daily_refresh_env_patch())
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
    except Exception as exc:
        logger.exception("sheet read failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def _json_safe(obj: Any) -> Any:
    if isinstance(obj, (date, datetime)):
        return obj.isoformat()
    if isinstance(obj, dict):
        return {k: _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_json_safe(v) for v in obj]
    return obj


def _coerce_json_dict(body: Any) -> dict[str, Any]:
    """Accept dict or JSON string body (legacy clients missing Content-Type)."""
    if isinstance(body, dict):
        return body
    if isinstance(body, str):
        text = body.strip()
        if not text:
            return {}
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                return parsed
            if isinstance(parsed, str):
                again = json.loads(parsed)
                return again if isinstance(again, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


async def _request_json_dict(request: Request) -> dict[str, Any]:
    try:
        raw = await request.json()
    except Exception:
        return {}
    return _coerce_json_dict(raw)


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
                path = scope.get("path", "")
                if _token_exempt_path(path):
                    await self.app(scope, receive, send)
                    return
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


class _MobileSlashRedirectMiddleware:
    """``/mobile?…`` → ``/mobile/?…`` (StaticFiles mount requires trailing slash)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope.get("path") == "/mobile":
            from fastapi.responses import RedirectResponse

            qs = scope.get("query_string", b"").decode("latin-1")
            target = "/mobile/" + (f"?{qs}" if qs else "")
            response = RedirectResponse(url=target, status_code=307)
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
    elif cfg.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(cfg.cors_origins),
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


def _mount_mobile_web_subpath(application: FastAPI, cfg: SupernovaConfig) -> None:
    """Serve ``mobile-ui/dist`` at ``/mobile/`` alongside desktop web (SERVE_DESKTOP)."""
    if not cfg.serve_desktop or cfg.serve_mobile:
        return
    dist = Path(cfg.mobile_dist) if cfg.mobile_dist else ROOT / "mobile-ui" / "dist"
    index = dist / "index.html"
    if not index.is_file():
        logger.warning(
            "mobile-ui/dist assente — esegui scripts/build_mobile_vps.ps1 e redeploy: %s",
            dist,
        )
        return

    from fastapi.staticfiles import StaticFiles

    application.mount(
        "/mobile",
        _DesktopWebStaticFiles.factory(str(dist)),
        name="supernova-mobile-web",
    )
    logger.info("SuperNova Mobile servita da %s su /mobile/", dist)


def _mount_mobile_short_pwa(application: FastAPI, cfg: SupernovaConfig) -> None:
    """Serve ``mobile-ui/dist`` on ``/`` (v3 host — stesso origin di ``/api``)."""
    if not cfg.serve_mobile or cfg.serve_desktop:
        return
    dist = Path(cfg.mobile_dist) if cfg.mobile_dist else ROOT / "mobile-ui" / "dist"
    index = dist / "index.html"
    if not index.is_file():
        logger.warning(
            "SUPERNOVA_SERVE_MOBILE=1 ma %s assente — esegui scripts/build_mobile_v3.ps1",
            dist,
        )
        return
    from fastapi.staticfiles import StaticFiles

    application.mount(
        "/",
        StaticFiles(directory=str(dist), html=True),
        name="supernova-mobile-short",
    )
    logger.info("SuperNova Short PWA servita da %s (stesso host/porta API)", dist)


def _register_project_data_routes(application: FastAPI) -> None:
    """Serve ``data/*.json`` su ``/project-data/`` (web host, stesso origin UI)."""
    data_root = Path(DATA_DIR).resolve()

    @application.get("/project-data/{rel_path:path}")
    def serve_project_data(rel_path: str) -> FileResponse:
        rel = rel_path.split("?")[0].replace("\\", "/").lstrip("/")
        if not rel or ".." in rel.split("/"):
            raise HTTPException(status_code=400, detail="bad path")
        file_path = (data_root / rel).resolve()
        try:
            file_path.relative_to(data_root)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="bad path") from exc
        if not file_path.is_file():
            raise HTTPException(status_code=404, detail="not found")
        media = (
            "application/json; charset=utf-8"
            if file_path.suffix.lower() == ".json"
            else "application/octet-stream"
        )
        return FileResponse(file_path, media_type=media)


class _DesktopWebStaticFiles:
    """Lazy wrapper — Starlette StaticFiles + cache policy for SPA deploys."""

    @staticmethod
    def factory(directory: str):
        from starlette.staticfiles import StaticFiles

        class DesktopWebStaticFiles(StaticFiles):
            async def get_response(self, path: str, scope):
                response = await super().get_response(path, scope)
                if response.status_code != 200:
                    return response
                rel = (path or "index.html").lstrip("/")
                if rel in ("", "index.html"):
                    response.headers["Cache-Control"] = "no-cache, must-revalidate"
                    response.headers["Pragma"] = "no-cache"
                elif rel.startswith("assets/"):
                    response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
                return response

        return DesktopWebStaticFiles(directory=directory, html=True)


def _mount_desktop_web(application: FastAPI, cfg: SupernovaConfig) -> None:
    """UI desktop + snapshot JSON — Option B (server + browser, no Electron)."""
    if not cfg.serve_desktop:
        return
    if cfg.serve_mobile:
        logger.warning(
            "SUPERNOVA_SERVE_DESKTOP=1 — PWA mobile ignorata (solo una UI sulla root /)"
        )
    _register_project_data_routes(application)
    dist = Path(cfg.desktop_dist) if cfg.desktop_dist else ROOT / "desktop-ui" / "dist"
    index = dist / "index.html"
    if not index.is_file():
        logger.warning(
            "SUPERNOVA_SERVE_DESKTOP=1 ma %s assente — esegui scripts/build_desktop_web.ps1",
            dist,
        )
        return
    application.mount(
        "/",
        _DesktopWebStaticFiles.factory(str(dist)),
        name="supernova-desktop-web",
    )
    logger.info(
        "SuperNova Desktop Web servita da %s (+ /project-data/ → %s)",
        dist,
        Path(DATA_DIR).resolve(),
    )


def build_app(cfg: SupernovaConfig | None = None) -> FastAPI:
    """Create FastAPI app (used by tests and ``app`` module export)."""
    from contextlib import asynccontextmanager

    c = cfg or get_supernova_config()

    @asynccontextmanager
    async def _lifespan(_app: FastAPI):
        _log_startup_security(c)
        sched_stop: threading.Event | None = None
        try:
            import ai_secrets_store as _ai_sec

            _ai_sec.load_and_apply()
        except Exception as exc:
            logger.warning("ai_secrets_store load skipped: %s", exc)
        sched_enabled = (
            c.hourly_financial_enabled
            or c.morning_refresh_enabled
            or c.sds_refresh_enabled
            or c.eis_refresh_enabled
            or c.scheduled_refresh_minutes > 0
            or c.daily_refresh_hour >= 0
        )
        if sched_enabled:
            try:
                from supernova_web_scheduler import start_web_scheduler

                sched_stop = start_web_scheduler(c)
            except Exception as exc:
                logger.warning("web scheduler skipped: %s", exc)

        def _warm_learning_lab_cache() -> None:
            try:
                from prediction.learning_lab import build_overview_payload

                build_overview_payload(use_mock=False)
                logger.info("learning-lab overview cache warmed")
            except Exception as exc:
                logger.warning("learning-lab cache warm skipped: %s", exc)

        threading.Thread(
            target=_warm_learning_lab_cache, name="ll-cache-warm", daemon=True
        ).start()
        yield
        if sched_stop is not None:
            sched_stop.set()

    application = FastAPI(title="SuperNova API", version="0.1.0", lifespan=_lifespan)

    _configure_cors(application, c)
    application.add_middleware(_LocalTokenMiddleware)
    application.add_middleware(_MobileSlashRedirectMiddleware)

    @application.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "root": str(ROOT)}

    @application.get("/api/status")
    def status() -> dict[str, Any]:
        xlsx = Path(FINAL_XLSX)
        token = c.api_token
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
            "api_token_required": bool(token),
            "api_token_is_placeholder": token == "CAMBIA_QUESTA_CHIAVE",
        }

    @application.post("/api/auth/verify-token")
    def verify_api_token() -> dict[str, bool]:
        """Verifica header X-SuperNova-Token (passa dal middleware mutating)."""
        return {"ok": True}

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

    @application.get("/api/refresh/profiles")
    def refresh_profiles_list() -> dict[str, Any]:
        from refresh_profile_runner import list_refresh_profiles

        return {"profiles": list_refresh_profiles()}

    @application.get("/api/desktop/workbook-status")
    def desktop_workbook_status() -> dict[str, Any]:
        from refresh_profile_runner import workbook_status

        return _json_safe(workbook_status())

    @application.post("/api/desktop/export-snapshots")
    def desktop_export_snapshots(
        essential: bool = Query(False, description="Solo Simulation + curve (refresh giornaliero)"),
    ) -> dict[str, Any]:
        from excel_sheet_reader import export_desktop_snapshots

        return _json_safe(export_desktop_snapshots(essential_only=essential))

    @application.get("/api/desktop/manifest")
    def desktop_manifest() -> dict[str, Any]:
        """Manifest snapshot desktop (``data/desktop_data_manifest.json``)."""
        p = Path(DESKTOP_DATA_MANIFEST_JSON)
        if not p.is_file():
            return {"error": "manifest missing", "updated_at": None}
        try:
            return _json_safe(json.loads(p.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError) as exc:
            return {"error": str(exc), "updated_at": None}

    @application.post("/api/desktop/merge-yf-financial")
    def desktop_merge_yf_financial() -> dict[str, Any]:
        """Merges yf.json entries missing from financial_sheet_snapshot.json.

        Called after a New Bio IPO scan to make newly added companies visible in
        the Financial table without waiting for a full orchestrator run.
        """
        from excel_sheet_reader import merge_yf_into_financial_snapshot

        return _json_safe(merge_yf_into_financial_snapshot())

    # ── Catalyst Feed ────────────────────────────────────────────────────────

    _catalyst_feed_thread: list[threading.Thread | None] = [None]

    @application.post("/api/catalyst-feed/refresh")
    def catalyst_feed_refresh() -> dict[str, Any]:
        """Starts background extraction of 8-K filing content for simulation companies."""
        import catalyst_extractor as _ce

        status = _ce.get_status()
        if status.get("running"):
            return {"started": False, "message": "Already running"}

        def _target() -> None:
            _ce.run_catalyst_feed_refresh()

        t = threading.Thread(target=_target, name="catalyst-feed", daemon=True)
        _catalyst_feed_thread[0] = t
        t.start()
        return {"started": True}

    @application.get("/api/catalyst-feed/status")
    def catalyst_feed_status() -> dict[str, Any]:
        import catalyst_extractor as _ce

        return _json_safe(_ce.get_status())

    @application.get("/api/catalyst-feed/snapshot")
    def catalyst_feed_snapshot() -> dict[str, Any]:
        import catalyst_extractor as _ce

        return _json_safe(_ce.load_snapshot())

    @application.get("/api/ai/provider")
    def ai_provider_status() -> dict[str, Any]:
        import ai_provider as _ap

        return _json_safe(_ap.provider_info())

    @application.post("/api/ai/provider")
    def ai_provider_set(body: dict[str, Any] | None = None) -> dict[str, Any]:
        """Cambia provider AI a runtime (persiste in data/ai_provider_override.json)."""
        import ai_provider as _ap

        payload = body if isinstance(body, dict) else {}
        provider = str(payload.get("provider", "")).strip().lower()
        try:
            _ap.set_active_provider(provider)
            return _json_safe({"ok": True, "provider": provider, **_ap.provider_info()})
        except ValueError as exc:
            return _json_safe({"ok": False, "error": str(exc)})

    @application.post("/api/ai/provider/probe")
    def ai_provider_probe() -> dict[str, Any]:
        """Quick test of configured providers (populates error hints for the UI)."""
        import ai_provider as _ap

        info = _ap.provider_info()
        ok = bool(_ap.call_ai("Reply with exactly: OK", max_tokens=8, task="catalyst"))
        info = _ap.provider_info()
        return _json_safe({**info, "probe_ok": ok})

    @application.post("/api/ai/provider/select")
    def ai_provider_select(body: dict[str, Any] | None = None) -> dict[str, Any]:
        """Alias POST /api/ai/provider (clinical feed switch)."""
        return ai_provider_set(body)

    @application.get("/api/ai/secrets")
    def ai_secrets_status() -> dict[str, Any]:
        """Stato chiavi API (mascherate) — salvate da UI feed clinico in data/ai_secrets.json."""
        import ai_secrets_store as _sec

        return _json_safe(_sec.get_status())

    @application.post("/api/ai/secrets")
    def ai_secrets_save(body: dict[str, Any] | None = None) -> dict[str, Any]:
        """Salva chiavi API da desktop (effetto immediato, no restart)."""
        import ai_provider as _ap
        import ai_secrets_store as _sec

        payload = body if isinstance(body, dict) else {}
        status = _sec.save_secrets(
            anthropic_api_key=payload.get("anthropic_api_key"),
            openai_api_key=payload.get("openai_api_key"),
            github_token=payload.get("github_token"),
            anthropic_prepaid_eur=payload.get("anthropic_prepaid_eur"),
            anthropic_org_id=payload.get("anthropic_org_id"),
            clear_anthropic=bool(payload.get("clear_anthropic")),
            clear_openai=bool(payload.get("clear_openai")),
            clear_github=bool(payload.get("clear_github")),
            clear_anthropic_prepaid=bool(payload.get("clear_anthropic_prepaid")),
        )
        return _json_safe({"ok": True, **status, "provider": _ap.provider_info()})

    # ── Clinical pre-CD enrichment (CT.gov + PubMed, 6 months before CD) ─────

    _clinical_pre_cd_thread: list[threading.Thread | None] = [None]

    @application.post("/api/clinical-pre-cd/refresh")
    def clinical_pre_cd_refresh(
        portfolio_only: bool = Query(True),
        force: bool = Query(False, description="Ignore TTL cache — reprocess all rows"),
        deep: bool = Query(
            False,
            description="Copilot-grade deep pass (also auto weekly for portfolio tickers)",
        ),
    ) -> dict[str, Any]:
        import clinical_pre_cd_enrichment as _cp

        if _cp.get_status().get("running"):
            return {"started": False, "message": "Already running"}

        def _target() -> None:
            _cp.run_clinical_pre_cd_refresh(
                portfolio_only=portfolio_only,
                force=force,
                deep=deep,
            )

        t = threading.Thread(target=_target, name="clinical-pre-cd", daemon=True)
        _clinical_pre_cd_thread[0] = t
        t.start()
        return {
            "started": True,
            "portfolio_only": portfolio_only,
            "force": force,
            "deep": deep,
        }

    @application.get("/api/clinical-pre-cd/status")
    def clinical_pre_cd_status() -> dict[str, Any]:
        import clinical_pre_cd_enrichment as _cp

        return _json_safe(_cp.get_status())

    @application.get("/api/clinical-pre-cd/snapshot")
    def clinical_pre_cd_snapshot() -> dict[str, Any]:
        import clinical_pre_cd_enrichment as _cp

        return _json_safe(_cp.load_snapshot())

    @application.get("/api/clinical-pre-cd/feed-refresh-report")
    def clinical_feed_refresh_report() -> dict[str, Any]:
        import clinical_feed_refresh_report as _rpt

        doc = _rpt.load_refresh_report()
        if not doc:
            return {"report": None, "should_show": False}
        return _json_safe(
            {
                "report": doc,
                "should_show": _rpt.should_show_report(doc),
            }
        )

    @application.post("/api/clinical-pre-cd/feed-refresh-report/ack")
    def clinical_feed_refresh_report_ack(body: dict[str, Any] | None = None) -> dict[str, Any]:
        import clinical_feed_refresh_report as _rpt

        payload = body if isinstance(body, dict) else {}
        report_id = str(payload.get("report_id") or "").strip()
        if not report_id:
            doc = _rpt.load_refresh_report()
            report_id = str((doc or {}).get("report_id") or (doc or {}).get("finished_at") or "")
        if not report_id:
            return {"ok": False, "error": "report_id required"}
        _rpt.save_ack(report_id)
        return {"ok": True, "report_id": report_id}

    @application.post("/api/catalyst-feed/copilot/chat")
    async def catalyst_feed_copilot_chat(body: dict[str, Any] | None = None) -> dict[str, Any]:
        """Interactive chat grounded on clinical pre-CD / Catalyst Feed snapshot."""
        import catalyst_copilot_chat as _chat

        payload = body if isinstance(body, dict) else {}
        message = str(payload.get("message") or "").strip()
        history = payload.get("history")
        if history is not None and not isinstance(history, list):
            history = []
        ticker = str(payload.get("ticker") or "").strip() or None
        tickers_raw = payload.get("tickers")
        tickers: list[str] | None = None
        if isinstance(tickers_raw, list):
            tickers = [str(t).strip() for t in tickers_raw if str(t).strip()]
        lang = str(payload.get("lang") or "it").strip().lower()
        use_live = payload.get("use_live_research", False)
        if isinstance(use_live, str):
            use_live = use_live.strip().lower() not in ("0", "false", "no", "off")
        page_records = payload.get("page_records")
        if page_records is not None and not isinstance(page_records, list):
            page_records = None
        return _json_safe(
            _chat.chat(
                message,
                history=history,
                ticker=ticker,
                tickers=tickers,
                page_records=page_records,
                lang=lang,
                use_live_research=bool(use_live),
            )
        )

    # ── Clinical Trial AI Summaries ──────────────────────────────────────────

    @application.post("/api/clinical/study-summary")
    def clinical_study_summary(
        nct_id:  str = Query(...),
        ticker:  str = Query(""),
        company: str = Query(""),
    ) -> dict[str, Any]:
        """Generate (or return cached) AI summary for a ClinicalTrials.gov study."""
        from clinical_trial_summary import generate_summary

        return _json_safe(generate_summary(nct_id=nct_id, ticker=ticker, company=company))

    @application.get("/api/clinical/study-summary/{nct_id}")
    def clinical_study_summary_cached(nct_id: str) -> dict[str, Any]:
        """Return cached summary if available (no generation)."""
        from clinical_trial_summary import get_cached_summary

        cached = get_cached_summary(nct_id)
        if cached:
            return _json_safe(cached)
        return {"cached": False, "nct_id": nct_id.upper()}

    @application.get("/api/clinical/study-meta/{nct_id}")
    def clinical_study_meta(
        nct_id: str,
        company: str = Query(""),
    ) -> dict[str, Any]:
        """Protocol metadata from ClinicalTrials.gov (no AI) for study banners."""
        from clinical_trial_summary import get_protocol_meta

        return _json_safe(get_protocol_meta(nct_id, company=company))

    @application.post("/api/refresh/run")
    def run_refresh_fast(profile: str = Query("daily")) -> dict[str, str]:
        """
        Profili refresh (stessi di Refresh Desktop Tk).

        ``profile``: daily | simulation | accuracy | sec_k8 | sunday | dry_run
        (alias: accuracy_only, simulation_only)

        Tutte le eccezioni vengono convertite in ``{"error": "..."}`` con HTTP
        200, evitando 500 con body vuoto che dal client UI vengono mostrati
        come ``Startup failed: 500:`` (nessuna informazione diagnosticabile).
        """
        global _refresh_proc, _refresh_profile, _refresh_exit_code
        try:
            from refresh_profile_runner import (
                build_refresh_command,
                normalize_refresh_profile,
            )
        except Exception as exc:  # noqa: BLE001 - import error → user-friendly
            return {"error": f"Impossibile importare refresh_profile_runner: {exc}"}

        if not PYTHON.is_file():
            return {"error": f"Python non trovato: {PYTHON}"}
        key = normalize_refresh_profile(profile)
        if not key:
            return {"error": f"Profilo refresh sconosciuto: {profile}"}
        try:
            argv, env_patch, log_path = build_refresh_command(key, str(PYTHON))
        except (ValueError, FileNotFoundError) as exc:
            return {"error": str(exc)}
        except Exception as exc:  # noqa: BLE001
            return {"error": f"Errore inatteso preparando il comando: {exc}"}

        try:
            with _run_lock:
                if _background_job_running():
                    return {"error": "Un job è già in corso (orchestrator o refresh)"}
                Path(DATA_DIR).mkdir(parents=True, exist_ok=True)
                try:
                    log_fh = open(log_path, "w", encoding="utf-8")
                except OSError as exc:
                    return {"error": f"Impossibile aprire il log {log_path}: {exc}"}
                env = os.environ.copy()
                env.update(env_patch)
                env["PYTHONUNBUFFERED"] = "1"
                if key == "sunday":
                    from refresh_desktop_app import strip_daily_fast_env, weekly_full_env_patch

                    env = strip_daily_fast_env(env)
                    env.update(weekly_full_env_patch())
                elif key in ("daily", "simulation", "dry_run"):
                    env = _apply_daily_refresh_env(env)
                elif key == "accuracy":
                    from refresh_desktop_app import accuracy_only_env_patch, strip_daily_fast_env

                    env = strip_daily_fast_env(env)
                    env.update(accuracy_only_env_patch())
                try:
                    _refresh_profile = key
                    _refresh_exit_code = None
                    _refresh_proc = subprocess.Popen(
                        argv,
                        cwd=str(ROOT),
                        env=env,
                        stdout=log_fh,
                        stderr=subprocess.STDOUT,
                    )
                    threading.Thread(
                        target=_refresh_proc_watcher,
                        args=(_refresh_proc, key),
                        name=f"refresh-watcher-{key}",
                        daemon=True,
                    ).start()
                except (OSError, ValueError) as exc:
                    log_fh.close()
                    return {"error": f"Avvio subprocess fallito: {exc}"}
        except Exception as exc:  # noqa: BLE001 - last-resort guard
            return {"error": f"Errore inatteso avviando il refresh: {exc}"}

        return {
            "started": "true",
            "profile": key,
            "hint": "Chiudi Excel sul workbook prima del run; preserva Prezzo acquisto/Capitale.",
        }

    @application.get("/api/refresh/status")
    def refresh_status() -> dict[str, Any]:
        st = _read_refresh_fast_status_file()
        running = _refresh_proc is not None and _refresh_proc.poll() is None
        out: dict[str, Any] = {
            "running": running,
            "profile": _refresh_profile,
            **st,
        }
        if not running and _refresh_exit_code is not None:
            out["exit_code"] = _refresh_exit_code
            out["ok"] = "1" if _refresh_exit_code == 0 else "0"
            # File status può restare "running" se il processo è crashato dopo la prima write.
            out["state"] = "ok" if _refresh_exit_code == 0 else "error"
            if _refresh_profile == "sunday":
                try:
                    from orchestrator_run_summary import (
                        format_summary_message,
                        load_last_summary,
                    )

                    _sum = load_last_summary()
                    if _sum:
                        out["orchestrator_summary"] = _sum
                        out["message"] = format_summary_message(_sum, lang="it")
                    else:
                        out["message"] = (
                            "Orchestrator domenica completato."
                            if _refresh_exit_code == 0
                            else f"Orchestrator domenica terminato con errori (exit {_refresh_exit_code})."
                        )
                except Exception:
                    out["message"] = (
                        "Orchestrator domenica completato."
                        if _refresh_exit_code == 0
                        else f"Orchestrator domenica terminato con errori (exit {_refresh_exit_code})."
                    )
            elif out.get("state") == "running" and not running:
                out["message"] = (
                    out.get("message")
                    or "Refresh terminato (stato file non aggiornato — vedi log)."
                )
        elif not running and st.get("state") == "running":
            # Subprocess assente ma file ancora "running" (kill, crash, API riavviata).
            out["state"] = "error"
            out["ok"] = "0"
            out["message"] = (
                st.get("message")
                or "Refresh interrotto o stato obsoleto — riavvia il refresh o controlla last_refresh_desktop.log."
            )
        return out

    @application.get("/api/refresh/orchestrator-summary")
    def orchestrator_summary() -> dict[str, Any]:
        try:
            from orchestrator_run_summary import load_last_summary

            doc = load_last_summary()
            return doc if doc else {}
        except Exception as exc:  # noqa: BLE001
            return {"error": str(exc)}

    # ── New Bio IPO refresh ──────────────────────────────────────────────────
    # Aggiorna ``data/biotech_symbols.json`` (universo) e ``yf.json`` con le
    # nuove IPO biotech del mese. Endpoint dedicato (NON parte del fast refresh
    # principale): viene chiamato dal bottone "🧬 New Bio IPO" nella tab
    # Financial o automaticamente il primo del mese (vedi
    # ``_new_bio_ipo_monthly_check``).
    _new_bio_ipo_running: list[bool] = [False]
    _new_bio_ipo_lock = threading.Lock()
    _new_bio_ipo_last_summary: list[dict[str, Any] | None] = [None]
    _new_bio_ipo_last_error: list[str | None] = [None]

    def _new_bio_ipo_thread_target() -> None:
        try:
            import new_bio_ipo as _nbi

            summary = _nbi.run_new_bio_ipo()
            _new_bio_ipo_last_summary[0] = summary
            _new_bio_ipo_last_error[0] = None
        except Exception as exc:  # noqa: BLE001
            _new_bio_ipo_last_error[0] = str(exc)
            print(f"[supernova_api] new_bio_ipo failed: {exc}", flush=True)
        finally:
            with _new_bio_ipo_lock:
                _new_bio_ipo_running[0] = False

    @application.post("/api/refresh/new-bio-ipo")
    def run_new_bio_ipo_endpoint() -> dict[str, Any]:
        """Avvia il refresh in background, ritorna subito.

        Usa il polling di ``/api/refresh/new-bio-ipo/status`` per leggere lo
        stato (running / completato + summary).
        """
        with _new_bio_ipo_lock:
            if _new_bio_ipo_running[0]:
                return {
                    "started": "false",
                    "running": "true",
                    "message": "New Bio IPO refresh già in corso",
                }
            _new_bio_ipo_running[0] = True
        thread = threading.Thread(
            target=_new_bio_ipo_thread_target,
            name="new-bio-ipo",
            daemon=True,
        )
        thread.start()
        return {"started": "true"}

    @application.get("/api/refresh/new-bio-ipo/status")
    def new_bio_ipo_status() -> dict[str, Any]:
        # Carica l'ultimo summary persistito (può venire da run precedenti).
        try:
            import new_bio_ipo as _nbi

            persisted = _nbi.load_last_run()
        except Exception:  # noqa: BLE001
            persisted = None
        summary = _new_bio_ipo_last_summary[0] or persisted
        with _new_bio_ipo_lock:
            running = _new_bio_ipo_running[0]
        return _json_safe(
            {
                "running": running,
                "summary": summary,
                "error": _new_bio_ipo_last_error[0],
            }
        )

    def _new_bio_ipo_monthly_check() -> None:
        """Esegue il refresh all'avvio del server se il mese è cambiato.

        Idempotente: salta se ``new_bio_ipo_last_run.json`` riporta una
        ``window_to`` nello stesso mese di oggi. Non blocca l'avvio: gira in
        un thread daemon.
        """
        try:
            import new_bio_ipo as _nbi

            if not _nbi.needs_monthly_run():
                return
        except Exception:  # noqa: BLE001
            # Se l'import fallisce ora, ritenteremo manualmente dal bottone UI.
            return

        def _target() -> None:
            with _new_bio_ipo_lock:
                if _new_bio_ipo_running[0]:
                    return
                _new_bio_ipo_running[0] = True
            _new_bio_ipo_thread_target()

        threading.Thread(
            target=_target, name="new-bio-ipo-monthly", daemon=True
        ).start()

    # Schedula il check mensile all'avvio del server (asincrono, non blocca).
    threading.Timer(5.0, _new_bio_ipo_monthly_check).start()

    # ── Simulation CD scan (Reload tab Simulation, ~2–8 min) ─────────────────
    @application.post("/api/simulation/cd-scan/run")
    def run_simulation_cd_scan() -> dict[str, Any]:
        """Fetch clinico incrementale + rigenera foglio Simulation + export snapshot."""
        global _cd_scan_proc, _cd_scan_exit_code
        if not PYTHON.is_file():
            return {"error": f"Python non trovato: {PYTHON}"}
        if not SIMULATION_CD_SCAN_SCRIPT.is_file():
            return {"error": f"Script non trovato: {SIMULATION_CD_SCAN_SCRIPT}"}
        try:
            from simulation_cd_scan_status import reset_simulation_cd_scan_running
        except Exception as exc:  # noqa: BLE001
            return {"error": f"Impossibile importare simulation_cd_scan_status: {exc}"}
        try:
            with _run_lock:
                if _background_job_running():
                    return {
                        "error": "Un job è già in corso (orchestrator, refresh o scan CD)",
                    }
                Path(DATA_DIR).mkdir(parents=True, exist_ok=True)
                try:
                    log_fh = open(LAST_SIMULATION_CD_SCAN_LOG, "w", encoding="utf-8")
                except OSError as exc:
                    return {"error": f"Impossibile aprire il log {LAST_SIMULATION_CD_SCAN_LOG}: {exc}"}
                reset_simulation_cd_scan_running()
                env = os.environ.copy()
                env["PYTHONUNBUFFERED"] = "1"
                try:
                    _cd_scan_exit_code = None
                    _cd_scan_proc = subprocess.Popen(
                        [str(PYTHON), "-u", str(SIMULATION_CD_SCAN_SCRIPT)],
                        cwd=str(ROOT),
                        env=env,
                        stdout=log_fh,
                        stderr=subprocess.STDOUT,
                    )
                    threading.Thread(
                        target=_cd_scan_proc_watcher,
                        args=(_cd_scan_proc,),
                        name="simulation-cd-scan-watcher",
                        daemon=True,
                    ).start()
                except (OSError, ValueError) as exc:
                    log_fh.close()
                    return {"error": f"Avvio scan CD fallito: {exc}"}
        except Exception as exc:  # noqa: BLE001
            return {"error": f"Errore inatteso avviando scan CD: {exc}"}
        return {
            "started": "true",
            "hint": "Chiudi Excel sul workbook se la rigenerazione Simulation fallisce.",
        }

    @application.get("/api/simulation/cd-scan/status")
    def simulation_cd_scan_status() -> dict[str, Any]:
        try:
            from simulation_cd_scan_status import read_simulation_cd_scan_status
        except Exception as exc:  # noqa: BLE001
            return {"error": str(exc)}
        st = read_simulation_cd_scan_status()
        running = _cd_scan_proc is not None and _cd_scan_proc.poll() is None
        out: dict[str, Any] = {**st, "running": running}
        if not running and _cd_scan_exit_code is not None:
            out["exit_code"] = _cd_scan_exit_code
            if st.get("ok") is None:
                out["ok"] = _cd_scan_exit_code == 0
                if _cd_scan_exit_code != 0 and not out.get("error"):
                    out["error"] = f"Scan CD terminato con exit {_cd_scan_exit_code}"
        return _json_safe(out)

    # ── Live signals: refresh rapido (~20s) solo per ticker con CD imminente ──
    _live_signals_proc: list = []   # [subprocess.Popen] — lista mutabile per closure

    @application.post("/api/refresh/live-signals")
    def refresh_live_signals(cd_horizon: int = Query(90, ge=7, le=180)) -> dict[str, Any]:
        """
        Aggiorna slope/affid/pred5 nel simulation_sheet_snapshot.json
        scaricando solo 3 mesi di prezzi per le società con CD imminente.
        Tipicamente < 30 secondi. Non tocca Excel né data_orchestrator.
        """
        if not PYTHON.is_file():
            return {"error": f"Python non trovato: {PYTHON}"}
        # Evita esecuzioni parallele
        if _live_signals_proc and _live_signals_proc[0].poll() is None:
            return {"running": True, "message": "Live signals refresh già in corso."}
        script = ROOT / "refresh_live_signals.py"
        if not script.is_file():
            return {"error": f"Script non trovato: {script}"}
        import subprocess as _sp
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        proc = _sp.Popen(
            [str(PYTHON), "-u", str(script), "--cd-horizon", str(cd_horizon)],
            cwd=str(ROOT), env=env,
            stdout=_sp.PIPE, stderr=_sp.STDOUT,
        )
        if _live_signals_proc:
            _live_signals_proc[0] = proc
        else:
            _live_signals_proc.append(proc)
        return {"started": True, "cd_horizon": cd_horizon,
                "message": "Live signals refresh avviato (~20s)."}

    @application.get("/api/refresh/live-signals/status")
    def live_signals_status() -> dict[str, Any]:
        """Stato dell'ultimo refresh live signals."""
        running = bool(_live_signals_proc and _live_signals_proc[0].poll() is None)
        status_file = Path(DATA_DIR) / "refresh_live_signals_status.json"
        st: dict = {}
        if status_file.is_file():
            try:
                st = json.loads(status_file.read_text(encoding="utf-8"))
            except Exception:
                pass
        return {"running": running, **st}

    @application.get("/api/refresh/log")
    def refresh_log(tail: int = Query(4000, ge=0, le=200_000)) -> dict[str, str]:
        parts: list[str] = []
        for p in (
            Path(DATA_DIR) / "last_refresh_desktop.log",
            LAST_REFRESH_LOG,
            Path(LAST_ORCH_LOG),
        ):
            if p.is_file():
                parts.append(p.read_text(encoding="utf-8", errors="replace"))
        text = "\n".join(parts) if parts else ""
        if tail and len(text) > tail:
            text = text[-tail:]
        return {"log": text}

    # ── Post-refresh pipeline (Decision Lab) ───────────────────────────────
    # Esegue in cascata gli step che lo scheduler `daily_market_refresh.py`
    # e il WeeklyFull lanciano dopo refresh/orchestrator:
    #   1. scripts/_build_directional_calibration.py  (KPI direzionali Raw/Useful/Strong)
    #   2. scripts/investment_decision_cohort.py      (cohort storica Decision Lab)
    #   3. refresh_live_signals.py                    (pred5/affid Pre-CD)
    # Output: file di status + log dedicati in data/.
    _post_pipeline_proc: list = []   # lista mutabile per closure
    POST_PIPELINE_STATUS = Path(DATA_DIR) / "post_refresh_pipeline_status.json"
    POST_PIPELINE_LOG = Path(DATA_DIR) / "post_refresh_pipeline.log"

    def _write_post_pipeline_status(state: str, message: str = "") -> None:
        try:
            Path(DATA_DIR).mkdir(parents=True, exist_ok=True)
            POST_PIPELINE_STATUS.write_text(
                json.dumps(
                    {
                        "state": state,
                        "message": message,
                        "updated_at": datetime.now().isoformat(timespec="seconds"),
                    }
                ),
                encoding="utf-8",
            )
        except OSError:
            pass

    def _run_post_pipeline_steps(steps: list[tuple[str, list[str]]]) -> None:
        """Esegue gli script in cascata scrivendo su POST_PIPELINE_LOG."""
        _write_post_pipeline_status("running", f"Step 1/{len(steps)}: avvio…")
        with POST_PIPELINE_LOG.open("w", encoding="utf-8") as log_fh:
            for idx, (name, argv) in enumerate(steps, start=1):
                header = f"\n══════════════════════════════════════\n[{idx}/{len(steps)}] {name}\n══════════════════════════════════════\n"
                log_fh.write(header)
                log_fh.flush()
                _write_post_pipeline_status("running", f"Step {idx}/{len(steps)}: {name}…")
                try:
                    cp = subprocess.run(
                        argv,
                        cwd=str(ROOT),
                        stdout=log_fh,
                        stderr=subprocess.STDOUT,
                        timeout=15 * 60,  # 15 min per step (safety)
                        check=False,
                    )
                    log_fh.write(f"\n[exit code: {cp.returncode}]\n")
                    log_fh.flush()
                    if cp.returncode != 0:
                        _write_post_pipeline_status(
                            "error",
                            f"Step {idx}/{len(steps)} ({name}) ha restituito exit {cp.returncode}",
                        )
                        return
                except subprocess.TimeoutExpired:
                    log_fh.write(f"\n[TIMEOUT dopo 15 min — step abortito]\n")
                    log_fh.flush()
                    _write_post_pipeline_status(
                        "error", f"Step {idx}/{len(steps)} ({name}) in timeout dopo 15 min"
                    )
                    return
                except OSError as exc:
                    log_fh.write(f"\n[ERROR I/O: {exc}]\n")
                    log_fh.flush()
                    _write_post_pipeline_status(
                        "error", f"Step {idx}/{len(steps)} ({name}) errore I/O: {exc}"
                    )
                    return
        _write_post_pipeline_status("ok", f"Pipeline completata ({len(steps)} step).")

    @application.post("/api/investment/post-refresh-pipeline")
    def run_post_refresh_pipeline() -> dict[str, Any]:
        """
        Esegue post-pipeline Decision Lab in background:
          1. scripts/_build_directional_calibration.py  (~1–3 min)
          2. scripts/investment_decision_cohort.py      (~2–5 min)

        Da chiamare DOPO un refresh fast + export snapshot (o in parallelo al reload UI)
        per portare a video KPI direzionali, cohort e live signals Pre-CD.
        """
        if not PYTHON.is_file():
            return {"error": f"Python non trovato: {PYTHON}"}
        if _post_pipeline_proc and _post_pipeline_proc[0].is_alive():
            return {"running": True, "message": "Post-pipeline già in corso."}

        scripts: list[tuple[str, list[str]]] = []
        dir_calib = ROOT / "scripts" / "_build_directional_calibration.py"
        if dir_calib.is_file():
            scripts.append(("directional_calibration", [str(PYTHON), "-u", str(dir_calib)]))
        cohort = ROOT / "scripts" / "investment_decision_cohort.py"
        if cohort.is_file():
            scripts.append(("investment_decision_cohort", [str(PYTHON), "-u", str(cohort)]))
        live = ROOT / "refresh_live_signals.py"
        if live.is_file():
            scripts.append(
                (
                    "live_signals",
                    [str(PYTHON), "-u", str(live), "--cd-horizon", "60"],
                )
            )

        if not scripts:
            return {"error": "Nessuno script post-pipeline disponibile in scripts/."}

        Path(DATA_DIR).mkdir(parents=True, exist_ok=True)
        _write_post_pipeline_status("starting", "Avvio post-pipeline…")

        thread = threading.Thread(
            target=_run_post_pipeline_steps,
            args=(scripts,),
            daemon=True,
            name="post-refresh-pipeline",
        )
        thread.start()
        if _post_pipeline_proc:
            _post_pipeline_proc[0] = thread
        else:
            _post_pipeline_proc.append(thread)

        return {
            "started": True,
            "steps": [name for name, _ in scripts],
            "eta_min": "5–8",
        }

    @application.get("/api/investment/post-refresh-pipeline/status")
    def post_refresh_pipeline_status() -> dict[str, Any]:
        running = bool(_post_pipeline_proc and _post_pipeline_proc[0].is_alive())
        st: dict[str, Any] = {}
        if POST_PIPELINE_STATUS.is_file():
            try:
                st = json.loads(POST_PIPELINE_STATUS.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                st = {}
        return {"running": running, **st}

    @application.get("/api/investment/post-refresh-pipeline/log")
    def post_refresh_pipeline_log(tail: int = Query(4000, ge=0, le=200_000)) -> dict[str, str]:
        if not POST_PIPELINE_LOG.is_file():
            return {"log": ""}
        try:
            text = POST_PIPELINE_LOG.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return {"log": ""}
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
        from orchestrator_io_paths import SIMULATION_CHARTS_SNAPSHOT_JSON

        p = Path(SIMULATION_CHARTS_SNAPSHOT_JSON)
        if p.is_file():
            try:
                import json

                with p.open(encoding="utf-8") as fh:
                    cached = json.load(fh)
                if isinstance(cached, dict) and cached.get("series"):
                    return _json_safe(cached)
            except (OSError, json.JSONDecodeError):
                pass
        from dpg_lab_data import build_simulation_lab_bundle

        return _json_safe(build_simulation_lab_bundle())

    @application.get("/api/charts/ristretta")
    def charts_ristretta() -> dict[str, Any]:
        from dpg_lab_data import build_ristretta_dpg_bundle

        return _json_safe(build_ristretta_dpg_bundle())

    @application.get("/api/predictions")
    def predictions_json() -> dict[str, Any]:
        """Dashboard: legge ``data/past_catalyst_predictions.json`` (fallback se UI senza snapshot locale)."""
        from orchestrator_io_paths import PAST_CATALYST_PREDICTIONS_JSON

        p = Path(PAST_CATALYST_PREDICTIONS_JSON)
        if not p.is_file():
            from fastapi import HTTPException

            raise HTTPException(
                status_code=404,
                detail={
                    "message_it": "File predizioni non trovato",
                    "path": str(p),
                },
            )
        import json

        with p.open(encoding="utf-8") as fh:
            return json.load(fh)

    @application.get("/api/evaluation/results")
    def evaluation_results_cached() -> dict[str, Any]:
        from prediction.evaluationFramework import load_cached_evaluation

        doc = load_cached_evaluation()
        if not doc:
            from fastapi import HTTPException

            raise HTTPException(
                status_code=404,
                detail={
                    "message_it": "Nessuna valutazione in cache — esegui POST /api/evaluation/run",
                },
            )
        return _json_safe(doc)

    @application.get("/api/evaluation/blend-ab")
    def evaluation_blend_ab(
        source: str = Query("all"),
        past_only: bool = Query(True),
    ) -> dict[str, Any]:
        from prediction.blend_ab_eval import evaluate_blend_ab

        return _json_safe(
            evaluate_blend_ab(
                source=source if source in ("all", "live", "charts", "past") else "all",
                past_only=past_only,
            )
        )

    @application.post("/api/evaluation/run")
    def evaluation_run(
        lookback_cds: int = Query(10, ge=0, le=500),
        use_mock: bool = Query(False),
    ) -> dict[str, Any]:
        from prediction.evaluationFramework import run_full_evaluation

        return _json_safe(
            run_full_evaluation(
                lookback_cds=lookback_cds,
                use_mock_if_sparse=use_mock,
            )
        )

    @application.get("/api/evaluation/baseline")
    def evaluation_baseline_get() -> dict[str, Any]:
        from prediction.evaluationFramework import load_evaluation_baseline

        doc = load_evaluation_baseline()
        if not doc:
            from fastapi import HTTPException

            raise HTTPException(
                status_code=404,
                detail={"message_it": "Nessuna baseline salvata — usa POST /api/evaluation/baseline"},
            )
        return _json_safe(doc)

    @application.post("/api/evaluation/baseline")
    def evaluation_baseline_save(
        label: str | None = Query(None, max_length=120),
    ) -> dict[str, Any]:
        from prediction.evaluationFramework import save_evaluation_baseline

        return _json_safe(save_evaluation_baseline(label=label))

    @application.get("/api/evaluation/compare")
    def evaluation_compare() -> dict[str, Any]:
        from prediction.evaluationFramework import (
            compare_evaluations,
            load_cached_evaluation,
            load_evaluation_baseline,
        )

        current = load_cached_evaluation()
        baseline = load_evaluation_baseline()
        if not current:
            from fastapi import HTTPException

            raise HTTPException(status_code=404, detail={"message_it": "Nessuna valutazione in cache"})
        if not baseline:
            from fastapi import HTTPException

            raise HTTPException(status_code=404, detail={"message_it": "Nessuna baseline salvata"})
        return _json_safe(
            {
                "current": current,
                "baseline": baseline,
                "comparison": compare_evaluations(current, baseline),
            }
        )

    @application.get("/api/sheets")
    def sheets_list() -> dict[str, Any]:
        from excel_sheet_reader import list_workbook_sheets

        return _sheet_json_safe(list_workbook_sheets)

    @application.get("/api/sheets/simulation")
    def sheet_simulation() -> dict[str, Any]:
        from excel_sheet_reader import read_simulation_table_cached

        return _sheet_json_safe(read_simulation_table_cached)

    @application.get("/api/sheets/accuracy")
    def sheet_accuracy() -> dict[str, Any]:
        from excel_sheet_reader import read_accuracy_table_cached

        return _sheet_json_safe(read_accuracy_table_cached)

    @application.get("/api/sheets/accuracy/v4-v5-summary")
    def sheet_accuracy_v4_v5_summary() -> dict[str, Any]:
        from excel_sheet_reader import read_accuracy_v4_v5_summary

        return _json_safe(read_accuracy_v4_v5_summary())

    @application.get("/api/models/accuracy-monitor")
    def model_accuracy_monitor() -> dict[str, Any]:
        from orchestrator_io_paths import MODEL_ACCURACY_MONITOR_JSON

        p = Path(MODEL_ACCURACY_MONITOR_JSON)
        if not p.is_file():
            return {"entries": [], "path": str(p), "error": "File monitor assente"}
        import json

        try:
            with p.open(encoding="utf-8") as fh:
                return _json_safe(json.load(fh))
        except (OSError, json.JSONDecodeError) as exc:
            return {"entries": [], "path": str(p), "error": str(exc)}

    @application.post("/api/models/accuracy-monitor/run")
    async def model_accuracy_monitor_run(body: dict[str, Any] | None = None) -> dict[str, Any]:
        """Snapshot manuale monitor (senza attendere weekly task)."""
        payload = body if isinstance(body, dict) else {}
        trigger = str(payload.get("trigger") or "manual_ui").strip() or "manual_ui"
        write_sheet = bool(payload.get("write_sheet", True))
        recalibrated = bool(payload.get("recalibrated", False))
        from prediction.accuracy_monitor_run import run_accuracy_monitor_snapshot

        result = run_accuracy_monitor_snapshot(
            trigger=trigger,
            write_sheet=write_sheet,
            recalibrated=recalibrated,
        )
        return _json_safe(result)

    @application.get("/api/models/kpi-signal-analysis")
    def kpi_signal_analysis() -> dict[str, Any]:
        from prediction.kpi_signal_analysis import load_analysis
        return _json_safe(load_analysis())

    @application.post("/api/models/kpi-signal-analysis/rebuild")
    def kpi_signal_analysis_rebuild() -> dict[str, Any]:
        from prediction.kpi_signal_analysis import write_analysis
        doc = write_analysis()
        return _json_safe({"ok": True, "n_enriched": doc.get("n_enriched", 0)})

    @application.get("/api/models/signal-calibration")
    def signal_calibration_get() -> dict[str, Any]:
        from prediction.signal_audit import load_calibration

        return _json_safe(load_calibration())

    @application.post("/api/models/signal-calibration/rebuild")
    def signal_calibration_rebuild() -> dict[str, Any]:
        from prediction.signal_audit import build_calibration_document, close_pending_outcomes

        n_closed = close_pending_outcomes()
        doc = build_calibration_document(close_outcomes_first=False)
        cohorts = doc.get("cohorts") if isinstance(doc.get("cohorts"), dict) else {}
        useful = cohorts.get("useful") if isinstance(cohorts.get("useful"), dict) else {}
        return _json_safe({
            "ok": True,
            "closed": n_closed,
            "log_rows": doc.get("log_rows"),
            "closed_rows": doc.get("closed_rows"),
            "pending_outcomes": doc.get("pending_outcomes"),
            "cohorts": cohorts,
            "useful_hit_pct": useful.get("hit_pct"),
            "useful_n": useful.get("n"),
            "weekly_actionable": doc.get("weekly_actionable"),
            "generated_at": doc.get("generated_at"),
        })

    @application.get("/api/models/eis-magnitude-analysis")
    def eis_magnitude_analysis_get() -> dict[str, Any]:
        """EIS high vs low score vs market reaction (clinical feed events only)."""
        from prediction.eis_magnitude_analysis import build_eis_magnitude_analysis

        return _json_safe(build_eis_magnitude_analysis())

    @application.get("/api/models/eis-cohort-comparison")
    def eis_cohort_comparison_get() -> dict[str, Any]:
        """Live EIS cohort split (EIS ≠ 0 vs EIS = 0/null) for Performance tab chart."""
        from prediction.eis_cohort_weekly_history import load_weekly_history
        from prediction.pre_cd_curve_impact import build_curve_impact_cumulative

        doc = build_curve_impact_cumulative(persist_state=False, auto_enrich=True)
        comparison = doc.get("eis_cohort_comparison") or {}
        magnitude = doc.get("eis_magnitude_analysis") or {}
        return _json_safe(
            {
                "eis_cohort_comparison": comparison,
                "eis_magnitude_analysis": magnitude,
                "n_simulation_events": doc.get("n_simulation_events"),
                "n_with_eis_data": doc.get("n_with_eis_data"),
                "built_at": doc.get("built_at"),
                "weekly_history": load_weekly_history(),
            }
        )

    @application.get("/api/models/eis-cohort-weekly-history")
    def eis_cohort_weekly_history_get() -> dict[str, Any]:
        """Weekly EIS cohort trend points (one per ISO week, updated Lun–Ven 10:00)."""
        from prediction.eis_cohort_weekly_history import load_weekly_history

        return _json_safe(load_weekly_history())

    @application.get("/api/market/context")
    def market_context_get() -> dict[str, Any]:
        from prediction.market_context_gate import load_market_context

        return _json_safe(load_market_context())

    @application.post("/api/market/context/run")
    def market_context_run() -> dict[str, Any]:
        from prediction.market_context_gate import run as market_gate_run

        return _json_safe(market_gate_run())

    @application.get("/api/models/feedback-loop/summary")
    def feedback_loop_summary() -> dict[str, Any]:
        from orchestrator_io_paths import FEEDBACK_HISTORY_JSON, FEEDBACK_SUMMARY_JSON

        import json

        out: dict[str, Any] = {"summary": None, "history": []}
        for key, path in (("summary", FEEDBACK_SUMMARY_JSON), ("history", FEEDBACK_HISTORY_JSON)):
            p = Path(path)
            if not p.is_file():
                continue
            try:
                with p.open(encoding="utf-8") as fh:
                    doc = json.load(fh)
                if key == "summary":
                    out["summary"] = doc
                else:
                    out["history"] = doc.get("weeks") or doc
            except (OSError, json.JSONDecodeError):
                continue
        return _json_safe(out)

    @application.get("/api/models/feedback-loop/ticker-performance")
    def feedback_loop_ticker_performance() -> dict[str, Any]:
        from orchestrator_io_paths import TICKER_PERFORMANCE_JSON

        import json

        p = Path(TICKER_PERFORMANCE_JSON)
        if not p.is_file():
            return {"tickers": {}}
        try:
            with p.open(encoding="utf-8") as fh:
                return _json_safe(json.load(fh))
        except (OSError, json.JSONDecodeError) as exc:
            return {"tickers": {}, "error": str(exc)}

    @application.get("/api/models/feedback-loop/preview")
    @application.post("/api/models/feedback-loop/preview")
    def feedback_loop_preview() -> dict[str, Any]:
        from prediction.validation_feedback_loop import run_now

        return _json_safe(run_now(dry_run=True))

    @application.post("/api/models/feedback-loop/apply")
    def feedback_loop_apply(body: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = body if isinstance(body, dict) else {}
        if not payload.get("confirm"):
            return _json_safe({"ok": False, "error": "confirm=true required"})
        from prediction.validation_feedback_loop import run_now

        return _json_safe(run_now(dry_run=False))

    @application.get("/api/models/learning-lab/overview")
    def learning_lab_overview() -> dict[str, Any]:
        from prediction.learning_lab import build_overview_payload

        return _json_safe(build_overview_payload(use_mock=False))

    @application.get("/api/models/learning-lab/preview")
    @application.post("/api/models/learning-lab/preview")
    def learning_lab_preview() -> dict[str, Any]:
        from prediction.learning_lab import run_learning_cycle

        return _json_safe(run_learning_cycle(dry_run=True))

    @application.post("/api/models/learning-lab/apply")
    async def learning_lab_apply(request: Request) -> dict[str, Any]:
        payload = await _request_json_dict(request)
        if not payload.get("confirm"):
            return _json_safe({"ok": False, "error": "confirm=true required"})
        from prediction.learning_lab import run_learning_cycle

        return _json_safe(run_learning_cycle(dry_run=False))

    @application.post("/api/models/learning-lab/reset")
    async def learning_lab_reset(request: Request) -> dict[str, Any]:
        payload = await _request_json_dict(request)
        dry = not payload.get("confirm")
        from prediction.learning_lab import reset_all_learning

        return _json_safe(reset_all_learning(dry_run=dry))

    @application.get("/api/models/learning-lab/export")
    def learning_lab_export() -> dict[str, Any]:
        from prediction.learning_lab import export_learning_report

        return _json_safe(export_learning_report())

    # ── Learning Bus v2 (taxonomy + health for the unified Learning Lab) ──
    # Coexists with the legacy /api/models/learning-lab/* above. The v2
    # endpoints enumerate ALL ~33 loops in the system (not just the 8 that
    # the legacy overview surfaces) so the Learning Lab v2 grid can show
    # every mechanism at a glance.

    @application.get("/api/learning/health")
    def learning_health() -> dict[str, Any]:
        from prediction.learning_bus import get_health_overview

        return _json_safe(get_health_overview())

    @application.get("/api/learning/loops")
    def learning_loops() -> dict[str, Any]:
        from prediction.learning_bus import list_loops_with_status

        return _json_safe({"loops": list_loops_with_status()})

    @application.get("/api/learning/loops/{loop_id}")
    def learning_loop_detail(loop_id: str) -> dict[str, Any]:
        from prediction.learning_bus import get_loop

        loop = get_loop(loop_id)
        if loop is None:
            raise HTTPException(status_code=404, detail=f"Unknown loop id: {loop_id}")
        return _json_safe(loop)

    @application.post("/api/learning/loops/{loop_id}/preview")
    def learning_loop_preview(loop_id: str) -> dict[str, Any]:
        from prediction.learning_bus import get_loop
        from prediction.learning_loop_actions import preview_loop

        if get_loop(loop_id) is None:
            raise HTTPException(status_code=404, detail=f"Unknown loop id: {loop_id}")
        return _json_safe(preview_loop(loop_id))

    @application.post("/api/learning/loops/{loop_id}/apply")
    async def learning_loop_apply(loop_id: str, request: Request) -> dict[str, Any]:
        body = await _request_json_dict(request)
        from prediction.learning_bus import get_loop
        from prediction.learning_loop_actions import apply_loop

        if get_loop(loop_id) is None:
            raise HTTPException(status_code=404, detail=f"Unknown loop id: {loop_id}")
        return _json_safe(apply_loop(loop_id, confirm=bool(body.get("confirm"))))

    @application.post("/api/learning/loops/{loop_id}/reset")
    async def learning_loop_reset(loop_id: str, request: Request) -> dict[str, Any]:
        body = await _request_json_dict(request)
        from prediction.learning_bus import get_loop
        from prediction.learning_loop_actions import reset_loop

        if get_loop(loop_id) is None:
            raise HTTPException(status_code=404, detail=f"Unknown loop id: {loop_id}")
        return _json_safe(reset_loop(loop_id, confirm=bool(body.get("confirm"))))

    @application.get("/api/learning/pipeline-overview")
    def learning_pipeline_overview() -> dict[str, Any]:
        from prediction.learning_pipeline_overview import build_learning_pipeline_overview

        return _json_safe(build_learning_pipeline_overview())

    @application.get("/api/learning/portfolio-advice/snapshot")
    def portfolio_advice_snapshot_get() -> dict[str, Any]:
        from prediction.portfolio_advice_snapshot import read_portfolio_advice_snapshot

        return _json_safe(read_portfolio_advice_snapshot())

    @application.put("/api/learning/portfolio-advice/snapshot")
    async def portfolio_advice_snapshot_put(request: Request) -> dict[str, Any]:
        body = await _request_json_dict(request)
        from prediction.portfolio_advice_snapshot import write_portfolio_advice_snapshot

        return _json_safe(write_portfolio_advice_snapshot(body))

    @application.get("/api/learning/calibration/state")
    def learning_calibration_state_get() -> dict[str, Any]:
        from prediction.calibration_state import read_calibration_state

        return _json_safe(read_calibration_state())

    @application.get("/api/learning/audit-log")
    def learning_audit_log(limit: int = 200) -> dict[str, Any]:
        from prediction.learning_audit_log import build_learning_audit_log

        safe_limit = max(1, min(int(limit or 200), 500))
        return _json_safe(build_learning_audit_log(limit=safe_limit))

    @application.get("/api/learning/portfolio-error-loop")
    def portfolio_error_loop_get() -> dict[str, Any]:
        from prediction.portfolio_error_loop import build_status_excerpt

        return _json_safe(build_status_excerpt())

    @application.post("/api/learning/portfolio-error-loop/preview")
    def portfolio_error_loop_preview() -> dict[str, Any]:
        from prediction.portfolio_error_loop import preview_cycle

        return _json_safe(preview_cycle())

    @application.post("/api/learning/portfolio-error-loop/apply")
    async def portfolio_error_loop_apply(request: Request) -> dict[str, Any]:
        body = await _request_json_dict(request)
        from prediction.portfolio_error_loop import apply_cycle

        return _json_safe(apply_cycle(confirm=bool(body.get("confirm"))))

    @application.post("/api/learning/portfolio-error-loop/reset")
    async def portfolio_error_loop_reset(request: Request) -> dict[str, Any]:
        body = await _request_json_dict(request)
        from prediction.portfolio_error_loop import reset_calibration

        return _json_safe(reset_calibration(confirm=bool(body.get("confirm"))))

    @application.post("/api/models/eis-super-score/compute")
    async def eis_super_score_compute(request: Request) -> dict[str, Any]:
        body = await _request_json_dict(request)
        from prediction.eis_super_score_learning import compute_super_score

        try:
            eis = float(body.get("eis_score"))
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="eis_score required") from None
        days_raw = body.get("days_before_cd")
        days: int | None
        try:
            days = int(days_raw) if days_raw is not None else None
        except (TypeError, ValueError):
            days = None
        score = compute_super_score(eis, days)
        return _json_safe({"super_score": score, "eis_score": eis, "days_before_cd": days})

    @application.get("/api/investment/decision-cohort")
    def investment_decision_cohort() -> dict[str, Any]:
        from prediction.investment_decision_cohort import read_investment_decision_cohort

        return _json_safe(read_investment_decision_cohort())

    @application.get("/api/investment/sim-outcomes")
    def investment_sim_outcomes() -> dict[str, Any]:
        from prediction.investment_sim_outcomes import read_investment_sim_outcomes

        return _json_safe(read_investment_sim_outcomes())

    @application.post("/api/investment/sim-outcomes/rebuild")
    def investment_sim_outcomes_rebuild() -> dict[str, Any]:
        from prediction.investment_sim_outcomes import write_investment_sim_outcomes

        return _json_safe(write_investment_sim_outcomes())

    @application.get("/api/investment/trade-calib")
    def investment_trade_calib() -> dict[str, Any]:
        from prediction.investment_trade_calib import read_investment_trade_calibration

        return _json_safe(read_investment_trade_calibration())

    @application.get("/api/investment/sim-inputs")
    def investment_sim_inputs_get() -> dict[str, Any]:
        p = INVEST_SIM_INPUTS_PATH
        if not p.is_file():
            return {"version": 1, "updated_at": None, "inputs": {}}
        try:
            with p.open(encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, json.JSONDecodeError) as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        if not isinstance(data, dict):
            return {"version": 1, "updated_at": None, "inputs": {}}
        inputs = data.get("inputs")
        if not isinstance(inputs, dict):
            data["inputs"] = {}
        return _json_safe(data)

    @application.put("/api/investment/sim-inputs")
    async def investment_sim_inputs_put(body: dict[str, Any]) -> dict[str, Any]:
        raw = body.get("inputs")
        if raw is not None and not isinstance(raw, dict):
            raise HTTPException(status_code=400, detail="inputs deve essere un oggetto")
        inputs = raw if isinstance(raw, dict) else {}
        payload = {
            "version": 1,
            "updated_at": datetime.now().astimezone().isoformat(),
            "inputs": inputs,
        }
        p = INVEST_SIM_INPUTS_PATH
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".json.tmp")
        try:
            tmp.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            tmp.replace(p)
        except OSError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        try:
            from prediction.investment_sim_outcomes import write_investment_sim_outcomes

            write_investment_sim_outcomes()
        except Exception as exc:
            logger.warning("sim-outcomes rebuild dopo sim-inputs: %s", exc)
        return _json_safe({"ok": True, "path": str(p), "updated_at": payload["updated_at"]})

    @application.get("/api/investment/sim-history")
    def investment_sim_history_get() -> dict[str, Any]:
        p = INVEST_SIM_HISTORY_PATH
        if not p.is_file():
            return {"version": 1, "updated_at": None, "points": []}
        try:
            with p.open(encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, json.JSONDecodeError) as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        if not isinstance(data, dict):
            return {"version": 1, "updated_at": None, "points": []}
        points = data.get("points")
        if not isinstance(points, list):
            data["points"] = []
        return _json_safe(data)

    @application.put("/api/investment/sim-history")
    async def investment_sim_history_put(body: dict[str, Any]) -> dict[str, Any]:
        raw = body.get("points")
        if raw is not None and not isinstance(raw, list):
            raise HTTPException(status_code=400, detail="points deve essere un array")
        points = raw if isinstance(raw, list) else []
        payload = {
            "version": 1,
            "updated_at": datetime.now().astimezone().isoformat(),
            "points": points,
        }
        p = INVEST_SIM_HISTORY_PATH
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".json.tmp")
        try:
            tmp.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            tmp.replace(p)
        except OSError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        return _json_safe({"ok": True, "path": str(p), "updated_at": payload["updated_at"]})

    @application.get("/api/sheets/financial")
    def sheet_financial() -> dict[str, Any]:
        from excel_sheet_reader import read_financial_table_cached

        return _sheet_json_safe(read_financial_table_cached)

    @application.get("/api/sheets/clinical-simulation")
    def sheet_clinical_simulation() -> dict[str, Any]:
        from excel_sheet_reader import read_clinical_for_simulation

        return _sheet_json_safe(read_clinical_for_simulation)

    @application.get("/api/sheets/sec-k8-simulation")
    def sheet_sec_k8_simulation() -> dict[str, Any]:
        from excel_sheet_reader import read_sec_k8_for_simulation

        return _sheet_json_safe(read_sec_k8_for_simulation)

    @application.get("/api/sheets/{sheet_name}")
    def sheet_by_name(sheet_name: str) -> dict[str, Any]:
        from excel_sheet_reader import read_sheet_table

        return _sheet_json_safe(lambda: read_sheet_table(sheet_name))

    # ── Tester feedback (mobile companion → desktop monitor) ─────────────────

    @application.get("/api/tester-feedback/config")
    def tester_feedback_config() -> dict[str, Any]:
        import tester_feedback_io as tf
        import tester_approval_email as tae

        return _json_safe({
            "schema_version": tf.SCHEMA_VERSION,
            "store_path": str(tf.STORE_PATH),
            "valid_modules": sorted(tf.VALID_MODULES),
            "valid_kinds": sorted(tf.VALID_KINDS),
            "valid_statuses": sorted(tf.VALID_STATUSES),
            "invite_required": bool(tf._load_invite_codes()),
            "approval_email": tae.email_config_summary(),
            "mvp_doc": "docs/MOBILE_TESTER_MVP.md",
            "defaults": {
                "predictions": "shared_snapshot",
                "tracking": "per_tester",
                "auth": "email_pending_approval",
            },
        })

    @application.get("/api/tester-feedback/summary")
    def tester_feedback_summary() -> dict[str, Any]:
        import tester_feedback_io as tf

        return _json_safe(tf.build_summary())

    @application.get("/api/tester-feedback/events")
    def tester_feedback_events(
        limit: int = Query(200, ge=1, le=1000),
        tester_id: str | None = None,
        module: str | None = None,
        kind: str | None = None,
    ) -> dict[str, Any]:
        import tester_feedback_io as tf

        events = tf.list_events(
            limit=limit,
            tester_id=tester_id,
            module=module,
            kind=kind,
        )
        return _json_safe({"events": events, "count": len(events)})

    @application.post("/api/tester-feedback/testers/register")
    async def tester_feedback_register(body: dict[str, Any]) -> dict[str, Any]:
        import tester_feedback_io as tf

        tid = body.get("tester_id")
        email = body.get("email")
        if not isinstance(tid, str):
            tid = ""
        if not tid.strip() and not (isinstance(email, str) and email.strip()):
            raise HTTPException(status_code=400, detail="tester_id o email richiesti")
        try:
            meta = tf.register_tester(
                tid,
                display_name=body.get("display_name") if isinstance(body.get("display_name"), str) else None,
                invite_code=body.get("invite_code") if isinstance(body.get("invite_code"), str) else None,
                email=email if isinstance(email, str) else None,
                source=body.get("source") if isinstance(body.get("source"), str) else "mobile",
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return _json_safe({"ok": True, "tester": meta})

    @application.get("/api/tester-feedback/testers/{tester_id}/access")
    def tester_feedback_access(tester_id: str) -> dict[str, Any]:
        import tester_feedback_io as tf

        try:
            return _json_safe(tf.get_tester_access(tester_id))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @application.post("/api/tester-feedback/testers/{tester_id}/status")
    async def tester_feedback_set_status(tester_id: str, body: dict[str, Any]) -> dict[str, Any]:
        import tester_feedback_io as tf

        status = body.get("status")
        if not isinstance(status, str) or not status.strip():
            raise HTTPException(status_code=400, detail="status richiesto (pending|approved|revoked)")
        note = body.get("note") if isinstance(body.get("note"), str) else None
        try:
            meta = tf.set_tester_status(tester_id, status, note=note)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return _json_safe({"ok": True, "tester": meta})

    @application.post("/api/tester-feedback/testers/{tester_id}/resend-approval-email")
    async def tester_feedback_resend_approval_email(tester_id: str) -> dict[str, Any]:
        import tester_feedback_io as tf

        try:
            meta = tf.resend_tester_approval_email(tester_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return _json_safe({"ok": True, "tester": meta})

    @application.delete("/api/tester-feedback/testers/{tester_id}")
    def tester_feedback_delete(tester_id: str) -> dict[str, Any]:
        import tester_feedback_io as tf

        try:
            out = tf.delete_tester(tester_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return _json_safe({"ok": True, **out})

    @application.get("/api/tester-feedback/testers/{tester_id}/sim-inputs")
    def tester_sim_inputs_get(tester_id: str) -> dict[str, Any]:
        import tester_sim_inputs_io as tsi

        try:
            return _json_safe(tsi.load_sim_inputs(tester_id))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @application.put("/api/tester-feedback/testers/{tester_id}/sim-inputs")
    async def tester_sim_inputs_put(tester_id: str, body: dict[str, Any]) -> dict[str, Any]:
        import tester_sim_inputs_io as tsi

        raw = body.get("inputs")
        if raw is not None and not isinstance(raw, dict):
            raise HTTPException(status_code=400, detail="inputs deve essere un oggetto")
        inputs = raw if isinstance(raw, dict) else {}
        src = body.get("source") if isinstance(body.get("source"), str) else "mobile"
        try:
            saved = tsi.save_sim_inputs(tester_id, inputs, source=src)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return _json_safe({"ok": True, **saved})

    @application.post("/api/tester-feedback/events")
    async def tester_feedback_append(body: dict[str, Any]) -> dict[str, Any]:
        import tester_feedback_io as tf

        tid = body.get("tester_id")
        if not isinstance(tid, str) or not tid.strip():
            raise HTTPException(status_code=400, detail="tester_id richiesto")
        module = body.get("module")
        kind = body.get("kind")
        if not isinstance(module, str) or not isinstance(kind, str):
            raise HTTPException(status_code=400, detail="module e kind richiesti")
        try:
            event = tf.append_event(
                tester_id=tid,
                module=module,
                kind=kind,
                source=body.get("source") if isinstance(body.get("source"), str) else "mobile",
                ticker=body.get("ticker") if isinstance(body.get("ticker"), str) else None,
                payload=body.get("payload") if isinstance(body.get("payload"), dict) else {},
                display_name=body.get("display_name") if isinstance(body.get("display_name"), str) else None,
            )
        except ValueError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        return _json_safe({"ok": True, "event": event})

    @application.get("/api/tester-feedback/export")
    def tester_feedback_export() -> dict[str, Any]:
        import tester_feedback_io as tf

        return _json_safe(tf.build_calibration_document())

    @application.post("/api/tester-feedback/export/snapshot")
    def tester_feedback_export_snapshot() -> dict[str, Any]:
        import tester_feedback_io as tf

        return _json_safe(tf.save_calibration_snapshot())

    @application.get("/api/mobile/dashboard-snapshot")
    def mobile_dashboard_snapshot_get() -> dict[str, Any]:
        p = MOBILE_DASHBOARD_SNAPSHOT_PATH
        if not p.is_file():
            return {"version": 1, "updated_at": None, "source": "missing"}
        try:
            with p.open(encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, json.JSONDecodeError) as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        if not isinstance(data, dict):
            return {"version": 1, "updated_at": None, "source": "invalid"}
        return _json_safe(data)

    @application.put("/api/mobile/dashboard-snapshot")
    async def mobile_dashboard_snapshot_put(body: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="body deve essere un oggetto JSON")
        payload = {
            "version": 1,
            "updated_at": datetime.now().astimezone().isoformat(),
            **{k: v for k, v in body.items() if k not in ("version", "updated_at")},
        }
        p = MOBILE_DASHBOARD_SNAPSHOT_PATH
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".json.tmp")
        try:
            tmp.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            tmp.replace(p)
        except OSError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        return _json_safe({"ok": True, "path": str(p), "updated_at": payload["updated_at"]})

    @application.get("/api/mobile-host/config")
    def mobile_host_config() -> dict[str, Any]:
        """Metadati per SuperNova Short in hosting v3 (HTTPS / token)."""
        mobile_path: str | None
        if c.serve_mobile and not c.serve_desktop:
            mobile_path = "/"
        elif c.serve_desktop and not c.serve_mobile:
            mobile_path = "/mobile/"
        else:
            mobile_path = None
        same_origin_api = bool(
            (c.serve_mobile and not c.serve_desktop)
            or (c.serve_desktop and mobile_path == "/mobile/")
        )
        return {
            "mode": "v3" if c.serve_mobile else ("hosted" if same_origin_api else "dev"),
            "api_token_required": bool(c.api_token),
            "same_origin_pwa": bool(c.serve_mobile),
            "same_origin_api": same_origin_api,
            "mobile_web_path": mobile_path,
        }

    @application.get("/api/scoring/{ticker}")
    def scoring_ticker(
        ticker: str,
        fetch_short: bool = Query(False, description="Fetch short float from FMP if API key set"),
    ) -> dict[str, Any]:
        """Composite stock score (-100..+100) with BUY/HOLD/SELL recommendation."""
        from prediction.scoring_data import score_ticker_from_cache

        try:
            return _json_safe(score_ticker_from_cache(ticker, fetch_short=fetch_short))
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @application.get("/api/sds/cohort")
    def sds_cohort(
        fetch_short: bool = Query(False),
        fetch_fmp: bool = Query(False),
        fetch_cluster_a: bool = Query(False),
        refresh: bool = Query(False),
    ) -> dict[str, Any]:
        from prediction.sds_data import (
            compute_sds_cohort,
            is_sds_snapshot_degraded,
            load_sds_snapshot,
            load_sds_snapshot_good,
            save_sds_snapshot,
        )

        use_fmp = fetch_fmp or fetch_short
        use_cluster_a = fetch_cluster_a or refresh or use_fmp
        if refresh or use_fmp or fetch_cluster_a:
            doc = compute_sds_cohort(fetch_fmp=use_fmp, fetch_cluster_a=use_cluster_a)
            save_sds_snapshot(doc)
            if is_sds_snapshot_degraded(doc):
                fallback = load_sds_snapshot()
                if fallback.get("rows") and not is_sds_snapshot_degraded(fallback):
                    return _json_safe(fallback)
                good = load_sds_snapshot_good()
                if good.get("rows"):
                    return _json_safe(good)
            return _json_safe(doc)
        cached = load_sds_snapshot()
        if cached.get("rows") and not is_sds_snapshot_degraded(cached):
            return _json_safe(cached)
        good = load_sds_snapshot_good()
        if good.get("rows") and not is_sds_snapshot_degraded(good):
            return _json_safe(good)
        if good.get("rows"):
            return _json_safe(good)
        if cached.get("rows"):
            return _json_safe(cached)
        raise HTTPException(
            status_code=503,
            detail="SDS snapshot missing or degraded — POST /api/sds/refresh with FMP key loaded.",
        )

    @application.post("/api/sds/refresh")
    def sds_refresh(
        fetch_short: bool = Query(False),
        fetch_fmp: bool = Query(False),
        fetch_cluster_a: bool = Query(True),
    ) -> dict[str, Any]:
        from prediction.sds_data import is_sds_snapshot_degraded, load_sds_snapshot, refresh_sds_cohort_full

        use_fmp = fetch_fmp or fetch_short
        result = refresh_sds_cohort_full(fetch_fmp=use_fmp, fetch_cluster_a=fetch_cluster_a or use_fmp)
        doc = result["doc"]
        if is_sds_snapshot_degraded(doc):
            fallback = load_sds_snapshot()
            if fallback.get("rows") and not is_sds_snapshot_degraded(fallback):
                return _json_safe(fallback)
        return _json_safe(doc)

    @application.post("/api/sds/refresh-light")
    def sds_refresh_light() -> dict[str, Any]:
        """SDS light refresh — Cluster C+E from fresh prices/live; A/B/D from cache."""
        from prediction.sds_data import is_sds_snapshot_degraded, load_sds_snapshot, refresh_sds_cohort_light

        result = refresh_sds_cohort_light()
        doc = result["doc"]
        if is_sds_snapshot_degraded(doc):
            fallback = load_sds_snapshot()
            if fallback.get("rows") and not is_sds_snapshot_degraded(fallback):
                return _json_safe(fallback)
        payload = dict(doc)
        payload["refresh_mode"] = "light"
        return _json_safe(payload)

    @application.post("/api/sds/sync-simulation")
    def sds_sync_simulation(
        fetch_short: bool = Query(False),
        fetch_fmp: bool = Query(False),
        fetch_cluster_a: bool = Query(False),
    ) -> dict[str, Any]:
        """SDS sync when Simulation cohort changes (new pre-CD entrants get FMP if requested)."""
        from prediction.sds_data import (
            is_sds_snapshot_degraded,
            load_sds_snapshot,
            load_sds_snapshot_good,
            sync_sds_after_simulation,
        )

        use_fmp = fetch_fmp or fetch_short
        result = sync_sds_after_simulation(fetch_fmp=use_fmp, fetch_cluster_a=fetch_cluster_a or use_fmp)
        doc = result["doc"]
        if is_sds_snapshot_degraded(doc):
            fallback = load_sds_snapshot()
            if fallback.get("rows") and not is_sds_snapshot_degraded(fallback):
                return _json_safe(fallback)
            good = load_sds_snapshot_good()
            if good.get("rows") and not is_sds_snapshot_degraded(good):
                return _json_safe(good)
        payload = dict(doc)
        if result.get("added_tickers"):
            payload["added_tickers"] = result["added_tickers"]
        if result.get("removed_tickers"):
            payload["removed_tickers"] = result["removed_tickers"]
        return _json_safe(payload)

    @application.post("/api/sds/restore-backup")
    def sds_restore_backup() -> dict[str, Any]:
        from prediction.sds_data import restore_sds_snapshot_from_backup

        return _json_safe(restore_sds_snapshot_from_backup())

    @application.get("/api/sds/{ticker}")
    def sds_ticker(
        ticker: str,
        fetch_short: bool = Query(False),
        fetch_fmp: bool = Query(False),
        fetch_cluster_a: bool = Query(False),
    ) -> dict[str, Any]:
        from prediction.sds_data import compute_sds_for_ticker

        use_fmp = fetch_fmp or fetch_short
        return _json_safe(
            compute_sds_for_ticker(
                ticker,
                fetch_fmp=use_fmp,
                fetch_cluster_a=fetch_cluster_a or use_fmp,
            )
        )

    @application.post("/api/scoring/compute")
    def scoring_compute(body: dict[str, Any]) -> dict[str, Any]:
        """Score from explicit payload (closes, volumes, fundamentals)."""
        from prediction.scoring_engine import ScoringInput, score_stock

        ticker = str(body.get("ticker") or "UNKNOWN").upper()
        data = ScoringInput(
            closes=list(body.get("closes") or []),
            volumes=list(body.get("volumes") or []),
            highs=list(body.get("highs") or []),
            lows=list(body.get("lows") or []),
            beta=body.get("beta"),
            xbi_closes=list(body.get("xbi_closes") or []),
            short_interest_pct=body.get("short_interest_pct"),
            days_to_cover=body.get("days_to_cover"),
            cash_runway_months=body.get("cash_runway_months"),
            catalyst_days_to_event=body.get("catalyst_days_to_event"),
            post_event_drop_pct=body.get("post_event_drop_pct"),
            price_drop_48h_pct=body.get("price_drop_48h_pct"),
            clinical_phase_num=body.get("clinical_phase_num"),
            phase_success_prob=body.get("phase_success_prob"),
            has_near_term_catalyst=body.get("has_near_term_catalyst"),
        )
        return _json_safe(score_stock(ticker, data).to_dict())

    _mount_mobile_web_subpath(application, c)
    _mount_desktop_web(application, c)
    _mount_mobile_short_pwa(application, c)
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
