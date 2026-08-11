"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { RadarChart, PolarGrid, PolarAngleAxis, Radar, Tooltip, ResponsiveContainer } from "recharts";
import { api } from "@/lib/api";

interface Detail {
  student: { id: string; name: string; email: string; createdAt: string };
  sessions: {
    id: string; mode: string; score: number | null; total: number | null; correctCount: number | null;
    startedAt: string; submittedAt: string | null;
    assignmentId: string | null;
    paper: { title: string | null; subject: string | null; sourceType: string | null; mode: string | null } | null;
    durationSec: number | null; status: "DONE" | "IN_PROGRESS";
  }[];
  byTopic: { topic: string; attempts: number; correctRate: number }[];
}

function fmtDur(sec: number | null) {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}
function fmtTime(done: string | null, started: string) {
  const v = done || started;
  return new Date(v).toLocaleString("zh-CN") + (done ? "" : " (进行中)");
}

export default function StudentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [modeF, setModeF] = useState<"ALL" | "EXAM" | "PRACTICE">("ALL");

  useEffect(() => {
    api.get<Detail>(`/teacher/students/${id}/stats`).then(setDetail).catch((e) => setError(e.message));
  }, [id]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!detail) return <p className="text-sm text-slate-500">加载中...</p>;

  const filtered = detail.sessions.filter((s) => modeF === "ALL" || s.mode === modeF);

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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-slate-700">做题情况(考试 + 练习,{detail.sessions.length})</h2>
          <div className="flex gap-1">
            {([["ALL", "全部"], ["EXAM", "模拟考"], ["PRACTICE", "自主练习"]] as const).map(([v, l]) => (
              <button
                key={v}
                onClick={() => setModeF(v)}
                className={`rounded-md px-2 py-1 text-xs font-medium ${modeF === v ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        {detail.sessions.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">暂无做题记录</p>
        ) : filtered.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">该筛选下暂无记录</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-slate-400">
                  <th className="pb-2 font-normal">来源</th>
                  <th className="pb-2 font-normal">类型</th>
                  <th className="pb-2 font-normal">完成时间</th>
                  <th className="pb-2 font-normal">完成用时</th>
                  <th className="pb-2 font-normal">得分</th>
                  <th className="pb-2 font-normal">正确率</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  const isAssignment = !!s.assignmentId;
                  const src = s.paper?.title || (s.mode === "EXAM" ? "模拟考" : "练习");
                  return (
                    <tr key={s.id} className="border-b border-slate-50">
                      <td className="py-2.5">
                        <div className="font-medium text-slate-800">{src}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1">
                          {s.paper?.subject && <span className="rounded bg-slate-100 px-1 py-0.5 text-xs text-slate-500">{s.paper.subject}</span>}
                          {s.paper?.sourceType && <span className="rounded bg-teal-50 px-1 py-0.5 text-xs text-teal-700">{s.paper.sourceType}</span>}
                        </div>
                      </td>
                      <td className="py-2.5">
                        <span className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${s.mode === "EXAM" ? "bg-indigo-50 text-indigo-700" : "bg-emerald-50 text-emerald-700"}`}>{s.mode === "EXAM" ? "模拟考" : "练习"}</span>
                        <span className={`ml-1 rounded-md px-1.5 py-0.5 text-xs font-medium ${isAssignment ? "bg-amber-50 text-amber-700" : "bg-slate-50 text-slate-500"}`}>{isAssignment ? "作业" : "自主"}</span>
                      </td>
                      <td className="py-2.5 text-slate-500">{fmtTime(s.submittedAt, s.startedAt)}</td>
                      <td className="py-2.5 text-slate-500">{s.status === "DONE" ? fmtDur(s.durationSec) : "进行中"}</td>
                      <td className="py-2.5">{s.score} / {s.total}</td>
                      <td className="py-2.5">{s.total ? Math.round((s.score! / s.total) * 100) : 0}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
