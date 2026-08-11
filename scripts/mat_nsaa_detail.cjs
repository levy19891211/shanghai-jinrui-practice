const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  // 1) paper 含 "MAT" 的每张卷 + 状态
  const matPapers = await p.question.groupBy({
    by: ["paper", "sourceType", "status"],
    where: { paper: { contains: "MAT" } },
    _count: { _all: true },
  });
  console.log("=== paper 含 'MAT' 的题(按卷/题源/状态) ===");
  for (const r of matPapers) console.log(`paper="${r.paper}" sourceType=${r.sourceType} status=${r.status} count=${r._count._all}`);

  // 2) 所有待审核题的题源分布(全库)
  const pendingBySource = await p.question.groupBy({
    by: ["sourceType", "status"],
    where: { status: "PENDING_REVIEW" },
    _count: { _all: true },
  });
  console.log("\n=== 全库待审核题之源分布 ===");
  for (const r of pendingBySource) console.log(`sourceType=${r.sourceType} count=${r._count._all}`);
  await p.$disconnect();
})();
