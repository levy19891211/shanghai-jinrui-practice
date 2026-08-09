// 一次性数据修正:把「PDF 导入」题目中存成字母(A-H)的答案映射回选项文本(可判分)。
// 越界字母(如 5 个选项却存 G)视为识别错误,清空交教师审核。
const { PrismaClient } = require('/root/shanghai-jinrui-practice/node_modules/@prisma/client');
const prisma = new PrismaClient();
function parseOpts(s) {
  try {
    const v = JSON.parse(s);
    if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  } catch {}
  return String(s || '').split(/[;；]/).map((x) => x.trim()).filter(Boolean);
}
function mapAnswer(ans, opts) {
  const a = (ans || '').trim();
  if (!a) return a;
  // 多选: A, C / A C
  const multi = a.split(/[ ,、]+/).filter(Boolean);
  if (multi.length >= 2 && multi.every((t) => /^[A-Ha-h]$/.test(t))) {
    const mapped = multi.map((t) => opts[t.toUpperCase().charCodeAt(0) - 65]).filter(Boolean);
    return mapped.length ? mapped.join('; ') : a;
  }
  if (/^[A-Ha-h]$/.test(a)) {
    const idx = a.toUpperCase().charCodeAt(0) - 65;
    return opts[idx] != null ? opts[idx] : ''; // 越界 → 清空
  }
  return a; // 本来就是选项文本
}
(async () => {
  const qs = await prisma.question.findMany({ where: { source: 'PDF 导入' } });
  let letterCount = 0, mapped = 0, cleared = 0, skipped = 0;
  for (const q of qs) {
    const opts = parseOpts(q.options);
    const ans = (q.answer || '').trim();
    const isLetterForm = /^[A-Ha-h]$/.test(ans) || /^([A-Ha-h])([ ,、]+[A-Ha-h])+$/.test(ans);
    if (!isLetterForm) { skipped++; continue; }
    letterCount++;
    const newAns = mapAnswer(ans, opts);
    if (newAns === ans) { skipped++; continue; }
    if (newAns === '') cleared++;
    else mapped++;
    await prisma.question.update({ where: { id: q.id }, data: { answer: newAns } });
  }
  console.log(`PDF导入题目总数=${qs.length} | 字母答案=${letterCount} | 已映射为选项文本=${mapped} | 越界清空=${cleared} | 无需改动=${skipped}`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
