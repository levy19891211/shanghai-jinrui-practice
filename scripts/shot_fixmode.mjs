// 本地 UI 截图:退回题双模式(一键修正 + AI 重调)与 AI 修正弹窗
import { chromium } from "playwright";
import fs from "node:fs";
const BASE = "http://localhost:3000";
const OUT = "/Users/levi/WorkBuddy/2026-08-07-13-05-24/.cache/shots";
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await page.goto(`${BASE}/login`);
await page.waitForTimeout(1500);
await page.fill('input[type="email"]', "teacher@example.com");
await page.fill('input[type="password"]', "123456");
await page.click('button[type="submit"]');
await page.waitForTimeout(2500);

await page.goto(`${BASE}/teacher`);
await page.waitForTimeout(1500);
await page.selectOption("select.ui-select", "REJECTED");
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/8-fixmode-buttons.png`, fullPage: true });

// 点第一个「AI 重调」
const aiBtn = page.locator("text=AI 重调").first();
if (await aiBtn.count()) {
  await aiBtn.click();
  await page.waitForTimeout(4000); // 等 mock LLM 返回
  await page.screenshot({ path: `${OUT}/9-ai-fix-modal.png`, fullPage: true });
}
console.log("errors:", errors.length ? errors.slice(0, 10) : "none");
await b.close();
