const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const qs = await p.question.findMany({
    where: { sourceType: 'MAT', stem: { contains: 'p(x)+p(y)=0' } },
    select: { id: true, stem: true, options: true, subject: true, answer: true, status: true }
  });
  console.log('MATCHED:', qs.length);
  qs.forEach((q, i) => {
    console.log(`\n--- Q${i + 1} id=${q.id} ---`);
    console.log('stem:', q.stem);
    console.log('options raw:', JSON.stringify(q.options));
    console.log('answer:', q.answer);
    console.log('status:', q.status);
  });
  await p.$disconnect();
})();
