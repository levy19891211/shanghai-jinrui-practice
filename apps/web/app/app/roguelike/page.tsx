"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { renderRich } from "@/lib/rich";

interface Run {
  id: string; subject: string; difficulty: number; layer: number; hp: number; maxHp: number;
  combo: number; maxCombo: number; score: number; coins: number; status: string;
}
interface Q { id: string; topic?: string; type: string; stem: string; options: string[]; difficulty: number }
interface AnsResp {
  correct: boolean; combo: number; maxCombo: number; hp: number; maxHp: number; layer: number;
  score: number; coins: number; reward: string | null; runOver: boolean; status: string;
  nextQuestion: Q | null;
}
interface StartResp { run: Run; question: Q | null }

const SUBJECTS = ["数学", "物理", "化学", "生物", "TMUA"];
const DIFFS = [1, 2, 3, 4, 5];
const DIFF_LABEL: Record<number, string> = { 1: "入门", 2: "基础", 3: "中等", 4: "较难", 5: "困难" };
const MAX_LAYER = 20;

export default function RoguelikePage() {
  const router = useRouter();
  const [phase, setPhase] = useState<"setup" | "playing" | "result">("setup");
  const [subject, setSubject] = useState("数学");
  const [difficulty, setDifficulty] = useState(3);
  const [run, setRun] = useState<Run | null>(null);
  const [question, setQuestion] = useState<Q | null>(null);
  const [selected, setSelected] = useState("");
  const [feedback, setFeedback] = useState<null | { correct: boolean }>(null);
  const [rewardMsg, setRewardMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setError("");
    setLoading(true);
    try {
      const d = await api.post<StartResp>("/roguelike/start", { subject, difficulty });
      setRun(d.run);
      setQuestion(d.question);
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
    setRewardMsg(null);
    try {
      const d = await api.post<AnsResp>(`/roguelike/${run.id}/answer`, { questionId: question.id, selected });
      setFeedback({ correct: d.correct });
      if (d.reward) setRewardMsg(d.reward);
      setRun((r) => (r ? { ...r, layer: d.layer, hp: d.hp, combo: d.combo, maxCombo: d.maxCombo, score: d.score, coins: d.coins, status: d.status } : r));
      if (d.runOver) {
        setRun((r) => (r ? { ...r, layer: d.layer, hp: d.hp, combo: d.combo, score: d.score, status: d.status } : r));
        setQuestion(null);
        setTimeout(() => setPhase("result"), 1200);
      } else {
        setTimeout(() => {
          setQuestion(d.nextQuestion);
          setSelected("");
          setFeedback(null);
          setRewardMsg(null);
        }, 900);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交失败");
    } finally {
      setLoading(false);
    }
  }

  const hpStr = (run ? run.hp : 0);
  const maxHp = run ? run.maxHp : 5;

  return (
    <div className="space-y-4">
      {phase === "setup" && (
        <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-bold">冒险模式</h1>
          <p className="mt-1 text-sm text-slate-500">连续答对推进层数,答错扣生命。连击越高奖励越丰厚!</p>
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
                  <button
                    key={d}
                    onClick={() => setDifficulty(d)}
                    className={`rounded-lg px-3 py-1.5 text-sm transition ${difficulty === d ? "bg-indigo-600 text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-50"}`}
                  >
                    {DIFF_LABEL[d]}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
              <p>❤ 生命 {maxHp} · 答错 -1</p>
              <p>🔥 连对递增得分与奖励(3 连对回血)</p>
              <p>🏁 到达第 {MAX_LAYER} 层即通关</p>
            </div>
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
            <button onClick={start} disabled={loading} className="h-10 w-full rounded-lg bg-indigo-600 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
              {loading ? "生成中..." : "开始冒险"}
            </button>
          </div>
        </div>
      )}

      {phase === "playing" && run && (
        <div className="mx-auto max-w-2xl space-y-4">
          {/* 状态栏 */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="rounded-lg bg-indigo-50 px-2.5 py-1 text-sm font-bold text-indigo-600">第 {run.layer} 层</span>
                <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-sm text-slate-600">{subject}</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span title="连续正确">🔥 连对 <b className={run.combo >= 3 ? "text-amber-600" : "text-slate-800"}>{run.combo}</b></span>
                <span title="得分">⭐ <b className="text-slate-800">{run.score}</b></span>
                <span title="金币">🪙 <b className="text-slate-800">{run.coins}</b></span>
              </div>
            </div>
            {/* 血条 */}
            <div className="mt-3">
              <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
                {Array.from({ length: maxHp }).map((_, i) => (
                  <div key={i} className={`mx-0.5 my-0.5 flex-1 rounded-full transition ${i < hpStr ? "bg-red-500" : "bg-slate-200"}`} />
                ))}
              </div>
              <p className="mt-1 text-xs text-slate-400">生命 {hpStr}/{maxHp} · 答错扣除 1 点生命</p>
            </div>
          </div>

          {/* 题目 */}
          {question ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="rounded bg-slate-100 px-2 py-0.5">{question.topic || "待归类"}</span>
                <span>难度 {DIFF_LABEL[question.difficulty] ?? question.difficulty}</span>
              </div>
              <div className="mt-3 text-[15px] leading-relaxed text-slate-800">{renderRich(question.stem)}</div>
              <div className="mt-4 space-y-2">
                {(question.options || []).map((opt, i) => (
                  <button
                    key={i}
                    onClick={() => setSelected(String(opt))}
                    disabled={loading}
                    className={`flex w-full items-start gap-2 rounded-xl border px-4 py-2.5 text-left text-sm transition ${
                      selected === String(opt)
                        ? "border-indigo-500 bg-indigo-50 text-slate-800"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <span className="mt-0.5 shrink-0 font-bold text-slate-400">{String.fromCharCode(65 + i)}.</span>
                    <span className="leading-relaxed">{renderRich(String(opt))}</span>
                  </button>
                ))}
              </div>
              {feedback && (
                <div className={`mt-4 flex items-center justify-between rounded-xl px-4 py-2.5 text-sm ${feedback.correct ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                  <span>{feedback.correct ? "✓ 回答正确!" : "✗ 回答错误,生命 -1"}</span>
                  {rewardMsg && <span className="font-medium">🎁 {rewardMsg}</span>}
                </div>
              )}
              {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
              <button
                onClick={submit}
                disabled={!selected || loading}
                className="mt-4 h-10 w-full rounded-lg bg-indigo-600 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "判分中..." : "提交答案"}
              </button>
            </div>
          ) : (
            <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">加载题目中...</p>
          )}
        </div>
      )}

      {phase === "result" && run && (
        <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
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
            <button onClick={() => router.push("/app")} className="h-10 flex-1 rounded-lg border border-slate-300 text-sm font-medium text-slate-600 hover:bg-slate-50">
              返回
            </button>
            <button onClick={() => { setPhase("setup"); setRun(null); setQuestion(null); setFeedback(null); setSelected(""); setRewardMsg(null); }} className="h-10 flex-1 rounded-lg bg-indigo-600 text-sm font-medium text-white hover:bg-indigo-700">
              再来一次
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
