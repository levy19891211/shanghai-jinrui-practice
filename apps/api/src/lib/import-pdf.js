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

export async function rasterize(pdfBuf) {
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

// 从文件名推测卷名,如 "TMUA-2021-paper-1.pdf" → "TMUA 2021 Paper 1"。
// 用作题目的 paper 字段,既能让审核列表/试卷名可读,又能避免不同年份同名卷
// 因 sourceKey(subject::paper::source) 相同而被错误合并。解析不出时回落到视觉模型返回的 paper。
export function paperFromFilename(filename) {
  const f = String(filename || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_\-]+/g, " ")
    .trim();
  if (!f) return "";
  const subj = /ESAT/i.test(f) ? "ESAT" : /TMUA/i.test(f) ? "TMUA" : "";
  const year = (f.match(/\b(19|20)\d{2}\b/) || [])[0] || "";
  const pNum = (f.match(/paper\s*(\d+)/i) || f.match(/p\s*(\d+)/i) || [])[1] || "";
  if (subj && year && pNum) return `${subj} ${year} Paper ${pNum}`;
  if (subj && pNum) return `${subj} Paper ${pNum}`;
  return "";
}

// ——— 文件级元数据统一:彻底避免同一份 PDF 被拆成多套卷 ———
// 视觉模型是逐题判断 subject 的,同卷内偶尔会判错(如把 NSAA 物理题判成 ESAT),
// 导致 syncAutoPaperSets 按 subject::paper::source 三元组拆成多套卷。
// 这里在同一份 PDF 内强制统一 subject/paper:
//   paper:  文件名解析优先 → 文件内多数派 → 首个非空 → 保持空
//   subject:文件名强信号(ESAT/TMUA/学科名) → 统一后 paper 组内多数派 → 文件内多数派 → 保持空
// 注意:subject 归一化映射须与 routes/questions.js 的 SUBJECT_NORM 保持一致。
const SUBJECT_NORM = {
  Chemistry: "化学",
  Physics: "物理",
  Biology: "生物",
  Math: "数学",
  Maths: "数学",
  Mathematics: "数学",
  Alevel: "数学",
};
function normSubject(s) {
  const v = String(s || "").trim();
  return SUBJECT_NORM[v] || v;
}

// 从文件名提取强学科信号(ESAT/TMUA/中英文学科名),未命中返回 ""
export function subjectFromFilename(filename) {
  const f = String(filename || "");
  if (/ESAT/i.test(f)) return "ESAT";
  if (/TMUA/i.test(f)) return "TMUA";
  for (const [re, subj] of [
    [/数学|Math(?:s)?|Mathematics/i, "数学"],
    [/物理|Physics/i, "物理"],
    [/化学|Chemistry/i, "化学"],
    [/生物|Biology/i, "生物"],
  ]) {
    if (re.test(f)) return subj;
  }
  return "";
}

// 取列表中出现次数最多的非空值,平票取先出现的;全空返回 ""
function modeOf(list) {
  const cnt = new Map();
  const order = [];
  for (const v of list) {
    const s = String(v || "").trim();
    if (!s) continue;
    if (!cnt.has(s)) {
      cnt.set(s, 0);
      order.push(s);
    }
    cnt.set(s, cnt.get(s) + 1);
  }
  if (!order.length) return "";
  let best = order[0];
  for (const v of order) if (cnt.get(v) > cnt.get(best)) best = v;
  return best;
}

export function unifyFileMeta(raws, filename) {
  if (!raws.length) return raws;
  const fnSubject = subjectFromFilename(filename);
  const fnPaper = paperFromFilename(filename);

  // 1) 统一 paper:文件名解析 → 文件内多数派 → 首个非空
  const paperVotes = raws.map((r) => String(r?.paper || "").trim());
  const paper = fnPaper || modeOf(paperVotes) || paperVotes.find(Boolean) || "";

  // 2) 统一 subject:文件名强信号 → 统一后 paper 组内多数派 → 文件内多数派
  let subject = fnSubject;
  if (!subject) {
    const inGroup = paper
      ? raws.filter((r) => String(r?.paper || "").trim() === paper)
      : raws;
    subject = modeOf(inGroup.map((r) => normSubject(r?.subject)));
    if (!subject) subject = modeOf(raws.map((r) => normSubject(r?.subject)));
  }

  // 3) 应用到每一道题
  return raws.map((r) => ({
    ...r,
    subject: subject || r?.subject,
    paper: paper || r?.paper,
  }));
}

function normalizeRaw(r, filename) {
  return {
    subject: r?.subject,
    paper: paperFromFilename(filename) || r?.paper,
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
  // 文件级统一 subject/paper:同一份 PDF 的所有题必须是同一套卷,视觉模型逐题误判
  // (如把物理题判成 ESAT)不应导致拆卷。详见 unifyFileMeta。
  const unified = unifyFileMeta(raws, filename);
  const rows = unified
    .map((r) => {
      try {
        return finalizeRow(normalizeRaw(r, filename));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((r) => r.stem && Array.isArray(r.options) && r.options.length >= 2);
  if (!rows.length) {
    throw new Error("视觉模型未从 PDF 解析出有效的选择题(可能是纯文本试卷、或公式无法识别)");
  }
  return rows;
}
