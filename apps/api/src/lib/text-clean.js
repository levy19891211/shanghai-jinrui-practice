// 共享文本清洗:把五花八门的原始题目文本,统一成 docs/QUESTION_FORMAT.md 的规范格式。
// 原先只在 scripts/adapters 下被离线脚本使用,现下沉到 src/lib,让 API 运行时(一键修正)也能复用同一套规则,
// 避免「脚本清洗过的题」和「接口修正过的题」出现两套标准。
// scripts/adapters/{latexify,sanitize}.js 现为本文件的再导出壳,历史脚本无需改动。

// 把常见非 LaTeX 数学记号转成 KaTeX 语法。
// 顺序敏感:简单分数必须在 π→\pi 之前处理,否则 \pi 的 i 会被误当变量。
export function latexify(s) {
  return s
    .replace(/√\(([^)]+)\)/g, "\\sqrt{$1}")
    .replace(/√([0-9a-zA-Z])/g, "\\sqrt{$1}")
    .replace(/log₁₀/g, "\\log_{10}")
    .replace(/log₂/g, "\\log_2")
    .replace(/log₃/g, "\\log_3")
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
    .replace(/·/g, "\\cdot ")
    .replace(/≤/g, "\\le")
    .replace(/≥/g, "\\ge")
    .replace(/≈/g, "\\approx")
    .replace(/≠/g, "\\ne")
    .replace(/Σ/g, "\\sum")
    .replace(/∫/g, "\\int")
    .replace(/(?<![a-zA-Z])(log|sin|cos|tan|ln|sec|csc|cot|exp|sinh|cosh|tanh)(?=[^a-zA-Z₁₀₂₃]|$)/g, "\\$1");
}

// 把一份可能含 HTML 与 \( \) 的文本,转成规范富文本(含 $...$ 公式)
// 关键点:
//  - 数学:`\(...\)` → `$...$`,`\[...\]` → `$$...$$`,并用 latexify 把 √/π/²/≤ 等转成 LaTeX
//  - HTML:白名单剥离,已知标签先转成可读文本,其余标签整体删除
//  - 不等式 < > 当作文本保留,绝不用全局 <[^>]+> 直接删除(那会误删数学符号)
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
