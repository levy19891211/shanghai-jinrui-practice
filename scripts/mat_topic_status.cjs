const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
function parseTopics(q) {
  if (Array.isArray(q.topicIds)) return q.topicIds;
  try { const v = JSON.parse(q.topicIds || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
(async () => {
  const all = await p.question.findMany({
    where: { sourceType: 'MAT' },
    select: { id: true, topic: true, topicIds: true, status: true, stem: true }
  });
  console.log('TOTAL MAT:', all.length);
  // status 分布
  const st = {};
  all.forEach((q) => { st[q.status] = (st[q.status] || 0) + 1; });
  console.log('STATUS:', JSON.stringify(st));
  // topic 分布
  const tp = {};
  all.forEach((q) => {
    const key = (q.topic || '').trim() || '(空)';
    tp[key] = (tp[key] || 0) + 1;
  });
  console.log('TOPIC:', JSON.stringify(tp, null, 2));
  // 空 topic 计数
  const emptyTopic = all.filter((q) => !(q.topic && q.topic.trim()));
  console.log('EMPTY TOPIC:', emptyTopic.length);
  // 抽样空 topic 题的 stem
  console.log('\n--- 空 topic 抽样 ---');
  emptyTopic.slice(0, 5).forEach((q) => console.log(q.id, '::', q.stem.slice(0, 90)));
  await p.$disconnect();
})();
