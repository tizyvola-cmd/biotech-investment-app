"""Backfill FDA AdCom briefings (last ~3 weeks tracked names) into Daily News."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import fda_adcom_briefing as fab
import fda_adcom_calendar as fac

ROOT = Path(__file__).resolve().parents[1]
TEXT_DIR = ROOT / "data" / "fda_briefing_texts"
AGENT = Path(
    r"C:\Users\tizyv\.cursor\projects\c-coding-Biotech-Investment-app-6\agent-tools"
)

# Tracked AdComs with published briefing PDFs (Sep 2026 window).
JOBS: list[dict] = [
    {
        "id": "2026-09-23-GRAL",
        "pdf": "https://www.fda.gov/media/194909/download",
        "title": "MCGP Sept. 23, 2026 FDA Executive Summary — Galleri",
        "text_files": [
            AGENT / "d0cc8882-b0de-4507-aed3-8b3aa95db009.txt",
            TEXT_DIR / "2026-09-23-GRAL-fda.txt",
        ],
    },
    {
        "id": "2026-09-16-GILD",
        "pdf": "https://www.fda.gov/media/194287/download",
        "title": "PAC Sep 16 2026 — Veklury pediatric postmarketing review (GILD)",
        "text_files": [
            AGENT / "2a5ecf94-fdda-4e35-b453-1f3dd074ca07.txt",
            TEXT_DIR / "2026-09-16-GILD-veklury.txt",
        ],
        "extra_text": """

Also PAC Vemlidy (tenofovir alafenamide) review for Gilead same meeting:
No new pediatric safety concerns; FAERS 4 serious US pediatric reports all excluded (transplacental); fatal N=0; continue routine pharmacovigilance.
PDF: https://www.fda.gov/media/194288/download
""",
    },
    {
        "id": "2026-09-16-AMGN",
        "pdf": "https://www.fda.gov/media/194269/download",
        "title": "PAC Sep 16 2026 — Aranesp pediatric postmarketing review (AMGN)",
        "inline": """Pediatric Postmarketing Pharmacovigilance Review — Aranesp (darbepoetin alfa)
Applicant: Amgen, Inc. · BLA 103951 · PAC September 16, 2026 · Review Dec 22, 2025

EXECUTIVE SUMMARY: DPV did not identify any new pediatric safety concerns for darbepoetin alfa and will continue routine pharmacovigilance. First presentation to PAC.

Results / statistics:
- FAERS Jan 21, 2015 through Jun 3, 2025: 94 U.S. serious pediatric reports (<17y), including 60 deaths; all excluded (duplicate, labeled AE, comorbidities, unassessable/trial aggregates without patient-level causality).
- Fatal cases for discussion: N=0
- Serious non-fatal cases for discussion: N=0
- No new safety signals; no increased severity of labeled AEs; no deaths directly associated after review.

Indication context: anemia due to CKD (dialysis and non-dialysis) including pediatric 1 month–16 years; cancer chemotherapy anemia (pediatric efficacy not established).
""",
    },
    {
        "id": "2026-09-16-VCEL",
        "pdf": "https://www.fda.gov/media/194305/download",
        "title": "PAC Sep 16 2026 — Epicel annual safety update (VCEL)",
        "text_files": [
            AGENT / "10f5fcf5-45f2-4008-bcf7-c9acf4af5b40.txt",
            TEXT_DIR / "2026-09-16-VCEL.txt",
        ],
    },
    {
        "id": "2026-09-16-ICU",
        "pdf": "https://www.fda.gov/media/194306/download",
        "title": "PAC Sep 16 2026 — Quelimmune safety/utilization review (ICU)",
        "inline": """Safety and Utilization Review for PAC — QUELIMMUNE (SeaStar Medical / ICU)
Meeting Date: September 16, 2026

SUMMARY: FDA did not identify new safety signals during this postmarketing safety review (annual report, PAS, literature). No MDRs July 1, 2025–June 30, 2026. HDE remains appropriate. Continue routine monitoring.

Results:
- Zero MDRs in MAUDE during review period
- Annual report: zero device-related events among treated patients
- PAS registry sample size revised 300→50; top-line report 50 patients through Day 28
- Literature: one relevant article; no new safety concern; no device-related infections in early RWE
- ADN not exceeded; no safety-related label changes
""",
    },
    {
        "id": "2026-09-16-PROF",
        "pdf": "https://www.fda.gov/media/194295/download",
        "title": "PAC Sep 16 2026 — Sonalleve MR-HIFU FDA executive summary (PROF)",
        "inline": """FDA Executive Summary — Sonalleve MR-HIFU System (H190003) Profound Medical / PROF
PAC Fall 2026

SUMMARY: Probable benefit continues to outweigh risk for osteoid osteomas in extremities. Continue surveillance; report ADN/literature/MDR to PAC in 2027.

Results / statistics:
- Premarket feasibility n=9; 16 AEs, no serious AEs; VAS median 6→0 by day 28 (P<0.01); 8/9 off NSAIDs; PROs improved P=0.0002
- Post-market pivotal n=15 patients / 17 treatments; no serious or unanticipated device-related AEs
- ADN maximum 20; no additional commercial devices shipped since HDE approval
- One EU MDR (tendon rupture ~6 weeks post Rx; uncertain relatedness); no significant change to benefit-risk
- Literature: no new Sonalleve-specific pediatric safety signals
""",
    },
    {
        "id": "2026-09-16-KIDS",
        "pdf": "https://www.fda.gov/media/194303/download",
        "title": "PAC Sep 16 2026 — MID-C System HDE executive summary (KIDS)",
        "inline": """FDA PAC Executive Summary — Minimally Invasive Deformity Correction (MID-C) System HDE H170001
OrthoPediatrics / KIDS · September 16, 2026 Pediatric Advisory Committee

SUMMARY: FDA post-market pediatric HDE safety update for MID-C (ApiFix) scoliosis correction. Document is the standard PAC HDE executive summary covering ADN, MDR, literature, and labeling for ongoing surveillance.

Note: Full PDF binary was not text-extractable in this backfill environment; staging uses the official FDA media link for the Sep 16 2026 PAC briefing package. Review focuses on continued postmarket safety monitoring of the pediatric HDE population.
""",
    },
    {
        "id": "2026-09-16-INVA",
        "pdf": "https://www.fda.gov/media/194291/download",
        "title": "PAC Sep 16 2026 — Zevtera pediatric postmarketing review (INVA)",
        "inline": """Pediatric Postmarketing Pharmacovigilance Review — Zevtera (ceftobiprole medocaril sodium)
Innoviva royalty product / INVA · PAC Sep 16 2026 · Review May 28 2026

EXECUTIVE SUMMARY: No new pediatric safety concerns; continue routine pharmacovigilance.

Results: FAERS Apr 3 2024–Apr 7 2026 zero U.S. serious pediatric reports; fatal N=0; non-fatal N=0; no new signals.
CABP indication includes pediatric patients 3 months to <18 years.
""",
    },
    {
        "id": "2026-09-16-LGND",
        "pdf": "https://www.fda.gov/media/194289/download",
        "title": "PAC Sep 16 2026 — Zelsuvmi pediatric postmarketing review (LGND)",
        "inline": """Pediatric Postmarketing Pharmacovigilance Review — Zelsuvmi (berdazimer sodium)
Ligand royalty (commercial PTHS) / LGND · PAC Sep 16 2026 · Review Apr 20 2026

EXECUTIVE SUMMARY: No new pediatric safety concerns for berdazimer; continue routine pharmacovigilance. First PAC presentation.

Results: FAERS Jan 5 2024–Jan 26 2026 U.S. serious pediatric reports: zero. Indication: molluscum contagiosum adults and pediatrics ≥1 year.
""",
    },
]


def load_text(job: dict) -> str:
    chunks: list[str] = []
    for p in job.get("text_files") or []:
        path = Path(p)
        if path.is_file():
            raw = path.read_text(encoding="utf-8", errors="replace")
            if raw.count("\n") >= 3 and len(raw) > 400:
                chunks.append(raw[:60_000])
    if job.get("inline"):
        chunks.append(str(job["inline"]))
    if job.get("extra_text"):
        chunks.append(str(job["extra_text"]))
    return "\n\n".join(chunks).strip()


def main() -> None:
    # Force heuristic path for deterministic offline backfill (AI optional).
    fab.score_briefing_with_ai = lambda *a, **k: None  # type: ignore

    snap = fac.load_snapshot()
    by_id = {str(r.get("id")): dict(r) for r in (snap.get("rows") or []) if isinstance(r, dict)}
    staged = 0
    ready = 0
    for job in JOBS:
        rid = job["id"]
        row = by_id.get(rid)
        if not row:
            print("MISSING ROW", rid)
            continue
        text = load_text(job)
        if len(text) < 200:
            print("NO TEXT", rid)
            continue
        row["briefingPdfHint"] = job["pdf"]
        card = fab.build_briefing_card(
            text,
            row,
            materials_url=str(row.get("href") or fab.MATERIALS_URL),
            pdf_url=job["pdf"],
            title=job["title"],
            match_ok=True,
            match_hint="backfill_3w",
        )
        by_id[rid] = {**row, "briefing": card}
        ready += 1
        if fab.stage_fda_briefing_into_daily_news(by_id[rid], card, force=True):
            staged += 1
            print("STAGED", rid, row.get("ticker"), "score", card.get("score"))
        else:
            print("CARD OK (news exists)", rid, row.get("ticker"))

    rows = list(by_id.values())
    # Keep snapshot order roughly by date/ticker
    rows.sort(key=lambda r: (str(r.get("date") or ""), str(r.get("ticker") or "")))
    snap["rows"] = rows
    snap["count"] = len(rows)
    snap["briefings_ready"] = sum(
        1
        for r in rows
        if isinstance(r.get("briefing"), dict) and r["briefing"].get("status") == "ready"
    )
    now = datetime.now(timezone.utc).astimezone().isoformat()
    snap["briefings_updated_at"] = now
    snap["updated_at"] = now
    snap["daily_news_staged"] = staged
    fac._SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = fac._SNAPSHOT_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(snap, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(fac._SNAPSHOT_PATH)
    print(
        "DONE ready=",
        ready,
        "staged=",
        staged,
        "briefings_ready=",
        snap["briefings_ready"],
    )


if __name__ == "__main__":
    main()
