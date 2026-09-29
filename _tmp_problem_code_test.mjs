function AH(e, t) {
  const n = `${e} ${t}`.toLowerCase();
  return /freeze|stuck|boot did not finish|request storm/.test(n)
    ? "entry_freeze_request_storm"
    : /chunkload|loading chunk|dynamically imported/.test(n)
      ? "chunk_load_failure"
      : /network|failed to fetch|load failed/.test(n)
        ? "network_error"
        : e.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 48) || "ui_error";
}
const label = "Catalyst Days";
const msg = "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.";
console.log("result=", AH(label, msg));
const raw = `${label} ${msg}`.toLowerCase();
for (const p of ["freeze", "stuck", "boot did not finish", "request storm", "failed to fetch", "load failed", "network"]) {
  console.log(p, new RegExp(p).test(raw));
}
