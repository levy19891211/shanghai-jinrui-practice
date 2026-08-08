// Roguelike 冒险模式（V1.6：爬塔战斗系统 + 装备/物品/技能/蓝条/掉落/升级三选一）
// 进度规则不变：每层一节点 normal/reward/boss；答对推进、答错扣血；血尽 DEAD，20 层 WON。
// 战斗系统（全部存于 items JSON，不改 schema）：
//  - 装备 gear：weapon(每答对+分)/armor(+生命上限)/trinket(+蓝上限/回蓝)，可点击穿戴到身上（equipped[slot]），有被动加成
//  - 物品 item：heal(恢复)/attack(下次作答必中)/defense(护盾)/utility(提示)，点击使用
//  - 技能 skill：分级、耗蓝，攻击/恢复/防御/辅助，升级时三选一获得
//  - 消灭怪物随机掉落装备或物品；蓝条随答对回复
import { Router } from "express";
import { prisma } from "../lib/db.js";
import { ok, fail, asyncHandler } from "../lib/res.js";
import { requireAuth } from "../middleware/auth.js";
import { isAnswerCorrect } from "../lib/grading.js";

const router = Router();

const MAX_LAYER = 20; // 通关层数
// 测试模式固定题：用户开启测试模式后,所有题目替换为这一题,便于快速验证 UI / 战斗流程
const TEST_QUESTION = {
  id: "TEST_Q",
  subject: "数学",
  topic: "测试",
  topicIds: [],
  difficulty: 1,
  type: "CHOICE",
  stem: "1+1=?",
  options: ["2", "3"],
  answer: "2",
  solution: "1+1=2",
};
const QUIZ_FIELDS = {
  id: true, subject: true, paper: true, topic: true, topicIds: true, difficulty: true,
  type: true, stem: true, options: true, answer: true, solution: true,
};

// ===================== 装备 / 物品 / 技能 池 =====================
const GEAR_POOL = [
  { id: "w_wood", slot: "weapon", name: "木剑", icon: "🗡", bonus: { score: 1 }, desc: "每答对 +1 分" },
  { id: "w_iron", slot: "weapon", name: "铁剑", icon: "⚔", bonus: { score: 2 }, desc: "每答对 +2 分" },
  { id: "w_flame", slot: "weapon", name: "烈焰剑", icon: "🔥", bonus: { score: 3 }, desc: "每答对 +3 分" },
  { id: "a_leather", slot: "armor", name: "皮甲", icon: "🛡", bonus: { hp: 1 }, desc: "生命上限 +1" },
  { id: "a_iron", slot: "armor", name: "铁甲", icon: "🛡", bonus: { hp: 2 }, desc: "生命上限 +2" },
  { id: "a_holy", slot: "armor", name: "圣铠", icon: "✨", bonus: { hp: 3 }, desc: "生命上限 +3" },
  { id: "t_amber", slot: "trinket", name: "琥珀", icon: "🔮", bonus: { mana: 2 }, desc: "蓝上限 +2" },
  { id: "t_star", slot: "trinket", name: "星之坠", icon: "🌟", bonus: { mana: 3, regen: 1 }, desc: "蓝上限 +3，每答对回蓝 +1" },
];
const ITEM_POOL = [
  { id: "i_heal", type: "heal", name: "治疗药水", icon: "🧪", heal: 2, desc: "回复 2 点生命" },
  { id: "i_heal_big", type: "heal", name: "大治疗药水", icon: "💗", heal: 4, desc: "回复 4 点生命" },
  { id: "i_atk", type: "attack", name: "力量药剂", icon: "💥", desc: "下次作答必中（自动答对）" },
  { id: "i_shield", type: "defense", name: "护盾", icon: "🛡", desc: "抵挡一次答错扣血" },
  { id: "i_hint", type: "utility", name: "提示卷轴", icon: "💡", desc: "排除 2 个错误选项" },
];
const SKILL_POOL = [
  { id: "s_fireball", tier: 1, type: "attack", name: "火球术", icon: "🔥", cost: 3, bonus: 0, desc: "下次作答必中（自动答对）" },
  { id: "s_heal", tier: 1, type: "heal", name: "治疗术", icon: "💚", cost: 4, heal: 3, desc: "回复 3 点生命" },
  { id: "s_shield", tier: 1, type: "defense", name: "守护", icon: "🛡", cost: 3, blocks: 1, desc: "抵挡一次答错扣血" },
  { id: "s_focus", tier: 1, type: "utility", name: "专注", icon: "💡", cost: 2, desc: "排除 2 个错误选项" },
  { id: "s_strike", tier: 2, type: "attack", name: "雷霆斩", icon: "⚡", cost: 5, bonus: 10, desc: "下次作答必中，并 +10 分" },
  { id: "s_regen", tier: 2, type: "heal", name: "生命涌动", icon: "🌿", cost: 5, heal: 5, desc: "回复 5 点生命" },
  { id: "s_berserk", tier: 2, type: "utility", name: "狂暴", icon: "😤", cost: 4, desc: "本次答对得分翻倍" },
  { id: "s_meteor", tier: 3, type: "attack", name: "陨石术", icon: "☄️", cost: 7, bonus: 20, desc: "下次作答必中，并 +20 分" },
  { id: "s_aegis", tier: 3, type: "defense", name: "圣盾", icon: "🪬", cost: 6, blocks: 2, desc: "抵挡两次答错扣血" },
  { id: "s_phoenix", tier: 3, type: "heal", name: "凤凰祝福", icon: "🦅", cost: 8, heal: 999, desc: "回复全部生命" },
];
const GEAR_BY_ID = Object.fromEntries(GEAR_POOL.map((g) => [g.id, g]));
const ITEM_BY_ID = Object.fromEntries(ITEM_POOL.map((i) => [i.id, i]));
const SKILL_BY_ID = Object.fromEntries(SKILL_POOL.map((s) => [s.id, s]));

function genId() { return Math.random().toString(36).slice(2, 9); }
function mkGearEntry(poolId) {
  const m = GEAR_BY_ID[poolId];
  return { uid: genId(), ref: poolId, kind: "gear", slot: m.slot, name: m.name, icon: m.icon, desc: m.desc, bonus: m.bonus };
}
function mkItemEntry(poolId) {
  const m = ITEM_BY_ID[poolId];
  return { uid: genId(), ref: poolId, kind: "item", type: m.type, name: m.name, icon: m.icon, desc: m.desc };
}
function randomFrom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function defaultItems() {
  return {
    answered: [], inventory: [], map: genMap(MAX_LAYER),
    mana: 10, maxMana: 10, level: 1, xp: 0,
    equipped: {}, skills: [], pendingSkills: null, pendingCount: 0,
    autoCorrect: false, pendingScoreBonus: 0, shield: false, shieldCount: 0, berserk: false,
    test: false,
  };
}
function parseItems(raw) {
  try {
    const v = JSON.parse(raw || "{}");
    if (Array.isArray(v)) return { ...defaultItems(), answered: v, inventory: [], map: genMap(MAX_LAYER) };
    const d = defaultItems();
    return {
      answered: Array.isArray(v.answered) ? v.answered : [],
      inventory: Array.isArray(v.inventory) ? v.inventory : [],
      map: Array.isArray(v.map) && v.map.length === MAX_LAYER ? v.map : d.map,
      mana: typeof v.mana === "number" ? v.mana : d.mana,
      maxMana: typeof v.maxMana === "number" ? v.maxMana : d.maxMana,
      level: typeof v.level === "number" ? v.level : d.level,
      xp: typeof v.xp === "number" ? v.xp : d.xp,
      equipped: v.equipped && typeof v.equipped === "object" ? v.equipped : d.equipped,
      skills: Array.isArray(v.skills) ? v.skills : d.skills,
      pendingSkills: Array.isArray(v.pendingSkills) ? v.pendingSkills : null,
      pendingCount: typeof v.pendingCount === "number" ? v.pendingCount : 0,
      autoCorrect: !!v.autoCorrect,
      pendingScoreBonus: typeof v.pendingScoreBonus === "number" ? v.pendingScoreBonus : 0,
      shield: !!v.shield,
      shieldCount: typeof v.shieldCount === "number" ? v.shieldCount : 0,
      berserk: !!v.berserk,
      test: !!v.test,
    };
  } catch {
    return defaultItems();
  }
}
// 把战斗状态额外字段附到响应里，前端统一读取
function extraState(items) {
  return {
    mana: items.mana, maxMana: items.maxMana, level: items.level,
    equipped: items.equipped, skills: items.skills, pendingSkills: items.pendingSkills,
    inventory: items.inventory, autoCorrect: items.autoCorrect,
  };
}

function genMap(len) {
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

// 提示用：测试模式直接返回固定题,否则查库
async function resolveQuestionForHint(run, questionId) {
  const items = parseItems(run.items);
  if (items.test && questionId === TEST_QUESTION.id) return TEST_QUESTION;
  return prisma.question.findUnique({ where: { id: questionId }, select: QUIZ_FIELDS });
}

// 抽一题
async function pickQuestion(run, opts = {}) {
  const items = parseItems(run.items);
  if (items.test) return publicQuestion(TEST_QUESTION);
  const exclude = new Set(items.answered);
  const subs = run.subject === "数学" ? ["数学", "TMUA"] : run.subject === "ESAT" ? ["ESAT", "数学", "物理"] : [run.subject];
  const subjectWhere = subs.length === 1 ? subs[0] : { in: subs };

  async function findPool(diffWhere) {
    const all = await prisma.question.findMany({ where: { status: "PUBLISHED", subject: subjectWhere, difficulty: diffWhere }, select: { id: true } });
    if (!all.length) return [];
    const fresh = all.filter((q) => !exclude.has(q.id));
    return fresh.length ? fresh : all;
  }

  let pool = [];
  if (opts.boss) {
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
      for (let d = Math.min(run.difficulty + 1, 5); d >= 1; d--) {
        pool = await findPool(d);
        if (pool.length) break;
      }
      if (!pool.length) pool = await findPool(undefined);
    }
  } else {
    pool = await findPool(run.difficulty);
    if (!pool.length) {
      for (let delta = 1; delta <= 4; delta++) {
        if (run.difficulty + delta <= 5) { pool = await findPool(run.difficulty + delta); if (pool.length) break; }
        if (run.difficulty - delta >= 1) { pool = await findPool(run.difficulty - delta); if (pool.length) break; }
      }
    }
    if (!pool.length) pool = await findPool(undefined);
  }
  if (!pool.length) return null;
  const picked = pool[Math.floor(Math.random() * pool.length)];
  const q = await prisma.question.findUnique({ where: { id: picked.id }, select: QUIZ_FIELDS });
  return q ? publicQuestion(q) : null;
}

// 连击奖励（额外物品）
function comboReward(combo) {
  if (combo === 3) return { message: "3 连对!恢复 1 点生命", coins: 2, heal: 1, items: ["i_heal"] };
  if (combo === 5) return { message: "5 连对!获得护盾 ×1", coins: 5, heal: 0, items: ["i_shield"] };
  if (combo === 10) return { message: "10 连对!获得治疗药水 ×1", coins: 10, heal: 0, items: ["i_heal"] };
  if (combo > 0 && combo % 5 === 0) return { message: `${combo} 连对!金币奖励`, coins: 5, heal: 0, items: [] };
  return { coins: 0, heal: 0, items: [] };
}

// 升级判定：xp 达到 level*3 升级，触发技能三选一
function checkLevelUp(items) {
  let leveled = false;
  while (items.xp >= items.level * 3) {
    items.xp -= items.level * 3;
    items.level += 1;
    leveled = true;
    if (!items.pendingSkills || items.pendingSkills.length === 0) {
      items.pendingSkills = pickThreeSkills(items.skills);
    } else {
      items.pendingCount += 1;
    }
  }
  return leveled;
}
function pickThreeSkills(owned) {
  const avail = SKILL_POOL.filter((s) => !owned.includes(s.id));
  const pool = avail.length >= 3 ? avail : SKILL_POOL.slice();
  const sh = pool.slice().sort(() => Math.random() - 0.5);
  return sh.slice(0, 3).map((s) => ({ id: s.id, name: s.name, icon: s.icon, cost: s.cost, type: s.type, tier: s.tier, desc: s.desc }));
}

// 掉落：消灭怪物随机掉落装备或物品
function rollDrop(items, isBoss) {
  const dropped = [];
  if (isBoss) {
    dropped.push(mkGearEntry(randomFrom(GEAR_POOL).id));
    if (Math.random() < 0.3) dropped.push(mkItemEntry(randomFrom(ITEM_POOL).id));
  } else if (Math.random() < 0.35) {
    if (Math.random() < 0.5) dropped.push(mkGearEntry(randomFrom(GEAR_POOL).id));
    else dropped.push(mkItemEntry(randomFrom(ITEM_POOL).id));
  }
  dropped.forEach((d) => items.inventory.push(d));
  return dropped;
}

// 推进到下一节点
async function nextNode(run) {
  const items = parseItems(run.items);
  const nodeType = items.map[run.layer - 1] || "normal";
  if (nodeType === "reward") return { nodeType: "reward", question: null };
  const question = await pickQuestion(run, { boss: nodeType === "boss" });
  return { nodeType, question };
}

// 计算当前武器加分与饰品回蓝
function weaponBonus(items) { return items.equipped?.weapon?.bonus?.score || 0; }
function trinketRegen(items) { return items.equipped?.trinket?.bonus?.regen || 0; }

// GET /api/roguelike/active
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
    ok(res, { run, ...extraState(parseItems(run.items)), ...node });
  })
);

// POST /api/roguelike/start
router.post(
  "/start",
  requireAuth,
  asyncHandler(async (req, res) => {
    const subject = String(req.body?.subject || "").trim() || "数学";
    const difficulty = req.body?.difficulty ? Number(req.body.difficulty) : 3;
    const test = !!req.body?.test;

    const existing = await prisma.roguelikeRun.findFirst({
      where: { studentId: req.user.id, status: "ACTIVE" },
      orderBy: { updatedAt: "desc" },
    });
    if (existing) {
      const node = await nextNode(existing);
      if (node.nodeType !== "reward" && !node.question) {
        return fail(res, 400, "当前进行中的冒险暂无可用题目,请结算或更换学科");
      }
      return ok(res, { run: existing, ...extraState(parseItems(existing.items)), ...node }, "继续上次冒险");
    }

    const runItems = defaultItems();
    runItems.test = test;
    const run = await prisma.roguelikeRun.create({
      data: {
        studentId: req.user.id,
        subject,
        difficulty,
        items: JSON.stringify(runItems),
      },
    });
    const node = await nextNode(run);
    if (node.nodeType !== "reward" && !node.question) {
      await prisma.roguelikeRun.delete({ where: { id: run.id } });
      const mapped = subject === "数学" ? "数学/TMUA" : subject === "ESAT" ? "ESAT/数学/物理" : subject;
      return fail(res, 400, `该学科/难度暂无可用题目,请选择其他学科(当前匹配题库:${mapped})`);
    }
    ok(res, { run, ...extraState(parseItems(run.items)), ...node }, "冒险开始");
  })
);

// POST /api/roguelike/:runId/answer
router.post(
  "/:runId/answer",
  requireAuth,
  asyncHandler(async (req, res) => {
    const run = await prisma.roguelikeRun.findUnique({ where: { id: req.params.runId } });
    if (!run || run.studentId !== req.user.id) return fail(res, 404, "冒险不存在");
    if (run.status !== "ACTIVE") return fail(res, 400, "冒险已结束");

    const { questionId, selected } = req.body || {};
    if (!questionId) return fail(res, 400, "questionId 必填");
    const items = parseItems(run.items);
    const nodeType = items.map[run.layer - 1] || "normal";

    let question;
    if (items.test && questionId === TEST_QUESTION.id) {
      question = TEST_QUESTION;
    } else {
      question = await prisma.question.findUnique({ where: { id: questionId } });
      if (!question || question.status !== "PUBLISHED") return fail(res, 404, "题目不存在");
    }

    let correct = isAnswerCorrect(question, selected);
    // 攻击道具/技能：下次作答必中
    let forcedByItem = false;
    if (items.autoCorrect) {
      correct = true;
      forcedByItem = true;
      items.autoCorrect = false;
    }

    if (!items.answered.includes(questionId)) items.answered.push(questionId);

    let { layer, hp, combo, maxCombo, score, coins, status } = run;
    const drops = [];
    let reward = { message: "", coins: 0, heal: 0, items: [] };
    let shieldUsed = false;
    let leveled = false;

    if (correct) {
      combo += 1;
      maxCombo = Math.max(maxCombo, combo);
      let gain = 10 + combo * 2 + weaponBonus(items);
      if (items.berserk) gain *= 2;
      if (items.pendingScoreBonus) gain += items.pendingScoreBonus;
      score += gain;
      items.pendingScoreBonus = 0;
      items.berserk = false;
      // 蓝条回复
      items.mana = Math.min(items.maxMana, items.mana + 1 + trinketRegen(items));
      // 经验与升级
      items.xp += nodeType === "boss" ? 3 : 1;
      leveled = checkLevelUp(items);

      reward = comboReward(combo);
      coins += 1 + reward.coins;
      if (reward.heal > 0) hp = Math.min(run.maxHp, hp + reward.heal);
      reward.items.forEach((ref) => items.inventory.push(mkItemEntry(ref)));

      if (nodeType === "boss") {
        coins += 5;
        items.inventory.push(mkItemEntry("i_heal"));
        reward.message = reward.message ? `${reward.message} · 击败 Boss!金币+5、药水×1` : "击败 Boss!金币+5、药水×1";
      }
      // 消灭怪物掉落装备/物品
      const d = rollDrop(items, nodeType === "boss");
      if (d.length) drops.push(...d);

      layer += 1;
    } else {
      // 护盾抵挡
      if (items.shieldCount > 0) {
        items.shieldCount -= 1;
        if (items.shieldCount <= 0) items.shield = false;
        shieldUsed = true;
      } else {
        hp -= 1;
      }
      combo = 0;
      items.berserk = false;
      items.pendingScoreBonus = 0;
      if (hp <= 0) {
        hp = 0;
        status = "DEAD";
      }
      // 测试模式(固定题 TEST_Q 不存在于 question 表)跳过错题本写入,避免外键报错
      if (!items.test) {
        await prisma.wrongBook.upsert({
          where: { studentId_questionId: { studentId: req.user.id, questionId } },
          create: { studentId: req.user.id, questionId, wrongCount: 1 },
          update: { wrongCount: { increment: 1 }, mastered: false },
        });
      }
    }

    let runOver = status !== "ACTIVE";
    let nextNodeInfo = { nodeType: null, question: null };
    if (!runOver && layer > MAX_LAYER) {
      status = "WON";
      runOver = true;
    }
    if (!runOver) {
      const updatedRun = { ...run, layer, hp, combo, maxCombo, score, coins, status };
      nextNodeInfo = await nextNode(updatedRun);
    }

    await prisma.roguelikeRun.update({
      where: { id: run.id },
      data: {
        layer, hp, combo, maxCombo, score, coins, status,
        items: JSON.stringify(items),
      },
    });

    ok(res, {
      correct: correct || forcedByItem,
      forcedByItem,
      combo, maxCombo, hp, maxHp: run.maxHp, layer, score, coins,
      reward: reward.message || null,
      drops: drops.length ? drops : null,
      shieldUsed,
      leveled,
      runOver, status: status,
      nodeType: nextNodeInfo.nodeType,
      nextQuestion: nextNodeInfo.question,
      ...extraState(items),
    }, correct ? "回答正确" : shieldUsed ? "回答错误(护盾抵挡)" : "回答错误");
  })
);

// POST /api/roguelike/:runId/claim
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
    coins += 2;
    const msg = [];
    if (Math.random() < 0.3) { items.inventory.push(mkItemEntry("i_heal")); msg.push("治疗药水×1"); }
    if (hp < run.maxHp && Math.random() < 0.3) { hp += 1; msg.push("回复 1 点生命"); }
    layer += 1;
    let runOver = false;
    let nextNodeInfo = { nodeType: null, question: null };
    if (layer > MAX_LAYER) { status = "WON"; runOver = true; }
    else {
      const updatedRun = { ...run, layer, hp, score, coins, status };
      nextNodeInfo = await nextNode(updatedRun);
    }

    await prisma.roguelikeRun.update({
      where: { id: run.id },
      data: { layer, hp, score, coins, status, items: JSON.stringify(items) },
    });

    ok(res, {
      hp, layer, score, coins,
      reward: `奖励节点:金币+2${msg.length ? "、" + msg.join("、") : ""}`,
      runOver, status: status,
      nodeType: nextNodeInfo.nodeType,
      nextQuestion: nextNodeInfo.question,
      ...extraState(items),
    }, "奖励领取成功");
  })
);

// POST /api/roguelike/:runId/use-item — 使用消耗品（物品）
router.post(
  "/:runId/use-item",
  requireAuth,
  asyncHandler(async (req, res) => {
    const run = await prisma.roguelikeRun.findUnique({ where: { id: req.params.runId } });
    if (!run || run.studentId !== req.user.id) return fail(res, 404, "冒险不存在");
    if (run.status !== "ACTIVE") return fail(res, 400, "冒险已结束");

    const uid = String(req.body?.uid || "");
    const items = parseItems(run.items);
    const idx = items.inventory.findIndex((e) => e.uid === uid && e.kind === "item");
    if (idx < 0) return fail(res, 400, "没有该物品");
    const entry = items.inventory[idx];
    const meta = ITEM_BY_ID[entry.ref];
    if (!meta) return fail(res, 400, "物品不存在");

    items.inventory.splice(idx, 1);
    let { layer, hp, combo, score, coins, status } = run;
    let payload = {};
    let runOver = false;
    let nextNodeInfo = { nodeType: null, question: null };

    if (meta.type === "heal") {
      hp = Math.min(run.maxHp, hp + (meta.heal || 1));
      payload = { message: `使用${meta.name},回复 ${meta.heal} 点生命` };
    } else if (meta.type === "attack") {
      items.autoCorrect = true;
      payload = { message: "力量药剂生效:下次作答必中" };
    } else if (meta.type === "defense") {
      items.shield = true;
      items.shieldCount = Math.max(items.shieldCount, 1);
      payload = { message: "已开启护盾,抵挡一次答错" };
    } else if (meta.type === "utility") {
      const hintQid = String(req.body?.questionId || "");
      if (!hintQid) return fail(res, 400, "提示需要 questionId");
      const q = await resolveQuestionForHint(run, hintQid);
      if (!q) return fail(res, 404, "题目不存在");
      const answer = String(q.answer).trim();
      const opts = safeParseOptions(q.options);
      const wrongIdx = opts.map((o, i) => i).filter((i) => {
        const ov = String(opts[i]).trim();
        if (q.type === "NUMERIC" && !Number.isNaN(Number(answer)) && !Number.isNaN(Number(ov))) {
          return Math.abs(Number(ov) - Number(answer)) > 0.01;
        }
        return ov !== answer;
      });
      payload = { message: "提示已使用:排除 2 个错误选项", hintExclude: wrongIdx.sort(() => Math.random() - 0.5).slice(0, 2) };
    }

    await prisma.roguelikeRun.update({
      where: { id: run.id },
      data: { layer, hp, combo, score, coins, status, items: JSON.stringify(items) },
    });

    ok(res, { ...payload, hp, layer, combo, score, coins, runOver, status: status, nodeType: nextNodeInfo.nodeType, nextQuestion: nextNodeInfo.question, ...extraState(items) }, "物品已使用");
  })
);

// POST /api/roguelike/:runId/equip — 穿戴/替换装备
router.post(
  "/:runId/equip",
  requireAuth,
  asyncHandler(async (req, res) => {
    const run = await prisma.roguelikeRun.findUnique({ where: { id: req.params.runId } });
    if (!run || run.studentId !== req.user.id) return fail(res, 404, "冒险不存在");
    if (run.status !== "ACTIVE") return fail(res, 400, "冒险已结束");

    const uid = String(req.body?.uid || "");
    const items = parseItems(run.items);
    const entry = items.inventory.find((e) => e.uid === uid && e.kind === "gear");
    if (!entry) return fail(res, 400, "没有该装备");
    const slot = entry.slot;
    const prev = items.equipped[slot];

    // 卸下旧装备（反向加成）
    if (prev && prev.bonus) {
      if (prev.bonus.hp) { run.maxHp = Math.max(1, run.maxHp - prev.bonus.hp); run.hp = Math.min(run.hp, run.maxHp); }
      if (prev.bonus.mana) { items.maxMana = Math.max(1, items.maxMana - prev.bonus.mana); items.mana = Math.min(items.mana, items.maxMana); }
    }
    // 穿戴新装备（正向加成）
    items.equipped[slot] = entry;
    if (entry.bonus) {
      if (entry.bonus.hp) { run.maxHp += entry.bonus.hp; run.hp = Math.min(run.maxHp, run.hp + entry.bonus.hp); }
      if (entry.bonus.mana) { items.maxMana += entry.bonus.mana; items.mana = Math.min(items.maxMana, items.mana + entry.bonus.mana); }
    }
    items.inventory = items.inventory.filter((e) => e.uid !== uid);

    await prisma.roguelikeRun.update({
      where: { id: run.id },
      data: { maxHp: run.maxHp, hp: run.hp, items: JSON.stringify(items) },
    });

    ok(res, { hp: run.hp, maxHp: run.maxHp, message: `已穿戴${entry.name}`, ...extraState(items) }, "装备已穿戴");
  })
);

// POST /api/roguelike/:runId/use-skill — 使用技能（耗蓝）
router.post(
  "/:runId/use-skill",
  requireAuth,
  asyncHandler(async (req, res) => {
    const run = await prisma.roguelikeRun.findUnique({ where: { id: req.params.runId } });
    if (!run || run.studentId !== req.user.id) return fail(res, 404, "冒险不存在");
    if (run.status !== "ACTIVE") return fail(res, 400, "冒险已结束");

    const skillId = String(req.body?.skillId || "");
    const items = parseItems(run.items);
    if (!items.skills.includes(skillId)) return fail(res, 400, "尚未习得该技能");
    const meta = SKILL_BY_ID[skillId];
    if (!meta) return fail(res, 400, "技能不存在");
    if (items.mana < meta.cost) return fail(res, 400, `蓝量不足(需要 ${meta.cost},现有 ${items.mana})`);

    items.mana -= meta.cost;
    let { layer, hp, combo, score, coins, status } = run;
    let payload = {};
    let hintExclude = null;

    if (meta.type === "attack") {
      items.autoCorrect = true;
      items.pendingScoreBonus = meta.bonus || 0;
      payload = { message: `${meta.name}发动:下次作答必中${meta.bonus ? `,+${meta.bonus} 分` : ""}` };
    } else if (meta.type === "heal") {
      const amt = meta.heal >= 999 ? run.maxHp : meta.heal;
      hp = Math.min(run.maxHp, hp + amt);
      payload = { message: `${meta.name}:回复 ${amt} 点生命` };
    } else if (meta.type === "defense") {
      items.shield = true;
      items.shieldCount = Math.max(items.shieldCount, meta.blocks || 1);
      payload = { message: `${meta.name}:抵挡 ${meta.blocks || 1} 次答错` };
    } else if (meta.type === "utility") {
      if (meta.id === "s_berserk") {
        items.berserk = true;
        payload = { message: "狂暴:本次答对得分翻倍" };
      } else {
        // 专注:提示
        const hintQid = String(req.body?.questionId || "");
        if (!hintQid) return fail(res, 400, "专注需要 questionId");
        const q = await resolveQuestionForHint(run, hintQid);
        if (!q) return fail(res, 404, "题目不存在");
        const answer = String(q.answer).trim();
        const opts = safeParseOptions(q.options);
        const wrongIdx = opts.map((o, i) => i).filter((i) => {
          const ov = String(opts[i]).trim();
          if (q.type === "NUMERIC" && !Number.isNaN(Number(answer)) && !Number.isNaN(Number(ov))) return Math.abs(Number(ov) - Number(answer)) > 0.01;
          return ov !== answer;
        });
        hintExclude = wrongIdx.sort(() => Math.random() - 0.5).slice(0, 2);
        payload = { message: "专注:排除 2 个错误选项", hintExclude };
      }
    }

    await prisma.roguelikeRun.update({
      where: { id: run.id },
      data: { layer, hp, combo, score, coins, status, items: JSON.stringify(items) },
    });

    ok(res, { ...payload, hp, layer, combo, score, coins, hintExclude, ...extraState(items) }, "技能已发动");
  })
);

// POST /api/roguelike/:runId/choose-skill — 升级三选一
router.post(
  "/:runId/choose-skill",
  requireAuth,
  asyncHandler(async (req, res) => {
    const run = await prisma.roguelikeRun.findUnique({ where: { id: req.params.runId } });
    if (!run || run.studentId !== req.user.id) return fail(res, 404, "冒险不存在");
    if (run.status !== "ACTIVE") return fail(res, 400, "冒险已结束");

    const skillId = String(req.body?.skillId || "");
    const items = parseItems(run.items);
    if (!Array.isArray(items.pendingSkills) || !items.pendingSkills.length) return fail(res, 400, "当前没有待选择的技能");
    if (!items.pendingSkills.some((s) => s.id === skillId)) return fail(res, 400, "该技能不在可选列表中");
    if (items.skills.includes(skillId)) return fail(res, 400, "已习得该技能");

    items.skills.push(skillId);
    // 还有排队的选择则继续给三个
    if (items.pendingCount > 0) {
      items.pendingCount -= 1;
      items.pendingSkills = pickThreeSkills(items.skills);
    } else {
      items.pendingSkills = null;
    }

    await prisma.roguelikeRun.update({
      where: { id: run.id },
      data: { items: JSON.stringify(items) },
    });

    const m = SKILL_BY_ID[skillId];
    ok(res, { message: `习得技能:${m?.name || skillId}`, ...extraState(items) }, "技能已选择");
  })
);

// POST /api/roguelike/:runId/quit
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

// GET /api/roguelike/:runId
router.get(
  "/:runId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const run = await prisma.roguelikeRun.findUnique({ where: { id: req.params.runId } });
    if (!run || run.studentId !== req.user.id) return fail(res, 404, "冒险不存在");
    const node = run.status === "ACTIVE" ? await nextNode(run) : { nodeType: null, question: null };
    ok(res, { run, ...extraState(parseItems(run.items)), ...node });
  })
);

export default router;
