#!/usr/bin/env python3
"""Audit cross-ticker clinical feed contamination (sponsor_match vs CT.gov title)."""
from __future__ import annotations

import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fetch_edgar import _compute_sponsor_match  # noqa: E402

_SUFFIX = re.compile(r"\b(inc|inc\.|llc|ltd|corp|corporation|company|co|co\.|plc)\b", re.I)


def _norm_words(s: str) -> set[str]:
    t = _SUFFIX.sub("", s.lower())
    t = re.sub(r"[^a-z0-9]+", " ", t)
    return {w for w in t.split() if len(w) >= 4}


def sponsor_ok(sm: str | None) -> bool:
    s = str(sm or "").strip().lower()
    return s in ("exact", "partial", "direct match")


def ctgov_sponsor_from_meta(meta: dict) -> str:
    return str(meta.get("lead_sponsor") or meta.get("sponsor") or "")


def title_mentions_company(title: str, company: str, ticker: str) -> bool:
    tl = title.lower()
    cw = _norm_words(company)
    if cw:
        hits = sum(1 for w in cw if w in tl)
        if hits >= min(2, len(cw)):
            return True
    tk = ticker.strip().upper()
    if len(tk) >= 3 and tk.lower() in tl:
        return True
    return False


def audit_snapshot(path: Path) -> dict:
    raw = json.loads(path.read_text(encoding="utf-8"))
    records = list(raw.get("records") or [])

    bad_sponsor: list[dict] = []
    bad_title: list[dict] = []
    ok_rows: list[dict] = []
    by_ticker: dict[str, list[dict]] = defaultdict(list)

    for rec in records:
        tk = str(rec.get("ticker") or "").upper()
        company = str(rec.get("company") or rec.get("query_company") or tk)
        sm = str(rec.get("sponsor_match") or "")
        meta = rec.get("meta") if isinstance(rec.get("meta"), dict) else {}
        title = str(meta.get("brief_title") or rec.get("brief_title") or "")
        nct = str(rec.get("nct_id") or "")
        lead = ctgov_sponsor_from_meta(meta)
        recomputed = _compute_sponsor_match(company, lead) if lead else "N/D"

        row = {
            "ticker": tk,
            "company": company[:50],
            "nct_id": nct,
            "sponsor_match": sm,
            "recomputed": recomputed,
            "lead_sponsor": lead[:60],
            "title": title[:72],
        }
        by_ticker[tk].append(row)

        if not sponsor_ok(sm):
            bad_sponsor.append(row)
        elif not title_mentions_company(title, company, tk) and lead:
            if not sponsor_ok(recomputed):
                bad_title.append(row)
            else:
                ok_rows.append(row)
        else:
            ok_rows.append(row)

    multi_nct = sorted(
        ((tk, len(rows)) for tk, rows in by_ticker.items() if len(rows) > 1),
        key=lambda x: -x[1],
    )

    return {
        "records": len(records),
        "tickers": len(by_ticker),
        "sponsor_ok": len(ok_rows),
        "sponsor_bad": len(bad_sponsor),
        "title_suspicious": len(bad_title),
        "bad_sponsor": bad_sponsor,
        "bad_title": bad_title,
        "multi_nct": multi_nct[:20],
        "by_ticker": dict(by_ticker),
    }


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Sponsor contamination audit")
    parser.add_argument(
        "--snapshot",
        default=str(ROOT / "data" / "clinical_pre_cd_enrichment_snapshot.json"),
    )
    parser.add_argument(
        "--fix",
        action="store_true",
        help="Rewrite snapshot keeping only Exact/Partial sponsor studies",
    )
    args = parser.parse_args()
    path = Path(args.snapshot)
    if not path.is_file():
        print(f"Missing: {path}", file=sys.stderr)
        return 1

    r = audit_snapshot(path)
    print("=== SPONSOR CONTAMINATION AUDIT ===")
    print(f"Records: {r['records']} · Tickers: {r['tickers']}")
    print(f"Sponsor OK: {r['sponsor_ok']} · Sponsor NOT OK: {r['sponsor_bad']}")
    print(f"Title/sponsor suspicious (even if stored sm OK): {r['title_suspicious']}")
    print()
    print("--- Tickers with multiple NCT records ---")
    for tk, n in r["multi_nct"][:15]:
        print(f"  {tk}: {n} records")
    print()
    print("--- PLSE ---")
    for row in r["by_ticker"].get("PLSE", []):
        print(f"  {row['nct_id']} sm={row['sponsor_match']!r} rec={row['recomputed']!r}")
        print(f"    lead: {row['lead_sponsor']}")
        print(f"    title: {row['title']}")
    print()
    print("--- Worst sponsor (first 20) ---")
    for row in r["bad_sponsor"][:20]:
        title = row["title"].encode("ascii", "replace").decode("ascii")
        print(
            f"  {row['ticker']} {row['nct_id']} sm={row['sponsor_match']!r} "
            f"rec={row['recomputed']!r} | {title}"
        )

    if args.fix:
        from prediction.eis_feed_quality import filter_trusted_snapshot_records

        raw = json.loads(path.read_text(encoding="utf-8"))
        before_n = len(raw.get("records") or [])
        clean = filter_trusted_snapshot_records(list(raw.get("records") or []))
        raw["records"] = clean
        raw["count"] = len(clean)
        raw["ai_ok_count"] = sum(1 for x in clean if x.get("ai_ok"))
        raw["sponsor_sanitize_at"] = __import__("datetime").datetime.now(
            __import__("datetime").timezone.utc
        ).isoformat()
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(raw, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
        tmp.replace(path)
        print(f"\n=== SANITIZED ===")
        print(f"  {before_n} -> {len(clean)} records ({before_n - len(clean)} removed)")
        plse = [x for x in clean if str(x.get("ticker") or "").upper() == "PLSE"]
        print(f"  PLSE remaining: {len(plse)}")
        for rec in plse:
            print(
                f"    {rec.get('nct_id')} sm={rec.get('sponsor_match')} "
                f"cd={rec.get('cd_date')}"
            )

    out = ROOT / "data" / "sponsor_contamination_audit.json"
    slim = {k: v for k, v in r.items() if k not in ("by_ticker",)}
    slim["bad_sponsor_tickers"] = Counter(x["ticker"] for x in r["bad_sponsor"]).most_common(30)
    out.write_text(json.dumps(slim, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nWrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
