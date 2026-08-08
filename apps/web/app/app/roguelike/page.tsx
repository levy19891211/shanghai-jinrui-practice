"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { renderRich } from "@/lib/rich";
import { playSfx, setSfxMuted } from "@/lib/sfx";
import Particles, { type Burst } from "./Particles";

interface Run {
  id: string; subject: string; difficulty: number; layer: number; hp: number; maxHp: number;
  combo: number; maxCombo: number; score: number; coins: number; status: string;
}
interface Q { id: string; topic?: string; type: string; stem: string; options: string[]; difficulty: number }
// 即时制战斗视图（来自后端 combatView）
interface EnemyView {
  eid: string; name: string; kind: "normal" | "boss"; sprite: number;
  hp: number; maxHp: number; interval: number; nextAtkBeat: number; windup: number;
}
interface CombatView {
  layer: number; nodeType: string;
  totalBeat: number; qStartBeat: number;
  qLimitMs: number; qRemainMs: number; beatMs: number;
  enemies: EnemyView[];
}
interface NodeResp {
  run?: Run;
  nodeType: "normal" | "boss" | "reward" | null;
  question: Q | null;
  reward?: string | null;
  hp?: number; layer?: number; score?: number; coins?: number; combo?: number; maxCombo?: number;
  status?: string; runOver?: boolean;
  drops?: string[] | null;
  shieldUsed?: boolean;
  nextQuestion?: Q | null;
  hintExclude?: number[];
  inventory?: any[];
  maxHp?: number;
  mana?: number;
  maxMana?: number;
  level?: number;
  equipped?: Record<string, any>;
  skills?: string[];
  pendingSkills?: any[] | null;
  autoCorrect?: boolean;
  message?: string;
  combat?: CombatView | null;
  // 答题结算/心跳事件
  events?: any[];
  attack?: { dmg: number; killed: boolean; eid: string; name: string; speed: string; speedText: string; mult: number } | null;
  counter?: { dmg: number; blocked: boolean; name: string; timeout: boolean } | null;
  kills?: { eid: string; name: string; kind: string }[];
  cleared?: boolean;
  overtime?: boolean;
  timedOut?: boolean;
}
interface StartResp extends NodeResp {}
interface AnsResp extends NodeResp { correct: boolean; nextQuestion: Q | null; damage?: number; heal?: number; shieldUsed?: boolean }
interface RunDetail { run: Run; nodeType: string | null; question: Q | null; inventory?: string[] }

const SUBJECTS = ["数学", "物理", "化学", "生物", "TMUA"];
const DIFFS = [1, 2, 3, 4, 5];
const DIFF_LABEL: Record<number, string> = { 1: "入门", 2: "基础", 3: "中等", 4: "较难", 5: "困难" };
const MAX_LAYER = 20;
const ITEM_LABEL: Record<string, string> = { shield: "🛡 护盾", heal: "🧪 药水", skip: "⏭ 跳过", hint: "💡 提示" };
const NODE_LABEL: Record<string, string> = { normal: "普通", boss: "BOSS", reward: "奖励" };
// Phase C:按层数分 Boss/敌人(每 5 层不同 Boss,普通敌人 3 档进阶)
const BOSS_NAME: Record<number, string> = { 5: "巨眼魔像", 10: "血翼蝠王", 15: "暗影蝠王", 20: "灭世魔像" };
const BOSS_IMG: Record<number, string> = {
  5: "/images/rogue/boss.png",
  10: "/images/rogue/boss2.png",
  15: "/images/rogue/boss3.png",
  20: "/images/rogue/boss.png",
};
function bossImg(layer: number) { return BOSS_IMG[layer] || BOSS_IMG[5]; }
function bossName(layer: number) { return BOSS_NAME[layer] || BOSS_NAME[5]; }
// 普通敌人:5 张较大精灵按层循环
const ENEMY_IMG = [
  "/images/rogue/enemy_a.png",
  "/images/rogue/enemy_b.png",
  "/images/rogue/enemy_c.png",
  "/images/rogue/enemy_d.png",
  "/images/rogue/enemy_e.png",
];
function enemyImg(layer: number) { return ENEMY_IMG[(layer - 1) % ENEMY_IMG.length]; }
// 即时制：按敌人实体（kind/sprite）选图，支持多敌人同屏
function enemySpriteFor(e: EnemyView): string {
  if (e.kind === "boss") return bossImg(e.sprite >= 0 ? [5, 10, 15, 20][e.sprite] || 5 : 5);
  return ENEMY_IMG[((e.sprite % ENEMY_IMG.length) + ENEMY_IMG.length) % ENEMY_IMG.length];
}
// 速度倍率档位（与后端 speedTier 一致）：按「本题已用时间比例」换算
function speedTierOf(ratio: number): { mult: number; label: string; text: string; color: string } {
  if (ratio <= 0.3) return { mult: 1.5, label: "perfect", text: "完美出手 ×1.5", color: "#22c55e" };
  if (ratio <= 0.6) return { mult: 1.25, label: "good", text: "迅捷出手 ×1.25", color: "#f59e0b" };
  return { mult: 1.0, label: "slow", text: "普通出手 ×1.0", color: "#ef4444" };
}

// 分区:按层切换背景色调与装饰素材(森林/海洋/山地/熔岩)
type Zone = { key: string; cls: string; deco: string[] };
const ZONES: Zone[] = [
  { key: "forest", cls: "zone-forest", deco: ["/images/rogue/deco_forest_tree.png", "/images/rogue/deco_forest_flower.png"] },
  { key: "ocean", cls: "zone-ocean", deco: ["/images/rogue/deco_ocean_fish.png", "/images/rogue/deco_ocean_crab.png"] },
  { key: "mountain", cls: "zone-mountain", deco: ["/images/rogue/deco_mountain_pine.png", "/images/rogue/deco_mountain_rock.png"] },
  { key: "volcano", cls: "zone-volcano", deco: ["/images/rogue/deco_volcano_spike.png", "/images/rogue/deco_volcano_trap.png"] },
];
function zoneOf(layer: number): Zone {
  if (layer <= 5) return ZONES[0];
  if (layer <= 10) return ZONES[1];
  if (layer <= 15) return ZONES[2];
  return ZONES[3];
}
// 玩家手持武器(随装备武器变化,默认剑)
const WEAPON_IMG: Record<string, string> = {
  w_wood: "/images/rogue/weapon_sword.png",
  w_iron: "/images/rogue/weapon_sword.png",
  w_flame: "/images/rogue/weapon_spear.png",
  default: "/images/rogue/weapon_sword.png",
  bow: "/images/rogue/weapon_bow.png",
};
function weaponImg(equipped: Record<string, any> | undefined): string {
  const w = equipped?.weapon?.ref as string | undefined;
  if (!w) return WEAPON_IMG.default;
  if (w === "w_iron" || w === "w_wood") return WEAPON_IMG.w_iron;
  if (w === "w_flame") return WEAPON_IMG.w_flame;
  return WEAPON_IMG.default;
}
// 前端技能展示(与后端 SKILL_POOL 对应)
const SKILL_META: Record<string, { name: string; icon: string; cost: number; type: string; tier: number; desc: string }> = {
  s_fireball: { name: "火球术", icon: "🔥", cost: 3, type: "attack", tier: 1, desc: "下次作答必中" },
  s_heal: { name: "治疗术", icon: "💚", cost: 4, type: "heal", tier: 1, desc: "回复 14-21 生命" },
  s_shield: { name: "守护", icon: "🛡", cost: 3, type: "defense", tier: 1, desc: "抵挡一次答错" },
  s_focus: { name: "专注", icon: "💡", cost: 2, type: "utility", tier: 1, desc: "排除 2 个错误选项" },
  s_strike: { name: "雷霆斩", icon: "⚡", cost: 5, type: "attack", tier: 2, desc: "必中并 +10 分" },
  s_regen: { name: "生命涌动", icon: "🌿", cost: 5, type: "heal", tier: 2, desc: "回复 26-39 生命" },
  s_berserk: { name: "狂暴", icon: "😤", cost: 4, type: "utility", tier: 2, desc: "本次答对得分翻倍" },
  s_meteor: { name: "陨石术", icon: "☄️", cost: 7, type: "attack", tier: 3, desc: "必中并 +20 分" },
  s_aegis: { name: "圣盾", icon: "🪬", cost: 6, type: "defense", tier: 3, desc: "抵挡两次答错" },
  s_phoenix: { name: "凤凰祝福", icon: "🦅", cost: 8, type: "heal", tier: 3, desc: "回复全部生命" },
};

export default function RoguelikePage() {
  const router = useRouter();
  const [phase, setPhase] = useState<"setup" | "playing" | "result">("setup");
  const [subject, setSubject] = useState("数学");
  const [difficulty, setDifficulty] = useState(3);
  const [run, setRun] = useState<Run | null>(null);
  const [nodeType, setNodeType] = useState<"normal" | "boss" | "reward" | null>(null);
  const [question, setQuestion] = useState<Q | null>(null);
  const [selected, setSelected] = useState("");
  const [feedback, setFeedback] = useState<null | { correct: boolean; shieldUsed?: boolean; damage?: number; heal?: number }>(null);
  // 浮动战斗数字(伤害红 / 回复绿)
  const [combatNum, setCombatNum] = useState<null | { key: number; text: string; kind: "dmg" | "heal" }>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [inventory, setInventory] = useState<string[]>([]);
  const [hintExclude, setHintExclude] = useState<number[]>([]);
  const [hasActive, setHasActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Phase A 特效状态
  const [burst, setBurst] = useState<Burst | null>(null);
  const [shake, setShake] = useState(0);
  const [comboPop, setComboPop] = useState(0);
  // Phase B 事件特效状态
  const [bossAppearKey, setBossAppearKey] = useState(0);
  const [bossDefeatKey, setBossDefeatKey] = useState(0);
  const [rewardClaimKey, setRewardClaimKey] = useState(0);
  const [victoryOn, setVictoryOn] = useState(false);
  const [deathOn, setDeathOn] = useState(false);
  // Phase C:体验设置(减少动效/静音,localStorage 持久化)
  const [fxReduced, setFxReduced] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("rogue_fx_reduced") === "1";
  });
  const [sfxMuted, setSfxMutedState] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("rogue_sfx_muted") === "1";
  });
  // 测试模式:固定题目 1+1=?(A 2 / B 3),便于快速验证 UI / 战斗流程
  const [testMode, setTestMode] = useState(false);
  // V1.6 战斗状态
  const [equipped, setEquipped] = useState<Record<string, any>>({});
  const [skills, setSkills] = useState<string[]>([]);
  const [pendingSkills, setPendingSkills] = useState<any[] | null>(null);
  const [mana, setMana] = useState(10);
  const [maxMana, setMaxMana] = useState(10);
  const [level, setLevel] = useState(1);
  const [autoArmed, setAutoArmed] = useState(false);
  // ===== V2.0 即时制实时战斗状态 =====
  const [combat, setCombat] = useState<CombatView | null>(null);
  const [remainMs, setRemainMs] = useState(0);          // 本地倒计时(每 100ms 递减,平滑显示)
  const [enemyFloats, setEnemyFloats] = useState<Record<string, { key: number; text: string; kind: "dmg" | "block" | "hit" }[]>>({}); // 敌人飘字
  const [attackingIds, setAttackingIds] = useState<Record<string, boolean>>({}); // 敌人前扑动画
  const [hitFlashIds, setHitFlashIds] = useState<Record<string, boolean>>({});   // 敌人受击闪白
  const [timeoutFlash, setTimeoutFlash] = useState(false); // 超时红屏
  const combatRef = useRef<CombatView | null>(null);
  const tickTimer = useRef<number | null>(null);
  const renderTimer = useRef<number | null>(null);
  const loadingRef = useRef(false);
  const feedbackRef = useRef(false);
  const questionIdRef = useRef<string | null>(null);

  useEffect(() => {
    setSfxMuted(sfxMuted);
  }, [sfxMuted]);

  function toggleFx() {
    setFxReduced((v) => {
      const nv = !v;
      try { localStorage.setItem("rogue_fx_reduced", nv ? "1" : "0"); } catch {}
      return nv;
    });
  }
  function toggleSfx() {
    setSfxMutedState((v) => {
      const nv = !v;
      try { localStorage.setItem("rogue_sfx_muted", nv ? "1" : "0"); } catch {}
      return nv;
    });
  }

  // ===== V2.0 即时制：每秒心跳 + 每 100ms 本地渲染循环 =====
  // 心跳把真实流逝时间上报服务端,结算敌人自动攻击与超时;本地循环只负责平滑倒计时与蓄力环。
  async function sendTick() {
    if (!run || !run.id) return;
    if (nodeType === "reward" || !combatRef.current) return;
    if (loadingRef.current || feedbackRef.current) return; // 答题/反馈期间跳过,避免双重换题
    try {
      const d = await api.post<AnsResp>(`/roguelike/${run.id}/tick`, {});
      if (d.status === "DEAD" || d.runOver) {
        setRun((r) => (r ? { ...r, hp: typeof d.hp === "number" ? d.hp : r.hp, status: d.status ?? r.status } : r));
        applyCombatView(d);
        setTimeout(() => setPhase("result"), 900);
        return;
      }
      if (typeof d.hp === "number") setRun((r) => (r ? { ...r, hp: d.hp!, combo: d.combo ?? r.combo } : r));
      applyCombat(d);
      applyCombatView(d);
      for (const ev of d.events || []) {
        if (ev.type === "enemy_hit") {
          pushEnemyFloat(ev.eid, ev.blocked ? "格挡" : `${ev.dmg}`, ev.blocked ? "block" : "dmg");
          setAttackingIds((prev) => ({ ...prev, [ev.eid]: true }));
          setTimeout(() => setAttackingIds((prev) => ({ ...prev, [ev.eid]: false })), 450);
          if (!fxReduced) setShake(Date.now());
          playSfx("wrong");
        } else if (ev.type === "timeout") {
          pushEnemyFloat(ev.eid, ev.blocked ? "格挡" : `${ev.dmg}`, ev.blocked ? "block" : "dmg");
          if (!fxReduced) setShake(Date.now());
          playSfx("wrong");
        }
      }
      if (d.timedOut) {
        setTimeoutFlash(true);
        setTimeout(() => setTimeoutFlash(false), 500);
        setToast("⏰ 超时!敌人重击,已换新题");
        setRun((r) => (r ? { ...r, combo: d.combo ?? 0 } : r));
        setSelected("");
        setFeedback(null);
        if (d.nextQuestion) applyNode({ nodeType: d.nodeType, question: d.nextQuestion });
      }
    } catch {
      /* 网络抖动忽略,下次心跳重试 */
    }
  }

  useEffect(() => {
    if (phase !== "playing" || !run) return;
    if (nodeType === "reward") return; // 奖励节点无战斗,不启动心跳
    renderTimer.current = window.setInterval(() => {
      setRemainMs((prev) => {
        if (feedbackRef.current || loadingRef.current) return prev; // 反馈/请求中冻结显示
        const next = prev - 100;
        return next < 0 ? 0 : next;
      });
    }, 100);
    tickTimer.current = window.setInterval(() => { void sendTick(); }, 1000);
    return () => {
      if (renderTimer.current) clearInterval(renderTimer.current);
      if (tickTimer.current) clearInterval(tickTimer.current);
      renderTimer.current = null;
      tickTimer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, run?.id, nodeType]);

  const burstCenter = useCallback((kind: Burst["kind"]) => {
    if (fxReduced) return; // 减少动效:跳过粒子
    setBurst({ x: window.innerWidth / 2, y: window.innerHeight * 0.45, kind });
  }, [fxReduced]);

  // 进入页面检测是否有进行中的冒险
  useEffect(() => {
    api.get<{ run: Run | null }>("/roguelike/active").then((d) => setHasActive(!!d.run)).catch(() => {});
  }, []);

  // Phase B:Boss 节点出现时触发横幅 + 低鸣音
  useEffect(() => {
    if (nodeType === "boss") {
      playSfx("boss_appear");
      setBossAppearKey(Date.now());
    }
  }, [nodeType]);

  // Phase B:进入结算页触发胜利/死亡幕布与音效
  useEffect(() => {
    if (phase !== "result" || !run) return;
    if (run.status === "WON") {
      setVictoryOn(true);
      playSfx("victory");
    } else if (run.status === "DEAD") {
      setDeathOn(true);
    }
  }, [phase, run]);

  // Phase B:banner 自动消失(2.6s 后清零 key,避免残留)
  useEffect(() => {
    if (!bossAppearKey && !bossDefeatKey && !rewardClaimKey) return;
    const t = setTimeout(() => {
      setBossAppearKey(0);
      setBossDefeatKey(0);
      setRewardClaimKey(0);
    }, 2600);
    return () => clearTimeout(t);
  }, [bossAppearKey, bossDefeatKey, rewardClaimKey]);

  function applyCombat(res: any) {
    if (res.equipped !== undefined) setEquipped(res.equipped || {});
    if (res.skills !== undefined) setSkills(res.skills || []);
    if (res.pendingSkills !== undefined) setPendingSkills(res.pendingSkills || null);
    if (res.mana !== undefined) setMana(res.mana);
    if (res.maxMana !== undefined) setMaxMana(res.maxMana);
    if (res.level !== undefined) setLevel(res.level);
    if (res.autoCorrect !== undefined) setAutoArmed(!!res.autoCorrect);
  }
  // 应用后端战斗视图：同步敌人/计时窗口，并重置本地倒计时
  function applyCombatView(res: any) {
    if (res.combat) {
      combatRef.current = res.combat;
      setCombat(res.combat);
      if (typeof res.combat.qRemainMs === "number") setRemainMs(res.combat.qRemainMs);
    } else {
      combatRef.current = null;
      setCombat(null);
    }
  }
  // 敌人飘字（命中/格挡/受伤）
  function pushEnemyFloat(eid: string, text: string, kind: "dmg" | "block" | "hit") {
    if (fxReduced && kind !== "dmg") return;
    const key = Date.now() + Math.random();
    setEnemyFloats((prev) => {
      const arr = prev[eid] ? [...prev[eid], { key, text, kind }] : [{ key, text, kind }];
      return { ...prev, [eid]: arr.slice(-3) };
    });
    setTimeout(() => {
      setEnemyFloats((prev) => {
        const arr = (prev[eid] || []).filter((f) => f.key !== key);
        const np = { ...prev };
        if (arr.length) np[eid] = arr; else delete np[eid];
        return np;
      });
    }, 950);
  }
  // 本地推算敌人蓄力进度(0-1)：根据剩余时间反推当前累计节拍
  function windupOf(e: EnemyView, c: CombatView | null, remain: number): number {
    if (!c || c.beatMs <= 0) return 0;
    const elapsedReal = Math.max(0, c.qLimitMs - remain);
    const curTotal = c.qStartBeat + elapsedReal / c.beatMs;
    const w = 1 - (e.nextAtkBeat - curTotal) / e.interval;
    return Math.max(0, Math.min(1, w));
  }
  function applyNode(res: {
    nodeType?: "normal" | "boss" | "reward" | null;
    question?: Q | null;
    run?: Run;
    hp?: number; layer?: number; score?: number; coins?: number; combo?: number; maxCombo?: number;
    status?: string; drops?: any[] | null; inventory?: any[];
  }) {
    setNodeType(res.nodeType ?? null);
    setQuestion(res.question ?? null);
    questionIdRef.current = res.question?.id ?? null;
    if (res.inventory !== undefined) setInventory(res.inventory || []);
    if (res.run) setRun(res.run);
    if (res.hp !== undefined) {
      setRun((r) => (r ? { ...r, hp: res.hp!, layer: res.layer!, score: res.score!, coins: res.coins!, combo: res.combo!, maxCombo: res.maxCombo!, status: res.status! } : r));
    }
    applyCombat(res);
    applyCombatView(res);
    if (res.drops && res.drops.length) setToast(`🎁 击败怪物,掉落:${res.drops.map((d: any) => `${d.icon}${d.name}`).join("、")}`);
  }

  async function start() {
    setError("");
    setLoading(true);
    playSfx("click");
    try {
      const d = await api.post<StartResp>("/roguelike/start", { subject, difficulty, test: testMode });
      setRun(d.run!);
      applyNode(d);
      setPhase("playing");
    } catch (e) {
      setError(e instanceof Error ? e.message : "开始失败");
    } finally {
      setLoading(false);
    }
  }

  async function submit(sel?: string) {
    const val = sel ?? selected;
    if (!run || !question || !val) return;
    setSelected(val);
    setLoading(true);
    loadingRef.current = true;
    setToast(null);
    try {
      const d = await api.post<AnsResp>(`/roguelike/${run.id}/answer`, { questionId: question.id, selected: val });
      setFeedback({ correct: d.correct, shieldUsed: d.shieldUsed, damage: d.damage, heal: d.heal });
      feedbackRef.current = true;
      // 应用最新战斗视图(新一波敌人 / 新计时窗口)
      applyCombatView(d);
      // 浮动战斗数字(减少动效时跳过)
      if (!fxReduced) {
        if (d.correct && d.heal) setCombatNum({ key: Date.now(), text: `+${d.heal}`, kind: "heal" });
        else if (!d.correct && !d.shieldUsed && d.damage) setCombatNum({ key: Date.now(), text: `-${d.damage}`, kind: "dmg" });
      }
      // 敌人飘字 + 受击/前扑动画
      if (d.correct && d.attack) {
        pushEnemyFloat(d.attack.eid, `${d.attack.dmg}`, "hit");
        setHitFlashIds((prev) => ({ ...prev, [d.attack!.eid]: true }));
        setTimeout(() => setHitFlashIds((prev) => ({ ...prev, [d.attack!.eid]: false })), 220);
      } else if (!d.correct && d.counter) {
        const fe = combatRef.current?.enemies.find((e) => e.hp > 0)?.eid;
        if (fe) {
          pushEnemyFloat(fe, d.shieldUsed ? "格挡" : `${d.counter.dmg}`, d.shieldUsed ? "block" : "dmg");
          setAttackingIds((prev) => ({ ...prev, [fe]: true }));
          setTimeout(() => setAttackingIds((prev) => ({ ...prev, [fe]: false })), 450);
        }
      }
      if (d.reward) setToast(`🎁 ${d.reward}`);
      // ---- Phase A 特效 ----
      if (d.correct) {
        playSfx("correct");
        burstCenter("gold");
        if ((d.combo ?? 0) >= 3) {
          playSfx("combo", d.combo ?? 0);
          setComboPop(Date.now());
        }
        if (nodeType === "boss") {
          playSfx("boss");
          burstCenter("confetti");
          setBossDefeatKey(Date.now());
        }
      } else {
        if (d.shieldUsed) playSfx("shield");
        else playSfx("wrong");
        if (!fxReduced) { setShake(Date.now()); }
        burstCenter("red");
      }
      if (d.runOver && d.status === "DEAD") playSfx("death");
      setRun((r) =>
        r ? { ...r, hp: d.hp ?? r.hp, layer: d.layer ?? r.layer, combo: d.combo ?? r.combo, maxCombo: d.maxCombo ?? r.maxCombo, score: d.score ?? r.score, coins: d.coins ?? r.coins, status: d.status ?? r.status } : r
      );
      applyCombat(d);
      setHintExclude([]);
      if (d.runOver) {
        setTimeout(() => setPhase("result"), 1200);
      } else {
        setTimeout(() => {
          setFeedback(null);
          feedbackRef.current = false;
          setCombatNum(null);
          setSelected("");
          applyNode({ nodeType: d.nodeType, question: d.nextQuestion });
        }, 900);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交失败");
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }

  async function claim() {
    if (!run) return;
    setLoading(true);
    setToast(null);
    try {
      const d = await api.post<NodeResp>(`/roguelike/${run.id}/claim`);
      setToast(d.reward || "奖励已领取");
      playSfx("reward");
      burstCenter("coins");
      setRewardClaimKey(Date.now());
      setRun((r) => (r ? { ...r, hp: d.hp!, layer: d.layer!, score: d.score!, coins: d.coins!, status: d.status! } : r));
      applyCombat(d);
      if (d.runOver) {
        setTimeout(() => setPhase("result"), 1200);
      } else {
        applyNode({ nodeType: d.nodeType, question: d.nextQuestion });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "领取失败");
    } finally {
      setLoading(false);
    }
  }

  // 使用消耗品(物品):传 entry 对象
  async function useItem(entry: any) {
    if (!run || !question) return;
    if (entry.type === "utility" && hintExclude.length) return; // 已提示过
    setLoading(true);
    setError("");
    try {
      const d = await api.post<NodeResp>(`/roguelike/${run.id}/use-item`, { uid: entry.uid, questionId: question.id });
      setInventory(d.inventory || []);
      if (d.message) setToast(d.message);
      playSfx("pick");
      if (d.hintExclude) setHintExclude(d.hintExclude);
      if (entry.type === "heal") setRun((r) => (r ? { ...r, hp: d.hp! } : r));
      applyCombat(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "使用失败");
    } finally {
      setLoading(false);
    }
  }

  // 穿戴装备
  async function equipItem(entry: any) {
    if (!run) return;
    setLoading(true);
    setError("");
    try {
      const d = await api.post<NodeResp>(`/roguelike/${run.id}/equip`, { uid: entry.uid });
      setInventory(d.inventory || []);
      setRun((r) => (r ? { ...r, hp: d.hp ?? r.hp, maxHp: d.maxHp ?? r.maxHp } : r));
      if (d.message) setToast(d.message);
      playSfx("click");
      applyCombat(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "穿戴失败");
    } finally {
      setLoading(false);
    }
  }

  // 使用技能(耗蓝)
  async function useSkill(skillId: string) {
    if (!run || !question) return;
    setLoading(true);
    setError("");
    try {
      const d = await api.post<NodeResp>(`/roguelike/${run.id}/use-skill`, { skillId, questionId: question.id });
      setInventory(d.inventory || []);
      if (d.message) setToast(d.message);
      if (d.hintExclude) setHintExclude(d.hintExclude);
      setRun((r) => (r ? { ...r, hp: d.hp ?? r.hp } : r));
      playSfx("boss");
      burstCenter("gold");
      applyCombat(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "技能失败");
    } finally {
      setLoading(false);
    }
  }

  // 升级三选一
  async function chooseSkill(skillId: string) {
    if (!run) return;
    setLoading(true);
    try {
      const d = await api.post<NodeResp>(`/roguelike/${run.id}/choose-skill`, { skillId });
      applyCombat(d);
      if (d.message) setToast(d.message);
      playSfx("reward");
    } catch (e) {
      setError(e instanceof Error ? e.message : "选择失败");
    } finally {
      setLoading(false);
    }
  }

  function quit() {
    if (!run) return;
    if (!window.confirm("结束本次冒险并结算?")) return;
    api.post(`/roguelike/${run.id}/quit`).then(() => setPhase("result")).catch((e) => setError(e.message));
  }

  function resetToSetup() {
    setPhase("setup");
    setRun(null);
    setQuestion(null);
    setFeedback(null);
    setSelected("");
    setCombatNum(null);
    setToast(null);
    setHintExclude([]);
    setInventory([]);
    setNodeType(null);
    setError("");
    setCombat(null);
    combatRef.current = null;
    setRemainMs(0);
    setEnemyFloats({});
    setAttackingIds({});
    setHitFlashIds({});
    setTimeoutFlash(false);
    setBossAppearKey(0);
    setBossDefeatKey(0);
    setRewardClaimKey(0);
    setVictoryOn(false);
    setDeathOn(false);
  }

  async function abandonActiveRun() {
    try {
      setLoading(true);
      const d = await api.get<{ run: Run | null }>("/roguelike/active");
      if (d.run?.id) {
        await api.post(`/roguelike/${d.run.id}/quit`);
      }
      setHasActive(false);
      setError("");
    } catch (e: any) {
      setError(e?.message || "放弃失败");
    } finally {
      setLoading(false);
    }
  }

  const maxHp = run ? run.maxHp : 5;

  return (
    <div className="space-y-4">
      <Particles burst={burst} onDone={() => setBurst(null)} />
      {/* Phase B 全屏横幅(Boss 出现 / 击败 / 奖励领取);减少动效时不渲染 */}
      {phase === "playing" && !fxReduced && bossAppearKey > 0 && run && (
        <div key={"ba-" + bossAppearKey} className="banner banner-boss">⚔ {bossName(run.layer)} 出现了!</div>
      )}
      {phase === "playing" && !fxReduced && bossDefeatKey > 0 && (
        <div key={"bd-" + bossDefeatKey} className="banner banner-defeat">🏆 {run ? bossName(run.layer) : "BOSS"} 击破!</div>
      )}
      {phase === "playing" && !fxReduced && rewardClaimKey > 0 && (
        <div key={"rc-" + rewardClaimKey} className="banner banner-claim">🎁 奖励已领取!</div>
      )}
      {phase === "setup" && (
        <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-bold">冒险模式</h1>
          <p className="mt-1 text-sm text-slate-500">连续答对推进层数,答错随机扣血、答对随机回血;每 5 层有 Boss,每 3 层有奖励!</p>
            {hasActive && (
              <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
                <p>你有进行中的冒险,点「开始冒险」将继续上次进度</p>
                <button onClick={abandonActiveRun} disabled={loading}
                  className="mt-2 text-xs font-medium text-amber-800 underline decoration-amber-400 underline-offset-2 hover:text-amber-900 disabled:opacity-50">
                  放弃当前冒险
                </button>
              </div>
            )}
          <div className="mt-6 space-y-4">
            <div>
              <label className="mb-1 block text-sm text-slate-600">学科</label>
              <select value={subject} onChange={(e) => setSubject(e.target.value)} className="ui-select h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-sm outline-none focus:border-indigo-500">
                {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-600">难度</label>
              <div className="flex flex-wrap gap-2">
                {DIFFS.map((d) => (
                  <button key={d} onClick={() => setDifficulty(d)}
                    className={`rounded-lg px-3 py-1.5 text-sm transition ${difficulty === d ? "bg-indigo-600 text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
                    {DIFF_LABEL[d]}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
              <p>❤ 生命 {maxHp} · 答错随机扣血(护盾可抵挡) · 答对随机回血 · 🛡 护盾/🧪 药水/⏭ 跳过/💡 提示</p>
              <p>🔥 连对递增得分;3/5/10 连对触发奖励</p>
              <p>⚔ 每 5 层 Boss(抽你的错题) · 🎁 每 3 层奖励节点 · 🏁 第 {MAX_LAYER} 层通关</p>
            </div>
            {/* Phase C:体验设置 */}
            <div className="flex flex-wrap gap-2 text-xs">
              <button onClick={toggleFx}
                className={`rounded-lg px-3 py-1.5 font-medium transition ${fxReduced ? "border border-slate-300 text-slate-500" : "bg-indigo-600 text-white"}`}>
                ✨ 粒子特效:{fxReduced ? "关" : "开"}
              </button>
              <button onClick={toggleSfx}
                className={`rounded-lg px-3 py-1.5 font-medium transition ${sfxMuted ? "border border-slate-300 text-slate-500" : "bg-indigo-600 text-white"}`}>
                🔊 音效:{sfxMuted ? "关" : "开"}
              </button>
              <button onClick={() => setTestMode((v) => !v)}
                className={`rounded-lg px-3 py-1.5 font-medium transition ${testMode ? "bg-emerald-600 text-white" : "border border-slate-300 text-slate-500"}`}>
                🧪 测试模式:{testMode ? "开" : "关"}
              </button>
              <span className="self-center text-slate-400">开粒子特效时手机端会自动降低粒子数保持流畅</span>
            </div>
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
            <button onClick={start} disabled={loading} className="h-10 w-full rounded-lg bg-indigo-600 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
              {loading ? "生成中..." : hasActive ? "继续冒险" : "开始冒险"}
            </button>
          </div>
        </div>
      )}

      {phase === "playing" && run && (
        <div className={`roguelike-bg battle-layout ${fxReduced ? "fx-reduced" : ""}`}>
          {/* ===== 左列：题干（战斗画面左侧） ===== */}
          <div className="battle-left">
            {question && nodeType !== "reward" && (
              <div className={`battle-panel pop-in ${nodeType === "boss" ? "is-boss" : ""}`}>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  {nodeType === "boss" && <span className="rounded bg-red-600 px-2 py-0.5 font-medium text-white">BOSS · 薄弱点</span>}
                  <span className="rounded bg-slate-100 px-2 py-0.5">{question.topic || "待归类"}</span>
                  <span>难度 {DIFF_LABEL[question.difficulty] ?? question.difficulty}</span>
                </div>
                <div className="mt-3 text-[15px] leading-relaxed text-slate-800">{renderRich(question.stem)}</div>
                {feedback && (
                  <div className={`pop-in mt-4 flex items-center rounded-xl px-4 py-2.5 text-sm ${feedback.correct ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                    <span>{feedback.correct ? `✓ 回答正确!回复 ${feedback.heal ?? 0} 点生命` : feedback.shieldUsed ? "✗ 回答错误(护盾抵挡,生命不减)" : `✗ 回答错误,受到 ${feedback.damage ?? 0} 点伤害`}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ===== 中列：战斗画面（舞台 + HUD） ===== */}
          <div className="battle-center">
          {toast && <div className="rogue-toast">{toast}</div>}
          {error && <p className="rogue-error">{error}</p>}
          {/* ===== 顶部舞台:环境背景 + 第一视角敌人 ===== */}
          {(() => {
            const zone = zoneOf(run.layer);
            const wpn = weaponImg(equipped);
            const alive = combat ? combat.enemies.filter((e) => e.hp > 0) : [];
            const ratio = combat && combat.qLimitMs > 0 ? 1 - remainMs / combat.qLimitMs : 1; // 已用时间比例
            const tier = speedTierOf(ratio);
            const secLeft = Math.max(0, Math.ceil(remainMs / 1000));
            return (
          <div key={shake} className={`rogue-stage ${zone.cls} ${shake ? "shake" : ""} ${nodeType === "boss" ? "stage-boss" : ""} ${run.hp <= 2 ? "stage-danger" : ""}`}>
            {/* 环境装饰素材 */}
            {zone.deco.map((src, i) => (
              <img key={i} src={src} className={`stage-deco stage-deco-${i === 0 ? "left" : "right"}`} alt="" />
            ))}
            {/* 顶部浮层:层数 / 学科 / 连对 / 得分 / 金币 / 结算 */}
            <div className="stage-top">
              <span className={`stage-badge ${nodeType === "boss" ? "is-boss" : ""}`}>
                {nodeType === "boss" ? `⚔ BOSS · 第 ${run.layer} 层` : `第 ${run.layer} 层`}
              </span>
              <span className="stage-subject">{run.subject}</span>
              {testMode && <span className="stage-badge" style={{ background: "#059669" }}>🧪 测试</span>}
              <span key={comboPop} className={`stage-stat ${run.combo >= 3 ? "combo-pop" : ""}`}>
                {run.combo >= 3 ? <span className="combo-fire mr-0.5">🔥</span> : "🔥 "}
                <b className={run.combo >= 3 ? "text-amber-300" : "text-slate-100"}>{run.combo}</b>
              </span>
              <span className="stage-stat">⭐ {run.score}</span>
              <span className="stage-stat">🪙 {run.coins}</span>
              <button onClick={quit} className="stage-quit">结算</button>
            </div>

            {/* 答题倒计时条(即时制核心):已用时间比例推进,绿/橙/红三档对应完美/迅捷/普通出手 */}
            {combat && nodeType !== "reward" && (
              <div className="combat-timer">
                <div className="timer-track">
                  <div className="timer-marker" style={{ left: `${Math.min(100, ratio * 100)}%` }} />
                </div>
                <div className="timer-info">
                  <span className="timer-sec">⏱ {secLeft}s</span>
                  <span className="timer-tier" style={{ color: tier.color }}>{tier.text}</span>
                  {feedback && <span className="timer-note">{feedback.correct ? "✓ 命中" : "✗ 落空"}</span>}
                </div>
              </div>
            )}

            {/* 敌人 / 奖励 显示区(第一视角,支持多敌人同屏) */}
            <div className="stage-center">
              {nodeType === "reward" ? (
                <div className="reward-stage">
                  {!fxReduced && <div className="coin-rain" />}
                  <div className="gift-bounce text-6xl">🎁</div>
                  <p className="reward-slide mt-2 text-base font-bold text-amber-200">奖励节点</p>
                </div>
              ) : (
                <div className={`enemy-row ${alive.length === 1 ? "solo" : ""}`}>
                  {alive.map((e) => {
                    const w = windupOf(e, combat, remainMs);
                    const floats = enemyFloats[e.eid] || [];
                    return (
                      <div key={e.eid} className={`enemy-card ${e.kind === "boss" ? "is-boss" : ""}`}>
                        <div className="enemy-sprite-wrap">
                          <img
                            src={enemySpriteFor(e)}
                            className={`enemy-sprite ${e.kind === "boss" ? "enemy-sprite-boss" : "enemy-sprite-normal"} ${attackingIds[e.eid] ? "enemy-attack" : ""} ${hitFlashIds[e.eid] ? "enemy-hit" : ""}`}
                            alt={e.name}
                          />
                          {/* 攻击蓄力预警环(本地推算平滑) */}
                          <svg className={`windup-ring ${w >= 0.85 ? "danger" : ""}`} viewBox="0 0 36 36" aria-hidden>
                            <circle className="wr-bg" cx="18" cy="18" r="15.5" />
                            <circle
                              className="wr-fg"
                              cx="18" cy="18" r="15.5"
                              style={{ strokeDasharray: 2 * Math.PI * 15.5, strokeDashoffset: 2 * Math.PI * 15.5 * (1 - w) }}
                            />
                          </svg>
                          {/* 敌人飘字(命中/格挡/受伤) */}
                          {floats.map((f) => (
                            <span key={f.key} className={`enemy-float ${f.kind}`}>{f.text}</span>
                          ))}
                        </div>
                        <div className="enemy-meta">
                          {e.kind !== "boss" && <div className="enemy-name">{e.name}</div>}
                          <div className="enemy-hp">
                            <div className="enemy-hp-fill" style={{ width: `${Math.max(0, Math.min(100, (e.hp / e.maxHp) * 100))}%` }} />
                            <span className="enemy-hp-num">{e.hp}/{e.maxHp}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 超时红屏闪烁 */}
            {timeoutFlash && !fxReduced && <div className="timeout-flash" aria-hidden />}

            {/* 玩家第一视角手持武器 */}
            {nodeType !== "reward" && (
              <img src={wpn} className="stage-weapon" alt="武器" />
            )}

            {/* Boss 名称牌 */}
            {nodeType === "boss" && (
              <div className="stage-nameplate">👹 {bossName(run.layer)}</div>
            )}
          </div>
            );
          })()}

          {/* ===== 中下部 HUD:蓝条 / 生命 / 装备 / 物品 / 技能 ===== */}
          <div className="rogue-hud">
            {/* 蓝条 + 等级 */}
            <div className="hud-mana-row">
              <span className="hud-level">Lv.{level}</span>
              <div className="hud-mana">
                <div className="hud-mana-fill" style={{ width: `${maxMana ? (mana / maxMana) * 100 : 0}%` }} />
                <span className="hud-mana-num">🔵 {mana}/{maxMana}</span>
              </div>
            </div>
            {/* 生命 */}
            <div className={`hud-hp ${run.hp / maxHp <= 0.25 ? "low-hp" : ""}`}>
              <span className="hud-hp-label">❤ 生命</span>
              <div className="hud-hp-bar">
                <div className="hud-hp-fill" style={{ width: `${Math.max(0, Math.min(100, (run.hp / maxHp) * 100))}%` }} />
              </div>
              <span className="hud-hp-num">{run.hp}/{maxHp}</span>
              {combatNum && (
                <span key={combatNum.key} className={`combat-float ${combatNum.kind}`}>{combatNum.text}</span>
              )}
            </div>
            {/* 身上穿戴 */}
            <div className="hud-equipped">
              {["weapon", "armor", "trinket"].map((slot) => (
                <div key={slot} className={`equip-slot equip-${slot} ${equipped[slot] ? "filled" : ""}`} title={equipped[slot]?.desc || "空"}>
                  <span className="equip-icon">{equipped[slot]?.icon || (slot === "weapon" ? "🗡" : slot === "armor" ? "🛡" : "🔮")}</span>
                  {equipped[slot] && <span className="equip-name">{equipped[slot].name}</span>}
                </div>
              ))}
            </div>
            {/* 物品(可点击使用) */}
            {inventory.filter((e: any) => e.kind === "item").length > 0 && (
              <div className="hud-items">
                <span className="hud-section-label">物品</span>
                {inventory.filter((e: any) => e.kind === "item").map((it: any) => (
                  <button key={it.uid} onClick={() => useItem(it)} disabled={loading} className={`hud-item item-${it.type}`} title={it.desc}>
                    {it.icon} {it.name}
                  </button>
                ))}
              </div>
            )}
            {/* 装备(可点击穿戴) */}
            {inventory.filter((e: any) => e.kind === "gear").length > 0 && (
              <div className="hud-items">
                <span className="hud-section-label">装备(点击穿戴)</span>
                {inventory.filter((e: any) => e.kind === "gear").map((it: any) => (
                  <button key={it.uid} onClick={() => equipItem(it)} disabled={loading} className="hud-item gear-item" title={it.desc}>
                    {it.icon} {it.name}
                  </button>
                ))}
              </div>
            )}
            {/* 技能(可点击使用) */}
            {skills.length > 0 && (
              <div className="hud-items">
                <span className="hud-section-label">技能</span>
                {skills.map((sid) => {
                  const m = SKILL_META[sid];
                  const can = mana >= (m?.cost || 0);
                  return (
                    <button key={sid} onClick={() => useSkill(sid)} disabled={loading || !can} className={`hud-item skill-item ${can ? "" : "no-mana"}`} title={`${m?.desc} · 耗蓝 ${m?.cost}`}>
                      {m?.icon} {m?.name} <span className="skill-cost">🔵{m?.cost}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <p className="hud-hint">答错随机扣血(护盾可抵挡) · 答对随机回血 · 答对回蓝 · 每 5 层 Boss · 每 3 层奖励 · 消灭怪物掉装备/物品</p>
          </div>

          {/* 奖励节点面板（中列内） */}
          {nodeType === "reward" && (
            <div className="battle-panel text-center">
              <p className="text-sm text-slate-500">休息一下,领取金币奖励!</p>
              <button onClick={claim} disabled={loading} className="rogue-claim-btn">
                {loading ? "处理中..." : "领取奖励"}
              </button>
            </div>
          )}
          {/* 无题面板（中列内） */}
          {!question && nodeType !== "reward" && (
            <div className="battle-panel text-center">
              <p className="text-sm text-slate-500">该学科/难度暂无可用题目,请更换学科或结算后重试。</p>
              <div className="mt-4 flex gap-3">
                <button onClick={resetToSetup} className="rogue-btn-secondary">返回设置</button>
                {run && (
                  <button onClick={() => { quit(); }} className="rogue-submit-btn">结算本次冒险</button>
                )}
              </div>
            </div>
          )}
          </div>{/* /battle-center */}

          {/* ===== 右列：选项（点击即提交，战斗画面右侧） ===== */}
          <div className="battle-right">
            {question && nodeType !== "reward" && (
              <div className={`battle-panel pop-in ${nodeType === "boss" ? "is-boss" : ""}`}>
                <p className="q-hint mb-2 text-xs text-slate-400">点击选项即作答{autoArmed ? "(本次必中 ✨)" : ""}</p>
                <div className="space-y-2">
                  {(question.options || []).map((opt, i) => {
                    const excluded = hintExclude.includes(i);
                    const isSel = selected === String(opt);
                    return (
                      <button key={i}
                        onClick={() => submit(String(opt))}
                        disabled={loading || excluded || !!feedback}
                        className={`flex w-full items-start gap-2 rounded-xl border px-4 py-2.5 text-left text-sm transition ${
                          excluded ? "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300 line-through"
                            : isSel ? "border-indigo-500 bg-indigo-50 text-slate-800"
                            : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                        }`}>
                        <span className="mt-0.5 shrink-0 font-bold text-slate-400">{String.fromCharCode(65 + i)}.</span>
                        <span className="leading-relaxed">{renderRich(String(opt))}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          {/* 升级三选一弹窗 */}
          {pendingSkills && pendingSkills.length > 0 && (
            <div className="skill-modal-mask">
              <div className="skill-modal">
                <h3 className="skill-modal-title">🎉 升级!选择一项技能</h3>
                <div className="skill-choices">
                  {pendingSkills.map((s: any) => (
                    <button key={s.id} onClick={() => chooseSkill(s.id)} className="skill-choice" disabled={loading}>
                      <span className="sc-icon">{s.icon}</span>
                      <span className="sc-name">{s.name}</span>
                      <span className="sc-tier">T{s.tier} · {s.type}</span>
                      <span className="sc-desc">{s.desc}</span>
                      <span className="sc-cost">🔵 {s.cost}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {phase === "result" && run && (
        <>
          {victoryOn && !fxReduced && <div className="victory-curtain" aria-hidden />}
          {deathOn && !fxReduced && <div className="death-curtain" aria-hidden />}
          {victoryOn && !fxReduced && <div key={"vic-" + phase} className="banner banner-victory">🏆 通关!</div>}
        <div className={`roguelike-bg mx-auto max-w-lg rounded-2xl border border-white/10 bg-white/95 p-8 text-center shadow-lg ${fxReduced ? "fx-reduced" : ""}`}>
          <div className="text-5xl">{run.status === "WON" ? "🏆" : "💀"}</div>
          <h1 className="mt-3 text-xl font-bold">{run.status === "WON" ? "通关!" : "冒险结束"}</h1>
          <p className="mt-1 text-sm text-slate-500">{run.status === "WON" ? "你完成了整场冒险,太强了!" : "生命耗尽,下次再来!"}</p>
          <div className="mt-6 grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-2xl font-bold text-slate-800">{run.layer}</p>
              <p className="mt-0.5 text-xs text-slate-500">到达层数</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-2xl font-bold text-amber-600">×{run.maxCombo}</p>
              <p className="mt-0.5 text-xs text-slate-500">最大连击</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-2xl font-bold text-indigo-600">{run.score}</p>
              <p className="mt-0.5 text-xs text-slate-500">总得分</p>
            </div>
          </div>
          <div className="mt-6 flex gap-3">
            <button onClick={() => router.push("/app")} className="h-10 flex-1 rounded-lg border border-slate-300 text-sm font-medium text-slate-600 hover:bg-slate-50">返回</button>
            <button onClick={resetToSetup} className="h-10 flex-1 rounded-lg bg-indigo-600 text-sm font-medium text-white hover:bg-indigo-700">再来一次</button>
          </div>
        </div>
        </>
      )}
    </div>
  );
}
