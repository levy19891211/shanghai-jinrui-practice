const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
const paperId = process.argv[2];
(async () => {
  const paper = await p.paper.findUnique({ where: { id: paperId } });
  if (!paper) { console.log("PAPER NOT FOUND:", paperId); await p.$disconnect(); return; }
  console.log("title:", paper.title);
  console.log("status:", paper.status);
  console.log("origin:", paper.origin);
  console.log("sourceKey:", paper.sourceKey);
  console.log("kind:", paper.kind, "sourceType:", paper.sourceType);
  const qIds = JSON.parse(paper.questionIds || "[]");
  console.log("qcount:", qIds.length);
  const qs = await p.question.findMany({ where: { id: { in: qIds } } });
  let bad = 0, noAnswer = 0;
  for (const q of qs) {
    let opts;
    try { opts = JSON.parse(q.options || "[]"); } catch (e) { opts = []; }
    const ans = q.answer;
    if (!ans || ans === "null" || ans === "") { noAnswer++; console.log("EMPTY-ANSWER:", q.id); continue; }
    const ok = Array.isArray(opts) ? opts.map(String).includes(String(ans)) : false;
    if (!ok) { bad++; console.log("ANS-NOT-IN-OPTIONS:", q.id, "ans=", JSON.stringify(ans).slice(0,50)); }
  }
  console.log("answerCheckFail:", bad, "emptyAnswer:", noAnswer);
  console.log("teacherVisible:", paper.status === "READY" && paper.origin !== "STUDENT");
  await p.$disconnect();
})();
