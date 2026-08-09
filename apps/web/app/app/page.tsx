"use client";

import { useEffect, useMemo, useState } from "react";
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
  const [form, setForm] = useState({ subject: "", limit: 10, mode: "PRACTICE" as "PRACTICE" | "EXAM", durationMin: 40, paperId: "", knowledgePointId: "", difficulty: "" });
  const [papers, setPapers] = useState<{ id: string; title: string; mode: string; questionCount: number; subject: string; kind?: string; sourceType?: string | null; source?: string | null }[]>([]);
  // 试卷库筛选/排序(与教师端试卷管理一致)
  const [libSubject, setLibSubject] = useState("");
  const [libKind, setLibKind] = useState("");
  const [libSort, setLibSort] = useState<"createdDesc" | "nameAsc" | "nameDesc">("createdDesc");
  const [allKps, setAllKps] = useState<{ id: string; name: string; subject: string }[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [allSessions, setAllSessions] = useState<SessionSummary[]>([]);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // 我的作业(教师布置的作业/考试)
  const [assignments, setAssignments] = useState<{
    id: string; title: string; note: string | null; mode: string; dueAt: string | null;
    status: string; submittedAt: string | null; sessionId: string | null; isLanguage?: boolean;
    paper: { title: string; mode: string; durationMin: number | null; subject: string | null; sourceType: string | null; isLanguage?: boolean; examType?: string | null; skill?: string | null } | null;
  }[]>([]);

  useEffect(() => {
    api.get<{ list: SessionSummary[] }>("/me/sessions").then((d) => {
      setSessions(d.list.slice(0, 5));
      setAllSessions(d.list);
    }).catch(() => {});
    api.get<StatsData>("/me/stats").then(setStats).catch(() => {});
    api.get<{ list: { id: string; title: string; mode: string; questionCount: number; subject: string; kind?: string; sourceType?: string | null; source?: string | null }[] }>("/papers").then((d) => setPapers(d.list)).catch(() => {});
    // 我的作业(教师布置的作业/考试)
    api.get<{ list: any[] }>("/me/assignments").then((d) => setAssignments(d.list || [])).catch(() => {});
    // 知识点库(供知识点下拉与掌握度"针对练习")
    api.get<{ list: { id: string; name: string; subject: string }[] }>("/knowledge-points").then((d) => setAllKps(d.list || [])).catch(() => {});
  }, []);

  async function start() {
    setError("");
    setLoading(true);
    try {
      const data = await api.post<CreateSessionData>("/sessions", {
        mode: form.mode,
        limit: form.limit,
        subject: form.subject || undefined,
        knowledgePointId: form.knowledgePointId || undefined,
        difficulty: form.difficulty || undefined,
        // 指定试卷的模拟考:时长用试卷设定(不传,后端强制取试卷时长)
        durationMin: form.mode === "EXAM" && !form.paperId ? form.durationMin : undefined,
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

  // 针对某个知识点发起练习(10 题)
  async function practiceTopic(topic: string) {
    const kp = allKps.find((k) => k.name === topic);
    if (!kp) return;
    setError("");
    setLoading(true);
    try {
      const data = await api.post<CreateSessionData>("/sessions", { mode: "PRACTICE", limit: 10, knowledgePointId: kp.id });
      sessionStorage.setItem(`session-${data.sessionId}`, JSON.stringify(data.questions));
      router.push(`/app/practice/${data.sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setLoading(false);
    }
  }

  // 从试卷库直接开始一张卷(PRACTICE 卷练题 / EXAM 卷模考,时长跟随试卷)
  async function startPaper(p: { id: string; title: string; mode: string; questionCount: number }) {
    setError("");
    setLoading(true);
    try {
      const data = await api.post<CreateSessionData>("/sessions", {
        mode: p.mode === "EXAM" ? "EXAM" : "PRACTICE",
        paperId: p.id,
      });
      sessionStorage.setItem(`session-${data.sessionId}`, JSON.stringify(data.questions));
      router.push(`/app/practice/${data.sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "开卷失败");
    } finally {
      setLoading(false);
    }
  }

  // 开始教师布置的作业/考试(带 assignmentId,试卷/时长/DDL 由作业决定,提交后自动回写完成状态)
  async function startAssignment(a: { id: string; title: string; mode: string; isLanguage?: boolean; paper: { title: string; mode: string; durationMin: number | null } | null }) {
    setError("");
    setLoading(true);
    try {
      if (a.isLanguage) {
        // 语言作业走语言开卷接口,落地到语言练习页
        const data = await api.post<{ sessionId: string; mode: string; durationMin: number | null; segments: any[]; questions: any[] }>("/language/sessions", { assignmentId: a.id });
        sessionStorage.setItem(`lang-session-${data.sessionId}`, JSON.stringify(data));
        router.push(`/app/language/practice/${data.sessionId}`);
      } else {
        const data = await api.post<CreateSessionData>("/sessions", {
          mode: a.mode === "EXAM" ? "EXAM" : "PRACTICE",
          assignmentId: a.id,
        });
        sessionStorage.setItem(`session-${data.sessionId}`, JSON.stringify(data.questions));
        router.push(`/app/practice/${data.sessionId}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "开卷失败");
    } finally {
      setLoading(false);
    }
  }

  // 试卷库:筛选(学科/套题类型) + 排序(最新/名称自然序),与教师端一致
  const libPapers = useMemo(() => {
    let arr = papers.filter((p) => {
      if (libSubject && p.subject !== libSubject) return false;
      if (libKind && p.kind !== libKind) return false;
      return true;
    });
    if (libSort === "nameAsc" || libSort === "nameDesc") {
      const dir = libSort === "nameAsc" ? 1 : -1;
      arr = [...arr].sort((a, b) => dir * String(a.title).localeCompare(String(b.title), undefined, { numeric: true, sensitivity: "base" }));
    }
    return arr;
  }, [papers, libSubject, libKind, libSort]);

  const input =
    "h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-sm outline-none focus:border-indigo-500 ui-select";

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
            <select className={`${input} ui-select`} value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as "PRACTICE" | "EXAM" })}>
              <option value="PRACTICE">练习(不限时)</option>
              <option value="EXAM">模拟考(限时)</option>
            </select>
          </div>
          {papers.length > 0 && (
            <div>
              <label className="mb-1 block text-sm text-slate-600">试卷</label>
              <select className={`${input} ui-select`} value={form.paperId} onChange={(e) => setForm({ ...form, paperId: e.target.value })}>
                <option value="">随机组卷</option>
                {papers.filter((p) => p.mode === form.mode).map((p) => (
                  <option key={p.id} value={p.id}>{p.title}({p.questionCount}题)</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="mb-1 block text-sm text-slate-600">科目</label>
            <select className={input} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value, knowledgePointId: "" })}>
              <option value="">全部</option>
              <option value="TMUA">TMUA</option>
              <option value="ESAT">ESAT</option>
              <option value="数学">数学</option>
              <option value="物理">物理</option>
              <option value="化学">化学</option>
              <option value="生物">生物</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">知识点</label>
            <select className={`${input} max-w-[220px]`} value={form.knowledgePointId} onChange={(e) => setForm({ ...form, knowledgePointId: e.target.value })}>
              <option value="">全部知识点</option>
              {(() => {
                const pool = form.subject === "TMUA" ? ["数学"] : form.subject === "ESAT" ? ["数学", "物理"] : form.subject ? [form.subject] : null;
                const list = pool ? allKps.filter((k) => pool.includes(k.subject)) : allKps;
                return list.map((kp) => (
                  <option key={kp.id} value={kp.id}>{pool ? kp.name : `[${kp.subject}] ${kp.name}`}</option>
                ));
              })()}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">难度</label>
            <select className={input} value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })}>
              <option value="">全部难度</option>
              <option value="1">难度 1</option>
              <option value="2">难度 2</option>
              <option value="3">难度 3</option>
              <option value="4">难度 4</option>
              <option value="5">难度 5</option>
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
          {form.mode === "EXAM" && !form.paperId && (
            <div>
              <label className="mb-1 block text-sm text-slate-600">时长</label>
              <select className={`${input} ui-select`} value={form.durationMin} onChange={(e) => setForm({ ...form, durationMin: Number(e.target.value) })}>
                {[25, 40, 60].map((n) => (
                  <option key={n} value={n}>{n} 分钟</option>
                ))}
              </select>
            </div>
          )}
          {form.mode === "EXAM" && form.paperId && (
            <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm text-indigo-700">
              时长跟随所选试卷设定,不可修改
            </div>
          )}
          <button
            onClick={start}
            disabled={loading}
            className="h-9 rounded-lg bg-indigo-600 px-6 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-60"
          >
            {loading ? "组卷中..." : form.mode === "EXAM" ? "开始模拟考" : "开始练习"}
          </button>
        </div>
        {form.mode === "EXAM" && <p className="mt-3 text-xs text-slate-400">模拟考模式下,时间到将自动交卷,超时后无法继续作答。</p>}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>

      {/* 我的作业:教师布置的作业/考试,带 DDL,点击直接开始 */}
      {assignments.length > 0 && (
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-6 shadow-sm">
          <h2 className="text-sm font-medium text-indigo-700">我的作业</h2>
          <p className="mt-0.5 text-xs text-indigo-400">老师布置的练习/模考,请在截止时间前完成。</p>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            {assignments.map((a) => {
              const overdue = a.dueAt && new Date(a.dueAt).getTime() < Date.now();
              const statusLabel =
                a.status === "SUBMITTED" ? "已提交" :
                a.status === "IN_PROGRESS" ? "进行中" :
                a.status === "EXPIRED" || overdue ? "已过期" : "待完成";
              const canStart = a.status !== "SUBMITTED" && !(a.status === "EXPIRED" || overdue);
              return (
                <div key={a.id} className="rounded-xl border border-indigo-100 bg-white p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-slate-800" title={a.title}>{a.title}</p>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        a.status === "SUBMITTED" ? "bg-emerald-50 text-emerald-600"
                        : overdue ? "bg-red-50 text-red-600"
                        : a.status === "IN_PROGRESS" ? "bg-blue-50 text-blue-600"
                        : "bg-amber-50 text-amber-600"
                      }`}
                    >
                      {statusLabel}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {a.paper?.title ?? "试卷"} · {a.isLanguage ? "语言" : a.mode === "EXAM" ? "模考" : "练习"}
                    {a.mode === "EXAM" && a.paper?.durationMin ? ` · ${a.paper.durationMin} 分钟` : ""}
                  </p>
                  {a.note && <p className="mt-1 truncate text-xs text-slate-400" title={a.note}>备注:{a.note}</p>}
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-xs text-slate-500">
                      {a.dueAt ? `DDL:${new Date(a.dueAt).toLocaleString("zh-CN", { hour12: false })}` : "不限时"}
                    </span>
                    {canStart ? (
                      <button
                        onClick={() => startAssignment(a)}
                        disabled={loading}
                        className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {a.status === "IN_PROGRESS" ? "继续作答 →" : "开始作答 →"}
                      </button>
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 试卷库:与教师端试卷管理一致的筛选(学科/套题类型) + 排序,点击直接开卷 */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <h2 className="mr-2 text-sm font-medium text-slate-700">试卷库</h2>
          {[{ v: "", l: "全部" }, { v: "数学", l: "数学" }, { v: "物理", l: "物理" }, { v: "化学", l: "化学" }, { v: "生物", l: "生物" }].map((t) => (
            <button
              key={t.v}
              onClick={() => setLibSubject(t.v)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                libSubject === t.v ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {t.l}
            </button>
          ))}
          <span className="mx-1 text-xs text-slate-300">|</span>
          {[{ v: "", l: "全部套题" }, { v: "OFFICIAL", l: "原版套题" }, { v: "CUSTOM", l: "组卷套题" }].map((t) => (
            <button
              key={t.v}
              onClick={() => setLibKind(t.v)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                libKind === t.v ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {t.l}
            </button>
          ))}
          <select
            value={libSort}
            onChange={(e) => setLibSort(e.target.value as "createdDesc" | "nameAsc" | "nameDesc")}
            className="ml-auto h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-600 outline-none focus:border-indigo-500 ui-select"
            aria-label="排序方式"
          >
            <option value="createdDesc">最新优先</option>
            <option value="nameAsc">名称 A→Z</option>
            <option value="nameDesc">名称 Z→A</option>
          </select>
        </div>

        {libPapers.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">该分类下暂无试卷。</p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            {libPapers.map((p) => (
              <button
                key={p.id}
                onClick={() => startPaper(p)}
                disabled={loading}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-indigo-300 hover:bg-indigo-50/40 disabled:opacity-60"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-slate-800" title={p.title}>{p.title}</p>
                    {p.kind === "OFFICIAL" ? (
                      <span className="shrink-0 rounded bg-teal-50 px-1.5 py-0.5 text-[11px] font-medium text-teal-600">原版</span>
                    ) : (
                      <span className="shrink-0 rounded bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-600">组卷</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {p.questionCount} 题 · {p.mode === "EXAM" ? "模拟考" : "练习"}
                    {p.sourceType ? ` · ${p.sourceType}` : ""}
                    {p.subject ? ` · ${p.subject}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-xs font-medium text-indigo-600">{p.mode === "EXAM" ? "开始模考 →" : "开始练习 →"}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {stats && stats.totalAnswered > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-medium text-slate-700">知识点掌握度</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
            {stats.byTopic.map((t) => (
              <div key={t.topic} className="rounded-xl bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-slate-800">{t.topic}</p>
                  {allKps.some((k) => k.name === t.topic) && (
                    <button
                      onClick={() => practiceTopic(t.topic)}
                      disabled={loading}
                      title="针对该知识点练 10 题"
                      className="shrink-0 rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      练习
                    </button>
                  )}
                </div>
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
