"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { SessionSummary } from "@/lib/types";

export default function SessionsPage() {
  const router = useRouter();
  const [list, setList] = useState<SessionSummary[]>([]);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    api.get<{ list: SessionSummary[] }>(`/me/sessions${filter ? `?mode=${filter}` : ""}`).then((d) => setList(d.list)).catch(() => {});
  }, [filter]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">成绩历史</h1>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-indigo-500">
          <option value="">全部模式</option>
          <option value="PRACTICE">练习</option>
          <option value="EXAM">模拟考</option>
        </select>
      </div>
      {list.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">暂无记录</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-400">
              <tr>
                <th className="px-4 py-3 font-normal">模式</th>
                <th className="px-4 py-3 font-normal">得分</th>
                <th className="px-4 py-3 font-normal">正确率</th>
                <th className="px-4 py-3 font-normal">开始时间</th>
                <th className="px-4 py-3 font-normal">提交时间</th>
                <th className="px-4 py-3 font-normal">详情</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">{s.mode === "EXAM" ? "模拟考" : "练习"}</td>
                  <td className="px-4 py-3 font-medium">{s.score} / {s.total}</td>
                  <td className="px-4 py-3">{s.total ? Math.round((s.score! / s.total) * 100) : 0}%</td>
                  <td className="px-4 py-3 text-slate-500">{new Date(s.startedAt).toLocaleString("zh-CN")}</td>
                  <td className="px-4 py-3 text-slate-500">{s.submittedAt ? new Date(s.submittedAt).toLocaleString("zh-CN") : "—"}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => router.push(`/app/practice/${s.id}`)} className="text-indigo-600 hover:underline">
                      查看
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
