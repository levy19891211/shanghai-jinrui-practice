"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import GroupPicker from "@/components/GroupPicker";
import type { GroupSummary } from "@/lib/types";

interface ExamRow {
  id: string;
  title: string;
  note: string | null;
  mode: string;
  dueAt: string | null;
  status: string;
  createdAt: string;
  paper: { title: string; subject: string; sourceType: string | null; durationMin: number | null } | null;
  stats: { total: number; submitted: number; inProgress: number; pending: number };
  avgRate: number | null;
  avgScore: number | null;
}

interface PaperOption {
  id: string;
  title: string;
  subject: string;
  sourceType: string | null;
  questionCount: number;
  status: string;
}

interface StudentOption {
  id: string;
  name: string;
  email: string;
}

interface Analysis {
  exam: { id: string; title: string; note: string | null; dueAt: string | null; createdAt: string };
  paper: { id: string; title: string; subject: string; sourceType: string | null; durationMin: number | null; questionCount: number } | null;
  students: {
    studentId: string;
    name: string;
    email: string;
    status: string;
    submittedAt: string | null;
    score: number | null;
    total: number | null;
    correctCount: number | null;
    correctRate: number | null;
    startedAt: string | null;
  }[];
  perQuestion: { questionId: string; index: number; topic: string; difficulty: number | null; attempts: number; correct: number; correctRate: number | null; avgTimeSpent: number | null }[];
  overall: { totalStudents: number; submitted: number; pending: number; inProgress: number; avgCorrectRate: number | null; avgScore: number | null };
  suggestions: string[];
}

const ST_LABEL: Record<string, string> = { PENDING: "未交", IN_PROGRESS: "进行中", SUBMITTED: "已交", EXPIRED: "已过期" };
const ST_CLASS: Record<string, string> = {
  PENDING: "bg-slate-100 text-slate-500",
  IN_PROGRESS: "bg-blue-50 text-blue-600",
  SUBMITTED: "bg-emerald-50 text-emerald-600",
  EXPIRED: "bg-red-50 text-red-600",
};

const input = "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none focus:border-indigo-500";

function fmtTime(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("zh-CN", { hour12: false });
}

export default function ExamsPanel() {
  const [tab, setTab] = useState<"schedule" | "analysis">("schedule");

  // 考试安排
  const [exams, setExams] = useState<ExamRow[]>([]);
  const [papers, setPapers] = useState<PaperOption[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ paperId: "", title: "", note: "", dueAt: "", durationMin: "" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  // 考情分析
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [llmOn, setLlmOn] = useState(false);

  const flash = (t: string) => {
    setMsg(t);
    setTimeout(() => setMsg(""), 4000);
  };

  const loadExams = useCallback(async () => {
    try {
      const d = await api.get<{ list: ExamRow[] }>("/exams");
      setExams(d.list);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加载考试列表失败");
    }
  }, []);

  useEffect(() => {
    loadExams();
    api.get<{ list: PaperOption[] }>("/papers").then((d) => setPapers(d.list || [])).catch(() => {});
    api.get<{ list: StudentOption[] }>("/teacher/students").then((d) => setStudents(d.list || [])).catch(() => {});
    api.get<{ list: GroupSummary[] }>("/teacher/groups").then((d) => setGroups(d.list || [])).catch(() => {});
    api.get<{ llmConfigured: boolean }>("/health").then((d) => setLlmOn(!!d.llmConfigured)).catch(() => {});
  }, [loadExams]);

  async function createExam() {
    setErr("");
    if (!form.paperId) { setErr("请选择考卷"); return; }
    if (!form.durationMin || Number(form.durationMin) <= 0) { setErr("考试必须设置考试用时(分钟)"); return; }
    if (totalTargets === 0) { setErr("请选择至少一名考生(或选择一个分组)"); return; }
    setCreating(true);
    try {
      const r = await api.post<{ id: string }>("/exams", {
        paperId: form.paperId,
        studentIds: Array.from(selected),
        groupIds: Array.from(selectedGroups),
        title: form.title,
        note: form.note,
        durationMin: Number(form.durationMin),
        dueAt: form.dueAt || undefined,
      });
      flash(r && typeof r === "object" && "id" in r ? "考试已安排" : "考试已安排");
      setCreateOpen(false);
      setForm({ paperId: "", title: "", note: "", dueAt: "", durationMin: "" });
      setSelected(new Set());
      setSelectedGroups(new Set());
      await loadExams();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "安排失败");
    } finally {
      setCreating(false);
    }
  }

  async function deleteExam(id: string) {
    if (!window.confirm("确认删除这场考试?已提交的作答记录会保留,但考试安排会被撤销。")) return;
    setBusyId(id);
    try {
      await api.del(`/exams/${id}`);
      if (analysis?.exam.id === id) { setAnalysis(null); setAiSuggestion(null); }
      await loadExams();
      flash("考试已删除");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusyId(null);
    }
  }

  async function openAnalysis(id: string) {
    setAnalysisLoading(true);
    setErr("");
    setAiSuggestion(null);
    try {
      const d = await api.get<Analysis>(`/exams/${id}/analysis`);
      setAnalysis(d);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加载考情失败");
    } finally {
      setAnalysisLoading(false);
    }
  }

  async function runAiSuggest() {
    if (!analysis) return;
    setAiBusy(true);
    setAiSuggestion(null);
    try {
      const d = await api.post<{ suggestion: string }>(`/exams/${analysis.exam.id}/suggest`, {});
      setAiSuggestion(d.suggestion);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "AI 建议生成失败");
    } finally {
      setAiBusy(false);
    }
  }

  const readyPapers = papers.filter((p) => p.status === "READY");
  const filteredStudents = students.filter((s) => {
    const kw = search.trim().toLowerCase();
    return !kw || s.name.toLowerCase().includes(kw) || s.email.toLowerCase().includes(kw);
  });

  // 选中的分组展开成学生 id 集合,与逐选考生合并得到最终总人数
  const groupStudentIds = useMemo(() => {
    const set = new Set<string>();
    groups.forEach((g) => {
      if (selectedGroups.has(g.id)) g.students.forEach((s) => set.add(s.id));
    });
    return set;
  }, [groups, selectedGroups]);
  const totalTargets = useMemo(
    () => new Set(Array.from(selected).concat(Array.from(groupStudentIds))).size,
    [selected, groupStudentIds]
  );

  const rateColor = (r: number | null | undefined) => {
    if (r == null) return "text-slate-400";
    return r >= 70 ? "text-emerald-600" : r >= 40 ? "text-amber-600" : "text-red-500";
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">考试管理</h2>
          <p className="mt-0.5 text-xs text-slate-500">安排考试(选卷 + 选考生)与考情分析</p>
        </div>
        <div className="flex gap-1.5 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
          <button
            onClick={() => setTab("schedule")}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${tab === "schedule" ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
          >
            考试安排
          </button>
          <button
            onClick={() => setTab("analysis")}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${tab === "analysis" ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
          >
            考情分析
          </button>
        </div>
      </div>

      {msg && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</p>}
      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}

      {/* ——— 考试安排 ——— */}
      {tab === "schedule" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-slate-700">已安排的考试</h2>
            <button
              onClick={() => { setErr(""); setCreateOpen(true); }}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              + 新建考试
            </button>
          </div>
          {exams.length === 0 ? (
            <p className="mt-6 text-center text-sm text-slate-400">还没有安排考试。点「新建考试」选择考卷与考生。</p>
          ) : (
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-slate-400">
                  <th className="pb-2 font-normal">考试</th>
                  <th className="pb-2 font-normal">考卷</th>
                  <th className="pb-2 font-normal">DDL</th>
                  <th className="pb-2 font-normal">完成情况</th>
                  <th className="pb-2 font-normal text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {exams.map((a) => (
                  <tr key={a.id} className="border-b border-slate-50">
                    <td className="py-2.5 font-medium">{a.title}</td>
                    <td className="py-2.5 text-slate-500">
                      {a.paper ? `${a.paper.title}${a.paper.durationMin ? `(限时 ${a.paper.durationMin} 分钟)` : ""}` : "—"}
                    </td>
                    <td className="py-2.5 text-slate-500">{fmtTime(a.dueAt)}</td>
                    <td className="py-2.5">
                      <span className="text-slate-600">
                        {a.stats.submitted}/{a.stats.total} 已交
                        {a.stats.inProgress > 0 && <span className="ml-1 text-blue-500">· {a.stats.inProgress} 进行中</span>}
                        {a.stats.pending > 0 && <span className="ml-1 text-slate-400">· {a.stats.pending} 未交</span>}
                      </span>
                    </td>
                    <td className="py-2.5 text-right">
                      <button onClick={() => { setTab("analysis"); openAnalysis(a.id); }} className="mr-2 text-indigo-600 hover:underline">
                        考情分析
                      </button>
                      <button onClick={() => deleteExam(a.id)} disabled={busyId === a.id} className="text-red-500 hover:underline disabled:opacity-50">
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ——— 考情分析 ——— */}
      {tab === "analysis" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <label className="mb-3 block text-sm font-medium text-slate-700">选择考试查看考情(按发布时间从近到远)</label>
            {exams.length === 0 ? (
              <p className="text-sm text-slate-400">还没有安排考试。请先到「考试安排」新建考试。</p>
            ) : (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {exams.map((a) => {
                  const active = analysis?.exam.id === a.id;
                  return (
                    <button
                      key={a.id}
                      onClick={() => openAnalysis(a.id)}
                      className={`rounded-xl border p-3 text-left transition ${
                        active
                          ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-200"
                          : "border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/40"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-slate-800">{a.title}</span>
                        {active && <span className="shrink-0 rounded bg-indigo-600 px-1.5 py-0.5 text-xs text-white">查看中</span>}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
                        <span>发布 {fmtTime(a.createdAt)}</span>
                        <span>参考 {a.stats.submitted}/{a.stats.total} 人</span>
                        <span className={a.avgRate != null ? "font-medium text-indigo-600" : ""}>
                          平均成绩 {a.avgRate != null ? `${a.avgRate}%` : "—"}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {analysisLoading && <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">加载考情中…</p>}

          {!analysisLoading && analysis && (
            <>
              {/* 总体概览 */}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  { label: "考生数", value: analysis.overall.totalStudents },
                  { label: "已交", value: `${analysis.overall.submitted}` },
                  { label: "平均正确率", value: analysis.overall.avgCorrectRate != null ? `${analysis.overall.avgCorrectRate}%` : "—" },
                  { label: "未交 / 进行中", value: `${analysis.overall.pending} / ${analysis.overall.inProgress}` },
                ].map((x) => (
                  <div key={x.label} className="rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm">
                    <p className="text-2xl font-bold text-indigo-600">{x.value}</p>
                    <p className="mt-1 text-xs text-slate-500">{x.label}</p>
                  </div>
                ))}
              </div>

              {/* 给老师的建议 */}
              <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-indigo-800">给老师的建议</h2>
                  <button
                    onClick={runAiSuggest}
                    disabled={aiBusy || !llmOn}
                    title={llmOn ? "用 AI 生成教学建议" : "服务端未配置 LLM_API_KEY,暂不可用"}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {aiBusy ? "生成中…" : "AI 生成教学建议"}
                  </button>
                </div>
                <ul className="mt-3 space-y-1.5">
                  {analysis.suggestions.map((s, i) => (
                    <li key={i} className="text-sm leading-relaxed text-indigo-900">
                      <span className="mr-1 text-indigo-400">•</span>
                      {s}
                    </li>
                  ))}
                </ul>
                {aiSuggestion && (
                  <div className="mt-3 whitespace-pre-wrap rounded-xl bg-white px-4 py-3 text-sm leading-relaxed text-slate-700 ring-1 ring-indigo-100">
                    <p className="mb-1 text-xs font-medium text-indigo-500">AI 教学建议:</p>
                    {aiSuggestion}
                  </div>
                )}
              </div>

              {/* 每考生考试结果 */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-medium text-slate-700">各考生考试结果({analysis.paper ? `《${analysis.paper.title}》` : ""})</h2>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-left text-slate-400">
                        <th className="pb-2 font-normal">考生</th>
                        <th className="pb-2 font-normal">状态</th>
                        <th className="pb-2 font-normal">得分</th>
                        <th className="pb-2 font-normal">正确率</th>
                        <th className="pb-2 font-normal">开始</th>
                        <th className="pb-2 font-normal">提交</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.students.map((s) => (
                        <tr key={s.studentId} className="border-b border-slate-50">
                          <td className="py-2.5">
                            <span className="font-medium">{s.name}</span>
                            <span className="ml-1 text-xs text-slate-400">{s.email}</span>
                          </td>
                          <td className="py-2.5">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ST_CLASS[s.status] ?? "bg-slate-100 text-slate-500"}`}>
                              {ST_LABEL[s.status] ?? s.status}
                            </span>
                          </td>
                          <td className="py-2.5">
                            {s.score != null && s.total != null ? `${s.score}/${s.total}` : "—"}
                          </td>
                          <td className={`py-2.5 font-medium ${rateColor(s.correctRate)}`}>
                            {s.correctRate != null ? `${s.correctRate}%` : "—"}
                          </td>
                          <td className="py-2.5 text-slate-500">{fmtTime(s.startedAt)}</td>
                          <td className="py-2.5 text-slate-500">{fmtTime(s.submittedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 每题分析 */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-sm font-medium text-slate-700">每题整体考情</h2>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-left text-slate-400">
                        <th className="pb-2 font-normal">题号</th>
                        <th className="pb-2 font-normal">知识点</th>
                        <th className="pb-2 font-normal">难度</th>
                        <th className="pb-2 font-normal">作答</th>
                        <th className="pb-2 font-normal">答对</th>
                        <th className="pb-2 font-normal">正确率</th>
                        <th className="pb-2 font-normal">平均用时</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.perQuestion.map((q) => (
                        <tr key={q.questionId} className="border-b border-slate-50">
                          <td className="py-2.5">第 {q.index} 题</td>
                          <td className="py-2.5 text-slate-500">{q.topic || "未分类"}</td>
                          <td className="py-2.5 text-slate-500">{q.difficulty ?? "—"}</td>
                          <td className="py-2.5">{q.attempts}</td>
                          <td className="py-2.5 text-emerald-600">{q.correct}</td>
                          <td className={`py-2.5 font-medium ${rateColor(q.correctRate)}`}>
                            {q.correctRate != null ? `${q.correctRate}%` : "—"}
                          </td>
                          <td className="py-2.5 text-slate-500">{q.avgTimeSpent != null ? `${q.avgTimeSpent}s` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {!analysisLoading && !analysis && (
            <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">请先选择一场考试。</p>
          )}
        </div>
      )}

      {/* 新建考试弹窗 */}
      {createOpen && (
        <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4" onClick={() => !creating && setCreateOpen(false)}>
          <div className="mt-8 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800">安排考试</h2>
              <button onClick={() => !creating && setCreateOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm text-slate-600">考卷(必选,仅显示「可作答」的卷子)</label>
                <select
                  className={`${input} ui-select`}
                  value={form.paperId}
                  onChange={(e) => setForm((f) => ({ ...f, paperId: e.target.value }))}
                >
                  <option value="">请选择考卷</option>
                  {readyPapers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}({p.questionCount}题 · {p.subject})
                    </option>
                  ))}
                </select>
                {readyPapers.length === 0 && (
                  <p className="mt-1 text-xs text-amber-500">暂无「可作答」的卷子,请先到试卷组卷把卷内题目审核发布。</p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-600">考试用时(分钟,必填)</label>
                <input
                  type="number"
                  min={1}
                  max={240}
                  className={input}
                  value={form.durationMin}
                  onChange={(e) => setForm({ ...form, durationMin: e.target.value })}
                  placeholder="如 90"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-600">考试名称(留空 = 用试卷名)</label>
                <input className={input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="如:2018 TMUA Paper 1 模考" />
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-600">截止时间(DDL,可选)</label>
                <input type="datetime-local" className={input} value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm text-slate-600">备注(可选)</label>
                <input className={input} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="如:本周五前完成,模考计时" />
              </div>
            </div>

            <GroupPicker groups={groups} selected={selectedGroups} onToggle={(id) => setSelectedGroups((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; })} />
            <div className="mt-3">
              <div className="mb-1 flex items-center gap-2">
                <label className="text-sm text-slate-600">参加考试的学生(逐选 {selected.size} 人,含分组共 {totalTargets} 人)</label>
                <input
                  className="ml-auto w-44 rounded-lg border border-slate-300 px-2.5 py-1 text-sm outline-none focus:border-indigo-500"
                  placeholder="搜索学生姓名/邮箱…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <button
                  onClick={() => setSelected((prev) => (prev.size === filteredStudents.length ? new Set() : new Set(filteredStudents.map((s) => s.id))))}
                  className="text-xs text-indigo-600 hover:underline"
                >
                  {selected.size === students.length ? "取消全选" : "全选"}
                </button>
              </div>
              {students.length === 0 ? (
                <p className="text-xs text-slate-400">暂无学生账号。</p>
              ) : (
                <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 p-2">
                  <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
                    {filteredStudents.map((s) => (
                      <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
                        <input type="checkbox" checked={selected.has(s.id)} onChange={() => setSelected((prev) => { const n = new Set(prev); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; })} className="accent-indigo-600" />
                        <span className="truncate">{s.name}</span>
                        <span className="truncate text-xs text-slate-400">{s.email}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {err && createOpen && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setCreateOpen(false)} disabled={creating} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">取消</button>
              <button onClick={createExam} disabled={creating} className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
                {creating ? "安排中..." : "安排考试"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
