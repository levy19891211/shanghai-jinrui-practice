// Inspect TMUA Paper 1 模考6 (local) and dump Q19 full content.
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const papers = await p.paper.findMany({
    where: { OR: [{ sourceType: 'TMUA' }, { source: { contains: '模考' } }, { title: { contains: '模考' } }, { sourceKey: { contains: 'TMUA' } }] },
    select: { id: true, title: true, source: true, sourceKey: true, status: true, subject: true, sourceType: true, questionIds: true },
  });
  console.log('CANDIDATE_PAPERS', papers.length);
  for (const pp of papers) {
    let ids = []; try { ids = JSON.parse(pp.questionIds || '[]'); } catch {}
    console.log(JSON.stringify({ id: pp.id, title: pp.title, source: pp.source, sourceKey: pp.sourceKey, status: pp.status, qLen: ids.length }));
  }
  console.log('DEBUG titles:', JSON.stringify(papers.map(x => x.title)));
  const target = papers.find(pp => (pp.title || '').includes('模考6'));
  if (!target) { console.log('NO_TARGET_FOUND'); await p.$disconnect(); return; }
  console.log('TARGET', JSON.stringify({ id: target.id, title: target.title, sourceKey: target.sourceKey }));
  let ids = []; try { ids = JSON.parse(target.questionIds || '[]'); } catch {}
  console.log('Q_COUNT', ids.length);
  const q19id = ids[18];
  console.log('Q19_ID', q19id);
  if (q19id) {
    const q = await p.question.findUnique({ where: { id: q19id } });
    if (q) {
      console.log('--- Q19 FULL ---');
      console.log('subject', q.subject, '| sourceType', q.sourceType, '| paper', q.paper, '| source', q.source, '| status', q.status);
      console.log('topic', q.topic, '| topicIds', q.topicIds, '| difficulty', q.difficulty);
      console.log('STEM:\n' + q.stem);
      console.log('OPTIONS:\n' + q.options);
      console.log('ANSWER:\n' + q.answer);
      console.log('SOLUTION:\n' + (q.solution || '(none)'));
    } else { console.log('Q19_NOT_FOUND'); }
  }
  await p.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
