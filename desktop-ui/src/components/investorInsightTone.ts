/**
 * Investor Insight polarity — green = constructive, red = adverse, teal = mixed.
 * Shared by InvestorInsightBox UI.
 */

export function isStronglyNegativeInvestorInsight(text: string): boolean {
  const t = text.toLowerCase();
  if (
    /\b(stock[- ]?price|overall|net|valuation)\b[^.]{0,80}\b(bearish|negative|downside|adverse|headwind)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\b(bearish|negative|adverse|downside)\b[^.]{0,60}\b(stock|share|valuation|price|implication)/i.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\b(outcome of death|death-coded|deaths?\b|fatal pediatric|serious (?:unlabeled )?adverse|faers\b.{0,40}serious|negative safety)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  return (
    /\b(bearish|sell[- ]off|dilutive|dilution overhang|credit negative|going[- ]concern|bankruptcy|insolvency|crl\b|complete response letter|trial (?:fail|halt|discontinu)|fda rejection)\b/i.test(
      t,
    ) ||
    /\b(weighs?|weighing|pressure|drag)\b[^.]{0,40}\b(on )?(the )?(stock|shares?|valuation|equity)\b/i.test(
      t,
    ) ||
    /\b(raises?|adds?|creates?|increases?|heightens?)\b[^.]{0,40}\bsafety overhang\b/i.test(
      t,
    ) ||
    /\bsafety overhang\b[^.]{0,50}\b(weighs?|pressure|bearish|negative|adverse)\b/i.test(t)
  );
}

export function isConstructiveCleanReview(text: string): boolean {
  return /\b(no new (pediatric )?safety (signals?|concerns?)|clean (postmarketing|pediatric) review|mildly constructive|near-term noise to mildly constructive)\b/i.test(
    text,
  );
}

export function isNegativeInvestorInsight(text: string): boolean {
  const t = text.toLowerCase();
  if (
    isConstructiveCleanReview(t) &&
    !/\b(outcome of death|death-coded|deaths?\b|fatal pediatric)\b/i.test(t)
  ) {
    return false;
  }
  const softNeutral =
    /\b(mixed|neutral|balanced|noise|unclear|wait[- ]and[- ]see|pending|not a trading signal)\b/i.test(
      t,
    ) && !/\b(bearish|adverse|death-coded|outcome of death|fatal pediatric)\b/i.test(t);
  if (softNeutral && !isStronglyNegativeInvestorInsight(t)) return false;
  return isStronglyNegativeInvestorInsight(t);
}

export function isPositiveInvestorInsight(text: string): boolean {
  const t = text.toLowerCase();
  if (isNegativeInvestorInsight(t)) return false;
  return (
    /\b(bullish|constructive|supportive|favorable benefit[- ]risk|met (the )?primary|substantial evidence|mildly constructive|positive efficacy)\b/i.test(
      t,
    ) || isConstructiveCleanReview(t)
  );
}

export function resolveInvestorInsightPolarity(
  text: string,
  tone?: "positive" | "negative" | "mixed" | null,
): "negative" | "positive" | "neutral" {
  const body = String(text || "").trim();
  if (!body) return "neutral";

  let negative = false;
  if (tone === "negative") {
    negative = true;
  } else if (tone === "positive") {
    negative = false;
  } else if (tone === "mixed") {
    negative =
      isStronglyNegativeInvestorInsight(body) && !isConstructiveCleanReview(body);
  } else {
    negative = isNegativeInvestorInsight(body);
  }

  if (negative) return "negative";
  if (tone === "positive" || isPositiveInvestorInsight(body)) return "positive";
  return "neutral";
}
