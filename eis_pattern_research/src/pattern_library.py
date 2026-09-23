"""
Catalyst pattern library — discover, confirm, and evolve repeatable pre/post CD patterns.

Loop:
  1. Load unified event panel (archived + active pipeline)
  2. Score each pattern on all events with labeled outcomes
  3. Update confirmation stats; deprecate patterns that degrade
  4. Mine new candidate patterns from high-lift feature combos
  5. Merge similar patterns; persist JSON for app consumption
"""
from __future__ import annotations

import json
import logging
import math
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from itertools import combinations
from pathlib import Path
from typing import Any, Literal

import numpy as np
import pandas as pd
from scipy import stats

from .config import MIN_EVENTS_FOR_SIGNIFICANCE
from .supernova_bridge import cohort_summary, load_unified_catalyst_panel

logger = logging.getLogger(__name__)

PatternPhase = Literal["pre_volume_watch", "dump_entry", "exhaustion_exit"]
PatternStatus = Literal["hypothesis", "emerging", "confirmed", "deprecated"]

LIBRARY_VERSION = 1


@dataclass
class PatternCondition:
    feature: str
    op: Literal[">=", "<=", "abs<=", ">"]
    threshold: float
    threshold_kind: Literal["absolute", "percentile"] = "absolute"
    percentile: float | None = None


@dataclass
class PatternDefinition:
    id: str
    phase: PatternPhase
    name_en: str
    name_it: str
    description_en: str
    description_it: str
    conditions: list[PatternCondition]
    outcome_feature: str = "run_m30_m3_pct"
    outcome_success_min_pct: float = 5.0
    version: int = 1
    status: PatternStatus = "hypothesis"
    created_at: str = ""
    updated_at: str = ""
    stats: dict[str, Any] = field(default_factory=dict)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _eval_condition(row: pd.Series, cond: PatternCondition) -> bool:
    v = row.get(cond.feature)
    if v is None or (isinstance(v, float) and not math.isfinite(v)):
        return False
    x = float(v)
    t = float(cond.threshold)
    if cond.op == ">=":
        return x >= t
    if cond.op == "<=":
        return x <= t
    if cond.op == ">":
        return x > t
    if cond.op == "abs<=":
        return abs(x) <= t
    return False


def pattern_matches(row: pd.Series, pattern: PatternDefinition) -> bool:
    return all(_eval_condition(row, c) for c in pattern.conditions)


def _percentile_threshold(series: pd.Series, q: float) -> float:
    clean = series.dropna()
    if clean.empty:
        return float("nan")
    return float(clean.quantile(q))


def seed_patterns(df: pd.DataFrame) -> list[PatternDefinition]:
    """Canonical patterns aligned to the 3-phase user objective."""
    now = _now_iso()
    pct = {f: df[f].dropna() for f in df.columns if df[f].dtype in ("float64", "float32", "int64")}

    def p(f: str, q: float) -> float:
        return _percentile_threshold(pct.get(f, pd.Series(dtype=float)), q)

    return [
        PatternDefinition(
            id="pre_volume_silent_accumulation",
            phase="pre_volume_watch",
            name_en="Silent volume build",
            name_it="Accumulo silenzioso volume",
            description_en="High relative volume with flat 20d slope — anticipatory activity before visible price move.",
            description_it="Volume relativo alto con slope 20g piatta — attività anticipatoria prima del movimento visibile.",
            conditions=[
                PatternCondition("vol_ratio", ">=", p("vol_ratio", 0.75), "percentile", 0.75),
                PatternCondition("slope_20d", "abs<=", p("slope_20d", 0.50), "percentile", 0.50),
            ],
            created_at=now,
            updated_at=now,
        ),
        PatternDefinition(
            id="pre_volume_xbi_divergence",
            phase="pre_volume_watch",
            name_en="XBI divergence + volume",
            name_it="Divergenza XBI + volume",
            description_en="Ticker outperforming XBI slope with rising volume ratio.",
            description_it="Ticker in outperformance vs slope XBI con volume ratio in aumento.",
            conditions=[
                PatternCondition("exc_slope_vs_XBI", ">=", p("exc_slope_vs_XBI", 0.70), "percentile", 0.70),
                PatternCondition("vol_ratio", ">=", p("vol_ratio", 0.60), "percentile", 0.60),
            ],
            created_at=now,
            updated_at=now,
        ),
        PatternDefinition(
            id="dump_entry_capitalation",
            phase="dump_entry",
            name_en="Post-dump entry window",
            name_it="Ingresso post-dump",
            description_en="Deep drawdown from T-60 anchor — historical cases often recovered toward CD.",
            description_it="Drawdown profondo da ancora T-60 — storicamente spesso recovery verso CD.",
            conditions=[
                PatternCondition("dump_proxy_pct", "<=", -8.0, "absolute"),
            ],
            outcome_success_min_pct=10.0,
            created_at=now,
            updated_at=now,
        ),
        PatternDefinition(
            id="dump_entry_oversold_rsi",
            phase="dump_entry",
            name_en="Oversold RSI rebound",
            name_it="Rimbalzo RSI ipervenduto",
            description_en="Low RSI pre-CD — entry zone candidate after sell-off.",
            description_it="RSI basso pre-CD — candidato ingresso dopo sell-off.",
            conditions=[
                PatternCondition("rsi_14", "<=", p("rsi_14", 0.25), "percentile", 0.25),
            ],
            created_at=now,
            updated_at=now,
        ),
        PatternDefinition(
            id="exhaustion_distribution",
            phase="exhaustion_exit",
            name_en="Distribution (volume/price divergence)",
            name_it="Distribuzione (divergenza vol/prezzo)",
            description_en="Extended run-up with negative volume-price divergence — likely curve exhaustion.",
            description_it="Run-up esteso con divergenza volume-prezzo negativa — probabile esaurimento curva.",
            conditions=[
                PatternCondition("run_up_30d", ">=", p("run_up_30d", 0.75), "percentile", 0.75),
                PatternCondition("vol_price_div", "<", 0.0, "absolute"),
            ],
            outcome_success_min_pct=0.0,
            created_at=now,
            updated_at=now,
        ),
        PatternDefinition(
            id="exhaustion_rsi_stretched",
            phase="exhaustion_exit",
            name_en="RSI stretched pre-CD",
            name_it="RSI teso pre-CD",
            description_en="High RSI after extended run — take-profit zone candidate.",
            description_it="RSI alto dopo run esteso — candidato zona take-profit.",
            conditions=[
                PatternCondition("rsi_14", ">=", p("rsi_14", 0.80), "percentile", 0.80),
                PatternCondition("run_up_30d", ">=", p("run_up_30d", 0.65), "percentile", 0.65),
            ],
            outcome_success_min_pct=0.0,
            created_at=now,
            updated_at=now,
        ),
    ]


def _resolve_thresholds(pattern: PatternDefinition, df: pd.DataFrame) -> PatternDefinition:
    conds = []
    for c in pattern.conditions:
        if c.threshold_kind == "percentile" and c.percentile is not None and c.feature in df.columns:
            t = _percentile_threshold(df[c.feature], c.percentile)
            conds.append(
                PatternCondition(c.feature, c.op, t, c.threshold_kind, c.percentile)
            )
        else:
            conds.append(c)
    out = PatternDefinition(**{**asdict(pattern), "conditions": conds})
    return out


def score_pattern(
    pattern: PatternDefinition,
    df: pd.DataFrame,
    *,
    labeled_only: bool = True,
) -> dict[str, Any]:
    """Evaluate pattern on cohort; return stats dict."""
    work = df.copy()
    if labeled_only and "run_m30_m3_pct" in work.columns:
        work = work[work["run_m30_m3_pct"].notna()]

    if work.empty:
        return {"n_match": 0, "n_total": 0}

    resolved = _resolve_thresholds(pattern, work)
    mask = work.apply(lambda r: pattern_matches(r, resolved), axis=1)
    matched = work[mask]
    n_match = int(len(matched))
    n_total = int(len(work))

    baseline_rate = float(work["outcome_success_5pct"].mean()) if "outcome_success_5pct" in work.columns else None
    outcomes = matched["run_m30_m3_pct"].dropna()
    success = matched["outcome_success_5pct"] if "outcome_success_5pct" in matched.columns else pd.Series(dtype=bool)

    hit_rate = float(success.mean()) if len(success) else None
    median_outcome = float(outcomes.median()) if len(outcomes) else None
    mean_outcome = float(outcomes.mean()) if len(outcomes) else None

    lift = (hit_rate / baseline_rate) if hit_rate is not None and baseline_rate and baseline_rate > 0 else None

    p_value = None
    if n_match >= 3 and baseline_rate is not None and "outcome_success_5pct" in work.columns:
        non = work[~mask]["outcome_success_5pct"]
        if len(success) >= 2 and len(non) >= 2:
            table = [[int(success.sum()), int(len(success) - success.sum())], [int(non.sum()), int(len(non) - non.sum())]]
            try:
                _, p_value = stats.fisher_exact(table)
            except Exception:
                p_value = None

    tickers_repeat = 0
    if n_match and "ticker" in matched.columns:
        tc = matched.groupby("ticker").size()
        tickers_repeat = int((tc >= 2).sum())

    return {
        "n_match": n_match,
        "n_total": n_total,
        "match_rate": round(n_match / n_total, 4) if n_total else 0,
        "hit_rate_5pct": round(hit_rate, 4) if hit_rate is not None else None,
        "baseline_hit_rate_5pct": round(baseline_rate, 4) if baseline_rate is not None else None,
        "lift_vs_baseline": round(lift, 3) if lift is not None else None,
        "median_outcome_pct": round(median_outcome, 2) if median_outcome is not None else None,
        "mean_outcome_pct": round(mean_outcome, 2) if mean_outcome is not None else None,
        "p_value_fisher": round(float(p_value), 4) if p_value is not None else None,
        "tickers_with_2plus_hits": tickers_repeat,
        "resolved_thresholds": [
            {"feature": c.feature, "op": c.op, "threshold": round(c.threshold, 4)}
            for c in resolved.conditions
        ],
    }


def _status_from_stats(stats: dict[str, Any], prev_status: PatternStatus) -> PatternStatus:
    n = stats.get("n_match") or 0
    lift = stats.get("lift_vs_baseline")
    p = stats.get("p_value_fisher")
    hit = stats.get("hit_rate_5pct")
    baseline = stats.get("baseline_hit_rate_5pct")

    if prev_status == "deprecated" and n >= MIN_EVENTS_FOR_SIGNIFICANCE and lift and lift >= 1.15:
        return "emerging"

    if n < MIN_EVENTS_FOR_SIGNIFICANCE:
        return "hypothesis"

    if hit is not None and baseline is not None and hit < baseline * 0.85 and n >= MIN_EVENTS_FOR_SIGNIFICANCE:
        return "deprecated"

    if n >= 20 and lift and lift >= 1.2 and (p is None or p < 0.1):
        return "confirmed"
    if n >= MIN_EVENTS_FOR_SIGNIFICANCE:
        return "emerging"
    return "hypothesis"


def mine_candidate_patterns(
    df: pd.DataFrame,
    *,
    max_new: int = 5,
) -> list[PatternDefinition]:
    """Discover new AND-rules with lift on outcome_success_5pct."""
    work = df[df["run_m30_m3_pct"].notna()].copy()
    if len(work) < 50:
        return []

    features = [
        f
        for f in (
            "vol_ratio",
            "vol_accel",
            "vol_price_div",
            "slope_5d",
            "slope_20d",
            "run_up_30d",
            "rsi_14",
            "exc_slope_vs_XBI",
            "dump_proxy_pct",
            "pre_run_m60_m30_pct",
        )
        if f in work.columns and work[f].notna().sum() >= 100
    ]
    baseline = float(work["outcome_success_5pct"].mean())
    now = _now_iso()
    candidates: list[tuple[float, PatternDefinition]] = []

    for f in features:
        for q, op in ((0.75, ">="), (0.25, "<=")):
            thr = _percentile_threshold(work[f], q)
            mask = work[f] >= thr if op == ">=" else work[f] <= thr
            sub = work[mask]
            if len(sub) < 15:
                continue
            rate = float(sub["outcome_success_5pct"].mean())
            lift = rate / baseline if baseline > 0 else 0
            if lift < 1.25:
                continue
            phase: PatternPhase = "dump_entry" if f == "dump_proxy_pct" else "pre_volume_watch"
            if f in ("run_up_30d", "rsi_14", "vol_price_div"):
                phase = "exhaustion_exit"
            pid = f"mined_{f}_{op}_{int(q*100)}"
            pat = PatternDefinition(
                id=pid,
                phase=phase,
                name_en=f"Mined: {f} {op} p{int(q*100)}",
                name_it=f"Scoperto: {f} {op} p{int(q*100)}",
                description_en=f"Auto-mined rule lift={lift:.2f} on historical cohort.",
                description_it=f"Regola auto-scoperta lift={lift:.2f} sul cohort storico.",
                conditions=[PatternCondition(f, op, thr, "percentile", q)],
                created_at=now,
                updated_at=now,
            )
            candidates.append((lift, pat))

    for f1, f2 in combinations(features[:8], 2):
        for q1, op1 in ((0.75, ">="), (0.25, "<=")):
            t1 = _percentile_threshold(work[f1], q1)
            for q2, op2 in ((0.75, ">="), (0.25, "<=")):
                t2 = _percentile_threshold(work[f2], q2)
                m1 = work[f1] >= t1 if op1 == ">=" else work[f1] <= t1
                m2 = work[f2] >= t2 if op2 == ">=" else work[f2] <= t2
                sub = work[m1 & m2]
                if len(sub) < 12:
                    continue
                rate = float(sub["outcome_success_5pct"].mean())
                lift = rate / baseline if baseline > 0 else 0
                if lift < 1.35:
                    continue
                pid = f"mined_{f1}_{f2}_{int(q1*100)}_{int(q2*100)}"
                pat = PatternDefinition(
                    id=pid,
                    phase="pre_volume_watch",
                    name_en=f"Mined: {f1} AND {f2}",
                    name_it=f"Scoperto: {f1} AND {f2}",
                    description_en=f"Auto-mined 2-feature rule lift={lift:.2f}.",
                    description_it=f"Regola a 2 feature lift={lift:.2f}.",
                    conditions=[
                        PatternCondition(f1, op1, t1, "percentile", q1),
                        PatternCondition(f2, op2, t2, "percentile", q2),
                    ],
                    created_at=now,
                    updated_at=now,
                )
                candidates.append((lift, pat))

    candidates.sort(key=lambda x: -x[0])
    seen: set[str] = set()
    out: list[PatternDefinition] = []
    for _, pat in candidates:
        if pat.id in seen:
            continue
        seen.add(pat.id)
        out.append(pat)
        if len(out) >= max_new:
            break
    return out


def _pattern_signature(pattern: PatternDefinition) -> frozenset[tuple[str, str]]:
    return frozenset((c.feature, c.op) for c in pattern.conditions)


def merge_pattern_libraries(
    existing: list[PatternDefinition],
    discovered: list[PatternDefinition],
) -> list[PatternDefinition]:
    by_sig: dict[frozenset, PatternDefinition] = {_pattern_signature(p): p for p in existing}
    for d in discovered:
        sig = _pattern_signature(d)
        if sig not in by_sig:
            by_sig[sig] = d
    return list(by_sig.values())


def pattern_to_dict(p: PatternDefinition) -> dict[str, Any]:
    d = asdict(p)
    d["conditions"] = [asdict(c) for c in p.conditions]
    return d


def pattern_from_dict(d: dict[str, Any]) -> PatternDefinition:
    conds = [PatternCondition(**c) for c in d.get("conditions") or []]
    fields = {k: v for k, v in d.items() if k != "conditions"}
    return PatternDefinition(**fields, conditions=conds)


def load_library(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {"version": LIBRARY_VERSION, "patterns": [], "runs": []}
    return json.loads(path.read_text(encoding="utf-8"))


def save_library(path: Path, doc: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, indent=2, ensure_ascii=False), encoding="utf-8")


def refresh_pattern_library(
    library_path: Path,
    report_path: Path | None = None,
    *,
    mine_new: bool = True,
) -> dict[str, Any]:
    df = load_unified_catalyst_panel()
    summary = cohort_summary(df)

    doc = load_library(library_path)
    prev_patterns = [pattern_from_dict(p) for p in doc.get("patterns") or []]
    prev_by_id = {p.id: p for p in prev_patterns}

    if prev_patterns:
        patterns = prev_patterns
    else:
        patterns = seed_patterns(df)

    if mine_new:
        mined = mine_candidate_patterns(df)
        patterns = merge_pattern_libraries(patterns, mined)

    run_stats: list[dict[str, Any]] = []
    updated_patterns: list[dict[str, Any]] = []

    for pat in patterns:
        prev = prev_by_id.get(pat.id)
        prev_stats = (prev.stats if prev else {}) or {}
        stats = score_pattern(pat, df)
        n_new = max(0, stats["n_match"] - int(prev_stats.get("n_match") or 0))
        stats["n_new_since_last_run"] = n_new
        stats["confirmed_by_repeat_tickers"] = stats.get("tickers_with_2plus_hits", 0) >= 3

        status = _status_from_stats(stats, pat.status if prev else "hypothesis")
        pat.stats = stats
        pat.status = status
        pat.updated_at = _now_iso()
        if not pat.created_at:
            pat.created_at = pat.updated_at
        if prev and status == "confirmed" and prev.status != "confirmed":
            pat.version = prev.version + 1

        updated_patterns.append(pattern_to_dict(pat))
        run_stats.append(
            {
                "id": pat.id,
                "phase": pat.phase,
                "status": status,
                "n_match": stats["n_match"],
                "lift": stats.get("lift_vs_baseline"),
                "median_outcome_pct": stats.get("median_outcome_pct"),
            }
        )

    run_record = {
        "at": _now_iso(),
        "cohort": summary,
        "patterns_scored": len(updated_patterns),
        "top_patterns": sorted(
            run_stats,
            key=lambda x: (x.get("lift") or 0, x.get("n_match") or 0),
            reverse=True,
        )[:10],
    }

    doc["version"] = LIBRARY_VERSION
    doc["updated_at"] = run_record["at"]
    doc["cohort_summary"] = summary
    doc["patterns"] = updated_patterns
    runs = doc.get("runs") or []
    runs.append(run_record)
    doc["runs"] = runs[-30:]

    save_library(library_path, doc)

    if report_path:
        _write_audit_report(report_path, doc, df)

    return doc


def score_ticker_current(
    library_doc: dict[str, Any],
    ticker: str,
    df: pd.DataFrame | None = None,
) -> list[dict[str, Any]]:
    """Score active/archived events for one ticker against confirmed/emerging patterns."""
    if df is None:
        df = load_unified_catalyst_panel()
    sub = df[df["ticker"] == ticker.upper()]
    if sub.empty:
        return []

    patterns = [pattern_from_dict(p) for p in library_doc.get("patterns") or []]
    patterns = [p for p in patterns if p.status in ("confirmed", "emerging", "hypothesis")]

    alerts: list[dict[str, Any]] = []
    for _, row in sub.iterrows():
        for pat in patterns:
            resolved = _resolve_thresholds(pat, df)
            if pattern_matches(row, resolved):
                alerts.append(
                    {
                        "ticker": ticker.upper(),
                        "event_key": row.get("event_key"),
                        "completion_date": row.get("completion_date"),
                        "pattern_id": pat.id,
                        "phase": pat.phase,
                        "status": pat.status,
                        "name_it": pat.name_it,
                        "name_en": pat.name_en,
                        "historical_lift": pat.stats.get("lift_vs_baseline"),
                        "historical_n": pat.stats.get("n_match"),
                    }
                )
    return alerts


def _write_audit_report(path: Path, doc: dict[str, Any], df: pd.DataFrame) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# Catalyst Pattern Library — Audit",
        "",
        f"_Updated: {doc.get('updated_at')}_",
        "",
        "## Cohort",
        "",
    ]
    for k, v in (doc.get("cohort_summary") or {}).items():
        lines.append(f"- **{k}**: {v}")
    lines.extend(["", "## Patterns by phase", ""])

    patterns = doc.get("patterns") or []
    by_phase: dict[str, list] = {}
    for p in patterns:
        by_phase.setdefault(p.get("phase", "?"), []).append(p)

    for phase, plist in sorted(by_phase.items()):
        lines.append(f"### {phase}")
        lines.append("")
        lines.append("| id | status | n | lift | median outcome % | tickers 2+ |")
        lines.append("|---|---|---:|---:|---:|---:|")
        for p in sorted(
            plist,
            key=lambda x: -((x.get("stats") or {}).get("lift_vs_baseline") or 0),
        ):
            s = p.get("stats") or {}
            lines.append(
                f"| {p.get('id')} | {p.get('status')} | {s.get('n_match', 0)} | "
                f"{s.get('lift_vs_baseline', '—')} | {s.get('median_outcome_pct', '—')} | "
                f"{s.get('tickers_with_2plus_hits', 0)} |"
            )
        lines.append("")

    confirmed = [p for p in patterns if p.get("status") == "confirmed"]
    emerging = [p for p in patterns if p.get("status") == "emerging"]
    lines.extend(
        [
            "## Summary",
            "",
            f"- **Confirmed patterns**: {len(confirmed)}",
            f"- **Emerging patterns**: {len(emerging)}",
            f"- **Total in library**: {len(patterns)}",
            "",
            "> Patterns with status `hypothesis` need more cases. "
            "The library auto-updates on each refresh run.",
            "",
        ]
    )
    path.write_text("\n".join(lines), encoding="utf-8")
