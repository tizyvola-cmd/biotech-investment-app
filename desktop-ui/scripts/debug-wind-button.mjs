/**
 * Click "Open wind table" and verify drawer dialog appears.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.DEBUG_DASHBOARD_URL ?? "http://127.0.0.1:5173/?lab=1";
const TOKEN =
  process.env.SUPERNOVA_API_TOKEN ??
  fs.readFileSync(path.join(process.cwd(), "..", ".supernova_api_token"), "utf8").trim();

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript((token) => {
    localStorage.setItem("supernova_api_token", token);
  }, TOKEN);
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(12000);

  const scrollEl = page.locator(".app-page-scroll");
  for (let i = 0; i < 10; i++) {
    await scrollEl.evaluate((el) => { el.scrollTop += 400; });
    await page.waitForTimeout(300);
  }

  const btn = page.locator("[data-whatif-wind-open]");
  const count = await btn.count();
  console.log("wind button count:", count);
  if (count === 0) {
    const body = await page.locator("body").innerText();
    console.log("body snippet:", body.slice(0, 600));
    await browser.close();
    process.exit(2);
  }

  await btn.first().click({ timeout: 8000 });
  await page.waitForTimeout(800);

  const dialog = page.getByRole("dialog", { name: /^Wind$/i });
  const dialogCount = await dialog.count();
  console.log("dialog count after click:", dialogCount);
  const visible = dialogCount > 0 ? await dialog.first().isVisible() : false;
  console.log("dialog visible:", visible);

  const tableRows = dialogCount > 0
    ? await dialog.locator(".what-if-compact-table tbody tr").count()
    : 0;
  console.log("table rows in dialog:", tableRows);

  await browser.close();
  process.exit(visible ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
