"use client";

import { useCallback, useEffect, useState } from "react";
import { api, getUser } from "@/lib/api";
import { useScopes, ExamAnalytics, ClassAnalytics } from "@/components/AcademicAnalytics";
import * as XLSX from "xlsx";
import Select from "@/components/Select";
import { CourseSelectionClassPanel } from "@/components/TeacherCourseSelection";
import { GpaManageView } from "@/components/TeacherGpaManage";
import { TeacherManageView } from "@/components/TeacherTeachersManage";
import TeacherPlacementWorkbench from "@/components/TeacherPlacementWorkbench";
import TeacherMyClasses from "@/components/TeacherMyClasses";
import TeacherScheduling from "@/components/TeacherScheduling";

// ============ 类型 ============
interface Cls { id: string; name: string; grade?: string | null; academicYear: string; term: string; headTeacher: { id: string; name: string } | null; studentCount: number; subjectTeachers: { id: string; subject: string; role: string; teacher: { id: string; name: string } }[]; }
interface Stu { id: string; name: string; studentNo?: string | null; }
interface Tch { id: string; name: string; role: string; }
interface ExamItem { id: string; classId: string; className: string; subject: string; title: string; type: string; examDate: string; totalScore: number; }
interface ScoreRow { id?: string; studentId: string; student: { id: string; name: string; studentNo?: string | null }; score: number; rankInClass: number | null; comment: string | null; updatedAt?: string; }
interface FeedbackItem { id: string; studentId: string; student: { id: string; name: string; studentNo?: string | null }; teacher: { id: string; name: string } | null; subject?: string | null; exam?: { id: string; title: string } | null; content: string; visibility: string; status: string; createdAt: string; }
interface TimetableItem { id: string; classId: string; dayOfWeek: number; period: number; periodLabel?: string | null; periodTime?: string | null; subject: string; teacherId?: string | null; teacher: { id: string; name: string } | null; room?: string | null; academicYear: string; term: string; }

// 连堂课跨行合并:同一天、相邻节次且「科目+教师+教室」集合完全相同 → 合并为一个跨行大格(rowSpan)
// 中间若有空节次则断开(不跨空节误合并)。teacherId 为空时回退到 teacher.id 进行匹配。
function columnSpanRuns(itemsByPeriod: Record<number, TimetableItem[]>, maxPeriod: number) {
  const sig: Record<number, string> = {};
  const itemsAt: Record<number, TimetableItem[]> = {};
  for (let p = 1; p <= maxPeriod; p++) {
    const arr = itemsByPeriod[p] || [];
    itemsAt[p] = arr;
    sig[p] = arr.map((it) => `${it.subject}|${(it as any).teacherId ?? it.teacher?.id ?? ""}|${it.room || ""}`).sort().join("::");
  }
  const runs: Record<number, { len: number; items: TimetableItem[] }> = {};
  const covered: Record<number, boolean> = {};
  for (let p = 1; p <= maxPeriod; p++) {
    if (covered[p]) continue;
    const k = sig[p];
    if (k === "") { runs[p] = { len: 1, items: [] }; continue; }
    let len = 1;
    while (p + len <= maxPeriod && sig[p + len] === k) len++;
    runs[p] = { len, items: itemsAt[p] };
    for (let q = p + 1; q < p + len; q++) covered[q] = true;
  }
  return { runs, covered };
}
interface ParentLink { id: string; parent: { id: string; name: string }; student: { id: string; name: string; studentNo?: string | null }; relation?: string | null; status: string; matchMethod?: string | null; createdAt: string; }

const DAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const SUBJECTS = ["数学", "物理", "化学", "生物"];
const TYPES: Record<string, string> = { DAILY: "日常", MONTHLY: "月考", MIDTERM: "期中", FINAL: "期末", OTHER: "其他" };
const VIS: Record<string, string> = { STUDENT: "仅学生", PARENT: "仅家长", BOTH: "学生+家长" };

// 课表配色:按去重科目排序序号、以黄金角(约137.5°)步进旋转色相生成浅底/深字,
// 科目数量不限且不同序号色相必不同(不会因调色板循环而撞色,如17门科目);
// 同一科目永远同色;同时间多课(分层走班)大格以第一门课的颜色为准。
const FALLBACK_COLOR = { bg: "#eef2ff", text: "#4338ca" }; // 查表失败兜底
function subjectColorByIndex(i: number): { bg: string; text: string } {
  const h = Math.round((i * 137.508) % 360);
  return { bg: `hsl(${h}, 65%, 93%)`, text: `hsl(${h}, 70%, 28%)` };
}
function buildSubjectColorMap(subjects: string[]): Map<string, { bg: string; text: string }> {
  const distinct = Array.from(new Set(subjects)).sort();
  const m = new Map<string, { bg: string; text: string }>();
  distinct.forEach((s, i) => m.set(s, subjectColorByIndex(i)));
  return m;
}

export default function TeacherAcademicsPage() {
  // 教务管理子模块:「课程管理」= 原教务管理内容;「GPA管理」= 原 GPA 管理页;「教师管理」= 原教师管理页(仅管理员)
  // 支持 /teacher/academics?tab=gpa 或 ?tab=teachers 直达对应子模块
  const [sub, setSub] = useState<"course" | "gpa" | "teachers" | "placement" | "myclasses" | "scheduling">("course");
  const scope = useScopes();
  const isAdmin = !!scope?.isAdmin;
  const me = getUser();
  const canManage = !!me && (me.role === "ADMIN" || me.teacherRole === "ACADEMIC");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (tab === "gpa" || (tab === "teachers" && (isAdmin || canManage)) || tab === "placement" || tab === "myclasses" || (tab === "scheduling" && canManage))
      setSub(tab as typeof sub);
  }, [isAdmin, canManage]);
  const [classes, setClasses] = useState<Cls[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadClasses = useCallback(() => {
    setLoading(true);
    api
      .get<{ classes: Cls[] }>("/academics/classes")
      .then((d) => { setClasses(d.classes || []); setError(""); })
      .catch((e) => setError(e.message || "加载失败"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadClasses(); }, [loadClasses]);

  const selected = classes.find((c) => c.id === selectedId) || null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">教务管理</h1>
        {sub === "course" && canManage && <NewClassButton onCreated={loadClasses} />}
      </div>

      {/* 子模块切换(「教师管理」管理员/教务老师可见;「分层/选课分班」教务/管理员可见) */}
      <div className="flex flex-wrap gap-1 border-b border-slate-200 text-sm">
        {(
          [
            { k: "course", l: "课程管理" },
            { k: "gpa", l: "GPA管理" },
            ...(canManage ? [{ k: "scheduling", l: "排课管理" }] : []),
            ...((isAdmin || canManage) ? [{ k: "teachers", l: "教师管理" }] : []),
            ...(canManage ? [{ k: "placement", l: "分层/选课分班" }] : []),
            { k: "myclasses", l: "我的教学班" },
          ] as { k: "course" | "gpa" | "teachers" | "placement" | "myclasses" | "scheduling"; l: string }[]
        ).map((t) => (
          <button
            key={t.k}
            onClick={() => setSub(t.k)}
            className={`px-3 py-2 ${sub === t.k ? "border-b-2 border-indigo-500 font-medium text-indigo-600" : "text-slate-500 hover:text-slate-700"}`}
          >
            {t.l}
          </button>
        ))}
      </div>

      {sub === "gpa" && <GpaManageView />}
      {sub === "teachers" && <TeacherManageView />}
      {sub === "scheduling" && canManage && <TeacherScheduling />}
      {sub === "placement" && <TeacherPlacementWorkbench />}
      {sub === "myclasses" && <TeacherMyClasses />}

      {sub === "course" && (
        <>
      {!isAdmin && !canManage && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          您是学科教师,仅可查看任教班级、录入任教科目成绩、提交反馈与查看学情统计;课表与班级成员管理由管理员负责。
        </p>
      )}
      {error && <p className="text-red-500">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-2">
          <h2 className="text-sm font-medium text-slate-500">{(isAdmin || canManage) ? "全部班级" : "我的任教班级"}</h2>
          {loading && <p className="text-slate-400">加载中…</p>}
          {!loading && classes.length === 0 && <p className="text-slate-400">{(isAdmin || canManage) ? "暂无班级,点击右上角新建。" : "您当前未任教任何班级。"}</p>}
          {classes.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className={`w-full rounded-lg border p-3 text-left transition ${selectedId === c.id ? "border-indigo-400 bg-indigo-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
            >
              <div className="font-medium text-slate-800">{c.name}</div>
              <div className="mt-0.5 text-xs text-slate-500">{c.academicYear} {c.term} · {c.studentCount}人</div>
            </button>
          ))}
        </aside>

        <section>
          {!selected && <p className="text-slate-400">请选择一个班级进行管理。</p>}
          {selected && <ClassPanel cls={selected} isAdmin={isAdmin} canManage={canManage} onChanged={loadClasses} onGoScheduling={canManage ? () => setSub("scheduling") : undefined} />}
        </section>
      </div>
        </>
      )}
    </div>
  );
}

// ============ 新建班级(仅管理员) ============
function NewClassButton({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", grade: "", academicYear: "", term: "第一学期" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    setBusy(true); setErr("");
    try {
      await api.post("/academics/classes", form);
      setOpen(false); setForm({ name: "", grade: "", academicYear: "", term: "第一学期" });
      onCreated();
    } catch (e: any) { setErr(e.message || "创建失败"); }
    finally { setBusy(false); }
  }

  if (!open) return <button onClick={() => setOpen(true)} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700">新建班级</button>;
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3">
      <Field label="班级名称"><input className="ui-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如 高三(1)班" /></Field>
      <Field label="年级"><input className="ui-input" value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} placeholder="如 高三" /></Field>
      <Field label="学年"><input className="ui-input" value={form.academicYear} onChange={(e) => setForm({ ...form, academicYear: e.target.value })} placeholder="如 2026-2027" /></Field>
      <Field label="学期">
        <Select value={form.term} onChange={(v) => setForm({ ...form, term: v })} options={[{ value: "第一学期", label: "第一学期" }, { value: "第二学期", label: "第二学期" }, { value: "全年", label: "全年" }]} />
      </Field>
      <button onClick={submit} disabled={busy} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">保存</button>
      <button onClick={() => setOpen(false)} className="rounded-md px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100">取消</button>
      {err && <span className="text-sm text-red-500">{err}</span>}
    </div>
  );
}

// ============ 班级面板 ============
// 注意:「教师反馈」(feedback) 与「家长审批」(parents) 两个子模块的入口已于本次下线,
// 仍保留在 TabKey 与下方组件定义中(未删除代码),如需恢复只需把对应项加回 ADMIN_TABS/TEACHER_TABS
// 并还原 ClassPanel 中的渲染分支。
type TabKey = "members" | "teachers" | "exams" | "feedback" | "timetable" | "parents" | "analytics" | "course";
const ADMIN_TABS: { k: TabKey; l: string }[] = [
  { k: "members", l: "班级成员" }, { k: "teachers", l: "任课教师" }, { k: "exams", l: "考试与成绩" },
  { k: "timetable", l: "课程表" }, { k: "analytics", l: "学情统计" },
];
const TEACHER_TABS: { k: TabKey; l: string }[] = [
  { k: "exams", l: "考试与成绩" }, { k: "timetable", l: "课程表" }, { k: "analytics", l: "学情统计" },
];
// 教务老师(ACADEMIC):与后端 isAcademicAdmin/canManageCourses 对齐 —— 可管理任课教师、课程目录(选课管理),
// 但班级成员(增删学生)与删除班级等破坏性操作仍限管理员。
const ACADEMIC_TABS: { k: TabKey; l: string }[] = [
  { k: "teachers", l: "任课教师" }, { k: "exams", l: "考试与成绩" }, { k: "timetable", l: "课程表" }, { k: "analytics", l: "学情统计" },
];

function ClassPanel({ cls, isAdmin, canManage, onChanged, onGoScheduling }: { cls: Cls; isAdmin: boolean; canManage: boolean; onChanged: () => void; onGoScheduling?: () => void }) {
  const [tab, setTab] = useState<TabKey>(isAdmin || canManage ? "teachers" : "exams");
  const tabs = isAdmin ? ADMIN_TABS : canManage ? ACADEMIC_TABS : TEACHER_TABS;
  // 选课管理权限与后端 canManageCourses 对齐:管理员/教务老师任意班级;教师仅本班班主任。
  const me = getUser();
  const canManageCourse = !!isAdmin || !!canManage || (me?.id != null && cls.headTeacher?.id === me.id);
  const allTabs = canManageCourse ? [...tabs, { k: "course" as TabKey, l: "选课管理" }] : tabs;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">{cls.name}</h2>
            <p className="text-sm text-slate-500">{cls.grade || "—"} · {cls.academicYear} {cls.term} · 班主任 <HeadTeacherSetter cls={cls} onChanged={onChanged} /> · {cls.studentCount}人</p>
          </div>
          {isAdmin && <ClassActions cls={cls} onChanged={onChanged} />}
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-200 text-sm">
        {allTabs.map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={`px-3 py-2 ${tab === t.k ? "border-b-2 border-indigo-500 font-medium text-indigo-600" : "text-slate-500 hover:text-slate-700"}`}
          >
            {t.l}
          </button>
        ))}
      </div>

      {tab === "members" && isAdmin && <MembersTab cls={cls} onChanged={onChanged} />}
      {tab === "teachers" && (isAdmin || canManage) && <TeachersTab cls={cls} onChanged={onChanged} />}
      {tab === "exams" && <ExamsTab cls={cls} />}
      {tab === "timetable" && <TimetableTab cls={cls} isAdmin={isAdmin} onGoScheduling={onGoScheduling} />}
      {tab === "analytics" && <ClassAnalytics classId={cls.id} />}
      {tab === "course" && canManageCourse && <CourseSelectionClassPanel cls={cls} onChanged={onChanged} />}
    </div>
  );
}

// 设置/更换班主任(管理员或教务老师可见并可编辑)
function HeadTeacherSetter({ cls, onChanged }: { cls: Cls; onChanged: () => void }) {
  const me = getUser();
  const canSet = !!me && (me.role === "ADMIN" || me.teacherRole === "ACADEMIC");
  const [editing, setEditing] = useState(false);
  const [teachers, setTeachers] = useState<Tch[]>([]);
  const [htId, setHtId] = useState<string>(cls.headTeacher?.id || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function open() {
    setErr("");
    api.get<{ teachers: Tch[] }>("/academics/teachers")
      .then((d) => { setTeachers(d.teachers); setHtId(cls.headTeacher?.id || ""); setEditing(true); })
      .catch((e) => setErr(e.message || "加载教师列表失败"));
  }
  async function save() {
    setBusy(true); setErr("");
    try {
      await api.put(`/academics/classes/${cls.id}/head-teacher`, { headTeacherId: htId || null });
      setEditing(false); onChanged();
    } catch (e: any) { setErr(e.message || "保存失败"); }
    finally { setBusy(false); }
  }

  if (!canSet) return <span>{cls.headTeacher?.name || "未设置"}</span>;
  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <span>{cls.headTeacher?.name || "未设置"}</span>
        <button onClick={open} className="rounded px-1.5 py-0.5 text-xs text-indigo-600 hover:bg-indigo-50">{cls.headTeacher ? "更换" : "设置"}</button>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Select value={htId} onChange={setHtId} options={[{ value: "", label: "（不设置）" }, ...teachers.map((t) => ({ value: t.id, label: t.role === "ADMIN" ? `${t.name}（管理员）` : t.name }))]} />
      <button onClick={save} disabled={busy} className="rounded-md bg-indigo-600 px-2 py-1 text-xs text-white hover:bg-indigo-700 disabled:opacity-50">保存</button>
      <button onClick={() => setEditing(false)} className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100">取消</button>
      {err && <span className="text-xs text-red-500">{err}</span>}
    </span>
  );
}

function ClassActions({ cls, onChanged }: { cls: Cls; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  async function del() {
    if (!confirm(`确认删除班级「${cls.name}」?此操作将级联删除其成员、考试、成绩、课表(不可恢复)。`)) return;
    setBusy(true);
    try { await api.del(`/academics/classes/${cls.id}`); onChanged(); }
    catch (e: any) { alert(e.message || "删除失败"); }
    finally { setBusy(false); }
  }
  return (
    <button onClick={del} disabled={busy} className="rounded-md px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 disabled:opacity-50">删除班级</button>
  );
}

// ============ 成员管理(仅管理员) ============
function MembersTab({ cls, onChanged }: { cls: Cls; onChanged: () => void }) {
  const [students, setStudents] = useState<Stu[]>([]);
  const [all, setAll] = useState<Stu[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [newStu, setNewStu] = useState("");

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get<{ students: Stu[] }>(`/academics/classes/${cls.id}/students`),
      api.get<{ students: Stu[] }>("/academics/students"),
    ])
      .then(([cur, pool]) => { setStudents(cur.students); setAll(pool.students); })
      .catch((e) => setErr(e.message || "加载失败"))
      .finally(() => setLoading(false));
  }, [cls.id]);

  async function add(ids: string[]) {
    setErr("");
    try { await api.post(`/academics/classes/${cls.id}/students`, { studentIds: ids }); onChanged(); }
    catch (e: any) { setErr(e.message || "添加失败"); }
  }
  async function remove(id: string) {
    try { await api.del(`/academics/classes/${cls.id}/students/${id}`); onChanged(); }
    catch (e: any) { alert(e.message || "移除失败"); }
  }

  const inClass = new Set(students.map((s) => s.id));
  const candidates = all.filter((s) => !inClass.has(s.id));

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      {err && <p className="mb-2 text-sm text-red-500">{err}</p>}
      {loading ? <p className="text-slate-400">加载中…</p> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-500">添加学生:</span>
            <div className="max-w-xs w-full">
              <Select value={newStu} onChange={setNewStu} placeholder="选择学生…" options={candidates.map((s) => ({ value: s.id, label: s.studentNo ? `${s.name} (${s.studentNo})` : s.name }))} />
            </div>
            <button
              onClick={() => { if (newStu) { add([newStu]); setNewStu(""); } }}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700"
            >添加</button>
          </div>
          <table className="min-w-full text-sm">
            <thead className="text-slate-500"><tr><th className="py-1 text-left">姓名</th><th className="py-1 text-left">学号</th><th></th></tr></thead>
            <tbody>
              {students.length === 0 && <tr><td colSpan={3} className="py-3 text-center text-slate-400">暂无成员</td></tr>}
              {students.map((s) => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="py-1.5">{s.name}</td>
                  <td className="py-1.5 text-slate-500">{s.studentNo || "—"}</td>
                  <td className="py-1.5 text-right"><button onClick={() => remove(s.id)} className="text-sm text-red-500 hover:underline">移除</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============ 任课教师管理(仅管理员) ============
function TeachersTab({ cls, onChanged }: { cls: Cls; onChanged: () => void }) {
  const [teachers, setTeachers] = useState<Tch[]>([]);
  const [subject, setSubject] = useState(SUBJECTS[0]);
  const [teacherId, setTeacherId] = useState("");
  const [role, setRole] = useState("LEAD");
  const [err, setErr] = useState("");

  useEffect(() => {
    api.get<{ teachers: Tch[] }>("/academics/teachers").then((d) => { setTeachers(d.teachers); if (d.teachers[0]) setTeacherId(d.teachers[0].id); }).catch(() => {});
  }, []);

  async function add() {
    setErr("");
    if (!teacherId) return setErr("请选择教师");
    try { await api.post(`/academics/classes/${cls.id}/teachers`, { subject, teacherId, role }); onChanged(); }
    catch (e: any) { setErr(e.message || "添加失败"); }
  }
  async function remove(linkId: string) {
    try { await api.del(`/academics/classes/${cls.id}/teachers/${linkId}`); onChanged(); }
    catch (e: any) { alert(e.message || "移除失败"); }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
      {err && <p className="text-sm text-red-500">{err}</p>}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="科目">
          <Select value={subject} onChange={setSubject} options={SUBJECTS.map((s) => ({ value: s, label: s }))} />
        </Field>
        <Field label="教师">
          <Select value={teacherId} onChange={setTeacherId} options={teachers.map((t) => ({ value: t.id, label: t.name }))} />
        </Field>
        <Field label="角色">
          <Select value={role} onChange={setRole} options={[{ value: "LEAD", label: "主讲" }, { value: "CO", label: "协同" }, { value: "ASSISTANT", label: "助教" }]} />
        </Field>
        <button onClick={add} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700">添加任教</button>
      </div>
      <table className="min-w-full text-sm">
        <thead className="text-slate-500"><tr><th className="py-1 text-left">科目</th><th className="py-1 text-left">教师</th><th className="py-1 text-left">角色</th><th></th></tr></thead>
        <tbody>
          {cls.subjectTeachers.length === 0 && <tr><td colSpan={4} className="py-3 text-center text-slate-400">暂无任课教师</td></tr>}
          {cls.subjectTeachers.map((st) => (
            <tr key={st.id} className="border-t border-slate-100">
              <td className="py-1.5">{st.subject}</td>
              <td className="py-1.5">{st.teacher.name}</td>
              <td className="py-1.5 text-slate-500">{st.role}</td>
              <td className="py-1.5 text-right"><button onClick={() => remove(st.id)} className="text-sm text-red-500 hover:underline">移除</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============ 考试与成绩 ============
function ExamsTab({ cls }: { cls: Cls }) {
  const [exams, setExams] = useState<ExamItem[]>([]);
  const [selectedExam, setSelectedExam] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const scope = useScopes();
  const isAdmin = !!scope?.isAdmin;

  const load = useCallback(() => {
    setLoading(true);
    api.get<{ exams: ExamItem[] }>(`/academics/exams?classId=${cls.id}`).then((d) => { setExams(d.exams || []); setLoading(false); }).catch(() => setLoading(false));
  }, [cls.id]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-600">考试列表</h3>
        {isAdmin && <button onClick={() => setShowCreate((v) => !v)} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700">新建考试</button>}
      </div>
      {isAdmin && showCreate && <CreateExam cls={cls} onCreated={() => { setShowCreate(false); load(); }} />}
      {loading ? <p className="text-slate-400">加载中…</p> : (
        <div className="space-y-2">
          {exams.length === 0 && <p className="text-slate-400">暂无考试。</p>}
          {exams.map((e) => (
            <button
              key={e.id}
              onClick={() => setSelectedExam(e.id)}
              className={`block w-full rounded-lg border p-3 text-left ${selectedExam === e.id ? "border-indigo-400 bg-indigo-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
            >
              <div className="font-medium text-slate-800">{e.title} <span className="text-xs text-slate-400">{e.subject} · {TYPES[e.type] || e.type}</span></div>
              <div className="text-xs text-slate-500">{new Date(e.examDate).toLocaleDateString()} · 满分 {e.totalScore}</div>
            </button>
          ))}
        </div>
      )}
      {selectedExam && (
        <div className="space-y-4">
          <ScoreEntry classId={cls.id} examId={selectedExam} onSaved={load} />
          <div>
            <h4 className="mb-1 text-sm font-medium text-slate-600">本场考试学情</h4>
            <ExamAnalytics examId={selectedExam} />
          </div>
        </div>
      )}
    </div>
  );
}

function CreateExam({ cls, onCreated }: { cls: Cls; onCreated: () => void }) {
  const [form, setForm] = useState({ subject: SUBJECTS[0], title: "", type: "DAILY", examDate: "", totalScore: 100 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    setBusy(true); setErr("");
    try {
      await api.post("/academics/exams", { ...form, classId: cls.id, examDate: new Date(form.examDate).toISOString() });
      onCreated();
    } catch (e: any) { setErr(e.message || "创建失败"); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3">
      <Field label="科目"><Select value={form.subject} onChange={(v) => setForm({ ...form, subject: v })} options={SUBJECTS.map((s) => ({ value: s, label: s }))} /></Field>
      <Field label="名称"><input className="ui-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="如 第一次月考" /></Field>
      <Field label="类型">
        <Select value={form.type} onChange={(v) => setForm({ ...form, type: v })} options={Object.entries(TYPES).map(([k, v]) => ({ value: k, label: v }))} />
      </Field>
      <Field label="日期"><input type="date" className="ui-input" value={form.examDate} onChange={(e) => setForm({ ...form, examDate: e.target.value })} /></Field>
      <Field label="满分"><input type="number" className="ui-input w-20" value={form.totalScore} onChange={(e) => setForm({ ...form, totalScore: Number(e.target.value) })} /></Field>
      <button onClick={submit} disabled={busy} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">保存</button>
      {err && <span className="text-sm text-red-500">{err}</span>}
    </div>
  );
}

function ScoreEntry({ classId, examId, onSaved }: { classId: string; examId: string; onSaved: () => void }) {
  const [rows, setRows] = useState<ScoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get<{ students: Stu[] }>(`/academics/classes/${classId}/students`),
      api.get<{ scores: ScoreRow[] }>(`/academics/exams/${examId}`),
    ]).then(([mem, exam]) => {
      const scoreMap = new Map(exam.scores.map((s) => [s.studentId, s]));
      setRows(mem.students.map((st) => {
        const sc = scoreMap.get(st.id);
        return { studentId: st.id, student: st, score: sc ? sc.score : 0, rankInClass: sc ? sc.rankInClass : null, comment: sc ? sc.comment : "" };
      }));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [classId, examId]);

  function setVal(i: number, key: "score" | "rankInClass" | "comment", val: any) {
    setRows((rs) => rs.map((r, idx) => idx === i ? { ...r, [key]: val } : r));
  }

  async function save() {
    setBusy(true); setErr("");
    try {
      await api.put(`/academics/exams/${examId}/scores`, {
        scores: rows.map((r) => ({
          studentId: r.studentId,
          score: Number(r.score),
          rankInClass: r.rankInClass == null ? null : r.rankInClass,
          comment: r.comment || null,
        })),
      });
      onSaved();
    } catch (e: any) { setErr(e.message || "保存失败"); }
    finally { setBusy(false); }
  }

  if (loading) return <p className="text-slate-400">加载中…</p>;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-medium text-slate-600">录入成绩</h4>
        <button onClick={save} disabled={busy} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">保存成绩</button>
      </div>
      {err && <p className="mb-2 text-sm text-red-500">{err}</p>}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-slate-500"><tr><th className="py-1 text-left">姓名</th><th className="py-1 text-left">学号</th><th className="py-1 w-24">得分</th><th className="py-1 w-24">班级排名</th><th className="py-1 text-left">评语</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.studentId} className="border-t border-slate-100">
                <td className="py-1.5">{r.student.name}</td>
                <td className="py-1.5 text-slate-500">{r.student.studentNo || "—"}</td>
                <td className="py-1.5"><input type="number" className="ui-input w-20" value={r.score} onChange={(e) => setVal(i, "score", Number(e.target.value))} /></td>
                <td className="py-1.5"><input type="number" className="ui-input w-20" value={r.rankInClass ?? ""} onChange={(e) => setVal(i, "rankInClass", e.target.value === "" ? null : Number(e.target.value))} /></td>
                <td className="py-1.5"><input className="ui-input" value={r.comment || ""} onChange={(e) => setVal(i, "comment", e.target.value)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============ 教师反馈(入口已下线,代码保留) ============
// 说明:班级面板已移除「教师反馈」子模块入口;此组件不再被渲染,保留以便按需恢复。
// 学生端/家长端的「教师反馈」展示 Tab 仍读取 TeacherFeedback 数据(历史记录不受影响)。
function FeedbackTab({ cls }: { cls: Cls }) {
  const [list, setList] = useState<FeedbackItem[]>([]);
  const [students, setStudents] = useState<Stu[]>([]);
  const [form, setForm] = useState({ studentId: "", subject: "", content: "", visibility: "BOTH", status: "PUBLISHED" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    api.get<{ feedbacks: FeedbackItem[] }>(`/academics/feedbacks?studentId=&status=`).then((d) => setList(d.feedbacks || [])).catch(() => {});
  }, []);
  useEffect(() => { load(); api.get<{ students: Stu[] }>(`/academics/classes/${cls.id}/students`).then((d) => { setStudents(d.students); if (d.students[0]) setForm((f) => ({ ...f, studentId: f.studentId || d.students[0].id })); }).catch(() => {}); }, [cls.id, load]);

  async function submit() {
    setBusy(true); setErr("");
    try { await api.post("/academics/feedbacks", form); setForm({ ...form, content: "", status: "PUBLISHED" }); load(); }
    catch (e: any) { setErr(e.message || "创建失败"); }
    finally { setBusy(false); }
  }
  async function publish(id: string) { try { await api.post(`/academics/feedbacks/${id}/publish`); load(); } catch (e: any) { alert(e.message); } }
  async function remove(id: string) { try { await api.del(`/academics/feedbacks/${id}`); load(); } catch (e: any) { alert(e.message); } }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-2">
        <h4 className="text-sm font-medium text-slate-600">新建反馈</h4>
        {err && <p className="text-sm text-red-500">{err}</p>}
        <div className="flex flex-wrap items-end gap-2">
          <Field label="学生"><Select value={form.studentId} onChange={(v) => setForm({ ...form, studentId: v })} options={students.map((s) => ({ value: s.id, label: s.name }))} /></Field>
          <Field label="科目"><input className="ui-input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="可选" /></Field>
          <Field label="可见性">
            <Select value={form.visibility} onChange={(v) => setForm({ ...form, visibility: v })} options={[{ value: "BOTH", label: "学生+家长" }, { value: "STUDENT", label: "仅学生" }, { value: "PARENT", label: "仅家长" }]} />
          </Field>
          <Field label="状态">
            <Select value={form.status} onChange={(v) => setForm({ ...form, status: v })} options={[{ value: "PUBLISHED", label: "直接发布" }, { value: "DRAFT", label: "存为草稿" }]} />
          </Field>
        </div>
        <textarea className="ui-input min-h-[80px] w-full" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="反馈内容…" />
        <button onClick={submit} disabled={busy} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">提交</button>
      </div>

      <div className="space-y-2">
        {list.length === 0 && <p className="text-slate-400">暂无反馈。</p>}
        {list.map((f) => (
          <div key={f.id} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span className="font-medium text-slate-600">{f.student.name}</span>
              {f.subject && <span className="rounded bg-slate-100 px-1.5 py-0.5">{f.subject}</span>}
              <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-600">{VIS[f.visibility] || f.visibility}</span>
              <span className={`rounded px-1.5 py-0.5 ${f.status === "DRAFT" ? "bg-amber-50 text-amber-600" : "bg-emerald-50 text-emerald-600"}`}>{f.status === "DRAFT" ? "草稿" : "已发布"}</span>
              <span>{new Date(f.createdAt).toLocaleDateString()}</span>
            </div>
            <p className="whitespace-pre-wrap text-sm text-slate-700">{f.content}</p>
            <div className="mt-2 flex gap-3 text-sm">
              {f.status === "DRAFT" && <button onClick={() => publish(f.id)} className="text-emerald-600 hover:underline">发布</button>}
              <button onClick={() => remove(f.id)} className="text-red-500 hover:underline">删除</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============ 课程表(管理员可编辑+导入;教师只读) ============
function TimetableTab({ cls, isAdmin, onGoScheduling }: { cls: Cls; isAdmin: boolean; onGoScheduling?: () => void }) {
  const [entries, setEntries] = useState<TimetableItem[]>([]);
  const [teachers, setTeachers] = useState<Tch[]>([]);
  const [form, setForm] = useState({ dayOfWeek: 1, period: 1, subject: SUBJECTS[0], teacherId: "", room: "", academicYear: cls.academicYear, term: cls.term });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(() => { api.get<{ entries: TimetableItem[] }>(`/academics/timetable?classId=${cls.id}`).then((d) => setEntries(d.entries || [])).catch(() => {}); }, [cls.id]);
  useEffect(() => {
    load();
    if (isAdmin) api.get<{ teachers: Tch[] }>("/academics/teachers").then((d) => { setTeachers(d.teachers); if (d.teachers[0]) setForm((f) => ({ ...f, teacherId: f.teacherId || d.teachers[0].id })); }).catch(() => {});
  }, [cls.id, load, isAdmin]);

  async function add() {
    setBusy(true); setErr("");
    try { await api.post("/academics/timetable", form); setForm({ ...form, room: "" }); load(); }
    catch (e: any) { setErr(e.message || "添加失败"); }
    finally { setBusy(false); }
  }
  async function remove(id: string) { try { await api.del(`/academics/timetable/${id}`); load(); } catch (e: any) { alert(e.message); } }

  // 同时段可能有多条(分层走班:如"数学/A2物理"),用数组避免互相覆盖
  const grid: Record<number, Record<number, TimetableItem[]>> = {};
  entries.forEach((e) => {
    grid[e.dayOfWeek] = grid[e.dayOfWeek] || {};
    (grid[e.dayOfWeek][e.period] = grid[e.dayOfWeek][e.period] || []).push(e);
  });
  const maxPeriod = entries.reduce((m, e) => Math.max(m, e.period), 0);
  // 行头节次名/时间:取该节次任一条目的 periodLabel/periodTime(导入网格时携带)
  const periodMeta: Record<number, { label?: string | null; time?: string | null }> = {};
  entries.forEach((e) => { if (!periodMeta[e.period] && (e.periodLabel || e.periodTime)) periodMeta[e.period] = { label: e.periodLabel, time: e.periodTime }; });
  // 预计算每列的跨行合并信息(连堂课合并为 rowSpan 大格)
  const spanByDay: Record<number, { runs: Record<number, { len: number; items: TimetableItem[] }>; covered: Record<number, boolean> }> = {};
  for (let d = 1; d <= 7; d++) spanByDay[d] = columnSpanRuns(grid[d] || {}, maxPeriod);
  // 科目配色映射:基于当前课表去重科目,保证不同科目不同色(数量<=调色板)
  const subjectColorMap = buildSubjectColorMap(entries.map((e) => e.subject));

  return (
    <div className="space-y-4">
      {isAdmin && onGoScheduling && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs text-slate-600">
          <span>建议改用「排课管理」:先在「组课」把课程与教师绑成课程块,再拖进课表网格。本页保留单条增删改与整表导入。</span>
          <button onClick={onGoScheduling} className="shrink-0 rounded-md border border-indigo-200 bg-white px-2 py-1 font-medium text-indigo-600 hover:bg-indigo-50">前往排课管理 →</button>
        </div>
      )}
      {isAdmin && (
        <TimetableImport cls={cls} onDone={load} teachers={teachers} />
      )}
      {isAdmin && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-2">
          <h4 className="text-sm font-medium text-slate-600">新增课表条目</h4>
          {err && <p className="text-sm text-red-500">{err}</p>}
          <div className="flex flex-wrap items-end gap-2">
            <Field label="星期"><Select value={String(form.dayOfWeek)} onChange={(v) => setForm({ ...form, dayOfWeek: Number(v) })} options={DAYS.map((d, i) => ({ value: String(i + 1), label: d }))} /></Field>
            <Field label="节次"><input type="number" className="ui-input w-16" value={form.period} onChange={(e) => setForm({ ...form, period: Number(e.target.value) })} /></Field>
            <Field label="科目"><Select value={form.subject} onChange={(v) => setForm({ ...form, subject: v })} options={SUBJECTS.map((s) => ({ value: s, label: s }))} /></Field>
            <Field label="教师"><Select value={form.teacherId} onChange={(v) => setForm({ ...form, teacherId: v })} options={teachers.map((t) => ({ value: t.id, label: t.name }))} /></Field>
            <Field label="教室"><input className="ui-input w-20" value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} /></Field>
            <button onClick={add} disabled={busy} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">添加</button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white p-2">
        {entries.length === 0 ? <p className="p-4 text-slate-400">暂无课表。</p> : (
          <table className="min-w-full text-sm">
            <thead className="text-slate-500"><tr><th className="px-2 py-1 text-left">节次</th>{DAYS.map((d) => <th key={d} className="px-2 py-1 text-center">{d}</th>)}</tr></thead>
            <tbody>
              {Array.from({ length: maxPeriod }, (_, i) => i + 1).map((p) => (
                <tr key={p} className="border-t border-slate-100">
                  <td className="whitespace-nowrap px-2 py-1 text-slate-500">
                    <div>{periodMeta[p]?.label || `第 ${p} 节`}</div>
                    {periodMeta[p]?.time && <div className="text-[10px] text-slate-400">{periodMeta[p].time}</div>}
                  </td>
                  {DAYS.map((_, di) => {
                    const d = di + 1;
                    const span = spanByDay[d];
                    if (span.covered[p]) return null;
                    const run = span.runs[p];
                    if (!run || run.items.length === 0) return <td key={di} className="px-2 py-1 align-top" />;
                    // 同一 run 内多科(分层走班)合并为一张卡片,每科单列一行;管理员 hover 逐科删除。
                    // 撑满方案:td 设 relative,卡片层 absolute inset 铺满整个跨行单元格;
                    // 另留一份 invisible 占位副本参与行高计算,防止内容被裁切。
                    const teachersLabel = Array.from(new Set(run.items.map((it) => it.teacher?.name).filter(Boolean))).join(" / ") || "—";
                    const roomsLabel = Array.from(new Set(run.items.map((it) => it.room).filter(Boolean))).join(" / ");
                    // 同时间多课(分层走班)大格以第一门课颜色为准
                    const color = subjectColorMap.get(run.items[0]?.subject || "—") || FALLBACK_COLOR;
                    const cardInner = (withDelete: boolean) => (
                      <>
                        {run.items.map((item) => (
                          <div key={item.id} className="font-medium" style={{ color: color.text }}>
                            {item.subject}
                            {withDelete && isAdmin && <button onClick={() => remove(item.id)} className="ml-1 hidden align-middle text-xs font-normal text-red-500 group-hover:inline">删除</button>}
                          </div>
                        ))}
                        <div className="mt-0.5 text-xs text-slate-500">{teachersLabel}</div>
                        {roomsLabel && <div className="text-xs text-slate-400">{roomsLabel}</div>}
                      </>
                    );
                    return (
                      <td key={di} rowSpan={run.len} className="relative px-1 py-1 align-top">
                        <div className="invisible flex flex-col gap-1" aria-hidden="true">
                          <div className="rounded px-1.5 py-2 text-center" style={{ backgroundColor: color.bg }}>{cardInner(false)}</div>
                        </div>
                        <div className="absolute inset-1 flex flex-col items-stretch gap-1">
                          <div className="group flex flex-1 flex-col items-center justify-center rounded px-1.5 py-2 text-center" style={{ backgroundColor: color.bg }}>{cardInner(true)}</div>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ============ 管理员:Excel/CSV 批量导入课表 ============
function TimetableImport({ cls, onDone, teachers }: { cls: Cls; onDone: () => void; teachers: Tch[] }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [mode, setMode] = useState<"append" | "replace">("append");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const nameToId = Object.fromEntries(teachers.map((t) => [t.name, t.id]));

  function parseDay(v: any): number | null {
    if (v == null) return null;
    const s = String(v).trim();
    const map: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
    if (/^[1-7]$/.test(s)) return Number(s);
    const m = s.match(/[一二三四五六日天]/);
    if (m) return map[m[0]];
    return null;
  }
  function pick(row: any, keys: string[]): any {
    for (const k of keys) if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== "") return row[k];
    return undefined;
  }
  // 星期表头(列)→ dayOfWeek
  function parseDayHeader(s: string): number | null {
    const t = String(s || "").trim();
    if (/周一|星期一|mon/i.test(t)) return 1;
    if (/周二|星期二|tue/i.test(t)) return 2;
    if (/周三|星期三|wed/i.test(t)) return 3;
    if (/周四|星期四|thu/i.test(t)) return 4;
    if (/周五|星期五|fri/i.test(t)) return 5;
    if (/周六|星期六|sat/i.test(t)) return 6;
    if (/周日|星期日|周天|sun/i.test(t)) return 7;
    return null;
  }
  // 检测「节次 × 星期」网格表头:首列含「节次」且后续列出现 ≥3 个星期表头
  function detectMatrixHeader(raw: any[][]): { row: number; dayCols: { col: number; day: number }[] } | null {
    for (let i = 0; i < raw.length; i++) {
      const row = raw[i] || [];
      const first = String(row[0] || "").trim();
      const isPeriodCol = first.includes("节次") || first === "节" || /period/i.test(first);
      if (!isPeriodCol) continue;
      const dayCols: { col: number; day: number }[] = [];
      for (let j = 1; j < row.length; j++) {
        const d = parseDayHeader(String(row[j] || ""));
        if (d != null) dayCols.push({ col: j, day: d });
      }
      if (dayCols.length >= 3) return { row: i, dayCols };
    }
    return null;
  }
  // 解析网格:每行=一个时段,每列=一天;一格多科用 / 分隔自动拆成多条;网格无教师/教室列时留空
  // fillMap: 纵向合并单元格填充映射("r:c"->顶部值),使连堂课在每个被占节次都有条目(忠实呈现)
  function parseMatrix(raw: any[][], header: { row: number; dayCols: { col: number; day: number }[] }, fillMap: Map<string, string>): any[] {
    const out: any[] = [];
    let periodIndex = 0;
    for (let i = header.row + 1; i < raw.length; i++) {
      const row = raw[i] || [];
      const periodRaw = String(row[0] || "").trim();
      if (periodRaw === "") continue;
      periodIndex++;
      const periodLabel = periodRaw.split(/\n/)[0].trim();
      const tm = periodRaw.match(/(\d{1,2}:\d{2})\s*[-–—~]\s*(\d{1,2}:\d{2})/);
      const periodTime = tm ? `${tm[1]}-${tm[2]}` : "";
      for (const { col, day } of header.dayCols) {
        const cell = String(fillMap.get(`${i}:${col}`) ?? row[col] ?? "").trim();
        if (cell === "") continue;
        const parts = cell.split(/\s*[／/、]\s*/).map((s) => s.trim()).filter((s) => s !== "");
        for (const subj of parts) {
          out.push({ dayOfWeek: day, period: periodIndex, periodLabel, periodTime, subject: subj, teacherId: undefined, room: "", _row: i + 1, _ok: true });
        }
      }
    }
    return out;
  }

  async function onFile(f: File) {
    setFile(f); setPreview([]); setWarnings([]); setMsg(""); setErr("");
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as any[][];
      if (raw.length === 0) { setErr("文件无数据"); return; }
      const warns: string[] = [];
      const matrix = detectMatrixHeader(raw);
      let entries: any[];
      if (matrix) {
        // 纵向合并单元格(连堂课):把顶部值填充到合并范围内的每一行,保证每个被占节次都有条目
        const fillMap = new Map<string, string>();
        for (const m of ((ws as any)["!merges"] || []) as any[]) {
          if (m.s.r === m.e.r) continue;
          if (m.s.c === 0) continue;
          const top = String((raw[m.s.r] || [])[m.s.c] ?? "").trim();
          if (!top) continue;
          for (let r = m.s.r + 1; r <= m.e.r; r++) fillMap.set(`${r}:${m.s.c}`, top);
        }
        entries = parseMatrix(raw, matrix, fillMap);
      } else {
        const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
        if (rows.length === 0) { setErr("文件无数据"); return; }
        entries = rows.map((r, idx) => {
          const dayRaw = pick(r, ["星期", "周几", "dayOfWeek", "day", "星期几"]);
          const periodRaw = pick(r, ["节次", "节", "period", "第几节"]);
          const subject = pick(r, ["科目", "subject", "课程"]);
          const teacherName = pick(r, ["教师", "teacher", "老师"]);
          const room = pick(r, ["教室", "room", "地点"]);
          const dayOfWeek = parseDay(dayRaw);
          const period = periodRaw != null ? Number(periodRaw) : NaN;
          const subjectStr = subject != null ? String(subject).trim() : "";
          let teacherId: string | undefined = undefined;
          if (teacherName != null) {
            const id = nameToId[String(teacherName).trim()];
            if (id) teacherId = id;
            else warns.push(`第 ${idx + 2} 行:教师「${teacherName}」未在系统匹配,将留空`);
          }
          return {
            dayOfWeek, period, subject: subjectStr, teacherId, room: room != null ? String(room).trim() : "",
            _row: idx + 2,
            _ok: dayOfWeek != null && !Number.isNaN(period) && subjectStr !== "",
          };
        });
      }
      setPreview(entries);
      if (warns.length) setWarnings(warns);
    } catch (e: any) {
      setErr(e.message || "解析失败");
    }
  }

  async function submit() {
    const valid = preview.filter((p) => p._ok).map(({ dayOfWeek, period, periodLabel, periodTime, subject, teacherId, room }) => ({ dayOfWeek, period, periodLabel, periodTime, subject, teacherId, room, academicYear: cls.academicYear, term: cls.term }));
    if (valid.length === 0) { setErr("没有可导入的有效行"); return; }
    setBusy(true); setErr(""); setMsg("");
    try {
      const res = await api.post<{ created: number; skipped: number; errors: any[] }>(`/academics/classes/${cls.id}/timetable/import`, { entries: valid, mode });
      let msg = `已${mode === "replace" ? "替换" : "追加"}导入:成功 ${res.created} 条,跳过 ${res.skipped} 条`;
      if (res.errors && res.errors.length) {
        const reasons = Array.from(new Set(res.errors.map((x: any) => x.reason).filter(Boolean))).slice(0, 3).join("; ");
        msg += `(原因: ${reasons}${res.errors.length > 3 ? " 等" : ""})`;
      }
      setMsg(msg);
      setFile(null); setPreview([]);
      onDone();
    } catch (e: any) { setErr(e.message || "导入失败"); }
    finally { setBusy(false); }
  }

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-4 space-y-3">
      <h4 className="text-sm font-medium text-indigo-700">批量导入课表(Excel/CSV)</h4>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          选择文件(.xlsx/.xls/.csv)
          <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} className="ui-input w-64" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          导入方式
          <Select value={mode} onChange={(v) => setMode(v as "append" | "replace")} options={[{ value: "append", label: "追加(保留已有)" }, { value: "replace", label: "替换(先清空再导入)" }]} />
        </label>
        <button onClick={submit} disabled={busy || preview.length === 0} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">确认导入</button>
      </div>
      <p className="text-xs text-slate-500">支持两种格式:① 扁平(每行一条)列名:星期/周几、节次/节、科目、教师、教室;② 网格(节次×星期)首列节次(可含时间,如"第一节 8:15-8:55")、后列周一…周五;一格多科用 / 分隔自动拆成多条(分层走班),纵向合并单元格(连堂课)自动填充到每个被占节次。教师按姓名匹配系统账号;网格无教师/教室列时留空。</p>
      {err && <p className="text-sm text-red-500">{err}</p>}
      {msg && <p className="text-sm text-emerald-600">{msg}</p>}
      {warnings.length > 0 && (
        <details className="text-xs text-amber-700">
          <summary>导入提示({warnings.length})</summary>
          <ul className="list-disc pl-5">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </details>
      )}
      {preview.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-white/60 text-slate-500"><tr>
              <th className="px-2 py-1 text-left">行</th><th className="px-2 py-1 text-left">星期</th><th className="px-2 py-1 text-left">节次</th><th className="px-2 py-1 text-left">时间</th>
              <th className="px-2 py-1 text-left">科目</th><th className="px-2 py-1 text-left">教师</th><th className="px-2 py-1 text-left">教室</th><th className="px-2 py-1 text-left">校验</th>
            </tr></thead>
            <tbody>
              {preview.map((p, pi) => (
                <tr key={pi} className="border-t border-indigo-100">
                  <td className="px-2 py-1">{p._row}</td>
                  <td className="px-2 py-1">{DAYS[p.dayOfWeek - 1] || <span className="text-red-500">?</span>}</td>
                  <td className="px-2 py-1">{Number.isNaN(p.period) ? <span className="text-red-500">?</span> : (p.periodLabel || p.period)}</td>
                  <td className="px-2 py-1">{p.periodTime || "—"}</td>
                  <td className="px-2 py-1">{p.subject || <span className="text-red-500">?</span>}</td>
                  <td className="px-2 py-1">{p.teacherId ? "✓" : "—"}</td>
                  <td className="px-2 py-1">{p.room || "—"}</td>
                  <td className="px-2 py-1">{p._ok ? <span className="text-emerald-600">有效</span> : <span className="text-red-500">缺字段</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============ 家长审批(仅管理员,入口已下线,代码保留) ============
// 说明:班级面板已移除「家长审批」子模块入口;此组件不再被渲染,保留以便按需恢复。
// 后端 /api/academics/parent-links 系列接口未改动。学号+姓名精确匹配的家长注册仍会自动 VERIFIED;
// 仅「匹配不上的」家长关联会停在 PENDING,当前无前台审批入口(如需恢复可加回 Tab)。
function ParentsTab() {
  const [links, setLinks] = useState<ParentLink[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.get<{ links: ParentLink[] }>("/academics/parent-links").then((d) => { setLinks(d.links || []); setLoading(false); }).catch(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(id: string, kind: "approve" | "reject") {
    try { await api.post(`/academics/parent-links/${id}/${kind}`); load(); }
    catch (e: any) { alert(e.message || "操作失败"); }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h4 className="mb-2 text-sm font-medium text-slate-600">待审批家长关联</h4>
      {loading ? <p className="text-slate-400">加载中…</p> : links.length === 0 ? <p className="text-slate-400">暂无待审批申请。</p> : (
        <table className="min-w-full text-sm">
          <thead className="text-slate-500"><tr><th className="py-1 text-left">家长</th><th className="py-1 text-left">学生</th><th className="py-1 text-left">关系</th><th className="py-1 text-left">匹配方式</th><th className="py-1 text-left">申请时间</th><th></th></tr></thead>
          <tbody>
            {links.map((l) => (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="py-1.5">{l.parent.name}</td>
                <td className="py-1.5">{l.student.name}{l.student.studentNo ? ` (${l.student.studentNo})` : ""}</td>
                <td className="py-1.5 text-slate-500">{l.relation || "—"}</td>
                <td className="py-1.5 text-slate-500">{l.matchMethod === "EXACT" ? "学号+姓名精确匹配" : "手动"}</td>
                <td className="py-1.5 text-slate-500">{new Date(l.createdAt).toLocaleDateString()}</td>
                <td className="py-1.5 text-right">
                  <button onClick={() => act(l.id, "approve")} className="mr-2 rounded-md bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-700">通过</button>
                  <button onClick={() => act(l.id, "reject")} className="rounded-md px-2 py-1 text-xs text-red-500 hover:bg-red-50">驳回</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ============ 通用字段包装 ============
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-500">
      {label}
      {children}
    </label>
  );
}
