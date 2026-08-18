import fs from 'fs';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)');
const dir = '/root/shanghai-jinrui-practice/apps/api/prisma/';
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const src = dir + 'dev.db';
const dst = dir + 'dev.db.bak-pre-smc-dedup-' + ts;
fs.copyFileSync(src, dst);
console.log('BACKUP OK ->', dst, fs.statSync(dst).size, 'bytes');

// 也备份 -wal / -shm（若有）
for (const ext of ['-wal', '-shm']) {
  if (fs.existsSync(src + ext)) {
    fs.copyFileSync(src + ext, dst + ext);
    console.log('BACKUP', ext, '->', dst + ext);
  }
}
await prisma.$disconnect();
