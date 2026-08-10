const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const papers = await p.paper.findMany({ where: { sourceType: "MAT" }, select: { id: true, title: true, status: true, subject: true, sourceType: true, _count: { select: { sessions: true } } } });
  const qBySource = await p.question.groupBy({ by: ["sourceType"], _count: { _all: true } });
  const matQ = await p.question.count({ where: { sourceType: "MAT" } });
  const anyMat = await p.question.count({ where: { OR: [{ sourceType: "MAT" }, { paper: { contains: "MAT" } }, { stem: { contains: "MAT" } }] } });
  console.log("MAT papers:", JSON.stringify(papers, null, 2));
  console.log("MAT question count (sourceType=MAT):", matQ);
  console.log("any MAT (sourceType/paper/stem):", anyMat);
  console.log("sourceType distribution:", JSON.stringify(qBySource));
  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
