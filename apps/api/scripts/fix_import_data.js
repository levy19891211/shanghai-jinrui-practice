// 一次性修复最近导入的数据:
// 1) subject 英文学科归一化(Chemistry→化学 等)
// 2) 题干/选项中"纯单位"公式还原为普通文本(如 $2.0\ \mathrm{mol}$ → 2.0 mol)
// 3) 按共享规则重新自动归类知识点(含斜杠拆分)
// 运行:npm run fix:import-data 或 node scripts/fix_import_data.js [--dry]
import "dotenv/config";
import { prisma } from "../src/lib/db.js";
import { KNOWLEDGE_RULES } from "../src/lib/knowledge-rules.js";

const dry = process.argv.includes("--dry");

const SUBJECT_NORM = { Chemistry: "化学", Physics: "物理", Biology: "生物", Math: "数学", Maths: "数学", Mathematics: "数学" };
const SUBJECT_POOL = { TMUA: ["数学"], ESAT: ["数学", "物理"], 数学: ["数学"], 物理: ["物理"], 化学: ["化学"], 生物: ["生物"] };

// 纯单位/数字公式 → 普通文本:只允许 数字/点/空格/字母/\mathrm{...}/上标/\,/\ 
// 上标还原为 Unicode(⁻³ 等),使 mol dm⁻³ 这类单位用正文字体,避免 KaTeX 数学字体混排
const SUP = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻", "+": "⁺", ".": "˙" };
const SUB = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉" };
const toSup = (s) => String(s).split("").map((c) => SUP[c] || c).join("");
const toSub = (s) => String(s).split("").map((c) => SUB[c] || c).join("");
const UNIT_RE = /\$((?:[-−\d.,\s]|\\mathrm\{(?:[^{}]|\{[^{}]*\})*\}|\\text\{(?:[^{}]|\{[^{}]*\})*\}|\\,|\\ |\^\{[^}]*\}|\^[a-zA-Z0-9]|_\{?[a-zA-Z0-9-]+\}?)+)\$/g;
function cleanUnits(s) {
  return String(s || "")
    .replace(UNIT_RE, (_all, inner) =>
      inner
        .replace(/\^\{([^}]*)\}/g, (_a, n) => toSup(n))
        .replace(/\^([a-zA-Z0-9])/g, (_a, c) => toSup(c))
        .replace(/_\{([^}]*)\}/g, (_a, n) => toSub(n))
        .replace(/_([a-zA-Z0-9])/g, (_a, c) => toSub(c))
        .replace(/\\mathrm\{([^}]*)\}/g, "$1")
        .replace(/\\text\{([^}]*)\}/g, "$1")
        .replace(/\\,/g, " ")
        .replace(/\\ /g, " ")
        .replace(/\s+/g, " ")
        .trim()
    )
    // 裸文本里的单位上标(如 cm^3 → cm³),避免被当数学公式渲染成斜体
    .replace(/(?<![a-zA-Z0-9\\}])cm\^(\d)/gi, (_a, n) => `cm${toSup(n)}`)
    .replace(/(?<![a-zA-Z0-9\\}])dm\^(\d)/gi, (_a, n) => `dm${toSup(n)}`)
    .replace(/(?<![a-zA-Z0-9\\}])m\^(\d)/gi, (_a, n) => `m${toSup(n)}`)
    .replace(/(?<![a-zA-Z0-9\\}])s\^(\d)/gi, (_a, n) => `s${toSup(n)}`)
    // 裸文本里的单位负幂次(如 "kJ mol^{-1}" → "kJ mol⁻¹"),避免 KaTeX 渲染失败
    .replace(/\b(mol|kg|g|cm|dm|mm|m|s|min|h|K|J|kJ|Pa|Hz|V|A)\s*\^\{(-?\d+)\}/g, (_a, u, n) => `${u}${toSup(n)}`);
}

const kps = await prisma.knowledgePoint.findMany({ select: { id: true, subject: true, name: true } });
const kpBySubject = {};
for (const k of kps) (kpBySubject[k.subject] = kpBySubject[k.subject] || []).push(k);

function matchKps(subject, topicStr) {
  const names = String(topicStr || "").split(/[,、;；\/\s]+/).map((s) => s.trim()).filter(Boolean);
  const subs = SUBJECT_POOL[subject] || [subject];
  const pool = subs.flatMap((s) => kpBySubject[s] || []);
  const hits = [];
  for (const n of names) {
    let hit = pool.find((k) => k.name === n || k.name.includes(n) || n.includes(k.name));
    if (!hit) {
      for (const r of KNOWLEDGE_RULES) {
        if (!subs.includes(r.subject)) continue;
        if (r.re.test(n)) {
          hit = pool.find((k) => k.name === r.kp);
          if (hit) break;
        }
      }
    }
    if (hit && !hits.some((h) => h.id === hit.id)) hits.push(hit);
  }
  return hits;
}

const qs = await prisma.question.findMany({ select: { id: true, subject: true, topic: true, topicIds: true, stem: true, options: true } });
let changed = 0, detail = { subj: 0, units: 0, classify: 0, total: qs.length };
for (const q of qs) {
  const data = {};
  const subj = SUBJECT_NORM[q.subject] || q.subject;
  if (subj !== q.subject) { data.subject = subj; detail.subj++; }

  const stem = cleanUnits(q.stem);
  const opts = JSON.parse(q.options || "[]");
  const cleanedOpts = opts.map((o) => cleanUnits(o));
  const optsStr = JSON.stringify(cleanedOpts);
  if (stem !== q.stem) { data.stem = stem; detail.units++; }
  if (optsStr !== q.options) { data.options = optsStr; detail.units++; }

  // 重新归类(覆盖旧 topicIds,与导入时逻辑一致)
  const matched = matchKps(subj, q.topic);
  const newIds = matched.map((k) => k.id);
  const newTopic = matched[0]?.name || String(q.topic || "").trim();
  if (JSON.stringify(newIds) !== q.topicIds || newTopic !== q.topic) {
    data.topicIds = JSON.stringify(newIds);
    data.topic = newTopic;
    detail.classify++;
  }

  if (Object.keys(data).length) {
    changed++;
    if (!dry) await prisma.question.update({ where: { id: q.id }, data });
  }
}
console.log(`扫描 ${detail.total} 题${dry ? "(dry)" : ""}: 变更 ${changed} | 学科归一 ${detail.subj} | 题干单位清洗 ${detail.units} | 归类 ${detail.classify}`);
await prisma.$disconnect();
