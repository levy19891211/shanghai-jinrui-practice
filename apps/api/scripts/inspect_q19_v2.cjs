// Directly fetch TMUA Paper 1 模考6 (local) by known paper id, dump Q19.
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const PAPER_ID = 'cmt59y9j2000k11xpmi4vu0ht';
(async () => {
  const paper = await p.paper.findUnique({ where: { id: PAPER_ID } });
  if (!paper) { console.log('PAPER_NOT_FOUND'); await p.$disconnect(); return; }
  console.log('PAPER', JSON.stringify({ id: paper.id, title: paper.title, source: paper.source, status: paper.status }));
  let ids = []; try { ids = JSON.parse(paper.questionIds || '[]'); } catch {}
  console.log('Q_COUNT', ids.length);
  const q19id = ids[18];
  console.log('Q19_ID', q19id);
  const q = await p.question.findUnique({ where: { id: q19id } });
  if (!q) { console.log('Q19_NOT_FOUND'); await p.$disconnect(); return; }
  console.log('=== Q19 META ===');
  console.log('subject:', q.subject, '| sourceType:', q.sourceType, '| paper:', q.paper, '| source:', q.source, '| status:', q.status);
  console.log('topic:', q.topic, '| topicIds:', q.topicIds, '| difficulty:', q.difficulty);
  console.log('=== STEM ===');
  console.log(q.stem);
  console.log('=== OPTIONS ===');
  console.log(q.options);
  console.log('=== ANSWER ===');
  console.log(q.answer);
  console.log('=== SOLUTION ===');
  console.log(q.solution || '(none)');
  await p.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
