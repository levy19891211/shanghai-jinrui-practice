"use client";

import { useCallback, useEffect, useState } from "react";
import { api, getUser } from "@/lib/api";
import { useScopes, ExamAnalytics, ClassAnalytics } from "@/components/AcademicAnalytics";
import Select from "@/components/Select";
import { CourseSelectionClassPanel } from "@/components/TeacherCourseSelection";
import { GpaManageView } from "@/components/TeacherGpaManage";
import { TeacherManageView } from "@/components/TeacherTeachersManage";
import TeacherPlacementWorkbench from "@/components/TeacherPlacementWorkbench";
import TeacherMyClasses from "@/components/TeacherMyClasses";
import TeacherScheduling from "@/components/TeacherScheduling";
import TeacherSchoolCourses from "@/components/TeacherSchoolCourses";

// ============ 类型 ============
interface Cls { id: string; name: string; grade?: string | null; academicYear: string; term: string; headTeacher: { id: string; name: string } | null; studentCount: number; subjectTeachers: { id: string; subject: string; role: string; teacher: { id: string; name: string } }[]; }
interface Stu { id: string; name: string; studentNo?: string | null; }
interface Tch { id: string; name: string; role: string; }
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
  // 教务管理子模块:
  //   「班级管理」(key=course) = 班级列表 + 班内管理(任课教师/考试/课程表/学情统计/选课管理);原名为「课程管理」
  //   「课程管理」(key=catalog) = 学校开设课程库的维护(新建/编辑/停用/删除),见 components/TeacherSchoolCourses
  //   「GPA管理」= 原 GPA 管理页;「教师管理」= 原教师管理页(管理员/教务老师可见)
  // 支持 /teacher/academics?tab=gpa 或 ?tab=teachers 或 ?tab=catalog 直达对应子模块
  const [sub, setSub] = useState<"course" | "catalog" | "gpa" | "teachers" | "placement" | "myclasses" | "scheduling">("course");
  const scope = useScopes();
  const isAdmin = !!scope?.isAdmin;
  const me = getUser();
  const canManage = !!me && (me.role === "ADMIN" || me.teacherRole === "ACADEMIC");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (tab === "catalog" || tab === "gpa" || (tab === "teachers" && (isAdmin || canManage)) || tab === "placement" || tab === "myclasses" || (tab === "scheduling" && canManage))
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
            { k: "course", l: "班级管理" },
            { k: "catalog", l: "课程管理" },
            { k: "gpa", l: "GPA管理" },
            ...(canManage ? [{ k: "scheduling", l: "排课管理" }] : []),
            ...((isAdmin || canManage) ? [{ k: "teachers", l: "教师管理" }] : []),
            ...(canManage ? [{ k: "placement", l: "分层/选课分班" }] : []),
            { k: "myclasses", l: "我的教学班" },
          ] as { k: "course" | "catalog" | "gpa" | "teachers" | "placement" | "myclasses" | "scheduling"; l: string }[]
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

      {sub === "catalog" && <TeacherSchoolCourses />}
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
      {tab === "teachers" && (isAdmin || canManage) && <TeachersTab cls={cls} onGoScheduling={onGoScheduling} />}
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

// ============ 任课教师(只读:来源 = 排课管理 → 排课 的课表) ============
// 完全按该班课表中已确认的课程生成,不可在此编辑;调整请到排课管理改课表 / 课程块任课教师。
interface SubjectTeacherGroup {
  subject: string;
  periods: number;
  teachers: { id: string | null; name: string | null; periods: number }[];
  rooms: string[];
}
function TeachersTab({ cls, onGoScheduling }: { cls: Cls; onGoScheduling?: () => void }) {
  const [items, setItems] = useState<SubjectTeacherGroup[]>([]);
  const [summary, setSummary] = useState<{ subjects: number; teachers: number; entries: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    setLoading(true);
    setErr("");
    api
      .get<{ items: SubjectTeacherGroup[]; summary: { subjects: number; teachers: number; entries: number } }>(`/academics/classes/${cls.id}/subject-teachers`)
      .then((d) => { setItems(d.items || []); setSummary(d.summary || null); })
      .catch((e: any) => setErr(e.message || "加载失败"))
      .finally(() => setLoading(false));
  }, [cls.id]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs text-slate-600">
        <span>
          <b className="font-medium text-slate-700">只读</b>:任课教师完全按「排课管理 → 排课」中本班课表已确认的课程生成。
          如需调整科目或教师,请到排课管理修改课表或课程块的任课教师。
        </span>
        {onGoScheduling && (
          <button onClick={onGoScheduling} className="shrink-0 rounded-md border border-indigo-200 bg-white px-2 py-1 font-medium text-indigo-600 hover:bg-indigo-50">前往排课管理 →</button>
        )}
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        {loading ? (
          <p className="text-sm text-slate-400">加载中…</p>
        ) : err ? (
          <p className="text-sm text-red-500">{err}</p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
              <span>共 <b className="text-slate-700">{summary?.subjects ?? items.length}</b> 门课程</span>
              <span><b className="text-slate-700">{summary?.teachers ?? 0}</b> 位任课教师</span>
              <span>课表 <b className="text-slate-700">{summary?.entries ?? 0}</b> 个课时</span>
            </div>
            {items.length === 0 ? (
              <p className="py-3 text-center text-sm text-slate-400">暂无任课教师 —— 该班课表里还没有已排课程。</p>
            ) : (
              <table className="min-w-full text-sm">
                <thead className="text-slate-500"><tr><th className="py-1 text-left">课程(科目)</th><th className="py-1 text-left">任课教师</th><th className="py-1 text-left">课表课时</th><th className="py-1 text-left">教室</th></tr></thead>
                <tbody>
                  {items.map((g) => (
                    <tr key={g.subject} className="border-t border-slate-100 align-top">
                      <td className="py-1.5 font-medium text-slate-700">{g.subject}</td>
                      <td className="py-1.5">
                        <div className="flex flex-wrap gap-1">
                          {g.teachers.map((t, i) => (
                            <span key={i} className={`rounded px-1.5 py-0.5 text-xs ${t.name ? "bg-slate-100 text-slate-700" : "bg-amber-50 text-amber-600"}`}>
                              {t.name || "未指定教师"}
                              {g.teachers.length > 1 && t.periods ? ` · ${t.periods} 节` : ""}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-1.5 tabular-nums text-slate-500">{g.periods} 节</td>
                      <td className="py-1.5 text-slate-500">{g.rooms.length ? g.rooms.join(" / ") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ============ 考试与成绩(只读) ============
// 只读视图,零写入。成绩来源 = 班级课程目录(Course) ∪ 课表科目(TimetableEntry) ∪ 已建考试科目(Exam)
// 对应的 Score 记录,由 GET /academics/classes/:id/gradebook 一次性返回后在前端透视。
// 拆成两个子模块:① 按课程查看(课程 × 学生 成绩矩阵) ② 按学生查看(单个学生跨课程成绩明细)。
// 新建考试/录入成绩等写操作已从本模块下线(后端写接口保留,成绩录入仍可用 PUT /exams/:id/scores)。
type GExam = { id: string; title: string; type: string; examDate: string; totalScore: number };
type GCourse = { subject: string; exams: GExam[] };
type GScore = { examId: string; studentId: string; score: number; rankInClass: number | null; comment: string | null };
type Gradebook = {
  class: { id: string; name: string; grade?: string | null; academicYear: string; term: string };
  courses: GCourse[];
  students: Stu[];
  scores: GScore[];
  readonly: boolean;
};

const scoreKey = (examId: string, studentId: string) => `${examId}::${studentId}`;
const fmt1 = (n: number) => (Math.round(n * 10) / 10).toString();
const fmtDay = (s: string) => { const d = new Date(s); return isNaN(d.getTime()) ? "—" : d.toLocaleDateString(); };
const rateOf = (score: number, total: number) => (total > 0 ? score / total : 0);
const pctStr = (r: number) => `${Math.round(r * 1000) / 10}%`;

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const a = nums.slice().sort((x, y) => x - y);
  const h = Math.floor(a.length / 2);
  return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2;
}

function ExamsTab({ cls }: { cls: Cls }) {
  const [sub, setSub] = useState<"course" | "student">("course");
  const [data, setData] = useState<Gradebook | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    setLoading(true); setErr("");
    api.get<Gradebook>(`/academics/classes/${cls.id}/gradebook`)
      .then((d) => { setData(d); setLoading(false); })
      .catch((e: any) => { setErr(e.message || "加载失败"); setLoading(false); });
  }, [cls.id]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <p className="text-slate-400">加载中…</p>;
  if (err) return <p className="text-sm text-red-500">{err}</p>;
  if (!data) return null;
  const examCount = data.courses.reduce((n, c) => n + c.exams.length, 0);

  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
        本模块为<b>只读</b>视图:成绩按「本班涉及的全部课程」汇总展示,不支持新建考试或修改分数。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm">
          {([["course", "按课程查看"], ["student", "按学生查看"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setSub(k)}
              className={`rounded-md px-3 py-1.5 ${sub === k ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}>
              {l}
            </button>
          ))}
        </div>
        <button onClick={load} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">刷新</button>
        <span className="ml-auto text-xs text-slate-400">
          {data.courses.length} 门课程 · {examCount} 场考试 · {data.students.length} 名学生 · {data.scores.length} 条成绩
        </span>
      </div>
      {sub === "course" ? <GradeByCourse data={data} /> : <GradeByStudent data={data} />}
    </div>
  );
}

// ——— 子模块一:按课程查看(课程 × 学生 矩阵) ———
function GradeByCourse({ data }: { data: Gradebook }) {
  const initial = data.courses.find((c) => c.exams.length) || data.courses[0];
  const [subject, setSubject] = useState(initial?.subject || "");
  const [examId, setExamId] = useState<string | null>(null);
  const course = data.courses.find((c) => c.subject === subject) || initial;

  if (!course) return <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-400">本班暂无课程记录。</p>;

  const scoreMap = new Map(data.scores.map((s) => [scoreKey(s.examId, s.studentId), s]));
  const students = data.students;
  // 每场考试的横截面统计(仅统计已录成绩者)
  const stats = course.exams.map((e) => {
    const nums = students.map((st) => scoreMap.get(scoreKey(e.id, st.id))).filter(Boolean).map((s) => (s as GScore).score);
    return {
      exam: e,
      count: nums.length,
      avg: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null,
      max: nums.length ? Math.max(...nums) : null,
      min: nums.length ? Math.min(...nums) : null,
      median: median(nums),
    };
  });

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <aside className="shrink-0 space-y-1 lg:w-56">
        <p className="px-1 text-xs font-medium text-slate-400">课程({data.courses.length})</p>
        <div className="flex flex-wrap gap-1 lg:flex-col lg:flex-nowrap">
          {data.courses.map((c) => (
            <button key={c.subject} onClick={() => { setSubject(c.subject); setExamId(null); }}
              className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm ${c.subject === course.subject ? "border-indigo-400 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
              <span className="truncate">{c.subject}</span>
              <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] ${c.exams.length ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>
                {c.exams.length ? `${c.exams.length} 场` : "暂无"}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <div className="min-w-0 flex-1 space-y-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-1">
            <h4 className="text-sm font-medium text-slate-600">{course.subject} · 成绩汇总(学生 × 考试)</h4>
            <span className="text-xs text-slate-400">点考试列标题可展开该场学情</span>
          </div>
          {course.exams.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">该课程暂无考试记录。</p>
          ) : students.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">本班暂无学生。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-slate-500">
                  <tr>
                    <th className="whitespace-nowrap py-1 pr-3 text-left font-medium">学生</th>
                    {stats.map((s) => (
                      <th key={s.exam.id} className="px-2 py-1 align-bottom">
                        <button onClick={() => setExamId(s.exam.id === examId ? null : s.exam.id)}
                          className={`w-full rounded px-1.5 py-0.5 ${s.exam.id === examId ? "bg-indigo-50 text-indigo-600" : "hover:bg-slate-50"}`}>
                          <div className="font-medium text-slate-700">{s.exam.title}</div>
                          <div className="text-[11px] font-normal text-slate-400">{TYPES[s.exam.type] || s.exam.type} · {fmtDay(s.exam.examDate)} · 满分 {s.exam.totalScore}</div>
                        </button>
                      </th>
                    ))}
                    <th className="whitespace-nowrap px-2 py-1 text-center font-medium">平均得分率</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((st) => {
                    const cells = course.exams.map((e) => scoreMap.get(scoreKey(e.id, st.id)));
                    const ratios = cells
                      .map((c, i) => (c ? rateOf(c.score, course.exams[i].totalScore || 100) : null))
                      .filter((x): x is number => x != null);
                    const avgRatio = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : null;
                    return (
                      <tr key={st.id} className="border-t border-slate-100">
                        <td className="whitespace-nowrap py-1.5 pr-3">
                          <span className="text-slate-800">{st.name}</span>
                          <span className="ml-1.5 text-xs text-slate-400">{st.studentNo || "—"}</span>
                        </td>
                        {cells.map((c, i) => (
                          <td key={course.exams[i].id} className="px-2 py-1.5 text-center">
                            {c ? (
                              <>
                                <span className="font-medium text-slate-800">{fmt1(c.score)}</span>
                                <span className="ml-1 text-[11px] text-slate-400">/{course.exams[i].totalScore}</span>
                                {c.rankInClass != null && <span className="ml-1 text-[11px] text-slate-400">#{c.rankInClass}</span>}
                              </>
                            ) : <span className="text-slate-300">—</span>}
                          </td>
                        ))}
                        <td className="px-2 py-1.5 text-center text-slate-600">
                          {avgRatio == null ? <span className="text-slate-300">—</span> : pctStr(avgRatio)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="border-t-2 border-slate-100 text-xs text-slate-500">
                  <tr>
                    <td className="py-1 pr-3">已录/参考</td>
                    {stats.map((s) => <td key={s.exam.id} className="px-2 py-1 text-center">{s.count}/{students.length}</td>)}
                    <td />
                  </tr>
                  <tr>
                    <td className="py-1 pr-3">平均分</td>
                    {stats.map((s) => <td key={s.exam.id} className="px-2 py-1 text-center">{s.avg == null ? "—" : fmt1(s.avg)}</td>)}
                    <td />
                  </tr>
                  <tr>
                    <td className="py-1 pr-3">中位数</td>
                    {stats.map((s) => <td key={s.exam.id} className="px-2 py-1 text-center">{s.median == null ? "—" : fmt1(s.median)}</td>)}
                    <td />
                  </tr>
                  <tr>
                    <td className="py-1 pr-3">最高/最低</td>
                    {stats.map((s) => (
                      <td key={s.exam.id} className="px-2 py-1 text-center">
                        {s.max == null ? "—" : `${fmt1(s.max)} / ${fmt1(s.min as number)}`}
                      </td>
                    ))}
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
        {examId && (
          <div>
            <h4 className="mb-1 text-sm font-medium text-slate-600">本场考试学情</h4>
            <ExamAnalytics examId={examId} />
          </div>
        )}
      </div>
    </div>
  );
}

// ——— 子模块二:按学生查看(单生跨课程成绩明细) ———
function GradeByStudent({ data }: { data: Gradebook }) {
  const [q, setQ] = useState("");
  const [sid, setSid] = useState(data.students[0]?.id || "");
  const examMeta = new Map<string, { exam: GExam; subject: string }>();
  data.courses.forEach((c) => c.exams.forEach((e) => examMeta.set(e.id, { exam: e, subject: c.subject })));

  const rows = data.scores
    .filter((s) => s.studentId === sid)
    .map((s) => { const m = examMeta.get(s.examId); return m ? { ...s, exam: m.exam, subject: m.subject } : null; })
    .filter((x): x is GScore & { exam: GExam; subject: string } => !!x)
    .sort((a, b) =>
      a.subject.localeCompare(b.subject, "zh-Hans-CN") ||
      new Date(a.exam.examDate).getTime() - new Date(b.exam.examDate).getTime()
    );

  const student = data.students.find((s) => s.id === sid);
  const allExams = data.courses.reduce((n, c) => n + c.exams.length, 0);
  const subjectCount = new Set(rows.map((r) => r.subject)).size;
  const avgRatio = rows.length ? rows.reduce((a, r) => a + rateOf(r.score, r.exam.totalScore), 0) / rows.length : null;
  const list = data.students.filter((s) => {
    const k = q.trim();
    return !k || s.name.includes(k) || String(s.studentNo || "").includes(k);
  });

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <aside className="shrink-0 space-y-2 lg:w-56">
        <input className="ui-input w-full" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索姓名 / 学号" />
        <div className="max-h-[26rem] space-y-1 overflow-y-auto pr-1">
          {list.length === 0 && <p className="px-1 py-2 text-xs text-slate-400">无匹配学生</p>}
          {list.map((s) => {
            const n = data.scores.filter((x) => x.studentId === s.id).length;
            return (
              <button key={s.id} onClick={() => setSid(s.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm ${s.id === sid ? "border-indigo-400 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
                <span className="truncate">{s.name}</span>
                <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] ${n ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>{n} 条</span>
              </button>
            );
          })}
        </div>
      </aside>

      <div className="min-w-0 flex-1 space-y-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h4 className="mb-3 text-sm font-medium text-slate-600">
            {student ? student.name : "—"} <span className="text-xs font-normal text-slate-400">{student?.studentNo || "无学号"} · 各课程成绩明细</span>
          </h4>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { l: "覆盖课程", v: subjectCount },
              { l: "有成绩考试", v: rows.length },
              { l: "全部考试", v: allExams },
              { l: "平均得分率", v: avgRatio == null ? "—" : pctStr(avgRatio) },
            ].map((c) => (
              <div key={c.l} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="text-xs text-slate-500">{c.l}</div>
                <div className="text-base font-medium text-slate-800">{c.v}</div>
              </div>
            ))}
          </div>
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">该学生暂无成绩记录。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-slate-500">
                  <tr>
                    <th className="whitespace-nowrap py-1 pr-3 text-left font-medium">课程</th>
                    <th className="whitespace-nowrap py-1 pr-3 text-left font-medium">考试</th>
                    <th className="whitespace-nowrap px-2 py-1 text-center font-medium">得分/满分</th>
                    <th className="whitespace-nowrap px-2 py-1 text-center font-medium">得分率</th>
                    <th className="whitespace-nowrap px-2 py-1 text-center font-medium">排名</th>
                    <th className="whitespace-nowrap py-1 pl-3 text-left font-medium">评语</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.examId} className="border-t border-slate-100">
                      <td className="whitespace-nowrap py-1.5 pr-3 text-slate-600">{r.subject}</td>
                      <td className="py-1.5 pr-3">
                        <div className="whitespace-nowrap text-slate-800">{r.exam.title}</div>
                        <div className="whitespace-nowrap text-[11px] text-slate-400">{TYPES[r.exam.type] || r.exam.type} · {fmtDay(r.exam.examDate)}</div>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-center">
                        <span className="font-medium text-slate-800">{fmt1(r.score)}</span>
                        <span className="ml-0.5 text-xs text-slate-400">/{r.exam.totalScore}</span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-center text-slate-600">{pctStr(rateOf(r.score, r.exam.totalScore))}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-center text-slate-500">{r.rankInClass == null ? "—" : `#${r.rankInClass}`}</td>
                      <td className="max-w-[16rem] py-1.5 pl-3 text-slate-500">{r.comment || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
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
          <span>建议改用「排课管理」:先在「组课」把课程与教师绑成课程块,再拖进课表网格。本页保留单条增删改。</span>
          <button onClick={onGoScheduling} className="shrink-0 rounded-md border border-indigo-200 bg-white px-2 py-1 font-medium text-indigo-600 hover:bg-indigo-50">前往排课管理 →</button>
        </div>
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
