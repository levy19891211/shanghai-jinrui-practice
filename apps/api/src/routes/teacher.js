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

// DELETE /api/teacher/students/:id — 删除学生(级联删除该学生所有相关数据)
// 关联数据:Session(及其 AnswerRecord)、WrongBook、RoguelikeRun、AssignmentStudent、User
router.delete(
  "/students/:id",
  asyncHandler(async (req, res) => {
    const student = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!student || student.role !== "STUDENT") return fail(res, 404, "学生不存在");
    if (student.id === req.user.id) return fail(res, 400, "不能删除自己");

    // 1) 该学生所有会话 → 会话的作答记录
    const sessions = await prisma.session.findMany({ where: { studentId: student.id }, select: { id: true } });
    const sessionIds = sessions.map((s) => s.id);
    if (sessionIds.length) {
      await prisma.answerRecord.deleteMany({ where: { sessionId: { in: sessionIds } } });
      await prisma.session.deleteMany({ where: { id: { in: sessionIds } } });
    }
    // 1b) 语言模块:语言会话 → 作答记录
    const langSessions = await prisma.languageSession.findMany({ where: { studentId: student.id }, select: { id: true } });
    const langSessionIds = langSessions.map((s) => s.id);
    if (langSessionIds.length) {
      await prisma.languageAnswerRecord.deleteMany({ where: { sessionId: { in: langSessionIds } } });
      await prisma.languageSession.deleteMany({ where: { id: { in: langSessionIds } } });
    }
    // 2) 作业分发目标
    await prisma.assignmentStudent.deleteMany({ where: { studentId: student.id } });
    // 3) 错题本 / 爬塔记录
    await prisma.wrongBook.deleteMany({ where: { studentId: student.id } });
    await prisma.languageWrongBook.deleteMany({ where: { studentId: student.id } });
    await prisma.roguelikeRun.deleteMany({ where: { studentId: student.id } });
    // 4) 学生账号
    await prisma.user.delete({ where: { id: student.id } });

    ok(res, { id: student.id }, `已删除学生「${student.name}」及其全部数据`);
  })
);

// ——— 作业分发 ———
// GET /api/teacher/assignments — 作业列表(含每份作业的完成统计);?mode=PRACTICE 只列作业
router.get(
  "/assignments",
  asyncHandler(async (req, res) => {
    const list = await prisma.assignment.findMany({
      where: { teacherId: req.user.id, ...(req.query.mode ? { mode: String(req.query.mode) } : {}) },
      include: {
        paper: { select: { title: true, mode: true, subject: true, sourceType: true } },
        languagePaper: { select: { id: true, title: true, examType: true, skill: true } },
        targets: { select: { status: true, submittedAt: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    ok(res, {
      list: list.map((a) => {
        const total = a.targets.length;
        const submitted = a.targets.filter((t) => t.status === "SUBMITTED").length;
        const inProgress = a.targets.filter((t) => t.status === "IN_PROGRESS").length;
        return {
          id: a.id, title: a.title, note: a.note, mode: a.mode, dueAt: a.dueAt, status: a.status, createdAt: a.createdAt,
          paper: a.paper ? { title: a.paper.title, mode: a.paper.mode, subject: a.paper.subject, sourceType: a.paper.sourceType } : null,
          languagePaper: a.languagePaper ? { id: a.languagePaper.id, title: a.languagePaper.title, examType: a.languagePaper.examType, skill: a.languagePaper.skill } : null,
          stats: { total, submitted, inProgress, pending: total - submitted - inProgress },
        };
      }),
    });
  })
);

// POST /api/teacher/assignments — 创建作业/考试分发(选试卷 + 选学生 + 可选 DDL)
// paperId: 学科卷;languagePaperId: 语言卷(雅思等)。二者选一
router.post(
  "/assignments",
  asyncHandler(async (req, res) => {
    const { paperId, languagePaperId, title, note, studentIds, dueAt, mode } = req.body || {};
    if (!paperId && !languagePaperId) return fail(res, 400, "请选择试卷");
    if (!Array.isArray(studentIds) || studentIds.length === 0) return fail(res, 400, "请选择至少一名学生");

    let paperTitle = "";
    if (paperId) {
      const paper = await prisma.paper.findUnique({ where: { id: paperId } });
      if (!paper) return fail(res, 404, "试卷不存在");
      paperTitle = paper.title;
    }
    let languagePaper = null;
    if (languagePaperId) {
      languagePaper = await prisma.languagePaper.findUnique({ where: { id: languagePaperId } });
      if (!languagePaper) return fail(res, 404, "语言试卷不存在");
      paperTitle = languagePaper.title;
    }

    // 校验学生存在且都是 STUDENT
    const students = await prisma.user.findMany({ where: { id: { in: studentIds }, role: "STUDENT" } });
    if (students.length !== studentIds.length) return fail(res, 400, "存在无效的学生");

    // 显式 mode 优先(学生管理「作业分发」固定传 PRACTICE);未传时按卷子模式推断
    const aMode =
      mode === "EXAM" ? "EXAM" :
      mode === "PRACTICE" ? "PRACTICE" :
      languagePaper?.mode === "EXAM" || (paperId && (await prisma.paper.findUnique({ where: { id: paperId } }))?.mode === "EXAM") ? "EXAM" : "PRACTICE";
    const parsedDue = dueAt ? new Date(dueAt) : null;
    if (parsedDue && Number.isNaN(parsedDue.getTime())) return fail(res, 400, "截止时间格式不正确");

    const assignment = await prisma.assignment.create({
      data: {
        teacherId: req.user.id,
        paperId: paperId || null,
        languagePaperId: languagePaperId || null,
        title: String(title || "").trim() || paperTitle,
        note: note ? String(note).trim() : null,
        mode: aMode,
        dueAt: parsedDue,
        targets: { create: studentIds.map((sid) => ({ studentId: sid })) },
      },
    });
    ok(res, { id: assignment.id }, `已向 ${students.length} 名学生布置「${assignment.title}」`);
  })
);

// DELETE /api/teacher/assignments/:id — 删除作业(撤回分发)
router.delete(
  "/assignments/:id",
  asyncHandler(async (req, res) => {
    const assignment = await prisma.assignment.findUnique({ where: { id: req.params.id } });
    if (!assignment || assignment.teacherId !== req.user.id) return fail(res, 404, "作业不存在");
    await prisma.assignmentStudent.deleteMany({ where: { assignmentId: assignment.id } });
    // 学生已开的作业会话保留(不删作答记录),仅解除作业关联
    await prisma.session.updateMany({ where: { assignmentId: assignment.id }, data: { assignmentId: null } });
    await prisma.languageSession.updateMany({ where: { assignmentId: assignment.id }, data: { assignmentId: null } });
    await prisma.assignment.delete({ where: { id: assignment.id } });
    ok(res, { id: assignment.id }, "作业已删除");
  })
);

// GET /api/teacher/assignments/:id — 作业详情(含每个学生的完成状态)
router.get(
  "/assignments/:id",
  asyncHandler(async (req, res) => {
    const assignment = await prisma.assignment.findUnique({
      where: { id: req.params.id },
      include: {
        paper: { select: { title: true, mode: true, subject: true, sourceType: true } },
        languagePaper: { select: { id: true, title: true, examType: true, skill: true } },
        targets: {
          include: { student: { select: { id: true, name: true, email: true } } },
        },
      },
    });
    if (!assignment || assignment.teacherId !== req.user.id) return fail(res, 404, "作业不存在");
    ok(res, {
      id: assignment.id, title: assignment.title, note: assignment.note, mode: assignment.mode, dueAt: assignment.dueAt,
      status: assignment.status, createdAt: assignment.createdAt,
      paper: assignment.paper,
      languagePaper: assignment.languagePaper,
      targets: assignment.targets.map((t) => ({
        studentId: t.studentId, name: t.student.name, email: t.student.email,
        status: t.status, submittedAt: t.submittedAt,
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
