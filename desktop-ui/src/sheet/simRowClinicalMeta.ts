/** Fase / indicazione da riga Simulation (colonne Excel). */

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

export function clinicalIndicationFromSimRow(
  row: Record<string, unknown> | undefined,
  maxLen = 72,
): string {
  if (!row) return "";
  const col = colMatch(row, /indicaz|indication|terapeutic|conditions|condition/i);
  if (!col) return "";
  const v = String(row[col] ?? "").trim();
  if (!v || v === "—") return "";
  return v.length > maxLen ? `${v.slice(0, maxLen - 1)}…` : v;
}
