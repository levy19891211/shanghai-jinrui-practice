const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const qUpd = await p.question.updateMany({
    where: { sourceType: "MAT", subject: "" },
    data: { subject: "数学" },
  });
  const papers = await p.paper.findMany({
    where: { sourceType: "MAT", subject: "" },
    select: { id: true, sourceKey: true },
  });
  let paperFixed = 0;
  for (const pp of papers) {
    const parts = String(pp.sourceKey || "").split("::"); // ["", middle, source]
    const middle = parts[1] || "MAT 2007 2023 MC Questions";
    const src = parts[2] || "PDF 导入";
    const newKey = ["数学", middle, src].join("::");
    await p.paper.update({ where: { id: pp.id }, data: { subject: "数学", sourceKey: newKey } });
    paperFixed++;
  }
  const remainQ = await p.question.count({ where: { sourceType: "MAT", subject: "" } });
  const remainP = await p.paper.count({ where: { sourceType: "MAT", subject: "" } });
  console.log("MAT 题目 subject 已回填:", qUpd.count);
  console.log("MAT 试卷 subject 已回填:", paperFixed);
  console.log("剩余空 subject 的 MAT 题:", remainQ, " 试卷:", remainP);
  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
