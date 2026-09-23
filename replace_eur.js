const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "desktop-ui", "src");
const euro = "\u20ac";
let changed = 0;
const log = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      const content = fs.readFileSync(full, "utf-8");
      if (content.includes(euro)) {
        fs.writeFileSync(full, content.replaceAll(euro, "$"), "utf-8");
        changed++;
        log.push(entry.name);
      }
    }
  }
}

walk(root);
const result = `Done. Changed ${changed} files.\n${log.join("\n")}`;
fs.writeFileSync(path.join(__dirname, "_replace_log.txt"), result, "utf-8");
