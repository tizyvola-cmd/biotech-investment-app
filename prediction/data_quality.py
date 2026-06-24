"""
Data-quality reporting for prediction market inputs (Yahoo / options).

Strictness for missing options/price: ``prediction.config`` env
``PRED_REQUIRE_OPTIONS`` / ``PRED_REQUIRE_PRICE`` (via ``get_config()``).
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field

from prediction.config import get_config


@dataclass
class DataQualityReport:
    """Per-event quality flags and aggregate score (0–1)."""

    price_ok: bool = False
    volume_ok: bool = False
    xbi_ok: bool = False
    options_ok: bool = False
    hist_5y_ok: bool = False
    missing: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    quality_score: float = 0.0

    _FLAG_WEIGHTS: tuple[tuple[str, float], ...] = (
        ("price_ok", 0.35),
        ("volume_ok", 0.15),
        ("xbi_ok", 0.15),
        ("options_ok", 0.15),
        ("hist_5y_ok", 0.20),
    )

    def recompute_score(self) -> None:
        total_w = sum(w for _, w in self._FLAG_WEIGHTS)
        if total_w <= 0:
            self.quality_score = 0.0
            return
        got = sum(
            w for name, w in self._FLAG_WEIGHTS if bool(getattr(self, name))
        )
        self.quality_score = round(got / total_w, 3)

    def to_dict(self) -> dict:
        d = asdict(self)
        d.pop("_FLAG_WEIGHTS", None)
        return d


_MISSING_LABELS: dict[str, str] = {
    "price": "prezzo 60d",
    "volume": "volume 60d",
    "xbi": "benchmark XBI",
    "options": "opzioni (PCR/move)",
    "hist_5y": "storico 5y",
}


def build_data_quality_report(
    *,
    price_ok: bool,
    volume_ok: bool,
    xbi_ok: bool,
    options_ok: bool,
    hist_5y_ok: bool,
    options_error: str | None = None,
    warnings: list[str] | None = None,
) -> DataQualityReport:
    """Build report from booleans; fills ``missing`` and ``quality_score``."""
    rep = DataQualityReport(
        price_ok=price_ok,
        volume_ok=volume_ok,
        xbi_ok=xbi_ok,
        options_ok=options_ok,
        hist_5y_ok=hist_5y_ok,
        warnings=list(warnings or []),
    )
    if not price_ok:
        rep.missing.append(_MISSING_LABELS["price"])
    if not volume_ok:
        rep.missing.append(_MISSING_LABELS["volume"])
    if not xbi_ok:
        rep.missing.append(_MISSING_LABELS["xbi"])
    if not options_ok:
        rep.missing.append(_MISSING_LABELS["options"])
        if options_error:
            rep.warnings.append(f"opzioni: {options_error}")
    if not hist_5y_ok:
        rep.missing.append(_MISSING_LABELS["hist_5y"])
    rep.recompute_score()
    return rep


def format_dq_adj_tag(report: DataQualityReport, *, max_len: int = 80) -> str:
    """Short tag for ``adj_notes`` / Excel, e.g. ``[DQ: no options, no XBI]``."""
    if report.quality_score >= 1.0:
        return ""
    parts: list[str] = []
    if not report.options_ok:
        parts.append("no options")
    if not report.xbi_ok:
        parts.append("no XBI")
    if not report.price_ok:
        parts.append("no price")
    if not report.volume_ok:
        parts.append("no volume")
    if not report.hist_5y_ok:
        parts.append("no 5y")
    if not parts:
        return ""
    tag = "[DQ: " + ", ".join(parts) + "]"
    if len(tag) > max_len:
        tag = tag[: max_len - 1].rstrip(", ") + "…]"
    return tag


def prediction_inputs_strict() -> tuple[bool, bool]:
    """(require_options, require_price) from centralized env config."""
    c = get_config()
    return c.pred_require_options, c.pred_require_price


__all__ = [
    "DataQualityReport",
    "build_data_quality_report",
    "format_dq_adj_tag",
    "prediction_inputs_strict",
]
