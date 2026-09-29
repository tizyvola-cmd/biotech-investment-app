"""Rebuild LGND Zelsuvmi FDA briefing with full Executive Summary + structured Investor Insight."""
from __future__ import annotations

import json
import sys

import fda_adcom_briefing as fab
import fda_adcom_calendar as fac

LGND_TEXT = """
Pediatric Postmarketing Pharmacovigilance Review
Date: April 20, 2026
Product Name: Zelsuvmi (berdazimer sodium) topical gel
Pediatric Labeling Approval Date: January 5, 2024
Application Type/Number: NDA 217424
Applicant: LNHC, Inc.

TABLE OF CONTENTS
Executive Summary ... 1
1 Introduction ... 2

EXECUTIVE SUMMARY
This review evaluates FDA Adverse Event Reporting System (FAERS) reports for Zelsuvmi
(berdazimer sodium) topical gel in pediatric patients less than 18 years of age. The Division of
Pharmacovigilance (DPV) conducted this review in accordance with the Pediatric Research
Equity Act (PREA). This review focuses on United States (U.S.) serious unlabeled adverse
events associated with berdazimer sodium in pediatric patients.
Zelsuvmi (berdazimer sodium) topical gel is a nitric oxide releasing agent that was initially FDA
approved on January 5, 2024. Berdazimer sodium is currently indicated for the topical treatment
of molluscum contagiosum (MC) in adults and pediatric patients 1 year of age and older.
This pediatric postmarketing safety review was prompted by the pediatric labeling on January 5,
2024, that established the safety and effectiveness of berdazimer sodium for the topical treatment
of MC in pediatric patients 1 year of age and older. The safety and effectiveness of berdazimer
sodium have not been established in pediatric patients younger than 1 year of age.
A pediatric safety review for berdazimer sodium has not previously been presented to the
Pediatric Advisory Committee.
DPV searched FAERS for all U.S. serious reports with berdazimer sodium in pediatric patients
less than 18 years of age from January 5, 2024, through January 26, 2026, and identified no
reports.
DPV did not identify any new pediatric safety concerns for berdazimer sodium at this time and
will continue routine pharmacovigilance monitoring for berdazimer sodium

1 INTRODUCTION
This review evaluates FAERS reports for Zelsuvmi in pediatric patients <18 years.
"""


def main() -> int:
    snap = fac.load_snapshot()
    rows = [r for r in (snap.get("rows") or []) if isinstance(r, dict)]
    lgnd = next((r for r in rows if str(r.get("id") or "") == "2026-09-16-LGND"), None)
    if not lgnd:
        lgnd = {
            "id": "2026-09-16-LGND",
            "date": "2026-09-16",
            "ticker": "LGND",
            "company": "Ligand Pharmaceuticals Incorporated",
            "product": "Zelsuvmi (berdazimer)",
            "committee": "Pediatric Advisory Committee",
            "briefingPdfHint": "https://www.fda.gov/media/194289/download",
        }
        rows.append(lgnd)

    pdf = str(lgnd.get("briefingPdfHint") or "https://www.fda.gov/media/194289/download")
    card = fab.build_briefing_card(
        LGND_TEXT,
        lgnd,
        materials_url=str(lgnd.get("href") or fab.MATERIALS_URL),
        pdf_url=pdf,
        title="Pediatric Postmarketing Pharmacovigilance Review — Zelsuvmi (FDA DPV)",
        match_ok=True,
        match_hint="seeded_text",
    )
    nxt = {**lgnd, "briefing": card}
    out = []
    found = False
    for r in rows:
        if str(r.get("id") or "") == "2026-09-16-LGND":
            out.append(nxt)
            found = True
        else:
            out.append(r)
    if not found:
        out.append(nxt)
    snap = dict(snap)
    snap["rows"] = out
    snap["count"] = len(out)
    fac._SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = fac._SNAPSHOT_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(snap, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(fac._SNAPSHOT_PATH)

    staged = fab.stage_fda_briefing_into_daily_news(nxt, card, force=True)
    print("exec_len", len(card.get("executiveSummaryEn") or ""))
    print("exec_head", (card.get("executiveSummaryEn") or "")[:220])
    print("company", (card.get("companySummaryEn") or "")[:280])
    print("product", card.get("productInset"))
    print("insight", (card.get("investorInsightEn") or "")[:320])
    print("staged", staged)
    return 0


if __name__ == "__main__":
    sys.exit(main())
