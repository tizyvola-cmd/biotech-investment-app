/**
 * Chart.js fill gradients + scale colors from appearance theme CSS variables.
 * Curve line colors (--chart-*) stay fixed across violet/mint.
 */

export function chartGrad(
  ctx: CanvasRenderingContext2D,
  hex: string,
  alpha = 0.3,
  height = 200,
): CanvasGradient {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  const gr = ctx.createLinearGradient(0, 0, 0, height);
  gr.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
  gr.addColorStop(0.42, "rgba(220,190,100,0.14)");
  gr.addColorStop(1, "rgba(255,252,230,0)");
  return gr;
}

/** Retina / display scaling — keeps Chart.js canvas sharp on HiDPI screens. */
export function chartDevicePixelRatio(): number {
  if (typeof window === "undefined") return 2;
  const dpr = window.devicePixelRatio || 1;
  return Math.min(3, Math.max(1.5, dpr));
}

export function chartScaleStyle() {
  if (typeof document === "undefined") {
    return {
      grid: { color: "rgba(194, 186, 224, 0.22)" },
      ticks: { color: "#9b90be", font: { size: 10 } },
    };
  }
  const style = getComputedStyle(document.documentElement);
  const grid = style.getPropertyValue("--sn-chart-grid").trim() || "rgba(194, 186, 224, 0.22)";
  const tick = style.getPropertyValue("--sn-chart-tick").trim() || "#9b90be";
  return {
    grid: { color: grid },
    ticks: { color: tick, font: { size: 10 } },
  };
}

/** Recharts CartesianGrid stroke from current theme. */
export function rechartsGridStroke(): string {
  return chartScaleStyle().grid.color;
}

/** Recharts axis tick fill from current theme. */
export function rechartsTickFill(): string {
  return chartScaleStyle().ticks.color;
}

type BubbleLabelRaw = { bandLabel?: string; n?: number };

/** Draw RA band label + n on Chart.js bubble points. */
export function bubbleBandLabelPlugin(textColor = "#1e1530") {
  return {
    id: "bubbleBandLabels",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    afterDatasetsDraw(chart: any) {
      const { ctx } = chart as { ctx: CanvasRenderingContext2D };
      const meta = chart.getDatasetMeta(0);
      const points = (chart.data.datasets[0]?.data ?? []) as BubbleLabelRaw[];
      if (!meta?.data?.length) return;

      ctx.save();
      ctx.textAlign = "center";
      meta.data.forEach((el: { getProps: (keys: string[]) => { x: number; y: number } }, i: number) => {
        const raw = points[i];
        const band = raw?.bandLabel;
        const n = raw?.n ?? 0;
        if (!band || n <= 0) return;
        const { x, y } = el.getProps(["x", "y"]);
        ctx.font = "700 10px sans-serif";
        ctx.fillStyle = textColor;
        ctx.shadowColor = "rgba(255,255,255,0.85)";
        ctx.shadowBlur = 3;
        ctx.fillText(`RA ${band}`, x, y - 4);
        ctx.font = "600 9px sans-serif";
        ctx.fillText(`n=${n}`, x, y + 8);
        ctx.shadowBlur = 0;
      });
      ctx.restore();
    },
  };
}

function snCssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** Pre-CD / post-CD background zones + CD vertical separator (categorical x index). */
export function cdZonePlugin(cdNodeIndex: number) {
  return {
    id: `cdZone_${cdNodeIndex}`,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    beforeDraw(chart: any) {
      const { ctx, chartArea: ca, scales } = chart;
      const x = scales.x;
      if (!ca || !x) return;
      const xCd = x.getPixelForValue(cdNodeIndex);
      ctx.save();
      ctx.fillStyle = snCssVar("--sn-zone-past", "rgba(148,163,184,0.08)");
      ctx.fillRect(ca.left, ca.top, xCd - ca.left, ca.height);
      ctx.fillStyle = snCssVar("--sn-zone-cd", "rgba(250,238,180,0.42)");
      ctx.fillRect(xCd, ca.top, ca.right - xCd, ca.height);
      const cdColor = snCssVar("--sn-accent", "#C8924A");
      ctx.strokeStyle = cdColor;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(xCd, ca.top);
      ctx.lineTo(xCd, ca.bottom);
      ctx.stroke();
      ctx.fillStyle = cdColor;
      ctx.font = "500 10px sans-serif";
      ctx.setLineDash([]);
      ctx.fillText("CD", xCd + 4, ca.top + 13);
      ctx.restore();
    },
  };
}

/** Vertical marker at the T-node with smallest pred/actual gap (★ closest). */
export function bestAccurateNodePlugin(
  nodeIndex: number,
  label: string,
  mae: number,
  caption = "★ closest",
) {
  return {
    id: `bestAccurate_${nodeIndex}`,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    afterDatasetsDraw(chart: any) {
      const { ctx, chartArea: ca, scales } = chart;
      const x = scales.x;
      if (!ca || !x || nodeIndex < 0) return;
      const xPx = x.getPixelForValue(nodeIndex);
      const color = snCssVar("--sn-long-text", "#5A9A18");
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(xPx, ca.top);
      ctx.lineTo(xPx, ca.bottom);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = "700 10px sans-serif";
      ctx.setLineDash([]);
      ctx.fillText(`${caption} ${label}`, xPx + 4, ca.top + 12);
      ctx.font = "600 9px sans-serif";
      ctx.fillText(`±${mae}pp`, xPx + 4, ca.top + 24);
      ctx.restore();
    },
  };
}

/** Vertical dashed marker at a categorical x index (e.g. «today» T-node). */
export function todayNodePlugin(nodeIndex: number, label = "Today") {
  return {
    id: `todayNode_${nodeIndex}`,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    afterDatasetsDraw(chart: any) {
      const { ctx, chartArea: ca, scales } = chart;
      const x = scales.x;
      if (!ca || !x || nodeIndex < 0) return;
      const xPx = x.getPixelForValue(nodeIndex);
      const color = snCssVar("--sn-accent", "#C8924A");
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(xPx, ca.top);
      ctx.lineTo(xPx, ca.bottom);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = "600 9px sans-serif";
      ctx.setLineDash([]);
      ctx.fillText(label, xPx + 3, ca.top + 24);
      ctx.restore();
    },
  };
}

/** Horizontal dashed reference line on a given y scale. */
export function refLinePlugin(
  yValue: number,
  label: string,
  color: string,
  yAxisId = "y",
) {
  return {
    id: `refLine_${yValue}_${yAxisId}`,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    afterDraw(chart: any) {
      const { ctx, chartArea: ca, scales } = chart;
      const yScale = scales[yAxisId];
      if (!ca || !yScale) return;
      const yPx = yScale.getPixelForValue(yValue);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(ca.left, yPx);
      ctx.lineTo(ca.right, yPx);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = "10px sans-serif";
      ctx.setLineDash([]);
      ctx.fillText(label, ca.right - label.length * 6, yPx - 4);
      ctx.restore();
    },
  };
}

/** Gray vertical bands where threshold success rate is based on too few signals (categorical x). */
export function thresholdLowSampleZonePlugin(lowSampleIndices: number[]) {
  const key = lowSampleIndices.join("_") || "none";
  return {
    id: `thresholdLowN_${key}`,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    beforeDatasetsDraw(chart: any) {
      const { ctx, chartArea: ca, scales } = chart;
      const xScale = scales.x;
      if (!ca || !xScale || lowSampleIndices.length === 0) return;
      const nCats = (chart.data.labels as unknown[] | undefined)?.length ?? 0;
      ctx.save();
      ctx.fillStyle = snCssVar("--sn-chart-low-n", "rgba(148,163,184,0.2)");
      for (const i of lowSampleIndices) {
        if (i < 0 || i >= nCats) continue;
        const center = xScale.getPixelForValue(i);
        const prevCenter = i > 0 ? xScale.getPixelForValue(i - 1) : center;
        const nextCenter = i < nCats - 1 ? xScale.getPixelForValue(i + 1) : center;
        const left = i === 0 ? ca.left : (center + prevCenter) / 2;
        const right = i === nCats - 1 ? ca.right : (center + nextCenter) / 2;
        ctx.fillRect(left, ca.top, right - left, ca.height);
      }
      ctx.restore();
    },
  };
}

/** Reusable Chart.js plugin: horizontal threshold zone + dashed line. */
export function thresholdZonePlugin(yValue: number, label: string, color = "#5A9A18") {
  return {
    id: `thresholdZone_${yValue}`,
    beforeDraw(chart: {
      ctx: CanvasRenderingContext2D;
      chartArea?: { left: number; right: number; width: number };
      scales: { y?: { getPixelForValue: (v: number) => number; max: number } };
    }) {
      const { ctx, chartArea: ca, scales } = chart;
      const y = scales.y;
      if (!ca || !y) return;
      const yPx = y.getPixelForValue(yValue);
      const yTop = y.getPixelForValue(y.max);
      ctx.save();
      const fillColor = color.startsWith("rgb")
        ? color.replace(")", ",0.07)").replace("rgb", "rgba")
        : color.length === 7
          ? `${color}12`
          : color;
      ctx.fillStyle = fillColor;
      ctx.fillRect(ca.left, yTop, ca.width, yPx - yTop);
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ca.left, yPx);
      ctx.lineTo(ca.right, yPx);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = "500 10px sans-serif";
      ctx.setLineDash([]);
      ctx.fillText(label, ca.right - label.length * 6.5, yPx - 4);
      ctx.restore();
    },
  };
}
