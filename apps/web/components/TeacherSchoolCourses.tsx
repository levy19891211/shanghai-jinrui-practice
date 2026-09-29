"use client";

// 课程管理(教务管理「课程管理」子模块):新建与维护学校开设的所有课程(课程库)
// 数据:/api/academics/school-courses
// 权限:ADMIN / TEACHER 可查看;建 / 改 / 删 仅管理员或教务老师(teacherRole=ACADEMIC),普通教师只读
// 与班级维度的科目目录(班级管理 → 选课管理)解耦:这里维护的是「学校开哪些课」的主数据

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, getUser } from "@/lib/api";

const CATEGORIES = ["学术核心", "素养与综合", "艺术与体育", "研究与创新", "人工智能与实践"];
const GRADE_OPTIONS = ["高一", "高二", "高三"];
const TYPES = [
  { value: "REQUIRED", label: "必修" },
  { value: "ELECTIVE", label: "选修" },
];

export interface SchoolCourse {
  id: string;
  name: string;
  category: string;
  type: string;
  grades: string; // 逗号分隔多选,如 "高一,高二";空=全年级通用
  weeklyHours: number | null;
  sortOrder: number;
  active: boolean;
  note: string;
}

type Form = Partial<SchoolCourse>;

const input = "ui-input";
const select = "ui-input ui-select cursor-pointer pr-9 hover:border-slate-400 [&>option]:text-[13px]";
const label = "mb-1 block text-xs text-slate-500";

function typeLabel(t: string) {
  return t === "REQUIRED" ? "必修" : "选修";
}
function emptyForm(): Form {
  return {
    name: "",
    category: CATEGORIES[0],
    type: "ELECTIVE",
    grades: "",
    weeklyHours: null,
    sortOrder: 0,
    active: true,
    note: "",
  };
}

export default function TeacherSchoolCourses() {
  const me = getUser();
  const canManage = !!me && (me.role === "ADMIN" || me.teacherRole === "ACADEMIC");

  const [courses, setCourses] = useState<SchoolCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [editing, setEditing] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");

  // 过滤(数据量小,前端即时过滤)
  const [q, setQ] = useState("");
  const [fCategory, setFCategory] = useState("");
  const [fGrade, setFGrade] = useState("");
  const [fType, setFType] = useState("");
  const [fActive, setFActive] = useState("1"); // 默认只看在开设的课程

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<{ courses: SchoolCourse[] }>("/academics/school-courses")
      .then((d) => { setCourses(d.courses || []); setError(""); })
      .catch((e: unknown) => setError((e as Error).message || "加载失败"))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const gradeChoices = useMemo(
    () =>
      Array.from(
        new Set([...GRADE_OPTIONS, ...courses.flatMap((c) => (c.grades || "").split(",")).filter(Boolean)])
      ),
    [courses]
  );

  const filtered = useMemo(() => {
    const kw = q.trim();
    return courses.filter((c) => {
      if (fCategory && c.category !== fCategory) return false;
      if (fGrade) {
        const gs = (c.grades || "").split(",").filter(Boolean);
        if (gs.length > 0 && !gs.includes(fGrade)) return false; // 空年级=全年级通用,任何年级筛选都命中
      }
      if (fType && c.type !== fType) return false;
      if (fActive === "1" && !c.active) return false;
      if (fActive === "0" && c.active) return false;
      if (kw && !`${c.name} ${c.note}`.includes(kw)) return false;
      return true;
    });
  }, [courses, q, fCategory, fGrade, fType, fActive]);

  const stats = useMemo(() => {
    const active = courses.filter((c) => c.active).length;
    const required = courses.filter((c) => c.active && c.type === "REQUIRED").length;
    return { total: courses.length, active, elective: active - required };
  }, [courses]);

  async function save() {
    if (!editing) return;
    const name = (editing.name || "").trim();
    if (!name) { setError("课程名称不能为空"); return; }
    setSaving(true);
    try {
      const payload = {
        name,
        category: editing.category || CATEGORIES[0],
        type: editing.type === "REQUIRED" ? "REQUIRED" : "ELECTIVE",
        grades: (editing.grades || "")
          .split(",")
          .map((g) => g.trim())
          .filter(Boolean),
        weeklyHours: editing.weeklyHours === null || editing.weeklyHours === undefined || (editing.weeklyHours as unknown) === ""
          ? null
          : Number(editing.weeklyHours),
        sortOrder: Number(editing.sortOrder) || 0,
        active: editing.active !== false,
        note: (editing.note || "").trim(),
      };
      if (editing.id) {
        await api.put(`/academics/school-courses/${editing.id}`, payload);
        setToast("课程已更新");
      } else {
        await api.post("/academics/school-courses", payload);
        setToast("课程已新增");
      }
      setEditing(null);
      setError("");
      load();
    } catch (e: unknown) {
      setError((e as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(c: SchoolCourse) {
    setBusyId(c.id);
    try {
      await api.put(`/academics/school-courses/${c.id}`, { active: !c.active });
      setToast(c.active ? `已停用「${c.name}」` : `已重新启用「${c.name}」`);
      load();
    } catch (e: unknown) {
      setError((e as Error).message || "操作失败");
    } finally {
      setBusyId("");
    }
  }

  async function remove(c: SchoolCourse) {
    if (!confirm(`确认删除课程「${c.name}」${c.grades ? `(${c.grades.split(",").join("、")})` : ""}?\n\n若只是本学期不开了,建议改用「停用」保留记录。删除后不可恢复。`)) return;
    setBusyId(c.id);
    try {
      await api.del(`/academics/school-courses/${c.id}`);
      setToast("已删除课程");
      load();
    } catch (e: unknown) {
      setError((e as Error).message || "删除失败");
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-800">课程管理</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            维护学校开设的所有课程。共 {stats.total} 门,其中在开设 {stats.active} 门(必修 {stats.active - stats.elective}、选修 {stats.elective})。
            {!canManage && " 您当前为只读权限。"}
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => { setEditing(emptyForm()); setError(""); }}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700"
          >
            + 新建课程
          </button>
        )}
      </div>

      {!canManage && (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          课程库由管理员或教务老师维护;您可以查看课程开设情况。
        </p>
      )}
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>}
      {toast && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{toast}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <label className={label}>搜索</label>
          <input className={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="课程名称 / 备注" />
        </div>
        <div>
          <label className={label}>课程类别</label>
          <select className={select} value={fCategory} onChange={(e) => setFCategory(e.target.value)}>
            <option value="">全部类别</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>适用年级</label>
          <select className={select} value={fGrade} onChange={(e) => setFGrade(e.target.value)}>
            <option value="">全部年级</option>
            {gradeChoices.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>类型</label>
            <select className={select} value={fType} onChange={(e) => setFType(e.target.value)}>
              <option value="">全部</option>
              {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>状态</label>
            <select className={select} value={fActive} onChange={(e) => setFActive(e.target.value)}>
              <option value="1">在开设</option>
              <option value="0">已停用</option>
              <option value="">全部</option>
            </select>
          </div>
        </div>
      </div>

      <section className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">课程名称</th>
              <th className="px-3 py-2 text-left">类别</th>
              <th className="px-3 py-2 text-left">类型</th>
              <th className="px-3 py-2 text-left">适用年级</th>
              <th className="px-3 py-2 text-right">参考周课时数</th>
              <th className="px-3 py-2 text-center">状态</th>
              {canManage && <th className="px-3 py-2 text-right">操作</th>}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={canManage ? 7 : 6} className="px-3 py-6 text-center text-slate-400">加载中…</td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={canManage ? 7 : 6} className="px-3 py-6 text-center text-slate-400">
                  {courses.length === 0 ? "课程库还是空的,点击右上角「新建课程」开始建立。" : "没有符合筛选条件的课程。"}
                </td>
              </tr>
            )}
            {!loading && filtered.map((c) => (
              <tr key={c.id} className={`border-t border-slate-100 ${c.active ? "" : "bg-slate-50/60 text-slate-400"}`}>
                <td className="px-3 py-2 font-medium text-slate-800">
                  {c.name}
                  {c.note && <span className="ml-2 text-xs font-normal text-slate-400" title={c.note}>{c.note.length > 16 ? `${c.note.slice(0, 16)}…` : c.note}</span>}
                </td>
                <td className="px-3 py-2">{c.category}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${c.type === "REQUIRED" ? "bg-indigo-100 text-indigo-700" : "bg-sky-100 text-sky-700"}`}>
                    {typeLabel(c.type)}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {c.grades
                    ? c.grades.split(",").filter(Boolean).map((g) => (
                        <span key={g} className="mr-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{g}</span>
                      ))
                    : <span className="text-slate-400">全年级</span>}
                </td>
                <td className="px-3 py-2 text-right">{c.weeklyHours ?? "/"}</td>
                <td className="px-3 py-2 text-center">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${c.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>
                    {c.active ? "在开设" : "已停用"}
                  </span>
                </td>
                {canManage && (
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <button onClick={() => { setEditing({ ...c }); setError(""); }} className="rounded-md px-2 py-1 text-indigo-600 hover:bg-indigo-50">编辑</button>
                    <button
                      onClick={() => toggleActive(c)}
                      disabled={busyId === c.id}
                      className="ml-1 rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
                    >
                      {c.active ? "停用" : "启用"}
                    </button>
                    <button
                      onClick={() => remove(c)}
                      disabled={busyId === c.id}
                      className="ml-1 rounded-md px-2 py-1 text-rose-500 hover:bg-rose-50 disabled:opacity-50"
                    >
                      删除
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditing(null)}>
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-slate-900">{editing.id ? "编辑课程" : "新建课程"}</h3>
            <div className="mt-4 space-y-4">
              <div>
                <label className={label}>课程名称 *</label>
                <input className={input} value={editing.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="如 A Level 数学 / 进阶数学 FP2" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={label}>课程类别</label>
                  <select className={select} value={editing.category || CATEGORIES[0]} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label}>类型</label>
                  <select className={select} value={editing.type || "ELECTIVE"} onChange={(e) => setEditing({ ...editing, type: e.target.value })}>
                    {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className={label}>适用年级(可多选,都不勾选 = 全年级通用)</label>
                <div className="flex gap-5 rounded-lg border border-slate-200 px-3 py-2">
                  {GRADE_OPTIONS.map((g) => {
                    const selected = (editing.grades || "").split(",").filter(Boolean).includes(g);
                    return (
                      <label key={g} className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-600">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={(e) => {
                            const cur = (editing.grades || "").split(",").filter(Boolean);
                            const next = e.target.checked ? [...cur, g] : cur.filter((x) => x !== g);
                            setEditing({ ...editing, grades: GRADE_OPTIONS.filter((x) => next.includes(x)).join(",") });
                          }}
                        />
                        {g}
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={label}>参考周课时数</label>
                  <input className={input} type="number" min={0} max={60} step="0.5" value={editing.weeklyHours ?? ""} onChange={(e) => setEditing({ ...editing, weeklyHours: e.target.value === "" ? null : Number(e.target.value) })} placeholder="参考值,可留空" />
                </div>
                <div>
                  <label className={label}>排序(越小越前)</label>
                  <input className={input} type="number" value={editing.sortOrder ?? 0} onChange={(e) => setEditing({ ...editing, sortOrder: Number(e.target.value) })} />
                </div>
              </div>
              <div>
                <label className={label}>备注 / 课程简介</label>
                <textarea className={`${input} min-h-[64px]`} value={editing.note || ""} onChange={(e) => setEditing({ ...editing, note: e.target.value })} placeholder="如 面向高二、需先修完 P1" />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={editing.active !== false} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
                仍在开设(取消勾选=停用,保留记录但不计入开设)
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="rounded-md px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100">取消</button>
              <button onClick={save} disabled={saving} className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:opacity-50">
                {saving ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
