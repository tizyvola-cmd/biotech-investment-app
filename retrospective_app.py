"""
retrospective_app.py  v2
------------------------
Analisi retrospettiva comparativa — fino a 5 società contemporaneamente.
Avvio:  streamlit run retrospective_app.py
"""

import json
import math
import os
import sys
from datetime import date, timedelta

import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import streamlit as st
import yfinance as yf

from orchestrator_io_paths import FINAL_JSON

MAX_COMPANIES = 5

PALETTE = ["#4472C4", "#ED7D31", "#70AD47", "#FF4C4C", "#7030A0"]

_PHASE_COLORS = {
    "phase 1": "#74B9FF",
    "phase 2": "#FFA94D",
    "phase 3": "#51CF66",
    "phase 4": "#CC5DE8",
}
_PHASE_DEFAULT = "#ADB5BD"

_DATE_CANDIDATES  = [
    "primary_completion_date", "completion_date",
    "PrimaryCompletionDate", "CompletionDate",
    "estimated_completion_date", "end_date",
]
_TITLE_CANDIDATES = [
    "brief_title", "BriefTitle", "official_title",
    "OfficialTitle", "study_title", "title",
]
_PHASE_CANDIDATES = ["phase", "Phase", "study_phase"]

# ── Page config ────────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="Biotech Retrospective",
    page_icon="📈",
    layout="wide",
)
st.markdown("""
<style>
  .main { background: #f7f9fc; }
  .block-container { padding-top: 1.5rem; }
  h1, h2, h3 { color: #1F3864; }
  div[data-testid="metric-container"] {
    background: #EBF3FB;
    border-radius: 8px;
    padding: 6px 12px;
    border-left: 4px solid #4472C4;
  }
</style>
""", unsafe_allow_html=True)

# ── Session state ──────────────────────────────────────────────────────────────
if "companies" not in st.session_state:
    st.session_state.companies = []   # list of {symbol, name, color}

# ── Helpers ────────────────────────────────────────────────────────────────────
def _pct(new, old):
    if old and old != 0 and new is not None:
        return (new - old) / old * 100
    return None


def _fmt_pct(v, decimals=1):
    if v is None:
        return "N/D"
    return f"{'+'if v >= 0 else ''}{v:.{decimals}f}%"


def _phase_color(phase_str: str) -> str:
    key = str(phase_str).lower()
    for k, v in _PHASE_COLORS.items():
        if k in key:
            return v
    return _PHASE_DEFAULT


def _price_at(close: pd.Series, target_date, tol: int = 10):
    if target_date is None:
        return None
    ts = pd.Timestamp(target_date)
    w  = close.loc[
        (close.index >= ts - timedelta(days=tol)) &
        (close.index <= ts + timedelta(days=tol))
    ]
    if w.empty:
        return None
    return float(w.iloc[(w.index - ts).map(abs).argmin()])


# ── Caricamento dati ───────────────────────────────────────────────────────────
@st.cache_data(ttl=300, show_spinner=False)
def load_json_symbols() -> list[dict]:
    """Carica i ticker dal JSON dell'orchestrator."""
    if not os.path.exists(FINAL_JSON):
        return []
    try:
        with open(FINAL_JSON, "r", encoding="utf-8") as f:
            data = json.load(f)
        recs = data.get("financial", [])
        if not recs:
            return []
        df       = pd.DataFrame(recs)
        sym_col  = next((c for c in ["symbol", "ticker"]         if c in df.columns), None)
        name_col = next((c for c in ["companyName", "longName", "shortName"] if c in df.columns), None)
        if sym_col is None:
            return []
        result = []
        for _, row in df.iterrows():
            sym  = str(row[sym_col]).strip().upper()
            name = str(row[name_col]).strip() if name_col else sym
            result.append({"symbol": sym, "name": name})
        return sorted(result, key=lambda x: x["symbol"])
    except Exception:
        return []


@st.cache_data(ttl=60, show_spinner=False)
def load_clinical_for_ticker(symbol: str) -> pd.DataFrame:
    if not os.path.exists(FINAL_JSON):
        return pd.DataFrame()
    try:
        with open(FINAL_JSON, "r", encoding="utf-8") as f:
            data = json.load(f)
        recs = data.get("clinical_openfda", [])
        if not recs:
            return pd.DataFrame()
        df = pd.DataFrame(recs)
        tc = next((c for c in ["ticker", "symbol", "Ticker"] if c in df.columns), None)
        if tc is None:
            return pd.DataFrame()
        df = df[df[tc].astype(str).str.strip().str.upper() == symbol.upper()].copy()
        if df.empty:
            return df
        date_col = next((c for c in _DATE_CANDIDATES  if c in df.columns), None)
        tc2      = next((c for c in _TITLE_CANDIDATES if c in df.columns), None)
        pc       = next((c for c in _PHASE_CANDIDATES if c in df.columns), None)
        if date_col:
            df["_completion_date"] = pd.to_datetime(df[date_col], errors="coerce").dt.date
        else:
            df["_completion_date"] = None
        df["_title"] = df[tc2].fillna("").astype(str) if tc2 else ""
        df["_phase"] = df[pc].fillna("").astype(str)  if pc  else ""
        return df[df["_completion_date"].notna()].sort_values("_completion_date")
    except Exception:
        return pd.DataFrame()


@st.cache_data(ttl=300, show_spinner=False)
def load_history(symbol: str):
    tk   = yf.Ticker(symbol)
    hist = tk.history(period="max", auto_adjust=True)
    info = tk.info
    hist.index = pd.to_datetime(hist.index).tz_localize(None)
    return hist, info


@st.cache_data(ttl=300, show_spinner=False)
def search_ticker(query: str) -> list[dict]:
    query   = query.strip()
    results = []
    try:
        tk   = yf.Ticker(query.upper())
        info = tk.info
        if info and (info.get("regularMarketPrice") or info.get("currentPrice")):
            results.append({
                "symbol": query.upper(),
                "name":   info.get("longName") or info.get("shortName", query.upper()),
            })
            return results
    except Exception:
        pass
    try:
        hits = yf.Search(query, max_results=6).quotes
        for h in hits:
            results.append({
                "symbol": h.get("symbol", ""),
                "name":   h.get("longname") or h.get("shortname", ""),
            })
    except Exception:
        pass
    return results


# ── Sidebar ────────────────────────────────────────────────────────────────────
with st.sidebar:
    st.title("📈 Retrospective")
    st.caption(f"Confronta fino a **{MAX_COMPANIES}** società dall'IPO a oggi.")

    companies = st.session_state.companies

    # ── Lista corrente ───────────────────────────────────────────────────────
    if companies:
        st.markdown("**Società selezionate:**")
        for comp in companies:
            c1, c2 = st.columns([5, 1])
            with c1:
                dot = f'<span style="color:{comp["color"]};font-size:18px">●</span>'
                st.markdown(
                    f'{dot} **{comp["symbol"]}** &nbsp; <small>{comp["name"][:24]}</small>',
                    unsafe_allow_html=True,
                )
            with c2:
                if st.button("✕", key=f"rm_{comp['symbol']}", help="Rimuovi"):
                    st.session_state.companies = [
                        c for c in companies if c["symbol"] != comp["symbol"]
                    ]
                    st.rerun()

        if st.button("🗑️ Rimuovi tutte", use_container_width=True):
            st.session_state.companies = []
            st.rerun()
        st.divider()

    # ── Aggiungi dal portafoglio JSON ────────────────────────────────────────
    json_syms = load_json_symbols()
    cur_syms  = {c["symbol"] for c in companies}
    available = [s for s in json_syms if s["symbol"] not in cur_syms]

    if available and len(companies) < MAX_COMPANIES:
        st.markdown("**Dal portafoglio:**")
        opts   = {f"{s['symbol']}  —  {s['name'][:28]}": s for s in available}
        choice = st.selectbox(
            "Seleziona", ["—"] + list(opts.keys()),
            label_visibility="collapsed",
        )
        if choice != "—":
            pick  = opts[choice]
            color = PALETTE[len(st.session_state.companies) % len(PALETTE)]
            st.session_state.companies.append(
                {"symbol": pick["symbol"], "name": pick["name"], "color": color}
            )
            st.rerun()

    # ── Ricerca libera ───────────────────────────────────────────────────────
    if len(companies) < MAX_COMPANIES:
        st.markdown("**Oppure cerca per ticker / nome:**")
        query = st.text_input(
            "Cerca",
            placeholder="es. RXRX  ·  Recursion  ·  MRNA",
            label_visibility="collapsed",
        )
        if query:
            with st.spinner("Ricerca…"):
                hits = search_ticker(query)
            hits = [h for h in hits if h["symbol"] not in cur_syms and h["symbol"]]
            if hits:
                hopts   = {f"{h['symbol']}  —  {h['name']}": h for h in hits}
                hchoice = st.selectbox(
                    "Risultati", list(hopts.keys()), label_visibility="collapsed"
                )
                if st.button("➕ Aggiungi", use_container_width=True):
                    pick  = hopts[hchoice]
                    color = PALETTE[len(st.session_state.companies) % len(PALETTE)]
                    st.session_state.companies.append(
                        {"symbol": pick["symbol"], "name": pick["name"], "color": color}
                    )
                    st.rerun()
            else:
                st.warning("Nessun risultato.")

    elif len(companies) >= MAX_COMPANIES:
        st.info(f"Limite di {MAX_COMPANIES} società raggiunto.")

    st.divider()

    # ── Opzioni grafico ──────────────────────────────────────────────────────
    st.markdown("**Opzioni grafico**")
    chart_mode = st.radio(
        "Tipo",
        ["Rendimento % dall'IPO", "Prezzi assoluti"],
        index=0,
    )
    show_ma50  = st.checkbox("Media mobile 50gg",  value=False)
    show_ma200 = st.checkbox("Media mobile 200gg", value=False)
    show_flags = st.checkbox("Flag studi clinici", value=True,
                             help="Triangoli sui completion date degli studi clinici.")

    st.divider()
    st.markdown("**Range date**")
    use_custom = st.checkbox("Personalizza range", value=False)
    date_start, date_end = None, None
    if use_custom:
        date_start = st.date_input("Da", value=date(2010, 1, 1))
        date_end   = st.date_input("A",  value=date.today())

    if show_flags:
        st.markdown(
            "<small>🔵 Fase 1 · 🟠 Fase 2 · 🟢 Fase 3 · 🟣 Fase 4</small>",
            unsafe_allow_html=True,
        )


# ── Area principale ────────────────────────────────────────────────────────────
st.title("📈 Analisi Retrospettiva — IPO → Oggi")

companies = st.session_state.companies

if not companies:
    st.info("👈 Aggiungi fino a 5 società dalla barra laterale per iniziare il confronto.")
    st.stop()
    sys.exit(0)   # fallback se eseguito con 'python' invece di 'streamlit run'

# ── Caricamento dati ───────────────────────────────────────────────────────────
datasets: dict[str, dict | None] = {}

with st.spinner("Carico i dati storici…"):
    for comp in companies:
        sym = comp["symbol"]
        try:
            hist, info = load_history(sym)
            if hist.empty:
                datasets[sym] = None
                continue
            hist.index = pd.to_datetime(hist.index).tz_localize(None)
            if use_custom and date_start and date_end:
                hist = hist.loc[
                    (hist.index >= pd.Timestamp(date_start)) &
                    (hist.index <= pd.Timestamp(date_end))
                ]
            if hist.empty:
                datasets[sym] = None
                continue
            clin_df = load_clinical_for_ticker(sym) if show_flags else pd.DataFrame()
            datasets[sym] = {
                "hist":        hist,
                "info":        info,
                "close":       hist["Close"],
                "clinical_df": clin_df,
            }
        except Exception as e:
            datasets[sym] = None
            st.warning(f"Errore per {sym}: {e}")

valid: list[tuple[dict, dict]] = [
    (c, datasets[c["symbol"]])
    for c in companies
    if datasets.get(c["symbol"]) is not None
]

if not valid:
    st.error("Nessun dato disponibile per le società selezionate.")
    st.stop()
    sys.exit(0)   # fallback bare mode

# ── Metriche affiancate ────────────────────────────────────────────────────────
st.markdown("### 📊 Metriche chiave")

metric_cols = st.columns(max(1, len(valid)))   # max(1,...) evita crash con 0 colonne

for col_idx, (comp, ds) in enumerate(valid):
    close = ds["close"]
    info  = ds["info"]
    cur   = info.get("currency", "")
    name  = (info.get("longName") or info.get("shortName") or comp["name"])[:32]

    first_price = float(close.iloc[0])
    last_price  = float(close.iloc[-1])
    first_date  = close.index[0].date()
    ath_val     = float(close.max())
    ath_date    = close.idxmax().date()
    total_ret   = _pct(last_price, first_price)
    dist_ath    = _pct(last_price, ath_val)

    def _ret_n(days, _close=close, _lp=last_price):
        cutoff = _close.index[-1] - timedelta(days=days)
        sub    = _close.loc[_close.index >= cutoff]
        return _pct(_lp, float(sub.iloc[0])) if not sub.empty else None

    ret_1y = _ret_n(365)
    ret_3y = _ret_n(365 * 3)

    with metric_cols[col_idx]:
        dot = f'<span style="color:{comp["color"]};font-size:20px">●</span>'
        st.markdown(f'{dot} **{comp["symbol"]}**', unsafe_allow_html=True)
        st.caption(name)
        st.metric(
            f"Prezzo IPO ({first_date.strftime('%m/%Y')})",
            f"{first_price:.2f} {cur}",
        )
        st.metric(
            "Prezzo attuale",
            f"{last_price:.2f} {cur}",
            delta=_fmt_pct(total_ret),
            delta_color="normal" if (total_ret or 0) >= 0 else "inverse",
        )
        st.metric(
            f"ATH  ({ath_date.strftime('%m/%Y')})",
            f"{ath_val:.2f} {cur}",
            delta=f"{_fmt_pct(dist_ath)} dall'ATH",
            delta_color="off",
        )
        st.metric("Rendimento 1Y", _fmt_pct(ret_1y))
        st.metric("Rendimento 3Y", _fmt_pct(ret_3y))

st.divider()

# ── Grafico comparativo ────────────────────────────────────────────────────────
st.markdown("### 📉 Andamento storico comparativo")

fig = go.Figure()

for comp, ds in valid:
    close = ds["close"]
    color = comp["color"]
    sym   = comp["symbol"]
    name  = (ds["info"].get("longName") or ds["info"].get("shortName") or comp["name"])[:28]

    if chart_mode == "Rendimento % dall'IPO":
        y_vals = (close / close.iloc[0] - 1) * 100
    else:
        y_vals = close

    fig.add_trace(go.Scatter(
        x=close.index,
        y=y_vals,
        mode="lines",
        name=f"{sym}  ({name})",
        line=dict(color=color, width=2),
    ))

    if show_ma50:
        ma50 = close.rolling(50, min_periods=1).mean()
        y50  = (ma50 / close.iloc[0] - 1) * 100 if chart_mode == "Rendimento % dall'IPO" else ma50
        fig.add_trace(go.Scatter(
            x=ma50.index, y=y50,
            mode="lines",
            name=f"{sym} MM50",
            line=dict(color=color, width=1, dash="dot"),
            opacity=0.55,
            showlegend=False,
        ))

    if show_ma200:
        ma200 = close.rolling(200, min_periods=1).mean()
        y200  = (ma200 / close.iloc[0] - 1) * 100 if chart_mode == "Rendimento % dall'IPO" else ma200
        fig.add_trace(go.Scatter(
            x=ma200.index, y=y200,
            mode="lines",
            name=f"{sym} MM200",
            line=dict(color=color, width=1, dash="dash"),
            opacity=0.55,
            showlegend=False,
        ))

    if show_flags and not ds["clinical_df"].empty:
        clin = ds["clinical_df"]
        for cd, grp in clin.groupby("_completion_date"):
            if cd is None:
                continue
            ts     = pd.Timestamp(cd)
            p_flag = _price_at(close, cd)
            if p_flag is None:
                continue
            y_flag = (p_flag / close.iloc[0] - 1) * 100 \
                if chart_mode == "Rendimento % dall'IPO" else p_flag
            phase_str = grp["_phase"].iloc[0]
            ph_color  = _phase_color(phase_str)
            title_txt = grp["_title"].iloc[0]
            title_txt = title_txt[:70] + "…" if len(title_txt) > 70 else title_txt
            tooltip   = (
                f"<b>{sym}  —  {cd.strftime('%d/%m/%Y')}</b><br>"
                f"{phase_str}<br>{title_txt}"
            )
            fig.add_trace(go.Scatter(
                x=[ts],
                y=[y_flag],
                mode="markers",
                marker=dict(
                    symbol="triangle-down",
                    size=10,
                    color=ph_color,
                    line=dict(color="white", width=1),
                ),
                text=[tooltip],
                hovertemplate="%{text}<extra></extra>",
                showlegend=False,
            ))

if chart_mode == "Rendimento % dall'IPO":
    fig.add_hline(y=0, line_dash="dash", line_color="#AAAAAA", opacity=0.6)
    y_axis_title = "Rendimento % dall'IPO"
else:
    y_axis_title = "Prezzo di chiusura"

fig.update_layout(
    height=540,
    hovermode="x unified",
    legend=dict(
        orientation="h",
        yanchor="bottom", y=1.01,
        xanchor="right",  x=1,
    ),
    margin=dict(l=10, r=10, t=55, b=10),
    paper_bgcolor="#f7f9fc",
    plot_bgcolor="#ffffff",
    xaxis_rangeslider_visible=False,
)
fig.update_yaxes(title_text=y_axis_title, gridcolor="#E0E0E0")
fig.update_xaxes(gridcolor="#E0E0E0")

st.plotly_chart(fig, use_container_width=True)

# ── Tabella riepilogo ──────────────────────────────────────────────────────────
st.divider()
st.markdown("### 📋 Riepilogo metriche")

summary_rows = []
for comp, ds in valid:
    close = ds["close"]
    info  = ds["info"]
    cur   = info.get("currency", "")

    last_price = float(close.iloc[-1])

    def _ret_n2(days, _close=close, _lp=last_price):
        cutoff = _close.index[-1] - timedelta(days=days)
        sub    = _close.loc[_close.index >= cutoff]
        return _pct(_lp, float(sub.iloc[0])) if not sub.empty else None

    daily_ret = close.pct_change().dropna()
    vol_ann   = float(daily_ret.std() * math.sqrt(252) * 100) if not daily_ret.empty else None

    summary_rows.append({
        "Ticker":      comp["symbol"],
        "Società":     (info.get("longName") or info.get("shortName") or comp["name"])[:30],
        "Settore":     info.get("sector", "—"),
        "Paese":       info.get("country", "—"),
        "Valuta":      cur,
        "IPO":         close.index[0].date().strftime("%m/%Y"),
        "Prezzo IPO":  round(float(close.iloc[0]), 2),
        "Attuale":     round(last_price, 2),
        "Δ Totale %":  _fmt_pct(_pct(last_price, float(close.iloc[0]))),
        "ATH":         round(float(close.max()), 2),
        "Δ ATH %":     _fmt_pct(_pct(last_price, float(close.max()))),
        "Rend. 1Y %":  _fmt_pct(_ret_n2(365)),
        "Rend. 3Y %":  _fmt_pct(_ret_n2(365 * 3)),
        "Rend. 5Y %":  _fmt_pct(_ret_n2(365 * 5)),
        "Vol. Ann. %": _fmt_pct(vol_ann),
    })

st.dataframe(
    pd.DataFrame(summary_rows),
    use_container_width=True,
    hide_index=True,
)

# ── Studi clinici per ogni società ────────────────────────────────────────────
if show_flags:
    clinical_data = [(c, ds) for c, ds in valid if not ds["clinical_df"].empty]
    if clinical_data:
        st.divider()
        st.markdown("### 🧪 Studi Clinici")
        for comp, ds in clinical_data:
            clin = ds["clinical_df"]
            with st.expander(
                f"{'🔔 ' if not clin.empty else ''}"
                f"**{comp['symbol']}**  —  {len(clin)} studi con completion date",
                expanded=False,
            ):
                disp = clin[["_completion_date", "_phase", "_title"]].copy()
                disp.columns = ["Completion Date", "Fase", "Titolo Studio"]
                st.dataframe(disp, use_container_width=True, hide_index=True)
    elif not any(ds["clinical_df"].empty is False for _, ds in valid):
        st.caption("Nessun dato clinico disponibile per le società selezionate.")
