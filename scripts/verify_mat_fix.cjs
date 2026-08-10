const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const q = await p.question.findUnique({
    where: { id: 'cmsnb84ej006cbicc15dn5mie' },
    select: { id: true, stem: true, options: true, answer: true, status: true }
  });
  console.log('id:', q.id);
  console.log('status:', q.status);
  console.log('options:', q.options);
  console.log('answer:', q.answer);
  await p.$disconnect();
})();
