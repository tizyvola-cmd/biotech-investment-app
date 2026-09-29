/**
 * Company debrief frame: who they are, market cap, what they develop, what they sell.
 * Used on Daily News / Drug development path (not the R&D pipeline table — that lives
 * on the Clinical / R&D deep-dive tab).
 */
import { useEffect, useMemo, useState } from "react";
import {
  fetchYfCache,
  lookupDeskPipelineOverview,
  type PipelineOverviewProduct,
} from "../api/supernova";
import { formatMarketCap } from "../finance/financialRow";
import { marketCapUsdFromSimRow } from "../sheet/issuerResilience";
import { resolveIndicationEpidemiology } from "../sheet/indicationEpidemiology";
import { resolveNewsProductHints } from "../sheet/newsBriefProductHints";
import {
  clinicalDrugFromSimRow,
  clinicalIndicationFromSimRow,
  clinicalPhaseFromSimRow,
  usableProductName,
} from "../sheet/simRowClinicalMeta";

/** Rough large-cap / major-manufacturer gate for the "multiple drugs" develops line. */
const BIG_PHARMA_MCAP_USD = 80_000_000_000;

const BIG_PHARMA_TICKERS = new Set([
  "JNJ",
  "PFE",
  "MRK",
  "ABBV",
  "LLY",
  "AZN",
  "NVS",
  "NVO",
  "RHHBY",
  "SNY",
  "GSK",
  "BMY",
  "AMGN",
  "GILD",
  "BIIB",
  "REGN",
  "VRTX",
  "TMO",
  "DHR",
]);

function simRowForTicker(
  rows: Array<Record<string, unknown>> | null | undefined,
  ticker: string,
): Record<string, unknown> | null {
  const tk = ticker.trim().toUpperCase();
  if (!tk || !rows?.length) return null;
  return (
    rows.find((r) => String(r.Ticker ?? r.ticker ?? "").trim().toUpperCase() === tk) ??
    null
  );
}

function companyFromSim(row: Record<string, unknown> | null): string {
  if (!row) return "";
  return String(
    row["Società (full name)"] ?? row["Società"] ?? row.company ?? row.Company ?? "",
  ).trim();
}

function isBigPharmaIssuer(opts: {
  ticker: string;
  industry?: string | null;
  sector?: string | null;
  marketCapUsd?: number | null;
}): boolean {
  if (BIG_PHARMA_TICKERS.has(opts.ticker)) return true;
  const mcap = opts.marketCapUsd;
  if (typeof mcap === "number" && Number.isFinite(mcap) && mcap >= BIG_PHARMA_MCAP_USD) {
    return true;
  }
  const ind = `${opts.industry || ""} ${opts.sector || ""}`.toLowerCase();
  if (/\bdrug manufacturers?\s*-\s*(general|major)\b/i.test(ind)) return true;
  return (
    /\bdrug manufacturers?\s*-\s*specialty\b/i.test(ind) &&
    typeof mcap === "number" &&
    mcap >= 40_000_000_000
  );
}

function productIsApproved(row: PipelineOverviewProduct): boolean {
  const life = String(row.lifecycle ?? "").trim().toLowerCase();
  if (life === "approved" || life === "marketed" || life === "commercial") return true;
  if (life === "development" || life === "clinical" || life === "pipeline") return false;
  const phase = String(row.phase ?? "").toLowerCase();
  return /\bapprov|\blaunched|\bon[- ]market|\bcommercial/i.test(phase);
}

function formatProductLine(row: PipelineOverviewProduct): string {
  const name = String(row.name || "").trim();
  if (!name) return "";
  const ind = String(row.indication || "").trim();
  return ind ? `${name} — ${ind}` : name;
}

export type FdaProductInset = {
  name?: string | null;
  moa?: string | null;
  target?: string | null;
  indications?: string | null;
  stage?: string | null;
  usa_prevalence?: string | null;
};

export function NewsCompanyProductDebrief({
  ticker,
  title,
  companyHint,
  productHint,
  indicationHint,
  phaseHint,
  companySummary,
  productInset,
  simRows,
  companyMode = false,
  it,
}: {
  ticker?: string | null;
  /** Article headline — used to reject pipeline drugs that don't match the news. */
  title?: string | null;
  companyHint?: string | null;
  productHint?: string | null;
  indicationHint?: string | null;
  phaseHint?: string | null;
  /** FDA / long-form who-they-are blurb. */
  companySummary?: string | null;
  /** FDA product inset: MoA, target, indications, stage. */
  productInset?: FdaProductInset | null;
  simRows?: Array<Record<string, unknown>> | null;
  /**
   * Company-wide view (Drug development path «company» chip): prefer full
   * develops/sells lists over a single focal product.
   */
  companyMode?: boolean;
  it: boolean;
}) {
  const tk = String(ticker || "").trim().toUpperCase();
  const simRow = useMemo(() => simRowForTicker(simRows, tk), [simRows, tk]);
  const [yf, setYf] = useState<{
    companyName?: string | null;
    sector?: string | null;
    industry?: string | null;
    marketCap?: number | null;
  } | null>(null);
  const [pipelineRows, setPipelineRows] = useState<PipelineOverviewProduct[]>([]);

  useEffect(() => {
    if (!tk) {
      setYf(null);
      return;
    }
    let cancelled = false;
    void fetchYfCache(tk).then((row) => {
      if (!cancelled) setYf(row);
    });
    return () => {
      cancelled = true;
    };
  }, [tk]);

  const company =
    companyHint?.trim() ||
    companyFromSim(simRow) ||
    String(yf?.companyName || "").trim() ||
    tk ||
    "—";

  // Quiet pipeline lookup for Develops / Sells lines (same cache as R&D tab).
  useEffect(() => {
    if (!tk) {
      setPipelineRows([]);
      return;
    }
    let cancelled = false;
    void lookupDeskPipelineOverview({
      ticker: tk,
      company: company !== "—" ? company : undefined,
      products: productHint ? [productHint] : undefined,
      conditions: indicationHint || undefined,
    })
      .then((res) => {
        if (cancelled) return;
        const next = Array.isArray(res.products)
          ? res.products.filter((p) => String(p.name || "").trim())
          : [];
        setPipelineRows(next);
      })
      .catch(() => {
        if (!cancelled) setPipelineRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [tk, company, productHint, indicationHint]);

  const simProduct = clinicalDrugFromSimRow(simRow ?? undefined);
  const simIndication = clinicalIndicationFromSimRow(simRow ?? undefined, 120);
  const simPhase = clinicalPhaseFromSimRow(simRow ?? undefined) || "";

  const hints = useMemo(
    () =>
      resolveNewsProductHints({
        title,
        briefProduct: productHint || productInset?.name || null,
        briefIndication: indicationHint || productInset?.indications || null,
        simProduct,
        simIndication,
      }),
    [
      title,
      productHint,
      indicationHint,
      productInset?.name,
      productInset?.indications,
      simProduct,
      simIndication,
    ],
  );

  const productRaw = usableProductName(hints.product) || "";
  // Never treat the ticker itself as a drug name (e.g. SMMT → "SMMT").
  const product =
    productRaw && productRaw.toUpperCase() !== tk ? productRaw : "";
  const indication = hints.indication || productInset?.indications?.trim() || "";
  const usedSimProduct = Boolean(product && simProduct && product === simProduct);
  const phase =
    phaseHint?.trim() ||
    productInset?.stage?.trim() ||
    (usedSimProduct ? simPhase : "") ||
    "";

  const mcapUsd =
    marketCapUsdFromSimRow(simRow) ??
    (typeof yf?.marketCap === "number" && Number.isFinite(yf.marketCap)
      ? yf.marketCap
      : null);
  const mcapLabel = mcapUsd != null ? `$${formatMarketCap(mcapUsd)}` : "—";

  const bigPharma = isBigPharmaIssuer({
    ticker: tk,
    industry: yf?.industry,
    sector: yf?.sector,
    marketCapUsd: mcapUsd,
  });

  const approvedLines = pipelineRows
    .filter(productIsApproved)
    .map(formatProductLine)
    .filter(Boolean);
  const developmentLines = pipelineRows
    .filter((r) => !productIsApproved(r))
    .map(formatProductLine)
    .filter(Boolean);

  let develops = "";
  if (bigPharma && companyMode) {
    develops = it
      ? "Marketing e sviluppo di più farmaci"
      : "Marketing and developing multiple drugs";
  } else if (companyMode && developmentLines.length) {
    develops = developmentLines.slice(0, 8).join("; ");
  } else if (product && indication) {
    develops = `${product} — ${indication}`;
  } else if (product) {
    develops = product;
  } else if (developmentLines.length) {
    develops = developmentLines.slice(0, 6).join("; ");
  } else if (indication) {
    develops = indication;
  } else if (yf?.industry || yf?.sector) {
    develops = [yf.industry, yf.sector].filter(Boolean).join(" · ");
  } else if (tk) {
    develops = it ? "Asset in sviluppo clinico" : "Clinical-stage assets";
  }

  let sells = "";
  if (bigPharma && companyMode) {
    sells = it
      ? "Portafoglio commerciale multi-prodotto"
      : "Multi-product commercial portfolio";
  } else if (approvedLines.length) {
    sells = approvedLines.slice(0, 8).join("; ");
  } else {
    sells = it
      ? "Nessun prodotto commerciale (clinical-stage)"
      : "No commercial products (clinical-stage)";
  }

  const moa = productInset?.moa?.trim() || "";
  const target = productInset?.target?.trim() || "";
  const blurb =
    companySummary?.trim() ||
    (bigPharma
      ? it
        ? `${company} è una grande pharma che commercializza e sviluppa più farmaci in diverse aree terapeutiche.`
        : `${company} is a large pharmaceutical company marketing and developing multiple drugs across therapeutic areas.`
      : [yf?.industry, yf?.sector].filter(Boolean).length
        ? it
          ? `${company} — ${[yf?.industry, yf?.sector].filter(Boolean).join(" · ")}.`
          : `${company} — ${[yf?.industry, yf?.sector].filter(Boolean).join(" · ")}.`
        : "");

  const epi = useMemo(
    () =>
      indication
        ? resolveIndicationEpidemiology(indication, {
            briefingPrevalence: productInset?.usa_prevalence || null,
            briefingIndication: indication,
          })
        : null,
    [indication, productInset?.usa_prevalence],
  );
  const usaPrevalence =
    productInset?.usa_prevalence?.trim() || epi?.usaPrevalence || "";

  if (
    !tk &&
    !companyHint &&
    !product &&
    !indication &&
    !blurb &&
    !moa &&
    mcapUsd == null
  ) {
    return null;
  }

  return (
    <section
      className="rounded-lg border border-[rgb(var(--border))]/45 bg-[rgb(var(--surface-2))]/40 px-2.5 py-2 space-y-1.5"
      aria-label={it ? "Company Debrief" : "Company Debrief"}
    >
      <h4 className="text-[10px] font-bold uppercase tracking-wide text-ink">
        Company Debrief
      </h4>
      <p className="text-[12px] font-semibold text-ink leading-snug">{company}</p>
      {blurb ? (
        <p className="text-[11px] text-ink leading-relaxed whitespace-pre-wrap break-words">
          {blurb}
        </p>
      ) : null}
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px] leading-snug">
        <dt className="text-ink-muted font-semibold whitespace-nowrap">
          {it ? "Sviluppa" : "Develops"}
        </dt>
        <dd className="text-ink min-w-0 break-words">{develops || "—"}</dd>
        <dt className="text-ink-muted font-semibold whitespace-nowrap">
          {it ? "Vende" : "Sells"}
        </dt>
        <dd className="text-ink min-w-0 break-words">{sells || "—"}</dd>
        {!companyMode && !bigPharma && product && develops !== product ? (
          <>
            <dt className="text-ink-muted font-semibold whitespace-nowrap">
              {it ? "Prodotto (focus)" : "Product (focus)"}
            </dt>
            <dd className="text-ink min-w-0 break-words">{product}</dd>
          </>
        ) : null}
        {!companyMode && indication && !develops.includes(indication) ? (
          <>
            <dt className="text-ink-muted font-semibold whitespace-nowrap">
              {it ? "Indicazione" : "Indication"}
            </dt>
            <dd className="text-ink min-w-0 break-words">{indication}</dd>
          </>
        ) : null}
        {usaPrevalence ? (
          <>
            <dt className="text-ink-muted font-semibold whitespace-nowrap">
              {it ? "Prevalenza USA" : "US prevalence"}
            </dt>
            <dd className="text-ink min-w-0 break-words">{usaPrevalence}</dd>
          </>
        ) : null}
        {moa ? (
          <>
            <dt className="text-ink-muted font-semibold whitespace-nowrap">MoA</dt>
            <dd className="text-ink min-w-0 break-words">{moa}</dd>
          </>
        ) : null}
        {target ? (
          <>
            <dt className="text-ink-muted font-semibold whitespace-nowrap">Target</dt>
            <dd className="text-ink min-w-0 break-words">{target}</dd>
          </>
        ) : null}
        {!companyMode && phase ? (
          <>
            <dt className="text-ink-muted font-semibold whitespace-nowrap">
              {it ? "Stadio" : "Stage"}
            </dt>
            <dd className="text-ink">{phase}</dd>
          </>
        ) : null}
        <dt className="text-ink-muted font-semibold whitespace-nowrap">Market cap</dt>
        <dd className="text-ink tabular-nums font-semibold">{mcapLabel}</dd>
      </dl>
    </section>
  );
}
