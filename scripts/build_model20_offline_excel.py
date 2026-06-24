"""
Genera data/model20_offline_check_template.xlsx
Template offline aggiornato per Modello 2.1 (engine + OHLCV fixed/ridge).
"""
from __future__ import annotations

import pathlib

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter


ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "model20_offline_check_template.xlsx"


def _header(ws, row: int, texts: list[str], widths: list[int]) -> None:
    fill = PatternFill("solid", fgColor="1F3864")
    font = Font(bold=True, color="FFFFFF", size=10)
    for i, txt in enumerate(texts, start=1):
        c = ws.cell(row=row, column=i, value=txt)
        c.fill = fill
        c.font = font
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        if i <= len(widths):
            ws.column_dimensions[get_column_letter(i)].width = widths[i - 1]


def main() -> None:
    wb = Workbook()

    # ── Legenda ───────────────────────────────────────────────────────────────
    ws0 = wb.active
    ws0.title = "Legenda"
    ws0["A1"] = "Modello 2.1 - verifica offline"
    ws0["A1"].font = Font(bold=True, size=14)
    ws0.merge_cells("A1:G1")

    legend = """
Scope
- Path A (curve storiche): offset fissi t={-7,-5,-3,-1,+1,+3,+5,+7}, y% rispetto a P(T-7).
- Path B (Modello 2.0/2.1): y_base% rispetto a price_at_cd, poi correzione OHLCV.

Modalita implementate nel codice
- MODEL20_ENGINE = poly | spline
  poly: fit polinomiale (legacy)
  spline: spline lineare a tratti sui punti mediani

- MODEL20_OHLCV_WEIGHT_MODE = fixed | ridge
  fixed: y = w_base*y_base + w_oc*oc_pct + w_hl*hl_pct*sgn + w_vol*vol_sur*sgn
         con default w_base=1.00, w_oc=0.20, w_hl=0.05, w_vol=1.50
  ridge: stessi termini ma pesi stimati su coorte (regolarizzazione alpha)

Feature
- oc_pct   = (Close/Open - 1)*100
- hl_pct   = (High-Low)/Open*100
- vol_sur  = clamp(Volume/V_med - 1, -2, +2)
- sgn      = sign(oc_pct), fallback su sign(y_base) quando oc_pct = 0

Note
- Formule in sintassi Excel EN (virgole). In Excel IT usa ; se necessario.
"""
    ws0["A3"] = legend.strip()
    ws0["A3"].alignment = Alignment(wrap_text=True, vertical="top")
    ws0.row_dimensions[3].height = 300
    ws0.column_dimensions["A"].width = 105

    # ── Path A: Close-only baseline T-7 ──────────────────────────────────────
    ws1 = wb.create_sheet("PathA_CurvePts")
    ws1["A1"] = "Path A: y(t)% = (P(t)/P(T-7)-1)*100, baseline P(T-7)=C5"
    ws1["A2"] = "Compila riga 5 con i Close agli offset."
    offs = [-7, -5, -3, -1, 1, 3, 5, 7]
    _header(
        ws1,
        4,
        ["Campo"] + [f"{o:+d}" for o in offs],
        [24] + [10] * len(offs),
    )
    ws1["A5"] = "Close P(t)"
    ws1["A6"] = "y % vs P(T-7)"
    for j in range(len(offs)):
        col = get_column_letter(2 + j)
        ws1[f"{col}6"] = f'=IF({col}5="","",(({col}5/$B$5)-1)*100)'
    ws1.freeze_panes = "A5"

    # ── Path B: OHLCV blend (fixed o ridge già noti) ─────────────────────────
    ws2 = wb.create_sheet("PathB_M20_Blend")
    ws2["A1"] = "Path B: punto singolo t con blend OHLCV (usa pesi scelti in B19:B22)"
    ws2["A1"].font = Font(bold=True, size=12)
    labels = [
        "P_CD (price_at_cd)",
        "y_base %",
        "Open",
        "High",
        "Low",
        "Close",
        "Volume V",
        "V_med (mediana 20 pre)",
    ]
    for i, lab in enumerate(labels, start=3):
        ws2.cell(i, 1, lab)
    ws2["A12"] = "oc_pct %"
    ws2["C12"] = '=IF(OR(B5="",B8="",B5=0),"",(B8/B5-1)*100)'
    ws2["A13"] = "hl_pct %"
    ws2["C13"] = '=IF(OR(B5="",B6="",B7="",B5=0),"",(B6-B7)/B5*100)'
    ws2["A14"] = "sgn"
    ws2["C14"] = '=IF(C12="","",IF(C12>0,1,IF(C12<0,-1,IF(B4>0,1,-1))))'
    ws2["A15"] = "vol_sur"
    ws2["C15"] = '=IF(OR(B9="",B10="",B10=0),"",MAX(-2,MIN(2,B9/B10-1)))'
    ws2["A16"] = "y finale %"
    ws2["C16"] = '=IF(B4="","",B19*B4+B20*C12+B21*C13*C14+B22*C15*C14)'

    ws2["A18"] = "Pesi usati (fixed o ridge)"
    ws2["A18"].font = Font(bold=True)
    ws2["A19"] = "w_base"
    ws2["A20"] = "w_oc"
    ws2["A21"] = "w_hl"
    ws2["A22"] = "w_vol"
    ws2["B19"] = 1.00
    ws2["B20"] = 0.20
    ws2["B21"] = 0.05
    ws2["B22"] = 1.50
    ws2["D19"] = "Con ridge: incolla qui i pesi stampati dal run."

    for rr in (12, 13, 14, 15, 16, 18, 19, 20, 21, 22):
        ws2.cell(rr, 1).font = Font(bold=True)
    ws2.column_dimensions["A"].width = 30
    ws2.column_dimensions["B"].width = 16
    ws2.column_dimensions["C"].width = 16
    ws2.column_dimensions["D"].width = 54
    ws2.freeze_panes = "A3"

    # ── Confronto engine 2.0 vs 2.1 (manual check grid) ─────────────────────
    ws3 = wb.create_sheet("Engine_2.0_vs_2.1")
    ws3["A1"] = "Confronto offline: 2.0 poly vs 2.1 spline"
    ws3["A1"].font = Font(bold=True, size=12)
    _header(
        ws3,
        3,
        ["Engine", "N punti eval", "MAE (pp)", "Acc dir T+5 (%)", "Note"],
        [18, 16, 12, 16, 54],
    )
    ws3["A4"] = "2.0 poly"
    ws3["A5"] = "2.1 spline"
    ws3["A7"] = "Winner (MAE)"
    ws3["B7"] = '=IF(OR(C4="",C5=""),"N/D",IF(C5<C4,"2.1 spline","2.0 poly"))'
    ws3["A8"] = "Winner (Acc dir)"
    ws3["B8"] = '=IF(OR(D4="",D5=""),"N/D",IF(D5>D4,"2.1 spline","2.0 poly"))'
    ws3.column_dimensions["A"].width = 20
    ws3.column_dimensions["B"].width = 16
    ws3.column_dimensions["C"].width = 12
    ws3.column_dimensions["D"].width = 16
    ws3.column_dimensions["E"].width = 54

    # ── Polyfit note (per riproduzione python) ───────────────────────────────
    ws4 = wb.create_sheet("Polyfit_note")
    ws4["A1"] = "Riproduzione Python"
    ws4["A1"].font = Font(bold=True, size=12)
    ws4["A3"] = (
        "import numpy as np\n"
        "x = np.array([-7,-5,-3,-1,1,3,5,7], float)\n"
        "y = np.array([...], float)  # mediane %\n"
        "deg = min(4, len(x)-1)\n"
        "c = np.polyfit(x, y, deg)\n"
        "yhat = np.polyval(c, x)"
    )
    ws4["A3"].alignment = Alignment(wrap_text=True, vertical="top")
    ws4.row_dimensions[3].height = 120
    ws4.column_dimensions["A"].width = 92

    OUT.parent.mkdir(parents=True, exist_ok=True)
    wb.save(OUT)
    print(f"Written: {OUT}")


if __name__ == "__main__":
    main()

