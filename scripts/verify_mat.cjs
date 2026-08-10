const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const mat = await p.paper.findFirst({ where: { sourceType: "MAT" }, select: { id: true, title: true, subject: true, sourceType: true, sourceKey: true, status: true } });
  const byMath = await p.paper.findMany({ where: { subject: "数学", sourceType: "MAT" }, select: { id: true, title: true } });
  const qSubj = await p.question.count({ where: { sourceType: "MAT", subject: "数学" } });
  console.log("MAT 卷:", JSON.stringify(mat));
  console.log("按 subject=数学 过滤到的 MAT 卷数:", byMath.length);
  console.log("MAT 题 subject=数学 数量:", qSubj);
  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
