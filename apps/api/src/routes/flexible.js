import { Router } from "express";
import { prisma } from "../lib/db.js";
import { ok, fail, asyncHandler } from "../lib/res.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

// ============================================================
// 走班(分层 / 选课)教务接口
// 权限约定:
//   - 教师(TEACHER)/管理员(ADMIN) 可读
//   - 仅「教务老师(teacherRole=ACADEMIC)」或「管理员(ADMIN)」可执行分班类操作
//   - 科任老师只能在自己任教的教学班内建考核、录成绩(职责分离:教务不录分)
// 设计文档:docs/FLEXIBLE_SCHEDULING_DESIGN.md
// ============================================================

const router = Router();
router.use(requireAuth);

const staffOnly = requireRole("TEACHER", "ADMIN");

// 教务(ACADEMIC)或管理员(ADMIN):分班、时段块等管理类操作
function canManage(user) {
  return user?.role === "ADMIN" || user?.teacherRole === "ACADEMIC";
}
const requireManage = (req, res, next) => {
  if (!req.user) return fail(res, 401, "未认证");
  if (!canManage(req.user)) return fail(res, 403, "仅教务老师或管理员可执行此操作");
  next();
};

function parseJSON(str, fallback) {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

// ————————————————————————————————————————————
// 时段块 TimeBlock
// ————————————————————————————————————————————

router.get(
  "/blocks",
  staffOnly,
  asyncHandler(async (req, res) => {
    const { grade, academicYear, term } = req.query;
    const where = {};
    if (grade) where.grade = String(grade);
    if (academicYear) where.academicYear = String(academicYear);
    if (term) where.term = String(term);
    const list = await prisma.timeBlock.findMany({
      where,
      orderBy: [{ grade: "asc" }, { name: "asc" }],
      include: { _count: { select: { teachingClasses: true } } },
    });
    ok(res, list.map((b) => ({ ...b, slots: parseJSON(b.slots, []) })));
  })
);

router.post(
  "/blocks",
  requireManage,
  asyncHandler(async (req, res) => {
    const { grade, academicYear, term, name, slots } = req.body || {};
    if (!grade || !academicYear || !term || !name) {
      return fail(res, 400, "年级、学年、学期、名称均不能为空");
    }
    const block = await prisma.timeBlock.create({
      data: {
        grade: String(grade),
        academicYear: String(academicYear),
        term: String(term),
        name: String(name),
        slots: JSON.stringify(Array.isArray(slots) ? slots : []),
      },
    });
    ok(res, { ...block, slots: parseJSON(block.slots, []) });
  })
);

router.delete(
  "/blocks/:id",
  requireManage,
  asyncHandler(async (req, res) => {
    const block = await prisma.timeBlock.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { teachingClasses: true } } },
    });
    if (!block) return fail(res, 404, "时段块不存在");
    if (block._count.teachingClasses > 0) {
      return fail(res, 400, `该时段块下仍有 ${block._count.teachingClasses} 个教学班，无法删除`);
    }
    await prisma.timeBlock.delete({ where: { id: req.params.id } });
    ok(res, { id: req.params.id });
  })
);

// ————————————————————————————————————————————
// 分班方案 PlacementRun
// ————————————————————————————————————————————

// 候选学生:该年级该学期的学生 + 依据成绩 + 当前所在层级
async function loadCandidates({ grade, academicYear, term, subject, basisExamId }) {
  const classes = await prisma.class.findMany({
    where: { grade, academicYear, term },
    include: {
      memberships: {
        include: { student: { select: { id: true, name: true, studentNo: true } } },
      },
    },
  });
  const map = new Map();
  for (const c of classes) {
    for (const m of c.memberships || []) {
      if (!m.student || map.has(m.studentId)) continue;
      map.set(m.studentId, {
        id: m.studentId,
        name: m.student.name,
        studentNo: m.student.studentNo,
        adminClass: c.name,
      });
    }
  }

  const basis = new Map();
  if (basisExamId) {
    const scores = await prisma.score.findMany({ where: { examId: basisExamId } });
    for (const s of scores) basis.set(s.studentId, s.score);
  }

  const enrollments = await prisma.enrollment.findMany({
    where: { grade, academicYear, term, subject },
    include: { teachingClass: { select: { id: true, name: true, tier: true } } },
  });
  const cur = new Map();
  for (const e of enrollments) cur.set(e.studentId, e);

  return [...map.values()]
    .map((s) => ({
      ...s,
      basisScore: basis.has(s.id) ? basis.get(s.id) : null,
      currentTier: cur.get(s.id)?.teachingClass?.tier ?? null,
      currentClassId: cur.get(s.id)?.teachingClassId ?? null,
    }))
    .sort((a, b) => {
      const av = a.basisScore == null ? -1 : a.basisScore;
      const bv = b.basisScore == null ? -1 : b.basisScore;
      if (bv !== av) return bv - av;
      return String(a.studentNo || a.name || "").localeCompare(String(b.studentNo || b.name || ""));
    });
}

// 教师列表(供分班/教学班选任课教师,staff 可读;仅返回安全字段)
router.get(
  "/teachers",
  staffOnly,
  asyncHandler(async (req, res) => {
    const list = await prisma.user.findMany({
      where: { role: { in: ["TEACHER", "ADMIN"] }, status: { not: "DISABLED" } },
      orderBy: [{ role: "asc" }, { name: "asc" }],
      select: { id: true, name: true, role: true, teacherRole: true, email: true },
    });
    ok(res, list);
  })
);

// 依据考试:按 科目+年级(+学年/学期) 列出可作为分班依据的教学班考核
router.get(
  "/basis-exams",
  staffOnly,
  asyncHandler(async (req, res) => {
    const { subject, grade, academicYear, term } = req.query;
    const where = {
      teachingClass: subject ? { subject: String(subject) } : {},
    };
    if (grade) where.teachingClass.grade = String(grade);
    if (academicYear) where.teachingClass.academicYear = String(academicYear);
    if (term) where.teachingClass.term = String(term);
    const list = await prisma.exam.findMany({
      where,
      orderBy: [{ examDate: "desc" }],
      include: { teachingClass: { select: { id: true, name: true, subject: true, grade: true } } },
    });
    ok(res, list.map((e) => ({
      id: e.id,
      title: e.title,
      subject: e.subject,
      type: e.type,
      examDate: e.examDate,
      totalScore: e.totalScore,
      className: e.teachingClass?.name || "(行政班)",
    })));
  })
);

router.get(
  "/runs",
  staffOnly,
  asyncHandler(async (req, res) => {
    const { grade, academicYear, term } = req.query;
    const where = {};
    if (grade) where.grade = String(grade);
    if (academicYear) where.academicYear = String(academicYear);
    if (term) where.term = String(term);
    const list = await prisma.placementRun.findMany({
      where,
      orderBy: [{ grade: "asc" }, { subject: "asc" }],
      include: { block: { select: { id: true, name: true } } },
    });
    ok(
      res,
      list.map((r) => ({
        ...r,
        tiers: parseJSON(r.tiers, []),
        draftAssign: parseJSON(r.draftAssign, {}),
      }))
    );
  })
);

// 创建 / 覆盖草稿方案(同 年级+科目+学年+学期 唯一)
router.post(
  "/runs",
  requireManage,
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const { subject, grade, academicYear, term } = b;
    if (!subject || !grade || !academicYear || !term) {
      return fail(res, 400, "科目、年级、学年、学期均不能为空");
    }
    const mode = b.mode === "ELECTIVE" ? "ELECTIVE" : "LEVEL";
    const data = {
      subject: String(subject),
      grade: String(grade),
      academicYear: String(academicYear),
      term: String(term),
      mode,
      status: "DRAFT",
      blockId: b.blockId || null,
      tiers: JSON.stringify(Array.isArray(b.tiers) ? b.tiers : []),
      draftAssign: JSON.stringify(b.draftAssign && typeof b.draftAssign === "object" ? b.draftAssign : {}),
      basisExamId: b.basisExamId || null,
      basisNote: b.basisNote || null,
      createdBy: req.user.id,
    };
    const key = {
      subject_grade_academicYear_term: {
        subject: data.subject,
        grade: data.grade,
        academicYear: data.academicYear,
        term: data.term,
      },
    };
    const run = await prisma.placementRun.upsert({
      where: key,
      create: data,
      update: {
        mode: data.mode,
        blockId: data.blockId,
        tiers: data.tiers,
        draftAssign: data.draftAssign,
        basisExamId: data.basisExamId,
        basisNote: data.basisNote,
      },
    });
    ok(res, { ...run, tiers: parseJSON(run.tiers, []), draftAssign: parseJSON(run.draftAssign, {}) });
  })
);

// 方案详情 + 候选学生
router.get(
  "/runs/:id",
  staffOnly,
  asyncHandler(async (req, res) => {
    const run = await prisma.placementRun.findUnique({
      where: { id: req.params.id },
      include: { block: { select: { id: true, name: true, slots: true } } },
    });
    if (!run) return fail(res, 404, "分班方案不存在");
    const candidates = await loadCandidates(run);
    ok(res, {
      run: {
        ...run,
        block: run.block ? { ...run.block, slots: parseJSON(run.block.slots, []) } : null,
        tiers: parseJSON(run.tiers, []),
        draftAssign: parseJSON(run.draftAssign, {}),
      },
      candidates,
    });
  })
);

// 自动预分:按依据成绩排名顺序切分(可解释,非黑盒)
router.post(
  "/runs/:id/preview",
  requireManage,
  asyncHandler(async (req, res) => {
    const run = await prisma.placementRun.findUnique({ where: { id: req.params.id } });
    if (!run) return fail(res, 404, "分班方案不存在");
    const tiers = parseJSON(run.tiers, []);
    if (!tiers.length) return fail(res, 400, "请先配置层级");

    const ratios = Array.isArray(req.body?.ratios) && req.body.ratios.length === tiers.length ? req.body.ratios : null;
    const candidates = await loadCandidates(run);
    const ids = candidates.map((c) => c.id);
    const total = ids.length;
    const n = tiers.length;

    let counts;
    if (ratios) {
      const sum = ratios.reduce((a, v) => a + Number(v || 0), 0) || 1;
      counts = ratios.map((v) => Math.round((total * Number(v || 0)) / sum));
    } else {
      const base = Math.floor(total / n);
      counts = tiers.map(() => base);
    }
    // 修正舍入误差
    let diff = total - counts.reduce((a, b) => a + b, 0);
    for (let i = 0; diff > 0; i = (i + 1) % n, diff--) counts[i]++;
    let over = counts.reduce((a, b) => a + b, 0) - total;
    for (let i = n - 1; over > 0; i = (i - 1 + n) % n, over--) {
      if (counts[i] > 0) counts[i]--;
    }

    const assign = {};
    let idx = 0;
    tiers.forEach((t, i) => {
      for (let k = 0; k < counts[i] && idx < ids.length; k++, idx++) assign[ids[idx]] = t.key;
    });

    await prisma.placementRun.update({
      where: { id: run.id },
      data: { draftAssign: JSON.stringify(assign) },
    });

    ok(res, {
      assign,
      tiers: tiers.map((t, i) => ({ ...t, count: counts[i] })),
      total,
    });
  })
);

// 人工调剂:
//   - 草稿态:仅更新草稿分配
//   - 已发布:直接移动学生在读教学班,并写审计日志(用于学期中异动)
router.post(
  "/runs/:id/adjust",
  requireManage,
  asyncHandler(async (req, res) => {
    const { studentId, tierKey, reason } = req.body || {};
    if (!studentId) return fail(res, 400, "缺少 studentId");
    const run = await prisma.placementRun.findUnique({ where: { id: req.params.id } });
    if (!run) return fail(res, 404, "分班方案不存在");

    if (run.status !== "PUBLISHED") {
      const assign = parseJSON(run.draftAssign, {}) || {};
      const from = assign[studentId] ?? null;
      if (tierKey == null) delete assign[studentId];
      else assign[studentId] = tierKey;
      await prisma.placementRun.update({
        where: { id: run.id },
        data: { draftAssign: JSON.stringify(assign) },
      });
      return ok(res, { mode: "DRAFT", studentId, from, to: tierKey ?? null });
    }

    // 已发布:定位目标教学班并迁移
    if (!reason) return fail(res, 400, "学期中调剂必须填写原因");
    const tiers = parseJSON(run.tiers, []);
    const target = tiers.find((t) => t.key === tierKey);
    const targetClass = tierKey
      ? await prisma.teachingClass.findFirst({
          where: { subject: run.subject, grade: run.grade, academicYear: run.academicYear, term: run.term, tier: String(tierKey) },
        })
      : null;
    if (tierKey && !targetClass) return fail(res, 400, `目标层级 ${target?.label || tierKey} 尚未生成教学班`);

    const current = await prisma.enrollment.findUnique({
      where: {
        studentId_subject_academicYear_term: {
          studentId,
          subject: run.subject,
          academicYear: run.academicYear,
          term: run.term,
        },
      },
    });

    await prisma.$transaction([
      prisma.enrollment.update({
        where: {
          studentId_subject_academicYear_term: {
            studentId,
            subject: run.subject,
            academicYear: run.academicYear,
            term: run.term,
          },
        },
        data: {
          teachingClassId: targetClass?.id ?? null,
          status: targetClass ? "ASSIGNED" : "UNASSIGNED",
        },
      }),
      prisma.enrollmentLog.create({
        data: {
          studentId,
          fromTeachingClassId: current?.teachingClassId ?? null,
          toTeachingClassId: targetClass?.id ?? null,
          operatorId: req.user.id,
          reason: String(reason),
        },
      }),
    ]);

    ok(res, {
      mode: "PUBLISHED",
      studentId,
      from: current?.teachingClassId ?? null,
      to: targetClass?.id ?? null,
    });
  })
);

// 发布:跑检查清单 → 生成教学班与名单
router.post(
  "/runs/:id/publish",
  requireManage,
  asyncHandler(async (req, res) => {
    const globalReason = req.body?.reason || "学期初分班";
    const run = await prisma.placementRun.findUnique({ where: { id: req.params.id } });
    if (!run) return fail(res, 404, "分班方案不存在");

    const tiers = parseJSON(run.tiers, []);
    const assign = parseJSON(run.draftAssign, {}) || {};
    if (!tiers.length) return fail(res, 400, "请先配置层级");
    if (run.mode === "LEVEL" && !run.blockId) {
      return fail(res, 400, "分层走班必须先选择该科目的走班时段块（保证各层同一时段）");
    }

    const candidates = await loadCandidates(run);
    const candIds = new Set(candidates.map((c) => c.id));

    const issues = [];

    // ① 未分配学生
    const unassigned = candidates.filter((c) => !assign[c.id]);
    if (unassigned.length) {
      issues.push(`有 ${unassigned.length} 名学生未分配层级：` + unassigned.slice(0, 5).map((c) => c.name).join("、") + (unassigned.length > 5 ? " 等" : ""));
    }

    // ② 容量
    const byTier = {};
    for (const [sid, key] of Object.entries(assign)) {
      if (!candIds.has(sid)) continue;
      byTier[key] = (byTier[key] || 0) + 1;
    }
    for (const t of tiers) {
      const cnt = byTier[t.key] || 0;
      if (t.capacity && cnt > Number(t.capacity)) {
        issues.push(`${t.label || t.key} 超出容量（${cnt}/${t.capacity}）`);
      }
    }

    // ③ 时段块内教师 / 教室冲突
    if (run.blockId) {
      const teacherIds = tiers.map((t) => t.teacherId).filter(Boolean);
      const dupTeacher = teacherIds.filter((v, i) => teacherIds.indexOf(v) !== i);
      if (dupTeacher.length) issues.push("同一时段块内存在重复的主讲教师");

      const rooms = tiers.map((t) => t.room).filter(Boolean);
      const dupRoom = rooms.filter((v, i) => rooms.indexOf(v) !== i);
      if (dupRoom.length) issues.push("同一时段块内存在重复的教室");

      const others = await prisma.teachingClass.findMany({
        where: { blockId: run.blockId, NOT: { subject: run.subject } },
        include: { teachers: true },
      });
      const otherTeachers = new Set();
      const otherRooms = new Set();
      for (const o of others) {
        for (const t of o.teachers || []) otherTeachers.add(t.teacherId);
        if (o.room) otherRooms.add(o.room);
      }
      if (teacherIds.some((id) => otherTeachers.has(id))) issues.push("该时段块内主讲教师与其他科目教学班冲突");
      if (rooms.some((r) => otherRooms.has(r))) issues.push("该时段块内教室与其他科目教学班冲突");
    }

    if (issues.length) {
      return ok(res, { published: false, issues });
    }

    // ——— 生成教学班与名单 ———
    const scope = {
      subject: run.subject,
      grade: run.grade,
      academicYear: run.academicYear,
      term: run.term,
    };

    const oldEnrollments = await prisma.enrollment.findMany({
      where: scope,
      include: { teachingClass: { select: { id: true, tier: true } } },
    });
    const oldByStudent = new Map(oldEnrollments.map((e) => [e.studentId, e]));
    // 旧层级:用于判定是否需要写调剂日志
    const oldTierByStudent = new Map(oldEnrollments.map((e) => [e.studentId, e.teachingClass?.tier ?? null]));

    // 删除该科目该学期下旧的走班教学班(级联清理其教师与名单)
    await prisma.teachingClass.deleteMany({ where: { ...scope, type: run.mode } });

    const created = [];
    const classIdByTier = {};
    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i];
      const tc = await prisma.teachingClass.create({
        data: {
          ...scope,
          type: run.mode,
          tier: String(t.key),
          tierOrder: i,
          name: `${run.grade}${run.subject}${t.label || t.key}班`,
          capacity: t.capacity ? Number(t.capacity) : null,
          room: t.room || null,
          blockId: run.blockId || null,
        },
      });
      if (t.teacherId) {
        await prisma.teachingClassTeacher.create({
          data: { teachingClassId: tc.id, teacherId: t.teacherId, role: "LEAD" },
        });
      }
      created.push(tc);
      classIdByTier[t.key] = tc.id;
    }

    // 写入名单 + 变更日志
    const logRows = [];
    for (const c of candidates) {
      const key = assign[c.id];
      const tcId = key ? classIdByTier[key] ?? null : null;
      await prisma.enrollment.upsert({
        where: {
          studentId_subject_academicYear_term: {
            studentId: c.id,
            subject: run.subject,
            academicYear: run.academicYear,
            term: run.term,
          },
        },
        create: {
          studentId: c.id,
          teachingClassId: tcId,
          subject: run.subject,
          grade: run.grade,
          academicYear: run.academicYear,
          term: run.term,
          status: tcId ? "ASSIGNED" : "UNASSIGNED",
        },
        update: {
          teachingClassId: tcId,
          status: tcId ? "ASSIGNED" : "UNASSIGNED",
        },
      });

      const newTier = key ? String(key) : null;
      const oldTier = oldTierByStudent.has(c.id) ? oldTierByStudent.get(c.id) : undefined;
      // 首次分班(oldTier 无记录)不产生调剂日志;层级发生变化才记录
      if (oldTier !== undefined && oldTier !== newTier) {
        logRows.push({
          studentId: c.id,
          fromTeachingClassId: oldByStudent.get(c.id)?.teachingClassId ?? null,
          toTeachingClassId: tcId,
          operatorId: req.user.id,
          reason: globalReason,
        });
      }
    }
    if (logRows.length) {
      await prisma.enrollmentLog.createMany({ data: logRows });
    }

    await prisma.placementRun.update({
      where: { id: run.id },
      data: { status: "PUBLISHED", publishedBy: req.user.id, publishedAt: new Date() },
    });

    ok(res, { published: true, teachingClasses: created, adjusted: logRows.length, total: candidates.length });
  })
);

// 撤回发布
router.post(
  "/runs/:id/revoke",
  requireManage,
  asyncHandler(async (req, res) => {
    const run = await prisma.placementRun.findUnique({ where: { id: req.params.id } });
    if (!run) return fail(res, 404, "分班方案不存在");
    await prisma.placementRun.update({
      where: { id: run.id },
      data: { status: "REVOKED", publishedBy: null, publishedAt: null },
    });
    ok(res, { id: run.id, status: "REVOKED" });
  })
);

// ————————————————————————————————————————————
// 教学班 TeachingClass
// ————————————————————————————————————————————

router.get(
  "/my-classes",
  staffOnly,
  asyncHandler(async (req, res) => {
    const where = canManage(req.user) ? {} : { teachers: { some: { teacherId: req.user.id } } };
    const list = await prisma.teachingClass.findMany({
      where,
      orderBy: [{ grade: "asc" }, { subject: "asc" }, { tierOrder: "asc" }],
      include: {
        block: { select: { id: true, name: true } },
        teachers: { include: { teacher: { select: { id: true, name: true } } } },
        _count: { select: { enrollments: true, exams: true } },
      },
    });
    ok(res, list);
  })
);

// 教学班权限:教务/管理员,或该班任课教师
async function assertClassAccess(req, res, classId) {
  const tc = await prisma.teachingClass.findUnique({
    where: { id: classId },
    include: { teachers: true, block: { select: { id: true, name: true } } },
  });
  if (!tc) {
    fail(res, 404, "教学班不存在");
    return null;
  }
  const isOwner = (tc.teachers || []).some((t) => t.teacherId === req.user.id);
  if (!canManage(req.user) && !isOwner) {
    fail(res, 403, "无权访问该教学班");
    return null;
  }
  return tc;
}

router.get(
  "/classes/:id/roster",
  staffOnly,
  asyncHandler(async (req, res) => {
    const tc = await assertClassAccess(req, res, req.params.id);
    if (!tc) return;
    const enrollments = await prisma.enrollment.findMany({
      where: { teachingClassId: tc.id },
      include: { student: { select: { id: true, name: true, studentNo: true, email: true } } },
    });
    const ids = enrollments.map((e) => e.studentId);
    const memberships = ids.length
      ? await prisma.classMembership.findMany({
          where: { studentId: { in: ids } },
          include: { class: { select: { id: true, name: true } } },
        })
      : [];
    const adminByStudent = new Map();
    for (const m of memberships) adminByStudent.set(m.studentId, m.class?.name || null);

    ok(res, {
      teachingClass: tc,
      roster: enrollments.map((e) => ({
        studentId: e.studentId,
        name: e.student?.name,
        studentNo: e.student?.studentNo,
        adminClass: adminByStudent.get(e.studentId) || null,
        status: e.status,
      })),
    });
  })
);

router.get(
  "/classes/:id/exams",
  staffOnly,
  asyncHandler(async (req, res) => {
    const tc = await assertClassAccess(req, res, req.params.id);
    if (!tc) return;
    const exams = await prisma.exam.findMany({
      where: { teachingClassId: tc.id },
      orderBy: { examDate: "desc" },
      include: { _count: { select: { scores: true } } },
    });
    ok(res, exams);
  })
);

router.post(
  "/classes/:id/exams",
  staffOnly,
  asyncHandler(async (req, res) => {
    const tc = await assertClassAccess(req, res, req.params.id);
    if (!tc) return;
    const { title, type, examDate, totalScore } = req.body || {};
    if (!title) return fail(res, 400, "考核名称不能为空");
    const exam = await prisma.exam.create({
      data: {
        teachingClassId: tc.id,
        subject: tc.subject,
        title: String(title),
        type: type || "DAILY",
        examDate: examDate ? new Date(examDate) : new Date(),
        totalScore: totalScore != null ? Number(totalScore) : 100,
        createdBy: req.user.id,
      },
    });
    ok(res, exam);
  })
);

// 成绩:按教学班名册读取(未录入也占位显示)
router.get(
  "/classes/:id/exams/:examId/scores",
  staffOnly,
  asyncHandler(async (req, res) => {
    const tc = await assertClassAccess(req, res, req.params.id);
    if (!tc) return;
    const exam = await prisma.exam.findUnique({ where: { id: req.params.examId } });
    if (!exam || exam.teachingClassId !== tc.id) return fail(res, 404, "考核不存在或不属于该教学班");

    const enrollments = await prisma.enrollment.findMany({
      where: { teachingClassId: tc.id },
      include: { student: { select: { id: true, name: true, studentNo: true } } },
    });
    const ids = enrollments.map((e) => e.studentId);
    const memberships = ids.length
      ? await prisma.classMembership.findMany({
          where: { studentId: { in: ids } },
          include: { class: { select: { id: true, name: true } } },
        })
      : [];
    const adminByStudent = new Map();
    for (const m of memberships) adminByStudent.set(m.studentId, m.class?.name || null);
    const scores = await prisma.score.findMany({ where: { examId: exam.id } });
    const byStudent = new Map(scores.map((s) => [s.studentId, s]));

    ok(res, {
      exam,
      rows: enrollments.map((e) => {
        const s = byStudent.get(e.studentId);
        return {
          studentId: e.studentId,
          name: e.student?.name,
          studentNo: e.student?.studentNo,
          adminClass: adminByStudent.get(e.studentId) || null,
          score: s ? s.score : null,
          rankInClass: s?.rankInClass ?? null,
          comment: s?.comment ?? "",
        };
      }),
    });
  })
);

// 成绩:批量录入 / 覆盖,自动校验名册与分值,并重算班内排名
router.post(
  "/classes/:id/exams/:examId/scores",
  staffOnly,
  asyncHandler(async (req, res) => {
    const tc = await assertClassAccess(req, res, req.params.id);
    if (!tc) return;
    const exam = await prisma.exam.findUnique({ where: { id: req.params.examId } });
    if (!exam || exam.teachingClassId !== tc.id) return fail(res, 404, "考核不存在或不属于该教学班");

    const rows = Array.isArray(req.body?.scores) ? req.body.scores : [];
    if (!rows.length) return fail(res, 400, "没有待录入的成绩");

    // 校验:学生必须在本教学班名册内
    const enrollments = await prisma.enrollment.findMany({ where: { teachingClassId: tc.id } });
    const allowed = new Set(enrollments.map((e) => e.studentId));
    const invalid = rows.filter((r) => !allowed.has(r.studentId));
    if (invalid.length) return fail(res, 400, `有 ${invalid.length} 名学生不在本教学班名册内，已拒绝录入`);

    const full = exam.totalScore || 100;
    const bad = rows.filter((r) => r.score == null || Number.isNaN(Number(r.score)) || Number(r.score) < 0 || Number(r.score) > full);
    if (bad.length) return fail(res, 400, `有 ${bad.length} 条成绩超出 0~${full} 范围`);

    for (const r of rows) {
      await prisma.score.upsert({
        where: { examId_studentId: { examId: exam.id, studentId: r.studentId } },
        create: {
          examId: exam.id,
          studentId: r.studentId,
          score: Number(r.score),
          comment: r.comment || null,
          updatedBy: req.user.id,
        },
        update: {
          score: Number(r.score),
          comment: r.comment || null,
          updatedBy: req.user.id,
        },
      });
    }

    // 重算教学班内排名(同分并列,取较优名次)
    const all = await prisma.score.findMany({
      where: { examId: exam.id },
      orderBy: { score: "desc" },
    });
    let prevScore = null;
    let prevRank = 0;
    for (let i = 0; i < all.length; i++) {
      const rank = prevScore !== null && all[i].score === prevScore ? prevRank : i + 1;
      await prisma.score.update({ where: { id: all[i].id }, data: { rankInClass: rank } });
      prevScore = all[i].score;
      prevRank = rank;
    }

    ok(res, { saved: rows.length, ranked: all.length });
  })
);

export default router;
