"""Genera anteprima HTML standalone delle sparkline aggiornate.

Replica la logica di SimulationSparkline.tsx in puro HTML/SVG così l'utente
puo' vedere immediatamente come appaiono le nuove curve per i ticker di
portafoglio senza dover riavviare Electron.
"""
from __future__ import annotations

import io
import json
import sys
from datetime import date
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BUNDLE = Path("data/simulation_charts_snapshot.json")
OUT = Path("desktop-ui/sparkline_preview.html")

TICKERS = ["OLMA", "BCAB", "ANIK", "PBYI", "BNTX", "CLRB"]
TODAY = date.today().isoformat()

# Stile coerente con SimulationSparkline.tsx
WIDTH = 220        # larghezza preview (originale tabella 72)
HEIGHT = 90        # altezza
PAD_X = 8
PAD_Y = 10
FWD_TH = 0.10      # soglia trend forward (pp)


def _read_bundle() -> dict:
    return json.loads(BUNDLE.read_text(encoding="utf-8"))


def _series_key_match(series_keys, ticker: str):
    candidates = [k for k in series_keys if k.startswith(f"co:{ticker}|")]
    return candidates[0] if candidates else None


def _dense_points(points):
    out = []
    for p in points:
        if p.get("nodo") not in (None, "standard"):
            continue
        off = p.get("offset")
        if off is None:
            continue
        mod = p.get("pct_modello")
        if mod is None:
            mod = p.get("pct_curva")
        rea = p.get("pct_reale")
        out.append({"offset": off, "modello": mod, "reale": rea})
    out = [x for x in out if x["modello"] is not None]
    out.sort(key=lambda x: x["offset"])
    return out


def _now_offset_from_cd(cd_iso: str) -> float | None:
    try:
        cd = date.fromisoformat(cd_iso)
    except Exception:
        return None
    today = date.fromisoformat(TODAY)
    return (today - cd).days


def _x_for_offset(off: float, min_off: float, max_off: float) -> float:
    if max_off == min_off:
        return WIDTH / 2
    t = (off - min_off) / (max_off - min_off)
    return PAD_X + t * (WIDTH - 2 * PAD_X)


def _y_for_val(val: float, vmin: float, rng: float) -> float:
    return PAD_Y + (1 - (val - vmin) / rng) * (HEIGHT - 2 * PAD_Y)


def _interp(pts, x_target):
    # pts: list of {offset, val}
    if not pts:
        return None
    if x_target <= pts[0]["offset"]:
        return pts[0]["val"]
    if x_target >= pts[-1]["offset"]:
        return pts[-1]["val"]
    for a, b in zip(pts, pts[1:]):
        if a["offset"] <= x_target <= b["offset"]:
            t = (x_target - a["offset"]) / (b["offset"] - a["offset"])
            return a["val"] + t * (b["val"] - a["val"])
    return None


def _trend_color(delta_pp: float | None) -> str:
    if delta_pp is None:
        return "#9ca3af"   # ink-muted
    if delta_pp >= FWD_TH:
        return "#10b981"   # signal-up (verde)
    if delta_pp <= -FWD_TH:
        return "#ef4444"   # signal-down (rosso)
    return "#9ca3af"


def render_sparkline(ticker: str, cd_iso: str, pts: list) -> str:
    modelo_pts = [{"offset": p["offset"], "val": p["modello"]} for p in pts]
    reale_pts = [{"offset": p["offset"], "val": p["reale"]}
                 for p in pts if p["reale"] is not None]

    all_vals = [p["val"] for p in modelo_pts] + [p["val"] for p in reale_pts] + [0]
    vmin = min(all_vals)
    vmax = max(all_vals)
    rng = vmax - vmin or 0.01

    min_off = min(p["offset"] for p in modelo_pts)
    max_off = max(p["offset"] for p in modelo_pts)

    model_poly = " ".join(
        f"{_x_for_offset(p['offset'], min_off, max_off):.1f},"
        f"{_y_for_val(p['val'], vmin, rng):.1f}"
        for p in modelo_pts
    )
    reale_poly = (
        " ".join(
            f"{_x_for_offset(p['offset'], min_off, max_off):.1f},"
            f"{_y_for_val(p['val'], vmin, rng):.1f}"
            for p in reale_pts
        )
        if len(reale_pts) >= 2
        else None
    )

    zero_y = _y_for_val(0, vmin, rng)
    zero_in = PAD_Y < zero_y < HEIGHT - PAD_Y

    now_off = _now_offset_from_cd(cd_iso)
    now_x = now_y = None
    fwd_delta = None
    if now_off is not None:
        clamped = max(min_off, min(max_off, now_off))
        now_x = _x_for_offset(clamped, min_off, max_off)
        now_val = _interp(modelo_pts, clamped)
        if now_val is not None:
            now_y = _y_for_val(now_val, vmin, rng)
            last_val = modelo_pts[-1]["val"]
            if clamped < max_off:
                fwd_delta = last_val - now_val

    color = _trend_color(fwd_delta)

    parts = [
        f"Curva modello ricalibrato per {ticker}",
        f"oggi a {now_off:+d}gg da CD" if now_off is not None else "",
        f"trend forward {fwd_delta:+.2f}pp" if fwd_delta is not None else "",
    ]
    label = " · ".join(p for p in parts if p)

    svg = [
        f'<svg width="{WIDTH}" height="{HEIGHT}" '
        'style="background:#111827;border:1px solid #1f2937;border-radius:6px;overflow:visible;" '
        f'role="img" aria-label="{label}">',
        f'<title>{label}</title>',
    ]
    # zero line
    if zero_in:
        svg.append(
            f'<line x1="{PAD_X}" x2="{WIDTH-PAD_X}" y1="{zero_y:.1f}" '
            f'y2="{zero_y:.1f}" stroke="#9ca3af" stroke-width="0.6" '
            'stroke-dasharray="3 3" opacity="0.4" />'
        )
    # prezzo reale storico
    if reale_poly:
        svg.append(
            f'<polyline points="{reale_poly}" fill="none" stroke="#9ca3af" '
            'stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round" '
            'opacity="0.55" />'
        )
    # curva modello ricalibrato
    svg.append(
        f'<polyline points="{model_poly}" fill="none" stroke="{color}" '
        'stroke-width="2" stroke-linejoin="round" stroke-linecap="round" '
        'opacity="0.95" />'
    )
    # now marker
    if now_x is not None and now_y is not None:
        svg.append(
            f'<line x1="{now_x:.1f}" x2="{now_x:.1f}" y1="{PAD_Y}" '
            f'y2="{HEIGHT-PAD_Y}" stroke="#fbbf24" stroke-width="1" '
            'stroke-dasharray="2 2" opacity="0.8" />'
        )
        svg.append(
            f'<circle cx="{now_x:.1f}" cy="{now_y:.1f}" r="2.5" '
            'fill="#fbbf24" stroke="#111827" stroke-width="0.8" />'
        )

    # X-axis labels
    svg.append(
        f'<text x="{PAD_X}" y="{HEIGHT - 1}" font-size="8" fill="#6b7280">'
        f'T{min_off:+d}</text>'
    )
    svg.append(
        f'<text x="{WIDTH-PAD_X-12}" y="{HEIGHT - 1}" font-size="8" fill="#6b7280">'
        f'T{max_off:+d}</text>'
    )
    svg.append('</svg>')

    return "\n".join(svg), {
        "now_off": now_off,
        "fwd_delta": fwd_delta,
        "color": color,
        "vmin": vmin,
        "vmax": vmax,
    }


def main():
    bundle = _read_bundle()
    series = bundle.get("series", {})
    cards = []

    for ticker in TICKERS:
        sk = _series_key_match(series, ticker)
        if not sk:
            cards.append(
                f'<div class="card"><h3>{ticker}</h3>'
                '<p class="muted">Serie non trovata nel bundle.</p></div>'
            )
            continue
        cd_iso = sk.split("|", 1)[1]
        pts = _dense_points(series[sk]["points"])
        svg, info = render_sparkline(ticker, cd_iso, pts)
        verdict_color = info["color"]
        verdict_txt = (
            "🟢 Verde — trend forward UP"
            if info["fwd_delta"] is not None and info["fwd_delta"] >= FWD_TH
            else "🔴 Rosso — trend forward DOWN"
            if info["fwd_delta"] is not None and info["fwd_delta"] <= -FWD_TH
            else "⚪ Grigio — piatto/incerto"
        )
        cards.append(
            f'''<div class="card">
  <h3>{ticker} <span class="muted">CD {cd_iso}</span></h3>
  {svg}
  <div class="meta">
    <div>Oggi a CD: <b>{info["now_off"]:+d}gg</b></div>
    <div>Trend forward: <b style="color:{verdict_color}">'''
            + (f'{info["fwd_delta"]:+.2f}pp' if info["fwd_delta"] is not None else "n/d")
            + f'''</b></div>
    <div>Range curva: <b>{info["vmin"]:.2f}% .. {info["vmax"]:.2f}%</b></div>
    <div class="verdict" style="color:{verdict_color}">{verdict_txt}</div>
  </div>
</div>'''
        )

    html = f'''<!doctype html>
<html lang="it"><head>
<meta charset="utf-8" />
<title>Sparkline preview — curva modello ricalibrato</title>
<style>
  body {{
    background: #030712; color: #e5e7eb;
    font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif;
    margin: 24px; line-height: 1.5;
  }}
  h1 {{ margin: 0 0 4px; }}
  h2 {{ margin: 24px 0 12px; color: #f9fafb; }}
  p.intro {{ color: #9ca3af; max-width: 820px; }}
  .legend {{
    background: #111827; padding: 12px 14px; border-radius: 8px;
    border: 1px solid #1f2937; margin: 12px 0 24px; max-width: 820px;
  }}
  .legend code {{ background: #1f2937; padding: 1px 4px; border-radius: 3px; }}
  .grid {{
    display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 16px;
  }}
  .card {{
    background: #111827; border: 1px solid #1f2937;
    border-radius: 10px; padding: 14px;
  }}
  .card h3 {{ margin: 0 0 8px; font-size: 14px; }}
  .card .muted {{ color: #6b7280; font-weight: normal; font-size: 11px; }}
  .meta {{ font-size: 11px; color: #9ca3af; margin-top: 8px; }}
  .meta b {{ color: #e5e7eb; }}
  .meta .verdict {{ margin-top: 4px; font-weight: 600; }}
  .swatch {{
    display: inline-block; width: 24px; height: 8px; vertical-align: middle;
    margin: 0 4px; border-radius: 2px;
  }}
</style>
</head><body>
<h1>Anteprima sparkline aggiornata — curva modello ricalibrato</h1>
<p class="intro">
  Replica esattamente quello che vedrai nella colonna <b>Curva</b> della tabella
  <b>Tuo Portafoglio</b> dopo aver riavviato l'app. Sostituisce la vecchia
  sparkline che mostrava prezzi storici. Sorgente dati:
  <code>data/simulation_charts_snapshot.json</code> · campo <code>pct_modello</code>
  (curva del modello v4 ricalibrato con input storici 8-K + prezzi).
</p>
<div class="legend">
  <div><span class="swatch" style="background:#10b981"></span> Verde · trend forward (da oggi a CD) ≥ +0.10pp</div>
  <div><span class="swatch" style="background:#ef4444"></span> Rosso · trend forward ≤ −0.10pp</div>
  <div><span class="swatch" style="background:#9ca3af"></span> Grigio · piatto / incerto</div>
  <div><span class="swatch" style="background:#9ca3af;opacity:0.55"></span> Linea grigia chiara di sfondo · prezzo reale storico (<code>pct_reale</code>)</div>
  <div>Linea tratteggiata gialla · marker "oggi" sulla curva pred</div>
  <div>Linea tratteggiata grigia orizzontale · baseline 0% (riferimento Pred−60)</div>
</div>
<h2>Ticker del tuo portafoglio</h2>
<div class="grid">
{chr(10).join(cards)}
</div>
<p class="intro" style="margin-top: 24px;">
  Generato da <code>scripts/_gen_sparkline_preview.py</code> il {TODAY}.
  Per vedere queste curve nell'app: riavvia <code>Avvia_UI.bat</code> oppure
  premi <kbd>Ctrl+R</kbd> nella finestra Electron per ricaricare.
</p>
</body></html>'''

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    print(f"OK -> {OUT.resolve()}")


if __name__ == "__main__":
    main()
