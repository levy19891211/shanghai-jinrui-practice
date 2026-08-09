const { PrismaClient } = require('/root/shanghai-jinrui-practice/node_modules/@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const qs = await prisma.question.findMany({ where: { subject: '物理', source: 'PDF 导入' }, orderBy: { importedAt: 'desc' } });
  let total = qs.length, letters = 0, valid = 0, invalid = 0, nonLetter = 0;
  const bad = [];
  qs.forEach((q, i) => {
    let opts = [];
    try { opts = JSON.parse(q.options || '[]'); } catch {}
    const ans = (q.answer || '').trim();
    if (/^[A-H]$/.test(ans)) {
      letters++;
      const idx = ans.charCodeAt(0) - 65;
      if (idx < opts.length) valid++;
      else { invalid++; if (bad.length < 30) bad.push(`[${i}] ans=${ans} #opts=${opts.length} stem=${JSON.stringify((q.stem||'').replace(/\s+/g,' ').slice(0,40))}`); }
    } else nonLetter++;
  });
  console.log(`TOTAL=${total} letters=${letters} validLetter=${valid} invalidLetter(越界/明显错位)=${invalid} nonLetter/noAnswer=${nonLetter}`);
  console.log('SAMPLE INVALID:');
  bad.forEach((b) => console.log('  ' + b));
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
