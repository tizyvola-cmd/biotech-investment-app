import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Point = { offset: number; pct: number };

export function ModelCurveChart({ points, ticker }: { points: Point[]; ticker: string }) {
  if (points.length === 0) {
    return (
      <p className="text-sm text-ink-muted py-8 text-center">
        Nessun punto curva modello per {ticker}
      </p>
    );
  }

  const data = points.map((p) => ({
    label: p.offset > 0 ? `+${p.offset}g` : `${p.offset}g`,
    pct: p.pct,
  }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} unit="%" />
          <Tooltip
            formatter={(v: number) => [`${v.toFixed(2)}%`, "Modello"]}
            contentStyle={{ borderRadius: 8 }}
          />
          <Line
            type="monotone"
            dataKey="pct"
            stroke="rgb(var(--accent))"
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
