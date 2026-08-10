const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
function parseIds(q) {
  if (Array.isArray(q.topicIds)) return q.topicIds;
  try { const v = JSON.parse(q.topicIds || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
(async () => {
  const all = await p.question.findMany({ where: { sourceType: 'MAT' }, select: { id: true, topic: true, topicIds: true, status: true } });
  const st = {};
  all.forEach((q) => { st[q.status] = (st[q.status] || 0) + 1; });
  console.log('STATUS:', JSON.stringify(st));
  const badIds = all.filter((q) => parseIds(q).length === 0);
  console.log('EMPTY topicIds:', badIds.length);
  const emptyTopic = all.filter((q) => !(q.topic && q.topic.trim()));
  console.log('EMPTY topic:', emptyTopic.length);
  // 抽样
  console.log('\n--- 抽样 3 ---');
  all.slice(0, 3).forEach((q) => console.log(q.id, '|', q.status, '|', q.topic, '|', q.topicIds));
  await p.$disconnect();
})();
