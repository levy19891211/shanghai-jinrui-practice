const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const papers = await p.paper.findMany({
    select: { id: true, title: true, subject: true, sourceType: true, mode: true, status: true, questionIds: true },
  });
  const lps = await p.languagePaper.findMany({
    select: { id: true, title: true, examType: true, skill: true, mode: true, status: true, questionIds: true },
  });
  const teachers = await p.user.findMany({
    where: { role: { in: ["TEACHER", "ADMIN"] } },
    select: { id: true, email: true, name: true, role: true },
  });
  console.log("PAPER_COUNT:", papers.length);
  console.log(JSON.stringify(papers.slice(0, 12), null, 2));
  console.log("LANGPAPER_COUNT:", lps.length);
  console.log(JSON.stringify(lps.slice(0, 12), null, 2));
  console.log("TEACHERS:", JSON.stringify(teachers, null, 2));
  await p.$disconnect();
})();
