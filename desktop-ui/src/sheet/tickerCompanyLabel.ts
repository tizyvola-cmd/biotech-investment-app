/**
 * Company name under ticker in Catalyst / Discovery / Top KPI / Wind tables.
 * Display only — does not change Soft BUY/SELL.
 */

export function companyNameFromSimRow(
  row: Record<string, unknown> | null | undefined,
): string {
  if (!row) return "";
  return String(
    row["Società"] ??
      row.Societa ??
      row.Company ??
      row.company ??
      row.Name ??
      row.name ??
      row["Società (full name)"] ??
      "",
  ).trim();
}

export function truncateCompanyLabel(name: string, max = 42): string {
  const s = name.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(1, max - 1))}…`;
}
