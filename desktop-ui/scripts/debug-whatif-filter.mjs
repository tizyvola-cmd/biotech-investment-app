/**
 * Click what-if book filter chips and log row counts via /debug-ingest.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.DEBUG_DASHBOARD_URL ?? "http://127.0.0.1:5173/?lab=1";
const TOKEN =
  process.env.SUPERNOVA_API_TOKEN ??
  fs.readFileSync(path.join(process.cwd(), "..", ".supernova_api_token"), "utf8").trim();

async function ingest(payload) {
  await fetch("http://127.0.0.1:5173/debug-ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "ae3756" },
    body: JSON.stringify({ sessionId: "ae3756", ...payload, runId: "post-fix-v2", timestamp: Date.now() }),
  }).catch(() => {});
}

async function rowCount(page) {
  return page.locator(".what-if-compact-table tbody tr").filter({
    hasNot: page.locator("td[colspan]"),
  }).count();
}

async function toolbarRows(page) {
  const t = await page.locator(".what-if-compact-table").locator("xpath=ancestor::section[1]").locator("span.tabular-nums").last().textContent();
  return t?.trim() ?? "";
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript((token) => {
    localStorage.setItem("supernova_api_token", token);
  }, TOKEN);
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(8000);
  await ingest({ hypothesisId: "T", location: "Playwright:boot", message: "page loaded", data: { url: BASE } });

  const scrollEl = page.locator(".app-page-scroll");
  if ((await scrollEl.count()) === 0) {
    const body = await page.locator("body").innerText();
    await ingest({ hypothesisId: "T", location: "Playwright:fail", message: "no scroll container", data: { body: body.slice(0, 400) } });
    await browser.close();
    process.exit(2);
  }
  for (let i = 0; i < 8; i++) {
    await scrollEl.evaluate((el) => { el.scrollTop += 500; });
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(3000);

  const before = await rowCount(page);
  const toolbarBefore = await toolbarRows(page);
  await ingest({
    hypothesisId: "T",
    location: "Playwright:before",
    message: "before All click",
    data: { domRows: before, toolbar: toolbarBefore },
  });

  const allBtn = page.getByRole("button", { name: /All \(\d+\)|Tutti \(\d+\)/i });
  if ((await allBtn.count()) === 0) {
    await ingest({ hypothesisId: "T", location: "Playwright:fail", message: "All button missing", data: {} });
    await browser.close();
    process.exit(3);
  }
  await allBtn.first().click({ timeout: 5000 });
  await page.waitForTimeout(1500);

  const after = await rowCount(page);
  const toolbarAfter = await toolbarRows(page);
  await ingest({
    hypothesisId: "T",
    location: "Playwright:afterAll",
    message: "after All click",
    data: { domRows: after, toolbar: toolbarAfter },
  });

  await browser.close();
}

main().catch(async (err) => {
  await ingest({ hypothesisId: "T", location: "Playwright:error", message: String(err), data: {} });
  console.error(err);
  process.exit(1);
});
