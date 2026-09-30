// 排课管理模块(独立命名空间 /api/scheduling)
//
// 三大子模块:
//   1) 组课 —— 把「科目 + 任课教师」绑定成一个课程块(CourseBlock),并声明「预计每周课时数」与「开设年级」。
//   2) 排课 —— 选定班级后,把课程块拖进课表 slot;可删除、可替换、可移动到别的 slot。
//   3) 一日安排 —— 全校统一的作息模板(DayPeriodTemplate):一天几节课、每节的名称与时间段;
//      所有班级的排课网格行头与默认节数都由它驱动,课间休息由相邻两节的时间自动推导。
//
// 授权:整体前置 requireScheduler —— 仅「管理员(ADMIN)」或「教务老师(teacherRole=ACADEMIC)」。
//       (学科教师/学生/家长均不可访问,即便知道接口路径)
//
// 关键不变量:
//   - 一个 slot(班级 × 星期 × 节次 × 学年 × 学期)可以放 **多门课程** —— 这就是「选课走班 / 分层走班」:
//     同一时段全班学生分流到不同课堂,课表上该格并列显示多门课。
//     允许同科目多门并存(如「英语·王老师(A层)」+「英语·李老师(B层)」),但禁止完全重复条目。
//   - 走班组内的硬冲突只有两条,均在接口层拦下:
//       ① 同一课程块不得在同一格重复出现;
//       ② 同一教师不得在同一格并行两门课(一个人没法同时上两门课)。
//   - 「追加为走班」还是「覆盖该格」必须由人显式决定,不能让后端默认替用户选:
//     目标格已占用且请求未声明 mode 时,返回 409 + 两个选项(append / replace),前端弹选择卡。
//   - 课程块的 subject / teacherId / room 会「快照」写进 TimetableEntry,
//     因此删除课程块不会让已排课表消失(仅把来源关联置空,onDelete: SetNull)。
//
// 响应统一走 {code,message,data} 信封(见 lib/res.js)。

import { Router } from "express";
import { prisma } from "../lib/db.js";
import { ok, fail, asyncHandler } from "../lib/res.js";
import { requireAuth } from "../middleware/auth.js";
import { cmpGrade, sortClassesByGrade } from "../lib/grade-order.js";

const router = Router();
router.use(requireAuth);

// 教务老师或管理员
function canSchedule(user) {
  return user?.role === "ADMIN" || user?.teacherRole === "ACADEMIC";
}
const requireScheduler = (req, res, next) => {
  if (!req.user) return fail(res, 401, "未认证");
  // 例外:只读的「一日安排」模板 —— 全校统一作息表,任何已登录用户都要能读
  // (班级课表 / 成绩单等处要展示节次时间,普通教师也需要);写操作仍限教务老师或管理员。
  if (req.method === "GET" && req.path === "/day-template") return next();
  if (!canSchedule(req.user)) return fail(res, 403, "仅教务老师或管理员可执行排课管理操作");
  next();
};
router.use(requireScheduler);

// ————————————————————————————————————————————
// 小工具
// ————————————————————————————————————————————

const T = (v) => (v == null ? "" : String(v).trim());
const int = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
};
const MAX_PERIOD = 20; // 节次上限(与前端网格一致)
const DAYS_CN = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const MAX_GRADES = 6; // 开设年级多选上限
// 年级可选范围:高一前的衔接年级 Pre高一 亦纳入;实际班级年级会并入
const BASE_GRADE_OPTIONS = ["Pre高一", "高一", "高二", "高三"];
// 年级展示顺序:衔接年级在前,其余按学年递进(未知年级置后)
const GRADE_ORDER = ["Pre高一", "高一", "高二", "高三"];
// 排序统一走 lib/grade-order:已知年级按 GRADE_ORDER,其余(初一/初二/初三/9年级 等)按学段语义排,未知置后
function sortGrades(arr) {
  return arr.slice().sort((a, b) => {
    const ia = GRADE_ORDER.indexOf(a), ib = GRADE_ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) {
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    }
    const c = cmpGrade(a, b);
    if (c !== 0) return c;
    return a.localeCompare(b, "zh-Hans-CN");
  });
}

// 开设年级多选归一化:接受数组或逗号分隔串 → 去空白/去重/截断 → 逗号串(空串 = 全年级通用/跨年级)
// 返回 { ok: true, value } 或 { ok: false, error }
function normalizeGrades(input, gradeOptions) {
  const raw = Array.isArray(input) ? input : input == null || input === "" ? [] : String(input).split(",");
  const seen = new Set();
  const list = [];
  for (const g0 of raw) {
    const g = T(g0).slice(0, 20);
    if (!g || seen.has(g)) continue;
    seen.add(g);
    list.push(g);
  }
  if (list.length > MAX_GRADES) return { ok: false, error: `开设年级最多选择 ${MAX_GRADES} 个` };
  if (gradeOptions) {
    const bad = list.find((g) => !gradeOptions.includes(g));
    if (bad) return { ok: false, error: `开设年级「${bad}」不在可选范围内` };
  }
  return { ok: true, value: list.join(",") };
}
// 课程块是否对某年级可见:开设年级包含该年级,或未选年级 = 全年级通用
function blockCoversGrade(b, grade) {
  if (!grade) return true;
  if (!b.grades) return true; // 空 = 跨年级通用
  return b.grades.split(",").includes(grade);
}

// 注意:必须一起选出 role —— findTeacher 要用 role 做角色校验;
// 只选 teacherRole 会让 t.role 恒为 undefined,导致"指定任课教师"时误报「教师不存在或角色不符」。
const TEACHER_SELECT = { select: { id: true, name: true, role: true, teacherRole: true } };

function shapeBlock(b) {
  return {
    id: b.id,
    subject: b.subject,
    teacherId: b.teacherId,
    teacher: b.teacher || null,
    grades: b.grades || "",
    academicYear: b.academicYear,
    term: b.term,
    weeklyHours: b.weeklyHours,
    room: b.room,
    note: b.note,
    sortOrder: b.sortOrder,
    usageCount: b._count?.entries ?? undefined,
    createdAt: b.createdAt,
  };
}

// ————————————————————————————————————————————
// 「非学术课程」(V2.4.123):课程库里 category=非学术课程 的课程,不指派任课教师、不安排考试。
// 例:体育、社团、班会、自习 —— 可排进课表,但不产生教师归属与成绩。
// 课程库 name 全校唯一,故用「名称集合」判断;判断失败(查询异常)时整体回退为「没有非学术课程」,
// 保证排课主流程不会因为该附加语义而报错。
// ————————————————————————————————————————————
const NON_ACADEMIC_CATEGORY = "非学术课程";
async function nonAcademicSubjectSet() {
  try {
    const rows = await prisma.schoolCourse.findMany({
      where: { category: NON_ACADEMIC_CATEGORY },
      select: { name: true },
    });
    return new Set(rows.map((r) => r.name));
  } catch {
    return new Set();
  }
}

function shapeEntry(e) {
  return {
    id: e.id,
    classId: e.classId,
    dayOfWeek: e.dayOfWeek,
    period: e.period,
    periodLabel: e.periodLabel,
    periodTime: e.periodTime,
    subject: e.subject,
    teacherId: e.teacherId,
    teacher: e.teacher || null,
    room: e.room,
    academicYear: e.academicYear,
    term: e.term,
    courseBlockId: e.courseBlockId,
  };
}

async function findTeacher(teacherId) {
  if (!teacherId) return { teacher: null };
  const t = await prisma.user.findUnique({ where: { id: teacherId }, ...TEACHER_SELECT });
  if (!t || (t.role !== "TEACHER" && t.role !== "ADMIN")) return { error: "教师不存在或角色不符" };
  return { teacher: t };
}

// ————————————————————————————————————————————
// 「一日安排」模板(全校统一作息表)工具
// ————————————————————————————————————————————

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/; // HH:mm(24 小时制,含前导零)
const MAX_PERIODS_PER_DAY = 24; // 一天节数上限(防止误填 200 节撑爆网格)

// 时间归一化:接受 "7:45" / "07:45",统一补零成 "07:45";空串 = 未设置(null)
function normTime(v) {
  const s = T(v);
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return { error: `时间「${s}」格式应为 HH:mm(如 07:45)` };
  const out = `${String(Number(m[1])).padStart(2, "0")}:${m[2]}`;
  return TIME_RE.test(out) ? out : { error: `时间「${s}」超出 00:00–23:59 范围` };
}
const toMin = (t) => {
  const [h, m] = String(t).split(":");
  return Number(h) * 60 + Number(m);
};
// "07:45" → "7:45":展示时去掉小时前导零,与教师习惯写法一致
const pretty = (t) => (t ? String(t).replace(/^0(\d:)/, "$1") : "");
// 节次时间段展示:"7:45-8:15";只设了一端时退回单值
function rangeLabel(p) {
  if (p.startTime && p.endTime) return `${pretty(p.startTime)}-${pretty(p.endTime)}`;
  return pretty(p.startTime || p.endTime || "");
}

// 课间休息由相邻两节推导(上一节结束 → 下一节开始),不单独存字段,避免两处数据打架
function buildBreaks(periods) {
  const out = [];
  for (let i = 0; i < periods.length - 1; i++) {
    const a = periods[i], b = periods[i + 1];
    if (!a.endTime || !b.startTime) continue;
    const minutes = toMin(b.startTime) - toMin(a.endTime);
    if (minutes > 0) out.push({ afterPeriod: a.period, from: a.endTime, to: b.startTime, minutes });
  }
  return out;
}

function shapeTemplate(rows) {
  const periods = rows.map((r) => ({
    period: r.period,
    label: r.label || null,
    startTime: r.startTime || null,
    endTime: r.endTime || null,
    range: rangeLabel(r),
  }));
  const breaks = buildBreaks(periods);
  const first = periods.find((p) => p.startTime);
  const last = [...periods].reverse().find((p) => p.endTime);
  return {
    configured: periods.length > 0,
    periods,
    breaks,
    count: periods.length,
    firstStart: first ? first.startTime : null,
    lastEnd: last ? last.endTime : null,
    // 一天跨度(第一节开始 → 最后一节结束),用于「共 N 节 · 跨度 X」
    spanMinutes: first && last ? toMin(last.endTime) - toMin(first.startTime) : null,
  };
}

async function loadTemplate(academicYear, term) {
  if (!academicYear || !term) return shapeTemplate([]);
  try {
    const rows = await prisma.dayPeriodTemplate.findMany({
      where: { academicYear, term },
      orderBy: { period: "asc" },
    });
    return shapeTemplate(rows);
  } catch {
    // client 未生成 / 表不存在时的降级:视为"未配置模板",排课走旧回退逻辑
    return shapeTemplate([]);
  }
}

// 该班级该节次的「节次名 / 时间段」基准(往 TimetableEntry 写快照时用):
//   ① 优先「一日安排」模板 —— 全校统一作息,由教务在排课管理里设定;
//   ② 无模板时回落到"该节次已有条目携带的元数据"(兼容历史网格导入的课表)。
async function periodMetaFor(classId, period, academicYear, term) {
  try {
    const tpl = await prisma.dayPeriodTemplate.findUnique({
      where: { academicYear_term_period: { academicYear, term, period } },
    });
    if (tpl && (tpl.label || tpl.startTime || tpl.endTime)) {
      return { periodLabel: tpl.label || `第${period}节`, periodTime: rangeLabel(tpl) || null };
    }
  } catch {
    /* 模板不可用 → 走下面的旧逻辑 */
  }
  const row = await prisma.timetableEntry.findFirst({
    where: {
      classId,
      period,
      academicYear,
      term,
      OR: [{ periodLabel: { not: null } }, { periodTime: { not: null } }],
    },
    select: { periodLabel: true, periodTime: true },
  });
  return row || { periodLabel: null, periodTime: null };
}

// 目标格已被占用:返回 409 + 占用详情 + 两个显式选项,前端据此弹「加入选课走班 / 替换该时段」选择卡
function occupiedConflict(res, entries, incoming) {
  return res.status(409).json({
    code: 409,
    message: `该时段已有「${entries.map((e) => e.subject).join("、")}」`,
    data: {
      conflict: entries.map(shapeEntry),
      incoming: incoming || null,
      options: [
        {
          mode: "append",
          label: "加入选课走班",
          hint: `保留原课程,新增为同时段并行的第 ${entries.length + 1} 门课程`,
        },
        {
          mode: "replace",
          label: "替换该时段",
          hint: "清空该时段原有课程,只保留新增这一门",
        },
      ],
    },
  });
}

// append(选课走班)模式的合法性校验。返回值即错误文案,null 表示通过。
// 只拦两条硬冲突:同格重复同一课程块、同格同一教师并行授课。
function appendGuard(occupied, { courseBlockId, teacherId, teacherName }) {
  if (courseBlockId && occupied.some((e) => e.courseBlockId === courseBlockId)) {
    return "该课程已在此时段,无需重复添加";
  }
  if (teacherId && occupied.some((e) => e.teacherId === teacherId)) {
    const who = teacherName ? `「${teacherName}」` : "";
    return `任课教师${who}在同一时段已有其他课程,同一位老师无法在两门课同时授课`;
  }
  return null;
}

// ————————————————————————————————————————————
// 元数据:班级列表 / 可选年级学年学期 / 教师列表
// ————————————————————————————————————————————

// GET /api/scheduling/classes —— 全部班级(教务排课需遍历所有班级,不受"任教班级"限制)
router.get(
  "/classes",
  asyncHandler(async (req, res) => {
    const list = await prisma.class.findMany({
      orderBy: [{ grade: "asc" }, { name: "asc" }],
      include: {
        headTeacher: { select: { id: true, name: true } },
        _count: { select: { memberships: true, timetable: true } },
      },
    });
    const grades = Array.from(new Set([...BASE_GRADE_OPTIONS, ...list.map((c) => c.grade).filter(Boolean)])).sort();
    const years = Array.from(new Set(list.map((c) => c.academicYear).filter(Boolean))).sort();
    const terms = Array.from(new Set(list.map((c) => c.term).filter(Boolean))).sort();
    ok(res, {
      // 年级从低到高(Pre高一 → 高一 → 高二 → 高三),同年级按班号自然序
      classes: sortClassesByGrade(list).map((c) => ({
        id: c.id,
        name: c.name,
        grade: c.grade,
        academicYear: c.academicYear,
        term: c.term,
        headTeacher: c.headTeacher,
        studentCount: c._count.memberships,
        entryCount: c._count.timetable,
      })),
      grades,
      years,
      terms,
      // 基础年级范围(Pre高一/高一/高二/高三)并入实际班级年级,确保衔接年级始终可选
      gradeOptions: sortGrades(grades),
    });
  })
);

// ————————————————————————————————————————————
// 子模块三:一日安排 —— 全校统一的作息模板(一天几节课 / 每节时间段)
// ————————————————————————————————————————————
// 设定后,所有班级的排课网格都按此模板渲染行头(节次名 + 时间段)与默认节数。
// 课间休息不单独配置:由相邻两节的时间自动推导 —— 即"改课间"等价于"改下一节的开始时间",
// 不会出现「休息 10 分钟」与「下一节 8:55 开始」互相矛盾的两份数据。

// 已排课表里"节次超出模板节数"的条目数(把节数改小时,这些格子会落到网格之外) —— 只提示,不阻止
async function countOutOfRange(academicYear, term, count) {
  if (!count) return 0;
  try {
    return await prisma.timetableEntry.count({
      where: { academicYear, term, period: { gt: count } },
    });
  } catch {
    return 0;
  }
}

// GET /api/scheduling/day-template?academicYear=&term=
// 只读:任何已登录用户都能读(班级课表/成绩单等处要显示节次时间)。返回节次表 + 推导出的课间休息。
router.get(
  "/day-template",
  asyncHandler(async (req, res) => {
    const academicYear = T(req.query.academicYear);
    const term = T(req.query.term);
    if (!academicYear || !term) return fail(res, 400, "请指定学年与学期");
    const template = await loadTemplate(academicYear, term);
    const outOfRange = await countOutOfRange(academicYear, term, template.count);
    ok(res, { academicYear, term, ...template, outOfRangeEntries: outOfRange });
  })
);

// POST /api/scheduling/day-template —— 全量保存(替换)某学年学期的作息模板
// body: { academicYear, term, periods: [{ label?, startTime?, endTime? }, ...] }
//   数组顺序即节次顺序,服务端重排为 period = 1..N;periods: [] = 清空模板(回到"未配置"状态)。
// 用「全量替换」而非逐条增删改:作息表是一张整体表,前端编辑后一次提交,不会留下半套数据。
router.post(
  "/day-template",
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const academicYear = T(b.academicYear);
    const term = T(b.term);
    if (!academicYear) return fail(res, 400, "学年必填");
    if (!term) return fail(res, 400, "学期必填");
    if (!Array.isArray(b.periods)) return fail(res, 400, "periods 必须是数组");
    if (b.periods.length > MAX_PERIODS_PER_DAY) return fail(res, 400, `一天最多 ${MAX_PERIODS_PER_DAY} 节`);

    const rows = [];
    const errors = [];
    b.periods.forEach((p, i) => {
      const no = i + 1;
      const label = T(p?.label).slice(0, 20) || null;
      const st = normTime(p?.startTime);
      const et = normTime(p?.endTime);
      if (st && st.error) errors.push(`第 ${no} 节开始时间:${st.error}`);
      if (et && et.error) errors.push(`第 ${no} 节结束时间:${et.error}`);
      const startTime = st && !st.error ? st : null;
      const endTime = et && !et.error ? et : null;
      if (startTime && endTime && toMin(startTime) >= toMin(endTime)) {
        errors.push(`第 ${no} 节的结束时间必须晚于开始时间`);
      }
      rows.push({ period: no, label, startTime, endTime });
    });
    if (errors.length) return fail(res, 400, errors.join(";"));

    // 软校验(只提示不阻断):作息允许任意形态,但时间倒挂多半是填错了
    const warnings = [];
    const timed = rows.filter((r) => r.startTime);
    for (let i = 0; i < timed.length - 1; i++) {
      if (toMin(timed[i + 1].startTime) <= toMin(timed[i].startTime)) {
        warnings.push(`第 ${timed[i + 1].period} 节的开始时间不比第 ${timed[i].period} 节晚`);
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.dayPeriodTemplate.deleteMany({ where: { academicYear, term } });
      if (rows.length) {
        await tx.dayPeriodTemplate.createMany({
          data: rows.map((r) => ({ ...r, academicYear, term, createdById: req.user.id })),
        });
      }
    });

    const template = await loadTemplate(academicYear, term);
    const outOfRange = await countOutOfRange(academicYear, term, template.count);
    if (rows.length && !timed.length) warnings.push("所有节次都没填时间,排课网格只会显示「第 N 节」");
    if (outOfRange) warnings.push(`已有 ${outOfRange} 处已排课程位于第 ${template.count} 节之后,网格里看不到它们`);
    ok(
      res,
      { academicYear, term, ...template, outOfRangeEntries: outOfRange, warnings },
      rows.length ? "一日安排已保存,所有班级的排课将按此作息显示" : "已清空该学年学期的一日安排"
    );
  })
);

// ————————————————————————————————————————————
// 子模块一:组课 —— 课程块 CRUD
// ————————————————————————————————————————————

// GET /api/scheduling/blocks?grade=&academicYear=&term=
// 返回课程块列表(含被排课表引用次数)+ 表单所需的教师/年级/学年/学期选项
router.get(
  "/blocks",
  asyncHandler(async (req, res) => {
    const { grade, academicYear, term } = req.query;
    const where = {};
    if (academicYear) where.academicYear = T(academicYear);
    if (term) where.term = T(term);

    const [allRows, teachers, classes, naSubjects] = await Promise.all([
      prisma.courseBlock.findMany({
        where,
        orderBy: [{ sortOrder: "asc" }, { subject: "asc" }],
        include: { teacher: TEACHER_SELECT, _count: { select: { entries: true } } },
      }),
      prisma.user.findMany({
        where: { role: { in: ["TEACHER", "ADMIN"] }, status: "APPROVED" },
        select: { id: true, name: true, teacherRole: true },
        orderBy: { name: "asc" },
      }),
      prisma.class.findMany({ select: { grade: true, academicYear: true, term: true } }),
      nonAcademicSubjectSet(),
    ]);
    // 年级过滤在应用层做:多选年级(逗号串)用「包含」语义,未选年级 = 全年级通用恒命中
    const list = grade ? allRows.filter((b) => blockCoversGrade(b, T(grade))) : allRows;

    const grades = Array.from(new Set([...BASE_GRADE_OPTIONS, ...classes.map((c) => c.grade).filter(Boolean)])).sort();
    const years = Array.from(new Set(classes.map((c) => c.academicYear).filter(Boolean))).sort();
    const terms = Array.from(new Set(classes.map((c) => c.term).filter(Boolean))).sort();

    ok(res, {
      blocks: list.map((b) => ({ ...shapeBlock(b), nonAcademic: naSubjects.has(b.subject) })),
      teachers,
      gradeOptions: sortGrades(grades),
      years,
      terms,
    });
  })
);

// POST /api/scheduling/blocks —— 新建课程块
router.post(
  "/blocks",
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const subject = T(b.subject);
    const academicYear = T(b.academicYear);
    const term = T(b.term);
    if (!subject) return fail(res, 400, "科目必填");
    if (!academicYear) return fail(res, 400, "学年必填");
    if (!term) return fail(res, 400, "学期必填");
    // 开设年级多选:接受 grades(数组或逗号串);兼容旧客户端单值 grade 字段;全不选 = 全年级通用
    const g = normalizeGrades(b.grades !== undefined ? b.grades : b.grade);
    if (!g.ok) return fail(res, 400, g.error);
    const grades = g.value;
    const weeklyHours = int(b.weeklyHours, 0);
    if (weeklyHours < 0 || weeklyHours > 60) return fail(res, 400, "预计每周课时数需在 0–60 之间");

    // 「非学术课程」不指派任课教师:传入的教师一律忽略(前端已禁用该字段,这里是接口级兜底)
    const isNonAcademic = (await nonAcademicSubjectSet()).has(subject);
    const teacherId = isNonAcademic ? null : b.teacherId ? String(b.teacherId) : null;
    const t = await findTeacher(teacherId);
    if (t.error) return fail(res, 400, t.error);

    const dup = await prisma.courseBlock.findFirst({
      where: { subject, academicYear, term, teacherId },
    });
    if (dup) return fail(res, 409, "该学年学期下已存在「同科目 + 同教师」的课程块");

    const max = await prisma.courseBlock.aggregate({
      where: { academicYear, term },
      _max: { sortOrder: true },
    });

    const row = await prisma.courseBlock.create({
      data: {
        subject,
        grades,
        academicYear,
        term,
        teacherId,
        weeklyHours,
        room: T(b.room) || null,
        note: T(b.note) || null,
        sortOrder: (max._max.sortOrder ?? 0) + 1,
        createdById: req.user.id,
      },
      include: { teacher: TEACHER_SELECT, _count: { select: { entries: true } } },
    });
    ok(res, { block: { ...shapeBlock(row), nonAcademic: isNonAcademic } }, "课程块已创建");
  })
);

// PUT /api/scheduling/blocks/:id —— 编辑课程块
router.put(
  "/blocks/:id",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const row = await prisma.courseBlock.findUnique({ where: { id } });
    if (!row) return fail(res, 404, "课程块不存在");

    const b = req.body || {};
    const data = {};
    if (b.subject !== undefined) {
      const v = T(b.subject);
      if (!v) return fail(res, 400, "科目不能为空");
      data.subject = v;
    }
    if (b.grades !== undefined || b.grade !== undefined) {
      const g = normalizeGrades(b.grades !== undefined ? b.grades : b.grade);
      if (!g.ok) return fail(res, 400, g.error);
      data.grades = g.value;
    }
    if (b.academicYear !== undefined) data.academicYear = T(b.academicYear) || row.academicYear;
    if (b.term !== undefined) data.term = T(b.term) || row.term;
    if (b.weeklyHours !== undefined) {
      const n = int(b.weeklyHours, row.weeklyHours);
      if (n < 0 || n > 60) return fail(res, 400, "预计每周课时数需在 0–60 之间");
      data.weeklyHours = n;
    }
    if (b.teacherId !== undefined) {
      const tid = b.teacherId ? String(b.teacherId) : null;
      const t = await findTeacher(tid);
      if (t.error) return fail(res, 400, t.error);
      data.teacherId = tid;
    }
    // 「非学术课程」不指派任课教师:命中时清空教师(把科目改成非学术课程时同样生效)
    const naSubjects = await nonAcademicSubjectSet();
    if (naSubjects.has(data.subject ?? row.subject)) data.teacherId = null;
    if (b.room !== undefined) data.room = T(b.room) || null;
    if (b.note !== undefined) data.note = T(b.note) || null;
    if (b.sortOrder !== undefined) data.sortOrder = int(b.sortOrder, row.sortOrder);

    // 唯一性(同科目+同教师+同学年学期;年级为多选维度,不参与查重)
    const nextSubject = data.subject ?? row.subject;
    const nextTeacher = data.teacherId !== undefined ? data.teacherId : row.teacherId;
    const nextYear = data.academicYear ?? row.academicYear;
    const nextTerm = data.term ?? row.term;
    const dup = await prisma.courseBlock.findFirst({
      where: {
        id: { not: id },
        subject: nextSubject,
        teacherId: nextTeacher,
        academicYear: nextYear,
        term: nextTerm,
      },
    });
    if (dup) return fail(res, 409, "已存在相同「科目 + 教师 + 学年学期」的课程块");

    const updated = await prisma.courseBlock.update({
      where: { id },
      data,
      include: { teacher: TEACHER_SELECT, _count: { select: { entries: true } } },
    });
    ok(res, { block: { ...shapeBlock(updated), nonAcademic: naSubjects.has(updated.subject) } }, "已保存");
  })
);

// DELETE /api/scheduling/blocks/:id —— 删除课程块
// 已排入课表的条目保留(subject/teacherId/room 已快照),只解除来源关联
router.delete(
  "/blocks/:id",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const row = await prisma.courseBlock.findUnique({ where: { id } });
    if (!row) return fail(res, 404, "课程块不存在");
    const unlinked = await prisma.timetableEntry.count({ where: { courseBlockId: id } });
    await prisma.courseBlock.delete({ where: { id } });
    ok(
      res,
      { unlinked },
      unlinked ? `课程块已删除;${unlinked} 处已排课表保留,仅解除来源关联` : "课程块已删除"
    );
  })
);

// ————————————————————————————————————————————
// 子模块二:排课 —— 单班课表板 / 放置 / 移动 / 移除
// ————————————————————————————————————————————

// GET /api/scheduling/board?classId=
// 一次返回排课视图所需全部数据:课程块池(含 已排 n/需 w 与所在格)、课表条目、统计与行头元数据
router.get(
  "/board",
  asyncHandler(async (req, res) => {
    const classId = T(req.query.classId);
    if (!classId) return fail(res, 400, "请选择班级");

    const klass = await prisma.class.findUnique({
      where: { id: classId },
      select: { id: true, name: true, grade: true, academicYear: true, term: true },
    });
    if (!klass) return fail(res, 404, "班级不存在");

    const grade = T(req.query.grade) || klass.grade || "";
    const { academicYear, term } = klass;

    const [allBlocks, entries, otherRows, naSubjects] = await Promise.all([
      prisma.courseBlock.findMany({
        where: { academicYear, term },
        orderBy: [{ sortOrder: "asc" }, { subject: "asc" }],
        include: { teacher: TEACHER_SELECT },
      }),
      prisma.timetableEntry.findMany({
        where: { classId, academicYear, term },
        orderBy: [{ dayOfWeek: "asc" }, { period: "asc" }],
        include: { teacher: TEACHER_SELECT },
      }),
      // 该年级可见、但属于其他学年/学期的课程块(池子为空时给用户可行动提示)
      prisma.courseBlock.findMany({
        where: { NOT: { academicYear, term } },
        select: { grades: true },
      }),
      nonAcademicSubjectSet(),
    ]);
    // 年级过滤在应用层做:多选年级用「包含」语义,未选年级的课程块 = 跨年级通用,所有年级池都显示
    const blocks = grade ? allBlocks.filter((b) => blockCoversGrade(b, grade)) : allBlocks;
    const otherTermBlocks = grade ? otherRows.filter((b) => blockCoversGrade(b, grade)).length : otherRows.length;

    const cellsByBlock = new Map(); // blockId -> [{entryId, dayOfWeek, period}]
    const cellCount = new Map(); // "day-period" -> n
    for (const e of entries) {
      if (e.courseBlockId) {
        const arr = cellsByBlock.get(e.courseBlockId) || [];
        arr.push({ entryId: e.id, dayOfWeek: e.dayOfWeek, period: e.period });
        cellsByBlock.set(e.courseBlockId, arr);
      }
      const k = `${e.dayOfWeek}-${e.period}`;
      cellCount.set(k, (cellCount.get(k) || 0) + 1);
    }

    const pool = blocks.map((b) => {
      const cells = cellsByBlock.get(b.id) || [];
      return { ...shapeBlock(b), nonAcademic: naSubjects.has(b.subject), placed: cells.length, cells };
    });

    // 行头元数据:优先「一日安排」模板(全校统一作息),无模板时回退到课表条目快照(兼容历史导入的网格课表)
    const dayTemplate = await loadTemplate(academicYear, term);
    const periodMeta = {};
    for (const p of dayTemplate.periods) {
      if (p.label || p.range) {
        periodMeta[p.period] = { label: p.label || `第${p.period}节`, time: p.range || null };
      }
    }
    for (const e of entries) {
      if (!periodMeta[e.period] && (e.periodLabel || e.periodTime))
        periodMeta[e.period] = { label: e.periodLabel, time: e.periodTime };
      else if (!periodMeta[e.period]) periodMeta[e.period] = { label: null, time: null };
    }

    const planned = pool.reduce((s, b) => s + (b.weeklyHours || 0), 0);
    const placedTotal = pool.reduce((s, b) => s + b.placed, 0);
    const remaining = pool.reduce((s, b) => s + Math.max(0, (b.weeklyHours || 0) - b.placed), 0);
    const over = pool.reduce((s, b) => s + Math.max(0, b.placed - (b.weeklyHours || 0)), 0);
    // 走班时段:同一格并列 ≥2 门课程 —— 选课走班 / 分层走班是正常形态,不再是"冲突"
    const multi = Array.from(cellCount.values()).filter((n) => n > 1);
    const electiveCells = multi.length;
    const electiveCourses = multi.reduce((s, n) => s + n, 0);

    ok(res, {
      klass,
      grade,
      blocks: pool,
      entries: entries.map(shapeEntry),
      otherTermBlocks,
      periodMeta,
      // 非学术课程科目名(课表格子/课程池据此显示「不指派教师」而非「未指定教师」)
      nonAcademicSubjects: Array.from(naSubjects),
      // 一日安排模板:排课网格的节次名/时间段/默认节数都由它驱动(未配置时 periods 为空数组)
      dayTemplate,
      stats: {
        planned,
        placedTotal,
        remaining,
        over,
        electiveCells,
        electiveCourses,
        entries: entries.length,
        occupiedCells: cellCount.size,
        blocks: pool.length,
      },
    });
  })
);

// POST /api/scheduling/place —— 把课程块放进某个 slot
// body: { classId, courseBlockId, dayOfWeek, period, mode?: "append" | "replace", replace?: boolean(旧字段,等价 mode=replace) }
//   mode=append  → 选课走班:保留该格已有课程,把新课程追加为同时段并行课程
//   mode=replace → 覆盖:先清掉目标格已有条目再写入
//   mode 缺省且目标格已有课程 → 409 + 选项(不允许静默覆盖)
router.post(
  "/place",
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const classId = T(b.classId);
    const courseBlockId = T(b.courseBlockId);
    const dayOfWeek = int(b.dayOfWeek, 0);
    const period = int(b.period, 0);
    const mode = T(b.mode) || (b.replace ? "replace" : "");
    if (mode && mode !== "append" && mode !== "replace") return fail(res, 400, "mode 只能是 append 或 replace");

    if (!classId) return fail(res, 400, "班级必填");
    if (!courseBlockId) return fail(res, 400, "课程块必填");
    if (dayOfWeek < 1 || dayOfWeek > 7) return fail(res, 400, "星期需在 1–7 之间");
    if (period < 1 || period > MAX_PERIOD) return fail(res, 400, `节次需在 1–${MAX_PERIOD} 之间`);

    const [klass, block] = await Promise.all([
      prisma.class.findUnique({ where: { id: classId } }),
      prisma.courseBlock.findUnique({ where: { id: courseBlockId }, include: { teacher: TEACHER_SELECT } }),
    ]);
    if (!klass) return fail(res, 404, "班级不存在");
    if (!block) return fail(res, 404, "课程块不存在");

    const key = { classId, dayOfWeek, period, academicYear: klass.academicYear, term: klass.term };
    const occupied = await prisma.timetableEntry.findMany({
      where: key,
      include: { teacher: TEACHER_SELECT },
    });

    if (occupied.length && !mode) {
      return occupiedConflict(res, occupied, { subject: block.subject, teacherName: block.teacher?.name || null });
    }
    if (occupied.length && mode === "append") {
      const bad = appendGuard(occupied, {
        courseBlockId: block.id,
        teacherId: block.teacherId || null,
        teacherName: block.teacher?.name || null,
      });
      if (bad) return fail(res, 409, bad);
    }

    const meta = await periodMetaFor(classId, period, klass.academicYear, klass.term);

    const created = await prisma.$transaction(async (tx) => {
      if (occupied.length && mode === "replace") {
        await tx.timetableEntry.deleteMany({ where: { id: { in: occupied.map((e) => e.id) } } });
      }
      return tx.timetableEntry.create({
        data: {
          classId,
          dayOfWeek,
          period,
          periodLabel: meta.periodLabel,
          periodTime: meta.periodTime,
          subject: block.subject,
          teacherId: block.teacherId || null,
          room: block.room || null,
          academicYear: klass.academicYear,
          term: klass.term,
          courseBlockId: block.id,
        },
        include: { teacher: TEACHER_SELECT },
      });
    });

    const placed = await prisma.timetableEntry.count({ where: { courseBlockId: block.id, classId } });
    const cellSize = mode === "append" ? occupied.length + 1 : 1;
    ok(
      res,
      { entry: shapeEntry(created), placed, replaced: mode === "replace" ? occupied.length : 0, cellSize },
      mode === "append"
        ? `已加入选课走班（${DAYS_CN[dayOfWeek - 1]}第 ${period} 节现有 ${cellSize} 门课程并行）`
        : occupied.length
          ? "已替换该时段课程"
          : "已排入课表"
    );
  })
);

// POST /api/scheduling/move —— 拖动已排课程到另一个 slot
// body: { entryId, dayOfWeek, period, mode?: "append" | "replace", replace?: boolean(旧字段) }
//   mode=append  → 把该条目并入目标格的选课走班组(保留目标格原有课程)
//   mode=replace → 覆盖目标格
router.post(
  "/move",
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const entryId = T(b.entryId);
    const dayOfWeek = int(b.dayOfWeek, 0);
    const period = int(b.period, 0);
    const mode = T(b.mode) || (b.replace ? "replace" : "");
    if (mode && mode !== "append" && mode !== "replace") return fail(res, 400, "mode 只能是 append 或 replace");
    if (!entryId) return fail(res, 400, "条目必填");
    if (dayOfWeek < 1 || dayOfWeek > 7) return fail(res, 400, "星期需在 1–7 之间");
    if (period < 1 || period > MAX_PERIOD) return fail(res, 400, `节次需在 1–${MAX_PERIOD} 之间`);

    const entry = await prisma.timetableEntry.findUnique({
      where: { id: entryId },
      include: { teacher: TEACHER_SELECT },
    });
    if (!entry) return fail(res, 404, "课表条目不存在");
    if (entry.dayOfWeek === dayOfWeek && entry.period === period) {
      return ok(res, { entry: shapeEntry(entry), replaced: 0 }, "位置未变化");
    }

    const occupied = await prisma.timetableEntry.findMany({
      where: {
        classId: entry.classId,
        dayOfWeek,
        period,
        academicYear: entry.academicYear,
        term: entry.term,
        id: { not: entryId },
      },
      include: { teacher: TEACHER_SELECT },
    });

    if (occupied.length && !mode) {
      return occupiedConflict(res, occupied, { subject: entry.subject, teacherName: entry.teacher?.name || null });
    }
    if (occupied.length && mode === "append") {
      const bad = appendGuard(occupied, {
        courseBlockId: entry.courseBlockId,
        teacherId: entry.teacherId,
        teacherName: entry.teacher?.name || null,
      });
      if (bad) return fail(res, 409, bad);
    }

    const meta = await periodMetaFor(entry.classId, period, entry.academicYear, entry.term);

    const updated = await prisma.$transaction(async (tx) => {
      if (occupied.length && mode === "replace") {
        await tx.timetableEntry.deleteMany({ where: { id: { in: occupied.map((e) => e.id) } } });
      }
      return tx.timetableEntry.update({
        where: { id: entryId },
        data: { dayOfWeek, period, periodLabel: meta.periodLabel, periodTime: meta.periodTime },
        include: { teacher: TEACHER_SELECT },
      });
    });

    const cellSize = mode === "append" ? occupied.length + 1 : 1;
    ok(
      res,
      { entry: shapeEntry(updated), replaced: mode === "replace" ? occupied.length : 0, cellSize },
      mode === "append" ? `已并入选课走班组（该时段现有 ${cellSize} 门课程）` : "已移动"
    );
  })
);

// DELETE /api/scheduling/entries/:id —— 从课表中移除一个课程块(或手动条目)
router.delete(
  "/entries/:id",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const entry = await prisma.timetableEntry.findUnique({ where: { id } });
    if (!entry) return fail(res, 404, "课表条目不存在");
    await prisma.timetableEntry.delete({ where: { id } });
    const placed = entry.courseBlockId
      ? await prisma.timetableEntry.count({
          where: { courseBlockId: entry.courseBlockId, classId: entry.classId },
        })
      : 0;
    ok(res, { placed, courseBlockId: entry.courseBlockId }, "已从课表移除");
  })
);

// ————————————————————————————————————————————
// 子模块二附:一键「清空课表」—— 清空排课结果,保留课程块池,便于整体重排
// ————————————————————————————————————————————
// POST /api/scheduling/timetable/clear
// body: { classId?, academicYear?, term?, scope?: "class" | "all", dryRun?: boolean, confirm?: boolean }
//   scope=class(缺省) → 只清「指定班级」的课表条目(classId 必填)
//   scope=all         → 清「该学年 + 该学期」下全部班级的课表条目(班级主数据不动)
//   dryRun=true       → 预演:只统计将删除的条目/班级/教师数,不写库(前端弹窗展示用)
//   confirm !== true  → 拒绝执行(400):破坏性动作必须显式确认,防误触,也防直连接口调用
//   alsoClearExams=true → 一并删除本范围内的「成绩考试」(Exam)及其成绩(Score 级联删除)。
//     默认 false(语义不变:清空课表不动成绩数据)。预演时无论开关与否都回传 exams/examScores,
//     便于前端先摆出"本范围内有 N 场考试、M 条成绩"再让用户决定。
//     边界:只清理挂在**班级**上的考试(classId);走班模块的教学班考核(Exam.teachingClassId)不在范围内,
//     它由「走班」模块自己管理,跨模块静默删除会造成更大困惑。
// 语义边界(清空后能"原样重排"):
//   · 只删 TimetableEntry(排课结果)。CourseBlock(课程块池)、Class、成员、成绩、课程表配置一律不动,
//     所以清空后课程块池依旧是满的,可直接重新拖拽排课,不必重走「组课」。
//   · 学年/学期取 body,缺省回落到班级自身的学年学期;scope=all 且两者皆空 → 400,
//     避免「不传条件 = 清掉全部历史课表」这种最危险的默认行为。
router.post(
  "/timetable/clear",
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const scope = T(b.scope) === "all" ? "all" : "class";
    const classId = T(b.classId);

    let klass = null;
    if (scope === "class") {
      if (!classId) return fail(res, 400, "请选择要清空的班级");
      klass = await prisma.class.findUnique({
        where: { id: classId },
        select: { id: true, name: true, grade: true, academicYear: true, term: true },
      });
      if (!klass) return fail(res, 404, "班级不存在");
    }

    const academicYear = T(b.academicYear) || klass?.academicYear || "";
    const term = T(b.term) || klass?.term || "";
    // scope=all 必须有明确的学年学期边界,否则等于"清空所有历史课表"
    if (!academicYear || !term) {
      return fail(res, 400, "清空课表必须明确学年与学期(避免误清其他学期或全部历史课表)");
    }

    const where = scope === "class" ? { classId, academicYear, term } : { academicYear, term };

    const rows = await prisma.timetableEntry.findMany({
      where,
      select: { id: true, classId: true, teacherId: true, subject: true },
    });
    const classIds = Array.from(new Set(rows.map((r) => r.classId)));
    const teacherIds = Array.from(new Set(rows.map((r) => r.teacherId).filter(Boolean)));

    // 考试清理范围:scope=class → 该班;scope=all → 该学年学期下的全部班级
    // (Exam 自身没有 academicYear/term 字段,只能借班级的学年学期来界定,故此处必须显式取班级集合)
    const examClassIds =
      scope === "class"
        ? [classId]
        : (
            await prisma.class.findMany({
              where: { academicYear, term },
              select: { id: true },
            })
          ).map((c) => c.id);
    const examRows = examClassIds.length
      ? await prisma.exam.findMany({
          where: { classId: { in: examClassIds } },
          select: { id: true, classId: true, subject: true, title: true, examDate: true },
        })
      : [];
    const examIds = examRows.map((e) => e.id);
    const examScores = examIds.length ? await prisma.score.count({ where: { examId: { in: examIds } } }) : 0;
    const alsoClearExams = b.alsoClearExams === true;

    const preview = {
      scope,
      academicYear,
      term,
      target: klass ? { id: klass.id, name: klass.name } : null,
      entries: rows.length,
      classes: classIds.length,
      teachers: teacherIds.length,
      subjects: Array.from(new Set(rows.map((r) => r.subject))).length,
      alsoClearExams,
      exams: examIds.length,
      examScores,
      examSamples: examRows.slice(0, 5).map((e) => ({ subject: e.subject, title: e.title })),
      dryRun: b.dryRun === true,
    };

    // 预演:不改任何数据,只回统计
    if (b.dryRun === true) return ok(res, preview, "预演完成,未做任何修改");
    // 双重确认:接口层再拦一道,防止前端漏传或直连调用
    if (b.confirm !== true) return fail(res, 400, "清空课表为破坏性操作,请确认后再执行");
    // 注意:课表为空不代表无事可做 —— 勾选了清考试时仍要继续(典型场景正是"课表已空、只想清残留考试")
    if (!rows.length && (!alsoClearExams || !examIds.length)) {
      return ok(res, { ...preview, deleted: 0, deletedExams: 0 }, "该范围内没有已排课程,无需清空");
    }

    const r = await prisma.timetableEntry.deleteMany({ where: { id: { in: rows.map((x) => x.id) } } });
    const er = alsoClearExams && examIds.length
      ? await prisma.exam.deleteMany({ where: { id: { in: examIds } } })
      : { count: 0 };
    const examTail = er.count
      ? `,并删除 ${er.count} 场已建考试(含 ${examScores} 条成绩)`
      : "";
    ok(
      res,
      { ...preview, deleted: r.count, deletedExams: er.count },
      (scope === "class"
        ? `已清空「${klass.name}」课表:删除 ${r.count} 条已排课程,课程块池保留,可直接重新排课`
        : `已清空 ${academicYear} ${term} 全部班级课表:共 ${r.count} 条已排课程(涉及 ${classIds.length} 个班级),课程块池保留`) + examTail
    );
  })
);

// ————————————————————————————————————————————
// 子模块二附:一键「冲突检查」
// ————————————————————————————————————————————
// GET /api/scheduling/conflicts?academicYear=&term=
// 扫描课表条目(可按学年/学期过滤),按 学年+学期+星期+节次 分组,检出两类「同一时间」冲突:
//   ① 教师冲突 —— 同一时间同一位老师出现在 ≥2 条课表条目(跨班 / 跨课程块,一个人无法同时上两门课)
//   ② 教室冲突 —— 同一时间同一个教室被 ≥2 个不同课程块(条目)占用
// 同格「选课走班」(同班同时段并行多门课)不是冲突;仅当占用同一教师或同一教室时才判为冲突。
// 只读接口:不修改任何数据,仅返回明细 + 汇总,供前端一键查看。
router.get(
  "/conflicts",
  asyncHandler(async (req, res) => {
    const year = T(req.query.academicYear);
    const term = T(req.query.term);
    const where = {};
    if (year) where.academicYear = year;
    if (term) where.term = term;

    const entries = await prisma.timetableEntry.findMany({
      where,
      orderBy: [{ academicYear: "asc" }, { term: "asc" }, { dayOfWeek: "asc" }, { period: "asc" }],
      include: {
        teacher: { select: { id: true, name: true } },
        class: { select: { id: true, name: true, grade: true } },
      },
    });

    const teacherMap = new Map(); // key: year|term|day|period|teacherId -> entries[]
    const roomMap = new Map(); // key: year|term|day|period|room -> entries[]
    for (const e of entries) {
      const base = `${e.academicYear}|${e.term}|${e.dayOfWeek}|${e.period}`;
      if (e.teacherId) {
        const k = `${base}|${e.teacherId}`;
        const arr = teacherMap.get(k) || [];
        arr.push(e);
        teacherMap.set(k, arr);
      }
      const room = T(e.room);
      if (room) {
        const k = `${base}|${room}`;
        const arr = roomMap.get(k) || [];
        arr.push(e);
        roomMap.set(k, arr);
      }
    }

    const brief = (e) => ({
      entryId: e.id,
      classId: e.classId,
      className: e.class?.name || "",
      grade: e.class?.grade || null,
      subject: e.subject,
      teacherId: e.teacherId,
      teacherName: e.teacher?.name || null,
      room: e.room || null,
      courseBlockId: e.courseBlockId,
      academicYear: e.academicYear,
      term: e.term,
    });

    const teacherConflicts = [];
    for (const [k, arr] of teacherMap) {
      if (arr.length < 2) continue;
      const [academicYear, t2, dayOfWeek, period, teacherId] = k.split("|");
      teacherConflicts.push({
        academicYear,
        term: t2,
        dayOfWeek: Number(dayOfWeek),
        period: Number(period),
        teacherId,
        teacherName: arr[0].teacher?.name || null,
        entries: arr.map(brief),
      });
    }
    const roomConflicts = [];
    for (const [k, arr] of roomMap) {
      if (arr.length < 2) continue;
      const [academicYear, t2, dayOfWeek, period, room] = k.split("|");
      roomConflicts.push({
        academicYear,
        term: t2,
        dayOfWeek: Number(dayOfWeek),
        period: Number(period),
        room,
        entries: arr.map(brief),
      });
    }

    const byTime = (a, b) =>
      a.academicYear.localeCompare(b.academicYear) ||
      a.term.localeCompare(b.term) ||
      a.dayOfWeek - b.dayOfWeek ||
      a.period - b.period;
    teacherConflicts.sort(byTime);
    roomConflicts.sort(byTime);

    ok(res, {
      teacherConflicts,
      roomConflicts,
      summary: {
        teacherConflicts: teacherConflicts.length,
        roomConflicts: roomConflicts.length,
        total: teacherConflicts.length + roomConflicts.length,
        scannedEntries: entries.length,
      },
    });
  })
);

export default router;
