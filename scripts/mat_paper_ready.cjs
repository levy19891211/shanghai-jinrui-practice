const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const id = "cmsnb84os007rbicchfus4uyn"; // MAT 2007-2023
  const paper = await p.paper.findUnique({ where: { id } });
  if (!paper) { console.log("试卷不存在"); await p.$disconnect(); return; }
  console.log(`更新前: ${paper.title} status=${paper.status}`);
  // 校验卷内题目是否都已发布,避免把还有待审核题的卷误开放
  let ids = [];
  try { ids = JSON.parse(paper.questionIds || "[]"); } catch {}
  const pending = await p.question.count({ where: { id: { in: ids }, status: "PENDING_REVIEW" } });
  const published = await p.question.count({ where: { id: { in: ids }, status: "PUBLISHED" } });
  console.log(`卷内题目: 总数=${ids.length} 已发布=${published} 待审核=${pending}`);
  if (pending > 0) {
    console.log(`仍有 ${pending} 道待审核题,不开放,请先审核完成。`);
    await p.$disconnect();
    return;
  }
  await p.paper.update({ where: { id }, data: { status: "READY" } });
  console.log(`更新后: status=READY (可作答)`);
  await p.$disconnect();
})();
