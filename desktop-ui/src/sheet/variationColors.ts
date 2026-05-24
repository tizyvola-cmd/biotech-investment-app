/** Porta logica da ``variation_colors.py`` (openpyxl → CSS). */

export type CellStyle = {
  backgroundColor?: string;
  background?: string;
  color?: string;
  fontWeight?: string;
  fontStyle?: string;
};

const NEU: [number, number, number] = [245, 245, 247];
const LOSS_A: [number, number, number] = [227, 242, 253];
const LOSS_B: [number, number, number] = [13, 71, 161];
const GAIN_A: [number, number, number] = [255, 248, 225];
const GAIN_B: [number, number, number] = [245, 124, 0];

function smoothstep(u: number): number {
  const x = Math.max(0, Math.min(1, u));
  return x * x * (3 - 2 * x);
}

function lerpRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  const u = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * u),
    Math.round(a[1] + (b[1] - a[1]) * u),
    Math.round(a[2] + (b[2] - a[2]) * u),
  ];
}

function blendRgb(
  base: [number, number, number],
  overlay: [number, number, number],
  amount: number
): [number, number, number] {
  return lerpRgb(base, overlay, amount);
}

function relativeLuminance(rgb: [number, number, number]): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function rgbCss(rgb: [number, number, number]): string {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

/** Gradiente colonna t∈[0,1]: basso blu → neutro → alto ambra (come Excel). */
export function linearRgbDiverging(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  let rgb: [number, number, number];
  if (x <= 0.5) {
    rgb = lerpRgb(LOSS_B, NEU, smoothstep(x * 2));
  } else {
    rgb = lerpRgb(NEU, GAIN_B, smoothstep((x - 0.5) * 2));
  }
  return rgbCss(rgb);
}

/** Variazione % firmata — scala blu / ambra (Pred Simulation, ecc.). */
export function signedPctStyle(
  value: number,
  opts?: { maxAbs?: number; muted?: boolean; boldThreshold?: number }
): CellStyle | null {
  const maxAbs = opts?.maxAbs ?? 25;
  const muted = opts?.muted ?? false;
  const boldThreshold = opts?.boldThreshold ?? 5;

  if (!Number.isFinite(value)) return null;

  let rgb: [number, number, number];
  let color = "#424242";
  let bold = false;

  if (Math.abs(value) < 0.02) {
    rgb = NEU;
  } else if (value > 0) {
    const u = smoothstep(Math.min(1, value / maxAbs));
    rgb = lerpRgb(GAIN_A, GAIN_B, u);
    bold = value >= boldThreshold;
    color = relativeLuminance(rgb) < 145 ? "#FFFFFF" : u < 0.55 ? "#5D4037" : "#BF360C";
  } else {
    const u = smoothstep(Math.min(1, -value / maxAbs));
    rgb = lerpRgb(LOSS_A, LOSS_B, u);
    bold = -value >= boldThreshold;
    color = relativeLuminance(rgb) < 145 ? "#FFFFFF" : u < 0.55 ? "#0D47A1" : "#01579B";
  }

  if (muted) {
    rgb = blendRgb(rgb, [236, 239, 241], 0.28);
    if (relativeLuminance(rgb) < 140) color = "#FFFFFF";
    else if (color === "#FFFFFF") color = "#424242";
    bold = false;
  }

  return {
    backgroundColor: rgbCss(rgb),
    color,
    fontWeight: bold && !muted ? "600" : undefined,
  };
}

export type ColorScaleStats = { mean: number; std: number; n: number };

export function computeColorScaleStats(values: number[]): ColorScaleStats | null {
  const nums = values.filter((v) => Number.isFinite(v));
  if (nums.length < 2) return null;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
  const std = Math.sqrt(variance);
  if (std === 0) return null;
  return { mean, std, n: nums.length };
}

/** t per apply_linear_coloring (media ± 2σ). */
export function colorScaleT(value: number, stats: ColorScaleStats): number {
  const lo = stats.mean - 2 * stats.std;
  const span = 4 * stats.std;
  if (span <= 0) return 0.5;
  return Math.max(0, Math.min(1, (value - lo) / span));
}

export function colorScaleStyle(value: number, stats: ColorScaleStats): CellStyle {
  return { backgroundColor: linearRgbDiverging(colorScaleT(value, stats)) };
}
