const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const mats = await p.paper.findMany({
    where: { OR: [{ title: { contains: "MAT" } }, { sourceKey: { contains: "MAT" } }, { sourceType: "MAT" }] },
    select: { id: true, title: true, subject: true, sourceType: true, status: true, sourceKey: true, questionIds: true },
  });
  console.log("=== MAT papers ===");
  console.log(JSON.stringify(mats, null, 2));

  const emptySubjMat = await p.question.count({ where: { sourceType: "MAT", subject: "" } });
  const totalMat = await p.question.count({ where: { sourceType: "MAT" } });
  console.log("MAT questions total:", totalMat, " with empty subject:", emptySubjMat);

  // 这些题被哪些 sourceKey 的卷分组(模拟 syncAutoPaperSets)
  const grp = await p.question.groupBy({ by: ["subject", "paper", "source"], where: { sourceType: "MAT" }, _count: { _all: true } });
  console.log("=== MAT question groups (subject|paper|source) ===");
  console.log(JSON.stringify(grp, null, 2));

  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
