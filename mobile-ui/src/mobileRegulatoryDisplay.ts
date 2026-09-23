/** Regulatory score display helpers (subset of desktop regulatoryRiskIndex). */

export function formatRegulatoryScoreDisplay(score: number): string {
  return score > 0 ? `+${Math.round(score * 10) / 10}` : String(Math.round(score * 10) / 10);
}

export function regulatoryScoreSummaryLabel(score: number, lang: "it" | "en"): string {
  if (score < -20) {
    return lang === "it" ? "Profilo regolatorio favorevole" : "Favorable regulatory profile";
  }
  if (score < 0) {
    return lang === "it" ? "Leggermente favorevole" : "Slightly favorable";
  }
  if (score === 0) {
    return lang === "it" ? "Neutro — nessun segnale attivo" : "Neutral — no active signals";
  }
  if (score >= 50) {
    return lang === "it" ? "Rischio regolatorio elevato" : "High regulatory risk";
  }
  return lang === "it" ? "Rischio regolatorio moderato" : "Moderate regulatory risk";
}

export function regulatoryScoreColor(score: number): string {
  if (score <= -20) return "#059669";
  if (score < 0) return "#10b981";
  if (score === 0) return "rgb(var(--ink-muted))";
  if (score >= 50) return "#dc2626";
  if (score >= 25) return "#d97706";
  return "rgb(var(--ink))";
}
