"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { WrongItem } from "@/lib/types";

export default function WrongBookPage() {
  const [list, setList] = useState<WrongItem[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const d = await api.get<{ list: WrongItem[] }>("/me/wrongbook");
    setList(d.list);
    setLoading(false);
  }

  useEffect(() => { load().catch(() => setLoading(false)); }, []);

  async function markMastered(qid: string) {
    await api.post(`/me/wrongbook/${qid}/master`);
    await load();
  }

  if (loading) return <p className="text-sm text-slate-500">加载中...</p>;

  const pending = list.filter((w) => !w.mastered);
  const mastered = list.filter((w) => w.mastered);

  const renderItem = (w: WrongItem) => (
    <div key={w.questionId} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>{w.subject}</span>
            <span>·</span>
            <span>{w.topic}</span>
            <span>·</span>
            <span>难度 {w.difficulty}</span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-slate-800">{w.stem}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs text-slate-400">错 {w.wrongCount} 次</p>
          {!w.mastered && (
            <button onClick={() => markMastered(w.questionId)} className="mt-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700">
              标记掌握
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">错题本</h1>
      {list.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">太棒了,目前没有错题!</p>
      ) : (
        <>
          <section>
            <h2 className="mb-3 text-sm font-medium text-slate-500">待掌握 ({pending.length})</h2>
            <div className="space-y-3">{pending.map(renderItem)}</div>
          </section>
          {mastered.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-medium text-slate-500">已掌握 ({mastered.length})</h2>
              <div className="space-y-3 opacity-60">{mastered.map(renderItem)}</div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
