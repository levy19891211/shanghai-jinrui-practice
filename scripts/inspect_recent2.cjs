const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const papers = await p.paper.findMany({
    orderBy: { createdAt: "desc" },
    take: 8,
    select: { id: true, title: true, subject: true, sourceType: true, status: true, source: true, createdAt: true, _count: { select: { sessions: true } } },
  });
  console.log("=== 最近创建的试卷(前8) ===");
  for (const x of papers) console.log(`${x.createdAt} | ${x.title} | subject=${x.subject} sourceType=${x.sourceType} status=${x.status} src=${x.source} | ${x._count.sessions} sessions`);
  await p.$disconnect();
})();
