const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const paper = await p.paper.findUnique({
    where: { id: "cmt6hoxis000k4k2eur8skhz2" },
  });
  console.log("title:", paper.title);
  console.log("status:", paper.status);
  console.log("origin:", paper.origin);
  console.log("sourceKey:", paper.sourceKey);
  const qIds = JSON.parse(paper.questionIds || "[]");
  console.log("qcount:", qIds.length);
  const qs = await p.question.findMany({ where: { id: { in: qIds } } });
  let bad = 0, noAnswer = 0;
  for (const q of qs) {
    let opts;
    try { opts = JSON.parse(q.options || "[]"); } catch (e) { opts = []; }
    // answer stored as raw string; options are strings -> compare as strings
    const ans = q.answer;
    if (!ans || ans === "null" || ans === ""){ noAnswer++; continue; }
    const ok = Array.isArray(opts) ? opts.map(String).includes(String(ans)) : false;
    if (!ok) { bad++; console.log("ANS-NOT-IN-OPTIONS:", q.id, "ans=", JSON.stringify(ans)); }
  }
  console.log("answerCheckFail:", bad, "emptyAnswer:", noAnswer);
  console.log("teacherVisible:", paper.status === "READY" && paper.origin !== "STUDENT");
  await p.$disconnect();
})();
