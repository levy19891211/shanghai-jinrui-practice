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
  grade: string; academicYear: string; term: string; weeklyHours: number;
  room: string | null; note: string | null; sortOrder: number; usageCount?: number;
  placed?: number; cells?: { entryId: string; dayOfWeek: number; period: number }[];
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
  stats: {
    planned: number; placedTotal: number; remaining: number; over: number;
    electiveCells: number; electiveCourses: number;
    entries: number; occupiedCells: number; blocks: number;
  };
}
interface BlocksData {
  blocks: Block[]; teachers: Tch[]; gradeOptions: string[]; years: string[]; terms: string[];
}
// 目标格已被占用时的待决动作:等用户在「加入选课走班 / 替换该时段 / 取消」中选一个
type Conflict = { kind: "place" | "move"; blockId?: string; entryId?: string; day: number; period: number; occupied: Entry[]; label: string };

// ============ 常量与配色 ============
const DAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
// 常见中学学科(供组课下拉;非常规科目可写进备注)
const SUBJECT_OPTIONS = ["语文", "数学", "英语", "物理", "化学", "生物", "政治", "历史", "地理", "信息技术", "体育", "艺术", "班会"];
const TERM_OPTIONS = ["第一学期", "第二学期", "全年"];
const FALLBACK_COLOR = { bg: "#eef2ff", text: "#4338ca" };

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

// ============ 主组件 ============
export default function TeacherScheduling() {
  const [sub, setSub] = useState<"group" | "place">("group");

  // 元数据(班级/年级/学年/学期/教师)
  const [meta, setMeta] = useState<{ classes: Klass[]; gradeOptions: string[]; years: string[]; terms: string[] }>({
    classes: [], gradeOptions: [], years: [], terms: [],
  });
  const [toast, setToast] = useState<{ text: string; kind: "ok" | "err" } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("sub") === "place") setSub("place");
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
            先「组课」把课程与教师绑成课程块,再「排课」把课程块拖进班级课表。
            <span className="ml-1 text-violet-600">同一格可放多门课程 —— 即「选课走班」。</span>
          </p>
        </div>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
          {([
            { k: "group", l: "① 组课" },
            { k: "place", l: "② 排课" },
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
      ) : (
        <PlaceView meta={meta} say={say} onGoGroup={() => setSub("group")} />
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
  const [form, setForm] = useState({ subject: "", teacherId: "", grade: "", weeklyHours: "5", room: "", note: "" });
  const [busy, setBusy] = useState(false);

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

  function startNew() {
    setEditingId("new");
    setForm({ subject: SUBJECT_OPTIONS[0], teacherId: "", grade: meta.gradeOptions[0] || "", weeklyHours: "5", room: "", note: "" });
  }
  function startEdit(b: Block) {
    setEditingId(b.id);
    setForm({
      subject: b.subject, teacherId: b.teacherId || "", grade: b.grade,
      weeklyHours: String(b.weeklyHours), room: b.room || "", note: b.note || "",
    });
  }
  function cancelEdit() { setEditingId(null); }

  async function save() {
    if (!form.subject.trim()) return say("请选择科目", "err");
    if (!form.grade.trim()) return say("请选择开设年级", "err");
    setBusy(true);
    try {
      const payload = {
        subject: form.subject, teacherId: form.teacherId || null, grade: form.grade,
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
    if (!confirm(`删除课程块「${b.grade} ${b.subject}${b.teacher ? " · " + b.teacher.name : ""}」?\n已排入课表的课时不会被删除,仅解除来源关联。`)) return;
    try {
      const r = await api.del<{ unlinked: number }>(`/scheduling/blocks/${b.id}`);
      say(r?.unlinked ? `已删除;${r.unlinked} 处已排课表保留` : "已删除");
      load();
    } catch (e: any) { say(e.message || "删除失败", "err"); }
  }

  // 按年级分组 + 小计
  const groups = useMemo(() => {
    const m = new Map<string, Block[]>();
    blocks.forEach((b) => { const arr = m.get(b.grade) || []; arr.push(b); m.set(b.grade, arr); });
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
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-3">
          <h4 className="mb-2 text-sm font-medium text-slate-700">{editingId === "new" ? "新建课程块" : "编辑课程块"}</h4>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="科目">
              <Select value={form.subject} onChange={(v) => setForm({ ...form, subject: v })} options={SUBJECT_OPTIONS.map((s) => ({ value: s, label: s }))} />
            </Field>
            <Field label="任课教师">
              <Select value={form.teacherId} onChange={(v) => setForm({ ...form, teacherId: v })} placeholder="暂不指定" options={teachers.map((t) => ({ value: t.id, label: t.name }))} />
            </Field>
            <Field label="预计每周课时数">
              <input type="number" min={0} max={60} className="ui-input w-28" value={form.weeklyHours} onChange={(e) => setForm({ ...form, weeklyHours: e.target.value })} />
            </Field>
            <Field label="开设年级">
              <Select value={form.grade} onChange={(v) => setForm({ ...form, grade: v })} options={meta.gradeOptions.map((g) => ({ value: g, label: g }))} />
            </Field>
            <Field label="建议教室"><input className="ui-input w-32" value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} placeholder="选填" /></Field>
            <Field label="备注"><input className="ui-input w-44" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="如 合班 / A层" /></Field>
            <button onClick={save} disabled={busy} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">保存</button>
            <button onClick={cancelEdit} className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100">取消</button>
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
                return (
                  <div key={b.id} className="group flex items-stretch gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:shadow-sm">
                    <span className="w-1.5 shrink-0 rounded-full" style={{ background: c.text }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium text-slate-800">{b.subject}</span>
                        <span className="rounded px-1.5 py-0.5 text-xs font-medium" style={{ background: c.bg, color: c.text }}>
                          {b.weeklyHours} 课时/周
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                        <span>{b.teacher?.name || <span className="text-amber-600">未指定教师</span>}</span>
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
  meta, say, onGoGroup,
}: {
  meta: { classes: Klass[]; gradeOptions: string[]; years: string[]; terms: string[] };
  say: (t: string, k?: "ok" | "err") => void;
  onGoGroup: () => void;
}) {
  const [classId, setClassId] = useState("");
  const [board, setBoard] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [swapCell, setSwapCell] = useState<{ day: number; period: number } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [rowCount, setRowCount] = useState<string>("");
  const [showWeekend, setShowWeekend] = useState(false);
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

  const colorMap = useMemo(
    () => buildSubjectColorMap([...blocks.map((b) => b.subject), ...entries.map((e) => e.subject)]),
    [blocks, entries]
  );
  const colorOf = (s: string) => colorMap.get(s) || FALLBACK_COLOR;

  // 网格:行(节次) × 列(星期)
  const maxEntryPeriod = entries.reduce((m, e) => Math.max(m, e.period), 0);
  const maxEntryDay = entries.reduce((m, e) => Math.max(m, e.dayOfWeek), 0);
  const periods = rowCount ? Number(rowCount) : Math.max(8, maxEntryPeriod);
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
          <Select value={rowCount} onChange={setRowCount} placeholder={`自动（${Math.max(8, maxEntryPeriod)} 节）`} options={[6, 8, 10, 12].map((n) => ({ value: String(n), label: `${n} 节` }))} />
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
                          {b.teacher?.name || <span className="text-amber-600">未指定教师</span>}
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
                    return (
                      <div key={p} className="grid gap-1.5" style={{ gridTemplateColumns: `76px repeat(${dayCount}, minmax(0,1fr))` }}>
                        <div className="flex flex-col items-center justify-center rounded-md bg-slate-50 px-1 py-1 text-center">
                          <span className="text-xs font-medium text-slate-600">第 {p} 节</span>
                          {meta2 && <span className="mt-0.5 text-[10px] leading-tight text-slate-400">{meta2}</span>}
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
                                      <div className="truncate text-[10px] opacity-80">{e.teacher?.name || "未指定教师"}{e.room ? ` · ${e.room}` : ""}</div>
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
