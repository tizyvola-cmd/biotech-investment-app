/**

 * Grafici Δ% vs T−60 — nodi standard (allineato a foglio Grafici Excel).

 */

(function () {

  const COMBO_CTRL_SLOT_COUNT = 6;

  const COMBO_TYPE_OPTIONS = [
    {
      value: "curva ricalibr.",
      field: "pct_curva",
      dash: "solid",
      cohortKey: "g4curva",
    },
    { value: "storico", field: "pct_reale", dash: "dash", cohortKey: "g4stor" },
    {
      value: "modello",
      field: "pct_modello",
      dash: "dot",
      cohortKey: "g4mod",
    },
  ];

  const CHART_SESSION_TICKS = [-60, -30, -10, -7, -5, -3, 3, 4, 5, 7];

  const MESH_X_LINES = 5;

  const MESH_Y_LINES = 4;

  const SESSION_X_MIN = -62;

  const SESSION_X_MAX = 9;

  const PCT_Y_FALLBACK_MIN = -200;

  const PCT_Y_FALLBACK_MAX = 200;

  const VAR_HORIZON_LABELS = [
    "var 1day",
    "var 1 months",
    "var 3 months",
    "var 6 months",
  ];

  const VAR_BAR_COLORS = ["#8B1538", "#B83256", "#D9587A", "#F4A0B5"];

  function meshTickvals(min, max, lines) {
    const n = Math.max(2, lines);
    const step = (max - min) / (n - 1);
    return Array.from({ length: n }, (_, i) => {
      const v = min + i * step;
      return Math.round(v * 100) / 100;
    });
  }

  const CHART_MESH_X = meshTickvals(SESSION_X_MIN, SESSION_X_MAX, MESH_X_LINES);

  const CHART_MESH_Y_LINES_FOR_DTICK = 4;

  const AXIS_TICK_STYLE = {
    ticks: "outside",
    ticklen: 6,
    tickwidth: 1,
    tickcolor: "#9ca3af",
    showticklabels: true,
  };



  const COLORS = {

    curva: ["#00c896", "#5eead4", "#2dd4bf", "#14b8a6"],

    storico: ["#60a5fa", "#93c5fd", "#38bdf8", "#0ea5e9"],

    modello: ["#c8ff00", "#d9f99d", "#a3e635", "#84cc16"],

    control: ["#9ca3af", "#c8ff00", "#f59e0b", "#ef4444"],

    combo: [

      "#00c896",

      "#60a5fa",

      "#c8ff00",

      "#f472b6",

      "#a78bfa",

      "#fb923c",

      "#22d3ee",

      "#facc15",

    ],

  };



  let bundle = null;



  function companies() {

    if (!bundle?.series) return [];

    return Object.entries(bundle.series)

      .filter(([, m]) => m.kind === "company")

      .map(([id, m]) => ({ id, label: m.label || id }));

  }



  function controls() {

    if (!bundle?.series) return [];

    return Object.entries(bundle.series)

      .filter(([, m]) => m.kind === "control")

      .map(([id, m]) => ({ id, label: m.label || id }));

  }



  function xyStandard(points, field) {

    const xs = [];

    const ys = [];

    for (const p of points || []) {

      if (p.nodo !== "standard") continue;

      const y = p[field];

      if (y == null || Number.isNaN(y)) continue;

      xs.push(Number(p.offset));

      ys.push(Number(y));

    }

    const order = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);

    return {

      x: order.map((i) => xs[i]),

      y: order.map((i) => ys[i]),

    };

  }



  function traceYGroups(traces) {
    return (traces || []).map((t) =>
      (t.y || [])
        .filter((v) => v != null && !Number.isNaN(Number(v)))
        .map((v) => Number(v))
    );
  }

  function variationYGroups(traces) {
    const n = traces[0]?.x?.length || 0;
    const groups = [];
    for (let i = 0; i < n; i++) {
      const vals = [];
      for (const t of traces) {
        const v = t.y?.[i];
        if (v != null && !Number.isNaN(Number(v))) vals.push(Number(v));
      }
      if (vals.length) groups.push(vals);
    }
    return groups;
  }

  function niceAxisStep(span) {
    if (span <= 0) return 10;
    const raw = span / Math.max(1, CHART_MESH_Y_LINES_FOR_DTICK - 1);
    if (raw <= 0) return 10;
    const mag = 10 ** Math.floor(Math.log10(raw));
    for (const m of [1, 2, 5, 10]) {
      const s = m * mag;
      if (s >= raw * 0.85) return s;
    }
    return mag * 10;
  }

  /** Min/max globali su tutte le serie visibili; +10% sugli estremi. */
  function yLimitsFromAllVisibleSeries(groups, opts = {}) {
    const anchorZero = !!opts.anchorZero;
    const all = (groups || []).flat();
    if (!all.length) {
      return {
        range: [PCT_Y_FALLBACK_MIN, PCT_Y_FALLBACK_MAX],
        dtick: 100,
      };
    }
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    let ymin = lo - 0.1 * Math.abs(lo);
    let ymax = hi + 0.1 * Math.abs(hi);
    if (anchorZero) {
      ymin = Math.min(ymin, 0);
      ymax = Math.max(ymax, 0);
    }
    if (ymin >= ymax) {
      const pad = Math.max(1, 0.1 * Math.max(Math.abs(ymin), Math.abs(ymax), 1));
      ymin -= pad;
      ymax += pad;
      if (anchorZero) {
        ymin = Math.min(ymin, 0);
        ymax = Math.max(ymax, 0);
      }
    }
    return { range: [ymin, ymax], dtick: niceAxisStep(ymax - ymin) };
  }

  function layoutBase(title, yLimits) {
    const yl = yLimits || yLimitsFromAllVisibleSeries([]);
    return {
      title: { text: title, font: { color: "#e8e8e8", size: 13 } },
      paper_bgcolor: "#0f1221",
      plot_bgcolor: "#0b1025",
      font: { color: "#9ca3af", size: 11 },
      margin: { l: 52, r: 16, t: 40, b: 44 },
      xaxis: {
        title: "Sessioni vs CD (−60 … +7)",
        range: [SESSION_X_MIN, SESSION_X_MAX],
        tickmode: "array",
        tickvals: CHART_MESH_X,
        ticktext: CHART_MESH_X.map((t) =>
          t > 0 ? `+${Math.round(t)}` : String(Math.round(t))
        ),
        showgrid: true,
        gridcolor: "#334155",
        gridwidth: 1,
        zerolinecolor: "#444",
        ...AXIS_TICK_STYLE,
      },
      yaxis: {
        title: "Δ% vs T−60",
        ticksuffix: "%",
        tickmode: "linear",
        range: yl.range,
        dtick: yl.dtick,
        showgrid: true,
        gridcolor: "#334155",
        gridwidth: 1,
        zerolinecolor: "#444",
        ...AXIS_TICK_STYLE,
      },
      legend: {
        orientation: "v",
        x: 1.02,
        xanchor: "left",
        y: 1,
        yanchor: "top",
        font: { size: 9 },
      },
      showlegend: true,
    };
  }

  function layoutPctSession(title, traces) {
    const yLimits = yLimitsFromAllVisibleSeries(traceYGroups(traces));
    const layout = layoutBase(title, null);
    delete layout.yaxis.range;
    layout.yaxis.autorange = true;
    layout.yaxis.rangemode = "normal";
    if (yLimits?.dtick > 0) {
      layout.yaxis.dtick = yLimits.dtick;
    }
    return layout;
  }



  function plot(divId, traces, title) {

    const el = document.getElementById(divId);

    if (!el || typeof Plotly === "undefined") return;

    let layout;

    if (divId === "chart-variations") {
      const varYL = yLimitsFromAllVisibleSeries(variationYGroups(traces), {
        anchorZero: true,
      });
      layout = {
        title: { text: title, font: { color: "#e8e8e8", size: 13 } },
        paper_bgcolor: "#0f1221",
        plot_bgcolor: "#0b1025",
        font: { color: "#9ca3af", size: 11 },
        margin: { l: 52, r: 120, t: 40, b: 56 },
        barmode: "group",
        yaxis: {
          title: "Var. %",
          autorange: true,
          rangemode: "tozero",
          dtick: varYL.dtick > 0 ? varYL.dtick : undefined,
          showgrid: true,
          gridcolor: "#334155",
          zeroline: true,
          zerolinecolor: "#666",
          ...AXIS_TICK_STYLE,
        },

        xaxis: {
          title: "Società",
          type: "category",
          showgrid: false,
          ...AXIS_TICK_STYLE,
        },

        legend: {
          orientation: "v",
          x: 1.02,
          xanchor: "left",
          y: 1,
          yanchor: "top",
          font: { size: 9 },
        },

        showlegend: true,

      };

    } else {

      layout = layoutPctSession(title, traces);

    }

    Plotly.react(el, traces, layout, {

      responsive: true,

      displayModeBar: false,

    });

  }



  function seriesTrace(points, field, label, color, dash) {

    const { x, y } = xyStandard(points, field);

    if (x.length < 2) return null;

    return {

      x,

      y,

      type: "scatter",

      mode: "lines+markers",

      name: label,

      line: { color, width: 2, dash: dash || "solid" },

      marker: { size: 8, line: { width: 1, color: color } },

    };

  }



  function getFlags() {

    return {

      showAll: document.getElementById("chk-all-cohort")?.checked ?? false,

      sidA: document.getElementById("sel-co-a")?.value || "",

      sidB: document.getElementById("sel-co-b")?.value || "",

    };

  }



  function cohortControlOnCombo(controlId) {
    const g4 = document.getElementById(`cohort-${controlId}-g4mu`);
    if (g4) return g4.checked;
    return cohortChecked(controlId, "mu");
  }

  function cohortChecked(companyId, key) {
    const el = document.getElementById(`cohort-${companyId}-${key}`);
    if (el) return el.checked;
    if (key === "g4curva" || key === "g4stor" || key === "g4mod") return true;
    return false;
  }

  function companyIdsForChartField(field) {
    const map = {
      pct_curva: "g1",
      pct_reale: "g2",
      pct_modello: "g3",
    };
    const key = map[field];
    if (!key) return [];
    return companies()
      .filter((c) => cohortChecked(c.id, key))
      .map((c) => c.id);
  }

  function companyIdsForField(flags) {
    const all = companies().map((c) => c.id);
    if (flags.showAll) return all;
    const out = [];
    if (flags.sidA) out.push(flags.sidA);
    if (flags.sidB && flags.sidB !== flags.sidA) out.push(flags.sidB);
    return out.length ? out : all.slice(0, 1);
  }

  /** Società nel grafico Var.%: unione spunte G5 e menu A/B (come Excel). */
  function companyIdsForVariation() {
    const flags = getFlags();
    const ids = new Set();
    if (flags.sidA) ids.add(flags.sidA);
    if (flags.sidB && flags.sidB !== flags.sidA) ids.add(flags.sidB);
    for (const c of companies()) {
      if (cohortChecked(c.id, "g5")) ids.add(c.id);
    }
    return [...ids].filter((id) => bundle.series[id]);
  }

  function applyCohortShortcuts() {
    const flags = getFlags();
    const all = flags.showAll;
    const ids = all
      ? companies().map((c) => c.id)
      : companyIdsForField(flags);
    for (const c of companies()) {
      const on = all || ids.includes(c.id);
      ["g1", "g2", "g3", "g5", "g4curva", "g4stor", "g4mod"].forEach((k) => {
        const el = document.getElementById(`cohort-${c.id}-${k}`);
        if (el) el.checked = on;
      });
    }
  }



  function escapeAttr(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  function readCohortState() {
    const state = { companies: {}, controls: {} };
    for (const c of companies()) {
      state.companies[c.id] = {
        g1: cohortChecked(c.id, "g1"),
        g2: cohortChecked(c.id, "g2"),
        g3: cohortChecked(c.id, "g3"),
        g4: cohortChecked(c.id, "g4"),
        g4curva: cohortChecked(c.id, "g4curva"),
        g4stor: cohortChecked(c.id, "g4stor"),
        g4mod: cohortChecked(c.id, "g4mod"),
        g5: cohortChecked(c.id, "g5"),
      };
    }
    for (const c of controls()) {
      state.controls[c.id] = {
        mu: cohortChecked(c.id, "mu"),
        g4mu: cohortControlOnCombo(c.id),
      };
    }
    state.comboSlots = readComboSlotState();
    return state;
  }

  function readComboSlotState() {
    const slots = [];
    for (let i = 0; i < COMBO_CTRL_SLOT_COUNT; i++) {
      const el = document.getElementById(`combo-ctrl-slot-${i}`);
      slots.push(el?.value || "");
    }
    return slots;
  }

  function comboSlotSeriesOptions() {
    const opts = [{ value: "", label: "(nessuna)" }];
    for (const c of controls()) {
      opts.push({ value: c.id, label: c.label || c.id });
    }
    return opts;
  }

  function ensureComboControlSlots() {
    const host = document.getElementById("combo-control-slots");
    if (!host) return;
    const prev = readComboSlotState();
    const opts = comboSlotSeriesOptions();
    let html =
      '<span class="combo-toolbar-label">G4 — curve di controllo aggiuntive</span>';
    for (let i = 0; i < COMBO_CTRL_SLOT_COUNT; i++) {
      const sel = prev[i] || "";
      html += `<label class="combo-slot-label">Slot ${i + 1}<select id="combo-ctrl-slot-${i}">`;
      for (const o of opts) {
        html += `<option value="${escapeAttr(o.value)}"${
          o.value === sel ? " selected" : ""
        }>${escapeAttr(o.label)}</option>`;
      }
      html += "</select></label>";
    }
    host.innerHTML = html;
  }

  function ensureCohortPanel() {
    const panel = document.getElementById("cohort-selection-panel");
    if (!panel) return;
    const prev = readCohortState();
    let html =
      '<span class="cohort-panel-title">Selezione coorte</span>' +
      '<div class="cohort-table-wrap"><table class="cohort-table"><thead><tr>' +
      "<th>Società</th><th>G1 curva</th><th>G2 stor.</th><th>G3 mod.</th>" +
      "<th>G4 comb.</th><th>G4 curva</th><th>G4 stor.</th><th>G4 mod.</th>" +
      "<th>G5 Var.%</th></tr></thead><tbody>";
    for (const c of companies()) {
      const p = prev.companies[c.id] || {};
      const g1 = p.g1 !== false;
      const g2 = p.g2 !== false;
      const g3 = p.g3 !== false;
      const g4 = !!p.g4;
      const g4curva = p.g4curva !== false;
      const g4stor = p.g4stor !== false;
      const g4mod = p.g4mod !== false;
      const g5 = !!p.g5;
      html += `<tr data-id="${escapeAttr(c.id)}"><td>${escapeAttr(c.label)}</td>`;
      html += `<td><input type="checkbox" id="cohort-${escapeAttr(c.id)}-g1"${g1 ? " checked" : ""}></td>`;
      html += `<td><input type="checkbox" id="cohort-${escapeAttr(c.id)}-g2"${g2 ? " checked" : ""}></td>`;
      html += `<td><input type="checkbox" id="cohort-${escapeAttr(c.id)}-g3"${g3 ? " checked" : ""}></td>`;
      html += `<td><input type="checkbox" id="cohort-${escapeAttr(c.id)}-g4"${g4 ? " checked" : ""}></td>`;
      html += `<td><input type="checkbox" id="cohort-${escapeAttr(c.id)}-g4curva"${g4curva ? " checked" : ""}></td>`;
      html += `<td><input type="checkbox" id="cohort-${escapeAttr(c.id)}-g4stor"${g4stor ? " checked" : ""}></td>`;
      html += `<td><input type="checkbox" id="cohort-${escapeAttr(c.id)}-g4mod"${g4mod ? " checked" : ""}></td>`;
      html += `<td><input type="checkbox" id="cohort-${escapeAttr(c.id)}-g5"${g5 ? " checked" : ""}></td></tr>`;
    }
    html += "</tbody></table>";
    if (controls().length) {
      html +=
        '<table class="cohort-table cohort-mu-table"><thead><tr>' +
        "<th>Curva μ</th><th>G1–G3</th><th>G4 comb.</th></tr></thead><tbody>";
      for (const c of controls()) {
        const st = prev.controls[c.id] || {};
        const onG13 = st.mu !== false;
        const onG4 = st.g4mu === true || (st.g4mu === undefined && st.mu === true);
        html += `<tr><td>${escapeAttr(c.label)}</td>`;
        html += `<td><input type="checkbox" id="cohort-${escapeAttr(c.id)}-mu"${
          onG13 ? " checked" : ""
        }></td>`;
        html += `<td><input type="checkbox" id="cohort-${escapeAttr(c.id)}-g4mu"${
          onG4 ? " checked" : ""
        }></td></tr>`;
      }
      html += "</tbody></table>";
    }
    html += "</div>";
    panel.innerHTML = html;
  }



  function buildMetricChart(divId, field, title, palette) {

    const traces = [];

    const ids = companyIdsForChartField(field);

    ids.forEach((id, i) => {
      const meta = bundle.series[id];
      if (!meta) return;
      const t = seriesTrace(
        meta.points,
        field,
        meta.label,
        palette[i % palette.length]
      );
      if (t) traces.push(t);
    });
    let mi = traces.length;
    for (const c of controls()) {
      if (!cohortChecked(c.id, "mu")) continue;
      const meta = bundle.series[c.id];
      if (!meta) continue;
      const t = seriesTrace(
        meta.points,
        "pct_curva",
        meta.label || c.id,
        COLORS.control[mi % COLORS.control.length],
        "dot"
      );
      if (t) {
        traces.push(t);
        mi += 1;
      }
    }
    plot(divId, traces, title);

  }



  function comboTipoActive(companyId, cohortKey) {
    if (!cohortChecked(companyId, "g4")) return false;
    const anyTipo = COMBO_TYPE_OPTIONS.some((o) =>
      cohortChecked(companyId, o.cohortKey)
    );
    if (!anyTipo) return true;
    return cohortChecked(companyId, cohortKey);
  }

  function buildComboChart() {
    const traces = [];
    let ci = 0;
    for (const c of companies()) {
      if (!cohortChecked(c.id, "g4")) continue;
      const meta = bundle.series[c.id];
      if (!meta) continue;
      for (const spec of COMBO_TYPE_OPTIONS) {
        if (!comboTipoActive(c.id, spec.cohortKey)) continue;
        const t = seriesTrace(
          meta.points,
          spec.field,
          `${meta.label || c.id} · ${spec.value}`,
          COLORS.combo[ci % COLORS.combo.length],
          spec.dash
        );
        if (t) {
          traces.push(t);
          ci += 1;
        }
      }
    }
    for (const c of controls()) {
      if (!cohortControlOnCombo(c.id)) continue;
      const meta = bundle.series[c.id];
      if (!meta) continue;
      const t = seriesTrace(
        meta.points,
        "pct_curva",
        meta.label || c.id,
        COLORS.control[ci % COLORS.control.length],
        "dot"
      );
      if (t) {
        traces.push(t);
        ci += 1;
      }
    }
    for (const sid of readComboSlotState()) {
      if (!sid || !bundle.series[sid]) continue;
      const meta = bundle.series[sid];
      const t = seriesTrace(
        meta.points,
        "pct_curva",
        meta.label || sid,
        COLORS.control[ci % COLORS.control.length],
        "dot"
      );
      if (t) {
        traces.push(t);
        ci += 1;
      }
    }
    plot("chart-combo", traces, "4 · Combinato — G4 (curve + controllo μ)");
  }

  function buildVariationChart() {
    const labels = [];
    const byHorizon = VAR_HORIZON_LABELS.map(() => []);

    const varIds = companyIdsForVariation();
    for (const sid of varIds) {
      if (!bundle.series[sid]) continue;
      const meta = bundle.series[sid];
      labels.push(meta.label || sid);
      const horizons = meta.var_horizons || [];
      for (let hi = 0; hi < VAR_HORIZON_LABELS.length; hi++) {
        const h = horizons[hi];
        const v = h?.pct;
        byHorizon[hi].push(
          v == null || Number.isNaN(Number(v)) ? null : Number(v)
        );
      }
    }

    if (labels.length < 1) {
      plot("chart-variations", [], "5 · Variazioni % — 1g · 1M · 3M · 6M");
      return;
    }

    const traces = VAR_HORIZON_LABELS.map((name, hi) => {
      const base = VAR_BAR_COLORS[hi % VAR_BAR_COLORS.length];
      const ys = byHorizon[hi];
      return {
        x: labels,
        y: ys,
        type: "bar",
        base: 0,
        name,
        marker: {
          color: ys.map((v) => {
            if (v == null || Number.isNaN(Number(v))) return "rgba(0,0,0,0)";
            return Number(v) < 0 ? "#e85d6f" : base;
          }),
        },
      };
    });

    plot("chart-variations", traces, "5 · Variazioni % — 1g · 1M · 3M · 6M");
  }


  function fillSelectors() {

    const selA = document.getElementById("sel-co-a");

    const selB = document.getElementById("sel-co-b");

    if (!selA || !selB) return;

    const prevA = selA.value;

    const prevB = selB.value;

    const opts = companies();

    const html =

      opts.map((o) => `<option value="${o.id}">${o.label}</option>`).join("") +

      '<option value="">(nessuna)</option>';

    selA.innerHTML = html;

    selB.innerHTML = html;

    if (opts.some((o) => o.id === prevA)) selA.value = prevA;

    else if (opts[0]) selA.value = opts[0].id;

    if (opts.some((o) => o.id === prevB)) selB.value = prevB;

    else selB.value = "";

    ensureCohortPanel();
    ensureComboControlSlots();

    applyCohortShortcuts();

  }



  function renderAll() {

    if (!bundle?.series) return;

    buildMetricChart(

      "chart-curva",

      "pct_curva",

      "1 · % curva ricalibrata",

      COLORS.curva

    );

    buildMetricChart(

      "chart-storico",

      "pct_reale",

      "2 · % storico",

      COLORS.storico

    );

    buildMetricChart(

      "chart-modello",

      "pct_modello",

      "3 · % modello",

      COLORS.modello

    );

    buildComboChart();

    buildVariationChart();

  }



  function setBundle(data) {

    bundle = data;

    fillSelectors();

    const note = document.getElementById("charts-note");

    if (note) {

      const n = companies().length;

      note.textContent = data.note

        ? data.note

        : `${n} società · offset ${(data.offsets || []).join(", ")} · ${data.loaded_at || ""}`;

    }

    renderAll();

  }



  function bindControls() {

    const ids = [

      "sel-co-a",

      "sel-co-b",

      "chk-all-cohort",

    ];

    ids.forEach((id) => {
      document.getElementById(id)?.addEventListener("change", () => {
        applyCohortShortcuts();
        renderAll();
      });
    });

    document.getElementById("cohort-selection-panel")?.addEventListener("change", renderAll);
    document.getElementById("combo-control-slots")?.addEventListener("change", renderAll);
  }



  window.SupernovaCharts = { setBundle, renderAll, bindControls };

})();


