/**
 * Investor Insight callout — clinical / corporate / financial /
 * market-access lens + stock-price implication. Display only.
 * Green = positive / constructive; red = negative / adverse; teal = mixed/neutral.
 */
import { resolveInvestorInsightPolarity } from "./investorInsightTone";

export function InvestorInsightBox({
  text,
  it = false,
  className = "",
  /** Override from FDA stance / clinical polarity when available. */
  tone,
}: {
  text: string | null | undefined;
  it?: boolean;
  className?: string;
  tone?: "positive" | "negative" | "mixed" | null;
}) {
  const body = String(text || "").trim();
  if (!body) return null;

  const polarity = resolveInvestorInsightPolarity(body, tone);
  const negative = polarity === "negative";
  const positive = polarity === "positive";

  const shell = negative
    ? "border-red-500/55 bg-red-500/[0.14]"
    : positive
      ? "border-emerald-500/55 bg-emerald-500/[0.12]"
      : "border-teal-500/45 bg-teal-500/[0.10]";
  const title = negative
    ? "text-red-700 dark:text-red-300"
    : positive
      ? "text-emerald-800 dark:text-emerald-300"
      : "text-teal-700 dark:text-teal-200";
  const caption = negative
    ? "text-red-900/75 dark:text-red-100/70"
    : positive
      ? "text-emerald-900/75 dark:text-emerald-100/70"
      : "text-teal-900/80 dark:text-teal-100/70";

  return (
    <section
      className={`rounded-lg border ${shell} px-3 py-2.5 space-y-1 ${className}`}
    >
      <h4 className={`text-[10px] font-semibold uppercase tracking-wide ${title}`}>
        Investor Insight
      </h4>
      <p className={`text-[11px] ${caption} leading-snug`}>
        {it
          ? "Prima impatto sullo stato di avanzamento del prodotto · poi company e stock price"
          : "First: product advancement impact · then company & stock price"}
      </p>
      <p className="text-[12px] leading-relaxed text-ink whitespace-pre-wrap break-words">
        {body}
      </p>
    </section>
  );
}
