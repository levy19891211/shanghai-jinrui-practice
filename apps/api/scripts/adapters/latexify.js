// JS 版 latexify:把常见非 LaTeX 数学记号转成 KaTeX 语法。
// 顺序敏感:简单分数必须在 π→\pi 之前处理,否则 \pi 的 i 会被误当变量。
// 这是 docs/QUESTION_FORMAT.md 第 2 节「自动清洗」的一部分。
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
