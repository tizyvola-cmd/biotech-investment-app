import { useMemo, type CSSProperties } from "react";
import {
  RA_CALIB_MIN_SAMPLE_N,
  type RaThresholdHeatmap,
  type RaThresholdHeatmapCell,
} from "../sheet/rascoreCalibrationCompute";
import { useT } from "../shared/i18n";

function cellLookup(cells: RaThresholdHeatmapCell[]): Map<string, RaThresholdHeatmapCell> {
  const map = new Map<string, RaThresholdHeatmapCell>();
  for (const c of cells) map.set(`${c.offset}:${c.threshold}`, c);
  return map;
}

function cellStyle(rate: number | null, n: number): CSSProperties {
  if (n === 0 || rate == null) {
    return {
      background: "var(--sn-surface, #fafafa)",
      color: "var(--sn-text-3)",
    };
  }
  if (n < RA_CALIB_MIN_SAMPLE_N) {
    return {
      background: "rgba(148,163,184,0.22)",
      color: "var(--sn-text-2)",
    };
  }
  if (rate >= 55) {
    return {
      background: "var(--sn-long-bg)",
      color: "var(--sn-long-text)",
    };
  }
  if (rate >= 45) {
    return {
      background: "var(--sn-watch-bg)",
      color: "var(--sn-accent)",
    };
  }
  return {
    background: "var(--sn-short-bg)",
    color: "var(--sn-short-text)",
  };
}

export function RaThresholdHeatmap({
  heatmap,
  selectedOffset,
  onSelectOffset,
}: {
  heatmap: RaThresholdHeatmap;
  selectedOffset: number;
  onSelectOffset?: (offset: number) => void;
}) {
  const t = useT();
  const byKey = useMemo(() => cellLookup(heatmap.cells), [heatmap.cells]);

  const displayThresholds = useMemo(
    () => heatmap.thresholds.filter((th) => th >= 40),
    [heatmap.thresholds],
  );

  return (
    <div style={{ marginTop: 14 }}>
      <p style={{ fontSize: 11, fontWeight: 600, color: "var(--sn-text)", margin: "0 0 4px" }}>
        {t("modelLab.raCalibration.threshold.heatmap.title")}
      </p>
      <p style={{ fontSize: 10, color: "var(--sn-text-3)", margin: "0 0 10px", lineHeight: 1.45 }}>
        {t("modelLab.raCalibration.threshold.heatmap.desc", {
          minN: String(RA_CALIB_MIN_SAMPLE_N),
        })}
      </p>
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            minWidth: 420,
            borderCollapse: "collapse",
            fontSize: 10,
          }}
        >
          <thead>
            <tr>
              <th
                style={{
                  textAlign: "left",
                  padding: "6px 8px",
                  fontWeight: 600,
                  color: "var(--sn-text-2)",
                  borderBottom: "1px solid var(--sn-border)",
                }}
              >
                {t("modelLab.raCalibration.threshold.heatmap.colAnchor")}
              </th>
              {displayThresholds.map((th) => (
                <th
                  key={th}
                  style={{
                    textAlign: "center",
                    padding: "6px 4px",
                    fontWeight: 600,
                    color: "var(--sn-text-2)",
                    borderBottom: "1px solid var(--sn-border)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  ≥{th}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {heatmap.offsets.map((offset) => {
              const label =
                heatmap.cells.find((c) => c.offset === offset)?.offsetLabel ??
                String(offset);
              const selected = offset === selectedOffset;
              return (
                <tr key={offset}>
                  <td
                    style={{
                      padding: "6px 8px",
                      fontWeight: selected ? 700 : 600,
                      color: selected ? "var(--sn-primary)" : "var(--sn-text)",
                      borderBottom: "1px solid var(--sn-border-soft, var(--sn-border))",
                      whiteSpace: "nowrap",
                      cursor: onSelectOffset ? "pointer" : undefined,
                      background: selected ? "var(--sn-primary-pale)" : undefined,
                    }}
                    onClick={onSelectOffset ? () => onSelectOffset(offset) : undefined}
                    title={t("modelLab.raCalibration.threshold.heatmap.selectAnchor")}
                  >
                    {label}
                    {selected ? " ◂" : ""}
                  </td>
                  {displayThresholds.map((th) => {
                    const cell = byKey.get(`${offset}:${th}`);
                    const rate = cell?.successRate ?? null;
                    const n = cell?.sampleN ?? 0;
                    return (
                      <td
                        key={th}
                        style={{
                          padding: "6px 4px",
                          textAlign: "center",
                          borderBottom: "1px solid var(--sn-border-soft, var(--sn-border))",
                          fontVariantNumeric: "tabular-nums",
                          lineHeight: 1.35,
                          ...cellStyle(rate, n),
                          outline: selected ? "1px solid var(--sn-primary-pale)" : undefined,
                        }}
                        title={
                          n === 0
                            ? t("modelLab.raCalibration.threshold.heatmap.empty")
                            : n < RA_CALIB_MIN_SAMPLE_N
                              ? t("modelLab.raCalibration.threshold.heatmap.lowN", {
                                  minN: String(RA_CALIB_MIN_SAMPLE_N),
                                })
                              : undefined
                        }
                      >
                        {n === 0 || rate == null ? (
                          "—"
                        ) : (
                          <>
                            <span style={{ fontWeight: 700 }}>{rate}%</span>
                            <br />
                            <span style={{ fontSize: 9, opacity: 0.9 }}>n={n}</span>
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "8px 14px",
          marginTop: 8,
          fontSize: 9,
          color: "var(--sn-text-3)",
        }}
      >
        <span>{t("modelLab.raCalibration.threshold.heatmap.legendGreen")}</span>
        <span>{t("modelLab.raCalibration.threshold.heatmap.legendGray")}</span>
      </div>
    </div>
  );
}
