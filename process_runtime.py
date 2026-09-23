"""
Cross-worker runtime state (orchestrator / refresh PIDs).

Uvicorn/gunicorn workers do not share memory; subprocess handles must live on
disk so any worker can answer ``/api/health`` and avoid double-starts.
"""
from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Any

from orchestrator_io_paths import DATA_DIR

_log = logging.getLogger(__name__)

RUNTIME_DIR = Path(DATA_DIR) / "runtime"
ORCH_PATH = RUNTIME_DIR / "orchestrator.json"
REFRESH_PATH = RUNTIME_DIR / "refresh.json"
CD_SCAN_PATH = RUNTIME_DIR / "cd_scan.json"
SCHEDULER_LOCK = RUNTIME_DIR / "scheduler.lock"


def _ensure_dir() -> None:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)


def _pid_alive(pid: int | None) -> bool:
    if not pid or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    except Exception:
        return False
    return True


def write_job(path: Path, *, pid: int, extra: dict[str, Any] | None = None) -> None:
    _ensure_dir()
    doc = {
        "pid": int(pid),
        "started_at": time.time(),
        **(extra or {}),
    }
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(doc), encoding="utf-8")
    tmp.replace(path)


def clear_job(path: Path, *, pid: int | None = None) -> None:
    if not path.is_file():
        return
    try:
        if pid is not None:
            data = json.loads(path.read_text(encoding="utf-8"))
            if int(data.get("pid") or 0) != int(pid):
                return
        path.unlink(missing_ok=True)
    except Exception as exc:
        _log.debug("clear_job %s: %s", path, exc)


def read_job(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    pid = int(data.get("pid") or 0)
    if not _pid_alive(pid):
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
        return None
    data["alive"] = True
    return data


def orchestrator_running() -> bool:
    return read_job(ORCH_PATH) is not None


def refresh_running() -> bool:
    return read_job(REFRESH_PATH) is not None


def try_acquire_scheduler_lock() -> bool:
    """
    Only one gunicorn worker should run the web scheduler.

    Uses O_EXCL lock file; stale locks (dead pid) are replaced.
    """
    _ensure_dir()
    my_pid = os.getpid()
    if SCHEDULER_LOCK.is_file():
        try:
            raw = SCHEDULER_LOCK.read_text(encoding="utf-8").strip()
            old = int(raw.split()[0]) if raw else 0
            if _pid_alive(old):
                return old == my_pid
        except Exception:
            pass
        try:
            SCHEDULER_LOCK.unlink(missing_ok=True)
        except OSError:
            return False
    try:
        fd = os.open(str(SCHEDULER_LOCK), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        try:
            os.write(fd, f"{my_pid}\n".encode("ascii"))
        finally:
            os.close(fd)
        return True
    except FileExistsError:
        return False
    except OSError as exc:
        _log.warning("scheduler lock failed: %s", exc)
        return False


def release_scheduler_lock() -> None:
    if not SCHEDULER_LOCK.is_file():
        return
    try:
        raw = SCHEDULER_LOCK.read_text(encoding="utf-8").strip()
        old = int(raw.split()[0]) if raw else 0
        if old == os.getpid():
            SCHEDULER_LOCK.unlink(missing_ok=True)
    except Exception:
        pass
