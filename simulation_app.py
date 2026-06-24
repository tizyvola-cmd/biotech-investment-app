"""
simulation_app.py
-----------------
App Streamlit per simulazione investimento biotech.
Legge i dati dal JSON prodotto da data_orchestrator.py.
Tutta la logica Excel è in simulation_core.py (condivisa con data_orchestrator).

Avvio:  streamlit run simulation_app.py
"""

import io
import os
import json
from datetime import date, timedelta

import pandas as pd
import streamlit as st
from openpyxl import Workbook

from simulation_core import (
    build_rows_from_df,
    write_simulation_sheet,
    PRICE_COLS, CHG_COLS, NAME_COLS, SYM_COLS,
    BETA_COLS, MARKETCAP_COLS, VAR1M_COLS, VAR3M_COLS, VAR6M_COLS,
    _pick, _flt,
)

from orchestrator_io_paths import FINAL_JSON

CATALYST_WINDOW_DAYS = 30

DATE_CANDIDATES = [
    "primary_completion_date", "completion_date",
    "study_completion_date", "estimated_completion_date", "end_date",
]


# ── Caricamento dati ──────────────────────────────────────────────────────────

@st.cache_data(ttl=60)
def load_data() -> tuple[pd.DataFrame, pd.DataFrame]:
    """Restituisce (financial_df, clinical_df) dal JSON prodotto da data_orchestrator.py."""
    if not os.path.exists(FINAL_JSON):
        return pd.DataFrame(), pd.DataFrame()
    with open(FINAL_JSON, "r", encoding="utf-8") as f:
        payload = json.load(f)
    fin_records  = payload.get("financial", [])
    clin_records = payload.get("clinical_openfda", [])
    return (
        pd.DataFrame(fin_records)  if fin_records  else pd.DataFrame(),
        pd.DataFrame(clin_records) if clin_records else pd.DataFrame(),
    )


def get_catalyst_dates(clinical_df: pd.DataFrame) -> dict[str, str]:
    """
    Ritorna dict {ticker: 'DD/MM/YYYY'} con la prima completion date nei prossimi
    CATALYST_WINDOW_DAYS giorni per ogni azienda (stessa logica del sheet Catalysts_30d).
    """
    if clinical_df.empty:
        return {}

    date_col = next((c for c in DATE_CANDIDATES if c in clinical_df.columns), None)
    if date_col is None:
        return {}

    ticker_col = "ticker" if "ticker" in clinical_df.columns else (
                 "symbol" if "symbol" in clinical_df.columns else None)
    if ticker_col is None:
        return {}

    df = clinical_df.copy()
    df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
    today   = date.today()
    horizon = today + timedelta(days=CATALYST_WINDOW_DAYS)
    mask    = (df[date_col].dt.date >= today) & (df[date_col].dt.date <= horizon)
    cat_df  = df[mask].dropna(subset=[date_col]).sort_values(date_col)

    result: dict[str, str] = {}
    for _, row in cat_df.iterrows():
        sym = str(row[ticker_col]).strip().upper()
        if sym not in result:
            result[sym] = row[date_col].strftime("%d/%m/%Y")
    return result


# ── Export Excel (usa simulation_core) ───────────────────────────────────────

def build_excel_bytes(rows: list[dict]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Simulazione"
    ws.sheet_properties.tabColor = "7030A0"
    write_simulation_sheet(ws, rows)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.getvalue()


# ── UI ────────────────────────────────────────────────────────────────────────

st.set_page_config(
    page_title="Biotech Investment Simulator",
    page_icon="💊",
    layout="wide",
)

st.markdown("""
<style>
    .main { background: #f9f9fc; }
    .block-container { padding-top: 1.5rem; }
    h1 { color: #4472C4; }
    div[data-testid="metric-container"] {
        background: #EBF3FB;
        border: 1px solid #BDD7EE;
        border-radius: 8px;
        padding: 10px 16px;
    }
</style>
""", unsafe_allow_html=True)

st.title("💊 Biotech Investment Simulator")
st.caption("Seleziona le società, inserisci i tuoi dati e calcola P&L in tempo reale.")

# ── Carica dati ───────────────────────────────────────────────────────────────
df, clinical_df = load_data()

if df.empty:
    st.error(
        f"⚠️ File dati non trovato: `{FINAL_JSON}`\n\n"
        "Esegui prima `python data_orchestrator.py` per generare i dati."
    )
    st.stop()

# ── Ticker con catalyst nei prossimi 30 giorni (ticker → data) ───────────────
catalyst_dates = get_catalyst_dates(clinical_df)

sym_col    = _pick(SYM_COLS,    df)
name_col   = _pick(NAME_COLS,   df)
price_col  = _pick(PRICE_COLS,  df)
chg_col    = _pick(CHG_COLS,    df)
beta_col   = _pick(BETA_COLS,      df)
mcap_col   = _pick(MARKETCAP_COLS, df)
var1m_col  = _pick(VAR1M_COLS,     df)
var3m_col  = _pick(VAR3M_COLS,     df)
var6m_col  = _pick(VAR6M_COLS,     df)

companies = []
for _, row in df.iterrows():
    sym   = str(row[sym_col]).strip().upper() if sym_col else "N/D"
    name  = str(row[name_col]) if name_col and pd.notna(row.get(name_col)) else ""
    label = f"{sym}  —  {name}" if name else sym
    cat_date    = catalyst_dates.get(sym)       # stringa 'DD/MM/YYYY' o None
    is_catalyst = cat_date is not None
    companies.append({
        "sym":             sym,
        "name":            name,
        "label":           label,
        "is_catalyst":     is_catalyst,
        "completion_date": cat_date,
        "price":           _flt(row[price_col])  if price_col  else None,
        "chg":             _flt(row[chg_col])    if chg_col    else None,
        "beta":            _flt(row[beta_col])   if beta_col   else None,
        "market_cap":      _flt(row[mcap_col])   if mcap_col   else None,
        "var_1m":          _flt(row[var1m_col])  if var1m_col  else None,
        "var_3m":          _flt(row[var3m_col])  if var3m_col  else None,
        "var_6m":          _flt(row[var6m_col])  if var6m_col  else None,
    })

# Ordina: prima le catalyst per data, poi le altre alfabeticamente
companies.sort(key=lambda c: (
    0 if c["is_catalyst"] else 1,
    c["completion_date"] or "9999",
    c["sym"],
))
labels = [c["label"] for c in companies]

# Etichette pre-selezionate = società con catalyst nei prossimi 30 giorni
default_labels = [c["label"] for c in companies if c["is_catalyst"]]

# ── Pannello laterale ─────────────────────────────────────────────────────────
with st.sidebar:
    st.header("⚙️ Impostazioni")

    if catalyst_dates:
        st.success(
            f"🔔 **{len(catalyst_dates)} società** con catalyst nei prossimi "
            f"{CATALYST_WINDOW_DAYS} giorni — già selezionate."
        )
    else:
        st.info("Nessun catalyst nei prossimi 30 giorni trovato nei dati clinici.")

    st.markdown("**Seleziona le società da simulare**")
    selected_labels = st.multiselect(
        "Società", options=labels,
        default=default_labels,
        placeholder="Cerca per ticker o nome…",
    )
    st.divider()
    st.markdown(
        f"📂 Dati da:  \n`{FINAL_JSON}`\n\n"
        "Clicca **Aggiorna dati** per ricaricare dopo aver rieseguito `data_orchestrator.py`."
    )
    if st.button("🔄 Aggiorna dati", use_container_width=True):
        st.cache_data.clear()
        st.rerun()

# ── Area principale ───────────────────────────────────────────────────────────
if not selected_labels:
    st.info("👈 Seleziona almeno una società nel pannello a sinistra per iniziare.")
    st.stop()

selected = [c for c in companies if c["label"] in selected_labels]

# Banner catalyst se presenti tra le selezionate
catalyst_selected = [c for c in selected if c["is_catalyst"]]
if catalyst_selected:
    syms_str = "  ·  ".join(
        f"{c['sym']} ({c['completion_date']})" for c in catalyst_selected
    )
    st.info(
        f"🔔 **Catalyst entro {CATALYST_WINDOW_DAYS} giorni:** {syms_str}  "
        "— stesso insieme dello sheet Catalysts_30d"
    )

st.subheader(f"📋 Simulazione — {len(selected)} società selezionate")

simulation_rows = []
totale_capitale = 0.0
totale_valore   = 0.0

for comp in selected:
    # Badge visivo per le catalyst
    badge = "🔔 " if comp["is_catalyst"] else ""
    with st.expander(f"{badge}**{comp['sym']}**  {comp['name']}", expanded=True):
        col_info, col_input, col_result = st.columns([2, 2, 3])

        with col_info:
            st.markdown("**Dati di mercato**")
            if comp["is_catalyst"]:
                st.markdown(
                    f"🔔 **Completion date:** `{comp['completion_date']}`",
                )
            st.metric("Prezzo corrente",
                      f"$ {comp['price']:,.2f}" if comp["price"] else "N/D")
            if comp["chg"] is not None:
                ds = f"{comp['chg']:+.2f}%"
                st.metric("Var. giornaliera", ds, delta=ds, delta_color="normal")
            else:
                st.metric("Var. giornaliera", "N/D")

        with col_input:
            st.markdown("**Il tuo investimento**")
            buy_price = st.number_input(
                "Prezzo d'acquisto (€)",
                min_value=0.0, value=comp["price"] or 0.0,
                step=0.01, format="%.4f",
                key=f"buy_{comp['sym']}",
            )
            capital = st.number_input(
                "Capitale investito (€)",
                min_value=0.0, value=0.0,
                step=100.0, format="%.2f",
                key=f"cap_{comp['sym']}",
            )

        with col_result:
            st.markdown("**Risultati**")
            curr = comp["price"]
            if buy_price > 0 and capital > 0 and curr is not None:
                shares   = capital / buy_price
                curr_val = shares * curr
                pnl_eur  = curr_val - capital
                pnl_pct  = (curr - buy_price) / buy_price * 100
                totale_capitale += capital
                totale_valore   += curr_val

                r1, r2 = st.columns(2)
                r1.metric("N° azioni", f"{shares:,.2f}")
                r2.metric("Valore attuale", f"€ {curr_val:,.2f}")
                r3, r4 = st.columns(2)
                sign = "+" if pnl_eur >= 0 else ""
                r3.metric("P&L (€)", f"{sign}€ {pnl_eur:,.2f}",
                          delta=f"{sign}{pnl_eur:,.2f}",
                          delta_color="normal" if pnl_eur >= 0 else "inverse")
                r4.metric("P&L (%)", f"{sign}{pnl_pct:.2f}%",
                          delta=f"{sign}{pnl_pct:.2f}%",
                          delta_color="normal" if pnl_pct >= 0 else "inverse")
            else:
                st.info("Inserisci prezzo d'acquisto e capitale per calcolare.")

    simulation_rows.append({
        "ticker":          comp["sym"],
        "name":            comp["name"],
        "completion_date": comp.get("completion_date"),
        "curr_price":      comp["price"],
        "daily_chg":       comp["chg"],
        "beta":            comp.get("beta"),
        "market_cap":      comp.get("market_cap"),
        "var_1m":          comp.get("var_1m"),
        "var_3m":          comp.get("var_3m"),
        "var_6m":          comp.get("var_6m"),
        "buy_price":       buy_price if buy_price > 0 else None,
        "capital":         capital   if capital   > 0 else None,
    })

# ── Riepilogo portafoglio ─────────────────────────────────────────────────────
filled = [r for r in simulation_rows
          if r["buy_price"] and r["capital"] and r["curr_price"]]

if filled and totale_capitale > 0:
    st.divider()
    st.subheader("📊 Riepilogo portafoglio")
    tot_pnl = totale_valore - totale_capitale
    tot_pct = tot_pnl / totale_capitale * 100

    m1, m2, m3, m4 = st.columns(4)
    m1.metric("Capitale totale", f"€ {totale_capitale:,.2f}")
    m2.metric("Valore attuale", f"€ {totale_valore:,.2f}")
    sign = "+" if tot_pnl >= 0 else ""
    m3.metric("P&L (€)", f"{sign}€ {tot_pnl:,.2f}",
              delta=f"{sign}{tot_pnl:,.2f}",
              delta_color="normal" if tot_pnl >= 0 else "inverse")
    m4.metric("P&L (%)", f"{sign}{tot_pct:.2f}%",
              delta=f"{sign}{tot_pct:.2f}%",
              delta_color="normal" if tot_pct >= 0 else "inverse")

    summary_data = []
    for r in filled:
        shares   = r["capital"] / r["buy_price"]
        curr_val = shares * r["curr_price"]
        pnl_e    = curr_val - r["capital"]
        pnl_p    = (r["curr_price"] - r["buy_price"]) / r["buy_price"] * 100
        peso     = r["capital"] / totale_capitale * 100
        summary_data.append({
            "Ticker":           r["ticker"],
            "Società":          r["name"],
            "P. Acquisto €":    r["buy_price"],
            "P. Corrente €":    r["curr_price"],
            "Capitale €":       r["capital"],
            "Valore attuale €": round(curr_val, 2),
            "P&L €":            round(pnl_e, 2),
            "P&L %":            round(pnl_p, 2),
            "Peso %":           round(peso, 1),
        })

    sdf = pd.DataFrame(summary_data)
    st.dataframe(
        sdf.style
           .format({
               "P. Acquisto €":    "{:.4f}",
               "P. Corrente €":    "{:.2f}",
               "Capitale €":       "{:,.2f}",
               "Valore attuale €": "{:,.2f}",
               "P&L €":            "{:+,.2f}",
               "P&L %":            "{:+.2f}%",
               "Peso %":           "{:.1f}%",
           })
           .applymap(
               lambda v: ("color: #375623; font-weight:bold" if isinstance(v, (int, float)) and v > 0
                          else "color: #9C0006; font-weight:bold" if isinstance(v, (int, float)) and v < 0
                          else ""),
               subset=["P&L €", "P&L %"],
           ),
        use_container_width=True,
        hide_index=True,
    )

# ── Export Excel ──────────────────────────────────────────────────────────────
st.divider()
if simulation_rows:
    excel_bytes = build_excel_bytes(simulation_rows)
    st.download_button(
        label="📥 Scarica Excel con la simulazione",
        data=excel_bytes,
        file_name=f"simulazione_{date.today().strftime('%Y%m%d')}.xlsx",
        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        use_container_width=True,
        type="primary",
    )
