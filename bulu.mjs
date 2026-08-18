// 补录 TMUA 导入时因 answer 对齐失败的 4 道题(数据来自 tmua_missing.json)
import fs from "fs";
import { PrismaClient } from "@prisma/client";
import { alignAnswerToOptions } from "../src/lib/parse-import-file.js";
import { syncAutoPaperSets } from "../src/lib/paper-set.js";
import { cleanUnits } from "../src/lib/text-normalize.js";
import { normalizeNewlines } from "../src/lib/text-clean.js";
import { KNOWLEDGE_RULES } from "../src/lib/knowledge-rules.js";

const prisma = new PrismaClient();

const SUBJECT_NORM = {
  Chemistry: "化学", Physics: "物理", Biology: "生物",
  Math: "数学", Maths: "数学", Mathematics: "数学", Alevel: "数学",
};
function normalizeSubject(s) {
  const v = String(s || "").trim();
  return SUBJECT_NORM[v] || v;
}
function knowledgeSubjectsFor(subject) {
  if (subject === "TMUA") return ["数学"];
  if (subject === "ESAT") return ["数学", "物理"];
  if (subject === "SMC") return ["数学"];
  return [subject];
}
function cleanOptionPrefix(o) {
  return String(o ?? "").replace(/^[\(\[【（]?[A-HJ-Za-hj-z][\.\s:、)）\]】」、\]】]+/, "").trimStart();
}

async function importRows(req, rows, onProgress) {
  const errors = [];
  const created = [];
  let imported = 0;
  const allKps = await prisma.knowledgePoint.findMany();
  const kpBySubject = new Map();
  for (const k of allKps) {
    if (!kpBySubject.has(k.subject)) kpBySubject.set(k.subject, []);
    kpBySubject.get(k.subject).push(k);
  }
  function matchKps(subject, topicStr) {
    const names = String(topicStr || "")
      .split(/[,、;；\/\s]+/).map((s) => s.trim()).filter(Boolean);
    const subs = knowledgeSubjectsFor(subject);
    const pool = subs.flatMap((s) => kpBySubject.get(s) || []);
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
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    try {
      const options = Array.isArray(r.options)
        ? r.options
        : String(r.options || "").split(/[;；]/).map((s) => s.trim()).filter(Boolean);
      r.subject = normalizeSubject(r.subject);
      if (/^(TMUA|ESAT|NSAA|BMAT|STEP|MAT|PAT|ENGAA|SMC)$/i.test(String(r.subject || ""))) {
        if (!r.sourceType) r.sourceType = String(r.subject).toUpperCase();
        r.subject = "数学";
      }
      if (!r.subject && /^(TMUA|MAT|STEP|BMAT|PAT|ENGAA|SMC)$/i.test(String(r.sourceType || ""))) {
        r.subject = "数学";
      }
      const stem = cleanUnits(String(r.stem || ""));
      const cleanOpts = options.map((o) => normalizeNewlines(cleanOptionPrefix(cleanUnits(String(o)))));
      if ((!r.subject && !r.sourceType) || !r.topic || !stem || cleanOpts.length < 2) {
        throw new Error("字段不完整(需要 subject 或 sourceType、topic、stem、options≥2)");
      }
      r.stem = stem;
      options.length = 0;
      options.push(...cleanOpts);
      r.answer = alignAnswerToOptions(r.answer, cleanOpts);
      if (!r.answer && r.source !== "PDF 导入") {
        throw new Error("字段不完整:answer 必填");
      }
      let topicIds = [];
      let topic = String(r.topic || "").trim();
      if (Array.isArray(r.topicIds) && r.topicIds.length) {
        const valid = allKps.filter((k) => r.topicIds.includes(k.id));
        topicIds = valid.map((k) => k.id);
        if (valid[0]) topic = valid[0].name;
      } else {
        const matched = matchKps(r.subject, r.topic);
        topicIds = matched.map((k) => k.id);
        if (matched[0]) topic = matched[0].name;
      }
      const q = await prisma.question.create({
        data: {
          subject: r.subject,
          sourceType: r.sourceType || null,
          paper: r.paper || null,
          topic,
          topicIds: JSON.stringify(topicIds),
          difficulty: Number(r.difficulty) || 3,
          type: r.type || "SINGLE_CHOICE",
          stem: normalizeNewlines(cleanUnits(r.stem)),
          options: JSON.stringify(options),
          answer: r.answer ? normalizeNewlines(String(r.answer)) : "",
          solution: r.solution ? normalizeNewlines(r.solution) : null,
          source: r.source || "批量导入",
          status: r.status || "PENDING_REVIEW",
          importedAt: new Date(),
          createdBy: req.user.id,
        },
      });
      created.push({ id: q.id, subject: q.subject, sourceType: q.sourceType, paper: q.paper, source: q.source });
      imported++;
    } catch (e) {
      errors.push({ row: i + 1, reason: e.message });
    }
    if (onProgress && (i + 1) % 5 === 0) {
      onProgress(Math.round(((i + 1) / rows.length) * 100), `已处理 ${i + 1}/${rows.length} 条`);
    }
  }
  if (onProgress) onProgress(100, `已处理 ${rows.length}/${rows.length} 条`);
  return { imported, errors, created };
}

async function main() {
  const data = JSON.parse(fs.readFileSync("/root/tmua_missing.json", "utf8"));
  const admin = (await prisma.user.findFirst({ where: { role: "ADMIN" } }))
    || (await prisma.user.findFirst({ where: { role: "TEACHER" } }));
  const adminId = admin?.id || "system";
  console.log("[info] createdBy =", adminId);

  const rows = data.map((d) => {
    const opts = d.options.map((o) => String(o));
    const cleanOpts = opts.map((o) => normalizeNewlines(cleanOptionPrefix(cleanUnits(String(o)))));
    const letter = String(d.answerLetter || "").trim().toUpperCase();
    const idx = letter.charCodeAt(0) - 65;
    const ans = (cleanOpts[idx] != null) ? cleanOpts[idx] : (opts[idx] != null ? opts[idx] : "");
    return {
      subject: d.subject,
      sourceType: d.sourceType,
      paper: d.targetPaper,
      topic: d.topic,
      difficulty: Number(d.difficulty) || 3,
      type: d.type || "SINGLE_CHOICE",
      stem: d.stem,
      options: opts,
      answer: ans,
      solution: d.solution || null,
      source: d.targetPaper,
      status: d.status || "PENDING_REVIEW",
    };
  });

  const { imported, errors, created } = await importRows({ user: { id: adminId } }, rows, (p, m) => {
    if (p % 20 === 0) console.log(`[progress] ${m}`);
  });
  console.log(`[result] 入库成功 ${imported} 条,失败 ${errors.length} 条`);
  if (errors.length) console.log("[errors]", errors);

  const papers = await syncAutoPaperSets(created, {});
  console.log("[papers] 自动组卷结果:");
  for (const p of papers) {
    console.log(`  - ${p.title} | ${p.total} 题 | status=${p.status} | action=${p.action}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => { console.error("[FATAL]", e); prisma.$disconnect(); process.exit(1); });
