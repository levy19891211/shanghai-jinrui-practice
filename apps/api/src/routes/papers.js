import { Router } from "express";
import { prisma } from "../lib/db.js";
import { ok, fail, asyncHandler } from "../lib/res.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

// POST /api/papers/generate — 组卷(老师/管理员)
router.post(
  "/generate",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { title, subject, mode, durationMin, topics, difficulties, count } = req.body || {};
    if (!title || !subject) return fail(res, 400, "title、subject 必填");
    const where = { status: "PUBLISHED", subject };
    if (Array.isArray(topics) && topics.length) where.topic = { in: topics };
    if (Array.isArray(difficulties) && difficulties.length) where.difficulty = { in: difficulties.map(Number) };
    const total = Math.max(1, Number(count) || 10);
    const all = await prisma.question.findMany({ where, select: { id: true } });
    if (all.length === 0) return fail(res, 400, "没有符合条件的题目,请调整筛选条件");
    const picked = all.sort(() => Math.random() - 0.5).slice(0, Math.min(total, all.length));
    const paper = await prisma.paper.create({
      data: {
        title,
        subject,
        mode: mode === "EXAM" ? "EXAM" : "PRACTICE",
        durationMin: Number(durationMin) || null,
        questionIds: JSON.stringify(picked.map((q) => q.id)),
      },
    });
    ok(res, {
      id: paper.id, title: paper.title, subject: paper.subject,
      mode: paper.mode, durationMin: paper.durationMin, questionCount: picked.length,
    }, "组卷成功");
  })
);

// GET /api/papers — 试卷列表(含题目数量)
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const list = await prisma.paper.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
    ok(res, {
      list: list.map((p) => ({
        id: p.id, title: p.title, subject: p.subject, mode: p.mode,
        durationMin: p.durationMin, questionCount: JSON.parse(p.questionIds || "[]").length, createdAt: p.createdAt,
      })),
    });
  })
);

// GET /api/papers/:id — 试卷详情(题目不含答案,顺序保持)
router.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const paper = await prisma.paper.findUnique({ where: { id: req.params.id } });
    if (!paper) return fail(res, 404, "试卷不存在");
    const ids = JSON.parse(paper.questionIds || "[]");
    const questions = await prisma.question.findMany({
      where: { id: { in: ids }, status: "PUBLISHED" },
      select: { id: true, subject: true, topic: true, difficulty: true, type: true, stem: true, options: true, source: true },
    });
    const map = new Map(questions.map((q) => [q.id, q]));
    ok(res, {
      id: paper.id, title: paper.title, subject: paper.subject, mode: paper.mode,
      durationMin: paper.durationMin, questionCount: ids.length,
      questions: ids.map((id) => map.get(id)).filter(Boolean),
    });
  })
);

export default router;
