import React from "react";
import katex from "katex";

// 富文本渲染:
// - ![alt](url)  图片
// - $$...$$      块级公式(KaTeX)
// - $...$        行内公式(KaTeX)
// 其余按文本展示。用于题干与选项。

const TOKEN_RE = /!\[([^\]]*)\]\(([^)]+)\)|\$\$([\s\S]+?)\$\$|\$([^\s$][^$]*)\$/g;

function renderMathExpr(expr: string, displayMode: boolean): string {
  try {
    return katex.renderToString(expr, { throwOnError: false, displayMode });
  } catch {
    return expr;
  }
}

interface Token {
  type: "text" | "img" | "math";
  text?: string;
  alt?: string;
  src?: string;
  expr?: string;
  display?: boolean;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (m.index > last) tokens.push({ type: "text", text: text.slice(last, m.index) });
    if (m[1] !== undefined && m[2] !== undefined) {
      tokens.push({ type: "img", alt: m[1], src: m[2] });
    } else if (m[3] !== undefined) {
      tokens.push({ type: "math", expr: m[3], display: true });
    } else {
      tokens.push({ type: "math", expr: m[4], display: false });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) tokens.push({ type: "text", text: text.slice(last) });
  return tokens;
}

export function renderRich(text: string | null | undefined): React.ReactNode[] {
  if (!text) return [];
  let key = 0;
  return tokenize(text).map((t) => {
    switch (t.type) {
      case "img":
        return (
          <img
            key={key++}
            src={t.src}
            alt={t.alt || "题目图片"}
            className="mt-2 inline-block max-h-56 max-w-full rounded-lg border border-slate-200 bg-white"
          />
        );
      case "math":
        return (
          <span
            key={key++}
            className={t.display ? "my-2 block overflow-x-auto" : "mx-0.5 inline-block align-middle"}
            dangerouslySetInnerHTML={{ __html: renderMathExpr(t.expr!, t.display!) }}
          />
        );
      default:
        return <span key={key++}>{t.text}</span>;
    }
  });
}

// 纯文本版本(用于截断展示):去掉图片与公式标记
export function plainText(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(TOKEN_RE, (all, alt, src, block, inline) => {
      if (src) return " [图片] ";
      return "";
    })
    .trim();
}

// 将常见非 LaTeX 数学记号转换为 KaTeX 语法(供批量录入使用)
export function latexify(s: string): string {
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
    .replace(/×/g, "\\times")
    .replace(/·/g, "\\cdot")
    .replace(/≤/g, "\\le")
    .replace(/≥/g, "\\ge")
    .replace(/≈/g, "\\approx")
    .replace(/≠/g, "\\ne")
    .replace(/Σ/g, "\\sum")
    .replace(/∫/g, "\\int");
}

// 判断是否为"纯数学"文本(适合整体用 $ 包裹渲染)
const FUNC_NAMES = new Set(["log", "sin", "cos", "tan", "ln", "sec", "csc", "cot", "exp", "sqrt"]);
export function isPureMath(s: string): boolean {
  if (/[\u4e00-\u9fa5]/.test(s)) return false;
  const words = s.match(/[a-zA-Z]+/g) || [];
  for (const w of words) {
    if (w.length > 1 && !FUNC_NAMES.has(w.toLowerCase())) return false;
  }
  return true;
}
