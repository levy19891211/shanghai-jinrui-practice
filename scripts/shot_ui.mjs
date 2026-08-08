// 本地 UI 截图验证:试卷管理 + 一键修正
import { chromium } from "playwright";
import fs from "node:fs";

const OUT = "/Users/levi/WorkBuddy/2026-08-07-13-05-24/.cache/shots";
fs.mkdirSync(OUT, { recursive: true });

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await page.goto("http://localhost:3000/login");
await page.fill('input[type="email"]', "teacher@example.com");
await page.fill('input[type="password"]', "123456");
await page.click('button[type="submit"]');
await page.waitForTimeout(2500);

// 1. 试卷管理列表
await page.goto("http://localhost:3000/teacher/papers");
await page.waitForTimeout(1800);
await page.screenshot({ path: `${OUT}/1-papers-list.png`, fullPage: true });

// 2. 试卷详情抽屉
const view = page.locator("text=查看").first();
if (await view.count()) {
  await view.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/2-paper-detail.png` });
  await page.keyboard.press("Escape");
  await page.mouse.click(200, 300);
  await page.waitForTimeout(500);
}

// 3. 题库管理 - 已退回筛选
await page.goto("http://localhost:3000/teacher");
await page.waitForTimeout(1500);
await page.selectOption("select", "REJECTED");
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/3-rejected-list.png`, fullPage: true });

// 4. 单题一键修正弹窗
const fixBtn = page.locator("text=一键修正").first();
if (await fixBtn.count()) {
  await fixBtn.click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/4-autofix-modal.png`, fullPage: true });
  await page.locator("text=取消").first().click();
  await page.waitForTimeout(500);
}

// 5. 批量修正弹窗
const batch = page.locator("text=退回题一键修正").first();
if (await batch.count()) {
  await batch.click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/5-batch-modal.png`, fullPage: true });
}

console.log("errors:", errors.length ? errors.slice(0, 10) : "none");
await b.close();
