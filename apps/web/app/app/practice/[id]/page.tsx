"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { GradeResult, QuizQuestion, SessionDetail } from "@/lib/types";

const LETTERS = ["A", "B", "C", "D", "E", "F"];

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

  useEffect(() => {
    const cached = sessionStorage.getItem(`session-${id}`);
    if (cached) {
      setQuestions(JSON.parse(cached));
      const saved = sessionStorage.getItem(`answers-${id}`);
      if (saved) setAnswers(JSON.parse(saved));
      setLoading(false);
    } else {
      // 无缓存(如刷新后):尝试读取会话,若已提交则展示结果
      api.get<SessionDetail>(`/sessions/${id}`)
        .then((d) => {
          setDetail(d);
          if (!d.submittedAt) setQuestions(d.details.map((x) => ({ id: x.questionId, stem: x.stem, options: x.options, topic: x.topic, type: "SINGLE_CHOICE", subject: "", difficulty: 0 })));
        })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }
  }, [id]);

  const saveAnswer = useMemo(() => (qid: string, selected: string) => {
    api.post(`/sessions/${id}/answer`, { questionId: qid, selected, timeSpent: 20 }).catch(() => {});
  }, [id]);

  function choose(selected: string) {
    const qid = questions[current].id;
    const next = { ...answers, [qid]: selected };
    setAnswers(next);
    sessionStorage.setItem(`answers-${id}`, JSON.stringify(next));
    saveAnswer(qid, selected);
  }

  async function submit() {
    if (!window.confirm("确认提交?提交后将无法修改答案。")) return;
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
      setError(e instanceof Error ? e.message : "提交失败");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-slate-500">加载中...</p>;

  // 已提交:展示成绩与解析
  if (detail?.submittedAt || result) {
    const items = detail?.details ?? [];
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm text-slate-500">本次得分</p>
          <p className="mt-2 text-4xl font-bold text-indigo-600">
            {result?.score ?? detail?.score} <span className="text-lg text-slate-400">/ {result?.total ?? detail?.total}</span>
          </p>
          <p className="mt-2 text-sm text-slate-500">答对 {result?.correctCount ?? detail?.correctCount} 题</p>
          <button onClick={() => router.push("/app")} className="mt-4 rounded-lg bg-indigo-600 px-6 py-2 text-sm font-medium text-white hover:bg-indigo-700">
            返回首页
          </button>
        </div>
        {items.map((d, i) => (
          <div key={d.questionId} className={`rounded-2xl border bg-white p-6 shadow-sm ${d.isCorrect ? "border-emerald-200" : "border-red-200"}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <p className="text-sm text-slate-400">第 {i + 1} 题 · {d.topic}</p>
                <p className="mt-2 text-sm leading-relaxed text-slate-800">{d.stem}</p>
              </div>
              <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${d.isCorrect ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"}`}>
                {d.isCorrect ? "答对" : "答错"}
              </span>
            </div>
            <div className="mt-3 space-y-1.5">
              {d.options.map((opt, j) => (
                <div key={j} className={`rounded-lg px-3 py-2 text-sm ${opt === d.answer ? "bg-emerald-50 text-emerald-700" : opt === d.selected ? "bg-red-50 text-red-700" : "bg-slate-50 text-slate-600"}`}>
                  <span className="font-medium">{LETTERS[j]}. </span>{opt}
                  {opt === d.answer && <span className="ml-2 text-xs text-emerald-500">正确答案</span>}
                </div>
              ))}
            </div>
            {d.solution && (
              <div className="mt-3 rounded-lg bg-indigo-50 p-3 text-sm text-indigo-900">
                <span className="font-medium">解析:</span> {d.solution}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  // 答题中
  if (questions.length === 0) {
    return <p className="text-sm text-slate-500">该会话没有可用的题目。</p>;
  }
  const q = questions[current];
  const answeredCount = Object.keys(answers).length;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between text-sm text-slate-500">
        <span>已答 {answeredCount} / {questions.length}</span>
        <span>{q.topic} · 难度 {q.difficulty}</span>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-400">第 {current + 1} 题</p>
        <p className="mt-2 text-base leading-relaxed text-slate-800">{q.stem}</p>
        <div className="mt-5 space-y-2">
          {q.options.map((opt, j) => {
            const selected = answers[q.id] === opt;
            return (
              <button
                key={j}
                onClick={() => choose(opt)}
                className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left text-sm transition ${
                  selected ? "border-indigo-500 bg-indigo-50 text-indigo-900" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                }`}
              >
                <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${selected ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500"}`}>
                  {LETTERS[j]}
                </span>
                <span className="leading-relaxed">{opt}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <button
          onClick={() => setCurrent((c) => Math.max(0, c - 1))}
          disabled={current === 0}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 disabled:opacity-40"
        >
          上一题
        </button>
        <div className="flex gap-1.5">
          {questions.map((qq, i) => (
            <button
              key={qq.id}
              onClick={() => setCurrent(i)}
              className={`h-8 w-8 rounded-md text-xs font-medium transition ${
                i === current ? "bg-indigo-600 text-white" : answers[qq.id] ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-500"
              }`}
            >
              {i + 1}
            </button>
          ))}
        </div>
        {current < questions.length - 1 ? (
          <button onClick={() => setCurrent((c) => Math.min(questions.length - 1, c + 1))} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600">
            下一题
          </button>
        ) : (
          <button onClick={submit} disabled={saving} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
            {saving ? "提交中..." : "提交判分"}
          </button>
        )}
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  );
}
