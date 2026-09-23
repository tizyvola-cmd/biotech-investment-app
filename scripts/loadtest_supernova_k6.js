/**
 * k6 load test for SuperNova public surface (CDN + API).
 *
 * Install: https://k6.io/docs/get-started/installation/
 * Run:
 *   k6 run scripts/loadtest_supernova_k6.js
 *   k6 run -e BASE=https://supernovalpha.com -e VUS=50 -e DURATION=2m scripts/loadtest_supernova_k6.js
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

const BASE = __ENV.BASE || "https://supernovalpha.com";
const failRate = new Rate("failed_requests");

export const options = {
  vus: Number(__ENV.VUS || 20),
  duration: __ENV.DURATION || "1m",
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<3000"],
    failed_requests: ["rate<0.08"],
  },
};

const SNAPSHOTS = [
  "/project-data/desktop_data_manifest.json",
  "/project-data/simulation_sheet_snapshot.json",
  "/api/health",
  "/api/cdn/manifest",
];

export default function () {
  const path = SNAPSHOTS[Math.floor(Math.random() * SNAPSHOTS.length)];
  const res = http.get(`${BASE}${path}`, {
    headers: { Accept: "application/json" },
    tags: { name: path },
  });
  const ok = check(res, {
    "status 200": (r) => r.status === 200,
  });
  failRate.add(!ok);
  // Jitter so users don't lock-step
  sleep(0.5 + Math.random() * 1.5);
}
