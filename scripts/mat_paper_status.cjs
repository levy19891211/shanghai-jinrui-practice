const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const papers = await p.paper.findMany({
    where: { title: { contains: "MAT" } },
    select: { id: true, title: true, status: true, questionIds: true, sourceType: true, subject: true },
  });
  for (const paper of papers) {
    let ids = [];
    try { ids = JSON.parse(paper.questionIds || "[]"); } catch {}
    const qCount = await p.question.count({ where: { id: { in: ids } } });
    const pending = await p.question.count({ where: { id: { in: ids }, status: "PENDING_REVIEW" } });
    const published = await p.question.count({ where: { id: { in: ids }, status: "PUBLISHED" } });
    console.log(`\nPAPER: ${paper.title}`);
    console.log(`  id=${paper.id} status=${paper.status} subject=${paper.subject} sourceType=${paper.sourceType}`);
    console.log(`  题目数=${ids.length} 库中匹配=${qCount} 已发布=${published} 待审核=${pending}`);
  }
  await p.$disconnect();
})();
