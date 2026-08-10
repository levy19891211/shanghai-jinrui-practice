// 修复刚导入的 "NSAA 2023 Maths" 试卷及其题目:题源 TMUA → NSAA
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

const PAPER_ID = "cmsn9g38y000uafb8dy0nazot";

(async () => {
  const paper = await p.paper.findUnique({ where: { id: PAPER_ID } });
  if (!paper) {
    console.log("未找到试卷", PAPER_ID);
    await p.$disconnect();
    return;
  }
  console.log("修复前试卷:", paper.title, "sourceType=", paper.sourceType);

  // 1) 修试卷
  await p.paper.update({ where: { id: PAPER_ID }, data: { sourceType: "NSAA" } });

  // 2) 修该卷下全部题目(sourceType TMUA → NSAA),按试卷名精确定位避免误伤
  const ids = JSON.parse(paper.questionIds);
  const upd = await p.question.updateMany({
    where: { id: { in: ids }, sourceType: "TMUA" },
    data: { sourceType: "NSAA" },
  });
  console.log("已更新题目数:", upd.count, "/ 共", ids.length);

  // 校验
  const after = await p.paper.findUnique({ where: { id: PAPER_ID }, select: { sourceType: true } });
  const qCheck = await p.question.findMany({ where: { id: { in: ids } }, select: { sourceType: true } });
  const bad = qCheck.filter((q) => q.sourceType !== "NSAA").length;
  console.log("修复后试卷 sourceType=", after.sourceType, "| 题目未修正数=", bad);

  await p.$disconnect();
  console.log("DONE");
})();
