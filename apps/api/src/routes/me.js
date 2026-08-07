import { Router } from "express";
import { prisma } from "../lib/db.js";
import { ok, fail, asyncHandler } from "../lib/res.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// GET /api/me/sessions — 我的成绩历史
router.get(
  "/sessions",
  requireAuth,
  asyncHandler(async (req, res) => {
    const where = { studentId: req.user.id };
    if (req.query.mode) where.mode = req.query.mode;
    const list = await prisma.session.findMany({
      where,
      select: {
        id: true, mode: true, score: true, total: true, correctCount: true, startedAt: true, submittedAt: true,
      },
      orderBy: { startedAt: "desc" },
    });
    ok(res, { list });
  })
);

// GET /api/me/wrongbook — 我的错题本
router.get(
  "/wrongbook",
  requireAuth,
  asyncHandler(async (req, res) => {
    const list = await prisma.wrongBook.findMany({
      where: { studentId: req.user.id },
      include: { question: { select: { id: true, topic: true, subject: true, difficulty: true, stem: true } } },
      orderBy: { updatedAt: "desc" },
    });
    ok(res, {
      list: list.map((w) => ({
        questionId: w.questionId,
        topic: w.question.topic,
        subject: w.question.subject,
        difficulty: w.question.difficulty,
        stem: w.question.stem,
        wrongCount: w.wrongCount,
        mastered: w.mastered,
      })),
    });
  })
);

// POST /api/me/wrongbook/:questionId/master — 标记掌握
router.post(
  "/wrongbook/:questionId/master",
  requireAuth,
  asyncHandler(async (req, res) => {
    const existed = await prisma.wrongBook.findUnique({
      where: { studentId_questionId: { studentId: req.user.id, questionId: req.params.questionId } },
    });
    if (!existed) return fail(res, 404, "错题不存在");
    await prisma.wrongBook.update({
      where: { id: existed.id },
      data: { mastered: true },
    });
    ok(res, null, "已标记掌握");
  })
);

// GET /api/me/stats — 知识点掌握度(按 topic 聚合)
router.get(
  "/stats",
  requireAuth,
  asyncHandler(async (req, res) => {
    const records = await prisma.answerRecord.findMany({
      where: { session: { studentId: req.user.id }, isCorrect: { not: null } },
      include: { question: { select: { topic: true } } },
    });
    const agg = new Map();
    for (const r of records) {
      const topic = r.question.topic || "未分类";
      const item = agg.get(topic) || { topic, attempts: 0, correct: 0 };
      item.attempts += 1;
      if (r.isCorrect) item.correct += 1;
      agg.set(topic, item);
    }
    ok(res, {
      byTopic: [...agg.values()].map(({ topic, attempts, correct }) => ({
        topic,
        attempts,
        correctRate: attempts ? Math.round((correct / attempts) * 100) : 0,
      })),
      totalAnswered: records.length,
    });
  })
);

export default router;
