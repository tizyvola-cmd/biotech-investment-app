"""Rebuild GRAL Galleri FDA staff briefing with company/product + panel Q&A."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import fda_adcom_briefing as fab
import fda_adcom_calendar as fac

TEXT = Path(
    r"C:\Users\tizyv\.cursor\projects\c-coding-Biotech-Investment-app-6\agent-tools"
    r"\d0cc8882-b0de-4507-aed3-8b3aa95db009.txt"
)


def main() -> int:
    if not TEXT.exists():
        print("missing text", TEXT)
        return 1
    text = TEXT.read_text(encoding="utf-8", errors="replace")
    snap = fac.load_snapshot()
    rows = [r for r in (snap.get("rows") or []) if isinstance(r, dict)]
    gral = next((r for r in rows if str(r.get("id") or "") == "2026-09-23-GRAL"), None)
    if not gral:
        gral = {
            "id": "2026-09-23-GRAL",
            "date": "2026-09-23",
            "ticker": "GRAL",
            "company": "GRAIL, Inc.",
            "product": "Galleri",
            "committee": "Molecular and Clinical Genetics Panel",
            "briefingPdfHint": "https://www.fda.gov/media/194909/download",
            "href": (
                "https://www.fda.gov/advisory-committees/advisory-committee-calendar/"
                "september-23-2026-molecular-and-clinical-genetics-panel-medical-devices-"
                "advisory-committee-meeting"
            ),
        }
        rows.append(gral)

    pdf = str(gral.get("briefingPdfHint") or "https://www.fda.gov/media/194909/download")
    try:
        import ai_provider

        ai_ok = ai_provider.is_available()
    except Exception:
        ai_ok = False
    print("building card text_len", len(text), "ai", "yes" if ai_ok else "no")

    card = fab.build_briefing_card(
        text,
        gral,
        materials_url=str(gral.get("href") or fab.MATERIALS_URL),
        pdf_url=pdf,
        title="FDA Executive Summary — Galleri (MCGP Sept 23, 2026)",
        match_ok=True,
        match_hint="seeded_fda_staff_text",
    )
    nxt = {**gral, "briefing": card}
    out = []
    found = False
    for r in rows:
        if str(r.get("id") or "") == "2026-09-23-GRAL":
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
    qa = card.get("panelQaEn") or []
    brief = fab.card_to_daily_news_brief(nxt, card)
    print(
        "score",
        card.get("score"),
        "clin",
        card.get("clinicalScore"),
        "stance",
        card.get("stance"),
        "clin_ui",
        brief.get("clinical_score"),
    )
    print("company_len", len(str(card.get("companySummaryEn") or "")))
    print("moa_len", len(str((card.get("productInset") or {}).get("moa") or "")))
    print("panel_qa", len(qa), [q.get("id") for q in qa])
    for q in qa:
        print(" ", q.get("id"), "ans_len", len(str(q.get("answer") or "")))
    print("insight_len", len(str(card.get("investorInsightEn") or "")))
    print("staged", staged)
    return 0


if __name__ == "__main__":
    sys.exit(main())
