"""
Catalyst table — Silent Money (strict) + Governance Flag (Framework v2 signal 2).

Display only — not a Soft BUY/SELL input.

Silent money (senso stretto / originario):
  Denaro o posizionamento che si muove *prima* che la notizia sia pubblica —
  tipicamente Form 4 (dirigente/insider compra azioni proprie) e Schedule
  13D/13G (fondo costruisce o aumenta una partecipazione rilevante).

Provider preferito: sec-api.io (SEC_API_KEY) — Form 4 + 13D/13G + 8-K Item 5.02.
Fallback: FMP insider-trading/search, poi SEC EDGAR gratuito (submissions + Form 4 XML),
poi clinical pre-CD per 8-K 5.02. Mai inventare $0. Su 429 sec-api si attiva un
circuit-breaker e non si avvelena la cache 18h con ``no_silent_money_coverage``.

Formulas:
  InsiderNetBuy_30d = Σ(BuyValue_30d) − Σ(SellValue_30d)   # exclude 10b5-1 sales
  ClusterBuyFlag     = TRUE if ≥2 distinct insiders buy within 5 calendar days
  GovernanceFlag     = TRUE if an 8-K Item 5.02 exists in the ~60d window
                       (officer left preferred over appointments)
"""
from __future__ import annotations

import json
import logging
import math
import re
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Sequence
from urllib.parse import quote

logger = logging.getLogger("supernova.catalyst_silent")

_CACHE_DIR = Path("data") / "cache" / "catalyst_accumulation"
_TTL_S = 18 * 60 * 60
_TTL_PROVIDER_FAIL_S = 30 * 60
_MAX_TICKERS = 64
_LOOKBACK_D = 30
_GOV_LOOKBACK_D = 60  # 8-K Item 5.02: wider than Form 4 so officer exits surface
_13D_LOOKBACK_D = 90
_CLUSTER_WINDOW_D = 5

_PURCHASE_RE = re.compile(r"\b(p-?purchase|purchase|buy)\b", re.I)
_SALE_RE = re.compile(r"\b(s-?sale|sale|sell)\b", re.I)
_PLAN_RE = re.compile(r"10b5[\s\-]?1|rule\s*10b5|pre[\s\-]?arranged|planned\s*sale", re.I)
_ITEM_502_RE = re.compile(r"\b5\.02\b")
_DEPART_RE = re.compile(
    r"\b(resign(?:ed|ation|s)?|retir(?:ed|ement|es)?|depart(?:ed|ure|s)?|"
    r"steps?\s+down|left|terminated)\b",
    re.I,
)
_CEO_RE = re.compile(r"\b(ceo|chief executive)\b", re.I)
_CMO_RE = re.compile(r"\b(cmo|chief medical)\b", re.I)
_OFFICER_RE = re.compile(
    r"\b(ceo|chief executive|cmo|chief medical|president|coo|chief operating|"
    r"cfo|chief financial|officer|director)\b",
    re.I,
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


def _finite(v: Any) -> float | None:
    if v is None:
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return n if math.isfinite(n) else None


def _parse_iso_date(raw: Any) -> date | None:
    s = str(raw or "").strip()[:10]
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", s):
        return None
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


def is_10b5_1_sale(row: dict[str, Any]) -> bool:
    """Routine planned sales — exclude from InsiderNetBuy (brief: do not include)."""
    if row.get("aff10b5One") is True or row.get("is_10b5_1") is True:
        acq = str(row.get("acquisitionOrDisposition") or row.get("acqOrDisp") or "").upper()
        code = str(row.get("transactionCode") or row.get("coding_code") or "").upper()
        if acq == "D" or code == "S" or _SALE_RE.search(str(row.get("transactionType") or "")):
            return True
    blob = " ".join(
        str(row.get(k) or "")
        for k in (
            "transactionType",
            "transaction_type",
            "securitiesOwned",
            "comment",
            "remarks",
            "typeOfOwner",
            "reportingName",
            "footnotes_text",
        )
    )
    if not _PLAN_RE.search(blob):
        return False
    tx = str(row.get("transactionType") or row.get("transaction_type") or "")
    acq = str(row.get("acquisitionOrDisposition") or row.get("acqOrDisp") or "").upper()
    if _SALE_RE.search(tx) or acq == "D":
        return True
    return bool(_PLAN_RE.search(blob) and acq != "A")


def _tx_value(row: dict[str, Any]) -> float | None:
    shares = _finite(row.get("securitiesTransacted") or row.get("securities_transacted"))
    price = _finite(row.get("price") or row.get("transactionPrice") or row.get("sharePrice"))
    if shares is None or price is None or shares < 0 or price < 0:
        return None
    return shares * price


def _is_buy(row: dict[str, Any]) -> bool:
    code = str(row.get("transactionCode") or row.get("coding_code") or "").upper()
    if code == "P":
        return True
    if code == "S":
        return False
    tx = str(row.get("transactionType") or row.get("transaction_type") or "")
    acq = str(row.get("acquisitionOrDisposition") or row.get("acqOrDisp") or "").upper()
    if _SALE_RE.search(tx) or acq == "D":
        return False
    if acq == "A":
        return True
    return bool(_PURCHASE_RE.search(tx))


def _is_sell(row: dict[str, Any]) -> bool:
    code = str(row.get("transactionCode") or row.get("coding_code") or "").upper()
    if code == "S":
        return True
    if code == "P":
        return False
    tx = str(row.get("transactionType") or row.get("transaction_type") or "")
    acq = str(row.get("acquisitionOrDisposition") or row.get("acqOrDisp") or "").upper()
    if _PURCHASE_RE.search(tx) or acq == "A":
        return False
    if acq == "D":
        return True
    return bool(_SALE_RE.search(tx))


def _owner_key(row: dict[str, Any]) -> str:
    name = str(row.get("reportingName") or row.get("reporting_name") or "").strip().lower()
    if name:
        return name
    return str(row.get("cik") or row.get("reportingCik") or "unknown").strip().lower()


def _owner_role(title: str) -> str | None:
    t = title or ""
    if _CEO_RE.search(t):
        return "CEO"
    if _CMO_RE.search(t):
        return "CMO"
    if re.search(r"\bpresident\b", t, re.I):
        return "Pres"
    if re.search(r"\bcoo|chief operating\b", t, re.I):
        return "COO"
    if re.search(r"\bcfo|chief financial\b", t, re.I):
        return "CFO"
    if _OFFICER_RE.search(t):
        return "officer"
    return None


def normalize_sec_api_form4(filings: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """Flatten sec-api.io Form 4 filings into FMP-like transaction rows."""
    out: list[dict[str, Any]] = []
    for filing in filings:
        if not isinstance(filing, dict):
            continue
        owner = filing.get("reportingOwner") if isinstance(filing.get("reportingOwner"), dict) else {}
        rel = owner.get("relationship") if isinstance(owner.get("relationship"), dict) else {}
        title_bits = []
        if rel.get("officerTitle"):
            title_bits.append(str(rel["officerTitle"]))
        if rel.get("isOfficer"):
            title_bits.append("officer")
        if rel.get("isDirector"):
            title_bits.append("director")
        if rel.get("isTenPercentOwner"):
            title_bits.append("10% owner")
        owner_title = " ".join(title_bits) or str(owner.get("name") or "")
        footnotes = filing.get("footnotes") or []
        foot_text = " ".join(
            str(f.get("text") or f) if isinstance(f, dict) else str(f) for f in footnotes
        )
        aff = bool(filing.get("aff10b5One"))
        link = str(
            filing.get("linkToFilingDetails")
            or filing.get("linkToHtml")
            or filing.get("url")
            or ""
        ).strip()
        accession = str(filing.get("accessionNo") or "").strip()
        if not link and accession:
            link = f"https://www.sec.gov/Archives/edgar/data/{accession.replace('-', '')}"

        tables = []
        nd = filing.get("nonDerivativeTable")
        if isinstance(nd, dict):
            tables.append(nd.get("transactions") or [])
        derv = filing.get("derivativeTable")
        if isinstance(derv, dict):
            # Derivative open-market codes are rare for this signal — skip unless code P.
            tables.append(derv.get("transactions") or [])

        for tx_list in tables:
            if not isinstance(tx_list, list):
                continue
            for tx in tx_list:
                if not isinstance(tx, dict):
                    continue
                coding = tx.get("coding") if isinstance(tx.get("coding"), dict) else {}
                code = str(coding.get("code") or tx.get("code") or "").upper()
                # Strict silent-money buys: open-market / private purchase (P).
                # Keep sales (S) for net; ignore grants/awards/tax (A/F/M/…).
                if code and code not in {"P", "S"}:
                    continue
                amounts = tx.get("amounts") if isinstance(tx.get("amounts"), dict) else {}
                shares = _finite(
                    amounts.get("shares")
                    or tx.get("shares")
                    or tx.get("transactionShares")
                )
                price = _finite(
                    amounts.get("pricePerShare")
                    or tx.get("pricePerShare")
                    or tx.get("transactionPricePerShare")
                )
                acq = str(
                    amounts.get("acquiredDisposedCode")
                    or tx.get("acquiredDisposedCode")
                    or ("A" if code == "P" else "D" if code == "S" else "")
                ).upper()
                dt = (
                    _parse_iso_date(tx.get("transactionDate"))
                    or _parse_iso_date(filing.get("periodOfReport"))
                    or _parse_iso_date(filing.get("filedAt"))
                )
                out.append(
                    {
                        "transactionType": "P-Purchase" if code == "P" or acq == "A" else "S-Sale",
                        "transactionCode": code or ("P" if acq == "A" else "S"),
                        "acquisitionOrDisposition": acq or ("A" if code == "P" else "D"),
                        "securitiesTransacted": shares,
                        "price": price,
                        "transactionDate": dt.isoformat() if dt else None,
                        "filingDate": str(filing.get("filedAt") or "")[:10] or None,
                        "reportingName": str(owner.get("name") or "").strip(),
                        "typeOfOwner": owner_title,
                        "aff10b5One": aff,
                        "footnotes_text": foot_text,
                        "link": link or None,
                        "source": "sec-api",
                    }
                )
    return out


def compute_insider_net_buy_30d(
    rows: Sequence[dict[str, Any]],
    *,
    today: date | None = None,
    lookback_days: int = _LOOKBACK_D,
) -> dict[str, Any]:
    """InsiderNetBuy_30d and ClusterBuyFlag from Form 4 rows (10b5-1 sales excluded)."""
    ref = today or date.today()
    cutoff = ref - timedelta(days=int(lookback_days))
    buy_value = 0.0
    sell_value = 0.0
    buy_count = 0
    sell_count = 0
    skipped_10b5 = 0
    buy_events: list[tuple[date, str]] = []
    buys_detail: list[dict[str, Any]] = []
    has_value = False
    lead_role: str | None = None
    lead_name: str | None = None
    lead_date: str | None = None
    lead_link: str | None = None

    for row in rows:
        if not isinstance(row, dict):
            continue
        if is_10b5_1_sale(row):
            skipped_10b5 += 1
            continue
        dt = _parse_iso_date(
            row.get("transactionDate") or row.get("transaction_date") or row.get("filingDate")
        )
        if dt is None or dt < cutoff or dt > ref:
            continue
        val = _tx_value(row)
        role = _owner_role(
            str(row.get("typeOfOwner") or row.get("type_of_owner") or row.get("reportingName") or "")
        )
        if _is_buy(row):
            buy_count += 1
            buy_events.append((dt, _owner_key(row)))
            name = str(row.get("reportingName") or "").strip()
            buys_detail.append(
                {
                    "date": dt.isoformat(),
                    "role": role,
                    "name": name,
                    "value": val,
                    "link": row.get("link"),
                }
            )
            if val is not None:
                buy_value += val
                has_value = True
            # Prefer CEO/CMO as headline
            rank = {"CEO": 3, "CMO": 2, "CFO": 1, "COO": 1, "Pres": 1}.get(role or "", 0)
            cur = {"CEO": 3, "CMO": 2, "CFO": 1, "COO": 1, "Pres": 1}.get(lead_role or "", 0)
            if lead_role is None or rank > cur or (rank == cur and (lead_date or "") < dt.isoformat()):
                lead_role = role or "officer"
                lead_name = name or None
                lead_date = dt.isoformat()
                lead_link = str(row.get("link") or "") or None
        elif _is_sell(row):
            sell_count += 1
            if val is not None:
                sell_value += val
                has_value = True

    net = round(buy_value - sell_value, 2) if has_value else None

    cluster = False
    buy_events.sort(key=lambda x: x[0])
    for i, (d0, _) in enumerate(buy_events):
        owners: set[str] = set()
        for d1, who in buy_events[i:]:
            if (d1 - d0).days > _CLUSTER_WINDOW_D:
                break
            owners.add(who)
        if len(owners) >= 2:
            cluster = True
            break

    return {
        "insider_net_buy_30d": net,
        "buy_value_30d": round(buy_value, 2) if has_value else None,
        "sell_value_30d": round(sell_value, 2) if has_value else None,
        "buy_count_30d": buy_count,
        "sell_count_30d": sell_count,
        "cluster_buy": cluster,
        "skipped_10b5_1": skipped_10b5,
        "lead_role": lead_role,
        "lead_name": lead_name,
        "lead_date": lead_date,
        "lead_link": lead_link,
        "buys": buys_detail[:8],
        "status": "ok" if (has_value or buy_count or sell_count) else "none",
    }


def classify_13d_13g(
    filings: Sequence[dict[str, Any]],
    *,
    today: date | None = None,
    lookback_days: int = _13D_LOOKBACK_D,
) -> dict[str, Any]:
    """Recent Schedule 13D / 13G accumulation (silent money institutional leg)."""
    ref = today or date.today()
    cutoff = ref - timedelta(days=int(lookback_days))
    hits: list[dict[str, Any]] = []
    for row in filings:
        if not isinstance(row, dict):
            continue
        form = str(row.get("formType") or row.get("form") or row.get("type") or "")
        compact = re.sub(r"[\s-]+", "", form).upper()
        if "13D" not in compact and "13G" not in compact:
            continue
        dt = _parse_iso_date(
            row.get("eventDate") or row.get("filedAt") or row.get("filingDate") or row.get("date")
        )
        if dt is None or dt < cutoff or dt > ref:
            continue
        # Skip exits that report ownership falling to ≤5%.
        item5 = row.get("item5") if isinstance(row.get("item5"), dict) else {}
        if item5.get("classOwnership5PercentOrLess") is True:
            continue
        owners = row.get("owners") if isinstance(row.get("owners"), list) else []
        filers = row.get("filers") if isinstance(row.get("filers"), list) else []
        who = None
        for o in owners:
            if isinstance(o, dict) and o.get("name"):
                who = str(o["name"]).strip()
                break
        if not who:
            for f in filers:
                if not isinstance(f, dict):
                    continue
                name = str(f.get("name") or "")
                if "(Filed by)" in name or "Subject" not in name:
                    who = name.replace("(Filed by)", "").strip()
                    break
        pct = None
        for o in owners:
            if isinstance(o, dict):
                pct = _finite(o.get("amountAsPercent") or o.get("percent"))
                if pct is not None:
                    break
        kind = "13D" if "13D" in compact else "13G"
        amended = compact.endswith("A") or "/A" in form
        link = str(
            row.get("linkToFilingDetails") or row.get("linkToHtml") or row.get("link") or ""
        ).strip()
        hits.append(
            {
                "date": dt.isoformat(),
                "form": f"{kind}/A" if amended else kind,
                "who": who,
                "pct": pct,
                "link": link or None,
            }
        )
    hits.sort(key=lambda h: h["date"], reverse=True)
    top = hits[0] if hits else None
    return {
        "filing_13d": bool(hits),
        "form_13d": top["form"] if top else None,
        "date_13d": top["date"] if top else None,
        "who_13d": top["who"] if top else None,
        "pct_13d": top["pct"] if top else None,
        "link_13d": top["link"] if top else None,
        "filings_13d": hits[:6],
    }


def _person_name(ch: dict[str, Any]) -> str | None:
    person = ch.get("person")
    if isinstance(person, dict):
        name = str(person.get("name") or "").strip()
        return name or None
    name = str(person or ch.get("name") or "").strip()
    return name or None


def _role_from_positions(positions: Any) -> str | None:
    if not isinstance(positions, list):
        return None
    blob = " ".join(str(p) for p in positions)
    for role, pat in (
        ("CEO", r"\bchief executive\b|\bCEO\b"),
        ("CFO", r"\bchief financial\b|\bCFO\b"),
        ("CMO", r"\bchief medical\b|\bCMO\b"),
        ("COO", r"\bchief operating\b|\bCOO\b"),
        ("CSO", r"\bchief scientific\b|\bCSO\b"),
        ("Pres", r"\bpresident\b"),
        ("Dir", r"\bdirector\b|\bboard\b"),
    ):
        if re.search(pat, blob, re.I):
            return role
    return None


def _filing_href(ev: dict[str, Any]) -> str | None:
    for key in ("linkToFilingDetails", "linkToHtml", "link", "url", "gov_href"):
        href = str(ev.get(key) or "").strip()
        if href.startswith("http"):
            return href
    accession = str(ev.get("accessionNo") or "").strip()
    cik = str(ev.get("cik") or "").strip().lstrip("0")
    if accession and cik:
        clean = accession.replace("-", "")
        return f"https://www.sec.gov/Archives/edgar/data/{cik}/{clean}/{accession}.txt"
    return None


def _gov_cand_rank(cand: dict[str, Any]) -> tuple[int, str]:
    """Prefer officer departures, then newest filing date."""
    return (1 if cand.get("departed") else 0, str(cand.get("date") or ""))


def compute_governance_flag(
    events: Sequence[dict[str, Any]],
    *,
    today: date | None = None,
    lookback_days: int = _GOV_LOOKBACK_D,
) -> dict[str, Any]:
    """GovernanceFlag from 8-K Item 5.02 — prefer officer/director departures."""
    ref = today or date.today()
    cutoff = ref - timedelta(days=int(lookback_days))
    best: dict[str, Any] | None = None
    for ev in events:
        if not isinstance(ev, dict):
            continue
        items_val = ev.get("items_raw") if ev.get("items_raw") is not None else ev.get("items")
        if isinstance(items_val, list):
            items = " ".join(str(x) for x in items_val)
        else:
            items = str(items_val or "")
        title = str(ev.get("event_title") or ev.get("title") or "")
        summary = str(ev.get("summary") or ev.get("impact_note") or "")
        item502 = ev.get("item5_02") if isinstance(ev.get("item5_02"), dict) else None
        key_bits = str((item502 or {}).get("keyComponents") or "") if item502 else ""
        blob = f"{items} {title} {summary} {key_bits}"
        if not (item502 or _ITEM_502_RE.search(blob)):
            continue

        departed = False
        who: str | None = None
        role: str | None = None
        appointed_who: str | None = None
        if item502:
            for ch in item502.get("personnelChanges") or []:
                if not isinstance(ch, dict):
                    continue
                ctype = str(ch.get("type") or "").lower()
                name = _person_name(ch)
                pos_role = _role_from_positions(ch.get("positions"))
                if ctype == "departure" or (
                    ctype not in {"appointment", "nomination"}
                    and str(ch.get("departureType") or "").strip()
                ):
                    departed = True
                    if name:
                        who = name
                    if pos_role:
                        role = pos_role
                elif ctype in {"appointment", "nomination"}:
                    if name and appointed_who is None:
                        appointed_who = name
                    if pos_role and role is None and not departed:
                        role = pos_role
        if not departed and _DEPART_RE.search(blob):
            departed = True
        if who is None and not departed:
            who = appointed_who

        dt = _parse_iso_date(
            ev.get("filedAt")
            or ev.get("periodOfReport")
            or ev.get("event_date")
            or ev.get("filing_date")
            or ev.get("date")
        )
        if dt is None or dt < cutoff or dt > ref:
            continue

        if departed and who:
            label = f"{who} left" + (f" ({role})" if role else "")
        elif departed:
            label = f"Officer left" + (f" ({role})" if role else "")
        elif who:
            label = f"{who} appointed" + (f" ({role})" if role else "")
        else:
            clean_title = title.strip()
            label = (
                clean_title
                if clean_title and not re.match(r"^officer", clean_title, re.I)
                else "Officer / board change (8-K 5.02)"
            )
        cand = {
            "date": dt.isoformat(),
            "label": label,
            "href": _filing_href(ev),
            "departed": departed,
        }
        if best is None or _gov_cand_rank(cand) > _gov_cand_rank(best):
            best = cand
    return {
        "governance_flag": best is not None,
        "gov_date": best["date"] if best else None,
        "gov_label": best["label"] if best else None,
        "gov_href": best["href"] if best else None,
        "officer_departure": bool(best and best.get("departed")),
    }


def compose_silent_money_headline(
    insider: dict[str, Any],
    filing_13d: dict[str, Any],
) -> dict[str, Any] | None:
    """
    Strict silent-money headline: Form 4 officer buy preferred, else 13D/13G.
    Positive accumulation only — departures belong in Gov Flag.
    """
    form4_ok = (insider.get("buy_count_30d") or 0) > 0 and (
        insider.get("insider_net_buy_30d") is None or float(insider.get("insider_net_buy_30d") or 0) > 0
        or insider.get("cluster_buy")
    )
    if form4_ok and insider.get("lead_date"):
        role = insider.get("lead_role") or "officer"
        return {
            "kind": "form4",
            "label": (
                f"{role} cluster bought shares"
                if insider.get("cluster_buy") and role in {"CEO", "CMO", "CFO", "COO", "Pres"}
                else f"{role} bought shares"
                if role in {"CEO", "CMO", "CFO", "COO", "Pres"}
                else "Insiders bought shares"
            ),
            "date": insider.get("lead_date"),
            "who": insider.get("lead_name"),
            "href": insider.get("lead_link"),
            "rank": 100,
        }
    if filing_13d.get("filing_13d") and filing_13d.get("date_13d"):
        form = str(filing_13d.get("form_13d") or "13D")
        who = filing_13d.get("who_13d")
        return {
            "kind": "13d" if "13D" in form.upper() else "13g",
            "label": (
                f"{who} filed {form}"
                if who
                else (f"New {form} beneficial owner" if "13D" in form.upper() else f"New {form} stake")
            ),
            "date": filing_13d.get("date_13d"),
            "who": who,
            "href": filing_13d.get("link_13d"),
            "pct": filing_13d.get("pct_13d"),
            "rank": 90,
        }
    return None


def build_accumulation_row(
    ticker: str,
    *,
    form4_rows: Sequence[dict[str, Any]] | None = None,
    filings_13d: Sequence[dict[str, Any]] | None = None,
    clinical_events: Sequence[dict[str, Any]] | None = None,
    today: date | None = None,
    source: str | None = None,
) -> dict[str, Any]:
    """Pure row builder for tests and fetch."""
    tk = ticker.strip().upper()
    insider = compute_insider_net_buy_30d(form4_rows or [], today=today)
    filing_13d = classify_13d_13g(filings_13d or [], today=today)
    gov = compute_governance_flag(clinical_events or [], today=today)
    headline = compose_silent_money_headline(insider, filing_13d)
    return {
        "ticker": tk,
        **insider,
        **filing_13d,
        **gov,
        "silent_kind": headline.get("kind") if headline else None,
        "silent_label": headline.get("label") if headline else None,
        "silent_date": headline.get("date") if headline else None,
        "silent_who": headline.get("who") if headline else None,
        "silent_href": headline.get("href") if headline else None,
        "silent_pct": headline.get("pct") if headline else None,
        "source": source,
        "updated_at": _now_iso(),
    }


def _read_json(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError):
        return None
    return doc if isinstance(doc, dict) else None


def _write_json(path: Path, doc: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def _cache_path(ticker: str) -> Path:
    return _CACHE_DIR / f"{ticker.strip().upper()}.json"


def parse_tickers(raw: str | list[str] | None) -> list[str]:
    if not raw:
        return []
    parts = raw if isinstance(raw, list) else str(raw).replace(";", ",").split(",")
    out: list[str] = []
    seen: set[str] = set()
    for part in parts:
        tk = str(part).strip().upper()
        if not tk or tk in seen:
            continue
        seen.add(tk)
        out.append(tk)
    return out[:_MAX_TICKERS]


def _fetch_form4_fmp(ticker: str) -> list[dict[str, Any]]:
    try:
        from prediction.sds_data_collector import _fmp_get

        # Stable search path (legacy /api/v4 and bare /stable/insider-trading are dead/404).
        payload = _fmp_get(
            f"/stable/insider-trading/search?symbol={quote(ticker, safe='')}&page=0&limit=80"
        )
        if not payload:
            payload = _fmp_get(f"/stable/insider-trading?symbol={quote(ticker, safe='')}&limit=80")
        if not payload:
            payload = _fmp_get(f"/api/v4/insider-trading?symbol={quote(ticker, safe='')}&limit=80")
        if isinstance(payload, dict):
            payload = payload.get("data") or payload.get("transactions") or []
        return [r for r in payload if isinstance(r, dict)] if isinstance(payload, list) else []
    except Exception as exc:
        logger.warning("silent-money FMP form4 %s: %s", ticker, exc)
        return []


def _fetch_13d_fmp(ticker: str) -> list[dict[str, Any]]:
    try:
        from prediction.sds_data_collector import _fmp_get

        payload = _fmp_get(
            f"/stable/sec-filings-search/symbol?symbol={quote(ticker, safe='')}&from="
            f"{(date.today() - timedelta(days=_13D_LOOKBACK_D)).isoformat()}&to="
            f"{date.today().isoformat()}&limit=40"
        )
        if not payload:
            payload = _fmp_get(f"/api/v3/sec_filings/{quote(ticker, safe='')}?limit=40")
        if isinstance(payload, dict):
            payload = payload.get("data") or payload.get("filings") or []
        return [r for r in payload if isinstance(r, dict)] if isinstance(payload, list) else []
    except Exception as exc:
        logger.warning("silent-money FMP 13D %s: %s", ticker, exc)
        return []


def _clinical_events_for_ticker(ticker: str) -> list[dict[str, Any]]:
    tk = ticker.strip().upper()
    paths = [
        Path("data") / "clinical_pre_cd_records.json",
        Path("data") / "cache" / "clinical_pre_cd_records.json",
    ]
    for path in paths:
        doc = _read_json(path)
        if not doc:
            continue
        rows = doc.get("records") or doc.get("rows") or doc
        if isinstance(rows, dict):
            rows = list(rows.values())
        if not isinstance(rows, list):
            continue
        out: list[dict[str, Any]] = []
        for rec in rows:
            if not isinstance(rec, dict):
                continue
            if str(rec.get("ticker") or "").strip().upper() != tk:
                continue
            for ev in list(rec.get("clinical_events") or []) + list(rec.get("timeline_events") or []):
                if isinstance(ev, dict):
                    out.append(ev)
        if out:
            return out
    return []


def _is_poisoned_empty_cache(cached: dict[str, Any]) -> bool:
    """
    Morning warm often wrote empty rows tagged only ``sec-api-8k`` after 429s
    (empty list still counted as a 'source'). Those must not stick for 18h.
    """
    if cached.get("governance_flag") or cached.get("filing_13d") or cached.get("silent_kind"):
        return False
    if (cached.get("buy_count_30d") or 0) > 0 or (cached.get("sell_count_30d") or 0) > 0:
        return False
    err = str(cached.get("error") or "")
    if err in {"providers_unavailable", "rate_limited"}:
        return True
    src = str(cached.get("source") or "")
    if cached.get("status") == "none" and src in {"", "sec-api-8k"} and (
        err == "no_silent_money_coverage" or not err
    ):
        return True
    return False


def _cache_is_fresh(path: Path, cached: dict[str, Any] | None, *, now: float, force: bool) -> bool:
    if force or cached is None or not path.is_file():
        return False
    if _is_poisoned_empty_cache(cached):
        return False
    age = now - path.stat().st_mtime
    err = str(cached.get("error") or "")
    ttl = _TTL_PROVIDER_FAIL_S if err in {"providers_unavailable", "rate_limited"} else _TTL_S
    return age < ttl


def _fetch_live_row(ticker: str) -> dict[str, Any]:
    tk = ticker.strip().upper()
    source_bits: list[str] = []
    provider_ok = False
    rate_limited = False

    form4_rows: list[dict[str, Any]] = []
    filings_13d: list[dict[str, Any]] = []
    gov_events: list[dict[str, Any]] = []

    try:
        from sec_api_client import (
            fetch_8k_item_502,
            fetch_insider_form4,
            fetch_schedule_13d_13g,
            sec_api_key,
            sec_api_rate_limited,
        )

        if sec_api_rate_limited():
            rate_limited = True
        elif sec_api_key():
            raw4 = fetch_insider_form4(tk, lookback_days=_LOOKBACK_D)
            if raw4 is not None:
                provider_ok = True
                form4_rows = normalize_sec_api_form4(raw4)
                if form4_rows:
                    source_bits.append("sec-api-form4")
            elif sec_api_rate_limited():
                rate_limited = True
            raw13 = fetch_schedule_13d_13g(tk, lookback_days=_13D_LOOKBACK_D)
            if raw13 is not None:
                provider_ok = True
                filings_13d = raw13
                if filings_13d:
                    source_bits.append("sec-api-13d")
            elif sec_api_rate_limited():
                rate_limited = True
            raw502 = fetch_8k_item_502(tk, lookback_days=_GOV_LOOKBACK_D)
            if raw502 is not None:
                provider_ok = True
                gov_events = raw502
                if gov_events:
                    source_bits.append("sec-api-8k")
            elif sec_api_rate_limited():
                rate_limited = True
    except Exception as exc:
        logger.warning("silent-money sec-api %s: %s", tk, exc)

    if not form4_rows:
        fmp4 = _fetch_form4_fmp(tk)
        if fmp4:
            form4_rows = fmp4
            provider_ok = True
            source_bits.append("fmp-form4")
    if not filings_13d:
        fmp13 = _fetch_13d_fmp(tk)
        if fmp13:
            filings_13d = fmp13
            provider_ok = True
            source_bits.append("fmp-13d")

    if not form4_rows or not filings_13d or not gov_events:
        try:
            from edgar_silent_money import fetch_silent_money_bundle

            bundle = fetch_silent_money_bundle(
                tk,
                form4_lookback_days=_LOOKBACK_D,
                lookback_13d_days=_13D_LOOKBACK_D,
                gov_lookback_days=_GOV_LOOKBACK_D,
                want_form4=not bool(form4_rows),
                want_13d=not bool(filings_13d),
                want_8k=not bool(gov_events),
            )
            if bundle is not None:
                provider_ok = True
                if not form4_rows and isinstance(bundle.get("form4"), list):
                    form4_rows = bundle["form4"]
                    if form4_rows:
                        source_bits.append("edgar-form4")
                if not filings_13d and isinstance(bundle.get("filings_13d"), list):
                    filings_13d = bundle["filings_13d"]
                    if filings_13d:
                        source_bits.append("edgar-13d")
                if not gov_events and isinstance(bundle.get("gov_events"), list):
                    gov_events = bundle["gov_events"]
                    if gov_events:
                        source_bits.append("edgar-8k")
        except Exception as exc:
            logger.warning("silent-money edgar %s: %s", tk, exc)

    if not gov_events:
        clinical = _clinical_events_for_ticker(tk)
        if clinical:
            gov_events = clinical
            provider_ok = True
            source_bits.append("clinical-8k")

    row = build_accumulation_row(
        tk,
        form4_rows=form4_rows,
        filings_13d=filings_13d,
        clinical_events=gov_events,
        source="+".join(source_bits) if source_bits else None,
    )
    empty = (
        row.get("status") == "none"
        and not row.get("filing_13d")
        and not row.get("governance_flag")
        and not row.get("silent_kind")
    )
    if empty:
        if rate_limited and not provider_ok:
            row["error"] = "rate_limited"
        elif not provider_ok:
            row["error"] = "providers_unavailable"
        else:
            row["error"] = "no_silent_money_coverage"
    return row


def fetch_catalyst_accumulation(
    tickers: str | list[str] | None = None,
    *,
    force: bool = False,
) -> dict[str, Any]:
    wanted = parse_tickers(tickers)
    payload: dict[str, Any] = {
        "updated_at": _now_iso(),
        "rows": {},
        "error": None,
        "note": "silent_money_form4_13d_excl_10b5_1",
    }
    if not wanted:
        payload["error"] = "empty_tickers"
        return payload

    now = time.time()
    for tk in wanted:
        path = _cache_path(tk)
        cached = _read_json(path)
        if _cache_is_fresh(path, cached, now=now, force=force):
            payload["rows"][tk] = cached
            continue
        try:
            row = _fetch_live_row(tk)
        except Exception as exc:
            logger.warning("silent-money fetch failed %s: %s", tk, exc)
            if cached:
                payload["rows"][tk] = cached
            continue
        # Do not overwrite a richer prior cache with a provider-failure empty.
        if (
            cached
            and row.get("error") in {"providers_unavailable", "rate_limited"}
            and not row.get("silent_kind")
            and not row.get("governance_flag")
            and not row.get("filing_13d")
            and (
                cached.get("silent_kind")
                or cached.get("governance_flag")
                or cached.get("filing_13d")
                or (cached.get("buy_count_30d") or 0) > 0
            )
        ):
            payload["rows"][tk] = cached
            continue
        _write_json(path, row)
        payload["rows"][tk] = row
    return payload


# Alias kept for API / scheduler naming from signal-2 brief.
fetch_catalyst_silent_money = fetch_catalyst_accumulation


def refresh_catalyst_accumulation_universe(*, force: bool = False) -> dict[str, Any]:
    tickers: list[str] = []
    try:
        from event_vol_index import upcoming_pairs_from_snapshots

        # Catalyst desk hot zone ≈ 2 months.
        tickers = parse_tickers([t for t, _ in upcoming_pairs_from_snapshots(60)])
    except Exception as exc:
        logger.warning("silent-money universe scan failed: %s", exc)
    return fetch_catalyst_accumulation(tickers, force=force)
