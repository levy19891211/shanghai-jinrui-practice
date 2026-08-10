// 修正卷名含 NSAA 但被误标为 TMUA 的试卷及其题目 → NSAA
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

(async () => {
  const bad = await p.paper.findMany({
    where: { sourceType: "TMUA", subject: "数学", title: { contains: "NSAA" } },
    select: { id: true, title: true, questionIds: true },
  });
  console.log("待修正试卷数:", bad.length);
  for (const paper of bad) {
    const ids = JSON.parse(paper.questionIds);
    await p.paper.update({ where: { id: paper.id }, data: { sourceType: "NSAA" } });
    const upd = await p.question.updateMany({ where: { id: { in: ids }, sourceType: "TMUA" }, data: { sourceType: "NSAA" } });
    console.log(`- ${paper.title}: 卷→NSAA, 题目更新 ${upd.count}/${ids.length}`);
  }
  // 校验
  const remain = await p.paper.count({ where: { sourceType: "TMUA", subject: "数学", title: { contains: "NSAA" } } });
  console.log("残留误标卷数:", remain);
  await p.$disconnect();
  console.log("DONE");
})();
