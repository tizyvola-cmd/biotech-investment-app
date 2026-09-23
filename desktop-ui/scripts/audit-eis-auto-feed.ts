/**
 * Audit automatic clinical pre-CD feed EIS — replay stored scores vs current logic,
 * flag drift, trust issues, and semantic mismatches (KZIA-style keyword traps).
 *
 *   cd desktop-ui
 *   npx tsx scripts/audit-eis-auto-feed.ts
 *   npx tsx scripts/audit-eis-auto-feed.ts --min-score 1.5 --lookback 365
 *   npx tsx scripts/audit-eis-auto-feed.ts --snapshot ../data/clinical_pre_cd_enrichment_snapshot.json
 *
 * Outputs:
 *   data/eis_auto_feed_audit.json
 *   data/eis_auto_feed_audit.csv
 *   EIS_AUTO_FEED_AUDIT_REPORT.md (repo root)
 */
import fs from "node:fs";
import path from "node:path";
import type { ClinicalPreCdRecord, ClinicalPublicationEvent } from "../src/api/supernova";
import { kpiIntrinsicScore, resolveEventEis } from "../src/sheet/eventImpactScore";
import {
  autoFeedEventText,
  detectAutoFeedSemanticFlags,
  type AutoFeedSemanticFlag,
} from "../src/sheet/autoFeedSemanticAudit";
import {
  eventHasUsableReferenceText,
  isClinicalPreCdRecordTrusted,
  isFeedEventTrusted,
  verifyEventReference,
} from "../src/sheet/referenceVerification";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DATA = path.join(ROOT, "data");

type AuditFlag =
  | "score_drift"
  | "eis_without_price"
  | "strong_sentiment_only"
  | "unverified_high_eis"
  | "untrusted_sponsor_scored"
  | "feed_untrusted"
  | "empty_reference"
  | AutoFeedSemanticFlag;

type AuditRow = {
  ticker: string;
  company: string;
  eventDate: string;
  sourceType: string;
  title: string;
  storedEis: number | null;
  recomputedEis: number | null;
  eisDelta: number | null;
  deltaP1d: number | null;
  deltaP3d: number | null;
  sentiment: number | null;
  kpiScore: number | null;
  referenceVerified: boolean;
  feedTrusted: boolean;
  sponsorMatch: string;
  flags: AuditFlag[];
  severity: number;
  suggestedAction: string;
};

function parseArgs(argv: string[]) {
  const out: {
    snapshot: string;
    minScore: number;
    driftThreshold: number;
    lookbackDays: number | null;
    maxRows: number;
  } = {
    snapshot: path.join(DATA, "clinical_pre_cd_enrichment_snapshot.json"),
    minScore: 1,
    driftThreshold: 0.2,
    lookbackDays: null,
    maxRows: 500,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--snapshot" && argv[i + 1]) out.snapshot = path.resolve(argv[++i]!);
    else if (a === "--min-score" && argv[i + 1]) out.minScore = Number(argv[++i]);
    else if (a === "--drift" && argv[i + 1]) out.driftThreshold = Number(argv[++i]);
    else if (a === "--lookback" && argv[i + 1]) out.lookbackDays = Number(argv[++i]);
    else if (a === "--max-rows" && argv[i + 1]) out.maxRows = Number(argv[++i]);
  }
  return out;
}

function isAutoEvent(ev: ClinicalPublicationEvent): boolean {
  const st = String(ev.source_type ?? "").trim().toLowerCase();
  return st !== "manual" && st !== "";
}

function eventIndicators(ev: ClinicalPublicationEvent, rec: ClinicalPreCdRecord) {
  const local = ev.indicators ?? [];
  if (local.length) return local;
  return rec.clinical_indicators ?? [];
}

function recomputeKpiScore(ev: ClinicalPublicationEvent, rec: ClinicalPreCdRecord): number | null {
  const ind = eventIndicators(ev, rec);
  if (!ind.length) return ev.eis?.kpi_score ?? null;
  const k = kpiIntrinsicScore(ind);
  return Number.isFinite(k) ? k : null;
}

function suggestedAction(flags: AuditFlag[], row: AuditRow): string {
  if (flags.includes("score_drift")) return "re-enrich or trust recomputed EIS on next refresh";
  if (flags.includes("feed_untrusted") || flags.includes("untrusted_sponsor_scored"))
    return "exclude from ticker EIS aggregate until sponsor/reference fixed";
  if (flags.includes("financing_mild_strong_negative")) return "soften financing classifier; re-score";
  if (
    flags.some((f) =>
      [
        "text_positive_eis_negative",
        "text_negative_eis_positive",
        "kpi_positive_eis_negative",
        "kpi_negative_eis_positive",
      ].includes(f),
    )
  )
    return "manual review — fix sentiment/KPI or enrichment rule";
  if (flags.includes("eis_without_price") || flags.includes("strong_sentiment_only"))
    return "verify price series; cap publication-only EIS if unverified";
  if (flags.includes("unverified_high_eis")) return "tighten reference_verified gate";
  if (flags.includes("price_up_eis_negative") || flags.includes("price_down_eis_positive"))
    return "check price dates / recompute EIS from fresh yfinance";
  return "review";
}

function severityScore(flags: AuditFlag[], row: AuditRow): number {
  let s = 0;
  if (flags.includes("feed_untrusted")) s += 4;
  if (flags.includes("text_positive_eis_negative") || flags.includes("text_negative_eis_positive"))
    s += 4;
  if (flags.includes("kpi_positive_eis_negative") || flags.includes("kpi_negative_eis_positive"))
    s += 3;
  if (flags.includes("financing_mild_strong_negative")) s += 3;
  if (flags.includes("unverified_high_eis")) s += 3;
  if (flags.includes("price_up_eis_negative") || flags.includes("price_down_eis_positive"))
    s += 3;
  if (flags.includes("score_drift")) s += 2;
  if (flags.includes("eis_without_price")) s += 2;
  if (flags.includes("strong_sentiment_only")) s += 2;
  if (flags.includes("untrusted_sponsor_scored")) s += 2;
  if (flags.includes("empty_reference")) s += 1;
  const mag = Math.max(Math.abs(row.storedEis ?? 0), Math.abs(row.recomputedEis ?? 0));
  if (mag >= 3) s += 1;
  return s;
}

function auditEvent(rec: ClinicalPreCdRecord, ev: ClinicalPublicationEvent): AuditRow | null {
  if (!isAutoEvent(ev)) return null;

  const eventDate = String(ev.event_date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return null;

  const storedEis = ev.eis?.score ?? null;
  const resolved = resolveEventEis(ev, eventIndicators(ev, rec));
  const recomputedEis = resolved?.score ?? null;
  const deltaP1d = ev.price?.delta_p_1d ?? ev.eis?.delta_p_1d ?? null;
  const deltaP3d = ev.price?.delta_p_3d ?? ev.eis?.delta_p_3d ?? null;
  const sentiment = ev.sentiment ?? ev.eis?.sentiment ?? null;
  const kpiScore = recomputeKpiScore(ev, rec);
  const text = autoFeedEventText(ev.event_title, ev.summary, ev.impact_note);

  const flags: AuditFlag[] = [];
  const eisForChecks = recomputedEis ?? storedEis;

  if (
    storedEis != null &&
    recomputedEis != null &&
    Math.abs(storedEis - recomputedEis) >= 0.01
  ) {
    const drift = Math.abs(storedEis - recomputedEis);
    if (drift >= 0.2) flags.push("score_drift");
  }

  const noPrice =
    (deltaP1d == null || !Number.isFinite(deltaP1d)) &&
    (deltaP3d == null || !Number.isFinite(deltaP3d));
  if (noPrice && eisForChecks != null && Math.abs(eisForChecks) >= 1.5) {
    flags.push("eis_without_price");
  }
  if (
    noPrice &&
    eisForChecks != null &&
    Math.abs(eisForChecks) >= 2 &&
    (kpiScore == null || Math.abs(kpiScore) < 0.3) &&
    (sentiment == null || Math.abs(sentiment) < 0.35)
  ) {
    flags.push("strong_sentiment_only");
  }

  const refCheck = verifyEventReference(ev, rec, { strict: true });
  const feedTrusted = isFeedEventTrusted(ev, rec);
  if (!feedTrusted && eisForChecks != null && Math.abs(eisForChecks) >= 1) {
    flags.push("feed_untrusted");
  }
  if (!refCheck.verified && eisForChecks != null && Math.abs(eisForChecks) >= 2) {
    flags.push("unverified_high_eis");
  }
  if (!isClinicalPreCdRecordTrusted(rec) && eisForChecks != null && Math.abs(eisForChecks) >= 1.5) {
    flags.push("untrusted_sponsor_scored");
  }
  if (!eventHasUsableReferenceText(ev) && eisForChecks != null && Math.abs(eisForChecks) >= 1) {
    flags.push("empty_reference");
  }

  flags.push(
    ...detectAutoFeedSemanticFlags({
      text,
      eisScore: eisForChecks,
      kpiScore,
      deltaP1d,
    }),
  );

  const row: AuditRow = {
    ticker: String(rec.ticker ?? "").toUpperCase(),
    company: String(rec.company ?? ""),
    eventDate,
    sourceType: String(ev.source_type ?? ""),
    title: String(ev.event_title ?? "").slice(0, 120),
    storedEis,
    recomputedEis,
    eisDelta:
      storedEis != null && recomputedEis != null
        ? Math.round((recomputedEis - storedEis) * 100) / 100
        : null,
    deltaP1d,
    deltaP3d,
    sentiment,
    kpiScore,
    referenceVerified: refCheck.verified,
    feedTrusted,
    sponsorMatch: String(rec.sponsor_match ?? ""),
    flags: [...new Set(flags)],
    severity: 0,
    suggestedAction: "",
  };
  row.severity = severityScore(row.flags, row);
  row.suggestedAction = suggestedAction(row.flags, row);
  return row;
}

function csvEscape(v: string | number | boolean | null): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(rows: AuditRow[], outPath: string) {
  const header = [
    "ticker",
    "eventDate",
    "sourceType",
    "storedEis",
    "recomputedEis",
    "eisDelta",
    "deltaP1d",
    "kpiScore",
    "feedTrusted",
    "severity",
    "flags",
    "suggestedAction",
    "title",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.ticker,
        r.eventDate,
        r.sourceType,
        r.storedEis,
        r.recomputedEis,
        r.eisDelta,
        r.deltaP1d,
        r.kpiScore,
        r.feedTrusted,
        r.severity,
        r.flags.join("|"),
        r.suggestedAction,
        r.title,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
}

function writeMarkdownReport(args: {
  rows: AuditRow[];
  summary: Record<string, unknown>;
  outPath: string;
  opts: ReturnType<typeof parseArgs>;
}) {
  const { rows, summary, outPath, opts } = args;
  const top = rows.slice(0, 40);
  const flagCounts = summary.flagCounts as Record<string, number>;

  const lines: string[] = [
    "# EIS Auto Feed Audit Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `- Snapshot: \`${opts.snapshot}\``,
    `- Auto events scanned: **${summary.autoEvents}**`,
    `- Flagged rows (|EIS|≥${opts.minScore} or any anomaly): **${summary.flagged}**`,
    `- Score drift (≥${opts.driftThreshold}): **${summary.driftCount}**`,
    `- Feed-untrusted with |EIS|≥1: **${summary.untrustedFeed}**`,
    `- Semantic mismatch: **${summary.semanticMismatch}**`,
    "",
    "### Flag counts",
    "",
    "| Flag | Count |",
    "|------|-------|",
  ];
  for (const [k, v] of Object.entries(flagCounts).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${k} | ${v} |`);
  }
  lines.push("", "## Top anomalies (by severity)", "");
  for (const r of top) {
    lines.push(
      `### ${r.ticker} — ${r.eventDate} (severity ${r.severity})`,
      "",
      `- **Title:** ${r.title}`,
      `- **Stored / recomputed EIS:** ${r.storedEis ?? "—"} / ${r.recomputedEis ?? "—"} (Δ ${r.eisDelta ?? "—"})`,
      `- **ΔP1d:** ${r.deltaP1d ?? "—"} | KPI: ${r.kpiScore ?? "—"} | Feed trusted: ${r.feedTrusted}`,
      `- **Flags:** ${r.flags.join(", ")}`,
      `- **Action:** ${r.suggestedAction}`,
      "",
    );
  }
  lines.push(
    "## Next steps",
    "",
    "1. Fix enrichment rules for recurring semantic flags (see `autoFeedSemanticAudit.ts`).",
    "2. Re-run clinical refresh for tickers with `score_drift` after formula changes.",
    "3. Exclude `feed_untrusted` events from ticker EIS aggregate until reference fixed.",
    "4. Re-run: `cd desktop-ui && npx tsx scripts/audit-eis-auto-feed.ts`",
    "",
  );
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(opts.snapshot)) {
    console.error(`Snapshot not found: ${opts.snapshot}`);
    process.exit(1);
  }

  const snap = JSON.parse(fs.readFileSync(opts.snapshot, "utf8")) as {
    records?: ClinicalPreCdRecord[];
  };
  const records = snap.records ?? [];
  const cutoffMs =
    opts.lookbackDays != null
      ? Date.now() - opts.lookbackDays * 86_400_000
      : null;

  let autoEvents = 0;
  const allRows: AuditRow[] = [];

  for (const rec of records) {
    for (const ev of rec.clinical_events ?? rec.timeline_events ?? []) {
      if (!isAutoEvent(ev)) continue;
      autoEvents += 1;
      const ds = String(ev.event_date ?? "");
      if (cutoffMs != null && /^\d{4}-\d{2}-\d{2}$/.test(ds)) {
        const ms = Date.parse(`${ds}T12:00:00`);
        if (Number.isFinite(ms) && ms < cutoffMs) continue;
      }
      const row = auditEvent(rec, ev);
      if (!row) continue;
      const eisMag = Math.max(
        Math.abs(row.storedEis ?? 0),
        Math.abs(row.recomputedEis ?? 0),
      );
      if (row.flags.length > 0 || eisMag >= opts.minScore) {
        allRows.push(row);
      }
    }
  }

  allRows.sort((a, b) => b.severity - a.severity || b.eventDate.localeCompare(a.eventDate));

  const flagCounts: Record<string, number> = {};
  for (const r of allRows) {
    for (const f of r.flags) flagCounts[f] = (flagCounts[f] ?? 0) + 1;
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    snapshot: opts.snapshot,
    records: records.length,
    autoEvents,
    flagged: allRows.length,
    driftCount: allRows.filter((r) => r.flags.includes("score_drift")).length,
    untrustedFeed: allRows.filter((r) => r.flags.includes("feed_untrusted")).length,
    semanticMismatch: allRows.filter((r) =>
      r.flags.some((f) =>
        String(f).startsWith("text_") ||
        String(f).startsWith("kpi_") ||
        f === "financing_mild_strong_negative",
      ),
    ).length,
    flagCounts,
    topTickers: [...new Set(allRows.slice(0, 50).map((r) => r.ticker))],
  };

  const jsonOut = path.join(DATA, "eis_auto_feed_audit.json");
  const csvOut = path.join(DATA, "eis_auto_feed_audit.csv");
  const mdOut = path.join(ROOT, "EIS_AUTO_FEED_AUDIT_REPORT.md");

  fs.writeFileSync(
    jsonOut,
    JSON.stringify({ summary, rows: allRows.slice(0, opts.maxRows) }, null, 2),
    "utf8",
  );
  writeCsv(allRows.slice(0, opts.maxRows), csvOut);
  writeMarkdownReport({ rows: allRows, summary, outPath: mdOut, opts });

  console.log("EIS auto feed audit complete");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nWrote:\n  ${jsonOut}\n  ${csvOut}\n  ${mdOut}`);
}

main();
