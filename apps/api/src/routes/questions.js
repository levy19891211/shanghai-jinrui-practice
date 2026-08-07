import { Router } from "express";
import { prisma } from "../lib/db.js";
import { ok, fail, asyncHandler } from "../lib/res.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
const PUBLIC_FIELDS = { id: true, subject: true, paper: true, topic: true, difficulty: true, type: true, stem: true, options: true, source: true, status: true, createdAt: true, updatedAt: true };

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
        status: status || "DRAFT",
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
