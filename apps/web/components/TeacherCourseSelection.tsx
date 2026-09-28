"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

// 选课管理(教师/管理员端)的班级级 UI:课程目录维护 + 学生选课代改。
// 同时被 /teacher/course-selection(独立路由,自带班级列表)与 /teacher/academics 的「选课管理」Tab 复用。
export interface ManageCls { id: string; name: string; grade?: string | null; academicYear: string; term: string; }
interface Course { id: string; name: string; type: "REQUIRED" | "ELECTIVE"; }
interface ClassCourses {
  courses: Course[];
  availableSubjects: string[];
  academicYear: string;
  term: string;
}
interface Stu { id: string; name: string; studentNo?: string | null; }
interface StudentSel {
  student: Stu;
  requiredCourses: string[];
  selectedCourseIds: string[];
  submittedAt: string | null;
  isSubmitted: boolean;
}
interface ClassSelection {
  class: ManageCls;
  courses: Course[];
  requiredCourses: string[];
  students: StudentSel[];
}

// 班级级选课管理面板(操作给定班级),由外层提供班级与刷新回调。
export function CourseSelectionClassPanel({ cls, onChanged }: { cls: ManageCls; onChanged: () => void }) {
  const [tab, setTab] = useState<"catalog" | "students">("catalog");
  const [courses, setCourses] = useState<ClassCourses | null>(null);
  const [selection, setSelection] = useState<ClassSelection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadCourses = useCallback(() => {
    setLoading(true);
    api
      .get<ClassCourses>(`/academics/classes/${cls.id}/courses`)
      .then((d) => { setCourses(d); setError(""); })
      .catch((e) => setError(e.message || "加载失败"))
      .finally(() => setLoading(false));
  }, [cls.id]);

  const loadSelection = useCallback(() => {
    api
      .get<ClassSelection>(`/academics/classes/${cls.id}/course-selection`)
      .then((d) => setSelection(d))
      .catch(() => {/* 忽略 */});
  }, [cls.id]);

  useEffect(() => {
    loadCourses();
    loadSelection();
  }, [loadCourses, loadSelection]);

  const refresh = () => { loadCourses(); loadSelection(); onChanged(); };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-base font-semibold text-slate-800">{cls.name}</div>
        <div className="mt-1 text-sm text-slate-500">{cls.academicYear} {cls.term}</div>
      </div>

      <div className="flex gap-2 border-b border-slate-200">
        {[
          { k: "catalog", label: "课程目录" },
          { k: "students", label: "学生选课" },
        ].map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k as typeof tab)}
            className={`px-4 py-2 text-sm ${
              tab === t.k ? "border-b-2 border-indigo-500 font-medium text-indigo-600" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="text-red-500">{error}</p>}
      {loading && <p className="text-slate-400">加载中…</p>}
      {!loading && tab === "catalog" && courses && (
        <CatalogPanel cls={cls} data={courses} onChanged={refresh} />
      )}
      {!loading && tab === "students" && selection && (
        <StudentSelectionPanel cls={cls} data={selection} onChanged={refresh} />
      )}
    </div>
  );
}

function CatalogPanel({ cls, data, onChanged }: { cls: ManageCls; data: ClassCourses; onChanged: () => void }) {
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<"REQUIRED" | "ELECTIVE">("ELECTIVE");
  const [busy, setBusy] = useState("");

  const addCourse = (name: string, type: "REQUIRED" | "ELECTIVE") => {
    const n = name.trim();
    if (!n) return;
    setBusy(n);
    api
      .post<{ course: Course }>(`/academics/classes/${cls.id}/courses`, { name: n, type })
      .then(() => { setNewName(""); onChanged(); })
      .catch((e) => alert(e.message || "添加失败"))
      .finally(() => setBusy(""));
  };

  const setType = (courseId: string, type: "REQUIRED" | "ELECTIVE") => {
    setBusy(courseId);
    api
      .post<{ course: Course }>(`/academics/classes/${cls.id}/courses`, { name: courseName(courseId, data.courses), type })
      .then(() => onChanged())
      .catch((e) => alert(e.message || "修改失败"))
      .finally(() => setBusy(""));
  };

  const del = (courseId: string) => {
    if (!confirm("确定删除该课程目录项?")) return;
    setBusy(courseId);
    api
      .del(`/academics/classes/${cls.id}/courses/${courseId}`)
      .then(() => onChanged())
      .catch((e) => alert(e.message || "删除失败"))
      .finally(() => setBusy(""));
  };

  return (
    <div className="space-y-5">
      {/* 现有目录 */}
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-medium text-slate-600">课程目录({data.courses.length})</h3>
        {data.courses.length === 0 && <p className="text-sm text-slate-400">尚未建立课程目录。</p>}
        <div className="space-y-2">
          {data.courses.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
              <span className="font-medium text-slate-800">{c.name}</span>
              <button
                type="button"
                disabled={busy === c.id}
                onClick={() => setType(c.id, c.type === "REQUIRED" ? "ELECTIVE" : "REQUIRED")}
                className={`rounded px-2 py-0.5 text-xs font-medium transition ${
                  c.type === "REQUIRED" ? "bg-amber-100 text-amber-700 hover:bg-amber-200" : "bg-sky-100 text-sky-700 hover:bg-sky-200"
                }`}
              >
                {c.type === "REQUIRED" ? "必修" : "选修"} ⇄
              </button>
              <button
                type="button"
                disabled={busy === c.id}
                onClick={() => del(c.id)}
                className="ml-auto rounded px-2 py-0.5 text-xs text-red-500 hover:bg-red-50"
              >
                删除
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* 从课表科目一键加入 */}
      {data.availableSubjects.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-medium text-slate-600">从课表科目加入(未入目录)</h3>
          <div className="flex flex-wrap gap-2">
            {data.availableSubjects.map((s) => (
              <button
                key={s}
                type="button"
                disabled={busy === s}
                onClick={() => addCourse(s, "ELECTIVE")}
                className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 hover:border-indigo-300 hover:text-indigo-600"
              >
                ＋ {s}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* 自定义新增 */}
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-medium text-slate-600">新增课程</h3>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="课程名称,如 英语 / A2物理"
            className="flex-1 min-w-[180px] rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-400"
          />
          <div className="flex overflow-hidden rounded-lg border border-slate-300 text-sm">
            <button
              type="button"
              onClick={() => setNewType("REQUIRED")}
              className={`px-3 py-2 ${newType === "REQUIRED" ? "bg-amber-100 text-amber-700" : "bg-white text-slate-500"}`}
            >
              必修
            </button>
            <button
              type="button"
              onClick={() => setNewType("ELECTIVE")}
              className={`px-3 py-2 ${newType === "ELECTIVE" ? "bg-sky-100 text-sky-700" : "bg-white text-slate-500"}`}
            >
              选修
            </button>
          </div>
          <button
            type="button"
            disabled={!newName.trim() || busy === "__new"}
            onClick={() => addCourse(newName, newType)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            添加
          </button>
        </div>
      </section>
    </div>
  );
}

function StudentSelectionPanel({ cls, data, onChanged }: { cls: ManageCls; data: ClassSelection; onChanged: () => void }) {
  const electives = data.courses.filter((c) => c.type === "ELECTIVE").map((c) => c.name);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const openEdit = (stu: StudentSel) => {
    setEditingId(stu.student.id);
    setPicked(new Set(stu.selectedCourseIds || []));
  };
  const toggle = (name: string) => {
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(name)) n.delete(name); else n.add(name);
      return n;
    });
  };
  const save = (studentId: string) => {
    setSaving(true);
    const selectedCourseIds = electives.filter((n) => picked.has(n));
    api
      .put<{ selection: { selectedCourseIds: string[]; submittedAt: string | null } }>(
        `/academics/classes/${cls.id}/students/${studentId}/course-selection`,
        { selectedCourseIds }
      )
      .then(() => { setEditingId(null); onChanged(); })
      .catch((e) => alert(e.message || "保存失败"))
      .finally(() => setSaving(false));
  };

  return (
    <section className="overflow-x-auto rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left">学生</th>
            <th className="px-3 py-2 text-left">学号</th>
            <th className="px-3 py-2 text-left">已选选修</th>
            <th className="px-3 py-2 text-left">状态</th>
            <th className="px-3 py-2 text-left">操作</th>
          </tr>
        </thead>
        <tbody>
          {data.students.length === 0 && (
            <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-400">该班暂无学生。</td></tr>
          )}
          {data.students.map((s) => (
            <tr key={s.student.id} className="border-t border-slate-100 align-top">
              <td className="px-3 py-2 font-medium text-slate-800">{s.student.name}</td>
              <td className="px-3 py-2 text-slate-500">{s.student.studentNo || "—"}</td>
              <td className="px-3 py-2">
                {editingId === s.student.id ? (
                  <div className="flex flex-wrap gap-1.5">
                    {electives.length === 0 && <span className="text-xs text-slate-400">无选修课</span>}
                    {electives.map((name) => {
                      const on = picked.has(name);
                      return (
                        <button
                          key={name}
                          type="button"
                          onClick={() => toggle(name)}
                          className={`rounded px-2 py-0.5 text-xs ${
                            on ? "bg-indigo-500 text-white" : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {name}
                        </button>
                      );
                    })}
                  </div>
                ) : s.selectedCourseIds.length === 0 ? (
                  <span className="text-xs text-slate-400">未选(全必修)</span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {s.selectedCourseIds.map((n) => (
                      <span key={n} className="rounded bg-sky-50 px-2 py-0.5 text-xs text-sky-700">{n}</span>
                    ))}
                  </div>
                )}
              </td>
              <td className="px-3 py-2">
                {s.isSubmitted ? (
                  <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-600">已提交</span>
                ) : (
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">未提交</span>
                )}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                {editingId === s.student.id ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => save(s.student.id)}
                      className="rounded bg-indigo-600 px-2.5 py-1 text-xs text-white hover:bg-indigo-700 disabled:opacity-60"
                    >
                      {saving ? "保存…" : "保存"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="rounded px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-100"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => openEdit(s)}
                    className="rounded px-2.5 py-1 text-xs text-indigo-600 hover:bg-indigo-50"
                  >
                    调整
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function courseName(id: string, courses: Course[]): string {
  return courses.find((c) => c.id === id)?.name || "";
}
