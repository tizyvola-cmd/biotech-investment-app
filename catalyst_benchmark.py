"""
Catalyst / inflection-point benchmark (Excel seed).

Used for:
- Daily News → calendar inject only when date is *future* and matches a
  scheduled catalyst (or scientific/business conference)
- Weekly interest discovery queries (company + catalyst event)
- Thermometer importance anchors (−100…+100); outcome-specific rows already
  encode event type + outcome (e.g. Ph3 MET +85 vs MISSED −75)
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

_ROOT = Path(__file__).resolve().parent
_CFG = _ROOT / "config" / "catalyst_benchmark.json"

# Calendar event_type strings produced by daily_news_desk / interest discovery
_CONFERENCE_TYPES = frozenset(
    {
        "conference",
        "congress",
        "investor_day",
        "fireside",
        "presentation",
    }
)


@lru_cache(maxsize=1)
def load_catalyst_benchmark() -> dict[str, Any]:
    if not _CFG.is_file():
        return {"version": 0, "events": [], "conference_calendar": {"enabled": True}}
    try:
        return json.loads(_CFG.read_text(encoding="utf-8"))
    except Exception:
        return {"version": 0, "events": [], "conference_calendar": {"enabled": True}}


def clear_catalyst_benchmark_cache() -> None:
    load_catalyst_benchmark.cache_clear()


def list_benchmark_events(*, scheduled_only: bool = False) -> list[dict[str, Any]]:
    events = list(load_catalyst_benchmark().get("events") or [])
    if scheduled_only:
        return [e for e in events if e.get("scheduled") or e.get("calendar_eligible")]
    return events


def conference_config() -> dict[str, Any]:
    cfg = load_catalyst_benchmark().get("conference_calendar") or {}
    return cfg if isinstance(cfg, dict) else {}


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", str(s or "").lower()).strip()


def is_conference_text(blob: str, *, event_type: str | None = None) -> bool:
    et = str(event_type or "").strip().lower()
    if et in _CONFERENCE_TYPES:
        return True
    cfg = conference_config()
    if cfg.get("enabled") is False:
        return False
    text = _norm(blob)
    if not text:
        return False
    for kw in cfg.get("keywords") or []:
        k = _norm(str(kw))
        if len(k) >= 3 and k in text:
            return True
    return bool(
        re.search(
            r"\b(conference|congress|fireside|investor\s+day|"
            r"asco|ash|esmo|aacr|eular|wainwright|jefferies|jpmorgan)\b",
            text,
            re.I,
        )
    )


def _event_match_score(event: dict[str, Any], text: str) -> float:
    """Heuristic overlap between article text and a benchmark row."""
    if not text:
        return 0.0
    label = _norm(str(event.get("label") or ""))
    if not label:
        return 0.0
    score = 0.0
    # Phrase pieces from the label (drop tiny tokens)
    tokens = [t for t in re.findall(r"[a-z0-9+/]{3,}", label) if t not in {
        "the", "and", "for", "with", "from", "into", "same", "via", "no", "or",
    }]
    if not tokens:
        return 0.0
    hits = sum(1 for t in tokens if t in text)
    score += hits / max(1, len(tokens))
    for term in event.get("search_terms") or []:
        t = _norm(str(term))
        if len(t) >= 3 and t in text:
            score += 0.35
    # Outcome polarity cues
    if any(x in label for x in ("missed", "negative", "halted", "failure", "reject", "crl", "withdrawal")):
        if re.search(r"\b(miss(?:ed)?|fail(?:ed|ure)?|negative|halt(?:ed)?|crl|reject)\b", text):
            score += 0.4
    if any(x in label for x in ("met", "positive", "approval", "beat", "alignment")):
        if re.search(r"\b(met|positive|approv(?:ed|al)|beat|success)\b", text):
            score += 0.35
    # Phase specificity
    if "phase 3" in label or "pivotal" in label:
        if re.search(r"\b(phase\s*3|phase\s*iii|pivotal|registrational)\b", text):
            score += 0.45
    if "phase 2" in label:
        if re.search(r"\b(phase\s*2|phase\s*ii)\b", text):
            score += 0.4
    if "phase 1" in label:
        if re.search(r"\b(phase\s*1|phase\s*i)\b", text):
            score += 0.35
    return score


def match_benchmark_event(
    text: str,
    *,
    axis: str | None = None,
    taxonomy_event_id: str | None = None,
    min_score: float = 0.55,
) -> dict[str, Any] | None:
    """
    Pick the most specific benchmark row for article text.
    Prefers taxonomy_event_id candidates, then global best score.
    """
    blob = _norm(text)
    if not blob:
        return None
    events = list_benchmark_events()
    tid = str(taxonomy_event_id or "").strip().upper()
    candidates = events
    if tid:
        tax_hits = [
            e
            for e in events
            if str(e.get("taxonomy_event_id") or "").strip().upper() == tid
        ]
        if tax_hits:
            candidates = tax_hits
    if axis:
        ax = axis.strip().lower()
        ax_hits = [e for e in candidates if str(e.get("axis") or "").lower() == ax]
        if ax_hits:
            candidates = ax_hits
    best: dict[str, Any] | None = None
    best_s = 0.0
    for e in candidates:
        s = _event_match_score(e, blob)
        if s > best_s:
            best_s = s
            best = e
    if best is None or best_s < min_score:
        # Fallback: if taxonomy id uniquely maps to one row, use it
        if tid:
            tax_hits = [
                e
                for e in events
                if str(e.get("taxonomy_event_id") or "").strip().upper() == tid
            ]
            if len(tax_hits) == 1:
                return tax_hits[0]
            if tax_hits:
                # Prefer highest |importance| among same taxonomy id
                return max(
                    tax_hits,
                    key=lambda e: abs(float(e.get("importance_score") or 0)),
                )
        return None
    return best


def is_calendar_catalyst(
    *,
    text: str,
    event_type: str | None = None,
    timing_quote: str = "",
) -> bool:
    """
    True when a dated item should enter the guidance calendar:
    future date is checked by caller; here we require conference OR a
    recognizable scheduled / foreseeable catalyst from the benchmark list.
    """
    blob = f"{timing_quote}\n{text}"
    if is_conference_text(blob, event_type=event_type):
        return True
    et = str(event_type or "").strip().lower()
    # Known clinical/regulatory calendar types from classifier
    if et in {"pdufa", "fda_vote", "readout", "submission", "approval", "adcom"}:
        # Still require some catalyst cue so random past earnings dates stay out
        if re.search(
            r"\b(pdufa|adcom|advisory|phase\s*[123i]+|topline|readout|nda|bla|"
            r"approv|enrollment|endpoint|trial|fda)\b",
            _norm(blob),
            re.I,
        ):
            return True
    # Match any scheduled benchmark row
    hit = match_benchmark_event(blob, min_score=0.5)
    if hit and (hit.get("scheduled") or hit.get("calendar_eligible")):
        return True
    # Non-scheduled surprises generally should NOT pre-populate calendar
    return False


def scheduled_search_queries(company: str, ticker: str, *, limit: int = 8) -> list[str]:
    """
    Build Google/news query strings: company + catalyst event.
    Prefer high-|importance| scheduled clinical/regulatory events.
    """
    co = (company or ticker or "").strip()
    tk = (ticker or "").strip().upper()
    if not co and not tk:
        return []
    events = list_benchmark_events(scheduled_only=True)
    # Rank: clinical first, then |importance|
    events = sorted(
        events,
        key=lambda e: (
            0 if str(e.get("axis")) == "clinical" else 1,
            -abs(float(e.get("importance_score") or 0)),
        ),
    )
    out: list[str] = []
    seen: set[str] = set()
    for e in events:
        terms = list(e.get("search_terms") or [])
        label = str(e.get("label") or "")
        # Compact query piece from first search terms or label head
        piece = " OR ".join(f'"{t}"' if " " in str(t) else str(t) for t in terms[:3])
        if not piece:
            piece = " ".join(label.split()[:5])
        q = f'("{co}" OR "{tk}") ({piece})'
        key = q.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(q)
        if len(out) >= limit:
            break
    # Always include congress / investor conference sweep
    conf = (
        f'("{co}" OR "{tk}") '
        f'(ASCO OR ASH OR ESMO OR AACR OR conference OR "investor day" OR fireside) '
        f"when:30d"
    )
    if conf.lower() not in seen:
        out.append(conf)
    return out


def _norm_importance(raw: Any) -> float | None:
    """Signed importance on unit scale (−1…+1); accepts legacy ±100."""
    try:
        v = float(raw)
    except Exception:
        return None
    if not (v == v):  # NaN
        return None
    if abs(v) > 1.0001:
        v = v / 100.0
    return round(max(-1.0, min(1.0, v)), 4)


def importance_for_taxonomy(
    taxonomy_event_id: str,
    *,
    text: str = "",
    default: float | None = None,
) -> float | None:
    """Resolve signed importance (−1…+1) for a taxonomy hit + optional text."""
    hit = match_benchmark_event(
        text or taxonomy_event_id,
        taxonomy_event_id=taxonomy_event_id,
        min_score=0.45 if text else 0.99,
    )
    if hit is not None:
        imp = _norm_importance(hit.get("importance_score"))
        if imp is not None:
            return imp
    if default is not None:
        return float(default)
    return None


# Absolute |importance| floor for Calendar «main inflection» highlight (ochre).
MAIN_INFLECTION_MIN_ABS = float(
    __import__("os").environ.get("CATALYST_MAIN_INFLECTION_MIN_ABS", "0.40")
)

_MAIN_READOUT_HINT = re.compile(
    r"\b(?:phase\s*(?:3|iii)|pivotal|registrational|topline|"
    r"primary\s+endpoint|pdufa|adcom|advisory\s+committee)\b",
    re.I,
)


def classify_main_inflection(entry: dict[str, Any]) -> tuple[bool, float | None, str | None]:
    """
    Decide if a Calendar / SEC-forward row is a main inflection point.

    Returns ``(is_main, signed_importance, label)``.
    Rules (aligned with catalyst_benchmark scheduled high-|score| events):
      - PDUFA / AdCom → always main
      - Readout matching high-|importance| scheduled benchmark (≥ threshold) → main
      - Readout with pivotal / Ph3 / topline cues → main (fallback ~0.55)
      - Conference / Partnership → not main by default
    """
    et = str(entry.get("event_type") or "").strip()
    blob = " ".join(
        str(x)
        for x in (
            entry.get("raw_snippet"),
            entry.get("window_label"),
            entry.get("partner"),
            et,
        )
        if x
    )
    if et == "PDUFA":
        return True, 0.80, "PDUFA date"
    if et in {"AdCom", "adcom"}:
        return True, 0.50, "Advisory Committee"
    if et == "Readout":
        hit = match_benchmark_event(blob, axis="clinical", min_score=0.5)
        if hit is not None:
            score = _norm_importance(hit.get("importance_score")) or 0.0
            if abs(score) >= MAIN_INFLECTION_MIN_ABS and (
                hit.get("scheduled") or hit.get("calendar_eligible")
            ):
                return True, score, str(hit.get("label") or "Readout")
        if _MAIN_READOUT_HINT.search(blob):
            return True, 0.55, "Pivotal / Phase 3 readout"
        return False, None, None
    return False, None, None


def annotate_main_inflection(entry: dict[str, Any]) -> dict[str, Any]:
    """Mutate/return entry with ``main_inflection`` + optional importance fields."""
    ok, score, label = classify_main_inflection(entry)
    entry["main_inflection"] = bool(ok)
    if ok and score is not None:
        entry["inflection_importance"] = score
    if ok and label:
        entry["inflection_label"] = label
    elif not ok:
        entry.pop("inflection_importance", None)
        entry.pop("inflection_label", None)
    return entry
