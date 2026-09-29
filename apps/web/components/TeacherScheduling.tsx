"use client";

// 排课管理(仅管理员 / 教务老师可见)
//
// 结构:一个容器 + 两个子模块
//   子模块一「组课」 —— 把「科目 + 任课教师」绑成课程块,声明预计每周课时数与开设年级;支持增删改、按年级分组浏览。
//   子模块二「排课」 —— 上方课程块池(一行四个小格子,带 已排 n/需 w 进度)拖到下方课表网格的 slot;可删除、可替换、可拖动改时段。
//
// 三种操作方式(桌面拖拽 / 点击两步 / 键盘 Esc):
//   1) 拖拽:从池子拖到格子;已排的格子也能拖到别的格子(移动)
//   2) 点击:先点池子里的课程块(选中)→ 再点目标格(放置);已排格 hover 出现 ✕(移除)与 ⇄(替换)
//   3) 替换:点 ⇄ 后进入替换态 → 点池子里任意课程块即完成替换
//   4) 拖出即删:已排课程条目拖到课表网格外松手 = 直接删除(无二次确认,拖拽期间有底部提示条)
//
// 一格多课程 = 「选课走班 / 分层走班」(核心语义):
//   同一时段全班学生分流到不同课堂时,该格并列显示多门课程 —— 这是**正常形态,不是冲突**。
//   格内卡片纵向堆叠,右上角紫色胶囊显示「走班 N」。
//   往已占用的格子放课/移动时,弹选择卡二选一:
//     · 加入选课走班 —— 保留原有课程,新增为同时段并行的另一门(服务端 mode=append)
//     · 替换该时段 —— 清空该格后只保留新增这一门(服务端 mode=replace)
//   两条硬约束由服务端把关:同一课程块不得在同格重复;同一教师不得在同格并行两门课。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import Select from "@/components/Select";

// ============ 类型 ============
interface Tch { id: string; name: string; teacherRole?: string | null }
interface Klass { id: string; name: string; grade: string | null; academicYear: string; term: string; headTeacher?: { id: string; name: string } | null; studentCount: number; entryCount: number }
interface Block {
  id: string; subject: string; teacherId: string | null; teacher: Tch | null;
  grades: string; academicYear: string; term: string; weeklyHours: number;
  room: string | null; note: string | null; sortOrder: number; usageCount?: number;
  placed?: number; cells?: { entryId: string; dayOfWeek: number; period: number }[];
  /** 后端标记:该科目属于「非学术课程」类别(不指派任课教师、不安排考试) */
  nonAcademic?: boolean;
}
interface Entry {
  id: string; classId: string; dayOfWeek: number; period: number;
  periodLabel: string | null; periodTime: string | null;
  subject: string; teacherId: string | null; teacher: Tch | null; room: string | null;
  academicYear: string; term: string; courseBlockId: string | null;
}
interface BoardData {
  klass: { id: string; name: string; grade: string | null; academicYear: string; term: string };
  grade: string; blocks: Block[]; entries: Entry[]; otherTermBlocks: number;
  periodMeta: Record<string, { label: string | null; time: string | null }>;
  // 一日安排模板(全校统一作息):排课网格的行头与默认节数由它驱动
  dayTemplate: DayTemplate;
  // 「非学术课程」科目名(课表格子据此显示「不指派教师」而非「未指定教师」)
  nonAcademicSubjects?: string[];
  stats: {
    planned: number; placedTotal: number; remaining: number; over: number;
    electiveCells: number; electiveCourses: number;
    entries: number; occupiedCells: number; blocks: number;
  };
}

// 「一日安排」模板(来自 GET /scheduling/day-template)
interface DayPeriod {
  period: number; label: string | null; startTime: string | null; endTime: string | null;
  range: string; // 展示用时间段,如 "7:45-8:15"
}
interface DayBreak { afterPeriod: number; from: string; to: string; minutes: number }
interface DayTemplate {
  configured: boolean;
  periods: DayPeriod[];
  breaks: DayBreak[]; // 课间休息(由相邻两节时间推导,不单独存)
  count: number;
  firstStart: string | null;
  lastEnd: string | null;
  spanMinutes: number | null;
  outOfRangeEntries?: number; // 已排课表里"节次超出模板节数"的条目数
  warnings?: string[];
}
interface BlocksData {
  blocks: Block[]; teachers: Tch[]; gradeOptions: string[]; years: string[]; terms: string[];
}
// 目标格已被占用时的待决动作:等用户在「加入选课走班 / 替换该时段 / 取消」中选一个
type Conflict = { kind: "place" | "move"; blockId?: string; entryId?: string; day: number; period: number; occupied: Entry[]; label: string };

// 一键冲突检查结果(来自 GET /scheduling/conflicts)
interface ConflictEntry {
  entryId: string; classId: string; className: string; grade: string | null;
  subject: string; teacherId: string | null; teacherName: string | null;
  room: string | null; courseBlockId: string | null; academicYear: string; term: string;
}
interface TeacherConflict { academicYear: string; term: string; dayOfWeek: number; period: number; teacherId: string; teacherName: string | null; entries: ConflictEntry[] }
interface RoomConflict { academicYear: string; term: string; dayOfWeek: number; period: number; room: string; entries: ConflictEntry[] }
interface ConflictReport {
  teacherConflicts: TeacherConflict[];
  roomConflicts: RoomConflict[];
  summary: { teacherConflicts: number; roomConflicts: number; total: number; scannedEntries: number };
}

// 一键「清空课表」的预演/执行结果(来自 POST /scheduling/timetable/clear)
//   dryRun=true  → 只回统计(不写库),用于弹窗展示"将删除多少";deleted 不返回
//   confirm=true → 真实删除,额外回 deleted
interface ClearPreview {
  scope: "class" | "all";
  academicYear: string;
  term: string;
  target: { id: string; name: string } | null;
  entries: number;
  classes: number;
  teachers: number;
  subjects: number;
  dryRun: boolean;
  deleted?: number;
}

// ============ 常量与配色 ============
const DAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
// 组课「科目」下拉数据源 = 「课程管理」课程库(SchoolCourse,在开设的课程),不再用硬编码学科清单
const TERM_OPTIONS = ["第一学期", "第二学期", "全年"];
const FALLBACK_COLOR = { bg: "#eef2ff", text: "#4338ca" };
// 「非学术课程」= 课程管理里的一个类别:不指派任课教师、不安排考试,但可正常排进课表。
// 以后再选课表 / 改类别都会走这套判断,避免"未指定教师"的橙色告警对这类课程误导。
const NON_ACADEMIC_CATEGORY = "非学术课程";
const isNonAcademicCourse = (c: { category?: string; nonAcademic?: boolean } | null | undefined) =>
  !!c && (c.nonAcademic === true || c.category === NON_ACADEMIC_CATEGORY);

// ============ 「一日安排」时间小工具 ============
// 时间统一存 "HH:mm";展示时去掉小时前导零("07:45" → "7:45"),与教师习惯的写法一致
const prettyTime = (t: string | null | undefined) => (t ? String(t).replace(/^0(\d:)/, "$1") : "");
const toMinutes = (t: string) => { const [h, m] = String(t).split(":"); return Number(h) * 60 + Number(m); };
const fromMinutes = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// 与课表/成绩单一致:黄金角步进旋转色相,同科目恒同色,科目数不限
function subjectColorByIndex(i: number) {
  const h = Math.round((i * 137.508) % 360);
  return { bg: `hsl(${h}, 65%, 93%)`, text: `hsl(${h}, 70%, 28%)` };
}
function buildSubjectColorMap(subjects: string[]) {
  const m = new Map<string, { bg: string; text: string }>();
  Array.from(new Set(subjects)).sort().forEach((s, i) => m.set(s, subjectColorByIndex(i)));
  return m;
}

function defaultYear(): string {
  const now = new Date();
  const y = now.getMonth() + 1 >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}-${y + 1}`;
}

// 开设年级多选(逗号串)的工具:展示标签 / 年级徽章数组
function gradesLabel(grades: string): string {
  return grades ? grades.split(",").filter(Boolean).join("/") : "全年级";
}

// ============ 主组件 ============
export default function TeacherScheduling() {
  const [sub, setSub] = useState<"group" | "place" | "day">("group");

  // 元数据(班级/年级/学年/学期/教师)
  const [meta, setMeta] = useState<{ classes: Klass[]; gradeOptions: string[]; years: string[]; terms: string[] }>({
    classes: [], gradeOptions: [], years: [], terms: [],
  });
  const [toast, setToast] = useState<{ text: string; kind: "ok" | "err" } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const s = new URLSearchParams(window.location.search).get("sub");
    if (s === "place" || s === "day" || s === "group") setSub(s);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const say = useCallback((text: string, kind: "ok" | "err" = "ok") => setToast({ text, kind }), []);

  const loadMeta = useCallback(() => {
    api
      .get<{ classes: Klass[]; gradeOptions: string[]; years: string[]; terms: string[] }>("/scheduling/classes")
      .then((d) => setMeta({ classes: d.classes || [], gradeOptions: d.gradeOptions || [], years: d.years || [], terms: d.terms || [] }))
      .catch(() => {});
  }, []);
  useEffect(() => { loadMeta(); }, [loadMeta]);

  return (
    <div className="space-y-4">
      {/* 顶部说明 + 子模块切换(pill,与外层下划线 Tab 形成层级区分) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-800">排课管理</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            先「组课」把课程与教师绑成课程块,再「排课」把课程块拖进班级课表;一天几节课、每节几点,先在「一日安排」里设定好。
            <span className="ml-1 text-violet-600">同一格可放多门课程 —— 即「选课走班」。</span>
          </p>
        </div>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
          {([
            { k: "group", l: "① 组课" },
            { k: "place", l: "② 排课" },
            { k: "day", l: "③ 一日安排" },
          ] as const).map((t) => (
            <button
              key={t.k}
              onClick={() => setSub(t.k)}
              className={`rounded-md px-3.5 py-1.5 font-medium transition ${sub === t.k ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
            >
              {t.l}
            </button>
          ))}
        </div>
      </div>

      {toast && (
        <div className={`rounded-lg px-3 py-2 text-sm ${toast.kind === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
          {toast.text}
        </div>
      )}

      {sub === "group" ? (
        <GroupView meta={meta} onMetaReload={loadMeta} say={say} onGoPlace={() => setSub("place")} />
      ) : sub === "place" ? (
        <PlaceView meta={meta} say={say} onGoGroup={() => setSub("group")} onGoDay={() => setSub("day")} />
      ) : (
        <DayPlanView meta={meta} say={say} onGoPlace={() => setSub("place")} />
      )}
    </div>
  );
}

// ==================================================================
// 子模块一:组课
// ==================================================================
function GroupView({
  meta, onMetaReload, say, onGoPlace,
}: {
  meta: { classes: Klass[]; gradeOptions: string[]; years: string[]; terms: string[] };
  onMetaReload: () => void;
  say: (t: string, k?: "ok" | "err") => void;
  onGoPlace: () => void;
}) {
  const years = meta.years.length ? meta.years : [defaultYear()];
  const [year, setYear] = useState(years[0]);
  const [term, setTerm] = useState(meta.terms[0] || "第一学期");
  const [grade, setGrade] = useState(""); // "" = 全部年级
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [teachers, setTeachers] = useState<Tch[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null); // null=未编辑; "new"=新建
  const [form, setForm] = useState({ subject: "", teacherId: "", grades: [] as string[], weeklyHours: "5", room: "", note: "" });
  const [busy, setBusy] = useState(false);

  // 科目下拉数据源:「课程管理」课程库(SchoolCourse)。每次打开表单都重新拉取,保证与课程库同步
  interface CourseLibItem { name: string; weeklyHours: number | null; grades: string; active: boolean; category?: string; nonAcademic?: boolean }
  const [courseLib, setCourseLib] = useState<CourseLibItem[]>([]);
  const loadCourseLib = useCallback(() => {
    api
      .get<{ courses: CourseLibItem[] }>("/academics/school-courses")
      .then((d) => setCourseLib(d.courses || []))
      .catch(() => {});
  }, []);
  useEffect(() => { loadCourseLib(); }, [loadCourseLib]);

  // 元数据首次到位后,把默认学年/学期对齐到真实数据
  useEffect(() => {
    if (meta.years.length && !meta.years.includes(year)) setYear(meta.years[0]);
    if (meta.terms.length && !meta.terms.includes(term)) setTerm(meta.terms[0]);
  }, [meta.years, meta.terms, year, term]);

  const load = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams({ academicYear: year, term });
    if (grade) qs.set("grade", grade);
    api
      .get<BlocksData>(`/scheduling/blocks?${qs.toString()}`)
      .then((d) => { setBlocks(d.blocks || []); setTeachers(d.teachers || []); })
      .catch(() => say("课程块加载失败", "err"))
      .finally(() => setLoading(false));
  }, [year, term, grade, say]);
  useEffect(() => { load(); }, [load]);

  const colorMap = useMemo(() => buildSubjectColorMap(blocks.map((b) => b.subject)), [blocks]);

  // 科目选项:仅取课程库中「在开设」的课程名(按课程库排序);编辑旧块时若其科目已不在库中,补进选项避免显示丢失
  const subjectOptions = useMemo(() => {
    const names = courseLib.filter((c) => c.active).map((c) => c.name);
    if (form.subject && !names.includes(form.subject)) names.unshift(form.subject);
    return Array.from(new Set(names));
  }, [courseLib, form.subject]);

  // 当前选中科目的课程库记录(用于展示参考课时/年级提示)
  const selectedCourse = useMemo(() => courseLib.find((c) => c.name === form.subject) || null, [courseLib, form.subject]);
  // 选中「非学术课程」→ 任课教师字段不适用(前端禁用;后端同样会忽略传入的教师)
  const selectedIsNonAcademic = isNonAcademicCourse(selectedCourse);

  function startNew() {
    setEditingId("new");
    loadCourseLib(); // 打开表单即拉最新课程库:课程管理里刚建的课立即可选
    const first = courseLib.find((c) => c.active);
    setForm({
      subject: first?.name || "", teacherId: "", grades: [],
      weeklyHours: first?.weeklyHours != null ? String(first.weeklyHours) : "5", room: "", note: "",
    });
  }
  function startEdit(b: Block) {
    setEditingId(b.id);
    loadCourseLib();
    setForm({
      subject: b.subject, teacherId: b.teacherId || "", grades: (b.grades || "").split(",").filter(Boolean),
      weeklyHours: String(b.weeklyHours), room: b.room || "", note: b.note || "",
    });
  }
  function cancelEdit() { setEditingId(null); }

  // 年级复选:勾/取消一个年级(全不勾 = 全年级通用,跨所有年级)
  function toggleGrade(g: string) {
    setForm((f) => ({ ...f, grades: f.grades.includes(g) ? f.grades.filter((x) => x !== g) : [...f.grades, g] }));
  }

  // 选科目:新建态下同步课程库信息 —— 自动带入参考周课时;带入课程库勾选的开设年级(可再手动增删)
  function pickSubject(name: string) {
    const c = courseLib.find((x) => x.name === name);
    setForm((f) => {
      const next = { ...f, subject: name };
      if (editingId === "new" && c) {
        if (c.weeklyHours != null) next.weeklyHours = String(c.weeklyHours);
        const gs = (c.grades || "").split(",").filter(Boolean).filter((g) => meta.gradeOptions.includes(g));
        if (gs.length) next.grades = gs;
      }
      // 非学术课程不指派任课教师:切到该科目时清空已选教师,避免留下无意义的归属
      if (isNonAcademicCourse(c)) next.teacherId = "";
      return next;
    });
  }

  async function save() {
    if (!form.subject.trim()) return say("请选择科目", "err");
    setBusy(true);
    try {
      const payload = {
        subject: form.subject, teacherId: form.teacherId || null, grades: form.grades,
        academicYear: year, term, weeklyHours: Number(form.weeklyHours) || 0,
        room: form.room, note: form.note,
      };
      if (editingId === "new") await api.post("/scheduling/blocks", payload);
      else await api.put(`/scheduling/blocks/${editingId}`, payload);
      say(editingId === "new" ? "课程块已创建" : "课程块已保存");
      setEditingId(null);
      load(); onMetaReload();
    } catch (e: any) { say(e.message || "保存失败", "err"); }
    finally { setBusy(false); }
  }

  async function remove(b: Block) {
    if (!confirm(`删除课程块「${gradesLabel(b.grades)} ${b.subject}${b.teacher ? " · " + b.teacher.name : ""}」?\n已排入课表的课时不会被删除,仅解除来源关联。`)) return;
    try {
      const r = await api.del<{ unlinked: number }>(`/scheduling/blocks/${b.id}`);
      say(r?.unlinked ? `已删除;${r.unlinked} 处已排课表保留` : "已删除");
      load();
    } catch (e: any) { say(e.message || "删除失败", "err"); }
  }

  // 按主年级分组 + 小计(多选年级的课程块归入第一个勾选年级;未选年级的归入「全年级」)
  const groups = useMemo(() => {
    const m = new Map<string, Block[]>();
    blocks.forEach((b) => {
      const key = (b.grades || "").split(",").filter(Boolean)[0] || "全年级";
      const arr = m.get(key) || [];
      arr.push(b);
      m.set(key, arr);
    });
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [blocks]);
  const totalHours = blocks.reduce((s, b) => s + (b.weeklyHours || 0), 0);

  return (
    <div className="space-y-4">
      {/* 筛选 + 统计 */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <Field label="学年"><Select value={year} onChange={setYear} options={years.map((y) => ({ value: y, label: y }))} /></Field>
        <Field label="学期"><Select value={term} onChange={setTerm} options={(meta.terms.length ? meta.terms : TERM_OPTIONS).map((t) => ({ value: t, label: t }))} /></Field>
        <Field label="年级"><Select value={grade} onChange={setGrade} placeholder="全部年级" options={meta.gradeOptions.map((g) => ({ value: g, label: g }))} /></Field>
        <div className="ml-auto flex items-center gap-3 pb-1">
          <span className="text-xs text-slate-500">
            共 <b className="text-slate-700">{blocks.length}</b> 个课程块 · 合计 <b className="text-slate-700">{totalHours}</b> 课时/周
          </span>
          <button onClick={startNew} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700">＋ 新建课程块</button>
        </div>
      </div>

      {/* 新建/编辑表单 */}
      {editingId && (
        <div className="rounded-xl border border-indigo-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-slate-800">
              {editingId === "new" ? "新建课程块" : "编辑课程块"}
              <span className="ml-2 font-normal text-xs text-slate-400">科目取自「课程管理」课程库</span>
            </h4>
            {courseLib.filter((c) => c.active).length === 0 && (
              <span className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-600">
                课程库还没有在开设的课程,请先到「课程管理」新建课程
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
            <div className="flex flex-col gap-1 text-xs text-slate-500">
              <span>科目</span>
              <Select
                value={form.subject}
                onChange={pickSubject}
                placeholder="请选择课程"
                options={subjectOptions.map((s) => ({
                  value: s,
                  label: s,
                  hint: isNonAcademicCourse(courseLib.find((c) => c.name === s)) ? "非学术" : undefined,
                }))}
              />
              {selectedCourse && (
                <span className="text-[11px] leading-4 text-slate-400">
                  {selectedIsNonAcademic ? (
                    <span className="text-amber-600">非学术课程 · 不指派教师 / 不安排考试</span>
                  ) : (
                    <>参考 {selectedCourse.weeklyHours ?? "/"} 课时/周 · {gradesLabel(selectedCourse.grades)}</>
                  )}
                </span>
              )}
            </div>
            <Field label={selectedIsNonAcademic ? "任课教师(不适用)" : "任课教师"}>
              {selectedIsNonAcademic ? (
                <div
                  className="flex w-full items-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-400"
                  title="「非学术课程」不指派任课教师"
                >
                  非学术课程不指派教师
                </div>
              ) : (
                <Select value={form.teacherId} onChange={(v) => setForm({ ...form, teacherId: v })} placeholder="暂不指定" options={teachers.map((t) => ({ value: t.id, label: t.name }))} />
              )}
            </Field>
            <Field label="预计每周课时数">
              <input type="number" min={0} max={60} className="ui-input w-full" value={form.weeklyHours} onChange={(e) => setForm({ ...form, weeklyHours: e.target.value })} />
            </Field>
            <Field label="建议教室"><input className="ui-input w-full" value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} placeholder="选填" /></Field>
            <Field label="备注"><input className="ui-input w-full" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="如 合班 / A层" /></Field>
          </div>
          {/* 开设年级:多选,可跨年级组课;全不勾 = 全年级通用 */}
          <div className="mt-3 flex flex-col gap-1.5 text-xs text-slate-500">
            <span>
              开设年级 <span className="font-normal text-slate-400">(可多选,跨年级组课;全不勾 = 全年级通用)</span>
            </span>
            <div className="flex flex-wrap gap-1.5">
              {meta.gradeOptions.length === 0 && <span className="text-slate-400">暂无可选年级</span>}
              {meta.gradeOptions.map((g) => {
                const on = form.grades.includes(g);
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => toggleGrade(g)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                      on
                        ? "border-indigo-500 bg-indigo-500 text-white shadow-sm"
                        : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:bg-indigo-50"
                    }`}
                  >
                    {g}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
            <p className="text-[11px] text-slate-400">选中科目后自动带入课程库的参考课时与年级,均可手动修改。</p>
            <div className="flex gap-2">
              <button onClick={cancelEdit} className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100">取消</button>
              <button onClick={save} disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">保存</button>
            </div>
          </div>
        </div>
      )}

      {loading && <p className="text-slate-400">加载中…</p>}

      {!loading && blocks.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-sm text-slate-500">当前筛选下还没有课程块。</p>
          <p className="mt-1 text-xs text-slate-400">点右上角「＋ 新建课程块」把「科目 + 任课教师 + 每周课时数」绑成一个可拖拽的课程块。</p>
        </div>
      )}

      {/* 课程块卡片:按年级分组 */}
      {!loading && groups.map(([g, list]) => {
        const hours = list.reduce((s, b) => s + (b.weeklyHours || 0), 0);
        return (
          <div key={g} className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-700">{g}</h3>
              <span className="text-xs text-slate-400">{list.length} 门 · {hours} 课时/周</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {list.map((b) => {
                const c = colorMap.get(b.subject) || FALLBACK_COLOR;
                const gradeList = (b.grades || "").split(",").filter(Boolean);
                return (
                  <div key={b.id} className="group flex items-stretch gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:shadow-sm">
                    <span className="w-1.5 shrink-0 rounded-full" style={{ background: c.text }} />
                    <div className="min-w-0 flex-1">
                      {/* 第 1 行:科目 + 周课时。科目过长时截断,不挤走右侧徽章 */}
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-slate-800">{b.subject}</span>
                        {b.nonAcademic && (
                          <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700" title="非学术课程:不指派任课教师、不安排考试">
                            非学术
                          </span>
                        )}
                        <span className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium" style={{ background: c.bg, color: c.text }}>
                          {b.weeklyHours} 课时/周
                        </span>
                      </div>
                      {/* 第 2 行:开设年级徽章固定单行(年级很多时横向滚动,既不折行也不裁切) */}
                      <div
                        className="mt-1 flex flex-nowrap items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                        title={gradeList.length ? gradeList.join(" / ") : "跨年级通用"}
                      >
                        {gradeList.length ? gradeList.map((g) => (
                          <span key={g} className="shrink-0 whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{g}</span>
                        )) : (
                          <span className="shrink-0 whitespace-nowrap rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-700">跨年级通用</span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                        <span>
                          {b.nonAcademic
                            ? <span className="text-slate-400">不指派教师</span>
                            : b.teacher?.name || <span className="text-amber-600">未指定教师</span>}
                        </span>
                        {b.room && <span>· {b.room}</span>}
                        {!!b.usageCount && <span>· 已被 {b.usageCount} 个班次使用</span>}
                      </div>
                      {b.note && <div className="mt-1 truncate text-xs text-slate-400">{b.note}</div>}
                    </div>
                    <div className="flex shrink-0 flex-col justify-center gap-1">
                      <button
                        onClick={() => startEdit(b)}
                        className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => remove(b)}
                        className="rounded-md border border-slate-200 px-2 py-1 text-xs text-red-500 transition hover:border-red-300 hover:bg-red-50"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {!loading && blocks.length > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-500">课程块已配好?下一步把它们拖进班级课表。</p>
          <button onClick={onGoPlace} className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-600 hover:bg-indigo-100">去排课 →</button>
        </div>
      )}
    </div>
  );
}

// ==================================================================
// 子模块二:排课
// ==================================================================
function PlaceView({
  meta, say, onGoGroup, onGoDay,
}: {
  meta: { classes: Klass[]; gradeOptions: string[]; years: string[]; terms: string[] };
  say: (t: string, k?: "ok" | "err") => void;
  onGoGroup: () => void;
  onGoDay: () => void;
}) {
  const [classId, setClassId] = useState("");
  const [board, setBoard] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [swapCell, setSwapCell] = useState<{ day: number; period: number } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [report, setReport] = useState<ConflictReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [rowCount, setRowCount] = useState<string>("");
  const [showWeekend, setShowWeekend] = useState(false);
  const [clearOpen, setClearOpen] = useState(false); // 一键「清空课表」确认弹窗
  const dragRef = useRef<{ kind: "block" | "entry"; id: string } | null>(null);
  // 正在拖拽的已排条目 id(用于「拖出课表即删除」的提示条与判定)
  const [dragEntryId, setDragEntryId] = useState<string | null>(null);

  // 班级默认选中第一个
  useEffect(() => { if (!classId && meta.classes.length) setClassId(meta.classes[0].id); }, [meta.classes, classId]);

  const load = useCallback(() => {
    if (!classId) return;
    setLoading(true);
    api
      .get<BoardData>(`/scheduling/board?classId=${encodeURIComponent(classId)}`)
      .then((d) => { setBoard(d); setSelectedBlockId(null); setSwapCell(null); })
      .catch((e: any) => say(e.message || "课表加载失败", "err"))
      .finally(() => setLoading(false));
  }, [classId, say]);
  useEffect(() => { load(); }, [load]);

  const klass = meta.classes.find((c) => c.id === classId) || null;
  const entries = board?.entries || [];
  const blocks = board?.blocks || [];
  // 「非学术课程」科目(来自课程库):课表格子里这类课程不显示"未指定教师"的告警
  const nonAcademicSubjects = useMemo(() => new Set(board?.nonAcademicSubjects || []), [board]);

  const colorMap = useMemo(
    () => buildSubjectColorMap([...blocks.map((b) => b.subject), ...entries.map((e) => e.subject)]),
    [blocks, entries]
  );
  const colorOf = (s: string) => colorMap.get(s) || FALLBACK_COLOR;

  // 网格:行(节次) × 列(星期)
  const maxEntryPeriod = entries.reduce((m, e) => Math.max(m, e.period), 0);
  const maxEntryDay = entries.reduce((m, e) => Math.max(m, e.dayOfWeek), 0);
  // 一天节数:优先「一日安排」模板;未配置模板时退回历史默认(8 节)
  const dayTpl = board?.dayTemplate;
  const tplCount = dayTpl?.periods?.length || 0;
  const autoPeriods = tplCount ? Math.max(tplCount, maxEntryPeriod) : Math.max(8, maxEntryPeriod);
  const periods = rowCount ? Number(rowCount) : autoPeriods;
  const dayCount = Math.max(showWeekend ? 7 : 5, maxEntryDay);

  // 单元格 -> 条目
  const cellMap = useMemo(() => {
    const m = new Map<string, Entry[]>();
    entries.forEach((e) => {
      const k = `${e.dayOfWeek}-${e.period}`;
      m.set(k, [...(m.get(k) || []), e]);
    });
    return m;
  }, [entries]);

  // 池子排序:未排满优先,排满沉底;同组按 sortOrder
  const pool = useMemo(() => {
    const copy = [...blocks];
    copy.sort((a, b) => {
      const fa = (a.weeklyHours || 0) > 0 && (a.placed || 0) >= a.weeklyHours ? 1 : 0;
      const fb = (b.weeklyHours || 0) > 0 && (b.placed || 0) >= b.weeklyHours ? 1 : 0;
      if (fa !== fb) return fa - fb;
      return (a.sortOrder || 0) - (b.sortOrder || 0);
    });
    return copy;
  }, [blocks]);

  const periodLabel = (p: number) => {
    const m = board?.periodMeta?.[String(p)];
    return m?.time || m?.label || "";
  };

  // ——— 落库动作 ———
  // mode 缺省 = 目标格为空时的普通排课;append = 并入选课走班组;replace = 覆盖该格
  async function doPlace(blockId: string, day: number, period: number, mode?: "append" | "replace") {
    if (!classId) return;
    try {
      const r = await api.post<{ placed: number; replaced: number; cellSize?: number }>("/scheduling/place", {
        classId, courseBlockId: blockId, dayOfWeek: day, period, mode: mode || undefined,
      });
      say(r?.replaced ? "已替换该时段课程" : mode === "append" ? `已加入选课走班（该时段共 ${r?.cellSize ?? 2} 门课程）` : "已排入课表");
      load();
    } catch (e: any) {
      say(e.message || "排课失败", "err");
      load();
    }
  }
  async function doMove(entryId: string, day: number, period: number, mode?: "append" | "replace") {
    try {
      const r = await api.post<{ replaced: number; cellSize?: number }>("/scheduling/move", {
        entryId, dayOfWeek: day, period, mode: mode || undefined,
      });
      say(r?.replaced ? "已替换该时段课程" : mode === "append" ? "已并入选课走班组" : "已移动");
      load();
    } catch (e: any) {
      say(e.message || "移动失败", "err");
      load();
    }
  }
  async function doRemove(entryId: string) {
    try {
      await api.del(`/scheduling/entries/${entryId}`);
      say("已从课表移除");
      load();
    } catch (e: any) { say(e.message || "移除失败", "err"); }
  }

  // 一键冲突检查:扫全部班级课表(限当前班级学年/学期),检出教师/教室「同一时间」冲突
  async function runConflictCheck() {
    setChecking(true);
    try {
      const qs = new URLSearchParams();
      if (klass) { qs.set("academicYear", klass.academicYear); qs.set("term", klass.term); }
      const d = await api.get<ConflictReport>(`/scheduling/conflicts${qs.toString() ? "?" + qs.toString() : ""}`);
      setReport(d);
    } catch (e: any) {
      say(e.message || "冲突检查失败", "err");
    } finally {
      setChecking(false);
    }
  }

  // 点击/拖拽落点:先判该格占用情况,再决定直接落库还是弹「走班 / 替换」选择卡
  function attempt(kind: "place" | "move", id: string, day: number, period: number) {
    const occupied = (cellMap.get(`${day}-${period}`) || []).filter((e) => e.id !== id);
    if (!occupied.length) {
      if (kind === "place") doPlace(id, day, period);
      else doMove(id, day, period);
      return;
    }
    // 同格重复同一课程块:无需弹卡,直接拦下(服务端也会挡)
    if (kind === "place" && occupied.some((o) => o.courseBlockId === id)) {
      say(`「${blocks.find((b) => b.id === id)?.subject || "该课程"}」已在此格,无需重复添加`, "err");
      return;
    }
    const label =
      kind === "place"
        ? blocks.find((b) => b.id === id)?.subject || "所选课程"
        : entries.find((e) => e.id === id)?.subject || "所选课程";
    setConflict({
      kind,
      blockId: kind === "place" ? id : undefined,
      entryId: kind === "move" ? id : undefined,
      day, period, occupied, label,
    });
  }

  // 选择卡确认:把待决动作按 append(走班) 或 replace(覆盖) 落库
  function resolveConflict(mode: "append" | "replace") {
    const c = conflict;
    if (!c) return;
    setConflict(null);
    if (c.kind === "place" && c.blockId) doPlace(c.blockId, c.day, c.period, mode);
    else if (c.kind === "move" && c.entryId) doMove(c.entryId, c.day, c.period, mode);
  }

  // 点击格子:已选中课程块 → 放置(占用冲突由 attempt 弹确认);替换态下格子不接受点击(改点左侧池子)
  function clickCell(day: number, period: number) {
    if (swapCell || !selectedBlockId) return;
    attempt("place", selectedBlockId, day, period);
  }

  function swapWith(blockId: string) {
    if (!swapCell) return;
    attempt("place", blockId, swapCell.day, swapCell.period);
    setSwapCell(null);
  }

  // Esc 取消当前选择/替换态
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSelectedBlockId(null);
      setSwapCell(null);
      setConflict(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const stats = board?.stats;

  return (
    <div className="space-y-4">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <Field label="班级">
          <Select
            value={classId}
            onChange={setClassId}
            placeholder={meta.classes.length ? "请选择班级" : "暂无班级"}
            options={meta.classes.map((c) => ({ value: c.id, label: `${c.name}${c.grade ? " · " + c.grade : ""}` }))}
          />
        </Field>
        <Field label="显示节次">
          <Select value={rowCount} onChange={setRowCount} placeholder={`自动（${autoPeriods} 节）`} options={[6, 8, 10, 12].map((n) => ({ value: String(n), label: `${n} 节` }))} />
        </Field>
        <button
          onClick={() => setShowWeekend((v) => !v)}
          className={`rounded-lg border px-3 py-2 text-sm transition ${showWeekend ? "border-indigo-300 bg-indigo-50 text-indigo-600" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
          title="切换是否显示周六/周日列"
        >
          {showWeekend ? "含周末" : "仅工作日"}
        </button>
        {klass && (
          <div className="pb-1 text-xs text-slate-500">
            {klass.academicYear} {klass.term} · 班主任 {klass.headTeacher?.name || "未设置"} · {klass.studentCount} 人
          </div>
        )}
        <div className="ml-auto flex items-center gap-2 pb-1">
          <button
            onClick={() => setClearOpen(true)}
            disabled={!classId}
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
            title="一键清空已排好的课表格子,便于整体重新排课(课程块池原样保留)"
          >
            清空课表
          </button>
          <button
            onClick={runConflictCheck}
            disabled={checking}
            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
            title="检查教师与教室在课表中是否存在同一时间的冲突"
          >
            {checking ? "检查中…" : "⚠ 冲突检查"}
          </button>
          <button onClick={load} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">刷新</button>
          <button onClick={onGoGroup} className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-100">← 去组课</button>
        </div>
      </div>

      {/* 统计条 */}
      {stats && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
          <Stat label="需排课时" value={stats.planned} />
          <Stat label="已排课时" value={stats.placedTotal} tone="indigo" />
          <Stat label="待排" value={stats.remaining} tone={stats.remaining ? "amber" : undefined} />
          {stats.over > 0 && <Stat label="超出计划" value={stats.over} tone="red" />}
          {stats.electiveCells > 0 && <Stat label="走班时段" value={stats.electiveCells} tone="violet" />}
          <span className="ml-auto text-xs text-slate-400">
            {stats.blocks} 个课程块 · 已占用 {stats.occupiedCells} 个格子
            {stats.electiveCourses > 0 && ` · 走班课程 ${stats.electiveCourses} 门`}
          </span>
        </div>
      )}

      {/* 一日安排提示:网格行头的节次名/时间段来自全校统一模板 */}
      {classId && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs">
          <span className="text-slate-400">行头作息</span>
          {dayTpl?.configured ? (
            <span className="text-slate-600">
              按「一日安排」模板显示 —— 共 <b className="font-medium">{dayTpl.count}</b> 节
              {dayTpl.firstStart && dayTpl.lastEnd && (
                <span className="ml-1 text-slate-400">（{prettyTime(dayTpl.firstStart)}–{prettyTime(dayTpl.lastEnd)}）</span>
              )}
            </span>
          ) : (
            <span className="text-amber-600">尚未设定,当前用默认节次</span>
          )}
          <button
            onClick={onGoDay}
            className="ml-auto shrink-0 rounded-md border border-slate-200 px-2 py-0.5 text-slate-600 hover:bg-slate-50"
          >
            一日安排设定 →
          </button>
        </div>
      )}

      {/* 操作提示 */}
      <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
        {swapCell ? (
          <span className="text-indigo-600">替换模式:{DAYS[swapCell.day - 1]}第 {swapCell.period} 节 → 点上方任意课程块完成替换(按 Esc 取消)</span>
        ) : selectedBlockId ? (
          <span className="text-indigo-600">已选中「{blocks.find((b) => b.id === selectedBlockId)?.subject}」→ 点击右侧课表格子即可排入(按 Esc 取消)</span>
        ) : (
          <span>
            拖拽上方课程块到课表格子;或先点课程块再点格子。已排的格子可拖动改时段,hover 有 ✕ 移除与 ⇄ 替换。
            <b className="ml-1 font-medium text-violet-600">同一格放多门课程即为「选课走班」</b>
            ,放入时选择「加入选课走班」或「替换该时段」。
            <b className="ml-1 font-medium text-red-500">已排课程拖出课表松手即删除。</b>
          </span>
        )}
      </div>

      {!classId && <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">请先选择班级。</p>}

      {classId && (
        <div className="space-y-4">
          {/* 上:课程块池(一行四个小格子) */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700">
                课程块池
                {pool.length > 0 && <span className="ml-1.5 text-xs font-normal text-slate-400">{pool.length} 个 · 拖到下方课表</span>}
              </h3>
              <span className="text-xs text-slate-400">{board?.grade || "—"}</span>
            </div>
            {!loading && pool.length === 0 && (
              <div className="col-span-full rounded-xl border border-dashed border-slate-300 bg-white p-4 text-xs text-slate-500">
                <p>该年级在 {klass?.academicYear} {klass?.term} 下还没有课程块。</p>
                {!!board?.otherTermBlocks && <p className="mt-1 text-amber-600">另有 {board.otherTermBlocks} 个课程块属于其他学年/学期,请到「组课」核对学年学期。</p>}
                <button onClick={onGoGroup} className="mt-2 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-indigo-600">去组课 →</button>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
              {pool.map((b) => {
                const c = colorOf(b.subject);
                const quota = b.weeklyHours || 0;
                const placed = b.placed || 0;
                const full = quota > 0 && placed >= quota;
                const over = quota > 0 && placed > quota;
                const pct = quota > 0 ? Math.min(100, Math.round((placed / quota) * 100)) : 0;
                const active = selectedBlockId === b.id;
                return (
                  <div
                    key={b.id}
                    draggable
                    onDragStart={(e) => { dragRef.current = { kind: "block", id: b.id }; e.dataTransfer.effectAllowed = "copy"; e.dataTransfer.setData("text/plain", `block:${b.id}`); }}
                    onDragEnd={() => { if (dragRef.current?.kind === "block") dragRef.current = null; }}
                    onClick={() => { if (swapCell) { swapWith(b.id); return; } setSelectedBlockId(active ? null : b.id); }}
                    className={`group cursor-grab overflow-hidden rounded-lg border bg-white transition active:cursor-grabbing ${active ? "border-indigo-400 ring-2 ring-indigo-200" : "border-slate-200 hover:border-slate-300 hover:shadow-sm"} ${full && !active ? "opacity-75" : ""}`}
                    title={`${b.subject}${b.teacher ? " · " + b.teacher.name : ""}｜已排 ${placed} / 需 ${quota || "—"} 课时`}
                  >
                    <div className="flex items-stretch">
                      {/* 科目色条(与组课卡片同语言) */}
                      <span className="w-1 shrink-0" style={{ background: c.text }} />
                      <div className="min-w-0 flex-1 px-2 py-1.5">
                        {/* 行1:科目 + 状态徽章 + 已排/需 */}
                        <div className="flex items-center gap-1">
                          <span className="truncate text-[13px] font-semibold text-slate-800">{b.subject}</span>
                          {full && (
                            <span className={`shrink-0 rounded px-1 text-[10px] font-medium leading-4 ${over ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-600"}`}>
                              {over ? `超 ${placed - quota}` : "满"}
                            </span>
                          )}
                          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-slate-500">
                            {placed}<span className="text-slate-300">/</span>{quota || "—"}
                          </span>
                        </div>
                        {/* 行2:教师 · 教室 */}
                        <div className="mt-px truncate text-[11px] text-slate-500">
                          {b.nonAcademic
                            ? <span className="text-slate-400">不指派教师</span>
                            : b.teacher?.name || <span className="text-amber-600">未指定教师</span>}
                          {b.room && <span className="text-slate-400"> · {b.room}</span>}
                        </div>
                        {/* 行3:进度条 */}
                        {quota > 0 && (
                          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: over ? "#ef4444" : c.text }} />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* 下:课表网格 */}
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <div className="min-w-[820px] p-3">
                {/* 表头 */}
                <div className="grid gap-1.5" style={{ gridTemplateColumns: `76px repeat(${dayCount}, minmax(0,1fr))` }}>
                  <div />
                  {Array.from({ length: dayCount }).map((_, i) => (
                    <div key={i} className="rounded-md bg-slate-50 py-1.5 text-center text-xs font-medium text-slate-600">{DAYS[i]}</div>
                  ))}
                </div>
                {/* 行 */}
                <div className="mt-1.5 space-y-1.5">
                  {Array.from({ length: periods }).map((_, pi) => {
                    const p = pi + 1;
                    const meta2 = periodLabel(p);
                    const rp = dayTpl?.periods?.find((x) => x.period === p);
                    return (
                      <div key={p} className="grid gap-1.5" style={{ gridTemplateColumns: `76px repeat(${dayCount}, minmax(0,1fr))` }}>
                        <div className="flex flex-col items-center justify-center rounded-md bg-slate-50 px-1 py-1 text-center">
                          <span className="text-xs font-medium text-slate-600">{rp?.label || `第 ${p} 节`}</span>
                          {(rp?.range || meta2) && (
                            <span className="mt-0.5 text-[10px] leading-tight text-slate-400">{rp?.range || meta2}</span>
                          )}
                        </div>
                        {Array.from({ length: dayCount }).map((_, di) => {
                          const day = di + 1;
                          const key = `${day}-${p}`;
                          const cell = cellMap.get(key) || [];
                          const hovering = dragOver === key;
                          const isSwapTarget = !!swapCell && swapCell.day === day && swapCell.period === p;
                          const isElective = cell.length > 1; // 选课走班 / 分层走班:同格多课程并存
                          return (
                            <div
                              key={day}
                              onDragOver={(e) => { e.preventDefault(); setDragOver(key); }}
                              onDragLeave={() => setDragOver((k) => (k === key ? null : k))}
                              onDrop={(e) => {
                                e.preventDefault();
                                setDragOver(null);
                                const d = dragRef.current;
                                dragRef.current = null;
                                if (!d) return;
                                if (d.kind === "block") attempt("place", d.id, day, p);
                                else {
                                  // 拖回自己原来所在的格子 = 取消,不做任何事
                                  const src = entries.find((en) => en.id === d.id);
                                  if (src && src.dayOfWeek === day && src.period === p) return;
                                  attempt("move", d.id, day, p);
                                }
                              }}
                              onClick={() => clickCell(day, p)}
                              className={`group relative min-h-[58px] rounded-md border p-1 transition ${
                                cell.length === 0
                                  ? `border-dashed ${hovering ? "border-indigo-400 bg-indigo-50" : "border-slate-200 bg-slate-50/60"} ${selectedBlockId ? "cursor-copy hover:border-indigo-300 hover:bg-indigo-50/60" : ""}`
                                  : isElective
                                    ? `border-violet-200 bg-violet-50/40 ${hovering ? "ring-2 ring-violet-300" : ""}`
                                    : `border-slate-200 bg-white ${hovering ? "ring-2 ring-indigo-300" : ""}`
                              } ${isSwapTarget ? "ring-2 ring-indigo-400" : ""}`}
                            >
                              {cell.length === 0 && (
                                <span className={`pointer-events-none absolute inset-0 flex items-center justify-center text-xs ${hovering ? "text-indigo-500" : "text-slate-300 group-hover:text-indigo-400"}`}>
                                  {hovering ? "放置" : "+"}
                                </span>
                              )}

                              <div className="space-y-1">
                                {cell.map((e) => {
                                  const c = colorOf(e.subject);
                                  const isBlockEntry = !!e.courseBlockId;
                                  return (
                                    <div
                                      key={e.id}
                                      draggable
                                      onDragStart={(ev) => {
                                        ev.stopPropagation();
                                        dragRef.current = { kind: "entry", id: e.id };
                                        setDragEntryId(e.id);
                                        ev.dataTransfer.effectAllowed = "move";
                                        ev.dataTransfer.setData("text/plain", `entry:${e.id}`);
                                      }}
                                      onDragEnd={() => {
                                        setDragEntryId(null);
                                        const d = dragRef.current;
                                        dragRef.current = null;
                                        // 拖拽结束但没落到任何课表格子(= 拖到网格外松手)→ 直接删除,无二次确认
                                        if (d && d.kind === "entry" && d.id === e.id) doRemove(e.id);
                                      }}
                                      onClick={(ev) => ev.stopPropagation()}
                                      className={`relative cursor-grab rounded-md px-1.5 py-1 text-left active:cursor-grabbing ${isBlockEntry ? "" : "border border-dashed"}`}
                                      style={{ background: c.bg, color: c.text, borderColor: c.text }}
                                      title={`${e.subject}${e.teacher ? " · " + e.teacher.name : ""}${e.room ? " · " + e.room : ""}${isBlockEntry ? "" : "（手动/导入条目）"}`}
                                    >
                                      <div className="truncate text-xs font-medium">{e.subject}</div>
                                      <div className="truncate text-[10px] opacity-80">
                                        {nonAcademicSubjects.has(e.subject)
                                          ? "不指派教师"
                                          : e.teacher?.name || "未指定教师"}
                                        {e.room ? ` · ${e.room}` : ""}
                                      </div>
                                      {/* hover 操作 */}
                                      <div className="absolute right-0.5 top-0.5 hidden gap-0.5 group-hover:flex">
                                        <button
                                          onClick={(ev) => { ev.stopPropagation(); setSwapCell({ day, period: p }); setSelectedBlockId(null); }}
                                          className="rounded bg-white/85 px-1 text-[10px] leading-4 text-slate-600 hover:bg-white"
                                          title="替换成其他课程块"
                                        >
                                          ⇄
                                        </button>
                                        <button
                                          onClick={(ev) => { ev.stopPropagation(); doRemove(e.id); }}
                                          className="rounded bg-white/85 px-1 text-[10px] leading-4 text-red-500 hover:bg-white"
                                          title="从课表移除"
                                        >
                                          ✕
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>

                              {cell.length > 1 && (
                                <span
                                  className="absolute -top-1.5 -right-1.5 flex items-center gap-0.5 rounded-full bg-violet-600 px-1.5 py-[1px] text-[10px] font-medium text-white shadow-sm"
                                  title={`选课走班：同一时段并行开设 ${cell.length} 门课程，学生按选课/分层分流到不同课堂。若为导入产生的重复条目，可逐条 ✕ 删除。`}
                                >
                                  走班 {cell.length}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* 拖拽已排条目时的全局提示:拖出课表松手即删除 */}
      {dragEntryId && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-full bg-slate-900/85 px-4 py-2 text-xs font-medium text-white shadow-lg">
            <span className="text-base leading-none">🗑️</span>
            拖到课表外松手 = 删除「{entries.find((en) => en.id === dragEntryId)?.subject || "该课程"}」（移回原格或格子内松手则取消）
          </div>
        </div>
      )}

      {/* 落点选择卡:加入选课走班 / 替换该时段 / 取消 */}
      {conflict && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4" onClick={() => setConflict(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h4 className="text-sm font-semibold text-slate-800">
              {DAYS[conflict.day - 1]} 第 {conflict.period} 节 已有 {conflict.occupied.length} 门课程
            </h4>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {conflict.occupied.map((o) => {
                const c = colorOf(o.subject);
                return (
                  <span key={o.id} className="rounded-md px-2 py-0.5 text-xs font-medium" style={{ background: c.bg, color: c.text }}>
                    {o.subject}{o.teacher ? ` · ${o.teacher.name}` : ""}
                  </span>
                );
              })}
            </div>
            <div className="mt-3 space-y-1.5 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <p>
                <b className="text-violet-600">加入选课走班</b> —— 保留上面这些课程,把「{conflict.label}」作为<b>同时段并行</b>的
                第 {conflict.occupied.length + 1} 门课(学生按选课/分层分流到不同课堂)。
              </p>
              <p>
                <b className="text-slate-700">替换该时段</b> —— 清空上面这些课程,该格只留「{conflict.label}」。
              </p>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => setConflict(null)} className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100">取消</button>
              <button
                onClick={() => resolveConflict("replace")}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                替换该时段
              </button>
              <button
                onClick={() => resolveConflict("append")}
                className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700"
              >
                加入选课走班
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 一键清空课表:确认弹窗(含范围选择 + 预演统计 + 显式勾选确认) */}
      {clearOpen && klass && (
        <ClearTimetableDialog
          klass={klass}
          blockCount={stats?.blocks ?? 0}
          say={say}
          onClose={() => setClearOpen(false)}
          onDone={() => { setClearOpen(false); load(); }}
        />
      )}

      {/* 一键冲突检查结果 */}
      {report && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4" onClick={() => setReport(null)}>
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h4 className="text-sm font-semibold text-slate-800">
                冲突检查结果
                {klass && <span className="ml-2 text-xs font-normal text-slate-400">{klass.academicYear} {klass.term}</span>}
              </h4>
              <button onClick={() => setReport(null)} className="rounded px-2 py-1 text-sm text-slate-400 hover:bg-slate-100">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 text-sm">
              {report.summary.total === 0 ? (
                <div className="py-8 text-center">
                  <div className="text-3xl">✅</div>
                  <p className="mt-2 font-medium text-emerald-600">未发现冲突</p>
                  <p className="mt-1 text-xs text-slate-400">已扫描 {report.summary.scannedEntries} 个课表条目,教师、教室均无同一时间重复。</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="rounded-md bg-red-50 px-2 py-1 text-red-600">教师冲突 {report.summary.teacherConflicts}</span>
                    <span className="rounded-md bg-orange-50 px-2 py-1 text-orange-600">教室冲突 {report.summary.roomConflicts}</span>
                    <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-500">扫描条目 {report.summary.scannedEntries}</span>
                  </div>

                  {report.teacherConflicts.length > 0 && (
                    <section>
                      <h5 className="mb-1.5 text-xs font-semibold text-red-600">① 教师冲突 —— 同一时间同一位老师被排了多门课</h5>
                      <div className="space-y-2">
                        {report.teacherConflicts.map((c, i) => (
                          <div key={i} className="rounded-lg border border-red-100 bg-red-50/40 p-2">
                            <div className="text-xs font-medium text-slate-700">
                              {DAYS[c.dayOfWeek - 1]} 第 {c.period} 节 · <span className="text-red-600">{c.teacherName || "未命名教师"}</span>
                              <span className="ml-1 text-slate-400">({c.academicYear} {c.term} · {c.entries.length} 门课)</span>
                            </div>
                            <ul className="mt-1 space-y-0.5">
                              {c.entries.map((e) => (
                                <li key={e.entryId} className="text-xs text-slate-600">
                                  · {e.className}{e.grade ? `(${e.grade})` : ""} — {e.subject}{e.room ? ` @ ${e.room}` : ""}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {report.roomConflicts.length > 0 && (
                    <section>
                      <h5 className="mb-1.5 text-xs font-semibold text-orange-600">② 教室冲突 —— 同一时间同一教室被多个课程块占用</h5>
                      <div className="space-y-2">
                        {report.roomConflicts.map((c, i) => (
                          <div key={i} className="rounded-lg border border-orange-100 bg-orange-50/40 p-2">
                            <div className="text-xs font-medium text-slate-700">
                              {DAYS[c.dayOfWeek - 1]} 第 {c.period} 节 · <span className="text-orange-600">{c.room}</span>
                              <span className="ml-1 text-slate-400">({c.academicYear} {c.term} · {c.entries.length} 个课程块)</span>
                            </div>
                            <ul className="mt-1 space-y-0.5">
                              {c.entries.map((e) => (
                                <li key={e.entryId} className="text-xs text-slate-600">
                                  · {e.className}{e.grade ? `(${e.grade})` : ""} — {e.subject}{e.teacherName ? ` · ${e.teacherName}` : ""}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              )}
            </div>
            <div className="flex justify-end border-t border-slate-100 px-4 py-2.5">
              <button onClick={() => setReport(null)} className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-200">关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============ 一键「清空课表」确认弹窗 ============
//
// 定位:排课结果一键归零,便于整体重新排课。
//   · 只清「已排课表的格子」(TimetableEntry);课程块池、班级、成绩、节次设置全部保留。
//   · 两级范围:仅当前班级 / 该学年学期全部班级(误清代价大,故范围显式单选而非缺省)。
//   · 打开与切换范围时都先跑 dryRun 预演,把"将删除多少条、涉及几个班几个老师"摆到眼前;
//     真正执行必须再勾选确认(服务端也要求 confirm=true,直连接口同样拦得住)。
function ClearTimetableDialog({
  klass, blockCount, onClose, onDone, say,
}: {
  klass: Klass;
  blockCount: number;
  onClose: () => void;
  onDone: () => void;
  say: (t: string, k?: "ok" | "err") => void;
}) {
  const [scope, setScope] = useState<"class" | "all">("class");
  const [preview, setPreview] = useState<ClearPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [acked, setAcked] = useState(false);
  const [busy, setBusy] = useState(false);

  // 切换范围 → 重新预演;同时把确认勾选复位(防止"手快"沿用上一次的勾选)
  useEffect(() => {
    setAcked(false);
    let alive = true;
    setLoading(true);
    setPreview(null);
    api
      .post<ClearPreview>("/scheduling/timetable/clear", { classId: klass.id, scope, dryRun: true })
      .then((d) => { if (alive) setPreview(d); })
      .catch((e: any) => { if (alive) say(e.message || "无法统计待清空范围", "err"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [scope, klass.id, say]);

  async function doClear() {
    if (!preview || !acked) return;
    setBusy(true);
    try {
      const r = await api.post<ClearPreview>("/scheduling/timetable/clear", {
        classId: klass.id, scope, confirm: true,
      });
      say(`已清空 ${r?.deleted ?? 0} 条已排课程 · 课程块池保留,可直接重新排课`);
      onDone();
    } catch (e: any) {
      say(e.message || "清空失败", "err");
      setBusy(false);
    }
  }

  const scopeOptions = [
    { k: "class" as const, title: `仅当前班级「${klass.name}」`, desc: "只清这一个班的课表" },
    { k: "all" as const, title: `全部班级（${klass.academicYear} ${klass.term}）`, desc: "该学年学期下所有班级的课表一起清空" },
  ];
  const n = preview?.entries ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h4 className="text-sm font-semibold text-slate-800">
            ⚠ 清空课表
            <span className="ml-2 text-xs font-normal text-slate-400">{klass.academicYear} {klass.term}</span>
          </h4>
          <button onClick={onClose} className="rounded px-2 py-1 text-sm text-slate-400 hover:bg-slate-100">✕</button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
          <p className="text-xs text-slate-500">
            清空的是<b className="font-medium text-slate-700">已排好的课表格子</b>,课程块池原样保留,清空后可立即重新拖拽排课,不必重走「组课」。
          </p>

          {/* 范围 */}
          <div className="space-y-2">
            <div className="text-xs font-medium text-slate-600">清空范围</div>
            {scopeOptions.map((o) => (
              <label
                key={o.k}
                className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition ${scope === o.k ? "border-red-300 bg-red-50/60" : "border-slate-200 hover:border-slate-300"}`}
              >
                <input
                  type="radio"
                  name="clear-scope"
                  checked={scope === o.k}
                  onChange={() => setScope(o.k)}
                  className="mt-0.5 cursor-pointer accent-red-600"
                />
                <span className="flex-1">
                  <span className="block text-sm text-slate-700">{o.title}</span>
                  <span className="mt-0.5 block text-xs text-slate-400">
                    {o.desc}
                    {scope === o.k && (
                      <span className="ml-1 font-medium text-red-600">
                        {loading ? "统计中…" : `将删除 ${n} 条已排课程${o.k === "all" ? `,涉及 ${preview?.classes ?? 0} 个班级` : ""}`}
                      </span>
                    )}
                  </span>
                </span>
              </label>
            ))}
          </div>

          {/* 预演统计 */}
          {preview && (
            <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-2.5 text-center">
              <div>
                <div className="text-base font-semibold tabular-nums text-slate-800">{preview.entries}</div>
                <div className="text-xs text-slate-500">已排课程</div>
              </div>
              <div>
                <div className="text-base font-semibold tabular-nums text-slate-800">{preview.classes}</div>
                <div className="text-xs text-slate-500">涉及班级</div>
              </div>
              <div>
                <div className="text-base font-semibold tabular-nums text-slate-800">{preview.teachers}</div>
                <div className="text-xs text-slate-500">涉及教师</div>
              </div>
            </div>
          )}

          <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-xs leading-relaxed text-emerald-700">
            <b className="font-medium">不受影响</b> —— 课程块池（{blockCount} 个课程块）、班级与学生名单、成绩记录、节次时间段设置,均原样保留。
          </div>
          <div className="rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-2 text-xs leading-relaxed text-amber-700">
            <b className="font-medium">需知晓</b> —— 班级管理里的「任课教师」与「考试与成绩」的课程列由课表派生,清空后会暂时为空,重新排课后自动恢复。
          </div>

          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 px-3 py-2">
            <input
              type="checkbox"
              checked={acked}
              onChange={(e) => setAcked(e.target.checked)}
              className="mt-0.5 cursor-pointer accent-red-600"
            />
            <span className="text-xs text-slate-600">我已确认清空上述范围内的课表(已排课程会立即删除,无法撤销)</span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-4 py-2.5">
          <span className="mr-auto text-xs text-slate-400">{loading ? "正在统计…" : ""}</span>
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100">取消</button>
          <button
            onClick={doClear}
            disabled={!acked || busy || loading || !preview || preview.entries === 0}
            className="rounded-lg bg-red-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
          >
            {busy ? "清空中…" : preview && preview.entries === 0 ? "无课表可清空" : "确认清空"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================================================================
// 子模块三:一日安排(全校统一作息模板)
// ==================================================================
//
// 教务在这里设定「一天几节课、每节叫什么、几点到几点」,保存后**所有班级**的排课网格行头
// (节次名 + 时间段)与默认节数都按这套模板显示,不必逐班重复填时间。
//   · 课间休息不单独配置 —— 由相邻两节的时间自动推导(上一节结束 → 下一节开始);
//     想调课间就直接改下一节的开始时间,不会出现"休息 10 分钟"与"下节 8:55 开始"打架的两份数据。
//   · 保存是「全量替换」:前端编辑整张表,一次提交;节次清空后保存 = 回到"未配置"状态。
//   · 节数被改小时,已排在第 N 节之后的课程不会被动删除,只是网格里看不到 —— 保存时会给出提示。
type DayRow = { label: string; startTime: string; endTime: string };

function DayPlanView({
  meta, say, onGoPlace,
}: {
  meta: { classes: Klass[]; gradeOptions: string[]; years: string[]; terms: string[] };
  say: (t: string, k?: "ok" | "err") => void;
  onGoPlace: () => void;
}) {
  // 学年候选 = 实际有班级的学年 ∪ 当前学年(即使还没建班级,也能先把作息设好)
  const yearOptions = useMemo(
    () => Array.from(new Set([...(meta.years || []), defaultYear()])).sort(),
    [meta.years]
  );
  const [year, setYear] = useState("");
  const [term, setTerm] = useState("");
  const [rows, setRows] = useState<DayRow[]>([]);
  const [saved, setSaved] = useState<DayTemplate | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [gen, setGen] = useState({ start: "07:45", duration: "40", gap: "10", count: "8" });

  useEffect(() => {
    if (year || !yearOptions.length) return;
    setYear(yearOptions.includes(defaultYear()) ? defaultYear() : yearOptions[0]);
  }, [yearOptions, year]);
  useEffect(() => { if (!term) setTerm(meta.terms[0] || TERM_OPTIONS[0]); }, [meta.terms, term]);

  const load = useCallback(() => {
    if (!year || !term) return;
    setLoading(true);
    api
      .get<DayTemplate>(`/scheduling/day-template?academicYear=${encodeURIComponent(year)}&term=${encodeURIComponent(term)}`)
      .then((d) => {
        setSaved(d);
        setRows((d.periods || []).map((p) => ({ label: p.label || "", startTime: p.startTime || "", endTime: p.endTime || "" })));
        setWarnings([]);
      })
      .catch((e: any) => say(e.message || "加载一日安排失败", "err"))
      .finally(() => setLoading(false));
  }, [year, term, say]);
  useEffect(() => { load(); }, [load]);

  const snapshot = (list: DayRow[]) => list.map((r) => `${r.label}|${r.startTime}|${r.endTime}`).join(";");
  const dirty = useMemo(
    () => snapshot(rows) !== snapshot((saved?.periods || []).map((p) => ({ label: p.label || "", startTime: p.startTime || "", endTime: p.endTime || "" }))),
    [rows, saved]
  );

  // 编辑中的课间休息(本地即时推导,不必等保存即可预览)
  const localBreaks = useMemo<DayBreak[]>(() => {
    const out: DayBreak[] = [];
    for (let i = 0; i < rows.length - 1; i++) {
      const a = rows[i], b = rows[i + 1];
      if (!a.endTime || !b.startTime) continue;
      const m = toMinutes(b.startTime) - toMinutes(a.endTime);
      if (m > 0) out.push({ afterPeriod: i + 1, from: a.endTime, to: b.startTime, minutes: m });
    }
    return out;
  }, [rows]);

  const timed = rows.filter((r) => r.startTime && r.endTime);
  const totalMinutes = timed.reduce((s, r) => s + Math.max(0, toMinutes(r.endTime) - toMinutes(r.startTime)), 0);

  const setRow = (i: number, patch: Partial<DayRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const delRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));
  const moveRow = (i: number, d: number) =>
    setRows((rs) => {
      const j = i + d;
      if (j < 0 || j >= rs.length) return rs;
      const copy = [...rs];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  // 追加一节:自动沿上一节的时长,并从上一节结束后隔 10 分钟开始(手动微调更方便)
  const addRow = () =>
    setRows((rs) => {
      const last = rs[rs.length - 1];
      if (last && last.startTime && last.endTime) {
        const dur = toMinutes(last.endTime) - toMinutes(last.startTime);
        const start = toMinutes(last.endTime) + 10;
        if (dur > 0 && start + dur <= 24 * 60) {
          return [...rs, { label: "", startTime: fromMinutes(start), endTime: fromMinutes(start + dur) }];
        }
      }
      return [...rs, { label: "", startTime: "", endTime: "" }];
    });

  function applyGenerator() {
    const dur = Math.max(5, Math.min(180, Number(gen.duration) || 40));
    const gap = Math.max(0, Math.min(120, Number(gen.gap) || 0));
    const n = Math.max(1, Math.min(20, Number(gen.count) || 8));
    let cur = toMinutes(gen.start || "07:45");
    const next: DayRow[] = [];
    for (let i = 0; i < n; i++) {
      if (cur + dur > 24 * 60) break;
      next.push({ label: "", startTime: fromMinutes(cur), endTime: fromMinutes(cur + dur) });
      cur += dur + gap;
    }
    if (!next.length) { say("起始时间太晚,生成不出任何节次", "err"); return; }
    setRows(next);
    say(`已生成 ${next.length} 节(每节 ${dur} 分钟 · 课间 ${gap} 分钟),确认无误后点「保存并应用」`);
  }

  async function save() {
    setBusy(true);
    try {
      const d = await api.post<DayTemplate>("/scheduling/day-template", { academicYear: year, term, periods: rows });
      setSaved(d);
      setRows((d.periods || []).map((p) => ({ label: p.label || "", startTime: p.startTime || "", endTime: p.endTime || "" })));
      setWarnings(d.warnings || []);
      say(d.count ? `一日安排已保存(共 ${d.count} 节),所有班级的排课将按此作息显示` : "已清空该学年学期的一日安排");
    } catch (e: any) {
      say(e.message || "保存失败", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <Field label="学年">
          <Select value={year} onChange={setYear} placeholder="请选择学年" options={yearOptions.map((y) => ({ value: y, label: y }))} />
        </Field>
        <Field label="学期">
          <Select
            value={term}
            onChange={setTerm}
            placeholder="请选择学期"
            options={(meta.terms.length ? meta.terms : TERM_OPTIONS).map((t) => ({ value: t, label: t }))}
          />
        </Field>
        <div className="pb-1 text-xs text-slate-500">
          {loading && !rows.length ? "加载中…" : rows.length ? (
            <>共 <b className="font-medium text-slate-700">{rows.length}</b> 节{timed.length > 0 && <> · 上课合计 {totalMinutes} 分钟</>}</>
          ) : (
            "尚未设定"
          )}
        </div>
        <div className="ml-auto flex items-center gap-2 pb-1">
          <button onClick={load} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">刷新</button>
          <button onClick={onGoPlace} className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-100">去看排课 →</button>
        </div>
      </div>

      {/* 说明 */}
      <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs leading-relaxed text-slate-600">
        这里设定的是<b className="font-medium text-slate-700">全校统一作息模板</b> —— 保存后所有班级的排课网格行头(节次名与时间段)与默认节数都按它显示,不必逐班重复填。
        <span className="ml-1 text-slate-500">课间休息由相邻两节的时间自动算出,要调课间就直接改下一节的开始时间。</span>
      </div>

      {/* 快速生成 */}
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">
          快速生成
          <span className="ml-1.5 text-xs font-normal text-slate-400">一次填好整天的节次,之后可逐节微调</span>
        </h3>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="第一节开始">
            <input type="time" className="ui-input w-[112px]" value={gen.start} onChange={(e) => setGen({ ...gen, start: e.target.value })} />
          </Field>
          <Field label="每节时长(分钟)">
            <input type="number" className="ui-input w-20" value={gen.duration} onChange={(e) => setGen({ ...gen, duration: e.target.value })} />
          </Field>
          <Field label="课间休息(分钟)">
            <input type="number" className="ui-input w-20" value={gen.gap} onChange={(e) => setGen({ ...gen, gap: e.target.value })} />
          </Field>
          <Field label="一天节数">
            <input type="number" className="ui-input w-20" value={gen.count} onChange={(e) => setGen({ ...gen, count: e.target.value })} />
          </Field>
          <button
            onClick={applyGenerator}
            className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-100"
          >
            生成节次表
          </button>
        </div>
        <p className="mt-1.5 text-xs text-slate-400">生成只会覆盖下方表格(保存前不影响线上),大课间可以在生成后单独把某一节的开始时间往后调。</p>
      </div>

      {/* 节次表 */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
          <h3 className="text-sm font-semibold text-slate-700">
            节次表
            <span className="ml-1.5 text-xs font-normal text-slate-400">{year} {term}</span>
          </h3>
          <button onClick={addRow} className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">+ 添加一节</button>
        </div>

        <div className="divide-y divide-slate-100">
          {rows.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-slate-400">
              还没有节次。用上面的「快速生成」一次填好,或点「+ 添加一节」逐节添加。
            </p>
          )}
          {rows.map((r, i) => {
            const br = localBreaks.find((b) => b.afterPeriod === i + 1);
            const mins = r.startTime && r.endTime && toMinutes(r.endTime) > toMinutes(r.startTime) ? toMinutes(r.endTime) - toMinutes(r.startTime) : 0;
            return (
              <div key={i}>
                <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="w-14 shrink-0 text-xs font-medium text-slate-500">第 {i + 1} 节</span>
                  <input
                    className="ui-input w-32"
                    placeholder={`第${i + 1}节`}
                    value={r.label}
                    onChange={(e) => setRow(i, { label: e.target.value })}
                    title="节次名(留空则显示「第 N 节」)"
                  />
                  <input type="time" className="ui-input w-[112px]" value={r.startTime} onChange={(e) => setRow(i, { startTime: e.target.value })} />
                  <span className="text-xs text-slate-300">—</span>
                  <input type="time" className="ui-input w-[112px]" value={r.endTime} onChange={(e) => setRow(i, { endTime: e.target.value })} />
                  {mins > 0 && <span className="text-xs text-slate-400">{mins} 分钟</span>}
                  <div className="ml-auto flex items-center gap-1">
                    <button onClick={() => moveRow(i, -1)} disabled={i === 0} className="rounded border border-slate-200 px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40" title="上移">↑</button>
                    <button onClick={() => moveRow(i, 1)} disabled={i === rows.length - 1} className="rounded border border-slate-200 px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40" title="下移">↓</button>
                    <button onClick={() => delRow(i)} className="rounded border border-slate-200 px-1.5 py-0.5 text-xs text-red-500 hover:bg-red-50">删除</button>
                  </div>
                </div>
                {br && (
                  <div className="flex items-center gap-2 bg-slate-50/70 px-3 py-1 text-xs text-slate-400">
                    <span className="w-14 shrink-0" />
                    <span>课间休息 · {prettyTime(br.from)}–{prettyTime(br.to)} · {br.minutes} 分钟</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 保存提示 */}
      {warnings.length > 0 && (
        <div className="rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-2 text-xs text-amber-700">
          <b className="font-medium">保存提示</b>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}
      {!warnings.length && saved?.outOfRangeEntries ? (
        <div className="rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-2 text-xs text-amber-700">
          已有 {saved.outOfRangeEntries} 处已排课程位于第 {saved.count} 节之后,排课网格里看不到它们(课程不会丢失,把节数调回来即可)。
        </div>
      ) : null}

      {/* 底部操作 */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
        <span className={`text-xs ${dirty ? "text-amber-600" : "text-slate-400"}`}>
          {dirty ? "有未保存的改动" : saved?.configured ? "已保存,所有班级排课按此显示" : "尚未设定,排课网格使用默认节次"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={load} disabled={!dirty || busy} className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40">
            放弃改动
          </button>
          <button
            onClick={save}
            disabled={!dirty || busy}
            className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
          >
            {busy ? "保存中…" : "保存并应用"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============ 小组件 ============
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-[7rem] flex-col gap-1 text-xs text-slate-500">
      {label}
      {children}
    </label>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "indigo" | "amber" | "red" | "violet" }) {
  const color =
    tone === "indigo" ? "text-indigo-600"
    : tone === "amber" ? "text-amber-600"
    : tone === "red" ? "text-red-500"
    : tone === "violet" ? "text-violet-600"
    : "text-slate-800";
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`text-base font-semibold tabular-nums ${color}`}>{value}</span>
    </span>
  );
}
