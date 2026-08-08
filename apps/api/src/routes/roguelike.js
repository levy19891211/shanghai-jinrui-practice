// Roguelike 冒险模式(二期:线性爬塔 + 连击激励 + 血量 + 道具 + Boss 薄弱点 + 奖励节点 + 断线存档)
// 进度规则:
//  - 每层一节点:normal(普通题)/ reward(奖励,不答题) / boss(薄弱点题)
//  - 答对推进;答错扣 1 血(护盾可抵挡);血尽 DEAD,达到 20 层 WON
//  - 连对 combo:3/5/10 连对发放奖励(回血/金币/道具)
//  - 道具:shield(抵挡一次答错) / heal(回 1 血) / skip(跳过本题直接推进) / hint(排除 2 个错误选项)
//  - Boss(每 5 层):优先从学生错题本(薄弱点)抽题,击败给额外奖励
//  - 进度全部后端权威计算;items JSON 存 { answered, inventory, map }
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
function parseItems(raw) {
  // 向后兼容:一期 items 是纯数组(answeredIds);二期是 { answered, inventory, map }
  try {
    const v = JSON.parse(raw || "{}");
    if (Array.isArray(v)) return { answered: v, inventory: [], map: genMap(MAX_LAYER) };
    return {
      answered: Array.isArray(v.answered) ? v.answered : [],
      inventory: Array.isArray(v.inventory) ? v.inventory : [],
      map: Array.isArray(v.map) && v.map.length === MAX_LAYER ? v.map : genMap(MAX_LAYER),
    };
  } catch {
    return { answered: [], inventory: [], map: genMap(MAX_LAYER) };
  }
}
function genMap(len) {
  // boss:第 5/10/15/20 层;reward:第 3/6/9/12/18 层;其余 normal
  const map = [];
  for (let i = 1; i <= len; i++) {
    if (i % 5 === 0) map.push("boss");
    else if (i % 3 === 0) map.push("reward");
    else map.push("normal");
  }
  return map;
}
function publicQuestion(q) {
  let ids = q.topicIds;
  try {
    const v = JSON.parse(ids || "[]");
    ids = Array.isArray(v) ? v : [];
  } catch {
    ids = [];
  }
  return { ...q, options: safeParseOptions(q.options), topicIds: ids };
}

// 抽一题:normal 随机;boss 从错题本薄弱点抽,无错题则难度+1 随机
async function pickQuestion(run, opts = {}) {
  const items = parseItems(run.items);
  const exclude = new Set(items.answered);
  const subs = run.subject === "数学" ? ["数学", "TMUA"] : run.subject === "ESAT" ? ["ESAT", "数学", "物理"] : [run.subject];
  const subjectWhere = subs.length === 1 ? subs[0] : { in: subs };

  let pool = [];
  if (opts.boss) {
    // Boss:优先错题本(薄弱点),随机挑 10 道候选
    const wb = await prisma.wrongBook.findMany({ where: { studentId: run.studentId, mastered: false }, select: { questionId: true } });
    const cand = wb.map((w) => w.questionId).filter((id) => !exclude.has(id));
    if (cand.length) {
      const qs = await prisma.question.findMany({
        where: { id: { in: cand.slice(0, 40) }, status: "PUBLISHED", subject: subjectWhere },
        select: { id: true },
      });
      pool = qs.length ? qs : [];
    }
    if (!pool.length) {
      // 无薄弱点 → 随机难题
      const all = await prisma.question.findMany({ where: { status: "PUBLISHED", subject: subjectWhere, difficulty: { gte: Math.min(run.difficulty + 1, 5) } }, select: { id: true } });
      pool = all.filter((q) => !exclude.has(q.id));
      if (!pool.length) pool = all;
    }
  } else {
    const all = await prisma.question.findMany({ where: { status: "PUBLISHED", subject: subjectWhere, difficulty: run.difficulty }, select: { id: true } });
    pool = all.filter((q) => !exclude.has(q.id));
    if (!pool.length) pool = all;
  }
  if (!pool.length) return null;
  const picked = pool[Math.floor(Math.random() * pool.length)];
  const q = await prisma.question.findUnique({ where: { id: picked.id }, select: QUIZ_FIELDS });
  return q ? publicQuestion(q) : null;
}

// 道具定义
const ITEM_META = {
  shield: { label: "护盾", desc: "抵挡一次答错扣血" },
  heal: { label: "药水", desc: "回复 1 点生命" },
  skip: { label: "跳过", desc: "跳过本题直接推进" },
  hint: { label: "提示", desc: "排除 2 个错误选项" },
};

// 连击奖励(额外道具)
function comboReward(combo) {
  if (combo === 3) return { message: "3 连对!恢复 1 点生命", coins: 2, heal: 1, items: [] };
  if (combo === 5) return { message: "5 连对!获得护盾 ×1", coins: 5, heal: 0, items: ["shield"] };
  if (combo === 10) return { message: "10 连对!获得药水 ×1", coins: 10, heal: 0, items: ["heal"] };
  if (combo > 0 && combo % 5 === 0) return { message: `${combo} 连对!金币奖励`, coins: 5, heal: 0, items: [] };
  return { coins: 0, heal: 0, items: [] };
}

// 推进到下一节点:reward 节点返回不抽题;否则抽题
async function nextNode(run) {
  const items = parseItems(run.items);
  const nodeType = items.map[run.layer - 1] || "normal";
  if (nodeType === "reward") {
    return { nodeType: "reward", question: null };
  }
  const question = await pickQuestion(run, { boss: nodeType === "boss" });
  return { nodeType, question };
}

// 普通题答对 15% 概率掉道具
function randomDrop() {
  if (Math.random() < 0.15) {
    const pool = ["shield", "heal"];
    return [pool[Math.floor(Math.random() * pool.length)]];
  }
  return [];
}

// GET /api/roguelike/active — 查询是否有进行中的冒险(前端进入页面时提示继续)
router.get(
  "/active",
  requireAuth,
  asyncHandler(async (req, res) => {
    const run = await prisma.roguelikeRun.findFirst({
      where: { studentId: req.user.id, status: "ACTIVE" },
      orderBy: { updatedAt: "desc" },
    });
    if (!run) return ok(res, { run: null });
    const node = await nextNode(run);
    ok(res, { run, ...node });
  })
);

// POST /api/roguelike/start — 开始/恢复冒险
router.post(
  "/start",
  requireAuth,
  asyncHandler(async (req, res) => {
    const subject = String(req.body?.subject || "").trim() || "数学";
    const difficulty = req.body?.difficulty ? Number(req.body.difficulty) : 3;

    const existing = await prisma.roguelikeRun.findFirst({
      where: { studentId: req.user.id, status: "ACTIVE" },
      orderBy: { updatedAt: "desc" },
    });
    if (existing) {
      const node = await nextNode(existing);
      return ok(res, { run: existing, ...node }, "继续上次冒险");
    }

    const run = await prisma.roguelikeRun.create({
      data: {
        studentId: req.user.id,
        subject,
        difficulty,
        items: JSON.stringify({ answered: [], inventory: [], map: genMap(MAX_LAYER) }),
      },
    });
    const node = await nextNode(run);
    ok(res, { run, ...node }, "冒险开始");
  })
);

// POST /api/roguelike/:runId/answer — 作答
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

    const items = parseItems(run.items);
    const nodeType = items.map[run.layer - 1] || "normal";
    const correct = isAnswerCorrect(question, selected);

    if (!items.answered.includes(questionId)) items.answered.push(questionId);

    let { layer, hp, combo, maxCombo, score, coins, status } = run;
    const inv = items.inventory.slice();
    const drops = [];
    let reward = { message: "", coins: 0, heal: 0, items: [] };
    let shieldUsed = false;

    if (correct) {
      combo += 1;
      maxCombo = Math.max(maxCombo, combo);
      score += 10 + combo * 2;
      reward = comboReward(combo);
      coins += 1 + reward.coins;
      if (reward.heal > 0) hp = Math.min(run.maxHp, hp + reward.heal);
      reward.items.forEach((it) => inv.push(it));
      // Boss 击败奖励
      if (nodeType === "boss") {
        coins += 5;
        inv.push("heal");
        reward.message = reward.message ? `${reward.message} · 击败 Boss!金币+5、药水×1` : "击败 Boss!金币+5、药水×1";
      }
      // 普通题随机掉落
      if (nodeType === "normal") {
        const d = randomDrop();
        if (d.length) {
          drops.push(...d);
          inv.push(...d);
        }
      }
      layer += 1;
    } else {
      // 护盾抵挡
      const shieldIdx = inv.indexOf("shield");
      if (shieldIdx >= 0) {
        inv.splice(shieldIdx, 1);
        shieldUsed = true;
      } else {
        hp -= 1;
      }
      combo = 0;
      if (hp <= 0) {
        hp = 0;
        status = "DEAD";
      }
      await prisma.wrongBook.upsert({
        where: { studentId_questionId: { studentId: req.user.id, questionId } },
        create: { studentId: req.user.id, questionId, wrongCount: 1 },
        update: { wrongCount: { increment: 1 }, mastered: false },
      });
    }

    const runOver = status !== "ACTIVE";
    let nextNodeInfo = { nodeType: null, question: null };
    if (!runOver && layer > MAX_LAYER) {
      status = "WON";
      runOver = true;
    }
    if (!runOver) {
      const updatedRun = { ...run, layer, hp, combo, maxCombo, score, coins, status };
      nextNodeInfo = await nextNode(updatedRun);
    }

    const updated = await prisma.roguelikeRun.update({
      where: { id: run.id },
      data: {
        layer, hp, combo, maxCombo, score, coins, status,
        items: JSON.stringify({ answered: items.answered, inventory: inv, map: items.map }),
      },
    });

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
      drops: drops.length ? drops : null,
      shieldUsed,
      runOver,
      status: updated.status,
      nodeType: nextNodeInfo.nodeType,
      nextQuestion: nextNodeInfo.question,
    }, correct ? "回答正确" : shieldUsed ? "回答错误(护盾抵挡)" : "回答错误");
  })
);

// POST /api/roguelike/:runId/claim — 奖励节点领奖并推进
router.post(
  "/:runId/claim",
  requireAuth,
  asyncHandler(async (req, res) => {
    const run = await prisma.roguelikeRun.findUnique({ where: { id: req.params.runId } });
    if (!run || run.studentId !== req.user.id) return fail(res, 404, "冒险不存在");
    if (run.status !== "ACTIVE") return fail(res, 400, "冒险已结束");

    const items = parseItems(run.items);
    const nodeType = items.map[run.layer - 1] || "normal";
    if (nodeType !== "reward") return fail(res, 400, "当前节点不是奖励节点");

    let { layer, hp, score, coins, status } = run;
    const inv = items.inventory.slice();
    // 奖励:金币+2,30% 概率药水
    coins += 2;
    const msg = [];
    if (Math.random() < 0.3) {
      inv.push("heal");
      msg.push("药水×1");
    }
    if (hp < run.maxHp && Math.random() < 0.3) {
      hp += 1;
      msg.push("回复 1 点生命");
    }
    layer += 1;
    let runOver = false;
    let nextNodeInfo = { nodeType: null, question: null };
    if (layer > MAX_LAYER) {
      status = "WON";
      runOver = true;
    } else {
      const updatedRun = { ...run, layer, hp, score, coins, status };
      nextNodeInfo = await nextNode(updatedRun);
    }

    const updated = await prisma.roguelikeRun.update({
      where: { id: run.id },
      data: { layer, hp, score, coins, status, items: JSON.stringify({ answered: items.answered, inventory: inv, map: items.map }) },
    });

    ok(res, {
      hp, layer, score, coins,
      reward: `奖励节点:金币+2${msg.length ? "、" + msg.join("、") : ""}`,
      runOver, status: updated.status,
      nodeType: nextNodeInfo.nodeType,
      nextQuestion: nextNodeInfo.question,
    }, "奖励领取成功");
  })
);

// POST /api/roguelike/:runId/use-item — 使用道具
router.post(
  "/:runId/use-item",
  requireAuth,
  asyncHandler(async (req, res) => {
    const run = await prisma.roguelikeRun.findUnique({ where: { id: req.params.runId } });
    if (!run || run.studentId !== req.user.id) return fail(res, 404, "冒险不存在");
    if (run.status !== "ACTIVE") return fail(res, 400, "冒险已结束");

    const item = String(req.body?.item || "");
    if (!ITEM_META[item]) return fail(res, 400, "道具不存在");
    const items = parseItems(run.items);
    const idx = items.inventory.indexOf(item);
    if (idx < 0) return fail(res, 400, "没有该道具");

    const inv = items.inventory.slice();
    inv.splice(idx, 1);
    let { layer, hp, combo, score, coins, status } = run;
    let payload = {};
    let runOver = false;
    let nextNodeInfo = { nodeType: null, question: null };

    if (item === "heal") {
      hp = Math.min(run.maxHp, hp + 1);
      payload = { message: "回复 1 点生命" };
    } else if (item === "skip") {
      // 跳过本题:直接推进,combo+1,得分+10
      combo += 1;
      score += 10;
      layer += 1;
      if (layer > MAX_LAYER) {
        status = "WON";
        runOver = true;
      } else {
        const updatedRun = { ...run, layer, hp, combo, score, coins, status };
        nextNodeInfo = await nextNode(updatedRun);
      }
      payload = { message: "跳过本题,直接推进" };
    } else if (item === "hint") {
      // 提示:针对当前正在答的题,返回 2 个错误选项索引(前端禁用)
      const hintQid = String(req.body?.questionId || "");
      if (!hintQid) return fail(res, 400, "hint 需要 questionId");
      const q = await prisma.question.findUnique({ where: { id: hintQid }, select: QUIZ_FIELDS });
      if (!q) return fail(res, 404, "题目不存在");
      const answer = String(q.answer).trim();
      const wrongIdx = safeParseOptions(q.options).map((o, i) => i).filter((i) => {
        const ov = String(safeParseOptions(q.options)[i]).trim();
        if (q.type === "NUMERIC" && !Number.isNaN(Number(answer)) && !Number.isNaN(Number(ov))) {
          return Math.abs(Number(ov) - Number(answer)) > 0.01;
        }
        return ov !== answer;
      });
      const pick = wrongIdx.sort(() => Math.random() - 0.5).slice(0, 2);
      payload = { message: "提示已使用:排除 2 个错误选项", hintExclude: pick };
    }
    // shield 是被动道具,不能主动使用
    if (item === "shield") return fail(res, 400, "护盾为被动道具,答错时自动生效");

    const updated = await prisma.roguelikeRun.update({
      where: { id: run.id },
      data: { layer, hp, combo, score, coins, status, items: JSON.stringify({ answered: items.answered, inventory: inv, map: items.map }) },
    });

    ok(res, { ...payload, hp, layer, combo, score, coins, runOver, status: updated.status, nodeType: nextNodeInfo.nodeType, nextQuestion: nextNodeInfo.question }, "道具已使用");
  })
);

// POST /api/roguelike/:runId/quit — 主动结算
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

// GET /api/roguelike/:runId — 恢复进行中的冒险
router.get(
  "/:runId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const run = await prisma.roguelikeRun.findUnique({ where: { id: req.params.runId } });
    if (!run || run.studentId !== req.user.id) return fail(res, 404, "冒险不存在");
    const node = run.status === "ACTIVE" ? await nextNode(run) : { nodeType: null, question: null };
    ok(res, { run, ...node });
  })
);

export default router;
