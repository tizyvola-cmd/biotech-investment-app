"""File di stato per macro Excel / automazioni esterne (refresh_fast)."""
from __future__ import annotations

import glob
import os
from datetime import datetime

from orchestrator_io_paths import DATA_DIR, FINAL_XLSX

REFRESH_FAST_STATUS_PATH = os.path.join(DATA_DIR, "refresh_fast_status.txt")


def _stamp() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def write_refresh_fast_status(
    *,
    state: str,
    ok: bool | None = None,
    message: str = "",
    workbook: str | None = None,
    staged_workbook: str | None = None,
    snapshots_exported: bool | None = None,
) -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    lines = [
        f"state={state}",
        f"ok={'1' if ok else '0' if ok is False else ''}",
        f"message={message.replace(chr(10), ' ').replace(chr(13), ' ')}",
        f"workbook={workbook or FINAL_XLSX}",
        f"staged_workbook={staged_workbook or ''}",
        f"snapshots_exported={'1' if snapshots_exported else '0' if snapshots_exported is False else ''}",
        f"updated_at={_stamp()}",
    ]
    with open(REFRESH_FAST_STATUS_PATH, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")


def find_latest_staged_workbook(workbook_path: str | None = None) -> str | None:
    """Ultimo ``*__staged_*.xlsx`` accanto al workbook principale."""
    base = os.path.abspath(workbook_path or FINAL_XLSX)
    dname = os.path.dirname(base) or "."
    stem = os.path.splitext(os.path.basename(base))[0]
    pattern = os.path.join(dname, f"{stem}__staged_*.xlsx")
    hits = glob.glob(pattern)
    if not hits:
        return None
    hits.sort(key=lambda p: os.path.getmtime(p), reverse=True)
    return os.path.abspath(hits[0])
