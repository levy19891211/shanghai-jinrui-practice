"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

type LangPaper = {
  id: string;
  examType: string;
  skill: string;
  title: string;
  segments: { skill: string; durationMin: number; questionCount: number }[];
  mode: string;
  durationMin: number | null;
  kind: string;
  status: string;
  questionCount: number;
  createdAt: string;
};

type MyAssignment = {
  id: string;
  title: string;
  note?: string | null;
  mode: string;
  dueAt?: string | null;
  status: string;
  submittedAt?: string | null;
  sessionId?: string | null;
  paper: { id: string; title: string; examType: string; skill: string; mode: string; durationMin: number | null } | null;
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

const EXAMS = ["IELTS", "TOEFL", "KET_PET", "OTHER"];
const SKILLS = ["LISTENING", "READING", "WRITING", "SPEAKING"];
const EXAM_LABEL: Record<string, string> = { IELTS: "雅思", TOEFL: "托福", KET_PET: "剑桥KET/PET", OTHER: "其他语言" };
const SKILL_LABEL: Record<string, string> = { LISTENING: "听力", READING: "阅读", WRITING: "写作", SPEAKING: "口语", FULL: "全真连考" };
const SKILL_COLOR: Record<string, string> = {
  LISTENING: "#1f6fb2", READING: "#2e6f40", WRITING: "#b8860b", SPEAKING: "#7a3b8f", FULL: "#a14a3a",
};

function fmtDue(s?: string | null) {
  if (!s) return "不限时";
  const d = new Date(s);
  return `DDL ${d.toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`;
}

export default function StudentLanguagePage() {
  const router = useRouter();
  const [papers, setPapers] = useState<LangPaper[]>([]);
  const [assigns, setAssigns] = useState<MyAssignment[]>([]);
  const [sessions, setSessions] = useState<LangSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [startingId, setStartingId] = useState<string | null>(null);

  const [examType, setExamType] = useState("");
  const [skill, setSkill] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [p, a, s] = await Promise.all([
          api.get<{ list: LangPaper[] }>("/language/papers"),
          api.get<{ list: MyAssignment[] }>("/language/my-assignments"),
          api.get<{ list: LangSession[] }>("/language/sessions"),
        ]);
        setPapers(p.list);
        setAssigns(a.list);
        setSessions(s.list);
      } catch (e) {
        setError(e instanceof Error ? e.message : "加载失败");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const libPapers = useMemo(() => {
    return papers
      .filter((p) => p.status === "READY")
      .filter((p) => (examType ? p.examType === examType : true))
      .filter((p) => (skill ? p.skill === skill : true));
  }, [papers, examType, skill]);

  const pendingAssigns = assigns.filter((a) => a.status === "PENDING" || a.status === "IN_PROGRESS");

  async function start(paperId: string, assignmentId?: string) {
    setError("");
    setStartingId(paperId || assignmentId || "");
    try {
      const data = await api.post<{
        sessionId: string;
        mode: string;
        durationMin: number | null;
        segments: { skill: string; durationMin: number; questionCount: number }[];
        questions: any[];
      }>("/language/sessions", assignmentId ? { assignmentId, mode: undefined } : { paperId, mode: undefined });
      sessionStorage.setItem(`lang-session-${data.sessionId}`, JSON.stringify(data));
      router.push(`/app/language/practice/${data.sessionId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "开卷失败");
    } finally {
      setStartingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">语言学习</h1>
        <div className="flex gap-2">
          <select className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-600" value={examType} onChange={(e) => setExamType(e.target.value)}>
            <option value="">全部考试</option>
            {EXAMS.map((x) => <option key={x} value={x}>{EXAM_LABEL[x]}</option>)}
          </select>
          <select className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-600" value={skill} onChange={(e) => setSkill(e.target.value)}>
            <option value="">全部技能</option>
            {SKILLS.map((s) => <option key={s} value={s}>{SKILL_LABEL[s]}</option>)}
            <option value="FULL">全真连考</option>
          </select>
        </div>
      </div>

      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
      {loading && <p className="py-10 text-center text-slate-400">加载中...</p>}

      {!loading && pendingAssigns.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-2 text-base font-bold text-slate-700">📌 待完成作业</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {pendingAssigns.map((a) => {
              const overdue = a.status === "PENDING" && a.dueAt && new Date() > new Date(a.dueAt);
              return (
                <div key={a.id} className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 shadow-sm">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                      {a.status === "IN_PROGRESS" ? "进行中" : overdue ? "已过期" : "待完成"}
                    </span>
                    {a.paper && (
                      <span className="rounded-md px-1.5 py-0.5 text-xs font-medium text-white" style={{ background: SKILL_COLOR[a.paper.skill] || "#666" }}>
                        {EXAM_LABEL[a.paper.examType] || a.paper.examType}·{SKILL_LABEL[a.paper.skill] || a.paper.skill}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-semibold text-slate-800">{a.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {a.paper?.title} · {a.paper?.mode === "EXAM" ? `限时 ${a.paper.durationMin ?? ""} 分钟` : "练习"} · {fmtDue(a.dueAt)}
                  </p>
                  {a.note && <p className="mt-1 text-xs text-slate-400">备注: {a.note}</p>}
                  {!overdue && (
                    <button
                      className="mt-3 w-full rounded-lg bg-amber-500 px-3 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
                      disabled={!!startingId}
                      onClick={() => a.paper && start(a.paper.id, a.id)}
                    >
                      {startingId === a.id ? "开卷中..." : a.status === "IN_PROGRESS" ? "继续作答" : "开始作答"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && (
        <div className="mb-6">
          <h2 className="mb-2 text-base font-bold text-slate-700">🗂️ 语言试卷库</h2>
          {libPapers.length === 0 && <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">暂无可用试卷</p>}
          <div className="grid gap-3 md:grid-cols-2">
            {libPapers.map((p) => (
              <div key={p.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-md bg-teal-50 px-1.5 py-0.5 text-xs font-medium text-teal-700">{EXAM_LABEL[p.examType] || p.examType}</span>
                  <span className="rounded-md px-1.5 py-0.5 text-xs font-medium text-white" style={{ background: SKILL_COLOR[p.skill] || "#666" }}>{SKILL_LABEL[p.skill] || p.skill}</span>
                  {p.kind === "OFFICIAL" && <span className="rounded-md bg-cyan-50 px-1.5 py-0.5 text-xs text-cyan-700">原版</span>}
                  {p.kind === "CUSTOM" && <span className="rounded-md bg-purple-50 px-1.5 py-0.5 text-xs text-purple-700">组卷</span>}
                </div>
                <p className="text-sm font-semibold text-slate-800">{p.title}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {p.questionCount} 题 · {p.mode === "EXAM" ? `限时 ${p.durationMin ?? ""} 分钟` : "练习"}
                  {p.segments.length > 0 && ` · ${p.segments.map((s) => `${SKILL_LABEL[s.skill]}${s.durationMin}min`).join("→")}`}
                </p>
                <button
                  className="mt-3 w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                  disabled={!!startingId}
                  onClick={() => start(p.id)}
                >
                  {startingId === p.id ? "开卷中..." : p.mode === "EXAM" ? "开始模考" : "开始练习"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && sessions.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-2 text-base font-bold text-slate-700">📈 成绩历史</h2>
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="divide-y divide-slate-100">
              {sessions.slice(0, 15).map((s) => (
                <div key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-700">{s.paper?.title || "语言练习"}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {EXAM_LABEL[s.examType] || s.examType} · {SKILL_LABEL[s.skill] || s.skill} · {new Date(s.startedAt).toLocaleString("zh-CN", { hour12: false })}
                    </p>
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
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
