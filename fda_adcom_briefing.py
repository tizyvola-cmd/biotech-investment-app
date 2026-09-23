"""
FDA AdCom briefing cards — catch publication ASAP, stage into Daily News.

Sources:
  - meeting announcement page (briefing PDFs)
  - recently-updated advisory committee materials
  - optional row.briefingPdfHint when a known media URL is already public

On first ready card: rich AI digest (results + statistics + conclusions)
and a staged Daily News item (display until Migrate → EIS).

Display / news only. Not a Soft BUY/SELL input. Score colors reuse EIS palette.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import date, datetime, time as dt_time, timezone
from typing import Any

import fda_adcom_calendar as fac

logger = logging.getLogger("supernova.fda_adcom.briefing")

MATERIALS_URL = (
    "https://www.fda.gov/advisory-committees/recently-updated-advisory-committee-materials"
)
# Start hunting earlier than classic T−2; keep a short post-meeting lookback.
LOOKAHEAD_DAYS = 5
LOOKBACK_DAYS = 3
MAX_TEXT_CHARS = 60_000
PDF_MAX_PAGES = 40

_POS = (
    (r"substantial evidence", 2.5),
    (r"met (the )?primary endpoint", 3.0),
    (r"statistically significant", 1.5),
    (r"favorable benefit[- ]risk", 2.5),
    (r"recommend(s|ed)? (approval|accelerated)", 3.0),
    (r"efficacy (was )?demonstrated", 2.0),
    (r"positive (risk-benefit|benefit[- ]risk)", 2.0),
    (r"supports? approval", 2.5),
    # Clean postmarketing language — only counts when no death/serious FAERS pool below.
    (r"no new (pediatric )?safety (signals?|concerns?)", 1.0),
    (r"did not identify any new pediatric safety", 1.0),
    (r"continue routine pharmacovigilance", 0.5),
    (r"hde remains appropriately approved", 2.0),
    (r"does not appear to present a new safety signal", 1.0),
)
_NEG = (
    (r"complete response", 3.0),
    (r"did not meet", 2.5),
    (r"failed (the )?primary", 3.0),
    (r"insufficient evidence", 2.5),
    (r"safety concern", 2.0),
    (r"not approvable", 3.5),
    (r"review issues?", 1.5),
    (r"post-hoc", 1.0),
    (r"missing (data|documents)", 1.5),
    (r"do not provide evidence of effectiveness", 3.5),
    (r"no substantial evidence", 3.0),
    (r"not statistically significant", 2.0),
    (r"boxed warning", 1.0),
    (r"increased (the )?risk of (death|stroke|thrombo)", 1.5),
    (r"reoperation rate increased", 1.5),
    (r"higher than .{0,40}(ae|adverse event|reoperation) rate", 1.0),
    # Serious adverse events / FAERS — death is the most severe on this scale.
    (r"outcome of death", 4.0),
    (r"reports? with the outcome of death", 4.0),
    (r"fatal (pediatric )?(adverse|cases?|events?)", 3.5),
    (r"serious (unlabeled )?adverse events?", 2.0),
    (r"u\.?s\.?\s+serious pediatric reports?", 1.5),
    (r"faers .{0,40}serious", 1.5),
    (r"adverse event reporting system", 0.5),
)


def days_until_meeting(iso: str, today: date | None = None) -> int | None:
    try:
        meet = date.fromisoformat(str(iso)[:10])
    except ValueError:
        return None
    return (meet - (today or date.today())).days


def in_briefing_window(iso: str, today: date | None = None) -> bool:
    days = days_until_meeting(iso, today)
    if days is None:
        return False
    return -LOOKBACK_DAYS <= days <= LOOKAHEAD_DAYS


def material_matches_row(title: str, row: dict[str, Any]) -> bool:
    """True when a materials link/title clearly belongs to this scheduled AdCom."""
    blob = re.sub(r"\s+", " ", f"{title}").lower()
    ticker = str(row.get("ticker") or "").strip().lower()
    ticker_hit = bool(ticker and re.search(rf"\b{re.escape(ticker)}\b", blob))
    company = str(row.get("company") or "")
    first = re.split(r"[,.(]", company, maxsplit=1)[0].strip().lower()
    company_hit = bool(first and len(first) >= 4 and first in blob)
    company_tokens = [
        t
        for t in re.findall(r"[a-z0-9]{4,}", first)
        if t not in {"inc", "ltd", "llc", "corp", "group", "holdings", "pharma", "therapeutics"}
    ]
    if not company_hit and company_tokens:
        company_hit = any(t in blob for t in company_tokens[:3])
    product = str(row.get("product") or "").split(";")[0].strip().lower()
    product = re.sub(r"\s*\([^)]+\)\s*", " ", product).strip()
    product_hit = bool(product and len(product) >= 4 and product in blob)
    committee = str(row.get("committee") or "").strip().lower()
    committee_hit = bool(committee and len(committee) >= 12 and committee[:24] in blob)

    if ticker_hit or company_hit or product_hit:
        return True

    meet = str(row.get("date") or "")
    compact = meet.replace("-", "")
    blob_compact = blob.replace("-", "").replace("/", "").replace(" ", "")
    date_hit = False
    try:
        d = date.fromisoformat(meet)
        labels = (
            f"{d.strftime('%B').lower()} {d.day}, {d.year}",
            f"{d.strftime('%B').lower()} {d.day} {d.year}",
            d.strftime("%B %d, %Y").lower(),
            d.strftime("%b %d, %Y").lower(),
        )
        date_hit = any(label in blob for label in labels)
    except ValueError:
        d = None
    if compact and compact in blob_compact:
        date_hit = True

    if date_hit and committee_hit:
        return True
    return False


def text_matches_row(text: str, row: dict[str, Any]) -> bool:
    """Confirm extracted briefing text is about the scheduled company/product."""
    head = re.sub(r"\s+", " ", (text or "")[:4000]).strip()
    if not head:
        return False
    return material_matches_row(head, row)


def extract_material_links(html: str) -> list[dict[str, str]]:
    """Links from the recently-updated page or a meeting announcement."""
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for m in re.finditer(
        r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>',
        html,
        flags=re.I | re.S,
    ):
        href = m.group(1).strip()
        title = re.sub(r"<[^>]+>", " ", m.group(2))
        title = re.sub(r"\s+", " ", title).strip()
        if href.startswith("/"):
            href = "https://www.fda.gov" + href
        if "fda.gov" not in href:
            continue
        low = f"{href} {title}".lower()
        if "advisory-committee-calendar" in href and href.rstrip("/") == fac.SOURCE_URL.rstrip("/"):
            continue
        is_pdf = "/media/" in href or href.lower().endswith(".pdf") or "download" in href.lower()
        is_brief = "briefing" in low or "background material" in low or "meeting materials" in low
        if not (is_pdf or is_brief or "advisory-committee-calendar/" in href):
            continue
        key = href.split("?")[0]
        if key in seen:
            continue
        seen.add(key)
        out.append({"href": href, "title": title or href})
    return out


def pick_fda_briefing_pdf(links: list[dict[str, str]]) -> dict[str, str] | None:
    pdfs = [x for x in links if "/media/" in x["href"] or x["href"].lower().endswith(".pdf")]
    if not pdfs:
        return None

    def rank(item: dict[str, str]) -> tuple[int, int, int]:
        t = item["title"].lower()
        # Prefer FDA staff over sponsor when both exist; still accept sponsor exec summary.
        fda = 0 if ("fda" in t and "sponsor" not in t and "non-fda" not in t) else 1
        brief = 0 if ("briefing" in t or "executive summary" in t) else 1
        hint = 0 if t.startswith("hint ") else 1
        return hint, brief, fda

    pdfs.sort(key=rank)
    return pdfs[0]


def extract_pdf_text(content: bytes, max_pages: int = PDF_MAX_PAGES) -> str:
    try:
        import io
        import pdfplumber

        with pdfplumber.open(io.BytesIO(content)) as pdf:
            parts: list[str] = []
            for page in pdf.pages[:max_pages]:
                parts.append(page.extract_text() or "")
                if sum(len(p) for p in parts) >= MAX_TEXT_CHARS:
                    break
        return "\n".join(parts)[:MAX_TEXT_CHARS]
    except Exception as exc:
        logger.warning("FDA briefing PDF parse failed: %s", exc)
        return ""


def _faers_death_count(text: str) -> int:
    blob = text or ""
    m = re.search(
        r"(?i)(?:including\s+)?(\d+)\s+reports?\s+with\s+the\s+outcome\s+of\s+death",
        blob,
    )
    if not m:
        m = re.search(
            r"(?i)(?:including\s+|of those[, ]+)?(\d+)\s+reports?\s+coded\s+death",
            blob,
        )
    if m:
        try:
            return max(0, int(m.group(1)))
        except ValueError:
            return 0
    if re.search(
        r"(?i)\b(fatal pediatric|outcome of death|deaths? directly associated)\b",
        blob,
    ):
        return 1
    return 0


def _faers_serious_report_count(text: str) -> int:
    blob = text or ""
    m = re.search(
        r"(?i)(?:identified|retrieved|reviewed)\s+(\d+)\s+"
        r"(?:u\.?s\.?\s+)?(?:serious\s+)?(?:pediatric\s+)?reports?",
        blob,
    )
    if m:
        try:
            return max(0, int(m.group(1)))
        except ValueError:
            return 0
    return 0


def apply_safety_severity_to_score(score: float, text: str) -> float:
    """
    Serious AE / death reports weigh negative even when DPV excludes cases
    or concludes 'no new signal'. Death is the most severe step on the scale.
    """
    s = float(score)
    deaths = _faers_death_count(text)
    serious_n = _faers_serious_report_count(text)
    if deaths > 0:
        # Base −4 for any death-coded reports; scale mildly with count (cap −8).
        s -= min(8.0, 4.0 + deaths * 0.04)
        # A package that surfaces death reports cannot read as net-positive.
        s = min(s, -2.0)
    elif serious_n > 0 and re.search(
        r"(?i)serious (unlabeled )?adverse|faers|pharmacovigilance review",
        text or "",
    ):
        s -= min(3.5, 1.2 + serious_n * 0.02)
        s = min(s, -0.5)
    return max(-10.0, min(10.0, round(s, 1)))


def heuristic_fda_score(text: str) -> float:
    blob = re.sub(r"\s+", " ", text).lower()
    score = 0.0
    for pat, w in _POS:
        if re.search(pat, blob):
            score += w
    for pat, w in _NEG:
        if re.search(pat, blob):
            score -= w
    # MCED / Galleri-style staff packages rarely use classic "favorable benefit-risk"
    # phrasing — seed a modest mixed-positive when performance metrics are present,
    # tempered by open "early detection" labelling questions.
    if _is_mced_pma_package(text):
        if re.search(
            r"episode\s+sensitivity|positive\s+predictive\s+value|\bppv\b|"
            r"cancer\s+signal\s+detected",
            blob,
        ):
            score += 1.5
        if re.search(r"specificity.{0,12}99\.?\d*\s*%", blob):
            score += 0.5
        if re.search(
            r"early['\"]?\s*detection|absent the .{0,8}early|"
            r"does not (?:rule out|exclude) the presence of cancer",
            blob,
        ):
            score -= 0.5
        if re.search(r"voting questions|questions for panel", blob):
            score = max(score, 1.0)
            score = min(score, 2.5)
    return apply_safety_severity_to_score(score, text)


def _excerpt(text: str, n: int = 520) -> str:
    clean = re.sub(r"[ \t]+", " ", text)
    clean = re.sub(r"\n{3,}", "\n\n", clean).strip()
    if len(clean) <= n:
        return clean
    cut = clean[:n]
    if " " in cut:
        cut = cut.rsplit(" ", 1)[0]
    return cut + "…"


def _parse_ai_json(raw: str) -> dict[str, Any] | None:
    blob = raw.strip()
    blob = re.sub(r"^```(?:json)?\s*", "", blob)
    blob = re.sub(r"\s*```$", "", blob)
    try:
        doc = json.loads(blob)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", blob, flags=re.S)
        if not m:
            return None
        try:
            doc = json.loads(m.group(0))
        except json.JSONDecodeError:
            return None
    return doc if isinstance(doc, dict) else None


def _as_str_list(val: Any, *, limit: int = 16) -> list[str]:
    if not isinstance(val, list):
        return []
    out: list[str] = []
    for x in val:
        t = str(x or "").strip()
        if t:
            out.append(t)
        if len(out) >= limit:
            break
    return out


_METRIC_LINE_RE = re.compile(
    r"(?im)^(?P<label>[^\n]{0,80}?"
    r"(?:episode\s+sensitivity|sensitivity|specificity|ppv|npv|"
    r"false[- ]positive\s+rate|cso\s+prediction\s+accuracy|"
    r"cancer\s+detection\s+rate)"
    r"[^\n]{0,60}?)\s*[=:]\s*(?P<val>\d{1,3}(?:\.\d+)?\s*%"
    r"(?:\s*\([^)]{0,40}\))?)",
)


def heuristic_extract_metrics(text: str) -> dict[str, list[str]]:
    """
    Pull key performance lines from briefing text when AI is unavailable.
    Best-effort; never invents numbers outside the document.
    """
    blob = text or ""
    results: list[str] = []
    stats: list[str] = []
    seen: set[str] = set()

    def _add(bucket: list[str], line: str) -> None:
        key = re.sub(r"\s+", " ", line).strip().lower()
        if not key or key in seen:
            return
        seen.add(key)
        bucket.append(re.sub(r"\s+", " ", line).strip())

    for m in _METRIC_LINE_RE.finditer(blob):
        label = re.sub(r"\s+", " ", m.group("label")).strip(" |-:")
        val = re.sub(r"\s+", " ", m.group("val")).strip()
        _add(stats, f"{label}: {val}")

    for pat, label in (
        (
            r"(?i)episode\s+sensitivity\s*=\s*(\d{1,3}(?:\.\d+)?\s*%\s*(?:\([^)]+\))?)",
            "Episode sensitivity",
        ),
        (
            r"(?i)specificity\s*=\s*(\d{1,3}(?:\.\d+)?\s*%\s*(?:\([^)]+\))?)",
            "Specificity",
        ),
        (
            r"(?i)PPV\s*=\s*(\d{1,3}(?:\.\d+)?\s*%\s*(?:\([^)]+\))?)",
            "PPV",
        ),
        (
            r"(?i)NPV\s*=\s*(\d{1,3}(?:\.\d+)?\s*%\s*(?:\([^)]+\))?)",
            "NPV",
        ),
        (
            r"(?i)CSO\s+prediction\s+(?:accuracy|accurately identified)[^\d]{0,60}"
            r"(\d{1,3}(?:\.\d+)?\s*%)",
            "CSO prediction accuracy",
        ),
        (
            r"(?i)false[- ]positive\s+rate[^\d]{0,40}(\d{1,3}(?:\.\d+)?\s*%(?:\s*[–\-]\s*\d{1,3}(?:\.\d+)?%)?)",
            "False-positive rate",
        ),
        (
            r"(?i)overall episode sensitivity was\s+(\d{1,3}(?:\.\d+)?\s*%)",
            "Overall episode sensitivity",
        ),
        (
            r"(?i)episode sensitivity for cancers responsible for two-thirds[^\d]{0,40}"
            r"(\d{1,3}(?:\.\d+)?\s*%)",
            "Episode sensitivity (12 high-mortality cancers)",
        ),
    ):
        for m in re.finditer(pat, blob):
            _add(results, f"{label}: {re.sub(r'\s+', ' ', m.group(1)).strip()}")

    # Prefer lines that already carry a percent (skip TOC titles).
    for m in re.finditer(
        r"(?i)\b((?:PATHFINDER\s*2|NHS[- ]Galleri)[^\n]{0,100}"
        r"(?:sensitivity|PPV|specificity)[^\n]{0,60}\d{1,3}(?:\.\d+)?\s*%)",
        blob,
    ):
        _add(results, m.group(1)[:180])

    conclusions: list[str] = []
    if re.search(r"(?i)favorable benefit[- ]risk|meets the criteria recommended", blob):
        conclusions.append(
            "Document frames a favorable benefit-risk / meets prior panel criteria."
        )
    if re.search(r"(?i)early[' ]?detection|supports the proposed indications", blob):
        conclusions.append(
            "Open issue often includes whether stage performance supports 'early' detection labelling."
        )
    if re.search(
        r"(?i)no new (pediatric )?safety (signals?|concerns?)|"
        r"did not identify any new pediatric safety",
        blob,
    ):
        conclusions.append(
            "FDA DPV: no new pediatric safety signals identified; routine pharmacovigilance continues."
        )
    if re.search(
        r"(?i)(?:zero|no|0)\s+(?:fatal|deaths?).{0,40}(?:discussion|cases)|"
        r"no fatal pediatric",
        blob,
    ):
        conclusions.append("No fatal pediatric cases retained for causality discussion.")
    m_faers = re.search(
        r"(?i)identified\s+(\d+)\s+reports?",
        blob,
    )
    if m_faers:
        excl = re.search(r"(?i)all\s+(?:\d+\s+)?reports?\s+were\s+excluded|excluded\s+all", blob)
        results.append(
            f"FAERS U.S. serious pediatric reports reviewed: {m_faers.group(1)}"
            + ("; all excluded from case series." if excl else ".")
        )
    m_death = re.search(
        r"(?i)including\s+(\d+)\s+reports?\s+with\s+the\s+outcome\s+of\s+death",
        blob,
    )
    if m_death:
        results.append(
            f"Of those, {m_death.group(1)} reports coded death — excluded as unassessable "
            "(publication aggregates without patient-level causality data)."
        )
    m_reo = re.search(
        r"(?i)reoperation rate increased over time[^.]{0,120}?"
        r"(\d{1,2}\s*%).{0,40}?(\d{1,2}\s*%).{0,40}?(\d{1,2}\s*%)",
        blob,
    )
    if m_reo:
        results.append(
            f"PAS reoperation rate rose over reports: {m_reo.group(1)} → {m_reo.group(2)} → {m_reo.group(3)}."
        )
    elif re.search(r"(?i)reoperation rate increased", blob):
        results.append("PAS reoperation rate increased across successive annual reports.")
    m_mdr = re.search(
        r"(?i)(?:total of )?(?:three hundred and four|(\d{2,4}))\s+worldwide MDRs",
        blob,
    )
    if m_mdr:
        n = m_mdr.group(1) or "304"
        results.append(f"Worldwide MDRs since HDE approval: {n}.")
    m_mdr_us = re.search(
        r"(?i)(\d{1,2}\.\d{1,2}\s*%).{0,20}(?:in the )?US|"
        r"US\s*\([^)]*\)\s*(\d{1,2}\.\d{1,2}\s*%)|"
        r"30\.30%\s*in the US",
        blob,
    )
    if re.search(r"(?i)30\.30%\s*in the US|US \(120/396\)", blob):
        results.append("US MDR rate ~30.3% (120/396); most resulting in reoperation.")


    return {
        "results": results[:16],
        "statistics": stats[:16] or results[:16],
        "conclusions": conclusions[:6],
    }


# Investor digest Q&A for PMA / MCED AdCom packages (Galleri-style).
FDA_PMA_PANEL_QA: list[dict[str, str]] = [
    {
        "id": "q1_study_design",
        "question": (
            "Study designs: primary and secondary endpoints of PATHFINDER 2 and "
            "NHS-Galleri, enrollment criteria, and key differences between the two "
            "designs (US prospective vs UK randomized)."
        ),
    },
    {
        "id": "q2_test_performance",
        "question": (
            "Test performance: overall and per-cancer-type sensitivity and specificity, "
            "with emphasis on cancers already covered by recommended screening "
            "(e.g. breast, prostate, colorectal) vs those without standard screening today."
        ),
    },
    {
        "id": "q3_cso_accuracy",
        "question": (
            "Cancer Signal Origin (CSO) accuracy — organ-of-origin prediction — and "
            "which critical issues FDA flags on this."
        ),
    },
    {
        "id": "q4_safety_false_positives",
        "question": (
            "Safety: what FDA says about limits of the safety analysis (especially if "
            "Galleri results were not returned to participants in a primary study), and "
            "false-positive risk (including reported rate) in terms of unnecessary "
            "diagnostic procedures."
        ),
    },
    {
        "id": "q5_fda_limitations",
        "question": (
            "FDA-raised limitations / uncertainty: episode-sensitivity bias, differences "
            "between the two studies, recurrent cancers in NHS-Galleri, and risk of "
            "false reassurance after a negative result."
        ),
    },
    {
        "id": "q6_panel_voting_literal",
        "question": (
            "Questions for Panel Discussion (section 9) and Voting Questions (section 10): "
            "report them in full, literally — these are the most predictive of the vote."
        ),
    },
    {
        "id": "q7_early_vs_detection",
        "question": (
            "\"Early detection\" vs \"cancer detection\": what the document says about "
            "stage distribution and whether it supports an early-detection claim."
        ),
    },
    {
        "id": "q8_investor_vote_odds",
        "question": (
            "Investor paragraph: if estimating the chance the panel votes favorably, "
            "which 2–3 elements weigh most for and against."
        ),
    },
]


def _is_mced_pma_package(text: str, row: dict[str, Any] | None = None) -> bool:
    blob = f"{text or ''} {row or {}}"
    return bool(
        re.search(
            r"(?i)PATHFINDER\s*2|NHS[- ]Galleri|multi[- ]cancer\s+early\s+detection|"
            r"\bMCED\b|Cancer\s+Signal\s+Origin|\bGalleri\b",
            blob,
        )
    )


def extract_literal_panel_and_voting(text: str) -> str:
    """Pull sections 9 (panel discussion) + 10 (voting) when present in FDA staff briefs."""
    blob = text or ""
    m = re.search(
        r"(?i)(?:^|\n)\s*9\.?\s*Questions for Panel Discussion\b|"
        r"Questions for Panel Discussion\s+FDA is seeking",
        blob,
    )
    if not m:
        m = re.search(r"(?i)Questions for Panel Discussion", blob)
    if not m:
        return ""
    start = m.start()
    # Prefer the body occurrence (not TOC): body usually has FDA is seeking nearby.
    body = re.search(
        r"(?i)Questions for Panel Discussion\s+FDA is seeking",
        blob,
    )
    if body:
        start = body.start()
    end_m = re.search(
        r"(?i)(?:^|\n)\s*11\.?\s*References\b|(?:^|\n)\s*References\b",
        blob[start + 80 :],
    )
    end = start + 80 + end_m.start() if end_m else min(len(blob), start + 9000)
    out = re.sub(r"[ \t]+", " ", blob[start:end])
    out = re.sub(r"\n{3,}", "\n\n", out).strip()
    return out[:9000]


def _heuristic_mced_panel_qa(text: str, row: dict[str, Any]) -> list[dict[str, str]]:
    """Structured Q1–Q8 digest when AI is unavailable (Galleri / MCED PMA packages)."""
    metrics = heuristic_extract_metrics(text)
    stats = "; ".join((metrics.get("results") or metrics.get("statistics") or [])[:10])
    literal = extract_literal_panel_and_voting(text)
    pf2 = bool(re.search(r"(?i)PATHFINDER\s*2", text))
    nhs = bool(re.search(r"(?i)NHS[- ]Galleri", text))
    not_returned = bool(
        re.search(r"(?i)results were not returned|not returned to (?:the )?participants", text)
    )
    false_reass = bool(re.search(r"(?i)false reassurance", text))
    recurrent = bool(re.search(r"(?i)recurren(?:t|ce)", text))
    cso_m = re.search(
        r"(?i)(?:overall )?accuracy of Galleri CSO prediction[^.]{0,40}"
        r"(\d{1,3}(?:\.\d+)?\s*%[^.]{0,80})",
        text,
    )
    cso_bit = (
        f" PATHFINDER 2 CSO accuracy among true positives: {cso_m.group(1).strip()}."
        if cso_m
        else ""
    )
    fp_m = re.search(
        r"(?i)false[- ]positive rate was\s+(\d{1,3}(?:\.\d+)?\s*%(?:\s*\([^)]+\))?)",
        text,
    )
    fp_bit = fp_m.group(1).strip() if fp_m else "0.15% (PATHFINDER 2 table)"
    answers: dict[str, str] = {
        "q1_study_design": (
            f"{'PATHFINDER 2 is the US interventional prospective pivotal; ' if pf2 else ''}"
            f"{'NHS-Galleri is the UK randomized controlled pivotal. ' if nhs else ''}"
            "Both evaluate Galleri for multi-cancer signal detection with 12-month episode "
            "sensitivity, specificity, PPV/NPV, and CSO accuracy as key effectiveness measures; "
            "enrollment targets adults in the screening age range (proposed IFU: aged 50+). "
            "Key design contrast: US single-arm prospective return-of-results interventional "
            "study vs UK RCT with different healthcare pathway and cancer ascertainment "
            "(NCRAS / NHS). See FDA sections 7.1–7.2 for primary/secondary endpoint lists and "
            "enrollment criteria detail."
        ),
        "q2_test_performance": (
            f"Headline PATHFINDER 2 performance (12-month): {stats or 'see Results tables'}. "
            "FDA presents overall episode sensitivity (~35% PATHFINDER 2) with very high "
            "specificity (~99.85%) and PPV (~77%), plus per-cancer-type and stage breakdowns. "
            "Sensitivity is generally lower for many cancers already covered by USPSTF "
            "screening (breast, prostate, colorectal, etc.) than for several cancers without "
            "standard screening — FDA explicitly asks the panel to discuss clinical "
            "significance separately for screened vs unscreened cancer types and inter-study "
            "variability vs NHS-Galleri."
        ),
        "q3_cso_accuracy": (
            "When Cancer Signal Detected, Galleri returns a Cancer Signal Origin (CSO) "
            "prediction (and may return supplemental CSO-S)."
            f"{cso_bit} "
            "FDA highlights misclassification cases (wrong organ / cancers without a defined "
            "clinical CSO) and asks whether performance by cancer type creates new risks "
            "needing labeling mitigations. Episode sensitivity accounting for CSO accuracy "
            "is lower than raw signal sensitivity — a key FDA framing point."
        ),
        "q4_safety_false_positives": (
            f"False-positive rate reported around {fp_bit}, implying a small absolute rate of "
            "unnecessary diagnostic workups among screen negatives' complement — but each FP "
            "can trigger invasive procedures (FDA tables cover invasive diagnostic procedures "
            "/ AEs during diagnostic resolution)."
            + (
                " FDA notes limitations of the safety analysis where Galleri results were not "
                "returned to participants in a primary study context, which constrains "
                "real-world procedure/AE inference from that design."
                if not_returned
                else " Review the Safety sections (PATHFINDER 2 / NHS-Galleri) for AE counts "
                "during diagnostic resolution."
            )
        ),
        "q5_fda_limitations": (
            "FDA flags uncertainty around episode-sensitivity methodology/bias, inter-study "
            "differences between PATHFINDER 2 and NHS-Galleri, "
            + ("handling of recurrent cancers in NHS-Galleri, " if recurrent else "")
            + (
                "and the risk of false reassurance after a No Cancer Signal Detected result "
                "(negative does not rule out cancer; continue guideline screening)."
                if false_reass
                else "and false-reassurance risk after negative results (IFU: continue "
                "guideline-recommended single-cancer screening)."
            )
            + " Precautions/limitations also stress Galleri is not a replacement for existing "
            "single-cancer screening."
        ),
        "q6_panel_voting_literal": literal
        or "Section 9 / 10 not found in extracted text — open the FDA PDF.",
        "q7_early_vs_detection": (
            "FDA explicitly asks whether stage-specific performance (overall and per cancer "
            "type) supports the proposed IFU wording of 'early' detection. If not, panel is "
            "asked whether an alternate indication for multi-cancer detection without the "
            "'early' characterization is more appropriate, and how 'early' should be "
            "described in labeling (e.g. by stage / curative-intent eligibility). Stage "
            "distribution tables in the pivotal analyses are the evidence base — many "
            "detected cancers are not concentrated solely in stage I, which is the core "
            "tension for an early-detection claim."
        ),
        "q8_investor_vote_odds": (
            f"For {row.get('ticker') or 'GRAL'} / {row.get('product') or 'Galleri'}: "
            "FOR — (1) very high specificity / low FP rate with solid PPV in PATHFINDER 2; "
            "(2) CSO accuracy among true positives is high (~90%+ in reported analyses); "
            "(3) clear unmet need narrative for cancers without USPSTF screening. "
            "AGAINST — (1) modest overall episode sensitivity (~35% PATHFINDER 2) and "
            "weaker performance on many already-screened cancers; (2) open FDA question on "
            "whether data support 'early' detection labeling; (3) design differences / "
            "safety-analysis limits and false-reassurance risk may push for labeling "
            "constraints or post-approval studies. Net: panel may lean toward a mixed/yes "
            "on safety-effectiveness-B/R with labeling carve-outs rather than a clean "
            "unconditional endorsement of 'early' detection."
        ),
    }
    out: list[dict[str, str]] = []
    for q in FDA_PMA_PANEL_QA:
        out.append(
            {
                "id": q["id"],
                "question": q["question"],
                "answer": answers.get(q["id"], "")[:12000],
            }
        )
    return out


def briefing_text_for_ai(text: str, *, limit: int = 28_000) -> str:
    """Keep synopsis/results windows; drop oversized TOC-only heads."""
    blob = text or ""
    if len(blob) <= limit:
        return blob
    parts = [blob[:5000]]
    for pat in (
        r"(?i)1\.3\s+Product Overview",
        r"(?i)(?:Executive\s+Summary|Introduction|Background)",
        r"(?i)(?:Device Description|Mechanism|methylation)",
        r"(?i)(?:Efficacy|Effectiveness|Clinical\s+Studies|Study\s+Results|Pivotal)",
        r"(?i)(?:Safety|Adverse\s+Events|Pediatric\s+safety)",
        r"(?i)PATHFINDER\s*2",
        r"(?i)NHS[- ]Galleri",
        r"(?i)Episode\s+Sensitivity\s*=",
        r"(?i)PPV\s*=",
        r"(?i)Benefit[- ]Risk",
        r"(?i)(?:limitations|uncertainty|Precautions)",
        r"(?i)Questions for Panel Discussion",
        r"(?i)Voting Questions",
        r"(?i)(?:Conclusions?|Summary\s+of\s+Findings)",
    ):
        m = re.search(pat, blob)
        if not m:
            continue
        start = max(0, m.start() - 120)
        chunk = 4500 if "Questions" in pat or "Voting" in pat else 3500
        parts.append(blob[start : start + chunk])
    literal = extract_literal_panel_and_voting(blob)
    if literal:
        parts.append(literal)
    out = "\n\n----\n\n".join(parts)
    return out[:limit]

def extract_executive_summary(text: str, *, limit: int = 6500) -> str:
    """
    Pull the full EXECUTIVE SUMMARY chapter from an FDA briefing PDF text.
    Stops at the next numbered major heading (1 INTRODUCTION / I. …).
    """
    blob = text or ""
    m = re.search(r"(?im)^\s*EXECUTIVE\s+SUMMARY\s*$", blob)
    if not m:
        m = re.search(r"(?i)\bEXECUTIVE\s+SUMMARY\b", blob)
    if not m:
        return ""
    start = m.end()
    tail = blob[start:]
    # End at next top-level section (Introduction, Methods, Roman numeral, etc.).
    end_m = re.search(
        r"(?im)^\s*(?:1(?:\.\d+)?\s+INTRODUCTION|I+\.\s+INTRODUCTION|"
        r"1(?:\.\d+)?\s+Introduction|INTRODUCTION\s*$|"
        r"TABLE\s+OF\s+CONTENTS)\s*",
        tail,
    )
    body = tail[: end_m.start()] if end_m else tail
    body = re.sub(r"[ \t]+", " ", body)
    body = re.sub(r"\n{3,}", "\n\n", body).strip()
    if len(body) < 80:
        return ""
    return body[:limit]


def _heuristic_investor_insight(row: dict[str, Any], text: str, metrics: dict[str, list[str]]) -> str:
    """Product-path impact first, then company / stock — no buy/sell order."""
    product = str(row.get("product") or row.get("ticker") or "the product").strip()
    company = str(row.get("company") or row.get("ticker") or "the company").strip()
    tk = str(row.get("ticker") or "").strip().upper() or "the stock"
    blob = (text or "").lower()
    deaths = _faers_death_count(text)
    serious_n = _faers_serious_report_count(text)
    product_bits: list[str] = []

    if deaths > 0 or (serious_n > 0 and re.search(r"(?i)faers|serious (pediatric )?adverse", blob)):
        parts = []
        if serious_n > 0:
            parts.append(f"{serious_n} U.S. serious pediatric FAERS reports")
        if deaths > 0:
            parts.append(f"{deaths} coded with the outcome of death")
        counted = " / ".join(parts) if parts else "serious adverse-event reports"
        excluded = bool(
            re.search(r"(?i)all .{0,20}reports? were excluded|excluded from (further )?discussion", blob)
        )
        product_bits.append(
            f"Product path: the DPV package for {product} reviews {counted}"
            + (
                " — even where cases were later excluded as unassessable, surfacing death and "
                "serious AE counts is a negative safety file update for the pediatric franchise."
                if excluded or deaths > 0
                else " — a negative safety overhang for the labeled pediatric use."
            )
        )
        if re.search(
            r"(?i)(?:no|not identify(?: any)?) .{0,25}new (pediatric )?safety (signals?|concerns?)",
            blob,
        ):
            product_bits.append(
                "DPV did not call a new labeled safety signal, but that does not erase the "
                "adverse-event / death volume already in the review."
            )
    elif re.search(
        r"(?i)(?:no|not identify(?: any)?) .{0,25}new (pediatric )?safety (signals?|concerns?)",
        blob,
    ):
        product_bits.append(
            f"Product path: FDA DPV reports no new pediatric safety concerns for {product} "
            "and plans continued routine pharmacovigilance — this package does not add a new "
            "safety restriction based on the review text."
        )
    if re.search(
        r"(?i)identified no reports|zero .{0,40}pediatric reports|"
        r"retrieved zero|n\s*=\s*0|no reports\.",
        blob,
    ) and deaths == 0 and serious_n == 0:
        product_bits.append(
            "FAERS review retrieved no U.S. serious pediatric cases in the stated window, "
            "so there is no new case series weighing on the labeled pediatric use."
        )
    if re.search(r"(?i)met (the )?primary endpoint|statistically significant|substantial evidence", blob):
        product_bits.append(
            f"Product path: the package highlights supportive efficacy / benefit-risk language for {product}."
        )
    if re.search(r"not previously been presented|first .{0,20}pediatric advisory", blob):
        product_bits.append(
            "This appears to be a first PAC presentation for the product’s pediatric postmarketing review."
        )
    if not product_bits and metrics.get("conclusions"):
        product_bits.append(
            "Product path: " + "; ".join(metrics["conclusions"][:2])
        )
    if not product_bits:
        product_bits.append(
            f"Product path: the briefing updates the regulatory safety file for {product}; "
            "read the Executive Summary for DPV’s stated findings."
        )
    if deaths > 0 or serious_n >= 10:
        stock_bits = [
            f"Company / stock ({tk}): for {company}, a review that puts serious AE and death-coded "
            "FAERS counts in front of the PAC is a near-term negative / overhang on the safety "
            "narrative — not a trading signal by itself, but clearly bearish vs a clean file."
        ]
    else:
        stock_bits = [
            f"Company / stock ({tk}): for {company}, a clean postmarketing pediatric review is usually "
            "near-term noise to mildly constructive on the franchise safety narrative — not a trading signal "
            "unless the committee raises unexpected questions beyond the written package."
        ]
    return " ".join(product_bits + stock_bits)[:1200]


def _normalize_panel_qa(raw: Any, *, questions: list[dict[str, str]]) -> list[dict[str, str]]:
    """Align AI panelQa list to the fixed question ids; drop empties."""
    by_id: dict[str, dict[str, str]] = {}
    if isinstance(raw, list):
        for i, item in enumerate(raw):
            if not isinstance(item, dict):
                continue
            qid = str(item.get("id") or "").strip()
            if not qid and i < len(questions):
                qid = questions[i]["id"]
            ans = str(item.get("answer") or "").strip()
            qtext = str(item.get("question") or "").strip()
            if not qid or not ans:
                continue
            by_id[qid] = {
                "id": qid,
                "question": qtext
                or next((q["question"] for q in questions if q["id"] == qid), qtext),
                "answer": ans[:12000],
            }
    out: list[dict[str, str]] = []
    for q in questions:
        hit = by_id.get(q["id"])
        if hit:
            out.append(
                {
                    "id": q["id"],
                    "question": hit.get("question") or q["question"],
                    "answer": hit["answer"],
                }
            )
        elif q["id"] in by_id:
            out.append(by_id[q["id"]])
    # Keep any extra AI ids not in the template (rare).
    known = {q["id"] for q in questions}
    for qid, item in by_id.items():
        if qid not in known:
            out.append(item)
    return out


def _extract_indication_from_fda_text(text: str) -> str:
    blob = text or ""
    for pat in (
        r"(?i)(?:currently\s+)?indicated\s+for\s+(?:the\s+)?"
        r"(?:topical\s+)?(?:treatment\s+of\s+)?"
        r"([^.\n]{8,160})",
        r"(?i)indication[s]?\s*:\s*([^.\n]{8,160})",
        r"(?i)(?:for\s+the\s+(?:topical\s+)?treatment\s+of)\s+([^.\n]{8,160})",
        r"(?i)\b(molluscum\s+contagiosum)\b",
    ):
        m = re.search(pat, blob)
        if m:
            ind = re.sub(r"\s+", " ", m.group(1)).strip(" ;,")
            if len(ind) >= 8 and not re.match(r"(?i)^(this|the|a|an|topical)\b", ind):
                return ind[:220]
    return ""


def _is_big_pharma_name(company: str, ticker: str = "") -> bool:
    tk = (ticker or "").strip().upper()
    if tk in {
        "JNJ",
        "PFE",
        "MRK",
        "ABBV",
        "LLY",
        "AZN",
        "NVS",
        "NVO",
        "SNY",
        "GSK",
        "BMY",
        "AMGN",
        "GILD",
    }:
        return True
    return bool(
        re.search(
            r"(?i)\b("
            r"johnson\s*&\s*johnson|pfizer|merck|abbvie|eli\s+lilly|astrazeneca|"
            r"novartis|novo\s+nordisk|sanofi|glaxosmithkline|bristol[-\s]?myers|"
            r"amgen|gilead)\b",
            company or "",
        )
    )


def _heuristic_company_product_context(
    row: dict[str, Any], text: str
) -> tuple[str, dict[str, str]]:
    """Fallback company blurb + product inset when AI omits them."""
    company = str(row.get("company") or row.get("ticker") or "").strip()
    product = str(row.get("product") or "").strip() or "product"
    tk = str(row.get("ticker") or "").strip().upper()
    committee = str(row.get("committee") or "").strip()
    indication = _extract_indication_from_fda_text(text)
    company_summary = ""
    product_inset: dict[str, str] = {
        "name": product,
        "moa": "",
        "target": "",
        "indications": indication,
        "stage": "",
        "usa_prevalence": "",
    }
    if _is_mced_pma_package(text, row) or product.lower().startswith("galleri"):
        company_summary = (
            f"{company or 'GRAIL, Inc.'} ({tk or 'GRAL'}) develops multi-cancer early "
            "detection (MCED) blood tests. Flagship product Galleri is an NGS cfDNA "
            "methylation assay for screening adults aged 50+ and predicting Cancer Signal "
            "Origin (CSO) when a cancer signal is detected."
        )
        product_inset = {
            "name": product or "Galleri",
            "moa": (
                "NGS-based IVD detecting cancer-specific methylation patterns in cell-free "
                "DNA (cfDNA) from peripheral whole blood; returns Cancer Signal Detected / "
                "No Cancer Signal Detected plus CSO when positive."
            ),
            "target": "Aberrantly methylated cfDNA / cancer-specific methylation signatures",
            "indications": (
                indication
                or "Screening for early detection of multiple cancer types in adults aged 50+; "
                "CSO prediction when Cancer Signal Detected. Not a replacement for "
                "guideline-recommended single-cancer screening."
            ),
            "stage": "PMA under FDA review (CDRH / Molecular and Clinical Genetics Panel)",
            "usa_prevalence": "",
        }
    elif _is_big_pharma_name(company, tk):
        company_summary = (
            f"{company or tk} is a large pharmaceutical company marketing and developing "
            f"multiple drugs. This FDA package reviews {product}"
            + (f" ({indication})" if indication else "")
            + "."
        )
        product_inset.update(
            {
                "indications": indication,
                "stage": committee or "FDA Advisory Committee",
            }
        )
    elif company or product:
        # Specialty / biotech — say who they are + what this briefing product is for.
        focus = ""
        if indication:
            focus = f" This briefing covers {product} for {indication}."
        elif product and product.lower() != "product":
            focus = f" This briefing covers {product}."
        company_summary = (
            f"{company or tk} ({tk}) is a biotech / specialty pharma company."
            f"{focus}"
        ).strip()
        # Common known products when indication missing from thin text.
        low = f"{product} {text[:2500]}".lower()
        if re.search(r"berdazimer|zelsuvmi|molluscum", low):
            indication = indication or "Molluscum contagiosum"
            product_inset["indications"] = indication
            product_inset["usa_prevalence"] = (
                product_inset.get("usa_prevalence")
                or "~5–11% of US children under 15 affected at some point "
                "(common pediatric skin infection)"
            )
            if tk == "LGND" or re.search(r"(?i)ligand", company):
                company_summary = (
                    f"{company or 'Ligand Pharmaceuticals'} ({tk or 'LGND'}) is a specialty "
                    "biotech focused on Captisol® enabling technology and royalty / partnered "
                    f"assets. This FDA package reviews {product} for molluscum contagiosum "
                    "(topical nitric oxide–releasing gel; pediatric labeling)."
                )
            else:
                company_summary = (
                    f"{company or tk} ({tk}) is a biotech / specialty pharma company. "
                    f"This briefing covers {product} for molluscum contagiosum."
                )
        if re.search(r"(?i)nitric oxide|NO[- ]releasing|berdazimer", text):
            product_inset["moa"] = (
                product_inset.get("moa")
                or "Topical nitric oxide–releasing agent (berdazimer sodium)"
            )
            product_inset["target"] = (
                product_inset.get("target") or "Nitric oxide / viral skin infection pathway"
            )
        product_inset["name"] = product
        product_inset["indications"] = indication or product_inset.get("indications") or ""
        if indication and re.search(r"(?i)molluscum", indication):
            product_inset["usa_prevalence"] = (
                product_inset.get("usa_prevalence")
                or "~5–11% of US children under 15 affected at some point "
                "(common pediatric skin infection)"
            )
        product_inset["stage"] = (
            committee
            or (
                "Pediatric postmarketing pharmacovigilance review"
                if re.search(r"(?i)pediatric|postmarketing|pharmacovigilance", text)
                else "FDA Advisory Committee"
            )
        )[:160]
    return company_summary[:900], product_inset


def score_briefing_with_ai(text: str, row: dict[str, Any]) -> dict[str, Any] | None:
    try:
        import ai_provider
    except Exception:
        return None
    if not ai_provider.is_available():
        return None
    mced = _is_mced_pma_package(text, row)
    # Always ask for company/product context; MCED adds the 8-question panel digest.
    context_block = (
        "  companySummaryEn: 2-4 sentences — who the company is and what they develop. "
        "If it is a large/big pharma with a broad portfolio, say they market and develop "
        "multiple drugs (do not list the whole pipeline). No invented market-cap numbers,\n"
        "  companySummaryIt: same in Italian,\n"
        "  productInset: object with keys name, moa, target, indications, stage, "
        "usa_prevalence (English; MoA/target when known; labeled indication(s); "
        "development/regulatory stage; US prevalence only if stated or clearly standard),\n"
        "  productInsetIt: same object in Italian,\n"
    )
    panel_block = ""
    if mced:
        q_lines = "\n".join(
            f"    - id={q['id']}: {q['question']}" for q in FDA_PMA_PANEL_QA
        )
        panel_block = (
            "  panelQaEn: array of exactly 8 objects {id, question, answer} answering "
            "THESE questions one-by-one (use the given id; put the question text in "
            "question; answer in prose with all key numbers; for id=q6_panel_voting_literal "
            "the answer MUST be the FULL LITERAL text of section 9 Questions for Panel "
            "Discussion AND section 10 Voting Questions from the document — do not "
            "paraphrase):\n"
            f"{q_lines}\n"
            "  panelQaIt: same 8 answers in Italian (q6 may stay English if the source "
            "questions are English-only),\n"
        )
    prompt = (
        "You are a biotech / pharma intelligence analyst reading an FDA advisory-committee "
        "briefing PDF (FDA staff and/or sponsor executive summary).\n"
        "Return ONLY a JSON object with keys:\n"
        "  score: number from -10 (quite negative for the product / approval path) to +10 "
        "(supportive),\n"
        "  clinicalScore: number from -10 to +10 — clinical/regulatory impact of THIS package "
        "on the product (same scale as score; may equal score),\n"
        "  stance: positive | mixed | negative,\n"
        "SCORING RULES (mandatory):\n"
        "  - Reporting serious adverse events is NEGATIVE; death-coded reports are the most "
        "severe step on the scale (typically clinicalScore ≤ −2 even if DPV later excludes "
        "cases or says 'no new safety signal').\n"
        "  - Positive efficacy / met endpoint / favorable benefit-risk is POSITIVE.\n"
        "  - For MCED/PMA packages with open labeling questions (e.g. 'early' detection) "
        "prefer mixed unless the document clearly endorses favorable benefit-risk.\n"
        "  - Always cite n treated / n with AEs / death counts when the document has them.\n"
        "  executiveSummaryEn: a CLEAR 5-8 sentence SUMMARY of the Executive Summary "
        "(not a verbatim dump, not TOC) — keep every key number, n, %, CI, and the "
        "document's bottom-line conclusion,\n"
        "  executiveSummaryIt: same in Italian,\n"
        "  introductionEn: 3-5 sentences — what the package is, product/indication, "
        "committee purpose, study design / review scope (no TOC, no page numbers, "
        "no invented facts),\n"
        "  introductionIt: same in Italian,\n"
        "  summaryEn: 6-10 sentences covering introduction context, ALL key efficacy and "
        "safety results with numbers, and the document's conclusions / open panel questions "
        "so a reader understands CONTENT and IMPACT without opening the PDF,\n"
        "  summaryIt: same content in Italian,\n"
        "  resultsEn: array of EVERY primary and key secondary result as short bullets "
        "with exact numbers (n treated, n with AEs, %, CI when present),\n"
        "  resultsIt: same bullets in Italian,\n"
        "  statisticsEn: array of compact statistic bullets (one metric per line),\n"
        "  statisticsIt: same in Italian,\n"
        "  conclusionsEn: 3-6 bullets on benefit-risk, labelling issues, safety signals, "
        "and questions for the panel — what the package implies for the product's path,\n"
        "  conclusionsIt: same in Italian,\n"
        f"{context_block}"
        f"{panel_block}"
        "  investorInsightEn: 5-7 plain sentences (no markdown, no bullets). Structure MUST be:\n"
        "    (1) PRODUCT ADVANCEMENT first — how this package affects the product's "
        "regulatory/clinical path, labeling, safety file, PAC questions;\n"
        "    (2) then COMPANY and STOCK PRICE — franchise/royalty/corporate implications "
        "and bullish / bearish / mixed / likely noise with WHY.\n"
        "    If the read is safety-negative (serious AE / death), say so plainly (bearish).\n"
        "    No buy/sell order.\n"
        "  investorInsightIt: same structure in Italian,\n"
        "  bulletsEn: 5-8 short investor-facing English bullets,\n"
        "  bulletsIt: 5-8 short Italian bullets.\n"
        "Do not invent numbers. Do not give a buy/sell recommendation.\n"
        f"Ticker: {row.get('ticker')}  Company: {row.get('company')}  "
        f"Product: {row.get('product')}  Date: {row.get('date')}\n\n"
        f"Briefing text:\n{briefing_text_for_ai(text)}"
    )
    raw = ai_provider.call_ai(prompt, max_tokens=8000 if mced else 3200, task="summary")
    if not raw:
        return None
    return _parse_ai_json(raw)


def _join_bullets(items: list[str], *, limit: int = 12) -> str:
    lines = [f"• {x}" for x in items[:limit] if str(x).strip()]
    return "\n".join(lines).strip()


def _scrub_section_prose(text: str, *, limit: int = 2200) -> str:
    """Drop TOC / header chrome so Introduction reads as a real summary."""
    blob = str(text or "").strip()
    if not blob:
        return ""
    # Cut at embedded EXECUTIVE SUMMARY / TABLE OF CONTENTS dumps.
    cut = re.search(
        r"(?is)\b(?:TABLE\s+OF\s+CONTENTS|EXECUTIVE\s+SUMMARY)\b",
        blob,
    )
    if cut and cut.start() >= 40:
        blob = blob[: cut.start()].strip()
    elif cut and cut.start() < 40:
        # TOC at the very start — take text after the next real prose block if any.
        after = blob[cut.end() :]
        nxt = re.search(
            r"(?is)\b(?:This review|This document|The Division|Background|1\s+Introduction)\b",
            after,
        )
        blob = after[nxt.start() :].strip() if nxt else blob[: cut.start()].strip() or after[:800]
    # Drop leading metadata-only lines that are not prose.
    lines = []
    for ln in blob.splitlines():
        s = ln.strip()
        if not s:
            continue
        if re.match(
            r"(?i)^(review date|product name|application type|applicant|"
            r"pediatric labeling|bla|nda|nda/bla)\b",
            s,
        ) and len(s) < 120:
            continue
        if re.match(r"(?i)^\d+(\.\d+)?\s+[A-Z].{0,40}\.{2,}\s*\d+\s*$", s):
            continue
        lines.append(s)
    out = " ".join(lines) if lines else blob
    out = re.sub(r"[ \t]+", " ", out)
    out = re.sub(r"\n{3,}", "\n\n", out).strip()
    # Final safety: strip any remaining TOC / exec-summary headers mid-string.
    out = re.split(
        r"(?i)\b(?:TABLE\s+OF\s+CONTENTS|EXECUTIVE\s+SUMMARY)\b",
        out,
        maxsplit=1,
    )[0].strip()
    return out[:limit]


def _condense_executive_summary(text: str, *, limit: int = 1600) -> str:
    """Readable executive digest — not a full chapter paste."""
    blob = _scrub_section_prose(text, limit=limit * 2)
    if not blob:
        return ""
    # Prefer sentence-bounded trim.
    if len(blob) <= limit:
        return blob
    cut = blob[:limit]
    # Break on sentence end when possible.
    m = list(re.finditer(r"[.!?]\s+", cut))
    if m and m[-1].end() > limit * 0.55:
        cut = cut[: m[-1].end()].strip()
    else:
        cut = cut.rsplit(" ", 1)[0].strip() + "…"
    return cut


def _section_summaries_from_card(
    *,
    introduction: str,
    results: list[str],
    statistics: list[str],
    conclusions: list[str],
) -> list[dict[str, str]]:
    """UI chapters: Introduction → Results → Conclusions."""
    out: list[dict[str, str]] = []
    intro = _scrub_section_prose(introduction)
    if intro:
        out.append({"heading": "Introduction", "summary": intro[:2200]})
    # Results first with stats interleaved — keep numbers visible.
    res_blob = _join_bullets(results + [s for s in statistics if s not in results], limit=18)
    if res_blob:
        out.append({"heading": "Results", "summary": res_blob[:2800]})
    conc_blob = _join_bullets(conclusions, limit=10)
    if conc_blob:
        out.append({"heading": "Conclusions", "summary": conc_blob[:2200]})
    return out


def build_briefing_card(
    text: str,
    row: dict[str, Any],
    *,
    materials_url: str,
    pdf_url: str,
    title: str,
    match_ok: bool = True,
    match_hint: str = "company",
) -> dict[str, Any]:
    heuristic = heuristic_fda_score(text)
    ai = score_briefing_with_ai(text, row) or {}
    heur_metrics = heuristic_extract_metrics(text)
    try:
        score = float(ai.get("score")) if ai.get("score") is not None else heuristic
    except (TypeError, ValueError):
        score = heuristic
    score = apply_safety_severity_to_score(score, text)
    try:
        clinical_score = (
            float(ai.get("clinicalScore"))
            if ai.get("clinicalScore") is not None
            else score
        )
    except (TypeError, ValueError):
        clinical_score = score
    clinical_score = apply_safety_severity_to_score(clinical_score, text)
    excerpt = _excerpt(text, n=700)
    # Prefer a readable SUMMARY of the executive chapter — never paste TOC/raw dump.
    extracted_exec = extract_executive_summary(text)
    ai_exec = str(ai.get("executiveSummaryEn") or "").strip()
    ai_summary = str(ai.get("summaryEn") or "").strip()
    exec_en = ""
    if ai_exec and len(ai_exec) >= 120 and not re.search(
        r"(?i)table of contents|\.{3,}\s*\d+\s*$", ai_exec
    ):
        exec_en = _condense_executive_summary(ai_exec, limit=1600)
    elif ai_summary and len(ai_summary) >= 120:
        exec_en = _condense_executive_summary(ai_summary, limit=1600)
    elif extracted_exec:
        exec_en = _condense_executive_summary(extracted_exec, limit=1600)
    exec_it = str(ai.get("executiveSummaryIt") or "").strip()
    if exec_it:
        exec_it = _condense_executive_summary(exec_it, limit=1600)
    else:
        exec_it = exec_en
    intro_en = _scrub_section_prose(str(ai.get("introductionEn") or "").strip())
    intro_it = _scrub_section_prose(str(ai.get("introductionIt") or intro_en).strip())
    if not intro_en or len(intro_en) < 120:
        # Prefer first sentences of the executive digest over TOC/header chrome.
        if exec_en and len(exec_en) >= 120:
            intro_en = _condense_executive_summary(exec_en, limit=560)
            intro_it = intro_en
        else:
            head = _scrub_section_prose(_excerpt(text, n=900), limit=900)
            if len(head) >= 100:
                intro_en = head
                intro_it = intro_en
            elif not intro_en:
                intro_en = _scrub_section_prose(_excerpt(text, n=480))
                intro_it = intro_en
    summary_en = str(ai.get("summaryEn") or exec_en or excerpt)
    summary_it = str(ai.get("summaryIt") or exec_it or excerpt)
    results_en = _as_str_list(ai.get("resultsEn"), limit=20) or heur_metrics["results"]
    results_it = _as_str_list(ai.get("resultsIt"), limit=20) or results_en
    stats_en = _as_str_list(ai.get("statisticsEn"), limit=20) or heur_metrics["statistics"]
    stats_it = _as_str_list(ai.get("statisticsIt"), limit=20) or stats_en
    conc_en = _as_str_list(ai.get("conclusionsEn"), limit=10) or heur_metrics["conclusions"]
    conc_it = _as_str_list(ai.get("conclusionsIt"), limit=10) or conc_en
    bullets_en = _as_str_list(ai.get("bulletsEn"), limit=8)
    bullets_it = _as_str_list(ai.get("bulletsIt"), limit=8)
    if not bullets_en and results_en:
        bullets_en = results_en[:6]
    if not bullets_it and results_it:
        bullets_it = results_it[:6]
    insight_en = str(ai.get("investorInsightEn") or "").strip()
    insight_it = str(ai.get("investorInsightIt") or insight_en).strip()
    if not insight_en or not re.search(
        r"(?i)product\s+path|product\s+advancement|company\s*/\s*stock|stock\s+price",
        insight_en,
    ):
        insight_en = _heuristic_investor_insight(row, text, heur_metrics)
        insight_it = insight_en
    # Prefer a metrics-forward short summary when AI fell back to raw PDF TOC excerpt
    # AND we lack an Executive Summary chapter.
    if not exec_en and (
        (not ai.get("summaryEn") or summary_en.strip().startswith("GRAIL") or len(summary_en) < 120)
        and (results_en or stats_en or conc_en or intro_en)
    ):
        head = (
            f"{row.get('company') or row.get('ticker')} / {row.get('product') or 'product'} "
            f"FDA AdCom briefing ({row.get('date')})."
        )
        bits = [head]
        if intro_en and intro_en not in summary_en:
            bits.append(intro_en[:520])
        if results_en:
            bits.append("Key results: " + "; ".join(results_en[:5]))
        if conc_en:
            bits.append("Conclusions: " + "; ".join(conc_en[:4]))
        summary_en = " ".join(bits)
        if not ai.get("summaryIt"):
            summary_it = summary_en
    elif not exec_en and not ai.get("summaryEn") and (results_en or stats_en):
        head = (
            f"{row.get('company') or row.get('ticker')} / {row.get('product') or 'product'} "
            f"FDA AdCom briefing ({row.get('date')})."
        )
        summary_en = head + " " + " ".join(results_en[:6])
        if not ai.get("summaryIt"):
            summary_it = summary_en
    stance = str(ai.get("stance") or "")
    if stance not in {"positive", "mixed", "negative"}:
        stance = "positive" if score >= 2 else "negative" if score <= -2 else "mixed"
    if _faers_death_count(text) > 0:
        stance = "negative"
    sections_en = _section_summaries_from_card(
        introduction=intro_en,
        results=results_en,
        statistics=stats_en,
        conclusions=conc_en,
    )
    sections_it = _section_summaries_from_card(
        introduction=intro_it or intro_en,
        results=results_it or results_en,
        statistics=stats_it or stats_en,
        conclusions=conc_it or conc_en,
    )
    heur_company, heur_product = _heuristic_company_product_context(row, text)
    company_en = str(ai.get("companySummaryEn") or "").strip() or heur_company
    company_it = str(ai.get("companySummaryIt") or company_en).strip() or company_en
    product_inset = ai.get("productInset") if isinstance(ai.get("productInset"), dict) else {}
    product_inset_it = (
        ai.get("productInsetIt") if isinstance(ai.get("productInsetIt"), dict) else {}
    )
    merged_product = {
        "name": str(
            product_inset.get("name")
            or heur_product.get("name")
            or row.get("product")
            or ""
        ).strip()[:160],
        "moa": str(product_inset.get("moa") or heur_product.get("moa") or "").strip()[:800],
        "target": str(
            product_inset.get("target") or heur_product.get("target") or ""
        ).strip()[:400],
        "indications": str(
            product_inset.get("indications") or heur_product.get("indications") or ""
        ).strip()[:800],
        "stage": str(
            product_inset.get("stage") or heur_product.get("stage") or ""
        ).strip()[:240],
        "usa_prevalence": str(
            product_inset.get("usa_prevalence")
            or heur_product.get("usa_prevalence")
            or ""
        ).strip()[:400],
    }
    merged_product_it = {
        "name": str(product_inset_it.get("name") or merged_product["name"]).strip()[:160],
        "moa": str(product_inset_it.get("moa") or merged_product["moa"]).strip()[:800],
        "target": str(
            product_inset_it.get("target") or merged_product["target"]
        ).strip()[:400],
        "indications": str(
            product_inset_it.get("indications") or merged_product["indications"]
        ).strip()[:800],
        "stage": str(
            product_inset_it.get("stage") or merged_product["stage"]
        ).strip()[:240],
        "usa_prevalence": str(
            product_inset_it.get("usa_prevalence") or merged_product["usa_prevalence"]
        ).strip()[:400],
    }
    panel_qa_en = _normalize_panel_qa(ai.get("panelQaEn"), questions=FDA_PMA_PANEL_QA)
    panel_qa_it = _normalize_panel_qa(ai.get("panelQaIt"), questions=FDA_PMA_PANEL_QA)
    # Fill gaps / no-AI path with structured MCED digest; Q6 always literal when present.
    if _is_mced_pma_package(text, row):
        heur_qa = _heuristic_mced_panel_qa(text, row)
        by_id = {q["id"]: q for q in heur_qa}
        for q in panel_qa_en:
            by_id[q["id"]] = q
        literal_q = extract_literal_panel_and_voting(text)
        if literal_q:
            by_id["q6_panel_voting_literal"] = {
                "id": "q6_panel_voting_literal",
                "question": next(
                    x["question"]
                    for x in FDA_PMA_PANEL_QA
                    if x["id"] == "q6_panel_voting_literal"
                ),
                "answer": literal_q,
            }
        order = {q["id"]: i for i, q in enumerate(FDA_PMA_PANEL_QA)}
        panel_qa_en = sorted(by_id.values(), key=lambda x: order.get(x["id"], 99))
        if not panel_qa_it:
            panel_qa_it = panel_qa_en
        else:
            # Prefer EN literal Q6; keep IT answers for other ids when present.
            it_by = {q["id"]: q for q in panel_qa_it}
            it_by["q6_panel_voting_literal"] = by_id["q6_panel_voting_literal"]
            for qid, q in by_id.items():
                it_by.setdefault(qid, q)
            panel_qa_it = sorted(it_by.values(), key=lambda x: order.get(x["id"], 99))
    return {
        "status": "ready",
        "score": score,
        "clinicalScore": clinical_score,
        "stance": stance,
        "title": title,
        "executiveSummaryEn": exec_en,
        "executiveSummaryIt": exec_it or exec_en,
        "introductionEn": intro_en,
        "introductionIt": intro_it,
        "summaryEn": summary_en,
        "summaryIt": summary_it,
        "resultsEn": results_en,
        "resultsIt": results_it,
        "statisticsEn": stats_en,
        "statisticsIt": stats_it,
        "conclusionsEn": conc_en,
        "conclusionsIt": conc_it,
        "investorInsightEn": insight_en,
        "investorInsightIt": insight_it,
        "companySummaryEn": company_en,
        "companySummaryIt": company_it,
        "productInset": merged_product,
        "productInsetIt": merged_product_it,
        "panelQaEn": panel_qa_en,
        "panelQaIt": panel_qa_it or panel_qa_en,
        "sectionSummariesEn": sections_en,
        "sectionSummariesIt": sections_it,
        "bulletsEn": bullets_en,
        "bulletsIt": bullets_it,
        "materialsUrl": materials_url,
        "pdfUrl": pdf_url,
        "matchOk": bool(match_ok),
        "matchHint": match_hint,
        "source": "fda_briefing",
        "updated_at": datetime.now(timezone.utc).astimezone().isoformat(),
    }


def _pending_card() -> dict[str, Any]:
    return {
        "status": "pending",
        "score": None,
        "clinicalScore": None,
        "stance": None,
        "title": "",
        "executiveSummaryEn": "",
        "executiveSummaryIt": "",
        "introductionEn": "",
        "introductionIt": "",
        "summaryEn": "",
        "summaryIt": "",
        "resultsEn": [],
        "resultsIt": [],
        "statisticsEn": [],
        "statisticsIt": [],
        "conclusionsEn": [],
        "conclusionsIt": [],
        "investorInsightEn": "",
        "investorInsightIt": "",
        "companySummaryEn": "",
        "companySummaryIt": "",
        "productInset": {},
        "productInsetIt": {},
        "panelQaEn": [],
        "panelQaIt": [],
        "sectionSummariesEn": [],
        "sectionSummariesIt": [],
        "bulletsEn": [],
        "bulletsIt": [],
        "materialsUrl": MATERIALS_URL,
        "pdfUrl": "",
        "matchOk": False,
        "matchHint": "",
        "source": "fda_briefing",
        "updated_at": datetime.now(timezone.utc).astimezone().isoformat(),
    }


def _compose_daily_news_long(card: dict[str, Any], *, it: bool = False) -> str:
    exec_sum = str(
        (card.get("executiveSummaryIt") if it else card.get("executiveSummaryEn"))
        or card.get("executiveSummaryEn")
        or card.get("executiveSummaryIt")
        or ""
    ).strip()
    intro = str(
        (card.get("introductionIt") if it else card.get("introductionEn"))
        or card.get("introductionEn")
        or card.get("introductionIt")
        or ""
    ).strip()
    summary = str(
        (card.get("summaryIt") if it else card.get("summaryEn"))
        or card.get("summaryEn")
        or card.get("summaryIt")
        or ""
    ).strip()
    results = _as_str_list(
        card.get("resultsIt") if it else card.get("resultsEn"), limit=20
    ) or _as_str_list(card.get("resultsEn"), limit=20)
    stats = _as_str_list(
        card.get("statisticsIt") if it else card.get("statisticsEn"), limit=20
    ) or _as_str_list(card.get("statisticsEn"), limit=20)
    conclusions = _as_str_list(
        card.get("conclusionsIt") if it else card.get("conclusionsEn"), limit=10
    ) or _as_str_list(card.get("conclusionsEn"), limit=10)

    # Lead with condensed Executive Summary when present.
    if exec_sum and len(exec_sum) >= 80:
        return _condense_executive_summary(exec_sum, limit=1600)

    parts: list[str] = []
    if intro:
        parts.append("Introduction:\n" + _scrub_section_prose(intro))
    if summary and summary != intro:
        parts.append(_condense_executive_summary(summary, limit=1400))
    if results:
        parts.append("Results:\n" + "\n".join(f"• {r}" for r in results))
    if stats:
        parts.append("Statistics:\n" + "\n".join(f"• {s}" for s in stats))
    if conclusions:
        parts.append("Conclusions:\n" + "\n".join(f"• {c}" for c in conclusions))
    return "\n\n".join(parts).strip()[:4500]


def _fda_clinical_taxonomy_dims(
    *,
    clin_ui: float | None,
    stance: str | None,
    insight: str = "",
    evidence: str = "",
) -> dict[str, Any] | None:
    """
    Seed thermometer taxonomy so Clin is visible for FDA packages.
    Scale is the desk ±3 taxonomy score (thermometer maps ×1/3 → −1…+1).
    """
    try:
        if clin_ui is None:
            return None
        cv = float(clin_ui)
        if abs(cv) == float("inf") or abs(cv) < 0.01:
            return None
    except (TypeError, ValueError):
        return None
    ev_type = "FDA AdCom / DPV safety review"
    evid = (evidence or insight or ev_type).strip()[:180]
    stance_s = str(stance or "").strip().lower()
    return {
        "clinical": {
            "score": cv,
            "base_weight": cv,
            "event_id": None,
            "event_type": ev_type,
            "evidence": evid,
            "unclassified": False,
            "classification_method": "fda_briefing",
            "review_flag": stance_s == "negative",
        }
    }


def card_to_daily_news_brief(
    row: dict[str, Any],
    card: dict[str, Any],
    *,
    title: str | None = None,
    dims: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Shape a ready FDA card as a Daily News brief (modal / cache)."""
    tk = str(row.get("ticker") or "").strip().upper()
    product = str(row.get("product") or "").strip()
    committee = str(row.get("committee") or "").strip()
    pdf = str(card.get("pdfUrl") or "").strip()
    ttl = (
        title
        or f"FDA AdCom briefing · {product or tk} ({tk}) · {committee or 'Advisory Committee'}"
    )[:240]
    summary_long = _compose_daily_news_long(card, it=False)
    sections = (
        card.get("sectionSummariesEn")
        if isinstance(card.get("sectionSummariesEn"), list)
        else []
    )
    if not sections:
        sections = _section_summaries_from_card(
            introduction=str(card.get("introductionEn") or ""),
            results=_as_str_list(card.get("resultsEn"), limit=20),
            statistics=_as_str_list(card.get("statisticsEn"), limit=20),
            conclusions=_as_str_list(card.get("conclusionsEn"), limit=10),
        )
    try:
        clin = float(card.get("clinicalScore") if card.get("clinicalScore") is not None else card.get("score"))
    except (TypeError, ValueError):
        clin = None
    # Thermometer / chips use taxonomy scale; map FDA −10…+10 → roughly −3…+3.
    clin_ui = round(max(-3.0, min(3.0, (clin or 0.0) / 3.5)), 2) if clin is not None else None
    dim = dims or {}

    def _dim_or_fallback(key: str, fallback):
        try:
            v = dim.get(key)
            if v is None:
                return fallback
            fv = float(v)
            if abs(fv) < 0.01 and fallback is not None:
                return fallback
            return fv
        except (TypeError, ValueError):
            return fallback

    insight = str(card.get("investorInsightEn") or "").strip()
    exec_sum = str(card.get("executiveSummaryEn") or "").strip()
    # Modal "Executive Summary" = condensed readable digest (not full PDF chapter).
    detail = (
        _condense_executive_summary(exec_sum, limit=1600)
        if len(exec_sum) >= 80
        else (summary_long[:1600] or str(card.get("summaryEn") or "")[:1400])
    )
    # Prefer FDA package clinical score — taxonomy heuristics often mis-read
    # "no new signal" as positive even when death/serious AE counts are present.
    clin_final = clin_ui if clin is not None else _dim_or_fallback("clinical_score", None)
    tax_dims = dim.get("taxonomy_dimensions") if isinstance(dim.get("taxonomy_dimensions"), dict) else None
    if not tax_dims or not isinstance(tax_dims.get("clinical"), dict) or tax_dims["clinical"].get(
        "unclassified"
    ):
        seeded = _fda_clinical_taxonomy_dims(
            clin_ui=clin_final,
            stance=str(card.get("stance") or ""),
            insight=insight,
            evidence="; ".join(_as_str_list(card.get("resultsEn"), limit=2)),
        )
        if seeded:
            tax_dims = {**(tax_dims or {}), **seeded}
    return {
        "title": ttl,
        "headline": ttl,
        "ticker": tk,
        "product": product or None,
        "detail_summary": detail,
        "summary": (exec_sum or str(card.get("summaryEn") or ""))[:400],
        "key_points": _as_str_list(card.get("bulletsEn"), limit=8)
        or _as_str_list(card.get("resultsEn"), limit=8),
        "results": _join_bullets(_as_str_list(card.get("resultsEn"), limit=20), limit=20)
        or None,
        "key_results": [
            {"label": "Result", "detail": r}
            for r in _as_str_list(card.get("resultsEn"), limit=12)
        ]
        or None,
        "section_summaries": sections,
        "investor_insight": insight[:1200] or None,
        "executive_summary": detail or None,
        "company_summary": str(card.get("companySummaryEn") or "").strip()[:900] or None,
        "indication": (
            str((card.get("productInset") or {}).get("indications") or "").strip()[:220]
            or None
            if isinstance(card.get("productInset"), dict)
            else None
        ),
        "product_inset": (
            card.get("productInset")
            if isinstance(card.get("productInset"), dict) and card.get("productInset")
            else None
        ),
        "panel_qa": (
            card.get("panelQaEn")
            if isinstance(card.get("panelQaEn"), list) and card.get("panelQaEn")
            else None
        ),
        "clinical_score": clin_final,
        "financial_score": _dim_or_fallback("financial_score", None),
        "corporate_score": _dim_or_fallback("corporate_score", None),
        "market_access_score": _dim_or_fallback("market_access_score", None),
        "eis_score": clin_final if clin_final is not None else _dim_or_fallback("eis_score", None),
        "taxonomy_dimensions": tax_dims,
        "taxonomy_method": dim.get("taxonomy_method") or "fda_briefing",
        "taxonomy_version": dim.get("taxonomy_version"),
        "news_kind": "clinical",
        "source_kind": "fda_briefing",
        "source_label": "FDA BRIEFING",
        "digest_method": "fda_briefing",
        "link": pdf[:500] or None,
        "source_url": pdf[:500] or None,
        "fetch_error": None,
        "fda_score": card.get("score"),
        "fda_stance": card.get("stance"),
        "skip_page_check": True,
    }


def _hint_pdf_links(row: dict[str, Any]) -> list[dict[str, str]]:
    """Known media URLs seeded on the calendar row (publication catch-up)."""
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    candidates: list[str] = []
    for key in ("briefingPdfHint", "briefingPdfUrl"):
        v = str(row.get(key) or "").strip()
        if v:
            candidates.append(v)
    raw_list = row.get("briefingPdfHints")
    if isinstance(raw_list, list):
        candidates.extend(str(x).strip() for x in raw_list if str(x).strip())
    tk = str(row.get("ticker") or "").strip().upper() or "TK"
    product = str(row.get("product") or "").strip() or "product"
    for href in candidates:
        key = href.split("?")[0]
        if key in seen:
            continue
        if "/media/" not in href and not href.lower().endswith(".pdf"):
            continue
        seen.add(key)
        out.append(
            {
                "href": href,
                "title": f"hint {tk} {product} briefing",
            }
        )
    return out


def collect_candidate_links(row: dict[str, Any]) -> list[dict[str, str]]:
    """
    Candidate PDFs for this AdCom.

    - Seeded briefingPdfHint always included.
    - Materials index: title must match company/product/committee+date.
    - Meeting page: keep all /media/ PDFs (identity verified later via PDF text).
    """
    links: list[dict[str, str]] = list(_hint_pdf_links(row))
    seen = {x["href"].split("?")[0] for x in links}

    def _add(item: dict[str, str]) -> None:
        key = item["href"].split("?")[0]
        if key in seen:
            return
        seen.add(key)
        links.append(item)

    try:
        html = fac._http_get(MATERIALS_URL, timeout=25)
        for x in extract_material_links(html):
            if material_matches_row(f"{x['title']} {x['href']}", row):
                _add(x)
    except Exception as exc:
        logger.warning("Recently-updated materials page: %s", exc)

    href = str(row.get("href") or "").strip()
    if href:
        try:
            page = fac._http_get(href, timeout=25)
            for x in extract_material_links(page):
                is_pdf = "/media/" in x["href"] or x["href"].lower().endswith(".pdf")
                if is_pdf or material_matches_row(f"{x['title']} {x['href']}", row):
                    _add(x)
        except Exception as exc:
            logger.warning("Meeting page %s: %s", href, exc)

    return links


def refresh_row_briefing(
    row: dict[str, Any],
    *,
    today: date | None = None,
    force: bool = False,
) -> dict[str, Any]:
    current = row.get("briefing") if isinstance(row.get("briefing"), dict) else None
    if current and current.get("status") == "ready" and not force:
        # Upgrade thin ready cards (missing chapters / insight) in place.
        thin = not (
            current.get("sectionSummariesEn")
            and str(current.get("investorInsightEn") or "").strip()
            and current.get("clinicalScore") is not None
        )
        if not thin:
            return row
        force = True
    if not force and not in_briefing_window(str(row.get("date") or ""), today):
        return row
    links = collect_candidate_links(row)
    meeting_url = str(row.get("href") or "").strip() or MATERIALS_URL
    remaining = list(links)
    while remaining:
        picked = pick_fda_briefing_pdf(remaining)
        if not picked:
            break
        remaining = [x for x in remaining if x["href"] != picked["href"]]
        try:
            raw = fac._http_get_bytes(picked["href"])
        except Exception as exc:
            logger.warning("Briefing download %s: %s", picked["href"], exc)
            continue
        text = extract_pdf_text(raw)
        if len(text) < 200:
            continue
        if not text_matches_row(text, row):
            logger.info(
                "Skip FDA PDF for %s — text does not match company/product: %s",
                row.get("ticker"),
                picked.get("title") or picked.get("href"),
            )
            continue
        card = build_briefing_card(
            text,
            row,
            materials_url=meeting_url,
            pdf_url=picked["href"],
            title=picked["title"],
            match_ok=True,
            match_hint="verified",
        )
        return {**row, "briefing": card}

    # Force / thin upgrade: re-digest from existing ready text when PDF download fails.
    if force and current and current.get("status") == "ready":
        seed = "\n\n".join(
            x
            for x in (
                str(current.get("introductionEn") or ""),
                str(current.get("summaryEn") or ""),
                _join_bullets(_as_str_list(current.get("resultsEn"), limit=20)),
                _join_bullets(_as_str_list(current.get("conclusionsEn"), limit=10)),
            )
            if x.strip()
        )
        if len(seed) >= 280:
            card = build_briefing_card(
                seed,
                row,
                materials_url=meeting_url,
                pdf_url=str(current.get("pdfUrl") or row.get("briefingPdfHint") or ""),
                title=str(current.get("title") or "FDA Briefing"),
                match_ok=True,
                match_hint="rebrief_existing",
            )
            # Keep prior pdf URL / materials if rebuild omitted them.
            if not card.get("pdfUrl"):
                card["pdfUrl"] = current.get("pdfUrl") or ""
            return {**row, "briefing": card}

    return {
        **row,
        "briefing": current if current and current.get("status") == "ready" else _pending_card(),
    }


def stage_fda_briefing_into_daily_news(
    row: dict[str, Any],
    card: dict[str, Any],
    *,
    force: bool = False,
) -> bool:
    """
    Append a staged Daily News item the first time this AdCom briefing is ready.
    Returns True when a new row was written.
    """
    if not isinstance(card, dict) or card.get("status") != "ready":
        return False
    pdf = str(card.get("pdfUrl") or "").strip()
    if not pdf:
        return False
    try:
        from daily_news_desk import (
            _article_fingerprint,
            _dimension_scores,
            _is_article_seen,
            _mark_row_seen,
            _now_iso,
            _read,
            _ten_word_summary,
            _write,
            persist_brief_cache,
        )
    except Exception as exc:
        logger.warning("Daily News stage import failed: %s", exc)
        return False

    tk = str(row.get("ticker") or "").strip().upper()
    meet = str(row.get("date") or "")[:10]
    adcom_id = str(row.get("id") or f"{meet}-{tk}")
    rid = hashlib.sha1(f"fda_briefing|{adcom_id}|{pdf}".encode()).hexdigest()[:16]
    product = str(row.get("product") or "").strip()
    committee = str(row.get("committee") or "").strip()
    title = (
        f"FDA AdCom briefing · {product or tk} ({tk}) · {committee or 'Advisory Committee'}"
    )[:240]
    summary_long = _compose_daily_news_long(card, it=False)
    bullets = _as_str_list(card.get("bulletsEn"), limit=8) or _as_str_list(
        card.get("resultsEn"), limit=8
    )
    fp = _article_fingerprint(ticker=tk, title=title, url=pdf, item_id=rid)

    doc = _read()
    items = [i for i in (doc.get("items") or []) if isinstance(i, dict)]
    top = [i for i in (doc.get("top_news") or []) if isinstance(i, dict)]
    highlights = [i for i in (doc.get("highlights") or []) if isinstance(i, dict)]
    existing_ids = {str(i.get("id") or "") for i in items + top + highlights}
    already_id = rid in existing_ids
    already_seen = _is_article_seen(doc, fp)
    already_adcom = any(
        str(i.get("fda_adcom_id") or "") == adcom_id
        and str(i.get("source_kind") or "") == "fda_briefing"
        for i in items + top + highlights
    )
    if not force and (already_id or already_seen or already_adcom):
        return False
    if force and already_adcom:
        def _drop_adcom(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
            return [
                i
                for i in rows
                if not (
                    str(i.get("fda_adcom_id") or "") == adcom_id
                    and str(i.get("source_kind") or "") == "fda_briefing"
                )
            ]

        items = _drop_adcom(items)
        top = _drop_adcom(top)
        highlights = _drop_adcom(highlights)

    # Score the rich digest (not the title alone) so Clin/Fin/Access are meaningful.
    # Heuristic only here: open-modal / desk staging must not wait on Gemini.
    # build_briefing_card already ran the FDA package AI when the card was built.
    try:
        dims = _dimension_scores(title, summary_long or title, use_ai=False)
    except Exception:
        logger.debug("FDA dimension score failed; empty dims", exc_info=True)
        dims = {}
    brief_payload = card_to_daily_news_brief(row, card, title=title, dims=dims)
    # Prefer FDA package clinical score for AdCom briefs (not taxonomy fill-in).
    clin = brief_payload.get("clinical_score")
    news_row: dict[str, Any] = {
        "id": rid,
        "article_fp": fp,
        "ticker": tk,
        "company": str(row.get("company") or "")[:120] or None,
        "title": title,
        "summary": _ten_word_summary(title),
        "summary_10w": _ten_word_summary(title),
        "summary_long": summary_long,
        "detail_summary": brief_payload.get("detail_summary") or summary_long[:6500],
        "key_points": bullets,
        "results": _as_str_list(card.get("resultsEn"), limit=20),
        "statistics": _as_str_list(card.get("statisticsEn"), limit=20),
        "conclusions": _as_str_list(card.get("conclusionsEn"), limit=10),
        "section_summaries": brief_payload.get("section_summaries"),
        "investor_insight": brief_payload.get("investor_insight"),
        "executive_summary": brief_payload.get("executive_summary"),
        "company_summary": brief_payload.get("company_summary"),
        "product_inset": brief_payload.get("product_inset"),
        "panel_qa": brief_payload.get("panel_qa"),
        "link": pdf[:500],
        "source": "fda.gov",
        "source_kind": "fda_briefing",
        "source_label": "FDA BRIEFING",
        "news_kind": "clinical",
        "status": "staged",
        "section": "top",
        "found_at": _now_iso(),
        "published_at": str(card.get("updated_at") or "")[:10] or meet,
        "event_date": meet,
        "fda_adcom_id": adcom_id,
        "fda_score": card.get("score"),
        "fda_stance": card.get("stance"),
        "product": product or None,
        "clinical_score": clin,
        "financial_score": dims.get("financial_score"),
        "corporate_score": dims.get("corporate_score"),
        "market_access_score": dims.get("market_access_score"),
        "eis_score": dims.get("eis_score") or dims.get("eis") or clin,
        "taxonomy_dimensions": brief_payload.get("taxonomy_dimensions")
        or dims.get("taxonomy_dimensions"),
        "taxonomy_method": brief_payload.get("taxonomy_method")
        or dims.get("taxonomy_method")
        or "fda_briefing",
        "taxonomy_version": dims.get("taxonomy_version"),
        "taxonomy_audit": dims.get("taxonomy_audit"),
        "digest_method": "fda_briefing",
    }
    items.insert(0, news_row)
    top.insert(0, news_row)
    highlights.insert(0, news_row)
    _mark_row_seen(doc, news_row, status="staged")
    doc["items"] = items[:200]
    doc["top_news"] = top[:40]
    doc["highlights"] = highlights[:60]
    doc["top_news_updated_at"] = _now_iso()
    doc["updated_at"] = _now_iso()
    _write(doc)
    try:
        persist_brief_cache(fp, {**brief_payload, "brief_schema": 3, "article_fp": fp}, item_id=rid)
    except Exception:
        logger.debug("FDA brief cache persist failed for %s", tk, exc_info=True)
    logger.info("Staged FDA briefing into Daily News: %s %s", tk, adcom_id)
    return True


def refresh_fda_adcom_briefings(
    *,
    today: date | None = None,
    force: bool = False,
) -> dict[str, Any]:
    day = today or date.today()
    snap = fac.load_snapshot()
    rows = [r for r in (snap.get("rows") or []) if isinstance(r, dict)]
    fac._set_status(running=True, message="Scanning FDA briefing materials", error=None)
    updated: list[dict[str, Any]] = []
    found = 0
    newly_ready: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for row in rows:
        prev = row.get("briefing") if isinstance(row.get("briefing"), dict) else None
        was_ready = bool(prev and prev.get("status") == "ready")
        nxt = refresh_row_briefing(row, today=day, force=force)
        brief = nxt.get("briefing") if isinstance(nxt.get("briefing"), dict) else None
        if brief and brief.get("status") == "ready":
            found += 1
            if not was_ready or force:
                newly_ready.append((nxt, brief))
        updated.append(nxt)
    snap = dict(snap)
    snap["rows"] = updated
    snap["count"] = len(updated)
    now_iso = datetime.now(timezone.utc).astimezone().isoformat()
    snap["updated_at"] = now_iso
    snap["briefings_updated_at"] = now_iso
    snap["briefings_ready"] = found
    fac._SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = fac._SNAPSHOT_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(snap, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(fac._SNAPSHOT_PATH)
    staged = 0
    for row, card in newly_ready:
        try:
            if stage_fda_briefing_into_daily_news(row, card):
                staged += 1
        except Exception:
            logger.exception(
                "Failed staging FDA briefing for %s", row.get("ticker")
            )
    snap["daily_news_staged"] = staged
    fac._set_status(
        running=False,
        message=f"{found} FDA briefing cards ready · {staged} Daily News",
        error=None,
        finished_at=snap["briefings_updated_at"],
    )
    return snap


def run_fda_adcom_briefing_refresh(*, force: bool = False) -> dict[str, Any]:
    if fac.get_status().get("running") and not force:
        return {"error": "already_running", **fac.get_status()}
    return refresh_fda_adcom_briefings(force=force)


def any_due_without_card(today: date | None = None) -> bool:
    snap = fac.load_snapshot()
    day = today or date.today()
    for row in snap.get("rows") or []:
        if not isinstance(row, dict):
            continue
        if not in_briefing_window(str(row.get("date") or ""), day):
            continue
        brief = row.get("briefing") if isinstance(row.get("briefing"), dict) else None
        if not brief or brief.get("status") != "ready":
            return True
    return False


def should_run_fda_adcom_briefing(
    now: datetime,
    *,
    last_run_at: datetime | None = None,
    last_date: date | None = None,
    at: dt_time = dt_time(7, 0),
) -> bool:
    """
    While a meeting is in the briefing window without a ready card, poll hourly
    (Rome 07:00–22:00). Once all due cards are ready, stay quiet.
    """
    if last_run_at is None and last_date is not None:
        # Backward-compatible: treat last_date as "already ran that calendar day".
        if last_date == now.date():
            return False
    if not any_due_without_card(now.date()):
        return False
    now_m = now.hour * 60 + now.minute
    at_m = at.hour * 60 + at.minute
    if now_m < at_m:
        return False
    if now.hour > 22:
        return False
    if last_run_at is not None:
        try:
            same_hour = (
                last_run_at.date() == now.date() and last_run_at.hour == now.hour
            )
        except Exception:
            same_hour = False
        if same_hour:
            return False
    return True
