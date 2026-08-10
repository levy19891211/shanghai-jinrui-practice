const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  // 最近导入/创建的学科题(subject=数学),按导入时间倒序
  const recent = await p.question.findMany({
    where: { subject: "数学" },
    orderBy: { importedAt: "desc" },
    take: 60,
    select: { id: true, sourceType: true, subject: true, paper: true, source: true, topic: true, importedAt: true, createdAt: true, status: true },
  });
  console.log("=== 最近导入的数学题 (前60, 按 importedAt desc) ===");
  // 先按 sourceType 统计最近这一批
  const bySrc = {};
  for (const q of recent) bySrc[q.sourceType || "null"] = (bySrc[q.sourceType || "null"] || 0) + 1;
  console.log("最近60条 sourceType 分布:", JSON.stringify(bySrc));
  console.log(JSON.stringify(recent.slice(0, 25), null, 2));

  // 最近创建的试卷(全部)
  const papers = await p.paper.findMany({
    orderBy: { createdAt: "desc" },
    take: 15,
    select: { id: true, title: true, subject: true, sourceType: true, status: true, source: true, createdAt: true, questionIds: true },
  });
  console.log("\n=== 最近创建的试卷 (前15) ===");
  console.log(JSON.stringify(papers, null, 2));

  await p.$disconnect();
})();
