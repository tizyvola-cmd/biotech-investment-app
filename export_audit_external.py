"""
export_audit_external.py — Esporta dati per audit esterno gain.

Fogli generati:
  1. Portfolio_reale   — tutti i 63 record di investment_sim_outcomes.json (as-is)
  2. Sim_loop          — 29 punti della equity-curve da invest_sim_history.json
  3. Synth_sim_loop    — architettura e nota: dati live solo in localStorage
  4. Piggy_bank        — formula e nota: dati live solo in localStorage
  5. Legend            — descrizione colonne e formule di calcolo

Vincoli applicati:
  - NESSUNA modifica ai valori — riportati as-is dal JSON sorgente
  - I tre flussi restano su sheet separati
  - Nessun arrotondamento o semplificazione dei numeri

Uso:
  python export_audit_external.py
  (output: audit_gain_<data>.xlsx nella cartella corrente)
"""

import json
import os
from datetime import date
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

OUTPUT_PATH = f"audit_gain_{date.today().isoformat()}.xlsx"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# ── colour palette ──────────────────────────────────────────────────────────
C_HEADER_DARK   = "1E2A3A"   # navy  — Portfolio_reale / Legend headers
C_HEADER_SIM    = "1E3A2A"   # dark green — Sim_loop headers
C_HEADER_SYNTH  = "2A1E3A"   # purple — Synth headers
C_HEADER_PIGGY  = "3A2A1E"   # brown — Piggy headers
C_NOTE_BG       = "FFF3CD"   # amber — note cells
C_WARN_BG       = "F8D7DA"   # red-ish — localStorage-only warning
C_WHITE         = "FFFFFF"
C_LIGHT_GREY    = "F5F5F5"

thin = Side(style="thin", color="CCCCCC")
border_thin = Border(left=thin, right=thin, top=thin, bottom=thin)


def header_font(dark=True):
    return Font(bold=True, color=C_WHITE if dark else "000000", size=10)


def apply_header(ws, row_idx, values, fill_color):
    fill = PatternFill("solid", fgColor=fill_color)
    for col_idx, val in enumerate(values, start=1):
        cell = ws.cell(row=row_idx, column=col_idx, value=val)
        cell.font = Font(bold=True, color=C_WHITE, size=10)
        cell.fill = fill
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = border_thin


def autofit(ws, min_w=8, max_w=40):
    for col in ws.columns:
        max_len = 0
        col_letter = get_column_letter(col[0].column)
        for cell in col:
            try:
                val = str(cell.value) if cell.value is not None else ""
                max_len = max(max_len, len(val))
            except Exception:
                pass
        ws.column_dimensions[col_letter].width = min(max(max_len + 2, min_w), max_w)


def note_cell(ws, row, col, text, bg=C_NOTE_BG):
    c = ws.cell(row=row, column=col, value=text)
    c.fill = PatternFill("solid", fgColor=bg)
    c.alignment = Alignment(wrap_text=True, vertical="top")
    return c


# ── load source data ─────────────────────────────────────────────────────────
def load_json(rel_path):
    full = os.path.join(SCRIPT_DIR, rel_path)
    with open(full, "r", encoding="utf-8") as f:
        return json.load(f)


# ════════════════════════════════════════════════════════════════════════════
# SHEET 1 — Portfolio_reale
# ════════════════════════════════════════════════════════════════════════════
def build_portfolio_reale(wb):
    raw = load_json("data/investment_sim_outcomes.json")
    rows = raw if isinstance(raw, list) else raw.get("rows", [])

    # Collect ALL column names preserving insertion order
    all_cols = []
    seen = set()
    for r in rows:
        for k in r.keys():
            if k not in seen:
                all_cols.append(k)
                seen.add(k)

    ws = wb.create_sheet("Portfolio_reale")
    ws.freeze_panes = "A2"

    apply_header(ws, 1, all_cols, C_HEADER_DARK)

    alt_fill = PatternFill("solid", fgColor=C_LIGHT_GREY)
    for row_num, record in enumerate(rows, start=2):
        fill = alt_fill if row_num % 2 == 0 else None
        for col_idx, col_name in enumerate(all_cols, start=1):
            val = record.get(col_name)
            c = ws.cell(row=row_num, column=col_idx, value=val)
            c.border = border_thin
            if fill:
                c.fill = fill
            if isinstance(val, float):
                c.number_format = "0.0000"
            c.alignment = Alignment(vertical="center")

    autofit(ws)
    ws.row_dimensions[1].height = 30
    return ws


# ════════════════════════════════════════════════════════════════════════════
# SHEET 2 — Sim_loop
# ════════════════════════════════════════════════════════════════════════════
def build_sim_loop(wb):
    raw = load_json("data/invest_sim_history.json")
    points = raw.get("points", [])
    updated_at = raw.get("updated_at", "n/a")

    ws = wb.create_sheet("Sim_loop")
    ws.freeze_panes = "A3"

    # Metadata rows
    note_cell(ws, 1, 1,
              f"Fonte: invest_sim_history.json  —  Aggiornato: {updated_at}  —  {len(points)} snapshot")
    ws.merge_cells("A1:H1")
    ws.row_dimensions[1].height = 20

    note_cell(ws, 2, 1,
              "NOTA: questa equity-curve è uno snapshot su disco. "
              "I deal in tempo reale (tick-by-tick) e il portafoglio synth live "
              "esistono SOLO in localStorage del browser e non sono estraibili senza "
              "aprire l'app e usare l'export integrato (Gain Audit XLS).",
              bg=C_WARN_BG)
    ws.merge_cells("A2:H2")
    ws.row_dimensions[2].height = 40

    # Collect all tickers that appear in byTicker across any point
    all_tickers = []
    seen_t = set()
    for p in points:
        for tk in (p.get("byTicker") or {}).keys():
            if tk not in seen_t:
                all_tickers.append(tk)
                seen_t.add(tk)

    # Header
    base_cols = ["timestamp", "capital_eur", "value_eur", "pnl_eur", "pnl_pct"]
    ticker_cols = []
    for tk in all_tickers:
        ticker_cols += [f"{tk}|value", f"{tk}|pnl", f"{tk}|pnl_pct"]
    header = base_cols + ticker_cols
    apply_header(ws, 3, header, C_HEADER_SIM)
    ws.row_dimensions[3].height = 28

    alt_fill = PatternFill("solid", fgColor=C_LIGHT_GREY)
    for row_num, p in enumerate(points, start=4):
        fill = alt_fill if row_num % 2 == 0 else None
        vals = [
            p.get("ts"),
            p.get("capital"),
            p.get("value"),
            p.get("pnl"),
            p.get("pnlPct"),
        ]
        by = p.get("byTicker") or {}
        for tk in all_tickers:
            td = by.get(tk, {})
            vals += [td.get("value"), td.get("pnl"), td.get("pnlPct")]

        for col_idx, val in enumerate(vals, start=1):
            c = ws.cell(row=row_num, column=col_idx, value=val)
            c.border = border_thin
            if fill:
                c.fill = fill
            if isinstance(val, float):
                c.number_format = "0.0000"
            c.alignment = Alignment(vertical="center")

    autofit(ws)
    return ws


# ════════════════════════════════════════════════════════════════════════════
# SHEET 3 — Synth_sim_loop
# ════════════════════════════════════════════════════════════════════════════
def build_synth_sim_loop(wb):
    ws = wb.create_sheet("Synth_sim_loop")

    note_cell(ws, 1, 1, "SYNTH SIM LOOP — Architettura e provenienza dati", bg=C_HEADER_SYNTH)
    ws.cell(1, 1).font = Font(bold=True, color=C_WHITE, size=12)
    ws.merge_cells("A1:B1")

    rows = [
        ("Tipo", "Dettaglio"),
        ("Fonte dati live", "localStorage del browser — chiave 'synthSimLoop' (o equivalente)"),
        ("Disponibilità su disco", "NON disponibile — nessun file JSON di backup per questo flusso"),
        ("Come estrarre", "Aprire l'app → Model Quality → Gain Audit XLS (export integrato)"),
        ("", ""),
        ("ARCHITETTURA ALLOCAZIONE CAPITALE", ""),
        ("Pipeline", "Learning Lab weights → computeApprovedWeightShares → optimizeWeightSimExp → shares × totalCapitalPot"),
        ("Base del calcolo", "Pesi 'frozen' dal Learning Lab (NON basati su P(plan) del catalizzatore)"),
        ("optimizeWeightSimExp", "Funzione in approvedWeightPortfolioShares.ts — ottimizza i pesi approvati"),
        ("totalCapitalPot", "Capitale totale allocabile definito nella configurazione del portafoglio"),
        ("Allocazione per ticker", "totalCapitalPot × share (dove share = frazione normalizzata dai pesi frozen)"),
        ("", ""),
        ("DIFFERENZA rispetto a Portfolio_reale", ""),
        ("Capitale per trade", "Synth: deterministico da pesi frozen; Reale: variabile (decisione manuale)"),
        ("Segnale di entrata", "Synth: automatico da motore; Reale: manuale con conferma"),
        ("P&L", "Synth: simulato su prezzi storici; Reale: transazioni effettive"),
    ]

    apply_header(ws, 2, ["Voce", "Descrizione"], C_HEADER_SYNTH)

    alt_fill = PatternFill("solid", fgColor=C_LIGHT_GREY)
    for row_num, (k, v) in enumerate(rows, start=3):
        fill = alt_fill if row_num % 2 == 1 else None
        c_k = ws.cell(row=row_num, column=1, value=k)
        c_v = ws.cell(row=row_num, column=2, value=v)
        for c in (c_k, c_v):
            c.border = border_thin
            c.alignment = Alignment(wrap_text=True, vertical="top")
            if fill:
                c.fill = fill
        if k.isupper() and k:
            c_k.font = Font(bold=True)
            c_v.font = Font(bold=True)

    ws.column_dimensions["A"].width = 35
    ws.column_dimensions["B"].width = 75
    return ws


# ════════════════════════════════════════════════════════════════════════════
# SHEET 4 — Piggy_bank
# ════════════════════════════════════════════════════════════════════════════
def build_piggy_bank(wb):
    ws = wb.create_sheet("Piggy_bank")

    note_cell(ws, 1, 1, "PIGGY BANK — Architettura e provenienza dati", bg=C_HEADER_PIGGY)
    ws.cell(1, 1).font = Font(bold=True, color=C_WHITE, size=12)
    ws.merge_cells("A1:B1")

    rows = [
        ("Fonte dati live", "localStorage del browser — ledger archiviato"),
        ("Disponibilità su disco", "NON disponibile — nessun file JSON di backup per questo flusso"),
        ("Come estrarre", "Aprire l'app → Model Quality → Gain Audit XLS (export integrato)"),
        ("", ""),
        ("FORMULA DI CALCOLO", ""),
        ("rawPnlEur", "sum(r.totalEur  per ogni r nel ledger  dove r.archived == true)"),
        ("Display P&L", "rawPnlEur − baselineEur"),
        ("baselineEur", "Offset opzionale configurato in localStorage (default 0)"),
        ("totalEur per riga", "Importo effettivamente realizzato per quella voce archiviata"),
        ("", ""),
        ("NOTE AUDIT", ""),
        (
            "Perché i valori possono sembrare incongruenti",
            "Il piggy bank accumula gain/loss di natura diversa (profit-taking parziale, "
            "dividendi, commissioni) — verificare la tipologia di ogni riga con 'tipo' nel ledger",
        ),
        (
            "Baseline",
            "Se baselineEur ≠ 0 il display sarà diverso dal grezzo — "
            "il valore grezzo è in rawPnlEur",
        ),
    ]

    apply_header(ws, 2, ["Voce", "Descrizione"], C_HEADER_PIGGY)

    alt_fill = PatternFill("solid", fgColor=C_LIGHT_GREY)
    for row_num, (k, v) in enumerate(rows, start=3):
        fill = alt_fill if row_num % 2 == 1 else None
        c_k = ws.cell(row=row_num, column=1, value=k)
        c_v = ws.cell(row=row_num, column=2, value=v)
        for c in (c_k, c_v):
            c.border = border_thin
            c.alignment = Alignment(wrap_text=True, vertical="top")
            if fill:
                c.fill = fill
        if k.isupper() and k:
            c_k.font = Font(bold=True)
            c_v.font = Font(bold=True)

    ws.column_dimensions["A"].width = 32
    ws.column_dimensions["B"].width = 80
    return ws


# ════════════════════════════════════════════════════════════════════════════
# SHEET 5 — Legend
# ════════════════════════════════════════════════════════════════════════════
def build_legend(wb):
    ws = wb.create_sheet("Legend")

    note_cell(ws, 1, 1, "LEGENDA — Colonne e formule (Portfolio_reale)", bg=C_HEADER_DARK)
    ws.cell(1, 1).font = Font(bold=True, color=C_WHITE, size=12)
    ws.merge_cells("A1:C1")

    apply_header(ws, 2, ["Colonna", "Tipo", "Descrizione"], C_HEADER_DARK)

    entries = [
        # ── identifiers ──
        ("row_key", "string", "Chiave univoca: ticker|completion_date[#cycleN]"),
        ("ticker", "string", "Simbolo azionario (es. LTRN)"),
        ("completion_date", "date", "Data del catalizzatore (CD) — formato ISO 8601"),
        ("universe", "string|null", "Flusso: 'simloop' = posizione aperta sim loop; null = portafoglio reale chiuso"),

        # ── timing ──
        ("days_to_cd", "int", "Giorni rimanenti a CD al momento della snapshot (negativo = CD già passato)"),
        ("cd_passed", "bool", "true se la data CD è già trascorsa"),
        ("timing_bucket", "string", "Bucket temporale: pre_cd_close / pre_cd_far / post_cd"),
        ("timing_label", "string", "Etichetta leggibile del timing bucket"),

        # ── capital & price ──
        ("capital_eur", "float", "Capitale investito in EUR (variabile, riflette la decisione reale)"),
        ("buy_price_usd", "float", "Prezzo di acquisto in USD al momento della snapshot corrente"),
        ("entry_buy_price_usd", "float", "Prezzo di acquisto in USD al momento dell'entrata originale"),

        # ── P&L ──
        ("pnl_eur", "float", "P&L corrente in EUR: (prezzo_corrente / prezzo_acquisto − 1) × capital_eur"),
        ("pnl_pct", "float", "P&L corrente in % rispetto al capital_eur"),
        ("exit_pnl_pct_at_event", "float|null", "P&L % calcolato al momento dell'uscita (null se ancora aperto)"),
        ("exit_pnl_eur_at_event", "float|null", "P&L EUR calcolato al momento dell'uscita (null se ancora aperto)"),

        # ── outcome ──
        ("outcome", "string", "Risultato: win / loss / flat / open_win / open_failure / open_neutral"),
        ("outcome_label", "string", "Etichetta leggibile dell'outcome"),
        ("is_win", "bool", "true se pnl_pct > 0 al momento della chiusura (o ora, se aperto)"),
        ("_win", "bool", "Alias interno di is_win (usato da alcuni componenti UI)"),

        # ── model signals ──
        ("affidabilita_pct", "float|null", "Affidabilità del modello alla snapshot corrente (0–100)"),
        ("entry_affidabilita_pct", "float|null", "Affidabilità al momento dell'entrata"),
        ("pred7_pp", "float|null", "Predizione modello a 7 giorni (punti percentuale)"),
        ("pred5_pp", "float|null", "Predizione modello a 5 giorni (punti percentuale)"),
        ("pred4_pp", "float|null", "Predizione modello a 4 giorni (punti percentuale) — campo aggiuntivo"),
        ("pred_direction_hit", "bool|null", "true se la direzione predetta era corretta"),
        ("entry_pred5_pp", "float|null", "Predizione 5gg al momento dell'entrata"),
        ("entry_pred7_pp", "float|null", "Predizione 7gg al momento dell'entrata"),
        ("r2_fit", "float|null", "R² del fit del modello alla snapshot corrente"),
        ("entry_r2_fit", "float|null", "R² al momento dell'entrata"),
        ("entry_sds_score", "float|null", "SDS score al momento dell'entrata (0–100)"),
        ("sds_score", "float|null", "SDS score alla snapshot corrente"),

        # ── slope / momentum ──
        ("entry_slope_5d", "float|null", "Slope 5 giorni al momento dell'entrata"),
        ("entry_slope_20d", "float|null", "Slope 20 giorni al momento dell'entrata"),
        ("entry_run_up_30d", "float|null", "Run-up 30 giorni al momento dell'entrata (%)"),
        ("latest_slope_5d", "float|null", "Slope 5gg più recente disponibile"),
        ("latest_slope_20d", "float|null", "Slope 20gg più recente disponibile"),
        ("latest_slope_asof", "date|null", "Data della slope più recente"),
        ("pre_cd_slope_5d", "float|null", "Slope 5gg immediatamente pre-CD"),
        ("pre_cd_slope_20d", "float|null", "Slope 20gg immediatamente pre-CD"),
        ("pre_cd_run_up_30d", "float|null", "Run-up 30gg immediatamente pre-CD"),

        # ── regime ──
        ("entry_regime", "string|null", "Regime di mercato all'entrata (BULL/NEUTRAL/BEAR)"),
        ("market_regime", "string|null", "Regime di mercato corrente"),

        # ── exit ──
        ("exit_ts", "datetime|null", "Timestamp di uscita ISO 8601 (null se aperto)"),
        ("exit_current_price_usd", "float|null", "Prezzo USD al momento dell'uscita"),
        ("exit_reason", "string|null", "Motivo uscita: capital_removed / stop_loss / target_hit / ecc."),
        ("holding_days", "int|null", "Giorni di detenzione effettivi"),

        # ── signals ──
        ("buy_signal_suggested", "bool", "true se il motore aveva suggerito l'acquisto"),
        ("buy_signal_result", "string", "Risultato del segnale BUY: success / failure / not_applicable"),
        ("buy_signal_note", "string|null", "Note testuali sul segnale BUY"),
        ("sell_signal_suggested", "bool", "true se il motore aveva suggerito la vendita"),
        ("sell_signal_after_move_pct", "float|null", "Mossa % del titolo dopo il segnale SELL"),
        ("sell_signal_result", "string", "Risultato del segnale SELL: success / failure / not_applicable"),

        # ── meta ──
        ("entry_ts", "datetime", "Timestamp di entrata ISO 8601"),
        ("entry_was_existing", "bool", "true se la posizione era già esistente al primo ciclo di decisione"),
        ("decision_cycles_count", "int", "Numero di cicli di decisione eseguiti su questa posizione"),
        ("decision_current_open", "bool", "true se la posizione è ancora aperta nel ciclo corrente"),

        # ── Sim_loop columns ──
        ("", "", ""),
        ("=== COLONNE SHEET Sim_loop ===", "", ""),
        ("timestamp", "datetime", "Timestamp dello snapshot (ISO 8601)"),
        ("capital_eur (sim)", "float", "Somma del capitale allocato a tutti i ticker nel portafoglio sim in quel momento"),
        ("value_eur", "float", "Valore di mercato totale del portafoglio sim"),
        ("pnl_eur (sim)", "float", "P&L totale = value_eur − capital_eur"),
        ("pnl_pct (sim)", "float", "P&L % = pnl_eur / capital_eur × 100"),
        ("TICKER|value", "float", "Valore di mercato di quel ticker nel portafoglio sim"),
        ("TICKER|pnl", "float", "P&L del singolo ticker in EUR"),
        ("TICKER|pnl_pct", "float", "P&L del singolo ticker in %"),
    ]

    alt_fill = PatternFill("solid", fgColor=C_LIGHT_GREY)
    for row_num, (col, typ, desc) in enumerate(entries, start=3):
        fill = alt_fill if row_num % 2 == 0 else None
        is_section = col.startswith("===")
        vals = [col, typ, desc]
        for col_idx, val in enumerate(vals, start=1):
            c = ws.cell(row=row_num, column=col_idx, value=val)
            c.border = border_thin
            c.alignment = Alignment(wrap_text=True, vertical="top")
            if fill and not is_section:
                c.fill = fill
            if is_section:
                c.font = Font(bold=True, size=10)
                c.fill = PatternFill("solid", fgColor="E8E8E8")

    ws.column_dimensions["A"].width = 32
    ws.column_dimensions["B"].width = 18
    ws.column_dimensions["C"].width = 80
    return ws


# ════════════════════════════════════════════════════════════════════════════
# MAIN
# ════════════════════════════════════════════════════════════════════════════
def main():
    wb = Workbook()
    # Remove default empty sheet
    wb.remove(wb.active)

    print("Building Portfolio_reale …")
    build_portfolio_reale(wb)

    print("Building Sim_loop …")
    build_sim_loop(wb)

    print("Building Synth_sim_loop …")
    build_synth_sim_loop(wb)

    print("Building Piggy_bank …")
    build_piggy_bank(wb)

    print("Building Legend …")
    build_legend(wb)

    out_path = os.path.join(SCRIPT_DIR, OUTPUT_PATH)
    wb.save(out_path)
    print(f"\nSalvato: {out_path}")

    # Quick sanity check
    from openpyxl import load_workbook
    wb2 = load_workbook(out_path)
    for sn in wb2.sheetnames:
        ws = wb2[sn]
        print(f"  {sn}: {ws.max_row} rows × {ws.max_column} cols")


if __name__ == "__main__":
    main()
