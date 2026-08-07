"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { RadarChart, PolarGrid, PolarAngleAxis, Radar, Tooltip, ResponsiveContainer } from "recharts";
import { api } from "@/lib/api";

interface Detail {
  student: { id: string; name: string; email: string; createdAt: string };
  sessions: { id: string; mode: string; score: number | null; total: number | null; correctCount: number | null; startedAt: string; submittedAt: string | null }[];
  byTopic: { topic: string; attempts: number; correctRate: number }[];
}

export default function StudentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get<Detail>(`/teacher/students/${id}/stats`).then(setDetail).catch((e) => setError(e.message));
  }, [id]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!detail) return <p className="text-sm text-slate-500">加载中...</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">{detail.student.name}</h1>
        <p className="mt-1 text-sm text-slate-500">{detail.student.email}</p>
      </div>

      {detail.byTopic.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-medium text-slate-700">知识点掌握度</h2>
          {detail.byTopic.length >= 3 && (
            <div className="mt-2 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={detail.byTopic.map((t) => ({ topic: t.topic, rate: t.correctRate }))} outerRadius="70%">
                  <PolarGrid stroke="#e2e8f0" />
                  <PolarAngleAxis dataKey="topic" tick={{ fontSize: 11, fill: "#475569" }} />
                  <Radar dataKey="rate" stroke="#6366f1" fill="#6366f1" fillOpacity={0.25} />
                  <Tooltip formatter={(v: number) => [`${v}%`, "正确率"]} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
            {detail.byTopic.map((t) => (
              <div key={t.topic} className="rounded-xl bg-slate-50 p-4">
                <p className="text-sm font-medium text-slate-800">{t.topic}</p>
                <p className="mt-1 text-xs text-slate-500">作答 {t.attempts} 次</p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={`h-full rounded-full ${t.correctRate >= 70 ? "bg-emerald-500" : t.correctRate >= 40 ? "bg-amber-500" : "bg-red-500"}`}
                    style={{ width: `${Math.max(t.correctRate, 3)}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-slate-600">正确率 {t.correctRate}%</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-medium text-slate-700">成绩历史({detail.sessions.length})</h2>
        {detail.sessions.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">暂无成绩记录</p>
        ) : (
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-slate-400">
                <th className="pb-2 font-normal">模式</th>
                <th className="pb-2 font-normal">得分</th>
                <th className="pb-2 font-normal">正确率</th>
                <th className="pb-2 font-normal">时间</th>
              </tr>
            </thead>
            <tbody>
              {detail.sessions.map((s) => (
                <tr key={s.id} className="border-b border-slate-50">
                  <td className="py-2.5">{s.mode === "EXAM" ? "模拟考" : "练习"}</td>
                  <td className="py-2.5">{s.score} / {s.total}</td>
                  <td className="py-2.5">{s.total ? Math.round((s.score! / s.total) * 100) : 0}%</td>
                  <td className="py-2.5 text-slate-500">{new Date(s.startedAt).toLocaleString("zh-CN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
