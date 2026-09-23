// Refined scan: detects hardcoded Italian in desktop-ui components that is
// NOT already wrapped in a language-switch pattern (`it ? "…" : "…"`,
// `lang === "it" ? …`, `useT()`, `t("…")`, or `en ?? it` style helpers).
//
// Approach:
//  1) Find every string literal that contains a strong Italian marker.
//  2) Get a small context window (±160 chars) around the match.
//  3) If context includes any of the "safe" i18n patterns applying to that
//     same literal, skip it (false positive).
//  4) Otherwise, record the finding — this is a real "Italian-only" string
//     that will still appear in the English UI.

import fs from "node:fs";
import path from "node:path";

const ROOT = "desktop-ui/src";

const italianMarkers = [
  /\b(nessun[ao]?|nessune|non\s+ci\s+sono)\b/i,
  /\b(clicca|premi|carica|caricamento|salva|annulla|chiudi|apri|rimuovi|elimina|aggiungi|modifica|riprova|invia|conferma|ricarica|aggiorna|aggiornato|aggiornata)\b/i,
  /\b(impostazioni|pannello|barra\s+laterale|scheda|grafico|grafici|finestra|riepilogo|riepiloghi|leggenda|legende)\b/i,
  /\b(seleziona|selezionato|selezionata|selezionati|selezionate|selezione)\b/i,
  /\b(giorno|giorni|giornaliero|giornaliera|settiman[a-z]+|mensile|mensili|annuale|anni|minut[oi]|second[oi])\b/i,
  /\b(mostra|nascondi|nascosto|nascosta)\b/i,
  /\b(portafoglio|posizione|posizioni|titolo|titoli|prezzo|prezzi|azione|azioni|dati|indicatore|indicatori)\b/i,
  /\b(perché|perchè|così|già|però|dopo|prima|allora|infatti|quindi|adesso|comunque|almeno|inoltre|invece|mentre|senza|verso|circa)\b/i,
  /\b(soltanto|oppure|nella|nello|negli|nelle|dalla|dagli|dalle|dall'|nell'|dell'|sull'|all')\b/i,
  /\b(disponibile|disponibili|attiv[oaie]|abilitat[oaie]|disabilitat[oaie]|mancante|mancanti|presente|presenti|assente|assenti)\b/i,
  /\b(nuov[oaie]|vecchi[oaie]|alt[oaie]|bass[oaie]|grand[eio]|piccol[oaie]|migliore|peggiore|maggior[eio]|minor[eio]|primo|prima|ultimo|ultima)\b/i,
  /\b(tutto|tutti|tutte|tutta|molt[oaie]|pochi|poche|troppo|troppa|troppi|troppe)\b/i,
  /\b(rendimento|calcolat[oaie]|conferma|riprova|calibrazione|monitoraggio|arricch[a-z]+)\b/i,
  /\b\w+(ando|endo)\b/i,
  /\b\w+(zione|zioni|mento|menti)\b/i,
  /[àèéìòù]/,
];

function isJsxOrTs(f) {
  return f.endsWith(".tsx") || f.endsWith(".ts");
}

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist" || name === ".vite" || name === "public") continue;
      walk(p, out);
    } else if (isJsxOrTs(p)) {
      out.push(p);
    }
  }
  return out;
}

function isTechnical(s) {
  if (/^https?:\/\//i.test(s)) return true;
  if (/^\/[a-zA-Z0-9/_-]*$/.test(s)) return true;
  if (/^[a-z0-9_-]+\.[a-z0-9_.-]+$/i.test(s)) return true;
  if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return true;
  if (/^\d[\d.,%+\-\s]*$/.test(s)) return true;
  if (/^rgba?\(/.test(s) || /^var\(--/.test(s)) return true;
  return false;
}

function markerScore(s) {
  return italianMarkers.reduce((n, r) => n + (r.test(s) ? 1 : 0), 0);
}

// "safe" i18n patterns: string appears next to English translation or is derived from t()/useT()
const safePatterns = [
  /\bit\s*\?[\s\S]{0,400}?:\s*[`"']/, // `it ? "…" : "…"`
  /\?[\s\S]{0,60}\bit\b[\s\S]{0,400}?:/, // ternary using lang === 'it'
  /\blang(uage)?\s*===\s*["']it["']/, // lang === 'it'
  /\blocale\s*===\s*["']it["']/,
  /\bcurrentLang\s*===\s*["']it["']/,
];

// If the file *never* uses lang branching AND *never* imports useT, everything Italian
// in it is de-facto Italian-only. We record that.

const files = walk(ROOT);

const findings = [];

for (const f of files) {
  if (f.replace(/\\/g, "/").endsWith("shared/i18n.ts")) continue;
  const src = fs.readFileSync(f, "utf8");

  const fileUsesLangBranch = /\bconst\s+it\s*=\s*lang\s*===\s*["']it["']/.test(src) ||
    /\bconst\s+\{\s*lang\s*\}\s*=\s*useLang\(\)/.test(src) ||
    /\bconst\s+lang\s*=\s*getLang\(\)/.test(src) ||
    /\buseLang\(\)/.test(src) ||
    /\buseT\(\)/.test(src) ||
    /\blang\s*===\s*["']it["']/.test(src);

  // Extract literals with position
  const litRegex = /(["'`])((?:\\.|(?!\1).){2,300})\1/gs;
  let m;
  while ((m = litRegex.exec(src)) !== null) {
    const raw = m[2];
    if (!raw || raw.length < 4 || raw.length > 300) continue;
    if (!/[A-Za-zÀ-ÿ]/.test(raw)) continue;
    if (isTechnical(raw)) continue;
    const score = markerScore(raw);
    if (score === 0) continue;
    // Small strings need ≥1 marker; longer or accented need at least 1
    if (score < 1) continue;

    // Get context around match
    const start = Math.max(0, m.index - 200);
    const end = Math.min(src.length, m.index + m[0].length + 400);
    const ctx = src.slice(start, end);

    // Skip if context shows `it ? "…" : "…"` pairing this literal with English fallback
    // Heuristic: within 400 chars there's a ternary using `it` OR a match of "`? … : …`" with two literals
    const inLangBranch = safePatterns.some((r) => r.test(ctx));
    if (inLangBranch) continue;

    // Skip if this literal is right after `t(` — DICT lookup key
    // (we look at 40 chars before the opening quote)
    const preSlice = src.slice(Math.max(0, m.index - 30), m.index);
    if (/\bt\(\s*$/.test(preSlice) || /\btt\(\s*$/.test(preSlice) || /\btranslate\(\s*$/.test(preSlice)) continue;

    // Also skip TS type unions like  "foo" | "bar"
    if (/[:|=,]\s*$/.test(preSlice) && /^\s*[|:,)\]]/.test(src.slice(m.index + m[0].length, m.index + m[0].length + 8))) {
      // literal used as type — skip
      continue;
    }

    const lineNo = src.slice(0, m.index).split(/\r?\n/).length;
    findings.push({
      f,
      line: lineNo,
      hasLangBranch: fileUsesLangBranch,
      score,
      text: raw.replace(/\r?\n/g, " ").slice(0, 200),
    });
  }
}

// Deduplicate
const seen = new Set();
const dedup = findings.filter((x) => {
  const k = `${x.f}:${x.line}:${x.text}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

// Separate:
//  A) File has NO lang branching → 100% Italian-only (worst)
//  B) File uses lang branching but this literal isn't paired
const worst = dedup.filter((x) => !x.hasLangBranch);
const missed = dedup.filter((x) => x.hasLangBranch);

const byFile = (arr) => {
  const g = {};
  for (const x of arr) (g[x.f] ||= []).push(x);
  return Object.entries(g).sort((a, b) => b[1].length - a[1].length);
};

function print(title, arr) {
  console.log(`\n${"=".repeat(78)}`);
  console.log(`${title} — ${arr.length} findings in ${byFile(arr).length} files`);
  console.log("=".repeat(78));
  for (const [file, xs] of byFile(arr)) {
    console.log(`\n-- ${file}  (${xs.length}) --`);
    for (const x of xs.slice(0, 30)) {
      console.log(`  L${x.line} [${x.score}m]  ${x.text}`);
    }
    if (xs.length > 30) console.log(`  ... +${xs.length - 30} more`);
  }
}

print("A) File has NO language branching — Italian-only strings", worst);
print("B) File uses language branching but literal NOT paired", missed);

console.log(`\n\nSummary`);
console.log(`  Total findings: ${dedup.length}`);
console.log(`  A (no lang branch): ${worst.length}`);
console.log(`  B (lang branch present but literal unpaired): ${missed.length}`);
