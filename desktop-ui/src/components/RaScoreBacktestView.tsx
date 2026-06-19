import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { RascoreObservation } from "../sheet/rascoreSignalImpactView";
import { useLang } from "../shared/i18n";

type SignalType = "BUY" | "HOLD" | "AVOID";
type Outcome = "WIN" | "LOSS" | "FLAT" | "N/A";
type Classification = "TP" | "FP" | "TN" | "FN" | "N/A";

type BacktestSignal = {
  ticker: string;
  rowKey: string;
  raScore: number;
  signalType: SignalType;
  priceChg7d: number | null;
  outcome: Outcome;
  classification: Classification;
};

const ENTRY_THRESHOLD = 70;
const HOLD_THRESHOLD = 50;
const EXIT_THRESHOLD = 35;
const WIN_PCT = 5;
const LOSS_PCT = -5;

const RA_BIN_SIZE = 10;
const RA_BIN_COUNT = 10;

function classify(raScore: number, priceChg7d: number | null) {
  let signalType: SignalType;
  if (raScore >= ENTRY_THRESHOLD) signalType = "BUY";
  else if (raScore >= HOLD_THRESHOLD) signalType = "HOLD";
  else signalType = "AVOID";

  let outcome: Outcome = "N/A";
  if (priceChg7d === null || Number.isNaN(priceChg7d)) {
    outcome = "N/A";
  } else if (priceChg7d > WIN_PCT) outcome = "WIN";
  else if (priceChg7d < LOSS_PCT) outcome = "LOSS";
  else outcome = "FLAT";

  let classification: Classification = "N/A";
  if (outcome === "N/A" || outcome === "FLAT") {
    classification = "N/A";
  } else if (signalType === "BUY" && outcome === "WIN") classification = "TP";
  else if (signalType === "BUY" && outcome === "LOSS") classification = "FP";
  else if (signalType === "AVOID" && outcome === "LOSS") classification = "TN";
  else if (signalType === "AVOID" && outcome === "WIN") classification = "FN";

  return { signalType, outcome, classification };
}

function computeMetrics(signals: BacktestSignal[]) {
  const tp = signals.filter((s) => s.classification === "TP").length;
  const fp = signals.filter((s) => s.classification === "FP").length;
  const tn = signals.filter((s) => s.classification === "TN").length;
  const fn = signals.filter((s) => s.classification === "FN").length;

  const total = tp + fp + tn + fn;
  const accuracy = total > 0 ? ((tp + tn) / total) * 100 : 0;
  const precision = tp + fp > 0 ? (tp / (tp + fp)) * 100 : 0;
  const recall = tp + fn > 0 ? (tp / (tp + fn)) * 100 : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return { tp, fp, tn, fn, accuracy, precision, recall, f1 };
}

type Bin = {
  bin: string;
  raMin: number;
  raMax: number;
  raMid: number;
  win: number;
  loss: number;
  flat: number;
  na: number;
  total: number;
  resolved: number;
  winRate: number | null;
  avgPrice7d: number | null;
};

function buildBins(signals: BacktestSignal[]): Bin[] {
  const bins: Bin[] = Array.from({ length: RA_BIN_COUNT }, (_, i) => {
    const raMin = i * RA_BIN_SIZE;
    const raMax = raMin + RA_BIN_SIZE;
    return {
      bin: `${raMin}-${raMax === 100 ? 100 : raMax - 1}`,
      raMin,
      raMax,
      raMid: raMin + RA_BIN_SIZE / 2,
      win: 0,
      loss: 0,
      flat: 0,
      na: 0,
      total: 0,
      resolved: 0,
      winRate: null,
      avgPrice7d: null,
    };
  });

  const sumPriceByBin = new Array<number>(RA_BIN_COUNT).fill(0);
  const countPriceByBin = new Array<number>(RA_BIN_COUNT).fill(0);

  for (const sig of signals) {
    let idx = Math.floor(sig.raScore / RA_BIN_SIZE);
    if (idx < 0) idx = 0;
    if (idx >= RA_BIN_COUNT) idx = RA_BIN_COUNT - 1;
    const b = bins[idx]!;
    b.total += 1;
    if (sig.outcome === "WIN") b.win += 1;
    else if (sig.outcome === "LOSS") b.loss += 1;
    else if (sig.outcome === "FLAT") b.flat += 1;
    else b.na += 1;

    if (sig.priceChg7d !== null && !Number.isNaN(sig.priceChg7d)) {
      sumPriceByBin[idx]! += sig.priceChg7d;
      countPriceByBin[idx]! += 1;
    }
  }

  for (let i = 0; i < bins.length; i++) {
    const b = bins[i]!;
    b.resolved = b.win + b.loss;
    b.winRate = b.resolved > 0 ? (b.win / b.resolved) * 100 : null;
    b.avgPrice7d =
      countPriceByBin[i]! > 0 ? sumPriceByBin[i]! / countPriceByBin[i]! : null;
  }

  return bins;
}

const COLOR_WIN = "#16a34a";
const COLOR_LOSS = "#dc2626";
const COLOR_FLAT = "#9ca3af";
const COLOR_ACCENT = "#7c3aed";
const COLOR_ENTRY = "#16a34a";
const COLOR_EXIT = "#dc2626";

export function RaScoreBacktestView({
  observations,
}: {
  observations: RascoreObservation[];
}) {
  const { lang } = useLang();
  const it = lang === "it";

  const signals = useMemo<BacktestSignal[]>(
    () =>
      observations.map((obs) => {
        const c = classify(obs.score, obs.priceChg7d);
        return {
          ticker: obs.ticker,
          rowKey: obs.rowKey,
          raScore: obs.score,
          priceChg7d: obs.priceChg7d,
          ...c,
        };
      }),
    [observations],
  );

  const metrics = useMemo(() => computeMetrics(signals), [signals]);
  const bins = useMemo(() => buildBins(signals), [signals]);

  const winRatePoints = useMemo(
    () =>
      bins
        .filter((b) => b.resolved >= 2)
        .map((b) => ({
          ra: b.raMid,
          bin: b.bin,
          winRate: b.winRate,
          resolved: b.resolved,
          avgPrice7d: b.avgPrice7d,
        })),
    [bins],
  );

  const decisionByBin = useMemo(
    () =>
      bins.map((b) => {
        const isEntry = b.raMin >= ENTRY_THRESHOLD;
        const isExit = b.raMax <= EXIT_THRESHOLD;
        const recommendation: "ENTRY" | "EXIT" | "WAIT" = isEntry
          ? "ENTRY"
          : isExit
            ? "EXIT"
            : "WAIT";
        const correct =
          recommendation === "ENTRY"
            ? b.win
            : recommendation === "EXIT"
              ? b.loss
              : 0;
        const wrong =
          recommendation === "ENTRY"
            ? b.loss
            : recommendation === "EXIT"
              ? b.win
              : 0;
        const decided = correct + wrong;
        return {
          ...b,
          recommendation,
          correct,
          wrong,
          successRate: decided > 0 ? (correct / decided) * 100 : null,
        };
      }),
    [bins],
  );

  const totalResolved = signals.filter(
    (s) => s.outcome === "WIN" || s.outcome === "LOSS",
  ).length;

  if (observations.length === 0) {
    return (
      <div className="p-4 text-xs text-ink-muted text-center">
        {it
          ? "Nessun dato storico disponibile per backtest."
          : "No historical data available for backtest."}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Metrics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          label={it ? "Accuratezza" : "Accuracy"}
          value={`${metrics.accuracy.toFixed(1)}%`}
          sub="(TP+TN) / Total"
          tone="green"
        />
        <MetricCard
          label={it ? "Precisione (BUY)" : "Precision (BUY)"}
          value={`${metrics.precision.toFixed(1)}%`}
          sub={it ? "BUY corretti" : "Correct BUYs"}
          tone="blue"
        />
        <MetricCard
          label={it ? "Richiamo (BUY)" : "Recall (BUY)"}
          value={`${metrics.recall.toFixed(1)}%`}
          sub={it ? "WIN catturati" : "WINs captured"}
          tone="purple"
        />
        <MetricCard
          label="F1 Score"
          value={`${metrics.f1.toFixed(1)}%`}
          sub="2·P·R / (P+R)"
          tone="amber"
        />
      </div>

      {/* CHART 1 — Distribuzione RA score per outcome */}
      <ChartCard
        title={
          it
            ? "Distribuzione RA score per esito (7 giorni)"
            : "RA Score distribution by outcome (7-day)"
        }
        subtitle={
          it
            ? `${signals.length} segnali storici · WIN se prezzo >+5% · LOSS se <-5% · FLAT altrimenti`
            : `${signals.length} historical signals · WIN if price >+5% · LOSS if <-5% · FLAT otherwise`
        }
      >
        <ResponsiveContainer width="100%" height={260}>
          <BarChart
            data={bins}
            margin={{ top: 8, right: 16, left: 4, bottom: 24 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" opacity={0.3} />
            <XAxis
              dataKey="bin"
              tick={{ fontSize: 11, fill: "rgb(var(--ink-muted))" }}
              label={{
                value: it ? "Range RA score" : "RA score range",
                position: "insideBottom",
                offset: -10,
                style: { fontSize: 11, fill: "rgb(var(--ink-muted))" },
              }}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "rgb(var(--ink-muted))" }}
              label={{
                value: it ? "Segnali" : "Signals",
                angle: -90,
                position: "insideLeft",
                style: { fontSize: 11, fill: "rgb(var(--ink-muted))" },
              }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "rgb(var(--surface-elevated))",
                border: "1px solid rgb(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Legend
              verticalAlign="bottom"
              wrapperStyle={{ fontSize: 11, paddingTop: 16 }}
            />
            <ReferenceArea
              x1={`${EXIT_THRESHOLD - (EXIT_THRESHOLD % RA_BIN_SIZE)}-${
                EXIT_THRESHOLD - (EXIT_THRESHOLD % RA_BIN_SIZE) + RA_BIN_SIZE - 1
              }`}
              x2="0-9"
              fill={COLOR_EXIT}
              fillOpacity={0.06}
              label={{
                value: it ? "Zona EXIT (<35)" : "EXIT zone (<35)",
                position: "insideTopLeft",
                fontSize: 10,
                fill: COLOR_EXIT,
              }}
            />
            <ReferenceArea
              x1="70-79"
              x2="90-100"
              fill={COLOR_ENTRY}
              fillOpacity={0.08}
              label={{
                value: it ? "Zona ENTRY (≥70)" : "ENTRY zone (≥70)",
                position: "insideTopRight",
                fontSize: 10,
                fill: COLOR_ENTRY,
              }}
            />
            <Bar
              dataKey="win"
              stackId="outcome"
              fill={COLOR_WIN}
              name={it ? "WIN (>+5%)" : "WIN (>+5%)"}
            />
            <Bar
              dataKey="loss"
              stackId="outcome"
              fill={COLOR_LOSS}
              name={it ? "LOSS (<-5%)" : "LOSS (<-5%)"}
            />
            <Bar
              dataKey="flat"
              stackId="outcome"
              fill={COLOR_FLAT}
              name="FLAT"
            />
          </BarChart>
        </ResponsiveContainer>
        <p className="text-[10px] text-ink-muted/85 mt-2 leading-snug">
          {it
            ? "Lettura: zone verdi (RA ≥70) dovrebbero essere dominate da WIN; zone rosse (RA <35) da LOSS. Eccessi nella direzione opposta indicano falsi segnali."
            : "Reading: green zones (RA ≥70) should be dominated by WIN; red zones (RA <35) by LOSS. Excess in the opposite direction means false signals."}
        </p>
      </ChartCard>

      {/* CHART 2 — Curva di affidabilità (Win rate vs RA) */}
      <ChartCard
        title={
          it
            ? "Curva di affidabilità — probabilità di WIN per RA score"
            : "Reliability curve — WIN probability per RA score"
        }
        subtitle={
          it
            ? "P(WIN | RA score) calcolato su segnali risolti (WIN o LOSS, ignorato FLAT)"
            : "P(WIN | RA score) on resolved signals (WIN or LOSS, FLAT ignored)"
        }
      >
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart
            data={winRatePoints}
            margin={{ top: 8, right: 16, left: 4, bottom: 24 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" opacity={0.3} />
            <XAxis
              dataKey="ra"
              type="number"
              domain={[0, 100]}
              ticks={[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]}
              tick={{ fontSize: 11, fill: "rgb(var(--ink-muted))" }}
              label={{
                value: "RA score",
                position: "insideBottom",
                offset: -10,
                style: { fontSize: 11, fill: "rgb(var(--ink-muted))" },
              }}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fontSize: 11, fill: "rgb(var(--ink-muted))" }}
              label={{
                value: it ? "P(WIN) %" : "P(WIN) %",
                angle: -90,
                position: "insideLeft",
                style: { fontSize: 11, fill: "rgb(var(--ink-muted))" },
              }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "rgb(var(--surface-elevated))",
                border: "1px solid rgb(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(value: number, name: string) => {
                if (name === "winRate")
                  return [`${value.toFixed(1)}%`, it ? "P(WIN)" : "P(WIN)"];
                if (name === "resolved")
                  return [value, it ? "Segnali" : "Signals"];
                return [value, name];
              }}
              labelFormatter={(label: number) =>
                `RA ${label - 5}-${label + 5}`
              }
            />
            <Legend
              verticalAlign="bottom"
              wrapperStyle={{ fontSize: 11, paddingTop: 16 }}
            />
            <ReferenceArea
              x1={0}
              x2={EXIT_THRESHOLD}
              fill={COLOR_EXIT}
              fillOpacity={0.06}
              label={{
                value: it ? "EXIT (<35)" : "EXIT (<35)",
                position: "insideTopLeft",
                fontSize: 10,
                fill: COLOR_EXIT,
              }}
            />
            <ReferenceArea
              x1={ENTRY_THRESHOLD}
              x2={100}
              fill={COLOR_ENTRY}
              fillOpacity={0.08}
              label={{
                value: it ? "ENTRY (≥70)" : "ENTRY (≥70)",
                position: "insideTopRight",
                fontSize: 10,
                fill: COLOR_ENTRY,
              }}
            />
            <ReferenceLine
              y={50}
              stroke="rgb(var(--ink-muted))"
              strokeDasharray="4 4"
              label={{
                value: it ? "casuale 50%" : "random 50%",
                position: "right",
                fontSize: 10,
                fill: "rgb(var(--ink-muted))",
              }}
            />
            <Bar
              dataKey="resolved"
              fill={COLOR_FLAT}
              fillOpacity={0.35}
              yAxisId={0}
              name={it ? "Segnali (n)" : "Signals (n)"}
              barSize={18}
            />
            <Line
              type="monotone"
              dataKey="winRate"
              stroke={COLOR_ACCENT}
              strokeWidth={3}
              name={it ? "P(WIN)" : "P(WIN)"}
              dot={{ r: 4, fill: COLOR_ACCENT }}
              activeDot={{ r: 6 }}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
        <p className="text-[10px] text-ink-muted/85 mt-2 leading-snug">
          {it
            ? "La curva sale = score più alti predicono meglio il rialzo. Una curva piatta o invertita indica calibrazione debole. Le barre grigie mostrano la quantità di segnali in ogni bin (più dati = misura più affidabile)."
            : "Rising curve = higher scores predict gains better. Flat or inverted curve = weak calibration. Gray bars show signal count per bin (more data = more reliable estimate)."}
        </p>
      </ChartCard>

      {/* CHART 3 — Variazione media prezzo 7d per bin RA */}
      <ChartCard
        title={
          it
            ? "Variazione media prezzo a 7 giorni per RA score"
            : "Average 7-day price change per RA score"
        }
        subtitle={
          it
            ? "Verde = guadagno medio, rosso = perdita media. Conferma se i bin alti rendono."
            : "Green = average gain, red = average loss. Confirms if high bins actually return."
        }
      >
        <ResponsiveContainer width="100%" height={240}>
          <BarChart
            data={bins}
            margin={{ top: 8, right: 16, left: 4, bottom: 24 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgb(var(--border))"
              opacity={0.3}
            />
            <XAxis
              dataKey="bin"
              tick={{ fontSize: 11, fill: "rgb(var(--ink-muted))" }}
              label={{
                value: it ? "Range RA score" : "RA score range",
                position: "insideBottom",
                offset: -10,
                style: { fontSize: 11, fill: "rgb(var(--ink-muted))" },
              }}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "rgb(var(--ink-muted))" }}
              label={{
                value: it ? "Δ media 7d %" : "Avg 7d Δ %",
                angle: -90,
                position: "insideLeft",
                style: { fontSize: 11, fill: "rgb(var(--ink-muted))" },
              }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "rgb(var(--surface-elevated))",
                border: "1px solid rgb(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(value: number) => [
                `${value > 0 ? "+" : ""}${value.toFixed(2)}%`,
                it ? "Δ media 7d" : "Avg 7d Δ",
              ]}
            />
            <ReferenceLine y={0} stroke="rgb(var(--ink-muted))" strokeWidth={1} />
            <Bar dataKey="avgPrice7d" name={it ? "Δ media 7d %" : "Avg 7d Δ %"}>
              {bins.map((b, i) => (
                <Cell
                  key={i}
                  fill={
                    b.avgPrice7d == null
                      ? COLOR_FLAT
                      : b.avgPrice7d >= 0
                        ? COLOR_WIN
                        : COLOR_LOSS
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* CHART 4 — Probabilità di raccomandazione corretta per bin */}
      <ChartCard
        title={
          it
            ? "Probabilità che la raccomandazione sia corretta"
            : "Probability that the recommendation is correct"
        }
        subtitle={
          it
            ? "Per ogni bin: ENTRY (≥70) → corretto se WIN, EXIT (<35) → corretto se LOSS, WAIT → nessuna decisione"
            : "Per bin: ENTRY (≥70) → correct if WIN, EXIT (<35) → correct if LOSS, WAIT → no call"
        }
      >
        <ResponsiveContainer width="100%" height={260}>
          <BarChart
            data={decisionByBin}
            margin={{ top: 8, right: 16, left: 4, bottom: 24 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" opacity={0.3} />
            <XAxis
              dataKey="bin"
              tick={{ fontSize: 11, fill: "rgb(var(--ink-muted))" }}
              label={{
                value: it ? "Range RA score" : "RA score range",
                position: "insideBottom",
                offset: -10,
                style: { fontSize: 11, fill: "rgb(var(--ink-muted))" },
              }}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "rgb(var(--ink-muted))" }}
              label={{
                value: it ? "Decisioni" : "Decisions",
                angle: -90,
                position: "insideLeft",
                style: { fontSize: 11, fill: "rgb(var(--ink-muted))" },
              }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "rgb(var(--surface-elevated))",
                border: "1px solid rgb(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(value: number, name: string, props: { payload?: { recommendation?: string; successRate?: number | null } }) => {
                const reco = props?.payload?.recommendation;
                const rate = props?.payload?.successRate;
                if (name === "correct")
                  return [
                    `${value} ${rate != null ? `· ${rate.toFixed(0)}%` : ""}`,
                    `${it ? "Corretti" : "Correct"} (${reco})`,
                  ];
                if (name === "wrong")
                  return [value, `${it ? "Sbagliati" : "Wrong"} (${reco})`];
                return [value, name];
              }}
            />
            <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 11, paddingTop: 16 }} />
            <Bar
              dataKey="correct"
              stackId="dec"
              fill={COLOR_WIN}
              name={it ? "Raccomandazione corretta" : "Correct call"}
            />
            <Bar
              dataKey="wrong"
              stackId="dec"
              fill={COLOR_LOSS}
              name={it ? "Raccomandazione sbagliata" : "Wrong call"}
            />
          </BarChart>
        </ResponsiveContainer>
        <p className="text-[10px] text-ink-muted/85 mt-2 leading-snug">
          {it
            ? "Solo i bin in zona ENTRY (≥70) o EXIT (<35) producono raccomandazioni operative. La zona WAIT (35–69) non è un trade. Più verde = sistema affidabile in quel bin."
            : "Only ENTRY (≥70) or EXIT (<35) bins produce actionable calls. WAIT zone (35–69) is no trade. More green = reliable system in that bin."}
        </p>
      </ChartCard>

      {/* Confusion Matrix (compact) */}
      <ChartCard
        title={it ? "Matrice di confusione" : "Confusion matrix"}
        subtitle={
          it
            ? `Su ${totalResolved} segnali risolti (WIN/LOSS, esclusi FLAT e N/A)`
            : `On ${totalResolved} resolved signals (WIN/LOSS, excluding FLAT and N/A)`
        }
      >
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div></div>
          <div className="text-center font-semibold text-ink">
            {it ? "Prezzo ↑ (WIN)" : "Price ↑ (WIN)"}
          </div>
          <div className="text-center font-semibold text-ink">
            {it ? "Prezzo ↓ (LOSS)" : "Price ↓ (LOSS)"}
          </div>

          <div className="font-semibold text-ink py-2">
            RA BUY (≥{ENTRY_THRESHOLD})
          </div>
          <ConfusionCell value={metrics.tp} label="True Positive" tone="green" />
          <ConfusionCell value={metrics.fp} label="False Positive" tone="red" />

          <div className="font-semibold text-ink py-2">
            RA AVOID (&lt;{HOLD_THRESHOLD})
          </div>
          <ConfusionCell value={metrics.fn} label="False Negative" tone="orange" />
          <ConfusionCell value={metrics.tn} label="True Negative" tone="blue" />
        </div>
      </ChartCard>
    </div>
  );
}

function MetricCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "green" | "blue" | "purple" | "amber";
}) {
  const colors = {
    green: {
      bg: "from-green-50 to-emerald-50 dark:from-green-950/20 dark:to-emerald-950/20",
      border: "border-green-200/50 dark:border-green-800/50",
      labelText: "text-green-600/70 dark:text-green-400/70",
      valueText: "text-green-700 dark:text-green-400",
      subText: "text-green-600/60 dark:text-green-400/60",
    },
    blue: {
      bg: "from-blue-50 to-cyan-50 dark:from-blue-950/20 dark:to-cyan-950/20",
      border: "border-blue-200/50 dark:border-blue-800/50",
      labelText: "text-blue-600/70 dark:text-blue-400/70",
      valueText: "text-blue-700 dark:text-blue-400",
      subText: "text-blue-600/60 dark:text-blue-400/60",
    },
    purple: {
      bg: "from-purple-50 to-pink-50 dark:from-purple-950/20 dark:to-pink-950/20",
      border: "border-purple-200/50 dark:border-purple-800/50",
      labelText: "text-purple-600/70 dark:text-purple-400/70",
      valueText: "text-purple-700 dark:text-purple-400",
      subText: "text-purple-600/60 dark:text-purple-400/60",
    },
    amber: {
      bg: "from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20",
      border: "border-amber-200/50 dark:border-amber-800/50",
      labelText: "text-amber-600/70 dark:text-amber-400/70",
      valueText: "text-amber-700 dark:text-amber-400",
      subText: "text-amber-600/60 dark:text-amber-400/60",
    },
  }[tone];

  return (
    <div
      className={`p-3 bg-gradient-to-br ${colors.bg} border ${colors.border} rounded-lg`}
    >
      <div className={`text-[10px] ${colors.labelText} font-medium mb-1`}>
        {label}
      </div>
      <div className={`text-2xl font-bold ${colors.valueText}`}>{value}</div>
      <div className={`text-[9px] ${colors.subText} mt-0.5`}>{sub}</div>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="invest-trend-chart-panel rounded-xl border p-4">
      <h4 className="text-sm font-bold text-ink mb-1">{title}</h4>
      {subtitle ? (
        <p className="text-[11px] text-ink-muted leading-snug mb-3">
          {subtitle}
        </p>
      ) : null}
      {children}
    </div>
  );
}

function ConfusionCell({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: "green" | "red" | "orange" | "blue";
}) {
  const cls = {
    green:
      "bg-green-100 dark:bg-green-900/30 border-green-300 dark:border-green-700 text-green-700 dark:text-green-300",
    red: "bg-red-100 dark:bg-red-900/30 border-red-300 dark:border-red-700 text-red-700 dark:text-red-300",
    orange:
      "bg-orange-100 dark:bg-orange-900/30 border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-300",
    blue: "bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300",
  }[tone];

  return (
    <div className={`p-3 border rounded text-center ${cls}`}>
      <div className="text-lg font-bold">{value}</div>
      <div className="text-[9px] opacity-80">{label}</div>
    </div>
  );
}
