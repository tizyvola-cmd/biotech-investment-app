from __future__ import annotations

import os
import json
import pathlib
import subprocess
from copy import copy
import pandas as pd
from openpyxl.styles import PatternFill, Font, Alignment
from openpyxl.utils import get_column_letter
from openpyxl.formatting.rule import DataBarRule

from variation_colors import signed_pct_fill_font, linear_rgb_diverging
from orchestrator_io_paths import DATA_DIR, FINAL_JSON, FINAL_XLSX, RETROSPECTIVE_CONFIG_JSON

# ── Configurazione retrospettiva ──────────────────────────────────────────────
# Finestra in giorni per l'analisi prima/dopo ogni completion date clinica.
# Cambia questo valore per ottenere finestre diverse (es. 60, 90).
RETRO_WINDOW_DAYS  = 30
# File JSON: ticker fogli «Studio» e «IPO Snapshot» (max 5 in ``tickers``).
RETRO_CONFIG_FILE = RETROSPECTIVE_CONFIG_JSON

# ── Colori variazioni (rosso=negativo, verde=positivo) ────────────────────────
FILL_RED   = PatternFill("solid", fgColor="FF4C4C")
FILL_GREEN = PatternFill("solid", fgColor="5CDB5C")
FONT_WHITE = Font(bold=True, color="FFFFFF")
FONT_DARK  = Font(bold=True, color="222222")


# ── Stili intestazione / descrizione / riepilogo ──────────────────────────────
HEADER_FILL  = PatternFill("solid", fgColor="4472C4")
HEADER_FONT  = Font(bold=True, color="FFFFFF")
SUMMARY_FILL = PatternFill("solid", fgColor="BDD7EE")
SUMMARY_FONT = Font(bold=True, color="1F3864")
DESC_FILL    = PatternFill("solid", fgColor="D9E1F2")
DESC_FONT    = Font(italic=True, color="444444", size=10)
STATS_FILL   = PatternFill("solid", fgColor="E2EFDA")   # verde tenue per riga stats
STATS_FONT   = Font(bold=True,  color="375623", size=11)
ZEBRA_FILL   = PatternFill("solid", fgColor="F5F5F5")

# ── Allineamenti ──────────────────────────────────────────────────────────────
ALIGN_LEFT   = Alignment(horizontal="left",   vertical="center")
ALIGN_RIGHT  = Alignment(horizontal="right",  vertical="center")
ALIGN_CENTER = Alignment(horizontal="center", vertical="center")

# ── Colonne variazione (rosso/verde) ─────────────────────────────────────────
VARIATION_COLS = ["variation_1m_%", "variation_3m_%", "variation_6m_%", "variation_9m_%"]

# ── Ordine canonico colonne (Financial e Catalysts) ──────────────────────────
# Fonte: Yahoo Finance è prioritaria; Finnhub duplicati vengono eliminati.
_COL_ORDERED = [
    # Identità azienda
    "companyName",
    "symbol",
    "cik",
    "industry",
    "sector",
    # Fondamentali (solo Yahoo Finance)
    "marketCap",
    "enterpriseValue",
    # Volatilità e prezzi chiave
    "beta",
    "currentPrice",
    "last_close",
    "highPrice",
    "lowPrice",
    # Variazioni %
    "dailyChange_%",
    "variation_1m_%_variations",
    "variation_3m_%_variations",
    "variation_6m_%_variations",
    "variation_9m_%_variations",
    # Medie storiche chiusura
    "avg_1m_close",
    "avg_3m_close",
    "avg_6m_close",
    "avg_9m_close",
]

_COL_ORDERED_SET = set(_COL_ORDERED)

def _apply_col_order(df: "pd.DataFrame") -> "pd.DataFrame":
    """Riordina le colonne secondo _COL_ORDERED; le colonne extra vanno in coda."""
    ordered = [c for c in _COL_ORDERED if c in df.columns]
    rest    = [c for c in df.columns if c not in _COL_ORDERED_SET]
    return df[ordered + rest]

# ── Colonne con data bar (numerici principali) ────────────────────────────────
DATA_BAR_COLS = [
    "marketCap", "enterpriseValue",
    "currentPrice", "last_close",
    "avg_1m_close", "avg_3m_close", "avg_6m_close", "avg_9m_close",
]

_DATABAR_GREEN_CAP_PRICE = "70AD47"
_DATABAR_BLUE_OTHER       = "4472C4"


def _data_bar_hex(col_name: str) -> str:
    if col_name in ("marketCap", "currentPrice"):
        return _DATABAR_GREEN_CAP_PRICE
    return _DATABAR_BLUE_OTHER


# ── Colonne con color scale (gradiente rosso→giallo→verde) ────────────────────
COLOR_SCALE_COLS = [
    "dailyChange_%",
    "highPrice", "lowPrice",
    "variation_1m_%_variations", "variation_3m_%_variations",
    "variation_6m_%_variations", "variation_9m_%_variations",
]

# ── Formati numerici Excel ────────────────────────────────────────────────────
FMT_BILLIONS  = '#,##0.0,,,"B"'              # valore raw (es. 12_400_000_000) → 12.4B
FMT_VARIATION = '+0.00"%";-0.00"%";0.00"%"'  # 8.5 → +8.50%, -5 → -5.00%
FMT_BETA      = "#,##0.00"
FMT_PRICE     = "#,##0.0000"                 # separatore migliaia + 4 decimali

NUMERIC_COLS_FMT = {
    "marketCap":                    FMT_BILLIONS,
    "enterpriseValue":              FMT_BILLIONS,
    "beta":                         FMT_BETA,
    "currentPrice":                 FMT_PRICE,
    "last_close":                   FMT_PRICE,
    "highPrice":                    FMT_PRICE,
    "lowPrice":                     FMT_PRICE,
    "dailyChange_%":                FMT_VARIATION,
    "variation_1m_%_variations":    FMT_VARIATION,
    "variation_3m_%_variations":    FMT_VARIATION,
    "variation_6m_%_variations":    FMT_VARIATION,
    "variation_9m_%_variations":    FMT_VARIATION,
    "avg_1m_close":                 FMT_PRICE,
    "avg_3m_close":                 FMT_PRICE,
    "avg_6m_close":                 FMT_PRICE,
    "avg_9m_close":                 FMT_PRICE,
    # Colonne interne variations (non mostrate di default, ma formattate se presenti)
    "variation_1m_%":               FMT_VARIATION,
    "variation_3m_%":               FMT_VARIATION,
    "variation_6m_%":               FMT_VARIATION,
    "variation_9m_%":               FMT_VARIATION,
}

# ── Colonne da escludere dall'output Financial (duplicati e non richieste) ────
COLUMNS_TO_DROP = {
    # Target price (non richiesti)
    "targetHigh", "targetLow", "targetMean", "targetMedian", "targetPrice",
    "variation_52w_%",
    # Duplicati Finnhub (Yahoo Finance è prioritario)
    "marketCap_finnhub",
    "currentPrice_finnhub",
    "percentChange",        # stesso di dailyChange_% ma da Finnhub
    "change",               # variazione $ giornaliera Finnhub, non richiesta
    "prevClose",            # stesso di previousClose/last_close ma da Finnhub
    "openPrice",            # prezzo apertura Finnhub, non richiesto
    # Duplicato YF (usiamo last_close da variations che è più aggiornato)
    "previousClose",
}

# ── Descrizioni colonne ───────────────────────────────────────────────────────
COLUMN_DESCRIPTIONS = {
    "companyName":     "Nome completo dell'azienda",
    "symbol":          "Ticker del titolo in borsa",
    "cik":             "CIK SEC EDGAR (Central Index Key) — identificatore univoco SEC per depositi normativi",
    "industry":        "Sotto-settore specifico (es. Biotechnology)",
    "sector":          "Settore macro di appartenenza (es. Healthcare)",
    "marketCap":       "Market Cap Yahoo Finance: prezzo × azioni in circolazione",
    "enterpriseValue": "EV = Market Cap + debito - cassa. Il valore reale dell'azienda",
    "beta":            "Volatilità vs mercato. >2=rosso, 1.5-2=arancione, 1-1.5=giallo, <1=verde",
    "currentPrice":    "Prezzo corrente del titolo (Yahoo Finance)",
    "last_close":      "Ultimo prezzo di chiusura disponibile (da storico yfinance)",
    "highPrice":       "Prezzo massimo intraday (Finnhub)",
    "lowPrice":        "Prezzo minimo intraday (Finnhub)",
    "dailyChange_%":   "Variazione % giornaliera: (currentPrice - previousClose) / previousClose",
    "variation_1m_%_variations":   "Var% 1M: (last_close - avg_1m_close) / avg_1m_close",
    "variation_3m_%_variations":   "Var% 3M: (last_close - avg_3m_close) / avg_3m_close",
    "variation_6m_%_variations":   "Var% 6M: (last_close - avg_6m_close) / avg_6m_close",
    "variation_9m_%_variations":   "Var% 9M: (last_close - avg_9m_close) / avg_9m_close",
    "avg_1m_close":    "Media chiusure ±1g attorno a 1 mese fa (21 trading days)",
    "avg_3m_close":    "Media chiusure ±1g attorno a 3 mesi fa (63 trading days)",
    "avg_6m_close":    "Media chiusure ±1g attorno a 6 mesi fa (126 trading days)",
    "avg_9m_close":    "Media chiusure ±1g attorno a 9 mesi fa (189 trading days)",
    "currency":        "Valuta di quotazione",
    "country":         "Paese di sede legale",
    "website":         "Sito web ufficiale",
}

YF_JSON         = os.path.join(DATA_DIR, "yf.json")
FINNHUB_JSON    = os.path.join(DATA_DIR, "finnhub.json")
VARIATIONS_JSON = os.path.join(DATA_DIR, "variations.json")
CLINICAL_XLSX   = os.path.join(DATA_DIR, "biotech_clinical_openfda.xlsx")
_CTGOV_ESITO_CACHE = os.path.join(DATA_DIR, "cache", "ctgov_esito")

# Cohorte retro (vedi data_orchestrator.RETRO_CALIB_COHORT): v4 | v5 | v6, default v5.
_RAW_FE_RETRO_COHORT = os.environ.get("RETRO_CALIB_COHORT", "v5").strip().lower()
FE_RETRO_CALIB_COHORT = (
    _RAW_FE_RETRO_COHORT if _RAW_FE_RETRO_COHORT in ("v4", "v5", "v6") else "v5")

INCOMPLETE_DATASET_LABEL = "incomplete dataset"


def _fe_clinical_polarity_hint(txt: str) -> str:
    """Allineato a data_orchestrator._clinical_polarity_hint (pos/neg/mix/unk)."""
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


def _fe_retro_outcome_known_from_row(row: "pd.Series", nct_id: str) -> bool:
    """Stessa logica orchestrator `_retro_outcome_known_from_row` (solo disco, no HTTP)."""
    nid = str(nct_id or "").strip().upper()
    has_results = None
    summary_txt = ""
    if nid.startswith("NCT"):
        safe = "".join(ch for ch in nid if ch.isalnum())
        jpath = os.path.join(_CTGOV_ESITO_CACHE, f"{safe}.json")
        if os.path.isfile(jpath):
            try:
                data = json.loads(
                    pathlib.Path(jpath).read_text(encoding="utf-8", errors="replace"))
                if isinstance(data, dict):
                    _hr = data.get("has_results")
                    has_results = bool(_hr) if _hr is not None else None
                    summary_txt = str(data.get("summary") or "")
            except Exception:
                pass
    if has_results is True:
        return True
    parts: list[str] = []
    for c in ("brief_title", "official_title", "conditions"):
        if c in row.index:
            parts.append(str(row.get(c) or ""))
    parts.append(summary_txt)
    blob = " ".join(p for p in parts if p and str(p).strip().lower() != "nan")
    return _fe_clinical_polarity_hint(blob) in ("pos", "neg")

SEC_CIK_JSON    = os.path.join(DATA_DIR, "sec_company_tickers.json")  # cache locale SEC EDGAR


# ─────────────────────────────────────────────────────────────────────────────
# Funzioni di stile
# ─────────────────────────────────────────────────────────────────────────────

def color_for_variation(value):
    """Scala blu/ambra proporzionale (variation_colors)."""
    return signed_pct_fill_font(value, max_abs=25.0)


# Colori fissi per beta
FILL_BETA_GREEN  = PatternFill("solid", fgColor="C6EFCE")  # <1    verde pastello
FILL_BETA_YELLOW = PatternFill("solid", fgColor="FFFD75")  # 1–1.5 giallo pastello
FILL_BETA_ORANGE = PatternFill("solid", fgColor="FFEB9C")  # 1.5–2 arancione pastello
FILL_BETA_RED    = PatternFill("solid", fgColor="FFC7CE")  # >2    rosso pastello

def _beta_fill(value):
    """Restituisce il PatternFill per beta con soglie fisse: <1=verde, 1-1.5=giallo, 1.5-2=arancione, >2=rosso."""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    if v > 2:
        return FILL_BETA_RED
    if v >= 1.5:
        return FILL_BETA_ORANGE
    if v >= 1:
        return FILL_BETA_YELLOW
    return FILL_BETA_GREEN


def _linear_rgb(t):
    """Gradiente colonna min→max: blu → neutro → ambra (variation_colors)."""
    return linear_rgb_diverging(t)


def apply_linear_coloring(ws, col_idx, series, data_start_row):
    """
    Coloring ancorato a media ± 2σ (coerente con la riga statistiche del foglio).
      t=0 → mean−2σ (blu), t=0.5 → mean (neutro), t=1 → mean+2σ (ambra).
    Valori oltre ±2σ vengono clampati al colore estremo.
    """
    s = pd.to_numeric(series, errors="coerce").dropna()
    if len(s) < 2:
        return
    mean = float(s.mean())
    std  = float(s.std())
    if std == 0:
        return
    lo   = mean - 2 * std   # t = 0  → rosso
    span = 4 * std           # range totale (mean-2σ … mean+2σ)
    for row_offset, raw_val in enumerate(series):
        try:
            v = float(raw_val)
        except (TypeError, ValueError):
            continue
        t = max(0.0, min(1.0, (v - lo) / span))
        ws.cell(row=data_start_row + row_offset, column=col_idx).fill = PatternFill(
            "solid", fgColor=_linear_rgb(t)
        )


def apply_linear_coloring_at_positions(ws, col_idx, row_positions, raw_values):
    """
    Versione di apply_linear_coloring per righe NON consecutive.
    row_positions : lista di numeri di riga Excel (1-indexed)
    raw_values    : lista di valori corrispondenti (stesso ordine)
    La scala media±2σ è calcolata sull'intera serie, come nella versione normale.
    """
    s = pd.to_numeric(pd.Series(raw_values), errors="coerce").dropna()
    if len(s) < 2:
        return
    mean = float(s.mean())
    std  = float(s.std())
    if std == 0:
        return
    lo   = mean - 2 * std
    span = 4 * std
    for rn, raw_val in zip(row_positions, raw_values):
        try:
            v = float(raw_val)
        except (TypeError, ValueError):
            continue
        t = max(0.0, min(1.0, (v - lo) / span))
        ws.cell(row=rn, column=col_idx).fill = PatternFill("solid", fgColor=_linear_rgb(t))


def style_header_row(ws, ncols):
    for col_idx in range(1, ncols + 1):
        cell = ws.cell(row=1, column=col_idx)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = ALIGN_CENTER


def auto_col_width(ws, df, cols):
    for col_idx, col_name in enumerate(cols, start=1):
        header_len = len(str(col_name)) + 2
        if col_name in NUMERIC_COLS_FMT:
            data_len = 12
        else:
            try:
                data_len = int(df[col_name].dropna().astype(str).str.len().max()) + 2
            except Exception:
                data_len = 12
        width = max(header_len, data_len, 10)
        ws.column_dimensions[get_column_letter(col_idx)].width = min(width, 42)


def apply_financial_sheet_style(ws, df, data_start_row=3):
    cols = list(df.columns)
    col_map = {col: idx + 1 for idx, col in enumerate(cols)}
    nrows = len(df)

    var_col_indices = {
        col: col_map[col] for col in VARIATION_COLS if col in col_map
    }

    # Larghezze automatiche
    auto_col_width(ws, df, cols)

    # Colonne con CF a curva normale: il zebra NON va applicato (evita doppio strato)
    _cf_cols = set(COLOR_SCALE_COLS)

    # Righe dati: zebra (solo colonne non-CF) + allineamento centrato + formato numeri
    for row_offset in range(nrows):
        row_idx = data_start_row + row_offset
        for col_idx, col_name in enumerate(cols, start=1):
            cell = ws.cell(row=row_idx, column=col_idx)
            if row_offset % 2 == 1 and col_name not in _cf_cols:
                cell.fill = ZEBRA_FILL
            cell.alignment = ALIGN_CENTER
            if col_name in NUMERIC_COLS_FMT:
                cell.number_format = NUMERIC_COLS_FMT[col_name]

    # Colori rosso/verde sulle colonne variazione % (sovrascrivono zebra)
    for row_offset in range(nrows):
        row_idx = data_start_row + row_offset
        for col_name, col_idx in var_col_indices.items():
            cell = ws.cell(row=row_idx, column=col_idx)
            try:
                val = float(cell.value) if cell.value is not None else None
            except (TypeError, ValueError):
                val = None
            fill, font = color_for_variation(val)
            if fill:
                cell.fill = fill
                cell.font = font

    last_data_row = data_start_row + nrows - 1

    # Data bar — verde Market Cap / Prezzo; blu altre colonne DATA_BAR
    for col_name in DATA_BAR_COLS:
        if col_name not in col_map:
            continue
        col_letter = get_column_letter(col_map[col_name])
        ws.conditional_formatting.add(
            f"{col_letter}{data_start_row}:{col_letter}{last_data_row}",
            DataBarRule(
                start_type="min", start_value=0,
                end_type="max",   end_value=100,
                color=_data_bar_hex(col_name), showValue=True,
            ),
        )

    # Coloring lineare — min=rosso, max=verde, interpolazione per colonna indipendente
    for col_name in COLOR_SCALE_COLS:
        if col_name not in col_map or col_name not in df.columns:
            continue
        apply_linear_coloring(ws, col_map[col_name], df[col_name], data_start_row)

    # Beta — soglie fisse: <1=verde, 1-1.5=giallo, 1.5-2=arancione, >2=rosso
    if "beta" in col_map:
        beta_col_idx = col_map["beta"]
        for row_offset in range(nrows):
            cell = ws.cell(row=data_start_row + row_offset, column=beta_col_idx)
            fill = _beta_fill(cell.value)
            if fill:
                cell.fill = fill


# ─────────────────────────────────────────────────────────────────────────────
# Fogli speciali
# ─────────────────────────────────────────────────────────────────────────────

def write_errors_sheet(workbook, master_df):
    error_cols = [c for c in master_df.columns if "error" in c.lower()]
    if not error_cols:
        return

    mask = master_df[error_cols].apply(
        lambda col: col.astype(str).str.strip().replace({"nan": "", "None": ""}) != ""
    ).any(axis=1)
    errors_df = master_df[mask][["symbol"] + error_cols].copy()

    if errors_df.empty:
        return

    ws = workbook.create_sheet("Errors")
    ws.sheet_properties.tabColor = "FF4C4C"
    cols = list(errors_df.columns)

    for col_idx, col_name in enumerate(cols, start=1):
        cell = ws.cell(row=1, column=col_idx, value=col_name)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        ws.column_dimensions[get_column_letter(col_idx)].width = 30

    ws.freeze_panes = "A2"

    ERROR_FILL = PatternFill("solid", fgColor="FFD6D6")
    ERROR_FONT = Font(color="990000")

    for row_idx, (_, row) in enumerate(errors_df.iterrows(), start=2):
        for col_idx, col_name in enumerate(cols, start=1):
            cell = ws.cell(row=row_idx, column=col_idx, value=row.get(col_name, ""))
            if col_name != "symbol":
                cell.fill = ERROR_FILL
                cell.font = ERROR_FONT

    print(f"[Errors sheet] {len(errors_df)} simboli con errori.")


# ─────────────────────────────────────────────────────────────────────────────
# Modality detection
# ─────────────────────────────────────────────────────────────────────────────

_MODALITY_RULES = [
    # ordine: più specifico → più generico
    ("Cell Therapy",     ["car-t", "car t", "chimeric antigen", "cell therapy",
                          "adoptive cell", "til therapy", "nk cell therapy",
                          "dendritic cell", "tumor-infiltrating"]),
    ("Gene Therapy",     ["gene therapy", "gene transfer", "gene editing", "crispr",
                          "aav", "adeno-associated", "lentiviral", "retroviral vector",
                          "viral vector", "zinc finger nuclease", "talen"]),
    ("RNA Therapy",      ["mrna", "sirna", "antisense oligonucleotide", " aso",
                          "rna interference", "rnai", "small interfering rna",
                          "rna therapy", "nucleotide therapy", "aptamer"]),
    ("Advanced Therapy", ["atmp", "advanced therapy medicinal", "tissue engineering",
                          "somatic cell therapy"]),
    ("Antibody",         ["antibody", "monoclonal antibody", " mab", "bispecific",
                          "checkpoint inhibitor", "immunoglobulin", " igg", " iga",
                          "antibody-drug conjugate", " adc", "nanobody",
                          "single-chain", "scfv"]),
    ("Small Molecule",   ["small molecule", "kinase inhibitor", "protease inhibitor",
                          "tyrosine kinase", "oral tablet", "oral capsule",
                          "low molecular weight"]),
]

_MODALITY_COLORS = {
    "Cell Therapy":     "E2B4FF",   # viola chiaro
    "Gene Therapy":     "B4C7E7",   # blu polvere
    "RNA Therapy":      "B4EAD7",   # verde acqua
    "Advanced Therapy": "FFE699",   # oro chiaro
    "Antibody":         "FFB4B4",   # rosso salmone
    "Small Molecule":   "D9D9D9",   # grigio neutro
    "Other":            "F2F2F2",   # grigio chiarissimo
}


def detect_modality(row) -> str:
    """
    Rileva la modalità terapeutica da un dict/Series di dati clinici.
    Controlla titolo, nome intervento, tipo intervento e descrizione.
    """
    TEXT_FIELDS = [
        "brief_title", "official_title", "BriefTitle", "OfficialTitle",
        "study_title", "title",
        "intervention_name", "InterventionName", "drug_name", "brand_name",
        "intervention_type", "InterventionType",
        "description", "study_description", "BriefSummary",
    ]
    combined = " ".join(
        str(row.get(f, "") or "") for f in TEXT_FIELDS
    ).lower()

    for modality, keywords in _MODALITY_RULES:
        if any(kw in combined for kw in keywords):
            return modality
    return "Other"


def add_modality_column(df: pd.DataFrame) -> pd.DataFrame:
    """Aggiunge colonna 'Modality' al clinical_df (in-place copy)."""
    df = df.copy()
    df["Modality"] = df.apply(detect_modality, axis=1)
    return df


# ── Mapping CIK → ticker via SEC EDGAR (cache locale) ────────────────────────

def _load_sec_cik_map(force_refresh: bool = False) -> dict:
    """
    Restituisce due dict:
      cik_to_ticker : str(CIK) → ticker.upper()   (es. "1682852" → "MRNA")
      name_to_ticker: _norm(nome) → ticker.upper() (da SEC, complementa financial_df)

    Il file viene scaricato UNA SOLA VOLTA da SEC EDGAR e salvato in
    data/sec_company_tickers.json  (cache locale, refresh solo se force_refresh=True
    o se il file ha più di 30 giorni).

    Formato SEC:
      {"0": {"cik_str": "320193", "ticker": "AAPL", "title": "Apple Inc."},
       "1": {"cik_str": "1682852", "ticker": "MRNA", "title": "Moderna, Inc."}, ...}
    """
    import json as _json
    import urllib.request as _ur
    import time as _time
    import os as _os2

    cache = _os2.path.join(DATA_DIR, "sec_company_tickers.json")
    _SEC_URL = "https://www.sec.gov/files/company_tickers.json"
    _MAX_AGE_DAYS = 30

    # Scarica se non esiste o troppo vecchio o forzato
    need_download = force_refresh
    if not need_download:
        if not _os2.path.exists(cache):
            need_download = True
        else:
            age_days = (_time.time() - _os2.path.getmtime(cache)) / 86400
            if age_days > _MAX_AGE_DAYS:
                need_download = True

    if need_download:
        try:
            print(f"[CIK] Download SEC EDGAR company_tickers.json…")
            req = _ur.Request(_SEC_URL,
                              headers={"User-Agent": "biotech-tool research@example.com"})
            with _ur.urlopen(req, timeout=30) as resp:
                raw = resp.read().decode("utf-8")
            _os2.makedirs(DATA_DIR, exist_ok=True)
            with open(cache, "w", encoding="utf-8") as fh:
                fh.write(raw)
            print(f"[CIK] Salvato → {cache}")
        except Exception as _dl_err:
            print(f"[CIK] Download fallito ({_dl_err}); uso cache esistente se disponibile")

    cik_to_ticker: dict = {}
    name_to_ticker: dict = {}
    if not _os2.path.exists(cache):
        print("[CIK] Nessuna cache disponibile — mapping CIK disabilitato")
        return cik_to_ticker, name_to_ticker

    try:
        import re as _re2
        def _sec_norm(s):
            """Normalizza inline (stessa logica di _norm, evita dipendenza circolare)."""
            if not s or not isinstance(s, str): return ""
            return " ".join(_re2.sub(r"[,.\-/]", " ", s.lower()).split())

        with open(cache, encoding="utf-8") as fh:
            data = _json.load(fh)
        for entry in data.values():
            tk  = str(entry.get("ticker", "") or "").strip().upper()
            cik = str(entry.get("cik_str", "") or "").strip().lstrip("0")
            nm  = str(entry.get("title",  "") or "").strip()
            if not tk:
                continue
            if cik:
                cik_to_ticker[cik] = tk
            if nm:
                name_to_ticker[_sec_norm(nm)] = tk
        print(f"[CIK] Mapping caricato: {len(cik_to_ticker)} CIK, "
              f"{len(name_to_ticker)} nomi azienda")
    except Exception as _ld_err:
        print(f"[CIK] Errore caricamento cache: {_ld_err}")

    return cik_to_ticker, name_to_ticker


# ── Sponsor match (calcolato nell'orchestrator in modo autonomo) ───────────────

def _norm(s) -> str:
    """Normalizza stringa: minuscolo, rimuove punteggiatura, collassa spazi."""
    if not s or not isinstance(s, str):
        return ""
    import re as _re
    return " ".join(_re.sub(r"[,.\-/]", " ", s.lower()).split())


# Parole generiche che appaiono in decine di nomi aziendali e non hanno
# valore discriminante — escluse dal confronto a parole.
_SPONSOR_STOPWORDS: frozenset[str] = frozenset({
    "inc", "ltd", "llc", "corp", "co", "sa", "se", "ag", "nv", "bv", "plc",
    "gmbh", "ab", "as", "oy", "spa", "srl",
    "pharmaceuticals", "pharmaceutical", "pharma",
    "therapeutics", "therapeutic",
    "biosciences", "bioscience", "biopharmaceuticals", "biopharmaceutical",
    "oncology", "health", "sciences", "science",
    "global", "medical", "healthcare", "biotechnology", "biotech",
    "laboratories", "laboratory", "labs", "lab",
    "research", "development", "innovations", "innovation",
    "holdings", "holding", "group", "international", "institute",
    "university", "hospital", "center", "centre",
})


def _match_one_orch(q: str, candidate: str) -> str:
    """
    Restituisce 'Exact', 'Partial' o '' (nessun match) tra q e candidate
    già normalizzati.

    Regole (in ordine di priorità):
      1. Identici dopo normalizzazione                       → Exact
      2. Substring bidirezionale                            → Partial
      3. Overlap parole significative ≥ 70%                 → Partial
         (parole generiche escluse via _SPONSOR_STOPWORDS)
      4. Similarità caratteri SequenceMatcher ≥ 0.85        → Partial
         (cattura abbreviazioni, typo, varianti minori)
    """
    from difflib import SequenceMatcher as _SM

    if not candidate:
        return ""

    # 1. Exact
    if q == candidate:
        return "Exact"

    # 2. Substring — promuovi a Exact se la differenza è solo stopword
    if q in candidate or candidate in q:
        _longer  = q if len(q) >= len(candidate) else candidate
        _shorter = candidate if len(q) >= len(candidate) else q
        _extra   = set(_longer.split()) - set(_shorter.split())
        if not (_extra - _SPONSOR_STOPWORDS):
            return "Exact"   # es. "Ocuphire Pharma Inc" vs "Ocuphire Pharma"
        return "Partial"

    # 3. Word overlap — solo parole significative
    q_words = set(q.split()) - _SPONSOR_STOPWORDS
    c_words = set(candidate.split()) - _SPONSOR_STOPWORDS
    if q_words:                           # se restano parole dopo le stopword
        common = q_words & c_words
        if common and len(common) / len(q_words) >= 0.70:
            return "Partial"

    # 4. Similarità caratteri (abbreviazioni / typo)
    if _SM(None, q, candidate).ratio() >= 0.85:
        return "Partial"

    return ""


def _compute_sponsor_match(query_company: str,
                            lead_sponsor: str = "",
                            responsible_party_org: str = "",
                            collaborators: str = "") -> str:
    """
    Confronta query_company con:
      - lead_sponsor
      - responsible_party_org   ("Information provided by" su CT.gov)
      - ogni collaboratore      (lista separata da '|')

    Valori: "Exact" | "Partial" | "No match" | "N/D"
    """
    q = _norm(str(query_company))
    if not q:
        return "N/D"

    candidates = []
    for raw in [lead_sponsor, responsible_party_org]:
        v = _norm(str(raw or ""))
        if v:
            candidates.append(v)
    for part in str(collaborators or "").split("|"):
        v = _norm(part)
        if v:
            candidates.append(v)

    if not candidates:
        return "N/D"

    best = ""
    for cand in candidates:
        res = _match_one_orch(q, cand)
        if res == "Exact":
            return "Exact"
        if res == "Partial":
            best = "Partial"
    return best if best else "No match"


def add_sponsor_match_column(df: pd.DataFrame) -> pd.DataFrame:
    """
    Aggiunge/ricalcola la colonna 'sponsor_match' nel clinical_df.
    Funziona anche se il CSV/Excel precedente non aveva la colonna
    o era stato generato con logica più limitata (solo lead_sponsor).
    Controlla: lead_sponsor + responsible_party_org + collaborators.
    """
    df = df.copy()
    if "lead_sponsor" not in df.columns:
        df["sponsor_match"] = "N/D"
        return df

    df["sponsor_match"] = df.apply(
        lambda row: _compute_sponsor_match(
            query_company         = str(row.get("query_company",         "") or ""),
            lead_sponsor          = str(row.get("lead_sponsor",          "") or ""),
            responsible_party_org = str(row.get("responsible_party_org", "") or ""),
            collaborators         = str(row.get("collaborators",         "") or ""),
        ),
        axis=1,
    )
    return df


def write_clinical_sheet(workbook, clinical_df):
    ws = workbook.create_sheet("Clinical_OpenFDA")
    ws.sheet_properties.tabColor = "5CDB5C"
    cols = list(clinical_df.columns)

    company_col      = "query_company" if "query_company" in cols else None
    match_col        = "company_match"  if "company_match"  in cols else None
    ticker_col       = "ticker"         if "ticker"         in cols else None
    spon_match_col   = "sponsor_match"  if "sponsor_match"  in cols else None

    for col_idx, col_name in enumerate(cols, start=1):
        cell = ws.cell(row=1, column=col_idx, value=col_name)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        ws.column_dimensions[get_column_letter(col_idx)].width = 22

    ws.freeze_panes = "A2"
    row_idx = 2

    # Larghezza maggiore per Modality e titolo
    modality_col_idx = (cols.index("Modality") + 1) if "Modality" in cols else None
    for col_idx, col_name in enumerate(cols, start=1):
        if col_name == "Modality":
            ws.column_dimensions[get_column_letter(col_idx)].width = 18
        elif col_name in ("brief_title", "BriefTitle", "study_title", "title", "official_title"):
            ws.column_dimensions[get_column_letter(col_idx)].width = 46

    def _apply_modality_fill(cell, modality_val):
        color = _MODALITY_COLORS.get(str(modality_val), _MODALITY_COLORS["Other"])
        cell.fill = PatternFill("solid", fgColor=color)
        cell.font = Font(bold=True, size=9, color="1A1A1A")
        cell.alignment = ALIGN_CENTER

    if company_col:
        try:
            ws.sheet_properties.outlinePr.summaryBelow = True
        except Exception:
            pass

        groups = clinical_df.groupby(company_col, sort=True)

        for company_name, group_df in groups:
            for _, data_row in group_df.iterrows():
                for col_idx, col_name in enumerate(cols, start=1):
                    cell = ws.cell(row=row_idx, column=col_idx,
                                   value=data_row.get(col_name, ""))
                    if col_name == "Modality":
                        _apply_modality_fill(cell, data_row.get("Modality", "Other"))
                ws.row_dimensions[row_idx].outline_level = 1
                ws.row_dimensions[row_idx].hidden = True
                row_idx += 1

            first_row = group_df.iloc[0]
            # sponsor_match: valore più frequente nel gruppo (esclude N/D se possibile)
            if spon_match_col:
                sm_counts = group_df[spon_match_col].value_counts()
                spon_val = sm_counts.index[0] if not sm_counts.empty else ""
            else:
                spon_val = ""
            for col_idx, col_name in enumerate(cols, start=1):
                if col_name == company_col:
                    val = company_name
                elif col_name == match_col:
                    val = first_row.get(match_col, "") if match_col else ""
                elif col_name == ticker_col:
                    val = first_row.get(ticker_col, "") if ticker_col else ""
                elif col_name == spon_match_col:
                    val = spon_val
                else:
                    val = ""
                cell = ws.cell(row=row_idx, column=col_idx, value=val)
                cell.fill = SUMMARY_FILL
                cell.font = SUMMARY_FONT
                # colore semantico sponsor_match nella riga riepilogo
                if col_name == spon_match_col and spon_val:
                    sm_color = {"Exact": "C6EFCE", "Partial": "FFEB9C", "No match": "FFC7CE"}.get(spon_val)
                    if sm_color:
                        cell.fill = PatternFill("solid", fgColor=sm_color)
                        cell.font = Font(bold=True, size=9)
            row_idx += 1
    else:
        for _, data_row in clinical_df.iterrows():
            for col_idx, col_name in enumerate(cols, start=1):
                cell = ws.cell(row=row_idx, column=col_idx,
                               value=data_row.get(col_name, ""))
                if col_name == "Modality":
                    _apply_modality_fill(cell, data_row.get("Modality", "Other"))
            row_idx += 1


def _extract_catalyst_dates(clinical_df) -> dict:
    """
    Ritorna dict {ticker_upper: earliest_completion_date} per gli studi
    con completion date nei prossimi 60 giorni — stessa logica del sheet Catalysts_60d.
    """
    from datetime import date as _date, timedelta
    _DATE_CANDS   = ["primary_completion_date", "completion_date",
                     "study_completion_date", "estimated_completion_date", "end_date"]
    _TICKER_CANDS = ["ticker", "symbol"]

    if clinical_df is None or clinical_df.empty:
        return {}

    date_col   = next((c for c in _DATE_CANDS   if c in clinical_df.columns), None)
    ticker_col = next((c for c in _TICKER_CANDS if c in clinical_df.columns), None)
    if not date_col or not ticker_col:
        return {}

    df = clinical_df.copy()
    df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
    today   = _date.today()
    horizon = today + timedelta(days=60)
    mask    = (df[date_col].dt.date >= today) & (df[date_col].dt.date <= horizon)
    cat_df  = df[mask].dropna(subset=[date_col]).sort_values(date_col)

    result = {}
    for _, row in cat_df.iterrows():
        sym = str(row[ticker_col]).strip().upper()
        if sym not in result:
            result[sym] = row[date_col]   # datetime, formattato in simulation_core
    return result


def _read_invested_tickers(excel_path: str) -> tuple:
    """
    Legge il foglio Simulation del file Excel precedente.
    Ritorna (invested_set, portfolio_dict) dove:
      invested_set   : set di ticker (uppercase) con buy_price > 0 o capital > 0
      portfolio_dict : {ticker: {"buy_price": float, "capital": float}}
    """
    if not os.path.exists(excel_path):
        return set(), {}
    try:
        from openpyxl import load_workbook as _lw
        wb = _lw(excel_path, read_only=True, data_only=True)
        if "Simulation" not in wb.sheetnames:
            wb.close()
            return set(), {}
        ws = wb["Simulation"]
        invested = set()
        portfolio = {}
        for row in ws.iter_rows(min_row=4, values_only=True):
            if not row or row[0] is None:
                continue
            ticker = str(row[0]).strip().upper()
            buy    = row[10] if len(row) > 10 else None   # col K
            cap    = row[11] if len(row) > 11 else None   # col L
            try:
                _b = float(buy) if buy not in (None, "", "-") else 0.0
            except (TypeError, ValueError):
                _b = 0.0
            try:
                _c = float(cap) if cap not in (None, "", "-") else 0.0
            except (TypeError, ValueError):
                _c = 0.0
            if _b > 0 or _c > 0:
                invested.add(ticker)
                portfolio[ticker] = {"buy_price": _b, "capital": _c}
        wb.close()
        print(f"[Portfolio] Ticker in portafoglio: {sorted(invested) or '(nessuno)'}")
        return invested, portfolio
    except Exception as e:
        print(f"[Portfolio] Errore lettura file precedente: {e}")
        return set(), {}


def _get_closest_price(hist: "pd.Series", target) -> "float | None":
    """
    Ritorna il prezzo di chiusura più vicino a target (date) in hist (index=date).
    Cerca il giorno esatto, poi i 5 giorni seguenti (day-off / weekend).
    """
    from datetime import timedelta as _td
    for offset in range(6):
        d = target + _td(days=offset)
        if d in hist.index:
            v = hist[d]
            try:
                return float(v)
            except (TypeError, ValueError):
                pass
    return None


def _compute_pnl_data(portfolio: dict, past_syms: set,
                      completion_dates: dict) -> dict:
    """
    Scarica prezzi storici via yfinance e calcola P&L per ogni ticker in past_syms.
    portfolio       : {ticker: {"buy_price": float, "capital": float}}
    past_syms       : set ticker con completion date già passata
    completion_dates: {ticker: date}
    Ritorna {ticker: {"d0_eur", "d0_pct", "w1_eur", "w1_pct", "m1_eur", "m1_pct"}}
    """
    from datetime import date as _dt, timedelta as _td
    try:
        import yfinance as yf
    except ImportError:
        print("[P&L] yfinance non disponibile — P&L non calcolato.")
        return {}

    syms = [s for s in past_syms if s in portfolio and s in completion_dates]
    if not syms:
        return {}

    # Calcola l'intervallo date da scaricare
    min_date = min(completion_dates[s] for s in syms)
    max_end  = _dt.today()
    # +35 giorni per coprire il +1 mese (in caso di weekend/festivi)
    fetch_end = min(max_end, max(completion_dates[s] for s in syms) + _td(days=35))
    if fetch_end < min_date:
        return {}

    print(f"[P&L] Download prezzi per {syms} ({min_date} → {fetch_end}) …")
    try:
        raw = yf.download(
            syms if len(syms) > 1 else syms[0],
            start=min_date.isoformat(),
            end=(fetch_end + _td(days=1)).isoformat(),
            auto_adjust=True, progress=False,
        )
    except Exception as e:
        print(f"[P&L] Errore download yfinance: {e}")
        return {}

    if raw is None or raw.empty:
        return {}

    # Normalizza in dict {ticker: Series(date→close)}
    closes = {}
    if len(syms) == 1:
        s = syms[0]
        try:
            ser = raw["Close"] if "Close" in raw.columns else raw.iloc[:, 0]
            ser.index = ser.index.date
            closes[s] = ser.astype(float)
        except Exception:
            pass
    else:
        for s in syms:
            try:
                ser = raw["Close"][s] if ("Close", s) in raw.columns else raw.iloc[:, 0]
                ser.index = ser.index.date
                closes[s] = ser.astype(float)
            except Exception:
                pass

    result = {}
    for s in syms:
        bp = portfolio[s]["buy_price"]
        cp = portfolio[s]["capital"]
        if bp <= 0:
            continue
        hist = closes.get(s, pd.Series(dtype=float))
        comp_dt = completion_dates[s]

        def _pnl(price):
            if price is None:
                return None, None
            qty   = cp / bp if bp else 0
            p_eur = (price - bp) * qty
            p_pct = (price - bp) / bp * 100
            return round(p_eur, 2), round(p_pct, 2)

        p_d0 = _get_closest_price(hist, comp_dt)
        p_w1 = _get_closest_price(hist, comp_dt + _td(days=7))
        p_m1 = _get_closest_price(hist, comp_dt + _td(days=30))

        eur_d0, pct_d0 = _pnl(p_d0)
        eur_w1, pct_w1 = _pnl(p_w1)
        eur_m1, pct_m1 = _pnl(p_m1)

        result[s] = {
            "d0_eur": eur_d0, "d0_pct": pct_d0,
            "w1_eur": eur_w1, "w1_pct": pct_w1,
            "m1_eur": eur_m1, "m1_pct": pct_m1,
        }
        print(f"[P&L] {s}: D0={eur_d0}€ ({pct_d0}%) | +1w={eur_w1}€ | +1m={eur_m1}€")

    return result


def write_catalysts_sheet(workbook, clinical_df, financial_df,
                          invested_tickers=None, portfolio_data=None):
    """
    Sheet 'Catalysts_60d': studi clinici con completion date nei prossimi 60gg.
    Struttura per gruppo azienda:
      - Riga company  : identica alla Financial sheet (stesse colonne)
      - Riga titoli   : intestazioni colonne cliniche (collassabile)
      - Righe studio  : dati degli studi (collassabili)
    Ordine colonne cliniche: completion_date | nct_id | titolo | phase | resto
    Ordinamento gruppi: Exact/Partial sponsor_match in cima → No match/N/D in fondo.
    """
    from datetime import date, timedelta

    # ── 1. Trova colonne chiave nel clinical_df ────────────────────────────
    DATE_CANDIDATES  = ["primary_completion_date", "completion_date",
                        "PrimaryCompletionDate", "CompletionDate",
                        "estimated_completion_date", "end_date"]
    NCT_CANDIDATES   = ["nct_id", "NCTId", "nct_number", "study_id", "nctId"]
    TITLE_CANDIDATES = ["brief_title", "BriefTitle", "study_title", "title",
                        "official_title", "OfficialTitle"]
    PHASE_CANDIDATES = ["phase", "Phase", "study_phase", "StudyPhase"]

    def find_col(candidates, df):
        return next((c for c in candidates if c in df.columns), None)

    date_col  = find_col(DATE_CANDIDATES,  clinical_df)
    nct_col   = find_col(NCT_CANDIDATES,   clinical_df)
    title_col = find_col(TITLE_CANDIDATES, clinical_df)
    phase_col = find_col(PHASE_CANDIDATES, clinical_df)

    if date_col is None:
        print("[Catalysts_60d] Nessuna colonna data trovata — sheet non creato.")
        return

    # ── 2. Filtra studi nei prossimi 60 giorni ────────────────────────────
    today   = date.today()
    horizon = today + timedelta(days=60)

    df = clinical_df.copy()
    df[date_col] = pd.to_datetime(df[date_col], errors="coerce")

    # ── 3. Identifica colonna simbolo (serve per il filtro portafoglio) ────
    ticker_col = "ticker" if "ticker" in df.columns else (
                 "symbol" if "symbol" in df.columns else None)
    if ticker_col:
        df["_sym"] = df[ticker_col].astype(str).str.strip().str.upper()
    else:
        df["_sym"] = ""

    # Mask primaria: studi nei prossimi 60 giorni
    mask_future = (df[date_col].dt.date >= today) & (df[date_col].dt.date <= horizon)

    # Mask secondaria: studi già scaduti ma società in portafoglio (preserva la riga)
    _inv = set(invested_tickers) if invested_tickers else set()
    if _inv:
        mask_past_inv = (df[date_col].dt.date < today) & (df["_sym"].isin(_inv))
    else:
        mask_past_inv = pd.Series(False, index=df.index)

    mask = mask_future | mask_past_inv
    df = df[mask].sort_values(date_col).copy()

    # Flag per distinguere righe "catalizzatore scaduto — in portafoglio"
    df["_past_cat"] = (~mask_future[mask]).values

    if df.empty:
        print("[Catalysts_60d] Nessuno studio da mostrare.")
        return

    # ── 4. Prepara financial_df per il lookup ─────────────────────────────
    fin = financial_df.copy()
    if "symbol" in fin.columns:
        fin["symbol"] = fin["symbol"].astype(str).str.strip().str.upper()
    # Applica lo stesso ordine colonne dello sheet Financial
    fin = _apply_col_order(fin)
    fin_cols = list(fin.columns)   # stesse colonne dello sheet Financial

    # ── 4b. Colonna extra "Prossimo Catalyst" inserita subito dopo "sector" ─
    _EXTRA_COL = "Prossimo Catalyst"

    if "sector" in fin_cols:
        _sect_pos   = fin_cols.index("sector")
        cats_cols   = fin_cols[:_sect_pos + 1] + [_EXTRA_COL] + fin_cols[_sect_pos + 1:]
        _extra_cidx = _sect_pos + 2
    else:
        cats_cols   = fin_cols + [_EXTRA_COL]
        _extra_cidx = len(fin_cols) + 1

    # Pre-calcolo earliest completion date per ticker
    _earliest_by_sym = (
        df.groupby("_sym")[date_col].min().dt.date.to_dict()
    )

    # Set di ticker con SOLO studi passati (completion date < today) — in portafoglio
    _past_syms = set()
    if "_past_cat" in df.columns and _inv:
        for _s in df["_sym"].unique():
            _grp = df[df["_sym"] == _s]
            if _grp["_past_cat"].all():
                _past_syms.add(_s)

    # ── 5. Ordina le colonne cliniche: data | nct | titolo | phase | resto ─
    priority = [c for c in [date_col, nct_col, title_col, phase_col] if c]
    rest_clinical = [
        c for c in df.columns
        if c not in priority and c != "_sym" and not c.endswith("_variations")
    ]
    clinical_cols = priority + rest_clinical

    # ── 6. Priorità sponsor_match per ordinamento gruppi ──────────────────
    # Exact/Partial in cima (priorità 0/1), No match/N/D in fondo (2/3)
    _SPON_PRIORITY = {"Exact": 0, "Partial": 1, "No match": 2, "N/D": 3}
    spon_col_cat   = "sponsor_match" if "sponsor_match" in df.columns else None

    if spon_col_cat:
        df["_spon_pri"] = df[spon_col_cat].map(_SPON_PRIORITY).fillna(3).astype(int)
        # Per ogni ticker prendi la priorità migliore (min) tra i suoi studi
        sym_priority = df.groupby("_sym")["_spon_pri"].min()
    else:
        df["_spon_pri"] = 3
        sym_priority = pd.Series(dtype=int)

    # Ordine ticker: prima per priority, poi alfabetico
    ordered_syms = (
        sym_priority.reset_index()
                    .sort_values(["_spon_pri", "_sym"])["_sym"]
                    .tolist()
    ) if not sym_priority.empty else sorted(df["_sym"].unique())

    # ── 7. Crea il foglio ─────────────────────────────────────────────────
    ws = workbook.create_sheet("Catalysts_60d")
    ws.sheet_properties.tabColor = "FF8C00"

    COMPANY_FILL      = PatternFill("solid", fgColor="BDD7EE")   # match pieno/parziale
    COMPANY_FILL_NM   = PatternFill("solid", fgColor="F2DCDB")   # no match — rosato tenue
    COMPANY_FILL_PAST = PatternFill("solid", fgColor="D9D9D9")   # catalizzatore scaduto in portafoglio
    COMPANY_FONT      = Font(bold=True, color="1F3864", size=11)
    COMPANY_FONT_NM   = Font(bold=True, color="7B3333", size=11)
    COMPANY_FONT_PAST = Font(bold=True, italic=True, color="595959", size=11)
    SUB_HEADER_FILL   = PatternFill("solid", fgColor="D6E4F0")
    SUB_HEADER_FONT   = Font(bold=True, color="1F3864", size=9, italic=True)
    DETAIL_FILL       = PatternFill("solid", fgColor="EEF2F7")
    DETAIL_FONT       = Font(color="333333", size=9)

    # ── 8. Intestazione principale (fin_cols + colonne extra) ───────────────
    for col_idx, col_name in enumerate(cats_cols, start=1):
        cell = ws.cell(row=1, column=col_idx, value=col_name)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = ALIGN_CENTER
        _w = 20 if col_name == _EXTRA_COL else max(len(col_name) + 2, 14)
        ws.column_dimensions[get_column_letter(col_idx)].width = _w

    ws.freeze_panes = "A2"
    row_idx = 2
    company_rows = []   # terremo traccia delle righe azienda per rosso/verde

    # ── 9. Gruppi per azienda (ordinati per sponsor_match priority) ───────
    grouped = df.groupby("_sym", sort=False)
    for sym in ordered_syms:
        if sym not in grouped.groups:
            continue
        group = grouped.get_group(sym)
        # priorità migliore per questo ticker
        best_pri = int(df.loc[df["_sym"] == sym, "_spon_pri"].min()) if spon_col_cat else 3
        is_no_match = best_pri >= 2   # No match o N/D

        # ── Riga azienda (visibile) — dati Financial ──────────────────────
        fin_row = fin[fin["symbol"] == sym] if "symbol" in fin.columns else pd.DataFrame()
        fin_data = fin_row.iloc[0].to_dict() if not fin_row.empty else {}

        is_past_cat = sym in _past_syms   # catalizzatore scaduto, in portafoglio
        if is_past_cat:
            row_fill = COMPANY_FILL_PAST
            row_font = COMPANY_FONT_PAST
        elif is_no_match:
            row_fill = COMPANY_FILL_NM
            row_font = COMPANY_FONT_NM
        else:
            row_fill = COMPANY_FILL
            row_font = COMPANY_FONT

        company_rows.append((row_idx, fin_data, is_no_match))
        ws.row_dimensions[row_idx].height = 22
        _earliest_dt = _earliest_by_sym.get(sym)
        for col_idx, col_name in enumerate(cats_cols, start=1):
            if col_name == _EXTRA_COL:
                val = _earliest_dt
            elif col_name == "symbol" and is_past_cat:
                val = f"{fin_data.get(col_name, sym)}  [In portafoglio]"
            else:
                val = fin_data.get(col_name)
            cell = ws.cell(row=row_idx, column=col_idx, value=val)
            cell.fill = row_fill
            cell.font = row_font
            cell.alignment = ALIGN_CENTER
            if col_name == _EXTRA_COL:
                cell.number_format = "DD/MM/YYYY"
                cell.font = Font(bold=True,
                                 color="BF5000" if not is_past_cat else "595959",
                                 size=10)
            elif col_name in NUMERIC_COLS_FMT:
                cell.number_format = NUMERIC_COLS_FMT[col_name]
        row_idx += 1

        # ── Riga titoli colonne cliniche (collassabile) ───────────────────
        ws.row_dimensions[row_idx].outline_level = 1
        ws.row_dimensions[row_idx].hidden = True
        ws.row_dimensions[row_idx].height = 16
        for col_idx, col_name in enumerate(clinical_cols, start=1):
            cell = ws.cell(row=row_idx, column=col_idx, value=col_name)
            cell.fill = SUB_HEADER_FILL
            cell.font = SUB_HEADER_FONT
            cell.alignment = ALIGN_LEFT
        row_idx += 1

        # ── Righe dati studi (collassabili) ──────────────────────────────
        for _, study_row in group.iterrows():
            ws.row_dimensions[row_idx].outline_level = 1
            ws.row_dimensions[row_idx].hidden = True
            ws.row_dimensions[row_idx].height = 16
            for col_idx, col_name in enumerate(clinical_cols, start=1):
                val = study_row.get(col_name, None)
                cell = ws.cell(row=row_idx, column=col_idx, value=val)
                if col_name == "Modality":
                    mod_color = _MODALITY_COLORS.get(str(val or "Other"), _MODALITY_COLORS["Other"])
                    cell.fill = PatternFill("solid", fgColor=mod_color)
                    cell.font = Font(bold=True, size=9, color="1A1A1A")
                    cell.alignment = ALIGN_CENTER
                else:
                    cell.fill = DETAIL_FILL
                    cell.font = DETAIL_FONT
                    cell.alignment = ALIGN_LEFT
            row_idx += 1

    fin_col_map = {c: i + 1 for i, c in enumerate(cats_cols)}

    # ── 9. Rosso/verde variazioni — solo sulle righe azienda ─────────────
    var_col_indices = {
        col: fin_col_map[col]
        for col in VARIATION_COLS if col in fin_col_map
    }
    for r_idx, fin_data, _nm in company_rows:
        for col_name, col_idx in var_col_indices.items():
            cell = ws.cell(row=r_idx, column=col_idx)
            try:
                val = float(cell.value) if cell.value is not None else None
            except (TypeError, ValueError):
                val = None
            fill, font = color_for_variation(val)
            if fill:
                cell.fill = fill
                cell.font = font

    last_data_row = row_idx - 1

    # ── 10. Data bar — verde Market Cap / Prezzo; blu altre colonne DATA_BAR ─
    for col_name in DATA_BAR_COLS:
        if col_name not in fin_col_map:
            continue
        col_letter = get_column_letter(fin_col_map[col_name])
        ws.conditional_formatting.add(
            f"{col_letter}2:{col_letter}{last_data_row}",
            DataBarRule(
                start_type="min", start_value=0,
                end_type="max",   end_value=100,
                color=_data_bar_hex(col_name), showValue=True,
            ),
        )

    # ── 11. Coloring mean±2σ sulle righe azienda — identico al Financial sheet
    # Pre-calcolo mean/std su fin, poi itero company_rows (righe non contigue)
    _linear_stats = {}
    for col_name in COLOR_SCALE_COLS:
        if col_name not in fin_col_map or col_name not in fin.columns:
            continue
        s = pd.to_numeric(fin[col_name], errors="coerce").dropna()
        if len(s) < 2:
            continue
        mean, std = float(s.mean()), float(s.std())
        if std == 0:
            continue
        _linear_stats[col_name] = (mean, std)

    _beta_cat_idx = fin_col_map.get("beta")

    for r_idx, fin_data, _nm in company_rows:
        for col_name, (mean, std) in _linear_stats.items():
            col_idx = fin_col_map[col_name]
            cell = ws.cell(row=r_idx, column=col_idx)
            try:
                lo   = mean - 2 * std
                span = 4 * std
                t = max(0.0, min(1.0, (float(cell.value) - lo) / span))
                cell.fill = PatternFill("solid", fgColor=_linear_rgb(t))
            except (TypeError, ValueError):
                pass
        # Beta — soglie fisse (identico al Financial sheet)
        if _beta_cat_idx:
            cell = ws.cell(row=r_idx, column=_beta_cat_idx)
            fill = _beta_fill(cell.value)
            if fill:
                cell.fill = fill

    nm_count = sum(1 for _, _, nm in company_rows if nm)
    ok_count = len(company_rows) - nm_count
    print(f"[Catalysts_60d] {len(company_rows)} aziende ({ok_count} match/partial, {nm_count} no-match), "
          f"{len(df)} studi nei prossimi 60gg.")


# ─────────────────────────────────────────────────────────────────────────────
# Sheet 6: IPO Snapshot (5 società configurate in retrospective_config.json)
# ─────────────────────────────────────────────────────────────────────────────

def _load_retro_tickers() -> list:
    """Legge i ticker da retrospective_config.json (max 5)."""
    if not os.path.exists(RETRO_CONFIG_FILE):
        return []
    try:
        with open(RETRO_CONFIG_FILE, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        tickers = cfg.get("tickers", [])
        return [str(t).strip().upper() for t in tickers if t][:5]
    except Exception as e:
        print(f"  [IPO Snapshot] Errore lettura config: {e}")
        return []


def _fetch_snapshot_history(symbol: str):
    """Scarica tutta la storia disponibile per il ticker."""
    try:
        import yfinance as yf
        tk   = yf.Ticker(symbol)
        hist = tk.history(period="max", auto_adjust=True)
        info = tk.info
        hist.index = pd.to_datetime(hist.index).tz_localize(None)
        return hist, info
    except Exception as e:
        print(f" ERRORE ({e})")
        return pd.DataFrame(), {}


def _compute_snapshot_metrics(symbol: str, hist: pd.DataFrame, info: dict) -> dict:
    import math
    if hist.empty:
        return {"symbol": symbol, "error": True}
    close = hist["Close"]
    lp    = float(close.iloc[-1])
    fp    = float(close.iloc[0])

    def _p(new, old):
        return (new - old) / old * 100 if old and old != 0 else None

    def _ret_n(days):
        cutoff = close.index[-1] - pd.Timedelta(days=days)
        sub    = close.loc[close.index >= cutoff]
        return _p(lp, float(sub.iloc[0])) if not sub.empty else None

    daily_ret = close.pct_change().dropna()
    vol_ann   = float(daily_ret.std() * math.sqrt(252) * 100) if not daily_ret.empty else None

    return {
        "symbol":      symbol,
        "name":        info.get("longName") or info.get("shortName", symbol),
        "sector":      info.get("sector", ""),
        "country":     info.get("country", ""),
        "currency":    info.get("currency", ""),
        "first_date":  hist.index[0].date(),
        "last_date":   hist.index[-1].date(),
        "first_price": fp,
        "last_price":  lp,
        "total_ret":   _p(lp, fp),
        "ath_val":     float(close.max()),
        "ath_date":    close.idxmax().date(),
        "dist_ath":    _p(lp, float(close.max())),
        "vol_ann":     vol_ann,
        "ret_1y":      _ret_n(365),
        "ret_3y":      _ret_n(365 * 3),
        "ret_5y":      _ret_n(365 * 5),
        "error":       False,
    }


def write_ipo_snapshot_sheet(wb, clinical_df=None) -> None:
    """Delegato a ``data_orchestrator`` (unica implementazione, include pred. T+3)."""
    from data_orchestrator import write_ipo_snapshot_sheet as _orch_ipo_sheet
    _orch_ipo_sheet(wb, clinical_df)


# ─────────────────────────────────────────────────────────────────────────────
# I/O helpers
# ─────────────────────────────────────────────────────────────────────────────

def load_json_as_df(path):
    if not os.path.exists(path):
        return pd.DataFrame()
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            return pd.DataFrame(data)
        if isinstance(data, dict):
            return pd.DataFrame([
                {"key": k, **(v if isinstance(v, dict) else {"value": v})}
                for k, v in data.items()
            ])
        return pd.DataFrame()
    except Exception as e:
        print(f"[WARN] Could not load {path}: {e}")
        return pd.DataFrame()


def load_excel_as_df(path):
    if not os.path.exists(path):
        return pd.DataFrame()
    try:
        return pd.read_excel(path)
    except Exception as e:
        print(f"[WARN] Could not read {path}: {e}")
        return pd.DataFrame()


def run_script(script_name, extra_args=None):
    extra_args = extra_args or []
    print(f">>> Running {script_name} {' '.join(extra_args)}".strip() + " ...")
    script_path = os.path.abspath(script_name)
    workdir = os.path.dirname(script_path)

    result = subprocess.run(
        ["python", script_path] + extra_args,
        cwd=workdir,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )

    if result.returncode != 0:
        print(f"[ERROR] {script_name} failed")
        print(result.stdout)
        print(result.stderr)
        raise SystemExit(result.returncode)

    print(result.stdout)


# ─────────────────────────────────────────────────────────────────────────────
# Merge & output
# ─────────────────────────────────────────────────────────────────────────────

def merge_by_symbol():
    yf_df         = load_json_as_df(YF_JSON)
    finnhub_df    = load_json_as_df(FINNHUB_JSON)
    variations_df = load_json_as_df(VARIATIONS_JSON)
    clinical_df   = load_excel_as_df(CLINICAL_XLSX)

    for df_name, df in {
        "yf": yf_df,
        "finnhub": finnhub_df,
        "variations": variations_df,
        "clinical": clinical_df,
    }.items():
        if df.empty:
            continue
        if "symbol" not in df.columns and "ticker" in df.columns:
            df["symbol"] = df["ticker"]
        if "symbol" not in df.columns:
            df["symbol"] = ""
        df["symbol"] = df["symbol"].astype(str).str.strip().str.upper()

    merged_df = pd.DataFrame()

    if not yf_df.empty:
        merged_df = yf_df.copy()

    if not finnhub_df.empty:
        if merged_df.empty:
            merged_df = finnhub_df.copy()
        else:
            merged_df = pd.merge(
                merged_df, finnhub_df,
                on="symbol", how="outer",
                suffixes=("", "_finnhub")
            )

    if not variations_df.empty:
        print("Variations columns loaded:", variations_df.columns.tolist())
        if merged_df.empty:
            merged_df = variations_df.copy()
        else:
            if "symbol" not in variations_df.columns:
                variations_df["symbol"] = ""
            merged_df = pd.merge(
                merged_df, variations_df,
                on="symbol", how="outer",
                suffixes=("", "_variations")
            )

    return merged_df, clinical_df


# ─────────────────────────────────────────────────────────────────────────────
# SISTEMA DI AUTO-CALIBRAZIONE PREDIZIONI
# JSON: data/pred_calibration.json
# Flusso: pending → (T+35gg passati) → complete → bias correction
# ─────────────────────────────────────────────────────────────────────────────
_CALIB_PATH    = pathlib.Path("data") / "pred_calibration.json"
_MODEL_VERSION = "v4_options"    # aggiorna ad ogni cambio strutturale del modello

# Registro storico versioni — aggiungere una riga ad ogni aggiornamento strutturale.
# Ordine: dalla più vecchia alla più recente.
_MODEL_REGISTRY: list[dict] = [
    {
        "version":  "v1_momentum",
        "date":     "2025-01-01",
        "label":    "v1 — Momentum base",
        "changes":  "RSI-14 + slope vs XBI + vol build-up. Modello iniziale.",
    },
    {
        "version":  "v2_signals",
        "date":     "2025-03-01",
        "label":    "v2 — Multi-signal",
        "changes":  "Aggiunto vol_accel, slope_aligned (TF 5gg/20gg), prior fase clinica, "
                    "soglia RSI neutro rimossa, cap vol combinato a 3pt.",
    },
    {
        "version":  "v3_ensemble",
        "date":     "2025-04-29",
        "label":    "v3 — Ensemble + nuovi segnali",
        "changes":  "Fix 6 bug (RSI neutro, vol cap, TF alignment, BTR 12%). "
                    "3 nuovi segnali: run_up_7d (drift qualità), ath_prox (prossimità 52wk), "
                    "vpd (divergenza vol-prezzo).",
    },
    {
        "version":  "v4_options",
        "date":     "2025-04-29",
        "label":    "v4 — Segnali da opzioni",
        "changes":  "2 nuovi segnali: segnale 9 PCR contrarian (put/call ratio — panico > 2.5x, "
                    "frenesia call < 0.5x); segnale 10 expected move × direzione opzioni "
                    "(straddle ATM / prezzo > 25% amplifica la direzionalità PCR). "
                    "+5% affidabilità se options data disponibili; -8% se exp_move > 45% (evento binario).",
    },
]


def _calib_load(path=None) -> list:
    """Carica il JSON di calibrazione. Restituisce lista (vuota se assente)."""
    p = pathlib.Path(path or _CALIB_PATH)
    if not p.exists():
        return []
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception as _e:
        print(f"[Calib] Errore lettura: {_e}")
        return []


def _calib_save(records: list, path=None):
    """Salva il JSON di calibrazione su disco."""
    p = pathlib.Path(path or _CALIB_PATH)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(
        json.dumps(records, ensure_ascii=False, default=str, indent=2),
        encoding="utf-8",
    )


def _calib_bias(records: list) -> dict:
    """Calcola il bias medio per orizzonte dai record completati (≥5 obs)."""
    done = [r for r in records if r.get("status") == "complete"]
    n = len(done)
    if n == 0:
        return {"n": 0, "d3": 0.0, "d5": 0.0, "d10": 0.0, "d30": 0.0}

    def _m(key):
        vals = [r[key] for r in done if r.get(key) is not None]
        return round(sum(vals) / len(vals), 2) if vals else 0.0

    return {
        "n":   n,
        "d3":  _m("d3_err"),
        "d5":  _m("d5_err"),
        "d10": _m("d10_err"),
        "d30": _m("d30_err"),
    }


def _calib_save_pending(pred_data: dict, sim_rows: list, path=None):
    """
    Per ogni ticker con predizione calcolata, crea un record 'pending'
    nel JSON di calibrazione (se la coppia ticker+T non esiste già).
    """
    from datetime import date as _date
    records = _calib_load(path)
    existing = {(r["ticker"], str(r["completion_date"])) for r in records}
    added = 0
    for tk, p in pred_data.items():
        # Recupera la completion_date dalla riga sim corrispondente
        cd = next(
            (r.get("completion_date")
             for r in sim_rows
             if str(r.get("ticker", "")).strip().upper() == tk),
            None,
        )
        if cd is None:
            continue
        cd_str = str(cd)
        if (tk, cd_str) in existing:
            continue
        records.append({
            "ticker":           tk,
            "completion_date":  cd_str,
            "prediction_date":  str(_date.today()),
            "model_version":    _MODEL_VERSION,
            "days_to_t":        p.get("days_to_t"),
            "affidabilita":     p.get("affidabilita"),
            "stars":            p.get("stars"),
            "direction":        p.get("direction"),
            "direction_raw":    p.get("direction_raw"),
            "phase":            p.get("phase", ""),
            "phase_num":        p.get("phase_num"),
            "slope_aligned":    p.get("slope_aligned"),
            "vol_accel":        p.get("vol_accel"),
            "run_up_30d":       p.get("run_up_30d"),
            "run_up_7d":        p.get("run_up_7d"),
            "ath_prox":         p.get("ath_prox"),
            "vol_price_div":    p.get("vol_price_div"),
            "model":            p.get("model"),
            "r2":               p.get("r2"),
            "rsi":              p.get("rsi"),
            "vol_ratio":        p.get("vol_ratio"),
            "exc_slope":        p.get("exc_slope"),
            "d3_pred":          p.get("d3_pct"),
            "d5_pred":          p.get("d5_pct"),
            "d10_pred":         p.get("d10_pct"),
            "d30_pred":         p.get("d30_pct"),
            "d3_actual":  None, "d3_err":  None,
            "d5_actual":  None, "d5_err":  None,
            "d10_actual": None, "d10_err": None,
            "d30_actual": None, "d30_err": None,
            "status": "pending",
        })
        added += 1
    if added:
        _calib_save(records, path)
        print(f"[Calib] {added} record 'pending' salvati → {path or _CALIB_PATH}")


def _calib_collect_actuals(path=None):
    """
    Per i record 'pending' con completion_date + 35 giorni < oggi,
    scarica i prezzi reali e calcola gli errori pred vs actual.
    Aggiorna il JSON in-place.
    """
    import yfinance as yf
    from datetime import date as _date, timedelta as _td

    today   = _date.today()
    records = _calib_load(path)
    to_do   = []
    for r in records:
        if r.get("status") != "pending":
            continue
        try:
            cd = _date.fromisoformat(str(r["completion_date"]))
        except Exception:
            continue
        if (today - cd).days >= 35:          # abbastanza per tutti gli orizzonti
            to_do.append((r, cd))

    if not to_do:
        print("[Calib] Nessun record pending da completare oggi")
        return

    print(f"[Calib] Raccolta dati reali per {len(to_do)} record pending…")
    syms = list({r["ticker"] for r, _ in to_do})
    try:
        raw = yf.download(
            syms if len(syms) > 1 else syms[0],
            period="90d", auto_adjust=True, progress=False,
        )
    except Exception as _e:
        print(f"[Calib] Errore download: {_e}")
        return
    if raw is None or raw.empty:
        return

    # Estrai close per ticker
    closes_map: dict = {}
    if len(syms) == 1:
        s = syms[0]
        try:
            ser = raw["Close"] if "Close" in raw.columns else raw.iloc[:, 0]
            ser.index = ser.index.date
            closes_map[s] = ser.astype(float).dropna()
        except Exception:
            pass
    else:
        for s in syms:
            try:
                col = ("Close", s)
                if col in raw.columns:
                    ser = raw[col]
                    ser.index = ser.index.date
                    closes_map[s] = ser.astype(float).dropna()
            except Exception:
                pass

    def _actual_pct(close_ser, t_date, h_days):
        """% change da T al giorno T+h più vicino disponibile."""
        try:
            cands_t = [d for d in close_ser.index if d <= t_date]
            if not cands_t:
                return None
            p_t = float(close_ser[max(cands_t)])
            target = t_date + _td(days=h_days)
            cands_h = [d for d in close_ser.index if d >= target]
            if not cands_h:
                return None
            p_h = float(close_ser[min(cands_h)])
            return round((p_h / p_t - 1.0) * 100.0, 2) if p_t > 0 else None
        except Exception:
            return None

    updated = 0
    for r, cd in to_do:
        tk  = r["ticker"]
        cls = closes_map.get(tk)
        if cls is None or cls.empty:
            continue
        for h, key_a, key_p, key_e in [
            (3,  "d3_actual",  "d3_pred",  "d3_err"),
            (5,  "d5_actual",  "d5_pred",  "d5_err"),
            (10, "d10_actual", "d10_pred", "d10_err"),
            (30, "d30_actual", "d30_pred", "d30_err"),
        ]:
            actual = _actual_pct(cls, cd, h)
            r[key_a] = actual
            if actual is not None and r.get(key_p) is not None:
                r[key_e] = round(float(r[key_p]) - actual, 2)
        r["status"] = "complete"
        updated += 1

    if updated:
        _calib_save(records, path)
        print(f"[Calib] {updated} record aggiornati a 'complete' → {path or _CALIB_PATH}")


def _direction_ensemble(
    ph_num, exc_slope, slope, rsi_val,
    vol_ratio, vol_accel, run_up, slope_5d, slope_20d,
    run_up_7d=None, ath_prox=None, vol_px_div=0,
    pcr=None, exp_move_pct=None, days_to_t=None,
) -> tuple[str, list[str]]:
    """
    Modello ensemble v4 — predice la direzione post-catalyst.
    Soglia: net ≥ 3 per segnale direzionale.
      v3 fix: RSI neutro rimosso, vol cap 3pt, TF soglia, drift quality,
              52wk proximity, vol-price divergence.
      v4 new: PCR contrarian (segnale 9) + expected move × opzioni (segnale 10).
    """
    notes: list[str] = []

    if ph_num == 2:
        notes.append("Ph2: neutro (70% fail storico)")
        return "→ Stabile", notes

    bull = 0; bear = 0
    bull_r: list[str] = []; bear_r: list[str] = []

    # 1. Slope excess vs XBI
    _s = exc_slope if exc_slope is not None else slope
    if _s is not None:
        if   _s >=  1.5: bull += 2; bull_r.append(f"slope+{_s:+.2f}")
        elif _s >=  0.5: bull += 1; bull_r.append(f"slope+{_s:+.2f}")
        elif _s <= -1.5: bear += 2; bear_r.append(f"slope{_s:+.2f}")
        elif _s <= -0.5: bear += 1; bear_r.append(f"slope{_s:+.2f}")

    # 2. RSI — solo estremi, zona neutra rimossa
    if rsi_val is not None:
        if   rsi_val > 72: bear += 2; bear_r.append(f"RSI OB {rsi_val:.0f}")
        elif rsi_val > 65: bear += 1; bear_r.append(f"RSI alto {rsi_val:.0f}")
        elif rsi_val < 28: bull += 2; bull_r.append(f"RSI OS {rsi_val:.0f}")
        elif rsi_val < 35: bull += 1; bull_r.append(f"RSI basso {rsi_val:.0f}")

    # 3. Volume — cap combinato a 2 punti
    # Il volume alto pre-catalyst è quasi scontato: limitiamo il peso per non gonfiare il bull
    _vbull = 0; _vbear = 0
    if vol_ratio is not None:
        if   vol_ratio >= 2.0: _vbull += 2; bull_r.append(f"vol {vol_ratio:.1f}x")
        elif vol_ratio >= 1.5: _vbull += 1; bull_r.append(f"vol {vol_ratio:.1f}x")
        elif vol_ratio <  0.6: _vbear += 1; bear_r.append(f"vol↓ {vol_ratio:.1f}x")
    if vol_accel is not None:
        if   vol_accel >= 2.0: _vbull += 2; bull_r.append(f"va {vol_accel:.1f}x")
        elif vol_accel >= 1.5: _vbull += 1; bull_r.append(f"va {vol_accel:.1f}x")
        elif vol_accel <  0.6: _vbear += 1; bear_r.append(f"va↓ {vol_accel:.1f}x")
    bull += min(_vbull, 2)
    bear += min(_vbear, 2)

    # 4. Multi-TF — solo con soglia minima
    if (slope_5d is not None and slope_20d is not None
            and abs(slope_5d) > 0.3 and abs(slope_20d) > 0.3):
        if   slope_5d > 0 and slope_20d > 0: bull += 1; bull_r.append("TF↑↑")
        elif slope_5d < 0 and slope_20d < 0: bear += 1; bear_r.append("TF↓↓")

    # 5. Run-up / sell-off contrarian (Phase 3 peso triplo)
    # Soglie abbassate: il mercato tende a prezzare in anticipo → sell-the-news più frequente
    if run_up is not None:
        _ph3 = (ph_num == 3)
        if   run_up >  20: w = 3 if _ph3 else 2; bear += w; bear_r.append(f"BTR+{run_up:.0f}%")
        elif run_up >  15: bear += 2; bear_r.append(f"BTR+{run_up:.0f}%")
        elif run_up >   8: bear += 1; bear_r.append(f"run+{run_up:.0f}%")
        elif run_up < -20: w = 3 if _ph3 else 2; bull += w; bull_r.append(f"CTR{run_up:.0f}%")
        elif run_up < -15: bull += 2; bull_r.append(f"CTR{run_up:.0f}%")
        elif run_up <  -8: bull += 1; bull_r.append(f"dip{run_up:.0f}%")

    # 6. Drift quality — accumulo graduale vs spike
    if run_up is not None and run_up_7d is not None and abs(run_up) >= 8:
        if run_up > 0:
            r7 = abs(run_up_7d) / abs(run_up) if abs(run_up) > 0 else 0
            if r7 < 0.35:  bull += 1; bull_r.append(f"drift graduale {run_up:.0f}%")
            elif r7 > 0.70: bear += 1; bear_r.append(f"spike7gg {run_up_7d:.0f}%")
        elif run_up < 0:
            r7 = abs(run_up_7d) / abs(run_up) if abs(run_up) > 0 else 0
            if r7 < 0.35:  bear += 1; bear_r.append(f"sell graduale {run_up:.0f}%")
            elif r7 > 0.70: bull += 1; bull_r.append(f"panic7gg {run_up_7d:.0f}%")

    # 7. Prossimità massimo 52 settimane
    if ath_prox is not None:
        if   ath_prox >= 0.92: bear += 1; bear_r.append(f"vicino ATH {ath_prox:.0%}")
        elif ath_prox <= 0.45: bull += 1; bull_r.append(f"lontano ATH {ath_prox:.0%}")

    # 8. Divergenza volume-prezzo
    if vol_px_div == +1: bull += 1; bull_r.append("div vol↑px↓ (accum.)")
    elif vol_px_div == -1: bear += 1; bear_r.append("div vol↓px↑ (distrib.)")

    # 9. v4: Put/Call Ratio contrarian
    if pcr is not None:
        if   pcr > 2.5:  bull += 2; bull_r.append(f"PCR panico {pcr:.1f}")
        elif pcr > 1.5:  bull += 1; bull_r.append(f"PCR hedge {pcr:.1f}")
        elif pcr < 0.50: bear += 2; bear_r.append(f"PCR call-frenzy {pcr:.2f}")
        elif pcr < 0.70: bear += 1; bear_r.append(f"PCR call-excess {pcr:.2f}")

    # 10. v4: Expected move × direzione opzioni
    if exp_move_pct is not None and exp_move_pct > 25 and pcr is not None:
        if   pcr < 0.65: bull += 1; bull_r.append(f"bigmove+call {exp_move_pct:.0f}%")
        elif pcr > 1.50: bear += 1; bear_r.append(f"bigmove+put {exp_move_pct:.0f}%")

    # 11. "Prezzato in" — momentum positivo in prossimità del catalyst
    # Pre-catalyst run-up con slope positivo → rischio sell-the-news.
    # Attivo solo se: catalyst entro 30gg AND run_up > 5% AND slope > 0
    # Intensità: entro 7gg è più forte (mercato ha già scontato il positivo)
    if (days_to_t is not None and run_up is not None and slope is not None
            and days_to_t <= 30 and run_up > 5 and slope > 0):
        if   days_to_t <= 7:  bear += 2; bear_r.append(f"priced-in T-{days_to_t}gg +{run_up:.0f}%")
        elif days_to_t <= 14: bear += 1; bear_r.append(f"priced-in T-{days_to_t}gg +{run_up:.0f}%")
        else:                 bear += 1; bear_r.append(f"priced-in T-{days_to_t}gg +{run_up:.0f}%")

    net = bull - bear
    if   net >=  4: pred = "↑↑ Forte crescita"; notes = bull_r[:4]
    elif net ==  3: pred = "↑ Crescita lieve";  notes = bull_r[:3]
    elif net <= -4: pred = "↓↓ Calo forte";     notes = bear_r[:4]
    elif net == -3: pred = "↓ Calo lieve";      notes = bear_r[:3]
    else:           pred = "→ Stabile";         notes = [f"neutro (B{bull}/S{bear})"]

    notes.append(f"[B{bull} S{bear} net{net:+d}]")
    return pred, notes


def _prediction_score(direction: str, d5: float | None) -> int | None:
    """
    Score 0-100 che misura quanto la predizione si è avvicinata all'esito reale.

    Scala basata su T+5:
      ↑ prediction:
          d5 = +10%  → 100  (perfetta)
          d5 =   0%  →  50  (neutra)
          d5 = -10%  →   0  (completamente sbagliata)
          formula:  50 + d5 * 5   clampato [0, 100]

      ↓ prediction:
          d5 = -10%  → 100
          d5 =   0%  →  50
          d5 = +10%  →   0
          formula:  50 − d5 * 5   clampato [0, 100]

      → prediction (Stabile):
          d5 =    0% → 100  (esatto: flat atteso, flat reale)
          d5 = ±6.5% →  50  (tolleranza accettabile)
          d5 = ±12.5%→   0  (si aspettava flat, mossa grande)
          formula:  100 − |d5| * 8   clampato [0, 100]
    """
    if d5 is None or not direction:
        return None
    d = float(d5)
    if   direction.startswith("↑"): raw = 50.0 + d * 5.0
    elif direction.startswith("↓"): raw = 50.0 - d * 5.0
    else:                           raw = 100.0 - abs(d) * 8.0
    return max(0, min(100, round(raw)))


def _direction_v1(ph_num, exc_slope, slope, rsi_val, vol_ratio) -> str:
    """
    Modello v1_momentum — segnali originali:
      1. Slope excess vs XBI (o slope assoluto)
      2. RSI-14 con zona neutra 40-60 (non rimossa)
      3. Vol build-up (vol_ratio solo, nessun vol_accel, nessun cap)
    Nessun run_up contrarian, nessun multi-TF.
    """
    bull = 0; bear = 0

    _s = exc_slope if exc_slope is not None else slope
    if _s is not None:
        if   _s >=  1.5: bull += 2
        elif _s >=  0.5: bull += 1
        elif _s <= -1.5: bear += 2
        elif _s <= -0.5: bear += 1

    if rsi_val is not None:
        if   rsi_val > 70: bear += 2
        elif rsi_val > 60: bear += 1    # zona neutra 40-60 NON contribuisce
        elif rsi_val < 30: bull += 2
        elif rsi_val < 40: bull += 1

    if vol_ratio is not None:
        if   vol_ratio >= 2.0: bull += 2
        elif vol_ratio >= 1.5: bull += 1
        elif vol_ratio <  0.6: bear += 1

    net = bull - bear
    if   net >= 3:  return "↑ Crescita lieve"
    elif net <= -3: return "↓ Calo lieve"
    else:           return "→ Stabile"


def _direction_for_version(
    ver: str,
    ph_num, exc_slope, slope, rsi_val,
    vol_ratio, vol_accel, run_up, slope_5d, slope_20d,
    run_up_7d=None, ath_prox=None, vol_px_div=0,
) -> str:
    """
    Dispatcher per versione modello.
    Applica solo i segnali disponibili in quella versione storica.
    v3 e v4 sono identici su dati storici (PCR/exp_move non disponibili).
    """
    if ver == "v1_momentum":
        return _direction_v1(ph_num, exc_slope, slope, rsi_val, vol_ratio)
    elif ver == "v2_signals":
        d, _ = _direction_ensemble(
            ph_num, exc_slope, slope, rsi_val,
            vol_ratio, vol_accel, run_up, slope_5d, slope_20d,
            # segnali 6-10 non ancora in v2
            run_up_7d=None, ath_prox=None, vol_px_div=0,
        )
        return d
    elif ver in ("v3_ensemble", "v4_options"):
        # v4 == v3 su dati storici (PCR/exp_move = None)
        d, _ = _direction_ensemble(
            ph_num, exc_slope, slope, rsi_val,
            vol_ratio, vol_accel, run_up, slope_5d, slope_20d,
            run_up_7d=run_up_7d, ath_prox=ath_prox, vol_px_div=vol_px_div,
        )
        return d
    # fallback
    d, _ = _direction_ensemble(
        ph_num, exc_slope, slope, rsi_val,
        vol_ratio, vol_accel, run_up, slope_5d, slope_20d,
    )
    return d


_VERSIONS = ["v1_momentum", "v2_signals", "v3_ensemble", "v4_options"]


def _compute_past_catalyst_data(sim_rows_past: list) -> dict:
    """
    Per ogni ticker in sim_rows_past (catalyst già completati):
      1. Scarica 2 anni di prezzi storici
      2. A T-7 calcola i segnali tecnici e le direzioni modello v1-v4
      3. Da completion_date calcola le variazioni effettive d3/d5/d10/d30
      4. Computa score_v4 confrontando dir_v4 con d5_actual

    Ritorna {ticker: {dir_v1..v4, d3_pct..d30_pct, score_v4, stars, affidabilita}}
    Non ha cutoff di 42 giorni — copre tutti i catalyst passati.

    Delega a ``data_orchestrator._compute_past_catalyst_data`` (retro T−10, HistLib pickle/JSON,
    volumi ensemble). Solo se la delega fallisce si usa il ramo locale legacy (5y chunked).
    Disattiva delega: env ``FETCH_EDGAR_PAST_CATALYST_LEGACY=1``.
    """
    if os.environ.get("FETCH_EDGAR_PAST_CATALYST_LEGACY", "").strip().lower() not in (
            "1", "true", "yes", "on"):
        try:
            import data_orchestrator as _dor_pc
            return _dor_pc._compute_past_catalyst_data(sim_rows_past)
        except Exception as _deleg_pc_e:
            print(f"[PastCatalyst] Delega data_orchestrator fallita ({_deleg_pc_e}) "
                  f"— uso ramo locale fetch_edgar.", flush=True)
    if not sim_rows_past:
        return {}
    try:
        import yfinance as _yf
        import numpy as _np
        import pandas as _pd
        from datetime import date as _date, timedelta as _td
    except ImportError as _e:
        print(f"[PastCatalyst] Import mancante: {_e}")
        return {}

    # ── Raccogli TUTTE le coppie (ticker, cd) uniche ──────────────────────────
    # Ogni studio è trattato indipendentemente — più studi per ticker vengono
    # tutti inclusi, ognuno con la propria completion_date.
    def _to_date(v):
        if v is None: return None
        if hasattr(v, "date"):
            try: return v.date()
            except: return None
        if isinstance(v, _date): return v
        try:    return _pd.Timestamp(str(v)).date()
        except: return None

    _seen_pairs: set = set()
    _ticker_cd_pairs: list = []          # [(ticker, cd), ...]
    for _r in sim_rows_past:
        _tk = str(_r.get("ticker", "")).strip().upper()
        _cd = _to_date(_r.get("completion_date"))
        if not _tk or not _cd: continue
        if (_tk, _cd) not in _seen_pairs:
            _seen_pairs.add((_tk, _cd))
            _ticker_cd_pairs.append((_tk, _cd))

    if not _ticker_cd_pairs:
        return {}

    # Download prezzi solo per i ticker unici (non per ogni studio)
    tickers = sorted({tk for tk, _ in _ticker_cd_pairs})
    print(f"[PastCatalyst] {len(_ticker_cd_pairs)} studi da analizzare "
          f"su {len(tickers)} ticker: {tickers}")

    # ── Download batch prezzi a blocchi (max 50 ticker per chiamata) ──────────
    # Un singolo download di centinaia di ticker si blocca indefinitamente.
    # Scaricamento in chunk da 50: più lento ma garantisce termine in tempo finito.
    _CHUNK_SIZE = 50
    _close_cache: dict = {}   # ticker → pd.Series (Close, tz-naive)

    def _extract_close(raw_df, tk, n_tks):
        """Estrae Close series da DataFrame yfinance (gestisce MultiIndex e singolo)."""
        try:
            if n_tks == 1:
                s = (raw_df["Close"] if "Close" in raw_df.columns
                     else raw_df.iloc[:, 0]).dropna()
            else:
                cols = raw_df.columns
                if isinstance(cols, _pd.MultiIndex):
                    if "Close" in cols.get_level_values(0):
                        s = raw_df["Close"].get(tk, _pd.Series()).dropna()
                    elif tk in cols.get_level_values(0):
                        s = raw_df[tk].get("Close", _pd.Series()).dropna()
                    else:
                        return None
                else:
                    s = raw_df[tk].dropna() if tk in raw_df.columns else _pd.Series()
            if s.empty: return None
            if hasattr(s.index, "tz"):
                s.index = _pd.to_datetime(s.index).tz_localize(None)
            return s
        except: return None

    _n_chunks = (len(tickers) + _CHUNK_SIZE - 1) // _CHUNK_SIZE
    for _ci, _ci_start in enumerate(range(0, len(tickers), _CHUNK_SIZE)):
        _chunk = tickers[_ci_start: _ci_start + _CHUNK_SIZE]
        print(f"[PastCatalyst] Download blocco {_ci+1}/{_n_chunks}: "
              f"{len(_chunk)} ticker …", end=" ", flush=True)
        try:
            _raw = _yf.download(_chunk, period="5y", auto_adjust=True,
                                group_by="ticker", progress=False)
            _ok = 0
            for _tk in _chunk:
                _s = _extract_close(_raw, _tk, len(_chunk))
                if _s is not None and not _s.empty:
                    _close_cache[_tk] = _s
                    _ok += 1
            print(f"OK ({_ok}/{len(_chunk)})")
        except Exception as _de:
            print(f"errore: {_de}")

    if not _close_cache:
        print("[PastCatalyst] Nessun dato scaricato — merge past_pred non generato.")
        return {}

    # ── Helper: restituisce Close series dal cache ────────────────────────────
    def _get_close(tk):
        return _close_cache.get(tk)

    # ── Helper: slope %/gg su n barre fino a end_d ───────────────────────────
    def _sl(ser, end_d, n):
        try:
            ts = _pd.Timestamp(end_d)
            s  = ser[ser.index <= ts].dropna().tail(n)
            if len(s) < max(3, n // 2): return None
            x  = _np.arange(len(s), dtype=float)
            y  = s.values.astype(float)
            p0 = y[0] if y[0] > 0 else 1.0
            return round(float(_np.polyfit(x, (y / p0 - 1.0) * 100.0, 1)[0]), 4)
        except: return None

    # ── Helper: RSI-14 fino a end_d ──────────────────────────────────────────
    def _rsi(ser, end_d):
        try:
            ts = _pd.Timestamp(end_d)
            s  = ser[ser.index <= ts].dropna().tail(30)
            if len(s) < 15: return None
            d  = s.diff().dropna()
            g  = d.clip(lower=0).rolling(14).mean()
            l  = (-d.clip(upper=0)).rolling(14).mean()
            v  = (100 - 100 / (1 + g / l.replace(0, float("nan")))).iloc[-1]
            return float(v) if _pd.notna(v) else None
        except: return None

    # ── Helper: vol ratio fino a end_d ───────────────────────────────────────
    def _vrat(vol, end_d):
        return None  # volume non disponibile in download solo Close; usato come None

    # ── Helper: variazione % al n-esimo giorno di borsa da completion_date ──────
    def _dn(ser, cd, n_days):
        try:
            ts0  = _pd.Timestamp(cd)
            p0s  = ser[ser.index >= ts0].dropna()
            if p0s.empty: return None
            p0   = float(p0s.iloc[0])                     # prezzo al cd (o primo giorno utile)
            ts1  = _pd.Timestamp(cd + _td(days=n_days * 2 + 5))  # finestra calendario ampia
            p1s  = ser[(ser.index > ts0) & (ser.index <= ts1)].dropna()
            if len(p1s) < n_days: return None
            p1   = float(p1s.iloc[n_days - 1])            # n-esimo giorno di borsa (1-indexed)
            return round((p1 / p0 - 1.0) * 100.0, 2) if p0 > 0 else None
        except: return None

    # ── Calcolo XBI per excess slope ─────────────────────────────────────────
    try:
        _xbi_raw = _yf.download("^XBI", period="5y", auto_adjust=True, progress=False)
        _xbi_s   = (_xbi_raw["Close"] if "Close" in _xbi_raw.columns
                    else _xbi_raw.iloc[:, 0]).dropna()
        if hasattr(_xbi_s.index, "tz"):
            _xbi_s.index = _pd.to_datetime(_xbi_s.index).tz_localize(None)
    except: _xbi_s = _pd.Series(dtype=float)

    def _exc_sl(ser, end_d):
        try:
            s_tk  = _sl(ser, end_d, 45)
            common = ser.index.intersection(_xbi_s.index)
            if len(common) < 5 or s_tk is None: return None
            s_xbi = _sl(_xbi_s.reindex(common), end_d, 45)
            return round(s_tk - s_xbi, 4) if s_xbi is not None else None
        except: return None

    # ── Loop principale: un record per (ticker, cd) ───────────────────────────
    result: dict = {}
    for tk, cd in _ticker_cd_pairs:
        _rkey = f"{tk}|{cd}"   # chiave composita nel dict di output
        cls = _get_close(tk)
        if cls is None or cls.empty:
            print(f"[PastCatalyst] {tk} ({cd}): nessun dato prezzo → escluso")
            continue

        # ── Rilevamento quotazione al momento dello studio ────────────────────
        # "non quotata" = primo dato di borsa SUCCESSIVO alla completion_date
        # oppure meno di 21 barre di trading disponibili prima del catalyst
        # (21 gg ≈ 1 mese di borsa; segno probabile di IPO vicino al catalyst)
        _cd_ts        = _pd.Timestamp(cd)
        _pre_cd       = cls[cls.index < _cd_ts].dropna()
        _pre_cd_count = len(_pre_cd)
        _first_trade  = cls.index[0].date() if not cls.empty else None

        # Non quotata = nessun dato di borsa prima della completion_date
        _non_quotata  = (_pre_cd_count == 0)
        # Dati insufficienti = meno di 21 barre (1 mese) → segnali inaffidabili
        _dati_scarsi  = (not _non_quotata and _pre_cd_count < 21)

        if _non_quotata:
            print(f"[PastCatalyst] {tk}: non quotata al {cd} "
                  f"(primo trade: {_first_trade}) → inclusa con flag")
        elif _dati_scarsi:
            print(f"[PastCatalyst] {tk}: solo {_pre_cd_count} gg di borsa prima di {cd} "
                  f"(IPO recente?) → inclusa con flag 'dati scarsi'")

        ref_d  = cd - _td(days=7)   # segnali calcolati a T-7 (pre-catalyst)
        slope  = _sl(cls, ref_d, 45)
        sl5    = _sl(cls, ref_d, 5)
        sl20   = _sl(cls, ref_d, 20)
        exc    = _exc_sl(cls, ref_d)
        rsi_v  = _rsi(cls, ref_d)
        run30  = None   # richiederebbe serie vol
        run7   = None
        ath_p  = None
        vr     = None
        va     = None

        # Direzioni per i 4 modelli
        _v_dirs: dict[str, str]         = {}
        _v_scores: dict[str, int|None]  = {}
        d5_act = _dn(cls, cd, 5)

        for _ver in _VERSIONS:
            _vd = _direction_for_version(
                _ver, None, exc, slope, rsi_v,
                vr, va, run30, sl5, sl20,
                run_up_7d=run7, ath_prox=ath_p, vol_px_div=None,
            )
            _v_dirs[_ver]   = _vd
            _v_scores[_ver] = _prediction_score(_vd, d5_act)

        d3_act  = _dn(cls, cd, 3)
        d10_act = _dn(cls, cd, 10)
        d30_act = _dn(cls, cd, 30)

        # ── Curve fitting pre-catalyst → predizione numerica del modello ──────
        # Stesso algoritmo del main model: fit su 42gg di storia fino a T-7,
        # estrapolazione a T+3/5/10/30. Permet di calcolare Δ = effettivo - predetto.
        def _r2(y, yp):
            ss_r = float(_np.sum((y - yp) ** 2))
            ss_t = float(_np.sum((y - y.mean()) ** 2))
            return 1.0 - ss_r / ss_t if ss_t > 0 else 0.0

        _ref_ts   = _pd.Timestamp(ref_d)
        _hist_s   = cls[(cls.index >= _pd.Timestamp(ref_d - _td(days=49))) &
                        (cls.index <= _ref_ts)].dropna()
        _p_ref    = float(_hist_s.iloc[-1]) if not _hist_s.empty else None
        _m_d3 = _m_d5 = _m_d10 = _m_d30 = None

        if _p_ref and _p_ref > 0 and len(_hist_s) >= 5:
            _pairs = []
            for _dt2, _prc in _hist_s.items():
                _dx = (_pd.Timestamp(_dt2).date() - ref_d).days   # -49..0
                if -42 <= _dx <= 0 and float(_prc) > 0:
                    _pairs.append((float(_dx),
                                   (float(_prc) / _p_ref - 1.0) * 100.0))
            if len(_pairs) >= 5:
                _pairs.sort()
                _xa = _np.array([p[0] for p in _pairs])
                _ya = _np.array([p[1] for p in _pairs])
                _cands: dict = {}
                try:
                    _c = _np.polyfit(_xa, _ya, 1)
                    _cands["lin"] = (_r2(_ya, _np.polyval(_c, _xa)), _c, "lin")
                except Exception: pass
                if len(_pairs) >= 6:
                    try:
                        _c = _np.polyfit(_xa, _ya, 2)
                        _cands["pol"] = (_r2(_ya, _np.polyval(_c, _xa)), _c, "pol")
                    except Exception: pass
                try:
                    _ysh = _ya + 105.0
                    if _np.all(_ysh > 0):
                        _c   = _np.polyfit(_xa, _np.log(_ysh), 1)
                        _ype = _np.exp(_np.polyval(_c, _xa)) - 105.0
                        _cands["exp"] = (_r2(_ya, _ype), _c, "exp")
                except Exception: pass
                if _cands:
                    _, (_br2, _bc, _bt) = max(
                        _cands.items(), key=lambda kv: kv[1][0])
                    _delta_gg = 7   # predizione fatta a T-7 rispetto a cd
                    def _pred_at(xt, _c=_bc, _t=_bt):
                        if _t == "exp":
                            return float(_np.exp(_np.polyval(_c, float(xt))) - 105.0)
                        return float(_np.polyval(_c, float(xt)))
                    _cap = 25.0
                    def _cp(v):
                        return round(max(-_cap, min(_cap, v)), 1) if v is not None else None
                    _m_d3  = _cp(_pred_at(_delta_gg + 3))
                    _m_d5  = _cp(_pred_at(_delta_gg + 5))
                    _m_d10 = _cp(_pred_at(_delta_gg + 10))
                    _m_d30 = _cp(_pred_at(_delta_gg + 30))
                    # Allineamento segno alla direzione v4 (stesso logica main model)
                    _dv4 = _v_dirs.get("v4_options", "→")
                    def _align_m(v):
                        if v is None: return None
                        if _dv4.startswith("↑") and v < 0: return round(-v * 0.4, 1)
                        if _dv4.startswith("↓") and v > 0: return round(-v * 0.7, 1)
                        if _dv4.startswith("→"):           return round(v * 0.35, 1)
                        return v
                    _m_d3  = _align_m(_m_d3)
                    _m_d5  = _align_m(_m_d5)
                    _m_d10 = _align_m(_m_d10)
                    _m_d30 = _align_m(_m_d30)

        if _non_quotata or _dati_scarsi:
            _m_d3 = _m_d5 = _m_d10 = _m_d30 = None
        _pred_dataset_incomplete = (
            _non_quotata or _dati_scarsi
            or (
                _m_d3 is None and _m_d5 is None
                and _m_d10 is None and _m_d30 is None
            )
        )

        # Δ = effettivo - predetto (errore; negativo = overestimated)
        def _dlt(act, mod):
            return round(act - mod, 1) if act is not None and mod is not None else None

        sc4  = _v_scores.get("v4_options")
        _aff = sc4 if sc4 is not None else 0
        _ns  = (5 if _aff >= 80 else 4 if _aff >= 60 else
                3 if _aff >= 40 else 2 if _aff >= 20 else 1)

        result[_rkey] = {
            # Identificazione dello studio
            "ticker":      tk,
            "dir_v1":      _v_dirs.get("v1_momentum"),
            "dir_v2":      _v_dirs.get("v2_signals"),
            "dir_v3":      _v_dirs.get("v3_ensemble"),
            "dir_v4":      _v_dirs.get("v4_options"),
            "score_v1":    _v_scores.get("v1_momentum"),
            "score_v2":    _v_scores.get("v2_signals"),
            "score_v3":    _v_scores.get("v3_ensemble"),
            "score_v4":    sc4,
            # Risultati effettivi (per _write_pred_pct — mostrati in corsivo)
            "d3_pct":      d3_act,
            "d5_pct":      d5_act,
            "d10_pct":     d10_act,
            "d30_pct":     d30_act,
            # Predizione numerica del modello (curve fitting T-7)
            "model_d3_pct":  _m_d3,
            "model_d5_pct":  _m_d5,
            "model_d10_pct": _m_d10,
            "model_d30_pct": _m_d30,
            # Δ = effettivo - predetto
            "delta_d3":  _dlt(d3_act,  _m_d3),
            "delta_d5":  _dlt(d5_act,  _m_d5),
            "delta_d10": _dlt(d10_act, _m_d10),
            "delta_d30": _dlt(d30_act, _m_d30),
            "affidabilita":         _aff,
            "stars":                "★" * _ns + "☆" * (5 - _ns),
            "direction":            _v_dirs.get("v4_options"),
            "pred_dataset_incomplete": _pred_dataset_incomplete,
            "completion_date":      cd,
            # Quotazione al momento dello studio
            "non_quotata_al_tempo": _non_quotata,
            "dati_scarsi":          _dati_scarsi,
            "pre_catalyst_days":    _pre_cd_count,
            "first_trade_date":     _first_trade,
        }
        _avail = [k for k, v in {
            "d3": d3_act, "d5": d5_act, "d10": d10_act, "d30": d30_act
        }.items() if v is not None]
        print(f"[PastCatalyst] {tk} (cd={cd}): dir_v4={_v_dirs.get('v4_options')} | "
              f"effettivi={_avail} | mod_d5={_m_d5} | delta_d5={_dlt(d5_act,_m_d5)} | "
              f"score_v4={sc4}")

    return result


def _run_retro_backtest(clinical_df, financial_df=None, retro_cohort: str | None = None):
    """
    Backtesting retro su studi passati — sponsor Exact/Partial come data_orchestrator.
    Coorte: retro_cohort o env RETRO_CALIB_COHORT — v4 (tutto), v5 (ultimi 200), v6 (esito noto).
    """
    try:
        import numpy as np
        import yfinance as yf
        import pandas as pd
        import json as _json
        import os as _os
        from datetime import date as _date, timedelta as _td
    except ImportError:
        return []

    today = _date.today()
    _rc = (retro_cohort or FE_RETRO_CALIB_COHORT or "v5").strip().lower()
    if _rc not in ("v4", "v5", "v6"):
        _rc = "v5"

    # ── Identifica colonne in clinical_df ─────────────────────────────────────
    cols       = clinical_df.columns.tolist()
    ticker_col = next((c for c in ["ticker", "symbol"] if c in cols), None)
    date_col   = next((c for c in ["primary_completion_date", "completion_date",
                                    "study_completion_date",
                                    "estimated_completion_date"]
                        if c in cols), None)
    phase_col  = next((c for c in ["phase", "phases"] if c in cols), None)
    ls_col     = next((c for c in ["lead_sponsor", "sponsor"] if c in cols), None)
    rpo_col    = next((c for c in ["responsible_party_organization",
                                    "responsible_party_org"] if c in cols), None)
    clb_col    = "collaborators" if "collaborators" in cols else None
    qc_col     = "query_company" if "query_company" in cols else None
    nct_col    = next((c for c in ["nct_id", "NCTId", "nct_number"]
                       if c in cols), None)

    if not date_col:
        print("[RetroBacktest] Colonna data non trovata in clinical_df.")
        return []

    # ── Filtro temporale: studi completati almeno 42 giorni fa ────────────────
    def _to_d(v):
        if v is None: return None
        if hasattr(v, "date"): return v.date()
        if isinstance(v, _date): return v
        try:    return pd.Timestamp(v).date()
        except: return None

    cutoff = today - _td(days=42)
    cdf    = clinical_df.copy()
    cdf["_d"] = cdf[date_col].apply(_to_d)
    cdf = cdf[cdf["_d"].apply(lambda d: d is not None and d <= cutoff)]
    cdf = cdf.sort_values("_d", ascending=False)
    if _rc == "v5":
        cdf = cdf.head(200)

    print(f"[RetroBacktest] Cohorte retro: {_rc} | righe dopo filtro data (+cap v5): {len(cdf)}")

    if cdf.empty:
        print("[RetroBacktest] Nessuno studio passato trovato.")
        return []

    # ── Costruzione mappa companyName → ticker da yf.json e financial_df ──────
    _yfp = _os.path.join(DATA_DIR, "yf.json")
    _yf_name_to_sym: dict[str, str] = {}   # _norm(companyName) → ticker
    _sym_to_name:    dict[str, str] = {}   # ticker.upper() → companyName

    # Da yf.json
    if _os.path.exists(_yfp):
        try:
            with open(_yfp, encoding="utf-8") as _fh:
                for _it in _json.load(_fh):
                    if not isinstance(_it, dict): continue
                    _sym = str(_it.get("symbol", "")).strip().upper()
                    _nm  = str(_it.get("companyName", "")).strip()
                    if _sym and _nm:
                        _yf_name_to_sym[_norm(_nm)] = _sym
                        _sym_to_name[_sym] = _nm
        except Exception as _ye:
            print(f"[RetroBacktest] yf.json skip: {_ye}")

    # Da financial_df (aggiunge/sovrascrive con dati più freschi)
    _fn_col = None
    if financial_df is not None and not financial_df.empty:
        _fn_col  = next((c for c in ["companyName", "name", "longName", "shortName"]
                          if c in financial_df.columns), None)
        _sym_col = next((c for c in ["symbol", "ticker", "Ticker"]
                          if c in financial_df.columns), None)
        if _fn_col and _sym_col:
            for _, _fr in financial_df.iterrows():
                _sym = str(_fr.get(_sym_col, "")).strip().upper()
                _nm  = str(_fr.get(_fn_col,  "")).strip()
                if _sym and _nm:
                    _yf_name_to_sym[_norm(_nm)] = _sym
                    _sym_to_name[_sym] = _nm

    # ── Risoluzione ticker per ogni studio (3 passaggi) ───────────────────────
    # {riga_idx → (ticker, exact_match_confirmed)}
    _idx_to_sym: dict[int, str] = {}

    for _idx, _row in cdf.iterrows():
        _ls  = str(_row[ls_col]  or "") if ls_col  else ""
        _rpo = str(_row[rpo_col] or "") if rpo_col else ""
        _clb = str(_row[clb_col] or "") if clb_col else ""
        _qc  = str(_row[qc_col]  or "") if qc_col  else ""

        # Pass 1: ticker diretto dal CSV
        _tk1 = str(_row[ticker_col] or "").strip().upper() if ticker_col else ""
        if _tk1 and _tk1 in _sym_to_name:
            if _compute_sponsor_match(_sym_to_name[_tk1], _ls, _rpo, _clb) in ("Exact", "Partial"):
                _idx_to_sym[_idx] = _tk1
                continue

        # Pass 2: normalizza query_company → cerca in _yf_name_to_sym
        if _qc:
            _tk2 = _yf_name_to_sym.get(_norm(_qc), "")
            if _tk2 and _compute_sponsor_match(_sym_to_name.get(_tk2, _qc),
                                                _ls, _rpo, _clb) in ("Exact", "Partial"):
                _idx_to_sym[_idx] = _tk2
                continue

        # Pass 3: confronta ogni companyName noto vs lead_sponsor di questo studio
        for _sym_cand, _name_cand in _sym_to_name.items():
            if _compute_sponsor_match(_name_cand, _ls, _rpo, _clb) in ("Exact", "Partial"):
                _idx_to_sym[_idx] = _sym_cand
                break

    # ── Filtra cdf ai soli studi con ticker risolto ───────────────────────────
    cdf = cdf.loc[list(_idx_to_sym.keys())]
    if cdf.empty:
        print("[RetroBacktest] Nessuno studio con ticker Exact/Partial risolvibile.")
        return []

    if _rc == "v6":
        _nv_pre = len(cdf)
        _keepers_v6: list = []
        for _ix, _rw in cdf.iterrows():
            _nid = (str(_rw[nct_col] or "").strip().upper()
                    if nct_col else "")
            if _fe_retro_outcome_known_from_row(_rw, _nid):
                _keepers_v6.append(_ix)
        cdf = cdf.loc[_keepers_v6]
        _idx_to_sym = {i: _idx_to_sym[i] for i in cdf.index}
        print(
            f"[RetroBacktest] v6: {len(cdf)} studi con esito noto "
            f"(da {_nv_pre} con ticker risolto)."
        )

    tickers_resolved = sorted({_idx_to_sym[i] for i in cdf.index})
    if not tickers_resolved:
        print("[RetroBacktest] Nessuno studio nella coorte dopo i filtri (incl. v6).")
        return []
    print(f"[RetroBacktest] {len(cdf)} studi Exact/Partial risolti → "
          f"{len(tickers_resolved)} ticker: {tickers_resolved}")

    # ── Download prezzi XBI per excess slope ──────────────────────────────────
    try:
        _xbi_raw = yf.download("^XBI", period="3y", auto_adjust=True, progress=False)
        _xbi = (_xbi_raw["Close"] if "Close" in _xbi_raw.columns
                else _xbi_raw.iloc[:, 0]).dropna()
        if hasattr(_xbi.index, "tz_localize"):
            _xbi.index = pd.to_datetime(_xbi.index).tz_localize(None)
    except Exception:
        _xbi = pd.Series(dtype=float)

    # ── Download prezzi storici batch ─────────────────────────────────────────
    try:
        raw_dl = yf.download(tickers_resolved, period="3y", auto_adjust=True,
                             group_by="ticker", progress=False)
    except Exception as _de:
        print(f"[RetroBacktest] Errore download batch: {_de}")
        return []

    # ── Helper segnali ────────────────────────────────────────────────────────
    def _sl(ser, end_d, n):
        try:
            ts = pd.Timestamp(end_d)
            s  = ser[ser.index <= ts].dropna().tail(n)
            if len(s) < max(3, n // 2): return None
            x  = np.arange(len(s), dtype=float)
            y  = s.values.astype(float)
            p0 = y[0] if y[0] > 0 else 1.0
            return round(float(np.polyfit(x, (y / p0 - 1.0) * 100.0, 1)[0]), 4)
        except: return None

    def _rsi(ser, end_d):
        try:
            ts = pd.Timestamp(end_d)
            s  = ser[ser.index <= ts].dropna().tail(30)
            if len(s) < 15: return None
            d  = s.diff().dropna()
            g  = d.clip(lower=0).rolling(14).mean()
            l  = (-d.clip(upper=0)).rolling(14).mean()
            v  = (100 - 100 / (1 + g / l.replace(0, float("nan")))).iloc[-1]
            return float(v) if pd.notna(v) else None
        except: return None

    def _vrat(vol, end_d):
        try:
            ts = pd.Timestamp(end_d)
            v  = vol[vol.index <= ts].dropna().tail(20)
            if len(v) < 10: return None
            a5  = float(v.tail(5).mean())
            a15 = float(v.tail(20).head(15).mean())
            return round(a5 / a15, 3) if a15 > 0 else None
        except: return None

    def _vacl(vol, end_d):
        try:
            ts = pd.Timestamp(end_d)
            v  = vol[vol.index <= ts].dropna().tail(10)
            if len(v) < 10: return None
            return round(float(v.tail(5).mean()) / float(v.head(5).mean()), 2)
        except: return None

    def _runup(ser, end_d, n):
        try:
            ts = pd.Timestamp(end_d)
            s  = ser[ser.index <= ts].dropna().tail(n)
            if len(s) < max(5, n // 3): return None
            return round((float(s.iloc[-1]) / float(s.iloc[0]) - 1.0) * 100.0, 1)
        except: return None

    def _ath(ser, end_d):
        try:
            ts  = pd.Timestamp(end_d)
            s   = ser[ser.index <= ts].dropna()
            if len(s) < 20: return None
            hi  = float(s.tail(252).max())
            cur = float(s.iloc[-1])
            return round(cur / hi, 3) if hi > 0 else None
        except: return None

    def _exc(ticker_ser, end_d):
        try:
            if _xbi.empty: return None
            ts    = pd.Timestamp(end_d)
            s1    = _sl(ticker_ser, end_d, 45)
            xbi_w = _xbi[_xbi.index <= ts].tail(45)
            if len(xbi_w) < 5 or s1 is None: return None
            x  = np.arange(len(xbi_w), dtype=float)
            y  = xbi_w.values.astype(float)
            p0 = y[0] if y[0] > 0 else 1.0
            xs = round(float(np.polyfit(x, (y / p0 - 1.0) * 100.0, 1)[0]), 4)
            return round(s1 - xs, 4)
        except: return None

    def _phase_num(ph):
        ph = str(ph).upper()
        if any(x in ph for x in ["3", "III"]): return 3
        if any(x in ph for x in ["2", "II"]):  return 2
        if any(x in ph for x in ["1", "I"]):   return 1
        return None

    def _get_series(sym):
        """Estrae (close_series, vol_series) dal batch download."""
        try:
            if len(tickers_resolved) == 1:
                close_s = (raw_dl["Close"] if "Close" in raw_dl.columns
                           else raw_dl.iloc[:, 0]).dropna()
                vol_s   = (raw_dl["Volume"] if "Volume" in raw_dl.columns
                           else pd.Series(dtype=float))
            else:
                lvl0 = raw_dl.columns.get_level_values(0)
                if sym not in lvl0: return None, None
                close_s = raw_dl[sym]["Close"].dropna()
                vol_s   = (raw_dl[sym]["Volume"]
                           if "Volume" in raw_dl[sym].columns
                           else pd.Series(dtype=float))
            for _s in (close_s, vol_s):
                if hasattr(_s.index, "tz"):
                    _s.index = pd.to_datetime(_s.index).tz_localize(None)
            return close_s, vol_s
        except:
            return None, None

    # ── Loop backtest ─────────────────────────────────────────────────────────
    results = []
    for _idx, _row in cdf.iterrows():
        sym  = _idx_to_sym[_idx]
        cd   = _row["_d"]
        ph   = str(_row[phase_col]).strip() if phase_col else ""
        ph_n = _phase_num(ph)

        close_s, vol_s = _get_series(sym)
        if close_s is None or close_s.empty: continue

        ref_d = cd - _td(days=7)  # segnali calcolati a T-7

        rsi_v  = _rsi(close_s,   ref_d)
        vr     = _vrat(vol_s,    ref_d)
        va     = _vacl(vol_s,    ref_d)
        slope  = _sl(close_s,    ref_d, 45)
        sl5    = _sl(close_s,    ref_d, 5)
        sl20   = _sl(close_s,    ref_d, 20)
        run30  = _runup(close_s, ref_d, 30)
        run7   = _runup(close_s, ref_d, 7)
        ath_p  = _ath(close_s,   ref_d)
        exc_sl = _exc(close_s,   ref_d)

        direction, _ = _direction_ensemble(
            ph_n, exc_sl, slope, rsi_v, vr, va,
            run30, sl5, sl20, run_up_7d=run7, ath_prox=ath_p,
            days_to_t=7,
        )

        # ── Prezzi pre-T (variazioni storiche al catalyst) ────────────────────
        ts_t        = pd.Timestamp(cd)
        p_t         = close_s[close_s.index <= ts_t]
        close_after = close_s[close_s.index >  ts_t]
        if p_t.empty: continue
        p0 = float(p_t.iloc[-1])   # prezzo di chiusura a T

        # variazioni pre-catalyst (calcolate dalla serie intera fino a T)
        var_1m  = _runup(close_s, ts_t, 21)   # ~1 mese di trading days
        var_3m  = _runup(close_s, ts_t, 63)   # ~3 mesi
        var_6m  = _runup(close_s, ts_t, 126)  # ~6 mesi

        # ── Rendimenti effettivi post-T ────────────────────────────────────
        def _pret(n):
            sub = close_after.iloc[:n]
            if sub.empty: return None
            px = float(sub.iloc[-1])
            return round((px / p0 - 1.0) * 100.0, 2) if p0 > 0 else None

        d3  = _pret(3)
        d5  = _pret(5)
        d10 = _pret(10)
        d30 = _pret(30)

        _d_ref = None
        if d10 is not None:
            _d_ref = float(d10)
        elif d5 is not None:
            _d_ref = float(d5)
        if _d_ref is None:
            continue
        _hist_horizon = "T+10" if d10 is not None else "T+5"

        # ── ok_v* = solo direzione vs storico; score_v* = accordo % ───────────────
        _v_dirs:  dict[str, str]           = {}
        _v_corr:  dict[str, bool | None]   = {}
        _v_score: dict[str, int  | None]   = {}
        for _ver in _VERSIONS:
            _vd = _direction_for_version(
                _ver, ph_n, exc_sl, slope, rsi_v, vr, va,
                run30, sl5, sl20,
                run_up_7d=run7, ath_prox=ath_p, vol_px_div=0,
            )
            _v_dirs[_ver]  = _vd
            _v_score[_ver] = _prediction_score(_vd, _d_ref)
            if   _vd.startswith("↑"): _v_corr[_ver] = _d_ref > 0
            elif _vd.startswith("↓"): _v_corr[_ver] = _d_ref < 0
            elif _vd == "→ Stabile":  _v_corr[_ver] = abs(_d_ref) < 5.0
            else:                     _v_corr[_ver] = None

        # correct e direction basati su v4 (versione corrente)
        direction = _v_dirs[_MODEL_VERSION]
        correct   = _v_corr[_MODEL_VERSION]

        results.append({
            "ticker":        sym,
            "company_name":  _sym_to_name.get(sym, ""),
            "comp_date":     cd.isoformat(),
            "phase":         ph,
            "model_version": _MODEL_VERSION,
            "retro_cohort":  _rc,
            "direction":     direction,
            "price_at_t":    round(p0, 4),
            "var_1m_pre":    var_1m,
            "var_3m_pre":    var_3m,
            "var_6m_pre":    var_6m,
            "d3_actual":     d3,
            "d5_actual":     d5,
            "d10_actual":    d10,
            "d30_actual":    d30,
            "d_hist_ref_pct":     round(float(_d_ref), 2),
            "d_hist_ref_horizon": _hist_horizon,
            "affidabilita":  50,
            "status":        "complete",
            "source":        "retro",
            "correct":       correct,
            # per-version directions, correctness, score 0-100
            "dir_v1":        _v_dirs["v1_momentum"],
            "dir_v2":        _v_dirs["v2_signals"],
            "dir_v3":        _v_dirs["v3_ensemble"],
            "dir_v4":        _v_dirs["v4_options"],
            "ok_v1":         _v_corr["v1_momentum"],
            "ok_v2":         _v_corr["v2_signals"],
            "ok_v3":         _v_corr["v3_ensemble"],
            "ok_v4":         _v_corr["v4_options"],
            "score_v1":      _v_score["v1_momentum"],
            "score_v2":      _v_score["v2_signals"],
            "score_v3":      _v_score["v3_ensemble"],
            "score_v4":      _v_score["v4_options"],
        })

    ok  = sum(1 for r in results if r.get("correct") is True)
    tot = sum(1 for r in results if r.get("correct") is not None)
    _acc_m = None
    _scv4 = [r.get("score_v4") for r in results if r.get("score_v4") is not None]
    if _scv4:
        _acc_m = round(sum(_scv4) / len(_scv4))
    _acc_note = f" | accordo medio storico (score v4): {_acc_m}/100" if _acc_m is not None else ""
    print(
        f"[RetroBacktest] {len(results)} studi elaborati | "
        f"% successo solo-direzione (v4): {ok/tot*100:.1f}% ({ok}/{tot}){_acc_note}"
        if tot > 0 else
        f"[RetroBacktest] {len(results)} studi elaborati | nessun esito valutabile")
    return results


def _compute_price_predictions(sim_rows: list) -> dict:
    """
    Per ogni ticker con completion_date FUTURA e sponsor_match=Exact,
    scarica prezzi+volumi (60gg), scarica ^XBI, e calcola:
      - RSI-14 a oggi
      - Vol build-up (media 5gg ÷ media 15gg precedenti)
      - Slope pendenza al netto di XBI (%/gg)
      - Label direzione (↑↑/↑/→/↓/↓↓) corretta per RSI
      - Livello affidabilità basato sui giorni a T (Molto buono → Troppo presto)
      - Affidabilità % = base(giorni) ± bonus segnali

    Ritorna {ticker: {direction, livello, affidabilita, rsi, vol_ratio,
                      exc_slope, days_to_t, adj_notes, r2, model,
                      d1_pct, w1_pct, m1_pct}}
    """
    try:
        import numpy as np
        import yfinance as yf
        from datetime import date as _date, timedelta as _td
        import pandas as pd
    except ImportError as _e:
        print(f"[Pred] Import mancante: {_e}")
        return {}

    today = _date.today()

    # ── Carica calibrazione per bias-correction ───────────────────────────────
    _calib_recs = _calib_load()
    _bias       = _calib_bias(_calib_recs)
    if _bias["n"] >= 5:
        print(f"[Pred] Calibrazione attiva: n={_bias['n']} obs | "
              f"bias d3={_bias['d3']:+.2f}%  d5={_bias['d5']:+.2f}%  "
              f"d10={_bias['d10']:+.2f}%  d30={_bias['d30']:+.2f}%")
    else:
        print(f"[Pred] Calibrazione: {_bias['n']} obs completati "
              f"(servono ≥5 per attivare la bias-correction)")

    # ── Helper: converti a date ───────────────────────────────────────────────
    def _to_date(v):
        if v is None:              return None
        if hasattr(v, "date"):     return v.date()
        if isinstance(v, _date):   return v
        try:   return pd.Timestamp(v).date()
        except Exception: return None

    # ── Helper: RSI-14 ────────────────────────────────────────────────────────
    def _rsi14(close_ser: pd.Series) -> float | None:
        try:
            delta_ = close_ser.diff().dropna()
            if len(delta_) < 14: return None
            gain = delta_.clip(lower=0).rolling(14).mean()
            loss = (-delta_.clip(upper=0)).rolling(14).mean()
            rs   = gain / loss.replace(0, float("nan"))
            rsi  = 100 - 100 / (1 + rs)
            val  = rsi.iloc[-1]
            return float(val) if pd.notna(val) else None
        except Exception: return None

    # ── Helper: vol build-up ─────────────────────────────────────────────────
    def _vol_ratio(vol_ser: pd.Series) -> float | None:
        try:
            if len(vol_ser) < 20: return None
            avg5  = float(vol_ser.iloc[-5:].mean())
            avg15 = float(vol_ser.iloc[-20:-5].mean())
            return round(avg5 / avg15, 3) if avg15 > 0 else None
        except Exception: return None

    # ── Helper: prossimità al massimo 52 settimane ────────────────────────────
    def _52wk_proximity(close_ser: pd.Series) -> float | None:
        """Prezzo corrente / massimo 252gg. 1.0 = su ATH, 0.5 = a metà."""
        try:
            s = close_ser.dropna()
            if len(s) < 20: return None
            hi  = float(s.tail(252).max())
            cur = float(s.iloc[-1])
            return round(cur / hi, 3) if hi > 0 else None
        except Exception: return None

    # ── Helper: divergenza volume-prezzo ─────────────────────────────────────
    def _vol_price_div(close_ser: pd.Series, vol_ser: pd.Series, n: int = 20) -> int:
        """
        +1 = prezzo scende ma volume sale  (accumulo → segnale bull)
        -1 = prezzo sale  ma volume scende (distribuzione → segnale bear)
         0 = nessuna divergenza
        """
        try:
            p_sl = _slope_n(close_ser, n)
            raw_vol = vol_ser.dropna().astype(float).tail(n)
            if len(raw_vol) < max(3, n // 2): return 0
            xv = np.arange(len(raw_vol), dtype=float)
            yv = raw_vol.values
            v_sl = float(np.polyfit(xv, yv / (yv.mean() or 1.0), 1)[0]) * 100.0
            if p_sl is None: return 0
            if p_sl < -0.3 and v_sl >  0.5: return +1   # prezzo ↓ vol ↑
            if p_sl >  0.3 and v_sl < -0.5: return -1   # prezzo ↑ vol ↓
            return 0
        except Exception: return 0

    # ── Helper: vol acceleration (ultima settimana vs settimana precedente) ───
    def _vol_accel(vol_ser: pd.Series) -> float | None:
        """Avg volume ultimi 5gg / avg volume 5gg precedenti."""
        try:
            v = vol_ser.dropna()
            if len(v) < 10: return None
            last5 = float(v.tail(5).mean())
            prev5 = float(v.tail(10).head(5).mean())
            return round(last5 / prev5, 2) if prev5 > 0 else None
        except Exception: return None

    # ── Helper: slope su n giorni (multi-timeframe) ───────────────────────────
    def _slope_n(close_ser: pd.Series, n: int) -> float | None:
        """Slope %/gg degli ultimi n giorni di borsa."""
        try:
            s = close_ser.dropna().tail(n)
            if len(s) < max(3, n // 2): return None
            x  = np.arange(len(s), dtype=float)
            y  = s.values.astype(float)
            p0 = y[0] if y[0] > 0 else 1.0
            c  = np.polyfit(x, (y / p0 - 1.0) * 100.0, 1)
            return round(float(c[0]), 4)
        except Exception: return None

    # ── Helper: run-up % ultimi n giorni (buy-the-rumor detector) ────────────
    def _run_up(close_ser: pd.Series, n_days: int = 30) -> float | None:
        """% variazione dal primo prezzo disponibile negli ultimi n_days."""
        try:
            s = close_ser.dropna()
            if len(s) < max(5, n_days // 3): return None
            ref = float(s.tail(n_days).iloc[0])
            cur = float(s.iloc[-1])
            return round((cur / ref - 1.0) * 100.0, 1) if ref > 0 else None
        except Exception: return None

    # ── Helper: segnali da catena opzioni (yfinance) ─────────────────────────
    def _options_signals(ticker: str, curr_price: float) -> dict:
        """
        Scarica la prima scadenza disponibile e ritorna:
          pcr          — put/call volume ratio
          exp_move_pct — (straddle ATM / curr_price) * 100
        Ritorna {} silenziosamente su qualsiasi errore.
        """
        try:
            t    = yf.Ticker(ticker)
            exps = t.options
            if not exps:
                return {}
            chain = t.option_chain(exps[0])
            calls = chain.calls.copy()
            puts  = chain.puts.copy()

            # PCR per volume
            cv  = float(calls["volume"].fillna(0).sum())
            pv  = float(puts["volume"].fillna(0).sum())
            pcr = round(pv / cv, 3) if cv > 0 else None

            # Expected move: straddle ATM
            exp_move_pct = None
            if curr_price > 0 and not calls.empty:
                calls["_dist"] = (calls["strike"] - curr_price).abs()
                atm_strike = float(calls.sort_values("_dist").iloc[0]["strike"])
                atm_call_rows = calls[calls["strike"] == atm_strike]["lastPrice"]
                atm_put_rows  = puts[puts["strike"]  == atm_strike]["lastPrice"]
                atm_c = float(atm_call_rows.iloc[0]) if not atm_call_rows.empty else 0.0
                atm_p = float(atm_put_rows.iloc[0])  if not atm_put_rows.empty  else 0.0
                straddle = atm_c + atm_p
                if straddle > 0:
                    exp_move_pct = round(straddle / curr_price * 100, 1)

            return {k: v for k, v in {"pcr": pcr, "exp_move_pct": exp_move_pct}.items()
                    if v is not None}
        except Exception:
            return {}

    # ── Helper: estrae numero di fase dalla stringa ───────────────────────────
    _PH_PRIOR = {
        3: ("Phase 3", +5),   # ~50% success, alta rilevanza stock
        2: ("Phase 2", -10),  # ~30% success, più rischio
        1: ("Phase 1", 0),    # safety-focused, impatto minore
    }
    def _phase_num(ph: str) -> int | None:
        ph = ph.upper()
        if any(x in ph for x in ["3", "III"]): return 3
        if any(x in ph for x in ["2", "II"]):  return 2
        if any(x in ph for x in ["1", "I"]):   return 1
        return None

    # ── Helper: slope pendenza chiusure (45gg) ────────────────────────────────
    def _slope_pct(close_ser: pd.Series) -> float | None:
        try:
            s = close_ser.dropna().tail(45)
            if len(s) < 5: return None
            x = np.arange(len(s), dtype=float)
            y = s.values.astype(float)
            p0 = y[0] if y[0] > 0 else 1.0
            c  = np.polyfit(x, (y / p0 - 1.0) * 100.0, 1)
            return round(float(c[0]), 4)   # %/gg
        except Exception: return None

    # ── Helper: slope al netto di XBI ────────────────────────────────────────
    def _exc_slope(close_ser, xbi_ser) -> float | None:
        if xbi_ser is None: return None
        try:
            s_tk  = _slope_pct(close_ser)
            common_idx = close_ser.index.intersection(xbi_ser.index)
            if len(common_idx) < 5: return None
            s_xbi = _slope_pct(xbi_ser.reindex(common_idx))
            if s_tk is None or s_xbi is None: return None
            return round(s_tk - s_xbi, 4)
        except Exception: return None

    # ── Helper: label direzione ───────────────────────────────────────────────
    _STABILE = 0.5   # %/gg — stesso valore di fetch_retrospective
    def _dir_label(slope) -> str:
        if slope is None: return "→ Stabile"
        if   slope >=  3.0: return "↑↑ Forte crescita"
        elif slope >=  0.5: return "↑ Crescita lieve"
        elif slope <= -3.0: return "↓↓ Calo forte"
        elif slope <= -0.5: return "↓ Calo lieve"
        else:               return "→ Stabile"

    # ── Helper: correzione RSI (mantenuto per compatibilità) ─────────────────
    _SCALE = ["↓↓ Calo forte", "↓ Calo lieve", "→ Stabile",
              "↑ Crescita lieve", "↑↑ Forte crescita"]
    def _adj_rsi(pred: str, rsi) -> tuple[str, str]:
        if rsi is None: return pred, ""
        notes = []
        if rsi > 70 and pred in ("↑↑ Forte crescita", "↑ Crescita lieve"):
            idx = _SCALE.index(pred)
            pred = _SCALE[max(0, idx - 1)]
            notes.append(f"RSI {rsi:.0f} OB → downgrade")
        elif rsi < 30 and pred in ("↓↓ Calo forte", "↓ Calo lieve"):
            idx = _SCALE.index(pred)
            pred = _SCALE[min(4, idx + 1)]
            notes.append(f"RSI {rsi:.0f} OS → upgrade")
        return pred, "; ".join(notes)

    # _direction_ensemble è definita a livello modulo — usata anche dal backtesting.

    # ── Helper: livello affidabilità ─────────────────────────────────────────
    def _livello(days: int) -> str:
        if days <= 3:  return "🎯 Molto buono"
        if days <= 7:  return "📈 Buono"
        if days <= 30: return "📊 Basso"
        if days <= 60: return "⏳ Molto basso"
        return "⬜ Troppo presto"

    # ── Helper: affidabilità % ───────────────────────────────────────────────
    def _affidabilita(days, vr, exc, slope, rsi, r2,
                      vol_accel=None, slope_aligned=None, phase_num=None) -> int:
        base = (90 if days <= 3 else 78 if days <= 7 else
                62 if days <= 30 else 48 if days <= 60 else 35)
        adj = 0
        if vr  is not None and vr  >= 1.5:         adj += 5
        if exc is not None and exc > 0:             adj += 5
        elif exc is None and slope and slope > 0:   adj += 3
        if rsi is not None:
            if 30 <= rsi <= 70:                     adj += 3
            if rsi > 70:                            adj -= 8
            elif rsi < 30:                          adj -= 5
        # R² regime: flat pre-CD (r2 < 0.10) is neutral — quiet before catalyst is not a defect.
        if r2 is not None:
            if r2 >= 0.55 and slope is not None and slope > 0:
                adj += 5
            elif r2 >= 0.45:
                pass
            elif r2 >= 0.25:
                adj -= 5
            elif r2 >= 0.10:
                adj -= 10
        # ── Nuovi segnali ─────────────────────────────────────────────────────
        if vol_accel is not None:
            if   vol_accel >= 2.0: adj += 8    # forte accelerazione volume
            elif vol_accel >= 1.5: adj += 4
            elif vol_accel <  0.7: adj -= 4    # volume in calo
        if slope_aligned is True:  adj += 5    # 5gg e 20gg concordi
        elif slope_aligned is False: adj -= 5  # divergenti → incertezza
        if phase_num is not None:
            _, ph_adj = _PH_PRIOR.get(phase_num, ("", 0))
            adj += ph_adj
        return min(95, max(20, base + adj))

    def _aff_options_adj(opts: dict) -> int:
        """Aggiustamento affidabilità basato su segnali da opzioni (v4)."""
        adj = 0
        if opts.get("pcr") is not None:
            adj += 5   # dati opzioni disponibili: segnale aggiuntivo
        if (opts.get("exp_move_pct") or 0) > 45:
            adj -= 8   # evento binario estremo: mossa attesa > 45% → troppo incerto
        return adj

    # ── Helper: R² ───────────────────────────────────────────────────────────
    def _r2(y_true, y_pred):
        ss_res = float(np.sum((y_true - y_pred) ** 2))
        ss_tot = float(np.sum((y_true - np.mean(y_true)) ** 2))
        return 1.0 - ss_res / ss_tot if ss_tot > 1e-12 else 0.0

    # ── Solo eventi futuri, filtra su sponsor Exact ───────────────────────────
    future = []
    for r in sim_rows:
        cd = _to_date(r.get("completion_date"))
        spon = str(r.get("sponsor_match", "")).strip()
        if cd and cd >= today and spon == "Exact":
            future.append((r, cd))

    if not future:
        print("[Pred] Nessun evento futuro con sponsor Exact — nessuna predizione calcolata")
        return {}

    syms = list({str(r["ticker"]).strip().upper() for r, _ in future})
    print(f"[Pred] Segnali retro-model per {len(syms)} ticker (sponsor Exact): {syms} …")

    # ── Download prezzi + volumi ──────────────────────────────────────────────
    try:
        raw = yf.download(
            syms if len(syms) > 1 else syms[0],
            period="60d", auto_adjust=True, progress=False,
        )
    except Exception as _e:
        print(f"[Pred] Errore download: {_e}")
        return {}

    if raw is None or raw.empty:
        return {}

    closes:  dict = {}
    volumes: dict = {}
    if len(syms) == 1:
        s = syms[0]
        try:
            ser_c = raw["Close"]  if "Close"  in raw.columns else raw.iloc[:, 0]
            ser_v = raw["Volume"] if "Volume" in raw.columns else None
            ser_c.index = ser_c.index.date
            closes[s] = ser_c.astype(float).dropna()
            if ser_v is not None:
                ser_v.index = ser_v.index.date
                volumes[s] = ser_v.astype(float).dropna()
        except Exception: pass
    else:
        for s in syms:
            try:
                col_c = ("Close",  s)
                col_v = ("Volume", s)
                if col_c in raw.columns:
                    ser_c = raw[col_c];  ser_c.index = ser_c.index.date
                    closes[s]  = ser_c.astype(float).dropna()
                if col_v in raw.columns:
                    ser_v = raw[col_v];  ser_v.index = ser_v.index.date
                    volumes[s] = ser_v.astype(float).dropna()
            except Exception: pass

    # ── Download ^XBI ─────────────────────────────────────────────────────────
    _xbi = None
    try:
        _xbi_raw = yf.download("^XBI", period="60d", auto_adjust=True, progress=False)
        if not _xbi_raw.empty:
            _xbi_s = _xbi_raw["Close"] if "Close" in _xbi_raw.columns else _xbi_raw.iloc[:, 0]
            _xbi_s.index = _xbi_s.index.date
            _xbi = _xbi_s.astype(float).dropna()
            print(f"[Pred] XBI scaricato: {len(_xbi)} sessioni")
    except Exception as _xe:
        print(f"[Pred] XBI non disponibile: {_xe}")

    # ── Per ogni evento futuro ────────────────────────────────────────────────
    result = {}
    for r, comp_date in future:
        ticker = str(r["ticker"]).strip().upper()
        if ticker not in closes:
            continue
        hist = closes[ticker]
        vol  = volumes.get(ticker, pd.Series(dtype=float))
        if hist.empty:
            continue

        p_now = float(hist.iloc[-1])
        if p_now <= 0:
            continue

        # Segnali base
        rsi_val   = _rsi14(hist)
        vr        = _vol_ratio(vol)
        slope     = _slope_pct(hist)
        exc       = _exc_slope(hist, _xbi)
        days_to_t = (comp_date - today).days

        # ── Segnali tecnici ───────────────────────────────────────────────────
        slope_5d  = _slope_n(hist, 5)
        slope_20d = _slope_n(hist, 20)
        va        = _vol_accel(vol)
        run_up    = _run_up(hist, 30)
        run_up_7d = _run_up(hist, 7)
        ath_prox  = _52wk_proximity(hist)
        vpd       = _vol_price_div(hist, vol)
        phase_str = str(r.get("phase", ""))
        ph_num    = _phase_num(phase_str)

        # Multi-timeframe alignment: 5gg e 20gg concordi?
        slope_aligned: bool | None = None
        if slope_5d is not None and slope_20d is not None:
            slope_aligned = (slope_5d > 0) == (slope_20d > 0)

        # ── Segnali da opzioni v4 ─────────────────────────────────────────────
        opts        = _options_signals(ticker, p_now)
        pcr_val     = opts.get("pcr")
        exp_mv_val  = opts.get("exp_move_pct")

        # ── Direzione raw (momentum, solo diagnostica) ───────────────────────
        slope_for_dir = exc if exc is not None else slope
        direction_raw = _dir_label(slope_for_dir)

        # ── Modello ensemble v4 ───────────────────────────────────────────────
        direction_adj, _ens_notes = _direction_ensemble(
            ph_num, exc, slope, rsi_val,
            vr, va, run_up, slope_5d, slope_20d,
            run_up_7d=run_up_7d, ath_prox=ath_prox, vol_px_div=vpd,
            pcr=pcr_val, exp_move_pct=exp_mv_val, days_to_t=days_to_t,
        )
        adj_notes = "; ".join(_ens_notes)

        # ── Direzioni per tutti e 4 i modelli (per Simulation confronto) ─────
        _dir_by_ver = {
            ver: _direction_for_version(
                ver, ph_num, exc, slope, rsi_val,
                vr, va, run_up, slope_5d, slope_20d,
                run_up_7d=run_up_7d, ath_prox=ath_prox, vol_px_div=vpd,
            )
            for ver in _VERSIONS
        }

        livello = _livello(days_to_t)

        # Curve fitting (per le estrapolazioni d1/w1/m1 nel tooltip)
        pairs = []
        for d, price in hist.items():
            dx = (d - today).days
            if -42 <= dx <= 0 and float(price) > 0:
                pairs.append((float(dx), (float(price) / p_now - 1.0) * 100.0))
        best_r2   = None
        best_name = "N/D"
        d3_pct = d5_pct = d10_pct = d30_pct = None
        if len(pairs) >= 5:
            pairs.sort()
            x_arr = np.array([p[0] for p in pairs])
            y_arr = np.array([p[1] for p in pairs])
            candidates: dict = {}
            try:
                c = np.polyfit(x_arr, y_arr, 1)
                candidates["Lineare"] = (_r2(y_arr, np.polyval(c, x_arr)), c, "lin")
            except Exception: pass
            if len(pairs) >= 6:
                try:
                    c = np.polyfit(x_arr, y_arr, 2)
                    candidates["Polin°2"] = (_r2(y_arr, np.polyval(c, x_arr)), c, "pol")
                except Exception: pass
            try:
                y_sh = y_arr + 105.0
                if np.all(y_sh > 0):
                    c = np.polyfit(x_arr, np.log(y_sh), 1)
                    y_pred_e = np.exp(np.polyval(c, x_arr)) - 105.0
                    candidates["Esponenziale"] = (_r2(y_arr, y_pred_e), c, "exp")
            except Exception: pass
            if candidates:
                best_name  = max(candidates, key=lambda k: candidates[k][0])
                best_r2, best_c, best_type = candidates[best_name]
                delta = days_to_t
                def _pred_at(x_t, _c=best_c, _t=best_type):
                    if _t == "exp":
                        return float(np.exp(np.polyval(_c, float(x_t))) - 105.0)
                    return float(np.polyval(_c, float(x_t)))
                d3_pct  = round(_pred_at(delta + 3),  1)
                d5_pct  = round(_pred_at(delta + 5),  1)
                d10_pct = round(_pred_at(delta + 10), 1)
                d30_pct = round(_pred_at(delta + 30), 1)

                # ── Correzione reversion post-catalyst ───────────────────────
                # Il curve fitting estrapolante il trend pre-catalyst NON cattura
                # la discontinuità dell'evento. Correggiamo:
                #   1. Se run_up > 0: le previsioni positive vengono scalate verso
                #      il basso proporzionalmente al run-up già avvenuto (sell-the-news)
                #   2. Cap assoluto ±25% per evitare estrapolazioni esplosive
                _cap = 25.0
                if run_up is not None and run_up > 5:
                    # Fattore di reversion: più forte con run-up alto e catalyst vicino
                    _rev = min(0.6, run_up / 40.0)        # 0–0.6
                    if days_to_t <= 14: _rev = min(0.7, _rev + 0.15)
                    def _correct_pred(v, _r=_rev):
                        if v is None: return None
                        # Solo le previsioni positive vengono penalizzate
                        return round(v * (1 - _r) if v > 0 else v, 1)
                    d3_pct  = _correct_pred(d3_pct)
                    d5_pct  = _correct_pred(d5_pct)
                    d10_pct = _correct_pred(d10_pct)
                    d30_pct = _correct_pred(d30_pct)
                # Cap assoluto
                def _cap_pred(v, c=_cap):
                    return round(max(-c, min(c, v)), 1) if v is not None else None
                d3_pct  = _cap_pred(d3_pct)
                d5_pct  = _cap_pred(d5_pct)
                d10_pct = _cap_pred(d10_pct)
                d30_pct = _cap_pred(d30_pct)

                # Applica bias-correction se abbastanza osservazioni
                if _bias["n"] >= 5:
                    if d3_pct  is not None: d3_pct  = round(d3_pct  - _bias["d3"],  1)
                    if d5_pct  is not None: d5_pct  = round(d5_pct  - _bias["d5"],  1)
                    if d10_pct is not None: d10_pct = round(d10_pct - _bias["d10"], 1)
                    if d30_pct is not None: d30_pct = round(d30_pct - _bias["d30"], 1)

        # ── Allineamento direzione ↔ percentuali ─────────────────────────────
        # direction_adj e d3/d5/d10 sono calcolati indipendentemente (ensemble
        # vs curve fitting). Se vanno in senso opposto, le % vengono riallineate
        # per coerenza: il segno segue la direzione, l'entità si riduce.
        def _align(v, bull_dir: bool) -> float | None:
            if v is None: return None
            if bull_dir  and v < 0: return round(-v * 0.4, 1)   # converti negativo→positivo ridotto
            if not bull_dir and v > 0: return round(-v * 0.7, 1) # flip positivo→negativo (×0.7)
            return v
        _is_bull   = direction_adj.startswith("↑")
        _is_bear   = direction_adj.startswith("↓")
        _is_stable = direction_adj.startswith("→")
        if _is_bear:
            d3_pct  = _align(d3_pct,  False)
            d5_pct  = _align(d5_pct,  False)
            d10_pct = _align(d10_pct, False)
            d30_pct = _align(d30_pct, False)
        elif _is_stable:
            # Comprimi verso zero: lascia al massimo il 35% del valore assoluto
            def _damp(v):
                return round(v * 0.35, 1) if v is not None else None
            d3_pct  = _damp(d3_pct)
            d5_pct  = _damp(d5_pct)
            d10_pct = _damp(d10_pct)
            d30_pct = _damp(d30_pct)
        # ↑ bull → lascia le % così come sono (la curva è già positiva)

        aff = _affidabilita(days_to_t, vr, exc, slope, rsi_val, best_r2,
                            vol_accel=va, slope_aligned=slope_aligned,
                            phase_num=ph_num)
        aff = min(95, max(20, aff + _aff_options_adj(opts)))

        # ── Stelle qualità (1-5) basate su affidabilità + segnali ────────────
        def _stars(a: int | None) -> str:
            if a is None: return "—"
            if a >= 85:   return "★★★★★"
            if a >= 70:   return "★★★★"
            if a >= 55:   return "★★★"
            if a >= 40:   return "★★"
            return "★"

        result[ticker] = {
            "direction":      direction_adj,
            "direction_raw":  direction_raw,
            "livello":        livello,
            "affidabilita":   aff,
            "stars":          _stars(aff),
            "rsi":            rsi_val,
            "vol_ratio":      vr,
            "exc_slope":      exc,
            "days_to_t":      days_to_t,
            "adj_notes":      adj_notes,
            # Predizioni curve fitting a orizzonti fissi post-T
            "r2":      round(best_r2, 3) if best_r2 is not None else None,
            "model":   best_name,
            "d3_pct":  d3_pct,
            "d5_pct":  d5_pct,
            "d10_pct": d10_pct,
            "d30_pct": d30_pct,
            # Segnali ensemble
            "slope_5d":       slope_5d,
            "slope_20d":      slope_20d,
            "slope_aligned":  slope_aligned,
            "vol_accel":      va,
            "run_up_30d":     run_up,
            "run_up_7d":      run_up_7d,
            "ath_prox":       ath_prox,
            "vol_price_div":  vpd,
            "phase":          phase_str,
            "phase_num":      ph_num,
            # Confronto 4 modelli (per Simulation sheet)
            "dir_v1": _dir_by_ver["v1_momentum"],
            "dir_v2": _dir_by_ver["v2_signals"],
            "dir_v3": _dir_by_ver["v3_ensemble"],
            "dir_v4": _dir_by_ver["v4_options"],
        }
        _rsi_s2   = f"{rsi_val:.0f}" if rsi_val is not None else "N/D"
        _vr_s2    = f"{vr:.2f}" if vr is not None else "N/D"
        _va_s     = f"{va:.2f}x" if va is not None else "N/D"
        _slp      = exc if exc is not None else slope
        _slp_s    = f"{_slp:+.3f}" if _slp is not None else "N/D"
        _ali_s    = ("TF:ok" if slope_aligned else "TF:div") if slope_aligned is not None else "TF:—"
        _ph_s     = f"Ph{ph_num}" if ph_num else "Ph?"
        _ru_s     = f"run={run_up:+.0f}%" if run_up is not None else ""
        _st_s     = _stars(aff)
        print(
            f"[Pred] {ticker} — {direction_adj} | {_st_s} | {aff}%  "
            f"RSI={_rsi_s2}  vol={_vr_s2}x  va={_va_s}  "
            f"slope={_slp_s}%/gg  {_ali_s}  {_ph_s}  {_ru_s}  "
            f"d3={d3_pct}%  d5={d5_pct}%  d10={d10_pct}%  d30={d30_pct}%"
        )

    return result


# ── Etichetta affidabilità (basata su giorni a T) ─────────────────────────────
def _reliability_label(days_to_t, horizon: str = None) -> str:
    """Livello affidabilità basato sui giorni alla completion date."""
    if days_to_t is None: return "—"
    if days_to_t <= 3:  return "🎯 Molto buono"
    if days_to_t <= 7:  return "📈 Buono"
    if days_to_t <= 30: return "📊 Basso"
    if days_to_t <= 60: return "⏳ Molto basso"
    return "⬜ Troppo presto"


def _write_full_sim_sheet(ws, rows, ticker_studies, pnl_data=None, pred_data=None):
    """
    Scrive il foglio Simulation con righe principali E righe di dettaglio clinico
    intercalate, in un UNICO passaggio senza mai chiamare insert_rows.

    Questo risolve il bug di openpyxl 3.1.5 in cui insert_rows() sposta i dati
    delle celle ma NON sposta i row_dimensions — causando outline_level/hidden
    errati sulle righe principali (che diventavano invisibili).

    Restituisce main_row_positions: list[int] — numeri di riga Excel (1-indexed)
    delle righe principali, usato da _apply_sim_coloring.
    """
    from simulation_core import (
        COLS, WIDTHS,
        HEADER_FILL, HEADER_FONT,
        INPUT_FILL, INPUT_FONT,
        FORMULA_FILL, FORMULA_FONT,
        SUMMARY_FILL, SUMMARY_FONT,
        TITLE_FILL, TITLE_FONT,
        LEGEND_FILL, LEGEND_FONT,
        CATALYST_FILL, CATALYST_FONT,
        ALIGN_C, ALIGN_R, ALIGN_L,
        FMT_MCAP, FMT_VARIATION,
        _C_CURR, _C_BUY, _C_CAP, _C_SHARES, _C_VAL,
    )
    from openpyxl.utils import get_column_letter
    from openpyxl.styles import PatternFill, Font, Alignment
    from openpyxl.worksheet.properties import Outline
    from datetime import date as _date

    ncols = len(COLS)
    _PNL_HEADERS = ["P&L€ (D0)", "P&L% (D0)",
                    "P&L€ (+1w)", "P&L% (+1w)",
                    "P&L€ (+1m)", "P&L% (+1m)"]
    _PNL_KEY_MAP = {
        "P&L€ (D0)":  ("d0_eur", "#,##0.00"),
        "P&L% (D0)":  ("d0_pct", "0.00%"),
        "P&L€ (+1w)": ("w1_eur", "#,##0.00"),
        "P&L% (+1w)": ("w1_pct", "0.00%"),
        "P&L€ (+1m)": ("m1_eur", "#,##0.00"),
        "P&L% (+1m)": ("m1_pct", "0.00%"),
    }
    # Colonne predizione inserite PRIMA della sezione investimento (col 11 = K)
    _PRED_HEADERS = [
        ("Pred\n+3gg",   "d3_pct"),   # % stimata T+3 giorni
        ("Pred\n+5gg",   "d5_pct"),   # % stimata T+5 giorni
        ("Pred\n+10gg",  "d10_pct"),  # % stimata T+10 giorni
        ("Pred\n+30gg",  "d30_pct"),  # % stimata T+30 giorni
    ]
    _PRED_FILL     = PatternFill("solid", fgColor="EDE7F6")
    _PRED_HDR_FILL = PatternFill("solid", fgColor="4B1C82")
    _PRED_INS  = 11          # Pred partono dalla col 11 di simulation_core
    _N_PRED    = len(_PRED_HEADERS)   # = 4 (no colonna stelle)
    # Phase inserita in col D (4) → tutte le col >= D shiftatate di +1
    _PH_SHIFT       = 1
    _pred_start_col = _PRED_INS + _PH_SHIFT   # = 12 (prima col PRED nel foglio)
    _INV_START      = _pred_start_col + _N_PRED  # = 16 (prima col sezione investimento)
    _SH             = _PH_SHIFT + _N_PRED         # = 5  (shift totale per formule)

    # Lettere colonne sezione investimento (= _INV_START + offset)
    _c_buy    = get_column_letter(_INV_START)      # P(16) con _N_PRED=4
    _c_cap    = get_column_letter(_INV_START + 1)  # Q(17)
    _c_shares = get_column_letter(_INV_START + 2)  # R(18)
    _c_val    = get_column_letter(_INV_START + 3)  # S(19)
    # Prezzo corrente ora in col F (6) — Phase occupa la col D (4)
    _C_CURR = "F"

    # 4 colonne confronto modelli (AC-AF = 29-32)
    _MODEL_DIR_HEADERS = [
        ("Modello\nv1", "dir_v1"),
        ("Modello\nv2", "dir_v2"),
        ("Modello\nv3", "dir_v3"),
        ("Modello\nv4 ✓", "dir_v4"),
    ]
    _N_MODEL = len(_MODEL_DIR_HEADERS)   # = 4
    _MODEL_HDR_FILL = PatternFill("solid", fgColor="1F3864")

    _sheet_is_completati = (
        str(getattr(ws, "title", "") or "").strip() == "Catalyst Completati")
    _show_hist_pnl = not _sheet_is_completati

    total_cols = (ncols + _N_PRED
                  + (len(_PNL_HEADERS) if _show_hist_pnl else 0)
                  + _PH_SHIFT + _N_MODEL)

    # ── Riga 1: titolo ────────────────────────────────────────────────────────
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=total_cols)
    tc = ws.cell(row=1, column=1,
                 value=(
                     f"Catalyst Completati — {_date.today().strftime('%d/%m/%Y')}"
                     if _sheet_is_completati else
                     f"Simulazione Investimento — {_date.today().strftime('%d/%m/%Y')}"))
    tc.fill = TITLE_FILL; tc.font = TITLE_FONT; tc.alignment = ALIGN_C
    ws.row_dimensions[1].height = 30

    # ── Riga 2: legenda ───────────────────────────────────────────────────────
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=total_cols)
    lc = ws.cell(row=2, column=1,
                 value="🔔 Arancione = catalyst entro 30gg.  "
                       "Celle gialle = inserisci i tuoi dati.  "
                       "Celle azzurre = calcolate automaticamente da Excel.  "
                       "TBD (arancione chiaro) = dati non ancora disponibili (fetch fallito o dati insufficienti).  "
                       "— = non applicabile.")
    lc.fill = LEGEND_FILL; lc.font = LEGEND_FONT
    lc.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
    ws.row_dimensions[2].height = 22

    # ── Riga 3: intestazioni ──────────────────────────────────────────────────
    from openpyxl.styles import Border, Side
    _PNL_BORDER = Border(
        left=Side(style="thin"),  right=Side(style="thin"),
        top=Side(style="thin"),   bottom=Side(style="thin"),
    )

    # Sezione 1a: COLS A-C (Ticker, Società, Completion Date) — col 1-3
    for ci, (hdr, w) in enumerate(zip(COLS[:3], WIDTHS[:3]), start=1):
        c = ws.cell(row=3, column=ci, value=hdr)
        c.fill = HEADER_FILL; c.font = HEADER_FONT
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        ws.column_dimensions[get_column_letter(ci)].width = w

    # Sezione 1b: Phase in col D (4)
    _phc = ws.cell(row=3, column=4, value="Studio\nPhase")
    _phc.fill      = _PRED_HDR_FILL
    _phc.font      = Font(bold=True, color="FFFFFF", size=10)
    _phc.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    _phc.border    = _PNL_BORDER
    ws.column_dimensions["D"].width = 12

    # Sezione 1c: COLS D-J originali (MarketCap → Var.6M) ora in col 5-11
    for ci, (hdr, w) in enumerate(zip(COLS[3:10], WIDTHS[3:10]), start=5):
        c = ws.cell(row=3, column=ci, value=hdr)
        c.fill = HEADER_FILL; c.font = HEADER_FONT
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        ws.column_dimensions[get_column_letter(ci)].width = w

    # Sezione 2: Predizione — col 12-15 (= 4× %, _pred_start_col … +_N_PRED−1)
    for qi, (phdr, _) in enumerate(_PRED_HEADERS, start=_pred_start_col):
        qc = ws.cell(row=3, column=qi, value=phdr)
        qc.fill      = _PRED_HDR_FILL
        qc.font      = Font(bold=True, color="FFFFFF", size=10)
        qc.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        qc.border    = _PNL_BORDER
        ws.column_dimensions[get_column_letter(qi)].width = 16

    # Sezione 3: investimento → col _INV_START (16 con _N_PRED=4) in poi
    for ci_orig, (hdr, w) in enumerate(
        zip(COLS[10:], WIDTHS[10:]),
        start=_INV_START,
    ):
        c = ws.cell(row=3, column=ci_orig, value=hdr)
        c.fill = HEADER_FILL; c.font = HEADER_FONT
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        ws.column_dimensions[get_column_letter(ci_orig)].width = w

    # Override esplicito Beta (col 7) e Var.Giorn. % (col 8)
    for col_idx, label in [(7, "Beta"), (8, "Var.\nGiorn. %")]:
        c = ws.cell(row=3, column=col_idx, value=label)
        c.fill = HEADER_FILL; c.font = HEADER_FONT
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

    # P&L storici: dopo investimento — omessi su «Catalyst Completati»
    _pnl_hdr_start = _INV_START + ncols - (_PRED_INS - 1)
    if _show_hist_pnl:
        for pi, phdr in enumerate(_PNL_HEADERS, start=_pnl_hdr_start):
            pc = ws.cell(row=3, column=pi, value=phdr)
            pc.fill   = SUMMARY_FILL
            pc.font   = Font(bold=True, color="1F3864", size=10)
            pc.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            pc.border = _PNL_BORDER
            ws.column_dimensions[get_column_letter(pi)].width = 14
        _model_dir_start = _pnl_hdr_start + len(_PNL_HEADERS)
    else:
        _model_dir_start = _pnl_hdr_start
    for _mi, (_mhdr, _) in enumerate(_MODEL_DIR_HEADERS, start=_model_dir_start):
        _mc = ws.cell(row=3, column=_mi, value=_mhdr)
        _mc.fill      = _MODEL_HDR_FILL
        _mc.font      = Font(bold=True, color="FFFFFF", size=9)
        _mc.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        _mc.border    = _PNL_BORDER
        ws.column_dimensions[get_column_letter(_mi)].width = 11

    ws.row_dimensions[3].height = 36
    ws.freeze_panes = "A4"

    # ── Stili righe di dettaglio clinico ─────────────────────────────────────
    FIELD_LABELS = ["NCT ID", "Completion Date", "Indicazione",
                    "Titolo completo", "Modality", "Interventions", "Sponsor Match", "Link CT.gov"]
    DH_FILL = PatternFill("solid", fgColor="D6E4F0")
    DH_FONT = Font(bold=True, color="1F3864", size=8, italic=True)
    DD_FILL = PatternFill("solid", fgColor="EEF2F7")
    DD_FONT = Font(color="333333", size=8)
    DL_FONT = Font(color="0563C1", size=8, underline="single")
    DA_C    = Alignment(horizontal="center", vertical="center", wrap_text=False)
    DA_L    = Alignment(horizontal="left",   vertical="center", wrap_text=True)
    SPON_COLORS = {"Exact": "C6EFCE", "Partial": "FFEB9C", "No match": "FFC7CE"}
    MOD_COLORS = _MODALITY_COLORS
    NUM_COLS   = ncols
    _tail_fill_end = total_cols

    # Pulsante + (expand) sopra le righe collassate
    ws.sheet_properties.outlinePr = Outline(summaryBelow=False, summaryRight=False)

    data_row = 4
    main_row_positions = []

    for r in rows:
        rn          = data_row
        main_row_positions.append(rn)

        curr        = r.get("curr_price")
        chg         = r.get("daily_chg")
        buy         = r.get("buy_price")
        cap         = r.get("capital")
        cat_date    = r.get("completion_date")
        is_catalyst = bool(cat_date)

        def _c(col, val, fmt=None, fill=None, font=None, align=ALIGN_R, _rn=rn):
            cell = ws.cell(row=_rn, column=col, value=val)
            if fill: cell.fill = fill
            if fmt:  cell.number_format = fmt
            if font: cell.font = font
            cell.alignment = align
            return cell

        # A: Ticker
        tk_fill = CATALYST_FILL if is_catalyst else PatternFill("solid", fgColor="EBF3FB")
        tk_font = (Font(bold=True, color="BF5000", size=11) if is_catalyst
                   else Font(bold=True, color="1F3864", size=11))
        _c(1, r["ticker"], fill=tk_fill, font=tk_font, align=ALIGN_C)

        # B: Nome società
        _c(2, r["name"], font=Font(size=10), align=ALIGN_L)

        # C: Completion Date
        if is_catalyst:
            _c(3, cat_date, fill=CATALYST_FILL, font=CATALYST_FONT, align=ALIGN_C)
        else:
            cell = ws.cell(row=rn, column=3, value="—")
            cell.fill = PatternFill("solid", fgColor="F5F5F5")
            cell.font = Font(color="AAAAAA", size=9)
            cell.alignment = ALIGN_C

        # D: Studio Phase (inserita dopo Completion Date)
        _ph_cell = ws.cell(row=rn, column=4)
        _ph_cell.border    = _PNL_BORDER
        _ph_cell.alignment = ALIGN_C
        _phase_val = str(r.get("phase", "") or "").strip()
        _ph_num_map = {
            "1": 1, "i": 1, "phase 1": 1, "phase1": 1,
            "1/2": 2, "1, 2": 2,
            "2": 2, "ii": 2, "phase 2": 2, "phase2": 2,
            "2/3": 3, "2, 3": 3,
            "3": 3, "iii": 3, "phase 3": 3, "phase3": 3,
            "4": 4, "iv": 4, "phase 4": 4, "phase4": 4,
        }
        _ph_colors = {
            1: ("DEEBF7", "1F4E79"),
            2: ("EBF3DE", "375623"),
            3: ("FFF2CC", "7D5A00"),
            4: ("F2DCDB", "9C0006"),
        }
        _ph_key = _phase_val.lower().replace("phase ", "").replace("phase", "").strip()
        _ph_n   = _ph_num_map.get(_ph_key, _ph_num_map.get(_phase_val.lower()))
        if _phase_val:
            _ph_bg, _ph_fc = _ph_colors.get(_ph_n, ("F2F2F2", "595959"))
            _ph_cell.value = _phase_val
            _ph_cell.fill  = PatternFill("solid", fgColor=_ph_bg)
            _ph_cell.font  = Font(bold=(_ph_n in (3, 4)), color=_ph_fc, size=10)
        else:
            _ph_cell.value = "—"
            _ph_cell.fill  = PatternFill("solid", fgColor="F5F5F5")
            _ph_cell.font  = Font(color="AAAAAA", size=9)

        # E: Market Cap (era D=4, ora E=5)
        mcap = r.get("market_cap")
        if mcap is not None:
            _c(5, mcap, FMT_MCAP, fill=FORMULA_FILL, font=FORMULA_FONT, align=ALIGN_R)
        else:
            ws.cell(row=rn, column=5, value="N/D").alignment = ALIGN_C

        # F: Prezzo corrente (era E=5, ora F=6)
        if curr is not None:
            _c(6, curr, "#,##0.00 €", fill=FORMULA_FILL, font=FORMULA_FONT)
        else:
            _ec = ws.cell(row=rn, column=6, value="TBD")
            _ec.fill      = PatternFill("solid", fgColor="FFF3E0")
            _ec.font      = Font(color="E65100", size=9, italic=True)
            _ec.alignment = ALIGN_C

        # G: Beta (era F=6, ora G=7)
        beta_val = r.get("beta")
        if beta_val is not None:
            bf = _beta_fill(beta_val)
            _c(7, beta_val, "#,##0.00",
               fill=bf or FORMULA_FILL,
               font=Font(bold=True, size=10), align=ALIGN_C)
        else:
            ws.cell(row=rn, column=7, value="N/D").alignment = ALIGN_C

        # H: Variazione giornaliera % (era G=7, ora H=8)
        if chg is not None:
            _c(8, chg, FMT_VARIATION, fill=FORMULA_FILL, font=FORMULA_FONT, align=ALIGN_C)
        else:
            ws.cell(row=rn, column=8, value="N/D").alignment = ALIGN_C

        # I/J/K: Var 1M/3M/6M % (era H/I/J=8/9/10, ora I/J/K=9/10/11)
        for col_idx, key in [(9, "var_1m"), (10, "var_3m"), (11, "var_6m")]:
            val = r.get(key)
            cell = ws.cell(row=rn, column=col_idx)
            cell.alignment = ALIGN_C
            if val is not None:
                cell.value = val
                cell.number_format = FMT_VARIATION
            else:
                cell.value = "N/D"
                cell.font = Font(color="999999", size=9)

        # ── Pred: 4 orizzonti % ─────────────────────────────────────────────────
        ticker = str(r.get("ticker", "")).strip().upper()
        # Per i catalyst passati la chiave è composita "TICK|YYYY-MM-DD" perché
        # la stessa società può avere più studi con date diverse.
        if pred_data and r.get("past_catalyst"):
            _cd_raw  = r.get("completion_date")
            _cd_s    = str(_cd_raw) if _cd_raw is not None else ""
            _pred    = pred_data.get(f"{ticker}|{_cd_s}") or pred_data.get(ticker)
        else:
            _pred = pred_data.get(ticker) if pred_data else None

        _no_pred_fill = PatternFill("solid", fgColor="F5F5F5")
        _no_pred_font = Font(color="AAAAAA", size=9)

        # Costruisci il tooltip comune (messo sulla prima cella pred)
        _tooltip_txt = None
        if _pred and not r.get("past_catalyst"):
            from openpyxl.comments import Comment as _Comment
            _rsi_s  = f"{_pred.get('rsi'):.0f}" if _pred.get("rsi") is not None else "N/D"
            _vr_s   = f"{_pred.get('vol_ratio'):.2f}×" if _pred.get("vol_ratio") is not None else "N/D"
            _exc_s  = f"{_pred.get('exc_slope'):+.3f}%/gg" if _pred.get("exc_slope") is not None else "N/D"
            _adj_s  = _pred.get("adj_notes") or "—"
            _r2_s   = f"{_pred.get('r2'):.3f}" if _pred.get("r2") is not None else "N/D"
            _days_s = str(_pred.get("days_to_t", "N/D"))
            _tooltip_txt = (
                f"Modello: RSI-14 + slope ± XBI + vol\n"
                f"RSI-14: {_rsi_s}\n"
                f"Vol build-up: {_vr_s}\n"
                f"Slope excess XBI: {_exc_s}\n"
                f"Correzione RSI: {_adj_s}\n"
                f"Direzione grezza: {_pred.get('direction_raw', '—')}\n"
                f"Direzione aggiustata: {_pred.get('direction', '—')}\n"
                f"R² curve fitting: {_r2_s}  [{_pred.get('model','N/D')}]\n"
                f"Giorni a T: {_days_s}\n"
                f"Affidabilità: {_pred.get('affidabilita','—')}%\n"
                f"(solo sponsor Exact)"
            )

        # ── Helper per celle percentuali predizione ───────────────────────────
        def _write_pred_pct(col_offset, key):
            _c2 = ws.cell(row=rn, column=_pred_start_col + col_offset)
            _c2.border    = _PNL_BORDER
            _c2.alignment = ALIGN_C
            _is_past_row = r.get("past_catalyst")
            if _is_past_row:
                # Per catalyst già completati: mostra il risultato effettivo
                # (d3_pct/d5_pct/d10_pct/d30_pct mappati da d*_actual nel backtest).
                _actual_val = _pred.get(key) if _pred else None
                if _actual_val is None:
                    _c2.value = "—"; _c2.fill = _no_pred_fill; _c2.font = _no_pred_font
                    return
                # Stesso rendering delle celle future ma con bordo tratteggiato
                # per distinguere "effettivo" da "predetto"
                _pos = _actual_val > 0.5
                _neg = _actual_val < -0.5
                _c2.value         = _actual_val / 100.0
                _c2.number_format = '+0.0%;-0.0%;"—"'
                _c2.fill  = (PatternFill("solid", fgColor="C6EFCE") if _pos else
                              PatternFill("solid", fgColor="FFC7CE") if _neg else
                              PatternFill("solid", fgColor="F2F2F2"))
                _c2.font  = Font(
                    bold=abs(_actual_val) >= 5, italic=True,
                    color=("375623" if _pos else "9C0006" if _neg else "595959"),
                    size=10,
                )
                return
            if _pred is None:
                _c2.value = "TBD"
                _c2.fill  = PatternFill("solid", fgColor="FFF3E0")
                _c2.font  = Font(color="E65100", size=9, italic=True)
                return
            _val = _pred.get(key)
            if _val is None:
                _c2.value = "TBD"
                _c2.fill  = PatternFill("solid", fgColor="FFF3E0")
                _c2.font  = Font(color="E65100", size=9, italic=True)
                return
            # Colora: verde=positivo, rosso=negativo, grigio=neutro
            _pos = _val > 0.5
            _neg = _val < -0.5
            _c2.value         = _val / 100.0
            _c2.number_format = '+0.0%;-0.0%;"—"'
            _c2.fill  = (PatternFill("solid", fgColor="C6EFCE") if _pos else
                          PatternFill("solid", fgColor="FFC7CE") if _neg else
                          PatternFill("solid", fgColor="F2F2F2"))
            _c2.font  = Font(
                bold=abs(_val) >= 5,
                color=("375623" if _pos else "9C0006" if _neg else "595959"),
                size=10,
            )
            if col_offset == 0 and _tooltip_txt:
                _c2.comment = _Comment(_tooltip_txt, "AutoPred")

        _write_pred_pct(0, "d3_pct")
        _write_pred_pct(1, "d5_pct")
        _write_pred_pct(2, "d10_pct")
        _write_pred_pct(3, "d30_pct")

        # Prezzo acquisto (INPUT) — col _INV_START
        _c(_INV_START,     buy, "#,##0.00 €", fill=INPUT_FILL, font=INPUT_FONT)

        # Capitale investito (INPUT)
        _c(_INV_START + 1, cap, "#,##0.00 €", fill=INPUT_FILL, font=INPUT_FONT)

        # N° azioni
        _c(_INV_START + 2,
           f'=IF(AND(ISNUMBER({_c_buy}{rn}),{_c_buy}{rn}<>0),{_c_cap}{rn}/{_c_buy}{rn},"")',
           "#,##0.00", fill=FORMULA_FILL, font=FORMULA_FONT)

        # Valore attuale
        _c(_INV_START + 3,
           f'=IF(AND(ISNUMBER({_c_shares}{rn}),ISNUMBER({_C_CURR}{rn})),{_c_shares}{rn}*{_C_CURR}{rn},"")',
           "#,##0.00 €", fill=FORMULA_FILL, font=FORMULA_FONT)

        # P&L €
        _c(_INV_START + 4,
           f'=IF(ISNUMBER({_c_val}{rn}),{_c_val}{rn}-{_c_cap}{rn},"")',
           '#,##0.00 €;[Red]-#,##0.00 €', fill=FORMULA_FILL, font=FORMULA_FONT)

        # P&L %
        _c(_INV_START + 5,
           f'=IF(AND(ISNUMBER({_c_buy}{rn}),{_c_buy}{rn}<>0),({_C_CURR}{rn}-{_c_buy}{rn})/{_c_buy}{rn},"")',
           '0.00%;[Red]-0.00%', fill=FORMULA_FILL, font=FORMULA_FONT)

        ws.row_dimensions[rn].height = 20

        # ── P&L storici D0/+1w/+1m — solo Simulation ──
        if _show_hist_pnl:
            _pnl_no_data_fill = PatternFill("solid", fgColor="F5F5F5")
            _pnl_no_data_font = Font(color="AAAAAA", size=9)
            _pnl_tbd_fill     = PatternFill("solid", fgColor="FFF3E0")
            _pnl_tbd_font     = Font(color="E65100", size=9, italic=True)
            if pnl_data and ticker in pnl_data:
                _spnl = pnl_data[ticker]
                for _pi, _phdr in enumerate(_PNL_HEADERS, start=_pnl_hdr_start):
                    _key, _fmt = _PNL_KEY_MAP[_phdr]
                    _raw = _spnl.get(_key)
                    if _raw is None:
                        _tc = ws.cell(row=rn, column=_pi, value="TBD")
                        _tc.fill = _pnl_tbd_fill; _tc.font = _pnl_tbd_font
                        _tc.alignment = ALIGN_C
                        continue
                    _val = (_raw / 100.0) if "%" in _phdr else _raw
                    _pos = _raw >= 0
                    pc = ws.cell(row=rn, column=_pi, value=_val)
                    pc.number_format = _fmt
                    pc.fill   = PatternFill("solid", fgColor="FFC6EFCE" if _pos else "FFFFC7CE")
                    pc.font   = Font(bold=True, color="FF276221" if _pos else "FF9C0006", size=10)
                    pc.alignment = ALIGN_C
            else:
                for _pi in range(ncols + _N_PRED + 1, ncols + _N_PRED + len(_PNL_HEADERS) + 1):
                    _tc = ws.cell(row=rn, column=_pi, value="—")
                    _tc.fill = _pnl_no_data_fill; _tc.font = _pnl_no_data_font
                    _tc.alignment = ALIGN_C

        # ── Confronto 4 modelli (dir_v1 … dir_v4) ────────────────────────────
        _dir_fills = {
            "↑": ("C6EFCE", "276221"),  # verde
            "↓": ("FFC7CE", "9C0006"),  # rosso
            "→": ("FFEB9C", "8B6914"),  # giallo
        }
        _is_past = bool(r.get("past_catalyst"))
        for _mi2, (_, _mkey) in enumerate(_MODEL_DIR_HEADERS, start=_model_dir_start):
            _mdc = ws.cell(row=rn, column=_mi2)
            _mdc.border    = _PNL_BORDER
            _mdc.alignment = ALIGN_C
            # Per righe past: mostra la direzione se pred_data (retro backtest) la contiene.
            # Se pred_data assente o chiave mancante → "—" neutro.
            _dval = _pred.get(_mkey) if _pred else None
            if _is_past and not _dval:
                _mdc.value = "—"
                _mdc.fill  = _no_pred_fill
                _mdc.font  = _no_pred_font
            elif _dval is None:
                _mdc.value = "TBD"
                _mdc.fill  = PatternFill("solid", fgColor="FFF3E0")
                _mdc.font  = Font(color="E65100", size=9, italic=True)
            else:
                _sym = _dval[0] if _dval else "→"
                _bg, _fc = _dir_fills.get(_sym, ("F5F5F5", "444444"))
                _mdc.value = _dval
                _mdc.fill  = PatternFill("solid", fgColor=_bg)
                _mdc.font  = Font(bold=True, color=_fc, size=9)

        data_row += 1

        # ── Righe di dettaglio clinico (se catalyst con studi) ────────────────
        studies = ticker_studies.get(ticker, []) if is_catalyst else []
        if studies:
            # Riga header dettaglio
            hr = data_row
            ws.row_dimensions[hr].outline_level = 1
            ws.row_dimensions[hr].hidden        = True
            ws.row_dimensions[hr].height        = 16
            for c_idx, label in enumerate(FIELD_LABELS, start=1):
                cell = ws.cell(row=hr, column=c_idx, value=label)
                cell.fill = DH_FILL; cell.font = DH_FONT; cell.alignment = DA_C
            for c_idx in range(len(FIELD_LABELS) + 1, _tail_fill_end + 1):
                ws.cell(row=hr, column=c_idx).fill = DH_FILL
            data_row += 1

            # Righe dati studio
            for study in studies:
                dr = data_row
                ws.row_dimensions[dr].outline_level = 1
                ws.row_dimensions[dr].hidden        = True
                ws.row_dimensions[dr].height        = 30
                data_vals = [
                    study["NCT ID"],          # col 1
                    study["Completion Date"], # col 2
                    study["Indicazione"],     # col 3
                    study["Titolo completo"], # col 4
                    study["Modality"],        # col 5
                    study["Interventions"],   # col 6
                    study["Sponsor Match"],   # col 7
                    study["_link"],           # col 8
                ]
                for c_idx, val in enumerate(data_vals, start=1):
                    cell = ws.cell(row=dr, column=c_idx, value=val)
                    cell.alignment = DA_L
                    if c_idx == 5:   # Modality
                        mc = MOD_COLORS.get(str(val), MOD_COLORS.get("Other", "EEEEEE"))
                        cell.fill = PatternFill("solid", fgColor=mc)
                        cell.font = Font(bold=True, size=8, color="1A1A1A")
                        cell.alignment = DA_C
                    elif c_idx == 7:  # Sponsor Match
                        sm_color = SPON_COLORS.get(str(val))
                        cell.fill = PatternFill("solid", fgColor=sm_color) if sm_color else DD_FILL
                        cell.font = Font(bold=True, size=8, color="1A1A1A") if sm_color else DD_FONT
                        cell.alignment = DA_C
                    elif c_idx == 8:  # Link CT.gov
                        link = study["_link"]
                        nct_label = study.get("NCT ID", "").strip()
                        if link:
                            cell.value     = f"{nct_label} ↗" if nct_label and nct_label != "N/D" else "CT.gov ↗"
                            cell.hyperlink = link
                            cell.font      = DL_FONT
                        else:
                            cell.font = DD_FONT; cell.fill = DD_FILL
                    elif c_idx == 2:  # Completion Date arancione
                        cell.fill = PatternFill("solid", fgColor="FFE0B2")
                        cell.font = Font(bold=True, color="BF5000", size=8)
                        cell.alignment = DA_C
                    else:
                        cell.fill = DD_FILL; cell.font = DD_FONT
                for c_idx in range(len(FIELD_LABELS) + 1, _tail_fill_end + 1):
                    ws.cell(row=dr, column=c_idx).fill = DD_FILL
                data_row += 1

    # ── Riga totale portafoglio ───────────────────────────────────────────────
    if main_row_positions:
        first = main_row_positions[0]
        last  = main_row_positions[-1]
        tr    = data_row
        ws.row_dimensions[tr].height = 24
        # Merge etichetta fino all'ultima col PRED (copre Phase + pred, prima di Buy)
        ws.merge_cells(start_row=tr, start_column=1,
                       end_row=tr, end_column=_pred_start_col + _N_PRED - 1)
        tot = ws.cell(row=tr, column=1, value="TOTALE PORTAFOGLIO")
        tot.fill = SUMMARY_FILL; tot.font = SUMMARY_FONT; tot.alignment = ALIGN_L

        # Colonne SUMIF con indici e lettere shiftati di +3
        _col_pnl_e = get_column_letter(15 + _SH)   # col 18 = "R"
        for ci, col_l, fmt in [
            (12 + _SH, _c_cap,    "#,##0.00 €"),                       # Capitale  O
            (14 + _SH, _c_val,    "#,##0.00 €"),                       # Valore    Q
            (15 + _SH, _col_pnl_e, '#,##0.00 €;[Red]-#,##0.00 €'),    # P&L€      R
        ]:
            c = ws.cell(row=tr, column=ci,
                        value=f'=SUMIF({col_l}{first}:{col_l}{last},">0")')
            c.number_format = fmt
            c.fill = SUMMARY_FILL; c.font = SUMMARY_FONT; c.alignment = ALIGN_R

        # P&L% totale = R/O (P&L€/Capitale)
        c = ws.cell(row=tr, column=16 + _SH,
                    value=f'=IF({_c_cap}{tr}<>0,{_col_pnl_e}{tr}/{_c_cap}{tr},"")')
        c.number_format = '0.00%;[Red]-0.00%'
        c.fill = SUMMARY_FILL; c.font = SUMMARY_FONT; c.alignment = ALIGN_R

    return main_row_positions


def _build_ticker_studies(clinical_df_rich, include_past: bool = False):
    """
    Costruisce il lookup ticker → lista studi clinici.

    include_past=False (default): studi con completion date tra oggi e +60gg.
    include_past=True:            studi con completion date < oggi (già completati).

    Restituisce dict[str, list[dict]] — chiave = ticker UPPER, valore = lista studi.
    """
    from datetime import date, timedelta

    if clinical_df_rich is None or clinical_df_rich.empty:
        return {}

    def _find(candidates, df):
        return next((c for c in candidates if c in df.columns), None)

    date_col  = _find(["primary_completion_date", "completion_date",
                        "PrimaryCompletionDate", "CompletionDate",
                        "estimated_completion_date", "end_date"], clinical_df_rich)
    nct_col   = _find(["nct_id", "NCTId", "nct_number", "study_id"], clinical_df_rich)
    title_col = _find(["official_title", "OfficialTitle",
                        "brief_title", "BriefTitle", "study_title"], clinical_df_rich)
    cond_col  = _find(["conditions", "Conditions", "condition",
                        "indications_and_usage", "indication"], clinical_df_rich)
    drug_col  = _find(["interventions", "intervention_name",
                        "brand_name", "generic_name"], clinical_df_rich)
    mod_col   = "Modality"      if "Modality"      in clinical_df_rich.columns else None
    spon_col  = "sponsor_match" if "sponsor_match" in clinical_df_rich.columns else None
    tk_col    = _find(["ticker", "symbol"], clinical_df_rich)

    if date_col is None or tk_col is None:
        return {}

    today   = date.today()
    horizon = today + timedelta(days=60)
    df = clinical_df_rich.copy()
    df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
    if include_past:
        mask = df[date_col].dt.date < today
    else:
        mask = (df[date_col].dt.date >= today) & (df[date_col].dt.date <= horizon)
    df = df[mask].copy()
    if df.empty:
        return {}

    df["_sym"] = df[tk_col].astype(str).str.strip().str.upper()

    def _ct_link(row):
        nct = str(row.get(nct_col, "") or "").strip() if nct_col else ""
        return f"https://clinicaltrials.gov/study/{nct}" if nct else ""

    ticker_studies: dict[str, list[dict]] = {}
    for _, row in df.iterrows():
        sym = row["_sym"]
        raw_date = row.get(date_col)
        if pd.notna(raw_date):
            try:
                fmt_date = pd.Timestamp(raw_date).strftime("%d/%m/%Y")
            except Exception:
                fmt_date = str(raw_date)
        else:
            fmt_date = "N/D"
        entry = {
            "NCT ID":           str(row.get(nct_col,   "") or "N/D").strip() if nct_col   else "N/D",
            "Completion Date":  fmt_date,
            "Indicazione":      str(row.get(cond_col,  "") or "N/D").strip() if cond_col  else "N/D",
            "Titolo completo":  str(row.get(title_col, "") or "N/D").strip() if title_col else "N/D",
            "Modality":         str(row.get(mod_col,   "") or "N/D").strip() if mod_col   else "N/D",
            "Interventions":    str(row.get(drug_col,  "") or "N/D").strip() if drug_col  else "N/D",
            "Sponsor Match":    str(row.get(spon_col,  "") or "N/D").strip() if spon_col  else "N/D",
            "_link":            _ct_link(row),
        }
        ticker_studies.setdefault(sym, []).append(entry)

    return ticker_studies


def _add_sim_clinical_dropdowns(ws_sim, sim_rows, ticker_studies, main_row_positions):
    """
    Scrive le righe di dettaglio clinico collassabili (outline_level=1, hidden=True)
    DIRETTAMENTE alle posizioni già riservate da write_simulation_sheet
    (tramite extra_rows_after) — SENZA usare insert_rows.

    Struttura per ogni catalyst ticker che ha studi nei prossimi 30 gg:
      • 1 riga header  (main_row + 1): etichette dei campi
      • N righe dati   (main_row + 2 … +1+N): una per studio

    Prerequisito: write_simulation_sheet deve essere stato chiamato con
        extra_rows_after[i] = 1 + len(studi_per_quel_ticker)
    per ogni riga catalyst con studi, altrimenti si sovrascrivono righe principali.
    """
    from openpyxl.styles import PatternFill, Font, Alignment
    from openpyxl.worksheet.properties import Outline

    if not ticker_studies:
        return

    FIELD_LABELS = ["NCT ID", "Completion Date", "Indicazione",
                    "Titolo completo", "Modality", "Interventions", "Link CT.gov"]
    HDR_FILL = PatternFill("solid", fgColor="D6E4F0")
    HDR_FONT = Font(bold=True, color="1F3864", size=8, italic=True)
    DAT_FILL = PatternFill("solid", fgColor="EEF2F7")
    DAT_FONT = Font(color="333333", size=8)
    LNK_FONT = Font(color="0563C1", size=8, underline="single")
    ALGN_C   = Alignment(horizontal="center", vertical="center", wrap_text=False)
    ALGN_L   = Alignment(horizontal="left",   vertical="center", wrap_text=True)
    MOD_COLORS = _MODALITY_COLORS
    NUM_COLS   = 16  # A-P

    # Pulsante + (expand) sopra le righe collassate (non sotto)
    ws_sim.sheet_properties.outlinePr = Outline(summaryBelow=False, summaryRight=False)

    for i, r in enumerate(sim_rows):
        if not r.get("completion_date"):
            continue
        ticker  = str(r.get("ticker", "")).strip().upper()
        studies = ticker_studies.get(ticker, [])
        if not studies:
            continue

        main_row = main_row_positions[i]

        # ── Riga header ───────────────────────────────────────────────────────
        hr = main_row + 1
        ws_sim.row_dimensions[hr].outline_level = 1
        ws_sim.row_dimensions[hr].hidden        = True
        ws_sim.row_dimensions[hr].height        = 16
        for c_idx, label in enumerate(FIELD_LABELS, start=1):
            cell = ws_sim.cell(row=hr, column=c_idx, value=label)
            cell.fill      = HDR_FILL
            cell.font      = HDR_FONT
            cell.alignment = ALGN_C
        for c_idx in range(len(FIELD_LABELS) + 1, NUM_COLS + 1):
            ws_sim.cell(row=hr, column=c_idx).fill = HDR_FILL

        # ── Righe dati studio ─────────────────────────────────────────────────
        for s_idx, study in enumerate(studies):
            dr = main_row + 2 + s_idx
            ws_sim.row_dimensions[dr].outline_level = 1
            ws_sim.row_dimensions[dr].hidden        = True
            ws_sim.row_dimensions[dr].height        = 30

            data_values = [
                study["NCT ID"],           # col 1
                study["Completion Date"],  # col 2
                study["Indicazione"],      # col 3
                study["Titolo completo"],  # col 4
                study["Modality"],         # col 5
                study["Interventions"],     # col 6
                study["_link"],            # col 7 = Link
            ]
            for c_idx, val in enumerate(data_values, start=1):
                cell = ws_sim.cell(row=dr, column=c_idx, value=val)
                cell.alignment = ALGN_L

                if c_idx == 5:  # Modality
                    mod_color = MOD_COLORS.get(str(val), MOD_COLORS.get("Other", "EEEEEE"))
                    cell.fill = PatternFill("solid", fgColor=mod_color)
                    cell.font = Font(bold=True, size=8, color="1A1A1A")
                    cell.alignment = ALGN_C
                elif c_idx == 7:  # Link CT.gov
                    link = study["_link"]
                    nct_label = study.get("NCT ID", "").strip()
                    if link:
                        cell.value     = f"{nct_label} ↗" if nct_label and nct_label != "N/D" else "CT.gov ↗"
                        cell.hyperlink = link
                        cell.font      = LNK_FONT
                    else:
                        cell.font = DAT_FONT
                        cell.fill = DAT_FILL
                elif c_idx == 2:  # Completion Date — arancione catalyst
                    cell.fill = PatternFill("solid", fgColor="FFE0B2")
                    cell.font = Font(bold=True, color="BF5000", size=8)
                    cell.alignment = ALGN_C
                else:
                    cell.fill = DAT_FILL
                    cell.font = DAT_FONT

            for c_idx in range(len(FIELD_LABELS) + 1, NUM_COLS + 1):
                ws_sim.cell(row=dr, column=c_idx).fill = DAT_FILL


def _swap_ws_columns(ws, col_a, col_b, from_row, to_row):
    """Scambia tutte le celle (valore, formato, fill, font, alignment) tra col_a e col_b."""
    for rn in range(from_row, to_row + 1):
        ca = ws.cell(row=rn, column=col_a)
        cb = ws.cell(row=rn, column=col_b)
        ca.value,        cb.value        = cb.value,        ca.value
        ca.number_format, cb.number_format = cb.number_format, ca.number_format
        ca.fill,         cb.fill         = copy(cb.fill),   copy(ca.fill)
        ca.font,         cb.font         = copy(cb.font),   copy(ca.font)
        ca.alignment,    cb.alignment    = copy(cb.alignment), copy(ca.alignment)


def _apply_sim_coloring(ws_sim, rows, data_start_row=4, main_row_positions=None):
    """
    Applica alla sheet Simulation gli stessi colori di Catalyst/Financial,
    usando le identiche funzioni (apply_linear_coloring, _beta_fill, DataBarRule).

    Mapping colonne Simulation target (layout attuale dopo shift):
      D (4)  = marketCap         → DataBarRule verde
      E (5)  = currentPrice      → DataBarRule verde
      G (7)  = Beta              → _beta_fill (soglie fisse)
      H (8)  = Var. Giorn. %     → apply_linear_coloring (gradiente, curva normale interna)
      I (9)  = variation_1m_%    → apply_linear_coloring (gradiente)
      J (10) = variation_3m_%    → apply_linear_coloring
      K (11) = variation_6m_%    → apply_linear_coloring

    main_row_positions: lista di numeri di riga Excel (1-indexed) restituita da
        write_simulation_sheet quando si usano extra_rows_after. Se None, le
        righe sono considerate consecutive a partire da data_start_row (comportamento
        legacy per compatibilità).
    """
    if not rows:
        return

    # Normalizza le posizioni: se non fornite, usa offset consecutivi (legacy)
    if main_row_positions is None:
        main_row_positions = list(range(data_start_row, data_start_row + len(rows)))

    first_row = main_row_positions[0]
    last_row  = main_row_positions[-1]

    # ── Data bar marketCap (D) e currentPrice (E) — barra verde ────────────────
    for col_letter in ("D", "E"):
        ws_sim.conditional_formatting.add(
            f"{col_letter}{first_row}:{col_letter}{last_row}",
            DataBarRule(
                start_type="min", start_value=0,
                end_type="max",   end_value=100,
                color=_DATABAR_GREEN_CAP_PRICE, showValue=True,
            ),
        )

    # ── Gradiente media±2σ — Var.Giorn. % e variazioni mensili (H, I, J, K) ──
    # Layout attuale dopo lo shift di colonne:
    #   G (7)  = Beta              → _beta_fill (sotto)
    #   H (8)  = Var. Giorn. %    → apply_linear_coloring
    #   I (9)  = Var 1M %         → apply_linear_coloring
    #   J (10) = Var 3M %         → apply_linear_coloring
    #   K (11) = Var 6M %         → apply_linear_coloring
    for col_idx, key in [
        (8,  "daily_chg"),  # H: Var. Giorn. %
        (9,  "var_1m"),     # I: variation_1m_%
        (10, "var_3m"),     # J: variation_3m_%
        (11, "var_6m"),     # K: variation_6m_%
    ]:
        raw_values = [r.get(key) for r in rows]
        apply_linear_coloring_at_positions(ws_sim, col_idx, main_row_positions, raw_values)

    # ── Beta (G=7) — soglie fisse: <1 verde, 1-1.5 giallo, 1.5-2 arancione, >2 rosso
    for rn, r in zip(main_row_positions, rows):
        fill = _beta_fill(r.get("beta"))
        if fill:
            ws_sim.cell(row=rn, column=7).fill = fill


def _write_retro_sheet(wb, retro_results: list) -> None:
    """Sheet Retrospettiva: delega a data_orchestrator._write_retro_sheet (solo v4)."""
    from data_orchestrator import _write_retro_sheet as _orch_retro
    _orch_retro(wb, retro_results)


def _write_model_sheet(wb, calib_path=None, retro_results=None) -> None:
    """
    Sheet '📊 Modello' — performance storica del modello di predizione.
    Sezioni: A) Riepilogo versioni  B) Accuratezza orizzonti
             C) Distribuzione direzioni  D) Storico ultime previsioni
    """
    from openpyxl.styles import (
        Font, PatternFill, Alignment, Border, Side,
    )
    from openpyxl.utils import get_column_letter

    SHEET_NAME = "📊 Modello"
    if SHEET_NAME in wb.sheetnames:
        del wb[SHEET_NAME]
    ws = wb.create_sheet(SHEET_NAME)
    ws.sheet_properties.tabColor = "1F5C2E"

    # ── Palette colori ────────────────────────────────────────────────────────
    C_HEADER  = PatternFill("solid", fgColor="1F3864")
    C_SEC     = PatternFill("solid", fgColor="2E4D7B")
    C_ALT     = PatternFill("solid", fgColor="EEF2F7")
    C_GREEN   = PatternFill("solid", fgColor="C6EFCE")
    C_RED     = PatternFill("solid", fgColor="FFC7CE")
    C_YELLOW  = PatternFill("solid", fgColor="FFEB9C")
    C_GREY    = PatternFill("solid", fgColor="D9D9D9")

    FW = Font(bold=True, color="FFFFFF", size=11)
    FB = Font(bold=True, color="1F3864", size=10)
    FN = Font(color="1F3864", size=10)
    AL_C = Alignment(horizontal="center", vertical="center", wrap_text=True)
    AL_L = Alignment(horizontal="left",   vertical="center", wrap_text=True)
    THIN = Side(style="thin", color="B0B8C1")
    BD   = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

    def _hcell(ws, row, col, val, fill=None, font=None, align=None):
        c = ws.cell(row=row, column=col, value=val)
        if fill:  c.fill  = fill
        if font:  c.font  = font or FN
        if align: c.alignment = align or AL_C
        c.border = BD
        return c

    TBD_FILL = PatternFill("solid", fgColor="FFF3E0")
    TBD_FONT = Font(color="E65100", size=9, italic=True)
    NA_FILL  = PatternFill("solid", fgColor="F5F5F5")
    NA_FONT  = Font(color="AAAAAA", size=9)

    def _pct(v):
        return f"{v:.1f}%" if v is not None else "—"

    def _safe(v, fmt=".2f"):
        try:    return round(float(v), 2)
        except: return None

    def _hcell_tbd(ws, row, col, val, fill=None, font=None, align=None):
        """Come _hcell ma scrive TBD (arancione) per None e stringa vuota."""
        if val is None or val == "":
            c = ws.cell(row=row, column=col, value="TBD")
            c.fill   = TBD_FILL
            c.font   = TBD_FONT
            c.alignment = align or AL_C
            c.border = BD
            return c
        return _hcell(ws, row, col, val, fill, font, align)

    # ── Carica dati calibrazione ──────────────────────────────────────────────
    records = _calib_load(calib_path)

    # Normalizza model_version (record vecchi → "v1_momentum")
    for r in records:
        if not r.get("model_version"):
            r["model_version"] = "v1_momentum"

    complete = [r for r in records if r.get("status") == "complete"]

    # Lista versioni: SEMPRE tutte quelle del registro, più eventuali extra dal JSON
    _reg_versions = [e["version"] for e in _MODEL_REGISTRY]
    _data_versions = sorted(set(r["model_version"] for r in records))
    versions_ordered = _reg_versions + [v for v in _data_versions if v not in _reg_versions]

    # Direzione corretta: stesso ordine orchestrator — d3_actual poi d5_actual
    def _correct(r):
        d = r.get("direction", "")
        actual = (r.get("d3_actual") if r.get("d3_actual") is not None
                  else r.get("d5_actual"))
        if actual is None: return None
        if d.startswith("↑"):  return actual > 0
        if d.startswith("↓"):  return actual < 0
        if d == "→ Stabile":   return abs(actual) < 5.0
        return None

    # ── TITOLO ────────────────────────────────────────────────────────────────
    ws.merge_cells("A1:N1")
    n_rec = len(records)
    n_com = len(complete)
    t = ws.cell(row=1, column=1,
                value=f"📊 Performance Modello Predittivo  ·  Versione attiva: {_MODEL_VERSION}  ·  "
                      f"Tot. {n_rec} record  |  Complete: {n_com}  |  Pending: {n_rec - n_com}")
    t.fill = C_HEADER; t.font = Font(bold=True, color="FFFFFF", size=13)
    t.alignment = AL_C

    row = 3

    # ══════════════════════════════════════════════════════════════════════════
    # SEZIONE 0 — Registro versioni (changelog)
    # ══════════════════════════════════════════════════════════════════════════
    ws.merge_cells(f"A{row}:N{row}")
    _hcell(ws, row, 1, "0 — Registro Versioni Modello", C_SEC, FW, AL_L)
    row += 1

    reg_headers = ["Versione", "Data rilascio", "Etichetta", "Principali modifiche"]
    reg_widths  = [16, 14, 22, 80]
    for ci, (h, w) in enumerate(zip(reg_headers, reg_widths), 1):
        _hcell(ws, row, ci, h, C_HEADER, FW, AL_C)
        ws.column_dimensions[get_column_letter(ci)].width = w
    row += 1

    for ri, entry in enumerate(_MODEL_REGISTRY):
        is_current = entry["version"] == _MODEL_VERSION
        fill = PatternFill("solid", fgColor="D6E8D4") if is_current else (C_ALT if ri % 2 == 0 else None)
        font_v = Font(bold=True, color="1A5C1A" if is_current else "1F3864", size=10)
        for ci, val in enumerate([
            entry["version"],
            entry.get("date", ""),
            entry.get("label", ""),
            entry.get("changes", ""),
        ], 1):
            c = _hcell(ws, row, ci, val, fill, font_v if ci == 1 else FN, AL_L if ci >= 3 else AL_C)
            if is_current and ci == 1:
                c.value = f"▶ {val}"   # indicatore versione attiva
        row += 1

    row += 1

    # Prepara lookup retro per versione
    _retro_all = retro_results or []
    _retro_by_ver: dict = {}
    for _rr in _retro_all:
        _v = _rr.get("model_version", _MODEL_VERSION)
        _retro_by_ver.setdefault(_v, []).append(_rr)

    # ══════════════════════════════════════════════════════════════════════════
    # SEZIONE A — Riepilogo statistico per versione (due fonti separate)
    # ══════════════════════════════════════════════════════════════════════════
    ws.merge_cells(f"A{row}:N{row}")
    _hcell(ws, row, 1,
           "A — Statistiche per Versione  ·  "
           "% Retro = backtesting studi passati Exact  |  "
           "% Sim = calibrazione previsioni Simulation",
           C_SEC, FW, AL_L)
    row += 1

    sec_a_headers = [
        "Versione",
        "N Sim", "Pending", "Compl. Sim",
        "% Successo Retro", "N Retro",
        "% Successo Sim",   "✓ Sim", "✗ Sim",
        "→ Stabile%", "Aff.Media",
        "Bias d5", "Bias d10",
        "Confronto",
    ]
    for ci, h in enumerate(sec_a_headers, 1):
        _hcell(ws, row, ci, h, C_HEADER, FW, AL_C)
    row += 1

    # Calcola best_acc per confronto relativo (usa % Sim se disponibile, altrimenti Retro)
    _all_accs: dict = {}
    for ver in versions_ordered:
        recs_v = [r for r in records if r["model_version"] == ver
                  and r.get("source", "sim") != "retro"]
        comp_v = [r for r in recs_v if r.get("status") == "complete"]
        ev     = [_correct(r) for r in comp_v if _correct(r) is not None]
        if ev:
            _all_accs[ver] = sum(ev) / len(ev) * 100
        elif ver in _retro_by_ver:
            ev_r = [r.get("correct") for r in _retro_by_ver[ver] if r.get("correct") is not None]
            if ev_r: _all_accs[ver] = sum(ev_r) / len(ev_r) * 100
    best_acc = max(_all_accs.values()) if _all_accs else None

    for vi, ver in enumerate(versions_ordered):
        # ── Dati Simulation (JSON calibrazione, source != "retro") ────────────
        sim_recs = [r for r in records if r["model_version"] == ver
                    and r.get("source", "sim") != "retro"]
        sim_comp = [r for r in sim_recs if r.get("status") == "complete"]
        pend_v   = len(sim_recs) - len(sim_comp)
        sim_ev   = [_correct(r) for r in sim_comp if _correct(r) is not None]
        n_ok_s   = sum(1 for ok in sim_ev if ok)
        n_ko_s   = sum(1 for ok in sim_ev if not ok)
        acc_sim  = (n_ok_s / (n_ok_s + n_ko_s) * 100) if (n_ok_s + n_ko_s) > 0 else None

        # ── Dati Retro (backtesting) ──────────────────────────────────────────
        retro_v  = _retro_by_ver.get(ver, [])
        retro_ev = [r.get("correct") for r in retro_v if r.get("correct") is not None]
        n_ok_r   = sum(1 for ok in retro_ev if ok)
        n_ko_r   = sum(1 for ok in retro_ev if not ok)
        n_retro  = n_ok_r + n_ko_r
        acc_ret  = (n_ok_r / n_retro * 100) if n_retro > 0 else None

        # ── Statistiche comuni ────────────────────────────────────────────────
        all_recs = sim_recs   # stabile% e aff.media usano solo Sim
        n_stable = sum(1 for r in all_recs if r.get("direction") == "→ Stabile")
        pct_stab = (n_stable / len(all_recs) * 100) if all_recs else None
        aff_vals = [r["affidabilita"] for r in all_recs if r.get("affidabilita") is not None]
        aff_avg  = round(sum(aff_vals) / len(aff_vals), 1) if aff_vals else None

        def _bias(key, _comp_v=sim_comp):
            vals = [_safe(r.get(key)) for r in _comp_v if r.get(key) is not None]
            return round(sum(vals) / len(vals), 2) if vals else None

        is_current = ver == _MODEL_VERSION
        fill = PatternFill("solid", fgColor="D6E8D4") if is_current else (C_ALT if vi % 2 == 0 else None)

        # Confronto vs versione migliore
        best_v = _all_accs.get(ver)
        if best_v is not None and best_acc is not None:
            delta     = best_v - best_acc
            confronto = ("★ Migliore" if abs(delta) < 0.5
                         else f"+{delta:+.1f}pp" if delta > 0 else f"{delta:.1f}pp")
        else:
            confronto = "— no dati"

        row_vals = [
            ("▶ " if is_current else "") + ver,
            len(sim_recs), pend_v, len(sim_comp),
            _pct(acc_ret), n_retro if n_retro > 0 else "—",
            _pct(acc_sim), n_ok_s, n_ko_s,
            _pct(pct_stab), aff_avg,
            _bias("d5_err"), _bias("d10_err"),
            confronto,
        ]
        for ci, v in enumerate(row_vals, 1):
            tbd_cols = {11, 12, 13}   # aff, bias d5, bias d10
            c = (_hcell_tbd if ci in tbd_cols else _hcell)(ws, row, ci, v, fill, FN, AL_C)

            if ci == 5:   # % Successo Retro
                if acc_ret is not None:
                    c.fill = C_GREEN if acc_ret >= 55 else (C_YELLOW if acc_ret >= 50 else C_RED)
                    c.font = Font(bold=True, color="1F3864" if acc_ret >= 50 else "C00000", size=11)
                elif n_retro == 0:
                    c.value = "—"; c.fill = PatternFill(); c.font = NA_FONT
            if ci == 7:   # % Successo Sim
                if acc_sim is not None:
                    c.fill = C_GREEN if acc_sim >= 55 else (C_YELLOW if acc_sim >= 50 else C_RED)
                    c.font = Font(bold=True, color="1F3864" if acc_sim >= 50 else "C00000", size=11)
                else:
                    c.value = "TBD"; c.fill = TBD_FILL; c.font = TBD_FONT
            if ci == 1 and is_current:
                c.font = Font(bold=True, color="1A5C1A", size=10)
        row += 1

    row += 1

    # ══════════════════════════════════════════════════════════════════════════
    # SEZIONE B — Accuratezza per orizzonte
    # ══════════════════════════════════════════════════════════════════════════
    ws.merge_cells(f"A{row}:M{row}")
    _hcell(ws, row, 1, "B — Accuratezza per Orizzonte (record Complete)", C_SEC, FW, AL_L)
    row += 1

    sec_b_headers = ["Orizzonte", "N", "MAE%", "Bias medio%", "Min%", "Max%", ""]
    for ci, h in enumerate(sec_b_headers, 1):
        _hcell(ws, row, ci, h, C_HEADER, FW, AL_C)
    row += 1

    for label, pred_k, actual_k, err_k in [
        ("T+3gg",  "d3_pred",  "d3_actual",  "d3_err"),
        ("T+5gg",  "d5_pred",  "d5_actual",  "d5_err"),
        ("T+10gg", "d10_pred", "d10_actual", "d10_err"),
        ("T+30gg", "d30_pred", "d30_actual", "d30_err"),
    ]:
        errs = [_safe(r.get(err_k)) for r in complete if r.get(err_k) is not None]
        n    = len(errs)
        mae  = round(sum(abs(e) for e in errs) / n, 2) if n else None
        bias = round(sum(errs) / n, 2) if n else None
        mn   = round(min(errs), 2) if n else None
        mx   = round(max(errs), 2) if n else None
        fill = C_ALT if label in ("T+3gg", "T+10gg") else None
        for ci, v in enumerate([label, n, mae, bias, mn, mx, ""], 1):
            # Col 3-6 (MAE, Bias, Min, Max): None = nessun record completo ancora
            (_hcell_tbd if 3 <= ci <= 6 else _hcell)(ws, row, ci, v, fill, FN, AL_C)
        row += 1

    row += 1

    # ══════════════════════════════════════════════════════════════════════════
    # SEZIONE C — Distribuzione direzioni per versione
    # ══════════════════════════════════════════════════════════════════════════
    ws.merge_cells(f"A{row}:M{row}")
    _hcell(ws, row, 1, "C — Distribuzione Direzioni per Versione", C_SEC, FW, AL_L)
    row += 1

    dir_labels = ["↑↑ Forte crescita", "↑ Crescita lieve", "→ Stabile",
                  "↓ Calo lieve", "↓↓ Calo forte"]
    sec_c_headers = ["Direzione"] + versions_ordered + ["Tot."]
    for ci, h in enumerate(sec_c_headers, 1):
        _hcell(ws, row, ci, h, C_HEADER, FW, AL_C)
    row += 1

    for di, dl in enumerate(dir_labels):
        fill = C_ALT if di % 2 == 0 else None
        counts = [sum(1 for r in records if r["model_version"] == v and r.get("direction") == dl)
                  for v in versions_ordered]
        tot = sum(counts)
        for ci, v in enumerate([dl] + counts + [tot], 1):
            c = _hcell(ws, row, ci, v, fill, FN, AL_C)
            if di == 2 and ci == 1: c.font = Font(bold=True, color="1F7A3A", size=10)  # ↑
            if di == 4 and ci == 1: c.font = Font(bold=True, color="C00000", size=10)  # ↓
        row += 1

    row += 1

    # ══════════════════════════════════════════════════════════════════════════
    # SEZIONE D — Storico previsioni (ultimi 40 record, dal più recente)
    # ══════════════════════════════════════════════════════════════════════════
    ws.merge_cells(f"A{row}:M{row}")
    _hcell(ws, row, 1, "D — Storico Previsioni (ultimi 40 record)", C_SEC, FW, AL_L)
    row += 1

    sec_d_headers = [
        "Data Pred.", "Ticker", "Versione", "Fase",
        "Direzione Pred.", "Dir.Raw", "★",
        "Aff%", "VR", "run+30gg",
        "Stato", "d5 reale%", "Corretto?"
    ]
    for ci, h in enumerate(sec_d_headers, 1):
        _hcell(ws, row, ci, h, C_HEADER, FW, AL_C)
    row += 1

    # Colonne Sezione D che possono avere None → TBD se pending
    # 8=Aff%, 9=VR, 10=run+30gg  (1-indexed)
    _D_TBD_COLS = {8, 9, 10}

    recent = sorted(records, key=lambda r: r.get("prediction_date", ""), reverse=True)[:40]
    for ri, r in enumerate(recent):
        ok = _correct(r)
        fill = C_ALT if ri % 2 == 0 else None
        d5a  = r.get("d5_actual")
        esito_str = ("✓" if ok else "✗") if ok is not None else "⏳"
        vals = [
            r.get("prediction_date", ""),
            r.get("ticker", ""),
            r.get("model_version", ""),
            r.get("phase", ""),
            r.get("direction", ""),
            r.get("direction_raw", ""),
            r.get("stars", ""),
            r.get("affidabilita"),
            r.get("vol_ratio"),
            r.get("run_up_30d"),
            r.get("status", ""),
            round(d5a, 1) if d5a is not None else "—",
            esito_str,
        ]
        for ci, v in enumerate(vals, 1):
            # Colonne con dati "non ancora raccolti" → TBD; altri None → _hcell normale
            c = (_hcell_tbd if ci in _D_TBD_COLS else _hcell)(ws, row, ci, v, fill, FN, AL_C)
            if ci == 13:  # Corretto?
                if esito_str == "✓": c.fill = C_GREEN; c.font = FB
                elif esito_str == "✗": c.fill = C_RED;   c.font = Font(bold=True, color="C00000", size=10)
        row += 1

    # ── Larghezze colonne (14 colonne totali) ─────────────────────────────────
    col_widths = [18, 9, 14, 10, 20, 18, 12, 10, 9, 10, 10, 10, 10, 16]
    for i, w in enumerate(col_widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    # Colonna 4 (changelog Sezione 0) vuole molto spazio
    ws.column_dimensions["D"].width = 80
    for r_idx in range(1, row):
        ws.row_dimensions[r_idx].height = 18

    print(f"[Modello] Sheet '{SHEET_NAME}' scritta — {len(records)} record totali")


def _build_ticker_cik_map() -> dict[str, str]:
    """
    Legge data/sec_company_tickers.json (già in cache da _load_sec_cik_map)
    e costruisce una mappa ticker.upper() → CIK (stringa numerica senza leading zeros).
    Se il file non esiste tenta di scaricarlo tramite _load_sec_cik_map().
    """
    sec_cache = os.path.join(DATA_DIR, "sec_company_tickers.json")
    if not os.path.exists(sec_cache):
        _load_sec_cik_map()                 # effetto collaterale: scarica il file
    if not os.path.exists(sec_cache):
        print("[CIK] sec_company_tickers.json non disponibile — colonna CIK assente.")
        return {}
    try:
        with open(sec_cache, encoding="utf-8") as fh:
            sec_data = json.load(fh)
        ticker_to_cik: dict[str, str] = {}
        for entry in sec_data.values():
            tk  = str(entry.get("ticker", "") or "").strip().upper()
            cik = str(entry.get("cik_str", "") or "").strip().lstrip("0")
            if tk and cik:
                ticker_to_cik[tk] = cik
        print(f"[CIK] Mappa ticker→CIK costruita: {len(ticker_to_cik)} voci")
        return ticker_to_cik
    except Exception as exc:
        print(f"[CIK] Errore costruzione mappa ticker→CIK: {exc}")
        return {}


def save_final_outputs(master_df, clinical_df):
    # Sheet Simulation / Catalyst Completati — resta lista vuota se manca Sheet 5
    _sim_rows_past: list = []

    with pd.ExcelWriter(FINAL_XLSX, engine="openpyxl") as writer:

        # ── Sheet 1: Financial ────────────────────────────────────────────────
        if not master_df.empty:
            financial_df = master_df.copy()

            # ── Aggiungi colonna CIK (SEC EDGAR) ─────────────────────────────
            _tk_cik = _build_ticker_cik_map()   # dict vuoto se SEC non disponibile
            if "symbol" in financial_df.columns:
                financial_df["cik"] = (
                    financial_df["symbol"]
                    .astype(str).str.strip().str.upper()
                    .map(_tk_cik)              # NaN se ticker non trovato
                )
                _found = financial_df["cik"].notna().sum()
                print(f"[CIK] Colonna CIK aggiunta: {_found}/{len(financial_df)} "
                      f"società con CIK trovato")

            cols_to_remove = [c for c in financial_df.columns if c in COLUMNS_TO_DROP]
            if cols_to_remove:
                financial_df = financial_df.drop(columns=cols_to_remove)
                print(f"[Financial] Colonne escluse (COLUMNS_TO_DROP): {cols_to_remove}")

            empty_cols = [c for c in financial_df.columns if financial_df[c].isna().all()]
            if empty_cols:
                financial_df = financial_df.drop(columns=empty_cols)
                print(f"[Financial] Colonne vuote rimosse: {empty_cols}")

            # Riordina: ID → gruppo variazioni → resto
            financial_df = _apply_col_order(financial_df)

            if "marketCap" in financial_df.columns:
                financial_df["marketCap"] = pd.to_numeric(financial_df["marketCap"], errors="coerce")
                financial_df = financial_df.sort_values("marketCap", ascending=False, na_position="last")

            financial_df.to_excel(writer, index=False, sheet_name="Financial")
            ws1 = writer.sheets["Financial"]

            # Tab colore blu
            ws1.sheet_properties.tabColor = "4472C4"

            # Intestazione (riga 1)
            style_header_row(ws1, len(financial_df.columns))

            # Riga 2: descrizioni colonne
            ws1.insert_rows(2)
            for col_idx, col_name in enumerate(financial_df.columns, start=1):
                cell = ws1.cell(row=2, column=col_idx)
                cell.value = COLUMN_DESCRIPTIONS.get(col_name, "")
                cell.fill = DESC_FILL
                cell.font = DESC_FONT
                cell.alignment = ALIGN_CENTER
            ws1.row_dimensions[2].height = 28

            # Riga 3: media ± deviazione standard per colonne numeriche
            ws1.insert_rows(3)
            for col_idx, col_name in enumerate(financial_df.columns, start=1):
                cell = ws1.cell(row=3, column=col_idx)
                cell.fill = STATS_FILL
                cell.font = STATS_FONT
                cell.alignment = ALIGN_CENTER
                s = pd.to_numeric(financial_df[col_name], errors="coerce").dropna()
                if len(s) >= 2:
                    cell.value = f"μ {s.mean():.2f}  σ {s.std():.2f}"
            ws1.row_dimensions[3].height = 24

            # Stile completo dati (zebra, numeri, allineamento, variazioni, beta) — dati da riga 4
            apply_financial_sheet_style(ws1, financial_df, data_start_row=4)

            # Freeze su A4 (intestazione + descrizioni + stats sempre visibili)
            ws1.freeze_panes = "A4"

            # Setup stampa
            ws1.page_setup.orientation = "landscape"
            ws1.print_title_rows = "1:3"

        # ── Sheet 2: Errors ───────────────────────────────────────────────────
        if not master_df.empty:
            write_errors_sheet(writer.book, master_df)

        # ── Arricchimento clinical_df: Modality + sponsor_match ──────────────
        if not clinical_df.empty:
            clinical_df_rich = add_modality_column(clinical_df)
            clinical_df_rich = add_sponsor_match_column(clinical_df_rich)
        else:
            clinical_df_rich = clinical_df

        # ── Sheet 3: Clinical / FDA ───────────────────────────────────────────
        if not clinical_df_rich.empty:
            write_clinical_sheet(writer.book, clinical_df_rich)

        # ── Lettura portafoglio (usata da Catalysts e Simulation) ────────────
        _invested, _portfolio = _read_invested_tickers(FINAL_XLSX)

        # ── Sheet 4: Catalysts 60 giorni ─────────────────────────────────────
        if not clinical_df_rich.empty and not master_df.empty:
            write_catalysts_sheet(writer.book, clinical_df_rich, financial_df,
                                  invested_tickers=_invested,
                                  portfolio_data=_portfolio)

        # ── Sheet 5: Simulazione investimento ────────────────────────────────
        if not financial_df.empty:
            from simulation_core import build_rows_from_df
            ws_sim = writer.book.create_sheet("Simulation")
            ws_sim.sheet_properties.tabColor = "7030A0"
            _sim_rows = build_rows_from_df(
                financial_df,
                catalyst_dates=_extract_catalyst_dates(clinical_df),
            )
            _sim_rows_past  = []   # popolato nel filtro; usato per "Catalyst Completati"
            _sim_pnl_data   = {}   # default; sovrascritto nel blocco clinical_df_rich
            _ticker_studies_past = {}   # default; sovrascritto nel blocco clinical_df_rich

            # ── Filtro: completion date entro 60gg E sponsor Exact (perfect match)
            if not clinical_df_rich.empty:
                from datetime import date as _today_cls, timedelta as _td
                _tk_col = next(
                    (c for c in ["ticker", "symbol"] if c in clinical_df_rich.columns),
                    None,
                )
                _dt_col = next(
                    (c for c in ["primary_completion_date", "completion_date",
                                 "study_completion_date",
                                 "estimated_completion_date", "end_date"]
                     if c in clinical_df_rich.columns),
                    None,
                )
                if _tk_col and _dt_col:
                    _tmp = clinical_df_rich.copy()
                    _tmp[_dt_col] = pd.to_datetime(_tmp[_dt_col], errors="coerce")
                    _today60   = _today_cls.today()
                    _horizon60 = _today60 + _td(days=60)
                    # FIX Bug 1: usa >= (coerente con _extract_catalyst_dates)
                    _mask_date = (
                        (_tmp[_dt_col].dt.date >= _today60) &
                        (_tmp[_dt_col].dt.date <= _horizon60)
                    )
                    # condizione 2: solo sponsor Exact (perfect match)
                    _mask_spon = (
                        _tmp["sponsor_match"] == "Exact"
                        if "sponsor_match" in _tmp.columns
                        else pd.Series(False, index=_tmp.index)
                    )

                    # ── Risoluzione ticker mancanti ──────────────────────────
                    # Società Exact+60gg senza ticker: ticker non era in yf.json.
                    # Tentativo di risoluzione automatica da query_company via
                    # yfinance Search (solo mercati USA — NYSE/NASDAQ).
                    _exact_subset = _tmp.loc[_mask_date & _mask_spon].copy()
                    _missing_tk   = _exact_subset[
                        _exact_subset[_tk_col].astype(str).str.strip() == ""
                    ]
                    if not _missing_tk.empty:
                        _qc_col = "query_company" if "query_company" in _missing_tk.columns else None
                        _resolved_map: dict = {}   # query_company → ticker
                        for _, _mrow in _missing_tk.drop_duplicates(
                                subset=[_qc_col] if _qc_col else []).iterrows():
                            _qname = str(_mrow.get(_qc_col or "", "")).strip() if _qc_col else ""
                            if not _qname or _qname in _resolved_map:
                                continue
                            try:
                                import yfinance as _yf_search
                                _hits = _yf_search.Search(
                                    _qname, max_results=5,
                                    news_count=0, enable_fuzzy_query=True,
                                ).quotes
                                _us_xch = {"NMS", "NYQ", "NGM", "NCM", "BTS",
                                           "AMEX", "PCX", "ASE"}
                                for _hit in _hits:
                                    if (_hit.get("quoteType") == "EQUITY"
                                            and _hit.get("exchange", "") in _us_xch):
                                        _tk_found = str(_hit.get("symbol", "")).strip().upper()
                                        if _tk_found:
                                            _resolved_map[_qname] = _tk_found
                                            break
                            except Exception:
                                pass
                        if _resolved_map:
                            print(f"[Simulation] Ticker auto-risolti da nome sponsor: "
                                  f"{_resolved_map}")
                            # Scrivi i ticker trovati nel DataFrame in memoria
                            if _qc_col:
                                def _fill_tk(row, _map=_resolved_map, _tc=_tk_col, _qc=_qc_col):
                                    if str(row[_tc]).strip():
                                        return row[_tc]
                                    return _map.get(str(row[_qc]).strip(), "")
                                _tmp[_tk_col] = _tmp.apply(_fill_tk, axis=1)
                        _still_empty = _tmp.loc[
                            _mask_date & _mask_spon,
                            [_qc_col or _tk_col, _tk_col]
                        ]
                        _no_tk = _still_empty[
                            _still_empty[_tk_col].astype(str).str.strip() == ""
                        ]
                        if not _no_tk.empty:
                            _no_tk_names = list(_no_tk[_qc_col or _tk_col].unique()) if _qc_col else []
                            print(f"[Simulation] ⚠ Società Exact senza ticker risolto "
                                  f"(aggiungi a yf.json per includerle): "
                                  f"{_no_tk_names}")

                    # ── Pass 1: ticker diretto da colonna clinical_df_rich ────────
                    # Usa _mask_spon (TUTTI gli Exact, passati + futuri) così i ticker
                    # con completion già passata entrano in _match_ok e vengono poi
                    # dirottati sulla sheet "Catalyst Completati" dallo split.
                    # Normalizza in modo difensivo: evita set misti (float/str) da NaN/NA
                    # così logging/sorting non va in TypeError su Python.
                    _match_ok = {
                        str(_v).strip().upper()
                        for _v in _tmp.loc[_mask_spon, _tk_col].tolist()
                        if str(_v).strip()
                        and str(_v).strip().upper() not in {"NAN", "<NA>", "NONE", "NULL"}
                    }

                    # ── Pass 2: lookup yf.json query_company → symbol ─────────────
                    # Copre il caso in cui il ticker non era nel CSV ma la società
                    # è in yf.json con il nome che corrisponde a query_company.
                    try:
                        import json as _j2, os as _o2
                        _yfp = _o2.path.join(DATA_DIR, "yf.json")
                        if _o2.path.exists(_yfp):
                            with open(_yfp, encoding="utf-8") as _fh:
                                _yfd = _j2.load(_fh)
                            _yf_map = {
                                _norm(str(it.get("companyName", ""))):
                                    str(it.get("symbol", "")).strip().upper()
                                for it in _yfd
                                if isinstance(it, dict)
                                   and it.get("symbol") and it.get("companyName")
                            }
                            _qcc = "query_company" if "query_company" in _tmp.columns else None
                            if _qcc:
                                # usa _mask_spon (tutti gli Exact) per catturare anche i passati
                                for _, _er in _tmp.loc[_mask_spon].iterrows():
                                    _qcv = str(_er.get(_qcc, "")).strip()
                                    _tk_found = _yf_map.get(_norm(_qcv), "")
                                    if _tk_found and _tk_found not in _match_ok:
                                        _match_ok.add(_tk_found)
                                        print(f"[Simulation] Pass2 yf.json: "
                                              f"'{_qcv}' → {_tk_found}")
                    except Exception as _e2:
                        print(f"[Simulation] Pass2 skip: {_e2}")

                    # ── Pass 3: matching INDIPENDENTE da sponsor_match pre-calcolato ──
                    # Confronta financial_df["companyName"] contro lead_sponsor di
                    # TUTTI gli studi Exact (passati + futuri), con lo stesso fuzzy
                    # matching del catalyst sheet.
                    try:
                        _fn_col = next(
                            (c for c in ["companyName", "name", "longName", "shortName"]
                             if c in financial_df.columns), None
                        )
                        if _fn_col:
                            _fin_nm = {
                                str(rw.get("symbol", "")).strip().upper():
                                    str(rw.get(_fn_col, "")).strip()
                                for _, rw in financial_df.iterrows()
                                if str(rw.get("symbol", "")).strip()
                            }
                            # usa _mask_spon per includere anche studi già completati
                            _all60 = _tmp.loc[_mask_spon]
                            _lsc3  = next((c for c in ["lead_sponsor", "sponsor"]
                                           if c in _all60.columns), None)
                            _rpoc3 = next((c for c in ["responsible_party_organization",
                                                        "responsible_party_org"]
                                           if c in _all60.columns), None)
                            _clbc3 = "collaborators" if "collaborators" in _all60.columns else None
                            _qcc3  = "query_company" if "query_company" in _all60.columns else None
                            print(f"[Simulation] Pass3: {len(_all60)} studi Exact (passati+futuri), "
                                  f"{len(_fin_nm)} ticker in financial_df")
                            for _fsym, _fname in _fin_nm.items():
                                if _fsym in _match_ok or not _fname:
                                    continue
                                for _, _ar in _all60.iterrows():
                                    _ls3  = str(_ar.get(_lsc3,  "") or "") if _lsc3  else ""
                                    _rpo3 = str(_ar.get(_rpoc3, "") or "") if _rpoc3 else ""
                                    _clb3 = str(_ar.get(_clbc3, "") or "") if _clbc3 else ""
                                    _qc3  = str(_ar.get(_qcc3,  "") or "") if _qcc3  else ""
                                    # prova prima col companyName di financial_df,
                                    # poi con il query_company del CSV come fallback
                                    for _cand_q in (_fname, _qc3):
                                        if not _cand_q:
                                            continue
                                        if _compute_sponsor_match(
                                                _cand_q, _ls3, _rpo3, _clb3
                                        ) == "Exact":
                                            _match_ok.add(_fsym)
                                            print(f"[Simulation] Pass3 ✓ "
                                                  f"'{_cand_q}' → {_fsym} "
                                                  f"(lead='{_ls3}')")
                                            break
                                    if _fsym in _match_ok:
                                        break
                    except Exception as _e3:
                        print(f"[Simulation] Pass3 skip: {_e3}")

                    # ── Diagnostica: mostra sponsor_match per ogni ticker in financial_df
                    try:
                        _fn_col_d = next(
                            (c for c in ["companyName", "name", "longName", "shortName"]
                             if c in financial_df.columns), None
                        )
                        _sm_col_d = "sponsor_match" if "sponsor_match" in _tmp.columns else None
                        _qc_col_d = "query_company" if "query_company" in _tmp.columns else None
                        if _fn_col_d:
                            print("[Simulation] Diagnostica sponsor_match per ticker:")
                            for _, _drw in financial_df.iterrows():
                                _dtk = str(_drw.get("symbol", "")).strip().upper()
                                _dnm = str(_drw.get(_fn_col_d, "")).strip()
                                if not _dtk:
                                    continue
                                _d60_rows = _tmp.loc[_mask_date]
                                for _, _dar in _d60_rows.iterrows():
                                    _dqc = str(_dar.get(_qc_col_d, "") or "") if _qc_col_d else ""
                                    _dsm = str(_dar.get(_sm_col_d, "") or "") if _sm_col_d else ""
                                    _dls = str(_dar.get("lead_sponsor", "") or "") if "lead_sponsor" in _dar else ""
                                    if _norm(_dtk) in _norm(_dqc) or _norm(_dnm[:8]) in _norm(_dls):
                                        print(f"  {_dtk}: query_company='{_dqc}' "
                                              f"lead='{_dls}' sponsor_match='{_dsm}' "
                                              f"in_match_ok={_dtk in _match_ok}")
                                        break
                    except Exception:
                        pass

                    print(f"[Simulation] _match_ok ({len(_match_ok)}): "
                          f"{sorted(_match_ok, key=str)}")
                    _before = len(_sim_rows)
                    _sim_rows = [
                        r for r in _sim_rows
                        if str(r.get("ticker", "")).strip().upper() in _match_ok
                    ]
                    print(f"[Simulation] Filtro (60gg + Exact): "
                          f"{_before} → {len(_sim_rows)} "
                          f"(escluse {_before - len(_sim_rows)})")

                    # ── Arricchisci ogni riga con sponsor_match, completion_date e phase ──
                    # Usa _mask_spon (tutti gli studi Exact, senza limite di data) così
                    # sia i ticker futuri ≤60gg che quelli con completion già passata
                    # ricevono la loro data corretta per lo split.
                    _date_lookup: dict  = {}
                    _phase_lookup: dict = {}
                    _clin_filt = _tmp.loc[_mask_spon].copy()
                    _clin_filt["_tk_up"] = (
                        _clin_filt[_tk_col].astype(str).str.strip().str.upper()
                    )
                    # Individua colonna fase (vari naming possibili)
                    _ph_col = next(
                        (c for c in ["phase", "study_phase", "phases",
                                     "primary_phase", "study_type"]
                         if c in _clin_filt.columns),
                        None,
                    )
                    for _tk_u, _grp in _clin_filt.groupby("_tk_up"):
                        _raw_dt = _grp.iloc[0][_dt_col]
                        try:
                            _date_lookup[_tk_u] = pd.Timestamp(_raw_dt).date()
                        except Exception:
                            _date_lookup[_tk_u] = None
                        if _ph_col:
                            _phase_lookup[_tk_u] = str(_grp.iloc[0][_ph_col]).strip()

                    # Popola _date_lookup anche per i ticker trovati via Pass 2/3
                    # cercando nell'intera _all60 per ogni ticker in _match_ok
                    try:
                        _fn_col_dl = next(
                            (c for c in ["companyName", "name", "longName", "shortName"]
                             if c in financial_df.columns), None
                        )
                        _lsc_dl = next((c for c in ["lead_sponsor", "sponsor"]
                                        if c in _tmp.columns), None)
                        _rpoc_dl = next((c for c in ["responsible_party_organization",
                                                      "responsible_party_org"]
                                         if c in _tmp.columns), None)
                        _clbc_dl = "collaborators" if "collaborators" in _tmp.columns else None
                        for _dtk in list(_match_ok):
                            if _dtk in _date_lookup:
                                continue
                            # cerca il nome azienda in financial_df
                            _sym_col_dl = next(
                                (c for c in ["symbol", "ticker", "Ticker"]
                                 if c in financial_df.columns), None
                            )
                            if _sym_col_dl and _fn_col_dl:
                                _dfrow = financial_df[
                                    financial_df[_sym_col_dl]
                                    .astype(str).str.strip().str.upper() == _dtk
                                ]
                                _dname = str(_dfrow.iloc[0][_fn_col_dl]).strip() if not _dfrow.empty else ""
                            else:
                                _dname = ""
                            # usa _mask_spon (tutti gli Exact) — non solo _mask_date
                            for _, _dlr in _tmp.loc[_mask_spon].iterrows():
                                _dls  = str(_dlr.get(_lsc_dl,  "") or "") if _lsc_dl  else ""
                                _drpo = str(_dlr.get(_rpoc_dl, "") or "") if _rpoc_dl else ""
                                _dclb = str(_dlr.get(_clbc_dl, "") or "") if _clbc_dl else ""
                                _dqc  = str(_dlr.get("query_company", "") or "")
                                for _cq in (_dname, _dqc):
                                    if _cq and _compute_sponsor_match(_cq, _dls, _drpo, _dclb) == "Exact":
                                        try:
                                            _date_lookup[_dtk] = pd.Timestamp(_dlr[_dt_col]).date()
                                        except Exception:
                                            _date_lookup[_dtk] = None
                                        if _ph_col:
                                            _phase_lookup[_dtk] = str(_dlr.get(_ph_col, "")).strip()
                                        break
                                if _dtk in _date_lookup:
                                    break
                    except Exception as _dle:
                        print(f"[Simulation] date_lookup Pass2/3 skip: {_dle}")

                    # FIX Bug 2: aggiungi righe stub per ticker Exact presenti nel
                    # clinical ma assenti in financial_df (fetch prezzi fallito).
                    # I lookup sono già pronti a questo punto.
                    _sim_tickers = {
                        str(r.get("ticker", "")).strip().upper()
                        for r in _sim_rows
                    }
                    _missing = _match_ok - _sim_tickers
                    if _missing:
                        print(f"[Simulation] Aggiunte {len(_missing)} righe stub "
                              f"(ticker senza dati finanziari): {sorted(_missing)}")
                        for _tk_miss in sorted(_missing):
                            _sim_rows.append({
                                "ticker":          _tk_miss,
                                "name":            "",
                                "completion_date": _date_lookup.get(_tk_miss),
                                "sponsor_match":   "Exact",
                                "phase":           _phase_lookup.get(_tk_miss, ""),
                                "curr_price":      None,
                                "daily_chg":       None,
                                "market_cap":      None,
                                "beta":            None,
                                "var_1m":          None,
                                "var_3m":          None,
                                "var_6m":          None,
                                "buy_price":       None,
                                "capital":         None,
                            })

                    # Arricchisci tutte le righe (incluse le stub appena aggiunte)
                    for _r in _sim_rows:
                        _tk_u = str(_r.get("ticker", "")).strip().upper()
                        _r["sponsor_match"] = "Exact"
                        if not _r.get("completion_date"):
                            _r["completion_date"] = _date_lookup.get(_tk_u)
                        if not _r.get("phase"):
                            _r["phase"] = _phase_lookup.get(_tk_u, "")

                    # ── Split: futuri (≤60gg) e passati ──────────────────────────
                    # _r["completion_date"] può essere str ISO, datetime.date, NaT o None
                    def _cd_to_date(v):
                        if v is None: return None
                        # pd.NaT non è None ma è falsy e isnull → scarta
                        try:
                            if pd.isnull(v): return None
                        except (TypeError, ValueError):
                            pass
                        # Timestamp pandas o datetime con .date()
                        if hasattr(v, "date"):
                            try:
                                d = v.date()
                                # pd.NaT.date() ritorna NaT in pandas vecchie: _is_valid_date lo filtra
                                return d
                            except (ValueError, AttributeError):
                                return None
                        if isinstance(v, _today_cls): return v
                        try:
                            ts = pd.Timestamp(str(v))
                            if pd.isnull(ts): return None
                            return ts.date()
                        except: return None

                    def _is_valid_date(d):
                        """True solo se d è un datetime.date reale (non NaT, non None)."""
                        if d is None: return False
                        try:
                            if pd.isnull(d): return False
                        except (TypeError, ValueError):
                            pass
                        return isinstance(d, _today_cls)

                    _sim_rows_future = []
                    _sim_rows_past   = []
                    for _r in _sim_rows:
                        _cd = _cd_to_date(_r.get("completion_date"))
                        if not _is_valid_date(_cd):
                            continue
                        if _today60 <= _cd <= _horizon60:
                            _sim_rows_future.append(_r)
                        elif _cd < _today60:
                            _r["past_catalyst"] = True
                            _sim_rows_past.append(_r)
                        # completamente futuri >60gg vengono scartati

                    _before_date = len(_sim_rows)
                    _sim_rows    = _sim_rows_future   # la Simulation sheet usa solo futuri
                    _removed_date = _before_date - len(_sim_rows) - len(_sim_rows_past)
                    print(f"[Simulation] Futuri ≤60gg: {len(_sim_rows_future)}  "
                          f"Passati: {len(_sim_rows_past)}  "
                          f"Scartati (>60gg/no-data): {_removed_date}")

            # ── P&L per investimenti con catalyst già scaduti ─────────────────────
            # Stessa logica di data_orchestrator: se manca sponsor_match nel DF si
            # usano tutte le righe con data passata; merge date da _sim_rows_past.
            _sim_pnl_data = {}
            _pnl_cd: dict[str, object] = {}
            from datetime import date as _d_cls_pnl
            if not clinical_df_rich.empty:
                _tk2 = next((c for c in ["ticker", "symbol"]
                             if c in clinical_df_rich.columns), None)
                _dt2 = next((c for c in ["primary_completion_date", "completion_date",
                                          "study_completion_date",
                                          "estimated_completion_date", "end_date"]
                             if c in clinical_df_rich.columns), None)
                if _tk2 and _dt2:
                    _tmp2 = clinical_df_rich.copy()
                    _tmp2[_dt2] = pd.to_datetime(_tmp2[_dt2], errors="coerce")
                    _today2 = _d_cls_pnl.today()
                    _mask_past2 = _tmp2[_dt2].dt.date < _today2
                    if "sponsor_match" in _tmp2.columns:
                        _mask_spon2 = _tmp2["sponsor_match"].isin(["Exact", "Partial"])
                    else:
                        _mask_spon2 = pd.Series(True, index=_tmp2.index)
                    _past_comp_all = (
                        _tmp2.loc[_mask_past2 & _mask_spon2]
                        .groupby(_tk2)[_dt2].min().dt.date
                        .to_dict()
                    )
                    _pnl_cd = {
                        str(k).strip().upper(): v
                        for k, v in _past_comp_all.items()
                    }

            for __rpn in _sim_rows_past:
                __tkp = str(__rpn.get("ticker", "")).strip().upper()
                __raw = __rpn.get("completion_date")
                __dcp = None
                try:
                    if __raw is not None:
                        if hasattr(__raw, "date") and callable(__raw.date):
                            __dcp = __raw.date()
                        elif isinstance(__raw, _d_cls_pnl):
                            __dcp = __raw
                        else:
                            _ts_p = pd.Timestamp(__raw)
                            __dcp = (None if pd.isnull(_ts_p) else _ts_p.date())
                except Exception:
                    __dcp = None
                if __tkp and __dcp and __tkp in (_portfolio or {}):
                    _pnl_cd[__tkp] = __dcp

            if _portfolio and _pnl_cd:
                _pnl_tickers = {t for t in _portfolio if t in _pnl_cd}
                if _pnl_tickers:
                    _sim_pnl_data = _compute_pnl_data(
                        _portfolio,
                        _pnl_tickers,
                        {t: _pnl_cd[t] for t in _pnl_tickers},
                    )

            # Lookup studi clinici (prossimi 60 gg — coerente con filtro Simulation)
            _ticker_studies = _build_ticker_studies(
                clinical_df_rich if not clinical_df_rich.empty else None
            )

            # Calcola predizioni curve fitting (solo ticker con completion futura)
            _sim_pred_data = _compute_price_predictions(_sim_rows)

            # ── Ciclo auto-calibrazione ───────────────────────────────────────
            # 1. Completa record pending il cui T+35gg è già passato
            # 2. Salva i nuovi record pending per le predizioni appena calcolate
            try:
                _calib_collect_actuals()
                if _sim_pred_data:
                    _calib_save_pending(_sim_pred_data, _sim_rows)
            except Exception as _ce:
                print(f"[Calib] Errore ciclo calibrazione (non bloccante): {_ce}")

            # Scrive righe principali + dettaglio in un unico passaggio (no insert_rows)
            _main_row_positions = _write_full_sim_sheet(
                ws_sim, _sim_rows, _ticker_studies,
                pnl_data=_sim_pnl_data, pred_data=_sim_pred_data,
            )

            # Colori sulle righe principali (posizioni esplicite, non offset consecutivi)
            _apply_sim_coloring(ws_sim, _sim_rows,
                                data_start_row=4,
                                main_row_positions=_main_row_positions)

            # Sheet 5b "Catalyst Completati" viene scritto DOPO il retro backtest
            # (vedi blocco più in basso) in modo da avere le direzioni modello storiche.
            _ticker_studies_past = (
                _build_ticker_studies(
                    clinical_df_rich if not clinical_df_rich.empty else None,
                    include_past=True,
                )
                if _sim_rows_past else {}
            )

        # ── Sheet 6: IPO Snapshot (5 società da retrospective_config.json) ──
        print("\n[Sheet 6] IPO Snapshot…")
        write_ipo_snapshot_sheet(writer.book, clinical_df)

        # ── Retro backtest (foglio «📊 Modello» non esportato) ─────────────────
        print("\n[Calib] Retro backtest (export senza foglio Modello)…")
        print(f"[Calib] Backtesting retro (Exact/Partial) — "
              f"cohorte RETRO_CALIB_COHORT={FE_RETRO_CALIB_COHORT}…")
        try:
            _retro_recs = _run_retro_backtest(
                clinical_df,
                financial_df=financial_df if not financial_df.empty else None,
            )
        except Exception as _rbe:
            print(f"[RetroBacktest] Errore non bloccante: {_rbe}")
            _retro_recs = []
        if _retro_recs:
            _write_retro_sheet(writer.book, _retro_recs)

        # ── 📚 Libreria storica (stesso nome e JSON di data_orchestrator) ─────────
        if os.environ.get("SKIP_MODEL_HISTLIB_SHEET", "").strip() not in (
                "1", "true", "TRUE", "yes"):
            import data_orchestrator as _dorch

            _hist_doc_fe = None
            _cdf_hist = (clinical_df_rich
                         if not clinical_df_rich.empty else clinical_df)
            try:
                print("\n[HistLib] Libreria input storici (T±n) + foglio Excel…")
                _hlib_pairs = _dorch._gather_hist_library_pair_rows(
                    _retro_recs,
                    _sim_rows_past,
                    clinical_df=_cdf_hist,
                )
                _hist_doc_fe = _dorch._histlib_build_or_update_doc(_hlib_pairs)
            except Exception as _hle:
                import traceback as _tbh
                print(f"[HistLib] Build/update KO — foglio da JSON disco:\n"
                      f"{_hle}\n{_tbh.format_exc()}")
                _hist_doc_fe = _dorch._histlib_load_json()
                _bfe = str(_hist_doc_fe.get("built_note") or "").strip()
                _hist_doc_fe["built_note"] = (
                    (_bfe + " · ") if _bfe else "") + "Excel: JSON fallback (fetch_edgar)."
            try:
                _dorch._write_histlib_model_inputs_sheet(writer.book, _hist_doc_fe)
            except Exception as _hwfe:
                print(f"[HistLib] Scrittura foglio 📚 Modello storico snapshot KO: {_hwfe}")

        # ── Sheet 5b: Catalyst Completati ────────────────────────────────────
        # Scritto qui (dopo il retro backtest) per poter mostrare le direzioni
        # modello storiche (pre-catalyst) calcolate da _run_retro_backtest.
        if _sim_rows_past:
            print(f"\n[Sheet 5b] Catalyst Completati: {len(_sim_rows_past)} righe…")
            ws_past = writer.book.create_sheet("Catalyst Completati")
            ws_past.sheet_properties.tabColor = "C55A11"

            # ── Allarga la base studi: aggiungi TUTTE le righe Exact passate ──────
            # _sim_rows_past contiene solo i ticker già in yf.json (elaborati da
            # simulation_core). Estraiamo direttamente dal clinical_df tutte le
            # righe Exact con completion_date passata e le aggiungiamo evitando
            # duplicati: così _compute_past_catalyst_data copre l'intero storico.
            _DATE_C  = ["primary_completion_date", "completion_date",
                        "study_completion_date", "estimated_completion_date", "end_date"]
            _TICK_C  = ["ticker", "symbol"]

            def _cd2d(v):
                if v is None: return None
                if isinstance(v, _today_cls): return v
                try:
                    t = _pd.Timestamp(str(v))
                    return None if _pd.isnull(t) else t.date()
                except: return None

            _clin_src = (clinical_df_rich
                         if not clinical_df_rich.empty else clinical_df)

            # ── Livello 2: nome azienda → ticker da financial_df ─────────────
            # Molte righe in clinical_df hanno ticker vuoto perché non ancora
            # risolto da simulation_core. Proviamo a risolvere dal financial_df.
            _name_to_tk: dict = {}   # _norm(companyName) → ticker upper
            try:
                if financial_df is not None and not financial_df.empty:
                    _fn_col = next((c for c in ["companyName", "name", "longName",
                                                "shortName"] if c in financial_df.columns), None)
                    _ft_col = next((c for c in ["ticker", "symbol"]
                                   if c in financial_df.columns), None)
                    if _fn_col and _ft_col:
                        for _, _fr in financial_df.iterrows():
                            _fnm = _norm(str(_fr.get(_fn_col, "") or ""))
                            _ftk = str(_fr.get(_ft_col, "") or "").strip().upper()
                            if _fnm and _ftk:
                                _name_to_tk[_fnm] = _ftk
            except Exception as _nte:
                print(f"[PastCatalyst] Mappa nome→ticker (financial_df) non costruita: {_nte}")

            # ── Livello 3: CIK → ticker + nome → ticker da SEC EDGAR ─────────
            _cik_to_tk:  dict = {}   # str(CIK senza zeri) → ticker
            _sec_nm_to_tk: dict = {} # _norm(nome SEC) → ticker (complementa financial_df)
            try:
                _cik_to_tk, _sec_nm_to_tk = _load_sec_cik_map()
                # Fondi i due dizionari nome→ticker: financial_df ha priorità
                # perché è già filtrato sul nostro universo biotech
                _merged_name_to_tk = {**_sec_nm_to_tk, **_name_to_tk}
            except Exception as _cike:
                print(f"[PastCatalyst] Mapping CIK SEC non disponibile: {_cike}")
                _merged_name_to_tk = _name_to_tk
                _cik_to_tk = {}

            # Colonne CIK nel clinical_df (vari nomi possibili)
            _CIK_C = ["cik", "CIK", "cik_str", "entity_cik", "filer_cik"]

            _extra_past_rows: list = []
            _skip_no_tk   = 0   # righe escluse per ticker mancante (tutti e 3 i livelli)
            _skip_no_cd   = 0   # righe escluse per data mancante
            _skip_spon    = 0   # righe escluse per sponsor non Exact/Partial
            _skip_dup     = 0   # righe già in _sim_rows_past
            _resolved_fb  = 0   # ticker risolti via nome azienda (financial_df o SEC nome)
            _resolved_cik = 0   # ticker risolti via CIK SEC

            if _clin_src is not None and not _clin_src.empty:
                _dc   = next((c for c in _DATE_C if c in _clin_src.columns), None)
                _tcc  = next((c for c in _TICK_C if c in _clin_src.columns), None)
                _sc   = "sponsor_match" if "sponsor_match" in _clin_src.columns else None
                _qcc  = next((c for c in ["query_company", "lead_sponsor",
                                          "responsible_party_org"]
                              if c in _clin_src.columns), None)
                _cicc = next((c for c in _CIK_C if c in _clin_src.columns), None)
                if _dc:
                    _existing_keys = {
                        (str(_r.get("ticker","")).strip().upper(),
                         _cd2d(_r.get("completion_date")))
                        for _r in _sim_rows_past
                    }
                    _today_dt = _today_cls.today()
                    for _, _crow in _clin_src.iterrows():
                        # ── Livello 1: colonna ticker diretta ─────────────────
                        _ctk    = str(_crow.get(_tcc, "") if _tcc else "").strip().upper()
                        _via_fb = False   # True = risolto via nome o CIK (meno certo)

                        # ── Livello 2: CIK → ticker via SEC EDGAR ────────────
                        if not _ctk and _cicc and _cik_to_tk:
                            _raw_cik = str(_crow.get(_cicc, "") or "").strip().lstrip("0")
                            _ctk = _cik_to_tk.get(_raw_cik, "")
                            if _ctk:
                                _resolved_cik += 1
                                _via_fb = True

                        # ── Livello 3: nome azienda → ticker (financial_df + SEC) ──
                        if not _ctk and _qcc and _merged_name_to_tk:
                            _qcn = _norm(str(_crow.get(_qcc, "") or ""))
                            _ctk = _merged_name_to_tk.get(_qcn, "")
                            if _ctk:
                                _resolved_fb += 1
                                _via_fb = True

                        if not _ctk:
                            _skip_no_tk += 1; continue

                        _ccd = _cd2d(_crow.get(_dc))
                        if not _ccd:
                            _skip_no_cd += 1; continue
                        if _ccd >= _today_dt: continue        # solo passati

                        # Filtro sponsor:
                        # - ticker diretto (Lv1, _via_fb=False): NESSUN filtro sponsor.
                        #   Il ticker nella colonna è già la prova d'identità (fetch_biotech
                        #   ha interrogato ClinicalTrials.gov per quella società). Il
                        #   mancato match del lead_sponsor è solo un problema di forma legale
                        #   del nome (es. "ModernaTX, Inc." vs "Moderna").
                        # - ticker risolto via nome/CIK (Lv2/3, _via_fb=True): richiede
                        #   Exact perché l'identità è meno certa.
                        if _sc and _via_fb:
                            _sv = str(_crow.get(_sc, "")).strip()
                            if _sv != "Exact":
                                _skip_spon += 1; continue

                        if (_ctk, _ccd) in _existing_keys:
                            _skip_dup += 1; continue

                        _extra_past_rows.append({
                            "ticker":          _ctk,
                            "completion_date": _ccd,
                            "sponsor_match":   "Exact",
                        })
                        _existing_keys.add((_ctk, _ccd))

            print(f"\n[PastCatalyst] Estrazione da clinical_df:"
                  f"\n  Aggiunte:                    {len(_extra_past_rows)}"
                  f"\n  Risolte via CIK SEC:         {_resolved_cik}"
                  f"\n  Risolte via nome (fb/SEC):   {_resolved_fb}"
                  f"\n  Escluse (ticker mancante):   {_skip_no_tk}"
                  f"\n  Escluse (data mancante):     {_skip_no_cd}"
                  f"\n  Escluse (sponsor Lv2/3):     {_skip_spon}"
                  f"\n  Già in simulation (dup):     {_skip_dup}"
                  f"\n  Nota: Lv1 (ticker diretto) accetta tutti i sponsor_match")

            _all_past_rows = _sim_rows_past + _extra_past_rows
            print(f"[PastCatalyst] Totale righe past (simulation + clinical): "
                  f"{len(_sim_rows_past)} simulation + "
                  f"{len(_extra_past_rows)} clinical = "
                  f"{len(_all_past_rows)}")
            try:
                _past_pred_data = _compute_past_catalyst_data(_all_past_rows)
            except Exception as _pce:
                print(f"[PastCatalyst] Errore non bloccante: {_pce}")
                _past_pred_data = {}

            _past_row_positions = _write_full_sim_sheet(
                ws_past, _sim_rows_past, _ticker_studies_past,
                pnl_data=None, pred_data=_past_pred_data or None,
            )
            _apply_sim_coloring(ws_past, _sim_rows_past,
                                data_start_row=4,
                                main_row_positions=_past_row_positions)
            # La chiave in _past_pred_data è ora composita "TICK|YYYY-MM-DD"
            def _rk(r):
                tk  = str(r.get("ticker","")).strip().upper()
                cdr = r.get("completion_date")
                return f"{tk}|{cdr}" if cdr else tk
            _matched = sum(1 for r in _sim_rows_past if _rk(r) in _past_pred_data)
            print(f"[Sheet 5b] Catalyst Completati scritta — "
                  f"{_matched}/{len(_sim_rows_past)} ticker con direzioni modello da backtest.")

        else:
            print("\n[Sheet 5b] Nessuna riga past Exact → sheet 'Catalyst Completati' non creata.")


    # Usa clinical_df_rich (contiene sponsor_match + modality) se disponibile
    _clin_for_json = clinical_df_rich if not clinical_df_rich.empty else clinical_df
    final_payload = {
        "financial": master_df.to_dict(orient="records") if not master_df.empty else [],
        "clinical_openfda": _clin_for_json.to_dict(orient="records") if not _clin_for_json.empty else [],
    }

    with open(FINAL_JSON, "w", encoding="utf-8") as f:
        json.dump(final_payload, f, indent=2, ensure_ascii=False)

    print(f"Saved Excel: {FINAL_XLSX}")
    print(f"Saved JSON:  {FINAL_JSON}")


# ─────────────────────────────────────────────────────────────────────────────
# Riepilogo console
# ─────────────────────────────────────────────────────────────────────────────

def print_summary(master_df):
    if master_df.empty:
        print("\n[SUMMARY] Nessun dato nel master DataFrame.")
        return

    total = len(master_df)
    available_var_cols = [c for c in VARIATION_COLS if c in master_df.columns]
    error_cols = [c for c in master_df.columns if "error" in c.lower()]

    if error_cols:
        has_explicit_error = master_df[error_cols].apply(
            lambda col: col.astype(str).str.strip().replace({"nan": "", "None": ""}) != ""
        ).any(axis=1)
    else:
        has_explicit_error = pd.Series([False] * total, index=master_df.index)

    if available_var_cols:
        has_variation = master_df[available_var_cols].notna().any(axis=1)
    else:
        has_variation = pd.Series([False] * total, index=master_df.index)

    ok           = int(has_variation.sum())
    explicit_err = int(has_explicit_error.sum())
    missing_data = int((~has_variation & ~has_explicit_error).sum())

    print("\n" + "=" * 50)
    print("RIEPILOGO ORCHESTRAZIONE")
    print("=" * 50)
    print(f"  Simboli totali elaborati   : {total}")
    print(f"  Variazioni calcolate OK    : {ok}")
    print(f"  Errori di fetch (espliciti): {explicit_err}")
    print(f"  Dati mancanti (no errore)  : {missing_data}")

    if explicit_err > 0:
        err_syms = master_df[has_explicit_error]["symbol"].tolist()
        print(f"\n  Simboli con errore esplicito:")
        for sym in err_syms:
            print(f"    - {sym}")

    if missing_data > 0:
        miss_syms = master_df[~has_variation & ~has_explicit_error]["symbol"].tolist()
        print(f"\n  Simboli con dati mancanti:")
        for sym in miss_syms:
            print(f"    - {sym}")

    print("=" * 50 + "\n")


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

_BIOTECH_SYMBOLS_JSON    = os.path.join(DATA_DIR, "biotech_symbols.json")
_DISCOVERY_MARKER_FILE   = os.path.join(DATA_DIR, ".last_biotech_discovery")

# Parole chiave sufficientemente specifiche da identificare biotech/biopharma
# ma non così generiche da includere ospedali, distributori, etc.
_BIOTECH_DISCOVERY_KEYWORDS: frozenset[str] = frozenset({
    "therapeutics", "biosciences", "biopharma", "biotechnology",
    "biotherapeutics", "genomics", "oncology", "biologics",
    "biopharmaceutical", "biopharmaceuticals", "gene therapy",
    "cell therapy", "immunotherapeutics", "biotech",
    "radiotherapeutics", "radiopharmaceuticals",
})

# Caratteri non ammessi nei ticker US standard (evita preferred-share, warrants…)
import re as _re_ticker
_TICKER_RE = _re_ticker.compile(r'^[A-Z]{1,5}$')


def _auto_discover_biotech_tickers(force: bool = False) -> int:
    """
    Scopre nuovi ticker biotech leggendo il SEC EDGAR company_tickers.json
    (già in cache locale) e filtrando per parole chiave nel nome azienda.

    Eseguita automaticamente SOLO una volta al mese (primo giorno del mese,
    oppure se il marker non esiste o è di un mese precedente).
    Con force=True viene rieseguita a prescindere dalla data.

    Ritorna il numero di nuovi ticker effettivamente aggiunti.
    """
    import datetime

    today = datetime.date.today()

    # ── Controlla se è il momento di eseguire ─────────────────────────────────
    if not force:
        if os.path.exists(_DISCOVERY_MARKER_FILE):
            try:
                with open(_DISCOVERY_MARKER_FILE, encoding="utf-8") as fh:
                    last = fh.read().strip()          # formato "YYYY-MM"
                if last == today.strftime("%Y-%m"):
                    # già eseguita questo mese
                    return 0
            except Exception:
                pass
        # Esegue solo il primo giorno del mese OPPURE se marker mancante/vecchio
        if today.day != 1 and not os.path.exists(_DISCOVERY_MARKER_FILE):
            # Prima esecuzione assoluta: esegui subito per popolare il file
            pass
        elif today.day != 1:
            return 0

    print("[DISCOVERY] Avvio auto-discovery nuove biotech da SEC EDGAR…")

    # ── Carica il JSON SEC già in cache ───────────────────────────────────────
    sec_cache = os.path.join(DATA_DIR, "sec_company_tickers.json")
    if not os.path.exists(sec_cache):
        # Scarica ora tramite _load_sec_cik_map (effetto collaterale: crea il file)
        _load_sec_cik_map()
    if not os.path.exists(sec_cache):
        print("[DISCOVERY] sec_company_tickers.json non disponibile — skip.")
        return 0

    try:
        with open(sec_cache, encoding="utf-8") as fh:
            sec_data = json.load(fh)
    except Exception as exc:
        print(f"[DISCOVERY] Errore lettura sec_company_tickers.json: {exc} — skip.")
        return 0

    # ── Filtra per parole chiave nel nome azienda ─────────────────────────────
    candidates: list[str] = []
    for entry in sec_data.values():
        tk  = str(entry.get("ticker", "") or "").strip().upper()
        nm  = str(entry.get("title",  "") or "").strip().lower()
        if not tk or not nm:
            continue
        if not _TICKER_RE.match(tk):          # scarta preferred shares, warrant, etc.
            continue
        if any(kw in nm for kw in _BIOTECH_DISCOVERY_KEYWORDS):
            candidates.append(tk)

    # ── Leggi lista esistente ─────────────────────────────────────────────────
    existing: list[str] = []
    if os.path.exists(_BIOTECH_SYMBOLS_JSON):
        try:
            with open(_BIOTECH_SYMBOLS_JSON, encoding="utf-8") as fh:
                existing = json.load(fh)
        except Exception:
            pass

    existing_set = {t.upper() for t in existing}
    nuovi = sorted({t for t in candidates if t not in existing_set})

    if nuovi:
        updated = sorted(existing_set | set(nuovi))
        with open(_BIOTECH_SYMBOLS_JSON, "w", encoding="utf-8") as fh:
            json.dump(updated, fh, indent=2, ensure_ascii=False)
        preview = ", ".join(nuovi[:25]) + (f"… (+{len(nuovi)-25})" if len(nuovi) > 25 else "")
        print(f"[DISCOVERY] Aggiunti {len(nuovi)} nuovi ticker biotech: {preview}")
        print(f"[DISCOVERY] Totale ticker in biotech_symbols.json: {len(updated)}")
    else:
        print("[DISCOVERY] Nessun nuovo ticker biotech trovato.")

    # ── Aggiorna marker con anno-mese corrente ────────────────────────────────
    try:
        with open(_DISCOVERY_MARKER_FILE, "w", encoding="utf-8") as fh:
            fh.write(today.strftime("%Y-%m"))
    except Exception:
        pass

    return len(nuovi)


def _sync_extra_tickers() -> int:
    """
    Legge la chiave 'extra_tickers' da retrospective_config.json e aggiunge
    i nuovi ticker a biotech_symbols.json (crea il file se non esiste).

    Ritorna il numero di ticker effettivamente aggiunti (0 = nessuna novità).
    Mostra sempre il totale attuale del file al termine.
    """
    # ── Leggi extra_tickers dalla config ──────────────────────────────────────
    extra: list[str] = []
    try:
        with open(RETRO_CONFIG_FILE, encoding="utf-8") as fh:
            cfg = json.load(fh)
        extra = [t.strip().upper() for t in cfg.get("extra_tickers", []) if t.strip()]
    except Exception as exc:
        print(f"[WARN] _sync_extra_tickers: impossibile leggere {RETRO_CONFIG_FILE}: {exc}")
        return 0

    if not extra:
        return 0

    # ── Leggi biotech_symbols.json (lista di ticker esistenti) ────────────────
    existing: list[str] = []
    if os.path.exists(_BIOTECH_SYMBOLS_JSON):
        try:
            with open(_BIOTECH_SYMBOLS_JSON, encoding="utf-8") as fh:
                existing = json.load(fh)
        except Exception as exc:
            print(f"[WARN] _sync_extra_tickers: impossibile leggere {_BIOTECH_SYMBOLS_JSON}: {exc}")

    existing_set = {t.strip().upper() for t in existing}

    # ── Trova i ticker davvero nuovi ──────────────────────────────────────────
    nuovi = [t for t in extra if t not in existing_set]

    if nuovi:
        updated = list(existing) + nuovi
        with open(_BIOTECH_SYMBOLS_JSON, "w", encoding="utf-8") as fh:
            json.dump(sorted(set(t.upper() for t in updated)), fh,
                      indent=2, ensure_ascii=False)
        print(f"[SYNC] Aggiunti {len(nuovi)} nuovi ticker a biotech_symbols.json: "
              f"{', '.join(nuovi)}")
        print(f"[SYNC] Totale ticker nel file: "
              f"{len(existing) + len(nuovi)}")
    else:
        print(f"[SYNC] Nessun nuovo ticker da aggiungere "
              f"(extra_tickers già presenti in biotech_symbols.json).")

    return len(nuovi)


def main():
    os.makedirs(DATA_DIR, exist_ok=True)

    # ── Step 0a: auto-discovery mensile nuove biotech da SEC EDGAR ────────────
    print(">>> Auto-discovery biotech (mensile)…")
    _n_disc = _auto_discover_biotech_tickers()
    if _n_disc:
        print(f"    {_n_disc} nuove società biotech aggiunte dall'universo SEC EDGAR.")
    else:
        print("    Nessun nuovo ticker da SEC EDGAR (già aggiornato questo mese).")

    # ── Step 0b: espande biotech_symbols.json con eventuali extra_tickers ─────
    print(">>> Sincronizzazione extra_tickers da retrospective_config.json…")
    _n_new = _sync_extra_tickers()
    if _n_new:
        print(f"    {_n_new} nuovi ticker manuali aggiunti → i fetcher li scaricheranno ora.")

    run_script("fetch_yfinance.py")
    run_script("fetch_finnhub.py")
    run_script("fetch_variations.py")
    run_script("BiotechClinicalTrialDataFetcher.py")

    master_df, clinical_df = merge_by_symbol()
    save_final_outputs(master_df, clinical_df)
    print_summary(master_df)

    # ── Analisi retrospettiva (storia IPO + impatto completion date) ──────────
    # Viene lanciata DOPO save_final_outputs perché legge il JSON già scritto.
    print(f"\n>>> Avvio analisi retrospettiva (finestra ±{RETRO_WINDOW_DAYS}gg)…")
    run_script("fetch_retrospective.py",
               extra_args=["--window", str(RETRO_WINDOW_DAYS)])

    print("\n>>> Orchestration completed successfully <<<")


if __name__ == "__main__":
    main()
