const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const rows = await p.question.groupBy({
    by: ["status", "paper", "sourceType"],
    where: { sourceType: "MAT" },
    _count: { _all: true },
  });
  console.log("=== MAT 题 status × paper 分布 ===");
  for (const r of rows) {
    console.log(`status=${r.status}  sourceType=${r.sourceType}  paper="${r.paper}"  count=${r._count._all}`);
  }
  const all = await p.question.findMany({ where: { sourceType: "MAT" }, select: { id: true, status: true, paper: true, subject: true } });
  console.log("\n=== 待审核的 MAT 题 (status=PENDING_REVIEW) ===");
  const pending = all.filter((q) => q.status === "PENDING_REVIEW");
  console.log("待审核数量:", pending.length);
  // 按 paper 汇总
  const byPaper = {};
  for (const q of pending) byPaper[q.paper || "(空)"] = (byPaper[q.paper || "(空)"] || 0) + 1;
  for (const k of Object.keys(byPaper)) console.log(`  paper="${k}" -> ${byPaper[k]}`);
  await p.$disconnect();
})();
