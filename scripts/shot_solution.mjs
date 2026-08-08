// 公网 UI 截图验证:错题本解析展示 + 老师端 AI 生成解析按钮
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = "http://8.219.151.140";
const OUT = "/Users/levi/WorkBuddy/2026-08-07-13-05-24/.cache/shots";
fs.mkdirSync(OUT, { recursive: true });

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

async function login(email, pwd) {
  await page.goto(`${BASE}/login`);
  await page.waitForTimeout(1500);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', pwd);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
}

// 1. 学生端错题本
await login("stu@example.com", "123456");
await page.goto(`${BASE}/app/wrongbook`);
await page.waitForTimeout(2000);
await page.screenshot({ path: `${OUT}/6-wrongbook-solution.png`, fullPage: true });

// 2. 老师端题库页 - AI 生成解析按钮
await login("teacher@example.com", "123456");
await page.goto(`${BASE}/teacher`);
await page.waitForTimeout(2000);
await page.screenshot({ path: `${OUT}/7-teacher-ai-btn.png`, fullPage: true });

console.log("errors:", errors.length ? errors.slice(0, 10) : "none");
await b.close();
