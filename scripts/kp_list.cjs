const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const kps = await p.knowledgePoint.findMany({ select: { id: true, subject: true, name: true, sortOrder: true }, orderBy: [{ subject: 'asc' }, { sortOrder: 'asc' }] });
  console.log('TOTAL KP:', kps.length);
  const bySubj = {};
  kps.forEach((k) => { (bySubj[k.subject] = bySubj[k.subject] || []).push(`${k.name}(${k.id.slice(0,6)})`); });
  for (const s of Object.keys(bySubj)) {
    console.log(`\n=== subject=${s} (${bySubj[s].length}) ===`);
    console.log(bySubj[s].join(' | '));
  }
  await p.$disconnect();
})();
