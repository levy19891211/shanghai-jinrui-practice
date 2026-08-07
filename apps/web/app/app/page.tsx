"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  RadarChart, PolarGrid, PolarAngleAxis, Radar,
} from "recharts";
import { api, getUser } from "@/lib/api";
import type { CreateSessionData, SessionSummary, StatsData } from "@/lib/types";

export default function StudentHome() {
  const router = useRouter();
  const user = getUser();
  const [form, setForm] = useState({ subject: "", limit: 10, mode: "PRACTICE" as "PRACTICE" | "EXAM", durationMin: 40, paperId: "" });
  const [papers, setPapers] = useState<{ id: string; title: string; mode: string; questionCount: number }[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [allSessions, setAllSessions] = useState<SessionSummary[]>([]);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get<{ list: SessionSummary[] }>("/me/sessions").then((d) => {
      setSessions(d.list.slice(0, 5));
      setAllSessions(d.list);
    }).catch(() => {});
    api.get<StatsData>("/me/stats").then(setStats).catch(() => {});
    api.get<{ list: { id: string; title: string; mode: string; questionCount: number }[] }>("/papers").then((d) => setPapers(d.list)).catch(() => {});
  }, []);

  async function start() {
    setError("");
    setLoading(true);
    try {
      const data = await api.post<CreateSessionData>("/sessions", {
        mode: form.mode,
        limit: form.limit,
        subject: form.subject || undefined,
        durationMin: form.mode === "EXAM" ? form.durationMin : undefined,
        paperId: form.paperId || undefined,
      });
      sessionStorage.setItem(`session-${data.sessionId}`, JSON.stringify(data.questions));
      router.push(`/app/practice/${data.sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setLoading(false);
    }
  }

  const input =
    "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500";

  // 成绩趋势数据(已提交且有总分的会话,按时间升序,最近 10 次)
  const trendData = allSessions
    .filter((s) => s.submittedAt && s.total && s.total > 0 && typeof s.score === "number")
    .slice()
    .reverse()
    .slice(-10)
    .map((s, i) => ({
      name: `${i + 1}`,
      rate: Math.round((s.score! / s.total!) * 100),
      mode: s.mode === "EXAM" ? "模考" : "练习",
    }));

  // 掌握度雷达数据
  const radarData = (stats?.byTopic ?? [])
    .filter((t) => typeof t.correctRate === "number")
    .map((t) => ({ topic: t.topic, rate: t.correctRate }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">你好,{user?.name}</h1>
        <p className="mt-1 text-sm text-slate-500">选择科目与题量,开始今天的练习吧。</p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-medium text-slate-700">开始练习</h2>
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1 block text-sm text-slate-600">模式</label>
            <select className={input} value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as "PRACTICE" | "EXAM" })}>
              <option value="PRACTICE">练习(不限时)</option>
              <option value="EXAM">模拟考(限时)</option>
            </select>
          </div>
          {papers.length > 0 && (
            <div>
              <label className="mb-1 block text-sm text-slate-600">试卷</label>
              <select className={input} value={form.paperId} onChange={(e) => setForm({ ...form, paperId: e.target.value })}>
                <option value="">随机组卷</option>
                {papers.filter((p) => p.mode === form.mode).map((p) => (
                  <option key={p.id} value={p.id}>{p.title}({p.questionCount}题)</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="mb-1 block text-sm text-slate-600">科目</label>
            <select className={input} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })}>
              <option value="">全部</option>
              <option value="TMUA">TMUA</option>
              <option value="ESAT">ESAT</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">题量</label>
            <select className={input} value={form.limit} onChange={(e) => setForm({ ...form, limit: Number(e.target.value) })}>
              {[5, 10, 20].map((n) => (
                <option key={n} value={n}>{n} 题</option>
              ))}
            </select>
          </div>
          {form.mode === "EXAM" && (
            <div>
              <label className="mb-1 block text-sm text-slate-600">时长</label>
              <select className={input} value={form.durationMin} onChange={(e) => setForm({ ...form, durationMin: Number(e.target.value) })}>
                {[25, 40, 60].map((n) => (
                  <option key={n} value={n}>{n} 分钟</option>
                ))}
              </select>
            </div>
          )}
          <button
            onClick={start}
            disabled={loading}
            className="rounded-lg bg-indigo-600 px-6 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-60"
          >
            {loading ? "组卷中..." : form.mode === "EXAM" ? "开始模拟考" : "开始练习"}
          </button>
        </div>
        {form.mode === "EXAM" && <p className="mt-3 text-xs text-slate-400">模拟考模式下,时间到将自动交卷,超时后无法继续作答。</p>}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>

      {stats && stats.totalAnswered > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-medium text-slate-700">知识点掌握度</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
            {stats.byTopic.map((t) => (
              <div key={t.topic} className="rounded-xl bg-slate-50 p-4">
                <p className="text-sm font-medium text-slate-800">{t.topic}</p>
                <p className="mt-1 text-xs text-slate-500">作答 {t.attempts} 次</p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={`h-full rounded-full ${t.correctRate >= 70 ? "bg-emerald-500" : t.correctRate >= 40 ? "bg-amber-500" : "bg-red-500"}`}
                    style={{ width: `${t.correctRate}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-slate-600">正确率 {t.correctRate}%</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {trendData.length >= 2 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-medium text-slate-700">成绩趋势(正确率 %)</h2>
          <div className="mt-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 5, right: 10, bottom: 0, left: -20 }}>
                <XAxis dataKey="name" tick={{ fontSize: 12 }} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} label={{ value: "第 N 次", position: "insideBottomRight", offset: -2, fontSize: 11, fill: "#94a3b8" }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v: number) => [`${v}%`, "正确率"]} labelFormatter={(l) => `第 ${l} 次`} />
                <Line type="monotone" dataKey="rate" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {radarData.length >= 3 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-medium text-slate-700">知识点掌握度雷达图</h2>
          <div className="mt-2 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} outerRadius="70%">
                <PolarGrid stroke="#e2e8f0" />
                <PolarAngleAxis dataKey="topic" tick={{ fontSize: 11, fill: "#475569" }} />
                <Radar dataKey="rate" stroke="#6366f1" fill="#6366f1" fillOpacity={0.25} />
                <Tooltip formatter={(v: number) => [`${v}%`, "正确率"]} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-slate-700">最近成绩</h2>
          <button onClick={() => router.push("/app/sessions")} className="text-sm text-indigo-600 hover:underline">
            查看全部
          </button>
        </div>
        {sessions.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">还没有练习记录,先做几道题吧。</p>
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
              {sessions.map((s) => (
                <tr key={s.id} className="border-b border-slate-50">
                  <td className="py-2">{s.mode === "EXAM" ? "模拟考" : "练习"}</td>
                  <td className="py-2">{s.score} / {s.total}</td>
                  <td className="py-2">{s.total ? Math.round((s.score! / s.total) * 100) : 0}%</td>
                  <td className="py-2 text-slate-500">{new Date(s.startedAt).toLocaleString("zh-CN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
