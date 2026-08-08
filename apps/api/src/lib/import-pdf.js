// PDF 批量导入编排:
//   1) 用 PyMuPDF 把 PDF 逐页栅格化为 PNG(pdf_rasterize.py),公式以渲染后的图像呈现
//   2) 把每页图片交给视觉模型(读渲染后的数学字形,还原为规范 LaTeX)
//   3) 模型返回的每条题目经 finalizeRow 归一化(answer 字母→选项文本、换行清洗等)
//   4) 过滤掉字段不完整/无效的题,交回 importRows 入库
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { extractQuestionsFromPdfPages, isVisionConfigured } from "./vision.js";
import { finalizeRow } from "./parse-import-file.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RASTER_SCRIPT = path.join(__dirname, "..", "..", "scripts", "pdf_rasterize.py");

async function rasterize(pdfBuf) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdfimp-"));
  try {
    const pdfPath = path.join(tmpDir, "input.pdf");
    fs.writeFileSync(pdfPath, pdfBuf);
    const outDir = path.join(tmpDir, "pages");
    fs.mkdirSync(outDir, { recursive: true });
    const { stdout } = await execFileAsync(
      "python3",
      [RASTER_SCRIPT, pdfPath, outDir, "150"],
      { maxBuffer: 50 * 1024 * 1024, timeout: 120000 }
    );
    // 子进程 stdout 可能混入依赖库的告警,只截取 JSON 主体
    const s = stdout.indexOf("{");
    const e = stdout.lastIndexOf("}");
    if (s < 0 || e <= s) throw new Error("栅格化脚本未返回 JSON:" + stdout.slice(0, 200));
    const info = JSON.parse(stdout.slice(s, e + 1));
    const pages = (info.pages || []).map((p) => ({
      image: fs.readFileSync(p.path).toString("base64"),
      text: p.text || "",
    }));
    if (!pages.length) throw new Error("PDF 没有任何可栅格化的页面");
    return pages;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function normalizeRaw(r) {
  return {
    subject: r?.subject,
    paper: r?.paper,
    topic: r?.topic,
    difficulty: r?.difficulty,
    type: r?.type,
    stem: r?.stem,
    options: Array.isArray(r?.options) ? r.options : r?.options ? [r.options] : [],
    answer: r?.answer,
    solution: r?.solution,
    source: "PDF 导入", // PDF 来源统一标记,便于区分
  };
}

export async function parsePdf(filename, buffer) {
  if (!isVisionConfigured()) throw new Error("VISION_NOT_CONFIGURED");
  const pages = await rasterize(buffer);
  const raws = await extractQuestionsFromPdfPages(pages);
  const rows = raws
    .map((r) => {
      try {
        return finalizeRow(normalizeRaw(r));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((r) => r.stem && Array.isArray(r.options) && r.options.length >= 2 && r.answer);
  if (!rows.length) {
    throw new Error("视觉模型未从 PDF 解析出有效的选择题(可能是纯文本试卷、或公式无法识别)");
  }
  return rows;
}
