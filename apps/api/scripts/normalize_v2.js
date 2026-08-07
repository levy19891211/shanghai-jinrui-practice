// normalize_v2.js — 修复已 $...$ 包裹的数学片段:把"显然的" / 转 \frac
// KaTeX 默认会把数学模式下的 / 当视觉分数线,渲染时把公式错误堆叠
// 关键:只转"两边都是简单表达式"的 /,否则保留(可能是等式右侧等)
import "dotenv/config";
import { prisma } from "../src/lib/db.js";

const SAFE_SLASH = "\x01";

// 判断 expr 是否是"简单 token"(适合作为分子/分母的完整表达式)
// 简单 = 不含 等号 = 加减号 + - * \\(等分隔
// 含 上下标 _ ^ 允许
function isSimpleExpr(s) {
  if (!s) return false;
  // 不允许 = + - * \\(<命令>) 等
  if (/[=+\-*]/.test(s)) return false;
  // 不能跨过 LaTeX 命令边界(以 $ 截止也算)
  if (/\$/.test(s)) return false;
  // 允许的字符:数字/字母/小数点/空格/上下标符号/花括号
  return /^[\s0-9.a-zA-Z_^{}\\]*$/.test(s);
}

// 提取"显然完整"的 token:从右往左,直到遇到非法字符
// 用于检测 A 是否太复杂
function safeTrimLeftA(text, slashPos) {
  // 从 slashPos 往左,跳过空白
  let s = slashPos;
  while (s > 0 && /\s/.test(text[s - 1])) s--;
  // 简单 token:数字 / 字母(连续)/ 闭合组 / \\command 名
  let e = s;
  while (e > 0) {
    const c = text[e - 1];
    if (/[0-9]/.test(c)) {
      e--;
      while (e > 0 && /[0-9.]/.test(text[e - 1])) e--;
      return { val: text.slice(e, s), start: e };
    }
    if (/[a-zA-Z]/.test(c)) {
      e--;
      while (e > 0 && /[a-zA-Z]/.test(text[e - 1])) e--;
      // 检查前面是不是 \ 命令
      if (e > 0 && text[e - 1] === "\\") {
        e--;
        return { val: text.slice(e, s), start: e };
      }
      return { val: text.slice(e, s), start: e };
    }
    if (c === "}") {
      // 找到匹配的 {
      let depth = 1, p = e - 2;
      while (p >= 0 && depth > 0) {
        if (text[p] === "}") depth++;
        if (text[p] === "{") depth--;
        if (depth === 0) break;
        p--;
      }
      // p 指向 {
      return { val: text.slice(p, s), start: p };
    }
    // 其它都算复杂(=/+/-/*)
    return null;
  }
  return null;
}

function safeTrimRightB(text, slashPos) {
  let e = slashPos + 1;
  while (e < text.length && /\s/.test(text[e])) e++;
  let s = e;
  if (e >= text.length) return null;
  const c = text[e];
  if (/[0-9.]/.test(c)) {
    while (s < text.length && /[0-9.]/.test(text[s])) s++;
    return { val: text.slice(e, s), end: s };
  }
  if (c === "\\" && s + 1 < text.length && /[a-zA-Z]/.test(text[s + 1])) {
    s += 2;
    while (s < text.length && /[a-zA-Z]/.test(text[s])) s++;
    // 后续上下标
    while (s < text.length && (text[s] === "_" || text[s] === "^")) {
      s++;
      if (s < text.length && text[s] === "{") {
        let depth = 1, p = s + 1;
        while (p < text.length && depth > 0) { if (text[p] === "{") depth++; if (text[p] === "}") depth--; p++; }
        s = p;
      } else if (s < text.length) s++;
    }
    return { val: text.slice(e, s), end: s };
  }
  if (/[a-zA-Z]/.test(c)) {
    while (s < text.length && /[a-zA-Z]/.test(text[s])) s++;
    return { val: text.slice(e, s), end: s };
  }
  if (c === "(") {
    let depth = 1, p = e + 1;
    while (p < text.length && depth > 0) { if (text[p] === "(") depth++; if (text[p] === ")") depth--; p++; }
    // 含 ^ _
    while (p < text.length && (text[p] === "_" || text[p] === "^")) {
      p++;
      if (p < text.length && text[p] === "{") {
        let depth = 1, q = p + 1;
        while (q < text.length && depth > 0) { if (text[q] === "{") depth++; if (text[q] === "}") depth--; q++; }
        p = q;
      } else if (p < text.length) p++;
    }
    return { val: text.slice(e, p), end: p };
  }
  return null;
}

function fixInnerMath(s) {
  if (!s) return s;
  return s.replace(/\$([^$]+)\$/g, (_, expr) => {
    // 处理已存在 \frac{}{} 等命令内的 / 不拆分(占位符保护)
    let masked = expr.replace(/\\([a-zA-Z]+)\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g,
      (m, cmd, a, b) => "\\" + cmd + "{" + a + "}" + SAFE_SLASH + "{" + b + "}");

    let out = "";
    let i = 0;
    while (i < masked.length) {
      if (masked[i] === "/") {
        const A = safeTrimLeftA(masked, i);
        const B = safeTrimRightB(masked, i);
        if (A && B && isSimpleExpr(A.val) && isSimpleExpr(B.val)) {
          out += "\\frac{" + A.val.trim() + "}{" + B.val.trim() + "}";
          i = B.end;
          continue;
        }
      }
      out += masked[i];
      i++;
    }
    // 还原 SAFE_SLASH
    out = out.replace(new RegExp(SAFE_SLASH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "g"), "");
    return "$" + out + "$";
  });
}

async function main() {
  const qs = await prisma.question.findMany();
  let updated = 0;
  let changes = 0;
  for (const q of qs) {
    const newStem = fixInnerMath(q.stem || "");
    let newOptions = q.options;
    try {
      const arr = JSON.parse(q.options);
      const next = arr.map((o) => fixInnerMath(o));
      if (JSON.stringify(next) !== JSON.stringify(arr)) {
        for (let i = 0; i < next.length; i++) {
          if (next[i] !== arr[i]) {
            console.log("  [diff]", q.id.slice(-8), "opt", i, ":", arr[i].slice(0, 50), "→", next[i].slice(0, 70));
            changes++;
          }
        }
        newOptions = JSON.stringify(next);
      }
    } catch {}
    if (newStem !== (q.stem || "") || newOptions !== q.options) {
      await prisma.question.update({ where: { id: q.id }, data: { stem: newStem, options: newOptions } });
      updated++;
    }
  }
  console.log(`\n共修改 ${updated} 道题(${changes} 处差异)`);
  await prisma.$disconnect();
}
main();
