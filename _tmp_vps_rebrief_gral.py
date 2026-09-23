"""VPS: rebuild GRAL Galleri FDA staff briefing."""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, "/opt/biotech")
import fda_adcom_briefing as fab
import fda_adcom_calendar as fac

TEXT = Path("/tmp/galleri_fda_staff.txt")


def main() -> int:
    text = TEXT.read_text(encoding="utf-8", errors="replace")
    snap = fac.load_snapshot()
    rows = [r for r in (snap.get("rows") or []) if isinstance(r, dict)]
    gral = next((r for r in rows if str(r.get("id") or "") == "2026-09-23-GRAL"), None)
    if not gral:
        print("no GRAL row")
        return 1
    pdf = str(gral.get("briefingPdfHint") or "https://www.fda.gov/media/194909/download")
    try:
        import ai_provider

        print("ai", ai_provider.is_available())
    except Exception as e:
        print("ai err", e)
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
    out = [nxt if str(r.get("id") or "") == "2026-09-23-GRAL" else r for r in rows]
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
        "clin_ui",
        brief.get("clinical_score"),
        "stance",
        card.get("stance"),
    )
    print("panel_qa", len(qa), [q.get("id") for q in qa])
    print("company", bool(card.get("companySummaryEn")), "inset", bool(card.get("productInset")))
    print("tax", (brief.get("taxonomy_dimensions") or {}).get("clinical"))
    print("staged", staged)
    # echo snapshot confirmation
    snap2 = json.loads(Path(fac._SNAPSHOT_PATH).read_text(encoding="utf-8"))
    for r in snap2.get("rows") or []:
        if str(r.get("id")) == "2026-09-23-GRAL":
            b = r.get("briefing") or {}
            print(
                "snap_ok",
                b.get("status"),
                "qa",
                len(b.get("panelQaEn") or []),
                "company",
                len(str(b.get("companySummaryEn") or "")),
            )
            break
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
