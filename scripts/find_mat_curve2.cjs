const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
function matchStem(stem, term) {
  return String(stem || '').toLowerCase().includes(term.toLowerCase());
}
(async () => {
  const terms = ['sketch of a curve', 'p(x)+p(y)', 'p(x) + p(y)', 'polynomial', 'could be the sketch'];
  for (const t of terms) {
    const all = await p.question.findMany({
      where: { sourceType: 'MAT' },
      select: { id: true, stem: true, options: true, subject: true, answer: true, status: true, createdAt: true }
    });
    const qs = all.filter((q) => matchStem(q.stem, t));
    if (qs.length) {
      console.log(`TERM: ${t} => ${qs.length}`);
      qs.forEach((q, i) => {
        console.log(`\n--- Q${i + 1} id=${q.id} ---`);
        console.log('stem:', q.stem);
        console.log('options raw:', JSON.stringify(q.options));
        console.log('answer:', q.answer);
        console.log('status:', q.status);
      });
    }
  }
  await p.$disconnect();
})();
