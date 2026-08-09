import { Router } from "express";
import { prisma } from "../lib/db.js";
import { ok, fail, asyncHandler } from "../lib/res.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { parseIds, recalcPaper } from "../lib/paper-set.js";

const router = Router();

// 一次性算出多张卷的审核分布,避免逐卷查库(N+1)
async function statsForPapers(papers) {
  const allIds = [...new Set(papers.flatMap((p) => parseIds(p)))];
  const rows = allIds.length
    ? await prisma.question.findMany({ where: { id: { in: allIds } }, select: { id: true, status: true } })
    : [];
  const statusOf = new Map(rows.map((r) => [r.id, r.status]));
  const out = new Map();
  for (const p of papers) {
    const ids = parseIds(p);
    const c = { PUBLISHED: 0, PENDING_REVIEW: 0, REJECTED: 0, DRAFT: 0, ARCHIVED: 0 };
    let missing = 0;
    for (const id of ids) {
      const s = statusOf.get(id);
      if (!s) missing++;
      else if (c[s] !== undefined) c[s]++;
    }
    out.set(p.id, {
      total: ids.length,
      published: c.PUBLISHED,
      pending: c.PENDING_REVIEW,
      rejected: c.REJECTED,
      draft: c.DRAFT,
      archived: c.ARCHIVED,
      missing,
    });
  }
  return out;
}

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
    if (all.length === 0) {
      // 逐层回溯,精确告诉老师是哪个条件把题目筛空了
      const subjectPool = await prisma.question.findMany({
        where: { status: "PUBLISHED", subject },
        select: { topic: true, difficulty: true },
      });
      if (subjectPool.length === 0) {
        const others = await prisma.question.groupBy({
          by: ["subject"],
          where: { status: "PUBLISHED" },
          _count: { _all: true },
        });
        const hint = others.length
          ? `目前有已发布题目的科目:${others.map((o) => `${o.subject}(${o._count._all}道)`).join("、")}`
          : "题库中还没有任何已发布题目,请先到「题库管理」审核通过题目";
        return fail(res, 400, `科目「${subject}」下没有已发布的题目。${hint}`);
      }
      const availTopics = [...new Set(subjectPool.map((q) => q.topic).filter(Boolean))];
      const availDiffs = [...new Set(subjectPool.map((q) => q.difficulty).filter((d) => d != null))].sort((a, b) => a - b);
      const parts = [];
      if (where.topic) parts.push(`知识点(可选:${availTopics.join("、") || "无"})`);
      if (where.difficulty) parts.push(`难度(可选:${availDiffs.join("、") || "无"})`);
      return fail(
        res,
        400,
        `科目「${subject}」有 ${subjectPool.length} 道已发布题目,但被${parts.join("和")}筛选条件排除了。请放宽或清空这些条件。`
      );
    }
    const picked = all.sort(() => Math.random() - 0.5).slice(0, Math.min(total, all.length));
    const paper = await prisma.paper.create({
      data: {
        title,
        subject,
        mode: mode === "EXAM" ? "EXAM" : "PRACTICE",
        durationMin: Number(durationMin) || null,
        questionIds: JSON.stringify(picked.map((q) => q.id)),
        origin: "MANUAL",
      },
    });
    // 手动组卷只从已发布题目中抽取,推导后应为 READY;仍走一遍重算保证口径统一
    await recalcPaper(paper.id);
    ok(res, {
      id: paper.id, title: paper.title, subject: paper.subject,
      mode: paper.mode, durationMin: paper.durationMin, questionCount: picked.length,
    }, "组卷成功");
  })
);

// GET /api/papers — 试卷列表
// 学生:只返回 READY(卷内每道题都已审核发布)的卷
// 老师:返回全部,并附带审核进度统计,便于判断还差多少题没审
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const isTeacher = ["TEACHER", "ADMIN"].includes(req.user.role);
    const where = isTeacher ? {} : { status: "READY" };
    if (isTeacher && req.query.status) where.status = String(req.query.status);
    if (isTeacher && req.query.origin) where.origin = String(req.query.origin);
    const list = await prisma.paper.findMany({ where, orderBy: { createdAt: "desc" }, take: 100 });

    if (!isTeacher) {
      return ok(res, {
        list: list.map((p) => ({
          id: p.id, title: p.title, subject: p.subject, mode: p.mode,
          durationMin: p.durationMin, questionCount: parseIds(p).length, createdAt: p.createdAt,
        })),
      });
    }
    const statsMap = await statsForPapers(list);
    ok(res, {
      list: list.map((p) => {
        const stats = statsMap.get(p.id);
        return {
          id: p.id, title: p.title, subject: p.subject, mode: p.mode,
          durationMin: p.durationMin, questionCount: stats.total,
          source: p.source, origin: p.origin, status: p.status,
          stats, createdAt: p.createdAt,
        };
      }),
    });
  })
);

// GET /api/papers/facets — 组卷可选项(必须在 /:id 之前注册,否则会被当作 id 匹配)
// 返回各科目已发布题数 + 指定科目下真实存在的知识点/难度,供前端渲染成可点选项
router.get(
  "/facets",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const subject = req.query.subject || undefined;
    const bySubject = await prisma.question.groupBy({
      by: ["subject"],
      where: { status: "PUBLISHED" },
      _count: { _all: true },
    });
    const subjects = bySubject
      .map((s) => ({ subject: s.subject, count: s._count._all }))
      .sort((a, b) => b.count - a.count);

    let topics = [];
    let difficulties = [];
    let combos = [];
    let total = 0;
    if (subject) {
      const pool = await prisma.question.findMany({
        where: { status: "PUBLISHED", subject },
        select: { topic: true, difficulty: true },
      });
      total = pool.length;
      const tMap = new Map();
      const dMap = new Map();
      const cMap = new Map();
      for (const q of pool) {
        if (q.topic) tMap.set(q.topic, (tMap.get(q.topic) || 0) + 1);
        if (q.difficulty != null) dMap.set(q.difficulty, (dMap.get(q.difficulty) || 0) + 1);
        const key = `${q.topic ?? ""}\u0000${q.difficulty ?? ""}`;
        cMap.set(key, (cMap.get(key) || 0) + 1);
      }
      topics = [...tMap.entries()].map(([topic, count]) => ({ topic, count })).sort((a, b) => a.topic.localeCompare(b.topic));
      difficulties = [...dMap.entries()].map(([difficulty, count]) => ({ difficulty, count })).sort((a, b) => a.difficulty - b.difficulty);
      // combos 供前端精确预览「当前知识点+难度组合」能匹配多少题
      combos = [...cMap.entries()].map(([key, count]) => {
        const [t, d] = key.split("\u0000");
        return { topic: t || null, difficulty: d === "" ? null : Number(d), count };
      });
    }
    ok(res, { subjects, subject: subject || null, total, topics, difficulties, combos });
  })
);

// GET /api/papers/:id/manage — 试卷管理视图(老师):逐题列出内容与审核状态
router.get(
  "/:id/manage",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const paper = await prisma.paper.findUnique({ where: { id: req.params.id } });
    if (!paper) return fail(res, 404, "试卷不存在");
    const ids = parseIds(paper);
    const rows = ids.length
      ? await prisma.question.findMany({
          where: { id: { in: ids } },
          select: {
            id: true, subject: true, paper: true, topic: true, difficulty: true, type: true,
            stem: true, options: true, answer: true, solution: true, status: true, reviewNote: true, source: true,
          },
        })
      : [];
    const map = new Map(rows.map((q) => [q.id, q]));
    const stats = (await statsForPapers([paper])).get(paper.id);
    ok(res, {
      id: paper.id, title: paper.title, subject: paper.subject, mode: paper.mode,
      durationMin: paper.durationMin, source: paper.source, origin: paper.origin,
      status: paper.status, createdAt: paper.createdAt, stats,
      // 保持录入顺序;题目被删除时给出占位,方便老师发现卷内引用失效
      questions: ids.map((id, i) => {
        const q = map.get(id);
        if (!q) return { id, index: i + 1, missing: true };
        return { ...q, options: safeParse(q.options), index: i + 1, missing: false };
      }),
    });
  })
);

function safeParse(v) {
  if (Array.isArray(v)) return v;
  try {
    const a = JSON.parse(v || "[]");
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

// PATCH /api/papers/:id — 编辑试卷(改名/换科目/换模式/调限时/上下架/移除题目)
router.patch(
  "/:id",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const paper = await prisma.paper.findUnique({ where: { id: req.params.id } });
    if (!paper) return fail(res, 404, "试卷不存在");
    const b = req.body || {};
    const data = {};
    if (typeof b.title === "string" && b.title.trim()) data.title = b.title.trim();
    // 科目:只接受合法科目;更新 subject 时同步 sourceKey(subject::paper::source),否则下次导入同套题会建新卷
    const VALID_SUBJECTS = ["TMUA", "ESAT", "数学", "物理", "化学", "生物"];
    if (typeof b.subject === "string" && VALID_SUBJECTS.includes(b.subject)) data.subject = b.subject;
    if (b.mode === "EXAM" || b.mode === "PRACTICE") data.mode = b.mode;
    if (b.durationMin !== undefined) data.durationMin = Number(b.durationMin) || null;
    if (Array.isArray(b.questionIds)) data.questionIds = JSON.stringify(b.questionIds);
    // 只允许人工在 ARCHIVED 与自动推导状态之间切换,READY 不可手动设置(必须靠逐题审核挣得)
    if (b.status === "ARCHIVED") data.status = "ARCHIVED";
    if (b.status === "ACTIVE" && paper.status === "ARCHIVED") data.status = "DRAFT";
    if (data.mode === "EXAM" && !(data.durationMin ?? paper.durationMin)) {
      return fail(res, 400, "模拟考试卷必须设置限时(分钟)");
    }
    // 改科目时检查 sourceKey 冲突,避免与已有套卷撞唯一键
    if (data.subject && paper.sourceKey) {
      const [, p, s] = paper.sourceKey.split("::");
      const newKey = [data.subject, p, s].join("::");
      if (newKey !== paper.sourceKey) {
        const clash = await prisma.paper.findUnique({ where: { sourceKey: newKey } });
        if (clash) return fail(res, 400, `已存在「${clash.title}」套卷(${newKey}),改科目会与之冲突。可先删除/改名该卷再操作。`);
      }
      data.sourceKey = newKey;
    }
    const updated = await prisma.paper.update({ where: { id: paper.id }, data });
    const r = await recalcPaper(updated.id); // 移除题目/恢复上架后重新推导就绪度
    ok(res, { ...updated, status: r?.status ?? updated.status, stats: r?.stats }, "试卷已更新");
  })
);

// DELETE /api/papers/:id — 删除试卷(题目本身保留在题库中)
router.delete(
  "/:id",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const paper = await prisma.paper.findUnique({ where: { id: req.params.id } });
    if (!paper) return fail(res, 404, "试卷不存在");
    const used = await prisma.session.count({ where: { paperId: paper.id } });
    if (used > 0) {
      return fail(res, 400, `该试卷已有 ${used} 条学生作答记录,不能删除。可改为「下架」,学生将不再看到它。`);
    }
    await prisma.paper.delete({ where: { id: paper.id } });
    ok(res, null, "试卷已删除(卷内题目仍保留在题库中)");
  })
);

// GET /api/papers/:id — 试卷详情(题目不含答案,顺序保持)
// 学生只能取到 READY 的卷,避免未审核完的套题被提前作答
router.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const paper = await prisma.paper.findUnique({ where: { id: req.params.id } });
    if (!paper) return fail(res, 404, "试卷不存在");
    const isTeacher = ["TEACHER", "ADMIN"].includes(req.user.role);
    if (!isTeacher && paper.status !== "READY") {
      return fail(res, 403, "该试卷尚未全部通过审核,暂不可作答");
    }
    const ids = parseIds(paper);
    const questions = await prisma.question.findMany({
      where: { id: { in: ids }, status: "PUBLISHED" },
      select: { id: true, subject: true, topic: true, difficulty: true, type: true, stem: true, options: true, source: true },
    });
    const map = new Map(questions.map((q) => [q.id, q]));
    ok(res, {
      id: paper.id, title: paper.title, subject: paper.subject, mode: paper.mode,
      durationMin: paper.durationMin, questionCount: ids.length, status: paper.status,
      questions: ids.map((id) => map.get(id)).filter(Boolean),
    });
  })
);

export default router;
