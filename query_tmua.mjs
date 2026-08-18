import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const tq = await prisma.question.findMany({ where: { OR: [ { sourceType: 'TMUA' }, { source: { contains: 'TMUA' } }, { paper: { contains: 'TMUA' } } ] } });
console.log('TMUA 题目总数:', tq.length);
const papers = await prisma.paper.findMany({ where: { title: { contains: 'TMUA自编题卷' } } });
console.log('TMUA 套题数:', papers.length);
for (const p of papers) { let ids = []; try { ids = JSON.parse(p.questionIds || '[]'); } catch (e) {} console.log('  ', p.title, '#q=' + ids.length); }
await prisma.$disconnect();
