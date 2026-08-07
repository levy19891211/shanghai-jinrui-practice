// 共享清洗工具:把五花八门的原始题目文本,统一成 docs/QUESTION_FORMAT.md 的规范格式。
// 关键点:
//  - 数学:`\(...\)` → `$...$`,`\[...\]` → `$$...$$`,并用 latexify 把 √/π/²/≤ 等转成 LaTeX
//  - HTML:白名单剥离,只保留 <b>/<i>/<sub>/<sup>/<br>,其余标签整体删除
//  - 不等式 < > 当作文本保留,绝不用全局 <[^>]+> 删除(那会误删数学符号,正是之前的 Q13 bug)
import { latexify } from "./latexify.js";

// 把一份可能含 HTML 与 \( \) 的文本,转成规范富文本(含 $...$ 公式)
export function toCanonicalText(raw = "") {
  if (!raw) return "";
  let s = String(raw);

  // 1) 白名单处理已知标签(先转成可读文本,避免被后续整体剥离误伤或丢失内容)
  s = s
    .replace(/<b>/gi, "**").replace(/<\/b>/gi, "**")
    .replace(/<strong>/gi, "**").replace(/<\/strong>/gi, "**")
    .replace(/<i>/gi, "*").replace(/<\/i>/gi, "*")
    .replace(/<em>/gi, "*").replace(/<\/em>/gi, "*")
    .replace(/<sub>/gi, "_{").replace(/<\/sub>/gi, "}")
    .replace(/<sup>/gi, "^{").replace(/<\/sup>/gi, "}")
    // 表格 → 可读文本(行间换行、单元格用 | 分隔,避免内容粘连)
    .replace(/<tr\s*\/?>/gi, "\n").replace(/<\/tr>/gi, "")
    .replace(/<t[hd]\s*\/?>/gi, " | ").replace(/<\/t[hd]>/gi, "")
    .replace(/<ul\s*\/?>/gi, "\n").replace(/<ol\s*\/?>/gi, "\n")
    .replace(/<\/ul>/gi, "").replace(/<\/ol>/gi, "")
    .replace(/<li\s*\/?>/gi, "\n- ").replace(/<\/li>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n").replace(/<p>/gi, "")
    .replace(/<\/div>/gi, "\n").replace(/<div>/gi, "")
    .replace(/<span[^>]*>/gi, "").replace(/<\/span>/gi, "");

  // 2) 删除其余所有 HTML 标签(此时 < > 仅剩真正的不等式等文本符号)
  s = s.replace(/<[^>]+>/g, "");

  // 3) 换行规范化
  s = s.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  // 4) 数学定界符归一化
  s = s
    .replace(/\\\[/g, "$$")
    .replace(/\\\]/g, "$$")
    .replace(/\\\(/g, "$")
    .replace(/\\\)/g, "$");

  // 5) LaTeX 化(√/π/²/≤ 等)
  s = latexify(s);

  return s;
}

// 适配一个原始题目对象 → 规范题目对象
// raw: { topic, stem, options:[{letter,text}|string], answer(letter|text), explanation|solution, ... }
// 返回: { topic, stem, options:string[], answer:string, solution:string }
export function toCanonical(raw, { answerByLetter = false } = {}) {
  const stem = toCanonicalText(raw.stem);
  let options = Array.isArray(raw.options)
    ? raw.options.map((o) => (typeof o === "string" ? toCanonicalText(o) : toCanonicalText(o.text ?? o)))
    : [];
  options = options.filter((o) => o && o.trim());

  let answer = raw.answer;
  if (answerByLetter && /^[A-Za-z]$/.test(String(answer))) {
    const idx = answer.toUpperCase().charCodeAt(0) - 65;
    answer = options[idx] ?? answer;
  }
  answer = typeof answer === "string" ? answer.trim() : answer;

  const solution = toCanonicalText(raw.explanation ?? raw.solution ?? "");

  return { topic: raw.topic, stem, options, answer, solution };
}
