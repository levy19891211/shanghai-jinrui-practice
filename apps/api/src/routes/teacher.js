import { Router } from "express";
import { prisma } from "../lib/db.js";
import { ok, fail, asyncHandler } from "../lib/res.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
// 老师/管理员专用
router.use(requireAuth, requireRole("TEACHER", "ADMIN"));

// GET /api/teacher/students — 学生列表 + 成绩概览(可搜索)
router.get(
  "/students",
  asyncHandler(async (req, res) => {
    const search = req.query.search ? String(req.query.search).trim() : "";
    const where = {
      role: "STUDENT",
      ...(search ? { OR: [{ name: { contains: search } }, { email: { contains: search } }] } : {}),
    };
    const students = await prisma.user.findMany({
      where,
      select: { id: true, name: true, email: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    const list = [];
    for (const s of students) {
      const sessions = await prisma.session.findMany({
        where: { studentId: s.id, submittedAt: { not: null } },
        select: { score: true, total: true, mode: true, submittedAt: true },
        orderBy: { submittedAt: "desc" },
      });
      const answered = sessions.filter((x) => x.total && x.total > 0);
      const sumScore = answered.reduce((a, x) => a + (x.score ?? 0), 0);
      const sumTotal = answered.reduce((a, x) => a + (x.total ?? 0), 0);
      const last = sessions[0];
      list.push({
        id: s.id,
        name: s.name,
        email: s.email,
        createdAt: s.createdAt,
        sessionCount: sessions.length,
        avgRate: sumTotal ? Math.round((sumScore / sumTotal) * 100) : 0,
        lastSession: last ? { score: last.score, total: last.total, mode: last.mode, submittedAt: last.submittedAt } : null,
      });
    }
    // 按平均正确率降序
    list.sort((a, b) => b.avgRate - a.avgRate);
    ok(res, { list });
  })
);

// GET /api/teacher/students/:id/stats — 单个学生详情(成绩历史 + 知识点掌握度)
router.get(
  "/students/:id/stats",
  asyncHandler(async (req, res) => {
    const student = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!student || student.role !== "STUDENT") return fail(res, 404, "学生不存在");

    const sessions = await prisma.session.findMany({
      where: { studentId: student.id },
      orderBy: { startedAt: "desc" },
      select: { id: true, mode: true, score: true, total: true, correctCount: true, startedAt: true, submittedAt: true },
    });

    const records = await prisma.answerRecord.findMany({
      where: { session: { studentId: student.id }, isCorrect: { not: null } },
      include: { question: { select: { topic: true } } },
    });
    const agg = new Map();
    for (const r of records) {
      const t = r.question.topic || "未分类";
      const item = agg.get(t) || { topic: t, attempts: 0, correct: 0 };
      item.attempts += 1;
      if (r.isCorrect) item.correct += 1;
      agg.set(t, item);
    }
    ok(res, {
      student: { id: student.id, name: student.name, email: student.email, createdAt: student.createdAt },
      sessions,
      byTopic: [...agg.values()].map(({ topic, attempts, correct }) => ({
        topic, attempts, correctRate: attempts ? Math.round((correct / attempts) * 100) : 0,
      })),
    });
  })
);

// GET /api/teacher/stats/overview — 班级学情总览(学生数/刷题量/薄弱知识点 TOP)
router.get(
  "/stats/overview",
  asyncHandler(async (req, res) => {
    const [students, sessions, records] = await Promise.all([
      prisma.user.count({ where: { role: "STUDENT" } }),
      prisma.session.count({ where: { submittedAt: { not: null } } }),
      prisma.answerRecord.findMany({
        where: { isCorrect: { not: null } },
        include: { question: { select: { topic: true } } },
      }),
    ]);
    const agg = new Map();
    for (const r of records) {
      const t = r.question.topic || "未分类";
      const item = agg.get(t) || { topic: t, attempts: 0, correct: 0 };
      item.attempts += 1;
      if (r.isCorrect) item.correct += 1;
      agg.set(t, item);
    }
    ok(res, {
      students,
      sessions,
      totalAnswered: records.length,
      byTopic: [...agg.values()]
        .map(({ topic, attempts, correct }) => ({ topic, attempts, correctRate: attempts ? Math.round((correct / attempts) * 100) : 0 }))
        .sort((a, b) => a.correctRate - b.correctRate),
    });
  })
);

export default router;
