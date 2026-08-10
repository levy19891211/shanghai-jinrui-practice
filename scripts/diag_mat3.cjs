const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  // 精确:paper 字段以 MAT 开头(卷名),排除 stem 误匹配
  const matPaperQs = await p.question.findMany({
    where: { paper: { startsWith: "MAT" } },
    select: { id: true, subject: true, sourceType: true, paper: true, status: true },
  });
  console.log("=== questions with paper starting 'MAT' ===");
  console.log("count:", matPaperQs.length);
  const bySource = {};
  for (const q of matPaperQs) {
    const k = `${q.subject}|${q.sourceType}|${q.paper}`;
    bySource[k] = (bySource[k] || 0) + 1;
  }
  console.log(JSON.stringify(bySource, null, 2));

  // papers whose title or sourceKey contains MAT
  const mats = await p.paper.findMany({
    where: { OR: [{ title: { contains: "MAT" } }, { sourceKey: { contains: "MAT" } }, { paper: { contains: "MAT" } }] },
    select: { id: true, title: true, subject: true, sourceType: true, status: true, sourceKey: true },
  });
  console.log("=== papers with MAT in title/sourceKey/paper ===");
  console.log(JSON.stringify(mats, null, 2));

  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
