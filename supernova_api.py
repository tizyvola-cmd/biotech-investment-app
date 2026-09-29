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
| SUPERNOVA_API_TOKEN         | (unset)  | Se impostato: header ``X-SuperNova-Token``   |
|                             |          | su POST/PUT/PATCH/DELETE (salvo esenzioni     |
|                             |          | tester) + GET admin (summary/events/export/   |
|                             |          | sim-inputs/secrets). Obbligatorio su host     |
|                             |          | pubblico salvo ``SUPERNOVA_ALLOW_INSECURE=1``.|
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
| SUPERNOVA_MORNING_REFRESH   | (off)    | ``1`` → Lun–Ven 07:00 CD + IPO + hype volume   |
| SUPERNOVA_API_PERF          | (off)    | ``1`` → log ``[API-PERF]`` per ogni request   |
|                             |          | HTTP + header ``X-Response-Time-Ms``          |
| SUPERNOVA_VAPID_PUBLIC      | (unset)  | Web Push public key (mobile Soft BUY/SELL)    |
| SUPERNOVA_VAPID_PRIVATE     | (unset)  | Web Push private key                          |
| SUPERNOVA_VAPID_SUBJECT     | mailto:… | VAPID ``sub`` claim (mailto: or https:)       |
+-----------------------------+----------+-----------------------------------------------+

CORS di default: ``http://127.0.0.1:*``, ``http://localhost:*`` (regex),
``Origin: null`` (Electron ``file://``) e ``SUPERNOVA_PUBLIC_HOST`` (VPS web).
Non include origini web arbitrarie.
Senza token configurato viene loggato un avviso una tantum; le richieste mutanti restano
aperte (comodo in sviluppo). Impostare ``SUPERNOVA_API_TOKEN`` in produzione locale se
l'API può essere raggiunta da altri processi sulla macchina.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import subprocess
import sys
import threading
import time
from datetime import date, datetime
from pathlib import Path
from typing import Any

# Load .env file before anything else reads os.environ
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env", override=False)
except ImportError:
    pass

from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
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
    TOKEN_HEADER,
    SupernovaConfig,
    cors_allow_origin_regex,
    get_supernova_config,
)

logger = logging.getLogger("supernova.api")

ROOT = Path(_paths.project_root())
PYTHON = Path(PYTHON_VENV_EXE)
ORCHESTRATOR = Path(ORCHESTRATOR_SCRIPT)

_MUTATING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
# Paths that may mutate WITHOUT the admin token (testers / companion).
# Everything else mutating requires SUPERNOVA_API_TOKEN when configured.
# Admin-readable tester PII (summary/events/export) is NEVER exempt — see
# ``_TOKEN_PROTECTED_GET_PATHS``.
_TOKEN_EXEMPT_MUTATING_PATHS = frozenset({
    "/api/tester-feedback/testers/register",
    # Testers report session_ping / ui_error without the owner token.
    "/api/tester-feedback/events",
    # Calendar free-text insert (desktop Calendar tab for approved testers).
    "/api/simulation/manual-entries",
    # Catalyst interest watchlist enroll.
    "/api/catalyst-interest",
    # Precomputed market quotes (financial snapshot) — cheap read, no Yahoo fan-out.
    "/api/quotes/batch",
    # Daily News desk — read/refresh helpers used by Catalyst Days (no LLM brief/analyze here).
    "/api/market/daily-news/refresh",
    "/api/market/daily-news/top",
    "/api/market/daily-news/dismiss",
    "/api/market/catalyst-outcomes/resolved",
})

# Expensive rebuild — admin token OR approved tester session (not anonymous).
_MOBILE_SNAPSHOT_REFRESH_PATH = "/api/mobile/dashboard-snapshot/refresh"

# GET routes that expose tester PII / portfolio / secrets — always need admin token.
_TOKEN_PROTECTED_GET_PATHS = frozenset({
    "/api/tester-feedback/summary",
    "/api/tester-feedback/events",
    "/api/tester-feedback/export",
    "/api/tester-feedback/sim-monitor",
    "/api/ai/secrets",
    "/api/investment/sim-inputs",
    "/api/premium-waitlist",
    "/api/hitech-notify",
})

# Expensive / AI / orchestrator mutations — NEVER exempt (admin token only).
_TOKEN_NEVER_EXEMPT_PREFIXES = (
    "/api/ai/",
    "/api/orchestrator/",
    "/api/refresh/",
    "/api/market/daily-news/analyze",
    "/api/market/daily-news/brief",
    "/api/market/daily-news/migrate",
    "/api/market/catalyst-outcomes/scan",
    "/api/hype-volume-funnel/scan",
)

# Deep Dive product sheet + Daily News digests — admin token OR approved tester session.
# (Gemini runs on the server; testers must not wait for the owner to open a modal first.)
_DESK_TESTER_SESSION_OK_PREFIXES = (
    "/api/desk/",
)
_TESTER_SESSION_OK_EXACT_PATHS = frozenset({
    "/api/market/daily-news/brief",
    "/api/market/daily-news/analyze",
    "/api/mobile/dashboard-snapshot/refresh",
})


def _token_exempt_path(path: str, method: str = "GET") -> bool:
    method_u = method.upper()
    for prefix in _TOKEN_NEVER_EXEMPT_PREFIXES:
        if path == prefix or path.startswith(prefix):
            return False
    # Snapshot rebuild is expensive — never anonymous (session or admin token).
    if path == _MOBILE_SNAPSHOT_REFRESH_PATH:
        return False
    # Premium waitlist join is public; listing is owner-token only.
    if path == "/api/premium-waitlist":
        return method_u == "POST"
    # Hi-Tech notify signup is public; listing is owner-token only.
    if path == "/api/hitech-notify":
        return method_u == "POST"
    if method_u in _MUTATING_METHODS:
        if path in _TOKEN_EXEMPT_MUTATING_PATHS:
            return True
        # DELETE /api/catalyst-interest/{ticker}
        if path.startswith("/api/catalyst-interest/"):
            return True
        # Per-tester portfolio — auth checked in-route (admin token OR tester session).
        # Still listed here so the global admin-token middleware does not 401 first.
        if path.startswith("/api/tester-feedback/testers/") and path.endswith("/sim-inputs"):
            return True
        # Issue device session after sign-in / register.
        if path.startswith("/api/tester-feedback/testers/") and path.endswith("/session"):
            return True
        return False
    return False


def _token_required_for_get(path: str) -> bool:
    if path in _TOKEN_PROTECTED_GET_PATHS:
        return True
    if path.startswith("/api/tester-feedback/testers/") and path.endswith("/access"):
        return False
    return False


def _request_has_admin_token(request: Request) -> bool:
    cfg = get_supernova_config()
    if not cfg.api_token:
        return False
    header = request.headers.get(TOKEN_HEADER) or ""
    if header and header == cfg.api_token:
        return True
    auth = request.headers.get("authorization") or ""
    if auth.lower().startswith("bearer ") and auth[7:].strip() == cfg.api_token:
        return True
    return False


def _require_tester_book_auth(request: Request, tester_id: str) -> None:
    """Admin API token OR matching tester device session."""
    if _request_has_admin_token(request):
        return
    import tester_feedback_io as tf

    sess = request.headers.get(tf.TESTER_SESSION_HEADER) or request.headers.get(
        "x-supernova-tester-session"
    )
    if tf.verify_tester_session(tester_id, sess):
        return
    raise HTTPException(
        status_code=401,
        detail="Tester session or admin API token required for this portfolio",
    )


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
MOBILE_CURVE_CHARTS_PATH = Path(DATA_DIR) / "mobile_curve_charts.json"
WHATIF_READOUT_DAILY_SNAPSHOT_PATH = Path(DATA_DIR) / "whatif_readout_daily_snapshot.json"


def _subprocess_alive(proc: subprocess.Popen | None) -> bool:
    """True while the child PID is still running (handles Windows zombie handles)."""
    if proc is None:
        return False
    code = proc.poll()
    if code is not None:
        return False
    pid = proc.pid
    if pid is None or pid <= 0:
        return False
    if sys.platform == "win32":
        try:
            import ctypes

            PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
            STILL_ACTIVE = 259
            kernel32 = ctypes.windll.kernel32
            handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
            if not handle:
                return False
            try:
                exit_code = ctypes.c_ulong()
                if kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)):
                    return exit_code.value == STILL_ACTIVE
                return False
            finally:
                kernel32.CloseHandle(handle)
        except Exception:
            return proc.poll() is None
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return proc.poll() is None
    return True


def _reconcile_refresh_subprocess() -> bool:
    """Drop stale refresh handles; return True iff refresh child is still alive."""
    global _refresh_proc, _refresh_exit_code
    with _run_lock:
        if _refresh_proc is None:
            return False
        if _subprocess_alive(_refresh_proc):
            return True
        code = _refresh_proc.poll()
        _refresh_exit_code = code if code is not None else (_refresh_exit_code if _refresh_exit_code is not None else 0)
        _refresh_proc = None
        return False


def _background_job_running() -> bool:
    try:
        import process_runtime as _pr

        cross = (
            _pr.orchestrator_running()
            or _pr.refresh_running()
            or _pr.read_job(_pr.CD_SCAN_PATH) is not None
        )
    except Exception:
        cross = False
    return bool(
        (_proc is not None and _subprocess_alive(_proc))
        or _reconcile_refresh_subprocess()
        or (_cd_scan_proc is not None and _subprocess_alive(_cd_scan_proc))
        or cross
    )


def _weekly_full_pipeline_running() -> bool:
    """True se cron/scheduler sta eseguendo WeeklyFull (lock o processo orchestrator)."""
    # Prefer last_run: if WeeklyFull already completed, never report running
    # just because a lock file or a stray pgrep match is left behind.
    last = _load_weekly_full_last_run()
    finished_at = str(last.get("finished_at") or "").strip() if last else ""
    if last.get("ok") is True and finished_at:
        try:
            fin = datetime.fromisoformat(finished_at.replace("Z", "+00:00"))
            fin_ts = fin.timestamp() if fin.tzinfo is not None else time.mktime(fin.timetuple())
            age_min = (time.time() - fin_ts) / 60.0
            # Completed more than 10 minutes ago → idle (stale lock / orphan pgrep).
            if age_min >= 10:
                return False
        except (ValueError, OverflowError, OSError):
            pass

    lock = Path(DATA_DIR) / ".refresh_running.lock"
    if lock.is_file():
        try:
            age_min = (time.time() - lock.stat().st_mtime) / 60.0
            if age_min < 150:
                return True
        except OSError:
            pass
    if sys.platform != "win32":
        for pattern in ("data_orchestrator.py", "saturday_weekly_full_refresh.py"):
            try:
                r = subprocess.run(
                    ["pgrep", "-f", pattern],
                    capture_output=True,
                    timeout=5,
                    check=False,
                )
                if r.returncode == 0:
                    return True
            except (OSError, subprocess.TimeoutExpired):
                pass
    return False


def _load_weekly_full_last_run() -> dict[str, Any]:
    p = Path(DATA_DIR) / "saturday_weekly_full_last_run.json"
    if not p.is_file():
        return {}
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
        return doc if isinstance(doc, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


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
    public_host = bool(cfg.serve_desktop or cfg.serve_mobile or cfg.bind_all)
    allow_insecure = os.environ.get("SUPERNOVA_ALLOW_INSECURE", "").strip() in (
        "1",
        "true",
        "yes",
    )
    if public_host and not cfg.api_token and not allow_insecure:
        raise RuntimeError(
            "SUPERNOVA_API_TOKEN obbligatorio su host pubblico "
            "(SERVE_DESKTOP / SERVE_MOBILE / BIND_ALL). "
            "Imposta il token oppure SUPERNOVA_ALLOW_INSECURE=1 solo in dev."
        )
    if cfg.api_token:
        logger.info(
            "SUPERNOVA_API_TOKEN configurato: mutazioni + GET admin (tester PII / portfolio)."
        )
    else:
        logger.warning(
            "SUPERNOVA_API_TOKEN non configurato: route mutanti senza autenticazione."
        )


def _extract_request_token(scope: Scope) -> str | None:
    for key, value in scope.get("headers", ()):
        kl = key.lower()
        if kl == TOKEN_HEADER.lower().encode():
            return value.decode("latin-1")
        if kl == b"authorization":
            raw = value.decode("latin-1")
            if raw.lower().startswith("bearer "):
                return raw[7:].strip()
    return None


def _extract_tester_session_from_scope(scope: Scope) -> str | None:
    for key, value in scope.get("headers", ()):
        kl = key.lower()
        if kl in (b"x-supernova-tester-session", b"x-supernova-tester_session"):
            raw = value.decode("latin-1").strip()
            return raw or None
    return None


def _path_allows_tester_session(path: str) -> bool:
    if path in _TESTER_SESSION_OK_EXACT_PATHS:
        return True
    for prefix in _DESK_TESTER_SESSION_OK_PREFIXES:
        if path == prefix.rstrip("/") or path.startswith(prefix):
            return True
    return False


def _scope_has_approved_tester_session(scope: Scope) -> bool:
    sess = _extract_tester_session_from_scope(scope)
    if not sess:
        return False
    try:
        import tester_feedback_io as tf

        return tf.find_tester_id_by_session(sess) is not None
    except Exception:
        return False


class _LocalTokenMiddleware:
    """Require X-SuperNova-Token on mutating + sensitive GET routes when token is set.

    Deep Dive ``/api/desk/*`` and Daily News brief/analyze also accept an approved
    tester device session (testers do not have the owner API token).
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        method = scope.get("method", "GET")
        path = scope.get("path", "")
        cfg = get_supernova_config()
        need_token = False
        if method in _MUTATING_METHODS:
            if cfg.api_token and not _token_exempt_path(path, method):
                need_token = True
        elif method == "GET" and cfg.api_token and _token_required_for_get(path):
            need_token = True
        if need_token:
            token = _extract_request_token(scope)
            ok = bool(token and token == cfg.api_token)
            if (
                not ok
                and method in _MUTATING_METHODS
                and _path_allows_tester_session(path)
                and _scope_has_approved_tester_session(scope)
            ):
                ok = True
            if not ok:
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


class _RateLimitMiddleware:
    """In-process sliding window per client IP for anonymous / busy paths."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        self._hits: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def _client_ip(self, scope: Scope) -> str:
        for key, value in scope.get("headers", ()):
            if key.lower() == b"x-forwarded-for":
                raw = value.decode("latin-1").split(",")[0].strip()
                if raw:
                    return raw[:64]
        client = scope.get("client")
        if client and client[0]:
            return str(client[0])[:64]
        return "unknown"

    def _limit_for(self, path: str, method: str) -> tuple[int, float] | None:
        if path == "/api/tester-feedback/testers/register":
            return (20, 60.0)
        if path == "/api/tester-feedback/events":
            return (120, 60.0)
        if path.startswith("/api/tester-feedback/testers/") and path.endswith("/session"):
            return (30, 60.0)
        if path.startswith("/api/tester-feedback/testers/") and path.endswith("/sim-inputs"):
            return (90, 60.0)
        if path.startswith("/api/market/daily-news/"):
            return (60, 60.0)
        if path == "/api/mobile/dashboard-snapshot/refresh":
            return (3, 60.0)
        if path.startswith("/api/desk/"):
            return (30, 60.0)
        if path.startswith("/api/catalyst-interest"):
            return (40, 60.0)
        if path.startswith("/api/hype-volume-funnel"):
            return (10, 60.0)
        if path == "/api/premium-waitlist" and method.upper() == "POST":
            return (10, 60.0)
        if path == "/api/hitech-notify" and method.upper() == "POST":
            return (10, 60.0)
        return None

    def _allow(self, key: str, max_hits: int, window: float) -> bool:
        now = time.time()
        with self._lock:
            bucket = [t for t in (self._hits.get(key) or []) if now - t < window]
            if len(bucket) >= max_hits:
                self._hits[key] = bucket
                return False
            bucket.append(now)
            self._hits[key] = bucket
            if len(self._hits) > 5000:
                stale = [k for k, v in self._hits.items() if not v or now - v[-1] > 300]
                for k in stale[:500]:
                    self._hits.pop(k, None)
            return True

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path = scope.get("path", "")
        method = scope.get("method", "GET")
        rule = self._limit_for(path, method)
        if rule is None:
            await self.app(scope, receive, send)
            return
        max_hits, window = rule
        ip = self._client_ip(scope)
        key = f"{ip}|{method}|{path}"
        if not self._allow(key, max_hits, window):
            response = JSONResponse(
                {"detail": "Rate limit exceeded — retry shortly"},
                status_code=429,
                headers={"Retry-After": "30"},
            )
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)


class _AiUserBudgetMiddleware:
    """Daily shared-Gemini budget per tester (or IP) on expensive AI routes.

    Admin API token bypasses the budget so owner prefetch / ops are not capped.
    """

    _PATHS = frozenset({
        "/api/market/daily-news/brief",
        "/api/market/daily-news/analyze",
        "/api/hype-volume-funnel/scan",
    })

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    def _client_ip(self, scope: Scope) -> str:
        for key, value in scope.get("headers", ()):
            if key.lower() == b"x-forwarded-for":
                raw = value.decode("latin-1").split(",")[0].strip()
                if raw:
                    return raw[:64]
        client = scope.get("client")
        if client and client[0]:
            return str(client[0])[:64]
        return "unknown"

    def _applies(self, path: str, method: str) -> bool:
        if method.upper() != "POST":
            return False
        if path in self._PATHS:
            return True
        if path.startswith("/api/desk/"):
            return True
        return False

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path = scope.get("path", "")
        method = scope.get("method", "GET")
        if not self._applies(path, method):
            await self.app(scope, receive, send)
            return
        cfg = get_supernova_config()
        token = _extract_request_token(scope)
        if cfg.api_token and token and token == cfg.api_token:
            await self.app(scope, receive, send)
            return
        import ai_user_budget as _aub

        sess = _extract_tester_session_from_scope(scope)
        tester_id = None
        if sess:
            try:
                import tester_feedback_io as tf

                tester_id = tf.find_tester_id_by_session(sess)
            except Exception:
                tester_id = None
        key = _aub.budget_key(tester_id=tester_id, client_ip=self._client_ip(scope))
        ok, meta = _aub.allow(key)
        if not ok:
            response = JSONResponse(
                {
                    "detail": "AI daily budget exceeded — retry tomorrow or use cached briefs",
                    "budget": meta,
                },
                status_code=429,
                headers={"Retry-After": str(meta.get("retry_after_s") or 3600)},
            )
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)


def _api_perf_enabled() -> bool:
    return os.environ.get("SUPERNOVA_API_PERF", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )


#: Endpoints that always get a log line in addition to the response-time
#: header, regardless of ``SUPERNOVA_API_PERF``. Used for the perf remeasure
#: after the learning-lab snapshot landed — comparing this ``handler_ms`` to
#: the client-observed latency shows whether the gap is queueing or compute.
_ALWAYS_LOG_PERF_PATHS = frozenset(
    {
        "/api/health",
        "/api/investment/sim-outcomes",
        "/api/models/learning-lab/overview",
    }
)


class _ApiPerfMiddleware:
    """Measure request duration.

    - Always attaches ``X-Response-Time-ms`` to every response so the
      renderer's Network panel can compare handler duration against
      client-observed latency (the gap is transport-layer queueing).
    - Emits a log line for the three watched endpoints unconditionally, and
      for every other endpoint only when ``SUPERNOVA_API_PERF=1``.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        method = scope.get("method", "GET")
        path = scope.get("path", "")
        query = scope.get("query_string", b"").decode("latin-1")
        route = f"{path}?{query}" if query else path
        t0 = time.perf_counter()
        status_code = 500

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                headers: list[tuple[bytes, bytes]] = list(message.get("headers", ()))
                elapsed_ms = (time.perf_counter() - t0) * 1000.0
                headers.append(
                    (b"x-response-time-ms", f"{elapsed_ms:.1f}".encode("ascii"))
                )
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            elapsed_ms = (time.perf_counter() - t0) * 1000.0
            if _api_perf_enabled() or path in _ALWAYS_LOG_PERF_PATHS:
                logger.info(
                    "[API-PERF] %s %s handler_ms=%.1f status=%s",
                    method,
                    route,
                    elapsed_ms,
                    status_code,
                )
#: Custom response headers the browser is allowed to read via
#: ``response.headers.get(...)``. Without this the renderer's Network panel
#: can still show ``X-Response-Time-ms`` (it always sees raw response
#: headers), but any programmatic reader would be blocked by CORS.
_CORS_EXPOSED_HEADERS = ["X-Response-Time-ms", "ETag"]


def _configure_cors(app: FastAPI, cfg: SupernovaConfig) -> None:
    if cfg.cors_permissive:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_methods=["*"],
            allow_headers=["*"],
            expose_headers=_CORS_EXPOSED_HEADERS,
        )
    elif cfg.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(cfg.cors_origins),
            allow_methods=["*"],
            allow_headers=["*"],
            expose_headers=_CORS_EXPOSED_HEADERS,
        )
    else:
        # "null" = renderer Electron (file://) verso API su 127.0.0.1
        # Public host (SUPERNOVA_PUBLIC_HOST) so VPS web Origin is allowed on preflight.
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["null"],
            allow_origin_regex=cors_allow_origin_regex(),
            allow_methods=["*"],
            allow_headers=["*"],
            expose_headers=_CORS_EXPOSED_HEADERS,
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
    """Serve solo snapshot pubblici da ``data/`` su ``/project-data/`` (allowlist)."""
    data_root = Path(DATA_DIR).resolve()

    @application.get("/project-data/{rel_path:path}")
    def serve_project_data(rel_path: str) -> FileResponse:
        from cdn_snapshots import (
            cache_control_for_project_path,
            is_public_project_data_path,
        )

        rel = rel_path.split("?")[0].replace("\\", "/").lstrip("/")
        if not is_public_project_data_path(rel):
            # Do not confirm whether a private file exists on disk.
            # no-store so edge caches cannot keep a prior 200 for secrets.
            return JSONResponse(
                status_code=404,
                content={"detail": "not found"},
                headers={"Cache-Control": "no-store, max-age=0, must-revalidate"},
            )
        file_path = (data_root / rel).resolve()
        try:
            file_path.relative_to(data_root)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="bad path") from exc
        if not file_path.is_file():
            raise HTTPException(status_code=404, detail="not found")
        media = "application/json; charset=utf-8"
        resp = FileResponse(file_path, media_type=media)
        resp.headers["Cache-Control"] = cache_control_for_project_path(rel)
        # Edge caches (Cloudflare) need Vary only on Accept-Encoding (GZip).
        resp.headers.setdefault("Vary", "Accept-Encoding")
        return resp


def _register_cdn_routes(application: FastAPI) -> None:
    """Content-addressed snapshot objects + manifest (CDN / edge ready)."""

    @application.get("/cdn/o/{sha_name}")
    def serve_cdn_object(sha_name: str) -> FileResponse:
        from cdn_snapshots import cache_control_for_cdn_object, resolve_cdn_object

        raw = (sha_name or "").split("?")[0]
        digest = raw[:-5] if raw.lower().endswith(".json") else raw
        path = resolve_cdn_object(digest)
        if path is None:
            raise HTTPException(status_code=404, detail="not found")
        resp = FileResponse(path, media_type="application/json; charset=utf-8")
        resp.headers["Cache-Control"] = cache_control_for_cdn_object()
        resp.headers.setdefault("Vary", "Accept-Encoding")
        return resp

    @application.get("/api/cdn/manifest")
    def cdn_manifest() -> JSONResponse:
        from cdn_snapshots import load_manifest

        return JSONResponse(
            content=load_manifest(),
            headers={
                "Cache-Control": "public, max-age=30, stale-while-revalidate=60",
            },
        )

    @application.post("/api/cdn/publish")
    def cdn_publish(upload: bool = Query(False)) -> dict[str, Any]:
        """Rebuild hashed objects (+ optional R2/S3 upload). Admin token required."""
        from cdn_snapshots import publish_local_objects, upload_objects_to_s3

        doc = publish_local_objects()
        out: dict[str, Any] = {"ok": True, "manifest": doc}
        if upload:
            out["s3"] = upload_objects_to_s3(doc)
        return out


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
                rel = (path or "").lstrip("/")
                media = (response.headers.get("content-type") or "").lower()
                # `/` resolves via directory→index.html with path=="" — always
                # no-store HTML shells so deploys are visible without hard-refresh wars.
                if "text/html" in media or rel in ("", "index.html"):
                    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
                    response.headers["Pragma"] = "no-cache"
                    response.headers["Expires"] = "0"
                    for key in ("etag", "ETag", "last-modified", "Last-Modified"):
                        try:
                            del response.headers[key]
                        except KeyError:
                            pass
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
        try:
            import tester_feedback_io as _tf

            purged = _tf.purge_non_owner_testers()
            if purged.get("count"):
                logger.info("Purged non-owner tester accounts: %s", purged.get("removed"))
        except Exception as exc:
            logger.warning("tester purge skipped: %s", exc)
        sched_stop: threading.Event | None = None
        try:
            import ai_secrets_store as _ai_sec

            _ai_sec.load_and_apply()
        except Exception as exc:
            logger.warning("ai_secrets_store load skipped: %s", exc)
        try:
            import supernova_pg as _pg

            if _pg.enabled():
                # Never block API boot on a slow/locked Postgres migration.
                def _pg_boot() -> None:
                    try:
                        _pg.ensure_schema()
                        logger.info("Postgres backend enabled for tester store")
                    except Exception as exc2:
                        logger.warning("Postgres ensure_schema failed: %s", exc2)

                threading.Thread(target=_pg_boot, name="pg-ensure-schema", daemon=True).start()
        except Exception as exc:
            logger.warning("Postgres init skipped: %s", exc)

        sched_enabled = (
            c.hourly_financial_enabled
            or c.morning_refresh_enabled
            or c.sds_refresh_enabled
            or c.eis_refresh_enabled
            or c.scheduled_refresh_minutes > 0
            or c.daily_refresh_hour >= 0
            or c.trends_enabled
        )
        if sched_enabled and not os.environ.get("PYTEST_CURRENT_TEST"):
            try:
                import process_runtime as _pr

                if _pr.try_acquire_scheduler_lock():
                    from supernova_web_scheduler import start_web_scheduler

                    sched_stop = start_web_scheduler(c)
                    logger.info("web scheduler started (worker pid=%s)", os.getpid())
                else:
                    logger.info(
                        "web scheduler skipped — another worker holds the lock (pid=%s)",
                        os.getpid(),
                    )
            except Exception as exc:
                logger.warning("web scheduler skipped: %s", exc)

        def _warm_learning_lab_cache() -> None:
            # If the on-disk snapshot exists (normal case after the first
            # orchestrator run or after this warm-up has ever completed)
            # this is a ~20 ms JSON parse that primes the mtime cache. If it
            # is missing (first boot after this change lands) we build AND
            # persist it, so every subsequent boot goes on the fast path
            # without needing a one-off migration.
            try:
                from prediction.learning_lab import (
                    read_learning_lab_overview_snapshot,
                    write_learning_lab_overview_snapshot,
                )

                if read_learning_lab_overview_snapshot() is not None:
                    logger.info("learning-lab overview snapshot found — mtime cache primed")
                    return
                write_learning_lab_overview_snapshot()
                logger.info(
                    "learning-lab overview snapshot missing — built and persisted "
                    "at boot (subsequent boots will be ~20 ms)"
                )
            except Exception as exc:
                logger.warning("learning-lab cache warm skipped: %s", exc)

        threading.Thread(
            target=_warm_learning_lab_cache, name="ll-cache-warm", daemon=True
        ).start()
        yield
        if sched_stop is not None:
            sched_stop.set()
        try:
            import process_runtime as _pr

            _pr.release_scheduler_lock()
        except Exception:
            pass

    application = FastAPI(title="SuperNova API", version="0.1.0", lifespan=_lifespan)

    _configure_cors(application, c)
    from starlette.middleware.gzip import GZipMiddleware

    application.add_middleware(GZipMiddleware, minimum_size=500)
    application.add_middleware(_RateLimitMiddleware)
    application.add_middleware(_AiUserBudgetMiddleware)
    application.add_middleware(_LocalTokenMiddleware)
    application.add_middleware(_MobileSlashRedirectMiddleware)
    application.add_middleware(_ApiPerfMiddleware)

    @application.get("/api/health")
    async def health() -> dict[str, Any]:
        # Liveness only. Must stay on the event loop and must not open Postgres:
        # every signed-in desk polls this, and a sync connect here stalls the
        # whole worker (Cloudflare 524 + «API offline» for everyone else).
        return {"status": "ok", "root": str(ROOT)}

    @application.get("/api/status")
    def status() -> dict[str, Any]:
        xlsx = Path(FINAL_XLSX)
        token = c.api_token
        weekly_running = _weekly_full_pipeline_running()
        try:
            import process_runtime as _pr

            orch_cross = _pr.orchestrator_running()
        except Exception:
            orch_cross = False
        return {
            "workbook": xlsx.name if xlsx.is_file() else None,
            "workbook_path": str(xlsx) if xlsx.is_file() else None,
            "workbook_mtime": (
                datetime.fromtimestamp(xlsx.stat().st_mtime).isoformat()
                if xlsx.is_file()
                else None
            ),
            "orchestrator_running": (
                (_proc is not None and _subprocess_alive(_proc)) or orch_cross
            ),
            "refresh_running": _reconcile_refresh_subprocess(),
            "refresh_status": _read_refresh_fast_status_file(),
            "api_token_required": bool(token),
            "api_token_is_placeholder": token == "CAMBIA_QUESTA_CHIAVE",
            "saturday_weekly_full_enabled": c.saturday_weekly_full_enabled,
            "weekly_full_running": weekly_running,
            "precat_calendar_enabled": c.precat_calendar_enabled,
            "volume_delta_enabled": c.volume_delta_enabled,
            "trends_enabled": c.trends_enabled,
            "trends_pilot_tickers": c.trends_pilot_tickers,
            "workers": int(os.environ.get("SUPERNOVA_WORKERS", "1") or "1"),
        }

    @application.post("/api/auth/verify-token")
    def verify_api_token() -> dict[str, bool]:
        """Verifica header X-SuperNova-Token (passa dal middleware mutating)."""
        return {"ok": True}

    # ── WebSocket for real-time quotes ───────────────────────────────────────
    class ConnectionManager:
        def __init__(self):
            self.active_connections: list[WebSocket] = []

        async def connect(self, websocket: WebSocket):
            await websocket.accept()
            self.active_connections.append(websocket)

        def disconnect(self, websocket: WebSocket):
            if websocket in self.active_connections:
                self.active_connections.remove(websocket)

        async def broadcast(self, message: dict[str, Any]):
            for connection in self.active_connections:
                try:
                    await connection.send_json(message)
                except Exception:
                    self.disconnect(connection)

    manager = ConnectionManager()

    @application.websocket("/ws/quotes")
    async def websocket_quotes(websocket: WebSocket):
        """WebSocket endpoint for real-time quote updates."""
        await manager.connect(websocket)
        try:
            while True:
                # Client can send subscription messages
                data = await websocket.receive_json()
                # For now, just echo back (implement real quote fetching later)
                await websocket.send_json({"type": "echo", "data": data})
        except WebSocketDisconnect:
            manager.disconnect(websocket)

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
            try:
                import process_runtime as _pr

                _pr.write_job(_pr.ORCH_PATH, pid=_proc.pid, extra={"profile": profile})
            except Exception:
                pass
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
            # 10-Q MD&A feed — independent; never fail the 8-K refresh.
            try:
                import sec_10q_extractor as _q10

                _q10.run_sec_10q_feed_refresh()
            except Exception as exc:
                print(f"[catalyst-feed] 10-Q refresh skipped: {exc}", flush=True)
            try:
                import catalyst_calendar as _cc

                _cc.run_catalyst_calendar_refresh()
            except Exception as exc:
                print(f"[catalyst-feed] calendar refresh skipped: {exc}", flush=True)

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

    @application.post("/api/sec-10q-feed/refresh")
    def sec_10q_feed_refresh() -> dict[str, Any]:
        """Background: download 10-Q MD&A / Recent Developments for EIS (independent of 8-K)."""
        import sec_10q_extractor as _q10

        status = _q10.get_status()
        if status.get("running"):
            return {"started": False, "message": "Already running"}

        def _target() -> None:
            _q10.run_sec_10q_feed_refresh()

        t = threading.Thread(target=_target, name="sec-10q-feed", daemon=True)
        t.start()
        return {"started": True}

    @application.get("/api/sec-10q-feed/status")
    def sec_10q_feed_status() -> dict[str, Any]:
        import sec_10q_extractor as _q10

        return _json_safe(_q10.get_status())

    @application.get("/api/sec-10q-feed/snapshot")
    def sec_10q_feed_snapshot() -> dict[str, Any]:
        import sec_10q_extractor as _q10

        return _json_safe(_q10.load_snapshot())

    @application.post("/api/catalyst-calendar/refresh")
    async def catalyst_calendar_refresh(request: Request) -> dict[str, Any]:
        """Discovery queue → SEC catalyst-date scan → Calendar snapshot.

        Body / query flags:
          - ``include_biotech``: also fill from ``biotech_symbols.json``
          - ``biotech_gap_only``: scan only biotech names not yet on the calendar roster
        """
        import catalyst_calendar as _cc

        status = _cc.get_status()
        if status.get("running"):
            return {"started": False, "message": "Already running"}

        def _flag(raw: Any) -> bool:
            if isinstance(raw, bool):
                return raw
            return str(raw or "").strip().lower() in {"1", "true", "yes", "on"}

        include_biotech = _flag(request.query_params.get("include_biotech"))
        biotech_gap_only = _flag(request.query_params.get("biotech_gap_only"))
        try:
            body = await request.json()
        except Exception:
            body = {}
        if isinstance(body, dict):
            if "include_biotech" in body:
                include_biotech = _flag(body.get("include_biotech"))
            if "biotech_gap_only" in body:
                biotech_gap_only = _flag(body.get("biotech_gap_only"))
        if biotech_gap_only:
            include_biotech = True

        def _target() -> None:
            _cc.run_catalyst_calendar_refresh(
                include_biotech=include_biotech,
                biotech_gap_only=biotech_gap_only,
            )

        t = threading.Thread(target=_target, name="catalyst-calendar", daemon=True)
        t.start()
        if biotech_gap_only:
            msg = "Biotech gap → SEC catalyst scan started"
        elif include_biotech:
            msg = "Discovery + biotech universe → SEC catalyst scan started"
        else:
            msg = "Discovery → SEC catalyst scan started"
        return {
            "started": True,
            "message": msg,
            "include_biotech": include_biotech,
            "biotech_gap_only": biotech_gap_only,
        }

    @application.get("/api/catalyst-calendar/status")
    def catalyst_calendar_status() -> dict[str, Any]:
        import catalyst_calendar as _cc

        return _json_safe(_cc.get_status())

    @application.get("/api/catalyst-calendar/snapshot")
    def catalyst_calendar_snapshot() -> dict[str, Any]:
        import catalyst_calendar as _cc

        return _json_safe(_cc.load_snapshot())

    @application.get("/api/calendar/identity-index")
    def calendar_identity_index() -> dict[str, Any]:
        """Ticker → Discovery / ClinicalTrials.gov / FDA sources + designations (cached)."""
        import calendar_identity as _ci

        return _json_safe(_ci.load_identity_index())

    @application.post("/api/calendar/identity-index/refresh")
    def calendar_identity_index_refresh() -> dict[str, Any]:
        import calendar_identity as _ci

        doc = _ci.build_identity_index(persist=True)
        return {
            "ok": True,
            "ticker_count": doc.get("ticker_count"),
            "updated_at": doc.get("updated_at"),
        }

    @application.post("/api/market/fda-designations")
    async def market_fda_designations(request: Request) -> dict[str, Any]:
        """Top KPI Designation: Discovery identity + FDA-site search by product name."""
        import fda_product_designations as _fpd

        try:
            body = await request.json()
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}
        items = body.get("items") or []
        force = bool(body.get("force"))
        if not isinstance(items, list):
            items = []
        return _json_safe(_fpd.lookup_batch(items, force=force))

    @application.post("/api/universe-discovery/refresh")
    def universe_discovery_refresh() -> dict[str, Any]:
        """EDGAR full-text screener for biotech filers outside the watchlist (manual review only)."""
        import universe_discovery as _ud

        status = _ud.get_status()
        if status.get("running"):
            return {"started": False, "message": "Already running"}

        def _target() -> None:
            _ud.run_universe_discovery_refresh()

        t = threading.Thread(target=_target, name="universe-discovery", daemon=True)
        t.start()
        return {"started": True}

    @application.get("/api/universe-discovery/status")
    def universe_discovery_status() -> dict[str, Any]:
        import universe_discovery as _ud

        return _json_safe(_ud.get_status())

    @application.get("/api/universe-discovery/snapshot")
    def universe_discovery_snapshot() -> dict[str, Any]:
        import universe_discovery as _ud

        return _json_safe(_ud.load_snapshot())

    @application.post("/api/universe-discovery/review")
    async def universe_discovery_review(request: Request) -> dict[str, Any]:
        """Mark a discovery candidate reviewed_added | reviewed_rejected | new.

        ``reviewed_added`` enqueues the ticker for Calendar (SEC forward work list).
        Never silently mutates the Simulation Excel workbook.
        """
        import universe_discovery as _ud

        body = await _request_json_dict(request)
        cik = str(body.get("cik") or "").strip()
        status = str(body.get("status") or "").strip()
        start_calendar = bool(body.get("start_calendar", True))
        result = _ud.set_candidate_status(cik, status)  # type: ignore[arg-type]
        if (
            result.get("ok")
            and status == "reviewed_added"
            and result.get("queued_for_calendar")
            and start_calendar
        ):
            import catalyst_calendar as _cc

            st = _cc.get_status()
            if not st.get("running"):

                def _target() -> None:
                    _cc.run_catalyst_calendar_refresh()

                threading.Thread(
                    target=_target, name="universe-discovery-calendar", daemon=True
                ).start()
                result["calendar_refresh_started"] = True
            else:
                result["calendar_refresh_started"] = False
                result["calendar_refresh_message"] = "Calendar already running"
        return _json_safe(result)

    @application.get("/api/catalyst-interest")
    def catalyst_interest_get() -> dict[str, Any]:
        """User-curated interest tickers (Catalyst Days → pipeline + deep dive)."""
        from catalyst_interest import get_interest_snapshot

        return _json_safe(get_interest_snapshot())

    @application.post("/api/catalyst-interest")
    async def catalyst_interest_post(request: Request) -> dict[str, Any]:
        """
        Enroll a ticker of interest: watchlist + calendar roster (if CIK known) +
        optional manual CD sidecar + clinical/Daily News kicks.
        Body: {ticker, company?, cd_iso|cd_date?, nct_id?, note?, open_pipeline?}
        Requires admin API token OR approved premium tester session.
        """
        from catalyst_interest import enroll_interest_ticker
        import tester_feedback_io as tf

        if not _request_has_admin_token(request):
            sess = request.headers.get(tf.TESTER_SESSION_HEADER) or request.headers.get(
                "x-supernova-tester-session"
            )
            tid = tf.find_tester_id_by_session(sess)
            if not tid:
                raise HTTPException(
                    status_code=401,
                    detail="Premium membership required to enroll companies of interest",
                )
            access = tf.get_tester_access(tid)
            if not access.get("premium"):
                raise HTTPException(
                    status_code=403,
                    detail="Premium membership required to enroll companies of interest",
                )

        body = await _request_json_dict(request)
        return _json_safe(enroll_interest_ticker(body if isinstance(body, dict) else {}))

    @application.get("/api/catalyst-interest/discover")
    def catalyst_interest_discover(ticker: str = "", company: str = "") -> dict[str, Any]:
        """Search Calendar snapshots + CT.gov for the next catalyst day (read-only)."""
        from catalyst_interest import discover_catalyst_days

        return _json_safe(discover_catalyst_days(ticker, company or None))

    @application.delete("/api/catalyst-interest/{ticker}")
    def catalyst_interest_delete(ticker: str) -> dict[str, Any]:
        from catalyst_interest import remove_interest_ticker

        return _json_safe(remove_interest_ticker(ticker))

    # ── Guidance Calendar ────────────────────────────────────────────────────

    _guidance_cal_thread: list[threading.Thread | None] = [None]

    @application.post("/api/guidance-calendar/refresh")
    async def guidance_calendar_refresh(request: Request) -> dict[str, Any]:
        """Start background guidance extraction from existing press + 8-K data."""
        import guidance_calendar as _gc

        status = _gc.get_status()
        if status.get("running"):
            return {"started": False, "message": "Already running"}

        body = await _request_json_dict(request)
        force = bool(body.get("force"))

        def _target() -> None:
            _gc.run_guidance_calendar_refresh(force=force)

        t = threading.Thread(target=_target, name="guidance-calendar", daemon=True)
        _guidance_cal_thread[0] = t
        t.start()
        return {"started": True}

    @application.get("/api/guidance-calendar/status")
    def guidance_calendar_status() -> dict[str, Any]:
        import guidance_calendar as _gc

        return _json_safe(_gc.get_status())

    @application.get("/api/guidance-calendar/snapshot")
    def guidance_calendar_snapshot() -> dict[str, Any]:
        import guidance_calendar as _gc

        return _json_safe(_gc.load_snapshot())

    @application.get("/api/fda-adcom-calendar/status")
    def fda_adcom_calendar_status() -> dict[str, Any]:
        import fda_adcom_calendar as _fac

        return _json_safe(_fac.get_status())

    @application.get("/api/fda-adcom-calendar/snapshot")
    def fda_adcom_calendar_snapshot() -> dict[str, Any]:
        import fda_adcom_calendar as _fac

        return _json_safe(_fac.load_snapshot())

    @application.post("/api/fda-adcom-calendar/refresh")
    async def fda_adcom_calendar_refresh(request: Request) -> dict[str, Any]:
        import fda_adcom_calendar as _fac

        status = _fac.get_status()
        if status.get("running"):
            return {"started": False, "message": "Already running"}
        body = await _request_json_dict(request)
        force = bool(body.get("force"))

        def _target() -> None:
            _fac.run_fda_adcom_calendar_refresh(force=force)

        t = threading.Thread(target=_target, name="fda-adcom-calendar", daemon=True)
        t.start()
        return {"started": True}

    @application.post("/api/fda-adcom-calendar/briefings/refresh")
    async def fda_adcom_briefings_refresh(request: Request) -> dict[str, Any]:
        import fda_adcom_briefing as _fab
        import fda_adcom_calendar as _fac

        status = _fac.get_status()
        if status.get("running"):
            return {"started": False, "message": "Already running"}
        body = await _request_json_dict(request)
        force = bool(body.get("force"))

        def _target() -> None:
            _fab.run_fda_adcom_briefing_refresh(force=force)

        t = threading.Thread(target=_target, name="fda-adcom-briefing", daemon=True)
        t.start()
        return {"started": True}

    @application.post("/api/quotes/batch")
    def quotes_batch(request: Request, body: dict[str, Any] | None = None) -> dict[str, Any]:
        """Batch quotes from financial_sheet_snapshot (hourly). Live Yahoo only for admin."""
        from quotes_batch_cache import batch_quotes

        payload = body if isinstance(body, dict) else {}
        tickers = payload.get("tickers", [])
        if not isinstance(tickers, list) or not tickers:
            return {
                "quotes": {},
                "meta": {
                    "requested": 0,
                    "from_snapshot": 0,
                    "live_fetches": 0,
                    "missing": [],
                },
            }
        want_live = bool(payload.get("live") or payload.get("live_fallback"))
        live = want_live and _request_has_admin_token(request)
        return _json_safe(
            batch_quotes([str(t) for t in tickers], live_fallback=live)
        )

    # ── Regulatory Risk ───────────────────────────────────────────────────────

    @application.get("/api/regulatory-risk/snapshot")
    def regulatory_risk_snapshot_get() -> dict[str, Any]:
        """Serve the latest regulatory risk snapshot (auto-built by morning scheduler).
        If the file doesn't exist yet, build it on first request (lazy init)."""
        from orchestrator_io_paths import REGULATORY_RISK_SNAPSHOT_JSON

        p = Path(REGULATORY_RISK_SNAPSHOT_JSON)
        if not p.is_file():
            try:
                from scripts.regulatory_risk_refresh import build_regulatory_risk_snapshot, save_snapshot
                snap = build_regulatory_risk_snapshot()
                save_snapshot(snap)
                return _json_safe(snap)
            except Exception as exc:
                return {"updated_at": None, "tickers": {}, "error": str(exc)}
        try:
            return _json_safe(json.loads(p.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, OSError):
            return {"updated_at": None, "tickers": {}, "error": "failed to read snapshot"}

    @application.post("/api/regulatory-risk/refresh")
    def regulatory_risk_refresh() -> dict[str, Any]:
        """Rebuild the regulatory risk snapshot on demand."""
        from scripts.regulatory_risk_refresh import build_regulatory_risk_snapshot, save_snapshot

        snap = build_regulatory_risk_snapshot()
        save_snapshot(snap)
        return _json_safe(snap)

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
        """Quick test of configured providers + force-refresh balance for real-time info."""
        import ai_provider as _ap

        info = _ap.provider_info()
        ok = bool(_ap.call_ai("Reply with exactly: OK", max_tokens=8, task="catalyst"))
        # Force-refresh Anthropic balance after the probe call
        try:
            from ai_billing import get_anthropic_balance
            fresh_balance = get_anthropic_balance(force_refresh=True)
        except Exception:
            fresh_balance = None
        info = _ap.provider_info()
        if fresh_balance:
            info["anthropic_balance"] = fresh_balance
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
            gemini_api_key=payload.get("gemini_api_key"),
            anthropic_prepaid_eur=payload.get("anthropic_prepaid_eur"),
            anthropic_org_id=payload.get("anthropic_org_id"),
            clear_anthropic=bool(payload.get("clear_anthropic")),
            clear_openai=bool(payload.get("clear_openai")),
            clear_github=bool(payload.get("clear_github")),
            clear_gemini=bool(payload.get("clear_gemini")),
            clear_anthropic_prepaid=bool(payload.get("clear_anthropic_prepaid")),
        )
        return _json_safe({"ok": True, **status, "provider": _ap.provider_info()})

    # ── Clinical pre-CD enrichment (CT.gov + PubMed, 6 months before CD) ─────

    _clinical_pre_cd_thread: list[threading.Thread | None] = [None]

    @application.post("/api/clinical-pre-cd/refresh")
    def clinical_pre_cd_refresh(
        portfolio_only: bool = Query(
            True,
            description="When true, scope = Simulation sheet ∪ portfolio positions. False = entire work list.",
        ),
        force: bool = Query(False, description="Ignore TTL cache — reprocess all rows"),
        deep: bool = Query(
            False,
            description="Copilot-grade deep pass (also auto weekly for portfolio tickers)",
        ),
        tickers: str = Query(
            "",
            description="Optional comma-separated tickers — scopes the EIS search (High Vol)",
        ),
    ) -> dict[str, Any]:
        import clinical_pre_cd_enrichment as _cp

        if _cp.get_status().get("running"):
            return {"started": False, "message": "Already running"}

        ticker_list = [
            p.strip().upper()
            for p in tickers.replace(";", ",").split(",")
            if p.strip()
        ]

        def _target() -> None:
            _cp.run_clinical_pre_cd_refresh(
                portfolio_only=portfolio_only if not ticker_list else False,
                force=force or bool(ticker_list),
                deep=deep or bool(ticker_list),
                tickers=ticker_list or None,
            )

        t = threading.Thread(target=_target, name="clinical-pre-cd", daemon=True)
        _clinical_pre_cd_thread[0] = t
        t.start()
        return {
            "started": True,
            "portfolio_only": portfolio_only if not ticker_list else False,
            "force": force or bool(ticker_list),
            "deep": deep or bool(ticker_list),
            "tickers": ticker_list,
        }

    @application.get("/api/clinical-pre-cd/status")
    def clinical_pre_cd_status() -> dict[str, Any]:
        import clinical_pre_cd_enrichment as _cp

        return _json_safe(_cp.get_status())

    @application.get("/api/clinical-pre-cd/snapshot")
    def clinical_pre_cd_snapshot() -> dict[str, Any]:
        import clinical_pre_cd_enrichment as _cp

        return _json_safe(_cp.load_snapshot())

    @application.get("/api/clinical-pre-cd/history")
    def clinical_pre_cd_history(
        ticker: str = Query("", description="Optional ticker filter"),
    ) -> dict[str, Any]:
        """Historical Deep Dive / EIS library (past-catalyst cards, not deleted)."""
        from clinical_deep_dive_history import library_summary

        return _json_safe(library_summary(ticker=ticker or None))

    @application.get("/api/clinical-pre-cd/history/{ticker}")
    def clinical_pre_cd_history_ticker(ticker: str) -> dict[str, Any]:
        from clinical_deep_dive_history import historical_records_for_tickers, library_summary

        tk = (ticker or "").strip().upper()
        return _json_safe(
            {
                **library_summary(ticker=tk),
                "records": historical_records_for_tickers({tk}),
            }
        )

    # ── Anticipated events: pending-verification registry ────────────────────

    _hypothesis_verify_thread: list[threading.Thread | None] = [None]

    @application.get("/api/clinical-pre-cd/pending-hypotheses")
    def clinical_pending_hypotheses(
        status: str = Query("", description="Filter by status (pending|confirmed|expired|dismissed)"),
        ticker: str = Query("", description="Filter by ticker"),
    ) -> dict[str, Any]:
        from prediction.eis_pending_verification import load_registry, registry_summary

        items = [it for it in (load_registry().get("items") or []) if isinstance(it, dict)]
        if status:
            items = [it for it in items if str(it.get("status") or "") == status.strip().lower()]
        if ticker:
            tk = ticker.strip().upper()
            items = [it for it in items if str(it.get("ticker") or "").upper() == tk]
        items.sort(key=lambda it: str(it.get("expected_window_start") or ""))
        return _json_safe({"items": items, "summary": registry_summary()})

    @application.post("/api/clinical-pre-cd/verify-hypotheses")
    def clinical_verify_hypotheses(
        ticker: str = Query("", description="Limit the round to one ticker"),
        limit: int = Query(0, description="Max hypotheses to check (0 = no cap)"),
        force: bool = Query(False, description="Ignore the per-hypothesis cooldown"),
        allow_ai: bool = Query(True, description="Allow the targeted AI fact-check pass"),
    ) -> dict[str, Any]:
        from prediction.eis_hypothesis_verifier import verify_pending_hypotheses

        thread = _hypothesis_verify_thread[0]
        if thread is not None and thread.is_alive():
            return {"started": False, "message": "Already running"}

        tickers = {ticker.strip().upper()} if ticker.strip() else None

        def _target() -> None:
            try:
                res = verify_pending_hypotheses(
                    tickers=tickers,
                    limit=limit or None,
                    force=force,
                    allow_ai=allow_ai,
                )
                print(f"[EISVerify] round completato: {res}", flush=True)
            except Exception as exc:  # noqa: BLE001
                print(f"[EISVerify][ERROR] {exc}", flush=True)

        t = threading.Thread(target=_target, name="eis-hypothesis-verify", daemon=True)
        _hypothesis_verify_thread[0] = t
        t.start()
        return {"started": True, "ticker": ticker or None, "limit": limit or None}

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

    @application.post("/api/desk/product-briefing/lookup")
    async def desk_product_briefing_lookup(request: Request) -> dict[str, Any]:
        """Gemini lookup for modality / MoA / target when clinical profile is sparse."""
        from product_briefing_lookup import lookup_product_briefing

        payload = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
        if not isinstance(payload, dict):
            payload = {}
        force_raw = payload.get("force", False)
        force = force_raw is True or str(force_raw).strip().lower() in ("1", "true", "yes")
        # Sync Gemini/HTTP must not block the uvicorn event loop (freezes /api/health).
        result = await asyncio.to_thread(
            lookup_product_briefing,
            ticker=str(payload.get("ticker") or ""),
            product_name=str(payload.get("product_name") or payload.get("productName") or ""),
            company=str(payload.get("company") or "").strip() or None,
            nct_id=str(payload.get("nct_id") or payload.get("nctId") or "").strip() or None,
            interventions=str(payload.get("interventions") or "").strip() or None,
            conditions=str(payload.get("conditions") or "").strip() or None,
            force=force,
        )
        return _json_safe(result)

    @application.post("/api/desk/pipeline-overview/lookup")
    async def desk_pipeline_overview_lookup(request: Request) -> dict[str, Any]:
        """Gemini: company pipeline summary (modality, MoA, indication, US prevalence, phase)."""
        from product_briefing_lookup import lookup_pipeline_overview

        payload = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
        if not isinstance(payload, dict):
            payload = {}
        force_raw = payload.get("force", False)
        force = force_raw is True or str(force_raw).strip().lower() in ("1", "true", "yes")
        raw_products = payload.get("products") or payload.get("product_names") or []
        if isinstance(raw_products, str):
            products = [raw_products]
        elif isinstance(raw_products, list):
            products = [str(x) for x in raw_products if str(x).strip()]
        else:
            products = []
        result = await asyncio.to_thread(
            lookup_pipeline_overview,
            ticker=str(payload.get("ticker") or ""),
            company=str(payload.get("company") or "").strip() or None,
            products=products,
            nct_id=str(payload.get("nct_id") or payload.get("nctId") or "").strip() or None,
            conditions=str(payload.get("conditions") or payload.get("indication") or "").strip() or None,
            force=force,
        )
        return _json_safe(result)

    @application.post("/api/desk/us-product-revenue/lookup")
    async def desk_us_product_revenue_lookup(request: Request) -> dict[str, Any]:
        """Gemini: latest US product revenues (quarter/half), ranked by US $."""
        from us_product_revenue_lookup import lookup_us_product_revenue

        payload = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
        if not isinstance(payload, dict):
            payload = {}
        force_raw = payload.get("force", False)
        force = force_raw is True or str(force_raw).strip().lower() in ("1", "true", "yes")
        result = await asyncio.to_thread(
            lookup_us_product_revenue,
            ticker=str(payload.get("ticker") or ""),
            company=str(payload.get("company") or "").strip() or None,
            force=force,
        )
        return _json_safe(result)

    @application.post("/api/desk/competition-landscape/lookup")
    async def desk_competition_landscape_lookup(request: Request) -> dict[str, Any]:
        """Gemini + web search: clinical-stage peers targeting the same disease."""
        from competition_landscape_lookup import lookup_competition_landscape

        payload = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
        if not isinstance(payload, dict):
            payload = {}
        force_raw = payload.get("force", False)
        force = force_raw is True or str(force_raw).strip().lower() in ("1", "true", "yes")
        cache_only_raw = payload.get("cache_only", False)
        cache_only = cache_only_raw is True or str(cache_only_raw).strip().lower() in (
            "1",
            "true",
            "yes",
        )
        result = await asyncio.to_thread(
            lookup_competition_landscape,
            ticker=str(payload.get("ticker") or ""),
            product_name=str(payload.get("product_name") or payload.get("productName") or "").strip() or None,
            company=str(payload.get("company") or "").strip() or None,
            indication=str(payload.get("indication") or payload.get("disease") or "").strip() or None,
            nct_id=str(payload.get("nct_id") or payload.get("nctId") or "").strip() or None,
            force=force,
            cache_only=cache_only,
        )
        return _json_safe(result)

    @application.post("/api/desk/product-patent/lookup")
    async def desk_product_patent_lookup(request: Request) -> dict[str, Any]:
        """Gemini + web search: patent filing / LOE estimate for the CD product."""
        from product_briefing_lookup import lookup_product_patent

        payload = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
        if not isinstance(payload, dict):
            payload = {}
        force_raw = payload.get("force", False)
        force = force_raw is True or str(force_raw).strip().lower() in ("1", "true", "yes")
        kind_raw = (
            payload.get("product_kind")
            or payload.get("productKind")
            or payload.get("kind")
        )
        product_kind = str(kind_raw).strip().lower() if kind_raw else None
        result = await asyncio.to_thread(
            lookup_product_patent,
            ticker=str(payload.get("ticker") or ""),
            product_name=str(payload.get("product_name") or payload.get("productName") or ""),
            company=str(payload.get("company") or "").strip() or None,
            nct_id=str(payload.get("nct_id") or payload.get("nctId") or "").strip() or None,
            force=force,
            product_kind=product_kind or None,
        )
        return _json_safe(result)

    @application.post("/api/desk/ticker-8k-dossier")
    async def desk_ticker_8k_dossier(request: Request) -> dict[str, Any]:
        """EDGAR 8-K last 2 months: per-Item 50-word summaries + file score."""
        from ticker_8k_dossier import lookup_ticker_8k_dossier

        payload = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
        if not isinstance(payload, dict):
            payload = {}
        force_raw = payload.get("force", False)
        force = force_raw is True or str(force_raw).strip().lower() in ("1", "true", "yes")
        result = await asyncio.to_thread(
            lookup_ticker_8k_dossier,
            ticker=str(payload.get("ticker") or ""),
            force=force,
        )
        return _json_safe(result)

    @application.post("/api/desk/product-study-dossier")
    async def desk_product_study_dossier(request: Request) -> dict[str, Any]:
        """CT.gov studies for one drug + PubMed papers (drug in title/abstract; affiliation optional)."""
        from product_study_dossier import lookup_product_study_dossier

        payload = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
        if not isinstance(payload, dict):
            payload = {}
        force_raw = payload.get("force", False)
        force = force_raw is True or str(force_raw).strip().lower() in ("1", "true", "yes")
        aliases_raw = payload.get("aliases") or []
        aliases = [str(a).strip() for a in aliases_raw if str(a).strip()] if isinstance(aliases_raw, list) else []
        result = await asyncio.to_thread(
            lookup_product_study_dossier,
            ticker=str(payload.get("ticker") or ""),
            product_name=str(payload.get("product_name") or payload.get("productName") or ""),
            company=str(payload.get("company") or "").strip() or None,
            nct_id=str(payload.get("nct_id") or payload.get("nctId") or "").strip() or None,
            aliases=aliases,
            force=force,
        )
        return _json_safe(result)

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
        running = _reconcile_refresh_subprocess()
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

    @application.get("/api/refresh/weekly-full-status")
    def weekly_full_status() -> dict[str, Any]:
        """Stato WeeklyFull server-side (cron sabato) per popup desktop."""
        try:
            from orchestrator_run_summary import format_summary_message, load_last_summary

            summary = load_last_summary() or {}
            if summary and not summary.get("message"):
                summary = dict(summary)
                summary["message"] = format_summary_message(summary, lang="it")
            return {
                "enabled": c.saturday_weekly_full_enabled,
                "running": _weekly_full_pipeline_running(),
                "last_run": _load_weekly_full_last_run(),
                "summary": summary if summary else None,
            }
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
    def refresh_live_signals(
        cd_horizon: int = Query(90, ge=7, le=180),
        force_prices: bool = Query(
            False,
            description="Overwrite Prezzo Corrente / Var. Giorn. % even outside NYSE RTH",
        ),
    ) -> dict[str, Any]:
        """
        Aggiorna slope/affid/pred5 nel simulation_sheet_snapshot.json
        scaricando solo 3 mesi di prezzi per le società con CD imminente.
        Tipicamente < 30 secondi. Non tocca Excel né data_orchestrator.

        Fuori RTH scrive la chiusura ufficiale (settled); ``force_prices``
        forza quote live anche pre/post market.
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
        cmd = [str(PYTHON), "-u", str(script), "--cd-horizon", str(cd_horizon)]
        if force_prices:
            cmd.append("--force-prices")
        proc = _sp.Popen(
            cmd,
            cwd=str(ROOT), env=env,
            stdout=_sp.PIPE, stderr=_sp.STDOUT,
        )
        if _live_signals_proc:
            _live_signals_proc[0] = proc
        else:
            _live_signals_proc.append(proc)
        return {
            "started": True,
            "cd_horizon": cd_horizon,
            "force_prices": force_prices,
            "message": "Live signals refresh avviato (~20s).",
        }

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
        try:
            from orch_refresh_gates import mark_post_pipeline_ok

            mark_post_pipeline_ok(
                f"API post-pipeline OK ({len(steps)} step)",
                kind="full",
            )
        except Exception:
            pass

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

        try:
            from orch_refresh_gates import post_pipeline_ok_within

            skip_min = float(os.environ.get("POST_PIPELINE_SKIP_IF_WITHIN_MIN", "45"))
            if post_pipeline_ok_within(skip_min):
                st: dict[str, Any] = {}
                if POST_PIPELINE_STATUS.is_file():
                    try:
                        st = json.loads(POST_PIPELINE_STATUS.read_text(encoding="utf-8"))
                    except (OSError, json.JSONDecodeError):
                        st = {}
                return {
                    "skipped": True,
                    "message": (
                        f"Post-pipeline già completata negli ultimi {skip_min:.0f} min "
                        "(scheduler o run precedente)."
                    ),
                    **st,
                }
        except Exception:
            pass

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

    @application.get("/api/market/intraday-1h")
    def market_intraday_1h(
        tickers: str = Query("", description="Comma-separated tickers (max ~80)"),
        force: bool = Query(False, description="Bypass short cache — refresh live session"),
    ) -> dict[str, Any]:
        """Today's prices bucketed to 1 point/hour — Home what-if multi-curve chart."""
        from market_intraday_1h import fetch_intraday_1h

        return _json_safe(fetch_intraday_1h(tickers, force=force))

    @application.get("/api/market/volume-history")
    def market_volume_history(
        ticker: str = Query("", description="Single ticker symbol"),
        days: int = Query(35, ge=1, le=400, description="Calendar days of history"),
    ) -> dict[str, Any]:
        """Daily share volume bars — loss-analysis EIS overlay chart."""
        from market_volume_history import fetch_volume_history

        return _json_safe(fetch_volume_history(ticker, days=days))

    @application.get("/api/market/volume-character")
    def market_volume_character(
        ticker: str = Query("", description="Single ticker symbol"),
        days: int = Query(60, ge=40, le=400, description="Calendar days of OHLCV history"),
        eis_dates: str = Query(
            "",
            description="Comma-separated confirmed EIS dates (YYYY-MM-DD) for Reactive join",
        ),
    ) -> dict[str, Any]:
        """Volume Character Classifier — Anticipatory / Reactive / Ambiguous tags (no BUY/SELL)."""
        from volume_character import classify_ticker_from_history

        dates = [p.strip() for p in str(eis_dates or "").replace(";", ",").split(",") if p.strip()]
        return _json_safe(
            classify_ticker_from_history(ticker, days=days, eis_dates=dates)
        )

    @application.get("/api/market/volume-vs-prev-session")
    def market_volume_vs_prev_session(
        tickers: str = Query("", description="Comma-separated tickers (max ~80)"),
        force: bool = Query(False, description="Bypass the short cache"),
    ) -> dict[str, Any]:
        """Session volume as % of the previous Nasdaq session — KPI snapshot Vol column."""
        from market_volume_history import fetch_volume_vs_prev_session

        payload = fetch_volume_vs_prev_session(tickers, force=force)
        if not get_supernova_config().volume_delta_enabled:
            for row in payload.get("rows", {}).values():
                if isinstance(row, dict):
                    row.pop("volume_delta_signed", None)
                    row.pop("volume_delta_method", None)
                    row.pop("obv_divergence_flag", None)
        return _json_safe(payload)

    @application.get("/api/market/volume-acceleration")
    def market_volume_acceleration(
        tickers: str = Query("", description="Comma-separated tickers (max 20, 5m RVOL log-slope)"),
        force: bool = Query(False, description="Bypass the short cache"),
    ) -> dict[str, Any]:
        """Incremental-volume acceleration (T_double) — Soft BUY High Vol."""
        from volume_acceleration import fetch_volume_acceleration

        return _json_safe(fetch_volume_acceleration(tickers, force=force))

    @application.get("/api/market/search-interest")
    def market_search_interest(
        tickers: str = Query("", description="Comma-separated tickers (max 16; ~4h cache)"),
    ) -> dict[str, Any]:
        """Google Trends search-interest — display only, not a BUY/SELL input.
        Dual window: today 3-m (baseline) + now 1-d (~24h)."""
        from search_interest import fetch_search_interest

        return _json_safe(fetch_search_interest(tickers))

    @application.get("/api/market/search-interest-leaders")
    def market_search_interest_leaders(
        limit: int = Query(10, ge=1, le=20, description="Top Simulation names by Trends z-score"),
    ) -> dict[str, Any]:
        """Highest Google Trends scores in the Simulation universe (cache only)."""
        from search_interest import fetch_search_interest_leaders

        return _json_safe(fetch_search_interest_leaders(limit))

    @application.get("/api/market/smart-money")
    def market_smart_money(
        tickers: str = Query("", description="Comma-separated tickers (Form 4 + cached 13F/short)"),
    ) -> dict[str, Any]:
        """Silent-money traces — display only, not a BUY/SELL input."""
        from smart_money import fetch_smart_money

        return _json_safe(fetch_smart_money(tickers))

    @application.get("/api/market/catalyst-short-interest")
    def market_catalyst_short_interest(
        tickers: str = Query("", description="Comma-separated tickers (bi-monthly SI; display only)"),
        force: bool = Query(False),
    ) -> dict[str, Any]:
        """Catalyst Short Interest / DTC. Not Soft BUY/SELL. Not an intra-day feed."""
        from catalyst_short_interest import fetch_catalyst_short_interest

        return _json_safe(fetch_catalyst_short_interest(tickers or None, force=force))

    @application.post("/api/market/catalyst-short-interest/refresh")
    def market_catalyst_short_interest_refresh() -> dict[str, Any]:
        """Once-daily warm of SI prints for the 10-day catalyst universe."""
        from catalyst_short_interest import refresh_catalyst_short_interest_universe

        return _json_safe(refresh_catalyst_short_interest_universe(force=False))

    @application.get("/api/market/catalyst-accumulation")
    def market_catalyst_accumulation(
        tickers: str = Query("", description="Comma-separated tickers (Form 4 net buy + gov flag)"),
        force: bool = Query(False),
    ) -> dict[str, Any]:
        """Accumulation + Governance Flag (Framework v2 signal 2). Not Soft BUY/SELL."""
        from catalyst_accumulation import fetch_catalyst_accumulation

        return _json_safe(fetch_catalyst_accumulation(tickers or None, force=force))

    @application.get("/api/market/catalyst-desk-cache")
    def market_catalyst_desk_cache() -> dict[str, Any]:
        """
        Catalyst Decision table cache split:
        - morning: Ticker/Event/Days + Insider + Exec Exit + FDA Brief (weekday mornings)
        - hourly: Vol/Sentiment/Skew/Short/vs XBI/Pre-Mkt/Trends (Nasdaq open hours)
        Display only — not Soft BUY/SELL.
        """
        from catalyst_desk_cache import load_desk_cache

        return _json_safe(load_desk_cache())

    @application.post("/api/market/catalyst-desk-cache/refresh")
    async def market_catalyst_desk_cache_refresh(
        force: bool = Query(False, description="Force full Yahoo refresh even off-hours"),
    ) -> dict[str, Any]:
        """
        Server-owned Catalyst hourly pack refresh (RTH full / off-hours hole-fill).
        Clients should only GET the pack — Yahoo lives here.
        """
        from catalyst_desk_cache import load_desk_cache, run_hourly_desk_cache_refresh

        result = run_hourly_desk_cache_refresh(force=force)
        pack = load_desk_cache()
        return _json_safe({**pack, "refresh": result})

    @application.get("/api/market/daily-news")
    def market_daily_news() -> dict[str, Any]:
        """
        Catalyst Daily News box — staged headlines (09:00 + hourly) + Top News
        (★ + positive momentum: press + digested 8-K). Display only — not Soft BUY/SELL.
        """
        from daily_news_desk import load_daily_news

        return _json_safe(load_daily_news())

    @application.post("/api/market/daily-news/refresh")
    async def market_daily_news_refresh(
        request: Request,
        force: bool = Query(False, description="Ignore hour cache and re-search"),
    ) -> dict[str, Any]:
        """Manual / scheduler trigger for Daily News search + hour migration."""
        from daily_news_desk import run_daily_news_search

        body = await _request_json_dict(request)
        prio = body.get("priority_tickers") if isinstance(body.get("priority_tickers"), list) else None
        force_body = bool(body.get("force")) if "force" in body else force
        return _json_safe(
            run_daily_news_search(force=force_body, priority_tickers=prio)
        )

    @application.post("/api/market/daily-news/top")
    async def market_daily_news_top(request: Request) -> dict[str, Any]:
        """
        Top News block: client sends ★ ∩ positive-momentum tickers.
        Returns press + digested SEC 8-K findings (each scored, each with link).
        """
        from daily_news_desk import build_top_news

        body = await _request_json_dict(request)
        tickers = body.get("tickers") or body.get("priority_tickers") or []
        if not isinstance(tickers, list):
            tickers = []
        force = bool(body.get("force"))
        return _json_safe(build_top_news(tickers, force=force))

    @application.post("/api/market/daily-news/analyze")
    async def market_daily_news_analyze(request: Request) -> dict[str, Any]:
        """
        Digest pasted text / URL / PDF → ~10-word summary + clinical, financial,
        EIS, market-access scores. Display only — not Soft BUY/SELL.
        Accepts multipart (field ``pdf``) or JSON with ``pdf_base64`` + ``pdf_name``.
        """
        from daily_news_desk import analyze_user_source

        ctype = (request.headers.get("content-type") or "").lower()
        if "multipart/form-data" in ctype:
            try:
                form = await request.form()
            except Exception as exc:
                return _json_safe(
                    {
                        "ok": False,
                        "error": (
                            "multipart_parse_failed: install python-multipart "
                            f"({type(exc).__name__}: {exc})"
                        )[:240],
                    }
                )
            text = str(form.get("text") or "") or None
            url = str(form.get("url") or "") or None
            pdf_bytes: bytes | None = None
            pdf_name: str | None = None
            upload = form.get("pdf") or form.get("file")
            if upload is not None and hasattr(upload, "read"):
                pdf_bytes = await upload.read()  # type: ignore[misc]
                pdf_name = getattr(upload, "filename", None) or "upload.pdf"
                if not pdf_bytes:
                    pdf_bytes = None
            return _json_safe(
                analyze_user_source(
                    text=text,
                    url=url,
                    pdf_bytes=pdf_bytes,
                    pdf_name=pdf_name,
                )
            )
        body = await _request_json_dict(request)
        pdf_bytes = None
        pdf_name = str(body.get("pdf_name") or "") or None
        b64 = str(body.get("pdf_base64") or "").strip()
        if b64:
            try:
                import base64

                # Allow data-URL prefix
                if "," in b64 and b64.lower().startswith("data:"):
                    b64 = b64.split(",", 1)[1]
                pdf_bytes = base64.b64decode(b64, validate=False)
            except Exception as exc:
                return _json_safe(
                    {"ok": False, "error": f"pdf_base64_invalid: {exc}"[:200]}
                )
            if not pdf_bytes:
                pdf_bytes = None
        return _json_safe(
            analyze_user_source(
                text=str(body.get("text") or "") or None,
                url=str(body.get("url") or "") or None,
                pdf_bytes=pdf_bytes,
                pdf_name=pdf_name or ("upload.pdf" if pdf_bytes else None),
            )
        )

    @application.post("/api/market/daily-news/migrate")
    async def market_daily_news_migrate(request: Request) -> dict[str, Any]:
        """
        Manual: push staged Daily News (+ Top + analyses with ticker) into
        company clinical EIS (Deep Dive). Optional body ``id`` / ``ids`` for
        single-row migrate. Not Soft BUY/SELL. Not auto/hourly.
        """
        from daily_news_desk import migrate_daily_news_to_eis

        body = await _request_json_dict(request)
        ids = body.get("ids")
        if not isinstance(ids, list):
            ids = None
        return _json_safe(
            migrate_daily_news_to_eis(
                item_id=str(body.get("id") or "") or None,
                ids=[str(x) for x in ids] if ids else None,
            )
        )

    @application.get("/api/market/catalyst-outcomes/resolved")
    def market_catalyst_outcomes_resolved() -> dict[str, Any]:
        """Keys of Catalyst Days whose outcome was migrated to Deep Dive."""
        from catalyst_outcome_feed import _load_resolved

        doc = _load_resolved()
        entries = doc.get("entries") if isinstance(doc.get("entries"), dict) else {}
        return _json_safe(
            {
                "ok": True,
                "keys": sorted(entries.keys()),
                "count": len(entries),
            }
        )

    @application.post("/api/market/catalyst-outcomes/scan")
    def market_catalyst_outcomes_scan() -> dict[str, Any]:
        """Scan post-CD week for outcome press/8-K and stage into Daily News."""
        from catalyst_outcome_feed import stage_catalyst_outcomes_into_daily_news

        return _json_safe(stage_catalyst_outcomes_into_daily_news(force=True))

    @application.post("/api/market/daily-news/brief")
    async def market_daily_news_brief(request: Request) -> dict[str, Any]:
        """
        Click-through detail for a Daily News headline OR an EIS Deep Dive /
        clinical-feed event with a source URL. Same investor digest engine
        (`_build_investor_digest`). Display only — not Soft BUY/SELL.
        """
        from daily_news_desk import brief_daily_news_item

        body = await _request_json_dict(request)
        return _json_safe(
            brief_daily_news_item(
                title=str(body.get("title") or "") or None,
                url=str(body.get("url") or body.get("link") or "") or None,
                summary=str(body.get("summary") or "") or None,
                ticker=str(body.get("ticker") or "") or None,
                item_id=str(body.get("id") or body.get("item_id") or "") or None,
            )
        )

    @application.post("/api/market/daily-news/dismiss")
    async def market_daily_news_dismiss(request: Request) -> dict[str, Any]:
        """Close a Daily News row without Migrate → EIS."""
        from daily_news_desk import dismiss_daily_news_item

        body = await _request_json_dict(request)
        ids = body.get("ids")
        if not isinstance(ids, list):
            ids = None
        return _json_safe(
            dismiss_daily_news_item(
                item_id=str(body.get("id") or "") or None,
                ids=[str(x) for x in ids] if ids else None,
            )
        )

    @application.get("/api/market/catalyst-vs-xbi")
    def market_catalyst_vs_xbi(
        tickers: str = Query("", description="Comma-separated tickers (relative move vs XBI)"),
        force: bool = Query(False),
    ) -> dict[str, Any]:
        """Stock vs XBI relative move (β=1 simple). Not Soft BUY/SELL."""
        from catalyst_vs_xbi import fetch_catalyst_vs_xbi

        return _json_safe(fetch_catalyst_vs_xbi(tickers or None, force=force))

    @application.get("/api/market/catalyst-pre-open-imbalance")
    def market_catalyst_pre_open_imbalance(
        tickers: str = Query("", description="Comma-separated tickers (pre-open NOII / Pillar)"),
        listings: str = Query(
            "",
            description="Optional ticker:VENUE pairs (e.g. ETON:NASDAQ,PFE:NYSE). Never assume Nasdaq.",
        ),
        force_live: bool = Query(
            False,
            description="One-shot Databento live pull when in-window. Not continuous desk poll.",
        ),
    ) -> dict[str, Any]:
        """
        Pre-Open Imbalance (Databento XNAS.ITCH / XNYS.PILLAR). Context only —
        not Soft BUY/SELL. Outside transmission window returns blank rows (never stale).
        Continuous refresh stays off unless PRE_OPEN_IMBALANCE_CONTINUOUS=1 after
        confirming Databento plan + venue licenses.
        """
        from pre_open_imbalance import fetch_pre_open_imbalance

        listing_by_ticker: dict[str, str] = {}
        for part in (listings or "").split(","):
            part = part.strip()
            if not part or ":" not in part:
                continue
            tk, venue = part.split(":", 1)
            tk = tk.strip().upper()
            venue = venue.strip()
            if tk and venue:
                listing_by_ticker[tk] = venue

        return _json_safe(
            fetch_pre_open_imbalance(
                tickers or None,
                listing_by_ticker=listing_by_ticker or None,
                force_live=force_live,
            )
        )

    @application.get("/api/market/catalyst-pre-mkt-conviction")
    def market_catalyst_pre_mkt_conviction(
        tickers: str = Query(
            "",
            description="Comma-separated tickers (pre-market conviction PROXY — not NOII)",
        ),
        search_buzz: str = Query(
            "",
            description="Optional ticker:delta_pct pairs (e.g. ETON:12.5) for ConvictionConfirmed",
        ),
    ) -> dict[str, Any]:
        """
        Pre-Mkt Conviction — FREE proxy from executed Yahoo pre-market trades.
        NOT official Pre-Open Imbalance / Databento NOII. Context only, not Soft BUY/SELL.
        """
        from pre_mkt_conviction import fetch_pre_mkt_conviction

        buzz: dict[str, float] = {}
        for part in (search_buzz or "").split(","):
            part = part.strip()
            if not part or ":" not in part:
                continue
            tk, raw = part.split(":", 1)
            tk = tk.strip().upper()
            try:
                buzz[tk] = float(raw.strip())
            except ValueError:
                continue

        return _json_safe(
            fetch_pre_mkt_conviction(
                tickers or None,
                search_buzz_by_ticker=buzz or None,
            )
        )

    @application.get("/api/market/catalyst-uoa")
    def market_catalyst_uoa(
        tickers: str = Query("", description="Comma-separated tickers (unusual options activity)"),
        force: bool = Query(False),
    ) -> dict[str, Any]:
        """Unusual Options Activity. Not Soft BUY/SELL. — without 20d avg-vol feed."""
        from catalyst_uoa import fetch_catalyst_uoa

        return _json_safe(fetch_catalyst_uoa(tickers or None, force=force))

    @application.get("/api/market/event-vol-index")
    def market_event_vol_index(
        pairs: str = Query(
            "",
            description="ticker:YYYY-MM-DD pairs (IV run-up + skew; display only)",
        ),
        force: bool = Query(False),
    ) -> dict[str, Any]:
        """IVR / event-vol and call-put skew for approaching catalysts. Not Soft BUY/SELL."""
        from event_vol_index import fetch_event_vol_index

        return _json_safe(fetch_event_vol_index(pairs or None, force=force))

    @application.post("/api/market/event-vol-index/refresh")
    def market_event_vol_index_refresh() -> dict[str, Any]:
        """Warm IV/skew prints for catalysts in the next 10 days."""
        from event_vol_index import refresh_event_vol_universe

        return _json_safe(refresh_event_vol_universe(force=False))

    @application.get("/api/hype-volume-funnel")
    def hype_volume_funnel_get() -> dict[str, Any]:
        """Accepted volume-hype rows (trusted next CD) + scan status."""
        from hype_volume_funnel import get_status, load_hype_entries

        return _json_safe(
            {
                "status": get_status(),
                "entries": load_hype_entries(),
            }
        )

    @application.get("/api/simulation/manual-entries")
    def simulation_manual_entries_get() -> dict[str, Any]:
        """Manual Simulation sidecar rows (Calendar insert / ops overrides)."""
        from manual_catalyst_insert import load_manual_sim_doc

        return _json_safe(load_manual_sim_doc())

    @application.post("/api/simulation/manual-entries")
    async def simulation_manual_entries_post(request: Request) -> dict[str, Any]:
        """
        Append / upsert a free-text Calendar catalyst into
        ``manual_sim_entries.json`` (+ CD day on guidance Calendar).
        Body: {ticker, company?, nct_id?, cd_iso|cd_date, drug?, phase?, note?}
        """
        from manual_catalyst_insert import append_manual_sim_entry

        try:
            body = await request.json()
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}
        result = append_manual_sim_entry(body)
        return _json_safe(result)

    @application.post("/api/hype-volume-funnel/scan")
    def hype_volume_funnel_scan(
        tickers: str = Query(
            "",
            description="Optional comma-separated tickers. Empty = daily rotated off-sheet universe.",
        ),
    ) -> dict[str, Any]:
        """Volume ≥400% (24h first, 7d tail) → CT.gov Exact/Partial → sidecar rows."""
        from hype_volume_funnel import start_hype_volume_funnel_scan

        ticker_list = [
            p.strip().upper()
            for p in tickers.replace(";", ",").split(",")
            if p.strip()
        ]
        return _json_safe(start_hype_volume_funnel_scan(ticker_list or None))

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
    def sheet_simulation(
        source: str = Query(
            "",
            description="Source: 'workbook' (default) or 'simulation_grafici' (legacy)."
        ),
        page: int = Query(1, ge=1),
        page_size: int = Query(50, ge=1, le=200),
    ) -> dict[str, Any]:
        from excel_sheet_reader import read_simulation_table_cached

        table = read_simulation_table_cached()
        if not isinstance(table, dict) or "rows" not in table:
            return _sheet_json_safe(lambda: table)

        all_rows = table["rows"]
        total = len(all_rows)
        start_idx = (page - 1) * page_size
        end_idx = min(start_idx + page_size, total)

        paginated_table = {
            **table,
            "rows": all_rows[start_idx:end_idx],
            "_pagination": {
                "page": page,
                "page_size": page_size,
                "total": total,
                "total_pages": (total + page_size - 1) // page_size,
                "has_next": end_idx < total,
                "has_prev": page > 1,
            },
        }

        return _sheet_json_safe(lambda: paginated_table)

    @application.post("/api/market/continuation/refresh")
    def market_continuation_refresh(
        dry_run: bool = Query(False, description="Compute without writing snapshot"),
    ) -> dict[str, Any]:
        """
        Recompute P(continuation) on simulation_sheet_snapshot rows
        (g5/g10/g20 + z_own + pct_pop vs HistLib universe). No EIS inputs.
        """
        try:
            from prediction.continuation_score import enrich_simulation_snapshot_file

            return _json_safe(enrich_simulation_snapshot_file(dry_run=dry_run))
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

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
    def eis_cohort_comparison_get(force: bool = Query(False)) -> dict[str, Any]:
        """EIS cohort split for Performance tab — cached from signal_calibration when fresh."""
        from prediction.pre_cd_curve_impact import load_eis_cohort_api_payload

        return _json_safe(load_eis_cohort_api_payload(force_refresh=force))

    @application.get("/api/models/eis-cohort-weekly-history")
    def eis_cohort_weekly_history_get() -> dict[str, Any]:
        """Weekly EIS cohort trend points (one per ISO week, updated Lun–Ven 10:00)."""
        from prediction.eis_cohort_weekly_history import load_weekly_history

        return _json_safe(load_weekly_history())

    @application.get("/api/market/context/mcs")
    def market_context_mcs_get() -> dict[str, Any]:
        from prediction.market_context_score import load_market_context_snapshot

        return _json_safe(load_market_context_snapshot())

    @application.post("/api/market/context/mcs/refresh")
    def market_context_mcs_refresh() -> dict[str, Any]:
        from prediction.market_context_score import (
            build_market_context_snapshot,
            load_previous_snapshot,
            save_market_context_snapshot,
        )

        prev = load_previous_snapshot()
        doc = build_market_context_snapshot(previous=prev)
        save_market_context_snapshot(doc)
        return _json_safe(doc)

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
    def learning_lab_overview(force: bool = Query(False)) -> dict[str, Any]:
        # Snapshot-first: the orchestrator (or the desktop-snapshots pipeline)
        # writes ``learning_lab_overview_snapshot.json`` on every terminal
        # rewrite of the clinical enrichment snapshot. The handler just
        # parses it (~20 ms). See ``prediction.learning_lab.get_overview_for_api``
        # for the mtime-based cache and the missing-snapshot fallback.
        from prediction.learning_lab import get_overview_for_api

        return _json_safe(get_overview_for_api(force_refresh=force))

    @application.get("/api/tickers/resilience-snapshot")
    def resilience_scores_snapshot() -> dict[str, Any]:
        """Pre-computed Resilience Score for every ticker in the sim table.

        Served from ``data/resilience_scores_snapshot.json`` (built by the
        desktop-snapshots pipeline in ``excel_sheet_reader.py``). Handler
        is O(mtime stat), the full compute never runs on the request path.

        Rescue / SDS / Regulatory scores are computed independently: the
        resilience score is derived only from the ticker's own 5y price
        history and XBI closes. See prediction/resilience_score.py.
        """
        from prediction.resilience_score import (
            read_resilience_scores_snapshot,
        )

        payload = read_resilience_scores_snapshot()
        if payload is None:
            return _json_safe({
                "generated_at": None,
                "ticker_count": 0,
                "skipped_count": 0,
                "skipped": [],
                "entries": {},
                "status": "snapshot_missing",
            })
        return _json_safe(payload)

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

    @application.get("/api/catalyst-patterns")
    def catalyst_pattern_library_get() -> dict[str, Any]:
        from orchestrator_io_paths import CATALYST_PATTERN_LIBRARY_JSON

        p = Path(CATALYST_PATTERN_LIBRARY_JSON)
        if not p.is_file():
            return {"version": 1, "patterns": [], "cohort_summary": None, "updated_at": None}
        try:
            with p.open(encoding="utf-8") as fh:
                return _json_safe(json.load(fh))
        except (OSError, json.JSONDecodeError) as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @application.post("/api/catalyst-patterns/refresh")
    def catalyst_pattern_library_refresh() -> dict[str, Any]:
        import subprocess
        import sys

        script = Path(__file__).resolve().parent / "scripts" / "refresh_catalyst_pattern_library.py"
        if not script.is_file():
            raise HTTPException(status_code=404, detail="refresh script missing")
        cp = subprocess.run(
            [sys.executable, "-u", str(script), "-q"],
            cwd=str(Path(__file__).resolve().parent),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=180,
        )
        if cp.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail=cp.stderr[-2000:] if cp.stderr else f"exit {cp.returncode}",
            )
        from orchestrator_io_paths import CATALYST_PATTERN_LIBRARY_JSON

        p = Path(CATALYST_PATTERN_LIBRARY_JSON)
        with p.open(encoding="utf-8") as fh:
            return _json_safe(json.load(fh))

    @application.get("/api/catalyst-patterns/alerts")
    def catalyst_pattern_alerts_get(tickers: str = "") -> dict[str, Any]:
        import sys

        eis_root = Path(__file__).resolve().parent / "eis_pattern_research"
        if str(eis_root) not in sys.path:
            sys.path.insert(0, str(eis_root))
        from src.catalyst_alerts import build_alerts_from_sim_snapshot

        tk_list = [t.strip().upper() for t in tickers.split(",") if t.strip()] or None
        return _json_safe(build_alerts_from_sim_snapshot(tickers=tk_list))

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
        incoming = raw if isinstance(raw, dict) else {}
        # Merge with on-disk book so a stale desktop republish cannot wipe a
        # mobile buy (or vice versa). Opt out with ``{"replace": true}``.
        force_replace = bool(body.get("replace"))
        existing: dict[str, Any] = {}
        p = INVEST_SIM_INPUTS_PATH
        if p.is_file() and not force_replace:
            try:
                with p.open(encoding="utf-8") as fh:
                    prev = json.load(fh)
                if isinstance(prev, dict) and isinstance(prev.get("inputs"), dict):
                    existing = prev["inputs"]
            except (OSError, json.JSONDecodeError):
                existing = {}
        if force_replace:
            inputs = incoming
        else:
            from invest_sim_inputs_merge import merge_invest_sim_inputs

            inputs = merge_invest_sim_inputs(existing, incoming)
        payload = {
            "version": 1,
            "updated_at": datetime.now().astimezone().isoformat(),
            "inputs": inputs,
        }
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
    def sheet_financial(
        page: int = Query(1, ge=1),
        page_size: int = Query(50, ge=1, le=500),
    ) -> dict[str, Any]:
        from excel_sheet_reader import read_financial_table_cached

        table = read_financial_table_cached()
        if not isinstance(table, dict) or "rows" not in table:
            return _sheet_json_safe(lambda: table)

        all_rows = table["rows"]
        total = len(all_rows)
        start_idx = (page - 1) * page_size
        end_idx = min(start_idx + page_size, total)

        paginated_table = {
            **table,
            "rows": all_rows[start_idx:end_idx],
            "_pagination": {
                "page": page,
                "page_size": page_size,
                "total": total,
                "total_pages": (total + page_size - 1) // page_size,
                "has_next": end_idx < total,
                "has_prev": page > 1,
            },
        }

        return _sheet_json_safe(lambda: paginated_table)

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
                "auth": "email_auto_approved",
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
                interest_edition=body.get("interest_edition") if isinstance(body.get("interest_edition"), str) else None,
                interest_other=body.get("interest_other") if isinstance(body.get("interest_other"), str) else None,
                first_name=body.get("first_name") if isinstance(body.get("first_name"), str) else None,
                last_name=body.get("last_name") if isinstance(body.get("last_name"), str) else None,
                birth_year=body.get("birth_year"),
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return _json_safe({"ok": True, "tester": meta})

    @application.post("/api/premium-waitlist")
    async def premium_waitlist_join(body: dict[str, Any]) -> dict[str, Any]:
        import premium_waitlist as _pw

        email = body.get("email") if isinstance(body.get("email"), str) else ""
        try:
            return _json_safe(_pw.join_premium_waitlist(email))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @application.get("/api/premium-waitlist")
    def premium_waitlist_list() -> dict[str, Any]:
        import premium_waitlist as _pw

        return _json_safe(_pw.list_premium_waitlist())

    @application.post("/api/hitech-notify")
    async def hitech_notify_join(body: dict[str, Any]) -> dict[str, Any]:
        """Public — email interest for Hi-Tech desk (not Premium access)."""
        import hitech_notify as _hn

        email = body.get("email") if isinstance(body.get("email"), str) else ""
        try:
            return _json_safe(_hn.join_hitech_notify(email))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @application.get("/api/hitech-notify")
    def hitech_notify_list() -> dict[str, Any]:
        import hitech_notify as _hn

        return _json_safe(_hn.list_hitech_notify())

    @application.post("/api/hitech-notify/dismiss")
    async def hitech_notify_dismiss(body: dict[str, Any]) -> dict[str, Any]:
        """Access tab — remove Technology/AI notify row."""
        import hitech_notify as _hn

        email = body.get("email") if isinstance(body.get("email"), str) else ""
        try:
            return _json_safe(_hn.remove_hitech_notify(email))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @application.post("/api/contact")
    async def contact_submit(body: dict[str, Any]) -> dict[str, Any]:
        """Public Contact form — email, name, message → Access tab."""
        import contact_messages as _cm

        try:
            return _json_safe(
                _cm.submit_contact_message(
                    email=body.get("email") if isinstance(body.get("email"), str) else "",
                    first_name=body.get("first_name")
                    if isinstance(body.get("first_name"), str)
                    else "",
                    last_name=body.get("last_name")
                    if isinstance(body.get("last_name"), str)
                    else "",
                    message=body.get("message") if isinstance(body.get("message"), str) else "",
                )
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @application.get("/api/contact")
    def contact_list() -> dict[str, Any]:
        """Access tab — Contact messages inbox."""
        import contact_messages as _cm

        return _json_safe(_cm.list_contact_messages())

    @application.post("/api/contact/dismiss")
    async def contact_dismiss(body: dict[str, Any]) -> dict[str, Any]:
        """Access tab — remove one Contact message."""
        import contact_messages as _cm

        mid = body.get("id") if isinstance(body.get("id"), str) else ""
        try:
            return _json_safe(_cm.dismiss_contact_message(mid))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @application.post("/api/premium-waitlist/grant")
    async def premium_waitlist_grant(body: dict[str, Any]) -> dict[str, Any]:
        """Access tab — approve Premium request (Basic + Calendar/Discovery)."""
        import tester_feedback_io as tf

        email = body.get("email") if isinstance(body.get("email"), str) else ""
        try:
            return _json_safe(tf.grant_premium_from_waitlist(email))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @application.post("/api/premium-waitlist/dismiss")
    async def premium_waitlist_dismiss(body: dict[str, Any]) -> dict[str, Any]:
        """Access tab — remove waitlist row without granting Premium."""
        import premium_waitlist as _pw

        email = body.get("email") if isinstance(body.get("email"), str) else ""
        try:
            return _json_safe(_pw.remove_premium_waitlist_email(email))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @application.get("/api/tester-feedback/testers/{tester_id}/access")
    def tester_feedback_access(tester_id: str) -> dict[str, Any]:
        import tester_feedback_io as tf

        try:
            return _json_safe(tf.get_tester_access(tester_id))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @application.post("/api/tester-feedback/testers/{tester_id}/session")
    async def tester_feedback_create_session(tester_id: str, body: dict[str, Any]) -> dict[str, Any]:
        """Issue device session token (email must match approved tester)."""
        import tester_feedback_io as tf

        email = body.get("email") if isinstance(body.get("email"), str) else ""
        try:
            meta = tf.create_session_for_email(tester_id, email)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return _json_safe({"ok": True, "tester": meta})

    @application.get("/api/tester-feedback/testers/{tester_id}/sim-inputs")
    def tester_sim_inputs_get(tester_id: str, request: Request) -> dict[str, Any]:
        import tester_sim_inputs_io as tsi

        _require_tester_book_auth(request, tester_id)
        try:
            return _json_safe(tsi.load_sim_inputs(tester_id))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @application.put("/api/tester-feedback/testers/{tester_id}/sim-inputs")
    async def tester_sim_inputs_put(
        tester_id: str, request: Request, body: dict[str, Any]
    ) -> dict[str, Any]:
        import tester_sim_inputs_io as tsi

        _require_tester_book_auth(request, tester_id)
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

    @application.post("/api/tester-feedback/testers/{tester_id}/premium")
    async def tester_feedback_set_premium(tester_id: str, body: dict[str, Any]) -> dict[str, Any]:
        """Grant / revoke premium (Calendar, Discovery, interest enroll). Owner always premium."""
        import tester_feedback_io as tf

        premium = body.get("premium")
        if not isinstance(premium, bool):
            raise HTTPException(status_code=400, detail="premium bool richiesto")
        try:
            meta = tf.set_tester_premium(tester_id, premium)
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

    @application.post("/api/tester-feedback/testers/{tester_id}/reply")
    async def tester_feedback_owner_reply(tester_id: str, body: dict[str, Any]) -> dict[str, Any]:
        import tester_feedback_io as tf

        subject = body.get("subject") if isinstance(body.get("subject"), str) else ""
        message = body.get("body") if isinstance(body.get("body"), str) else ""
        try:
            meta = tf.send_tester_owner_reply(tester_id, subject=subject, body=message)
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

    @application.post("/api/tester-feedback/events/{event_id}/resolve")
    async def tester_feedback_resolve_ui_issue(
        event_id: str, body: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """Owner Access: close a user UI error issue after the problem is handled."""
        import tester_feedback_io as tf

        payload = body if isinstance(body, dict) else {}
        try:
            out = tf.resolve_ui_issue(
                event_id,
                note=payload.get("note") if isinstance(payload.get("note"), str) else None,
                resolved_by=(
                    payload.get("resolved_by")
                    if isinstance(payload.get("resolved_by"), str)
                    else "owner"
                ),
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return _json_safe(out)

    @application.get("/api/tester-feedback/sim-monitor")
    def tester_feedback_sim_monitor() -> dict[str, Any]:
        import tester_sim_monitor as tsm

        return _json_safe(tsm.build_sim_monitor())

    @application.get("/api/tester-feedback/export")
    def tester_feedback_export() -> dict[str, Any]:
        import tester_feedback_io as tf

        return _json_safe(tf.build_calibration_document())

    @application.post("/api/tester-feedback/export/snapshot")
    def tester_feedback_export_snapshot() -> dict[str, Any]:
        import tester_feedback_io as tf

        return _json_safe(tf.save_calibration_snapshot())

    @application.get("/api/mobile/dashboard-snapshot")
    def mobile_dashboard_snapshot_get(request: Request) -> Any:
        """Slim companion snapshot (no curveCharts). Supports ETag / If-None-Match → 304."""
        import mobile_snapshot_io as msi

        msi.ensure_split_on_disk()
        p = MOBILE_DASHBOARD_SNAPSHOT_PATH
        if not p.is_file():
            return {"version": 1, "updated_at": None, "source": "missing"}
        try:
            st = p.stat()
        except OSError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        etag = f'W/"{st.st_mtime_ns}-{st.st_size}-slim"'
        inm = (request.headers.get("if-none-match") or "").strip()
        headers = {
            "ETag": etag,
            "Cache-Control": "private, max-age=30, must-revalidate",
        }
        if inm and inm == etag:
            return Response(status_code=304, headers=headers)
        return FileResponse(
            p,
            media_type="application/json; charset=utf-8",
            headers=headers,
        )

    @application.get("/api/mobile/curve-charts")
    def mobile_curve_charts_get(
        request: Request,
        key: str | None = Query(None, description="Decision-chart row key"),
    ) -> Any:
        """Lazy curve charts for opportunity detail (split from poll snapshot)."""
        import mobile_snapshot_io as msi

        msi.ensure_split_on_disk()
        if key and str(key).strip():
            hit = msi.curve_chart_for_key(str(key))
            return _json_safe(
                {
                    "ok": True,
                    "key": str(key).strip(),
                    "curveCharts": hit,
                    "updated_at": (msi.load_curve_charts() or {}).get("updated_at"),
                }
            )
        # Full charts doc is large — only with admin token.
        if not _request_has_admin_token(request):
            raise HTTPException(
                status_code=400,
                detail="Pass ?key=TICKER|YYYY-MM-DD for a single chart bundle",
            )
        return _json_safe(msi.load_curve_charts())

    @application.put("/api/mobile/dashboard-snapshot")
    async def mobile_dashboard_snapshot_put(body: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="body deve essere un oggetto JSON")
        import mobile_snapshot_io as msi

        payload = {
            "version": 1,
            "updated_at": datetime.now().astimezone().isoformat(),
            **{k: v for k, v in body.items() if k not in ("version", "updated_at")},
        }
        try:
            split_info = msi.write_split_snapshot(payload)
        except OSError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        push_info: dict[str, Any] = {}
        try:
            import mobile_push as mp

            push_info = mp.maybe_notify_soft_rec_change(payload)
        except Exception as exc:  # noqa: BLE001
            logger.warning("mobile push after snapshot PUT failed: %s", exc)
            push_info = {"ok": False, "error": str(exc)}
        return _json_safe(
            {
                "ok": True,
                "path": str(MOBILE_DASHBOARD_SNAPSHOT_PATH),
                "updated_at": payload["updated_at"],
                "push": push_info,
                "split": split_info,
            }
        )

    def _load_whatif_readout_daily_snapshot() -> dict[str, Any]:
        p = WHATIF_READOUT_DAILY_SNAPSHOT_PATH
        if not p.is_file():
            return {"schemaVersion": 1, "updatedAt": None, "days": {}}
        try:
            with p.open(encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, json.JSONDecodeError):
            return {"schemaVersion": 1, "updatedAt": None, "days": {}}
        return data if isinstance(data, dict) else {"schemaVersion": 1, "updatedAt": None, "days": {}}

    def _merge_whatif_readout_daily_snapshot(existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
        out_days: dict[str, Any] = dict(existing.get("days") or {})
        in_days = incoming.get("days") if isinstance(incoming.get("days"), dict) else {}
        for session_date, bucket in in_days.items():
            day_key = str(session_date).strip()
            if not day_key or not isinstance(bucket, dict):
                continue
            day_out = dict(out_days.get(day_key) or {})
            for ticker, entry in bucket.items():
                tk = str(ticker).strip().upper()
                if not tk or not isinstance(entry, dict):
                    continue
                if tk in day_out:
                    prev = day_out[tk] if isinstance(day_out[tk], dict) else {}
                    prev_at = prev.get("capturedAt")
                    next_at = entry.get("capturedAt")
                    if prev_at and next_at:
                        try:
                            if datetime.fromisoformat(str(next_at)) >= datetime.fromisoformat(str(prev_at)):
                                continue
                        except ValueError:
                            continue
                    else:
                        continue
                day_out[tk] = entry
            out_days[day_key] = day_out
        return {
            "schemaVersion": 1,
            "updatedAt": datetime.now().astimezone().isoformat(),
            "days": out_days,
        }

    @application.get("/api/whatif/readout-daily-snapshot")
    def whatif_readout_daily_snapshot_get() -> dict[str, Any]:
        return _json_safe(_load_whatif_readout_daily_snapshot())

    @application.put("/api/whatif/readout-daily-snapshot")
    async def whatif_readout_daily_snapshot_put(body: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="body deve essere un oggetto JSON")
        existing = _load_whatif_readout_daily_snapshot()
        merged = _merge_whatif_readout_daily_snapshot(existing, body)
        p = WHATIF_READOUT_DAILY_SNAPSHOT_PATH
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".json.tmp")
        try:
            tmp.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
            tmp.replace(p)
        except OSError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        return _json_safe({"ok": True, "path": str(p), "updatedAt": merged.get("updatedAt")})

    @application.post("/api/mobile/dashboard-snapshot/refresh")
    def mobile_dashboard_snapshot_refresh_endpoint() -> dict[str, Any]:
        """Rebuild mobile dashboard snapshot from data/ JSON (same logic as desktop Home)."""
        from scripts.mobile_dashboard_snapshot_refresh import refresh_mobile_dashboard_snapshot
        import mobile_snapshot_io as msi

        summary = refresh_mobile_dashboard_snapshot()
        split_info: dict[str, Any] = {}
        try:
            split_info = msi.ensure_split_on_disk()
        except Exception as exc:  # noqa: BLE001
            logger.warning("mobile snapshot split after refresh failed: %s", exc)
            split_info = {"ok": False, "error": str(exc)}
        push_info: dict[str, Any] = {}
        try:
            import mobile_push as mp

            if MOBILE_DASHBOARD_SNAPSHOT_PATH.is_file():
                with MOBILE_DASHBOARD_SNAPSHOT_PATH.open(encoding="utf-8") as fh:
                    snap = json.load(fh)
                if isinstance(snap, dict):
                    push_info = mp.maybe_notify_soft_rec_change(snap)
        except Exception as exc:  # noqa: BLE001
            logger.warning("mobile push after snapshot refresh failed: %s", exc)
            push_info = {"ok": False, "error": str(exc)}
        if isinstance(summary, dict):
            summary = {**summary, "push": push_info, "split": split_info}
        return _json_safe(summary)

    @application.get("/api/mobile/push/vapid-public-key")
    def mobile_push_vapid_public_key() -> dict[str, Any]:
        import mobile_push as mp

        key = mp.vapid_public_key()
        if not key:
            raise HTTPException(
                status_code=503,
                detail="Web Push not configured (set SUPERNOVA_VAPID_PUBLIC/PRIVATE)",
            )
        return {"publicKey": key, "configured": True}

    @application.post("/api/mobile/push/subscribe")
    async def mobile_push_subscribe(body: dict[str, Any]) -> dict[str, Any]:
        import mobile_push as mp

        if not mp.vapid_configured():
            raise HTTPException(
                status_code=503,
                detail="Web Push not configured (set SUPERNOVA_VAPID_PUBLIC/PRIVATE)",
            )
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="body must be a JSON object")
        try:
            return _json_safe(mp.upsert_subscription(body))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @application.post("/api/mobile/push/unsubscribe")
    async def mobile_push_unsubscribe(body: dict[str, Any]) -> dict[str, Any]:
        import mobile_push as mp

        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="body must be a JSON object")
        endpoint = body.get("endpoint")
        if not isinstance(endpoint, str) or not endpoint.strip():
            raise HTTPException(status_code=400, detail="endpoint required")
        return _json_safe(mp.remove_subscription(endpoint))

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

    _register_cdn_routes(application)
    _mount_mobile_web_subpath(application, c)
    _mount_desktop_web(application, c)
    _mount_mobile_short_pwa(application, c)
    return application


app = build_app()


def main() -> None:
    """Run API: single uvicorn, or gunicorn multi-worker when SUPERNOVA_WORKERS>1."""
    import uvicorn

    logging.basicConfig(level=logging.INFO)
    cfg = get_supernova_config()
    _log_startup_security(cfg)
    try:
        workers = int(os.environ.get("SUPERNOVA_WORKERS", "1").strip() or "1")
    except ValueError:
        workers = 1
    workers = max(1, min(16, workers))

    # Gunicorn + UvicornWorker is Linux/mac only (VPS). Windows stays on uvicorn.
    if workers > 1 and os.name != "nt":
        gunicorn = Path(sys.executable).with_name("gunicorn")
        if not gunicorn.is_file():
            # venv on Linux: bin/gunicorn next to python
            alt = Path(sys.executable).resolve().parent / "gunicorn"
            gunicorn = alt if alt.is_file() else Path("gunicorn")
        cmd = [
            str(gunicorn if gunicorn.is_file() else "gunicorn"),
            "-b",
            f"{cfg.uvicorn_host}:{cfg.uvicorn_port}",
            "-w",
            str(workers),
            "-k",
            "uvicorn.workers.UvicornWorker",
            "--timeout",
            str(int(os.environ.get("SUPERNOVA_GUNICORN_TIMEOUT", "120") or "120")),
            "--graceful-timeout",
            "30",
            "--keep-alive",
            "5",
            "--access-logfile",
            "-",
            "--error-logfile",
            "-",
            "supernova_api:app",
        ]
        logger.info("Starting %s", " ".join(cmd))
        os.execvp(cmd[0], cmd)

    uvicorn.run(
        "supernova_api:app",
        host=cfg.uvicorn_host,
        port=cfg.uvicorn_port,
        log_level="info",
        workers=1,
    )


if __name__ == "__main__":
    main()
