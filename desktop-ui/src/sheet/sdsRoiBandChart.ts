import type {
  SdsRoiBacktestScoresDoc,
  SdsRoiForecastEvent,
  SdsRoiHorizonKey,
} from "./sdsRoiForecast";
import { SDS_ZONE_STYLES, type SdsZoneId } from "./sdsZoneColors";

export type SdsRoiBandHorizonSummary = {
  n?: number;
  mae_pp?: number | null;
  mean_signed_err_pp?: number | null;
};

export type SdsRoiBandChartPoint = {
  zone: SdsZoneId;
  rangeLabel: string;
  zoneLabel: string;
  meanSignedErrPp: number;
  maePp: number | null;
  n: number;
  fill: string;
};

export type SdsRoiBandChartView = {
  horizon: SdsRoiHorizonKey;
  points: SdsRoiBandChartPoint[];
  hasData: boolean;
};

const ZONE_ORDER: SdsZoneId[] = ["distant", "watch", "candidate", "supernova"];

const ZONE_RANGE_LABEL: Record<SdsZoneId, string> = {
  distant: "0–30",
  watch: "30–55",
  candidate: "55–75",
  supernova: "75–100",
};

type Bucket = { n: number; sumSigned: number; sumAbs: number };

function emptyBuckets(): Record<SdsZoneId, Bucket> {
  return {
    distant: { n: 0, sumSigned: 0, sumAbs: 0 },
    watch: { n: 0, sumSigned: 0, sumAbs: 0 },
    candidate: { n: 0, sumSigned: 0, sumAbs: 0 },
    supernova: { n: 0, sumSigned: 0, sumAbs: 0 },
  };
}

function mergeSummaryIntoBuckets(
  buckets: Record<SdsZoneId, Bucket>,
  summary: SdsRoiBacktestScoresDoc["summary_by_sds_zone"],
  horizon: SdsRoiHorizonKey,
): void {
  if (!summary) return;
  for (const zone of ZONE_ORDER) {
    const row = summary[zone]?.[horizon];
    const n = row?.n ?? 0;
    if (n <= 0) continue;
    const mean = row?.mean_signed_err_pp ?? 0;
    const mae = row?.mae_pp ?? 0;
    buckets[zone].n += n;
    buckets[zone].sumSigned += mean * n;
    buckets[zone].sumAbs += mae * n;
  }
}

function mergeForwardEvents(
  buckets: Record<SdsZoneId, Bucket>,
  events: SdsRoiForecastEvent[],
  horizon: SdsRoiHorizonKey,
): void {
  for (const ev of events) {
    const err = ev.error_pp?.[horizon];
    const snap = ev.snapshots?.[ev.snapshots.length - 1];
    const sds = snap?.sds;
    if (err == null || !Number.isFinite(err) || sds == null || !Number.isFinite(sds)) continue;
    const zone =
      sds >= 75 ? "supernova" : sds >= 55 ? "candidate" : sds >= 30 ? "watch" : "distant";
    buckets[zone].n += 1;
    buckets[zone].sumSigned += err;
    buckets[zone].sumAbs += Math.abs(err);
  }
}

function mergeSampleRows(
  buckets: Record<SdsZoneId, Bucket>,
  rows: SdsRoiBacktestScoresDoc["sample_rows"],
  horizon: SdsRoiHorizonKey,
): void {
  for (const row of rows ?? []) {
    const err = row?.error_pp?.[horizon];
    const sds = row?.sds;
    if (err == null || !Number.isFinite(err) || sds == null || !Number.isFinite(sds)) continue;
    const zone =
      sds >= 75 ? "supernova" : sds >= 55 ? "candidate" : sds >= 30 ? "watch" : "distant";
    buckets[zone].n += 1;
    buckets[zone].sumSigned += err;
    buckets[zone].sumAbs += Math.abs(err);
  }
}

export function buildSdsRoiBandChartView(
  backtest: SdsRoiBacktestScoresDoc | null | undefined,
  forwardEvents: SdsRoiForecastEvent[],
  horizon: SdsRoiHorizonKey = "pre_5",
): SdsRoiBandChartView {
  const buckets = emptyBuckets();
  if (backtest?.summary_by_sds_zone) {
    mergeSummaryIntoBuckets(buckets, backtest.summary_by_sds_zone, horizon);
  } else {
    mergeSampleRows(buckets, backtest?.sample_rows, horizon);
  }
  mergeForwardEvents(buckets, forwardEvents, horizon);

  const points: SdsRoiBandChartPoint[] = ZONE_ORDER.map((zone) => {
    const b = buckets[zone];
    const meanSignedErrPp =
      b.n > 0 ? Math.round((b.sumSigned / b.n) * 100) / 100 : 0;
    const maePp = b.n > 0 ? Math.round((b.sumAbs / b.n) * 100) / 100 : null;
    return {
      zone,
      rangeLabel: ZONE_RANGE_LABEL[zone],
      zoneLabel: SDS_ZONE_STYLES[zone].label,
      meanSignedErrPp,
      maePp,
      n: b.n,
      fill: SDS_ZONE_STYLES[zone].bar,
    };
  });

  return {
    horizon,
    points,
    hasData: points.some((p) => p.n > 0),
  };
}
