// 验证 TMUA 自编题 8 套卷入库结果
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
(async () => {
  const qs = await prisma.question.count({ where: { paper: { startsWith: "TMUA自编题卷" } } });
  const papers = await prisma.paper.findMany({
    where: { title: { startsWith: "TMUA自编题卷" } },
    select: { title: true, questionIds: true, status: true, sourceType: true, kind: true },
    orderBy: { title: "asc" },
  });
  const statusDist = await prisma.question.groupBy({
    by: ["status"],
    where: { paper: { startsWith: "TMUA自编题卷" } },
    _count: true,
  });
  console.log("=== 验证 TMUA 自编题入库 ===");
  console.log("题目总数(paper 以 TMUA自编题卷 开头):", qs);
  console.log("试卷套数:", papers.length);
  papers.forEach((p) => {
    const n = JSON.parse(p.questionIds || "[]").length;
    console.log(`  - ${p.title} | ${n} 题 | status=${p.status} | sourceType=${p.sourceType} | kind=${p.kind}`);
  });
  console.log("题目状态分布:", JSON.stringify(statusDist));
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
