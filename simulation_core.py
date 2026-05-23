"""
simulation_core.py
------------------
Logica condivisa per la simulazione investimento.
Importabile da data_orchestrator.py (senza streamlit) e da simulation_app.py.

Funzioni esportate:
  - build_rows_from_df(financial_df, catalyst_dates)  → lista di dict pronta per lo sheet
  - write_simulation_sheet(ws, rows)                 → scrive su un worksheet openpyxl esistente
  - SIM_ROW_KEYS, COLS, sim_screener_excel_col        → layout Simulation (41 col. screener)
  - SIM_SHEET_BANNER_FONT, SIM_SHEET_BODY_*_FONT      → export Excel: bold solo intestazioni colonna
"""

from __future__ import annotations

from datetime import date, datetime

import pandas as pd
from openpyxl.styles import PatternFill, Font, Alignment
from openpyxl.utils import get_column_letter

from variation_colors import signed_pct_fill_font

# ── Stili ─────────────────────────────────────────────────────────────────────
HEADER_FILL   = PatternFill("solid", fgColor="4472C4")
HEADER_FONT   = Font(bold=True, color="FFFFFF")
INPUT_FILL    = PatternFill("solid", fgColor="FFF2CC")
INPUT_FONT    = Font(bold=True, color="7F6000", size=11)
FORMULA_FILL  = PatternFill("solid", fgColor="EBF3FB")
FORMULA_FONT  = Font(italic=True, color="1F4E79", size=10)
SUMMARY_FILL  = PatternFill("solid", fgColor="BDD7EE")
SUMMARY_FONT  = Font(bold=True, color="1F3864")
TITLE_FILL    = PatternFill("solid", fgColor="7030A0")
TITLE_FONT    = Font(bold=True, color="FFFFFF", size=13)
LEGEND_FILL   = PatternFill("solid", fgColor="F3EEFF")
LEGEND_FONT   = Font(italic=True, color="4B0082", size=9)
CATALYST_FILL = PatternFill("solid", fgColor="FFE0B2")
CATALYST_FONT = Font(bold=True, color="BF5000", size=10)
# Export Simulation: grassetto solo riga intestazioni (es. riga 3); corpo senza bold.
SIM_SHEET_BANNER_FONT = Font(bold=False, color="FFFFFF", size=13)
SIM_SHEET_BODY_INPUT_FONT = Font(bold=False, color="7F6000", size=11)
SIM_SHEET_BODY_CATALYST_FONT = Font(bold=False, color="BF5000", size=10)
SIM_SHEET_BODY_SUMMARY_FONT = Font(bold=False, color="1F3864")
ALIGN_C       = Alignment(horizontal="center", vertical="center")
ALIGN_R       = Alignment(horizontal="right",  vertical="center")
ALIGN_L       = Alignment(horizontal="left",   vertical="center")

# ── Lookup colonne da financial_df ────────────────────────────────────────────
PRICE_COLS  = ["currentPrice", "last_close"]
CHG_COLS    = ["dailyChange_%"]
NAME_COLS   = ["longName", "shortName", "name", "companyName"]
SYM_COLS    = ["symbol", "ticker"]
BETA_COLS       = ["beta"]
MARKETCAP_COLS  = ["marketCap", "market_cap"]
VAR1M_COLS  = ["variation_1m_%_variations", "variation_1m_%"]
VAR3M_COLS  = ["variation_3m_%_variations", "variation_3m_%"]
VAR6M_COLS  = ["variation_6m_%_variations", "variation_6m_%"]
VAR9M_COLS  = ["variation_9m_%_variations", "variation_9m_%"]
HIGH52_COLS = ["highPrice", "fiftyTwoWeekHigh", "fifty_two_week_high"]
LOW52_COLS  = ["lowPrice", "fiftyTwoWeekLow", "fifty_two_week_low"]
VOLUME_COLS = ["volume", "regularMarketVolume"]
VOL_AVG_COLS = ["averageVolume", "averageDailyVolume3Month", "avg_volume_3m"]
TARGET_COLS = ["targetMean", "targetMedian", "targetPrice"]
SECTOR_COLS = ["sector"]
INDUSTRY_COLS = ["industry"]
ISIN_COLS   = ["isin"]
EXCH_COLS   = ["exchange", "fullExchangeName", "exchangeName"]
SUMMARY_COLS = ["longBusinessSummary"]
WEB_COLS    = ["website"]
MARKET_ST_COLS = ["marketState", "regularMarketState", "exchangeTimezoneName"]

FMT_MCAP = '#,##0.0,,,"B"'
FMT_VARIATION = '+0.00"%";-0.00"%";0.00"%"'

# ── Chiavi interne (ordine = ordine colonne foglio, senza colonna Phase) ─────
SIM_ROW_KEYS: list[str] = [
    "ticker",
    "name",
    "description_date",
    "trend_period",
    "sector",
    "industry",
    "isin",
    "exchange",
    "business_summary",
    "link_url",
    "market_status",
    "market_cap",
    "curr_price",
    "var_1d",
    "var_5d",
    "var_1m",
    "var_3m",
    "var_1y",
    "price_target_1y",
    "var_index_1d",
    "var_index_1m",
    "port_1d",
    "port_1m",
    "port_3m",
    "port_6m",
    "port_1y",
    "vol_1y",
    "beta",
    "sharpe_1y",
    "sortino_1y",
    "max_dd_1y",
    "var_95",
    "var_99",
    "tracking_error",
    "info_ratio",
    "alpha_1y",
    "treynor",
    "volume",
    "volume_avg_3m",
    "pct_vs_52w_high",
    "pct_vs_52w_low",
]

# Intestazioni visibili (allineate alla lista richiesta)
COLS: list[str] = [
    "Ticker",
    "Name",
    "Description\nDate",
    "Trend Period\n(short/med)",
    "Sector",
    "Industry\n(Sub-sector)",
    "ISIN",
    "Primary\nExchange",
    "Business\nSummary",
    "Link\n(URL)",
    "Market\nStatus",
    "Market Cap",
    "Price",
    "Var. 1D\n(%)",
    "Var. 5D\n(%)",
    "Var. 1M\n(%)",
    "Var. 3M\n(%)",
    "Var. 1Y\n(%)",
    "Price Target\n1Y",
    "Var. Index\nvs 1D",
    "Var. Index\nvs 1M",
    "Portfolio\n1D",
    "Portfolio\n1M",
    "Portfolio\n3M",
    "Portfolio\n6M",
    "Portfolio\n1Y",
    "Volatility\n(1Y)",
    "Beta\n(1Y)",
    "Sharpe Ratio\n(1Y)",
    "Sortino Ratio\n(1Y)",
    "Max Drawdown\n(1Y)",
    "VaR\n(95%)",
    "VaR\n(99%)",
    "Tracking\nError",
    "Information\nRatio",
    "Alpha\n(1Y)",
    "Treynor\nRatio",
    "Volume",
    "Volume\n(Avg 3M)",
    "% vs\n52W High",
    "% vs\n52W Low",
]

# Larghezze (41)
WIDTHS: list[float] = [
    10, 28, 12, 14, 14, 18, 12, 12, 36, 14,
    10, 12, 11, 10, 10, 10, 10, 10, 11, 11,
    11, 11, 11, 11, 11, 11, 10, 9, 10, 10,
    11, 9, 9, 11, 11, 10, 10, 12, 12, 10,
    10,
]

# Colonne investimento coda (solo write_simulation_sheet standalone / export Streamlit)
INV_COLS: list[str] = [
    "Prezzo\nAcquisto ($)",
    "Capitale\nInvestito ($)",
    "N° Azioni\nImplicite",
    "Valore\nAttuale ($)",
    "P&L ($)",
    "P&L (%)",
]
INV_WIDTHS: list[float] = [14, 16, 14, 16, 14, 10]

N_SCREENER = len(COLS)
assert len(SIM_ROW_KEYS) == N_SCREENER == len(WIDTHS)

# Con riga «Studio Phase» in colonna D nel foglio orchestrator: colonne dati saltano la 4ª
SIM_PHASE_COL = 4
N_BASE_WITH_PHASE = N_SCREENER + 1  # 3 + Phase + (41−3) = 42


def sim_screener_excel_col(key: str, *, with_phase_column: bool = True) -> int:
    """
    Indice colonna Excel 1-based per la chiave `key` in SIM_ROW_KEYS.
    Se with_phase_column, dopo le prime 3 colonne (A–C) la colonna 4 è Phase:
    le chiavi da index ≥ 3 occupano le colonne da 5 in poi.
    """
    i = SIM_ROW_KEYS.index(key)
    if not with_phase_column:
        return i + 1
    if i < 3:
        return i + 1
    return i + 2  # salta Phase a colonna 4


def sim_col_letter(key: str, *, with_phase_column: bool = True) -> str:
    return get_column_letter(sim_screener_excel_col(key, with_phase_column=with_phase_column))


def _pick(candidates, df):
    return next((c for c in candidates if c in df.columns), None)


def _flt(val):
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def merge_sim_row_liquidity_fields(row_dict: dict, fin_row) -> dict:
    """
    Copia liquidità FY e beta da una riga ``financial_df`` nel dict riga Simulation.
    Non sovrascrive ``beta`` già valorizzato se il merge non ne fornisce uno.
    """
    if fin_row is None:
        return row_dict
    from prediction.financial_liquidity import (
        format_liquidity_display,
        financial_row_liquidity_keys,
    )

    for k, v in financial_row_liquidity_keys(fin_row).items():
        if v is None:
            continue
        if k == "beta" and row_dict.get("beta") is not None:
            continue
        row_dict[k] = v
    if not row_dict.get("liquidita_fy"):
        disp = format_liquidity_display(row=fin_row)
        if disp:
            row_dict["liquidita_fy"] = disp
    return row_dict


def _str_clean(val) -> str | None:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    s = str(val).strip()
    return s if s else None


def _beta_fill(value):
    """PatternFill per beta — soglie come in data_orchestrator."""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    if v > 2:
        return PatternFill("solid", fgColor="FFC7CE")
    if v > 1.5:
        return PatternFill("solid", fgColor="FFEB9C")
    if v > 1:
        return PatternFill("solid", fgColor="FFFD75")
    return PatternFill("solid", fgColor="C6EFCE")


def _fmt_date(val) -> str | None:
    if val is None:
        return None
    if isinstance(val, (date, datetime)):
        return val.strftime("%d/%m/%Y")
    try:
        return pd.to_datetime(val).strftime("%d/%m/%Y")
    except Exception:
        return str(val) if val else None


def _pct_vs_ref(price: float | None, ref: float | None) -> float | None:
    if price is None or ref is None or ref == 0:
        return None
    try:
        return (float(price) / float(ref) - 1.0) * 100.0
    except (TypeError, ValueError):
        return None


def build_rows_from_df(
    financial_df: pd.DataFrame,
    catalyst_dates: dict | None = None,
) -> list[dict]:
    """
    Estrae da financial_df una lista di dict con i campi dello screener Simulation.
    catalyst_dates: dict ticker→completion_date → campo description_date.
    """
    if financial_df.empty:
        return []

    catalyst_dates = catalyst_dates or {}

    sym_col    = _pick(SYM_COLS,    financial_df)
    name_col   = _pick(NAME_COLS,   financial_df)
    price_col  = _pick(PRICE_COLS,  financial_df)
    chg_col    = _pick(CHG_COLS,    financial_df)
    beta_col   = _pick(BETA_COLS,      financial_df)
    mcap_col   = _pick(MARKETCAP_COLS, financial_df)
    var1m_col  = _pick(VAR1M_COLS,     financial_df)
    var3m_col  = _pick(VAR3M_COLS,     financial_df)
    var6m_col  = _pick(VAR6M_COLS,     financial_df)
    var9m_col  = _pick(VAR9M_COLS,     financial_df)
    high_col   = _pick(HIGH52_COLS, financial_df)
    low_col    = _pick(LOW52_COLS, financial_df)
    vol_col    = _pick(VOLUME_COLS, financial_df)
    volavg_col = _pick(VOL_AVG_COLS, financial_df)
    tgt_col    = _pick(TARGET_COLS, financial_df)
    sector_c   = _pick(SECTOR_COLS, financial_df)
    ind_c      = _pick(INDUSTRY_COLS, financial_df)
    isin_c     = _pick(ISIN_COLS, financial_df)
    exch_c     = _pick(EXCH_COLS, financial_df)
    summ_c     = _pick(SUMMARY_COLS, financial_df)
    web_c      = _pick(WEB_COLS, financial_df)
    mkst_c     = _pick(MARKET_ST_COLS, financial_df)

    if sym_col is None or price_col is None:
        return []

    rows: list[dict] = []
    for _, row in financial_df.iterrows():
        sym = str(row[sym_col]).strip().upper()
        cat_date = catalyst_dates.get(sym)
        curr = _flt(row[price_col])
        hi = _flt(row[high_col]) if high_col else None
        lo = _flt(row[low_col]) if low_col else None

        desc_date = _fmt_date(cat_date)
        _chg_v = _flt(row[chg_col]) if chg_col else None
        if _chg_v is None:
            trend = "Neutral"
        elif _chg_v > 0:
            trend = "Bullish"
        elif _chg_v < 0:
            trend = "Bearish"
        else:
            trend = "Neutral"

        row_dict: dict = {
            "ticker": sym,
            "name": _str_clean(row[name_col]) if name_col else "",
            "description_date": desc_date,
            "completion_date": desc_date,
            "trend_period": trend,
            "sector": _str_clean(row[sector_c]) if sector_c else None,
            "industry": _str_clean(row[ind_c]) if ind_c else None,
            "isin": _str_clean(row[isin_c]) if isin_c else None,
            "exchange": _str_clean(row[exch_c]) if exch_c else None,
            "business_summary": _str_clean(row[summ_c]) if summ_c else None,
            "link_url": _str_clean(row[web_c]) if web_c else None,
            "market_status": _str_clean(row[mkst_c]) if mkst_c else None,
            "market_cap": _flt(row[mcap_col]) if mcap_col else None,
            "curr_price": curr,
            "var_1d": _flt(row[chg_col]) if chg_col else None,
            "var_5d": None,
            "var_1m": _flt(row[var1m_col]) if var1m_col else None,
            "var_3m": _flt(row[var3m_col]) if var3m_col else None,
            "var_6m": _flt(row[var6m_col]) if var6m_col else None,
            "var_1y": _flt(row[var9m_col]) if var9m_col else None,
            "price_target_1y": _flt(row[tgt_col]) if tgt_col else None,
            "var_index_1d": None,
            "var_index_1m": None,
            "port_1d": None,
            "port_1m": None,
            "port_3m": None,
            "port_6m": None,
            "port_1y": None,
            "vol_1y": None,
            "beta": _flt(row[beta_col]) if beta_col else None,
            "sharpe_1y": None,
            "sortino_1y": None,
            "max_dd_1y": None,
            "var_95": None,
            "var_99": None,
            "tracking_error": None,
            "info_ratio": None,
            "alpha_1y": None,
            "treynor": None,
            "volume": _flt(row[vol_col]) if vol_col else None,
            "volume_avg_3m": _flt(row[volavg_col]) if volavg_col else None,
            "pct_vs_52w_high": _pct_vs_ref(curr, hi),
            "pct_vs_52w_low": _pct_vs_ref(curr, lo),
            "buy_price": None,
            "capital": None,
            "phase": "",
        }
        merge_sim_row_liquidity_fields(row_dict, row)

        rows.append(row_dict)

    def _sort_key(r):
        d = r["description_date"]
        if d:
            try:
                return (0, datetime.strptime(d, "%d/%m/%Y"), r["ticker"])
            except Exception:
                return (0, datetime.max, r["ticker"])
        return (1, datetime.max, r["ticker"])

    rows.sort(key=_sort_key)
    return rows


# Chiavi che usano formato variazione % (stesso dei fogli Financial/Catalyst)
_VAR_PCT_KEYS = frozenset({
    "var_1d", "var_5d", "var_1m", "var_3m", "var_6m", "var_1y",
    "var_index_1d", "var_index_1m",
    "port_1d", "port_1m", "port_3m", "port_6m", "port_1y",
    "pct_vs_52w_high", "pct_vs_52w_low",
})

_RATIO_KEYS = frozenset({
    "sharpe_1y", "sortino_1y", "info_ratio", "treynor", "alpha_1y",
    "tracking_error", "var_95", "var_99", "max_dd_1y", "vol_1y",
})


def write_screener_data_cell(
    ws, rn: int, col: int, key: str, val,
    *, align=ALIGN_R,
):
    """Scrive una cella dello screener (formato in base alla chiave)."""
    cell = ws.cell(row=rn, column=col)
    cell.alignment = align
    if val is None or val == "":
        cell.value = "N/D"
        cell.font = Font(color="999999", size=9)
        return
    if key == "business_summary":
        cell.value = str(val)[:500]
        cell.font = Font(size=9)
        cell.alignment = ALIGN_L
        return
    if key == "link_url" and isinstance(val, str) and val.startswith("http"):
        cell.value = "Link ↗"
        cell.hyperlink = val
        cell.font = Font(color="0563C1", size=10, underline="single")
        cell.alignment = ALIGN_C
        return
    if key == "beta":
        bf = _beta_fill(val)
        cell.value = val
        cell.number_format = "#,##0.00"
        cell.fill = bf or FORMULA_FILL
        cell.font = Font(bold=False, size=10)
        cell.alignment = ALIGN_C
        return
    if key == "market_cap":
        cell.value = val
        cell.number_format = FMT_MCAP
        cell.fill = FORMULA_FILL
        cell.font = FORMULA_FONT
        return
    if key == "curr_price":
        cell.value = val
        cell.number_format = '"$"#,##0.00'
        cell.fill = FORMULA_FILL
        cell.font = FORMULA_FONT
        return
    if key == "price_target_1y":
        cell.value = val
        cell.number_format = '"$"#,##0.00'
        cell.fill = FORMULA_FILL
        cell.font = FORMULA_FONT
        return
    if key in _VAR_PCT_KEYS:
        cell.value = val
        cell.number_format = FMT_VARIATION
        cell.fill = FORMULA_FILL
        cell.font = FORMULA_FONT
        cell.alignment = ALIGN_C
        return
    if key in _RATIO_KEYS:
        cell.value = val
        cell.number_format = "#,##0.00"
        cell.fill = FORMULA_FILL
        cell.font = FORMULA_FONT
        return
    if key in ("volume", "volume_avg_3m"):
        cell.value = val
        cell.number_format = "#,##0"
        cell.fill = FORMULA_FILL
        cell.font = FORMULA_FONT
        return
    if isinstance(val, (int, float)):
        cell.value = val
        cell.number_format = "#,##0.00"
        cell.fill = FORMULA_FILL
        cell.font = FORMULA_FONT
        return
    cell.value = str(val)
    cell.font = Font(size=10)
    cell.alignment = ALIGN_L


def write_simulation_sheet(ws, rows: list[dict]) -> None:
    """
    Scrive il foglio Simulation standalone: 41 colonne screener + 6 colonne investimento.
    """
    n_scr = N_SCREENER
    n_inv = len(INV_COLS)
    ncols = n_scr + n_inv

    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=ncols)
    tc = ws.cell(row=1, column=1,
                 value=f"Simulation Sheet — {date.today().strftime('%d/%m/%Y')}")
    tc.fill = TITLE_FILL
    tc.font = SIM_SHEET_BANNER_FONT
    tc.alignment = ALIGN_C
    ws.row_dimensions[1].height = 30

    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=ncols)
    lc = ws.cell(row=2, column=1,
                 value="🔔 Arancione = catalyst (description date).  "
                       "Celle gialle = input.  Celle azzurre = calcolate.  "
                       "Variazioni %: blu = negativo, ambra = positivo (intensità ∝ |Δ|).  "
                       "N/D = dato non presente nel merge corrente.")
    lc.fill = LEGEND_FILL
    lc.font = LEGEND_FONT
    lc.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
    ws.row_dimensions[2].height = 20

    all_hdrs = COLS + INV_COLS
    all_widths = WIDTHS + INV_WIDTHS
    for ci, (hdr, w) in enumerate(zip(all_hdrs, all_widths), start=1):
        c = ws.cell(row=3, column=ci, value=hdr)
        c.fill = HEADER_FILL
        c.font = HEADER_FONT
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        ws.column_dimensions[get_column_letter(ci)].width = w
    ws.row_dimensions[3].height = 36
    ws.freeze_panes = "A4"

    _c_buy = get_column_letter(n_scr + 1)
    _c_cap = get_column_letter(n_scr + 2)
    _c_sh = get_column_letter(n_scr + 3)
    _c_val = get_column_letter(n_scr + 4)
    _c_curr = get_column_letter(sim_screener_excel_col("curr_price", with_phase_column=False))

    data_row = 4
    for r in rows:
        rn = data_row
        cat_date = r.get("description_date")
        is_catalyst = bool(cat_date)
        buy = r.get("buy_price")
        cap = r.get("capital")

        for ki, key in enumerate(SIM_ROW_KEYS):
            col = ki + 1
            val = r.get(key)
            if key == "ticker":
                tf = CATALYST_FILL if is_catalyst else PatternFill("solid", fgColor="EBF3FB")
                tfont = (Font(bold=False, color="BF5000", size=11) if is_catalyst
                         else Font(bold=False, color="1F3864", size=11))
                c = ws.cell(row=rn, column=col, value=val)
                c.fill = tf
                c.font = tfont
                c.alignment = ALIGN_C
            elif key == "description_date":
                if is_catalyst:
                    c = ws.cell(row=rn, column=col, value=val)
                    c.fill = CATALYST_FILL
                    c.font = SIM_SHEET_BODY_CATALYST_FONT
                    c.alignment = ALIGN_C
                else:
                    c = ws.cell(row=rn, column=col, value="—")
                    c.fill = PatternFill("solid", fgColor="F5F5F5")
                    c.font = Font(color="AAAAAA", size=9)
                    c.alignment = ALIGN_C
            else:
                write_screener_data_cell(ws, rn, col, key, val)

        inv_c0 = n_scr + 1
        def _inv(col_off, val, fmt, fill, font):
            c = ws.cell(row=rn, column=inv_c0 + col_off, value=val)
            if fmt:
                c.number_format = fmt
            c.fill = fill
            c.font = font
            c.alignment = ALIGN_R
            return c

        _inv(0, buy, "#,##0.00 $", INPUT_FILL, SIM_SHEET_BODY_INPUT_FONT)
        _inv(1, cap, "#,##0.00 $", INPUT_FILL, SIM_SHEET_BODY_INPUT_FONT)
        _inv(2, f'=IF(AND(ISNUMBER({_c_buy}{rn}),{_c_buy}{rn}<>0),{_c_cap}{rn}/{_c_buy}{rn},"")',
             "#,##0.00", FORMULA_FILL, FORMULA_FONT)
        _inv(3, f'=IF(AND(ISNUMBER({_c_sh}{rn}),ISNUMBER({_c_curr}{rn})),{_c_sh}{rn}*{_c_curr}{rn},"")',
             "#,##0.00 $", FORMULA_FILL, FORMULA_FONT)
        _inv(4, f'=IF(ISNUMBER({_c_val}{rn}),{_c_val}{rn}-{_c_cap}{rn},"")',
             '#,##0.00 $;[Red]-#,##0.00 $', FORMULA_FILL, FORMULA_FONT)
        _inv(5, f'=IF(AND(ISNUMBER({_c_buy}{rn}),{_c_buy}{rn}<>0),({_c_curr}{rn}-{_c_buy}{rn})/{_c_buy}{rn},"")',
             '0.00%;[Red]-0.00%', FORMULA_FILL, FORMULA_FONT)

        ws.row_dimensions[rn].height = 20
        data_row += 1

    if data_row > 4:
        first, last = 4, data_row - 1
        tr = data_row
        ws.row_dimensions[tr].height = 24
        merge_end = min(10, n_scr)
        ws.merge_cells(start_row=tr, start_column=1, end_row=tr, end_column=merge_end)
        tot = ws.cell(row=tr, column=1, value="TOTALE PORTAFOGLIO")
        tot.fill = SUMMARY_FILL
        tot.font = SIM_SHEET_BODY_SUMMARY_FONT
        tot.alignment = ALIGN_L
        cap_i = n_scr + 2
        val_i = n_scr + 4
        pnl_i = n_scr + 5
        cl_cap = get_column_letter(cap_i)
        cl_val = get_column_letter(val_i)
        cl_pnl = get_column_letter(pnl_i)
        for ci, col_l, fmt in [
            (cap_i, cl_cap, "#,##0.00 $"),
            (val_i, cl_val, "#,##0.00 $"),
            (pnl_i, cl_pnl, '#,##0.00 $;[Red]-#,##0.00 $'),
        ]:
            c = ws.cell(row=tr, column=ci, value=f"=SUMIF({col_l}{first}:{col_l}{last},\">0\")")
            c.number_format = fmt
            c.fill = SUMMARY_FILL
            c.font = SIM_SHEET_BODY_SUMMARY_FONT
            c.alignment = ALIGN_R
        c = ws.cell(row=tr, column=n_scr + 6,
                    value=f'=IF({cl_cap}{tr}<>0,{cl_pnl}{tr}/{cl_cap}{tr},"")')
        c.number_format = '0.00%;[Red]-0.00%'
        c.fill = SUMMARY_FILL
        c.font = SIM_SHEET_BODY_SUMMARY_FONT
        c.alignment = ALIGN_R


def _write_var_cell(ws, row, col, value):
    """Compat: scrive cella variazione % (colore esterno via apply_linear_coloring)."""
    cell = ws.cell(row=row, column=col)
    cell.alignment = ALIGN_C
    if value is not None:
        cell.value = value
        cell.number_format = FMT_VARIATION
    else:
        cell.value = "N/D"
        cell.font = Font(color="999999", size=9)