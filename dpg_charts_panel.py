"""Pannello grafici Dear PyGui (curve Simulation / Ristretta)."""
from __future__ import annotations

import threading
from collections.abc import Callable
from typing import Any

import dearpygui.dearpygui as dpg

from dpg_lab_data import build_ristretta_dpg_bundle, build_simulation_lab_bundle

_ACCENT = (0, 200, 150, 255)
_LIME = (200, 255, 0, 255)
_MUTED = (156, 163, 175, 255)
_TEXT = (232, 232, 232, 255)
_BG = (28, 28, 28, 255)
_PANEL = (37, 37, 37, 255)
_COMBO_MULTI = "(prima società in elenco)"
_CO_B_NONE = "(nessuna — solo società A)"
_CMP_FROZEN = (255, 167, 38, 255)
_CMP_RECAL = (0, 220, 160, 255)
_PCT_STORICO = (120, 200, 255, 230)
# Colori società B nel confronto (stesso tipo curva, tonalità diversa).
_CO_B_CURVA = (0, 175, 130, 230)
_CO_B_STOR = (175, 140, 255, 230)
_CO_B_MOD = (255, 115, 90, 230)

_REF_COLORS: dict[str, tuple[int, int, int, int]] = {
    "Cluster 0": (156, 163, 175, 220),
    "SuperNova (cl.1)": _LIME,
    "μ SuperNova (cl.1)": _LIME,
    "Post-CD rialzo": _ACCENT,
    "μ Post-CD rialzo": _ACCENT,
    "Post-CD ribasso": (251, 113, 133, 220),
    "μ Post-CD ribasso": (251, 113, 133, 220),
}


def apply_supernova_theme() -> None:
    with dpg.theme() as th:
        with dpg.theme_component(dpg.mvAll):
            dpg.add_theme_color(dpg.mvThemeCol_WindowBg, _BG)
            dpg.add_theme_color(dpg.mvThemeCol_ChildBg, _PANEL)
            dpg.add_theme_color(dpg.mvThemeCol_FrameBg, _PANEL)
            dpg.add_theme_color(dpg.mvThemeCol_Text, _TEXT)
            dpg.add_theme_color(dpg.mvThemeCol_CheckMark, _ACCENT)
            dpg.add_theme_color(dpg.mvThemeCol_Button, (45, 55, 50, 255))
            dpg.add_theme_color(dpg.mvThemeCol_ButtonHovered, (0, 160, 120, 255))
            dpg.add_theme_color(dpg.mvThemeCol_ButtonActive, _ACCENT)
    dpg.bind_theme(th)


def _xy_from_points(points: list[dict], field: str = "pct_curva") -> tuple[list[float], list[float]]:
    xs: list[float] = []
    ys: list[float] = []
    for p in points:
        if p.get("nodo") != "standard":
            continue
        y = p.get(field)
        if y is None or y != y:
            continue
        try:
            xs.append(float(p["offset"]))
            ys.append(float(y))
        except (TypeError, ValueError, KeyError):
            continue
    return xs, ys


def _xy_price_from_points(
    points: list[dict],
    field: str = "price_usd",
    *,
    include_k8: bool = False,
) -> tuple[list[float], list[float]]:
    xs: list[float] = []
    ys: list[float] = []
    for p in sorted(points or [], key=lambda z: (z.get("sort", (0, z.get("offset", 0))))):
        if not include_k8 and p.get("nodo") != "standard":
            continue
        if include_k8 and p.get("nodo") not in ("standard", "K-8"):
            continue
        y = p.get(field)
        if y is None or y != y:
            continue
        try:
            xs.append(float(p["offset"]))
            ys.append(float(y))
        except (TypeError, ValueError, KeyError):
            continue
    return xs, ys


def _series_color(label: str, kind: str, idx: int) -> tuple[int, int, int, int]:
    for key, col in _REF_COLORS.items():
        if key in label:
            return col
    if kind == "control":
        return (120, 180, 255, 200)
    h = (idx * 47) % 200
    return (80 + h // 2, 200, 140 + h // 3, 180)


def _sanitize_dpg_tag(s: str) -> str:
    return (
        str(s).replace("|", "_").replace(":", "_").replace("/", "_").replace("\\", "_")
    )


class ChartsPanel:
    def __init__(
        self,
        *,
        status_tag: str = "charts_status",
        ui_post: Callable[[Callable[[], None]], None] | None = None,
    ) -> None:
        self.status_tag = status_tag
        self._ui_post = ui_post
        self._load_lock = threading.Lock()
        self._load_thread: threading.Thread | None = None
        self.bundle: dict | None = None
        # Solo serie «control» (μ di riferimento): checkbox nella sidebar.
        self.visible: dict[str, bool] = {}

        self._combo_keys: list[str | None] = [None]

    def _set_status(self, msg: str) -> None:
        if dpg.does_item_exist(self.status_tag):
            dpg.set_value(self.status_tag, msg)

    def _company_entries(self) -> list[tuple[str, str]]:
        if not self.bundle:
            return []
        series = self.bundle.get("series") or {}
        return sorted(
            [(k, str(v.get("label") or k)) for k, v in series.items() if v.get("kind") == "company"],
            key=lambda t: t[1],
        )

    def _control_entries(self) -> list[tuple[str, str]]:
        if not self.bundle:
            return []
        series = self.bundle.get("series") or {}
        return sorted(
            [(k, str(v.get("label") or k)) for k, v in series.items() if v.get("kind") == "control"],
            key=lambda t: t[1],
        )

    def _show_controls_on_explorer(self) -> bool:
        if not dpg.does_item_exist("chk_controlli"):
            return True
        return bool(dpg.get_value("chk_controlli"))

    def _sid_from_combo(self, combo_tag: str) -> str | None:
        if not dpg.does_item_exist(combo_tag):
            return None
        try:
            cur = str(dpg.get_value(combo_tag) or "")
        except Exception:
            cur = ""
        if cur == _CO_B_NONE:
            return None
        for k, lbl in self._company_entries():
            if lbl == cur:
                return k
        return None

    def _sync_explorer_combos(self) -> None:
        ents = self._company_entries()
        labs = [lbl for _, lbl in ents]
        _empty_a = ["(carica Simulation o Ristretta)"]
        _items_a = labs if labs else _empty_a
        _items_b = ([_CO_B_NONE] + labs) if labs else [_CO_B_NONE]
        if dpg.does_item_exist("chart_co_a"):
            dpg.configure_item("chart_co_a", items=_items_a)
            if labs:
                try:
                    _ca = dpg.get_value("chart_co_a")
                except Exception:
                    _ca = None
                if _ca not in labs:
                    dpg.set_value("chart_co_a", labs[0])
            else:
                dpg.set_value("chart_co_a", _empty_a[0])
        if dpg.does_item_exist("chart_co_b"):
            dpg.configure_item("chart_co_b", items=_items_b)
            try:
                _cb = dpg.get_value("chart_co_b")
            except Exception:
                _cb = None
            if _cb not in _items_b:
                dpg.set_value("chart_co_b", _CO_B_NONE)

    def _explorer_curve_flags(self) -> tuple[bool, bool, bool]:
        def _chk(tag: str, default: bool = True) -> bool:
            if not dpg.does_item_exist(tag):
                return default
            return bool(dpg.get_value(tag))

        return (
            _chk("chk_curva", True),
            _chk("chk_storico", True),
            _chk("chk_modello", True),
        )

    def _on_explorer_change(self, *args) -> None:
        sid_a = self._sid_from_combo("chart_co_a")
        if sid_a and dpg.does_item_exist("company_combo"):
            for k, lbl in self._company_entries():
                if k == sid_a:
                    dpg.set_value("company_combo", lbl)
                    break
        self._refresh_explorer_plot()
        self._refresh_var_plot()
        self._refresh_price_path_plot()
        self._refresh_price_model_plot()
        self._refresh_table()

    def _preset_explorer(self, curva: bool, storico: bool, modello: bool) -> None:
        if dpg.does_item_exist("chk_curva"):
            dpg.set_value("chk_curva", curva)
        if dpg.does_item_exist("chk_storico"):
            dpg.set_value("chk_storico", storico)
        if dpg.does_item_exist("chk_modello"):
            dpg.set_value("chk_modello", modello)
        self._on_explorer_change()

    def _refresh_explorer_plot(self) -> None:
        """Grafico principale: società A/B + μ controllo (Cluster 0/1, post-CD)."""
        self._clear_axis_series("y_axis_explorer")
        if not self.bundle:
            return
        show_c, show_s, show_m = self._explorer_curve_flags()
        show_ctrl = self._show_controls_on_explorer()
        sid_a = self._sid_from_combo("chart_co_a")
        sid_b = self._sid_from_combo("chart_co_b")
        if not (show_c or show_s or show_m) and not show_ctrl:
            return
        if not sid_a and not show_ctrl:
            return
        series = self.bundle.get("series") or {}
        specs: list[tuple[str, str, bool, tuple]] = [
            ("pct_curva", "curva ricalibr.", show_c, (_CMP_RECAL, _CO_B_CURVA)),
            ("pct_reale", "storico", show_s, (_PCT_STORICO, _CO_B_STOR)),
            ("pct_modello", "modello", show_m, (_CMP_FROZEN, _CO_B_MOD)),
        ]
        ci = 0
        for slot, sid in enumerate((sid_a, sid_b)):
            if not sid or sid not in series:
                continue
            meta = series[sid]
            if meta.get("kind") != "company":
                continue
            pts = meta.get("points") or []
            _tk = str(meta.get("label") or sid)[:24]
            st = _sanitize_dpg_tag(sid)
            _pfx = "A" if slot == 0 else "B"
            for field, kind_lbl, on, (col_a, col_b) in specs:
                if not on:
                    continue
                col = col_a if slot == 0 else col_b
                self._plot_pct_field(
                    pts,
                    field,
                    label=f"{_pfx} {_tk} · {kind_lbl}",
                    parent="y_axis_explorer",
                    tag=f"ex_{st}_{field}_{slot}_{ci}",
                    color=col,
                    weight=2.5 if slot == 1 else 1.5,
                )
            ci += 1
        if show_ctrl and show_c:
            _ci_mu = 0
            for sid, clbl in self._control_entries():
                if not self.visible.get(sid, True):
                    continue
                pts = (series.get(sid) or {}).get("points") or []
                col = _series_color(clbl, "control", _ci_mu)
                st = _sanitize_dpg_tag(sid)
                self._plot_pct_field(
                    pts,
                    "pct_curva",
                    label=f"μ {clbl[:36]}",
                    parent="y_axis_explorer",
                    tag=f"ex_mu_{st}_{_ci_mu}",
                    color=col,
                    weight=1.25,
                )
                _ci_mu += 1
        dpg.fit_axis_data("x_axis_explorer")
        dpg.fit_axis_data("y_axis_explorer")

    def _table_company_id(self) -> str | None:
        """Chiave serie per tabella punti dalla combo Tabella."""
        ents = self._company_entries()
        if not ents:
            return None
        if not dpg.does_item_exist("company_combo"):
            return ents[0][0]
        try:
            cur = str(dpg.get_value("company_combo") or _COMBO_MULTI)
        except Exception:
            cur = _COMBO_MULTI
        if cur == _COMBO_MULTI:
            return ents[0][0]
        labels = [_COMBO_MULTI] + [lbl for _, lbl in ents]
        try:
            idx = labels.index(cur)
        except ValueError:
            return ents[0][0]
        if idx <= 0 or idx - 1 >= len(ents):
            return ents[0][0]
        return ents[idx - 1][0]

    def _explorer_company_slots(self) -> list[tuple[str, int]]:
        """Società A (slot 0) e opz. B (slot 1) dai menu a tendina."""
        out: list[tuple[str, int]] = []
        sid_a = self._sid_from_combo("chart_co_a")
        if sid_a:
            out.append((sid_a, 0))
        sid_b = self._sid_from_combo("chart_co_b")
        if sid_b and sid_b != sid_a:
            out.append((sid_b, 1))
        return out

    def _plot_pct_field(
        self,
        pts: list[dict],
        field: str,
        *,
        label: str,
        parent: str,
        tag: str,
        color: tuple[int, int, int, int],
        weight: float = 1.5,
    ) -> bool:
        xs, ys = _xy_from_points(pts, field)
        if len(xs) < 2:
            return False
        self._add_themed_line(
            xs, ys, label=label, parent=parent, tag=tag, color=color, weight=weight
        )
        return True

    def build(self, parent: str) -> None:
        with dpg.group(parent=parent):
            with dpg.group(horizontal=True):
                dpg.add_button(
                    label="Simulation",
                    callback=lambda: self.load_mode("simulation"),
                )
                dpg.add_button(
                    label="Ristretta CD±7",
                    callback=lambda: self.load_mode("ristretta"),
                )
                dpg.add_button(
                    label="Mostra tutti μ",
                    callback=lambda: self._select_all(True),
                )
                dpg.add_button(
                    label="Nascondi tutti μ",
                    callback=lambda: self._select_all(False),
                )
            dpg.add_button(
                label="Solo μ controllo",
                callback=self._only_controls,
            )
            dpg.add_text("Analisi % vs T−60", color=_ACCENT)
            with dpg.group(horizontal=True):
                dpg.add_combo(
                    label="Società A",
                    items=["(carica Simulation o Ristretta)"],
                    default_value="(carica Simulation o Ristretta)",
                    width=320,
                    tag="chart_co_a",
                    callback=self._on_explorer_change,
                )
                dpg.add_combo(
                    label="Società B (confronto)",
                    items=[_CO_B_NONE],
                    default_value=_CO_B_NONE,
                    width=320,
                    tag="chart_co_b",
                    callback=self._on_explorer_change,
                )
            with dpg.group(horizontal=True):
                dpg.add_checkbox(
                    label="Curva ricalibr.",
                    default_value=True,
                    tag="chk_curva",
                    callback=self._on_explorer_change,
                )
                dpg.add_checkbox(
                    label="Storico (dato vero)",
                    default_value=True,
                    tag="chk_storico",
                    callback=self._on_explorer_change,
                )
                dpg.add_checkbox(
                    label="Modello",
                    default_value=True,
                    tag="chk_modello",
                    callback=self._on_explorer_change,
                )
                dpg.add_checkbox(
                    label="μ controllo (C0, cl.1, post-CD)",
                    default_value=True,
                    tag="chk_controlli",
                    callback=self._on_explorer_change,
                )
            with dpg.group(horizontal=True):
                dpg.add_text("Preset:", color=_MUTED)
                dpg.add_button(
                    label="Solo curva",
                    callback=lambda: self._preset_explorer(True, False, False),
                )
                dpg.add_button(
                    label="Solo storico",
                    callback=lambda: self._preset_explorer(False, True, False),
                )
                dpg.add_button(
                    label="Solo modello",
                    callback=lambda: self._preset_explorer(False, False, True),
                )
                dpg.add_button(
                    label="Tutte e 3",
                    callback=lambda: self._preset_explorer(True, True, True),
                )
                dpg.add_button(
                    label="Confronto stor.+mod.",
                    callback=lambda: self._preset_explorer(False, True, True),
                )
            dpg.add_combo(
                label="Tabella punti · società",
                items=[_COMBO_MULTI],
                default_value=_COMBO_MULTI,
                width=380,
                tag="company_combo",
                callback=self._on_company_combo,
            )
            dpg.add_text(
                "Menu A/B: una o due società; spunta le curve da mostrare. "
                "Var. % e prezzi $ seguono le stesse selezioni (solo Simulation per Var.).",
                color=_MUTED,
            )
            with dpg.group(horizontal=True):
                with dpg.child_window(width=280, height=-1, border=True):
                    dpg.add_text("Serie μ (solo controlli)", color=_ACCENT)
                    with dpg.group(tag="sidebar_list"):
                        pass
                with dpg.child_window(border=True, width=-1, height=-1):
                    with dpg.plot(
                        label="% vs T−60 — società A/B e curve selezionate",
                        height=240,
                        width=-1,
                        crosshairs=True,
                        tag="plot_explorer",
                    ):
                        dpg.add_plot_legend(outside=True, horizontal=True)
                        dpg.add_plot_axis(
                            dpg.mvXAxis, label="Giorni da CD", tag="x_axis_explorer"
                        )
                        dpg.add_plot_axis(
                            dpg.mvYAxis, label="% vs T−60", tag="y_axis_explorer"
                        )
                    with dpg.plot(
                        label="iii · Variazioni % (1g · 1M · 3M · 6M)",
                        height=168,
                        width=-1,
                        tag="plot_var",
                    ):
                        dpg.add_plot_legend(outside=True, horizontal=True)
                        dpg.add_plot_axis(
                            dpg.mvXAxis, label="Orizzonte", tag="x_axis_var"
                        )
                        dpg.add_plot_axis(
                            dpg.mvYAxis, label="Var. %", tag="y_axis_var"
                        )
                    with dpg.plot(
                        label="Prezzo $ — storico + ricalibrata (path)",
                        height=150,
                        width=-1,
                        tag="plot_price_path",
                    ):
                        dpg.add_plot_legend(outside=True, horizontal=True)
                        dpg.add_plot_axis(
                            dpg.mvXAxis, label="Giorni da CD", tag="x_axis_px_path"
                        )
                        dpg.add_plot_axis(
                            dpg.mvYAxis, label="Prezzo ($)", tag="y_axis_px_path"
                        )
                    with dpg.plot(
                        label="Prezzo $ — solo modello T−60",
                        height=150,
                        width=-1,
                        tag="plot_price_model",
                    ):
                        dpg.add_plot_legend(outside=True, horizontal=True)
                        dpg.add_plot_axis(
                            dpg.mvXAxis, label="Giorni da CD", tag="x_axis_px_mod"
                        )
                        dpg.add_plot_axis(
                            dpg.mvYAxis, label="Prezzo ($)", tag="y_axis_px_mod"
                        )
            dpg.add_text("Tabella punti", color=_MUTED, tag="table_caption")
            with dpg.table(
                tag="points_table",
                header_row=True,
                resizable=True,
                borders_innerH=True,
                borders_outerH=True,
                height=140,
            ):
                pass

    def _clear_axis_series(self, y_axis_tag: str) -> None:
        if not dpg.does_item_exist(y_axis_tag):
            return
        for child in dpg.get_item_children(y_axis_tag, slot=1) or []:
            if dpg.get_item_type(child) in ("mvLineSeries", "mvScatterSeries"):
                dpg.delete_item(child)

    def _add_themed_line(
        self,
        xs: list[float],
        ys: list[float],
        *,
        label: str,
        parent: str,
        tag: str,
        color: tuple[int, int, int, int],
        weight: float = 1.5,
    ) -> None:
        dpg.add_line_series(xs, ys, label=label, parent=parent, tag=tag)
        with dpg.theme() as st:
            with dpg.theme_component(dpg.mvLineSeries):
                dpg.add_theme_color(dpg.mvPlotCol_Line, color, category=dpg.mvThemeCat_Plots)
                dpg.add_theme_style(
                    dpg.mvPlotStyleVar_LineWeight, weight, category=dpg.mvThemeCat_Plots
                )
        dpg.bind_item_theme(tag, st)

    def _refresh_var_plot(self) -> None:
        self._clear_axis_series("y_axis_var")
        if not self.bundle:
            return
        series = self.bundle.get("series") or {}
        ci = 0
        _var_cols = (_PCT_STORICO, _CO_B_STOR)
        for sid, slot in self._explorer_company_slots():
            meta = series.get(sid)
            if not isinstance(meta, dict) or meta.get("kind") != "company":
                continue
            horizons = meta.get("var_horizons") or []
            xs: list[float] = []
            ys: list[float] = []
            for i, h in enumerate(horizons):
                p = h.get("pct")
                if p is None or p != p:
                    continue
                xs.append(float(i))
                ys.append(float(p))
            if len(xs) < 1:
                continue
            st = _sanitize_dpg_tag(sid)
            _pfx = "A" if slot == 0 else "B"
            _tk = str(meta.get("label") or sid)[:40]
            tag = f"var_{st}_{slot}_{ci}"
            dpg.add_line_series(
                xs,
                ys,
                label=f"{_pfx} {_tk}",
                parent="y_axis_var",
                tag=tag,
            )
            col = _var_cols[slot] if slot < len(_var_cols) else _series_color(_tk, "company", ci)
            with dpg.theme() as vst:
                with dpg.theme_component(dpg.mvLineSeries):
                    dpg.add_theme_color(
                        dpg.mvPlotCol_Line, col, category=dpg.mvThemeCat_Plots
                    )
                    dpg.add_theme_style(
                        dpg.mvPlotStyleVar_LineWeight,
                        2.5 if slot == 1 else 1.5,
                        category=dpg.mvThemeCat_Plots,
                    )
            dpg.bind_item_theme(tag, vst)
            ci += 1
        dpg.fit_axis_data("x_axis_var")
        dpg.fit_axis_data("y_axis_var")

    def _refresh_price_path_plot(self) -> None:
        self._clear_axis_series("y_axis_px_path")
        if not self.bundle:
            return
        series = self.bundle.get("series") or {}
        ci = 0
        _stor_cols = ((120, 200, 255, 200), (175, 140, 255, 200))
        _path_cols = (_CMP_RECAL, _CO_B_CURVA)
        for sid, slot in self._explorer_company_slots():
            meta = series.get(sid)
            if not isinstance(meta, dict) or meta.get("kind") != "company":
                continue
            pts = meta.get("points") or []
            _pfx = "A" if slot == 0 else "B"
            _tk = str(meta.get("label") or "")[:32]
            st = _sanitize_dpg_tag(sid)
            xs_s, ys_s = _xy_price_from_points(pts, "price_storico_usd")
            if len(xs_s) >= 2:
                self._add_themed_line(
                    xs_s,
                    ys_s,
                    label=f"{_pfx} {_tk} · storico",
                    parent="y_axis_px_path",
                    tag=f"pxs_{st}_{slot}_{ci}",
                    color=_stor_cols[slot],
                    weight=2.5 if slot == 1 else 1.5,
                )
            xs_r, ys_r = _xy_price_from_points(pts, "price_usd", include_k8=True)
            if len(xs_r) >= 2:
                self._add_themed_line(
                    xs_r,
                    ys_r,
                    label=f"{_pfx} {_tk} · path",
                    parent="y_axis_px_path",
                    tag=f"pxr_{st}_{slot}_{ci}",
                    color=_path_cols[slot],
                    weight=2.5 if slot == 1 else 1.5,
                )
            ci += 1
        dpg.fit_axis_data("x_axis_px_path")
        dpg.fit_axis_data("y_axis_px_path")

    def _refresh_price_model_plot(self) -> None:
        self._clear_axis_series("y_axis_px_mod")
        if not self.bundle:
            return
        series = self.bundle.get("series") or {}
        ci = 0
        _mod_cols = (_CMP_FROZEN, _CO_B_MOD)
        for sid, slot in self._explorer_company_slots():
            meta = series.get(sid)
            if not isinstance(meta, dict) or meta.get("kind") != "company":
                continue
            pts = meta.get("points") or []
            _pfx = "A" if slot == 0 else "B"
            _tk = str(meta.get("label") or "")[:36]
            xs_m, ys_m = _xy_price_from_points(pts, "price_model_usd")
            if len(xs_m) < 2:
                continue
            self._add_themed_line(
                xs_m,
                ys_m,
                label=f"{_pfx} {_tk} · modello",
                parent="y_axis_px_mod",
                tag=f"pxm_{_sanitize_dpg_tag(sid)}_{slot}_{ci}",
                color=_mod_cols[slot],
                weight=2.5 if slot == 1 else 1.5,
            )
            ci += 1
        dpg.fit_axis_data("x_axis_px_mod")
        dpg.fit_axis_data("y_axis_px_mod")

    def _refresh_all_plots(self) -> None:
        self._refresh_explorer_plot()
        self._refresh_var_plot()
        self._refresh_price_path_plot()
        self._refresh_price_model_plot()

    def _refresh_table(self) -> None:
        if not dpg.does_item_exist("points_table"):
            return
        dpg.delete_item("points_table", children_only=True)
        if dpg.does_item_exist("table_caption"):
            dpg.set_value(
                "table_caption",
                "Tabella punti: società selezionata + μ controllo in coda (% ricalibr.)",
            )
        if not self.bundle:
            return
        sid = self._table_company_id()
        if not sid:
            return
        meta = (self.bundle.get("series") or {}).get(sid)
        if not meta:
            return
        for h in (
            "Serie",
            "Punto",
            "Gg CD",
            "Nodo",
            "Data cal.",
            "Data raw",
            "Origine",
            "% ricalibr.",
            "% modello T−60",
            "% storico",
            "Prezzo $",
        ):
            dpg.add_table_column(label=h, parent="points_table")
        _co_lbl = str(meta.get("label") or sid)[:36]

        def _append_point_row(serie_lbl: str, p: dict) -> None:
            _dc = p.get("data_cal")
            _dr = p.get("data_raw")
            _pu = p.get("price_usd")
            with dpg.table_row(parent="points_table"):
                dpg.add_text(serie_lbl)
                dpg.add_text(str(p.get("label") or "—"))
                dpg.add_text(str(p.get("offset", "—")))
                dpg.add_text(str(p.get("nodo") or "—"))
                dpg.add_text(
                    _dc.strftime("%d/%m/%Y") if hasattr(_dc, "strftime") else "—"
                )
                dpg.add_text(
                    _dr.strftime("%d/%m/%Y") if hasattr(_dr, "strftime") else "—"
                )
                dpg.add_text(str(p.get("tipo") or "—"))
                for _fk in ("pct_curva", "pct_modello", "pct_reale"):
                    v = p.get(_fk)
                    dpg.add_text(
                        f"{float(v):.3f}" if v is not None and v == v else "—"
                    )
                dpg.add_text(
                    f"${float(_pu):.2f}" if _pu is not None and _pu == _pu else "—"
                )

        for p in meta.get("points") or []:
            _append_point_row(_co_lbl, p)
        series = self.bundle.get("series") or {}
        for csid, clbl in self._control_entries():
            if not self.visible.get(csid, True):
                continue
            cmeta = series.get(csid) or {}
            for p in cmeta.get("points") or []:
                if p.get("nodo") != "standard":
                    continue
                _append_point_row(f"μ {clbl}", p)

    def _on_company_combo(self, sender, app_data) -> None:
        self._refresh_table()

    def _update_company_combo(self) -> None:
        if not dpg.does_item_exist("company_combo"):
            return
        entries = self._company_entries()
        labels = [_COMBO_MULTI] + [lbl for _, lbl in entries]
        self._combo_keys = [None] + [k for k, _ in entries]
        dpg.configure_item("company_combo", items=labels)
        dpg.set_value("company_combo", _COMBO_MULTI)

    def _on_toggle(self, sender, app_data, user_data: str) -> None:
        self.visible[str(user_data)] = bool(app_data)
        self._refresh_all_plots()

    def _rebuild_sidebar(self) -> None:
        if dpg.does_item_exist("sidebar_list"):
            dpg.delete_item("sidebar_list", children_only=True)
        if not self.bundle:
            return
        series = self.bundle.get("series") or {}
        controls = sorted(
            [(k, v) for k, v in series.items() if v.get("kind") == "control"],
            key=lambda t: str(t[1].get("label")),
        )
        dpg.add_text("Controlli μ", parent="sidebar_list", color=_ACCENT)
        for sid, meta in controls:
            dpg.add_checkbox(
                label=str(meta.get("label") or sid),
                default_value=self.visible.get(sid, True),
                callback=self._on_toggle,
                user_data=sid,
                parent="sidebar_list",
            )
        dpg.add_separator(parent="sidebar_list")
        dpg.add_text(
            "Società: menu Società A / B sopra i grafici",
            parent="sidebar_list",
            color=_MUTED,
        )

    def _fetch_mode_bundle(self, mode: str) -> dict[str, Any]:
        return (
            build_ristretta_dpg_bundle()
            if mode == "ristretta"
            else build_simulation_lab_bundle()
        )

    def _apply_mode_bundle(
        self,
        mode: str,
        bundle: dict[str, Any] | None,
        *,
        error: str | None = None,
    ) -> None:
        if error or bundle is None:
            self.bundle = None
            self._set_status(f"Errore: {error or 'dati assenti'}")
            return
        self.bundle = bundle
        note = str(self.bundle.get("note") or "").strip()
        self.visible = {}
        _series = self.bundle.get("series") or {}
        for _sid0, _m0 in _series.items():
            if not isinstance(_m0, dict):
                continue
            if _m0.get("kind") == "control":
                self.visible[str(_sid0)] = True
        if dpg.does_item_exist("chk_controlli"):
            dpg.set_value("chk_controlli", True)
        msg = f"{mode}: {len(_series)} serie."
        if mode != "simulation":
            msg += " Variazioni % (iii) sono piene solo in modalità Simulation."
        if note:
            msg += f" — {note}"
        self._set_status(msg)
        self._update_company_combo()
        self._sync_explorer_combos()
        self._rebuild_sidebar()
        self._refresh_all_plots()
        self._refresh_table()

    def load_mode(self, mode: str) -> None:
        if self._ui_post is not None:
            self.load_mode_async(mode)
            return
        self._set_status("Caricamento…")
        try:
            bundle = self._fetch_mode_bundle(mode)
        except Exception as exc:
            self._apply_mode_bundle(mode, None, error=str(exc))
            return
        self._apply_mode_bundle(mode, bundle)

    def load_mode_async(self, mode: str) -> None:
        with self._load_lock:
            if self._load_thread and self._load_thread.is_alive():
                self._set_status("Caricamento grafici già in corso…")
                return
        self._set_status(
            f"Caricamento {mode}… (Excel + curve, può richiedere ~1 min)"
        )

        def worker() -> None:
            try:
                bundle = self._fetch_mode_bundle(mode)
                err: str | None = None
            except Exception as exc:
                bundle = None
                err = str(exc)

            def apply() -> None:
                self._apply_mode_bundle(mode, bundle, error=err)

            if self._ui_post is not None:
                self._ui_post(apply)

        thread = threading.Thread(target=worker, daemon=True)
        with self._load_lock:
            self._load_thread = thread
        thread.start()

    def _select_all(self, on: bool) -> None:
        if not self.bundle:
            return
        for sid, meta in (self.bundle.get("series") or {}).items():
            if not isinstance(meta, dict):
                continue
            if meta.get("kind") == "control":
                self.visible[str(sid)] = on
        self._rebuild_sidebar()
        self._refresh_all_plots()

    def _only_controls(self) -> None:
        if not self.bundle:
            return
        for sid, meta in (self.bundle.get("series") or {}).items():
            if not isinstance(meta, dict):
                continue
            if meta.get("kind") == "control":
                self.visible[str(sid)] = True
            else:
                self.visible[str(sid)] = False
        self._rebuild_sidebar()
        self._refresh_all_plots()
