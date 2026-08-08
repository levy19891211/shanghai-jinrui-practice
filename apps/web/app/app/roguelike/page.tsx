"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { renderRich } from "@/lib/rich";
import { playSfx } from "@/lib/sfx";
import Particles, { type Burst } from "./Particles";

interface Run {
  id: string; subject: string; difficulty: number; layer: number; hp: number; maxHp: number;
  combo: number; maxCombo: number; score: number; coins: number; status: string;
}
interface Q { id: string; topic?: string; type: string; stem: string; options: string[]; difficulty: number }
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
  inventory?: string[];
  message?: string;
}
interface StartResp extends NodeResp {}
interface AnsResp extends NodeResp { correct: boolean; nextQuestion: Q | null }
interface RunDetail { run: Run; nodeType: string | null; question: Q | null; inventory?: string[] }

const SUBJECTS = ["数学", "物理", "化学", "生物", "TMUA"];
const DIFFS = [1, 2, 3, 4, 5];
const DIFF_LABEL: Record<number, string> = { 1: "入门", 2: "基础", 3: "中等", 4: "较难", 5: "困难" };
const MAX_LAYER = 20;
const ITEM_LABEL: Record<string, string> = { shield: "🛡 护盾", heal: "🧪 药水", skip: "⏭ 跳过", hint: "💡 提示" };
const NODE_LABEL: Record<string, string> = { normal: "普通", boss: "BOSS", reward: "奖励" };

export default function RoguelikePage() {
  const router = useRouter();
  const [phase, setPhase] = useState<"setup" | "playing" | "result">("setup");
  const [subject, setSubject] = useState("数学");
  const [difficulty, setDifficulty] = useState(3);
  const [run, setRun] = useState<Run | null>(null);
  const [nodeType, setNodeType] = useState<"normal" | "boss" | "reward" | null>(null);
  const [question, setQuestion] = useState<Q | null>(null);
  const [selected, setSelected] = useState("");
  const [feedback, setFeedback] = useState<null | { correct: boolean; shieldUsed?: boolean }>(null);
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

  const burstCenter = useCallback((kind: Burst["kind"]) => {
    setBurst({ x: window.innerWidth / 2, y: window.innerHeight * 0.45, kind });
  }, []);

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

  function applyNode(res: {
    nodeType?: "normal" | "boss" | "reward" | null;
    question?: Q | null;
    run?: Run;
    hp?: number; layer?: number; score?: number; coins?: number; combo?: number; maxCombo?: number;
    status?: string; drops?: string[] | null;
  }) {
    setNodeType(res.nodeType ?? null);
    setQuestion(res.question ?? null);
    if (res.run) {
      setRun(res.run);
      setInventory((res.run as unknown as { inventory?: string[] }).inventory || []);
    }
    if (res.hp !== undefined && run) {
      setRun((r) => (r ? { ...r, hp: res.hp!, layer: res.layer!, score: res.score!, coins: res.coins!, combo: res.combo!, maxCombo: res.maxCombo!, status: res.status! } : r));
    }
    if (res.drops) setToast(`🎁 掉落道具:${res.drops.join("、")}`);
  }

  async function start() {
    setError("");
    setLoading(true);
    playSfx("click");
    try {
      const d = await api.post<StartResp>("/roguelike/start", { subject, difficulty });
      setRun(d.run!);
      applyNode(d);
      setPhase("playing");
    } catch (e) {
      setError(e instanceof Error ? e.message : "开始失败");
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    if (!run || !question || !selected) return;
    setLoading(true);
    setToast(null);
    try {
      const d = await api.post<AnsResp>(`/roguelike/${run.id}/answer`, { questionId: question.id, selected });
      setFeedback({ correct: d.correct, shieldUsed: d.shieldUsed });
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
        setShake(Date.now());
        burstCenter("red");
      }
      if (d.runOver && d.status === "DEAD") playSfx("death");
      setRun((r) =>
        r ? { ...r, hp: d.hp ?? r.hp, layer: d.layer ?? r.layer, combo: d.combo ?? r.combo, maxCombo: d.maxCombo ?? r.maxCombo, score: d.score ?? r.score, coins: d.coins ?? r.coins, status: d.status ?? r.status } : r
      );
      setHintExclude([]);
      if (d.runOver) {
        setTimeout(() => setPhase("result"), 1200);
      } else {
        setTimeout(() => {
          setFeedback(null);
          setSelected("");
          applyNode({ nodeType: d.nodeType, question: d.nextQuestion });
        }, 900);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交失败");
    } finally {
      setLoading(false);
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

  async function useItem(item: string) {
    if (!run || !question) return;
    if (item === "hint" && hintExclude.length) return; // 已提示过
    setLoading(true);
    setError("");
    try {
      const d = await api.post<NodeResp>(`/roguelike/${run.id}/use-item`, { item, questionId: question.id });
      setInventory(d.inventory || inventory.filter((x) => x !== item));
      if (d.message) setToast(d.message);
      playSfx(item === "hint" ? "click" : "pick");
      if (d.hintExclude) setHintExclude(d.hintExclude);
      if (item === "heal") setRun((r) => (r ? { ...r, hp: d.hp! } : r));
      if (item === "skip") {
        setHintExclude([]);
        setFeedback(null);
        setSelected("");
        if (d.runOver) {
          setRun((r) => (r ? { ...r, hp: d.hp!, layer: d.layer!, combo: d.combo!, score: d.score!, status: d.status! } : r));
          setTimeout(() => setPhase("result"), 1200);
        } else {
          applyNode({ nodeType: d.nodeType, question: d.nextQuestion });
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "使用失败");
    } finally {
      setLoading(false);
    }
  }

  function quit() {
    if (!run) return;
    if (!window.confirm("结束本次冒险并结算?")) return;
    api.post(`/roguelike/${run.id}/quit`).then(() => setPhase("result")).catch((e) => setError(e.message));
  }

  const maxHp = run ? run.maxHp : 5;

  return (
    <div className="space-y-4">
      <Particles burst={burst} onDone={() => setBurst(null)} />
      {/* Phase B 全屏横幅(Boss 出现 / 击败 / 奖励领取) */}
      {phase === "playing" && bossAppearKey > 0 && (
        <div key={"ba-" + bossAppearKey} className="banner banner-boss">⚔ BOSS 出现了!</div>
      )}
      {phase === "playing" && bossDefeatKey > 0 && (
        <div key={"bd-" + bossDefeatKey} className="banner banner-defeat">🏆 BOSS 击破!</div>
      )}
      {phase === "playing" && rewardClaimKey > 0 && (
        <div key={"rc-" + rewardClaimKey} className="banner banner-claim">🎁 奖励已领取!</div>
      )}
      {phase === "setup" && (
        <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-bold">冒险模式</h1>
          <p className="mt-1 text-sm text-slate-500">连续答对推进层数,答错扣生命;每 5 层有 Boss,每 3 层有奖励!</p>
          {hasActive && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">你有进行中的冒险,点「开始冒险」将继续上次进度</p>
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
              <p>❤ 生命 {maxHp} · 答错 -1(护盾可抵挡) · 🛡 护盾/🧪 药水/⏭ 跳过/💡 提示</p>
              <p>🔥 连对递增得分;3/5/10 连对触发奖励</p>
              <p>⚔ 每 5 层 Boss(抽你的错题) · 🎁 每 3 层奖励节点 · 🏁 第 {MAX_LAYER} 层通关</p>
            </div>
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
            <button onClick={start} disabled={loading} className="h-10 w-full rounded-lg bg-indigo-600 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
              {loading ? "生成中..." : hasActive ? "继续冒险" : "开始冒险"}
            </button>
          </div>
        </div>
      )}

      {phase === "playing" && run && (
        <div key={shake} className="roguelike-bg mx-auto max-w-2xl space-y-4 rounded-2xl p-4">
          {/* 状态栏 */}
          <div className="rounded-2xl border border-white/10 bg-white/95 p-4 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {nodeType === "boss" && (
                <img src="/images/rogue/boss.png" className="portrait portrait-boss h-16 w-16 shrink-0" alt="Boss" />
              )}
              {nodeType === "normal" && (
                <img src="/images/rogue/enemy.png" className="portrait portrait-enemy h-12 w-12 shrink-0" alt="敌人" />
              )}
              <div className="flex items-center gap-2">
                <span className={`rounded-lg px-2.5 py-1 text-sm font-bold ${nodeType === "boss" ? "bg-red-600 text-white" : "bg-indigo-600/15 text-indigo-600"}`}>
                  {nodeType === "boss" ? `⚔ BOSS 第 ${run.layer} 层` : `第 ${run.layer} 层`}
                </span>
                <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-sm text-slate-600">{run.subject}</span>
              </div>
            </div>
              <div className="flex items-center gap-3 text-sm">
                <span key={comboPop} title="连续正确" className={run.combo >= 3 ? "combo-pop" : ""}>
                  {run.combo >= 3 ? <span className="combo-fire mr-0.5">🔥</span> : "🔥 "}
                  连对 <b className={run.combo >= 3 ? "text-amber-600" : "text-slate-800"}>{run.combo}</b>
                </span>
                <span title="得分">⭐ <b className="text-slate-800">{run.score}</b></span>
                <span title="金币">🪙 <b className="text-slate-800">{run.coins}</b></span>
                <button onClick={quit} className="rounded-lg border border-slate-200 px-2 py-0.5 text-xs text-slate-400 hover:bg-slate-50">结算</button>
              </div>
            </div>
            <div className={`mt-3 rounded-full ${run.hp <= 2 ? "low-hp" : ""}`}>
              <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
                {Array.from({ length: maxHp }).map((_, i) => (
                  <div key={i} className={`mx-0.5 my-0.5 flex-1 rounded-full transition ${i < run.hp ? "bg-red-500" : "bg-slate-200"}`} />
                ))}
              </div>
              <p className="mt-1 text-xs text-slate-400">生命 {run.hp}/{maxHp} · 答错扣除 1 点生命</p>
            </div>
            {/* 道具栏 */}
            {inventory.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {inventory.map((it) => (
                  <button key={it} onClick={() => useItem(it)} disabled={loading}
                    className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
                    {ITEM_LABEL[it] ?? it}
                  </button>
                ))}
              </div>
            )}
          </div>

          {toast && <div className="pop-in rounded-xl bg-amber-50/95 px-4 py-2.5 text-sm text-amber-700 shadow">{toast}</div>}
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

          {/* 奖励节点 */}
          {nodeType === "reward" && (
            <div className="relative overflow-hidden rounded-2xl border-2 border-dashed border-amber-300/70 bg-amber-50/95 p-8 text-center shadow-lg">
              <div className="coin-rain" />
              <div className="gift-bounce relative text-5xl">🎁</div>
              <h2 className="reward-slide relative mt-2 text-lg font-bold text-amber-700">奖励节点</h2>
              <p className="relative mt-1 text-sm text-amber-600">休息一下,领取金币奖励!</p>
              <button onClick={claim} disabled={loading} className="relative mt-4 h-10 rounded-lg bg-amber-500 px-6 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-60">
                {loading ? "处理中..." : "领取奖励"}
              </button>
            </div>
          )}

          {/* 题目节点 */}
          {nodeType !== "reward" && (question ? (
            <div className={`pop-in rounded-2xl border border-white/10 bg-white p-6 shadow-lg ${nodeType === "boss" ? "boss-arena" : ""}`}>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                {nodeType === "boss" && <span className="rounded bg-red-600 px-2 py-0.5 font-medium text-white">BOSS · 薄弱点</span>}
                <span className="rounded bg-slate-100 px-2 py-0.5">{question.topic || "待归类"}</span>
                <span>难度 {DIFF_LABEL[question.difficulty] ?? question.difficulty}</span>
              </div>
              <div className="mt-3 text-[15px] leading-relaxed text-slate-800">{renderRich(question.stem)}</div>
              <div className="mt-4 space-y-2">
                {(question.options || []).map((opt, i) => {
                  const excluded = hintExclude.includes(i);
                  return (
                    <button key={i}
                      onClick={() => setSelected(String(opt))}
                      disabled={loading || excluded}
                      className={`flex w-full items-start gap-2 rounded-xl border px-4 py-2.5 text-left text-sm transition ${
                        excluded ? "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300 line-through"
                          : selected === String(opt) ? "border-indigo-500 bg-indigo-50 text-slate-800"
                          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                      }`}>
                      <span className="mt-0.5 shrink-0 font-bold text-slate-400">{String.fromCharCode(65 + i)}.</span>
                      <span className="leading-relaxed">{renderRich(String(opt))}</span>
                    </button>
                  );
                })}
              </div>
              {feedback && (
                <div className={`pop-in mt-4 flex items-center justify-between rounded-xl px-4 py-2.5 text-sm ${feedback.correct ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                  <span>{feedback.correct ? "✓ 回答正确!" : feedback.shieldUsed ? "✗ 回答错误(护盾抵挡,生命不减)" : "✗ 回答错误,生命 -1"}</span>
                </div>
              )}
              <button onClick={submit} disabled={!selected || loading}
                className="mt-4 h-10 w-full rounded-lg bg-indigo-600 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
                {loading ? "判分中..." : "提交答案"}
              </button>
            </div>
          ) : (
            <p className="rounded-2xl border border-white/10 bg-white p-8 text-center text-sm text-slate-400 shadow">加载题目中...</p>
          ))}
        </div>
      )}

      {phase === "result" && run && (
        <>
          {victoryOn && <div className="victory-curtain" aria-hidden />}
          {deathOn && <div className="death-curtain" aria-hidden />}
          {victoryOn && <div key={"vic-" + phase} className="banner banner-victory">🏆 通关!</div>}
        <div className="roguelike-bg mx-auto max-w-lg rounded-2xl border border-white/10 bg-white/95 p-8 text-center shadow-lg">
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
            <button onClick={() => { setPhase("setup"); setRun(null); setQuestion(null); setFeedback(null); setSelected(""); setToast(null); setHintExclude([]); setInventory([]); setNodeType(null); setBossAppearKey(0); setBossDefeatKey(0); setRewardClaimKey(0); setVictoryOn(false); setDeathOn(false); }} className="h-10 flex-1 rounded-lg bg-indigo-600 text-sm font-medium text-white hover:bg-indigo-700">再来一次</button>
          </div>
        </div>
        </>
      )}
    </div>
  );
}
