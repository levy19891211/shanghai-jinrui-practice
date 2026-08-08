// Roguelike 冒险模式(一期:线性爬塔 + 连击激励 + 血量)
// 进度规则:
//  - 每层一题,答对推进;答错扣 1 血;血尽 DEAD,达到 20 层 WON
//  - 连对 combo:连续答对递增,奖励按 3/5/10 连对发放(回血/金币)
//  - 题目不持久化,每层临时抽题;作答不写入 AnswerRecord(避免污染正常会话统计),
//    答错仍写入错题本(复用教学数据)。判分复用 grading.isAnswerCorrect。
import { Router } from "express";
import { prisma } from "../lib/db.js";
import { ok, fail, asyncHandler } from "../lib/res.js";
import { requireAuth } from "../middleware/auth.js";
import { isAnswerCorrect } from "../lib/grading.js";

const router = Router();

const MAX_LAYER = 20; // 通关层数
const QUIZ_FIELDS = {
  id: true, subject: true, paper: true, topic: true, topicIds: true, difficulty: true,
  type: true, stem: true, options: true, answer: true, solution: true,
};

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

function publicQuestion(q) {
  const arr = Array.isArray(q.topicIds) ? q.topicIds : safeParse(q.topicIds);
  return { ...q, options: safeParseOptions(q.options), topicIds: arr };
}
function safeParse(s) {
  try {
    const v = JSON.parse(s || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// 抽一题(排除本次 run 已答过的题;题库不足则回退为可重复)
async function pickQuestion(run) {
  const exclude = new Set(safeParse(run.items));
  const where = { status: "PUBLISHED" };
  // 学科映射:数学包含 TMUA(数学思维考试),ESAT 含数学+物理(与题库管理一致)
  const subs = run.subject === "数学" ? ["数学", "TMUA"] : run.subject === "ESAT" ? ["ESAT", "数学", "物理"] : [run.subject];
  if (subs.length === 1) where.subject = subs[0];
  else where.subject = { in: subs };
  if (run.difficulty) where.difficulty = run.difficulty;
  const all = await prisma.question.findMany({ where, select: { id: true } });
  if (!all.length) return null;
  let pool = all.filter((q) => !exclude.has(q.id));
  if (!pool.length) pool = all;
  const picked = pool[Math.floor(Math.random() * pool.length)];
  const q = await prisma.question.findUnique({ where: { id: picked.id }, select: QUIZ_FIELDS });
  return q ? publicQuestion(q) : null;
}

// 连击奖励:返回 { message?, coins, heal }
function comboReward(combo) {
  if (combo === 3) return { message: "3 连对!恢复 1 点生命", coins: 2, heal: 1 };
  if (combo === 5) return { message: "5 连对!恢复 2 点生命", coins: 5, heal: 2 };
  if (combo === 10) return { message: "10 连对!稀有奖励", coins: 10, heal: 0 };
  if (combo > 0 && combo % 5 === 0) return { message: `${combo} 连对!金币奖励`, coins: 5, heal: 0 };
  return { coins: 0, heal: 0 };
}

// POST /api/roguelike/start — 开始/恢复冒险
router.post(
  "/start",
  requireAuth,
  asyncHandler(async (req, res) => {
    const subject = String(req.body?.subject || "").trim() || undefined;
    const difficulty = req.body?.difficulty ? Number(req.body.difficulty) : 3;

    // 已有进行中的冒险 → 直接恢复,不重复开
    const existing = await prisma.roguelikeRun.findFirst({
      where: { studentId: req.user.id, status: "ACTIVE" },
      orderBy: { updatedAt: "desc" },
    });
    if (existing) {
      const question = await pickQuestion(existing);
      return ok(res, { run: existing, question }, "继续上次冒险");
    }

    const run = await prisma.roguelikeRun.create({
      data: { studentId: req.user.id, subject: subject || "数学", difficulty, items: "[]" },
    });
    const question = await pickQuestion(run);
    ok(res, { run, question }, "冒险开始");
  })
);

// POST /api/roguelike/:runId/answer — 作答(判分/连击/血量/下一题,全部后端权威计算)
router.post(
  "/:runId/answer",
  requireAuth,
  asyncHandler(async (req, res) => {
    const run = await prisma.roguelikeRun.findUnique({ where: { id: req.params.runId } });
    if (!run || run.studentId !== req.user.id) return fail(res, 404, "冒险不存在");
    if (run.status !== "ACTIVE") return fail(res, 400, "冒险已结束");

    const { questionId, selected } = req.body || {};
    if (!questionId) return fail(res, 400, "questionId 必填");
    const question = await prisma.question.findUnique({ where: { id: questionId } });
    if (!question || question.status !== "PUBLISHED") return fail(res, 404, "题目不存在");

    const correct = isAnswerCorrect(question, selected);
    const answered = safeParse(run.items);
    if (!answered.includes(questionId)) answered.push(questionId);

    let { layer, hp, combo, maxCombo, score, coins, status } = run;
    let reward = { message: "", coins: 0, heal: 0 };

    if (correct) {
      combo += 1;
      maxCombo = Math.max(maxCombo, combo);
      score += 10 + combo * 2;
      reward = comboReward(combo);
      coins += 1 + reward.coins;
      if (reward.heal > 0) hp = Math.min(run.maxHp, hp + reward.heal);
      layer += 1;
      if (layer > MAX_LAYER) status = "WON";
    } else {
      combo = 0;
      hp -= 1;
      if (hp <= 0) {
        hp = 0;
        status = "DEAD";
      }
      // 错题写入错题本(教学数据复用)
      await prisma.wrongBook.upsert({
        where: { studentId_questionId: { studentId: req.user.id, questionId } },
        create: { studentId: req.user.id, questionId, wrongCount: 1 },
        update: { wrongCount: { increment: 1 }, mastered: false },
      });
    }

    const updated = await prisma.roguelikeRun.update({
      where: { id: run.id },
      data: { layer, hp, combo, maxCombo, score, coins, status, items: JSON.stringify(answered) },
    });

    const runOver = status !== "ACTIVE";
    const questionNext = runOver ? null : await pickQuestion(updated);
    ok(res, {
      correct,
      combo,
      maxCombo,
      hp,
      maxHp: run.maxHp,
      layer: updated.layer,
      score,
      coins,
      reward: reward.message || null,
      runOver,
      status: updated.status,
      nextQuestion: questionNext,
    }, correct ? "回答正确" : "回答错误");
  })
);

// GET /api/roguelike/:runId — 恢复进行中的冒险
router.get(
  "/:runId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const run = await prisma.roguelikeRun.findUnique({ where: { id: req.params.runId } });
    if (!run || run.studentId !== req.user.id) return fail(res, 404, "冒险不存在");
    const question = run.status === "ACTIVE" ? await pickQuestion(run) : null;
    ok(res, { run, question });
  })
);

// POST /api/roguelike/:runId/quit — 主动结算(提前结束)
router.post(
  "/:runId/quit",
  requireAuth,
  asyncHandler(async (req, res) => {
    const run = await prisma.roguelikeRun.findUnique({ where: { id: req.params.runId } });
    if (!run || run.studentId !== req.user.id) return fail(res, 404, "冒险不存在");
    if (run.status !== "ACTIVE") return fail(res, 400, "冒险已结束");
    const updated = await prisma.roguelikeRun.update({ where: { id: run.id }, data: { status: "QUIT" } });
    ok(res, { run: updated }, "冒险已结算");
  })
);

export default router;
