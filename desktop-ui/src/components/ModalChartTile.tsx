import type { ReactNode } from "react";

export function ModalChartTile({
  title,
  caption,
  height,
  children,
}: {
  title: string;
  caption?: string;
  height?: number;
  children: ReactNode;
}) {
  const chartH = height ?? 168;
  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-white/90 p-2 flex flex-col gap-0.5 min-h-0">
      <h3 className="text-[10px] font-bold uppercase tracking-wide text-ink-muted leading-tight">
        {title}
      </h3>
      {caption ? (
        <p className="text-[9px] text-ink-muted leading-snug line-clamp-3">{caption}</p>
      ) : null}
      <div
        className="w-full shrink-0 invest-trend-chart-panel rounded-md border border-[rgb(var(--border))]/25 overflow-hidden"
        style={{ height: chartH }}
      >
        {children}
      </div>
    </div>
  );
}
