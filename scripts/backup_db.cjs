#!/usr/bin/env node
// 整站 SQLite 每日热备:
// 1) 先 PRAGMA wal_checkpoint(TRUNCATE) 把 WAL 合并进主库,得到在线一致性快照(无需停服)
// 2) 复制主库(+ -wal/-shm 若存在)到 /root/backups
// 3) 多版本保留:daily 最近 7 份 / weekly 每周一保留 4 份 / monthly 每月 1 号保留 3 份
// 4) 异地扩展点:若配置 BACKUP_RCLONE 远程,则在末尾 rclone copy(可选,无配置则跳过)
const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const ENV_FILE = path.join(REPO, "apps", "api", ".env");
const PRISMA_DIR = path.join(REPO, "apps", "api", "prisma");
const BACKUP_ROOT = process.env.BACKUP_ROOT || "/root/backups";

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (!fs.existsSync(ENV_FILE)) throw new Error("no DATABASE_URL and no .env at " + ENV_FILE);
  const text = fs.readFileSync(ENV_FILE, "utf8");
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (k === "DATABASE_URL") return v;
  }
  throw new Error("DATABASE_URL not found in .env");
}

function resolveDbPath(url) {
  const m = url.match(/file:\s*(.+?)\s*$/);
  if (!m) throw new Error("DATABASE_URL is not a sqlite file: url=" + url);
  const rel = m[1].trim();
  return path.isAbsolute(rel) ? rel : path.resolve(PRISMA_DIR, rel);
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function cleanup(dir, keep) {
  if (!fs.existsSync(dir)) return;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".db"))
    .map((f) => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  files.slice(keep).forEach((x) => fs.unlinkSync(path.join(dir, x.f)));
  if (files.length > keep) console.log(`[backup] pruned ${files.length - keep} old in ${dir}`);
}

async function main() {
  const url = loadDatabaseUrl();
  process.env.DATABASE_URL = url;
  const dbPath = resolveDbPath(url);
  if (!fs.existsSync(dbPath)) throw new Error("db file not found: " + dbPath);

  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  try {
    await prisma.$executeRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    await prisma.$disconnect();
  }

  const dailyDir = path.join(BACKUP_ROOT, "daily");
  fs.mkdirSync(dailyDir, { recursive: true });
  const dest = path.join(dailyDir, `jinrui-${stamp()}.db`);
  fs.copyFileSync(dbPath, dest);
  for (const suf of ["-wal", "-shm"]) {
    if (fs.existsSync(dbPath + suf)) fs.copyFileSync(dbPath + suf, dest + suf);
  }
  console.log("[backup] daily ->", dest);

  const now = new Date();
  if (now.getDay() === 1) {
    const wd = path.join(BACKUP_ROOT, "weekly");
    fs.mkdirSync(wd, { recursive: true });
    fs.copyFileSync(dest, path.join(wd, path.basename(dest)));
    cleanup(wd, 4);
    console.log("[backup] weekly snapshot saved");
  }
  if (now.getDate() === 1) {
    const md = path.join(BACKUP_ROOT, "monthly");
    fs.mkdirSync(md, { recursive: true });
    fs.copyFileSync(dest, path.join(md, path.basename(dest)));
    cleanup(md, 3);
    console.log("[backup] monthly snapshot saved");
  }
  cleanup(dailyDir, 7);

  if (process.env.BACKUP_RCLONE) {
    const { execSync } = require("child_process");
    try {
      execSync(`rclone copy ${BACKUP_ROOT} ${process.env.BACKUP_RCLONE}`, { stdio: "inherit" });
      console.log("[backup] synced to remote:", process.env.BACKUP_RCLONE);
    } catch (e) {
      console.error("[backup][warn] remote sync failed:", e.message);
    }
  }
  console.log("[backup] done");
}

main().catch((e) => {
  console.error("[backup] FAILED:", e.message);
  process.exit(1);
});
