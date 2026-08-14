"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import ExamsPanel from "@/components/ExamsPanel";

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

interface AssignmentRow {
  id: string;
  title: string;
  note: string | null;
  mode: string;
  dueAt: string | null;
  status: string;
  createdAt: string;
  paper: { title: string; mode: string; subject: string; sourceType: string | null } | null;
  stats: { total: number; submitted: number; inProgress: number; pending: number };
}

interface AssignmentDetail {
  id: string;
  title: string;
  note: string | null;
  mode: string;
  dueAt: string | null;
  status: string;
  createdAt: string;
  paper: { title: string; mode: string; subject: string; sourceType: string | null } | null;
  targets: { studentId: string; name: string; email: string; status: string; submittedAt: string | null }[];
}

interface PaperOption {
  id: string;
  title: string;
  mode: string;
  subject: string;
  questionCount: number;
  kind?: string;
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: "未交",
  IN_PROGRESS: "进行中",
  SUBMITTED: "已交",
  EXPIRED: "已过期",
};
const STATUS_CLASS: Record<string, string> = {
  PENDING: "bg-slate-100 text-slate-500",
  IN_PROGRESS: "bg-blue-50 text-blue-600",
  SUBMITTED: "bg-emerald-50 text-emerald-600",
  EXPIRED: "bg-red-50 text-red-600",
};

export default function TeacherStudentsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<"stats" | "assign" | "exams" | "review">("stats");
  const [pendingCount, setPendingCount] = useState(0);

  // ——— 学情统计 ———
  const [list, setList] = useState<StudentRow[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  // ——— 作业分发 ———
  const [assignList, setAssignList] = useState<AssignmentRow[]>([]);
  const [students, setStudents] = useState<{ id: string; name: string; email: string }[]>([]);
  const [papers, setPapers] = useState<PaperOption[]>([]);
  const [assignForm, setAssignForm] = useState({ paperId: "", title: "", note: "", mode: "PRACTICE" as "PRACTICE" | "EXAM", dueAt: "" });
  const [selectedStudents, setSelectedStudents] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [assignMsg, setAssignMsg] = useState("");
  const [assignErr, setAssignErr] = useState("");
  const [detail, setDetail] = useState<AssignmentDetail | null>(null);

  // 已布置作业:筛选与搜索
  const [assignSearch, setAssignSearch] = useState("");
  const [assignMode, setAssignMode] = useState<"" | "PRACTICE" | "EXAM">("");
  const [assignSubject, setAssignSubject] = useState("");

  // ——— 注册审核 ———(待教师审核的学生)
  interface ReviewRow {
    id: string;
    name: string;
    email: string;
    createdAt: string;
    status: string;
    reviewedAt: string | null;
    reviewNote: string | null;
  }
  const [reviewList, setReviewList] = useState<ReviewRow[]>([]);
  const [reviewSearch, setReviewSearch] = useState("");
  const [selectedReview, setSelectedReview] = useState<Set<string>>(new Set());
  const [reviewMsg, setReviewMsg] = useState("");
  const [reviewErr, setReviewErr] = useState("");

  async function load(kw = search) {
    try {
      const d = await api.get<{ list: StudentRow[] }>(`/teacher/students${kw ? `?search=${encodeURIComponent(kw)}` : ""}`);
      setList(d.list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    }
  }

  const loadAssignments = useCallback(async () => {
    try {
      // 教学管理仅展示作业(练习);考试请到「考试管理」
      const d = await api.get<{ list: AssignmentRow[] }>("/teacher/assignments?mode=PRACTICE");
      setAssignList(d.list);
    } catch (e) {
      setAssignErr(e instanceof Error ? e.message : "作业加载失败");
    }
  }, []);

  useEffect(() => {
    load();
    api.get<Overview & { pendingCount: number }>("/teacher/stats/overview").then((d) => { setOverview(d); setPendingCount(d.pendingCount || 0); }).catch(() => {});
    loadAssignments();
    // 学生与试卷库(供作业分发)
    api.get<{ list: { id: string; name: string; email: string }[] }>("/teacher/students").then((d) => setStudents(d.list)).catch(() => {});
    api.get<{ list: PaperOption[] }>("/papers").then((d) => setPapers(d.list)).catch(() => {});
  }, [loadAssignments]);

  // 注册审核:拉取待审核(PENDING)学生
  const loadReview = useCallback(async (kw = reviewSearch) => {
    try {
      const d = await api.get<{ list: ReviewRow[] }>(`/teacher/students?status=PENDING${kw ? `&search=${encodeURIComponent(kw)}` : ""}`);
      setReviewList(d.list);
      setPendingCount(d.list.length);
    } catch (e) {
      setReviewErr(e instanceof Error ? e.message : "加载待审核列表失败");
    }
  }, [reviewSearch]);

  useEffect(() => {
    if (tab === "review") loadReview();
  }, [tab, loadReview]);

  const weak = (overview?.byTopic ?? []).slice(0, 5);

  async function deleteStudent(s: StudentRow) {
    if (!window.confirm(`确认删除学生「${s.name}」?该学生的成绩、错题本、作答记录等全部数据将被永久删除,无法恢复。`)) return;
    try {
      await api.del(`/teacher/students/${s.id}`);
      setError("");
      await load();
      const d = await api.get<Overview>("/teacher/stats/overview").then((x) => x).catch(() => null);
      if (d) setOverview(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  }

  function toggleStudent(id: string) {
    setSelectedStudents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllStudents() {
    setSelectedStudents((prev) => (prev.size === students.length ? new Set() : new Set(students.map((s) => s.id))));
  }

  async function createAssignment() {
    setAssignErr("");
    setAssignMsg("");
    if (!assignForm.paperId) { setAssignErr("请选择试卷"); return; }
    if (selectedStudents.size === 0) { setAssignErr("请选择至少一名学生"); return; }
    setCreating(true);
    try {
      await api.post("/teacher/assignments", {
        paperId: assignForm.paperId,
        title: assignForm.title,
        note: assignForm.note,
        mode: "PRACTICE", // 教学管理仅布置作业(练习);考试请到「考试管理」
        dueAt: assignForm.dueAt || undefined,
        studentIds: Array.from(selectedStudents),
      });
      setAssignMsg(`已向 ${selectedStudents.size} 名学生布置作业`);
      setAssignForm({ paperId: "", title: "", note: "", mode: "PRACTICE", dueAt: "" });
      setSelectedStudents(new Set());
      await loadAssignments();
    } catch (e) {
      setAssignErr(e instanceof Error ? e.message : "创建失败");
    } finally {
      setCreating(false);
    }
  }

  async function openDetail(id: string) {
    try {
      const d = await api.get<AssignmentDetail>(`/teacher/assignments/${id}`);
      setDetail(d);
    } catch (e) {
      setAssignErr(e instanceof Error ? e.message : "加载详情失败");
    }
  }

  async function deleteAssignment(id: string) {
    if (!window.confirm("确认删除这份作业?已提交的作答记录会保留,但作业分发关系会被撤销。")) return;
    try {
      await api.del(`/teacher/assignments/${id}`);
      setDetail(null);
      await loadAssignments();
    } catch (e) {
      setAssignErr(e instanceof Error ? e.message : "删除失败");
    }
  }

  // ——— 注册审核操作 ———
  async function approveOne(id: string) {
    setReviewErr("");
    try {
      await api.post(`/teacher/students/${id}/approve`);
      setReviewMsg("已通过该学生的注册申请");
      await loadReview();
      api.get<Overview & { pendingCount: number }>("/teacher/stats/overview").then((d) => setPendingCount(d.pendingCount || 0)).catch(() => {});
    } catch (e) {
      setReviewErr(e instanceof Error ? e.message : "操作失败");
    }
  }
  async function rejectOne(s: ReviewRow) {
    if (!window.confirm(`确认拒绝「${s.name}」的注册申请?该账号将被删除,邮箱释放后可重新注册。`)) return;
    setReviewErr("");
    try {
      await api.post(`/teacher/students/${s.id}/reject`);
      setReviewMsg(`已拒绝并删除「${s.name}」的账号`);
      await loadReview();
      api.get<Overview & { pendingCount: number }>("/teacher/stats/overview").then((d) => setPendingCount(d.pendingCount || 0)).catch(() => {});
    } catch (e) {
      setReviewErr(e instanceof Error ? e.message : "操作失败");
    }
  }
  async function batchApprove() {
    if (selectedReview.size === 0) { setReviewErr("请先勾选要通过的学生"); return; }
    setReviewErr("");
    try {
      await api.post("/teacher/students/batch-approve", { ids: Array.from(selectedReview) });
      setReviewMsg(`已通过 ${selectedReview.size} 名学生`);
      setSelectedReview(new Set());
      await loadReview();
      api.get<Overview & { pendingCount: number }>("/teacher/stats/overview").then((d) => setPendingCount(d.pendingCount || 0)).catch(() => {});
    } catch (e) {
      setReviewErr(e instanceof Error ? e.message : "操作失败");
    }
  }
  async function batchReject() {
    if (selectedReview.size === 0) { setReviewErr("请先勾选要拒绝的学生"); return; }
    if (!window.confirm(`确认拒绝并删除选中的 ${selectedReview.size} 名学生账号?`)) return;
    setReviewErr("");
    try {
      await api.post("/teacher/students/batch-reject", { ids: Array.from(selectedReview) });
      setReviewMsg(`已拒绝并删除 ${selectedReview.size} 名学生账号`);
      setSelectedReview(new Set());
      await loadReview();
      api.get<Overview & { pendingCount: number }>("/teacher/stats/overview").then((d) => setPendingCount(d.pendingCount || 0)).catch(() => {});
    } catch (e) {
      setReviewErr(e instanceof Error ? e.message : "操作失败");
    }
  }
  function toggleReview(id: string) {
    setSelectedReview((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAllReview() {
    setSelectedReview((prev) => (prev.size === reviewList.length ? new Set() : new Set(reviewList.map((s) => s.id))));
  }

  // 学生选择:可搜索过滤
  const filteredStudents = useMemo(() => {
    const kw = search.trim().toLowerCase();
    if (!kw) return students;
    return students.filter((s) => s.name.toLowerCase().includes(kw) || s.email.toLowerCase().includes(kw));
  }, [students, search]);

  // 已布置作业:按模式/科目分类筛选 + 按作业名称/试卷名称搜索
  const assignSubjects = useMemo(() => {
    const set = new Set<string>();
    assignList.forEach((a) => { if (a.paper?.subject) set.add(a.paper.subject); });
    return Array.from(set).sort();
  }, [assignList]);

  const filteredAssign = useMemo(() => {
    const kw = assignSearch.trim().toLowerCase();
    return assignList.filter((a) => {
      if (assignMode && a.mode !== assignMode) return false;
      if (assignSubject && (a.paper?.subject ?? "") !== assignSubject) return false;
      if (kw) {
        const hay = `${a.title} ${a.paper?.title ?? ""}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [assignList, assignSearch, assignMode, assignSubject]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between">
        <h1 className="text-xl font-bold">教学管理</h1>
        <div className="flex gap-1.5 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
          <button
            onClick={() => setTab("stats")}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${tab === "stats" ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
          >
            学情统计
          </button>
          <button
            onClick={() => setTab("assign")}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${tab === "assign" ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
          >
            作业分发
          </button>
          <button
            onClick={() => setTab("exams")}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${tab === "exams" ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
          >
            考试管理
          </button>
          <button
            onClick={() => setTab("review")}
            className={`relative rounded-lg px-4 py-1.5 text-sm font-medium transition ${tab === "review" ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
          >
            注册审核
            {pendingCount > 0 && (
              <span className={`ml-1 rounded-full px-1.5 text-xs ${tab === "review" ? "bg-white/25 text-white" : "bg-red-500 text-white"}`}>
                {pendingCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {tab === "stats" && (
        <>
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
                    <th className="pb-2 font-normal text-right">操作</th>
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
                      <td className="py-2.5 text-right">
                        <button
                          onClick={() => deleteStudent(s)}
                          className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-500 hover:bg-red-50"
                          title="删除该学生及其全部数据"
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {tab === "assign" && (
        <div className="space-y-6">
          {/* 新建作业 */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-medium text-slate-700">布置作业</h2>
            <p className="mt-1 text-xs text-slate-400">选择试卷库中的卷子,作为平时练习分发给学生,可设置截止时间(DDL)。考试安排请到「考试管理」。</p>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm text-slate-600">试卷(必选)</label>
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 ui-select"
                  value={assignForm.paperId}
                  onChange={(e) => setAssignForm((f) => ({ ...f, paperId: e.target.value }))}
                >
                  <option value="">请选择试卷</option>
                  {papers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}({p.questionCount}题 · {p.mode === "EXAM" ? "模考" : "练习"})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-600">作业名称(留空 = 用试卷名)</label>
                <input
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                  value={assignForm.title}
                  onChange={(e) => setAssignForm({ ...assignForm, title: e.target.value })}
                  placeholder="如:2018 TMUA 限时练习"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-600">截止时间(DDL,可选)</label>
                <input
                  type="datetime-local"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                  value={assignForm.dueAt}
                  onChange={(e) => setAssignForm({ ...assignForm, dueAt: e.target.value })}
                />
              </div>
            </div>
            <div className="mt-3">
              <label className="mb-1 block text-sm text-slate-600">备注(可选)</label>
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                value={assignForm.note}
                onChange={(e) => setAssignForm({ ...assignForm, note: e.target.value })}
                placeholder="如:本周五前完成,模考计时"
              />
            </div>
            <div className="mt-3">
              <div className="mb-1 flex items-center gap-2">
                <label className="text-sm text-slate-600">分发给学生(已选 {selectedStudents.size} 人)</label>
                <button onClick={toggleAllStudents} className="text-xs text-indigo-600 hover:underline">
                  {selectedStudents.size === students.length ? "取消全选" : "全选"}
                </button>
              </div>
              {students.length === 0 ? (
                <p className="text-xs text-slate-400">暂无学生账号。</p>
              ) : (
                <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 p-2">
                  <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
                    {filteredStudents.map((s) => (
                      <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
                        <input type="checkbox" checked={selectedStudents.has(s.id)} onChange={() => toggleStudent(s.id)} className="accent-indigo-600" />
                        <span className="truncate">{s.name}</span>
                        <span className="truncate text-xs text-slate-400">{s.email}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {assignErr && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{assignErr}</p>}
            {assignMsg && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{assignMsg}</p>}
            <button
              onClick={createAssignment}
              disabled={creating}
              className="mt-4 rounded-lg bg-indigo-600 px-6 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {creating ? "布置中..." : "布置作业"}
            </button>
          </div>

          {/* 作业列表 */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-medium text-slate-700">已布置的作业</h2>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={assignSearch}
                  onChange={(e) => setAssignSearch(e.target.value)}
                  placeholder="搜索作业名称 / 试卷"
                  className="w-48 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-indigo-500"
                />
                <select
                  value={assignMode}
                  onChange={(e) => setAssignMode(e.target.value as "" | "PRACTICE" | "EXAM")}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-indigo-500"
                >
                  <option value="">全部模式</option>
                  <option value="PRACTICE">练习</option>
                  <option value="EXAM">模考</option>
                </select>
                <select
                  value={assignSubject}
                  onChange={(e) => setAssignSubject(e.target.value)}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-indigo-500"
                >
                  <option value="">全部科目</option>
                  {assignSubjects.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
            {assignList.length === 0 ? (
              <p className="mt-4 text-sm text-slate-400">还没有布置过作业。</p>
            ) : filteredAssign.length === 0 ? (
              <p className="mt-4 text-sm text-slate-400">没有符合筛选条件的作业。</p>
            ) : (
              <table className="mt-4 w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-slate-400">
                    <th className="pb-2 font-normal">作业名称</th>
                    <th className="pb-2 font-normal">试卷</th>
                    <th className="pb-2 font-normal">模式</th>
                    <th className="pb-2 font-normal">DDL</th>
                    <th className="pb-2 font-normal">完成情况</th>
                    <th className="pb-2 font-normal">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAssign.map((a) => (
                    <tr key={a.id} className="border-b border-slate-50">
                      <td className="py-2.5 font-medium">{a.title}</td>
                      <td className="py-2.5 text-slate-500">{a.paper?.title ?? "—"}</td>
                      <td className="py-2.5">{a.mode === "EXAM" ? "模考" : "练习"}</td>
                      <td className="py-2.5 text-slate-500">{a.dueAt ? new Date(a.dueAt).toLocaleString("zh-CN", { hour12: false }) : "不限"}</td>
                      <td className="py-2.5">
                        <span className="text-slate-600">
                          {a.stats.submitted}/{a.stats.total} 已交
                          {a.stats.inProgress > 0 && <span className="ml-1 text-blue-500">· {a.stats.inProgress} 进行中</span>}
                          {a.stats.pending > 0 && <span className="ml-1 text-slate-400">· {a.stats.pending} 未交</span>}
                        </span>
                      </td>
                      <td className="py-2.5">
                        <button onClick={() => openDetail(a.id)} className="mr-2 text-indigo-600 hover:underline">
                          详情
                        </button>
                        <button onClick={() => deleteAssignment(a.id)} className="text-red-500 hover:underline">
                          删除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === "review" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-medium text-slate-700">待审核注册申请</h2>
                <p className="mt-1 text-xs text-slate-400">学生注册后默认进入待审核状态,需教师通过后账号才生效、可登录使用系统。</p>
              </div>
              <div className="flex gap-2">
                <input
                  value={reviewSearch}
                  onChange={(e) => setReviewSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && loadReview()}
                  placeholder="按姓名/邮箱搜索"
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-indigo-500"
                />
                <button onClick={() => loadReview()} className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
                  搜索
                </button>
              </div>
            </div>

            {reviewMsg && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{reviewMsg}</p>}
            {reviewErr && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{reviewErr}</p>}

            {reviewList.length === 0 ? (
              <p className="mt-4 text-sm text-slate-400">暂无待审核的注册申请。</p>
            ) : (
              <>
                <div className="mt-4 flex items-center gap-2">
                  <button onClick={toggleAllReview} className="text-xs text-indigo-600 hover:underline">
                    {selectedReview.size === reviewList.length ? "取消全选" : "全选"}
                  </button>
                  <span className="text-xs text-slate-400">已选 {selectedReview.size} 人</span>
                  <div className="ml-auto flex gap-2">
                    <button
                      onClick={batchApprove}
                      disabled={selectedReview.size === 0}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      批量通过
                    </button>
                    <button
                      onClick={batchReject}
                      disabled={selectedReview.size === 0}
                      className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 disabled:opacity-50"
                    >
                      批量拒绝
                    </button>
                  </div>
                </div>
                <table className="mt-3 w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-slate-400">
                      <th className="pb-2 font-normal w-8"></th>
                      <th className="pb-2 font-normal">学生</th>
                      <th className="pb-2 font-normal">邮箱</th>
                      <th className="pb-2 font-normal">注册时间</th>
                      <th className="pb-2 font-normal text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviewList.map((s) => (
                      <tr key={s.id} className="border-b border-slate-50">
                        <td className="py-2.5">
                          <input type="checkbox" checked={selectedReview.has(s.id)} onChange={() => toggleReview(s.id)} className="accent-indigo-600" />
                        </td>
                        <td className="py-2.5 font-medium">{s.name}</td>
                        <td className="py-2.5 text-slate-500">{s.email}</td>
                        <td className="py-2.5 text-slate-500">{s.createdAt ? new Date(s.createdAt).toLocaleString("zh-CN", { hour12: false }) : "—"}</td>
                        <td className="py-2.5 text-right">
                          <button
                            onClick={() => approveOne(s.id)}
                            className="mr-2 rounded bg-emerald-600 px-2.5 py-0.5 text-xs text-white hover:bg-emerald-700"
                          >
                            通过
                          </button>
                          <button
                            onClick={() => rejectOne(s)}
                            className="rounded border border-red-200 px-2.5 py-0.5 text-xs text-red-500 hover:bg-red-50"
                          >
                            拒绝
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      )}

      {tab === "exams" && <ExamsPanel />}

      {/* 作业详情弹窗 */}
      {detail && (
        <div className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
          <div className="mt-10 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">{detail.title}</h2>
              <button onClick={() => setDetail(null)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              试卷:{detail.paper?.title ?? "—"} · {detail.mode === "EXAM" ? "模考" : "练习"} ·
              DDL:{detail.dueAt ? new Date(detail.dueAt).toLocaleString("zh-CN", { hour12: false }) : "不限"}
            </p>
            {detail.note && <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">备注:{detail.note}</p>}
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-slate-400">
                  <th className="pb-2 font-normal">学生</th>
                  <th className="pb-2 font-normal">状态</th>
                  <th className="pb-2 font-normal">提交时间</th>
                </tr>
              </thead>
              <tbody>
                {detail.targets.map((t) => (
                  <tr key={t.studentId} className="border-b border-slate-50">
                    <td className="py-2.5">
                      <span className="font-medium">{t.name}</span>
                      <span className="ml-1 text-xs text-slate-400">{t.email}</span>
                    </td>
                    <td className="py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[t.status] ?? "bg-slate-100 text-slate-500"}`}>
                        {STATUS_LABEL[t.status] ?? t.status}
                      </span>
                    </td>
                    <td className="py-2.5 text-slate-500">
                      {t.submittedAt ? new Date(t.submittedAt).toLocaleString("zh-CN", { hour12: false }) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-5 flex justify-end">
              <button onClick={() => setDetail(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600">
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
