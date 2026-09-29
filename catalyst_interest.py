"""
Catalyst Interest Watchlist
===========================
User-curated tickers of interest (Catalyst Days tab).

On enroll:
  - persist to ``data/catalyst_interest_watchlist.json``
  - add to SEC calendar roster when CIK is known (re-scanned every calendar refresh)
  - search **all** catalyst types across:
      ClinicalTrials.gov, FDA (AdCom snapshot + PDUFA calendar / Drugs@FDA),
      SEC 8-K filings, news/press with dated catalysts, plus dates already
      on Calendar / Simulation
  - always inject a Simulation sidecar row (pending if no date yet)
  - inject every dated event into the Guidance Calendar snapshot
  - kick clinical pre-CD enrich + Daily News + G-Trends for that ticker

Weekly (Monday guidance calendar): re-search those sources for every watchlist ticker.
Daily News (hourly): interest tickers stay in the news universe; dated catalysts
from new articles are injected into the calendar as they arrive.

Does not change Soft BUY/SELL gates.
"""

from __future__ import annotations

import json
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_DATA_DIR = Path(__file__).resolve().parent / "data"
_WATCH_PATH = _DATA_DIR / "catalyst_interest_watchlist.json"
_SEC_TICKERS_PATH = _DATA_DIR / "sec_company_tickers.json"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_doc() -> dict[str, Any]:
    if not _WATCH_PATH.is_file():
        return {"updated_at": None, "entries": []}
    try:
        doc = json.loads(_WATCH_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"updated_at": None, "entries": []}
    if not isinstance(doc, dict):
        return {"updated_at": None, "entries": []}
    if not isinstance(doc.get("entries"), list):
        doc["entries"] = []
    return doc


def _save_doc(doc: dict[str, Any]) -> None:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    doc = dict(doc)
    doc["updated_at"] = _now_iso()
    entries = [e for e in (doc.get("entries") or []) if isinstance(e, dict)]
    doc["entries"] = entries
    tmp = _WATCH_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(_WATCH_PATH)


def list_interest_entries() -> list[dict[str, Any]]:
    doc = _load_doc()
    entries = [e for e in (doc.get("entries") or []) if isinstance(e, dict)]
    entries.sort(key=lambda e: str(e.get("added_at") or ""), reverse=True)
    return entries


def get_interest_snapshot() -> dict[str, Any]:
    ensure_interest_sim_rows()
    doc = _load_doc()
    return {
        "updated_at": doc.get("updated_at"),
        "entries": list_interest_entries(),
        "count": len(doc.get("entries") or []),
    }


def ensure_interest_sim_rows() -> int:
    """Backfill Simulation sidecar rows for watchlist tickers (no network)."""
    added = 0
    try:
        from manual_catalyst_insert import append_manual_sim_entry
    except Exception:
        return 0
    for e in list_interest_entries():
        tk = _normalize_ticker(e.get("ticker"))
        if not tk:
            continue
        try:
            res = append_manual_sim_entry(
                {
                    "ticker": tk,
                    "company": e.get("company") or tk,
                    "cd_iso": e.get("cd_iso"),
                    "nct_id": e.get("nct_id"),
                    "phase": e.get("phase"),
                    "note": "Interest watchlist",
                }
            )
            if res.get("ok"):
                added += 1
        except Exception as exc:
            print(f"[CatalystInterest] sim backfill failed for {tk}: {exc}", flush=True)
    return added


def _normalize_ticker(raw: Any) -> str | None:
    tk = str(raw or "").strip().upper()
    tk = re.sub(r"[^A-Z0-9.\-]", "", tk)
    if not tk or len(tk) > 8:
        return None
    return tk


def _parse_cd_iso(raw: Any) -> str | None:
    s = str(raw or "").strip()
    if not s:
        return None
    if re.match(r"^20\d{2}-\d{2}-\d{2}", s):
        return s[:10]
    m = re.match(r"^(\d{1,2})[/.](\d{1,2})[/.](20\d{2})$", s)
    if m:
        return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
    return None


def _sec_identity(ticker: str) -> tuple[str | None, str | None]:
    """(cik10, legal company name) from the SEC ``company_tickers.json`` cache."""
    try:
        doc = json.loads(_SEC_TICKERS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None, None
    if not isinstance(doc, dict):
        return None, None
    for row in doc.values():
        if not isinstance(row, dict):
            continue
        if str(row.get("ticker") or "").strip().upper() != ticker:
            continue
        company = str(row.get("title") or "").strip() or None
        cik_raw = str(row.get("cik_str") or "").strip().lstrip("0")
        cik = cik_raw.zfill(10) if cik_raw.isdigit() else None
        return cik, company
    return None, None


def _resolve_cik(ticker: str) -> str | None:
    cik, _company = _sec_identity(ticker)
    if cik:
        return cik
    try:
        from edgar_silent_money import cik_for_ticker

        hit = cik_for_ticker(ticker)
        if hit:
            return str(int(hit)).zfill(10)
    except Exception:
        pass
    try:
        from catalyst_calendar import _cik_map_from_sec_k8

        hit = (_cik_map_from_sec_k8() or {}).get(ticker)
        if isinstance(hit, dict):
            cik = str(hit.get("cik10") or "").zfill(10)
            if cik.isdigit():
                return cik
    except Exception:
        pass
    try:
        from calendar_identity import load_identity_index

        idx = load_identity_index()
        by_tk = (idx.get("by_ticker") or {}) if isinstance(idx, dict) else {}
        row = by_tk.get(ticker) or {}
        cik = str(row.get("cik10") or row.get("cik") or "").zfill(10)
        if cik.isdigit():
            return cik
    except Exception:
        pass
    return None


def _resolve_company(ticker: str, hint: Any = None) -> str:
    """Prefer the SEC legal name — CT.gov sponsor search needs a real company name."""
    given = str(hint or "").strip()
    if given and given.upper() != ticker:
        return given
    _cik, sec_name = _sec_identity(ticker)
    if sec_name:
        return sec_name
    try:
        from catalyst_calendar import _cik_map_from_sec_k8

        hit = (_cik_map_from_sec_k8() or {}).get(ticker)
        if isinstance(hit, dict):
            name = str(hit.get("company") or "").strip()
            if name:
                return name
    except Exception:
        pass
    return given or ticker


def _days_until(iso: str | None) -> int | None:
    if not iso:
        return None
    try:
        cd = datetime.strptime(str(iso)[:10], "%Y-%m-%d").date()
        return (cd - datetime.now(timezone.utc).date()).days
    except ValueError:
        return None


def _json_load(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _pick_nearest_future(cands: list[dict[str, Any]]) -> dict[str, Any] | None:
    today = datetime.now(timezone.utc).date()
    best: tuple[int, dict[str, Any]] | None = None
    for c in cands:
        iso = _parse_cd_iso(c.get("cd_date") or c.get("window_start") or c.get("date"))
        if not iso:
            continue
        try:
            d = datetime.strptime(iso, "%Y-%m-%d").date()
        except ValueError:
            continue
        delta = (d - today).days
        if delta < 0 or delta > 400:
            continue
        row = {**c, "cd_date": iso}
        if best is None or delta < best[0]:
            best = (delta, row)
    return best[1] if best else None


def _collect_local_catalysts(ticker: str) -> list[dict[str, Any]]:
    """All future catalyst events already on Calendar / Simulation for this ticker."""
    tk = ticker.upper()
    hits: list[dict[str, Any]] = []

    gdoc = _json_load(_DATA_DIR / "guidance_calendar_snapshot.json")
    if isinstance(gdoc, dict):
        for ev in gdoc.get("events") or []:
            if not isinstance(ev, dict):
                continue
            if str(ev.get("ticker") or "").strip().upper() != tk:
                continue
            hits.append(
                {
                    "cd_date": ev.get("window_start") or ev.get("window_end"),
                    "event_type": ev.get("event_type") or "cd",
                    "nct_id": ev.get("nct_id") or ev.get("nct"),
                    "phase": ev.get("trial_phase") or ev.get("phase"),
                    "title": ev.get("asset_name") or ev.get("timing_quote"),
                    "source": "guidance_calendar",
                }
            )

    sdoc = _json_load(_DATA_DIR / "catalyst_calendar_snapshot.json")
    if isinstance(sdoc, dict):
        for ev in sdoc.get("entries") or sdoc.get("events") or []:
            if not isinstance(ev, dict):
                continue
            if str(ev.get("ticker") or "").strip().upper() != tk:
                continue
            hits.append(
                {
                    "cd_date": ev.get("date_value") or ev.get("window_start") or ev.get("date"),
                    "event_type": ev.get("event_type") or "other",
                    "title": ev.get("window_label") or ev.get("quote"),
                    "source": "sec_calendar",
                }
            )

    fdoc = _json_load(_DATA_DIR / "fda_adcom_calendar_snapshot.json")
    if isinstance(fdoc, dict):
        for ev in fdoc.get("rows") or fdoc.get("events") or []:
            if not isinstance(ev, dict):
                continue
            if str(ev.get("ticker") or "").strip().upper() != tk:
                continue
            hits.append(
                {
                    "cd_date": ev.get("date"),
                    "event_type": "fda_vote",
                    "title": ev.get("eventEn") or ev.get("product"),
                    "source": "fda_adcom",
                }
            )

    sim = _json_load(_DATA_DIR / "simulation_sheet_snapshot.json")
    rows = sim.get("rows") if isinstance(sim, dict) else None
    if isinstance(rows, list):
        for row in rows:
            if not isinstance(row, dict):
                continue
            if str(row.get("Ticker") or "").strip().upper() != tk:
                continue
            hits.append(
                {
                    "cd_date": row.get("Completion Date"),
                    "event_type": "cd",
                    "nct_id": row.get("NCT"),
                    "phase": row.get("Studio Phase"),
                    "title": row.get("Drug") or row.get("Indication"),
                    "source": "simulation",
                }
            )

    today = datetime.now(timezone.utc).date()
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for c in hits:
        iso = _parse_cd_iso(c.get("cd_date") or c.get("window_start") or c.get("date"))
        if not iso:
            continue
        try:
            d = datetime.strptime(iso, "%Y-%m-%d").date()
        except ValueError:
            continue
        delta = (d - today).days
        if delta < 0 or delta > 400:
            continue
        et = str(c.get("event_type") or "other").strip().lower() or "other"
        nct = str(c.get("nct_id") or "").strip().upper()
        key = f"{et}|{iso}|{nct}"
        if key in seen:
            continue
        seen.add(key)
        out.append({**c, "cd_date": iso, "event_type": et, "days_until": delta})
    out.sort(key=lambda r: str(r.get("cd_date") or ""))
    return out


def _search_local_calendar(ticker: str) -> dict[str, Any] | None:
    """Nearest future event already on Calendar / Simulation for this ticker."""
    return _pick_nearest_future(_collect_local_catalysts(ticker))


def _ctgov_upcoming(ticker: str, company: str, *, limit: int = 8) -> list[dict[str, Any]]:
    """Upcoming CT.gov completion dates (ticker then sponsor)."""
    import urllib.parse
    import urllib.request

    today = datetime.now(timezone.utc).date()
    queries: list[tuple[str, str]] = [("query.term", ticker)]
    token = (company or "").split()[0].strip()
    if token and token.upper() != ticker and len(token) >= 4:
        queries.append(("query.spons", token))

    for qkey, qval in queries:
        try:
            params = urllib.parse.urlencode({qkey: qval, "pageSize": "25"})
            url = f"https://clinicaltrials.gov/api/v2/studies?{params}"
            req = urllib.request.Request(url, headers={"User-Agent": "SuperNova/1.0"})
            with urllib.request.urlopen(req, timeout=14) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except Exception as exc:
            print(f"[CatalystInterest] CT.gov {qkey}={qval} failed: {exc}", flush=True)
            continue
        cands: list[dict[str, Any]] = []
        for study in data.get("studies") or []:
            if not isinstance(study, dict):
                continue
            p = study.get("protocolSection") or {}
            ident = p.get("identificationModule") or {}
            status = p.get("statusModule") or {}
            nct = str(ident.get("nctId") or "").strip().upper()
            pc = (status.get("primaryCompletionDateStruct") or {}).get("date") or ""
            cd = (status.get("completionDateStruct") or {}).get("date") or ""
            cd_iso = _parse_cd_iso(pc) or _parse_cd_iso(cd)
            if not cd_iso:
                continue
            try:
                d = datetime.strptime(cd_iso, "%Y-%m-%d").date()
            except ValueError:
                continue
            delta = (d - today).days
            if delta < 0 or delta > 400:
                continue
            phases = (p.get("designModule") or {}).get("phases") or []
            phase = ", ".join(phases) if isinstance(phases, list) else str(phases or "")
            cands.append(
                {
                    "cd_date": cd_iso,
                    "nct_id": nct,
                    "phase": phase,
                    "title": str(ident.get("briefTitle") or ""),
                    "source": "ctgov",
                    "event_type": "cd",
                }
            )
        if cands:
            cands.sort(key=lambda r: str(r.get("cd_date") or ""))
            return cands[: max(1, limit)]
    return []


def _ctgov_nearest_cd_fast(ticker: str, company: str) -> dict[str, Any] | None:
    hits = _ctgov_upcoming(ticker, company, limit=1)
    return hits[0] if hits else None


def _merge_catalyst_events(*groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for group in groups:
        for c in group:
            if not isinstance(c, dict):
                continue
            iso = _parse_cd_iso(c.get("cd_date") or c.get("window_start") or c.get("date"))
            if not iso:
                continue
            et = str(c.get("event_type") or "other").strip().lower() or "other"
            nct = str(c.get("nct_id") or "").strip().upper()
            key = f"{et}|{iso}|{nct}"
            if key in seen:
                continue
            seen.add(key)
            out.append({**c, "cd_date": iso, "event_type": et})
    out.sort(key=lambda r: str(r.get("cd_date") or ""))
    return out


_SEC_EVENT_TYPE = {
    "PDUFA": "pdufa",
    "AdCom": "fda_vote",
    "Readout": "readout",
    "Conference": "congress",
    "Partnership": "partnership",
}


def _sec_upcoming(ticker: str, cik10: str | None, company: str) -> list[dict[str, Any]]:
    """Live SEC 8-K catalyst dates (PDUFA / AdCom / readout / conference)."""
    if not cik10:
        return []
    try:
        from catalyst_calendar import scan_ticker_sec_filings

        rows = scan_ticker_sec_filings(ticker, cik10, company=company, max_8k=6)
    except Exception as exc:
        print(f"[CatalystInterest] SEC scan failed for {ticker}: {exc}", flush=True)
        return []
    out: list[dict[str, Any]] = []
    for ev in rows:
        if not isinstance(ev, dict):
            continue
        iso = _parse_cd_iso(ev.get("date_value") or ev.get("window_start"))
        if not iso:
            continue
        raw_et = str(ev.get("event_type") or "")
        out.append(
            {
                "cd_date": iso,
                "event_type": _SEC_EVENT_TYPE.get(raw_et, "other"),
                "title": str(ev.get("raw_snippet") or ev.get("window_label") or raw_et)[:180],
                "source": "sec_8k",
                "link": ev.get("source_filing_url"),
            }
        )
    return out


def _fda_upcoming(ticker: str, company: str) -> list[dict[str, Any]]:
    """PDUFA / FDA calendar match for this ticker (Drugs@FDA + RTTNews cache)."""
    try:
        from guidance_calendar import _fetch_pdufa_calendar, _match_pdufa_to_tickers

        raw = _fetch_pdufa_calendar({ticker: company})
        matched = _match_pdufa_to_tickers(raw or [], {ticker: company})
    except Exception as exc:
        print(f"[CatalystInterest] FDA PDUFA search failed for {ticker}: {exc}", flush=True)
        return []
    out: list[dict[str, Any]] = []
    for ev in matched:
        if not isinstance(ev, dict):
            continue
        if str(ev.get("ticker") or "").strip().upper() != ticker:
            continue
        iso = _parse_cd_iso(ev.get("window_start") or ev.get("pdufa_date"))
        if not iso:
            continue
        out.append(
            {
                "cd_date": iso,
                "event_type": str(ev.get("event_type") or "pdufa"),
                "title": str(ev.get("timing_quote") or ev.get("asset_name") or "")[:180],
                "source": "fda_pdufa",
                "link": ev.get("link"),
            }
        )
    return out


def _news_upcoming(ticker: str, company: str) -> list[dict[str, Any]]:
    """News / press headlines that already carry a catalyst date."""
    try:
        from press_release_fetch import _fetch_google_news_rss
        from daily_news_desk import _extract_catalyst_dates_from_news
        from catalyst_benchmark import scheduled_search_queries
    except Exception as exc:
        print(f"[CatalystInterest] news search import failed for {ticker}: {exc}", flush=True)
        return []
    co = (company or ticker).strip()
    queries = [
        (
            f'("{co}" OR "{ticker}") '
            f'(PDUFA OR FDA OR "advisory committee" OR "phase 3" OR readout OR trial '
            f'OR "topline" OR conference OR ASCO OR ASH OR ESMO) when:30d'
        )
    ]
    try:
        for q in scheduled_search_queries(co, ticker, limit=5):
            # Recent window for news channel
            qq = q if "when:" in q.lower() else f"{q} when:30d"
            queries.append(qq)
    except Exception:
        pass
    raw: list[dict[str, Any]] = []
    seen_link: set[str] = set()
    for query in queries[:6]:
        try:
            batch = _fetch_google_news_rss(query, max_items=8) or []
        except Exception as exc:
            print(f"[CatalystInterest] news RSS failed for {ticker}: {exc}", flush=True)
            continue
        for it in batch:
            if not isinstance(it, dict):
                continue
            link = str(it.get("link") or it.get("url") or "").strip()
            key = link or str(it.get("title") or "")[:120]
            if not key or key in seen_link:
                continue
            seen_link.add(key)
            raw.append(it)
    out: list[dict[str, Any]] = []
    for it in raw:
        row = {
            **it,
            "ticker": ticker,
            "company": co,
            "title": it.get("title") or it.get("summary") or "",
        }
        try:
            dates = _extract_catalyst_dates_from_news(
                row, future_only=True, require_catalyst=True
            )
        except Exception:
            dates = []
        for d in dates:
            iso = _parse_cd_iso(d.get("window_start"))
            if not iso:
                continue
            out.append(
                {
                    "cd_date": iso,
                    "event_type": str(d.get("event_type") or "other"),
                    "title": str(d.get("timing_quote") or row.get("title") or "")[:180],
                    "source": "news",
                    "link": it.get("link"),
                }
            )
    return out


def _web_catalyst_upcoming(ticker: str, company: str) -> list[dict[str, Any]]:
    """
    Direct web/news search: company name + catalyst event from the benchmark list
    (PDUFA, Ph3 readout, congress, etc.). Broader window than hourly Daily News.
    """
    try:
        from press_release_fetch import _fetch_google_news_rss
        from daily_news_desk import _extract_catalyst_dates_from_news
        from catalyst_benchmark import scheduled_search_queries
    except Exception as exc:
        print(f"[CatalystInterest] web catalyst import failed for {ticker}: {exc}", flush=True)
        return []
    co = (company or ticker).strip()
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    try:
        queries = scheduled_search_queries(co, ticker, limit=8)
    except Exception:
        queries = []
    for q in queries:
        qq = q if "when:" in q.lower() else f"{q} when:90d"
        try:
            batch = _fetch_google_news_rss(qq, max_items=6) or []
        except Exception:
            continue
        for it in batch:
            if not isinstance(it, dict):
                continue
            row = {
                **it,
                "ticker": ticker,
                "company": co,
                "title": it.get("title") or it.get("summary") or "",
            }
            try:
                dates = _extract_catalyst_dates_from_news(
                    row, future_only=True, require_catalyst=True
                )
            except Exception:
                dates = []
            for d in dates:
                iso = _parse_cd_iso(d.get("window_start"))
                if not iso:
                    continue
                key = f"{iso}|{d.get('event_type')}|{str(row.get('title') or '')[:60]}"
                if key in seen:
                    continue
                seen.add(key)
                out.append(
                    {
                        "cd_date": iso,
                        "event_type": str(d.get("event_type") or "other"),
                        "title": str(d.get("timing_quote") or row.get("title") or "")[:180],
                        "source": "web_catalyst",
                        "link": it.get("link"),
                    }
                )
    return out


def discover_all_catalysts(ticker: Any, company: Any = None) -> dict[str, Any]:
    """
    Upcoming catalysts for one ticker: local calendar + CT.gov + FDA + SEC 8-K + dated news.
    """
    tk = _normalize_ticker(ticker)
    if not tk:
        return {"ok": False, "error": "ticker_required"}
    name = _resolve_company(tk, company)
    cik10 = _resolve_cik(tk)
    local = _collect_local_catalysts(tk)
    errors: list[str] = []
    ctgov: list[dict[str, Any]] = []
    try:
        ctgov = _ctgov_upcoming(tk, name)
    except Exception as exc:
        errors.append(f"ctgov:{exc}"[:200])
        print(f"[CatalystInterest] CT.gov search failed for {tk}: {exc}", flush=True)
    sec: list[dict[str, Any]] = []
    try:
        sec = _sec_upcoming(tk, cik10, name)
    except Exception as exc:
        errors.append(f"sec:{exc}"[:200])
        print(f"[CatalystInterest] SEC search failed for {tk}: {exc}", flush=True)
    fda: list[dict[str, Any]] = []
    try:
        fda = _fda_upcoming(tk, name)
    except Exception as exc:
        errors.append(f"fda:{exc}"[:200])
        print(f"[CatalystInterest] FDA search failed for {tk}: {exc}", flush=True)
    news: list[dict[str, Any]] = []
    try:
        news = _news_upcoming(tk, name)
    except Exception as exc:
        errors.append(f"news:{exc}"[:200])
        print(f"[CatalystInterest] news search failed for {tk}: {exc}", flush=True)
    web: list[dict[str, Any]] = []
    try:
        web = _web_catalyst_upcoming(tk, name)
    except Exception as exc:
        errors.append(f"web:{exc}"[:200])
        print(f"[CatalystInterest] web catalyst search failed for {tk}: {exc}", flush=True)
    events = _merge_catalyst_events(local, ctgov, sec, fda, news, web)
    candidate = _pick_nearest_future(events)
    source = str(candidate.get("source") or "") if candidate else None
    days_until = _days_until(candidate.get("cd_date") if candidate else None)
    searched = {
        "local": len(local),
        "ctgov": len(ctgov),
        "sec_8k": len(sec),
        "fda": len(fda),
        "news": len(news),
        "web_catalyst": len(web),
    }
    return {
        "ok": True,
        "ticker": tk,
        "company": name,
        "cik10": cik10,
        "candidate": candidate,
        "events": events,
        "days_until": days_until,
        "source": source,
        "searched": searched,
        "error": "; ".join(errors) if errors else None,
    }


def discover_catalyst_days(ticker: Any, company: Any = None) -> dict[str, Any]:
    """Next catalyst of any type. Wrapper around ``discover_all_catalysts``."""
    return discover_all_catalysts(ticker, company)


def _kick_enrichment(ticker: str) -> dict[str, Any]:
    """Fire-and-forget clinical + daily-news + G-Trends for the new interest ticker."""
    out: dict[str, Any] = {"clinical": False, "daily_news": False, "trends": False}

    def _clinical() -> None:
        try:
            import clinical_pre_cd_enrichment as cpe

            cpe.run_clinical_pre_cd_refresh(
                portfolio_only=False,
                force=True,
                deep=True,
                tickers=[ticker],
            )
            out["clinical"] = True
        except Exception as exc:
            print(f"[CatalystInterest] clinical kick failed for {ticker}: {exc}", flush=True)

    def _news() -> None:
        try:
            from daily_news_desk import run_daily_news_search

            run_daily_news_search(force=True, priority_tickers=[ticker])
            out["daily_news"] = True
        except Exception as exc:
            print(f"[CatalystInterest] daily-news kick failed for {ticker}: {exc}", flush=True)

    def _trends() -> None:
        try:
            from search_interest import refresh_search_interest_universe

            refresh_search_interest_universe(tickers=[ticker], force=True)
            out["trends"] = True
        except Exception as exc:
            print(f"[CatalystInterest] trends kick failed for {ticker}: {exc}", flush=True)

    threading.Thread(target=_clinical, name=f"interest-clin-{ticker}", daemon=True).start()
    threading.Thread(target=_news, name=f"interest-news-{ticker}", daemon=True).start()
    threading.Thread(target=_trends, name=f"interest-trends-{ticker}", daemon=True).start()
    return out


def _inject_discovered_events(
    ticker: str,
    company: str,
    events: list[dict[str, Any]],
) -> int:
    """Write every dated catalyst into the Guidance Calendar snapshot."""
    injected = 0
    try:
        from manual_catalyst_insert import inject_guidance_calendar_event
    except Exception as exc:
        print(f"[CatalystInterest] calendar inject import failed: {exc}", flush=True)
        return 0
    for ev in events:
        iso = _parse_cd_iso(ev.get("cd_date") or ev.get("window_start"))
        if not iso:
            continue
        et = str(ev.get("event_type") or "other").strip().lower() or "other"
        nct = str(ev.get("nct_id") or "").strip().upper() or None
        title = str(ev.get("title") or "").strip() or None
        try:
            ok = inject_guidance_calendar_event(
                {
                    "ticker": ticker,
                    "company": company,
                    "event_type": et,
                    "asset_name": title,
                    "trial_phase": ev.get("phase"),
                    "timing_quote": title or f"{et} {iso}",
                    "window_start": iso,
                    "window_end": iso,
                    "source_type": "catalyst_interest",
                    "source_date": iso,
                    "confidence": 0.8,
                    "estimation_method": str(ev.get("source") or "catalyst_interest"),
                    "nct_id": nct,
                    "link": ev.get("link")
                    or (
                        f"https://clinicaltrials.gov/study/{nct}"
                        if nct and nct.startswith("NCT")
                        else None
                    ),
                }
            )
            if ok:
                injected += 1
        except Exception as exc:
            print(f"[CatalystInterest] inject {ticker} {et} {iso} failed: {exc}", flush=True)
    return injected


def enroll_interest_ticker(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Body: {ticker, company?, cd_iso|cd_date?, nct_id?, phase?, note?,
           open_pipeline?, discover?}

    Always writes a Simulation sidecar row (pending if no date). Searches
    CT.gov, FDA, SEC 8-K and dated news — not only CD — and injects every dated event.
    """
    ticker = _normalize_ticker(payload.get("ticker") or payload.get("Ticker"))
    if not ticker:
        return {"ok": False, "error": "ticker_required"}

    company = _resolve_company(
        ticker,
        payload.get("company")
        or payload.get("Società")
        or payload.get("company_name"),
    )
    cd_iso = _parse_cd_iso(
        payload.get("cd_iso") or payload.get("cd_date") or payload.get("Completion Date")
    )
    nct = str(payload.get("nct_id") or payload.get("NCT") or "").strip().upper() or None
    phase = str(payload.get("phase") or "").strip() or None
    note = str(payload.get("note") or "").strip() or None
    open_pipeline = payload.get("open_pipeline", True) is not False
    want_discovery = payload.get("discover", True) is not False

    cik10 = _resolve_cik(ticker)

    discovery: dict[str, Any] | None = None
    found_events: list[dict[str, Any]] = []
    event_type = str(payload.get("event_type") or "").strip().lower() or None
    if want_discovery:
        discovery = discover_all_catalysts(ticker, company)
        found_events = [
            e
            for e in (discovery.get("events") or [])
            if isinstance(e, dict)
        ]
        cand = discovery.get("candidate") if isinstance(discovery, dict) else None
        if isinstance(cand, dict):
            if not cd_iso:
                cd_iso = _parse_cd_iso(cand.get("cd_date"))
            nct = nct or (str(cand.get("nct_id") or "").strip().upper() or None)
            phase = phase or (str(cand.get("phase") or "").strip() or None)
            event_type = event_type or (
                str(cand.get("event_type") or "").strip().lower() or None
            )
        if not cik10 and isinstance(discovery, dict):
            cik10 = discovery.get("cik10") or cik10

    now = _now_iso()

    doc = _load_doc()
    entries: list[dict[str, Any]] = [
        e for e in (doc.get("entries") or []) if isinstance(e, dict)
    ]
    replaced = False
    entry: dict[str, Any] = {
        "ticker": ticker,
        "company": company,
        "cik10": cik10,
        "cd_iso": cd_iso,
        "nct_id": nct,
        "phase": phase,
        "cd_source": (
            "manual"
            if payload.get("cd_iso") or payload.get("cd_date")
            else (str((discovery or {}).get("source") or "") or None)
        ),
        "event_count": len(found_events),
        "note": note,
        "source": "catalyst_interest",
        "added_at": now,
        "updated_at": now,
    }
    for i, existing in enumerate(entries):
        if str(existing.get("ticker") or "").strip().upper() == ticker:
            merged = {**existing, **entry, "added_at": existing.get("added_at") or now}
            entries[i] = merged
            entry = merged
            replaced = True
            break
    if not replaced:
        entries.append(entry)
    doc["entries"] = entries
    _save_doc(doc)

    roster_ok = False
    if cik10:
        try:
            from catalyst_calendar import upsert_roster_entries

            upsert_roster_entries(
                [
                    {
                        "ticker": ticker,
                        "cik10": cik10,
                        "company": company,
                        "source": "catalyst_interest",
                    }
                ]
            )
            roster_ok = True
        except Exception as exc:
            print(f"[CatalystInterest] roster upsert failed: {exc}", flush=True)

    events_injected = 0
    if found_events:
        events_injected = _inject_discovered_events(ticker, company, found_events)
    elif cd_iso:
        events_injected = _inject_discovered_events(
            ticker,
            company,
            [{"cd_date": cd_iso, "event_type": event_type or "cd", "nct_id": nct, "phase": phase}],
        )

    manual_ok = False
    try:
        from manual_catalyst_insert import append_manual_sim_entry

        res = append_manual_sim_entry(
            {
                "ticker": ticker,
                "company": company,
                "cd_iso": cd_iso,
                "nct_id": nct,
                "phase": phase,
                "event_type": event_type or ("cd" if cd_iso else "watch"),
                "note": note
                or (
                    "Catalyst interest → Simulation"
                    if cd_iso
                    else "Catalyst interest — pending catalyst date"
                ),
            }
        )
        manual_ok = bool(res.get("ok"))
    except Exception as exc:
        print(f"[CatalystInterest] manual sim insert failed: {exc}", flush=True)

    kicks: dict[str, Any] = {}
    if open_pipeline:
        kicks = _kick_enrichment(ticker)

    return {
        "ok": True,
        "replaced": replaced,
        "entry": entry,
        "roster_added": roster_ok,
        "manual_sim_added": manual_ok,
        "events_injected": events_injected,
        "cik10": cik10,
        "cd_iso": cd_iso,
        "discovery": discovery,
        "pipeline": kicks,
        "count": len(entries),
        "in_catalyst_table": bool(manual_ok),
    }


def refresh_interest_watchlist_catalysts() -> dict[str, Any]:
    """Weekly: re-search all catalyst types for every interest ticker and refresh cards."""
    entries = list_interest_entries()
    tickers: list[str] = []
    updated = 0
    events_injected = 0
    for e in entries:
        tk = _normalize_ticker(e.get("ticker"))
        if not tk:
            continue
        tickers.append(tk)
        try:
            res = enroll_interest_ticker(
                {
                    "ticker": tk,
                    "company": e.get("company"),
                    "open_pipeline": False,
                    "discover": True,
                }
            )
            if res.get("ok"):
                updated += 1
                events_injected += int(res.get("events_injected") or 0)
        except Exception as exc:
            print(f"[CatalystInterest] weekly refresh failed for {tk}: {exc}", flush=True)
    trends_ok = False
    if tickers:
        try:
            from search_interest import refresh_search_interest_universe

            refresh_search_interest_universe(tickers=tickers, force=False)
            trends_ok = True
        except Exception as exc:
            print(f"[CatalystInterest] weekly trends failed: {exc}", flush=True)
    print(
        f"[CatalystInterest] weekly refresh tickers={len(tickers)} "
        f"updated={updated} events={events_injected}",
        flush=True,
    )
    return {
        "ok": True,
        "tickers": tickers,
        "updated": updated,
        "events_injected": events_injected,
        "trends": trends_ok,
    }


def remove_interest_ticker(ticker: str) -> dict[str, Any]:
    tk = _normalize_ticker(ticker)
    if not tk:
        return {"ok": False, "error": "ticker_required"}
    doc = _load_doc()
    before = len(doc.get("entries") or [])
    entries = [
        e
        for e in (doc.get("entries") or [])
        if isinstance(e, dict) and str(e.get("ticker") or "").strip().upper() != tk
    ]
    doc["entries"] = entries
    _save_doc(doc)
    return {"ok": True, "removed": before - len(entries), "count": len(entries)}
