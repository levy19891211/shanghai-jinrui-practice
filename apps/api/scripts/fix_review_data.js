// 部署后数据修正(幂等,可重复运行):
//  1) 用清洗后的 scripts/data/tmua2016.js 覆盖已发布的 2016 题目字段
//     (修复 extract_tmua2016.js 接入共享清洗器之前残留的 <span>/<table>/<ul> 裸标签)
//  2) 修正 2 道 Specimen 2017 Paper 1 题目:answer 用 / 除法书写,而选项用 \frac,
//     导致前端 opt===answer 永远不匹配(判分必错)。改为与选项 E 文本完全一致。
import "dotenv/config";
import { prisma } from "../src/lib/db.js";
import questions from "./data/tmua2016.js";

const SOURCE_2016 = "TMUA 2016 Paper 1";

// Specimen 2017 Paper 1 中 answer 与选项文本不一致的题目(按 id 后缀定位,改为正确选项文本)
const SPECIMEN_FIXES = [
  { idEnds: "g4jicz", ansIdx: 4 }, // 指数与对数 → 选项 E
  { idEnds: "0bdctp", ansIdx: 4 }, // 指数方程 → 选项 E
];

async function main() {
  // —— 1) 2016 清洗覆盖 ——
  const existing = await prisma.question.findMany({
    where: { source: SOURCE_2016 },
    orderBy: { createdAt: "asc" },
  });
  const n = Math.min(existing.length, questions.length);
  for (let i = 0; i < n; i++) {
    const q = questions[i];
    await prisma.question.update({
      where: { id: existing[i].id },
      data: { stem: q.stem, options: JSON.stringify(q.options), answer: q.answer, solution: q.solution },
    });
  }
  console.log(`[ok] 已覆盖 ${n} 道 ${SOURCE_2016} 的 stem/options/answer/solution`);

  // —— 2) Specimen answer 修正 ——
  const all = await prisma.question.findMany({});
  for (const f of SPECIMEN_FIXES) {
    const q = all.find((r) => r.id.endsWith(f.idEnds));
    if (!q) { console.log("未找到", f.idEnds); continue; }
    const opts = JSON.parse(q.options);
    const correct = opts[f.ansIdx];
    if (q.answer.trim() === correct.trim()) { console.log(q.id.slice(-6), "已一致,跳过"); continue; }
    await prisma.question.update({ where: { id: q.id }, data: { answer: correct } });
    console.log(`[ok] ${q.id.slice(-6)} (${q.topic}) answer → 选项 ${String.fromCharCode(65 + f.ansIdx)}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
