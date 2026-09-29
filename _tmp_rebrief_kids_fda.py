"""Rebuild KIDS ApiFix MID-C PAC briefing from known FDA exec summary text."""
from __future__ import annotations

import json
import sys

import fda_adcom_briefing as fab
import fda_adcom_calendar as fac

KIDS_TEXT = """
FDA Executive Summary — Prepared for the Pediatric Advisory Committee
Minimally Invasive Deformity Correction (MID-C) System (H170001) — ApiFix / OrthoPediatrics (KIDS)

I. INTRODUCTION
In accordance with the Pediatric Medical Device Safety and Improvement Act, this review
provides a safety update based on the post-market experience with the use of the Minimally
Invasive Deformity Correction System ("MID-C") from ApiFix, Ltd. in pediatric patients since
approval in 2019. The purpose is to provide the Pediatric Advisory Committee (PAC) with
post-market safety data so the committee can advise FDA on whether there are any new safety
concerns and whether the Humanitarian Device Exemption (HDE) remains appropriate for
pediatric use. Sources: sponsor Annual Report, MDR adverse events, peer-reviewed literature,
and Post-Approval Study (PAS) data.

II. INDICATIONS FOR USE
The MID-C System is indicated for adolescent idiopathic scoliosis (AIS) — Lenke 1 or Lenke 5
curves, Cobb angle 35 to 60 degrees reducing to ≤30 degrees on side-bending, thoracic kyphosis
<55 degrees (T5–T12). Non-fusion internal brace (ratchet expandable rod).

VII. POST-APPROVAL STUDY (PAS)
PAS objective: ongoing safety and probable benefit. Enrollment complete: N=201 patients.
Estimated 84 months from PAS approval. Within the PAS, 159 adverse events were reported in
102 patients. Reoperation rate increased over time: 15% (48-month report) → 22% (60-month)
→ 32% (72-month report). Average follow-up 37 months. Of 79 reoperations, 68 (86%) were
device-related; 20 (25%) revisions to a new MID-C system and 21 (27%) involved removal of
the MID-C system.

VIII. ADVERSE EVENTS / MDR
As of October 1, 2025, 304 worldwide MDRs related to ApiFix MID-C since HDE approval.
Cumulative MDR rate: 27.97% worldwide (304/1087) and 30.30% in the US (120/396), most
resulting in reoperation — higher than the SSPB AE rate at HDE approval (12.2% US / 17.9%
worldwide) and higher than typical fusion reoperation benchmarks, but FDA states this does not
appear to present a new safety signal at this time and will be closely monitored.
Tissue discoloration reported in some MDRs (possible metallosis sign) is not unanticipated for
metallic implants with ADLC coatings and does not appear harmful based on available data;
additional monitoring continues (396 US subjects implanted; limited long-term follow-up).

IX. SUMMARY / CONCLUSIONS
Evaluation of HDE 6-year Annual Report, MDRs, literature, and sponsor correspondence has
identified no new safety signals compared with what was known at HDE approval (August 2019).
Design changes and surgical technique updates since approval were intended to mitigate early
known AEs. Based on available data, considering probable benefits (including avoidance of
definitive fusion) and risks, FDA believes the HDE remains appropriately approved for pediatric
use. FDA recommends continued surveillance and will report ADN, literature, MDR, and PAS
updates to the PAC in 2027.
"""


def main() -> int:
    snap = fac.load_snapshot()
    rows = [r for r in (snap.get("rows") or []) if isinstance(r, dict)]
    kids = next((r for r in rows if str(r.get("id") or "") == "2026-09-16-KIDS"), None)
    if not kids:
        kids = {
            "id": "2026-09-16-KIDS",
            "date": "2026-09-16",
            "ticker": "KIDS",
            "company": "OrthoPediatrics Corp.",
            "product": "MID-C / ApiFix",
            "committee": "Pediatric Advisory Committee",
            "briefingPdfHint": "https://www.fda.gov/media/194303/download",
        }
        rows.append(kids)

    pdf = str(kids.get("briefingPdfHint") or "https://www.fda.gov/media/194303/download")
    card = fab.build_briefing_card(
        KIDS_TEXT,
        kids,
        materials_url=str(kids.get("href") or fab.MATERIALS_URL),
        pdf_url=pdf,
        title="FDA Executive Summary — MID-C / ApiFix (PAC)",
        match_ok=True,
        match_hint="seeded_text",
    )
    nxt = {**kids, "briefing": card}
    out = []
    found = False
    for r in rows:
        if str(r.get("id") or "") == "2026-09-16-KIDS":
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
