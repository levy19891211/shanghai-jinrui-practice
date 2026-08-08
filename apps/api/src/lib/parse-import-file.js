// 文件批量导入解析:把 Excel(.xlsx/.xls) 与 Word(.docx) 转成 importRows 可消费的 rows 数组。
// 关键约定(与 /api/questions/import 的 JSON/CSV 一致):
//   - 字段:subject, paper, topic, difficulty, type, stem, options, answer, solution, source, status
//   - options:字符串时用分号(; 或 ；)分隔;数组时直接用
//   - answer 必须是「选项文本」(判分按 a===s 全等比对);若作者写字母 A-H,本模块自动映射成对应选项文本
//   - 所有文本经过 normalizeNewlines 清洗(统一换行、去多余空白)
import xlsx from "xlsx";
import mammoth from "mammoth";
import { normalizeNewlines } from "./text-clean.js";

// 字段中文/英文别名 → 标准字段名
const FIELD_ALIASES = {
  subject: ["subject", "学科"],
  paper: ["paper", "试卷"],
  topic: ["topic", "知识点", "topic知识点"],
  difficulty: ["difficulty", "难度"],
  type: ["type", "题型"],
  stem: ["stem", "题干"],
  options: ["options", "选项"],
  answer: ["answer", "答案"],
  solution: ["solution", "解析", "解答"],
  source: ["source", "来源"],
  status: ["status", "状态"],
};

function normHeader(h) {
  return String(h || "").trim().toLowerCase().replace(/[\s　]/g, "");
}

// 把字母答案(A-H / 多个字母)映射成选项文本;options 为分号字符串或数组
function mapAnswerToOptionText(answer, options) {
  if (options == null || answer == null) return answer;
  const opts = Array.isArray(options)
    ? options
    : String(options).split(/[;；]/).map((s) => s.trim()).filter(Boolean);
  if (opts.length === 0) return answer;
  const a = String(answer).trim();
  // 多选题:逗号/空格分隔的多个字母,如 "A, C"
  if (/^[A-Ha-h]([ ,、][A-Ha-h])+$/.test(a)) {
    const mapped = a
      .split(/[ ,、]+/)
      .map((t) => t.trim())
      .map((letter) => opts[letter.toUpperCase().charCodeAt(0) - 65])
      .filter(Boolean);
    return mapped.join("; ");
  }
  // 单选字母
  if (/^[A-Ha-h]$/.test(a)) {
    const idx = a.toUpperCase().charCodeAt(0) - 65;
    if (opts[idx] != null) return opts[idx];
  }
  return a; // 本来就是选项文本
}

// 统一收尾:拆分选项 + 答案字母映射 + 换行清洗 + 字段归一
function finalizeRow(raw) {
  const options = Array.isArray(raw.options)
    ? raw.options.map((o) => normalizeNewlines(String(o)))
    : String(raw.options || "")
        .split(/[;；]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((o) => normalizeNewlines(o));
  const answer = mapAnswerToOptionText(raw.answer, options);
  return {
    subject: raw.subject ? normalizeNewlines(String(raw.subject)) : "",
    paper: raw.paper ? normalizeNewlines(String(raw.paper)) : null,
    topic: raw.topic ? normalizeNewlines(String(raw.topic)) : "",
    difficulty: raw.difficulty != null && raw.difficulty !== "" ? Number(raw.difficulty) || 3 : 3,
    type: raw.type ? normalizeNewlines(String(raw.type)) : "SINGLE_CHOICE",
    stem: raw.stem ? normalizeNewlines(String(raw.stem)) : "",
    options,
    answer: answer != null ? normalizeNewlines(String(answer)) : "",
    solution: raw.solution ? normalizeNewlines(String(raw.solution)) : null,
    source: raw.source ? normalizeNewlines(String(raw.source)) : "批量导入",
    status: raw.status ? normalizeNewlines(String(raw.status)) : "PENDING_REVIEW",
  };
}

// ——— Excel ———
function parseXlsx(buffer) {
  const wb = xlsx.read(buffer, { type: "buffer", cellHTML: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("Excel 工作簿为空");
  const sheet = wb.Sheets[sheetName];
  const matrix = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
  if (!matrix.length) return [];

  const header = matrix[0].map(normHeader);
  // 建立 标准字段 -> 列号 映射
  const colMap = {};
  let matched = 0;
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const idx = header.findIndex((h) => aliases.some((al) => h === al || h.includes(al)));
    if (idx >= 0) {
      colMap[field] = idx;
      matched++;
    }
  }

  let dataRows;
  if (matched >= 3) {
    // 有表头:按字段名取列
    dataRows = matrix.slice(1).map((r) => {
      const raw = {};
      for (const field of Object.keys(colMap)) raw[field] = r[colMap[field]];
      return raw;
    });
  } else {
    // 无明确表头:跳过首行(当表头),按固定位置顺序取列
    const order = ["subject", "paper", "topic", "difficulty", "type", "stem", "options", "answer", "solution", "source", "status"];
    dataRows = matrix.slice(1).map((r) => {
      const raw = {};
      order.forEach((field, i) => (raw[field] = r[i]));
      return raw;
    });
  }
  return dataRows.map(finalizeRow).filter((r) => r.stem || (r.options && r.options.length));
}

// ——— Word ———
// 模板(题与题之间用单独一行的 --- 分隔):
//   ---
//   Subject: TMUA
//   Paper: 2016 P1
//   Topic: 代数
//   Difficulty: 3
//   Type: SINGLE_CHOICE
//   Source: 自编
//
//   题干内容,可含 $LaTeX$ 公式。
//
//   A. 选项一
//   B. 选项二
//   C. 选项三
//   D. 选项四
//
//   Answer: B
//
//   解析内容(可选),可含公式。
const META_RE = /^(Subject|Paper|Topic|Difficulty|Type|Source|学科|试卷|知识点|难度|题型|来源)\s*[:：]\s*(.+)$/i;
const OPTION_RE = /^([A-Ha-h])[\.、)]\s*(.+)$/;
const ANSWER_RE = /^(Answer|答案)\s*[:：]?\s*(.+)$/i;

function splitDocxBlocks(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let cur = [];
  for (const line of lines) {
    const t = line.trim();
    if (t === "---" || t === "***" || t === "===") {
      if (cur.length) blocks.push(cur.join("\n"));
      cur = [];
      continue;
    }
    cur.push(line);
  }
  if (cur.length) blocks.push(cur.join("\n"));
  return blocks.map((b) => b.trim()).filter(Boolean);
}

function parseBlock(blockText) {
  const lines = blockText.split(/\r?\n/);
  const meta = {};
  const content = [];
  for (const line of lines) {
    const m = line.match(META_RE);
    if (m) {
      const key = m[1].toLowerCase();
      const val = m[2].trim();
      const map = {
        subject: "subject", 学科: "subject",
        paper: "paper", 试卷: "paper",
        topic: "topic", 知识点: "topic",
        difficulty: "difficulty", 难度: "difficulty",
        type: "type", 题型: "type",
        source: "source", 来源: "source",
      };
      if (map[key]) meta[map[key]] = val;
      continue;
    }
    content.push(line);
  }

  const stemParts = [];
  const options = [];
  let answer = null;
  const solutionParts = [];
  let phase = "stem"; // stem -> options -> afterAnswer
  for (const line of content) {
    const t = line.trim();
    if (!t) {
      if (phase === "stem" && stemParts.length) stemParts.push("");
      else if (phase === "afterAnswer") solutionParts.push("");
      continue;
    }
    const opt = t.match(OPTION_RE);
    if (opt) {
      options.push(opt[2].trim());
      phase = "options";
      continue;
    }
    const ans = t.match(ANSWER_RE);
    if (ans) {
      answer = ans[2].trim();
      phase = "afterAnswer";
      continue;
    }
    if (phase === "stem") stemParts.push(t);
    else if (phase === "afterAnswer") solutionParts.push(t);
    // phase === "options" 且不是选项也不是答案行 → 视为选项段落的延续,忽略(防误吞)
  }
  // 去掉解析行首多余的「解析: / 解答: / Solution:」标签
  while (solutionParts.length && /^(解析|解答|solution)\s*[:：]?$/i.test(solutionParts[0].trim())) solutionParts.shift();
  if (solutionParts.length) {
    const m = solutionParts[0].match(/^(解析|解答|solution)\s*[:：]\s*(.+)$/i);
    if (m) solutionParts[0] = m[2];
  }

  const raw = {
    ...meta,
    stem: stemParts.join("\n").trim(),
    options,
    answer,
    solution: solutionParts.join("\n").trim() || null,
  };
  return finalizeRow(raw);
}

export function parseDocxText(text) {
  const blocks = splitDocxBlocks(text);
  return blocks.map(parseBlock).filter((r) => r.stem || (r.options && r.options.length));
}

async function parseDocx(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return parseDocxText(result.value || "");
}

// ——— 入口 ———
export async function parseImportFile(filename, buffer) {
  const ext = String(filename || "").toLowerCase().split(".").pop();
  if (ext === "xlsx" || ext === "xls") return parseXlsx(buffer);
  if (ext === "docx") return await parseDocx(buffer);
  throw new Error(`不支持的文件类型: .${ext || "?"} (仅支持 .xlsx/.xls/.docx)`);
}
