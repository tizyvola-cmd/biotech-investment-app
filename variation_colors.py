"""
Scala colori per variazioni % (Excel / openpyxl).

Due famiglie:

- ``signed_pct_fill_font``: negativo **blu**, positivo **ambra/arancio**, neutro grigio chiaro
  (meno ambiguo daltonismo vs rosso/verde).
- ``signed_pct_fill_font_gwr``: **rosso** (negativo), **bianco** (~0), **verde** (positivo), con rossi
  **non fluorescenti** e testo ad alto contrasto (es. Simulation, altri fogli).
- ``signed_pct_fill_font_accuracy_5stop``: scala **a 5 colori** terracotta → sabbia → crema → salvia →
  teal (palette Accuracy **Pred** / **Storico**).
- ``delta_pp_blue_white_rose_fill_font``: stessa scala rosso/bianco/verde (nome storico); usata dove
  serve compatibilità.
- ``delta_pp_accuracy_sequential_9_fill_font``: scala **sequenziale a 9 colori** (navy → … → crema)
  per **Δ% Pred−Stor** su **Accuracy** (legacy / alternativa).
- ``delta_pp_accuracy_blue_beige_yellow_fill_font``: scala **Accuracy Δ% Pred−Stor** blu–beige–giallo
  (#1976D2 → … → #F5F5DC ~0 → … → #FFC107).
- ``delta_pp_yellow_white_blue_fill_font``: scala giallo/bianco/blu (legacy; non usata dal foglio Accuracy).
"""
from __future__ import annotations

from openpyxl.styles import Font, PatternFill

# RGB punti estremi (lato neg / lato pos) e neutro
_NEU = (245, 245, 247)
_LOSS_A = (227, 242, 253)   # blu chiarissimo
_LOSS_B = (13, 71, 161)     # blu intenso (testo bianco)
_GAIN_A = (255, 248, 225)   # crema
_GAIN_B = (245, 124, 0)     # arancio (testo bianco)


def _smoothstep(u: float) -> float:
    u = max(0.0, min(1.0, u))
    return u * u * (3.0 - 2.0 * u)


def _lerp_rgb(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    t = max(0.0, min(1.0, t))
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def _blend_rgb(
    base: tuple[int, int, int],
    overlay: tuple[int, int, int],
    amount: float,
) -> tuple[int, int, int]:
    """Miscela base verso overlay (amount 0..1)."""
    return _lerp_rgb(base, overlay, amount)


def _relative_luminance(rgb: tuple[int, int, int]) -> float:
    """Luminanza percepita 0–255 (semplificata)."""
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]


def _diverging_rwG_text_color(rgb: tuple[int, int, int]) -> str:
    """
    Testo leggibile su sfondo da gradiente rosso/bianco/verde (no rosso su rosso chiaro illeggibile).
    Soglia luminanza conservativa per astigmatismo / display vari.
    """
    lum = _relative_luminance(rgb)
    if lum < 168:
        return "FFFFFF"
    r, g, b = rgb
    if r > g + 18 and r > b + 12:
        return "4A1212"
    if g > r + 18 and g > b + 12:
        return "0D3318"
    return "212121"


_GWR_NEU = (255, 255, 255)
# Rossi profondi (Material ~800): visibili ma non «neon» / fluorescenti
_GWR_RED_END = (198, 40, 40)     # #C62828
_GWR_GRN_END = (56, 142, 60)    # #388E3C


def signed_pct_fill_font_gwr(
    value,
    *,
    max_abs: float = 25.0,
    size: int = 10,
    bold_threshold: float = 5.0,
) -> tuple[PatternFill | None, Font | None]:
    """
    Gradiente **rosso (negativo) ⇄ bianco (~0) ⇄ verde (positivo)** per variazioni %:
    intensità cresce con |Δ|; rossi verso un rosso profondo (non accecante).

    Utile per fogli dove serve lettura ± classica (es. Simulation: prezzi vs base).
    """
    if value is None:
        return None, None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None, None

    if max_abs <= 0:
        max_abs = 25.0

    # Fascia «vicino allo zero» un po’ più ampia così il bianco resta leggibile in Excel
    if abs(v) < 0.12:
        rgb = _GWR_NEU
        fc = _diverging_rwG_text_color(rgb)
        bold = False
    elif v < 0:
        u = _smoothstep(min(1.0, (-v) / max_abs))
        rgb = _lerp_rgb(_GWR_NEU, _GWR_RED_END, u)
        bold = abs(v) >= bold_threshold
        fc = _diverging_rwG_text_color(rgb)
    else:
        u = _smoothstep(min(1.0, v / max_abs))
        rgb = _lerp_rgb(_GWR_NEU, _GWR_GRN_END, u)
        bold = abs(v) >= bold_threshold
        fc = _diverging_rwG_text_color(rgb)

    hx = f"{rgb[0]:02X}{rgb[1]:02X}{rgb[2]:02X}"
    fill = PatternFill("solid", fgColor=hx)
    font = Font(bold=bold, color=fc, size=size)
    return fill, font


# Palette Accuracy (Pred % / Storico %): terracotta → sabbia → crema → salvia → teal
_ACC5_NEG = (199, 82, 42)       # #C7522A
_ACC5_NEG_MID = (229, 193, 133)  # #E5C185
_ACC5_NEU = (251, 242, 196)     # #FBF2C4
_ACC5_POS_MID = (116, 168, 146)  # #74A892
_ACC5_POS = (0, 133, 133)       # #008585


def _rgb_accuracy_five_stop_diverge(t: float) -> tuple[int, int, int]:
    """t in [-1, 1]: da negativo estremo (terracotta) a positivo estremo (teal)."""
    t = max(-1.0, min(1.0, t))
    anchors: tuple[tuple[float, tuple[int, int, int]], ...] = (
        (-1.0, _ACC5_NEG),
        (-0.5, _ACC5_NEG_MID),
        (0.0, _ACC5_NEU),
        (0.5, _ACC5_POS_MID),
        (1.0, _ACC5_POS),
    )
    for i in range(len(anchors) - 1):
        t_a, rgb_a = anchors[i]
        t_b, rgb_b = anchors[i + 1]
        if t <= t_b:
            span = t_b - t_a
            u = 0.0 if abs(span) < 1e-12 else (t - t_a) / span
            u = max(0.0, min(1.0, u))
            return _lerp_rgb(rgb_a, rgb_b, u)
    t_a, rgb_a = anchors[-2]
    t_b, rgb_b = anchors[-1]
    span = t_b - t_a
    u = 0.0 if abs(span) < 1e-12 else (t - t_a) / span
    u = max(0.0, min(1.0, u))
    return _lerp_rgb(rgb_a, rgb_b, u)


def _text_on_accuracy_five_rgb(rgb: tuple[int, int, int]) -> str:
    lum = _relative_luminance(rgb)
    if lum < 155:
        return "FFFFFF"
    if lum > 218:
        return "37474F"
    return "212121"


def signed_pct_fill_font_accuracy_5stop(
    value,
    *,
    max_abs: float = 40.0,
    size: int = 9,
    bold_threshold: float = 5.0,
) -> tuple[PatternFill | None, Font | None]:
    """
    Variazioni % per foglio **Accuracy** (blocchi Pred e Storico): gradiente a 5 fermate
    (#C7522A → #E5C185 → #FBF2C4 → #74A892 → #008585), simmetrico su ``value / max_abs``.
    """
    if value is None:
        return None, None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None, None

    if max_abs <= 0:
        max_abs = 40.0

    if abs(v) < 0.12:
        rgb = _ACC5_NEU
        bold = False
    else:
        t = max(-1.0, min(1.0, v / max_abs))
        rgb = _rgb_accuracy_five_stop_diverge(t)
        bold = abs(v) >= bold_threshold

    fc = _text_on_accuracy_five_rgb(rgb)
    hx = f"{rgb[0]:02X}{rgb[1]:02X}{rgb[2]:02X}"
    fill = PatternFill("solid", fgColor=hx)
    font = Font(bold=bold, color=fc, size=size)
    return fill, font


def delta_pp_blue_white_rose_fill_font(
    value,
    *,
    max_abs: float = 40.0,
    size: int = 9,
    bold_threshold: float = 5.0,
) -> tuple[PatternFill | None, Font | None]:
    """
    Punti % «Pred − Stor» (o simili): **stessa logica** ``signed_pct_fill_font_gwr`` —
    negativo → rosso, ~0 → bianco, positivo → verde (gradienti moderati, testo ad alto contrasto).

    ``value``: differenza **Pred % − Stor %** in **punti percentuali numerici**
    (es. ``+3.2`` = +3,2 punti tra le due variazioni %).
    """
    if value is None:
        return None, None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None, None

    if max_abs <= 0:
        max_abs = 40.0

    if abs(v) < 0.12:
        rgb = _GWR_NEU
        fc = _diverging_rwG_text_color(rgb)
        bold = False
    elif v > 0:
        u = _smoothstep(min(1.0, v / max_abs))
        rgb = _lerp_rgb(_GWR_NEU, _GWR_GRN_END, u)
        bold = abs(v) >= bold_threshold
        fc = _diverging_rwG_text_color(rgb)
    else:
        u = _smoothstep(min(1.0, (-v) / max_abs))
        rgb = _lerp_rgb(_GWR_NEU, _GWR_RED_END, u)
        bold = abs(v) >= bold_threshold
        fc = _diverging_rwG_text_color(rgb)

    hx = f"{rgb[0]:02X}{rgb[1]:02X}{rgb[2]:02X}"
    fill = PatternFill("solid", fgColor=hx)
    font = Font(bold=bold, color=fc, size=size)
    return fill, font


# Δ Pred−Stor (Accuracy): sequenza navy → … → crema (9 fermate, negativo → positivo)
_DELTA9_SEQ = (
    (0, 32, 46),       # #00202E
    (0, 63, 92),       # #003F5C
    (44, 72, 117),     # #2C4875
    (138, 80, 143),    # #8A508F
    (188, 80, 144),    # #BC5090
    (255, 99, 97),     # #FF6361
    (255, 133, 49),    # #FF8531
    (255, 166, 0),     # #FFA600
    (255, 211, 128),   # #FFD380
)


def _rgb_delta_accuracy_9_sequential(t: float) -> tuple[int, int, int]:
    """t in [-1, 1]: da Pred≪Stor (sinistra, navy) a Pred≫Stor (destra, crema)."""
    t = max(-1.0, min(1.0, t))
    n = len(_DELTA9_SEQ)
    anchors: list[tuple[float, tuple[int, int, int]]] = [
        (-1.0 + 2.0 * i / (n - 1), _DELTA9_SEQ[i]) for i in range(n)
    ]
    for i in range(len(anchors) - 1):
        t_a, rgb_a = anchors[i]
        t_b, rgb_b = anchors[i + 1]
        if t <= t_b:
            span = t_b - t_a
            u = 0.0 if abs(span) < 1e-12 else (t - t_a) / span
            u = max(0.0, min(1.0, u))
            return _lerp_rgb(rgb_a, rgb_b, u)
    t_a, rgb_a = anchors[-2]
    t_b, rgb_b = anchors[-1]
    span = t_b - t_a
    u = 0.0 if abs(span) < 1e-12 else (t - t_a) / span
    u = max(0.0, min(1.0, u))
    return _lerp_rgb(rgb_a, rgb_b, u)


def _text_on_delta_9_rgb(rgb: tuple[int, int, int]) -> str:
    lum = _relative_luminance(rgb)
    if lum < 156:
        return "FFFFFF"
    if lum > 198:
        return "1A237E"
    return "212121"


def delta_pp_accuracy_sequential_9_fill_font(
    value,
    *,
    max_abs: float = 40.0,
    size: int = 9,
    bold_threshold: float = 5.0,
) -> tuple[PatternFill | None, Font | None]:
    """
    Differenza **Pred % − Stor %** (Accuracy): gradiente **sequenziale** a 9 colori
    (#00202E → #003F5C → #2C4875 → #8A508F → #BC5090 → #FF6361 → #FF8531 → #FFA600 → #FFD380),
    con ``value / max_abs`` in [-1, 1]. Vicino a zero (~|v| < 0,12 pp) → colore a t=0 sulla scala.
    """
    if value is None:
        return None, None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None, None

    if max_abs <= 0:
        max_abs = 40.0

    if abs(v) < 0.12:
        rgb = _rgb_delta_accuracy_9_sequential(0.0)
        bold = False
    else:
        t = max(-1.0, min(1.0, v / max_abs))
        rgb = _rgb_delta_accuracy_9_sequential(t)
        bold = abs(v) >= bold_threshold

    fc = _text_on_delta_9_rgb(rgb)
    hx = f"{rgb[0]:02X}{rgb[1]:02X}{rgb[2]:02X}"
    fill = PatternFill("solid", fgColor=hx)
    font = Font(bold=bold, color=fc, size=size)
    return fill, font


# ── Accuracy Δ% Pred−Stor: blu (neg) → turchese / menta → beige (~0) → crema → giallo (pos) ──
# Sfumature: #1976D2 #5FA9C9 #AFCFC0 — neutro #F5F5DC — #E8E3C0 #FFC107
_DELTA_ACC_BY_SEQ: list[tuple[float, tuple[int, int, int]]] = [
    (-1.0, (25, 118, 210)),      # #1976D2
    (-0.55, (95, 169, 201)),     # #5FA9C9
    (-0.22, (175, 207, 192)),    # #AFCFC0
    (0.0, (245, 245, 220)),      # #F5F5DC (beige-bianco ≈ 0)
    (0.35, (232, 227, 192)),     # #E8E3C0
    (1.0, (255, 193, 7)),        # #FFC107
]


def _rgb_delta_accuracy_blue_beige_yellow(t: float) -> tuple[int, int, int]:
    """t in [-1, 1]: Pred ≪ Stor (blu) … neutro beige … Pred ≫ Stor (giallo)."""
    t = max(-1.0, min(1.0, float(t)))
    anchors = _DELTA_ACC_BY_SEQ
    if t <= anchors[0][0]:
        return anchors[0][1]
    for i in range(len(anchors) - 1):
        t_a, c_a = anchors[i]
        t_b, c_b = anchors[i + 1]
        if t <= t_b:
            span = t_b - t_a
            u = 0.0 if abs(span) < 1e-12 else (t - t_a) / span
            return _lerp_rgb(c_a, c_b, max(0.0, min(1.0, u)))
    return anchors[-1][1]


def _text_on_delta_acc_blue_beige_yellow(rgb: tuple[int, int, int]) -> str:
    """Contrasto elevato su blu saturo, beige chiaro e giallo Material."""
    lum = _relative_luminance(rgb)
    r, g, b = rgb
    if lum < 152 or (b > max(r, g) + 28 and r < 130):
        return "FFFFFF"
    if r > 238 and g > 185 and b < 100:
        return "212121"
    if lum > 215 and r > 220 and g > 215:
        return "263238"
    return "212121"


def delta_pp_accuracy_blue_beige_yellow_fill_font(
    value,
    *,
    max_abs: float = 40.0,
    size: int = 9,
    bold_threshold: float = 5.0,
) -> tuple[PatternFill | None, Font | None]:
    """
    Differenza **Pred % − Stor %** (foglio Accuracy): gradiente **blu → beige → giallo**
    con neutro **#F5F5DC** a ~0; estremi **#1976D2** (molto negativo) e **#FFC107** (molto positivo),
    passando da **#5FA9C9**, **#AFCFC0**, **#E8E3C0**. ``value / max_abs`` mappa in [-1, 1].
    """
    if value is None:
        return None, None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None, None

    if max_abs <= 0:
        max_abs = 40.0

    if abs(v) < 0.12:
        rgb = _DELTA_ACC_BY_SEQ[3][1]
        bold = False
    else:
        t = max(-1.0, min(1.0, v / max_abs))
        rgb = _rgb_delta_accuracy_blue_beige_yellow(t)
        bold = abs(v) >= bold_threshold

    fc = _text_on_delta_acc_blue_beige_yellow(rgb)
    hx = f"{rgb[0]:02X}{rgb[1]:02X}{rgb[2]:02X}"
    fill = PatternFill("solid", fgColor=hx)
    font = Font(bold=bold, color=fc, size=size)
    return fill, font


# Legacy: giallo/bianco/blu (mantenuta per compatibilità o script)
_YWB_NEU = (255, 255, 255)
_YWB_YEL_END = (234, 179, 8)    # ambra leggibile, non fluorescente (#E6B308)
_YWB_BLU_END = (25, 118, 210)   # blu Material 700 (#1976D2)


def _diverging_ywB_text_color(rgb: tuple[int, int, int]) -> str:
    """Testo leggibile su sfondo giallo chiaro / bianco / blu."""
    lum = _relative_luminance(rgb)
    if lum < 158:
        return "FFFFFF"
    r, g, b = rgb
    if r > 228 and g > 200 and b < 210:
        return "3E2723"
    return "212121"


def delta_pp_yellow_white_blue_fill_font(
    value,
    *,
    max_abs: float = 40.0,
    size: int = 9,
    bold_threshold: float = 5.0,
) -> tuple[PatternFill | None, Font | None]:
    """
    Differenza **Pred % − Stor %** (stessa unità numerica dei nodi in foglio): **blu** (Pred < Stor),
    **bianco** (~0), **giallo/ambra** (Pred > Stor). Gradiente ``smoothstep`` su |valore| / ``max_abs``.

    Separato dalla scala **a 5 colori** (Pred/Storico su ``signed_pct_fill_font_accuracy_5stop``) così il segno della Δ si legge
    con hue diverso (utile con astigmatismo o affiancamento ai due blocchi Pred/Stor).
    """
    if value is None:
        return None, None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None, None

    if max_abs <= 0:
        max_abs = 40.0

    if abs(v) < 0.12:
        rgb = _YWB_NEU
        fc = _diverging_ywB_text_color(rgb)
        bold = False
    elif v > 0:
        u = _smoothstep(min(1.0, v / max_abs))
        rgb = _lerp_rgb(_YWB_NEU, _YWB_YEL_END, u)
        bold = abs(v) >= bold_threshold
        fc = _diverging_ywB_text_color(rgb)
    else:
        u = _smoothstep(min(1.0, (-v) / max_abs))
        rgb = _lerp_rgb(_YWB_NEU, _YWB_BLU_END, u)
        bold = abs(v) >= bold_threshold
        fc = _diverging_ywB_text_color(rgb)

    hx = f"{rgb[0]:02X}{rgb[1]:02X}{rgb[2]:02X}"
    fill = PatternFill("solid", fgColor=hx)
    font = Font(bold=bold, color=fc, size=size)
    return fill, font


def signed_pct_fill_font(
    value,
    *,
    max_abs: float = 20.0,
    muted: bool = False,
    muted_amount: float = 0.28,
    size: int = 10,
    bold_threshold: float = 5.0,
) -> tuple[PatternFill | None, Font | None]:
    """
    Ritorna (PatternFill, Font) per una cella con variazione % (punti percentuali, es. +3.2 = +3.2%).

    muted: attenua i colori (es. righe catalyst / contesti secondari).
    """
    if value is None:
        return None, None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None, None

    if max_abs <= 0:
        max_abs = 20.0

    if abs(v) < 0.02:
        rgb = _NEU
        fc = "424242"
        bold = False
    elif v > 0:
        u = _smoothstep(min(1.0, v / max_abs))
        rgb = _lerp_rgb(_GAIN_A, _GAIN_B, u)
        bold = abs(v) >= bold_threshold
        if _relative_luminance(rgb) < 145:
            fc = "FFFFFF"
        else:
            fc = "5D4037" if u < 0.55 else "BF360C"
    else:
        u = _smoothstep(min(1.0, (-v) / max_abs))
        rgb = _lerp_rgb(_LOSS_A, _LOSS_B, u)
        bold = abs(v) >= bold_threshold
        if _relative_luminance(rgb) < 145:
            fc = "FFFFFF"
        else:
            fc = "0D47A1" if u < 0.55 else "01579B"

    if muted:
        rgb = _blend_rgb(rgb, (236, 239, 241), muted_amount)
        lum = _relative_luminance(rgb)
        if lum < 140:
            fc = "FFFFFF"
        elif fc == "FFFFFF":
            fc = "424242"

    hx = f"{rgb[0]:02X}{rgb[1]:02X}{rgb[2]:02X}"
    fill = PatternFill("solid", fgColor=hx)
    font = Font(bold=bold and not muted, color=fc, size=size)
    return fill, font


def linear_rgb_diverging(t: float) -> str:
    """
    Gradiente colonna (t in [0,1]): t=0 blu (basso), t=0.5 neutro, t=1 ambra (alto).
    Alternativa al rosso↔verde per heatmap.
    """
    t = max(0.0, min(1.0, t))
    if t <= 0.5:
        u = _smoothstep(t * 2.0)
        rgb = _lerp_rgb(_LOSS_B, _NEU, u)
    else:
        u = _smoothstep((t - 0.5) * 2.0)
        rgb = _lerp_rgb(_NEU, _GAIN_B, u)
    return f"{rgb[0]:02X}{rgb[1]:02X}{rgb[2]:02X}"


if __name__ == "__main__":
    # Invocabile come: python variation_colors.py - anteprima campioni (Excel fgColor)

    def _fg_hex_6(fill):
        """openpyxl espone spesso ARGB ('005883C1'); in Excel si usa RRGGBB ('5883C1')."""
        if not fill or not getattr(fill, "fgColor", None):
            return "—"
        raw = getattr(fill.fgColor, "rgb", None) or fill.fgColor
        s = "".join(c for c in str(raw).upper() if c in "0123456789ABCDEF")
        if len(s) >= 8:
            return s[-6:]
        if len(s) == 6:
            return s
        return str(raw)

    print("variation_colors - campioni var.% (max_abs=20 default)\n")
    for v in (-12.0, 0.0, 8.0):
        f, _fo = signed_pct_fill_font(v)
        print(f"  signed_pct_fill_font({v:+.1f})  ->  fgColor RRGGBB={_fg_hex_6(f)}")
    print()
    for v in (-10.0, 3.0):
        f, _fo = signed_pct_fill_font_gwr(v, max_abs=25.0)
        print(f"  signed_pct_fill_font_gwr({v:+.1f})   ->  fgColor RRGGBB={_fg_hex_6(f)}")
    print()
    for v in (-40.0, -10.0, 0.0, 10.0, 40.0):
        f, _fo = signed_pct_fill_font_accuracy_5stop(v, max_abs=40.0)
        print(f"  accuracy_5stop({v:+.1f})  ->  fgColor RRGGBB={_fg_hex_6(f)}")
    print()
    for v in (-6.0, 0.05, 5.0):
        f, fo = delta_pp_blue_white_rose_fill_font(v, max_abs=25.0)
        print(f"  delta_pp_rwG({v:+.2f})  fill={_fg_hex_6(f)}  font={getattr(fo, 'color', None)}")
    print()
    for v in (-25.0, 0.0, 15.0):
        f, fo = delta_pp_accuracy_blue_beige_yellow_fill_font(v, max_abs=25.0)
        print(f"  delta_acc_bby({v:+.1f})  fill={_fg_hex_6(f)}")
    print()
    for v in (-8.0, 0.0, 6.0):
        f, fo = delta_pp_yellow_white_blue_fill_font(v, max_abs=25.0)
        print(f"  delta_pp_ywB({v:+.2f})  fill={_fg_hex_6(f)}  font={getattr(fo, 'color', None)}")
    print()
    print("linear_rgb_diverging(t):", [linear_rgb_diverging(t) for t in (0.0, 0.5, 1.0)])
    print(
        "\nQuesto file è solo la demo colori. Pipeline completa: "
        "python -u data_orchestrator.py   oppure   supernova_desk.py (Aggiorna ora)."
    )
