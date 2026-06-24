"""
Audit: studi clinical con esito textual classificabile (positivo vs negativo)
e incrocio sponsor Exact + presenza lista NASDAQ (proxy yfinance).

Uso:
  python scripts/outcome_nasdaq_audit.py

Percorsi relativi alla root progetto (cartella contenente ./data/).
Non importa data_orchestrator (evita carico modulo enorme).

Definizioni (euristiche, documentare in console):
  • Esito «controllabile»: polarità CT cache + titoli ≠ mix/unk
    (_clinical_polarity_hint su blob testuale — stesso elenco kw del core).
  • NASDAQ alla CD: metadati exchange «famiglia Nasdaq» +
    prima barra storico ≤ completion date +
    barra chiusura entro ±7 gg dalla CD.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

# Root = parent di scripts/
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CLINICAL_XLSX = DATA / "biotech_clinical_openfda.xlsx"
CTGOV_CACHE = DATA / "cache" / "ctgov_esito"


def _clinical_polarity_hint(txt: str) -> str:
    """Stessa euristica di data_orchestrator._clinical_polarity_hint (pos/neg/mix/unk)."""
    s = str(txt or "").strip()
    if len(s) < 16:
        return "unk"
    t = s.lower()
    pos_kw = (
        "met primary", "met the primary", "primary endpoint", "positive outcome",
        "statistically significant", "significantly improved", "significant improvement",
        "superiority", "superior to", "non-inferior", "noninferior", "non inferior",
        "efficacious", "demonstrated efficacy", "therapeutic benefit", "favorable",
        "favourable", "successful", "achieved the", "meets the primary",
        "superiorità", "significativamente", "endpoint primario", "esito positivo",
        "beneficio clinico", "miglioramento",
    )
    neg_kw = (
        "did not meet", "failed to meet", "did not achieve", "negative outcome",
        "no statistically significant", "not statistically significant",
        "statistically insignificant", "failed to demonstrate", "lack of efficacy",
        "halted due to futility", "stopped for futility", "terminated early",
        "inferiority", "did not improve", "no significant difference",
        "non ha raggiunto", "non significativo", "assenza di efficacia",
        "interruzione anticipata", "fallimento", "inefficace",
    )
    ph, nh = 0, 0
    for k in pos_kw:
        if k in t:
            ph += 1
    for k in neg_kw:
        if k in t:
            nh += 1
    if ph and nh:
        return "mix"
    if ph:
        return "pos"
    if nh:
        return "neg"
    return "unk"


def _pick_cd(row: pd.Series) -> date | None:
    for c in ("completion_date", "primary_completion_date"):
        if c not in row.index:
            continue
        v = row[c]
        if v is None or (isinstance(v, float) and pd.isna(v)):
            continue
        try:
            ts = pd.Timestamp(v)
            if pd.isna(ts):
                continue
            return ts.date()
        except Exception:
            continue
    return None


def _load_ct_summary(nct: str) -> dict | None:
    nid = (nct or "").strip().upper()
    if not nid.startswith("NCT"):
        return None
    p = CTGOV_CACHE / f"{nid}.json"
    if not p.is_file():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


def _outcome_blob(row: pd.Series, ct: dict | None) -> str:
    parts = [
        str(row.get("brief_title") or ""),
        str(row.get("official_title") or ""),
        str(row.get("conditions") or ""),
    ]
    if ct:
        parts.append(str(ct.get("summary") or ""))
        if ct.get("has_results") is True:
            parts.append("results table present clinicaltrials")
    return " ".join(p for p in parts if p and str(p).strip() != "nan")


def _nasdaq_family(info: dict) -> bool:
    blob = " ".join(
        str(info.get(k) or "")
        for k in ("exchange", "fullExchangeName", "quoteType")
    ).upper()
    markers = (
        "NASDAQ", "NMS", "NGM", "NCM", "GLOBAL SELECT", "CAPITAL MARKET",
        "GLOBAL MARKET",
    )
    return any(m in blob for m in markers)


def _trade_at_completion(sym: str, cd: date, yf_ticker) -> tuple[bool | None, str]:
    """
    None = errore/dato assente; True/False = giudizio proxy.
    """
    sym = str(sym or "").strip().upper()
    if not sym:
        return None, "no_symbol"
    try:
        t = yf_ticker.Ticker(sym)
        info = t.info or {}
    except Exception as e:
        return None, f"info_err:{e!r}"
    if not _nasdaq_family(info):
        return False, "exchange_not_nasdaq_family"

    # Storico: prima barra e presenza negoziazione intorno alla CD
    try:
        start = date(2000, 1, 1)
        end = cd + timedelta(days=21)
        h = t.history(start=start.isoformat(), end=end.isoformat(), auto_adjust=True)
    except Exception as e:
        return None, f"hist_err:{e!r}"

    if h is None or h.empty:
        return False, "no_history_before_cd_window"

    idx_dates: list[date] = []
    for x in h.index:
        try:
            xi = pd.Timestamp(x)
            if xi.tzinfo is not None:
                xi = xi.tz_convert("UTC").tz_localize(None)
            idx_dates.append(xi.date())
        except Exception:
            continue
    if not idx_dates:
        return None, "hist_bad_index"

    first_d = min(idx_dates)
    if first_d > cd:
        return False, f"first_bar_after_cd(first={first_d})"

    window = [d for d in idx_dates if abs((d - cd).days) <= 7]
    if not window:
        return False, "no_bar_within_7d_of_cd"

    return True, f"OK first={first_d} exchange={info.get('exchange')}"


def main() -> int:
    os.chdir(ROOT)
    if not CLINICAL_XLSX.is_file():
        print(f"Manca {CLINICAL_XLSX} — esegui prima l orchestrazione clinical.")
        return 1

    df = pd.read_excel(CLINICAL_XLSX)
    today = date.today()

    if "sponsor_match" not in df.columns:
        print("Colonna sponsor_match assente nel clinical.")
        return 1

    df = df.copy()
    df["_cd"] = df.apply(_pick_cd, axis=1)
    df = df[df["_cd"].notna()]
    df = df[df["_cd"] < today]

    df_ex = df[df["sponsor_match"].astype(str).str.strip().str.lower() == "exact"].copy()
    df_ex = df_ex[df_ex.get("nct_id", pd.Series([], dtype=str)).astype(str).str.startswith("NCT")]

    # Una riga per studio (NCT) — prima riga vince (stesso trial duplicato su righe ticker)
    df_ex_u = df_ex.drop_duplicates(subset=["nct_id"], keep="first")

    outcomes: list[tuple[str, date, str, str, str, str]] = []
    # nct, cd, polarity, ticker, blob_head, notes

    for _, row in df_ex_u.iterrows():
        nct = str(row.get("nct_id") or "").strip().upper()
        cd = row["_cd"]
        ct = _load_ct_summary(nct)
        blob = _outcome_blob(row, ct)
        pol = _clinical_polarity_hint(blob)
        tk = str(row.get("ticker") or "").strip().upper()

        notes = []
        if ct is None:
            notes.append("no_ct_cache")
        elif ct.get("has_results"):
            notes.append("hasResults_table")

        outcomes.append((nct, cd, pol, tk, blob[:120].replace("\n", " "), ",".join(notes)))

    n_total_exact = len(outcomes)
    pos = [o for o in outcomes if o[2] == "pos"]
    neg = [o for o in outcomes if o[2] == "neg"]
    mix = [o for o in outcomes if o[2] == "mix"]
    unk = [o for o in outcomes if o[2] == "unk"]

    # Strict "outcome check": solo pos o neg (no mix)
    checked = pos + neg

    print("=== Audit esito + NASDAQ (proxy) ===")
    print(f"File clinical: {CLINICAL_XLSX}")
    print(f"Studi unici NCT con sponsor_match=Exact e completion passata: {n_total_exact}")
    print(f"Polarità testo — pos: {len(pos)} | neg: {len(neg)} | mix: {len(mix)} | unk: {len(unk)}")
    print(
        f"Con «check esito» stretto (solo pos o neg, escluso mix): {len(checked)}"
    )

    try:
        import yfinance as yf
    except ImportError:
        print("yfinance non installato — salto verifica NASDAQ.")
        return 0

    # Solo righe con ticker e outcome stretto
    nasdaq_ok = 0
    nasdaq_fail = 0
    nasdaq_unk = 0
    yf_cache: dict[str, tuple[bool | None, str]] = {}

    for nct, cd, pol, tk, _, _note in checked:
        if not tk:
            nasdaq_unk += 1
            continue
        if tk not in yf_cache:
            yf_cache[tk] = _trade_at_completion(tk, cd, yf)
        ok, reason = yf_cache[tk]
        if ok is True:
            nasdaq_ok += 1
        elif ok is False:
            nasdaq_fail += 1
        else:
            nasdaq_unk += 1

    print(
        f"Tra i {len(checked)} con esito pos/neg e ticker presente: "
        f"NASDAQ+negoziazione intorno CD (proxy): {nasdaq_ok} | "
        f"non NASDAQ o non negoziata a CD: {nasdaq_fail} | "
        f"indeterminato (no ticker / errore API): {nasdaq_unk}"
    )

    # Criterio alternativo «check esito»: tabella risultati su ClinicalTrials.gov
    ct_hasres: list[tuple] = []
    for _, row in df_ex_u.iterrows():
        nct = str(row.get("nct_id") or "").strip().upper()
        cd = row["_cd"]
        ct = _load_ct_summary(nct)
        if not ct:
            continue
        if ct.get("has_results") is True:
            tk = str(row.get("ticker") or "").strip().upper()
            ct_hasres.append((nct, cd, tk))

    print(
        f"\nCon hasResults=true in cache CT.gov (misura «disclosure» sul registro): "
        f"{len(ct_hasres)} studi Exact (unici NCT)"
    )
    n2_ok = n2_bad = n2_u = 0
    yf2: dict[str, tuple[bool | None, str]] = {}
    try:
        import yfinance as yf
    except ImportError:
        yf = None
    if yf and ct_hasres:
        for _nct, cd, tk in ct_hasres:
            if not tk:
                n2_u += 1
                continue
            if tk not in yf2:
                yf2[tk] = _trade_at_completion(tk, cd, yf)
            ok2, _ = yf2[tk]
            if ok2 is True:
                n2_ok += 1
            elif ok2 is False:
                n2_bad += 1
            else:
                n2_u += 1
        print(
            f"  -> tra questi con ticker: NASDAQ+trade +/-7gg CD: {n2_ok} | "
            f"no: {n2_bad} | indet.: {n2_u}"
        )

    print(
        "\nNota: (1) pos/neg = keyword su titoli/cache; (2) hasResults = esito pubblicato "
        "in tabella CT (non implica segno); NASDAQ = proxy yfinance."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
