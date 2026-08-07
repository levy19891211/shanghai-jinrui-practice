// 一次性修复:用重新清洗过的 scripts/data/tmua2016.js 覆盖库中已发布的 2016 题目字段。
// 用于补齐 extract_tmua2016.js 接入共享清洗器(sanitize.js)后,对残留 <span>/<table>/<ul> 的修复。
// 仅更新 stem / options / answer / solution;主题/难度等保持不变。
import "dotenv/config";
import { prisma } from "../src/lib/db.js";
import questions from "./data/tmua2016.js";

const SOURCE = "TMUA 2016 Paper 1";

async function main() {
  const existing = await prisma.question.findMany({
    where: { source: SOURCE },
    orderBy: { createdAt: "asc" },
  });
  if (existing.length !== questions.length) {
    console.log(`[warn] 库中 ${existing.length} 道 vs 数据 ${questions.length} 道,按索引覆盖(前 ${Math.min(existing.length, questions.length)} 道)`);
  }
  const n = Math.min(existing.length, questions.length);
  for (let i = 0; i < n; i++) {
    const q = questions[i];
    await prisma.question.update({
      where: { id: existing[i].id },
      data: {
        stem: q.stem,
        options: JSON.stringify(q.options),
        answer: q.answer,
        solution: q.solution,
      },
    });
  }
  console.log(`[ok] 已更新 ${n} 道 ${SOURCE} 的 stem/options/answer/solution`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
