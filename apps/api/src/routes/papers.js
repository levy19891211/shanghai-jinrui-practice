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
