import { Router } from "express";
import { prisma } from "../lib/db.js";
import { ok, fail, asyncHandler } from "../lib/res.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

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
      await prisma.question.create({
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
      imported++;
    } catch (e) {
      errors.push({ row: i + 1, reason: e.message });
    }
  }
  return { imported, errors };
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
    const { imported, errors } = await importRows(req, rows);
    ok(res, { imported, failed: errors.length, errors: errors.slice(0, 20) }, `导入完成:成功 ${imported} 条,失败 ${errors.length} 条`);
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
    const [list, total] = await Promise.all([
      prisma.question.findMany({
        where,
        select: PUBLIC_FIELDS,
        orderBy: { createdAt: "desc" },
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
    ok(res, q, "创建成功");
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
    ok(res, q, action === "approve" ? "已通过审核,题目已发布" : "已驳回,题目退回修改");
  })
);

// DELETE /api/questions/:id — 删除题目(管理员)
router.delete(
  "/:id",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const existed = await prisma.question.findUnique({ where: { id: req.params.id } });
    if (!existed) return fail(res, 404, "题目不存在");
    await prisma.question.delete({ where: { id: req.params.id } });
    ok(res, null, "删除成功");
  })
);

export default router;
