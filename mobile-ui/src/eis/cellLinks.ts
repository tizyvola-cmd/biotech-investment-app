const NCT_VALUE_RE = /^NCT\d{8}$/i;

export function nctClinicalTrialsUrl(text: string): string | null {
  const s = text.trim().toUpperCase();
  return NCT_VALUE_RE.test(s) ? `https://clinicaltrials.gov/study/${s}` : null;
}
