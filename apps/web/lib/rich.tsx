import React from "react";
import katex from "katex";

// 富文本渲染:
// - ![alt](url)  图片
// - $$...$$      块级公式(KaTeX)
// - $...$        行内公式(KaTeX)
// 其余按文本展示。用于题干与选项。

// 行内公式允许 $ 后紧跟空白(如 "$ f(x) $",常见于模型/录入数据),只要内容非空且不成对 $ 就不算
const TOKEN_RE = /!\[([^\]]*)\]\(([^)]+)\)|\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderMathExpr(expr: string, displayMode: boolean): string {
  try {
    const html = katex.renderToString(expr, { throwOnError: false, displayMode });
    // KaTeX 渲染失败时返回的 HTML 含 katex-error(红框),此时退回显示原文,避免刺眼报错
    return html.includes("katex-error") ? escapeHtml(expr) : html;
  } catch {
    return escapeHtml(expr);
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
            className={t.display ? "my-2 block overflow-x-auto" : "math-inline align-baseline inline-block whitespace-nowrap"}
            dangerouslySetInnerHTML={{ __html: renderMathExpr(latexify(t.expr!), t.display!) }}
          />
        );
      default:
        // 普通文本:智能识别其中的数学片段并渲染为公式
        return <span key={key++}>{smartMath(t.text!)}</span>;
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
// 注意执行顺序:简单分数(π/4 等)必须在 π→\pi 之前处理,否则 \pi 中的 i 会被误当变量
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
    // 合并被拆分的上标数字(如 sin^{1}^{0} → sin^{10},(1/2)^{1}00 → (1/2)^{100})
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
    // 连续 Unicode 上标/下标 → 单个 LaTeX 上标/下标
    // 关键:先整体合并,避免 ⁻¹ 被后续单字符转换拆成 ⁻^{1}(Double superscript 报错)
    .replace(/([⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g, (m) =>
      "^{" + m.split("").map((c) => ({ "⁻": "-", "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" })[c] || c).join("") + "}"
    )
    .replace(/([₀₁₂₃₄₅₆₇₈₉]+)/g, (m) =>
      "_{" + m.split("").map((c) => ({ "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9" })[c] || c).join("") + "}"
    )
    // 函数名 → LaTeX 命令(如 sin → \sin、3cos → 3\cos;前面不能是字母或已有反斜杠,避免 \log 变成 \\log)
    .replace(/(?<![a-zA-Z\\])(log|sin|cos|tan|ln|sec|csc|cot|exp|sinh|cosh|tanh)(?=[^a-zA-Z₁₀₂₃]|$)/g, "\\$1")
    // 简单分数:数字/π/θ/单变量的 A/B(如 3π/4、1/2、x/y、5650/79.5;分母至少 1 字符)
    // 此时 π/上标已转(\pi、^{3} 形式);单字母变量前后不能是字母(避免 \pi 的 i 被误当变量)
    .replace(/([0-9]*(?:\\pi|\\theta|π|θ)?|[a-zA-Z])(?![a-zA-Z])\s*\/\s*([0-9]+(?:\\pi|\\theta|π|θ)?|[a-zA-Z])(?![a-zA-Z0-9])/g, "\\frac{$1}{$2}")
    // 括号分子/数字分母:(\sqrt{5} − 1)/2 → \frac{\sqrt{5} − 1}{2}
    .replace(/\(([^()]+)\)\s*\/\s*([0-9]+(?:\\pi|\\theta|π|θ)?)(?![a-zA-Z0-9])/g, "\\frac{$1}{$2}")
    // 括号分数:A/(B) 或 (A)/(B) → \frac{A}{B}(容忍空格,如 "2 / (a + 2b)")
    // A 前不能是 ^ 或 {(避免把 ^{2} 的上标数字当分子)
    .replace(/(?<![\^{])([A-Za-z0-9][^()]*?)\s*\/\s*\(([^()]+)\)/g, "\\frac{$1}{$2}")
    .replace(/\(([^()]+)\)\s*\/\s*\(([^()]+)\)/g, "\\frac{$1}{$2}");
}

// ===== 智能数学识别:将文本中的数学片段自动渲染为公式 =====

// 运算符 / 数字 / 单字母变量 / 函数名
// 注意:字符类中的连字符需用 \- 转义或放末尾,避免被解析为范围
const OP_TOKEN = /^[+\-*/=<>≤≥≈≠×÷±()−]$/;
const NUM_TOKEN = /^[\-−]?\d+([.,]\d+)?%?$/;
const VAR_TOKEN = /^[a-zA-Z]$/;
const FUNC_TOKEN = /^(log|log₁₀|log₂|log₃|sin|cos|tan|ln|sec|csc|cot|exp|sqrt|sinh|cosh|tanh)$/;
// 含数学符号的 token(Unicode 上下标 ⁻¹²³ 等排除:它们是单位/化学式文本,如 mol⁻¹、cm³,不应按数学渲染)
const MATHY_TOKEN = /[√πθΣ∫≤≥≈≠×÷±^]/;
// 纯小写英文单词(长度≥2 且非函数名) → 文本(避免 sum/Given/it 等英文单词误判;单字母 x/y 由 VAR 处理)
const PURE_WORD = /^[a-z]{2,}$/;
// 数字/数学符号开头的紧凑表达式(如 3x^2、10^(-y)、2π、5650/79.5、−log₁₀(1)
// 开头类不含 ASCII 连字符/加号/方括号:它们多是英文标点("-coordinate"),负号由 OP_TOKEN 单独处理,避免整个英文词被误判斜体(#15)
// 内部 Unicode 上下标排除:`AgNO₃` 等化学式/单位含 ₀₁₂₃ 不应被判数学(单位/化学式按正文字体显示)
const MIXED_NUM = /^[0-9√πθ(−][a-zA-Z0-9√πθ−^(){}[\]/.,]*$/;
// 字母开头,内部必须含数学特征(数字/^/()/减号等)(如 x^2、x、(c+1)²、)
// 注意:句号/逗号(英文标点)不是数学特征,否则 "radius."、"Thus," 会被误判为数学渲染成斜体(#15)
// Unicode 上下标 ₀₁₂₃⁰¹²³ 也不是数学特征(`AgNO₃` 应作文本)
const MIXED_LET = /^[a-zA-Z][a-zA-Z0-9√πθ−^(){}[\]/.,]*[0-9^√πθ()\[\]/−][a-zA-Z0-9√πθ−^(){}[\]/.,]*$/;
function isMixedMath(token: string): boolean {
  return MIXED_NUM.test(token) || MIXED_LET.test(token);
}

// 含 Unicode 上下标的 token 一律当文本:化学式(AgNO₃)、单位(mol⁻¹、cm³)等
// 不应进入 KaTeX 数学模式(否则字母变斜体、显示为数学字体)。见 #16。
const HAS_UNI_SUP_SUB = /[⁰¹²³⁴⁵⁶⁷⁸⁹⁻₀₁₂₃₄₅₆₇₈⁹]/;

export function isMathToken(token: string): boolean {
  if (HAS_UNI_SUP_SUB.test(token)) return false;
  // 纯小写英文用 / 连接的组合(如 is/are、and/or、either/or)→ 一律文本
  if (/^[a-z]+(\/[a-z]+)+$/.test(token)) return false;
  // 括号内全小写≥2字母(化学状态如 (aq)/(gas)) 或纯罗马数字((II)/(III)/(IV))→ 文本
  // 见 #18(NaCl(aq)、copper(II) 等化学式中括号被当 OP 带进数学模式)
  if (/^\(([a-z]{2,}|[IVX]+)\)$/i.test(token)) return false;
  // 裸 LaTeX 命令(如 \log、\sin、\frac、\sqrt,没有 $ 包裹)也必须按数学渲染,否则会露出反斜杠
  if (/\\[a-zA-Z]+/.test(token)) return true;
  // 纯小写英文单词(非函数名)直接判文本;单字母变量由 VAR 处理
  if (PURE_WORD.test(token) && !FUNC_TOKEN.test(token)) return false;
  if (OP_TOKEN.test(token) || NUM_TOKEN.test(token) || FUNC_TOKEN.test(token)) return true;
  // 单字母变量(a/A/i/I 是英文冠词/代词,不当作数学)
  if (VAR_TOKEN.test(token) && !["a", "A", "i", "I"].includes(token)) return true;
  if (MATHY_TOKEN.test(token)) return true;
  if (isMixedMath(token)) return true;
  return false;
}

// 将文本按"数学片段 / 纯文本片段"切分,数学片段用 KaTeX 渲染
// 关键:每次 flushMath 后追加一个 " " 文本节点,避免 KaTeX 吞掉尾部空格导致与后续文本挤在一起(0differ)
export function smartMath(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const tokens = text.split(/(\s+)/);
  let mathBuf: string[] = [];
  let textBuf: string[] = [];
  let key = 0;

  const flushMath = () => {
    if (mathBuf.length) {
      const expr = latexify(mathBuf.join(" "));
      parts.push(
        <span key={key++} className="math-inline align-baseline" dangerouslySetInnerHTML={{ __html: renderMathExpr(expr, false) }} />
      );
      // KaTeX 数学模式忽略尾部空格,显式补一个视觉间隔
      parts.push(<span key={key++}> </span>);
      mathBuf = [];
    }
  };
  const flushText = () => {
    if (textBuf.length) {
      parts.push(<span key={key++}>{textBuf.join("")}</span>);
      textBuf = [];
    }
  };

  for (const t of tokens) {
    if (t.trim() === "") {
      (mathBuf.length ? mathBuf : textBuf).push(t);
      continue;
    }
    if (isMathToken(t.trim())) {
      flushText();
      mathBuf.push(t);
    } else {
      flushMath();
      textBuf.push(t);
    }
  }
  flushMath();
  flushText();
  return parts;
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
