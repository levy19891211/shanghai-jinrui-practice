// 语言学习模块路由(雅思/其他语言)——完全独立于学科题库
// 所有数据表均带 Language 前缀,不与 Question/Paper/Session 冲突
import { Router } from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { prisma } from "../lib/db.js";
import { ok, fail, asyncHandler } from "../lib/res.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { rasterize } from "../lib/import-pdf.js";
import { extractReadingPassagesFromPdfPages } from "../lib/vision.js";
import { createImportTask, updateImportTask, finishImportTask, failImportTask, getImportTask } from "../lib/import-task.js";

const router = Router();

// —— 工具 ——

// —— Band 换算:全部交由评分引擎处理(V2.4.126,G2/H1/H3) ——
// 历史问题:此处曾硬编码 LISTENING_BAND 一张表给听读共用,且按比例折算到 40 题;
// 它与前端 LangGrowthPanel.estimateBand 的阶梯算法、grade 接口的平均算法互不相等
// ⇒ 同一份作答在不同页面读出不同 Band。现在口径唯一来源 = apps/api/src/lib/lang-scoring.js。
import {
  SCORING_VERSION, RUBRIC_VERSION,
  ensureDefaultBandTables, loadBandTable, lookupBand, roundIeltsBand, parseRows,
  bandFromSubscores, parseSubscores, parseSkillBands, composeOverall, goalGap,
  scoringConfig, dimsForSkill, SKILL_CN, WRITING_DIMS, SPEAKING_DIMS,
  OBJECTIVE_QTYPES, SUBJECTIVE_QTYPES,
} from "../lib/lang-scoring.js";

function safeSeedTables() {
  // 播种默认换算表:失败也不阻断主流程(引擎自带内置常量兜底)
  return ensureDefaultBandTables().catch(() => null);
}

// 雅思客观题判分(填空/单选/多选/判断/配对/标题)
// 填空:答案可多写用 | 分隔,忽略大小写与首尾空格,容错复数(±s)与连字符
function isAnswerCorrect(question, selected) {
  if (selected === undefined || selected === null || String(selected).trim() === "") return false;
  const q = question.qType;
  const sel = String(selected).trim();
  const expect = String(question.answer || "").trim();
  if (!expect) return false;

  if (q === "FILL_BLANK") {
    const accepted = expect.split("|").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const variants = (s) => {
      const out = new Set([s]);
      if (s.endsWith("s")) out.add(s.slice(0, -1));
      else out.add(s + "s");
      return [...out];
    };
    const selVar = variants(sel.replace(/[-–—]/g, "").toLowerCase());
    for (const acc of accepted) {
      const accNorm = acc.replace(/[-–—]/g, "");
      if (selVar.includes(accNorm)) return true;
      for (const v of selVar) {
        if (accNorm === v) return true;
      }
    }
    return false;
  }
  // 多选(V2.4.126,H4):雅思「五选二」等题型允许任意顺序作答,且书写分隔符不统一。
  // 归一方式:按常见分隔符切分 → 取首个字母 → 排序 → 逗号拼接,两侧同法处理后比较。
  // 例:答案 "B,D" ←→ 学生答 "D,B" / "BD" / "D, B" 均判对。
  // 仅当答案为单字母时不进入此分支,走下面的直接比对,行为与原逻辑完全一致。
  if (q === "MULTIPLE_CHOICE") {
    const norm = (s) =>
      String(s).toUpperCase().split(/[^A-Z]+/).filter(Boolean).map((x) => x[0]).sort().join(",");
    const a = norm(expect);
    const b = norm(sel);
    if (a.includes(",") || b.includes(",")) return a === b;
  }
  // 判断 T/F/NG、单选、配对、标题:直接比对字母(大写归一)
  return expect.toLowerCase() === sel.toLowerCase();
}

function parseOptions(options) {
  if (!options) return [];
  try {
    const v = JSON.parse(options);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function parseIds(s) {
  try {
    const v = JSON.parse(s || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

const Q_FIELDS = {
  id: true, examType: true, skill: true, qType: true, part: true, groupTitle: true,
  stem: true, options: true, answer: true, solution: true, audioUrl: true,
  materialId: true, wordLimit: true, difficulty: true, status: true, reviewNote: true,
  createdAt: true, updatedAt: true,
};

function fmtQ(q) {
  return { ...q, options: parseOptions(q.options) };
}

// 音频上传目录(Nginx 静态托管)
const AUDIO_DIR = "/var/www/uploads";

// POST /api/language/upload-audio — 教师上传听力/口语音频(仅教师/管理员)
router.post(
  "/upload-audio",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { filename, data } = req.body || {};
    if (!data || typeof data !== "string") return fail(res, 400, "缺少音频数据");
    const m = /^data:audio\/([a-zA-Z0-9+.-]+);base64,(.+)$/s.exec(data);
    let b64 = data;
    let ext = "mp3";
    if (m) {
      const mime = m[1].toLowerCase();
      if (mime === "mpeg" || mime === "mp3") ext = "mp3";
      else if (mime === "wav") ext = "wav";
      else if (mime === "ogg" || mime === "oga") ext = "ogg";
      else if (mime === "webm") ext = "webm";
      else if (mime === "mp4") ext = "m4a";
      else return fail(res, 400, "不支持的音频格式(仅 mp3 / wav / ogg / webm / m4a)");
      b64 = m[2];
    } else {
      const fe = String(filename || "").toLowerCase().match(/\.([a-z0-9]+)$/);
      if (!fe || !["mp3", "wav", "ogg", "oga", "webm", "m4a", "mp4"].includes(fe[1])) {
        return fail(res, 400, "不支持的音频格式(仅 mp3 / wav / ogg / webm / m4a)");
      }
      ext = fe[1] === "oga" ? "ogg" : fe[1] === "mp4" ? "m4a" : fe[1];
    }
    let buf;
    try {
      buf = Buffer.from(b64, "base64");
    } catch {
      return fail(res, 400, "音频解码失败");
    }
    if (!buf.length) return fail(res, 400, "音频内容为空");
    if (buf.length > 20 * 1024 * 1024) return fail(res, 400, "音频过大,上限 20MB");

    fs.mkdirSync(AUDIO_DIR, { recursive: true });
    const name = crypto.randomBytes(12).toString("hex") + "." + ext;
    fs.writeFileSync(path.join(AUDIO_DIR, name), buf);
    ok(res, { url: "/uploads/" + name, filename: name });
  })
);

// POST /api/language/upload-recording — 学生口语音频上传(所有登录用户)
router.post(
  "/upload-recording",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { filename, data } = req.body || {};
    if (!data || typeof data !== "string") return fail(res, 400, "缺少音频数据");
    const m = /^data:audio\/([a-zA-Z0-9+.-]+);base64,(.+)$/s.exec(data);
    let b64 = data;
    let ext = "webm";
    if (m) {
      const mime = m[1].toLowerCase();
      if (mime === "mpeg" || mime === "mp3") ext = "mp3";
      else if (mime === "wav") ext = "wav";
      else if (mime === "ogg" || mime === "oga") ext = "ogg";
      else if (mime === "webm") ext = "webm";
      else if (mime === "mp4") ext = "m4a";
      else return fail(res, 400, "不支持的音频格式");
      b64 = m[2];
    } else {
      const fe = String(filename || "").toLowerCase().match(/\.([a-z0-9]+)$/);
      if (!fe || !["mp3", "wav", "ogg", "webm", "m4a", "mp4"].includes(fe[1])) {
        return fail(res, 400, "不支持的音频格式");
      }
      ext = fe[1] === "oga" ? "ogg" : fe[1] === "mp4" ? "m4a" : fe[1];
    }
    let buf;
    try {
      buf = Buffer.from(b64, "base64");
    } catch {
      return fail(res, 400, "音频解码失败");
    }
    if (!buf.length) return fail(res, 400, "音频内容为空");
    if (buf.length > 20 * 1024 * 1024) return fail(res, 400, "音频过大,上限 20MB");

    fs.mkdirSync(AUDIO_DIR, { recursive: true });
    const name = crypto.randomBytes(12).toString("hex") + "." + ext;
    fs.writeFileSync(path.join(AUDIO_DIR, name), buf);
    ok(res, { url: "/uploads/" + name, filename: name });
  })
);

// —— 语言题库 ——

// GET /api/language/questions?examType=&skill=&status=&q=
// 学生只读已发布;教师可按状态/搜索
router.get(
  "/questions",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { examType, skill, status, q } = req.query;
    const where = {};
    if (examType) where.examType = String(examType);
    if (skill) where.skill = String(skill);
    if (req.user.role === "STUDENT") {
      where.status = "PUBLISHED";
    } else if (status) {
      where.status = String(status);
    }
    if (q) {
      const kw = String(q).trim();
      where.OR = [{ stem: { contains: kw } }, { groupTitle: { contains: kw } }];
    }
    const list = await prisma.languageQuestion.findMany({
      where,
      select: Q_FIELDS,
      orderBy: [{ part: "asc" }, { createdAt: "asc" }],
    });
    ok(res, { list: list.map(fmtQ), total: list.length });
  })
);

// POST /api/language/questions — 新增语言题(教师/管理员)
router.post(
  "/questions",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    if (!b.examType || !b.skill || !b.qType || !b.stem) return fail(res, 400, "examType、skill、qType、stem 必填");
    if (b.skill === "WRITING" && b.qType !== "TASK1" && b.qType !== "TASK2") return fail(res, 400, "写作题 qType 仅支持 TASK1/TASK2");
    const q = await prisma.languageQuestion.create({
      data: {
        examType: b.examType,
        skill: b.skill,
        qType: b.qType,
        part: b.part ? Number(b.part) : null,
        groupTitle: b.groupTitle ? String(b.groupTitle) : null,
        stem: String(b.stem),
        options: Array.isArray(b.options) ? JSON.stringify(b.options) : null,
        answer: b.answer !== undefined && b.answer !== null && b.answer !== "" ? String(b.answer) : null,
        solution: b.solution ? String(b.solution) : null,
        audioUrl: b.audioUrl ? String(b.audioUrl) : null,
        materialId: b.materialId || null,
        wordLimit: b.wordLimit ? Number(b.wordLimit) : null,
        difficulty: Number(b.difficulty) || 3,
        status: b.status || "PENDING_REVIEW",
        createdBy: req.user.id,
      },
    });
    ok(res, fmtQ(q), "创建成功");
  })
);

// PUT /api/language/questions/:id — 更新语言题(教师/管理员)
router.put(
  "/questions/:id",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const existed = await prisma.languageQuestion.findUnique({ where: { id: req.params.id } });
    if (!existed) return fail(res, 404, "题目不存在");
    const b = req.body || {};
    const data = {};
    for (const key of ["examType", "skill", "qType", "part", "groupTitle", "stem", "answer", "solution", "audioUrl", "materialId", "wordLimit", "difficulty", "status", "reviewNote"]) {
      if (b[key] !== undefined) {
        if (key === "part" || key === "wordLimit" || key === "difficulty") data[key] = Number(b[key]) || null;
        else if (key === "answer") data[key] = b[key] === "" || b[key] === null ? null : String(b[key]);
        else data[key] = b[key];
      }
    }
    if (b.options !== undefined) data.options = Array.isArray(b.options) ? JSON.stringify(b.options) : b.options;
    const q = await prisma.languageQuestion.update({ where: { id: req.params.id }, data });
    ok(res, fmtQ(q), "更新成功");
  })
);

// 语言题审核通过/退回(复用学科题审核语义:status=PUBLISHED / REJECTED)
router.post(
  "/questions/:id/review",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const existed = await prisma.languageQuestion.findUnique({ where: { id: req.params.id } });
    if (!existed) return fail(res, 404, "题目不存在");
    const { pass, note } = req.body || {};
    const q = await prisma.languageQuestion.update({
      where: { id: req.params.id },
      data: {
        status: pass ? "PUBLISHED" : "REJECTED",
        reviewNote: note ? String(note) : null,
      },
    });
    ok(res, { id: q.id, status: q.status }, pass ? "审核通过" : "已退回");
  })
);

// DELETE /api/language/questions/:id — 删除语言题(教师/管理员)
router.delete(
  "/questions/:id",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const existed = await prisma.languageQuestion.findUnique({ where: { id: req.params.id } });
    if (!existed) return fail(res, 404, "题目不存在");
    await prisma.languageAnswerRecord.deleteMany({ where: { questionId: existed.id } });
    await prisma.languageWrongBook.deleteMany({ where: { questionId: existed.id } });
    await prisma.languageQuestion.delete({ where: { id: existed.id } });
    ok(res, { id: existed.id }, "删除成功");
  })
);

// —— 语言材料(阅读文章/写作任务/口语提示) ——

// GET /api/language/materials?examType=&skill=&q=
router.get(
  "/materials",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { examType, skill, q } = req.query;
    const where = {};
    if (examType) where.examType = String(examType);
    if (skill) where.skill = String(skill);
    if (q) where.title = { contains: String(q).trim() };
    const list = await prisma.languageMaterial.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: { id: true, examType: true, skill: true, title: true, createdAt: true, updatedAt: true },
    });
    ok(res, { list, total: list.length });
  })
);

// GET /api/language/materials/:id — 材料详情(含正文与关联题目)
router.get(
  "/materials/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const m = await prisma.languageMaterial.findUnique({
      where: { id: req.params.id },
      include: { questions: { select: Q_FIELDS, orderBy: { createdAt: "asc" } } },
    });
    if (!m) return fail(res, 404, "材料不存在");
    ok(res, { ...m, questions: m.questions.map(fmtQ) });
  })
);

// POST /api/language/materials — 新增材料(教师/管理员)
router.post(
  "/materials",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    if (!b.content) return fail(res, 400, "材料内容必填");
    const m = await prisma.languageMaterial.create({
      data: {
        examType: b.examType || "IELTS",
        skill: b.skill || "READING",
        title: b.title ? String(b.title) : null,
        content: String(b.content),
      },
    });
    ok(res, m, "创建成功");
  })
);

// PUT /api/language/materials/:id — 更新材料
router.put(
  "/materials/:id",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const existed = await prisma.languageMaterial.findUnique({ where: { id: req.params.id } });
    if (!existed) return fail(res, 404, "材料不存在");
    const b = req.body || {};
    const data = {};
    for (const key of ["examType", "skill", "title", "content"]) {
      if (b[key] !== undefined) data[key] = b[key];
    }
    const m = await prisma.languageMaterial.update({ where: { id: req.params.id }, data });
    ok(res, m, "更新成功");
  })
);

// DELETE /api/language/materials/:id — 删除材料(同时解除题目关联)
router.delete(
  "/materials/:id",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const existed = await prisma.languageMaterial.findUnique({ where: { id: req.params.id } });
    if (!existed) return fail(res, 404, "材料不存在");
    await prisma.languageQuestion.updateMany({ where: { materialId: existed.id }, data: { materialId: null } });
    await prisma.languageMaterial.delete({ where: { id: existed.id } });
    ok(res, { id: existed.id }, "删除成功");
  })
);

// —— 阅读篇章(一篇文章 + 绑定它的若干题目,作为一个整体单元) ——
// 数据仍复用 LanguageMaterial(文章) + LanguageQuestion.materialId(绑定),不改 schema

const PASSAGE_QTYPES = ["TRUE_FALSE_NG", "FILL_BLANK", "SINGLE_CHOICE", "MULTIPLE_CHOICE", "MATCHING", "HEADING"];

function fmtPassage(m) {
  const qs = (m.questions || []).map(fmtQ);
  const statusCount = {};
  for (const q of qs) statusCount[q.status] = (statusCount[q.status] || 0) + 1;
  const typeCount = {};
  for (const q of qs) typeCount[q.qType] = (typeCount[q.qType] || 0) + 1;
  return {
    id: m.id,
    examType: m.examType,
    skill: m.skill,
    title: m.title,
    content: m.content,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    questionCount: qs.length,
    statusCount,
    typeCount,
    questions: qs,
  };
}

// 校验并归一化一道篇章内题目
function normPassageQuestion(raw, idx) {
  const qType = String(raw.qType || "").trim();
  if (!PASSAGE_QTYPES.includes(qType)) throw new Error(`第 ${idx + 1} 题:题型不合法`);
  const stem = String(raw.stem || "").trim();
  if (!stem) throw new Error(`第 ${idx + 1} 题:题干必填`);
  const isChoice = ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "MATCHING", "HEADING"].includes(qType);
  let options = null;
  if (isChoice) {
    const arr = (Array.isArray(raw.options) ? raw.options : []).map((s) => String(s || "").trim()).filter(Boolean);
    if (arr.length < 2) throw new Error(`第 ${idx + 1} 题:选择/配对/标题题至少需要 2 个选项`);
    options = JSON.stringify(arr);
  }
  const answer = raw.answer === undefined || raw.answer === null || String(raw.answer).trim() === "" ? null : String(raw.answer).trim();
  if (!answer) throw new Error(`第 ${idx + 1} 题:客观题必须填写答案`);
  return {
    qType,
    stem,
    options,
    answer,
    solution: raw.solution ? String(raw.solution) : null,
    difficulty: Number(raw.difficulty) || 3,
  };
}

// GET /api/language/passages?examType=&skill=&status=&q=
// 返回「一篇文章 + 其绑定题目」的整体单元列表(教师/管理员)
router.get(
  "/passages",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { examType, skill, status, q } = req.query;
    const where = { skill: skill ? String(skill) : "READING" };
    if (examType) where.examType = String(examType);
    if (q) {
      const kw = String(q).trim();
      where.OR = [{ title: { contains: kw } }, { content: { contains: kw } }];
    }
    const list = await prisma.languageMaterial.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { questions: { select: Q_FIELDS, orderBy: [{ part: "asc" }, { createdAt: "asc" }] } },
    });
    let rows = list.map(fmtPassage);
    if (status) rows = rows.filter((p) => (p.statusCount[String(status)] || 0) > 0);
    ok(res, { list: rows, total: rows.length });
  })
);

// GET /api/language/passages/:id — 单篇详情
router.get(
  "/passages/:id",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const m = await prisma.languageMaterial.findUnique({
      where: { id: req.params.id },
      include: { questions: { select: Q_FIELDS, orderBy: [{ part: "asc" }, { createdAt: "asc" }] } },
    });
    if (!m) return fail(res, 404, "篇章不存在");
    ok(res, fmtPassage(m));
  })
);

// POST /api/language/passages — 一次创建「一篇文章 + 其题目」
// body: { examType, skill, title, content, part?, groupTitle?, status?, questions: [...] }
router.post(
  "/passages",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const content = String(b.content || "").trim();
    if (!content) return fail(res, 400, "文章正文必填");
    if (!Array.isArray(b.questions) || b.questions.length === 0) return fail(res, 400, "请至少录入一道题目");
    let normed;
    try {
      normed = b.questions.map((raw, i) => normPassageQuestion(raw, i));
    } catch (e) {
      return fail(res, 400, e.message);
    }
    const examType = b.examType || "IELTS";
    const skill = b.skill || "READING";
    const status = ["DRAFT", "PENDING_REVIEW", "PUBLISHED"].includes(b.status) ? b.status : "PENDING_REVIEW";
    const part = b.part ? Number(b.part) : null;
    const groupTitle = b.groupTitle ? String(b.groupTitle) : b.title ? String(b.title) : null;

    const created = await prisma.$transaction(async (tx) => {
      const m = await tx.languageMaterial.create({
        data: { examType, skill, title: b.title ? String(b.title) : null, content },
      });
      for (const nq of normed) {
        await tx.languageQuestion.create({
          data: {
            examType, skill, qType: nq.qType, part, groupTitle,
            stem: nq.stem, options: nq.options, answer: nq.answer, solution: nq.solution,
            materialId: m.id, difficulty: nq.difficulty, status,
            createdBy: req.user.id,
          },
        });
      }
      return m;
    });
    ok(res, { id: created.id, questionCount: normed.length }, "篇章创建成功");
  })
);

// PUT /api/language/passages/:id — 更新整篇(文章正文 + 题目增删改)
// questions 中带 id 的更新,不带 id 的新增,原有但未出现在列表中的删除
router.put(
  "/passages/:id",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const existed = await prisma.languageMaterial.findUnique({
      where: { id: req.params.id },
      include: { questions: { select: { id: true, status: true, part: true }, orderBy: { createdAt: "asc" } } },
    });
    if (!existed) return fail(res, 404, "篇章不存在");
    const b = req.body || {};
    const examType = b.examType || existed.examType;
    const skill = b.skill || existed.skill;
    const part = b.part !== undefined ? (b.part ? Number(b.part) : null) : undefined;
    // 未显式传 part 时,新增题目继承篇内已有题目的 Passage 序号,避免排序错乱
    const inheritPart = existed.questions.find((x) => x.part !== null && x.part !== undefined)?.part ?? null;
    const groupTitle = b.title !== undefined ? (b.title ? String(b.title) : null) : undefined;

    let normed = null;
    if (b.questions !== undefined) {
      if (!Array.isArray(b.questions) || b.questions.length === 0) return fail(res, 400, "请至少保留一道题目");
      try {
        normed = b.questions.map((raw, i) => ({ ...normPassageQuestion(raw, i), id: raw.id ? String(raw.id) : null }));
      } catch (e) {
        return fail(res, 400, e.message);
      }
      const keep = new Set(normed.filter((x) => x.id).map((x) => x.id));
      for (const id of keep) {
        if (!existed.questions.some((q) => q.id === id)) return fail(res, 400, "存在不属于本篇章的题目 id");
      }
    }

    await prisma.$transaction(async (tx) => {
      const mData = {};
      if (b.title !== undefined) mData.title = b.title ? String(b.title) : null;
      if (b.content !== undefined) mData.content = String(b.content);
      if (b.examType !== undefined) mData.examType = examType;
      if (b.skill !== undefined) mData.skill = skill;
      if (Object.keys(mData).length) await tx.languageMaterial.update({ where: { id: existed.id }, data: mData });

      if (!normed) return;
      const keep = new Set(normed.filter((x) => x.id).map((x) => x.id));
      const removed = existed.questions.filter((q) => !keep.has(q.id)).map((q) => q.id);
      if (removed.length) {
        await tx.languageAnswerRecord.deleteMany({ where: { questionId: { in: removed } } });
        await tx.languageWrongBook.deleteMany({ where: { questionId: { in: removed } } });
        await tx.languageQuestion.deleteMany({ where: { id: { in: removed } } });
      }
      for (const nq of normed) {
        const data = {
          examType, skill, qType: nq.qType, stem: nq.stem, options: nq.options,
          answer: nq.answer, solution: nq.solution, difficulty: nq.difficulty,
        };
        if (part !== undefined) data.part = part;
        if (groupTitle !== undefined) data.groupTitle = groupTitle;
        if (nq.id) {
          await tx.languageQuestion.update({ where: { id: nq.id }, data });
        } else {
          await tx.languageQuestion.create({
            data: { ...data, part: part !== undefined ? part : inheritPart, groupTitle: groupTitle ?? null, materialId: existed.id, status: "PENDING_REVIEW", createdBy: req.user.id },
          });
        }
      }
    });
    ok(res, { id: existed.id }, "篇章已更新");
  })
);

// POST /api/language/passages/:id/review — 整篇审核(通过/退回,批量作用于篇内所有题目)
router.post(
  "/passages/:id/review",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const existed = await prisma.languageMaterial.findUnique({ where: { id: req.params.id } });
    if (!existed) return fail(res, 404, "篇章不存在");
    const { pass, note } = req.body || {};
    const r = await prisma.languageQuestion.updateMany({
      where: { materialId: existed.id },
      data: { status: pass ? "PUBLISHED" : "REJECTED", reviewNote: note ? String(note) : null },
    });
    ok(res, { id: existed.id, count: r.count }, pass ? `整篇审核通过(${r.count} 题)` : `整篇已退回(${r.count} 题)`);
  })
);

// DELETE /api/language/passages/:id — 删除整篇(文章 + 其题目 + 作答/错题记录)
router.delete(
  "/passages/:id",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const existed = await prisma.languageMaterial.findUnique({
      where: { id: req.params.id },
      include: { questions: { select: { id: true } } },
    });
    if (!existed) return fail(res, 404, "篇章不存在");
    const qids = existed.questions.map((q) => q.id);
    await prisma.$transaction(async (tx) => {
      if (qids.length) {
        await tx.languageAnswerRecord.deleteMany({ where: { questionId: { in: qids } } });
        await tx.languageWrongBook.deleteMany({ where: { questionId: { in: qids } } });
        await tx.languageQuestion.deleteMany({ where: { id: { in: qids } } });
      }
      await tx.languageMaterial.delete({ where: { id: existed.id } });
    });
    ok(res, { id: existed.id, questionCount: qids.length }, "整篇已删除");
  })
);

// —— 阅读篇章 PDF 导入(视觉模型抽取,返回草稿供教师确认后再保存) ——

// 视觉模型返回的原始篇章 → 前端可直接填表的草稿
function draftFromRaw(raw) {
  const qs = Array.isArray(raw?.questions) ? raw.questions : [];
  const questions = [];
  for (const r of qs) {
    let qType = String(r?.qType || "").trim().toUpperCase();
    const options = (Array.isArray(r?.options) ? r.options : [])
      .map((s) => String(s || "").replace(/^[A-Ha-h][.、)]\s*/, "").trim())
      .filter(Boolean);
    if (!PASSAGE_QTYPES.includes(qType)) qType = options.length >= 2 ? "SINGLE_CHOICE" : "FILL_BLANK";
    let answer = r?.answer === undefined || r?.answer === null ? "" : String(r.answer).trim();
    // 选择类题:答案给的是选项正文时换算成字母
    if (["SINGLE_CHOICE", "MULTIPLE_CHOICE", "MATCHING", "HEADING"].includes(qType) && answer.length > 1) {
      const hit = options.findIndex((o) => o.toLowerCase() === answer.toLowerCase());
      if (hit >= 0) answer = String.fromCharCode(65 + hit);
    }
    const stem = String(r?.stem || "").trim();
    if (!stem) continue;
    questions.push({
      qType,
      stem,
      options: ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "MATCHING", "HEADING"].includes(qType) ? options : [],
      answer,
      solution: r?.solution ? String(r.solution) : "",
      difficulty: 3,
    });
  }
  return {
    title: String(raw?.title || "").trim(),
    content: String(raw?.content || "").trim(),
    questions,
  };
}

// POST /api/language/passages/import — 上传阅读 PDF(base64),异步抽取篇章草稿
// body: { filename, data, examType?, skill? } → { taskId }
router.post(
  "/passages/import",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { filename, data } = req.body || {};
    if (!data) return fail(res, 400, "请提供 PDF 文件 data(base64)");
    let buf;
    try {
      const s = String(data).includes(",") ? String(data).split(",")[1] : String(data);
      buf = Buffer.from(s, "base64");
    } catch {
      return fail(res, 400, "data 不是合法的 base64");
    }
    if (!buf.length) return fail(res, 400, "文件内容为空");
    if (buf.length > 15 * 1024 * 1024) return fail(res, 400, "文件过大(上限 15MB)");

    const task = createImportTask();
    updateImportTask(task.id, { progress: 3, message: "正在读取 PDF..." });
    (async () => {
      try {
        updateImportTask(task.id, { progress: 10, message: "正在栅格化 PDF..." });
        const pages = await rasterize(buf);
        updateImportTask(task.id, { progress: 30, message: `共 ${pages.length} 页,正在用视觉模型抽取文章与题目...这可能需要几十秒` });
        const raws = await extractReadingPassagesFromPdfPages(pages);
        const drafts = raws.map(draftFromRaw).filter((d) => d.content && d.questions.length);
        if (!drafts.length) throw new Error("未从该 PDF 抽取到任何「文章+题目」篇章,请确认这是阅读试卷");
        finishImportTask(task.id, { drafts, filename: filename || "", pageCount: pages.length });
      } catch (e) {
        const msg = e?.message === "VISION_NOT_CONFIGURED"
          ? "PDF 导入需要配置视觉模型:请在服务器 apps/api/.env 配置 VISION_API_KEY 后重启 API"
          : "阅读篇章解析失败:" + (e?.message || "未知错误");
        failImportTask(task.id, msg);
      }
    })();
    ok(res, { taskId: task.id }, "已开始解析");
  })
);

// GET /api/language/passages/import/:taskId — 轮询导入进度与结果
router.get(
  "/passages/import/:taskId",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const t = getImportTask(req.params.taskId);
    if (!t) return fail(res, 404, "任务不存在或已过期");
    ok(res, { id: t.id, status: t.status, progress: t.progress, message: t.message, result: t.result, error: t.error });
  })
);

// —— 语言试卷 ——

// GET /api/language/papers?examType=&skill=&kind=&status=
// 学生只读 READY 卷(卷内题目全部已发布)
router.get(
  "/papers",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { examType, skill, kind, status } = req.query;
    const where = {};
    if (examType) where.examType = String(examType);
    if (skill) where.skill = String(skill);
    if (kind) where.kind = String(kind);
    const isTeacher = ["TEACHER", "ADMIN"].includes(req.user.role);
    if (isTeacher && status) where.status = String(status);
    if (!isTeacher) where.status = "READY";
    const list = await prisma.languagePaper.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    const rows = [];
    for (const p of list) {
      const ids = parseIds(p.questionIds);
      let questionCount = ids.length;
      if (!isTeacher) {
        const cnt = await prisma.languageQuestion.count({ where: { id: { in: ids }, status: "PUBLISHED" } });
        questionCount = cnt;
      }
      rows.push({
        id: p.id, examType: p.examType, skill: p.skill, title: p.title,
        segments: parseIds(p.segments), mode: p.mode, durationMin: p.durationMin,
        source: p.source, kind: p.kind, status: p.status, questionCount,
        createdAt: p.createdAt,
      });
    }
    ok(res, { list: rows, total: rows.length });
  })
);

// GET /api/language/papers/:id — 卷详情(题目含材料/音频)
router.get(
  "/papers/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const p = await prisma.languagePaper.findUnique({ where: { id: req.params.id } });
    if (!p) return fail(res, 404, "试卷不存在");
    const isTeacher = ["TEACHER", "ADMIN"].includes(req.user.role);
    const ids = parseIds(p.questionIds);
    const questions = await prisma.languageQuestion.findMany({
      where: { id: { in: ids }, ...(isTeacher ? {} : { status: "PUBLISHED" }) },
      select: { ...Q_FIELDS, material: { select: { id: true, title: true, content: true } } },
    });
    // 保持卷内顺序
    const orderMap = new Map(questions.map((q) => [q.id, q]));
    const ordered = ids.map((id) => orderMap.get(id)).filter(Boolean);
    ok(res, {
      id: p.id, examType: p.examType, skill: p.skill, title: p.title,
      segments: parseIds(p.segments), mode: p.mode, durationMin: p.durationMin,
      source: p.source, kind: p.kind, status: p.status,
      questionCount: ordered.length,
      questions: ordered.map((q) => ({
        ...fmtQ(q),
        options: parseOptions(q.options),
        material: q.material ? { id: q.material.id, title: q.material.title, content: q.material.content } : null,
      })),
    });
  })
);

// POST /api/language/papers — 创建语言卷(教师/管理员)
// body: { examType, skill, title, questionIds, segments?, mode, durationMin?, kind }
router.post(
  "/papers",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    if (!b.examType || !b.title) return fail(res, 400, "examType、title 必填");
    if (!Array.isArray(b.questionIds) || b.questionIds.length === 0) return fail(res, 400, "请选择至少一道题");
    const ids = b.questionIds.map(String);
    const cnt = await prisma.languageQuestion.count({ where: { id: { in: ids } } });
    if (cnt !== ids.length) return fail(res, 400, "存在无效的题目 id");
    const p = await prisma.languagePaper.create({
      data: {
        examType: b.examType,
        skill: b.skill || "READING",
        title: String(b.title),
        questionIds: JSON.stringify(ids),
        segments: Array.isArray(b.segments) && b.segments.length ? JSON.stringify(b.segments) : null,
        mode: b.mode === "EXAM" ? "EXAM" : "PRACTICE",
        durationMin: b.durationMin ? Number(b.durationMin) : null,
        source: b.source ? String(b.source) : null,
        kind: b.kind || "CUSTOM",
        status: "READY",
      },
    });
    ok(res, { id: p.id, title: p.title }, "组卷成功");
  })
);

// PUT /api/language/papers/:id — 更新语言卷
router.put(
  "/papers/:id",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const existed = await prisma.languagePaper.findUnique({ where: { id: req.params.id } });
    if (!existed) return fail(res, 404, "试卷不存在");
    const b = req.body || {};
    const data = {};
    for (const key of ["examType", "skill", "title", "source", "kind", "mode", "durationMin", "status"]) {
      if (b[key] !== undefined) data[key] = b[key];
    }
    if (b.questionIds !== undefined) {
      if (!Array.isArray(b.questionIds) || !b.questionIds.length) return fail(res, 400, "请选择至少一道题");
      data.questionIds = JSON.stringify(b.questionIds.map(String));
    }
    if (b.segments !== undefined) data.segments = Array.isArray(b.segments) ? JSON.stringify(b.segments) : null;
    const p = await prisma.languagePaper.update({ where: { id: req.params.id }, data });
    ok(res, { id: p.id }, "更新成功");
  })
);

// DELETE /api/language/papers/:id — 删除语言卷
router.delete(
  "/papers/:id",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const existed = await prisma.languagePaper.findUnique({ where: { id: req.params.id } });
    if (!existed) return fail(res, 404, "试卷不存在");
    // 保护:若仍有作业/考试分发引用该卷,禁止删除(否则会让学生端点开作业报"试卷不存在")
    const refCount = await prisma.assignment.count({ where: { languagePaperId: existed.id } });
    if (refCount > 0) {
      return fail(res, 400, "该试卷已布置给学生的作业/考试,无法删除。请先在「作业分发」中撤回相关作业后再删除。");
    }
    await prisma.languageSession.updateMany({ where: { paperId: existed.id }, data: { paperId: null } });
    await prisma.languagePaper.delete({ where: { id: existed.id } });
    ok(res, { id: existed.id }, "删除成功");
  })
);

// —— 语言会话(学生开卷) ——

// POST /api/language/sessions — 创建语言会话
// body: { paperId, mode?, assignmentId? }
// 支持作业:assignment 关联 languagePaper 时,paperId 由作业决定
router.post(
  "/sessions",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { paperId, mode, assignmentId } = req.body || {};
    let paper = null;
    let assignment = null;

    if (assignmentId) {
      assignment = await prisma.assignment.findUnique({
        where: { id: String(assignmentId) },
        include: { targets: { where: { studentId: req.user.id } } },
      });
      if (!assignment || !assignment.languagePaperId) return fail(res, 403, "您没有被布置这份作业");
      if (assignment.status !== "ACTIVE") return fail(res, 400, "该作业已停止");
      // 注意:过期语言作业仍允许作答补交(会打「逾期补交」标签),此处不再拦截 dueAt
      const target = assignment.targets[0];
      if (!target) return fail(res, 403, "您没有被布置这份作业");
      if (target.status === "SUBMITTED") return fail(res, 400, "这份作业已提交,请勿重复作答");
      paper = await prisma.languagePaper.findUnique({ where: { id: assignment.languagePaperId } });
      if (!paper) return fail(res, 404, "作业对应的试卷不存在");
    } else if (paperId) {
      paper = await prisma.languagePaper.findUnique({ where: { id: String(paperId) } });
      if (!paper) return fail(res, 404, "试卷不存在");
      if (paper.status !== "READY") return fail(res, 400, "该试卷尚未开放");
    } else {
      return fail(res, 400, "请指定试卷");
    }

    const aMode = mode === "EXAM" ? "EXAM" : paper.mode === "EXAM" ? "EXAM" : "PRACTICE";
    let durationMin = paper.durationMin;
    if (aMode === "EXAM" && !durationMin) {
      // 全真连考卷:由分段求和
      const segs = parseIds(paper.segments);
      if (segs.length) durationMin = segs.reduce((a, s) => a + (Number(s.durationMin) || 0), 0);
      if (!durationMin) return fail(res, 400, "模拟考必须配置时长");
    }

    const session = await prisma.languageSession.create({
      data: {
        studentId: req.user.id,
        paperId: paper.id,
        assignmentId: assignment?.id || null,
        examType: paper.examType,
        skill: paper.skill,
        mode: aMode,
        durationMin,
        total: parseIds(paper.questionIds).length,
      },
    });

    // 作业目标回写进行中
    if (assignment) {
      await prisma.assignmentStudent.updateMany({
        where: { assignmentId: assignment.id, studentId: req.user.id, status: "PENDING" },
        data: { status: "IN_PROGRESS", sessionId: session.id },
      });
    }

    // 返回卷详情(学生可见题目,不含答案)
    const ids = parseIds(paper.questionIds);
    const questions = await prisma.languageQuestion.findMany({
      where: { id: { in: ids }, status: "PUBLISHED" },
      select: { ...Q_FIELDS, material: { select: { id: true, title: true, content: true } } },
    });
    const orderMap = new Map(questions.map((q) => [q.id, q]));
    const ordered = ids.map((id) => orderMap.get(id)).filter(Boolean);
    ok(res, {
      sessionId: session.id,
      mode: aMode,
      durationMin,
      segments: parseIds(paper.segments),
      questions: ordered.map((q) => {
        const { answer, reviewNote, status, ...safe } = q;
        return { ...fmtQ(safe), options: parseOptions(q.options), answer: undefined, material: q.material };
      }),
    }, "会话已创建");
  })
);

// 保存单个作答(客观题实时判分并写入)
router.post(
  "/sessions/:id/answer",
  requireAuth,
  asyncHandler(async (req, res) => {
    const session = await prisma.languageSession.findUnique({ where: { id: req.params.id } });
    if (!session || session.studentId !== req.user.id) return fail(res, 404, "会话不存在");
    if (session.submittedAt) return fail(res, 400, "会话已提交,无法作答");
    const { questionId, selected, timeSpent } = req.body || {};
    if (!questionId) return fail(res, 400, "缺少题目 id");
    const question = await prisma.languageQuestion.findUnique({ where: { id: String(questionId) } });
    if (!question) return fail(res, 404, "题目不存在");
    const isObjective = ["FILL_BLANK", "SINGLE_CHOICE", "MULTIPLE_CHOICE", "MATCHING", "HEADING", "TRUE_FALSE_NG", "YES_NO_NG"].includes(question.qType);
    const isCorrect = isObjective ? isAnswerCorrect(question, selected) : null;
    await prisma.languageAnswerRecord.upsert({
      where: { sessionId_questionId: { sessionId: session.id, questionId: question.id } },
      create: {
        sessionId: session.id, questionId: question.id,
        selected: selected !== undefined ? String(selected) : null,
        isCorrect, timeSpent: timeSpent ? Number(timeSpent) : null,
      },
      update: {
        selected: selected !== undefined ? String(selected) : null,
        isCorrect, timeSpent: timeSpent ? Number(timeSpent) : null,
      },
    });
    ok(res, { questionId: question.id, isCorrect });
  })
);

// 保存写作/口语主观作答(selected 文本 / audioUrl 录音)
router.post(
  "/sessions/:id/answer/text",
  requireAuth,
  asyncHandler(async (req, res) => {
    const session = await prisma.languageSession.findUnique({ where: { id: req.params.id } });
    if (!session || session.studentId !== req.user.id) return fail(res, 404, "会话不存在");
    if (session.submittedAt) return fail(res, 400, "会话已提交,无法作答");
    const { questionId, text, audioUrl } = req.body || {};
    if (!questionId) return fail(res, 400, "缺少题目 id");
    const question = await prisma.languageQuestion.findUnique({ where: { id: String(questionId) } });
    if (!question) return fail(res, 404, "题目不存在");
    await prisma.languageAnswerRecord.upsert({
      where: { sessionId_questionId: { sessionId: session.id, questionId: question.id } },
      create: {
        sessionId: session.id, questionId: question.id,
        selected: text ? String(text) : null,
        audioUrl: audioUrl ? String(audioUrl) : null,
        isCorrect: null,
      },
      update: {
        selected: text !== undefined ? String(text) : undefined,
        audioUrl: audioUrl !== undefined ? String(audioUrl) : undefined,
        isCorrect: null,
      },
    });
    ok(res, { questionId: question.id }, "已保存");
  })
);

// POST /api/language/sessions/:id/submit — 交卷并判分
router.post(
  "/sessions/:id/submit",
  requireAuth,
  asyncHandler(async (req, res) => {
    const session = await prisma.languageSession.findUnique({
      where: { id: req.params.id },
      include: { assignment: { select: { dueAt: true } } },
    });
    if (!session || session.studentId !== req.user.id) return fail(res, 404, "会话不存在");
    if (session.submittedAt) return fail(res, 400, "会话已提交");

    const records = await prisma.languageAnswerRecord.findMany({
      where: { sessionId: session.id },
      include: { question: { select: { id: true, qType: true, answer: true, skill: true } } },
    });
    const objective = records.filter((r) => OBJECTIVE_QTYPES.includes(r.question.qType));
    const subjective = records.filter((r) => !OBJECTIVE_QTYPES.includes(r.question.qType));
    const correct = objective.filter((r) => r.isCorrect).length;
    const total = records.length;
    const score = correct;

    await safeSeedTables();

    // —— 按技能分别计分(H2) ——
    // 旧实现用 records.length 当分母估算 Band,一旦卷里混了写作/口语,阅读正确率的分母
    // 平白多出主观题数 ⇒ 分数必然偏低。这里给每个技能自带 correct/total。
    const bySkill = new Map();
    for (const r of objective) {
      const k = r.question.skill || session.skill || "READING";
      const it = bySkill.get(k) || { correct: 0, total: 0 };
      it.total += 1;
      if (r.isCorrect) it.correct += 1;
      bySkill.set(k, it);
    }
    const skillBands = {};
    let scaled = false;
    for (const [k, v] of bySkill.entries()) {
      const { rows, maxRaw } = await loadBandTable(session.examType, k);
      const res2 = lookupBand(rows, v.correct, v.total, maxRaw);
      skillBands[k] = { band: res2.band, correct: v.correct, total: v.total, scaled: res2.scaled };
      if (res2.scaled) scaled = true;
    }
    // 主观技能占位:等教师批改后再回填 band(composeOverall 见到 null 就不合成总分)
    for (const r of subjective) {
      const k = r.question.skill || session.skill;
      if (!skillBands[k]) skillBands[k] = { band: null, pending: true };
    }

    // 目标分快照(事后目标改了也不影响这批作答的达标判定)
    const goal = await prisma.languageGoal
      .findUnique({ where: { studentId_examType: { studentId: req.user.id, examType: session.examType } } })
      .catch(() => null);
    const goalBand = goal && goal.overall !== null && goal.overall !== undefined ? goal.overall : null;

    const { overallBand } = composeOverall(skillBands);
    // session.band 语义统一为"本会话的主分数":
    //   多技能卷 → 合成总分;单技能卷 → 该技能 Band(保持与旧前端兼容)
    let band = overallBand;
    if (band === null) {
      const keys = Object.keys(skillBands);
      if (keys.length === 1) band = skillBands[keys[0]].band ?? null;
    }

    const updated = await prisma.languageSession.update({
      where: { id: session.id },
      data: {
        score, correctCount: correct, total, band,
        skillBands: JSON.stringify(skillBands),
        overallBand,
        goalBand,
        scoringVersion: SCORING_VERSION,
        scaled,
        submittedAt: new Date(),
      },
    });

    // 作业回写已交(逾期则标记补交)
    if (session.assignmentId) {
      const isLateSubmit = !!(
        session.assignment?.dueAt && new Date() > new Date(session.assignment.dueAt)
      );
      await prisma.assignmentStudent.updateMany({
        where: { assignmentId: session.assignmentId, studentId: req.user.id },
        data: { status: "SUBMITTED", submittedAt: new Date(), lateSubmit: isLateSubmit },
      });
    }

    // 错题本:客观错题写入
    const wrong = objective.filter((r) => !r.isCorrect);
    for (const w of wrong) {
      await prisma.languageWrongBook.upsert({
        where: { studentId_questionId: { studentId: req.user.id, questionId: w.questionId } },
        create: { studentId: req.user.id, questionId: w.questionId, wrongCount: 1 },
        update: { wrongCount: { increment: 1 }, mastered: false },
      });
    }

    ok(res, {
      score, total, correctCount: correct,
      band,
      skillBands,
      overallBand,
      goalBand,
      scaled,
      scoringVersion: SCORING_VERSION,
      needsReview: subjective.length > 0,
      timedOut: false,
      details: (() => {
        const seen = new Set();
        return records
          .filter((r) => {
            if (seen.has(r.questionId)) return false;
            seen.add(r.questionId);
            return true;
          })
          .map((r) => ({ questionId: r.questionId, selected: r.selected, isCorrect: r.isCorrect }));
      })(),
    }, "判分完成");
  })
);

// GET /api/language/sessions/:id — 会话详情(作答后查看成绩/批改)
router.get(
  "/sessions/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const session = await prisma.languageSession.findUnique({
      where: { id: req.params.id },
      include: {
        records: { include: { question: { select: { ...Q_FIELDS, material: { select: { id: true, title: true, content: true } } } } } },
      },
    });
    if (!session || (session.studentId !== req.user.id && !["TEACHER", "ADMIN"].includes(req.user.role))) {
      return fail(res, 404, "会话不存在");
    }
    ok(res, {
      id: session.id, examType: session.examType, skill: session.skill, mode: session.mode,
      allowReplay: session.mode !== "EXAM",
      durationMin: session.durationMin, score: session.score, total: session.total,
      correctCount: session.correctCount, band: session.band,
      skillBands: parseSkillBands(session.skillBands),
      overallBand: session.overallBand, goalBand: session.goalBand,
      scoringVersion: session.scoringVersion, scaled: session.scaled,
      startedAt: session.startedAt, submittedAt: session.submittedAt,
      paper: session.paper ? { id: session.paper.id, title: session.paper.title } : null,
      details: (() => {
        const seen = new Set();
        return session.records
          .filter((r) => {
            if (seen.has(r.questionId)) return false;
            seen.add(r.questionId);
            return true;
          })
          .map((r) => ({
            questionId: r.questionId,
            stem: r.question.stem,
            options: parseOptions(r.question.options),
            answer: r.question.answer,
            solution: r.question.solution,
            audioUrl: r.question.audioUrl,
            material: r.question.material ? { id: r.question.material.id, title: r.question.material.title, content: r.question.material.content } : null,
            selected: r.selected,
            isCorrect: r.isCorrect,
            band: r.band,
            feedback: r.feedback,
            recordAudioUrl: r.audioUrl,
            qType: r.question.qType,
          }));
      })(),
    });
  })
);

// GET /api/language/sessions — 我的语言会话历史
router.get(
  "/sessions",
  requireAuth,
  asyncHandler(async (req, res) => {
    const where = { studentId: req.user.id };
    if (req.query.skill) where.skill = String(req.query.skill);
    const list = await prisma.languageSession.findMany({
      where,
      orderBy: { startedAt: "desc" },
      take: 50,
      select: {
        id: true, examType: true, skill: true, mode: true, score: true, total: true,
        correctCount: true, band: true, startedAt: true, submittedAt: true,
        // V2.4.126:一并返回评分引擎产出,使前端不必也不能再自行估算
        skillBands: true, overallBand: true, goalBand: true, scoringVersion: true, scaled: true,
        paper: { select: { title: true } },
      },
    });
    ok(res, { list });
  })
);

// —— 学生端:我的语言作业 ——
// GET /api/language/my-assignments — 教师布置给我的语言作业(未完成优先)
router.get(
  "/my-assignments",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user.role !== "STUDENT") return fail(res, 403, "仅学生可查看");
    const targets = await prisma.assignmentStudent.findMany({
      where: { studentId: req.user.id, assignment: { languagePaperId: { not: null } } },
      include: {
        assignment: {
          include: { languagePaper: { select: { id: true, title: true, examType: true, skill: true, mode: true, durationMin: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    ok(res, {
      list: targets.map((t) => {
        const a = t.assignment;
        const paper = a.languagePaper;
        let effective = t.status;
        if (effective === "PENDING" && a.dueAt && new Date() > a.dueAt) effective = "EXPIRED";
        return {
          id: a.id, title: a.title, note: a.note, mode: a.mode, dueAt: a.dueAt,
          status: effective, submittedAt: t.submittedAt, sessionId: t.sessionId,
          lateSubmit: t.lateSubmit,
          paper: paper ? { id: paper.id, title: paper.title, examType: paper.examType, skill: paper.skill, mode: paper.mode, durationMin: paper.durationMin } : null,
        };
      }),
    });
  })
);

// —— 教师端:写作/口语批改台 ——

// GET /api/language/review-pool?examType=&skill= — 待批改会话(写作/口语)
router.get(
  "/review-pool",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { examType, skill, scope } = req.query;
    const where = { submittedAt: { not: null } };
    if (examType) where.examType = String(examType);
    if (skill) where.skill = String(skill);
    // H8:支持 ?scope=mine 只看自己布置的作业产生的会话。
    // 默认值保持 all —— 教师本质是同事关系,而把"学生自主练习产生的待批改"藏起来
    // 会直接破坏现有批改工作流,故此项做成**可选收窄**而非改变默认行为。
    if (String(scope || "all") === "mine") {
      const mine = await prisma.assignment.findMany({
        where: { teacherId: req.user.id, languagePaperId: { not: null } },
        select: { id: true },
      });
      const ids = mine.map((a) => a.id);
      // 空数组必须是"零结果"而不是"不过滤"(与教务侧 visibleClassIds 的同一条铁律)
      if (!ids.length) {
        ok(res, { list: [], note: "你还没有布置过语言作业" });
        return;
      }
      where.assignmentId = { in: ids };
    }
    // H6:列表不再 include 全量题目字段与全部 records
    const sessions = await prisma.languageSession.findMany({
      where,
      include: {
        student: { select: { id: true, name: true, email: true } },
        paper: { select: { id: true, title: true } },
        records: { select: { band: true, question: { select: { qType: true } } } },
      },
      orderBy: { submittedAt: "desc" },
      take: 100,
    });
    const list = [];
    for (const s of sessions) {
      const subs = s.records.filter((r) => SUBJECTIVE_QTYPES.includes(r.question.qType));
      const pending = subs.filter((r) => r.band === null || r.band === undefined);
      if (subs.length === 0) continue;
      list.push({
        id: s.id,
        student: s.student,
        examType: s.examType,
        skill: s.skill,
        mode: s.mode,
        paperTitle: s.paper?.title || null,
        submittedAt: s.submittedAt,
        totalSub: subs.length,
        pendingSub: pending.length,
        overallBand: s.overallBand, // V2.4.126:列表直接看合成总分,不必逐条点开
      });
    }
    ok(res, { list });
  })
);

// GET /api/language/review-pool/:sessionId — 批改详情(学生作答 + 参考)
router.get(
  "/review-pool/:sessionId",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const session = await prisma.languageSession.findUnique({
      where: { id: req.params.sessionId },
      include: {
        student: { select: { id: true, name: true, email: true } },
        paper: { select: { title: true } },
        records: { include: { question: { select: { ...Q_FIELDS, material: { select: { id: true, title: true, content: true } } } } } },
      },
    });
    if (!session) return fail(res, 404, "会话不存在");
    const subs = session.records.filter((r) => SUBJECTIVE_QTYPES.includes(r.question.qType));
    ok(res, {
      id: session.id,
      student: session.student,
      paperTitle: session.paper?.title,
      examType: session.examType,
      skill: session.skill,
      mode: session.mode,
      startedAt: session.startedAt,
      submittedAt: session.submittedAt,
      band: session.band,
      overallBand: session.overallBand,
      skillBands: parseSkillBands(session.skillBands),
      goalBand: session.goalBand,
      scoringVersion: session.scoringVersion,
      dims: dimsForSkill(subs[0]?.question?.skill || session.skill),
      rubricVersion: RUBRIC_VERSION,
      objectiveSummary: {
        score: session.score, total: session.total, correctCount: session.correctCount,
      },
      items: subs.map((r) => ({
        recordId: r.id,
        questionId: r.questionId,
        qType: r.question.qType,
        skill: r.question.skill,
        stem: r.question.stem,
        groupTitle: r.question.groupTitle,
        wordLimit: r.question.wordLimit,
        solution: r.question.solution,
        audioUrl: r.question.audioUrl,
        material: r.question.material ? { id: r.question.material.id, title: r.question.material.title, content: r.question.material.content } : null,
        selected: r.selected,
        recordAudioUrl: r.audioUrl,
        band: r.band,
        feedback: r.feedback,
        subscores: parseSubscores(r.subscores), // V2.4.126:四维已评分数(回显用)
        gradedAt: r.gradedAt,
      })),
    });
  })
);

// POST /api/language/review-pool/:sessionId/grade — 批改单个作答(四维 / 直接打分 + 评语)
// body: { recordId, band?, subscores?, feedback? }
//   subscores 给出时(如写作 {"TR":6.5,"CC":6,"LR":7,"GRA":6}),由四维自动合成该题 Band;
//   未给出则沿用直接传入的 band。两者混用时以四维为准,避免"维度与总分自相矛盾"。
router.post(
  "/review-pool/:sessionId/grade",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const session = await prisma.languageSession.findUnique({ where: { id: req.params.sessionId } });
    if (!session) return fail(res, 404, "会话不存在");
    const { recordId, band, feedback, subscores } = req.body || {};
    if (!recordId) return fail(res, 400, "缺少作答记录 id");
    const rec = await prisma.languageAnswerRecord.findUnique({
      where: { id: String(recordId) },
      include: { question: { select: { skill: true, qType: true } } },
    });
    if (!rec || rec.sessionId !== session.id) return fail(res, 404, "作答记录不存在");

    // —— 四维 → 单题 Band ——
    let sub = null;
    let b = null;
    if (subscores && typeof subscores === "object" && !Array.isArray(subscores)) {
      const skill = rec.question.skill || session.skill;
      const clean = {};
      for (const d of dimsForSkill(skill)) {
        const v = Number(subscores[d]);
        if (Number.isFinite(v) && v >= 0 && v <= 9) clean[d] = v;
      }
      if (Object.keys(clean).length) {
        if (Object.keys(clean).length !== Object.keys(subscores).length) return fail(res, 400, "四维分数含非法值(须为 0-9 的数字)");
        sub = clean;
        b = bandFromSubscores(skill, clean);
      }
    }
    if (b === null) {
      const raw = band !== undefined && band !== null && band !== "" ? Number(band) : null;
      if (raw !== null && (!Number.isFinite(raw) || raw < 0 || raw > 9)) return fail(res, 400, "Band 范围 0-9");
      b = raw;
    }

    await prisma.languageAnswerRecord.update({
      where: { id: rec.id },
      data: {
        band: b,
        feedback: feedback ? String(feedback) : null,
        subscores: sub ? JSON.stringify(sub) : null,
        rubricVersion: sub ? RUBRIC_VERSION : null,
        gradedBy: req.user.id,
        gradedAt: new Date(),
      },
    });

    // —— 重新合成会话分数(H1 根治点) ——
    const full = await prisma.languageAnswerRecord.findMany({
      where: { sessionId: session.id },
      include: { question: { select: { qType: true, skill: true } } },
    });

    let skillBands = parseSkillBands(session.skillBands);
    if (!skillBands) {
      // 评分引擎上线前提交的历史会话:客观部分按新口径补算,使合成结果完整
      skillBands = {};
      await safeSeedTables();
      const bySkill = new Map();
      for (const r of full) {
        if (!OBJECTIVE_QTYPES.includes(r.question.qType)) continue;
        const k = r.question.skill || session.skill;
        const it = bySkill.get(k) || { correct: 0, total: 0 };
        it.total += 1;
        if (r.isCorrect) it.correct += 1;
        bySkill.set(k, it);
      }
      for (const [k, v] of bySkill.entries()) {
        const { rows, maxRaw } = await loadBandTable(session.examType, k);
        const rr = lookupBand(rows, v.correct, v.total, maxRaw);
        skillBands[k] = { band: rr.band, correct: v.correct, total: v.total, scaled: rr.scaled };
      }
    }

    // 主观技能:取该技能内已批改题目的平均分再进位到半分;同技能仍有未批改题则保持 pending
    const gradedBySkill = new Map();
    const countBySkill = new Map();
    for (const r of full) {
      if (!SUBJECTIVE_QTYPES.includes(r.question.qType)) continue;
      const k = r.question.skill || session.skill;
      countBySkill.set(k, (countBySkill.get(k) || 0) + 1);
      if (r.band !== null && r.band !== undefined) {
        const arr = gradedBySkill.get(k) || [];
        arr.push(Number(r.band));
        gradedBySkill.set(k, arr);
      }
    }
    for (const [k, cnt] of countBySkill.entries()) {
      const arr = gradedBySkill.get(k) || [];
      if (arr.length === 0 || arr.length < cnt) {
        skillBands[k] = { band: null, pending: true, totalSub: cnt, gradedSub: arr.length };
      } else {
        const avg = arr.reduce((a, x) => a + x, 0) / arr.length;
        skillBands[k] = { ...(skillBands[k] || {}), band: roundIeltsBand(avg), totalSub: cnt, gradedSub: arr.length, pending: false };
      }
    }

    const { overallBand } = composeOverall(skillBands);
    let bandFinal = overallBand;
    if (bandFinal === null) {
      const keys = Object.keys(skillBands);
      if (keys.length === 1) bandFinal = skillBands[keys[0]].band ?? null;
    }
    await prisma.languageSession.update({
      where: { id: session.id },
      data: {
        band: bandFinal,
        skillBands: JSON.stringify(skillBands),
        overallBand,
        scoringVersion: SCORING_VERSION,
      },
    });

    ok(res, {
      recordId: rec.id, band: b, subscores: sub, sessionBand: bandFinal,
      overallBand, skillBands, scoringVersion: SCORING_VERSION,
    }, "批改完成");
  })
);

// —— 语言学情统计(教师端) ——

// GET /api/language/stats/overview — 语言学习总览(人数/会话/Band 分布/薄弱题型)
router.get(
  "/stats/overview",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const sessions = await prisma.languageSession.findMany({
      where: { submittedAt: { not: null } },
      include: { records: { include: { question: { select: { qType: true, skill: true } } } } },
    });
    const students = await prisma.user.count({ where: { role: "STUDENT" } });
    const bySkill = new Map();
    const byBand = { "0-4": 0, "4.5-5.5": 0, "6-6.5": 0, "7-7.5": 0, "8-9": 0 };
    const qTypeAgg = new Map();
    for (const s of sessions) {
      const key = s.skill || "FULL";
      const item = bySkill.get(key) || { sessions: 0, avgBand: 0, totalBand: 0 };
      item.sessions += 1;
      if (s.band !== null && s.band !== undefined) {
        item.totalBand += s.band;
        if (s.band <= 4) byBand["0-4"] += 1;
        else if (s.band <= 5.5) byBand["4.5-5.5"] += 1;
        else if (s.band <= 6.5) byBand["6-6.5"] += 1;
        else if (s.band <= 7.5) byBand["7-7.5"] += 1;
        else byBand["8-9"] += 1;
      }
      bySkill.set(key, item);
    }
    for (const s of sessions) {
      for (const r of s.records) {
        if (r.isCorrect === null || r.isCorrect === undefined) continue;
        const qk = `${r.question.skill}·${r.question.qType}`;
        const it = qTypeAgg.get(qk) || { key: qk, attempts: 0, correct: 0 };
        it.attempts += 1;
        if (r.isCorrect) it.correct += 1;
        qTypeAgg.set(qk, it);
      }
    }
    ok(res, {
      students,
      sessions: sessions.length,
      bySkill: [...bySkill.entries()].map(([skill, v]) => ({
        skill,
        sessions: v.sessions,
        avgBand: v.sessions ? Math.round((v.totalBand / v.sessions) * 2) / 2 : null,
      })),
      byBand,
      weakQTypes: [...qTypeAgg.values()]
        .map((x) => ({ ...x, correctRate: x.attempts ? Math.round((x.correct / x.attempts) * 100) : 0 }))
        .sort((a, b) => a.correctRate - b.correctRate)
        .slice(0, 10),
    });
  })
);

// ============================================================
// V2.4.126 新增:评分引擎相关端点
// ============================================================

// GET /api/language/scoring-config — 当前评分口径与版本(全角色可读,供前端展示口径用)
router.get(
  "/scoring-config",
  requireAuth,
  asyncHandler(async (req, res) => {
    await safeSeedTables();
    ok(res, await scoringConfig(), "当前评分口径");
  })
);

// GET /api/language/band-tables?examType= — 查看 Band 换算表(教师/管理员)
router.get(
  "/band-tables",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    await safeSeedTables();
    const examType = String(req.query.examType || "IELTS");
    const list = await prisma.languageBandTable.findMany({
      where: { examType },
      orderBy: [{ skill: "asc" }, { effectiveFrom: "desc" }],
    });
    ok(res, {
      scoringVersion: SCORING_VERSION,
      list: list.map((t) => ({
        id: t.id, examType: t.examType, skill: t.skill, name: t.name,
        maxRaw: t.maxRaw, rows: parseRows(t.rows), isDefault: t.isDefault,
        effectiveFrom: t.effectiveFrom, updatedAt: t.updatedAt,
      })),
    });
  })
);

// PUT /api/language/band-tables/:id — 编辑换算表(教师/管理员)
// body: { name?, maxRaw?, rows: [{raw, band}], isDefault? }
router.put(
  "/band-tables/:id",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const t = await prisma.languageBandTable.findUnique({ where: { id: String(req.params.id) } });
    if (!t) return fail(res, 404, "换算表不存在");
    const { name, maxRaw, rows, isDefault } = req.body || {};
    const data = {};
    if (name !== undefined && String(name).trim()) data.name = String(name).trim();
    if (isDefault !== undefined) data.isDefault = !!isDefault;
    if (maxRaw !== undefined) {
      const m = Number(maxRaw);
      if (!Number.isFinite(m) || m <= 0) return fail(res, 400, "maxRaw 须为正整数");
      data.maxRaw = Math.round(m);
    }
    if (rows !== undefined) {
      if (!Array.isArray(rows) || rows.length === 0) return fail(res, 400, "rows 须为非空数组");
      const clean = rows
        .map((r) => ({ raw: Number(r?.raw), band: Number(r?.band) }))
        .filter((r) => Number.isFinite(r.raw) && Number.isFinite(r.band) && r.band >= 0 && r.band <= 9);
      if (clean.length !== rows.length) return fail(res, 400, "rows 含非法项(raw 须为数字,band 须为 0-9 数字)");
      data.rows = rowsToJson(clean.map((r) => [r.raw, r.band]));
    }
    const updated = await prisma.languageBandTable.update({ where: { id: t.id }, data });
    ok(res, {
      id: updated.id, skill: updated.skill, name: updated.name,
      maxRaw: updated.maxRaw, rows: parseRows(updated.rows), isDefault: updated.isDefault,
    }, "换算表已更新(仅影响此后提交的会话,历史会话保留原口径)");
  })
);

// rows → JSON(与 lang-scoring 内部表示保持一致)
function rowsToJson(pairs) {
  return JSON.stringify(pairs.map(([raw, band]) => ({ raw, band })));
}

// POST /api/language/band-tables/reset — 恢复官方默认换算表(仅管理员)
router.post(
  "/band-tables/reset",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const { skill, confirm } = req.body || {};
    // 与"清空课表"同规格的双重确认:不显式 confirm 一律拒绝
    if (confirm !== true) return fail(res, 400, "此操作会覆盖换算表,请传 confirm:true");
    const target = skill && ["LISTENING", "READING"].includes(String(skill)) ? String(skill) : null;
    await prisma.languageBandTable.deleteMany({ where: target ? { examType: "IELTS", skill: target } : { examType: "IELTS" } });
    await ensureDefaultBandTables();
    const list = await prisma.languageBandTable.findMany({ where: { examType: "IELTS" } });
    ok(res, { count: list.length, restored: target || "ALL" }, "已恢复官方默认换算表");
  })
);

// —— 目标分 ——

// GET /api/language/goals?examType=&studentId= — 读取目标分(学生自己;教师可指定学生)
router.get(
  "/goals",
  requireAuth,
  asyncHandler(async (req, res) => {
    let studentId = req.user.id;
    if (req.query.studentId) {
      if (!["TEACHER", "ADMIN"].includes(req.user.role)) return fail(res, 403, "无权查看他人目标分");
      studentId = String(req.query.studentId);
    }
    const examType = String(req.query.examType || "IELTS");
    const g = await prisma.languageGoal.findUnique({ where: { studentId_examType: { studentId, examType } } });
    ok(res, {
      examType,
      goal: g ? {
        overall: g.overall, listening: g.listening, reading: g.reading,
        writing: g.writing, speaking: g.speaking, targetDate: g.targetDate,
      } : null,
    });
  })
);

// PUT /api/language/goals — 写入目标分(学生自己;教师/管理员可代设)
// body: { examType?, overall?, listening?, reading?, writing?, speaking?, targetDate?, studentId? }
router.put(
  "/goals",
  requireAuth,
  asyncHandler(async (req, res) => {
    let studentId = req.user.id;
    const body = req.body || {};
    if (body.studentId) {
      if (!["TEACHER", "ADMIN"].includes(req.user.role)) return fail(res, 403, "无权设置他人目标分");
      studentId = String(body.studentId);
    }
    const examType = String(body.examType || "IELTS");
    const numOrNull = (v) => {
      if (v === undefined || v === null || v === "") return null;
      const n = Number(v);
      if (!Number.isFinite(n)) return undefined; // 非法值 → 明确报错,不静默置 null
      return Math.max(0, Math.min(9, Math.round(n * 2) / 2));
    };
    const data = {};
    for (const k of ["overall", "listening", "reading", "writing", "speaking"]) {
      if (k in body) {
        const v = numOrNull(body[k]);
        if (v === undefined) return fail(res, 400, `${k} 须为 0-9 的数字`);
        data[k] = v;
      }
    }
    if ("targetDate" in body) {
      data.targetDate = body.targetDate ? new Date(body.targetDate) : null;
    }
    const g = await prisma.languageGoal.upsert({
      where: { studentId_examType: { studentId, examType } },
      create: { studentId, examType, ...data },
      update: data,
    });
    ok(res, {
      examType: g.examType, overall: g.overall, listening: g.listening, reading: g.reading,
      writing: g.writing, speaking: g.speaking, targetDate: g.targetDate,
    }, "目标分已保存");
  })
);

// —— 错题本(补 G1 断链:此前表存在、写了数据,但没有任何读取端点) ——

// GET /api/language/wrong-book?examType=&skill=&mastered= — 学生自己的语言错题本
router.get(
  "/wrong-book",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { skill, qType, mastered } = req.query;
    const where = { studentId: req.user.id };
    if (skill) where.question = { ...(where.question || {}), skill: String(skill) };
    if (mastered !== undefined) where.mastered = String(mastered) !== "false";
    const list = await prisma.languageWrongBook.findMany({
      where,
      include: {
        question: {
          select: {
            ...Q_FIELDS,
            topic: true, tags: true, sourceRef: true, estSec: true,
            material: { select: { id: true, title: true } },
          },
        },
      },
      orderBy: [{ mastered: "asc" }, { wrongCount: "desc" }, { updatedAt: "desc" }],
      take: 300,
    });
    const items = list
      .filter((w) => (qType ? w.question.qType === String(qType) : true))
      .map((w) => ({
        questionId: w.questionId,
        wrongCount: w.wrongCount,
        mastered: w.mastered,
        updatedAt: w.updatedAt,
        question: { ...fmtQ(w.question), tags: parseTags(w.question.tags) },
      }));
    // 面板用的聚合:按技能 / 按题型分布
    const bySkill = {};
    const byQType = {};
    for (const it of items) {
      const s = it.question.skill || "OTHER";
      const qt = it.question.qType || "OTHER";
      bySkill[s] = (bySkill[s] || 0) + 1;
      byQType[qt] = (byQType[qt] || 0) + 1;
    }
    ok(res, {
      total: items.length,
      pending: items.filter((x) => !x.mastered).length,
      mastered: items.filter((x) => x.mastered).length,
      bySkill, byQType, items,
    });
  })
);

function parseTags(s) {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// POST /api/language/wrong-book/:questionId/master — 标记/取消「已掌握」
// body: { mastered?: boolean } 缺省则取反
router.post(
  "/wrong-book/:questionId/master",
  requireAuth,
  asyncHandler(async (req, res) => {
    const qid = String(req.params.questionId);
    const w = await prisma.languageWrongBook.findUnique({
      where: { studentId_questionId: { studentId: req.user.id, questionId: qid } },
    });
    if (!w) return fail(res, 404, "错题本中没有这道题");
    const want = req.body && typeof req.body.mastered === "boolean" ? req.body.mastered : !w.mastered;
    const updated = await prisma.languageWrongBook.update({
      where: { id: w.id },
      data: { mastered: want },
    });
    ok(res, { questionId: qid, mastered: updated.mastered }, updated.mastered ? "已标记掌握" : "已取消掌握");
  })
);

// DELETE /api/language/wrong-book/:questionId — 从错题本移除
router.delete(
  "/wrong-book/:questionId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const r = await prisma.languageWrongBook.deleteMany({
      where: { studentId: req.user.id, questionId: String(req.params.questionId) },
    });
    if (!r.count) return fail(res, 404, "错题本中没有这道题");
    ok(res, { removed: r.count }, "已移出错题本");
  })
);

// —— 四维报告页 ——

// GET /api/language/sessions/:id/report — 评后报告(分项 Band + 四维 + 错因 + 目标差距)
router.get(
  "/sessions/:id/report",
  requireAuth,
  asyncHandler(async (req, res) => {
    const session = await prisma.languageSession.findUnique({
      where: { id: req.params.id },
      include: {
        paper: { select: { id: true, title: true, kind: true, mode: true } },
        student: { select: { id: true, name: true } },
        records: {
          include: {
            question: {
              select: {
                ...Q_FIELDS, topic: true, tags: true, sourceRef: true,
                material: { select: { id: true, title: true } },
              },
            },
          },
        },
      },
    });
    if (!session) return fail(res, 404, "会话不存在");
    const mine = session.studentId === req.user.id;
    if (!mine && !["TEACHER", "ADMIN"].includes(req.user.role)) return fail(res, 403, "无权查看该报告");
    if (!session.submittedAt) return fail(res, 400, "会话尚未提交,暂无报告");

    const skillBands = parseSkillBands(session.skillBands) || {};
    const { missing } = composeOverall(skillBands);

    // 四维明细(主观题)
    const subjectiveItems = session.records
      .filter((r) => SUBJECTIVE_QTYPES.includes(r.question.qType))
      .map((r) => ({
        questionId: r.questionId,
        qType: r.question.qType,
        skill: r.question.skill,
        stem: r.question.stem,
        wordLimit: r.question.wordLimit,
        selected: r.selected,
        audioUrl: r.audioUrl,
        band: r.band,
        feedback: r.feedback,
        subscores: parseSubscores(r.subscores),
        solution: r.question.solution,
        gradedAt: r.gradedAt,
      }));

    // 客观题明细 + 错因聚合
    const objectiveItems = session.records
      .filter((r) => OBJECTIVE_QTYPES.includes(r.question.qType))
      .map((r) => ({
        questionId: r.questionId,
        qType: r.question.qType,
        skill: r.question.skill,
        topic: r.question.topic || null,
        groupTitle: r.question.groupTitle,
        stem: r.question.stem,
        selected: r.selected,
        answer: r.question.answer,
        isCorrect: r.isCorrect,
        solution: r.question.solution,
        materialTitle: r.question.material?.title || null,
      }));

    const wrongQTypes = {};
    const wrongSkills = {};
    for (const it of objectiveItems) {
      if (it.isCorrect) continue;
      wrongQTypes[it.qType] = (wrongQTypes[it.qType] || 0) + 1;
      wrongSkills[it.skill] = (wrongSkills[it.skill] || 0) + 1;
    }

    // 目标差距:S→建议下一步
    const goal = goalGap(session.goalBand, skillBands);

    ok(res, {
      session: {
        id: session.id, examType: session.examType, skill: session.skill, mode: session.mode,
        startedAt: session.startedAt, submittedAt: session.submittedAt,
        band: session.band, overallBand: session.overallBand, goalBand: session.goalBand,
        score: session.score, total: session.total, correctCount: session.correctCount,
        scaled: session.scaled, scoringVersion: session.scoringVersion,
        pending: missing.length > 0 ? missing : [],
      },
      paper: session.paper,
      student: mine ? null : session.student,
      skillBands,
      goalAnalysis: { ...goal, bands: Object.keys(skillBands).map((k) => ({ skill: k, cn: SKILL_CN[k] || k, band: skillBands[k]?.band ?? null })) },
      objective: objectiveItems,
      subjective: subjectiveItems,
      wrongQTypes,
      wrongSkills,
      dims: { writing: WRITING_DIMS, speaking: SPEAKING_DIMS },
    });
  })
);

// POST /api/language/scoring/rescore — 按当前口径重算历史会话(仅管理员,dryRun 默认 true)
// body: { confirm?: boolean, dryRun?: boolean, limit?: number }
router.post(
  "/scoring/rescore",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const { confirm, limit } = req.body || {};
    const dryRun = req.body?.dryRun !== false;
    if (!dryRun && confirm !== true) return fail(res, 400, "写库模式必须传 confirm:true(建议先 dryRun 看影响面)");
    await safeSeedTables();
    const sessions = await prisma.languageSession.findMany({
      where: { submittedAt: { not: null } },
      include: { records: { include: { question: { select: { id: true, qType: true, skill: true } } } } },
      orderBy: { submittedAt: "desc" },
      take: Math.min(Number(limit) || 500, 2000),
    });
    const preview = [];
    for (const s of sessions) {
      const bySkill = new Map();
      for (const r of s.records) {
        if (!OBJECTIVE_QTYPES.includes(r.question.qType)) continue;
        const k = r.question.skill || s.skill;
        const it = bySkill.get(k) || { correct: 0, total: 0 };
        it.total += 1;
        if (r.isCorrect) it.correct += 1;
        bySkill.set(k, it);
      }
      const subBySkill = new Map();
      const cntBySkill = new Map();
      for (const r of s.records) {
        if (!SUBJECTIVE_QTYPES.includes(r.question.qType)) continue;
        const k = r.question.skill || s.skill;
        cntBySkill.set(k, (cntBySkill.get(k) || 0) + 1);
        if (r.band !== null && r.band !== undefined) {
          const arr = subBySkill.get(k) || [];
          arr.push(Number(r.band));
          subBySkill.set(k, arr);
        }
      }
      const skillBands = {};
      for (const [k, v] of bySkill.entries()) {
        const { rows, maxRaw } = await loadBandTable(s.examType, k);
        const rr = lookupBand(rows, v.correct, v.total, maxRaw);
        skillBands[k] = { band: rr.band, correct: v.correct, total: v.total, scaled: rr.scaled };
      }
      for (const [k, cnt] of cntBySkill.entries()) {
        const arr = subBySkill.get(k) || [];
        if (arr.length && arr.length >= cnt) {
          skillBands[k] = { band: roundIeltsBand(arr.reduce((a, x) => a + x, 0) / arr.length), totalSub: cnt, gradedSub: arr.length };
        } else {
          skillBands[k] = { band: null, pending: true, totalSub: cnt, gradedSub: arr.length };
        }
      }
      const { overallBand } = composeOverall(skillBands);
      let band = overallBand;
      if (band === null) {
        const keys = Object.keys(skillBands);
        if (keys.length === 1) band = skillBands[keys[0]].band ?? null;
      }
      const changed = Math.abs(Number(band || 0) - Number(s.band || 0)) > 0.001;
      if (changed || !dryRun) {
        preview.push({ id: s.id, oldBand: s.band, newBand: band, changed });
      }
      if (!dryRun && changed) {
        await prisma.languageSession.update({
          where: { id: s.id },
          data: { band, overallBand, skillBands: JSON.stringify(skillBands), scoringVersion: SCORING_VERSION },
        });
      }
    }
    ok(res, {
      dryRun, scanned: sessions.length,
      changed: preview.filter((x) => x.changed).length,
      written: dryRun ? 0 : preview.filter((x) => x.changed).length,
      sample: preview.slice(0, 20),
      scoringVersion: SCORING_VERSION,
    }, dryRun ? "预演完成(未写库)" : "重算完成");
  })
);

export default router;
