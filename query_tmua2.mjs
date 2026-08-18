import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const tq = await prisma.question.findMany({ where: { OR: [ { sourceType: 'TMUA' }, { source: { contains: 'TMUA' } }, { paper: { contains: 'TMUA' } } ] } });
console.log('TMUA 题目总数:', tq.length);

const byPaper = {};
for (const q of tq) { const k = q.paper || '(null)'; byPaper[k] = (byPaper[k]||0)+1; }
console.log('[按 paper 分布]');
console.log(JSON.stringify(byPaper, null, 2));

const bySrc = {};
for (const q of tq) { const k = q.source || '(null)'; bySrc[k] = (bySrc[k]||0)+1; }
console.log('[按 source 分布]', JSON.stringify(bySrc));

const byStatus = {};
for (const q of tq) { const k = q.status; byStatus[k] = (byStatus[k]||0)+1; }
console.log('[按 status 分布]', JSON.stringify(byStatus));

const byDate = {};
for (const q of tq) { const k = String(q.importedAt||'').slice(0,10); byDate[k] = (byDate[k]||0)+1; }
console.log('[按 importedAt 日期分布]', JSON.stringify(byDate));
await prisma.$disconnect();
