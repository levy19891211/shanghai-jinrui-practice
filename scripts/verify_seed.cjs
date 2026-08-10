const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
const HOUR = 3600 * 1000;
const now = Date.now();
(async () => {
  for (const sid of ["cmsn8blrh0008afb8hmtp1ymc", "cmsn8blxg0009afb8t79w72l1"]) {
    const u = await p.user.findUnique({ where: { id: sid }, select: { name: true } });
    const rows = await p.assignmentStudent.findMany({
      where: { studentId: sid },
      include: { assignment: { include: { paper: true, languagePaper: true } } },
    });
    let urgent = 0, subjPending = 0, langPending = 0, subjPast = 0, langPast = 0;
    for (const r of rows) {
      const a = r.assignment;
      const isLang = !!a.languagePaperId;
      const due = a.dueAt ? new Date(a.dueAt).getTime() : null;
      const isUrgent = due && due > now && due - now <= 24 * HOUR;
      if (r.status === "SUBMITTED") {
        if (isLang) langPast++; else subjPast++;
      } else if (isUrgent) {
        urgent++;
      } else if (isLang) {
        langPending++;
      } else {
        subjPending++;
      }
    }
    console.log(`\n【${u.name}】 紧急=${urgent} 笔试待完成=${subjPending} 语言待完成=${langPending} 笔试往期=${subjPast} 语言往期=${langPast} (合计 ${rows.length})`);
  }
  await p.$disconnect();
})();
