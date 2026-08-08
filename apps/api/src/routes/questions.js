import { Router } from "express";
import { prisma } from "../lib/db.js";
import { ok, fail, asyncHandler } from "../lib/res.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { syncAutoPaperSets, recalcPapersOfQuestion, parseIds } from "../lib/paper-set.js";
import { planAutoFix } from "../lib/autofix.js";
import { chatComplete, llmConfigured, llmInfo } from "../lib/llm.js";
import { planSkillFix } from "../lib/fix-question.js";
import { normalizeNewlines } from "../lib/text-clean.js";
import { parseImportFile } from "../lib/parse-import-file.js";

const router = Router();
const PUBLIC_FIELDS = { id: true, subject: true, paper: true, topic: true, topicIds: true, difficulty: true, type: true, stem: true, options: true, source: true, status: true, importedAt: true, createdAt: true, updatedAt: true };

// 解析 JSON 字符串数组(如 topicIds)
function parseJsonIds(s) {
  try {
    const v = JSON.parse(s || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// 依据 subject + topic 字符串,从知识点库自动匹配知识点(名称相等或互相包含)。
// 题目学科 → 可归类的知识点学科池(TMUA 是数学思维考试 → 数学;ESAT → 数学+物理)
function knowledgeSubjectsFor(subject) {
  if (subject === "TMUA") return ["数学"];
  if (subject === "ESAT") return ["数学", "物理"];
  return [subject];
}

// 匹配不到返回 []——题目留白,由老师后续归类。
async function matchKnowledgePoints(subject, topicStr) {
  const names = String(topicStr || "")
    .split(/[,、;；\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!names.length) return [];
  const subs = knowledgeSubjectsFor(subject);
  const kps = subs.length ? await prisma.knowledgePoint.findMany({ where: { subject: { in: subs } } }) : [];
  const hits = [];
  for (const n of names) {
    const hit = kps.find((k) => k.name === n || k.name.includes(n) || n.includes(k.name));
    if (hit && !hits.some((h) => h.id === hit.id)) hits.push(hit);
  }
  return hits;
}

// 把 topicIds(数组)解析成知识点名称数组;题目未归类返回空
async function resolveTopics(topicIds) {
  const ids = Array.isArray(topicIds) ? topicIds : parseJsonIds(topicIds);
  if (!ids.length) return [];
  const kps = await prisma.knowledgePoint.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const byId = new Map(kps.map((k) => [k.id, k.name]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

// 归一化题目携带的知识点:支持 topicIds(数组) 或 topic(字符串,自动匹配)
// 返回 { topicIds, topic }
// 注意:topicIds 是前端按"题目学科映射的知识点学科"加载的(如 TMUA→数学),后端直接信任,
//       不要再用题目 subject 过滤(题目学科 TMUA 下没有知识点,会误清空)。
async function normalizeTopicInput({ subject, topic, topicIds }) {
  if (Array.isArray(topicIds) && topicIds.length) {
    const kps = await prisma.knowledgePoint.findMany({ where: { id: { in: topicIds } }, select: { id: true, name: true } });
    const ids = kps.map((k) => k.id);
    return { topicIds: ids, topic: kps[0]?.name || String(topic || "").trim() };
  }
  const matched = await matchKnowledgePoints(subject, topic);
  return { topicIds: matched.map((k) => k.id), topic: matched[0]?.name || String(topic || "").trim() };
}

// 解析 options(JSON 字符串或数组) → 字符串数组
function safeParseOptions(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
  }
  return [];
}

// 清洗选项正文:去掉 PDF 视觉模型误带出的字母前缀(如 "A 1/25"、"A. 1/25"、"(A) 1/25"),
// 选项 A./B./C. 标签由系统自动添加。prompt 已禁止前缀,这里是兜底。
function cleanOptionPrefix(o) {
  return String(o ?? "").replace(/^[\(\[【（]?[A-Ja-j][\.\s:、)）\]】」、\]】]*/, "").trimStart();
}

// 组装发给 LLM 的题目信息
function buildSolutionPrompt({ stem, options, answer, topic }) {
  const optText = Array.isArray(options) && options.length
    ? options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join("\n")
    : "(无选项 / 填空题)";
  return [
    `【科目/知识点】${topic || "数学"}`,
    `【题干】${stem}`,
    `【选项】\n${optText}`,
    `【参考答案】${answer || "(见题干或解析)"}`,
    "",
    "请基于以上信息给出解析,务必包含解题步骤、考查知识点、易错点提醒三部分。",
  ].join("\n");
}

// 清理 LLM 可能返回的代码块包裹 / 多余前后缀
function cleanSolution(text) {
  let t = String(text || "").trim();
  const fence = t.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i);
  if (fence) t = fence[1].trim();
  return t;
}

// 若题目缺解析且已配置 LLM,则生成结构化解析;否则返回 null
async function tryGenerateSolution(q) {
  if (!llmConfigured() || (q.solution && String(q.solution).trim())) return null;
  try {
    const raw = await chatComplete({
      system:
        "你是资深的英国大学附加数学笔试(TMUA/ESAT 等)辅导老师。请针对题目给出清晰、严谨、面向学生的解题解析。" +
        "严格按以下三部分用 Markdown 小标题组织:\n## 解题步骤\n## 考查知识点\n## 易错点提醒\n" +
        "数学公式用 LaTeX 行内 $...$ 或独立 $$...$$ 表示。只输出解析内容,不要寒暄。",
      user: buildSolutionPrompt({ stem: q.stem, options: safeParseOptions(q.options), answer: q.answer, topic: q.topic }),
      temperature: 0.2,
      maxTokens: 900,
    });
    return cleanSolution(raw) || null;
  } catch {
    return null;
  }
}

// 简单 CSV 解析(支持双引号包裹的字段)
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field.trim()); field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field.trim()); field = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field.trim());
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

// 批量导入:兼容 JSON 数组 或 CSV 文本
// CSV 列顺序:subject,paper,topic,difficulty,type,stem,options(分号分隔),answer,solution,source,status
async function importRows(req, rows) {
  const errors = [];
  const created = []; // 供套题自动组卷使用
  let imported = 0;
  // 预载知识点库(按 subject 分组),供导入自动归类复用
  const allKps = await prisma.knowledgePoint.findMany();
  const kpBySubject = new Map();
  for (const k of allKps) {
    if (!kpBySubject.has(k.subject)) kpBySubject.set(k.subject, []);
    kpBySubject.get(k.subject).push(k);
  }
  function matchKps(subject, topicStr) {
    const names = String(topicStr || "")
      .split(/[,、;；\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    // 题目学科映射到知识点学科池(TMUA→数学,ESAT→数学+物理),保证 TMUA 题也能自动归类
    const pool = knowledgeSubjectsFor(subject).flatMap((s) => kpBySubject.get(s) || []);
    const hits = [];
    for (const n of names) {
      const hit = pool.find((k) => k.name === n || k.name.includes(n) || n.includes(k.name));
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
      if (!r.subject || !r.topic || !r.stem || options.length < 2) {
        throw new Error("字段不完整(需要 subject/topic/stem/options≥2)");
      }
      // PDF 导入若图片中无答案 key,允许 answer 为空,教师在审核页补充
      if (!r.answer && r.source !== "PDF 导入") {
        throw new Error("字段不完整:answer 必填");
      }
      // 知识点归类:显式 topicIds 优先;否则按 topic 字符串自动匹配(匹配不到留空)
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
          paper: r.paper || null,
          topic,
          topicIds: JSON.stringify(topicIds),
          difficulty: Number(r.difficulty) || 3,
          type: r.type || "SINGLE_CHOICE",
          stem: normalizeNewlines(r.stem),
          options: JSON.stringify(options.map((o) => normalizeNewlines(cleanOptionPrefix(o)))),
          answer: r.answer ? normalizeNewlines(String(r.answer)) : "",
          solution: r.solution ? normalizeNewlines(r.solution) : null,
          source: r.source || "批量导入",
          status: r.status || "PENDING_REVIEW",
          importedAt: new Date(),
          createdBy: req.user.id,
        },
      });
      created.push({ id: q.id, subject: q.subject, paper: q.paper, source: q.source });
      imported++;
    } catch (e) {
      errors.push({ row: i + 1, reason: e.message });
    }
  }
  return { imported, errors, created };
}

// POST /api/questions/import — 批量导入题目(老师/管理员)
router.post(
  "/import",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { items, csv } = req.body || {};
    let rows = [];
    if (Array.isArray(items)) rows = items;
    else if (typeof csv === "string" && csv.trim()) {
      const parsed = parseCsv(csv);
      if (parsed.length) parsed.shift(); // 跳过表头
      rows = parsed.map((cols) => ({
        subject: cols[0], paper: cols[1], topic: cols[2], difficulty: cols[3],
        type: cols[4], stem: cols[5], options: cols[6], answer: cols[7],
        solution: cols[8], source: cols[9], status: cols[10],
      }));
    } else {
      return fail(res, 400, "请提供 items(JSON 数组)或 csv(文本,含表头)");
    }
    if (rows.length === 0) return fail(res, 400, "没有可导入的数据");
    const { imported, errors, created } = await importRows(req, rows);

    // 套题自动组卷:同一 subject+paper+source 的题视为一套,自动成卷。
    // 注意自动成卷 ≠ 自动发布 —— 新卷 status=DRAFT,要等卷内每道题都审核通过才会转 READY 对学生开放。
    let papers = [];
    const autoPaper = req.body?.autoPaper !== false; // 默认开启,显式传 false 可关闭
    if (autoPaper && created.length) {
      papers = await syncAutoPaperSets(created, {
        title: req.body?.paperTitle,
        mode: req.body?.paperMode,
        durationMin: req.body?.paperDurationMin,
      });
    }
    const paperMsg = papers.length
      ? `;识别到 ${papers.length} 套题并自动组卷(${papers.map((p) => `${p.title} ${p.total} 题`).join("、")}),需逐题审核通过后学生才可作答`
      : "";
    ok(
      res,
      { imported, failed: errors.length, errors: errors.slice(0, 20), papers, created },
      `导入完成:成功 ${imported} 条,失败 ${errors.length} 条${paperMsg}`
    );
  })
);

// POST /api/questions/import-file — 上传文件批量导入(Excel/Word/PDF)
// 接收 { filename, data }(data 为 base64,可带 data: 前缀),服务端解析后复用 importRows。
// PDF 经 PyMuPDF 栅格化 + 视觉模型读取公式,需要配置 VISION_API_KEY。
router.post(
  "/import-file",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { filename, data } = req.body || {};
    if (!filename || !data) return fail(res, 400, "请提供 filename 与 data(base64)");
    let buf;
    try {
      const b64 = String(data).includes(",") ? String(data).split(",")[1] : String(data);
      buf = Buffer.from(b64, "base64");
    } catch {
      return fail(res, 400, "data 不是合法的 base64");
    }
    if (buf.length === 0) return fail(res, 400, "文件内容为空");
    if (buf.length > 15 * 1024 * 1024) return fail(res, 400, "文件过大(上限 15MB)");

    let rows;
    try {
      rows = await parseImportFile(filename, buf);
    } catch (e) {
      if (e.message === "VISION_NOT_CONFIGURED") {
        return fail(
          res,
          400,
          "PDF 导入需要配置视觉模型:请在服务器 apps/api/.env 添加 VISION_API_KEY / VISION_BASE_URL / VISION_MODEL 并重启 API"
        );
      }
      return fail(res, 400, "解析失败:" + e.message);
    }
    if (!rows.length) return fail(res, 400, "未从文件中解析出任何题目(请检查模板/表头)");

    const { imported, errors, created } = await importRows(req, rows);

    let papers = [];
    const autoPaper = req.body?.autoPaper !== false;
    if (autoPaper && created.length) {
      papers = await syncAutoPaperSets(created, {
        title: req.body?.paperTitle,
        mode: req.body?.paperMode,
        durationMin: req.body?.paperDurationMin,
      });
    }
    const paperMsg = papers.length
      ? `;识别到 ${papers.length} 套题并自动组卷(${papers.map((p) => `${p.title} ${p.total} 题`).join("、")}),需逐题审核通过后学生才可作答`
      : "";
    ok(
      res,
      { imported, failed: errors.length, errors: errors.slice(0, 20), papers, parsed: rows.length, created },
      `导入完成:成功 ${imported} 条,失败 ${errors.length} 条${paperMsg}`
    );
  })
);

// 列表查询公共逻辑
function buildWhere(query, user) {
  const where = {};
  if (query.subject) where.subject = query.subject;
  // 多学科过滤(subjects=a,b,c),用于学科 Tab(如数学 tab 包含 TMUA)
  if (query.subjects) {
    const subs = String(query.subjects).split(",").map((s) => s.trim()).filter(Boolean);
    if (subs.length) where.subject = { in: subs };
  }
  if (query.topic) where.topic = { contains: query.topic };
  if (query.difficulty) where.difficulty = Number(query.difficulty);
  if (query.paper) where.paper = query.paper;
  if (query.knowledgePointId) where.topicIds = { contains: String(query.knowledgePointId) };
  // 学生只能看到已发布题目;老师/管理员不带 status 时默认显示全部状态(含待审核/草稿/已退回)
  if (user.role === "STUDENT") {
    where.status = "PUBLISHED";
  } else if (query.status) {
    where.status = query.status;
  }
  return where;
}

// GET /api/questions — 题目列表(筛选 + 分页)
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 20));
    const where = buildWhere(req.query, req.user);
    // paperId:只看某张试卷内的题目(老师从试卷管理跳转到审核队列时使用)
    if (req.query.paperId) {
      const p = await prisma.paper.findUnique({ where: { id: String(req.query.paperId) } });
      if (!p) return fail(res, 404, "试卷不存在");
      where.id = { in: parseIds(p) };
      // 老师查看整卷时默认要看到各种状态(否则默认只回 PUBLISHED,审核进度就看不见了)
      if (req.user.role !== "STUDENT" && !req.query.status) delete where.status;
    }
    // 老师/管理员要在列表上直接审核与一键修正,需要答案、解析和退回意见;学生仍只拿公共字段
    const isTeacher = ["TEACHER", "ADMIN"].includes(req.user.role);
    const select = isTeacher
      ? { ...PUBLIC_FIELDS, answer: true, solution: true, reviewNote: true, reviewedAt: true, autoFixLog: true }
      : PUBLIC_FIELDS;
    // 排序:?sort=difficulty|createdAt + ?order=asc|desc;默认最新在前(按试卷审核时按录入顺序)
    let orderBy;
    const dir = req.query.order === "asc" ? "asc" : "desc";
    if (req.query.sort === "difficulty") orderBy = [{ difficulty: dir }, { createdAt: "desc" }];
    else if (req.query.sort === "createdAt") orderBy = { createdAt: dir };
    else orderBy = req.query.paperId ? { createdAt: "asc" } : { createdAt: "desc" };
    const [list, total] = await Promise.all([
      prisma.question.findMany({
        where,
        select,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.question.count({ where }),
    ]);
    // 附带各题知识点名称(按 topicIds 解析)
    const allIds = [...new Set(list.flatMap((q) => parseJsonIds(q.topicIds)))];
    const kps = allIds.length ? await prisma.knowledgePoint.findMany({ where: { id: { in: allIds } }, select: { id: true, name: true } }) : [];
    const kpNameById = new Map(kps.map((k) => [k.id, k.name]));
    const enriched = list.map((q) => ({ ...q, topicIds: parseJsonIds(q.topicIds), topics: parseJsonIds(q.topicIds).map((id) => kpNameById.get(id)).filter(Boolean) }));
    ok(res, { list: enriched, total, page, pageSize });
  })
);

// GET /api/questions/:id — 题目详情
router.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = await prisma.question.findUnique({ where: { id: req.params.id } });
    if (!q) return fail(res, 404, "题目不存在");
    if (q.status !== "PUBLISHED" && req.user.role === "STUDENT") return fail(res, 404, "题目不存在");
    ok(res, { ...q, topicIds: parseJsonIds(q.topicIds), topics: await resolveTopics(q.topicIds) });
  })
);

// POST /api/questions — 创建题目(老师/管理员)
router.post(
  "/",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { subject, paper, topic, topicIds, difficulty, type, stem, options, answer, solution, source, status } = req.body || {};
    if (!subject || !topic || !stem || !options || !answer) {
      return fail(res, 400, "subject、topic、stem、options、answer 必填");
    }
    if (!Array.isArray(options) || options.length < 2) return fail(res, 400, "options 至少 2 个选项");
    const kp = await normalizeTopicInput({ subject, topic, topicIds });
    const q = await prisma.question.create({
      data: {
        subject,
        paper: paper || null,
        topic: kp.topic,
        topicIds: JSON.stringify(kp.topicIds),
        difficulty: difficulty || 3,
        type: type || "SINGLE_CHOICE",
        stem: normalizeNewlines(stem),
        options: JSON.stringify(options.map((o) => normalizeNewlines(cleanOptionPrefix(o)))),
        answer: normalizeNewlines(String(answer)),
        solution: solution ? normalizeNewlines(solution) : null,
        source: source || null,
        status: status || "PENDING_REVIEW",
        createdBy: req.user.id,
      },
    });
    // 单题录入也参与套题归并:同 subject+paper+source 的题攒够 2 道就自动成卷
    let papers = [];
    if (q.paper && req.body?.autoPaper !== false) {
      papers = await syncAutoPaperSets([{ id: q.id, subject: q.subject, paper: q.paper, source: q.source }]);
    }
    const msg = papers.length ? `创建成功;已归入套题试卷「${papers[0].title}」(共 ${papers[0].total} 题)` : "创建成功";
    ok(res, { ...q, papers, topicIds: parseJsonIds(q.topicIds), topics: await resolveTopics(q.topicIds) }, msg);
  })
);

// PUT /api/questions/:id — 更新题目(老师/管理员)
router.put(
  "/:id",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const existed = await prisma.question.findUnique({ where: { id: req.params.id } });
    if (!existed) return fail(res, 404, "题目不存在");
    const b = req.body || {};
    const data = {};
    for (const key of ["subject", "paper", "topic", "difficulty", "type", "stem", "answer", "solution", "source", "status"]) {
      if (b[key] === undefined) continue;
      if (key === "options") continue;
      if (key === "stem" || key === "answer") data[key] = normalizeNewlines(String(b[key]));
      else if (key === "solution") data[key] = b[key] ? normalizeNewlines(String(b[key])) : b[key];
      else data[key] = b[key];
    }
    if (b.options !== undefined) {
      if (!Array.isArray(b.options) || b.options.length < 2) return fail(res, 400, "options 至少 2 个选项");
      data.options = JSON.stringify(b.options.map((o) => normalizeNewlines(cleanOptionPrefix(o))));
    }
    // 知识点:传了 topicIds 数组则按库归类并同步 topic;只传 topic 则自动匹配(可清空:传空数组)
    if (b.topicIds !== undefined) {
      if (!Array.isArray(b.topicIds)) return fail(res, 400, "topicIds 必须是数组");
      const kp = await normalizeTopicInput({ subject: b.subject ?? existed.subject, topic: b.topic ?? existed.topic, topicIds: b.topicIds });
      data.topicIds = JSON.stringify(kp.topicIds);
      data.topic = kp.topic;
    } else if (b.topic !== undefined && b.topicIds === undefined) {
      const kp = await normalizeTopicInput({ subject: b.subject ?? existed.subject, topic: b.topic, topicIds: undefined });
      data.topicIds = JSON.stringify(kp.topicIds);
      data.topic = kp.topic;
    }
    const q = await prisma.question.update({ where: { id: req.params.id }, data });
    // 状态可能被手动改动,同步刷新所在试卷的就绪度
    if (data.status !== undefined) await recalcPapersOfQuestion(q.id);
    ok(res, { ...q, topicIds: parseJsonIds(q.topicIds), topics: await resolveTopics(q.topicIds) }, "更新成功");
  })
);

// POST /api/questions/:id/review — 老师审核(通过/驳回)
// body: { action: "approve" | "reject", note?: string }
//   approve → PUBLISHED(学生可见)
//   reject  → REJECTED(退回修改)
router.post(
  "/:id/review",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const existed = await prisma.question.findUnique({ where: { id: req.params.id } });
    if (!existed) return fail(res, 404, "题目不存在");
    const { action, note } = req.body || {};
    if (action !== "approve" && action !== "reject") {
      return fail(res, 400, "action 必须是 approve 或 reject");
    }
    const data = {
      status: action === "approve" ? "PUBLISHED" : "REJECTED",
      reviewNote: note ?? null,
      reviewedBy: req.user.id,
      reviewedAt: new Date(),
    };
    const q = await prisma.question.update({ where: { id: req.params.id }, data });
    // 该题所在的套题卷可能因此从「有未审核题」变为「全部通过」,重算就绪度
    const papers = await recalcPapersOfQuestion(q.id);
    const becameReady = papers.filter((p) => p.status === "READY");
    let msg = action === "approve" ? "已通过审核,题目已发布" : "已驳回,题目退回修改";
    if (becameReady.length) msg += `;所在试卷已全部审核完毕,学生现在可以作答`;
    ok(res, { ...q, papers }, msg);
  })
);

// POST /api/questions/:id/autofix — 一键按退回原因自动修正
// body: { apply?: boolean, resubmit?: boolean }
//   apply=false(默认) → 只返回修正方案与前后对比,不落库,供老师确认
//   apply=true        → 落库;resubmit=true 时同时重新提交审核(REJECTED → PENDING_REVIEW)
router.post(
  "/:id/autofix",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const q = await prisma.question.findUnique({ where: { id: req.params.id } });
    if (!q) return fail(res, 404, "题目不存在");
    const plan = planAutoFix(q);
    const apply = req.body?.apply === true;
    const resubmit = req.body?.resubmit !== false; // 落库时默认重新提交审核

    if (!apply) {
      return ok(res, { id: q.id, reviewNote: q.reviewNote, applied: false, ...plan }, describePlan(plan));
    }
    if (Object.keys(plan.patch).length === 0 && !resubmit) {
      return ok(res, { id: q.id, applied: false, ...plan }, "没有可自动修正的内容");
    }

    const data = { ...plan.patch };
    let solutionGenerated = false;
    const missingSol = !q.solution || !String(q.solution).trim();
    if (missingSol) {
      const sol = await tryGenerateSolution(q);
      if (sol) { data.solution = sol; solutionGenerated = true; }
    }
    if (resubmit) {
      // 修正后重新排队审核;保留原退回意见到修正日志里,便于复核时对照
      data.status = "PENDING_REVIEW";
      data.reviewNote = null;
      data.reviewedAt = null;
      data.reviewedBy = null;
    }
    const manual = solutionGenerated
      ? plan.manual.filter((m) => m.code !== "missing_solution")
      : plan.manual;
    data.autoFixLog = JSON.stringify({
      at: new Date().toISOString(),
      by: req.user.id,
      fromNote: q.reviewNote || null,
      fixes: plan.fixes.map((f) => ({ code: f.code, field: f.field, targeted: !!f.targeted })),
      manual,
      remaining: plan.remaining,
      solutionGenerated: solutionGenerated || undefined,
    });
    const updated = await prisma.question.update({ where: { id: q.id }, data });
    await recalcPapersOfQuestion(q.id);
    return ok(
      res,
      { id: updated.id, applied: true, status: updated.status, ...plan, manual },
      `${describePlan(plan)}${solutionGenerated ? ",已自动生成解析" : ""}${resubmit ? ",已重新提交审核" : ""}`
    );
  })
);

// POST /api/questions/autofix/batch — 批量一键修正(默认处理全部已退回题目)
// body: { ids?: string[], status?: string, apply?: boolean, resubmit?: boolean, onlyClean?: boolean }
//   onlyClean=true(默认):只有修完能通过体检的题才重新提交审核,仍有问题的留在退回列表等人工处理
router.post(
  "/autofix/batch",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { ids, status = "REJECTED", apply = false, resubmit = true, onlyClean = true } = req.body || {};
    const where = Array.isArray(ids) && ids.length ? { id: { in: ids } } : { status };
    const rows = await prisma.question.findMany({ where, take: 200 });
    if (rows.length === 0) return fail(res, 400, "没有符合条件的题目");

    const items = [];
    let fixedCount = 0;
    let resubmitted = 0;
    for (const q of rows) {
      const plan = planAutoFix(q);
      const hasPatch = Object.keys(plan.patch).length > 0;
      const willResubmit = resubmit && (plan.clean || !onlyClean);
        if (apply && (hasPatch || willResubmit || ((!q.solution || !String(q.solution).trim()) && llmConfigured()))) {
          const data = { ...plan.patch };
          let solutionGenerated = false;
          if (!q.solution || !String(q.solution).trim()) {
            const sol = await tryGenerateSolution(q);
            if (sol) { data.solution = sol; solutionGenerated = true; }
          }
          if (willResubmit) {
            data.status = "PENDING_REVIEW";
            data.reviewNote = null;
            data.reviewedAt = null;
            data.reviewedBy = null;
          }
          const manual = solutionGenerated
            ? plan.manual.filter((m) => m.code !== "missing_solution")
            : plan.manual;
          data.autoFixLog = JSON.stringify({
            at: new Date().toISOString(),
            by: req.user.id,
            fromNote: q.reviewNote || null,
            fixes: plan.fixes.map((f) => ({ code: f.code, field: f.field, targeted: !!f.targeted })),
            manual,
            remaining: plan.remaining,
            solutionGenerated: solutionGenerated || undefined,
          });
        await prisma.question.update({ where: { id: q.id }, data });
        await recalcPapersOfQuestion(q.id);
        if (hasPatch) fixedCount++;
        if (willResubmit) resubmitted++;
      } else if (hasPatch) {
        fixedCount++;
      }
      items.push({
        id: q.id,
        stem: String(q.stem || "").slice(0, 60),
        reviewNote: q.reviewNote,
        fixCount: plan.fixes.length,
        fixes: plan.fixes.map((f) => ({ code: f.code, label: f.label, field: f.field, targeted: !!f.targeted })),
        manual: plan.manual,
        remaining: plan.remaining,
        clean: plan.clean,
        willResubmit,
      });
    }
    const stuck = items.filter((i) => !i.clean).length;
    ok(
      res,
      { total: rows.length, fixedCount, resubmitted, stuck, applied: apply, items },
      apply
        ? `已修正 ${fixedCount} 道,重新提交审核 ${resubmitted} 道${stuck ? `,${stuck} 道仍需人工处理` : ""}`
        : `体检完成:${fixedCount} 道可自动修正${stuck ? `,${stuck} 道存在需人工处理的问题` : ""}`
    );
  })
);

// POST /api/questions/:id/generate-solution — AI 生成结构化解析草稿
router.post(
  "/:id/generate-solution",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    if (!llmConfigured()) {
      return fail(res, 400, "服务端未配置 LLM_API_KEY,无法生成解析。请在 .env 配置 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL。");
    }
    const q = await prisma.question.findUnique({ where: { id: req.params.id } });
    if (!q) return fail(res, 404, "题目不存在");

    const prompt = buildSolutionPrompt({
      stem: q.stem,
      options: safeParseOptions(q.options),
      answer: q.answer,
      topic: q.topic,
    });

    let raw;
    try {
      raw = await chatComplete({
        system:
          "你是资深的英国大学附加数学笔试(TMUA/ESAT 等)辅导老师。请针对题目给出清晰、严谨、面向学生的解题解析。" +
          "严格按以下三部分用 Markdown 小标题组织:\n## 解题步骤\n## 考查知识点\n## 易错点提醒\n" +
          "数学公式用 LaTeX 行内 $...$ 或独立 $$...$$ 表示。只输出解析内容,不要寒暄。",
        user: prompt,
        temperature: 0.2,
        maxTokens: 900,
      });
    } catch (e) {
      return fail(res, e.code === "LLM_NOT_CONFIGURED" ? 400 : 502, e.message || "LLM 调用失败");
    }

    const solution = cleanSolution(raw);
    if (!solution) return fail(res, 502, "LLM 返回内容为空,请重试");

    // 写入 solution;若题目当前不在审核态,则置为 PENDING_REVIEW 进入审核队列由老师确认
    const data = { solution };
    if (q.status !== "PENDING_REVIEW" && q.status !== "REJECTED") {
      data.status = "PENDING_REVIEW";
      data.reviewNote = null;
      data.reviewedAt = null;
      data.reviewedBy = null;
    }
    data.autoFixLog = JSON.stringify({
      at: new Date().toISOString(),
      by: req.user.id,
      action: "generate-solution",
      model: llmInfo().model,
      previousSolution: q.solution || null,
    });
    const updated = await prisma.question.update({ where: { id: q.id }, data });
    await recalcPapersOfQuestion(q.id);
    ok(res, { id: q.id, solution: updated.solution, status: updated.status }, "已生成解析,请老师在审核中确认后发布");
  })
);

// POST /api/questions/:id/fix — 用 question-fixer skill(LLM)按退回原因语义重调
// body: { apply?: boolean, resubmit?: boolean }
//   apply=false(默认) → 只返回 AI 修正预览(前后对比 + changes + 体检结果),不落库
//   apply=true        → 落库;resubmit=true(默认)时置 PENDING_REVIEW 重新提交审核,写 autoFixLog
// 未配置 LLM 时返回 400(由前端 AI 按钮禁用兜底)
router.post(
  "/:id/fix",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const q = await prisma.question.findUnique({ where: { id: req.params.id } });
    if (!q) return fail(res, 404, "题目不存在");
    const apply = req.body?.apply === true;
    const resubmit = req.body?.resubmit !== false;

    let result;
    try {
      result = await planSkillFix(q);
    } catch (e) {
      return fail(res, e.code === "LLM_NOT_CONFIGURED" ? 400 : 502, e.message || "AI 修正失败");
    }

    if (!apply) {
      return ok(res, { id: q.id, reviewNote: q.reviewNote, applied: false, ...result }, "AI 修正预览,请核对后应用");
    }

    const data = {
      stem: result.fixed.stem,
      options: JSON.stringify(result.fixed.options),
      answer: result.fixed.answer,
      solution: result.fixed.solution,
    };
    if (resubmit) {
      data.status = "PENDING_REVIEW";
      data.reviewNote = null;
      data.reviewedAt = null;
      data.reviewedBy = null;
    }
    data.autoFixLog = JSON.stringify({
      at: new Date().toISOString(),
      by: req.user.id,
      action: "ai-fix",
      fromNote: q.reviewNote || null,
      changes: result.changes,
      remaining: result.remaining,
      model: result.model,
    });
    const updated = await prisma.question.update({ where: { id: q.id }, data });
    await recalcPapersOfQuestion(q.id);
    const tail = result.remaining.length ? `,但仍有 ${result.remaining.length} 处需人工复核` : "";
    ok(
      res,
      { id: updated.id, applied: true, status: updated.status, ...result },
      `已应用 AI 修正${resubmit ? ",已重新提交审核" : ""}${tail}`
    );
  })
);

function describePlan(plan) {
  if (plan.fixes.length === 0 && plan.manual.length === 0) return "该题未检出可修正的问题";
  const parts = [];
  if (plan.fixes.length) parts.push(`可自动修正 ${plan.fixes.length} 处`);
  if (plan.manual.length) parts.push(`${plan.manual.length} 处需人工处理`);
  return parts.join(",");
}

// DELETE /api/questions/:id — 删除题目(管理员)
router.delete(
  "/:id",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const existed = await prisma.question.findUnique({ where: { id: req.params.id } });
    if (!existed) return fail(res, 404, "题目不存在");
    await prisma.question.delete({ where: { id: req.params.id } });
    // 卷内引用会失效,重算让试卷退回 DRAFT 并在管理页提示「缺失题目」
    await recalcPapersOfQuestion(req.params.id);
    ok(res, null, "删除成功");
  })
);

export default router;
