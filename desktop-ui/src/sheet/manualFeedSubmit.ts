import { refreshGainStarLedger, resolveManualInvestigationContext } from "./gainStarLedger";
import { dismissManualNewsPrompt } from "./manualFeedDropPrompt";
import {
  addManualFeedEvents,
  classifyManualNewsBlob,
  MANUAL_FEED_BATCH_MAX_ROWS,
  parseManualFeedBatch,
  scoreManualLossInvestigationEis,
  type ParsedManualFeedInput,
} from "./manualFeedEvents";
import { researchPriceUnverified } from "./manualResearchEnrichment";

export type ManualFeedSubmitError = "parse" | "too_many";

export type ManualFeedSubmitOptions = {
  raw: string;
  defaultTicker?: string | null;
  priceMovePct?: number | null;
  investigationContext?: "loss" | "gain" | null;
  resolveInvestigationContext?: (
    ticker: string,
    parsed: ParsedManualFeedInput,
  ) => "loss" | "gain" | null;
};

export function parseManualFeedForSubmit(opts: ManualFeedSubmitOptions): ParsedManualFeedInput[] {
  const tk = opts.defaultTicker?.trim().toUpperCase() ?? "";
  const rows = parseManualFeedBatch(opts.raw);
  const rawUnverified = researchPriceUnverified(opts.raw);
  return rows.map((r) => {
    // Never glue today's Var.24h onto research that explicitly says VAR_24H not supplied /
    // DATA CONFLICT — that falsely amplifies negative_catalyst EIS (e.g. JSPR acquisition).
    const blockInject =
      rawUnverified ||
      r.parseWarnings.includes("price_unverified") ||
      r.priceDropPct == null && /var_?24h\s*[:=]\s*not\s*supplied/i.test(opts.raw);
    return {
      ...r,
      ticker: tk || r.ticker,
      priceDropPct: r.priceDropPct ?? (blockInject ? null : opts.priceMovePct ?? null),
    };
  });
}

export function previewManualFeedEis(parsed: ParsedManualFeedInput) {
  const blob = `${parsed.title}\n${parsed.body}`.trim();
  const { sentiment, investigationOutcome, attribution } = classifyManualNewsBlob(blob, {
    sentiment: parsed.sentiment,
    investigationOutcome: parsed.investigationOutcome,
    attribution: parsed.attribution,
    priceDropPct: parsed.priceDropPct ?? parsed.deltaP1d ?? null,
  });
  const priceRef = parsed.priceDropPct ?? parsed.deltaP1d ?? null;
  return scoreManualLossInvestigationEis({
    priceChangePct: priceRef,
    sentiment,
    investigationOutcome,
    attribution,
  });
}

export function submitManualFeedRaw(
  opts: ManualFeedSubmitOptions,
):
  | { ok: true; count: number; tickers: string[] }
  | { ok: false; error: ManualFeedSubmitError; lineCount?: number } {
  const parsedList = parseManualFeedForSubmit(opts);
  if (!parsedList.length) return { ok: false, error: "parse" };
  if (parsedList.length >= MANUAL_FEED_BATCH_MAX_ROWS) {
    const lineCount = opts.raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean).length;
    if (lineCount > MANUAL_FEED_BATCH_MAX_ROWS) {
      return { ok: false, error: "too_many", lineCount };
    }
  }

  addManualFeedEvents(
    parsedList.map((p) => {
      const draftFields = {
        ticker: p.ticker,
        eventDate: p.eventDate,
        source: p.source,
        title: p.title,
        body: p.body,
        sentiment: p.sentiment,
        deltaP1d: p.deltaP1d,
        deltaP3d: p.deltaP3d,
        link: p.link,
        priceDropPct: p.priceDropPct,
        investigationOutcome: p.investigationOutcome,
        attribution: p.attribution,
      };
      return {
        ...draftFields,
        investigationContext:
          opts.resolveInvestigationContext?.(p.ticker, p) ??
          opts.investigationContext ??
          resolveManualInvestigationContext({
            id: "",
            createdAt: "",
            ...draftFields,
          }),
      };
    }),
  );

  const tickers = [...new Set(parsedList.map((r) => r.ticker))];
  for (const tk of tickers) dismissManualNewsPrompt(tk);
  refreshGainStarLedger();
  return { ok: true, count: parsedList.length, tickers };
}
