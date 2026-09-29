"""Rebuild AMGN Aranesp PAC briefing from known FDA DPV text (local PDF 404 fallback)."""
from __future__ import annotations

import json
import sys

import fda_adcom_briefing as fab
import fda_adcom_calendar as fac

# Extracted from FDA media/194269 (Pediatric Postmarketing Pharmacovigilance Review).
ARANESP_TEXT = """
Pediatric Postmarketing Pharmacovigilance Review — Aranesp (darbepoetin alfa)
Applicant: Amgen, Inc. — BLA 103951 — Pediatric Advisory Committee September 16, 2026
Review Date: December 22, 2025 — Division of Pharmacovigilance I (DPV-I)

EXECUTIVE SUMMARY
This review evaluates FDA Adverse Event Reporting System (FAERS) reports for Aranesp
(darbepoetin alfa) in pediatric patients less than 17 years of age. The Division of
Pharmacovigilance (DPV) conducted this review in accordance with the Best Pharmaceuticals
for Children Act (BPCA). This review focuses on United States (U.S.) serious unlabeled adverse
events associated with darbepoetin alfa in pediatric patients.
Aranesp (darbepoetin alfa) is an erythropoiesis-stimulating agent initially approved in the U.S.
on September 17, 2001. Darbepoetin alfa is currently indicated for the treatment of anemia due to:
Chronic Kidney Disease (CKD) in patients on dialysis and patients not on dialysis; and the effects
of concomitant myelosuppressive chemotherapy.
This pediatric postmarketing safety review was prompted by pediatric labeling on July 23, 2015,
which expanded the use of darbepoetin alfa to include use in pediatric patients 1 month to 16 years
old with CKD receiving or not receiving dialysis. Darbepoetin alfa has not previously been
presented to the Pediatric Advisory Committee.
DPV reviewed all U.S. serious FAERS reports with darbepoetin alfa in pediatric patients less than
17 years of age from January 21, 2015, through June 3, 2025, and identified 94 reports; however,
all reports were excluded from further discussion. There were no new safety signals identified,
no increased severity of any labeled adverse events, and no deaths directly associated with
darbepoetin alfa in pediatric patients less than 17 years of age. DPV did not identify any new
pediatric safety concerns for darbepoetin alfa at this time and will continue routine
pharmacovigilance monitoring for darbepoetin alfa.

1 INTRODUCTION
This review evaluates FAERS reports for Aranesp in pediatric patients <17 years. Focus: U.S.
serious unlabeled adverse events. Boxed warning remains: ESAs increase the risk of death,
myocardial infarction, stroke, venous thromboembolism, thrombosis of vascular access and
tumor progression or recurrence.

3 RESULTS
3.1 SELECTION OF U.S. SERIOUS PEDIATRIC CASES IN FAERS
FAERS search retrieved 94 U.S. serious pediatric reports for patients less than 17 years old from
January 21, 2015, through June 3, 2025, including 60 reports with the outcome of death.
All 94 reports were excluded from the case series (duplicates, labeled events not representing
increased severity, more likely due to concomitant meds/comorbidities, no AE described,
or unassessable including 60 deaths from publications without patient-level data).
After excluding reports, zero cases remained for discussion.
3.2 SUMMARY OF U.S. FATAL PEDIATRIC CASES (N=0)
There are no fatal pediatric adverse event cases for discussion.
3.3 SUMMARY OF U.S. SERIOUS NON-FATAL PEDIATRIC CASES (N=0)
There are no non-fatal pediatric adverse event cases for discussion.

4 DISCUSSION
DPV reviewed all U.S. serious FAERS reports and identified 94 reports; all excluded.
There were no new safety signals identified, no increased severity of any labeled adverse events,
and no deaths directly associated with darbepoetin alfa in pediatric patients less than 17 years of age.

5 CONCLUSION
DPV did not identify any new pediatric safety concerns for darbepoetin alfa at this time and will
continue routine pharmacovigilance monitoring for darbepoetin alfa.
"""


def main() -> int:
    snap = fac.load_snapshot()
    rows = [r for r in (snap.get("rows") or []) if isinstance(r, dict)]
    amgn = next(
        (r for r in rows if str(r.get("id") or "") == "2026-09-16-AMGN"),
        None,
    )
    if not amgn:
        amgn = {
            "id": "2026-09-16-AMGN",
            "date": "2026-09-16",
            "ticker": "AMGN",
            "company": "Amgen Inc.",
            "product": "Aranesp (darbepoetin alfa)",
            "committee": "Pediatric Advisory Committee",
            "briefingPdfHint": "https://www.fda.gov/media/194269/download",
        }
        rows.append(amgn)

    pdf = str(amgn.get("briefingPdfHint") or "https://www.fda.gov/media/194269/download")
    card = fab.build_briefing_card(
        ARANESP_TEXT,
        amgn,
        materials_url=str(amgn.get("href") or fab.MATERIALS_URL),
        pdf_url=pdf,
        title="Pediatric Postmarketing Pharmacovigilance Review — Aranesp (FDA DPV)",
        match_ok=True,
        match_hint="seeded_text",
    )
    nxt = {**amgn, "briefing": card}
    out = []
    found = False
    for r in rows:
        if str(r.get("id") or "") == "2026-09-16-AMGN":
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
    print("score", card.get("score"), "clin", card.get("clinicalScore"), "stance", card.get("stance"))
    print("sections", [s.get("heading") for s in (card.get("sectionSummariesEn") or [])])
    print("insight", (card.get("investorInsightEn") or "")[:240])
    print("summary", (card.get("summaryEn") or "")[:280])
    print("staged", staged)
    return 0


if __name__ == "__main__":
    sys.exit(main())
