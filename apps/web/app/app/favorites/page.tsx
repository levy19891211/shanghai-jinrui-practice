"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { renderRich } from "@/lib/rich";

interface FavItem {
  favoritedAt: string;
  question: {
    id: string;
    subject: string;
    sourceType: string | null;
    topic: string;
    difficulty: number;
    type: string;
    stem: string;
    options: string[];
    answer: string;
    solution: string | null;
    source: string | null;
  };
}

const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

export default function FavoritesPage() {
  const [list, setList] = useState<FavItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    api.get<{ list: FavItem[] }>("/me/favorites")
      .then((d) => setList(d.list || []))
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function remove(qid: string) {
    try {
      await api.del(`/me/favorites/${qid}`);
      setList((prev) => prev.filter((f) => f.question.id !== qid));
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">⭐ 题目收藏</h1>
          <p className="mt-1 text-sm text-slate-500">做题时收藏的题目,共 {list.length} 题</p>
        </div>
        <button onClick={() => window.history.back()} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
          ← 返回
        </button>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="py-10 text-center text-sm text-slate-400">加载中...</p>
      ) : list.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          还没有收藏题目。做题时点题目右上角「☆ 收藏」即可加入,方便以后查阅复习。
        </p>
      ) : (
        list.map((f) => (
          <div key={f.question.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">{f.question.subject}</span>
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-600">{f.question.topic}</span>
              {f.question.sourceType && (
                <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-600">{f.question.sourceType}</span>
              )}
              <span className="text-xs text-slate-400">
                难度 {f.question.difficulty} · 收藏于 {new Date(f.favoritedAt).toLocaleString("zh-CN", { hour12: false })}
              </span>
              <button onClick={() => remove(f.question.id)} className="ml-auto text-xs text-red-500 hover:underline">
                移除收藏
              </button>
            </div>
            <p className="mt-3 text-[15px] leading-relaxed text-slate-800">{renderRich(f.question.stem)}</p>
            <div className="mt-3 space-y-1">
              {f.question.options.map((opt, j) => {
                const isAns = opt === f.question.answer;
                return (
                  <div key={j} className={`rounded px-3 py-1.5 text-[14px] ${isAns ? "bg-emerald-50 font-medium text-emerald-800" : "text-slate-600"}`}>
                    <span className="mr-1 font-bold text-indigo-600">{LETTERS[j]}.</span>
                    {renderRich(opt)}
                    {isAns && <span className="ml-2 text-xs text-emerald-600">✓ 正确答案</span>}
                  </div>
                );
              })}
            </div>
            {f.question.solution && (
              <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50/50 px-3 py-2.5">
                <p className="text-xs font-semibold text-amber-700">💡 解析</p>
                <div className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{renderRich(f.question.solution, { smart: false })}</div>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
