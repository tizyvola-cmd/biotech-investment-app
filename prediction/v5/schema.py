"""Dataclasses for v5 probabilistic catalyst curves."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, TypedDict

# Calendar days from catalyst date (CD = 0).
NODE_OFFSETS: tuple[int, ...] = (-60, -30, -10, -7, -5, -3, 0, 4, 7)


class QuantileDict(TypedDict):
    q05: float
    q50: float
    q95: float


class NodeDict(TypedDict, total=False):
    offset: int
    q05: float
    q50: float
    q95: float


class PredictionDistributionDict(TypedDict, total=False):
    nodes: dict[str, NodeDict]
    regime: str
    metadata: dict[str, Any]


@dataclass(frozen=True)
class CurveNodeQuantiles:
    offset: int
    q05: float
    q50: float
    q95: float

    def as_dict(self) -> NodeDict:
        return {
            "offset": self.offset,
            "q05": round(self.q05, 4),
            "q50": round(self.q50, 4),
            "q95": round(self.q95, 4),
        }


@dataclass
class PredictionDistribution:
    """Fan chart nodes T-60 … CD+7 with quantiles and regime metadata."""

    nodes: dict[int, CurveNodeQuantiles] = field(default_factory=dict)
    regime: str = "trend"
    metadata: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> PredictionDistributionDict:
        return {
            "nodes": {str(k): v.as_dict() for k, v in sorted(self.nodes.items())},
            "regime": self.regime,
            "metadata": dict(self.metadata),
        }
