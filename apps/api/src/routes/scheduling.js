// 排课管理模块(独立命名空间 /api/scheduling)
//
// 两大子模块:
//   1) 组课 —— 把「科目 + 任课教师」绑定成一个课程块(CourseBlock),并声明「预计每周课时数」与「开设年级」。
//   2) 排课 —— 选定班级后,把课程块拖进课表 slot;可删除、可替换、可移动到别的 slot。
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

const router = Router();
router.use(requireAuth);

// 教务老师或管理员
function canSchedule(user) {
  return user?.role === "ADMIN" || user?.teacherRole === "ACADEMIC";
}
const requireScheduler = (req, res, next) => {
  if (!req.user) return fail(res, 401, "未认证");
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
function sortGrades(arr) {
  return arr.slice().sort((a, b) => {
    const ia = GRADE_ORDER.indexOf(a), ib = GRADE_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b, "zh");
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
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

// 该班级该节次的「节次名 / 时间段」基准:
// 课表常由网格导入,行头(如"第一节 8:15-8:55")存在条目上;排课时沿用同一节次已有元数据,保证行头一致。
async function periodMetaFor(classId, period, academicYear, term) {
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
      classes: list.map((c) => ({
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

    const [allRows, teachers, classes] = await Promise.all([
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
    ]);
    // 年级过滤在应用层做:多选年级(逗号串)用「包含」语义,未选年级 = 全年级通用恒命中
    const list = grade ? allRows.filter((b) => blockCoversGrade(b, T(grade))) : allRows;

    const grades = Array.from(new Set([...BASE_GRADE_OPTIONS, ...classes.map((c) => c.grade).filter(Boolean)])).sort();
    const years = Array.from(new Set(classes.map((c) => c.academicYear).filter(Boolean))).sort();
    const terms = Array.from(new Set(classes.map((c) => c.term).filter(Boolean))).sort();

    ok(res, {
      blocks: list.map(shapeBlock),
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

    const teacherId = b.teacherId ? String(b.teacherId) : null;
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
    ok(res, { block: shapeBlock(row) }, "课程块已创建");
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
    ok(res, { block: shapeBlock(updated) }, "已保存");
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

    const [allBlocks, entries, otherRows] = await Promise.all([
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
      return { ...shapeBlock(b), placed: cells.length, cells };
    });

    // 行头元数据:每个节次的名称/时间段(取自课表条目,兼容网格导入)
    const periodMeta = {};
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
