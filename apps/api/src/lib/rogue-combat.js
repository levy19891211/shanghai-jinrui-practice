// 冒险模式 · 即时制战斗内核（V2.0）
//
// 设计要点
// 1) 战斗节拍归一化：每道题给固定 BEATS_PER_QUESTION 个「战斗秒」的窗口，
//    1 战斗秒 = 该题真实限时 / BEATS_PER_QUESTION。
//    这样 TMUA 的 5 分钟长题与 ESAT 的 30 秒短题，战斗压力一致；
//    而「每 8 秒刷新护盾」「灼烧 3 秒」这类技能描述仍然成立（单位是战斗秒）。
// 2) 超时判定用「真实时间」（切后台不能偷时间思考）；
//    战斗结算用「节拍 + dt 钳制」（切后台不会被敌人打死）。
// 3) 服务端权威：前端只发心跳带时间戳，所有伤害/回复由服务端按 dt 推进。

export const BEATS_PER_QUESTION = 60; // 每题窗口的战斗秒数
export const MAX_TICK_MS = 3000;      // 单次心跳最多推进的真实毫秒（防挂机后暴毙 / 防加速作弊）
export const ANSWER_GRACE_MS = 1500;  // 提交答案的网络宽限

export function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function rand(min, max) {
  return Math.random() * (max - min) + min;
}
function genEid() {
  return Math.random().toString(36).slice(2, 8);
}

// ===================== 题目限时 =====================
// TMUA：2 - 5 分钟；ESAT：0.5 - 2 分钟；其他学科：45 秒 - 2.75 分钟。均随难度线性递增。
export function questionLimitMs(question, opts = {}) {
  if (opts.test) return 20000; // 测试模式固定题：20 秒，便于快速验证即时制
  const d = Math.min(5, Math.max(1, Number(question?.difficulty) || 3));
  const tag = `${question?.subject || ""} ${question?.paper || ""}`;
  let sec;
  if (/TMUA/i.test(tag)) sec = 120 + (d - 1) * 45;
  else if (/ESAT/i.test(tag)) sec = 30 + (d - 1) * 22.5;
  else sec = 45 + (d - 1) * 30;
  if (opts.boss) sec *= 1.2; // Boss 题多给两成时间
  return Math.round(sec * 1000);
}

// ===================== 敌人 =====================
// 普通节点敌人数量：1-5 只加权随机（多数是 1-2 只，偶尔成群）
const ENEMY_COUNT_WEIGHTS = [1, 1, 1, 1, 2, 2, 2, 3, 3, 4, 5];
const ENEMY_NAMES = ["岩甲兽", "腐叶精", "碎骨怪", "灰羽蝠", "沼泽伥"];
const BOSS_NAMES = { 5: "巨眼魔像", 10: "血翼蝠王", 15: "暗影蝠王", 20: "灭世魔像" };

// 攻击间隔（战斗秒）。窗口共 60 拍，所以：
//   普通怪 16 拍 → 完美出手(30%)只挨 1 刀、迅捷(60%)挨 2 刀、拖满挨 3 刀
//   Boss   20 拍 → 完美出手一刀不挨、迅捷挨 1 刀、拖满挨 3 刀
const NORMAL_INTERVAL = 16;
const BOSS_INTERVAL = 20;

export function spawnEnemies(layer, nodeType) {
  if (nodeType === "boss") {
    const bossLayer = [5, 10, 15, 20].find((l) => l === layer) || 5;
    // 目标：迅捷出手 3-4 次打死，配合 TMUA 长题也不会拖成半小时
    const maxHp = Math.round(40 + layer * 4);
    return [{
      eid: genEid(),
      kind: "boss",
      name: BOSS_NAMES[bossLayer] || BOSS_NAMES[5],
      sprite: [5, 10, 15, 20].indexOf(bossLayer),
      hp: maxHp, maxHp,
      atk: Math.round(7 + layer * 0.6),
      armor: 5,
      interval: BOSS_INTERVAL,
      nextAtkBeat: BOSS_INTERVAL,
    }];
  }
  const n = ENEMY_COUNT_WEIGHTS[randInt(0, ENEMY_COUNT_WEIGHTS.length - 1)];
  // 群怪：单体血量按数量衰减（多数一击必杀），攻击间隔同步拉长，
  // 保证「一题窗口内全队总出手次数」不随数量线性爆炸——快答几乎不挨打，慢答被围殴。
  const hpScale = 1 / (0.55 * n + 0.45);
  const interval = NORMAL_INTERVAL * (1 + 0.4 * (n - 1));
  const baseHp = 18 + layer * 1.5;
  const list = [];
  for (let i = 0; i < n; i++) {
    const maxHp = Math.max(6, Math.round(baseHp * hpScale));
    list.push({
      eid: genEid(),
      kind: "normal",
      name: ENEMY_NAMES[randInt(0, ENEMY_NAMES.length - 1)],
      sprite: randInt(0, 4),
      hp: maxHp, maxHp,
      atk: Math.round(6 + layer * 0.5),
      armor: layer >= 10 ? 2 : 0,
      interval,
      // 错开首次出手，避免开局同时挨打
      nextAtkBeat: interval * (0.6 + 0.2 * i),
    });
  }
  return list;
}

export function aliveEnemies(combat) {
  return (combat?.enemies || []).filter((e) => e.hp > 0);
}

// ===================== 战斗状态初始化 / 换题 =====================
export function newCombat(layer, nodeType, question, opts = {}) {
  const limit = questionLimitMs(question, { boss: nodeType === "boss", test: opts.test });
  const now = Date.now();
  return {
    layer,
    nodeType,
    enemies: spawnEnemies(layer, nodeType),
    totalBeat: 0,
    qStartBeat: 0,
    beatMs: limit / BEATS_PER_QUESTION,
    qLimitMs: limit,
    qStartMs: now,
    lastTickMs: now,
  };
}

// 换到下一题：保留敌人与累计节拍，重置本题窗口（敌人重新蓄力，给玩家一个喘息）
export function beginQuestionWindow(combat, question, opts = {}) {
  const limit = questionLimitMs(question, { boss: combat.nodeType === "boss", test: opts.test });
  const now = Date.now();
  combat.beatMs = limit / BEATS_PER_QUESTION;
  combat.qLimitMs = limit;
  combat.qStartMs = now;
  combat.lastTickMs = now;
  combat.qStartBeat = combat.totalBeat;
  combat.enemies.forEach((e) => {
    if (e.hp > 0) e.nextAtkBeat = combat.totalBeat + e.interval;
  });
}

// 确保 items.combat 与当前节点/题目一致；换层或全灭则重新生成敌人
export function syncCombat(items, layer, nodeType, question, opts = {}) {
  if (nodeType === "reward" || !question) {
    items.combat = null;
    return;
  }
  const c = items.combat;
  if (!c || c.layer !== layer || c.nodeType !== nodeType || !aliveEnemies(c).length) {
    items.combat = newCombat(layer, nodeType, question, opts);
  } else {
    beginQuestionWindow(c, question, opts);
  }
}

// ===================== 伤害结算 =====================
// 玩家攻击力：等级 + 武器加成
export function playerAtk(items, level) {
  const weapon = items.equipped?.weapon?.bonus?.score || 0;
  return 14 + (Math.max(1, level) - 1) * 2 + weapon * 3;
}

// 答题速度 → 伤害倍率。越快越狠，逼学生又快又准。
export function speedTier(ratio) {
  if (ratio <= 0.3) return { mult: 1.5, label: "perfect", text: "完美出手" };
  if (ratio <= 0.6) return { mult: 1.25, label: "good", text: "迅捷出手" };
  return { mult: 1.0, label: "slow", text: "普通出手" };
}

// 玩家对敌人造成伤害（护甲减免）
export function damageEnemy(enemy, amount) {
  const dealt = Math.max(1, Math.round(amount - (enemy.armor || 0)));
  enemy.hp = Math.max(0, enemy.hp - dealt);
  return { dealt, killed: enemy.hp <= 0 };
}

// 敌人对玩家造成伤害（当前仅护盾全额抵挡，阶段二再接入减伤/闪避/护甲/反弹）
export function damagePlayer(items, hp, rawAmount) {
  if (items.shieldCount > 0) {
    items.shieldCount -= 1;
    if (items.shieldCount <= 0) items.shield = false;
    return { hp, dealt: 0, blocked: true };
  }
  const dealt = Math.max(1, Math.round(rawAmount));
  return { hp: Math.max(0, hp - dealt), dealt, blocked: false };
}

// ===================== 时间轴推进 =====================
// 按 dt 推进战斗节拍，结算敌人自动攻击。返回事件列表供前端播放特效。
export function simulate(items, hp, nowMs) {
  const c = items.combat;
  const events = [];
  if (!c) return { hp, events };
  const dt = Math.max(0, Math.min(MAX_TICK_MS, nowMs - (c.lastTickMs || nowMs)));
  c.lastTickMs = nowMs;
  if (hp <= 0) return { hp, events };
  const dBeat = c.beatMs > 0 ? dt / c.beatMs : 0;
  c.totalBeat += dBeat;

  for (const e of c.enemies) {
    if (e.hp <= 0) continue;
    let guard = 0;
    while (c.totalBeat >= e.nextAtkBeat && guard++ < 12) {
      e.nextAtkBeat += e.interval;
      if (hp <= 0) break;
      const raw = e.atk * rand(0.85, 1.15);
      const r = damagePlayer(items, hp, raw);
      hp = r.hp;
      events.push({ type: "enemy_hit", eid: e.eid, name: e.name, dmg: r.dealt, blocked: r.blocked });
    }
  }
  return { hp, events };
}

// 超时：视为一次落空，并挨一记重击
export function isTimedOut(combat, nowMs = Date.now()) {
  if (!combat) return false;
  return nowMs - combat.qStartMs > combat.qLimitMs;
}
export function timeoutStrike(items, hp) {
  const c = items.combat;
  const target = aliveEnemies(c)[0];
  const raw = (target ? target.atk : 8) * 1.5;
  const r = damagePlayer(items, hp, raw);
  return { hp: r.hp, dmg: r.dealt, blocked: r.blocked, name: target?.name || "敌人" };
}

// ===================== 给前端的视图 =====================
export function combatView(items, nowMs = Date.now()) {
  const c = items.combat;
  if (!c) return null;
  return {
    layer: c.layer,
    nodeType: c.nodeType,
    // 累计节拍 & 本题起始节拍：前端按本地倒计时反推当前节拍，画平滑的蓄力环（心跳之间不抖动）
    totalBeat: c.totalBeat,
    qStartBeat: c.qStartBeat,
    enemies: c.enemies.map((e) => ({
      eid: e.eid, name: e.name, kind: e.kind, sprite: e.sprite,
      hp: e.hp, maxHp: e.maxHp,
      interval: e.interval,
      nextAtkBeat: e.nextAtkBeat,
      // 蓄力进度 0-1（服务端快照，前端以本地计算为准）
      windup: e.hp > 0 ? Math.max(0, Math.min(1, 1 - (e.nextAtkBeat - c.totalBeat) / e.interval)) : 0,
    })),
    qLimitMs: c.qLimitMs,
    qRemainMs: Math.max(0, c.qLimitMs - (nowMs - c.qStartMs)),
    beatMs: c.beatMs,
  };
}
