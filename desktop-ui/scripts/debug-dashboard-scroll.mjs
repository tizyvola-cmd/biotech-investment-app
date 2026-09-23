/**
 * Automated dashboard scroll probe — emits debug logs via Vite /debug-ingest.
 * Usage: node scripts/debug-dashboard-scroll.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.DEBUG_DASHBOARD_URL ?? "http://127.0.0.1:5173";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(12000);
  const scrollEl = page.locator(".app-page-scroll");
  const scrollCount = await scrollEl.count();
  if (scrollCount === 0) {
    const bodyText = await page.locator("body").innerText();
    console.error("NO .app-page-scroll — body preview:", bodyText.slice(0, 500));
    await page.screenshot({ path: "debug-dashboard-miss.png", fullPage: true });
    process.exit(2);
  }
  await scrollEl.first().waitFor({ timeout: 5000 });
  for (let i = 0; i < 12; i++) {
    await scrollEl.evaluate((el) => {
      el.scrollTop += 400;
    });
    await page.waitForTimeout(350);
  }
  for (let i = 0; i < 8; i++) {
    await scrollEl.evaluate((el) => {
      el.scrollTop -= 500;
    });
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(2000);
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
