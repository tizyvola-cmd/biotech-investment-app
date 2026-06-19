import { useT } from "../shared/i18n";

const ZONES = [
  {
    min: 0,
    max: 30,
    barColor: "#f5b5b5",
    cardBg: "#fce8e8",
    cardText: "#9b2335",
    labelKey: "decisionLab.sds.readout.zone.distant.label" as const,
    descKey: "decisionLab.sds.readout.zone.distant.desc" as const,
    markerKey: "decisionLab.sds.readout.marker.distant" as const,
    widthPct: 30,
  },
  {
    min: 30,
    max: 55,
    barColor: "#f5d89a",
    cardBg: "#fff4e0",
    cardText: "#9a6700",
    labelKey: "decisionLab.sds.readout.zone.watch.label" as const,
    descKey: "decisionLab.sds.readout.zone.watch.desc" as const,
    markerKey: "decisionLab.sds.readout.marker.watch" as const,
    widthPct: 25,
  },
  {
    min: 55,
    max: 75,
    barColor: "#b8e986",
    cardBg: "#eef8e0",
    cardText: "#3d6b1e",
    labelKey: "decisionLab.sds.readout.zone.candidate.label" as const,
    descKey: "decisionLab.sds.readout.zone.candidate.desc" as const,
    markerKey: "decisionLab.sds.readout.marker.candidate" as const,
    widthPct: 20,
  },
  {
    min: 75,
    max: 100,
    barColor: "#6db33f",
    cardBg: "#e8f5e0",
    cardText: "#2d5016",
    labelKey: "decisionLab.sds.readout.zone.supernova.label" as const,
    descKey: "decisionLab.sds.readout.zone.supernova.desc" as const,
    markerKey: "decisionLab.sds.readout.marker.supernova" as const,
    widthPct: 25,
  },
] as const;

export function SdsScoreReadoutPanel() {
  const t = useT();

  return (
    <section className="rounded-xl border border-[rgb(var(--border))]/40 bg-white dark:bg-[rgb(var(--surface))]/95 p-4 space-y-4 shadow-sm">
      <div>
        <h3 className="text-sm font-semibold text-ink">{t("decisionLab.sds.readout.title")}</h3>
        <p className="text-[11px] text-ink-muted mt-0.5">{t("decisionLab.sds.readout.subtitle")}</p>
      </div>

      <div className="space-y-2">
        <div className="flex h-3.5 w-full overflow-hidden rounded-full">
          {ZONES.map((z) => (
            <div key={z.min} style={{ width: `${z.widthPct}%`, backgroundColor: z.barColor }} />
          ))}
        </div>
        <div className="relative flex text-[10px] font-medium">
          {ZONES.map((z, i) => {
            const leftPct = ZONES.slice(0, i).reduce((s, x) => s + x.widthPct, 0);
            return (
              <span
                key={z.markerKey}
                className="absolute tabular-nums"
                style={{ left: `${leftPct}%`, color: z.cardText, transform: i === 0 ? "none" : "translateX(-4px)" }}
              >
                {t(z.markerKey)}
              </span>
            );
          })}
          <span className="ml-auto tabular-nums text-ink-muted">100</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {ZONES.map((z, i) => (
          <div
            key={z.labelKey}
            className="rounded-lg px-3 py-2.5"
            style={{
              backgroundColor: z.cardBg,
              color: z.cardText,
              border: i === ZONES.length - 1 ? `1.5px solid ${z.barColor}` : "1.5px solid transparent",
            }}
          >
            <p className="text-xs font-semibold">{t(z.labelKey)}</p>
            <p className="text-[11px] mt-0.5 leading-snug opacity-90">{t(z.descKey)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
