/**
 * Gate diagnostics for Risk v2 promotion — RETIRED.
 *
 * The Index Validation «Risk & Benefit vs realised P&L» panel was removed from
 * the desktop UI (Model comparison + Capital & diversification). This script
 * depended on that pipeline (`buildClosedDealRiskBenefitPoints`).
 *
 * Run: npx tsx scripts/diag-risk-v2-gates.ts
 */
console.log(
  "Retired: Risk & Benefit closed-correlation UI removed. This diagnostic is no longer maintained.",
);
process.exit(0);
