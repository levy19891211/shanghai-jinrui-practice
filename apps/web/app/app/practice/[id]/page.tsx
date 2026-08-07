"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { renderRich } from "@/lib/rich";
import type { GradeResult, QuizQuestion, SessionDetail } from "@/lib/types";

const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

// 知识点 → 标签配色(试卷风格)
const TOPIC_COLORS: Record<string, string> = {
  代数: "#2e6f40", 函数: "#2e6f40", "代数方程组": "#2e6f40", 不等式: "#2e6f40",
  微积分: "#7a3b8f", 定积分: "#7a3b8f",
  三角: "#b8860b", 三角函数: "#b8860b",
  概率: "#1f6fb2", 统计: "#1f6fb2",
  数列: "#a14a3a", "数列级数": "#a14a3a",
  几何: "#3d6b6b", "坐标几何": "#3d6b6b", "立体几何": "#3d6b6b", "解析几何": "#3d6b6b",
  逻辑: "#5b3a8f",
};
const DEFAULT_TOPIC = "#00467F";

function topicColor(topic: string): string {
  return TOPIC_COLORS[topic] || DEFAULT_TOPIC;
}

// 成绩等级
function gradeOf(pct: number): { label: string; color: string } {
  if (pct >= 90) return { label: "Outstanding", color: "#2e7d32" };
  if (pct >= 75) return { label: "Strong", color: "#1f6fb2" };
  if (pct >= 60) return { label: "Solid", color: "#b8860b" };
  if (pct >= 45) return { label: "Developing", color: "#c62828" };
  return { label: "Keep practising", color: "#9e9e9e" };
}

const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

export default function PracticePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [current, setCurrent] = useState(0);
  const [result, setResult] = useState<GradeResult | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deadline, setDeadline] = useState<number | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const submittedRef = useRef(false);

  const isExam = !!deadline;

  // 初始化:读缓存题目;并向后端确认会话信息(时限/是否已提交)
  useEffect(() => {
    let cached: string | null = null;
    try {
      cached = sessionStorage.getItem(`session-${id}`);
      if (cached) {
        const raw = JSON.parse(cached);
        if (Array.isArray(raw)) {
          const norm = raw.map((q) => ({
            ...q,
            options: Array.isArray(q.options)
              ? q.options
              : typeof q.options === "string"
                ? (() => { try { const v = JSON.parse(q.options); return Array.isArray(v) ? v : []; } catch { return []; } })()
                : [],
          }));
          setQuestions(norm);
        }
      }
    } catch {
      sessionStorage.removeItem(`session-${id}`);
    }
    try {
      const saved = sessionStorage.getItem(`answers-${id}`);
      if (saved) setAnswers(JSON.parse(saved));
    } catch {
      sessionStorage.removeItem(`answers-${id}`);
    }

    api.get<SessionDetail>(`/sessions/${id}`)
      .then((d) => {
        if (d.submittedAt) {
          setDetail(d);
          setResult({ score: d.score ?? 0, total: d.total ?? 0, correctCount: d.correctCount ?? 0, details: [] });
          return;
        }
        if (d.durationMin && d.startedAt) {
          const dl = new Date(d.startedAt).getTime() + d.durationMin * 60000;
          setDeadline(dl);
          setRemaining(Math.max(0, Math.floor((dl - Date.now()) / 1000)));
        }
        if (!cached && d.details?.length) {
          setQuestions(d.details.map((x) => ({
            id: x.questionId, stem: x.stem, options: x.options, topic: x.topic,
            type: "SINGLE_CHOICE", subject: "", difficulty: 0,
          })));
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  const saveAnswer = useCallback((qid: string, selected: string) => {
    api.post(`/sessions/${id}/answer`, { questionId: qid, selected, timeSpent: 20 }).catch(() => {});
  }, [id]);

  const submit = useCallback(async (auto = false) => {
    if (submittedRef.current) return;
    if (!auto && !window.confirm("确认交卷?交卷后将无法修改答案。")) return;
    submittedRef.current = true;
    setSaving(true);
    setError("");
    try {
      const r = await api.post<GradeResult>(`/sessions/${id}/submit`);
      setResult(r);
      const d = await api.get<SessionDetail>(`/sessions/${id}`);
      setDetail(d);
      sessionStorage.removeItem(`session-${id}`);
      sessionStorage.removeItem(`answers-${id}`);
    } catch (e) {
      submittedRef.current = false;
      setError(e instanceof Error ? e.message : "提交失败");
    } finally {
      setSaving(false);
    }
  }, [id]);

  // 倒计时:归零后自动交卷
  useEffect(() => {
    if (remaining === null || detail || result) return;
    if (remaining <= 0) {
      submit(true);
      return;
    }
    const t = setTimeout(() => setRemaining((r) => (r === null ? null : r - 1)), 1000);
    return () => clearTimeout(t);
  }, [remaining, detail, result, submit]);

  // 键盘导航:←/→ 切题
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft") setCurrent((c) => Math.max(0, c - 1));
      if (e.key === "ArrowRight") setCurrent((c) => Math.min(questions.length - 1, c + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [questions.length]);

  function choose(selected: string) {
    if (isExam && deadline && Date.now() > deadline) return; // 超时禁答
    if (questions.length === 0) return;
    const qid = questions[current].id;
    const next = { ...answers, [qid]: selected };
    setAnswers(next);
    sessionStorage.setItem(`answers-${id}`, JSON.stringify(next));
    saveAnswer(qid, selected);
  }

  if (loading) return <p className="py-10 text-center text-sm text-slate-500">加载中...</p>;

  const modeLabel = isExam ? "模拟考" : "练习";
  const answeredCount = Object.keys(answers).length;
  const total = questions.length;

  /* ============ 已提交:成绩总结 + 逐题解析 ============ */
  if (detail?.submittedAt) {
    const items = detail.details ?? [];
    const correct = detail.correctCount ?? 0;
    const wrong = items.filter((d) => d.selected != null && !d.isCorrect).length;
    const blank = items.filter((d) => d.selected == null).length;
    const pct = detail.total ? Math.round((correct / detail.total) * 100) : 0;
    const grade = gradeOf(pct);

    return (
      <div className="mx-auto max-w-3xl">
        <div className="overflow-hidden rounded-lg bg-[#fbf8f1] shadow-lg ring-1 ring-[#d9d2c2]">
          {/* 头 */}
          <div className="bg-gradient-to-br from-[#00467F] to-[#1f6fb2] px-8 py-6 text-white">
            <h1 className="text-lg font-bold tracking-wide">上海金瑞学校 · 附加笔试刷题系统</h1>
            <p className="mt-1 text-xs opacity-90">{modeLabel} · 成绩报告</p>
            {result?.timedOut && <p className="mt-2 inline-block rounded bg-amber-500/20 px-2 py-0.5 text-xs">考试时间已到,系统已自动交卷</p>}
          </div>
          {/* 成绩总结 */}
          <div className="px-8 py-8 text-center">
            <p className="text-sm text-[#5a5346]">本次得分</p>
            <p className="mt-2 text-6xl font-bold leading-none text-[#00467F]">
              {correct}
              <small className="ml-1 text-2xl text-[#8a8377]">/ {detail.total}</small>
            </p>
            <p className="mt-3 text-2xl font-bold" style={{ color: grade.color }}>{pct}%</p>
            <span className="mt-2 inline-block rounded-full px-4 py-1 text-sm font-semibold text-white" style={{ background: grade.color }}>
              {grade.label}
            </span>
            <div className="mt-5 flex justify-center gap-3 text-sm">
              <span className="rounded border border-[#d9d2c2] bg-white px-3 py-1.5">答对 <b className="text-[#2e7d32]">{correct}</b></span>
              <span className="rounded border border-[#d9d2c2] bg-white px-3 py-1.5">答错 <b className="text-[#c62828]">{wrong}</b></span>
              <span className="rounded border border-[#d9d2c2] bg-white px-3 py-1.5">未答 <b className="text-[#8a8377]">{blank}</b></span>
            </div>
            <div className="mt-6 flex justify-center gap-3">
              <button onClick={() => router.push("/app")} className="rounded bg-[#00467F] px-5 py-2 text-sm font-medium text-white hover:bg-[#1f6fb2]">
                返回首页
              </button>
            </div>
          </div>
          {/* 逐题 */}
          <div className="space-y-4 px-6 pb-8">
            {items.map((d, i) => (
              <div key={d.questionId} className={`rounded border bg-white p-5 ${d.isCorrect ? "border-[#2e7d32] shadow-[0_0_0_3px_rgba(46,125,50,0.15)]" : "border-[#c62828] shadow-[0_0_0_3px_rgba(198,40,40,0.12)]"}`}>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 min-w-[52px] text-sm font-bold text-[#b8860b]">Q{i + 1}.</span>
                  <div className="flex-1">
                    <span className="mr-2 inline-block rounded-full px-2 py-0.5 text-[11px] text-white" style={{ background: topicColor(d.topic) }}>
                      {d.topic}
                    </span>
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${d.isCorrect ? "bg-[#e8f5e9] text-[#2e7d32]" : d.selected ? "bg-[#fdecea] text-[#c62828]" : "bg-[#f0ead8] text-[#5a5346]"}`}>
                      {d.isCorrect ? "✓ 答对" : d.selected ? "✗ 答错" : "未作答"}
                    </span>
                    <p className="mt-2 text-[15px] leading-relaxed text-[#1a1a1a]">{renderRich(d.stem)}</p>
                    <div className="mt-3 space-y-1">
                      {d.options.map((opt, j) => {
                        const isAns = opt === d.answer;
                        const isSel = opt === d.selected;
                        return (
                          <div key={j} className={`rounded px-3 py-1.5 text-[14px] ${isAns ? "bg-[#e8f5e9] font-medium text-[#1b3a1d]" : isSel ? "bg-[#fdecea] text-[#5a1a17]" : "text-[#5a5346]"}`}>
                            <span className="mr-1 font-bold text-[#00467F]">{LETTERS[j]}.</span>
                            {renderRich(opt)}
                            {isAns && <span className="ml-2 text-xs text-[#2e7d32]">正确答案</span>}
                          </div>
                        );
                      })}
                    </div>
                    {d.solution && (
                      <div className="mt-3 whitespace-pre-wrap rounded border-l-4 border-[#c9b98f] bg-[#f6f1e2] px-3 py-2 text-sm leading-relaxed text-[#3a3528]">
                        <b className="text-[#00467F]">解析:</b> {renderRich(d.solution)}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ============ 答题中:试卷风格 ============ */
  if (questions.length === 0) {
    return <p className="py-10 text-center text-sm text-slate-500">该会话没有可用的题目。</p>;
  }
  const q = questions[current];
  const expired = isExam && deadline !== null && Date.now() > deadline;
  const remainingStr = remaining === null ? "" : fmt(remaining);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="overflow-hidden rounded-lg bg-[#fbf8f1] shadow-lg ring-1 ring-[#d9d2c2]">
        {/* 试卷头 */}
        <div className="bg-gradient-to-br from-[#00467F] to-[#1f6fb2] px-8 py-5 text-white">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-base font-bold tracking-wide">上海金瑞学校 · 附加笔试</h1>
              <p className="mt-0.5 text-xs opacity-90">
                {modeLabel} · 共 {total} 题 · 每题 1 分
                {isExam && <span className="ml-2 rounded bg-white/15 px-2 py-0.5">限时 {deadline ? Math.round((deadline - Date.now() + remaining! * 1000) / 60000) : ""} 分钟</span>}
              </p>
            </div>
            <div className="text-right">
              {isExam && remaining !== null ? (
                <>
                  <p className={`font-mono text-3xl font-bold tabular-nums ${remaining <= 60 ? "animate-pulse text-amber-300" : ""}`}>{remainingStr}</p>
                  <p className="text-[11px] opacity-80">{remaining <= 60 ? "即将自动交卷" : "剩余时间"}</p>
                </>
              ) : (
                <>
                  <p className="text-3xl font-bold text-white/40">∞</p>
                  <p className="text-[11px] opacity-60">不限时</p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* 进度条 */}
        <div className="flex items-center gap-3 bg-[#f1ead9] px-6 py-2.5 text-[13px] text-[#5a5346]">
          <span className="shrink-0">已答 {answeredCount} / {total}</span>
          <div className="h-2 flex-1 overflow-hidden rounded bg-[#e0d8c2]">
            <div className="h-full bg-[#00467F] transition-all duration-300" style={{ width: `${total ? (answeredCount / total) * 100 : 0}%` }} />
          </div>
          <span className="shrink-0 text-[#8a8377]">进度 {total ? Math.round((answeredCount / total) * 100) : 0}%</span>
        </div>

        {/* 题号导航网格 */}
        <div className="flex flex-wrap gap-1.5 bg-[#f1ead9] px-6 pb-4">
          {questions.map((qq, i) => {
            const isCur = i === current;
            const hasAns = !!answers[qq.id];
            return (
              <button
                key={qq.id}
                onClick={() => setCurrent(i)}
                className={`flex h-9 w-9 items-center justify-center rounded text-[13px] font-bold transition-all ${
                  isCur
                    ? "bg-[#b8860b] text-white shadow-[0_0_0_3px_rgba(184,134,11,0.35)]"
                    : hasAns
                      ? "bg-[#00467F] text-white"
                      : "border border-[#d9d2c2] bg-white text-[#5a5346] hover:border-[#00467F] hover:text-[#00467F]"
                }`}
              >
                {i + 1}
              </button>
            );
          })}
        </div>

        {/* 题目卡片 */}
        <div className="px-6 py-6">
          <div className="rounded border border-[#d9d2c2] bg-white p-5">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-bold text-[#b8860b]">Q{current + 1}.</span>
              <span className="rounded-full px-2 py-0.5 text-[11px] text-white" style={{ background: topicColor(q.topic) }}>
                {q.topic}
              </span>
              <span className="text-xs text-[#8a8377]">难度 {q.difficulty}</span>
            </div>
            <div className="mt-3 text-[15.5px] leading-relaxed text-[#1a1a1a]">{renderRich(q.stem)}</div>
            <div className="mt-4 space-y-1.5">
              {q.options.map((opt, j) => {
                const selected = answers[q.id] === opt;
                return (
                  <label
                    key={j}
                    className={`flex cursor-pointer items-start gap-2.5 rounded border px-3 py-2 text-[15px] transition-all ${
                      selected
                        ? "border-[#00467F] bg-[#e8eef7] shadow-[0_0_0_1px_#00467F]"
                        : "border-[#d9d2c2] bg-[#fdfaf2] hover:bg-[#f6f1e2]"
                    } ${expired ? "pointer-events-none opacity-60" : ""}`}
                  >
                    <input
                      type="radio"
                      name={`q-${current}`}
                      checked={selected}
                      disabled={expired}
                      onChange={() => choose(opt)}
                      className="mt-1.5 h-4 w-4 accent-[#00467F]"
                    />
                    <span className="font-bold text-[#00467F]">{LETTERS[j]}.</span>
                    <span className="leading-relaxed">{renderRich(opt)}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        {/* 分页导航 */}
        <div className="flex items-center justify-between px-6 pb-5">
          <button
            onClick={() => setCurrent((c) => Math.max(0, c - 1))}
            disabled={current === 0}
            className="rounded bg-[#00467F] px-4 py-2 text-sm text-white hover:bg-[#1f6fb2] disabled:bg-[#9aa3ad]"
          >
            ← 上一题
          </button>
          <span className="text-sm text-[#5a5346]">第 {current + 1} 题 / 共 {total} 题</span>
          {current < total - 1 ? (
            <button
              onClick={() => setCurrent((c) => Math.min(total - 1, c + 1))}
              className="rounded bg-[#00467F] px-4 py-2 text-sm text-white hover:bg-[#1f6fb2]"
            >
              下一题 →
            </button>
          ) : (
            <button
              onClick={() => submit(false)}
              disabled={saving}
              className="rounded bg-[#b8860b] px-5 py-2 text-sm font-semibold text-white hover:bg-[#d4a017] disabled:opacity-60"
            >
              {saving ? "交卷中..." : "交卷"}
            </button>
          )}
        </div>

        {error && <p className="px-6 pb-4 text-sm text-[#c62828]">{error}</p>}
      </div>

      <p className="mt-3 text-center text-xs text-[#8a8377]">
        支持键盘 ← → 切换题目 · 作答实时保存,刷新不丢失
      </p>
    </div>
  );
}
