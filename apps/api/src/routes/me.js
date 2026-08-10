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
      include: { question: { select: { id: true, topic: true, subject: true, difficulty: true, stem: true, solution: true, answer: true } } },
      orderBy: { updatedAt: "desc" },
    });
    ok(res, {
      list: list.map((w) => ({
        questionId: w.questionId,
        topic: w.question.topic,
        subject: w.question.subject,
        difficulty: w.question.difficulty,
        stem: w.question.stem,
        answer: w.question.answer,
        solution: w.question.solution,
        wrongCount: w.wrongCount,
        mastered: w.mastered,
      })),
    });
  })
);

// GET /api/me/wrongbook/topics — 错题本知识点汇总(供「按错题知识点组卷」多选)
router.get(
  "/wrongbook/topics",
  requireAuth,
  asyncHandler(async (req, res) => {
    const wb = await prisma.wrongBook.findMany({
      where: { studentId: req.user.id },
      include: { question: { select: { topic: true, status: true } } },
    });
    const agg = new Map();
    for (const w of wb) {
      if (w.question.status !== "PUBLISHED") continue;
      const t = String(w.question.topic || "").trim() || "未分类";
      agg.set(t, (agg.get(t) || 0) + 1);
    }
    ok(res, {
      list: [...agg.entries()]
        .map(([topic, count]) => ({ topic, count }))
        .sort((a, b) => b.count - a.count),
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
      include: {
        question: { select: { topic: true, subject: true, difficulty: true } },
        session: { select: { mode: true } },
      },
    });
    const byTopic = new Map();
    const bySubject = new Map();
    const byMode = new Map();
    const byDifficulty = new Map();
    let correctAnswered = 0;
    for (const r of records) {
      const correct = r.isCorrect ? 1 : 0;
      correctAnswered += correct;
      const topic = r.question.topic || "未分类";
      let t = byTopic.get(topic) || { topic, attempts: 0, correct: 0 };
      t.attempts += 1; t.correct += correct; byTopic.set(topic, t);
      const subject = r.question.subject || "其他";
      let s = bySubject.get(subject) || { subject, attempts: 0, correct: 0 };
      s.attempts += 1; s.correct += correct; bySubject.set(subject, s);
      const mode = r.session?.mode || "PRACTICE";
      let m = byMode.get(mode) || { mode, attempts: 0, correct: 0 };
      m.attempts += 1; m.correct += correct; byMode.set(mode, m);
      const diff = r.question.difficulty ?? 3;
      let d = byDifficulty.get(diff) || { difficulty: diff, attempts: 0, correct: 0 };
      d.attempts += 1; d.correct += correct; byDifficulty.set(diff, d);
    }
    const rate = (o) => (o.attempts ? Math.round((o.correct / o.attempts) * 100) : 0);
    ok(res, {
      totalAnswered: records.length,
      correctAnswered,
      overallRate: records.length ? Math.round((correctAnswered / records.length) * 100) : 0,
      byTopic: [...byTopic.values()].map(({ topic, attempts, correct }) => ({ topic, attempts, correctRate: rate({ attempts, correct }) })),
      bySubject: [...bySubject.values()].map(({ subject, attempts, correct }) => ({ subject, attempts, correctRate: rate({ attempts, correct }) })).sort((a, b) => b.correctRate - a.correctRate),
      byMode: [...byMode.values()].map(({ mode, attempts, correct }) => ({ mode, attempts, correctRate: rate({ attempts, correct }) })),
      byDifficulty: [...byDifficulty.values()].map(({ difficulty, attempts, correct }) => ({ difficulty, attempts, correctRate: rate({ attempts, correct }) })).sort((a, b) => a.difficulty - b.difficulty),
    });
  })
);

// GET /api/me/assignments — 我的作业(待完成 + 已完成)
router.get(
  "/assignments",
  requireAuth,
  asyncHandler(async (req, res) => {
    const targets = await prisma.assignmentStudent.findMany({
      where: { studentId: req.user.id },
      include: {
        assignment: {
          include: {
            paper: { select: { title: true, mode: true, durationMin: true, subject: true, sourceType: true } },
            languagePaper: { select: { title: true, mode: true, durationMin: true, examType: true, skill: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    const now = Date.now();
    const list = targets.map((t) => {
      const a = t.assignment;
      let status = t.status;
      // PENDING 且已过 DDL → 过期
      if (status === "PENDING" && a.dueAt && now > new Date(a.dueAt).getTime()) status = "EXPIRED";
      const isLanguage = !!a.languagePaperId;
      const lp = a.languagePaper;
      const pp = a.paper;
      return {
        id: t.assignmentId,
        title: a.title,
        note: a.note,
        mode: a.mode,
        dueAt: a.dueAt,
        status,
        submittedAt: t.submittedAt,
        sessionId: t.sessionId,
        isLanguage,
        paper: isLanguage
          ? { title: lp?.title, mode: lp?.mode, durationMin: lp?.durationMin, subject: null, sourceType: null, isLanguage: true, examType: lp?.examType, skill: lp?.skill }
          : { title: pp?.title, mode: pp?.mode, durationMin: pp?.durationMin, subject: pp?.subject, sourceType: pp?.sourceType, isLanguage: false },
      };
    });
    ok(res, { list });
  })
);

export default router;
