const fs = require("fs");
const path = require("path");

try {

const dataPath = "c:\\coding\\Biotech_Investment app 6\\data\\backtest_polygon_match.json";
const raw = fs.readFileSync(dataPath, "utf8");
const doc = JSON.parse(raw);
const rows = doc.rows || {};
const vals = Object.values(rows);

let out = `Total polygon rows: ${vals.length}\n\n`;

// Histogram of all match values (buckets of 5)
const hist = {};
let totalMatches = 0;
vals.forEach((r) => {
  [r.match_m10, r.match_m30, r.match_m60].forEach((v) => {
    if (v != null) {
      totalMatches++;
      const b = Math.round(v / 5) * 5;
      hist[b] = (hist[b] || 0) + 1;
    }
  });
});

out += `Total match values: ${totalMatches}\n\nHistogram (bucket 5%):\n`;
Object.entries(hist)
  .sort((a, b) => Number(a[0]) - Number(b[0]))
  .forEach(([k, v]) => {
    const bar = "#".repeat(Math.min(60, v));
    out += `  ${String(k).padStart(3)}%: ${String(v).padStart(3)} ${bar}\n`;
  });

// Detail: deals in the 35-50% cluster
out += `\nDeals with any match in 35-50% range:\n`;
let clusterCount = 0;
vals.forEach((r) => {
  const fields = [
    ["m10", r.match_m10],
    ["m30", r.match_m30],
    ["m60", r.match_m60],
  ];
  fields.forEach(([k, v]) => {
    if (v != null && v >= 35 && v <= 50) {
      clusterCount++;
      out += `  ${(r.ticker || "?").padEnd(8)} ${(r.completion_date || "?").slice(0, 10)} ${k}=${v}\n`;
    }
  });
});
out += `\nCluster 35-50% count: ${clusterCount}\n`;

const outPath = "c:\\coding\\Biotech_Investment app 6\\desktop-ui\\src\\_poly_debug.txt";
fs.writeFileSync(outPath, out, "utf8");
console.log("Wrote to: " + outPath);

} catch (e) {
  const errPath = "c:\\coding\\Biotech_Investment app 6\\desktop-ui\\src\\_poly_err.txt";
  require("fs").writeFileSync(errPath, String(e.stack || e), "utf8");
}
