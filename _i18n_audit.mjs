// Audits desktop-ui/src/shared/i18n.ts
// 1) Finds keys where en === it (potentially untranslated Italian).
// 2) Reports total and grouped by namespace.
import fs from "node:fs";

const src = fs.readFileSync("desktop-ui/src/shared/i18n.ts", "utf8");

// Grab everything between `const DICT = {` and `} as const;`
const start = src.indexOf("const DICT = {");
const end = src.indexOf("} as const;", start);
const body = src.slice(start, end);

// Regex to capture entries like:  "key": { en: "…", it: "…" },
// Supports multiline strings, escaped quotes, single-line.
const entryRe = /"([\w.\-]+)":\s*\{\s*en:\s*"((?:\\.|[^"\\])*)"\s*,\s*it:\s*"((?:\\.|[^"\\])*)"\s*,?\s*\}/g;

let m;
const entries = [];
while ((m = entryRe.exec(body)) !== null) {
  entries.push({ key: m[1], en: m[2], it: m[3] });
}

console.log(`Parsed entries: ${entries.length}`);

// Category 1: en === it AND string is non-trivial (more than 2 chars, contains letters, not a bare identifier)
function isTrivial(s) {
  if (s.length <= 2) return true;
  // Common trivial cases: percentages, dates, letters that are the same in both languages
  const trivialWords = new Set([
    "P&L","P&L%","ROI","EIS","SDS","CD","EV/S","EV","AI","API","URL","JSON","CSV","N/A","n/a","OK","ok","%","$","€","—","–","•","·",
    "Ticker","ticker","online","offline","stop","start","reset","import","export","Import","Export","Reset",
    "Y","M","D","W","H","T","test","Test","IT","EN","auto","Auto"
  ]);
  if (trivialWords.has(s)) return true;
  // Purely non-letter (symbols/numbers)
  if (!/[a-zA-Z]/.test(s)) return true;
  return false;
}

const suspicious = entries.filter(e => e.en === e.it && !isTrivial(e.en));

console.log(`\nSuspicious keys (en === it, non-trivial): ${suspicious.length}`);
console.log("---");
for (const e of suspicious) {
  console.log(`${e.key}\t${JSON.stringify(e.en).slice(0, 120)}`);
}

// Group them by top-level namespace for readability
const byNs = {};
for (const e of suspicious) {
  const ns = e.key.split(".")[0];
  (byNs[ns] ||= []).push(e.key);
}
console.log("\nCount by namespace:");
for (const [ns, keys] of Object.entries(byNs).sort((a,b) => b[1].length - a[1].length)) {
  console.log(`  ${ns}: ${keys.length}`);
}

// Also do a sanity check: dict length vs raw count of `en:` occurrences
const enCount = (body.match(/^\s+en:\s+"/gm) || []).length;
console.log(`\nRaw en: occurrences in DICT body: ${enCount} (parsed ${entries.length})`);
