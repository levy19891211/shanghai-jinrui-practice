import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const papers = await prisma.paper.findMany({
  where: { OR: [ { title: { contains: 'SMC' } }, { sourceType: 'SMC' } ] },
  orderBy: { title: 'asc' },
});
console.log('=== SMC 相关套题(Paper) ===');
for (const p of papers) {
  let ids = [];
  try { ids = JSON.parse(p.questionIds || '[]'); } catch (e) {}
  console.log(`TITLE=${p.title} | id=${p.id} | #q=${ids.length} | sourceType=${p.sourceType} | kind=${p.kind} | origin=${p.origin} | source=${p.source}`);
}

const smcQ = await prisma.question.findMany({ where: { sourceType: 'SMC' } });
console.log('\n=== SMC 题目总数 ===', smcQ.length);
const byPaper = {};
for (const q of smcQ) { const k = q.paper || '(null)'; byPaper[k] = (byPaper[k] || 0) + 1; }
console.log('SMC 题目按 paper 字段分布:');
console.log(JSON.stringify(byPaper, null, 2));
