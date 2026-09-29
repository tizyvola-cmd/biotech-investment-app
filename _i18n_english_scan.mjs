// Complementary scan: finds English strings in JSX text nodes / attributes
// of user-facing components that DO NOT go through useT() or a language
// branch. Focus areas per user request: tabs, panel titles, chart legends,
// collapsible details/summary labels.
//
// Approach:
//  - Walk desktop-ui/src for .tsx files only (charts/tabs/panels live here)
//  - Detect files that neither import useT nor use lang branching
//  - For those files, list every JSX text node (>text<) and interesting attrs
//    that contain human-readable English words.

import fs from "node:fs";
import path from "node:path";

const ROOT = "desktop-ui/src";

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (["node_modules", "dist", ".vite", "public"].includes(name)) continue;
      walk(p, out);
    } else if (p.endsWith(".tsx")) {
      out.push(p);
    }
  }
  return out;
}

const files = walk(ROOT);

function isTechnical(s) {
  if (/^https?:\/\//i.test(s)) return true;
  if (/^\/[a-zA-Z0-9/_-]*$/.test(s)) return true;
  if (/^[a-z0-9_-]+\.[a-z0-9_.-]+$/i.test(s)) return true;
  if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return true;
  if (/^\d[\d.,%+\-\s]*$/.test(s)) return true;
  if (/^rgba?\(/.test(s) || /^var\(--/.test(s)) return true;
  return false;
}

// English marker: contains at least two English function words OR looks like a
// sentence (starts with uppercase letter + has ≥ 3 words separated by spaces).
const englishFn = /\b(the|is|are|was|were|has|have|does|not|and|or|of|for|to|from|with|without|per|before|after|when|then|now|show|hide|open|close|reload|refresh|apply|reset|new|old|missing|updated|available|hidden|based|between|since|until|any|all|every|only|below|above|inside|outside|above|below)\b/i;
const noItalian = (s) => !/[àèéìòù]/.test(s) && !/\b(nessun|carica|salva|chiudi|aggiungi|aggiorna|clicca|apri|rimuovi|attivo|attiva|nascondi|mostra|prima|dopo|ultimo|nella|nello|questa|questo)\b/i.test(s);

const findings = [];

for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const hasI18n = /\buseT\(\)/.test(src) || /\buseLang\(\)/.test(src) ||
    /\blang\s*===\s*["']it["']/.test(src) || /\bconst\s+it\s*=/.test(src);
  if (hasI18n) continue; // file already migrated

  // JSX text nodes
  const jsxTextRegex = />([^<>{}\n]{6,240})</g;
  let m;
  while ((m = jsxTextRegex.exec(src)) !== null) {
    const raw = m[1].trim();
    if (!raw || raw.length < 6) continue;
    if (isTechnical(raw)) continue;
    if (!/[A-Za-z]/.test(raw)) continue;
    if (!noItalian(raw)) continue;
    // English marker: at least one function word OR looks like a title-cased phrase
    const hasFn = englishFn.test(raw);
    const words = raw.split(/\s+/);
    const titleCase = /^[A-Z]/.test(raw) && words.length >= 2 && words.length <= 12;
    if (!hasFn && !titleCase) continue;
    // Skip JS/TS keywords only
    if (/^[{}\[\]();,]+$/.test(raw)) continue;
    const lineNo = src.slice(0, m.index).split(/\r?\n/).length;
    findings.push({ f, line: lineNo, text: raw.slice(0, 180) });
  }
}

// Group by file
const seen = new Set();
const dedup = findings.filter((x) => {
  const k = `${x.f}:${x.line}:${x.text}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

const byFile = {};
for (const x of dedup) (byFile[x.f] ||= []).push(x);
const sorted = Object.entries(byFile).sort((a, b) => b[1].length - a[1].length);

console.log(`Files never using i18n primitives: ${sorted.length}`);
console.log(`Total JSX-text English literals in those files: ${dedup.length}\n`);

// Show top 40 files
for (const [file, arr] of sorted.slice(0, 60)) {
  console.log(`\n-- ${file}  (${arr.length}) --`);
  for (const x of arr.slice(0, 15)) {
    console.log(`  L${x.line}  ${x.text}`);
  }
  if (arr.length > 15) console.log(`  ... +${arr.length - 15} more`);
}
