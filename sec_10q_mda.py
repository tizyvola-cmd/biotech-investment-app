"""
Isolate MD&A / Recent Developments text from a 10-Q body.

10-Q filings are long; EIS matching must NOT see the full document.
Prefer «Recent Developments» / pipeline overview inside Item 2 (Part I);
fall back to the broader MD&A block; never the whole filing.
"""

from __future__ import annotations

import re
from typing import Any

# Soft cap on text passed to EIS / storage (section only).
DEFAULT_SECTION_MAX_CHARS = 12_000

_RECENT_DEV_START = re.compile(
    r"(?im)^(?:item\s*\d+[A-Z]?[\.\):\s]+)?\s*"
    r"(?:"
    r"recent\s+developments?"
    r"|pipeline\s+updates?"
    r"|business\s+overview"
    r"|overview\s+of\s+(?:our\s+)?(?:business|pipeline|operations|company)"
    r"|company\s+overview"
    r")\s*$"
)

_MDA_START = re.compile(
    r"(?im)^(?:item\s*2[\.\):\s]+)\s*"
    r"management['’]?s?\s+discussion\s+and\s+analysis"
    r"|^management['’]?s?\s+discussion\s+and\s+analysis"
    r"(?:\s+of\s+financial\s+condition)?"
)

_SECTION_STOP = re.compile(
    r"(?im)^(?:item\s*(?:1A|1B|3|4|5|6|7|8|9)[A-Z]?[\.\):\s]+)"
    r"|^(?:quantitative\s+and\s+qualitative\s+disclosures)"
    r"|^(?:controls\s+and\s+procedures)"
    r"|^(?:liquidity\s+and\s+capital\s+resources)"
    r"|^(?:critical\s+accounting)"
    r"|^(?:off[- ]balance[- ]sheet)"
    r"|^(?:contractual\s+obligations)"
    r"|^(?:results\s+of\s+operations)\s*$"
)


def _normalize_lines(text: str) -> list[str]:
    raw = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    raw = re.sub(r"[ \t]+", " ", raw)
    lines = [ln.strip() for ln in raw.split("\n")]
    return [ln for ln in lines if ln]


def _slice_from_match(
    lines: list[str],
    start_idx: int,
    *,
    max_chars: int,
    stop_at_mda_financial: bool,
) -> str:
    out: list[str] = []
    n = 0
    for ln in lines[start_idx:]:
        if out and _SECTION_STOP.match(ln):
            # Keep going past "Results of Operations" only when we are still
            # inside an early Overview/Recent Developments block that used that
            # phrase as a soft boundary — already handled by stop regex.
            break
        if stop_at_mda_financial and out and re.match(
            r"(?i)^(?:results\s+of\s+operations|liquidity\s+and\s+capital)",
            ln,
        ):
            break
        out.append(ln)
        n += len(ln) + 1
        if n >= max_chars:
            break
    return "\n".join(out).strip()


def extract_10q_pipeline_section(
    full_text: str,
    *,
    max_chars: int = DEFAULT_SECTION_MAX_CHARS,
) -> dict[str, Any]:
    """
    Returns:
      text: isolated section (may be "")
      section: "recent_developments" | "mda_item2" | "none"
      chars: length of returned text
    """
    lines = _normalize_lines(full_text)
    if not lines:
        return {"text": "", "section": "none", "chars": 0}

    for i, ln in enumerate(lines):
        if _RECENT_DEV_START.match(ln):
            body = _slice_from_match(
                lines, i, max_chars=max_chars, stop_at_mda_financial=True
            )
            if len(body) >= 120:
                return {
                    "text": body[:max_chars],
                    "section": "recent_developments",
                    "chars": min(len(body), max_chars),
                }

    for i, ln in enumerate(lines):
        if _MDA_START.search(ln):
            body = _slice_from_match(
                lines, i, max_chars=max_chars, stop_at_mda_financial=False
            )
            if len(body) >= 200:
                return {
                    "text": body[:max_chars],
                    "section": "mda_item2",
                    "chars": min(len(body), max_chars),
                }

    # Heading variants sometimes lack newlines — search in joined text windows.
    joined = "\n".join(lines)
    m = re.search(
        r"(?is)((?:recent\s+developments?|pipeline\s+updates?)["
        r"\s\S]{200,})",
        joined,
    )
    if m:
        chunk = m.group(1)
        stop = re.search(
            r"(?i)\n(?:item\s*(?:1A|3|4)\b|liquidity\s+and\s+capital|"
            r"results\s+of\s+operations)",
            chunk[80:],
        )
        if stop:
            chunk = chunk[: 80 + stop.start()]
        chunk = chunk[:max_chars].strip()
        if len(chunk) >= 120:
            return {
                "text": chunk,
                "section": "recent_developments",
                "chars": len(chunk),
            }

    m2 = re.search(
        r"(?is)(item\s*2[\.\):\s]+management['’]?s?\s+discussion"
        r"[\s\S]{300,})",
        joined,
    )
    if m2:
        chunk = m2.group(1)
        stop = re.search(r"(?i)\nitem\s*(?:1A|3|4)\b", chunk[100:])
        if stop:
            chunk = chunk[: 100 + stop.start()]
        chunk = chunk[:max_chars].strip()
        if len(chunk) >= 200:
            return {"text": chunk, "section": "mda_item2", "chars": len(chunk)}

    return {"text": "", "section": "none", "chars": 0}


def headline_from_10q_section(section_text: str, *, max_len: int = 140) -> str:
    """First substantial sentence as a short timeline headline."""
    text = re.sub(r"\s+", " ", (section_text or "").strip())
    if not text:
        return "10-Q MD&A / Recent Developments"
    # Skip the heading itself
    text = re.sub(
        r"(?i)^(recent developments?|pipeline updates?|item\s*2[^.]*)[:.\s]+",
        "",
        text,
    ).strip()
    for part in re.split(r"(?<=[.!?])\s+", text):
        p = part.strip()
        if len(p) >= 40:
            return (p[: max_len - 1] + "…") if len(p) > max_len else p
    return (text[: max_len - 1] + "…") if len(text) > max_len else text
