const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const all = await p.question.findMany({
    where: {
      OR: [
        { paper: { contains: "MAT" } },
        { paper: { contains: "2007" } },
        { paper: { contains: "2023" } },
      ],
    },
    select: { id: true, status: true, sourceType: true, paper: true, subject: true },
  });
  console.log("paper 含 MAT/2007/2023 的题总数:", all.length);
  const map = {};
  for (const q of all) {
    const key = JSON.stringify({ st: q.sourceType, status: q.status });
    map[key] = (map[key] || 0) + 1;
  }
  console.log("\n=== sourceType × status 分布 ===");
  for (const k of Object.keys(map)) {
    const { st, status } = JSON.parse(k);
    console.log(`sourceType=${st}  status=${status}  count=${map[k]}`);
  }
  const pending = all.filter((q) => q.status === "PENDING_REVIEW");
  console.log("\n待审核数量:", pending.length);
  if (pending.length) {
    const byPaper = {};
    const bySource = {};
    for (const q of pending) {
      byPaper[q.paper || "(空)"] = (byPaper[q.paper || "(空)"] || 0) + 1;
      bySource[q.sourceType || "(空)"] = (bySource[q.sourceType || "(空)"] || 0) + 1;
    }
    console.log("按 paper 分组:");
    for (const k of Object.keys(byPaper)) console.log(`  paper="${k}" -> ${byPaper[k]}`);
    console.log("按 sourceType 分组:");
    for (const k of Object.keys(bySource)) console.log(`  sourceType=${k} -> ${bySource[k]}`);
  }
  await p.$disconnect();
})();
