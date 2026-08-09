"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { renderRich } from "@/lib/rich";
import type { WrongItem } from "@/lib/types";

export default function WrongBookPage() {
  const [list, setList] = useState<WrongItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [subjectTab, setSubjectTab] = useState("");

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

  // 学科筛选:数学 tab 含 TMUA(与老师端一致)
  const visible = subjectTab
    ? list.filter((w) => (subjectTab === "数学" ? w.subject === "数学" || w.subject === "TMUA" : w.subject === subjectTab))
    : list;
  const pending = visible.filter((w) => !w.mastered);
  const mastered = visible.filter((w) => w.mastered);

  const renderItem = (w: WrongItem) => (
    <div key={w.questionId} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-600">{w.subject}</span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5">{w.topic}</span>
            <span>难度 {w.difficulty}</span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-slate-800">{renderRich(w.stem)}</p>
          {w.solution ? (
            <div className="mt-3 whitespace-pre-wrap rounded border-l-4 border-[#c9b98f] bg-[#f6f1e2] px-3 py-2 text-sm leading-relaxed text-[#3a3528]">
              <b className="text-[#00467F]">解析:</b> {renderRich(w.solution, { smart: false })}
            </div>
          ) : (
            <p className="mt-3 rounded bg-slate-50 px-3 py-2 text-xs text-slate-400">暂无解析,老师尚未补充</p>
          )}
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
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">错题本</h1>
        {list.length > 0 && (
          <div className="flex gap-1.5 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
            {[{ v: "", l: "全部" }, { v: "数学", l: "数学" }, { v: "物理", l: "物理" }, { v: "化学", l: "化学" }, { v: "生物", l: "生物" }].map((t) => (
              <button
                key={t.v}
                onClick={() => setSubjectTab(t.v)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  subjectTab === t.v ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {t.l}
              </button>
            ))}
          </div>
        )}
      </div>
      {list.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">太棒了,目前没有错题!</p>
      ) : visible.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">该学科暂无错题</p>
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
