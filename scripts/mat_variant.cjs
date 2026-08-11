const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  // 不区分大小写,所有 sourceType 含 "mat" 的题
  const all = await p.question.findMany({
    where: { sourceType: { contains: "mat" } },
    select: { id: true, status: true, sourceType: true, paper: true, subject: true },
  });
  console.log("sourceType 含 'mat'(不区分大小写) 总数:", all.length);
  // distinct sourceType 精确值 + status 分布
  const map = {};
  for (const q of all) {
    const key = JSON.stringify({ st: q.sourceType, status: q.status });
    map[key] = (map[key] || 0) + 1;
  }
  console.log("\n=== sourceType 精确值 × status 分布 ===");
  for (const k of Object.keys(map)) {
    const { st, status } = JSON.parse(k);
    console.log(`sourceType="${st}"  status=${status}  count=${map[k]}`);
  }
  // 待审核的
  const pending = all.filter((q) => q.status === "PENDING_REVIEW");
  console.log("\n待审核(MAT 相关)数量:", pending.length);
  if (pending.length) {
    const byPaper = {};
    for (const q of pending) byPaper[q.paper || "(空)"] = (byPaper[q.paper || "(空)"] || 0) + 1;
    console.log("按 paper 分组:");
    for (const k of Object.keys(byPaper)) console.log(`  paper="${k}" -> ${byPaper[k]}`);
  }
  await p.$disconnect();
})();
