"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

interface StudentRow {
  id: string;
  name: string;
  email: string;
  sessionCount: number;
  avgRate: number;
  lastSession: { score: number; total: number; mode: string; submittedAt: string } | null;
}

interface Overview {
  students: number;
  sessions: number;
  totalAnswered: number;
  byTopic: { topic: string; attempts: number; correctRate: number }[];
}

export default function TeacherStudentsPage() {
  const router = useRouter();
  const [list, setList] = useState<StudentRow[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  async function load(kw = search) {
    try {
      const d = await api.get<{ list: StudentRow[] }>(`/teacher/students${kw ? `?search=${encodeURIComponent(kw)}` : ""}`);
      setList(d.list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    }
  }

  useEffect(() => {
    load();
    api.get<Overview>("/teacher/stats/overview").then(setOverview).catch(() => {});
  }, []);

  const weak = (overview?.byTopic ?? []).slice(0, 5);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">学情统计</h1>

      {overview && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: "学生数", value: overview.students },
            { label: "刷题次数", value: overview.sessions },
            { label: "累计答题", value: overview.totalAnswered },
            { label: "知识点覆盖", value: overview.byTopic.length },
          ].map((x) => (
            <div key={x.label} className="rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm">
              <p className="text-2xl font-bold text-indigo-600">{x.value}</p>
              <p className="mt-1 text-xs text-slate-500">{x.label}</p>
            </div>
          ))}
        </div>
      )}

      {weak.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-medium text-slate-700">全班薄弱知识点 TOP 5(正确率最低)</h2>
          <div className="mt-4 space-y-3">
            {weak.map((t) => (
              <div key={t.topic} className="flex items-center gap-3">
                <span className="w-28 shrink-0 text-sm text-slate-600">{t.topic}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${t.correctRate >= 70 ? "bg-emerald-500" : t.correctRate >= 40 ? "bg-amber-500" : "bg-red-500"}`}
                    style={{ width: `${Math.max(t.correctRate, 3)}%` }}
                  />
                </div>
                <span className="w-16 shrink-0 text-right text-xs text-slate-500">{t.correctRate}% · {t.attempts} 题</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-slate-700">学生成绩概览</h2>
          <div className="flex gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load()}
              placeholder="按姓名/邮箱搜索"
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-indigo-500"
            />
            <button onClick={() => load()} className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
              搜索
            </button>
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        {list.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">暂无学生数据,学生开始刷题后这里会展示成绩。</p>
        ) : (
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-slate-400">
                <th className="pb-2 font-normal">学生</th>
                <th className="pb-2 font-normal">邮箱</th>
                <th className="pb-2 font-normal">刷题次数</th>
                <th className="pb-2 font-normal">平均正确率</th>
                <th className="pb-2 font-normal">最近成绩</th>
                <th className="pb-2 font-normal">详情</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} className="border-b border-slate-50">
                  <td className="py-2.5 font-medium">{s.name}</td>
                  <td className="py-2.5 text-slate-500">{s.email}</td>
                  <td className="py-2.5">{s.sessionCount}</td>
                  <td className="py-2.5">
                    <span className={`font-medium ${s.avgRate >= 70 ? "text-emerald-600" : s.avgRate >= 40 ? "text-amber-600" : "text-red-500"}`}>
                      {s.avgRate}%
                    </span>
                  </td>
                  <td className="py-2.5 text-slate-500">
                    {s.lastSession ? `${s.lastSession.score}/${s.lastSession.total} (${s.lastSession.mode === "EXAM" ? "模考" : "练习"})` : "—"}
                  </td>
                  <td className="py-2.5">
                    <button onClick={() => router.push(`/teacher/students/${s.id}`)} className="text-indigo-600 hover:underline">
                      查看
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
