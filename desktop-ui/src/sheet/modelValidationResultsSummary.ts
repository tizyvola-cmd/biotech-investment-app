import type { TranslationKey } from "../shared/i18n";
import type { EvalComparison, EvaluationResults } from "../data/evaluationModelData";

export type ResultsSummaryBullet = {
  key: TranslationKey;
  vars?: Record<string, string | number>;
};

export type ResultsSummaryTone = "good" | "warn" | "bad" | "neutral";

export type ValidationResultsSummary = {
  tone: ResultsSummaryTone;
  headlineKey: TranslationKey;
  headlineVars?: Record<string, string | number>;
  bullets: ResultsSummaryBullet[];
};

function pct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v * 100)}%`;
}

function maeFmt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(1)}%`;
}

function uShapeVerdict(nodes: { node: string; mae: number | null }[]): {
  ok: boolean;
  bestNode: string;
} {
  const withMae = nodes.filter((n) => n.mae != null && Number.isFinite(n.mae));
  if (withMae.length < 3) return { ok: false, bestNode: "—" };
  const best = withMae.reduce((a, b) => ((a.mae ?? 999) <= (b.mae ?? 999) ? a : b));
  const ok = ["T-10", "T-7", "T-5", "T-3"].includes(best.node);
  return { ok, bestNode: best.node };
}

function t5Quality(mae: number | null | undefined, dir: number | null | undefined): ResultsSummaryTone {
  const m = mae ?? 999;
  const d = dir ?? 0;
  if (m <= 6 && d >= 0.52) return "good";
  if (m > 12 || d < 0.38) return "bad";
  return "warn";
}

function baselineVerdict(
  comparison: EvalComparison | null,
): "unreliable" | "improved" | "mixed" | "worse" | "unchanged" | "none" {
  if (!comparison?.summary) return "none";
  if (comparison.warning) return "unreliable";
  const { mae_t5_delta, dir_t5_delta_pp } = comparison.summary;
  if (mae_t5_delta == null && dir_t5_delta_pp == null) return "none";
  const maeBetter = mae_t5_delta != null && mae_t5_delta < -0.3;
  const maeWorse = mae_t5_delta != null && mae_t5_delta > 0.3;
  const dirBetter = dir_t5_delta_pp != null && dir_t5_delta_pp > 1;
  const dirWorse = dir_t5_delta_pp != null && dir_t5_delta_pp < -1;
  if (maeBetter && dirBetter) return "improved";
  if (maeWorse && dirWorse) return "worse";
  if (maeBetter || dirBetter || maeWorse || dirWorse) return "mixed";
  return "unchanged";
}

export function buildValidationResultsSummary(
  data: EvaluationResults | null,
  comparison: EvalComparison | null,
): ValidationResultsSummary | null {
  const nodes = data?.node_accuracy?.nodes ?? [];
  if (!nodes.length) return null;

  const t5 = nodes.find((n) => n.node === "T-5");
  const slope5 = data?.slope_signals?.signals?.find((s) => s.signal === "slope5");
  const uShape = uShapeVerdict(nodes);
  const tone = t5Quality(t5?.mae, t5?.direction_accuracy);
  const baseV = baselineVerdict(comparison);

  const headlineKey: TranslationKey =
    tone === "good"
      ? "modelLab.validation.resultsHeadlineGood"
      : tone === "bad"
        ? "modelLab.validation.resultsHeadlineBad"
        : "modelLab.validation.resultsHeadlineWarn";

  const lookbackCds = data?.lookback_cds;
  const bullets: ResultsSummaryBullet[] = [
    {
      key:
        lookbackCds === 0
          ? "modelLab.validation.resultsBulletSampleShort"
          : "modelLab.validation.resultsBulletSampleShortN",
      vars: {
        tickers: data?.node_accuracy?.total_tickers ?? 0,
        cds: lookbackCds ?? 0,
        n: t5?.n_samples ?? 0,
        mae: maeFmt(t5?.mae),
        dir: pct(t5?.direction_accuracy),
      },
    },
  ];

  if (!uShape.ok) {
    bullets.push({
      key: "modelLab.validation.resultsBulletUShapeShort",
      vars: { node: uShape.bestNode },
    });
  }

  if (slope5?.direction_accuracy != null && slope5.direction_accuracy >= 0.55) {
    bullets.push({
      key: "modelLab.validation.resultsBulletSlope5Short",
      vars: { dir: pct(slope5.direction_accuracy) },
    });
  }

  if (data?.node_accuracy?.mock_fallback) {
    bullets.push({ key: "modelLab.validation.resultsBulletMockShort" });
  } else if (baseV === "unreliable") {
    bullets.push({ key: "modelLab.validation.resultsBulletBaselineUnreliable" });
  } else if (baseV === "improved" && comparison?.summary) {
    bullets.push({
      key: "modelLab.validation.resultsBulletBaselineImprovedShort",
      vars: {
        maeDelta: comparison.summary.mae_t5_delta?.toFixed(2) ?? "—",
        dirDelta: comparison.summary.dir_t5_delta_pp?.toFixed(1) ?? "—",
      },
    });
  } else if (baseV === "worse" && comparison?.summary) {
    bullets.push({
      key: "modelLab.validation.resultsBulletBaselineWorseShort",
      vars: {
        maeDelta: comparison.summary.mae_t5_delta?.toFixed(2) ?? "—",
      },
    });
  }

  return {
    tone,
    headlineKey,
    headlineVars: { dir: pct(t5?.direction_accuracy), mae: maeFmt(t5?.mae) },
    bullets: bullets.slice(0, 3),
  };
}
