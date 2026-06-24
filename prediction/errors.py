"""
Central prediction error logging and partial-result metadata.

Remaining silent-exception debt (out of scope for weakness #7 pass):
- ``data_orchestrator.py`` — large legacy surface; migrate incrementally.
- ``prediction/seq_calib.py`` — many defensive ``except Exception: pass``.
- ``prediction/curve_fit.py`` — partial print-only handlers.
- ``simulation_grafici_sheet.py`` — chart/histlib paths outside merge_live_pred.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from prediction.config import get_config

_LOG = logging.getLogger("prediction")


def log_prediction_error(
    context: str,
    exc: Exception,
    level: int = logging.WARNING,
) -> None:
    """Log a prediction sub-step failure; re-raise when ``PRED_STRICT_ERRORS=1``."""
    msg = str(exc).strip() or type(exc).__name__
    _LOG.log(level, "[%s] %s", context, msg, exc_info=level >= logging.ERROR)
    if get_config().pred_strict_errors:
        raise exc


class ErrorAccumulator:
    """Collects non-fatal errors for partial prediction/refresh outputs."""

    __slots__ = ("_entries",)

    def __init__(self) -> None:
        self._entries: list[dict[str, str]] = []

    def record(self, context: str, exc: Exception | str) -> None:
        message = str(exc).strip() if not isinstance(exc, Exception) else (
            str(exc).strip() or type(exc).__name__
        )
        self._entries.append(
            {
                "context": context,
                "message": message,
                "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            }
        )
        if isinstance(exc, Exception):
            log_prediction_error(context, exc)
        else:
            _LOG.warning("[%s] %s", context, message)
            if get_config().pred_strict_errors:
                raise RuntimeError(f"{context}: {message}")

    @property
    def entries(self) -> list[dict[str, str]]:
        return list(self._entries)

    def __bool__(self) -> bool:
        return bool(self._entries)

    @property
    def partial(self) -> bool:
        return bool(self._entries)

    def as_strings(self) -> list[str]:
        return [f"{e['context']}: {e['message']}" for e in self._entries]

    def extend_report(self, report: Any) -> None:
        """Populate ``errors`` / ``partial`` on a dataclass report if present."""
        if not self._entries:
            return
        errs = self.as_strings()
        if hasattr(report, "errors"):
            existing = getattr(report, "errors", None) or []
            setattr(report, "errors", list(existing) + errs)
        if hasattr(report, "partial"):
            setattr(report, "partial", bool(getattr(report, "partial", False)) or True)


def result_with_errors(
    data: Any,
    accumulator: ErrorAccumulator | None,
) -> Any:
    """
    Attach ``errors`` and ``partial=True`` to dict results when the accumulator
    recorded any non-fatal failure.
    """
    if accumulator is None or not accumulator:
        return data
    errs = accumulator.as_strings()
    if isinstance(data, dict):
        out = dict(data)
        prev = out.get("errors")
        if isinstance(prev, list):
            out["errors"] = list(prev) + errs
        else:
            out["errors"] = errs
        out["partial"] = True
        return out
    return data


def empty_result_with_error(
    context: str,
    exc: Exception,
    *,
    base: dict | None = None,
) -> dict:
    """Structured empty dict for ``except …: return {}`` replacements."""
    log_prediction_error(context, exc)
    out = dict(base) if base else {}
    out["_error"] = str(exc).strip() or type(exc).__name__
    out["partial"] = True
    out["errors"] = [f"{context}: {out['_error']}"]
    return out


__all__ = [
    "ErrorAccumulator",
    "empty_result_with_error",
    "log_prediction_error",
    "result_with_errors",
]
