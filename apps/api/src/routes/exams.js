import { Router } from "express";
import { prisma } from "../lib/db.js";
import { ok, fail, asyncHandler } from "../lib/res.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { parseIds } from "../lib/paper-set.js";
import { llmConfigured, chatComplete } from "../lib/llm.js";

const router = Router();
router.use(requireAuth, requireRole("TEACHER", "ADMIN"));

// ——— 考情分析核心:一次算完 每考生结果 + 每题统计 + 整体 + 规则建议 ———
async function analyzeExam(assignmentId) {
  const exam = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      paper: { select: { id: true, title: true, mode: true, subject: true, sourceType: true, durationMin: true, questionIds: true } },
      targets: { include: { student: { select: { id: true, name: true, email: true } } } },
    },
  });
  if (!exam || exam.mode !== "EXAM" || !exam.paperId) return null; // 仅学科卷考试

  const sessions = await prisma.session.findMany({
    where: { assignmentId: exam.id },
    select: { id: true, studentId: true, score: true, total: true, correctCount: true, startedAt: true, submittedAt: true },
  });
  const sessionByStudent = new Map(sessions.map((s) => [s.studentId, s]));
  const sessionIds = sessions.map((s) => s.id);
  const records = sessionIds.length
    ? await prisma.answerRecord.findMany({
        where: { sessionId: { in: sessionIds }, isCorrect: { not: null } },
        select: { questionId: true, isCorrect: true },
      })
    : [];

  // 每考生结果
  const students = exam.targets.map((t) => {
    const s = sessionByStudent.get(t.studentId);
    return {
      studentId: t.studentId,
      name: t.student.name,
      email: t.student.email,
      status: t.status,
      submittedAt: t.submittedAt,
      score: s?.score ?? null,
      total: s?.total ?? null,
      correctCount: s?.correctCount ?? null,
      correctRate: s && s.total ? Math.round(((s.correctCount ?? 0) / s.total) * 100) : null,
      startedAt: s?.startedAt ?? null,
    };
  });

  // 每题统计
  const qids = exam.paper ? parseIds(exam.paper) : [];
  const questions = qids.length
    ? await prisma.question.findMany({ where: { id: { in: qids } }, select: { id: true, topic: true, difficulty: true } })
    : [];
  const qById = new Map(questions.map((q) => [q.id, q]));
  const qStats = new Map();
  for (const r of records) {
    const st = qStats.get(r.questionId) || { attempts: 0, correct: 0 };
    st.attempts += 1;
    if (r.isCorrect) st.correct += 1;
    qStats.set(r.questionId, st);
  }
  const perQuestion = qids.map((id, i) => {
    const q = qById.get(id);
    const st = qStats.get(id) || { attempts: 0, correct: 0 };
    return {
      questionId: id,
      index: i + 1,
      topic: q?.topic || "",
      difficulty: q?.difficulty ?? null,
      attempts: st.attempts,
      correct: st.correct,
      correctRate: st.attempts ? Math.round((st.correct / st.attempts) * 100) : null,
    };
  });

  const submittedList = students.filter((s) => s.submittedAt && s.correctRate != null);
  const overall = {
    totalStudents: exam.targets.length,
    submitted: submittedList.length,
    pending: exam.targets.filter((t) => t.status === "PENDING").length,
    inProgress: exam.targets.filter((t) => t.status === "IN_PROGRESS").length,
    avgCorrectRate: submittedList.length ? Math.round(submittedList.reduce((a, s) => a + s.correctRate, 0) / submittedList.length) : null,
    avgScore: submittedList.length ? submittedList.reduce((a, s) => a + (s.score || 0), 0) / submittedList.length : null,
  };

  // 规则建议
  const suggestions = [];
  if (overall.submitted === 0) {
    suggestions.push("暂无学生提交。建议提醒考生尽快完成考试,或检查截止时间是否合理。");
  } else {
    const byTopic = new Map();
    for (const pq of perQuestion) {
      if (pq.attempts === 0 || !pq.topic) continue;
      const t = byTopic.get(pq.topic) || { topic: pq.topic, attempts: 0, correct: 0 };
      t.attempts += pq.attempts;
      t.correct += pq.correct;
      byTopic.set(pq.topic, t);
    }
    for (const t of byTopic.values()) {
      const rate = Math.round((t.correct / t.attempts) * 100);
      if (rate < 60) suggestions.push(`知识点「${t.topic}」正确率仅 ${rate}%(${t.correct}/${t.attempts}),建议安排专项讲解或针对性练习。`);
    }
    for (const pq of perQuestion) {
      if (pq.attempts >= 2 && pq.correctRate != null && pq.correctRate < 60) {
        suggestions.push(`第 ${pq.index} 题(${pq.topic || "未分类"})正确率仅 ${pq.correctRate}%,建议在课堂上重点讲评。`);
      }
    }
    for (const s of submittedList.filter((x) => x.correctRate < 50)) {
      suggestions.push(`学生「${s.name}」正确率 ${s.correctRate}%,建议重点关注并安排个别辅导。`);
    }
    if (suggestions.length === 0) suggestions.push("整体掌握情况良好,可继续按原计划推进教学。");
  }

  return {
    exam: { id: exam.id, title: exam.title, note: exam.note, dueAt: exam.dueAt, createdAt: exam.createdAt },
    paper: exam.paper
      ? { id: exam.paper.id, title: exam.paper.title, subject: exam.paper.subject, sourceType: exam.paper.sourceType, mode: exam.paper.mode, durationMin: exam.paper.durationMin, questionCount: qids.length }
      : null,
    students,
    perQuestion,
    overall,
    suggestions,
  };
}

// GET /api/exams — 考试列表
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const list = await prisma.assignment.findMany({
      where: { teacherId: req.user.id, mode: "EXAM", paperId: { not: null } }, // 只管理学科卷考试,语言卷(雅思)模考不在此模块
      include: {
        paper: { select: { title: true, mode: true, subject: true, sourceType: true, durationMin: true } },
        targets: { select: { status: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    ok(res, {
      list: list.map((a) => {
        const total = a.targets.length;
        const submitted = a.targets.filter((t) => t.status === "SUBMITTED").length;
        const inProgress = a.targets.filter((t) => t.status === "IN_PROGRESS").length;
        return {
          id: a.id,
          title: a.title,
          note: a.note,
          mode: a.mode,
          dueAt: a.dueAt,
          status: a.status,
          createdAt: a.createdAt,
          paper: a.paper ? { title: a.paper.title, mode: a.paper.mode, subject: a.paper.subject, sourceType: a.paper.sourceType, durationMin: a.paper.durationMin } : null,
          stats: { total, submitted, inProgress, pending: total - submitted - inProgress },
        };
      }),
    });
  })
);

// POST /api/exams — 安排考试(选考卷 + 选考生)
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { paperId, studentIds, title, note, dueAt } = req.body || {};
    if (!paperId) return fail(res, 400, "请选择考卷");
    if (!Array.isArray(studentIds) || studentIds.length === 0) return fail(res, 400, "请选择至少一名考生");
    const paper = await prisma.paper.findUnique({ where: { id: paperId } });
    if (!paper) return fail(res, 404, "试卷不存在");
    if (paper.status !== "READY") return fail(res, 400, "该试卷尚未「可作答」:卷内还有题目未通过审核。请先在试卷管理里把题目审核发布。");
    const students = await prisma.user.findMany({ where: { id: { in: studentIds }, role: "STUDENT" } });
    if (students.length !== studentIds.length) return fail(res, 400, "存在无效的学生");
    const parsedDue = dueAt ? new Date(dueAt) : null;
    if (parsedDue && Number.isNaN(parsedDue.getTime())) return fail(res, 400, "截止时间格式不正确");
    const assignment = await prisma.assignment.create({
      data: {
        teacherId: req.user.id,
        paperId,
        title: String(title || "").trim() || paper.title,
        note: note ? String(note).trim() : null,
        mode: "EXAM",
        dueAt: parsedDue,
        targets: { create: studentIds.map((sid) => ({ studentId: sid })) },
      },
    });
    ok(res, { id: assignment.id }, `已安排考试「${assignment.title}」,考生 ${students.length} 人`);
  })
);

// DELETE /api/exams/:id — 删除考试(撤回安排;已提交的作答记录保留,仅解除关联)
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const exam = await prisma.assignment.findUnique({ where: { id: req.params.id } });
    if (!exam || exam.teacherId !== req.user.id || exam.mode !== "EXAM") return fail(res, 404, "考试不存在");
    await prisma.assignmentStudent.deleteMany({ where: { assignmentId: exam.id } });
    await prisma.session.updateMany({ where: { assignmentId: exam.id }, data: { assignmentId: null } });
    await prisma.languageSession.updateMany({ where: { assignmentId: exam.id }, data: { assignmentId: null } });
    await prisma.assignment.delete({ where: { id: exam.id } });
    ok(res, { id: exam.id }, "考试已删除");
  })
);

// GET /api/exams/:id/analysis — 考情分析(每考生结果 + 每题统计 + 整体 + 规则建议)
router.get(
  "/:id/analysis",
  asyncHandler(async (req, res) => {
    const analysis = await analyzeExam(req.params.id);
    if (!analysis) return fail(res, 404, "考试不存在");
    const exam = await prisma.assignment.findUnique({ where: { id: req.params.id } });
    if (!exam || exam.teacherId !== req.user.id) return fail(res, 404, "考试不存在");
    ok(res, analysis);
  })
);

// POST /api/exams/:id/suggest — AI 教学建议(可选,需配置 LLM)
router.post(
  "/:id/suggest",
  asyncHandler(async (req, res) => {
    if (!llmConfigured()) {
      return fail(res, 400, "服务端未配置 LLM_API_KEY,无法生成 AI 教学建议。请在 .env 配置 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL。");
    }
    const analysis = await analyzeExam(req.params.id);
    if (!analysis) return fail(res, 404, "考试不存在");
    const exam = await prisma.assignment.findUnique({ where: { id: req.params.id } });
    if (!exam || exam.teacherId !== req.user.id) return fail(res, 404, "考试不存在");

    const summary = JSON.stringify(
      {
        paper: analysis.paper,
        overall: analysis.overall,
        weakStudents: analysis.students.filter((s) => s.correctRate != null && s.correctRate < 50).map((s) => ({ name: s.name, rate: s.correctRate })),
        weakQuestions: analysis.perQuestion.filter((q) => q.correctRate != null && q.correctRate < 60).map((q) => ({ index: q.index, topic: q.topic, rate: q.correctRate, attempts: q.attempts })),
        weakTopics: [...new Set(analysis.perQuestion.filter((q) => q.correctRate != null && q.correctRate < 60).map((q) => q.topic).filter(Boolean))],
      },
      null,
      2
    );
    const suggestion = await chatComplete({
      system:
        "你是一位经验丰富的国际课程(A Level / TMUA / ESAT)数学、物理老师。根据下面某套试卷的班级考试数据,给老师 3-5 条具体、可执行的教学建议,中文,每条用 - 开头一句话。不要编造数据,不要复述原始 JSON。",
      user: summary,
      temperature: 0.3,
      maxTokens: 700,
    });
    ok(res, { suggestion });
  })
);

export default router;
