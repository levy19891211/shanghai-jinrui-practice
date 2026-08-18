// 一次性修复:将题库文本字段中未 LaTeX 化的 sqrt(...) 转换为 \sqrt{...}
// 仅做最小化改写,不强制给整个表达式加 $...$ 包裹,避免影响前端 smartMath 的判定习惯。
// 同时同步 answer,确保判分全等比对不失配。
// 运行: node apps/api/scripts/fix_sqrt_text.mjs
import "dotenv/config";
import { prisma } from "../src/lib/db.js";

// 仅把文本形式的 sqrt(...) 转成 \sqrt{...};支持嵌套,排除 \sqrt 本身和 rsqrt 等变量前缀
function fixSqrt(str) {
  if (!str || typeof str !== "string") return str;
  let prev;
  do {
    prev = str;
    str = str.replace(/(?<![a-zA-Z\\])sqrt\(([^()]+)\)/g, "\\sqrt{$1}");
  } while (str !== prev);
  return str;
}

function fixText(text) {
  if (!text || typeof text !== "string") return text;
  return fixSqrt(text);
}

async function main() {
  const questions = await prisma.question.findMany({
    select: { id: true, stem: true, options: true, answer: true, solution: true, source: true }
  });

  let updated = 0;
  let answerAligned = 0;
  const details = [];

  for (const q of questions) {
    let changed = false;
    const next = {
      stem: fixText(q.stem),
      solution: fixText(q.solution),
      answer: fixText(q.answer)
    };
    if (next.stem !== q.stem || next.solution !== q.solution || next.answer !== q.answer) {
      changed = true;
    }

    let options;
    try {
      options = JSON.parse(q.options || "[]");
    } catch {
      options = [];
    }
    const nextOptions = options.map((o) => fixText(String(o ?? "")));
    if (JSON.stringify(nextOptions) !== JSON.stringify(options)) {
      changed = true;
    }

    // 答案对齐:如果原 answer 是某个原始选项的文本,同步改为新选项文本
    let finalAnswer = next.answer;
    const oldIdx = options.findIndex((o) => String(o ?? "").trim() === String(q.answer ?? "").trim());
    if (oldIdx >= 0 && nextOptions[oldIdx] !== String(q.answer ?? "")) {
      finalAnswer = nextOptions[oldIdx];
      if (finalAnswer !== next.answer) {
        answerAligned++;
      }
    }

    if (changed) {
      await prisma.question.update({
        where: { id: q.id },
        data: {
          ...(next.stem !== q.stem ? { stem: next.stem } : {}),
          ...(next.solution !== q.solution ? { solution: next.solution } : {}),
          ...(JSON.stringify(nextOptions) !== JSON.stringify(options) ? { options: JSON.stringify(nextOptions) } : {}),
          ...(finalAnswer !== q.answer ? { answer: finalAnswer } : {})
        }
      });
      updated++;
      if (details.length < 10) {
        details.push({ id: q.id, source: q.source, options: { before: options, after: nextOptions }, answer: { before: q.answer, after: finalAnswer } });
      }
    }
  }

  console.log(`修复完成:更新 ${updated} 道题,对齐答案 ${answerAligned} 道`);
  for (const d of details) {
    console.log("\n---", d.id, d.source);
    console.log("options before:", JSON.stringify(d.options.before));
    console.log("options after :", JSON.stringify(d.options.after));
    console.log("answer before :", JSON.stringify(d.answer.before));
    console.log("answer after  :", JSON.stringify(d.answer.after));
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
