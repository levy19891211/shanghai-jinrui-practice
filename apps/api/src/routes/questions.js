import { Router } from "express";
import { prisma } from "../lib/db.js";
import { ok, fail, asyncHandler } from "../lib/res.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { syncAutoPaperSets, recalcPapersOfQuestion, parseIds } from "../lib/paper-set.js";
import { planAutoFix } from "../lib/autofix.js";

const router = Router();
const PUBLIC_FIELDS = { id: true, subject: true, paper: true, topic: true, difficulty: true, type: true, stem: true, options: true, source: true, status: true, createdAt: true, updatedAt: true };

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
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    try {
      const options = Array.isArray(r.options)
        ? r.options
        : String(r.options || "").split(/[;；]/).map((s) => s.trim()).filter(Boolean);
      if (!r.subject || !r.topic || !r.stem || options.length < 2 || !r.answer) {
        throw new Error("字段不完整(需要 subject/topic/stem/options≥2/answer)");
      }
      const q = await prisma.question.create({
        data: {
          subject: r.subject,
          paper: r.paper || null,
          topic: r.topic,
          difficulty: Number(r.difficulty) || 3,
          type: r.type || "SINGLE_CHOICE",
          stem: r.stem,
          options: JSON.stringify(options),
          answer: String(r.answer),
          solution: r.solution || null,
          source: r.source || "批量导入",
          status: r.status || "PENDING_REVIEW",
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
      { imported, failed: errors.length, errors: errors.slice(0, 20), papers },
      `导入完成:成功 ${imported} 条,失败 ${errors.length} 条${paperMsg}`
    );
  })
);

// 列表查询公共逻辑
function buildWhere(query, user) {
  const where = {};
  if (query.subject) where.subject = query.subject;
  if (query.topic) where.topic = { contains: query.topic };
  if (query.difficulty) where.difficulty = Number(query.difficulty);
  if (query.paper) where.paper = query.paper;
  // 学生只能看到已发布题目;老师/管理员可指定 status
  if (user.role === "STUDENT" || !query.status) {
    where.status = "PUBLISHED";
  } else {
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
    // 按试卷审核时用录入顺序(第 1 题在前),普通列表用最新在前
    const orderBy = req.query.paperId ? { createdAt: "asc" } : { createdAt: "desc" };
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
    ok(res, { list, total, page, pageSize });
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
    ok(res, q);
  })
);

// POST /api/questions — 创建题目(老师/管理员)
router.post(
  "/",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { subject, paper, topic, difficulty, type, stem, options, answer, solution, source, status } = req.body || {};
    if (!subject || !topic || !stem || !options || !answer) {
      return fail(res, 400, "subject、topic、stem、options、answer 必填");
    }
    if (!Array.isArray(options) || options.length < 2) return fail(res, 400, "options 至少 2 个选项");
    const q = await prisma.question.create({
      data: {
        subject,
        paper: paper || null,
        topic,
        difficulty: difficulty || 3,
        type: type || "SINGLE_CHOICE",
        stem,
        options: JSON.stringify(options),
        answer: String(answer),
        solution: solution || null,
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
    ok(res, { ...q, papers }, msg);
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
      if (b[key] !== undefined) data[key] = key === "options" ? undefined : b[key];
    }
    if (b.options !== undefined) {
      if (!Array.isArray(b.options) || b.options.length < 2) return fail(res, 400, "options 至少 2 个选项");
      data.options = JSON.stringify(b.options);
    }
    const q = await prisma.question.update({ where: { id: req.params.id }, data });
    // 状态可能被手动改动,同步刷新所在试卷的就绪度
    if (data.status !== undefined) await recalcPapersOfQuestion(q.id);
    ok(res, q, "更新成功");
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
    if (resubmit) {
      // 修正后重新排队审核;保留原退回意见到修正日志里,便于复核时对照
      data.status = "PENDING_REVIEW";
      data.reviewNote = null;
      data.reviewedAt = null;
      data.reviewedBy = null;
    }
    data.autoFixLog = JSON.stringify({
      at: new Date().toISOString(),
      by: req.user.id,
      fromNote: q.reviewNote || null,
      fixes: plan.fixes.map((f) => ({ code: f.code, field: f.field, targeted: !!f.targeted })),
      manual: plan.manual,
      remaining: plan.remaining,
    });
    const updated = await prisma.question.update({ where: { id: q.id }, data });
    await recalcPapersOfQuestion(q.id);
    return ok(
      res,
      { id: updated.id, applied: true, status: updated.status, ...plan },
      `${describePlan(plan)}${resubmit ? ",已重新提交审核" : ""}`
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
      if (apply && (hasPatch || willResubmit)) {
        const data = { ...plan.patch };
        if (willResubmit) {
          data.status = "PENDING_REVIEW";
          data.reviewNote = null;
          data.reviewedAt = null;
          data.reviewedBy = null;
        }
        data.autoFixLog = JSON.stringify({
          at: new Date().toISOString(),
          by: req.user.id,
          fromNote: q.reviewNote || null,
          fixes: plan.fixes.map((f) => ({ code: f.code, field: f.field, targeted: !!f.targeted })),
          manual: plan.manual,
          remaining: plan.remaining,
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
