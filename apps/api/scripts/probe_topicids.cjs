// Probe how topicIds are stored + find 数学 M7 KP.
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const paper = await p.paper.findUnique({ where: { id: 'cmt59y9j2000k11xpmi4vu0ht' } });
  let ids = []; try { ids = JSON.parse(paper.questionIds || '[]'); } catch {}
  const qs = await p.question.findMany({ where: { id: { in: ids.slice(0, 5) } }, select: { id: true, topic: true, topicIds: true } });
  console.log('--- sample topicIds (Q1-5) ---');
  for (const q of qs) console.log(JSON.stringify({ topic: q.topic, topicIds: q.topicIds }));
  const q19 = await p.question.findUnique({ where: { id: ids[18] } });
  console.log('Q19 topic:', q19.topic, '| topicIds:', q19.topicIds);
  console.log('--- 数学 KPs matching M7/M? ---');
  const kps = await p.knowledgePoint.findMany({ where: { subject: '数学' } });
  const m = kps.filter(k => /M7|M6|M5|probability|prob/i.test(k.name + (k.code||'')));
  for (const k of m) console.log(JSON.stringify({ id: k.id, name: k.name, code: k.code, sortOrder: k.sortOrder }));
  await p.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
