import { Router } from "express";
import { prisma } from "../lib/db.js";
import { ok, fail, asyncHandler } from "../lib/res.js";
import { grade } from "../lib/grading.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// 面向学生的题目字段(不含答案与解析)
const QUIZ_FIELDS = {
  id: true, subject: true, paper: true, topic: true, difficulty: true, type: true, stem: true, options: true, source: true,
};

// 组卷:确定题目集合
async function resolveQuestionIds(body) {
  // 作业/考试分发:试卷与时长全部由作业决定,不接收前端传入
  if (body.assignmentId) {
    const target = await prisma.assignmentStudent.findUnique({
      where: { assignmentId_studentId: { assignmentId: String(body.assignmentId), studentId: body._userId } },
      include: { assignment: { include: { paper: true } } },
    });
    if (!target) throw Object.assign(new Error("您没有被布置这份作业"), { code: 403 });
    if (!target.assignment?.paper) throw Object.assign(new Error("作业对应的试卷不存在"), { code: 404 });
    return JSON.parse(target.assignment.paper.questionIds || "[]");
  }
  if (body.paperId) {
    const paper = await prisma.paper.findUnique({ where: { id: body.paperId } });
    if (!paper) throw Object.assign(new Error("试卷不存在"), { code: 404 });
    // 学生自建卷仅创建者本人可作答;普通卷需「可作答」状态
    if (paper.origin === "STUDENT" && paper.createdBy !== body._userId) {
      throw Object.assign(new Error("这不是您的试卷"), { code: 403 });
    }
    if (paper.origin !== "STUDENT" && paper.status !== "READY") {
      throw Object.assign(new Error("该试卷暂不可作答"), { code: 400 });
    }
    return JSON.parse(paper.questionIds || "[]");
  }
  if (Array.isArray(body.questionIds) && body.questionIds.length > 0) {
    return body.questionIds;
  }
  // 默认:从已发布题目中随机抽取 10 道(支持 subject/subjects/difficulty/knowledgePointId 过滤)
  const where = { status: "PUBLISHED" };
  if (body.subject) where.subject = body.subject;
  if (body.subjects) {
    const subs = String(body.subjects).split(",").map((s) => s.trim()).filter(Boolean);
    if (subs.length) where.subject = { in: subs };
  }
  if (body.difficulty) where.difficulty = Number(body.difficulty);
  // 按知识点组卷:只抽取挂了该知识点标签的题
  if (body.knowledgePointId) where.topicIds = { contains: String(body.knowledgePointId) };
  const all = await prisma.question.findMany({ where, select: { id: true } });
  const picked = all.sort(() => Math.random() - 0.5).slice(0, Number(body.limit) || 10);
  return picked.map((q) => q.id);
}

// POST /api/sessions — 创建答题会话
router.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const mode = req.body?.mode === "EXAM" ? "EXAM" : "PRACTICE";
    let questionIds;
    try {
      questionIds = await resolveQuestionIds({ ...(req.body || {}), _userId: req.user.id });
    } catch (e) {
      return fail(res, e.code || 500, e.message);
    }
    if (questionIds.length === 0) return fail(res, 400, "题库为空,暂无可作答题目");

    // 作业/考试分发:模式、试卷、时长、DDL 全部由作业决定
    let assignmentId = null;
    let assignmentPaperId = null;
    if (req.body?.assignmentId) {
      const target = await prisma.assignmentStudent.findUnique({
        where: { assignmentId_studentId: { assignmentId: String(req.body.assignmentId), studentId: req.user.id } },
        include: { assignment: { include: { paper: true } } },
      });
      if (!target) return fail(res, 403, "您没有被布置这份作业");
      if (target.status === "SUBMITTED") return fail(res, 400, "这份作业已提交,请勿重复作答");
      const assignment = target.assignment;
      if (assignment?.dueAt && new Date() > assignment.dueAt) return fail(res, 400, "该作业已过截止时间,无法作答");
      if (!assignment?.paper) return fail(res, 404, "作业对应的试卷不存在");
      assignmentId = assignment.id;
      assignmentPaperId = assignment.paper.id;
    }

    // 限时:EXAM 模式必须有时长(整数分钟)。
    // 指定了试卷 → 强制用试卷配置的时长(学生不能改,前端也不传);随机组卷 → 用学生选的时长。
    // 作业类型的 EXAM → 用作业所选试卷的时长
    let durationMin = null;
    if (mode === "EXAM") {
      if (assignmentPaperId || req.body?.paperId) {
        const paper = await prisma.paper.findUnique({ where: { id: assignmentPaperId || req.body.paperId } });
        durationMin = paper?.durationMin ?? null;
      } else {
        durationMin = Math.round(Number(req.body?.durationMin));
      }
      if (!durationMin || durationMin <= 0) return fail(res, 400, "模拟考必须指定时长(分钟)");
    }

    const session = await prisma.session.create({
      data: {
        studentId: req.user.id,
        paperId: assignmentPaperId || req.body?.paperId || null,
        assignmentId,
        mode,
        durationMin,
        // EXAM 模式:记录绝对截止时间,中途退出暂停时可改写(见 /pause)
        deadlineAt: mode === "EXAM" && durationMin ? new Date(Date.now() + durationMin * 60000) : null,
        questionIds: JSON.stringify(questionIds),
        total: questionIds.length,
      },
    });

    // 作业目标回写:记录会话 id,标记进行中(若当前还是 PENDING)
    if (assignmentId) {
      await prisma.assignmentStudent.updateMany({
        where: { assignmentId, studentId: req.user.id, status: "PENDING" },
        data: { sessionId: session.id, status: "IN_PROGRESS" },
      });
    }
    const questionsRaw = await prisma.question.findMany({ where: { id: { in: questionIds } }, select: QUIZ_FIELDS });
    // 统一将 options 从 JSON 字符串解析为数组,避免前端 q.options.map 报错
    const questions = questionsRaw.map((q) => ({ ...q, options: safeParseOptions(q.options) }));
    ok(res, { sessionId: session.id, mode, durationMin, questions }, "会话已创建");
  })
);

// 安全解析 options 字段(JSON 字符串或已是数组)
function safeParseOptions(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const arr = JSON.parse(value);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// 计算会话截止时间(EXAM)
// 优先用持久化的 deadlineAt(已包含中途暂停的补偿);没有则按 startedAt + 时长推算。
function deadlineOf(session) {
  if (session.mode !== "EXAM") return null;
  if (session.deadlineAt) return new Date(session.deadlineAt);
  if (!session.durationMin) return null;
  return new Date(session.startedAt.getTime() + session.durationMin * 60000);
}

// POST /api/sessions/:id/answer — 保存单题作答(实时保存,可覆盖)
router.post(
  "/:id/answer",
  requireAuth,
  asyncHandler(async (req, res) => {
    const session = await prisma.session.findUnique({ where: { id: req.params.id } });
    if (!session || session.studentId !== req.user.id) return fail(res, 404, "会话不存在");
    if (session.submittedAt) return fail(res, 400, "会话已提交,无法再作答");
    // 考试超时:不可再作答
    const deadline = deadlineOf(session);
    if (deadline && Date.now() > deadline.getTime()) {
      return fail(res, 400, "考试时间已到,请提交试卷");
    }
    const { questionId, selected, timeSpent } = req.body || {};
    if (!questionId) return fail(res, 400, "questionId 必填");

    const question = await prisma.question.findUnique({ where: { id: questionId } });
    if (!question) return fail(res, 404, "题目不存在");

    await prisma.answerRecord.upsert({
      where: { sessionId_questionId: { sessionId: session.id, questionId } },
      create: { sessionId: session.id, questionId, selected: selected ?? null, timeSpent: Number(timeSpent) || null },
      update: { selected: selected ?? null, timeSpent: Number(timeSpent) || null },
    });
    ok(res, null, "已保存");
  })
);

// POST /api/sessions/:id/pause — 模拟考中途退出时暂停计时
// 前端通过 fetch({keepalive:true}) 在页面隐藏/卸载时上报当前剩余秒数;
// 服务端把 deadlineAt 改写为 now + remaining,使计时暂停(继续做题时从剩余时间起算)。
router.post(
  "/:id/pause",
  requireAuth,
  asyncHandler(async (req, res) => {
    const session = await prisma.session.findUnique({ where: { id: req.params.id } });
    if (!session || session.studentId !== req.user.id) return fail(res, 404, "会话不存在");
    if (session.submittedAt) return fail(res, 400, "会话已提交");
    if (session.mode !== "EXAM") return fail(res, 400, "仅模拟考支持暂停计时");
    let remaining = Number(req.body?.remaining);
    if (!Number.isFinite(remaining) || remaining < 0) remaining = 0;
    const deadlineAt = remaining > 0 ? new Date(Date.now() + remaining * 1000) : new Date(Date.now());
    await prisma.session.update({
      where: { id: session.id },
      data: { deadlineAt, pausedRemaining: Math.round(remaining) },
    });
    ok(res, null, "已暂停计时");
  })
);

// POST /api/sessions/:id/submit — 提交判分
router.post(
  "/:id/submit",
  requireAuth,
  asyncHandler(async (req, res) => {
    const session = await prisma.session.findUnique({ where: { id: req.params.id }, include: { records: true } });
    if (!session || session.studentId !== req.user.id) return fail(res, 404, "会话不存在");
    if (session.submittedAt) return fail(res, 400, "会话已提交");

    // 补齐未答题目记录:交卷后错题回顾需要显示所有题目(含未答)
    let allIds = null;
    try {
      const parsed = session.questionIds ? JSON.parse(session.questionIds) : null;
      // 去重,避免试卷/题目列表里同一题重复导致结果重复
      if (Array.isArray(parsed)) allIds = [...new Set(parsed.map(String))];
    } catch {
      /* ignore */
    }
    if (allIds && allIds.length === 0) allIds = null;
    if (allIds) {
      const existingIds = new Set(session.records.map((r) => r.questionId));
      const missing = allIds.filter((id) => !existingIds.has(id));
      if (missing.length > 0) {
        await prisma.answerRecord.createMany({
          data: missing.map((questionId) => ({ sessionId: session.id, questionId })),
        });
      }
    }
    const recs = allIds
      ? allIds.map((id) => session.records.find((r) => r.questionId === id) || { questionId: id, selected: null })
      : session.records;

    const questions = await prisma.question.findMany({
      where: { id: { in: recs.map((r) => r.questionId) } },
    });
    const qMap = new Map(questions.map((q) => [q.id, q]));
    const result = grade(
      recs.map((r) => ({ question: qMap.get(r.questionId), selected: r.selected }))
    );

    // 超时标记(EXAM 模式且已过截止时间)
    const deadline = deadlineOf(session);
    const timedOut = !!(deadline && Date.now() > deadline.getTime());

    // 写回判分结果
    await prisma.$transaction([
      ...result.details.map((d) =>
        prisma.answerRecord.update({
          where: { sessionId_questionId: { sessionId: session.id, questionId: d.questionId } },
          data: { isCorrect: d.isCorrect },
        })
      ),
      prisma.session.update({
        where: { id: session.id },
        data: { score: result.score, correctCount: result.correctCount, submittedAt: new Date() },
      }),
      // 错题写入错题本
      ...result.details
        .filter((d) => !d.isCorrect)
        .map((d) =>
          prisma.wrongBook.upsert({
            where: { studentId_questionId: { studentId: req.user.id, questionId: d.questionId } },
            create: { studentId: req.user.id, questionId: d.questionId, wrongCount: 1 },
            update: { wrongCount: { increment: 1 }, mastered: false },
          })
        ),
      // 作业类型会话提交 → 回写作业目标为已交
      ...(session.assignmentId
        ? [
            prisma.assignmentStudent.updateMany({
              where: { assignmentId: session.assignmentId, studentId: req.user.id },
              data: { status: "SUBMITTED", submittedAt: new Date() },
            }),
          ]
        : []),
    ]);
    ok(res, { ...result, timedOut }, "判分完成");
  })
);

// GET /api/sessions/:id — 会话详情(本人或老师)
router.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const session = await prisma.session.findUnique({
      where: { id: req.params.id },
      include: {
        records: { include: { question: true } },
      },
    });
    if (!session) return fail(res, 404, "会话不存在");
    const isOwner = session.studentId === req.user.id;
    const isTeacher = ["TEACHER", "ADMIN"].includes(req.user.role);
    if (!isOwner && !isTeacher) return fail(res, 403, "无权限查看");

    let details;
    let answeredCount = 0;
    if (session.submittedAt) {
      // 已提交:仅返回答题记录(含答案与解析),供成绩回顾
      const seenQ = new Set();
      details = session.records
        .filter((r) => {
          if (seenQ.has(r.questionId)) return false;
          seenQ.add(r.questionId);
          return true;
        })
        .map((r) => ({
          questionId: r.questionId,
          selected: r.selected,
          isCorrect: r.isCorrect,
          timeSpent: r.timeSpent,
          options: JSON.parse(r.question.options || "[]"),
          answer: r.question.answer,
          solution: r.question.solution,
          stem: r.question.stem,
          topic: r.question.topic,
        }));
    } else {
      // 进行中:返回完整题目列表(从 questionIds 还原顺序),并附上已实时保存的答案,
      // 这样学生中途退出后再进入本会话即可恢复全部题目与已做作答,不会丢失未答题。
      let ids = [];
      try {
        const parsed = session.questionIds ? JSON.parse(session.questionIds) : null;
        if (Array.isArray(parsed)) ids = [...new Set(parsed.map(String))];
      } catch {
        /* ignore */
      }
      const recMap = new Map(session.records.map((r) => [r.questionId, r]));
      const questions =
        ids.length > 0
          ? await prisma.question.findMany({ where: { id: { in: ids } }, select: QUIZ_FIELDS })
          : [];
      const qMap = new Map(questions.map((q) => [q.id, q]));
      details = ids
        .map((qid) => {
          const q = qMap.get(qid);
          if (!q) return null;
          const rec = recMap.get(qid);
          const selected = rec?.selected ?? null;
          if (selected != null) answeredCount += 1;
          return {
            questionId: qid,
            selected,
            isCorrect: null,
            timeSpent: rec?.timeSpent ?? null,
            options: safeParseOptions(q.options),
            answer: undefined,
            solution: undefined,
            stem: q.stem,
            topic: q.topic,
          };
        })
        .filter(Boolean);
    }
    ok(res, {
      id: session.id,
      mode: session.mode,
      durationMin: session.durationMin,
      deadlineAt: session.deadlineAt,
      pausedRemaining: session.pausedRemaining,
      score: session.score,
      total: session.total,
      correctCount: session.correctCount,
      startedAt: session.startedAt,
      submittedAt: session.submittedAt,
      answeredCount,
      details,
    });
  })
);

export default router;
