// recover_frac.js — 一次性修复之前破坏写入的 \frac{a}/{b} 形态(支持嵌套花括号)
import "dotenv/config";
import { prisma } from "../src/lib/db.js";

// 匹配 \frac{a}/{b} 中 a 允许嵌套一对花括号(支持 \log_{10})
const fixFrac = (s) => s.replace(/\\frac\{((?:[^{}]|\{[^}]*\})*)\}\/\{/g, "\\frac{$1}{");

async function main() {
  const qs = await prisma.question.findMany();
  let n = 0;
  for (const q of qs) {
    const newStem = fixFrac(q.stem || "");
    let newOptions = q.options;
    try {
      const arr = JSON.parse(q.options);
      const next = arr.map(fixFrac);
      if (JSON.stringify(next) !== JSON.stringify(arr)) newOptions = JSON.stringify(next);
    } catch {}
    if (newStem !== (q.stem || "") || newOptions !== q.options) {
      await prisma.question.update({ where: { id: q.id }, data: { stem: newStem, options: newOptions } });
      n++;
    }
  }
  console.log(`已修复 ${n} 道题(\\frac{a}/{b} → \\frac{a}{b},支持嵌套)`);
  await prisma.$disconnect();
}
main();
