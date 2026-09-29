"""Diagnose why hype funnel rejected ABEO (run on VPS)."""
from __future__ import annotations

import json
from datetime import date

from hype_volume_funnel import (
    _default_relation,
    _default_trusted,
    _discover_studies,
    pick_trusted_next_cd,
)

TICKERS = ["ABEO", "ACAD", "ACHV", "ALDX"]


def main() -> None:
    today = date.today()
    out = []
    for tk in TICKERS:
        studies = _discover_studies(tk)
        rec = {
            "ticker": tk,
            "n_studies": len(studies),
            "today": today.isoformat(),
            "studies": [],
        }
        for s in studies[:8]:
            rel = _default_relation(s)
            trusted = _default_trusted(s)
            rec["studies"].append(
                {
                    "nct": s.get("nct_id"),
                    "cd": s.get("completion_date"),
                    "sm": s.get("sponsor_match"),
                    "lead": (s.get("lead_sponsor") or "")[:80],
                    "rel": rel,
                    "trusted": trusted,
                    "rel_ok": rel,
                }
            )
        pick = pick_trusted_next_cd(studies)
        rec["pick"] = None
        if pick:
            rec["pick"] = {
                "nct": (pick.get("row") or {}).get("nct_id"),
                "cd": str(pick.get("cd")),
                "sm": pick.get("sponsor_match"),
                "rel": pick.get("nct_relation_type"),
                "days": pick.get("days_to_cd"),
            }
        out.append(rec)
        print(json.dumps(rec, indent=2, default=str)[:4000])
        print("---")


if __name__ == "__main__":
    main()
