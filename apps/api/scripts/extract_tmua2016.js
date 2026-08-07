// 一次性提取脚本(ESM):从 TMUA-2016-Paper-1-Interactive.html 抽取题目,
// 在【文件文本层】做转换(必须在 eval 之前,否则 ESM 严格模式下 \( 非法转义会报错):
//   \(...\)  -> $...$        (行内数学)
//   \[...\]  -> $$...$$      (块级数学)
//   去掉 <p>/<div>/<br>/<b> 等 HTML 标签(用数学换行分段)
// 生成 scripts/data/tmua2016.js(export default 干净题目数组),供 seed_tmua2016.js 部署使用。
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { toCanonicalText } from "./adapters/sanitize.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = process.argv[2] || "/Users/levi/Downloads/TMUA-2016-Paper-1-Interactive.html";
const DATA_FILE = path.join(__dirname, "data", "tmua2016.js");

// 在原始文本层面转换:此时反斜杠还在,可正确识别 \( \) 等
function textConvert(raw) {
  return String(raw)
    .replace(/\\\(/g, "$") // 文件里的 \( -> $
    .replace(/\\\)/g, "$") // 文件里的 \) -> $
    .replace(/\\\[/g, "$$") // 文件里的 \[ -> $$
    .replace(/\\\]/g, "$$") // 文件里的 \] -> $$
    .replace(/<p[^>]*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<div[^>]*>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<b>/gi, "")
    .replace(/<\/b>/gi, "")
    .replace(/<sup>/gi, "")
    .replace(/<\/sup>/gi, "")
    .replace(/<sub>/gi, "")
    .replace(/<\/sub>/gi, "")
    // 注意:不写兜底 <[^>]+> 删除,否则会误删含裸 < 或 > 的数学文本(如不等式),
    // 导致对象结构错位。已知标签已在上文处理;其余残留标签由前端 rich 忽略。
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function main() {
  const html = fs.readFileSync(FILE, "utf8");
  const marker = "const QUESTIONS = [";
  const start = html.indexOf(marker);
  if (start < 0) throw new Error("未找到 const QUESTIONS = [");
  const arrStart = start + marker.length - 1; // 指向 [
  const end = html.indexOf("];", arrStart);
  let arrText = html.slice(arrStart, end + 1);

  // 文本层转换(此时反斜杠尚在,且必须在 eval 之前)
  arrText = textConvert(arrText);
  console.log("[debug] 转换后切片内 topic: 数量 =", (arrText.match(/topic:/g) || []).length);
  console.log("[debug] 转换后切片长度 =", arrText.length);
  // 转换后数学已是 $...$,无 HTML 标签,eval 在 ESM 严格模式也安全
  const QUESTIONS = eval(arrText);
  console.log(`解析到 ${QUESTIONS.length} 道题`);

  // 诊断:逐题检查结构
  QUESTIONS.forEach((q, i) => {
    if (!q || typeof q !== "object") {
      console.log(`[BAD ${i}] 非对象:`, q);
    } else if (!Array.isArray(q.options)) {
      console.log(`[BAD ${i}] options 缺失/非数组. keys=`, Object.keys(q), "topic=", q.topic);
    }
  });

  const questions = QUESTIONS.map((q) => {
    const options = q.options.map((o) => toCanonicalText(o.text)); // 走共享清洗(数学/标签归一)
    const ansObj = q.options.find((o) => o.letter === q.answer) || {};
    const answerText = ansObj.text || q.answer;
    return {
      topic: q.topic || "TMUA 2016",
      stem: toCanonicalText(q.stem), // 已是 $...$ 格式,再过一道清洗去除 <span>/表格等
      options,
      answer: toCanonicalText(answerText), // 选项文本(与前端 opt===answer 匹配)
      solution: toCanonicalText(q.explanation || ""),
    };
  });

  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const header =
    "// 自动生成 — TMUA 2016 Paper 1(真实考年)\n" +
    "// 来源: TMUA-2016-Paper-1-Interactive.html\n" +
    "// 经 scripts/adapters/sanitize.js 清洗:LaTeX 转 $...$,HTML 标签/表格转可读文本。\n" +
    "// 请勿手改,改源 HTML 后重跑 extract_tmua2016.js。\n";
  fs.writeFileSync(DATA_FILE, header + "export default " + JSON.stringify(questions, null, 2) + ";\n");
  console.log(`已写出 ${questions.length} 道题 -> ${DATA_FILE}`);

  // 抽样打印,确认格式
  console.log("\n=== 抽样 Q1 ===");
  console.log("stem:", questions[0].stem.slice(0, 140));
  console.log("opt[0]:", questions[0].options[0]);
  console.log("answer:", questions[0].answer.slice(0, 40));
  console.log("\n=== 抽样 Q3 ===");
  console.log("stem:", questions[2].stem.slice(0, 140));
  console.log("solution 片段:", questions[2].solution.replace(/\n/g, " ").slice(0, 160));
}

main();
