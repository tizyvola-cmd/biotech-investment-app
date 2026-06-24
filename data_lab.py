"""
Data Lab — vista desktop per ``model_calibration_state.json``.

GUI Tkinter + matplotlib (TkAgg). Palette: #1C1C1C / #00C896 / #C8FF00.
Compatibile con Python 3.11+.

- ``DataLabPanel``: ``tk.Frame`` da incorporare (es. in ``SuperNovaDesk``).
- ``DataLabWindow``: finestra standalone.

Uso standalone::

    from data_lab import DataLabWindow
    DataLabWindow().run()

Oppure::

    python data_lab.py
"""
from __future__ import annotations

import json
import os
import threading
from datetime import datetime
from pathlib import Path
from typing import Any

import tkinter as tk
from tkinter import ttk

import orchestrator_io_paths as _paths

try:
    import matplotlib

    matplotlib.use("TkAgg")
    from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
    from matplotlib.figure import Figure

    _HAVE_MPL = True
except ImportError:
    matplotlib = None  # type: ignore[assignment]
    FigureCanvasTkAgg = None  # type: ignore[misc, assignment]
    Figure = None  # type: ignore[misc, assignment]
    _HAVE_MPL = False

__all__ = (
    "DataLabPanel",
    "DataLabWindow",
    "apply_datalab_ttk_styles",
    "BG",
    "DEFAULT_JSON",
)

# --- Palette (mockup Data Lab) -------------------------------------------------
BG = "#1C1C1C"
BG_PANEL = "#252525"
ACCENT = "#00C896"
LIME = "#C8FF00"
TEXT = "#e8e8e8"
TEXT_MUTED = "#9ca3af"
GRID = "#3f3f3f"

DEFAULT_JSON = Path(_paths.DATA_DIR) / "model_calibration_state.json"

_SIDEBAR_SECTIONS = (
    "Ristretta CD±7",
    "Calibration State",
    "Sequential Curve",
    "CAR Curves",
    "Prediction Engine",
)

_REF_COLORS = {
    "Cluster 0": "#9ca3af",
    "SuperNova (cl.1)": LIME,
    "Post-CD rialzo": ACCENT,
    "Post-CD ribasso": "#fb7185",
}


def _ts() -> str:
    return datetime.now().strftime("%H:%M:%S")


def _safe_float(x: Any) -> float | None:
    if x is None:
        return None
    try:
        v = float(x)
        return v if v == v else None
    except (TypeError, ValueError):
        return None


def _median_series(med: dict[str, Any] | None) -> tuple[list[float], list[float]]:
    if not isinstance(med, dict) or not med:
        return [], []
    xs: list[tuple[float, float]] = []
    for k, v in med.items():
        xf = _safe_float(k)
        yf = _safe_float(v)
        if xf is None or yf is None:
            continue
        xs.append((xf, yf))
    xs.sort(key=lambda t: t[0])
    return [a for a, _ in xs], [b for _, b in xs]


def _result_from_inflection(inf: str) -> str:
    if not inf or inf.strip() in ("—", "-", "N/D", "n/d"):
        return "—"
    s = inf.strip()
    if s.startswith("(+)"):
        return "Success"
    if s.startswith("(-)"):
        return "Failure"
    return "Neutral"


def _unwrap_state(doc: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(doc, dict):
        return {}
    cur = doc.get("current")
    if isinstance(cur, dict) and cur:
        return cur
    return doc


def _latest_cal_factor_from_history(doc: dict[str, Any]) -> dict[str, float]:
    hist = doc.get("history")
    if not isinstance(hist, list):
        return {}
    for entry in reversed(hist):
        if not isinstance(entry, dict):
            continue
        cf = entry.get("cal_factor")
        if isinstance(cf, dict) and cf:
            out: dict[str, float] = {}
            for k, v in cf.items():
                fv = _safe_float(v)
                if fv is not None:
                    out[str(k)] = fv
            return out
    return {}


def apply_datalab_ttk_styles(master: tk.Misc) -> ttk.Style:
    """Applica tema ttk coerente col Data Lab (clam + colori scuri)."""
    style = ttk.Style(master)
    try:
        style.theme_use("clam")
    except Exception:
        pass
    style.configure(".", background=BG, foreground=TEXT)
    style.configure("TFrame", background=BG)
    style.configure("TLabelframe", background=BG_PANEL, foreground=ACCENT)
    style.configure("TLabelframe.Label", background=BG_PANEL, foreground=ACCENT)
    style.configure("TLabel", background=BG, foreground=TEXT)
    style.configure("TButton", padding=6)
    style.map(
        "TButton",
        background=[("active", ACCENT), ("!disabled", BG_PANEL)],
        foreground=[("!disabled", TEXT)],
    )
    style.configure(
        "Treeview",
        background=BG_PANEL,
        fieldbackground=BG_PANEL,
        foreground=TEXT,
        rowheight=22,
    )
    style.map(
        "Treeview",
        background=[("selected", ACCENT)],
        foreground=[("selected", "#0a0a0a")],
    )
    style.configure("TCheckbutton", background=BG, foreground=TEXT)
    style.configure("TRadiobutton", background=BG, foreground=TEXT)
    style.configure("TEntry", fieldbackground=BG_PANEL, foreground=TEXT)
    return style


class DataLabPanel(tk.Frame):
    """
    Pannello Data Lab (sidebar, grafici matplotlib, tabella, note, console calibrazione).

    :param show_header: se True, mostra barra titolo interna + «Ricarica JSON» (finestra standalone).
    """

    def __init__(
        self,
        master: tk.Misc,
        *,
        json_path: str | Path | None = None,
        show_header: bool = True,
    ) -> None:
        super().__init__(master, bg=BG)
        self._json_path = Path(json_path) if json_path else DEFAULT_JSON
        self._raw_doc: dict[str, Any] = {}
        self._state: dict[str, Any] = {}
        self._section = tk.StringVar(value=_SIDEBAR_SECTIONS[0])
        self._table_rows: list[tuple[str, str, str, str, str]] = []
        self._ristretta_bundle: dict[str, Any] | None = None
        self._ristretta_loading = False
        self._ristretta_sel: int | None = None
        self._sidebar_btns: dict[str, tk.Button] = {}
        self._chart_mode = tk.StringVar(value="curves")

        self._fig: Any = None
        self._canvas: Any = None
        self._ax_line = None
        self._ax_bar = None
        self._log: tk.Text | None = None

        self._build_ui(show_header=show_header)
        self.after(200, self.load_ristretta_async)

    def load_ristretta_async(self) -> None:
        if self._ristretta_loading:
            return
        self._ristretta_loading = True
        self.log_event("Caricamento coorte Ristretta (past_pred + μ riferimento)…", tag="info")

        def _worker() -> None:
            try:
                from ristretta_lab_data import build_ristretta_bundle

                bundle = build_ristretta_bundle()
                self.after(0, lambda b=bundle: self._apply_ristretta_bundle(b))
            except Exception as exc:
                self.after(
                    0,
                    lambda e=exc: self._ristretta_load_failed(str(e)),
                )

        threading.Thread(target=_worker, daemon=True).start()

    def _ristretta_load_failed(self, err: str) -> None:
        self._ristretta_loading = False
        self.log_event(f"Ristretta: {err}", tag="err")
        if self._section.get() == "Ristretta CD±7":
            self.update_charts()

    def _apply_ristretta_bundle(self, bundle: dict[str, Any]) -> None:
        self._ristretta_loading = False
        self._ristretta_bundle = bundle
        n = int(bundle.get("n_cohort") or 0)
        note = str(bundle.get("note") or "").strip()
        msg = f"Ristretta: {n} studi in finestra CD±7"
        if note:
            msg += f" — {note}"
        self.log_event(msg, tag="ok" if n else "info")
        if self._section.get() == "Ristretta CD±7":
            self._table_rows = self._build_ristretta_table_rows(bundle)
            self._fill_tree()
            self._fill_ristretta_notes(bundle)
            self.update_charts()

    def _build_ristretta_table_rows(
        self, bundle: dict[str, Any]
    ) -> list[tuple[str, str, str, str, str]]:
        rows: list[tuple[str, str, str, str, str]] = []
        for c in bundle.get("companies") or []:
            tk = getattr(c, "ticker", "") or "?"
            nm = getattr(c, "company", tk) or tk
            cd = getattr(c, "cd", None)
            cd_s = cd.isoformat() if cd is not None else "—"
            d = str(getattr(c, "direction", "—") or "—")
            days = getattr(c, "days_to_cd", None)
            if days is not None:
                d = f"{d} (J{int(days):+d})"
            rmse = getattr(c, "rmse_pp", None)
            rmse_s = f"{float(rmse):.2f}%" if rmse is not None else "—"
            res = str(getattr(c, "result", "—") or "—")
            label = nm if len(nm) <= 28 else nm[:25] + "…"
            rows.append((f"{tk} · {label}", cd_s, d, rmse_s, res))
        return rows

    def _fill_ristretta_notes(self, bundle: dict[str, Any]) -> None:
        if not hasattr(self, "_notes_text"):
            return
        lines = [
            f"Coorte Ristretta · {bundle.get('loaded_at', '—')}",
            f"Studi in finestra: {bundle.get('n_cohort', 0)}",
            f"Offset tabella: {bundle.get('offsets', [])}",
            "",
            "Curve riferimento:",
        ]
        for name in bundle.get("references") or {}:
            lines.append(f"  • {name}")
        note = str(bundle.get("note") or "").strip()
        if note:
            lines.extend(["", note])
        self._notes_text.delete("1.0", "end")
        self._notes_text.insert("1.0", "\n".join(lines))

    def load_data(self) -> bool:
        """Carica ``model_calibration_state.json``; aggiorna tabella, parametri e grafici."""
        path = self._json_path
        try:
            if not path.is_file():
                self._raw_doc = {}
                self._state = {}
                self._table_rows = []
                self.log_event(f"File assente: {path}", tag="err")
                self._fill_params_panel()
                self._fill_tree()
                self.update_charts()
                return False
            text = path.read_text(encoding="utf-8")
            self._raw_doc = json.loads(text) if text.strip() else {}
        except (OSError, json.JSONDecodeError) as exc:
            self._raw_doc = {}
            self._state = {}
            self._table_rows = []
            self.log_event(f"Errore lettura JSON: {exc}", tag="err")
            self._fill_params_panel()
            self._fill_tree()
            self.update_charts()
            return False

        self._state = _unwrap_state(self._raw_doc)
        if self._section.get() != "Ristretta CD±7":
            self._table_rows = self._build_table_rows(self._state)
        self.log_event(f"Calibrazione caricata: {path.name}", tag="ok")
        self._fill_params_panel()
        self._fill_tree()
        self.update_charts()
        self.load_ristretta_async()
        return True

    def update_charts(self) -> None:
        if self._ax_line is None or self._ax_bar is None or self._canvas is None:
            return
        sec = self._section.get()
        self._ax_line.clear()
        self._ax_bar.clear()
        for ax in (self._ax_line, self._ax_bar):
            ax.set_facecolor(BG_PANEL)
            ax.tick_params(colors=TEXT_MUTED, labelsize=8)
            ax.grid(True, color=GRID, alpha=0.35)
            ax.set_axis_on()

        if sec == "Ristretta CD±7":
            self._plot_ristretta_charts()
            return

        curves = self._state.get("curves") if isinstance(self._state, dict) else {}
        car = self._state.get("car_curves_v1") if isinstance(self._state, dict) else {}
        cal = self._state.get("cal_factor") if isinstance(self._state, dict) else {}
        if not isinstance(cal, dict) or not cal:
            cal = _latest_cal_factor_from_history(self._raw_doc)

        ver = "v4_options"
        if sec == "CAR Curves":
            src = car if isinstance(car, dict) else {}
            title = "CAR vs XBI (mediane di coorte)"
        elif sec == "Sequential Curve":
            self._ax_line.text(
                0.5,
                0.5,
                "Curva sequenziale (seq_curve_*)\nè prodotta a run-time in past_pred / Simulation.\n"
                "Qui: vedi Calibration / CAR per lo stato JSON.",
                ha="center",
                va="center",
                transform=self._ax_line.transAxes,
                color=TEXT_MUTED,
                fontsize=10,
                wrap=True,
            )
            self._ax_line.set_axis_off()
            self._ax_bar.set_axis_off()
            self._canvas.draw_idle()
            return
        elif sec == "Prediction Engine":
            self._plot_cal_factor_bars(self._ax_line, cal)
            self._ax_line.set_title("cal_factor per versione", color=ACCENT, fontsize=10)
            self._ax_bar.set_axis_off()
            self._canvas.draw_idle()
            return
        else:
            src = curves if isinstance(curves, dict) else {}
            title = "Curve empiriche % (mediane · " + ver + ")"

        block = src.get(ver) if isinstance(src, dict) else None
        if not isinstance(block, dict):
            self._ax_line.text(
                0.5,
                0.5,
                "Nessun blocco curve per questa sezione.\nEsegui un refresh calibrazione.",
                ha="center",
                va="center",
                transform=self._ax_line.transAxes,
                color=TEXT_MUTED,
                fontsize=10,
            )
            self._ax_line.set_axis_off()
            self._ax_bar.set_axis_off()
            self._canvas.draw_idle()
            return

        colors = {"success": ACCENT, "failure": "#fb7185", "neutral": "#fbbf24", "control": LIME}
        labels_en = {"success": "Success", "failure": "Failure", "neutral": "Neutral", "control": "Control"}

        for cat in ("success", "failure", "neutral", "control"):
            b = block.get(cat)
            if not isinstance(b, dict):
                continue
            xs, ys = _median_series(b.get("median"))
            if len(xs) < 2:
                continue
            self._ax_line.plot(
                xs,
                ys,
                "o-",
                color=colors.get(cat, TEXT),
                label=labels_en.get(cat, cat),
                linewidth=1.6,
                markersize=3,
            )

        self._ax_line.set_title(title, color=ACCENT, fontsize=10)
        self._ax_line.legend(loc="upper right", fontsize=7, framealpha=0.2)
        self._ax_line.set_xlabel("Offset (sessioni / chiave mediana)", color=TEXT_MUTED, fontsize=8)
        self._ax_line.set_ylabel("% vs baseline", color=TEXT_MUTED, fontsize=8)

        cats = ["success", "failure", "neutral", "control"]
        ns: list[int] = []
        lab: list[str] = []
        cs: list[str] = []
        for cat in cats:
            b = block.get(cat)
            n = 0
            if isinstance(b, dict):
                try:
                    n = int(b.get("n") or 0)
                except (TypeError, ValueError):
                    n = 0
            if n > 0:
                ns.append(n)
                lab.append(labels_en.get(cat, cat))
                cs.append(colors.get(cat, ACCENT))
        _mode = self._chart_mode.get()
        if _mode == "rmse_dist" and self._table_rows:
            _rmse_vals: list[float] = []
            for _r in self._table_rows:
                try:
                    _rs = str(_r[3]).replace("%", "").strip()
                    if _rs and _rs != "—":
                        _rmse_vals.append(float(_rs))
                except (TypeError, ValueError):
                    pass
            if _rmse_vals:
                self._ax_bar.hist(
                    _rmse_vals,
                    bins=min(12, max(4, len(_rmse_vals) // 3)),
                    color=ACCENT,
                    edgecolor=GRID,
                    alpha=0.85,
                )
                self._ax_bar.set_title("RMSE distribution (tabella)", color=LIME, fontsize=9)
                self._ax_bar.set_xlabel("RMSE (pp)", color=TEXT_MUTED, fontsize=8)
            elif ns:
                self._ax_bar.bar(lab, ns, color=cs, edgecolor=GRID)
                self._ax_bar.set_title("N osservazioni per pool", color=LIME, fontsize=9)
                self._ax_bar.tick_params(axis="x", rotation=15)
        elif ns:
            self._ax_bar.bar(lab, ns, color=cs, edgecolor=GRID)
            self._ax_bar.set_title("N osservazioni per pool", color=LIME, fontsize=9)
            self._ax_bar.tick_params(axis="x", rotation=15)
        else:
            self._ax_bar.text(
                0.5,
                0.5,
                "Nessun conteggio",
                ha="center",
                va="center",
                transform=self._ax_bar.transAxes,
                color=TEXT_MUTED,
            )

        self._fig.tight_layout()
        self._canvas.draw_idle()

    def log_event(self, message: str, *, tag: str = "info") -> None:
        if self._log is None:
            return
        line = f"[{_ts()}] {message}\n"
        self._log.configure(state="normal")
        self._log.insert("end", line, (tag,))
        self._log.see("end")
        self._log.configure(state="disabled")

    def _build_ui(self, *, show_header: bool) -> None:
        if show_header:
            header = tk.Frame(self, bg=BG, height=52)
            header.pack(fill="x")
            header.grid_columnconfigure(1, weight=1)
            tk.Frame(header, bg=BG, width=120).grid(row=0, column=0)
            tk.Label(
                header,
                text="Data Lab",
                font=("Segoe UI", 18, "bold"),
                fg=TEXT,
                bg=BG,
            ).grid(row=0, column=1, pady=12)
            hdr_r = tk.Frame(header, bg=BG)
            hdr_r.grid(row=0, column=2, sticky="e", padx=12)
            for _lab, _mode in (
                ("RMSE Distribution", "rmse_dist"),
                ("RMSE", "rmse"),
                ("Ricarica", "reload"),
            ):
                _is_rmse_d = _mode == "rmse_dist"
                tk.Button(
                    hdr_r,
                    text=_lab,
                    relief=tk.FLAT,
                    padx=12,
                    pady=6,
                    font=("Segoe UI", 9, "bold" if _is_rmse_d else "normal"),
                    bg=ACCENT if _is_rmse_d else BG_PANEL,
                    fg="#0a0a0a" if _is_rmse_d else TEXT,
                    activebackground=ACCENT,
                    command=(
                        self.load_data
                        if _mode == "reload"
                        else lambda m=_mode: self._set_chart_mode(m)
                    ),
                ).pack(side="left", padx=3)

        body = tk.Frame(self, bg=BG)
        body.pack(fill="both", expand=True, padx=6 if show_header else 0, pady=(0, 6) if show_header else 0)

        root_v = tk.PanedWindow(body, orient=tk.VERTICAL, sashwidth=5, bg=BG, bd=0)
        root_v.pack(fill="both", expand=True)

        top_row = tk.PanedWindow(root_v, orient=tk.HORIZONTAL, sashwidth=5, bg=BG, bd=0)
        root_v.add(top_row, stretch="always", minsize=360)

        side = tk.Frame(top_row, bg=BG_PANEL, width=200)
        tk.Label(
            side,
            text="MENU",
            font=("Segoe UI", 9, "bold"),
            fg=ACCENT,
            bg=BG_PANEL,
        ).pack(anchor="w", padx=12, pady=(12, 6))
        for lab in _SIDEBAR_SECTIONS:
            _btn = tk.Button(
                side,
                text=f"  {lab}",
                anchor="w",
                relief=tk.FLAT,
                padx=10,
                pady=10,
                bg=BG_PANEL,
                fg=TEXT,
                activebackground="#2d3d35",
                activeforeground=ACCENT,
                font=("Segoe UI", 9),
                command=lambda s=lab: self._select_section(s),
            )
            _btn.pack(fill="x", padx=6, pady=2)
            self._sidebar_btns[lab] = _btn
        self._style_sidebar_section(_SIDEBAR_SECTIONS[0])
        top_row.add(side, minsize=168, stretch="never")

        mid = tk.Frame(top_row, bg=BG)
        chart_f = tk.Frame(mid, bg=BG)
        chart_f.pack(fill="both", expand=True)
        self._chart_placeholder: tk.Label | None = None
        if _HAVE_MPL and Figure is not None and FigureCanvasTkAgg is not None:
            self._fig = Figure(figsize=(7, 4.5), dpi=100, facecolor=BG)
            self._ax_line = self._fig.add_subplot(2, 1, 1)
            self._ax_bar = self._fig.add_subplot(2, 1, 2)
            self._canvas = FigureCanvasTkAgg(self._fig, master=chart_f)
            self._canvas.get_tk_widget().pack(fill="both", expand=True)
        else:
            self._ax_line = None
            self._ax_bar = None
            self._canvas = None
            self._chart_placeholder = tk.Label(
                chart_f,
                text=(
                    "Matplotlib non installato nel venv.\n"
                    "Esegui:  .venv\\Scripts\\pip install matplotlib\n"
                    "poi riavvia SuperNova."
                ),
                fg=TEXT_MUTED,
                bg=BG,
                font=("Segoe UI", 10),
                justify="center",
            )
            self._chart_placeholder.pack(expand=True)

        tbl_lab = ttk.LabelFrame(mid, text="Filtered Data Table")
        tbl_lab.pack(fill="both", expand=False, pady=(6, 0))
        filt_row = ttk.Frame(tbl_lab)
        filt_row.pack(fill="x", padx=6, pady=4)
        ttk.Label(filt_row, text="Filtro:").pack(side="left")
        self._filter_var = tk.StringVar()
        ttk.Entry(filt_row, textvariable=self._filter_var, width=36).pack(side="left", padx=6)
        ttk.Button(filt_row, text="Applica", command=self._apply_filter).pack(side="left")
        ttk.Button(filt_row, text="Pulisci", command=self._clear_filter).pack(side="left", padx=6)

        cols = ("company", "date", "seq", "rmse", "result")
        self._tree = ttk.Treeview(tbl_lab, columns=cols, show="headings", height=8)
        self._tree.heading("company", text="Company")
        self._tree.heading("date", text="Date")
        self._tree.heading("seq", text="Seq / label")
        self._tree.heading("rmse", text="RMSE")
        self._tree.heading("result", text="Result")
        self._tree.column("company", width=120)
        self._tree.column("date", width=100)
        self._tree.column("seq", width=140)
        self._tree.column("rmse", width=80)
        self._tree.column("result", width=160)
        ys = ttk.Scrollbar(tbl_lab, orient="vertical", command=self._tree.yview)
        self._tree.configure(yscrollcommand=ys.set)
        self._tree.tag_configure("success", foreground=ACCENT)
        self._tree.tag_configure("failure", foreground="#fb7185")
        self._tree.tag_configure("neutral", foreground="#fbbf24")
        self._tree.pack(side="left", fill="both", expand=True, padx=4, pady=(0, 6))
        ys.pack(side="right", fill="y")
        self._tree.bind("<<TreeviewSelect>>", self._on_tree_select)

        top_row.add(mid, stretch="always", minsize=420)

        notes = tk.Frame(top_row, bg=BG_PANEL, width=260)
        tk.Label(
            notes,
            text="Notes & Parameters",
            font=("Segoe UI", 9, "bold"),
            fg=LIME,
            bg=BG_PANEL,
        ).pack(anchor="w", padx=10, pady=(12, 4))
        self._notes_text = tk.Text(
            notes,
            height=8,
            bg="#1a1f1c",
            fg=TEXT,
            insertbackground=ACCENT,
            font=("Segoe UI", 9),
            wrap="word",
            highlightthickness=1,
            highlightbackground=GRID,
        )
        self._notes_text.pack(fill="both", expand=False, padx=8, pady=4)
        self._notes_text.insert(
            "1.0",
            "• Review CAR trends\n• Check RMSE thresholds\n• Verify cal_factor\n",
        )
        tk.Label(
            notes,
            text="Model Parameters",
            font=("Segoe UI", 9, "bold"),
            fg=ACCENT,
            bg=BG_PANEL,
        ).pack(anchor="w", padx=10, pady=(8, 2))
        self._param_labels: dict[str, tk.Label] = {}
        pf = tk.Frame(notes, bg=BG_PANEL)
        pf.pack(fill="x", padx=8, pady=4)
        for i, key in enumerate(("Cal Factor", "Seq Adjust", "CAR Threshold", "Population")):
            tk.Label(pf, text=key + ":", fg=TEXT_MUTED, bg=BG_PANEL, font=("Segoe UI", 8)).grid(
                row=i, column=0, sticky="nw", pady=2
            )
            lb = tk.Label(pf, text="—", fg=LIME, bg=BG_PANEL, font=("Segoe UI", 9, "bold"))
            lb.grid(row=i, column=1, sticky="w", padx=8, pady=2)
            self._param_labels[key] = lb

        qf = tk.LabelFrame(
            notes,
            text="Quick metrics",
            fg=ACCENT,
            bg=BG_PANEL,
            font=("Segoe UI", 8, "bold"),
        )
        qf.pack(fill="x", padx=8, pady=(0, 10))
        self._qm_aff = tk.Label(
            qf, text="Aff% calib: —", fg=ACCENT, bg=BG_PANEL, font=("Segoe UI", 10, "bold")
        )
        self._qm_aff.pack(anchor="w", padx=8, pady=4)
        self._qm_seq = tk.Label(
            qf, text="Seq Δ%: —", fg=LIME, bg=BG_PANEL, font=("Segoe UI", 10, "bold")
        )
        self._qm_seq.pack(anchor="w", padx=8, pady=(0, 8))

        top_row.add(notes, stretch="never", minsize=220)

        log_fr = tk.LabelFrame(
            root_v,
            text="Console Log",
            fg=ACCENT,
            bg=BG,
            font=("Segoe UI", 9, "bold"),
        )
        root_v.add(log_fr, stretch="never", minsize=100)
        self._log = tk.Text(
            log_fr,
            height=5,
            bg="#0f1210",
            fg=TEXT,
            font=("Consolas", 9),
            state="disabled",
            wrap="word",
            highlightthickness=0,
        )
        self._log.tag_configure("ok", foreground=ACCENT)
        self._log.tag_configure("err", foreground="#fb7185")
        self._log.tag_configure("info", foreground=TEXT_MUTED)
        self._log.pack(fill="both", expand=True, padx=6, pady=6)

    def _style_sidebar_section(self, active: str) -> None:
        for lab, btn in self._sidebar_btns.items():
            if lab == active:
                btn.configure(bg="#1e3d32", fg=ACCENT, font=("Segoe UI", 9, "bold"))
            else:
                btn.configure(bg=BG_PANEL, fg=TEXT, font=("Segoe UI", 9, "normal"))

    def _set_chart_mode(self, mode: str) -> None:
        self._chart_mode.set(mode)
        self.log_event(f"Vista grafici: {mode}", tag="info")
        self.update_charts()

    def _select_section(self, name: str) -> None:
        self._section.set(name)
        self._style_sidebar_section(name)
        self.log_event(f"Sezione: {name}", tag="info")
        if name == "Ristretta CD±7":
            if self._ristretta_bundle:
                self._table_rows = self._build_ristretta_table_rows(self._ristretta_bundle)
                self._fill_ristretta_notes(self._ristretta_bundle)
            elif not self._ristretta_loading:
                self.load_ristretta_async()
            self._fill_tree()
        elif self._state:
            self._table_rows = self._build_table_rows(self._state)
            self._fill_tree()
        self.update_charts()

    def _offset_xtick_labels(self, offsets: list[int]) -> list[str]:
        out: list[str] = []
        for off in offsets:
            if off > 0:
                out.append(f"+{off}")
            else:
                out.append(str(off))
        return out

    def _plot_ristretta_charts(self) -> None:
        import numpy as np

        if self._ristretta_loading and not self._ristretta_bundle:
            self._ax_line.text(
                0.5,
                0.5,
                "Caricamento Ristretta…\n(past_pred + curve μ)",
                ha="center",
                va="center",
                transform=self._ax_line.transAxes,
                color=TEXT_MUTED,
                fontsize=11,
            )
            self._ax_line.set_axis_off()
            self._ax_bar.set_axis_off()
            self._canvas.draw_idle()
            return

        bundle = self._ristretta_bundle or {}
        offsets = bundle.get("offsets") or [-60, -30, -10, -7, -5, -3, 4, 7]
        x = np.arange(len(offsets))
        xlab = self._offset_xtick_labels([int(o) for o in offsets])
        self._ax_line.set_xticks(x)
        self._ax_line.set_xticklabels(xlab, fontsize=8, rotation=30, ha="right")
        self._ax_line.axhline(0.0, color=GRID, linewidth=0.8, zorder=0)

        refs = bundle.get("references") or {}
        for name, series in refs.items():
            if not series:
                continue
            ys = [
                float(series[j]) if j < len(series) and series[j] is not None else np.nan
                for j in range(len(offsets))
            ]
            self._ax_line.plot(
                x,
                ys,
                "o--",
                linewidth=1.4,
                markersize=3,
                alpha=0.85,
                color=_REF_COLORS.get(name, TEXT_MUTED),
                label=name,
            )

        companies = list(bundle.get("companies") or [])
        sel = self._ristretta_sel
        for i, comp in enumerate(companies):
            curve = getattr(comp, "curve_pct", None) or []
            ys = [
                float(curve[j]) if j < len(curve) and curve[j] is not None else np.nan
                for j in range(len(offsets))
            ]
            if all(np.isnan(ys)):
                continue
            is_sel = sel is not None and i == sel
            self._ax_line.plot(
                x,
                ys,
                "o-",
                linewidth=2.2 if is_sel else 1.0,
                markersize=5 if is_sel else 3,
                alpha=1.0 if is_sel else 0.45,
                color=ACCENT if is_sel else "#6ee7b7",
                label=getattr(comp, "ticker", None) if is_sel else None,
            )

        n = int(bundle.get("n_cohort") or 0)
        self._ax_line.set_title(
            f"Ristretta CD±7 — % vs M−60 (N={n})",
            color=ACCENT,
            fontsize=10,
        )
        self._ax_line.set_ylabel("% vs M−60", color=TEXT_MUTED, fontsize=8)
        if refs or companies:
            self._ax_line.legend(loc="upper left", fontsize=7, framealpha=0.15)

        rmse_vals: list[float] = []
        for comp in companies:
            r = getattr(comp, "rmse_pp", None)
            if r is not None:
                rmse_vals.append(float(r))
        if rmse_vals:
            self._ax_bar.hist(
                rmse_vals,
                bins=min(10, max(3, len(rmse_vals))),
                color=ACCENT,
                edgecolor=GRID,
                alpha=0.85,
            )
            self._ax_bar.set_title("RMSE vs μ riferimento (pp)", color=LIME, fontsize=9)
            self._ax_bar.set_xlabel("RMSE", color=TEXT_MUTED, fontsize=8)
        else:
            self._ax_bar.text(
                0.5,
                0.5,
                "Nessun RMSE (coorte vuota o curve incomplete)",
                ha="center",
                va="center",
                transform=self._ax_bar.transAxes,
                color=TEXT_MUTED,
                fontsize=9,
            )

        self._fig.tight_layout()
        self._canvas.draw_idle()

    def _plot_cal_factor_bars(self, ax, cal: dict[str, float]) -> None:
        if not cal:
            ax.text(
                0.5,
                0.5,
                "cal_factor vuoto in current;\nvedi history nel JSON.",
                ha="center",
                va="center",
                transform=ax.transAxes,
                color=TEXT_MUTED,
            )
            ax.set_axis_off()
            return
        names = list(cal.keys())
        vals = [cal[k] for k in names]
        ax.bar(names, vals, color=ACCENT, edgecolor=GRID)
        ax.axhline(1.0, color=LIME, linestyle="--", linewidth=1, alpha=0.7)
        ax.tick_params(axis="x", rotation=20, colors=TEXT_MUTED, labelsize=8)

    def _build_table_rows(self, state: dict[str, Any]) -> list[tuple[str, str, str, str, str]]:
        fb = state.get("accuracy_curve_feedback")
        if not isinstance(fb, dict):
            return []
        rows: list[tuple[str, str, str, str, str]] = []
        for key, meta in fb.items():
            if "|" not in key:
                continue
            ticker, _, cd = key.partition("|")
            inf = ""
            rmse_s = "—"
            if isinstance(meta, dict):
                inf = str(meta.get("inflection_label") or "").strip() or "—"
                aud = meta.get("audit")
                if isinstance(aud, dict):
                    r = aud.get("rmse_pp")
                    if r is not None:
                        rmse_s = f"{float(r):.2f}%"
            seq = inf if inf != "—" else "—"
            res = _result_from_inflection(inf)
            rows.append((ticker, cd, seq, rmse_s, res))
        rows.sort(key=lambda r: r[1], reverse=True)
        return rows[:500]

    def _fill_tree(self) -> None:
        for iid in self._tree.get_children():
            self._tree.delete(iid)
        q = self._filter_var.get().strip().lower()
        for row in self._table_rows:
            if q and not any(q in str(c).lower() for c in row):
                continue
            _tag = "neutral"
            if row[4] == "Success":
                _tag = "success"
            elif row[4] == "Failure":
                _tag = "failure"
            self._tree.insert("", "end", values=row, tags=(_tag,))

    def _apply_filter(self) -> None:
        self._fill_tree()
        self.log_event(f"Filtro tabella applicato: {self._filter_var.get()!r}", tag="info")

    def _clear_filter(self) -> None:
        self._filter_var.set("")
        self._fill_tree()

    def _on_tree_select(self, _event: tk.Event | None = None) -> None:
        if self._section.get() != "Ristretta CD±7":
            return
        sel = self._tree.selection()
        if not sel:
            self._ristretta_sel = None
            return
        try:
            idx = self._tree.index(sel[0])
        except tk.TclError:
            return
        visible = [
            r
            for r in self._table_rows
            if not self._filter_var.get().strip().lower()
            or self._filter_var.get().strip().lower() in " ".join(str(c).lower() for c in r)
        ]
        if idx < len(visible):
            try:
                full_idx = self._table_rows.index(visible[idx])
            except ValueError:
                full_idx = idx
            self._ristretta_sel = full_idx
            self.update_charts()

    def _fill_params_panel(self) -> None:
        cal = self._state.get("cal_factor") if isinstance(self._state, dict) else {}
        if not isinstance(cal, dict) or not cal:
            cal = _latest_cal_factor_from_history(self._raw_doc)
        v4 = _safe_float(cal.get("v4_options")) if isinstance(cal, dict) else None
        _car_thr = "—"
        _cep = self._state.get("car_event_params")
        if isinstance(_cep, dict) and _cep.get("cum"):
            _car_thr = str(_cep.get("cum"))
        if self._param_labels:
            self._param_labels["Cal Factor"].configure(
                text=f"{v4:.2f}" if v4 is not None else "—"
            )
            self._param_labels["Seq Adjust"].configure(text="T−60 anchored")
            self._param_labels["CAR Threshold"].configure(text=_car_thr)
            self._param_labels["Population"].configure(
                text=str(self._state.get("population_filter") or "—")[:28]
            )
        if v4 is not None:
            aff_proxy = max(5, min(99, int(round(50 + 50 * (v4 - 0.5)))))
            self._qm_aff.configure(text=f"Aff% Calib: {aff_proxy}%")
            self._qm_seq.configure(text=f"Seq Δ%: {(v4 - 1.0) * 100:+.1f}%")
        else:
            self._qm_aff.configure(text="Aff% calib: —")
            self._qm_seq.configure(text="Seq Δ%: —")


class DataLabWindow(tk.Tk):
    """Finestra standalone che avvolge ``DataLabPanel``."""

    def __init__(self, json_path: str | Path | None = None) -> None:
        super().__init__()
        self.title("Data Lab")
        self.geometry("1280x800")
        self.minsize(960, 640)
        self.configure(bg=BG)
        apply_datalab_ttk_styles(self)
        self._panel = DataLabPanel(self, json_path=json_path, show_header=True)
        self._panel.pack(fill="both", expand=True)
        self._panel.load_data()
        self._panel.log_event("Data Lab avviato.", tag="ok")

    def load_data(self) -> bool:
        return self._panel.load_data()

    def update_charts(self) -> None:
        self._panel.update_charts()

    def log_event(self, message: str, *, tag: str = "info") -> None:
        self._panel.log_event(message, tag=tag)

    def run(self) -> None:
        self.mainloop()


def main() -> None:
    DataLabWindow().run()


if __name__ == "__main__":
    root = Path(_paths.project_root())
    if Path.cwd().resolve() != root.resolve():
        try:
            os.chdir(root)
        except OSError:
            pass
    main()
