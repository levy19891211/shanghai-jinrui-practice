"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  RadarChart, PolarGrid, PolarAngleAxis, Radar,
} from "recharts";
import { api, getUser } from "@/lib/api";
import { renderRich } from "@/lib/rich";
import type { SessionSummary, WrongItem } from "@/lib/types";

type Assignment = {
  id: string;
  title: string;
  note: string | null;
  mode: string;
  dueAt: string | null;
  status: string;
  submittedAt: string | null;
  sessionId: string | null;
  isLanguage?: boolean;
  paper: {
    title: string; mode: string; durationMin: number | null; subject: string | null;
    sourceType: string | null; isLanguage?: boolean; examType?: string | null; skill?: string | null;
  } | null;
};

type LangSession = {
  id: string;
  examType: string;
  skill: string;
  mode: string;
  score: number | null;
  total: number | null;
  correctCount: number | null;
  band: number | null;
  startedAt: string;
  submittedAt: string | null;
  paper: { title: string } | null;
};

const EXAM_LABEL: Record<string, string> = { IELTS: "雅思", TOEFL: "托福", KET_PET: "剑桥KET/PET", OTHER: "其他语言" };
const SKILL_LABEL: Record<string, string> = { LISTENING: "听力", READING: "阅读", WRITING: "写作", SPEAKING: "口语", FULL: "全真连考" };
const SKILL_COLOR: Record<string, string> = {
  LISTENING: "#1f6fb2", READING: "#2e6f40", WRITING: "#b8860b", SPEAKING: "#7a3b8f", FULL: "#a14a3a",
};

type Tab = "assignments" | "grades" | "weak" | "wrong";

export default function PersonalSpacePage() {
  const router = useRouter();
  const user = getUser();
  const [tab, setTab] = useState<Tab>("assignments");

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [subjectSessions, setSubjectSessions] = useState<SessionSummary[]>([]);
  const [langSessions, setLangSessions] = useState<LangSession[]>([]);
  const [byTopic, setByTopic] = useState<{ topic: string; attempts: number; correctRate: number }[]>([]);
  const [totalAnswered, setTotalAnswered] = useState(0);
  const [wrongList, setWrongList] = useState<WrongItem[]>([]);
  const [allKps, setAllKps] = useState<{ id: string; name: string; subject: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [subjectTab, setSubjectTab] = useState("");
  const [openSolutions, setOpenSolutions] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [a, s, ls, stats, w, kps] = await Promise.all([
          api.get<{ list: Assignment[] }>("/me/assignments").catch(() => ({ list: [] as Assignment[] })),
          api.get<{ list: SessionSummary[] }>("/me/sessions").catch(() => ({ list: [] as SessionSummary[] })),
          api.get<{ list: LangSession[] }>("/language/sessions").catch(() => ({ list: [] as LangSession[] })),
          api.get<{ byTopic: { topic: string; attempts: number; correctRate: number }[]; totalAnswered: number }>("/me/stats").catch(() => ({ byTopic: [], totalAnswered: 0 })),
          api.get<{ list: WrongItem[] }>("/me/wrongbook").catch(() => ({ list: [] as WrongItem[] })),
          api.get<{ list: { id: string; name: string; subject: string }[] }>("/knowledge-points").catch(() => ({ list: [] as { id: string; name: string; subject: string }[] })),
        ]);
        setAssignments(a.list || []);
        setSubjectSessions(s.list || []);
        setLangSessions(ls.list || []);
        setByTopic(stats.byTopic || []);
        setTotalAnswered(stats.totalAnswered || 0);
        setWrongList(w.list || []);
        setAllKps(kps.list || []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "加载失败");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function fmtDue(s?: string | null) {
    if (!s) return "不限时";
    const d = new Date(s);
    return `DDL ${d.toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`;
  }
  function statusLabel(a: Assignment) {
    const overdue = a.dueAt && new Date(a.dueAt).getTime() < Date.now();
    if (a.status === "SUBMITTED") return "已提交";
    if (a.status === "IN_PROGRESS") return "进行中";
    if (a.status === "EXPIRED" || overdue) return "已过期";
    return "待完成";
  }

  // 开作业:学科走 /sessions,语言走 /language/sessions
  async function startAssignment(a: Assignment) {
    setError("");
    setBusyId(a.id);
    try {
      if (a.isLanguage) {
        const data = await api.post<{ sessionId: string }>("/language/sessions", { assignmentId: a.id });
        sessionStorage.setItem(`lang-session-${data.sessionId}`, JSON.stringify(data));
        router.push(`/app/language/practice/${data.sessionId}`);
      } else {
        const data = await api.post<{ sessionId: string; questions: unknown[] }>("/sessions", {
          mode: a.mode === "EXAM" ? "EXAM" : "PRACTICE",
          assignmentId: a.id,
        });
        sessionStorage.setItem(`session-${data.sessionId}`, JSON.stringify(data.questions));
        router.push(`/app/practice/${data.sessionId}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "开卷失败");
    } finally {
      setBusyId(null);
    }
  }

  // 针对某个知识点练习
  async function practiceTopic(topic: string) {
    const kp = allKps.find((k) => k.name === topic);
    if (!kp) return;
    setBusyId(`kp:${topic}`);
    try {
      const data = await api.post<{ sessionId: string; questions: unknown[] }>("/sessions", { mode: "PRACTICE", limit: 10, knowledgePointId: kp.id });
      sessionStorage.setItem(`session-${data.sessionId}`, JSON.stringify(data.questions));
      router.push(`/app/practice/${data.sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setBusyId(null);
    }
  }

  const pendingAssigns = assignments.filter((a) => a.status === "PENDING" || a.status === "IN_PROGRESS");
  const pastAssigns = assignments.filter((a) => a.status === "SUBMITTED" || a.status === "EXPIRED" || (a.dueAt && new Date(a.dueAt).getTime() < Date.now()));
  const sessById = useMemo(() => {
    const m = new Map<string, SessionSummary>();
    subjectSessions.forEach((s) => m.set(s.id, s));
    return m;
  }, [subjectSessions]);

  // 成绩趋势(学科会话,有得分)
  const trendData = subjectSessions
    .filter((s) => s.submittedAt && s.total && s.total > 0 && typeof s.score === "number")
    .slice().reverse().slice(-10)
    .map((s, i) => ({ name: `${i + 1}`, rate: Math.round((s.score! / s.total!) * 100), mode: s.mode === "EXAM" ? "模考" : "练习" }));

  const radarData = byTopic.filter((t) => typeof t.correctRate === "number").map((t) => ({ topic: t.topic, rate: t.correctRate }));
  const weakTopics = useMemo(() => [...byTopic].sort((a, b) => a.correctRate - b.correctRate), [byTopic]);

  // 错题本
  const visibleWrong = subjectTab ? wrongList.filter((w) => (subjectTab === "数学" ? w.subject === "数学" || w.subject === "TMUA" : w.subject === subjectTab)) : wrongList;
  const pendingWrong = visibleWrong.filter((w) => !w.mastered);
  const masteredWrong = visibleWrong.filter((w) => w.mastered);

  function toggleSolution(qid: string) {
    setOpenSolutions((prev) => {
      const next = new Set(prev);
      if (next.has(qid)) next.delete(qid); else next.add(qid);
      return next;
    });
  }
  async function markMastered(qid: string) {
    await api.post(`/me/wrongbook/${qid}/master`);
    setWrongList((prev) => prev.map((w) => (w.questionId === qid ? { ...w, mastered: true } : w)));
  }

  const tabBtn = (t: Tab, icon: string, label: string, count?: number) => (
    <button
      key={t}
      onClick={() => setTab(t)}
      className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition ${
        tab === t
          ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
          : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 hover:text-slate-800"
      }`}
    >
      <span className="text-base leading-none">{icon}</span>
      {label}
      {typeof count === "number" && count > 0 && (
        <span className={`ml-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold ${tab === t ? "bg-white/25 text-white" : "bg-indigo-100 text-indigo-600"}`}>{count}</span>
      )}
    </button>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-800">个人空间</h1>
        <p className="mt-1 text-sm text-slate-500">{user?.name}，这里汇总了你的作业、成绩、薄弱点与错题。</p>
      </div>

      <div className="flex flex-wrap gap-3">
        {tabBtn("assignments", "📌", "我的作业", pendingAssigns.length)}
        {tabBtn("grades", "📈", "成绩历史", subjectSessions.length + langSessions.length)}
        {tabBtn("weak", "🎯", "薄弱知识点", weakTopics.filter((t) => t.correctRate < 70).length)}
        {tabBtn("wrong", "📒", "错题本", pendingWrong.length)}
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
      {loading && <p className="py-10 text-center text-slate-400">加载中...</p>}

      {!loading && tab === "assignments" && (
        <div className="space-y-6">
          {/* 待完成/进行中 */}
          <section>
            <h2 className="mb-3 text-base font-bold text-slate-700">📌 待完成作业 ({pendingAssigns.length})</h2>
            {pendingAssigns.length === 0 ? (
              <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">暂无待完成的作业,去练习区放松一下吧~</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {pendingAssigns.map((a) => {
                  const overdue = a.dueAt && new Date(a.dueAt).getTime() < Date.now();
                  const canStart = a.status !== "SUBMITTED" && !(a.status === "EXPIRED" || overdue);
                  const cardCls =
                    "flex items-center justify-between gap-4 rounded-2xl border p-4 shadow-sm transition " +
                    (canStart
                      ? "cursor-pointer border-indigo-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/40"
                      : "border-slate-200 bg-slate-50");
                  const inner = (
                    <>
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap items-center gap-1.5">
                          <span className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${a.status === "IN_PROGRESS" ? "bg-blue-100 text-blue-700" : overdue ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-700"}`}>{statusLabel(a)}</span>
                          {a.isLanguage && a.paper?.examType && (
                            <span className="rounded-md px-1.5 py-0.5 text-xs font-medium text-white" style={{ background: SKILL_COLOR[a.paper.skill || "FULL"] || "#666" }}>
                              {EXAM_LABEL[a.paper.examType] || a.paper.examType}·{SKILL_LABEL[a.paper.skill || "FULL"] || a.paper.skill}
                            </span>
                          )}
                          {!a.isLanguage && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">{a.mode === "EXAM" ? "模考" : "练习"}</span>}
                        </div>
                        <p className="truncate text-sm font-semibold text-slate-800">{a.title}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {a.paper?.title ?? "试卷"}
                          {a.mode === "EXAM" && a.paper?.durationMin ? ` · 限时 ${a.paper.durationMin} 分钟` : ""} · {fmtDue(a.dueAt)}
                        </p>
                        {a.note && <p className="mt-1 truncate text-xs text-slate-400">备注: {a.note}</p>}
                      </div>
                      {busyId === a.id ? (
                        <span className="shrink-0 text-sm font-medium text-indigo-400">开卷中...</span>
                      ) : canStart ? (
                        <span className="shrink-0 whitespace-nowrap text-sm font-medium text-indigo-600">
                          {a.status === "IN_PROGRESS" ? "继续作答 →" : "开始作答 →"}
                        </span>
                      ) : null}
                    </>
                  );
                  return canStart ? (
                    <button key={a.id} onClick={() => startAssignment(a)} disabled={!!busyId} className={cardCls}>
                      {inner}
                    </button>
                  ) : (
                    <div key={a.id} className={cardCls}>
                      {inner}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* 往期作业表现 */}
          <section>
            <h2 className="mb-3 text-base font-bold text-slate-700">📋 往期作业表现 ({pastAssigns.length})</h2>
            {pastAssigns.length === 0 ? (
              <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">还没有已提交的作业记录。</p>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-400">
                    <tr>
                      <th className="px-4 py-3 font-normal">作业</th>
                      <th className="px-4 py-3 font-normal">类型</th>
                      <th className="px-4 py-3 font-normal">状态</th>
                      <th className="px-4 py-3 font-normal">成绩</th>
                      <th className="px-4 py-3 font-normal">提交时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pastAssigns.map((a) => {
                      const sess = a.sessionId ? sessById.get(a.sessionId) : undefined;
                      const rate = sess && sess.total ? Math.round((sess.score! / sess.total) * 100) : null;
                      return (
                        <tr key={a.id} className="border-t border-slate-100">
                          <td className="px-4 py-3 font-medium text-slate-700">{a.title}</td>
                          <td className="px-4 py-3">{a.isLanguage ? "语言" : a.mode === "EXAM" ? "模考" : "练习"}</td>
                          <td className="px-4 py-3">
                            <span className={`rounded-full px-2 py-0.5 text-xs ${a.status === "SUBMITTED" ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"}`}>{statusLabel(a)}</span>
                          </td>
                          <td className="px-4 py-3">{rate !== null ? `${sess!.score} / ${sess!.total} (${rate}%)` : "—"}</td>
                          <td className="px-4 py-3 text-slate-500">{a.submittedAt ? new Date(a.submittedAt).toLocaleString("zh-CN") : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {!loading && tab === "grades" && (
        <div className="space-y-6">
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

          {/* 学科成绩历史 + 语言成绩历史 合并 */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-medium text-slate-700">全部成绩记录 ({subjectSessions.length + langSessions.length})</h2>
            {subjectSessions.length + langSessions.length === 0 ? (
              <p className="mt-4 text-sm text-slate-400">暂无记录。</p>
            ) : (
              <div className="mt-4 space-y-2">
                {langSessions.map((s) => (
                  <div key={`L${s.id}`} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                    <span className="shrink-0 rounded-md bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">语言</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-700">{s.paper?.title || "语言练习"}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{EXAM_LABEL[s.examType] || s.examType} · {SKILL_LABEL[s.skill] || s.skill} · {new Date(s.startedAt).toLocaleString("zh-CN", { hour12: false })}</p>
                    </div>
                    <div className="text-right">
                      {s.band !== null && s.band !== undefined ? (
                        <span className="text-sm font-bold text-indigo-600">Band {s.band}</span>
                      ) : s.submittedAt ? (
                        <span className="text-xs text-amber-600">待教师批改</span>
                      ) : (
                        <span className="text-xs text-slate-400">未提交</span>
                      )}
                      {s.correctCount !== null && s.total ? <span className="block text-xs text-slate-400">{s.correctCount}/{s.total}</span> : null}
                    </div>
                    {s.submittedAt && (
                      <button onClick={() => router.push(`/app/language/practice/${s.id}`)} className="shrink-0 text-xs text-indigo-600 hover:underline">查看</button>
                    )}
                  </div>
                ))}
                {subjectSessions.map((s) => (
                  <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                    <span className="shrink-0 rounded-md bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">{s.mode === "EXAM" ? "模考" : "练习"}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-700">{s.total ? `${s.score} / ${s.total}` : "—"}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{s.total ? `正确率 ${Math.round((s.score! / s.total) * 100)}%` : ""} · {new Date(s.startedAt).toLocaleString("zh-CN")}</p>
                    </div>
                    {s.submittedAt && (
                      <button onClick={() => router.push(`/app/practice/${s.id}`)} className="shrink-0 text-xs text-indigo-600 hover:underline">查看</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {!loading && tab === "weak" && (
        <div className="space-y-6">
          {totalAnswered === 0 ? (
            <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">还没有作答记录,先做几道题,系统会分析你的薄弱知识点。</p>
          ) : (
            <>
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
                <h2 className="text-sm font-medium text-slate-700">薄弱知识点(按正确率升序)</h2>
                <p className="mt-1 text-xs text-slate-400">正确率低于 70% 的知识点建议重点练习。</p>
                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                  {weakTopics.map((t) => (
                    <div key={t.topic} className="rounded-xl bg-slate-50 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-slate-800">{t.topic}</p>
                        {allKps.some((k) => k.name === t.topic) && (
                          <button
                            onClick={() => practiceTopic(t.topic)}
                            disabled={!!busyId}
                            className="shrink-0 rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                          >
                            针对练习
                          </button>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">作答 {t.attempts} 次</p>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                        <div className={`h-full rounded-full ${t.correctRate >= 70 ? "bg-emerald-500" : t.correctRate >= 40 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${t.correctRate}%` }} />
                      </div>
                      <p className={`mt-1 text-xs ${t.correctRate < 70 ? "font-medium text-red-500" : "text-slate-600"}`}>正确率 {t.correctRate}%</p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {!loading && tab === "wrong" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-700">错题本 ({wrongList.length})</h2>
            {wrongList.length > 0 && (
              <div className="flex gap-1.5 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
                {[{ v: "", l: "全部" }, { v: "数学", l: "数学" }, { v: "物理", l: "物理" }, { v: "化学", l: "化学" }, { v: "生物", l: "生物" }].map((t) => (
                  <button
                    key={t.v}
                    onClick={() => setSubjectTab(t.v)}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${subjectTab === t.v ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
                  >
                    {t.l}
                  </button>
                ))}
              </div>
            )}
          </div>
          {wrongList.length === 0 ? (
            <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">太棒了,目前没有错题!</p>
          ) : visibleWrong.length === 0 ? (
            <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">该学科暂无错题</p>
          ) : (
            <>
              <section>
                <h3 className="mb-3 text-sm font-medium text-slate-500">待掌握 ({pendingWrong.length})</h3>
                <div className="space-y-3">{pendingWrong.map((w) => renderWrong(w))}</div>
              </section>
              {masteredWrong.length > 0 && (
                <section>
                  <h3 className="mb-3 text-sm font-medium text-slate-500">已掌握 ({masteredWrong.length})</h3>
                  <div className="space-y-3 opacity-60">{masteredWrong.map((w) => renderWrong(w))}</div>
                </section>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );

  function renderWrong(w: WrongItem) {
    return (
      <div key={w.questionId} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-600">{w.subject}</span>
              <span className="rounded bg-slate-100 px-1.5 py-0.5">{w.topic}</span>
              <span>难度 {w.difficulty}</span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-slate-800">{renderRich(w.stem)}</p>
            <div className="mt-3">
              <button
                onClick={() => toggleSolution(w.questionId)}
                className="flex items-center gap-1.5 rounded-lg border border-[#c9b98f] bg-[#f6f1e2] px-3 py-1.5 text-xs font-medium text-[#3a3528] transition hover:bg-[#efe8d2]"
                aria-expanded={openSolutions.has(w.questionId)}
              >
                <svg className={`h-3 w-3 transition-transform ${openSolutions.has(w.questionId) ? "rotate-90" : ""}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {w.solution ? (openSolutions.has(w.questionId) ? "收起解析" : "查看解析") : "暂无解析"}
              </button>
              {openSolutions.has(w.questionId) && (
                w.solution ? (
                  <div className="mt-2 whitespace-pre-wrap rounded border-l-4 border-[#c9b98f] bg-[#f6f1e2] px-3 py-2 text-sm leading-relaxed text-[#3a3528]">
                    <b className="text-[#00467F]">解析:</b> {renderRich(w.solution, { smart: false })}
                  </div>
                ) : (
                  <p className="mt-2 rounded bg-slate-50 px-3 py-2 text-xs text-slate-400">暂无解析,老师尚未补充</p>
                )
              )}
            </div>
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
  }
}
