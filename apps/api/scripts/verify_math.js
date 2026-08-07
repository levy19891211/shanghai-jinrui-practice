// 全题库数学公式渲染回归验证
// 运行:npm run verify:math --workspace=apps/api
// 检测:① KaTeX 渲染错误(ERR,必须修) ② latexify 后残留未转换符号(WARN,提示)
// 注意:本文件的 latexify 必须与 apps/web/lib/rich.tsx 保持一致(同步修改)
import "dotenv/config";
import katex from "katex";
import { prisma } from "../src/lib/db.js";

// ===== 与前端 lib/rich.tsx 同步的 latexify =====
function latexify(s) {
  return s
    .replace(/√\(([^)]+)\)/g, "\\sqrt{$1}")
    .replace(/√([0-9a-zA-Z])/g, "\\sqrt{$1}")
    .replace(/log₁₀/g, "\\log_{10}")
    .replace(/log₂/g, "\\log_2")
    .replace(/log₃/g, "\\log_3")
    .replace(/([0-9]*(?:\\pi|\\theta|π|θ)?|[a-zA-Z])(?![a-zA-Z])\s*\/\s*([0-9]*(?:\\pi|\\theta|π|θ)?|[a-zA-Z])(?![a-zA-Z0-9])/g, "\\frac{$1}{$2}")
    .replace(/\(([^()]+)\)\s*\/\s*([0-9πθ][0-9πθ.]*)(?![a-zA-Z0-9])/g, "\\frac{$1}{$2}")
    .replace(/π/g, "\\pi")
    .replace(/θ/g, "\\theta")
    .replace(/²/g, "^{2}")
    .replace(/³/g, "^{3}")
    .replace(/⁴/g, "^{4}")
    .replace(/⁵/g, "^{5}")
    .replace(/⁶/g, "^{6}")
    .replace(/⁷/g, "^{7}")
    .replace(/⁸/g, "^{8}")
    .replace(/⁹/g, "^{9}")
    .replace(/⁰/g, "^{0}")
    .replace(/¹/g, "^{1}")
    .replace(/\^\(([^)]*)\)/g, "^{$1}")
    .replace(/\^([0-9a-zA-Z])/g, "^{$1}")
    .replace(/\^\{(\d)\}\^\{(\d)\}/g, "^{$1$2}")
    .replace(/\^\{(\d)\}(\d{2,})/g, "^{$1$2}")
    .replace(/×/g, "\\times")
    .replace(/·/g, "\\cdot")
    .replace(/≤/g, "\\le")
    .replace(/≥/g, "\\ge")
    .replace(/≈/g, "\\approx")
    .replace(/≠/g, "\\ne")
    .replace(/Σ/g, "\\sum")
    .replace(/∫/g, "\\int")
    .replace(/(?<![a-zA-Z])(log|sin|cos|tan|ln|sec|csc|cot|exp|sinh|cosh|tanh)(?=[^a-zA-Z₁₀₂₃]|$)/g, "\\$1")
    .replace(/([A-Za-z0-9][^()]*?)\s*\/\s*\(([^()]+)\)/g, "\\frac{$1}{$2}")
    .replace(/\(([^()]+)\)\s*\/\s*\(([^()]+)\)/g, "\\frac{$1}{$2}");
}

// 纯数学文本判定(与前端 isPureMath 一致)
const FUNC_NAMES = new Set(["log", "sin", "cos", "tan", "ln", "sec", "csc", "cot", "exp", "sqrt"]);
function isPureMath(s) {
  if (/[\u4e00-\u9fa5]/.test(s)) return false;
  const words = s.match(/[a-zA-Z]+/g) || [];
  for (const w of words) {
    if (w.length > 1 && !FUNC_NAMES.has(w.toLowerCase())) return false;
  }
  return true;
}

function isMathish(text) {
  return /[√πθΣ∫≤≥≈≠×÷±²³⁴⁵⁶⁷⁸⁹⁰¹^₁₀₂₃]/.test(text);
}

// 提取 $ 包裹的数学内容;无 $ 标记返回 null
function extractDollarMath(text) {
  const parts = [];
  const re = /\$\$([\s\S]+?)\$\$|\$([^\s$][^$]*)\$/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    parts.push(m[1] !== undefined ? m[1] : m[2]);
  }
  return parts.length ? parts : null;
}

function findLeftover(latex) {
  const issues = [];
  if (/(?<![\\])√/.test(latex)) issues.push("裸√未转\\sqrt");
  if (/[0-9a-zA-Z)]\s*\/\s*[(0-9a-zA-Z]/.test(latex.replace(/\\frac/g, ""))) issues.push("可能未转\\frac的/");
  if (/(?<![\\])[0-9a-zA-Z]\^(?!\{)/.test(latex)) issues.push("裸^未转上标");
  return issues;
}

async function main() {
  const questions = await prisma.question.findMany();
  let errCount = 0;
  let warnCount = 0;
  let checked = 0;

  for (const q of questions) {
    let options;
    try { options = JSON.parse(q.options || "[]"); } catch { options = []; }
    const fields = [["题干", q.stem || ""], ...options.map((o, i) => [`选项 ${String.fromCharCode(65 + i)}`, String(o)])];

    for (const [label, text] of fields) {
      const dollarMath = extractDollarMath(text);
      // 候选验证片段:$ 包裹的数学 + (非 $ 时)整段纯数学文本;英文题干只验 $ 片段
      const candidates = dollarMath !== null
        ? dollarMath
        : (isMathish(text) && isPureMath(text) ? [text] : []);
      for (const expr of candidates) {
        checked++;
        const latex = latexify(expr);
        let renderErr = null;
        try {
          katex.renderToString(latex, { throwOnError: true });
        } catch (e) {
          renderErr = String(e.message || e).split("\n")[0];
        }
        const leftover = findLeftover(latex);
        if (renderErr) {
          errCount++;
          console.log(`\n[ERR][${q.source || "未知来源"}] ${label} (题目 ${q.id.slice(0, 8)})`);
          console.log(`  原文: ${text.slice(0, 110)}`);
          console.log(`  KaTeX 错误: ${renderErr}`);
          console.log(`  latexify: ${latex.slice(0, 130)}`);
        } else if (leftover.length) {
          warnCount++;
          console.log(`[WARN][${q.source || "未知来源"}] ${label} (题目 ${q.id.slice(0, 8)})`);
          console.log(`  原文: ${text.slice(0, 90)}`);
          console.log(`  残留: ${leftover.join("; ")}`);
          console.log(`  latexify: ${latex.slice(0, 110)}`);
        }
      }
    }
  }

  console.log(`\n========== 扫描完成 ==========`);
  console.log(`题库 ${questions.length} 题,验证数学片段 ${checked} 个:ERR ${errCount} 处, WARN ${warnCount} 处`);
  await prisma.$disconnect();
  process.exit(errCount > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
