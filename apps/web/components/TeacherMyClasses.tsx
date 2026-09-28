"use client";

// 科任老师:我的教学班 + 成绩登记
// 权限:教务/管理员可见全部;科任仅见自己任教的教学班(后端按任教关系过滤)
// 数据:/api/flexible/my-classes、/classes/:id/roster、/classes/:id/exams、.../scores

import { useCallback, useEffect, useState } from "react";
import { api, getUser } from "@/lib/api";

interface TeachingClass {
  id: string;
  subject: string;
  grade: string;
  academicYear: string;
  term: string;
  type: string;
  tier?: string | null;
  name: string;
  capacity?: number | null;
  room?: string | null;
  block?: { id: string; name: string } | null;
  teachers: { role: string; teacher: { id: string; name: string } }[];
  _count: { enrollments: number; exams: number };
}
interface ExamItem { id: string; title: string; type: string; examDate: string; totalScore: number; _count?: { scores: number } }
interface RosterRow { studentId: string; name: string; studentNo?: string | null; adminClass?: string | null; status: string }
interface ScoreRow { studentId: string; name: string; studentNo?: string | null; adminClass?: string | null; score: number | null; rankInClass: number | null; comment: string }

const EXAM_TYPES = [
  { value: "DAILY", label: "日常" },
  { value: "MONTHLY", label: "月考" },
  { value: "MIDTERM", label: "期中" },
  { value: "FINAL", label: "期末" },
  { value: "OTHER", label: "其他" },
];

function isManage(): boolean {
  const u = getUser();
  return !!u && (u.role === "ADMIN" || u.teacherRole === "ACADEMIC");
}

export default function TeacherMyClasses() {
  const [classes, setClasses] = useState<TeachingClass[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [exams, setExams] = useState<ExamItem[]>([]);
  const [selExam, setSelExam] = useState<string | null>(null);
  const [rows, setRows] = useState<ScoreRow[]>([]);
  const [total, setTotal] = useState(100);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  // 新建考核表单
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({ title: "", type: "DAILY", examDate: "", totalScore: 100 });

  const loadClasses = useCallback(() => {
    setLoading(true);
    api
      .get<TeachingClass[]>("/flexible/my-classes")
      .then((d) => {
        setClasses(d || []);
        setError("");
        if (d && d.length && !selId) setSelId(d[0].id);
      })
      .catch((e) => setError(e.message || "加载失败"))
      .finally(() => setLoading(false));
  }, [selId]);

  useEffect(() => { loadClasses(); }, [loadClasses]);

  const loadClassDetail = useCallback(async (id: string) => {
    setSelId(id); setSelExam(null); setRows([]); setError("");
    try {
      const r = await api.get<{ teachingClass: TeachingClass; roster: RosterRow[] }>("/flexible/classes/" + id + "/roster");
      setRoster(r.roster || []);
      const ex = await api.get<ExamItem[]>("/flexible/classes/" + id + "/exams");
      setExams(ex || []);
    } catch (e: any) {
      setError(e.message || "加载教学班失败");
    }
  }, []);

  async function openExam(examId: string) {
    if (!selId) return;
    setSelExam(examId); setError(""); setMsg("");
    try {
      const d = await api.get<{ exam: ExamItem; rows: ScoreRow[] }>(`/flexible/classes/${selId}/exams/${examId}/scores`);
      setRows(d.rows || []);
      setTotal(d.exam.totalScore || 100);
    } catch (e: any) {
      setError(e.message || "加载成绩失败");
    }
  }

  function setScore(studentId: string, score: string) {
    setRows((prev) => prev.map((r) => (r.studentId === studentId ? { ...r, score: score === "" ? null : Number(score) } : r)));
  }
  function setComment(studentId: string, comment: string) {
    setRows((prev) => prev.map((r) => (r.studentId === studentId ? { ...r, comment } : r)));
  }

  async function saveScores() {
    if (!selId || !selExam) return;
    setError(""); setMsg("");
    try {
      const res = await api.post<{ saved: number }>(`/flexible/classes/${selId}/exams/${selExam}/scores`, {
        scores: rows.map((r) => ({ studentId: r.studentId, score: r.score, comment: r.comment })),
      });
      setMsg(`已保存 ${res.saved} 条成绩,班内排名已重算`);
      await openExam(selExam);
    } catch (e: any) {
      setError(e.message || "保存失败");
    }
  }

  async function createExam() {
    if (!selId || !newForm.title.trim()) return setError("考核名称不能为空");
    try {
      await api.post(`/flexible/classes/${selId}/exams`, newForm);
      setShowNew(false); setNewForm({ title: "", type: "DAILY", examDate: "", totalScore: 100 });
      const ex = await api.get<ExamItem[]>("/flexible/classes/" + selId + "/exams");
      setExams(ex || []);
      setMsg("考核已创建");
    } catch (e: any) {
      setError(e.message || "创建失败");
    }
  }

  const selClass = classes.find((c) => c.id === selId) || null;

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-slate-800">我的教学班 {isManage() ? "（教务/管理员:全部教学班）" : "（仅我任教的班级）"}</h2>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
      {msg && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{msg}</p>}

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* 教学班列表 */}
        <aside className="space-y-2">
          <h3 className="text-sm font-medium text-slate-500">教学班</h3>
          {loading && <p className="text-slate-400">加载中…</p>}
          {!loading && classes.length === 0 && <p className="text-slate-400">暂无教学班。</p>}
          {classes.map((c) => (
            <button
              key={c.id}
              onClick={() => loadClassDetail(c.id)}
              className={`w-full rounded-lg border p-3 text-left transition ${selId === c.id ? "border-indigo-400 bg-indigo-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
            >
              <div className="font-medium text-slate-800">{c.name}</div>
              <div className="mt-0.5 text-xs text-slate-500">
                {c.type === "LEVEL" ? "分层走班" : c.type === "ELECTIVE" ? "选课走班" : "行政班授课"} · {c._count.enrollments}人 · {c._count.exams}次考核
                {c.teachers[0] ? ` · ${c.teachers[0].teacher.name}` : ""}
              </div>
            </button>
          ))}
        </aside>

        {/* 详情 */}
        <section>
          {!selClass && <p className="text-slate-400">请选择一个教学班。</p>}
          {selClass && (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
                <div className="font-medium text-slate-800">{selClass.name}</div>
                <div className="mt-1 text-xs text-slate-500">
                  科目 {selClass.subject} · {selClass.grade} · {selClass.academicYear} {selClass.term}
                  {selClass.tier ? ` · ${selClass.tier}` : ""} · 教室 {selClass.room || "待定"} · 容量 {selClass.capacity ?? "不限"}
                  {selClass.block ? ` · 时段块 ${selClass.block.name}` : ""}
                </div>
              </div>

              {/* 考核列表 */}
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-medium text-slate-700">考核与成绩（{exams.length}）</h3>
                  <button onClick={() => setShowNew((v) => !v)} className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs text-white hover:bg-indigo-700">
                    + 新建考核
                  </button>
                </div>
                {showNew && (
                  <div className="mb-3 grid gap-2 rounded-lg bg-slate-50 p-3 md:grid-cols-4">
                    <input className="ui-input" placeholder="考核名称" value={newForm.title} onChange={(e) => setNewForm({ ...newForm, title: e.target.value })} />
                    <select className="ui-input ui-select" value={newForm.type} onChange={(e) => setNewForm({ ...newForm, type: e.target.value })}>
                      {EXAM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                    <input className="ui-input" type="date" value={newForm.examDate} onChange={(e) => setNewForm({ ...newForm, examDate: e.target.value })} />
                    <input className="ui-input" type="number" placeholder="满分" value={newForm.totalScore} onChange={(e) => setNewForm({ ...newForm, totalScore: Number(e.target.value) })} />
                    <button onClick={createExam} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white md:col-span-4">创建</button>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {exams.length === 0 && <p className="text-xs text-slate-400">暂无考核。</p>}
                  {exams.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => openExam(e.id)}
                      className={`rounded-lg border px-3 py-1.5 text-xs ${selExam === e.id ? "border-indigo-400 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                    >
                      {e.title}（{EXAM_TYPES.find((t) => t.value === e.type)?.label || e.type} · 满分{e.totalScore}）
                      {e._count ? ` · ${e._count.scores}人` : ""}
                    </button>
                  ))}
                </div>
              </div>

              {/* 成绩录入 */}
              {selExam && (
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-medium text-slate-700">成绩录入（满分 {total}）</h3>
                    <button onClick={saveScores} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white">保存成绩</button>
                  </div>
                  <div className="max-h-96 space-y-1 overflow-auto">
                    <div className="grid grid-cols-[1fr_90px_70px_1fr] gap-2 border-b border-slate-100 px-2 py-1 text-[11px] text-slate-400">
                      <span>学生（行政班）</span><span>成绩</span><span>班内排名</span><span>评语</span>
                    </div>
                    {rows.map((r) => (
                      <div key={r.studentId} className="grid grid-cols-[1fr_90px_70px_1fr] items-center gap-2 px-2 py-1 text-xs">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-slate-700">{r.name}</div>
                          <div className="truncate text-[11px] text-slate-400">{r.studentNo || ""}{r.adminClass ? ` · ${r.adminClass}` : ""}</div>
                        </div>
                        <input
                          className="ui-input px-2 py-1 text-center"
                          type="number"
                          min={0}
                          max={total}
                          value={r.score ?? ""}
                          onChange={(e) => setScore(r.studentId, e.target.value)}
                        />
                        <span className="text-center text-slate-500">{r.rankInClass ?? "-"}</span>
                        <input className="ui-input px-2 py-1" value={r.comment ?? ""} onChange={(e) => setComment(r.studentId, e.target.value)} placeholder="评语" />
                      </div>
                    ))}
                    {rows.length === 0 && <p className="text-xs text-slate-400">该教学班暂无名单。</p>}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
