/** Clinical phase from Simulation row (mirrors desktop simRowClinicalMeta). */

function colMatch(row: Record<string, unknown>, re: RegExp): string | null {
  for (const k of Object.keys(row)) {
    if (re.test(k.replace(/\n/g, " "))) return k;
  }
  return null;
}

export function clinicalPhaseFromSimRow(row: Record<string, unknown> | undefined): string {
  if (!row) return "";
  const col = colMatch(row, /fase|phase/i);
  if (!col) return "";
  const v = String(row[col] ?? "").trim();
  return v && v !== "—" ? v : "";
}

export function formatCdDateShort(cd: string): string {
  const parts = cd.trim().split("/");
  if (parts.length === 3) {
    const [d, m] = parts;
    return `${d.padStart(2, "0")}/${m.padStart(2, "0")}`;
  }
  return cd.trim() || "—";
}
