"use client";

// GPA 管理(教师端):成绩登记 | 课程与权重 | 成绩单
// 数据:/api/gpa/*

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import GpaReportView from "@/components/GpaReportView";
import type { GpaReportData } from "@/components/TranscriptReport";

const MODULES = ["学术核心", "素养与综合", "艺术与体育", "研究与创新", "人工智能与实践"];
const SEASONS = ["夏季学", "秋季学", "冬季学", "春季学"];
const COMPONENTS = [
  { key: "FINAL", label: "期末" },
  { key: "MIDTERM", label: "期中" },
  { key: "REGULAR", label: "平时" },
] as const;

function level(score: number | null): string | null {
  if (score == null || Number.isNaN(score)) return null;
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "E";
}
// 综合评定(与后端同构):缺项按剩余权重归一
function comprehensive(w: { final: number; midterm: number; regular: number }, comps: { FINAL?: number | null; MIDTERM?: number | null; REGULAR?: number | null }) {
  const pairs = ([
    [comps.FINAL, w.final],
    [comps.MIDTERM, w.midterm],
    [comps.REGULAR, w.regular],
  ] as [number | null | undefined, number][]).filter(([v, wt]) => v != null && !Number.isNaN(v) && wt > 0) as [number, number][];
  if (!pairs.length) return null;
  const wSum = pairs.reduce((s, [, wt]) => s + wt, 0);
  if (wSum <= 0) return null;
  return Math.round((pairs.reduce((s, [v, wt]) => s + v * wt, 0) / wSum) * 10) / 10;
}

interface Cls { id: string; name: string; grade: string; academicYear: string; term: string; }
interface Course { id: string; academicYear: string; grade: string; name: string; module: string; weeklyHours: number | null; weightFinal: number; weightMidterm: number; weightRegular: number; sortOrder: number; active: boolean; }
interface RosterStudent { id: string; name: string; studentNo: string | null; gender: string | null; birthDate: string | null; enrollmentDate: string | null; }
type Cell = { score: string; remark: string }; // 表单态(字符串便于输入)
type Grid = Record<string, Record<string, Cell>>; // studentId -> component -> cell

const input = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200";
const label = "mb-1 block text-xs text-slate-500";

// 命名导出:供教务管理页(/teacher/academics)作为「GPA管理」子模块复用;
// 默认导出保留 /teacher/gpa 直达路由
export function GpaManageView() {
  const [tab, setTab] = useState<"entry" | "courses" | "report">("entry");
  const [classes, setClasses] = useState<Cls[]>([]);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  // 登记态
  const [season, setSeason] = useState(SEASONS[1]); // 默认秋季学
  const [classId, setClassId] = useState("");
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState("");
  const [students, setStudents] = useState<RosterStudent[]>([]);
  const [grid, setGrid] = useState<Grid>({});
  const [saving, setSaving] = useState(false);

  // 课程配置态
  const [cfgYear, setCfgYear] = useState("");
  const [cfgGrade, setCfgGrade] = useState("");

  // 成绩单态
  const [reportStudent, setReportStudent] = useState<RosterStudent | null>(null);

  const course = useMemo(() => courses.find((c) => c.id === courseId) || null, [courses, courseId]);
  const years = useMemo(() => Array.from(new Set(classes.map((c) => c.academicYear))).sort().reverse(), [classes]);
  const grades = useMemo(() => Array.from(new Set(classes.map((c) => c.grade).filter(Boolean))), [classes]);

  useEffect(() => {
    api.get<{ classes: Cls[] }>("/gpa/classes")
      .then((d) => setClasses(d.classes || []))
      .catch((e) => setError(e.message));
  }, []);

  // 登记页默认:最新学年第一个班;配置页默认:最新学年+第一个年级
  useEffect(() => {
    if (!classId && classes.length) setClassId(classes[0].id);
    if (!cfgYear && years.length) setCfgYear(years[0]);
    if (!cfgGrade && grades.length) setCfgGrade(grades[0]);
  }, [classes, years, grades, classId, cfgYear, cfgGrade]);

  // 课程列表:取所选班级的学年与年级
  const entryYear = useMemo(() => classes.find((c) => c.id === classId)?.academicYear || "", [classes, classId]);
  const entryGrade = useMemo(() => classes.find((c) => c.id === classId)?.grade || "", [classes, classId]);

  const loadCourses = useCallback(() => {
    if (!entryYear || !entryGrade) { setCourses([]); return; }
    api.get<{ courses: Course[] }>(`/gpa/courses?academicYear=${encodeURIComponent(entryYear)}&grade=${encodeURIComponent(entryGrade)}`)
      .then((d) => setCourses((d.courses || []).filter((c) => c.active)))
      .catch((e) => setError(e.message));
  }, [entryYear, entryGrade]);

  useEffect(loadCourses, [loadCourses]);

  // 选定课程后:拉名册 + 成绩
  useEffect(() => {
    if (!classId || !courseId || !season) { setStudents([]); setGrid({}); return; }
    api.get<{ students: RosterStudent[] }>(`/gpa/roster?classId=${classId}`)
      .then((d) => setStudents(d.students || []))
      .catch((e) => setError(e.message));
    api.get<{ students: RosterStudent[]; scores: Grid0 }>(`/gpa/scores?courseId=${courseId}&season=${encodeURIComponent(season)}&classId=${classId}`)
      .then((d) => {
        const g: Grid = {};
        for (const s of d.students || []) {
          g[s.id] = {};
          for (const comp of COMPONENTS) {
            const v = d.scores?.[s.id]?.[comp.key];
            g[s.id][comp.key] = { score: v ? String(v.score) : "", remark: v?.remark || "" };
          }
        }
        setGrid(g);
      })
      .catch((e) => setError(e.message));
  }, [classId, courseId, season]);

  const setCell = (sid: string, comp: string, patch: Partial<Cell>) =>
    setGrid((g) => ({ ...g, [sid]: { ...(g[sid] || {}), [comp]: { ...(g[sid]?.[comp] || { score: "", remark: "" }), ...patch } } }));

  const saveBatch = async () => {
    if (!courseId || !season) return;
    setSaving(true);
    setError("");
    try {
      const entries = Object.entries(grid).flatMap(([sid, comps]) =>
        COMPONENTS.map(({ key }) => ({
          studentId: sid,
          component: key,
          score: comps[key]?.score === "" ? null : Number(comps[key]?.score),
          remark: comps[key]?.remark || null,
        }))
      );
      const r = await api.put<{ saved: number; cleared: number }>("/gpa/scores/batch", { courseId, season, entries });
      setToast(`已保存 ${r.saved} 条,清除 ${r.cleared} 条`);
      setTimeout(() => setToast(""), 2500);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-800">GPA 管理</h1>
      </div>
      {error && <p className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>}
      {toast && <p className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{toast}</p>}

      <div className="flex gap-2 border-b border-slate-200">
        {[{ k: "entry", l: "成绩登记" }, { k: "courses", l: "课程与权重" }, { k: "report", l: "成绩单" }].map((t) => (
          <button key={t.k} onClick={() => setTab(t.k as typeof tab)} className={`px-4 py-2 text-sm ${tab === t.k ? "border-b-2 border-indigo-500 font-medium text-indigo-600" : "text-slate-500 hover:text-slate-700"}`}>{t.l}</button>
        ))}
      </div>

      {/* ——— 成绩登记 ——— */}
      {tab === "entry" && (
        <section className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className={label}>班级</label>
              <select className={`${input} ui-select`} value={classId} onChange={(e) => setClassId(e.target.value)}>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}({c.academicYear})</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>课程</label>
              <select className={`${input} ui-select`} value={courseId} onChange={(e) => setCourseId(e.target.value)}>
                <option value="">请选择</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>{c.module} · {c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>学季</label>
              <select className={`${input} ui-select`} value={season} onChange={(e) => setSeason(e.target.value)}>
                {SEASONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            {course && (
              <div>
                <label className={label}>权重(期末/期中/平时)</label>
                <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-600">
                  {course.weightFinal}% / {course.weightMidterm}% / {course.weightRegular}%
                </div>
              </div>
            )}
          </div>

          {course && students.length > 0 ? (
            <section className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">学生</th>
                    {COMPONENTS.map((c) => (
                      <th key={c.key} className="px-3 py-2 text-right">{c.label}得分</th>
                    ))}
                    <th className="px-3 py-2 text-right">综合评定</th>
                    <th className="px-3 py-2 text-center">等级</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => {
                    const comps = {
                      FINAL: grid[s.id]?.FINAL?.score === "" ? null : Number(grid[s.id]?.FINAL?.score),
                      MIDTERM: grid[s.id]?.MIDTERM?.score === "" ? null : Number(grid[s.id]?.MIDTERM?.score),
                      REGULAR: grid[s.id]?.REGULAR?.score === "" ? null : Number(grid[s.id]?.REGULAR?.score),
                    };
                    const comp = comprehensive({ final: course.weightFinal, midterm: course.weightMidterm, regular: course.weightRegular }, comps);
                    const lv = level(comp);
                    return (
                      <tr key={s.id} className="border-t border-slate-100">
                        <td className="whitespace-nowrap px-3 py-2">{s.name}{s.studentNo && <span className="ml-1 text-xs text-slate-400">{s.studentNo}</span>}</td>
                        {COMPONENTS.map((c) => (
                          <td key={c.key} className="px-3 py-1.5 text-right">
                            <input
                              type="number" min={0} max={100} step="0.5"
                              value={grid[s.id]?.[c.key]?.score ?? ""}
                              onChange={(e) => setCell(s.id, c.key, { score: e.target.value })}
                              className="w-20 rounded border border-slate-300 px-2 py-1 text-right text-sm"
                              placeholder="—"
                            />
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right font-semibold text-slate-800">{comp == null ? "—" : comp}</td>
                        <td className="px-3 py-2 text-center">
                          {lv ? <span className="rounded bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-600">{lv}</span> : <span className="text-slate-300">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2">
                <p className="text-xs text-slate-400">留空=清除该项成绩;综合评定 = 已填项按权重归一化加权,等级 A≥90/B≥80/C≥70/D≥60/E</p>
                <button onClick={saveBatch} disabled={saving} className="rounded bg-indigo-600 px-4 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:opacity-50">
                  {saving ? "保存中…" : "保存本表"}
                </button>
              </div>
            </section>
          ) : (
            <p className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-center text-slate-400">
              {course ? "该班级暂无学生" : "请选择班级与课程后开始登记"}
            </p>
          )}
        </section>
      )}

      {/* ——— 课程与权重 ——— */}
      {tab === "courses" && (
        <CourseConfig
          years={years}
          grades={grades}
          year={cfgYear}
          grade={cfgGrade}
          onYear={setCfgYear}
          onGrade={setCfgGrade}
          onToast={(m) => { setToast(m); setTimeout(() => setToast(""), 2500); }}
          onError={setError}
        />
      )}

      {/* ——— 成绩单 ——— */}
      {tab === "report" && (
        <section className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className={label}>选择班级</label>
              <select
                className={`${input} ui-select`}
                value={reportStudent ? "" : classId}
                onChange={(e) => { setReportStudent(null); setClassId(e.target.value); }}
              >
                <option value="">请选择</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}({c.academicYear})</option>
                ))}
              </select>
            </div>
          </div>
          {classId && !reportStudent && (
            <RosterPicker classId={classId} onPick={setReportStudent} onError={setError} />
          )}
          {reportStudent && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <button onClick={() => setReportStudent(null)} className="text-sm text-indigo-600 hover:underline">← 返回选择学生</button>
                <StudentMetaEditor student={reportStudent} onSaved={() => setToast("学生档案已更新")} onError={setError} />
              </div>
              <GpaReportView studentId={reportStudent.id} />
            </div>
          )}
        </section>
      )}
    </div>
  );
}

type Grid0 = Record<string, Record<string, { score: number; fullScore: number; remark: string | null }>>;

function RosterPicker({ classId, onPick, onError }: { classId: string; onPick: (s: RosterStudent) => void; onError: (m: string) => void }) {
  const [students, setStudents] = useState<RosterStudent[]>([]);
  useEffect(() => {
    api.get<{ students: RosterStudent[] }>(`/gpa/roster?classId=${classId}`)
      .then((d) => setStudents(d.students || []))
      .catch((e) => onError(e.message));
  }, [classId]);
  if (!students.length) return <p className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-center text-slate-400">该班级暂无学生</p>;
  return (
    <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {students.map((s) => (
        <button
          key={s.id}
          onClick={() => onPick(s)}
          className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-left shadow-sm hover:border-indigo-400 hover:shadow"
        >
          <div className="font-medium text-slate-800">{s.name}</div>
          <div className="text-xs text-slate-400">{s.studentNo || "未设学号"}</div>
        </button>
      ))}
    </div>
  );
}

function StudentMetaEditor({ student, onSaved, onError }: { student: RosterStudent; onSaved: () => void; onError: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [gender, setGender] = useState(student.gender || "");
  const [birthDate, setBirthDate] = useState(student.birthDate ? student.birthDate.slice(0, 10) : "");
  const [enrollmentDate, setEnrollmentDate] = useState(student.enrollmentDate ? student.enrollmentDate.slice(0, 10) : "");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setGender(student.gender || "");
    setBirthDate(student.birthDate ? student.birthDate.slice(0, 10) : "");
    setEnrollmentDate(student.enrollmentDate ? student.enrollmentDate.slice(0, 10) : "");
  }, [student.id]);
  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/gpa/students/${student.id}/meta`, {
        gender: gender || null,
        birthDate: birthDate || null,
        enrollmentDate: enrollmentDate || null,
      });
      onSaved();
      setOpen(false);
    } catch (e: unknown) {
      onError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
        编辑档案信息(性别/出生/入学)
      </button>
      {open && (
        <div className="absolute left-0 top-11 z-20 w-72 space-y-2 rounded-lg border border-slate-200 bg-white p-4 shadow-lg">
          <div>
            <label className={label}>性别</label>
            <select className={`${input} ui-select`} value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="">未填写</option>
              <option value="男">男</option>
              <option value="女">女</option>
            </select>
          </div>
          <div>
            <label className={label}>出生日期</label>
            <input type="date" className={input} value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
          </div>
          <div>
            <label className={label}>入学时间</label>
            <input type="date" className={input} value={enrollmentDate} onChange={(e) => setEnrollmentDate(e.target.value)} />
          </div>
          <button onClick={save} disabled={saving} className="w-full rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:opacity-50">
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      )}
    </div>
  );
}

function CourseConfig({ years, grades, year, grade, onYear, onGrade, onToast, onError }: {
  years: string[];
  grades: string[];
  year: string;
  grade: string;
  onYear: (y: string) => void;
  onGrade: (g: string) => void;
  onToast: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Partial<Course> | null>(null);

  const load = useCallback(() => {
    if (!year || !grade) { setCourses([]); return; }
    setLoading(true);
    api.get<{ courses: Course[] }>(`/gpa/courses?academicYear=${encodeURIComponent(year)}&grade=${encodeURIComponent(grade)}`)
      .then((d) => setCourses(d.courses || []))
      .catch((e) => onError(e.message))
      .finally(() => setLoading(false));
  }, [year, grade]);
  useEffect(load, [load]);

  const save = async () => {
    if (!editing) return;
    try {
      if (editing.id) {
        await api.put(`/gpa/courses/${editing.id}`, editing);
        onToast("课程已更新");
      } else {
        await api.post("/gpa/courses", { ...editing, academicYear: year, grade });
        onToast("课程已创建");
      }
      setEditing(null);
      load();
    } catch (e: unknown) {
      onError((e as Error).message);
    }
  };

  return (
    <section className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div>
          <label className={label}>学年</label>
          <select className={`${input} ui-select`} value={year} onChange={(e) => onYear(e.target.value)}>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
            {!years.length && <option value="">(暂无班级学年)</option>}
          </select>
        </div>
        <div>
          <label className={label}>年级</label>
          <select className={`${input} ui-select`} value={grade} onChange={(e) => onGrade(e.target.value)}>
            {grades.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
            {!grades.length && <option value="">(暂无年级)</option>}
          </select>
        </div>
        <div className="flex items-end">
          <button
            onClick={() => setEditing({ module: MODULES[0], weightFinal: 50, weightMidterm: 30, weightRegular: 20, sortOrder: 0, active: true })}
            className="rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
          >
            + 新增课程
          </button>
        </div>
      </div>

      <section className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">模块</th>
              <th className="px-3 py-2 text-left">课程</th>
              <th className="px-3 py-2 text-right">周课时</th>
              <th className="px-3 py-2 text-right">期末%</th>
              <th className="px-3 py-2 text-right">期中%</th>
              <th className="px-3 py-2 text-right">平时%</th>
              <th className="px-3 py-2 text-right">排序</th>
              <th className="px-3 py-2 text-center">状态</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={9} className="px-3 py-4 text-center text-slate-400">加载中…</td></tr>
            )}
            {!loading && courses.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-4 text-center text-slate-400">该学年/年级暂无 GPA 课程,点击「新增课程」建立课程体系</td></tr>
            )}
            {courses.map((c) => (
              <tr key={c.id} className="border-t border-slate-100">
                <td className="px-3 py-2 text-slate-500">{c.module}</td>
                <td className="px-3 py-2">{c.name}</td>
                <td className="px-3 py-2 text-right">{c.weeklyHours ?? "/"}</td>
                <td className="px-3 py-2 text-right">{c.weightFinal}</td>
                <td className="px-3 py-2 text-right">{c.weightMidterm}</td>
                <td className="px-3 py-2 text-right">{c.weightRegular}</td>
                <td className="px-3 py-2 text-right">{c.sortOrder}</td>
                <td className="px-3 py-2 text-center">
                  <span className={`rounded px-2 py-0.5 text-xs ${c.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>{c.active ? "启用" : "停用"}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <button onClick={() => setEditing(c)} className="mr-2 text-indigo-600 hover:underline">编辑</button>
                  <button
                    onClick={async () => {
                      if (!confirm(`删除「${c.name}」?将同时删除其全部成绩记录,不可恢复。`)) return;
                      try {
                        const r = await api.del<{ removedScores: number }>(`/gpa/courses/${c.id}`);
                        onToast(r?.removedScores != null ? `已删除课程(清除 ${r.removedScores} 条成绩)` : "已删除");
                        load();
                      } catch (e: unknown) {
                        onError((e as Error).message);
                      }
                    }}
                    className="text-rose-500 hover:underline"
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {editing && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={() => setEditing(null)}>
          <div className="w-full max-w-md space-y-3 rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-slate-800">{editing.id ? "编辑课程" : "新增课程"}({year} · {grade})</h3>
            <div>
              <label className={label}>课程模块</label>
              <select className={`${input} ui-select`} value={editing.module || ""} onChange={(e) => setEditing({ ...editing, module: e.target.value })}>
                {MODULES.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>课程名称</label>
              <input className={input} value={editing.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="如 A Level数学" />
            </div>
            <div className="grid grid-cols-4 gap-2">
              <div>
                <label className={label}>周课时</label>
                <input className={input} type="number" min={0} step="0.5" value={editing.weeklyHours ?? ""} onChange={(e) => setEditing({ ...editing, weeklyHours: e.target.value === "" ? null : Number(e.target.value) })} placeholder="空=/" />
              </div>
              <div>
                <label className={label}>期末%</label>
                <input className={input} type="number" min={0} max={100} value={editing.weightFinal ?? 50} onChange={(e) => setEditing({ ...editing, weightFinal: Number(e.target.value) })} />
              </div>
              <div>
                <label className={label}>期中%</label>
                <input className={input} type="number" min={0} max={100} value={editing.weightMidterm ?? 30} onChange={(e) => setEditing({ ...editing, weightMidterm: Number(e.target.value) })} />
              </div>
              <div>
                <label className={label}>平时%</label>
                <input className={input} type="number" min={0} max={100} value={editing.weightRegular ?? 20} onChange={(e) => setEditing({ ...editing, weightRegular: Number(e.target.value) })} />
              </div>
            </div>
            <div>
              <label className={label}>排序(越小越靠前)</label>
              <input className={input} type="number" value={editing.sortOrder ?? 0} onChange={(e) => setEditing({ ...editing, sortOrder: Number(e.target.value) })} />
            </div>
            {editing.id && (
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={editing.active ?? true} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
                启用(停用后不出现在成绩单,但保留成绩)
              </label>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setEditing(null)} className="rounded border border-slate-300 px-4 py-1.5 text-sm text-slate-600">取消</button>
              <button onClick={save} className="rounded bg-indigo-600 px-4 py-1.5 text-sm text-white hover:bg-indigo-700">保存</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default GpaManageView;
