const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const CONJ = ['and', 'but', 'or', 'not', 'only'];
function startsWithConj(text) {
  const t = String(text || '').trim().toLowerCase();
  return CONJ.some((c) => t.startsWith(c));
}
function parseOptions(q) {
  if (Array.isArray(q.options)) return q.options;
  try {
    const v = JSON.parse(q.options || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

(async () => {
  // 1) 扫描 MAT 中 options 以连接词/否定词开头的异常题
  const all = await p.question.findMany({
    where: { sourceType: 'MAT' },
    select: { id: true, stem: true, options: true, answer: true, status: true, createdAt: true }
  });
  const suspicious = all.filter((q) => {
    const opts = parseOptions(q);
    return opts.some(startsWithConj);
  });
  console.log(`Suspicious MAT questions: ${suspicious.length}`);
  for (const q of suspicious) {
    console.log(`\n--- id=${q.id} ---`);
    console.log('stem:', q.stem.slice(0, 120));
    console.log('options:', JSON.stringify(parseOptions(q)));
    console.log('answer:', q.answer);
  }

  // 2) 修复 curve sketch 这道题
  const targetId = 'cmsnb84ej006cbicc15dn5mie';
  const fixedOptions = JSON.stringify([
    'A and D, but not B or C',
    'A and B, but not C or D',
    'C and D, but not A or B',
    'A, C and D, but not B',
    'A, B and C, but not D'
  ]);
  const fixedAnswer = 'C and D, but not A or B';
  await p.question.update({
    where: { id: targetId },
    data: {
      options: fixedOptions,
      answer: fixedAnswer
    }
  });
  console.log(`\nFixed curve sketch question ${targetId}`);

  await p.$disconnect();
})();
