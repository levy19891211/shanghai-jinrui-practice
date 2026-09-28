// 教务管理模块(独立命名空间 /api/academics)
// 与笔试题库/会话/作业/升学规划等完全隔离:仅读写 8 张新增表(Class / ClassSubjectTeacher /
// ClassMembership / Exam / Score / TeacherFeedback / TimetableEntry / ParentLink),
// 不触碰任何现有业务 model/路由,不影响现有功能与数据。
//
// 响应统一走 {code,message,data} 信封(由 lib/res.js 的 ok/fail 提供),
// 因为前端 /app/* 与 /teacher/* 页面统一通过 lib/api.ts 消费信封。
//
// 授权模型:
//   - 教师/管理员:对可见班级(Class)有完整 CRUD;对"自己任教(或担任班主任)的班级+科目"可录分/排课。
//   - 学生:只读本人成绩/反馈(按 visibility 过滤)/课表/班级信息,零写入。
//   - 家长:只读已 VERIFIED 关联孩子的全科成绩/反馈(PARENT|BOTH 且 PUBLISHED)/课表/升学规划(若 parentVisible),零写入。

import express from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { ok, fail } from "../lib/res.js";
import { asyncHandler } from "../lib/res.js";
import { prisma } from "../lib/db.js";

const router = express.Router();

// ============================================================
// 作用域辅助
// ============================================================

// 该用户可见的班级 id 集合(ADMIN=全部;TEACHER=任教或班主任;STUDENT=所在班级;PARENT=孩子所在班级)
async function visibleClassIds(req) {
  const role = req.user.role;
  if (role === "ADMIN") {
    const all = await prisma.class.findMany({ select: { id: true } });
    return all.map((c) => c.id);
  }
  if (role === "TEACHER") {
    const t = await prisma.classSubjectTeacher.findMany({
      where: { teacherId: req.user.id },
      select: { classId: true },
    });
    const head = await prisma.class.findMany({
      where: { headTeacherId: req.user.id },
      select: { id: true },
    });
    return [...new Set([...t.map((x) => x.classId), ...head.map((x) => x.id)])];
  }
  if (role === "STUDENT") {
    const m = await prisma.classMembership.findMany({
      where: { studentId: req.user.id },
      select: { classId: true },
    });
    return m.map((x) => x.classId);
  }
  if (role === "PARENT") {
    const links = await prisma.parentLink.findMany({
      where: { parentUserId: req.user.id, status: "VERIFIED" },
      select: { studentUserId: true },
    });
    const studentIds = links.map((l) => l.studentUserId);
    if (!studentIds.length) return [];
    const m = await prisma.classMembership.findMany({
      where: { studentId: { in: studentIds } },
      select: { classId: true },
    });
    return [...new Set(m.map((x) => x.classId))];
  }
  return [];
}

// 是否可管理(写)该班级:ADMIN 任意;TEACHER 需为班主任或该班任一科目任教;其余 false
async function canManageClass(req, classId) {
  if (req.user.role === "ADMIN") return true;
  if (req.user.role !== "TEACHER") return false;
  const cls = await prisma.class.findUnique({
    where: { id: classId },
    select: { headTeacherId: true },
  });
  if (!cls) return false;
  if (cls.headTeacherId === req.user.id) return true;
  const link = await prisma.classSubjectTeacher.findFirst({
    where: { classId, teacherId: req.user.id },
  });
  return !!link;
}

// 是否可任教(写)该班某科目:ADMIN 任意;TEACHER 需为班主任或该班该科目任教;其余 false
async function canTeachSubject(req, classId, subject) {
  if (req.user.role === "ADMIN") return true;
  if (req.user.role !== "TEACHER") return false;
  const cls = await prisma.class.findUnique({
    where: { id: classId },
    select: { headTeacherId: true },
  });
  if (!cls) return false;
  if (cls.headTeacherId === req.user.id) return true;
  const link = await prisma.classSubjectTeacher.findFirst({
    where: { classId, subject, teacherId: req.user.id },
  });
  return !!link;
}

// 判断当前用户是否为某班班主任(ADMIN 视为否,因其权限走 ADMIN 通道)
async function isHeadTeacherOf(req, classId) {
  if (req.user.role !== "TEACHER" && req.user.role !== "ADMIN") return false;
  const cls = await prisma.class.findUnique({ where: { id: classId }, select: { headTeacherId: true } });
  return !!cls && cls.headTeacherId === req.user.id;
}

// 是否可设置班主任(管理员 或 教务老师 teacherRole=ACADEMIC)
function canSetHomeroom(user) {
  return user?.role === "ADMIN" || user?.teacherRole === "ACADEMIC";
}

// 是否具教务管理权限(管理员 或 教务老师 teacherRole=ACADEMIC),跨班教务管理(建班/建课/任课教师等)
function isAcademicAdmin(user) {
  return user?.role === "ADMIN" || user?.teacherRole === "ACADEMIC";
}

// 该用户在指定班级内「可见/可管的科目」集合(用于成绩/反馈作用域):
//   ADMIN   -> null  (全部科目)
//   班主任   -> null  (本班全部科目)
//   学科老师 -> 仅本人任教科目数组
//   学生/家长 -> []   (不用于成绩作用域)
async function visibleSubjects(req, classId) {
  if (req.user.role === "ADMIN") return null;
  if (req.user.role !== "TEACHER") return [];
  const cls = await prisma.class.findUnique({ where: { id: classId }, select: { headTeacherId: true } });
  if (!cls) return [];
  if (cls.headTeacherId === req.user.id) return null;
  const links = await prisma.classSubjectTeacher.findMany({
    where: { classId, teacherId: req.user.id },
    select: { subject: true },
  });
  return links.map((l) => l.subject);
}

// 为学科老师构造作用域:{ classIds, classSubjects: {classId: string[]|null} }
// classSubjects 为 null 表示该班其为班主任(可见全部科目),否则为所教科目数组。
async function buildTeacherScope(req) {
  const ids = await visibleClassIds(req);
  const classSubjects = {};
  for (const cid of ids) {
    classSubjects[cid] = await visibleSubjects(req, cid); // null 或 string[]
  }
  return { classIds: ids, classSubjects };
}

// 学生所属班级 id 列表(批量)
async function studentClassIds(studentId) {
  const m = await prisma.classMembership.findMany({ where: { studentId }, select: { classId: true } });
  return m.map((x) => x.classId);
}

// ============================================================
// 教师/学生 选择器(供前端下拉)
// ============================================================

// GET /api/academics/teachers —— 教师/管理员:返回教师与管理员列表(供班主任/任课教师下拉)
router.get(
  "/teachers",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({
      where: { role: { in: ["TEACHER", "ADMIN"] } },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    });
    ok(res, { teachers: users });
  })
);

// GET /api/academics/students —— 教师/管理员:返回已审核学生列表(供添加班级成员/录分下拉)
router.get(
  "/students",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({
      where: { role: "STUDENT", status: "APPROVED" },
      select: { id: true, name: true, studentNo: true },
      orderBy: { name: "asc" },
    });
    ok(res, { students: users });
  })
);

// ============================================================
// 班级 Class
// ============================================================

// GET /api/academics/classes —— 列出可见班级(含班主任/科目教师/人数摘要)
router.get(
  "/classes",
  requireAuth,
  asyncHandler(async (req, res) => {
    const ids = await visibleClassIds(req);
    if (req.user.role === "PARENT" && ids.length === 0) {
      return ok(res, { classes: [] });
    }
    const where = ids.length ? { id: { in: ids } } : undefined;
    const classes = await prisma.class.findMany({
      where,
      orderBy: [{ academicYear: "desc" }, { name: "asc" }],
      include: {
        headTeacher: { select: { id: true, name: true } },
        subjectTeachers: {
          include: { teacher: { select: { id: true, name: true } } },
        },
        memberships: { select: { id: true } },
      },
    });
    ok(res, {
      classes: classes.map((c) => ({
        id: c.id,
        name: c.name,
        grade: c.grade,
        academicYear: c.academicYear,
        term: c.term,
        headTeacher: c.headTeacher,
        studentCount: c.memberships.length,
        subjectTeachers: c.subjectTeachers.map((st) => ({
          id: st.id,
          subject: st.subject,
          role: st.role,
          teacher: st.teacher,
        })),
      })),
    });
  })
);

// POST /api/academics/classes —— 教师/管理员:创建班级
router.post(
  "/classes",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!isAcademicAdmin(req.user)) return fail(res, 403, "仅管理员或教务老师可建立班级");
    const { name, grade, academicYear, term, headTeacherId } = req.body || {};
    if (!name || !String(name).trim()) return fail(res, 400, "班级名称必填");
    if (!academicYear || !String(academicYear).trim()) return fail(res, 400, "学年必填");
    if (!term || !String(term).trim()) return fail(res, 400, "学期必填");
    if (headTeacherId) {
      const ht = await prisma.user.findUnique({ where: { id: headTeacherId } });
      if (!ht || (ht.role !== "TEACHER" && ht.role !== "ADMIN"))
        return fail(res, 400, "班主任必须是教师或管理员");
    }
    const cls = await prisma.class.create({
      data: {
        name: String(name).trim(),
        grade: grade ? String(grade).trim() : null,
        academicYear: String(academicYear).trim(),
        term: String(term).trim(),
        headTeacherId: headTeacherId || null,
      },
    });
    ok(res, { class: cls }, "创建成功");
  })
);

// GET /api/academics/classes/:id —— 班级详情(含成员名单 + 科目教师)
router.get(
  "/classes/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const ids = await visibleClassIds(req);
    if (ids.length && !ids.includes(id)) return fail(res, 403, "无权访问该班级");
    const cls = await prisma.class.findUnique({
      where: { id },
      include: {
        headTeacher: { select: { id: true, name: true } },
        subjectTeachers: {
          include: { teacher: { select: { id: true, name: true } } },
        },
        memberships: {
          include: { student: { select: { id: true, name: true, studentNo: true } } },
        },
      },
    });
    if (!cls) return fail(res, 404, "班级不存在");
    ok(res, {
      class: {
        id: cls.id,
        name: cls.name,
        grade: cls.grade,
        academicYear: cls.academicYear,
        term: cls.term,
        headTeacher: cls.headTeacher,
        subjectTeachers: cls.subjectTeachers.map((st) => ({
          id: st.id,
          subject: st.subject,
          role: st.role,
          teacher: st.teacher,
        })),
        students: cls.memberships.map((m) => m.student),
      },
    });
  })
);

// PUT /api/academics/classes/:id —— 教师/管理员(作用域):更新班级
router.put(
  "/classes/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!isAcademicAdmin(req.user) && !(await canManageClass(req, id))) return fail(res, 403, "无权管理该班级");
    const cls = await prisma.class.findUnique({ where: { id } });
    if (!cls) return fail(res, 404, "班级不存在");
    const { name, grade, academicYear, term, headTeacherId } = req.body || {};
    const data = {};
    if (name !== undefined) data.name = String(name).trim();
    if (grade !== undefined) data.grade = grade ? String(grade).trim() : null;
    if (academicYear !== undefined) data.academicYear = String(academicYear).trim();
    if (term !== undefined) data.term = String(term).trim();
    if (headTeacherId !== undefined) {
      if (headTeacherId) {
        const ht = await prisma.user.findUnique({ where: { id: headTeacherId } });
        if (!ht || (ht.role !== "TEACHER" && ht.role !== "ADMIN"))
          return fail(res, 400, "班主任必须是教师或管理员");
      }
      data.headTeacherId = headTeacherId || null;
    }
    const updated = await prisma.class.update({ where: { id }, data });
    ok(res, { class: updated }, "更新成功");
  })
);

// PUT /api/academics/classes/:id/head-teacher —— 管理员/教务老师:设置或移除班主任
// 专用接口(最小权限):仅开放「设置班主任」这一动作给教务老师,不连带放开班级 CRUD/删除。
router.put(
  "/classes/:id/head-teacher",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!canSetHomeroom(req.user)) return fail(res, 403, "仅管理员或教务老师可设置班主任");
    const id = req.params.id;
    const cls = await prisma.class.findUnique({ where: { id } });
    if (!cls) return fail(res, 404, "班级不存在");
    const { headTeacherId } = req.body || {};
    if (headTeacherId) {
      const ht = await prisma.user.findUnique({ where: { id: headTeacherId } });
      if (!ht || (ht.role !== "TEACHER" && ht.role !== "ADMIN"))
        return fail(res, 400, "班主任必须是教师或管理员");
    }
    const updated = await prisma.class.update({
      where: { id },
      data: { headTeacherId: headTeacherId || null },
    });
    ok(res, { class: { id: updated.id, headTeacherId: updated.headTeacherId } }, headTeacherId ? "已设置班主任" : "已移除班主任");
  })
);

// DELETE /api/academics/classes/:id —— 教师/管理员(作用域):删除班级(级联由 Prisma 处理)
router.delete(
  "/classes/:id",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!(await canManageClass(req, id))) return fail(res, 403, "无权管理该班级");
    const cls = await prisma.class.findUnique({ where: { id } });
    if (!cls) return fail(res, 404, "班级不存在");
    await prisma.class.delete({ where: { id } });
    ok(res, { id }, "已删除");
  })
);

// ============================================================
// 班级科目教师 ClassSubjectTeacher
// ============================================================

// GET /api/academics/classes/:id/teachers —— 列出班级科目教师
router.get(
  "/classes/:id/teachers",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const ids = await visibleClassIds(req);
    if (ids.length && !ids.includes(id)) return fail(res, 403, "无权访问该班级");
    const list = await prisma.classSubjectTeacher.findMany({
      where: { classId: id },
      include: { teacher: { select: { id: true, name: true } } },
    });
    ok(res, {
      teachers: list.map((st) => ({
        id: st.id,
        subject: st.subject,
        role: st.role,
        teacher: st.teacher,
      })),
    });
  })
);

// POST /api/academics/classes/:id/teachers —— 教师/管理员(作用域):添加科目教师
router.post(
  "/classes/:id/teachers",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!isAcademicAdmin(req.user) && !(await canManageClass(req, id))) return fail(res, 403, "无权管理该班级任课教师");
    const { subject, teacherId, role } = req.body || {};
    if (!subject || !String(subject).trim()) return fail(res, 400, "科目必填");
    if (!teacherId) return fail(res, 400, "教师必填");
    const t = await prisma.user.findUnique({ where: { id: teacherId } });
    if (!t || (t.role !== "TEACHER" && t.role !== "ADMIN"))
      return fail(res, 400, "教师不存在或角色不符");
    const link = await prisma.classSubjectTeacher.create({
      data: {
        classId: id,
        subject: String(subject).trim(),
        teacherId,
        role: role && String(role).trim() ? String(role).trim() : "LEAD",
      },
      include: { teacher: { select: { id: true, name: true } } },
    });
    ok(res, { teacher: { id: link.id, subject: link.subject, role: link.role, teacher: link.teacher } }, "已添加");
  })
);

// DELETE /api/academics/classes/:id/teachers/:linkId —— 教师/管理员(作用域):移除科目教师
router.delete(
  "/classes/:id/teachers/:linkId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id, linkId } = req.params;
    if (!isAcademicAdmin(req.user) && !(await canManageClass(req, id))) return fail(res, 403, "无权管理该班级任课教师");
    const link = await prisma.classSubjectTeacher.findUnique({ where: { id: linkId } });
    if (!link || link.classId !== id) return fail(res, 404, "任教记录不存在");
    await prisma.classSubjectTeacher.delete({ where: { id: linkId } });
    ok(res, { id: linkId }, "已移除");
  })
);

// ============================================================
// 班级成员 ClassMembership
// ============================================================

// GET /api/academics/classes/:id/students —— 列出班级学生
router.get(
  "/classes/:id/students",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const ids = await visibleClassIds(req);
    if (ids.length && !ids.includes(id)) return fail(res, 403, "无权访问该班级");
    const list = await prisma.classMembership.findMany({
      where: { classId: id },
      include: { student: { select: { id: true, name: true, studentNo: true } } },
    });
    ok(res, { students: list.map((m) => m.student) });
  })
);

// POST /api/academics/classes/:id/students —— 教师/管理员(作用域):添加学生(支持批量 studentIds)
router.post(
  "/classes/:id/students",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!(await canManageClass(req, id))) return fail(res, 403, "无权管理该班级");
    const cls = await prisma.class.findUnique({ where: { id } });
    if (!cls) return fail(res, 404, "班级不存在");
    const { studentId, studentIds } = req.body || {};
    let arr = [];
    if (Array.isArray(studentIds)) arr = studentIds.map((s) => String(s).trim()).filter(Boolean);
    else if (studentId) arr = [String(studentId).trim()];
    if (!arr.length) return fail(res, 400, "请提供至少一个学生");
    arr = [...new Set(arr)];
    // 仅纳入已审核学生
    const users = await prisma.user.findMany({
      where: { id: { in: arr }, role: "STUDENT", status: "APPROVED" },
      select: { id: true },
    });
    const validIds = new Set(users.map((u) => u.id));
    const skipped = arr.filter((x) => !validIds.has(x));
    const existing = await prisma.classMembership.findMany({
      where: { classId: id, studentId: { in: arr } },
      select: { studentId: true },
    });
    const existIds = new Set(existing.map((e) => e.studentId));
    const toAdd = arr.filter((x) => validIds.has(x) && !existIds.has(x));
    if (toAdd.length) {
      await prisma.classMembership.createMany({
        data: toAdd.map((sid) => ({ classId: id, studentId: sid })),
      });
    }
    ok(res, { added: toAdd.length, skipped: skipped.length, alreadyMember: existIds.size }, "添加完成");
  })
);

// DELETE /api/academics/classes/:id/students/:studentId —— 教师/管理员(作用域):移除学生
router.delete(
  "/classes/:id/students/:studentId",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const { id, studentId } = req.params;
    if (!(await canManageClass(req, id))) return fail(res, 403, "无权管理该班级");
    const m = await prisma.classMembership.findUnique({
      where: { classId_studentId: { classId: id, studentId } },
    });
    if (!m) return fail(res, 404, "该生不在本班");
    await prisma.classMembership.delete({ where: { id: m.id } });
    ok(res, { studentId }, "已移除");
  })
);

// ============================================================
// 考试 Exam
// ============================================================

// GET /api/academics/exams —— 列出考试(可按 classId / subject 过滤;作用域受限)
router.get(
  "/exams",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { classId, subject } = req.query;
    const ids = await visibleClassIds(req);
    const where = {};
    if (classId) {
      if (ids.length && !ids.includes(String(classId)))
        return fail(res, 403, "无权访问该班级");
      where.classId = String(classId);
    } else if (ids.length) {
      where.classId = { in: ids };
    }
    if (subject) where.subject = String(subject);
    const exams = await prisma.exam.findMany({
      where,
      orderBy: { examDate: "desc" },
      include: { class: { select: { id: true, name: true } }, creator: { select: { id: true, name: true } } },
    });
    // 学科老师(非班主任)按「本人任教科目」作用域过滤;班主任/管理员看全部
    if (req.user.role === "TEACHER") {
      const scope = await buildTeacherScope(req);
      exams = exams.filter((e) => {
        const subs = scope.classSubjects[e.classId];
        return subs === null || (subs && subs.includes(e.subject));
      });
    }
    ok(res, {
      exams: exams.map((e) => ({
        id: e.id,
        classId: e.classId,
        className: e.class.name,
        subject: e.subject,
        title: e.title,
        type: e.type,
        examDate: e.examDate,
        totalScore: e.totalScore,
        creator: e.creator,
      })),
    });
  })
);

// POST /api/academics/exams —— 教师/管理员(任教该班该科目):创建考试
router.post(
  "/exams",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { classId, subject, title, type, examDate, totalScore } = req.body || {};
    if (!classId) return fail(res, 400, "班级必填");
    if (!subject || !String(subject).trim()) return fail(res, 400, "科目必填");
    if (!title || !String(title).trim()) return fail(res, 400, "考试名称必填");
    if (!examDate) return fail(res, 400, "考试日期必填");
    if (!(await canTeachSubject(req, classId, String(subject).trim())))
      return fail(res, 403, "无权为该班该科目录入考试");
    const cls = await prisma.class.findUnique({ where: { id: classId } });
    if (!cls) return fail(res, 404, "班级不存在");
    const exam = await prisma.exam.create({
      data: {
        classId,
        subject: String(subject).trim(),
        title: String(title).trim(),
        type: type && String(type).trim() ? String(type).trim() : "DAILY",
        examDate: new Date(examDate),
        totalScore: totalScore != null ? Number(totalScore) : 100,
        createdBy: req.user.id,
      },
    });
    ok(res, { exam }, "创建成功");
  })
);

// GET /api/academics/exams/:id —— 考试详情 + 成绩列表(教师视角:全部成绩)
router.get(
  "/exams/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const exam = await prisma.exam.findUnique({
      where: { id },
      include: { class: { select: { id: true, name: true } } },
    });
    if (!exam) return fail(res, 404, "考试不存在");
    // 学生/家长不得访问该教师视图(其成绩通过 /me/records 与 /children/:id/records 获取)
    if (req.user.role === "STUDENT" || req.user.role === "PARENT")
      return fail(res, 403, "无权限访问该视图");
    const ids = await visibleClassIds(req);
    if (ids.length && !ids.includes(exam.classId))
      return fail(res, 403, "无权访问该考试");
    // 学科老师(非班主任)只能查看本人任教科目的考试
    if (req.user.role === "TEACHER") {
      const subs = await visibleSubjects(req, exam.classId);
      if (subs !== null && !subs.includes(exam.subject))
        return fail(res, 403, "无权查看该科目考试");
    }
    const scores = await prisma.score.findMany({
      where: { examId: id },
      include: { student: { select: { id: true, name: true, studentNo: true } } },
      orderBy: { score: "desc" },
    });
    ok(res, {
      exam: {
        id: exam.id,
        classId: exam.classId,
        className: exam.class.name,
        subject: exam.subject,
        title: exam.title,
        type: exam.type,
        examDate: exam.examDate,
        totalScore: exam.totalScore,
      },
      scores: scores.map((s) => ({
        id: s.id,
        studentId: s.studentId,
        student: s.student,
        score: s.score,
        rankInClass: s.rankInClass,
        comment: s.comment,
        updatedAt: s.updatedAt,
      })),
    });
  })
);

// PUT /api/academics/exams/:id —— 教师/管理员(任教该班该科目):更新考试
router.put(
  "/exams/:id",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const exam = await prisma.exam.findUnique({ where: { id } });
    if (!exam) return fail(res, 404, "考试不存在");
    if (!(await canTeachSubject(req, exam.classId, exam.subject)))
      return fail(res, 403, "无权修改该考试");
    const { title, type, examDate, totalScore } = req.body || {};
    const data = {};
    if (title !== undefined) data.title = String(title).trim();
    if (type !== undefined) data.type = String(type).trim();
    if (examDate !== undefined) data.examDate = new Date(examDate);
    if (totalScore !== undefined) data.totalScore = Number(totalScore);
    const updated = await prisma.exam.update({ where: { id }, data });
    ok(res, { exam: updated }, "更新成功");
  })
);

// DELETE /api/academics/exams/:id —— 教师/管理员(任教该班该科目):删除考试(级联成绩)
router.delete(
  "/exams/:id",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const exam = await prisma.exam.findUnique({ where: { id } });
    if (!exam) return fail(res, 404, "考试不存在");
    if (!(await canTeachSubject(req, exam.classId, exam.subject)))
      return fail(res, 403, "无权删除该考试");
    await prisma.exam.delete({ where: { id } });
    ok(res, { id }, "已删除");
  })
);

// ============================================================
// 成绩 Score
// ============================================================

// PUT /api/academics/exams/:id/scores —— 教师/管理员(任教该班该科目):批量录入/更新成绩
// body: { scores: [{ studentId, score, rankInClass?, comment? }] }
router.put(
  "/exams/:id/scores",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const exam = await prisma.exam.findUnique({ where: { id } });
    if (!exam) return fail(res, 404, "考试不存在");
    if (!(await canTeachSubject(req, exam.classId, exam.subject)))
      return fail(res, 403, "无权为该考试录分");
    const list = req.body && req.body.scores;
    if (!Array.isArray(list) || list.length === 0)
      return fail(res, 400, "scores 不能为空");
    // 校验每个学生都是本班成员,防止越权录入
    const members = await prisma.classMembership.findMany({
      where: { classId: exam.classId },
      select: { studentId: true },
    });
    const memberSet = new Set(members.map((m) => m.studentId));
    const invalid = list.filter((s) => !s || !s.studentId || !memberSet.has(String(s.studentId)));
    if (invalid.length)
      return fail(res, 400, "存在非本班学生的成绩记录,已拒绝整批写入");
    let upserted = 0;
    for (const s of list) {
      const studentId = String(s.studentId);
      await prisma.score.upsert({
        where: { examId_studentId: { examId: id, studentId } },
        create: {
          examId: id,
          studentId,
          score: Number(s.score),
          rankInClass: s.rankInClass != null ? Number(s.rankInClass) : null,
          comment: s.comment != null ? String(s.comment) : null,
          updatedBy: req.user.id,
        },
        update: {
          score: Number(s.score),
          rankInClass: s.rankInClass != null ? Number(s.rankInClass) : null,
          comment: s.comment != null ? String(s.comment) : null,
          updatedBy: req.user.id,
        },
      });
      upserted++;
    }
    ok(res, { upserted }, "成绩已保存");
  })
);

// ============================================================
// 教师反馈 TeacherFeedback
// ============================================================

// GET /api/academics/feedbacks
//   教师/管理员:可按 studentId / status 过滤(看全部)。
//   学生:仅本人 STUDENT|BOTH 且 PUBLISHED。
//   家长:仅关联孩子 PARENT|BOTH 且 PUBLISHED。
router.get(
  "/feedbacks",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { studentId, status, childId } = req.query;
    if (req.user.role === "TEACHER" || req.user.role === "ADMIN") {
      const where = {};
      if (studentId) where.studentId = String(studentId);
      if (status) where.status = String(status);
      let list = await prisma.teacherFeedback.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: {
          student: { select: { id: true, name: true, studentNo: true } },
          teacher: { select: { id: true, name: true } },
          exam: { select: { id: true, title: true } },
        },
      });
      // 学科老师(非班主任)仅看本人任教科目 / 本班(班主任)的反馈
      if (req.user.role === "TEACHER") {
        const scope = await buildTeacherScope(req);
        const stuIds = [...new Set(list.map((f) => f.studentId))];
        const memberships = stuIds.length
          ? await prisma.classMembership.findMany({
              where: { studentId: { in: stuIds } },
              select: { studentId: true, classId: true },
            })
          : [];
        const classesByStu = {};
        memberships.forEach((m) => {
          (classesByStu[m.studentId] = classesByStu[m.studentId] || []).push(m.classId);
        });
        list = list.filter((f) => {
          const cids = classesByStu[f.studentId] || [];
          return cids.some((cid) => {
            const subs = scope.classSubjects[cid];
            if (subs === null) return true; // 班主任:可见该生全部反馈
            return !!f.subject && subs.includes(f.subject);
          });
        });
      }
      return ok(res, { feedbacks: list });
    }
    if (req.user.role === "STUDENT") {
      const list = await prisma.teacherFeedback.findMany({
        where: {
          studentId: req.user.id,
          status: "PUBLISHED",
          visibility: { in: ["STUDENT", "BOTH"] },
        },
        orderBy: { createdAt: "desc" },
        include: { teacher: { select: { id: true, name: true } } },
      });
      return ok(res, { feedbacks: list });
    }
    if (req.user.role === "PARENT") {
      const links = await prisma.parentLink.findMany({
        where: { parentUserId: req.user.id, status: "VERIFIED" },
        select: { studentUserId: true },
      });
      const childIds = links.map((l) => l.studentUserId);
      if (!childIds.length) return ok(res, { feedbacks: [] });
      const target = childId ? String(childId) : null;
      if (target && !childIds.includes(target)) return fail(res, 403, "无权查看该学生反馈");
      const list = await prisma.teacherFeedback.findMany({
        where: {
          studentId: target || { in: childIds },
          status: "PUBLISHED",
          visibility: { in: ["PARENT", "BOTH"] },
        },
        orderBy: { createdAt: "desc" },
        include: { teacher: { select: { id: true, name: true } } },
      });
      return ok(res, { feedbacks: list });
    }
    return fail(res, 403, "无权限");
  })
);

// POST /api/academics/feedbacks —— 教师/管理员:新建反馈(支持 DRAFT 草稿态)
router.post(
  "/feedbacks",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { studentId, subject, examId, content, visibility, status } = req.body || {};
    if (!studentId) return fail(res, 400, "学生必填");
    if (!content || !String(content).trim()) return fail(res, 400, "反馈内容必填");
    const stu = await prisma.user.findUnique({ where: { id: studentId } });
    if (!stu || stu.role !== "STUDENT") return fail(res, 400, "学生不存在");
    // 学科老师只能为自己任教班级内的学生提交反馈(班主任可对其班内任意学生)
    if (req.user.role === "TEACHER") {
      const cids = await studentClassIds(studentId);
      let allowed = false;
      for (const cid of cids) {
        const subs = await visibleSubjects(req, cid);
        if (subs === null) { allowed = true; break; }
        if (subject && subs.includes(String(subject))) { allowed = true; break; }
      }
      if (!allowed) return fail(res, 403, "只能为自己任教班级内的学生提交反馈");
    }
    if (examId) {
      const ex = await prisma.exam.findUnique({ where: { id: examId } });
      if (!ex) return fail(res, 400, "关联考试不存在");
    }
    const fb = await prisma.teacherFeedback.create({
      data: {
        studentId,
        teacherId: req.user.id,
        subject: subject ? String(subject).trim() : null,
        examId: examId || null,
        content: String(content).trim(),
        visibility: visibility && ["STUDENT", "PARENT", "BOTH"].includes(String(visibility)) ? String(visibility) : "BOTH",
        status: status && ["DRAFT", "PUBLISHED"].includes(String(status)) ? String(status) : "PUBLISHED",
      },
    });
    ok(res, { feedback: fb }, "已创建");
  })
);

// PUT /api/academics/feedbacks/:id —— 教师/管理员:修改反馈(仅本人所写或 ADMIN)
router.put(
  "/feedbacks/:id",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const fb = await prisma.teacherFeedback.findUnique({ where: { id } });
    if (!fb) return fail(res, 404, "反馈不存在");
    if (req.user.role !== "ADMIN" && fb.teacherId !== req.user.id)
      return fail(res, 403, "只能修改本人撰写的反馈");
    const { subject, examId, content, visibility, status } = req.body || {};
    const data = {};
    if (subject !== undefined) data.subject = subject ? String(subject).trim() : null;
    if (examId !== undefined) data.examId = examId || null;
    if (content !== undefined) data.content = String(content).trim();
    if (visibility !== undefined && ["STUDENT", "PARENT", "BOTH"].includes(String(visibility)))
      data.visibility = String(visibility);
    if (status !== undefined && ["DRAFT", "PUBLISHED"].includes(String(status)))
      data.status = String(status);
    const updated = await prisma.teacherFeedback.update({ where: { id }, data });
    ok(res, { feedback: updated }, "已更新");
  })
);

// POST /api/academics/feedbacks/:id/publish —— 教师/管理员:草稿发布
router.post(
  "/feedbacks/:id/publish",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const fb = await prisma.teacherFeedback.findUnique({ where: { id } });
    if (!fb) return fail(res, 404, "反馈不存在");
    if (req.user.role !== "ADMIN" && fb.teacherId !== req.user.id)
      return fail(res, 403, "只能发布本人撰写的反馈");
    const updated = await prisma.teacherFeedback.update({
      where: { id },
      data: { status: "PUBLISHED" },
    });
    ok(res, { feedback: updated }, "已发布");
  })
);

// DELETE /api/academics/feedbacks/:id —— 教师/管理员:删除反馈
router.delete(
  "/feedbacks/:id",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const fb = await prisma.teacherFeedback.findUnique({ where: { id } });
    if (!fb) return fail(res, 404, "反馈不存在");
    if (req.user.role !== "ADMIN" && fb.teacherId !== req.user.id)
      return fail(res, 403, "只能删除本人撰写的反馈");
    await prisma.teacherFeedback.delete({ where: { id } });
    ok(res, { id }, "已删除");
  })
);

// ============================================================
// 课程表 TimetableEntry
// ============================================================

// GET /api/academics/timetable —— 列出课表(按 classId 过滤;作用域受限)
router.get(
  "/timetable",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { classId, academicYear, term } = req.query;
    const ids = await visibleClassIds(req);
    const where = {};
    if (classId) {
      if (ids.length && !ids.includes(String(classId)))
        return fail(res, 403, "无权访问该班级");
      where.classId = String(classId);
    } else if (ids.length) {
      where.classId = { in: ids };
    }
    if (academicYear) where.academicYear = String(academicYear);
    if (term) where.term = String(term);
    const list = await prisma.timetableEntry.findMany({
      where,
      orderBy: [{ dayOfWeek: "asc" }, { period: "asc" }],
      include: { teacher: { select: { id: true, name: true } } },
    });
    ok(res, {
      entries: list.map((e) => ({
        id: e.id,
        classId: e.classId,
        dayOfWeek: e.dayOfWeek,
        period: e.period,
        periodLabel: e.periodLabel,
        periodTime: e.periodTime,
        subject: e.subject,
        teacherId: e.teacherId,
        teacher: e.teacher,
        room: e.room,
        academicYear: e.academicYear,
        term: e.term,
      })),
    });
  })
);

// POST /api/academics/timetable —— 教师/管理员(任教该班):新增课表条目
router.post(
  "/timetable",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const { classId, dayOfWeek, period, subject, teacherId, room, academicYear, term } = req.body || {};
    if (!classId) return fail(res, 400, "班级必填");
    if (!subject || !String(subject).trim()) return fail(res, 400, "科目必填");
    if (!academicYear || !String(academicYear).trim()) return fail(res, 400, "学年必填");
    if (!term || !String(term).trim()) return fail(res, 400, "学期必填");
    if (!(await canManageClass(req, classId))) return fail(res, 403, "无权管理该班级课表");
    if (dayOfWeek == null || period == null) return fail(res, 400, "星期与节次必填");
    if (teacherId) {
      const t = await prisma.user.findUnique({ where: { id: teacherId } });
      if (!t || (t.role !== "TEACHER" && t.role !== "ADMIN"))
        return fail(res, 400, "教师不存在或角色不符");
    }
    // 同一 slot 允许多门课程并存(选课走班),只挡「同科目 + 同教师」的完全重复;
    // 唯一键含 teacherId,而 teacherId 为 NULL 时 SQLite 不参与唯一性判断,故这里显式查一次。
    const dup = await prisma.timetableEntry.findFirst({
      where: {
        classId,
        dayOfWeek: Number(dayOfWeek),
        period: Number(period),
        subject: String(subject).trim(),
        teacherId: teacherId || null,
        academicYear: String(academicYear).trim(),
        term: String(term).trim(),
      },
    });
    if (dup) return fail(res, 409, "该时段已有同一门课程(同科目同教师)");
    try {
      const e = await prisma.timetableEntry.create({
        data: {
          classId,
          dayOfWeek: Number(dayOfWeek),
          period: Number(period),
          subject: String(subject).trim(),
          teacherId: teacherId || null,
          room: room ? String(room).trim() : null,
          academicYear: String(academicYear).trim(),
          term: String(term).trim(),
        },
      });
      ok(res, { entry: e }, "已添加");
    } catch (err) {
      if (err && err.code === "P2002")
        return fail(res, 409, "该时段已有同一门课程(同科目同教师)");
      throw err;
    }
  })
);

// PUT /api/academics/timetable/:id —— 教师/管理员(任教该班):更新课表条目
router.put(
  "/timetable/:id",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const e = await prisma.timetableEntry.findUnique({ where: { id } });
    if (!e) return fail(res, 404, "课表条目不存在");
    if (!(await canManageClass(req, e.classId))) return fail(res, 403, "无权管理该班级课表");
    const { dayOfWeek, period, subject, teacherId, room } = req.body || {};
    const data = {};
    if (dayOfWeek !== undefined) data.dayOfWeek = Number(dayOfWeek);
    if (period !== undefined) data.period = Number(period);
    if (subject !== undefined) data.subject = String(subject).trim();
    if (teacherId !== undefined) data.teacherId = teacherId || null;
    if (room !== undefined) data.room = room ? String(room).trim() : null;
    try {
      const updated = await prisma.timetableEntry.update({ where: { id }, data });
      ok(res, { entry: updated }, "已更新");
    } catch (err) {
      if (err && err.code === "P2002")
        return fail(res, 409, "该班级在该星期/节次/学年/学期下已有排课");
      throw err;
    }
  })
);

// DELETE /api/academics/timetable/:id —— 教师/管理员(任教该班):删除课表条目
router.delete(
  "/timetable/:id",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const e = await prisma.timetableEntry.findUnique({ where: { id } });
    if (!e) return fail(res, 404, "课表条目不存在");
    if (!(await canManageClass(req, e.classId))) return fail(res, 403, "无权管理该班级课表");
    await prisma.timetableEntry.delete({ where: { id } });
    ok(res, { id }, "已删除");
  })
);

// ============================================================
// 家长关联 ParentLink(审批)
// ============================================================

// GET /api/academics/parent-links
//   教师/管理员:列出 PENDING(待审批)链接(可按 studentId 过滤),供班主任审批。
//   家长:列出本人所有关联(含状态)。
router.get(
  "/parent-links",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { status, studentId } = req.query;
    if (req.user.role === "TEACHER" || req.user.role === "ADMIN") {
      const where = {};
      if (status) where.status = String(status);
      else where.status = "PENDING";
      if (studentId) where.studentUserId = String(studentId);
      const list = await prisma.parentLink.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: {
          parent: { select: { id: true, name: true } },
          student: { select: { id: true, name: true, studentNo: true } },
        },
      });
      return ok(res, { links: list });
    }
    if (req.user.role === "PARENT") {
      const list = await prisma.parentLink.findMany({
        where: { parentUserId: req.user.id },
        include: { student: { select: { id: true, name: true, studentNo: true } } },
      });
      return ok(res, { links: list });
    }
    return fail(res, 403, "无权限");
  })
);

// POST /api/academics/parent-links/:id/approve —— 教师/管理员:审批通过(PENDING -> VERIFIED)
router.post(
  "/parent-links/:id/approve",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const link = await prisma.parentLink.findUnique({ where: { id } });
    if (!link) return fail(res, 404, "关联申请不存在");
    const updated = await prisma.parentLink.update({
      where: { id },
      data: { status: "VERIFIED", matchMethod: link.matchMethod || "MANUAL", verifiedAt: new Date() },
    });
    ok(res, { link: updated }, "已通过");
  })
);

// POST /api/academics/parent-links/:id/reject —— 教师/管理员:驳回/解除(VERIFIED -> REVOKED)
router.post(
  "/parent-links/:id/reject",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const link = await prisma.parentLink.findUnique({ where: { id } });
    if (!link) return fail(res, 404, "关联申请不存在");
    const updated = await prisma.parentLink.update({
      where: { id },
      data: { status: "REVOKED" },
    });
    ok(res, { link: updated }, "已驳回/解除");
  })
);

// ============================================================
// 学生 / 家长 聚合视图(只读)
// ============================================================

// 构造学生的教务档案(班级 + 考试/成绩 + 反馈 + 课表)
// 课表按选课结果过滤(学生/家长视角):
//   - 某班该学期无课程目录 → 全显(向后兼容)
//   - 有目录但学生未提交选课 → 全显(便于选择)
//   - 有目录且已提交 → 仅显示 必修(REQUIRED) + 学生已勾选的选修(ELECTIVE)
async function filterTimetableBySelection(timetable, studentId) {
  if (!timetable || !timetable.length) return timetable;
  const keySet = [];
  for (const t of timetable) {
    const k = `${t.classId}|${t.academicYear}|${t.term}`;
    if (!keySet.includes(k)) keySet.push(k);
  }
  const keyCond = keySet.map((k) => {
    const [classId, academicYear, term] = k.split("|");
    return { classId, academicYear, term };
  });
  const courses = await prisma.course.findMany({ where: { OR: keyCond } });
  if (!courses.length) return timetable; // 无任何目录 → 全显
  const selections = await prisma.studentCourseSelection.findMany({
    where: { studentId, OR: keyCond },
  });
  const selByKey = {};
  for (const s of selections) selByKey[`${s.classId}|${s.academicYear}|${s.term}`] = s;
  const coursesByKey = {};
  for (const c of courses) {
    const k = `${c.classId}|${c.academicYear}|${c.term}`;
    (coursesByKey[k] = coursesByKey[k] || []).push(c);
  }
  return timetable.filter((t) => {
    const k = `${t.classId}|${t.academicYear}|${t.term}`;
    const cc = coursesByKey[k];
    if (!cc || !cc.length) return true; // 该班该学期无目录
    const sel = selByKey[k];
    if (!sel || !sel.submittedAt) return true; // 未提交 → 全显(便于选择)
    const required = cc.filter((c) => c.type === "REQUIRED").map((c) => c.name);
    let selected = [];
    try {
      selected = JSON.parse(sel.selectedCourseIds || "[]");
    } catch {
      selected = [];
    }
    if (!Array.isArray(selected)) selected = [];
    const allowed = new Set([...required, ...selected]);
    return allowed.has(t.subject);
  });
}

async function buildStudentRecords(studentId, { forParent = false } = {}) {
  const memberships = await prisma.classMembership.findMany({
    where: { studentId },
    include: { class: { select: { id: true, name: true, grade: true, academicYear: true, term: true } } },
  });
  const classIds = memberships.map((m) => m.classId);

  // 考试 + 本人成绩
  const exams = await prisma.exam.findMany({
    where: { classId: { in: classIds } },
    orderBy: { examDate: "desc" },
    include: { class: { select: { id: true, name: true } } },
  });
  const examIds = exams.map((e) => e.id);
  const scores = await prisma.score.findMany({
    where: { examId: { in: examIds }, studentId },
  });
  const scoreByExam = Object.fromEntries(scores.map((s) => [s.examId, s]));

  // 反馈(按视角过滤可见性)
  const fbWhere = { studentId, status: "PUBLISHED" };
  if (forParent) fbWhere.visibility = { in: ["PARENT", "BOTH"] };
  else fbWhere.visibility = { in: ["STUDENT", "BOTH"] };
  const feedbacks = await prisma.teacherFeedback.findMany({
    where: fbWhere,
    orderBy: { createdAt: "desc" },
    include: { teacher: { select: { id: true, name: true } } },
  });

  // 课表(所属全部班级)
  const timetableRaw = await prisma.timetableEntry.findMany({
    where: { classId: { in: classIds } },
    orderBy: [{ dayOfWeek: "asc" }, { period: "asc" }],
    include: { teacher: { select: { id: true, name: true } } },
  });
  // 选课过滤:仅学生/家长视角生效(教师端走各自独立接口,不过滤)
  const timetable = await filterTimetableBySelection(timetableRaw, studentId);

  // 已选课程(依据选课情况):REQUIRED 必修 + 已勾选 ELECTIVE 选修;无目录班级回退到考试科目/课表科目
  const courseKeys = memberships.map((m) => ({
    classId: m.classId,
    academicYear: m.class.academicYear,
    term: m.class.term,
  }));
  const catalog = await prisma.course.findMany({ where: { OR: courseKeys } });
  const selMap = {};
  const sels = await prisma.studentCourseSelection.findMany({ where: { studentId, OR: courseKeys } });
  for (const s of sels) selMap[`${s.classId}|${s.academicYear}|${s.term}`] = s;
  const catByKey = {};
  for (const c of catalog) {
    const k = `${c.classId}|${c.academicYear}|${c.term}`;
    (catByKey[k] = catByKey[k] || []).push(c);
  }
  const courseSet = new Map();
  for (const m of memberships) {
    const k = `${m.classId}|${m.class.academicYear}|${m.class.term}`;
    const cc = catByKey[k] || [];
    if (!cc.length) {
      const subj = new Set();
      exams.filter((e) => e.classId === m.classId).forEach((e) => subj.add(e.subject));
      timetableRaw.filter((t) => t.classId === m.classId).forEach((t) => subj.add(t.subject));
      subj.forEach((s) => courseSet.set(s, { name: s, type: "UNKNOWN" }));
    } else {
      const sel = selMap[k];
      const required = cc.filter((c) => c.type === "REQUIRED").map((c) => c.name);
      let names;
      if (sel && sel.submittedAt) {
        let selected = [];
        try { selected = JSON.parse(sel.selectedCourseIds || "[]"); } catch { selected = []; }
        if (!Array.isArray(selected)) selected = [];
        names = [...required, ...selected];
      } else {
        names = cc.map((c) => c.name); // 未提交选课 → 显示全部可选课程
      }
      names.forEach((n) => courseSet.set(n, { name: n, type: required.includes(n) ? "REQUIRED" : "ELECTIVE" }));
    }
  }
  const courses = [...courseSet.values()];

  // 作业情况:学生本人分发记录 + 作业元信息 + 科目(学科卷取 paper.subject,语言卷回退 examType skill)
  const assignmentStudents = await prisma.assignmentStudent.findMany({
    where: { studentId },
    include: {
      assignment: {
        include: {
          paper: { select: { subject: true, title: true } },
          languagePaper: { select: { examType: true, skill: true, title: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  const now = new Date();
  const assignments = assignmentStudents.map((as) => {
    const a = as.assignment;
    let subject = a.paper?.subject || null;
    if (!subject && a.languagePaper) subject = `${a.languagePaper.examType} ${a.languagePaper.skill}`;
    let status = as.status;
    if (status === "PENDING" && a.dueAt && new Date(a.dueAt) < now) status = "EXPIRED";
    return {
      id: as.id,
      title: a.title || a.paper?.title || a.languagePaper?.title || "作业",
      subject,
      dueAt: a.dueAt,
      status, // PENDING | SUBMITTED | EXPIRED(按 dueAt 计算)
      submittedAt: as.submittedAt,
      lateSubmit: as.lateSubmit,
      note: a.note || null,
    };
  });

  return {
    classes: memberships.map((m) => m.class),
    exams: exams.map((e) => ({
      id: e.id,
      className: e.class.name,
      classId: e.classId,
      subject: e.subject,
      title: e.title,
      type: e.type,
      examDate: e.examDate,
      totalScore: e.totalScore,
      score: scoreByExam[e.id]
        ? {
            score: scoreByExam[e.id].score,
            rankInClass: scoreByExam[e.id].rankInClass,
            comment: scoreByExam[e.id].comment,
          }
        : null,
    })),
    feedbacks,
    courses,
    assignments,
    timetable: timetable.map((t) => ({
      id: t.id,
      classId: t.classId,
      dayOfWeek: t.dayOfWeek,
      period: t.period,
      periodLabel: t.periodLabel,
      periodTime: t.periodTime,
      subject: t.subject,
      teacher: t.teacher,
      room: t.room,
      academicYear: t.academicYear,
      term: t.term,
    })),
  };
}

// GET /api/academics/me/records —— 学生:本人教务档案
router.get(
  "/me/records",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user.role !== "STUDENT") return fail(res, 403, "仅学生可访问");
    const records = await buildStudentRecords(req.user.id, { forParent: false });
    ok(res, { records });
  })
);

// GET /api/academics/children —— 家长:已关联(VERIFIED)的孩子列表
router.get(
  "/children",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user.role !== "PARENT") return fail(res, 403, "仅家长可访问");
    const links = await prisma.parentLink.findMany({
      where: { parentUserId: req.user.id, status: "VERIFIED" },
      include: { student: { select: { id: true, name: true, studentNo: true } } },
    });
    ok(res, { children: links.map((l) => ({ ...l.student, relation: l.relation })) });
  })
);

// GET /api/academics/children/:studentId/records —— 家长:某孩子的教务档案 + 升学规划(若 parentVisible)
router.get(
  "/children/:studentId/records",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user.role !== "PARENT") return fail(res, 403, "仅家长可访问");
    const studentId = req.params.studentId;
    const link = await prisma.parentLink.findUnique({
      where: { parentUserId_studentUserId: { parentUserId: req.user.id, studentUserId: studentId } },
    });
    if (!link || link.status !== "VERIFIED") return fail(res, 403, "无权查看该学生档案");
    const records = await buildStudentRecords(studentId, { forParent: true });
    // 升学规划:仅当 parentVisible 时返回
    let planning = null;
    const prof = await prisma.planningProfile.findUnique({ where: { studentId } });
    if (prof && prof.parentVisible) {
      try {
        planning = JSON.parse(prof.data || "{}");
      } catch {
        planning = null;
      }
    }
    ok(res, { records, planningVisible: !!(prof && prof.parentVisible), planning });
  })
);

// ============================================================
// 学情统计 Analytics(所有角色可见,作用域严格受控)
// ============================================================

function round2(x) {
  return Math.round(x * 100) / 100;
}

// 由一组分数计算统计量(百分制分数段分布)
function computeExamStats(values, totalScore) {
  const n = values.length;
  if (n === 0)
    return { count: 0, mean: null, median: null, std: null, max: null, min: null, passRate: null, distribution: [] };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const mid = Math.floor(n / 2);
  const median = n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  const max = sorted[n - 1];
  const min = sorted[0];
  const pass = totalScore > 0 ? values.filter((v) => v / totalScore >= 0.6).length / n : null;
  const buckets = [
    ["0-59", 0, 60],
    ["60-69", 60, 70],
    ["70-79", 70, 80],
    ["80-89", 80, 90],
    ["90-100", 90, 101],
  ];
  const distribution =
    totalScore > 0
      ? buckets.map(([label, lo, hi]) => {
          const c = values.filter((v) => {
            const p = (v / totalScore) * 100;
            return p >= lo && p < hi;
          }).length;
          return { label, count: c, pct: round2((c / n) * 100) };
        })
      : [];
  return {
    count: n,
    mean: round2(mean),
    median: round2(median),
    std: round2(std),
    max,
    min,
    passRate: pass == null ? null : round2(pass * 100),
    distribution,
  };
}

// GET /api/academics/analytics/exam/:examId —— 单场考试学情(均值/中位数/标准差/及格率/分数段)
router.get(
  "/analytics/exam/:examId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const examId = req.params.examId;
    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      include: { class: { select: { id: true, name: true } } },
    });
    if (!exam) return fail(res, 404, "考试不存在");
    const role = req.user.role;
    // 作用域校验
    if (role === "STUDENT") {
      const cids = await studentClassIds(req.user.id);
      if (!cids.includes(exam.classId)) return fail(res, 403, "无权查看该考试");
    } else if (role === "PARENT") {
      const links = await prisma.parentLink.findMany({
        where: { parentUserId: req.user.id, status: "VERIFIED" },
        select: { studentUserId: true },
      });
      const childIds = links.map((l) => l.studentUserId);
      const cids = childIds.length
        ? await prisma.classMembership.findMany({ where: { studentId: { in: childIds } }, select: { classId: true } })
        : [];
      if (!cids.some((c) => c.classId === exam.classId)) return fail(res, 403, "无权查看该考试");
    } else if (role === "TEACHER") {
      const subs = await visibleSubjects(req, exam.classId);
      if (subs !== null && !subs.includes(exam.subject)) return fail(res, 403, "无权查看该科目考试");
    }
    const scores = await prisma.score.findMany({
      where: { examId },
      include: { student: { select: { id: true, name: true, studentNo: true } } },
      orderBy: { score: "desc" },
    });
    const values = scores.map((s) => s.score);
    const stats = computeExamStats(values, exam.totalScore);
    let view = scores;
    if (role === "STUDENT") view = scores.filter((s) => s.studentId === req.user.id);
    if (role === "PARENT") {
      const links = await prisma.parentLink.findMany({
        where: { parentUserId: req.user.id, status: "VERIFIED" },
        select: { studentUserId: true },
      });
      const childIds = links.map((l) => l.studentUserId);
      view = scores.filter((s) => childIds.includes(s.studentId));
    }
    ok(res, {
      exam: {
        id: exam.id,
        classId: exam.classId,
        className: exam.class.name,
        subject: exam.subject,
        title: exam.title,
        type: exam.type,
        examDate: exam.examDate,
        totalScore: exam.totalScore,
      },
      stats,
      scores: view.map((s) => ({
        studentId: s.studentId,
        name: s.student.name,
        studentNo: s.student.studentNo,
        score: s.score,
        rankInClass: s.rankInClass,
      })),
    });
  })
);

// GET /api/academics/analytics/class/:classId —— 班级各考试/各科目学情汇总
router.get(
  "/analytics/class/:classId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const classId = req.params.classId;
    const ids = await visibleClassIds(req);
    if (ids.length && !ids.includes(classId)) return fail(res, 403, "无权访问该班级");
    let allowedSubjects = null; // null = 全部(管理员/班主任)
    if (req.user.role === "TEACHER") allowedSubjects = await visibleSubjects(req, classId);
    const exams = await prisma.exam.findMany({ where: { classId }, orderBy: { examDate: "asc" } });
    const examIds = exams.map((e) => e.id);
    const allScores = examIds.length
      ? await prisma.score.findMany({ where: { examId: { in: examIds } }, select: { examId: true, score: true } })
      : [];
    const byExam = {};
    allScores.forEach((s) => {
      (byExam[s.examId] = byExam[s.examId] || []).push(s.score);
    });
    let perExam = exams.map((e) => {
      const vals = byExam[e.id] || [];
      return { id: e.id, subject: e.subject, title: e.title, examDate: e.examDate, totalScore: e.totalScore, ...computeExamStats(vals, e.totalScore) };
    });
    if (allowedSubjects !== null) perExam = perExam.filter((e) => allowedSubjects.includes(e.subject));
    const subjMap = {};
    perExam.forEach((e) => {
      const m = (subjMap[e.subject] = subjMap[e.subject] || { subject: e.subject, means: [], passRates: [], counts: [] });
      m.means.push(e.mean ?? 0);
      m.passRates.push(e.passRate ?? 0);
      m.counts.push(e.count);
    });
    const subjects = Object.values(subjMap).map((m) => ({
      subject: m.subject,
      examCount: m.means.length,
      avgMean: round2(m.means.reduce((s, v) => s + v, 0) / m.means.length),
      avgPassRate: round2(m.passRates.reduce((s, v) => s + v, 0) / m.passRates.length),
    }));
    ok(res, { classId, examCount: perExam.length, perExam, subjects });
  })
);

// GET /api/academics/analytics/student/:studentId —— 学生个人学情(各科趋势 + 班级对比)
router.get(
  "/analytics/student/:studentId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const studentId = req.params.studentId;
    const role = req.user.role;
    if (role === "STUDENT" && studentId !== req.user.id) return fail(res, 403, "无权限");
    if (role === "PARENT") {
      const links = await prisma.parentLink.findMany({
        where: { parentUserId: req.user.id, status: "VERIFIED" },
        select: { studentUserId: true },
      });
      if (!links.map((l) => l.studentUserId).includes(studentId)) return fail(res, 403, "无权限");
    }
    if (role === "TEACHER") {
      const cids = await studentClassIds(studentId);
      let allowed = false;
      for (const cid of cids) {
        const subs = await visibleSubjects(req, cid);
        if (subs === null || (subs && subs.length > 0)) {
          allowed = true;
          break;
        }
      }
      if (!allowed) return fail(res, 403, "无权限");
    }
    const stu = await prisma.user.findUnique({ where: { id: studentId }, select: { id: true, name: true, studentNo: true } });
    if (!stu) return fail(res, 404, "学生不存在");
    const cids = await studentClassIds(studentId);
    const exams = await prisma.exam.findMany({ where: { classId: { in: cids } }, orderBy: { examDate: "asc" } });
    const examIds = exams.map((e) => e.id);
    const myScores = examIds.length
      ? await prisma.score.findMany({ where: { examId: { in: examIds }, studentId } })
      : [];
    const scoreMap = Object.fromEntries(myScores.map((s) => [s.examId, s]));
    const allScores = examIds.length
      ? await prisma.score.findMany({ where: { examId: { in: examIds } }, select: { examId: true, score: true } })
      : [];
    const classByExam = {};
    allScores.forEach((s) => {
      (classByExam[s.examId] = classByExam[s.examId] || []).push(s.score);
    });
    let allowedSubjects = null;
    if (role === "TEACHER") {
      const set = new Set();
      for (const cid of cids) {
        const subs = await visibleSubjects(req, cid);
        if (subs !== null) subs.forEach((s) => set.add(s));
      }
      allowedSubjects = [...set];
    }
    const perSubject = {};
    exams.forEach((e) => {
      if (allowedSubjects && !allowedSubjects.includes(e.subject)) return;
      const sc = scoreMap[e.id];
      const clsVals = classByExam[e.id] || [];
      const clsMean = clsVals.length ? round2(clsVals.reduce((s, v) => s + v, 0) / clsVals.length) : null;
      perSubject[e.subject] = perSubject[e.subject] || { subject: e.subject, items: [] };
      perSubject[e.subject].items.push({
        examId: e.id,
        title: e.title,
        examDate: e.examDate,
        totalScore: e.totalScore,
        score: sc ? sc.score : null,
        rankInClass: sc ? sc.rankInClass : null,
        classMean: clsMean,
      });
    });
    const subjects = Object.values(perSubject).map((m) => {
      const vals = m.items.filter((i) => i.score != null).map((i) => i.score);
      const mean = vals.length ? round2(vals.reduce((s, v) => s + v, 0) / vals.length) : null;
      const latest = m.items[m.items.length - 1];
      const best = vals.length ? Math.max(...vals) : null;
      return {
        subject: m.subject,
        examCount: m.items.length,
        mean,
        best,
        latest: latest ? { score: latest.score, title: latest.title, examDate: latest.examDate } : null,
        items: m.items,
      };
    });
    const allVals = subjects.flatMap((s) => s.items.filter((i) => i.score != null).map((i) => i.score));
    const overall = {
      examCount: allVals.length,
      mean: allVals.length ? round2(allVals.reduce((s, v) => s + v, 0) / allVals.length) : null,
    };
    ok(res, { student: stu, overall, subjects });
  })
);

// GET /api/academics/my-scopes —— 前端据此判断当前用户可见班级/科目(用于界面裁剪)
router.get(
  "/my-scopes",
  requireAuth,
  asyncHandler(async (req, res) => {
    const ids = await visibleClassIds(req);
    const classSubjects = {};
    if (req.user.role === "TEACHER") {
      for (const cid of ids) classSubjects[cid] = await visibleSubjects(req, cid);
    }
    ok(res, {
      role: req.user.role,
      isAdmin: req.user.role === "ADMIN",
      classIds: ids,
      classSubjects,
      subjects: Object.values(classSubjects).filter(Array.isArray).flat(),
    });
  })
);

// POST /api/academics/classes/:id/timetable/import —— 管理员:批量导入课表(前端已解析为条目数组)
// body: { entries: [{ dayOfWeek, period, subject, teacherId?, room?, academicYear?, term? }], mode?: "append"|"replace" }
router.post(
  "/classes/:id/timetable/import",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const cls = await prisma.class.findUnique({ where: { id } });
    if (!cls) return fail(res, 404, "班级不存在");
    const { entries, mode } = req.body || {};
    if (!Array.isArray(entries) || entries.length === 0)
      return fail(res, 400, "entries 不能为空");
    if (mode === "replace") {
      await prisma.timetableEntry.deleteMany({ where: { classId: id } });
    }
    // 同一 slot 允许多门课程并存(选课走班 / 分层走班),唯一键又含 teacherId(teacherId 为 NULL 时
    // SQLite 不参与唯一性判断),因此这里用应用层去重:
    // 只挡「同科目 + 同教师(含均未指定教师)」的完全重复;不同课程 / 不同教师可并列导入。
    const dupKey = (d, p, s, t) => `${d}|${p}|${s}|${t || ""}`;
    const seen = new Set();
    const existing = await prisma.timetableEntry.findMany({
      where: { classId: id },
      select: { dayOfWeek: true, period: true, subject: true, teacherId: true },
    });
    existing.forEach((x) => seen.add(dupKey(x.dayOfWeek, x.period, x.subject, x.teacherId)));
    let created = 0;
    let skipped = 0;
    const errors = [];
    for (const e of entries) {
      const dayOfWeek = Number(e.dayOfWeek);
      const period = Number(e.period);
      const subject = e.subject ? String(e.subject).trim() : "";
      if (!subject || dayOfWeek == null || period == null || Number.isNaN(dayOfWeek) || Number.isNaN(period)) {
        skipped++;
        errors.push({ entry: e, reason: "缺少科目/星期/节次" });
        continue;
      }
      if (e.teacherId) {
        const t = await prisma.user.findUnique({ where: { id: String(e.teacherId) } });
        if (!t || (t.role !== "TEACHER" && t.role !== "ADMIN")) {
          skipped++;
          errors.push({ entry: e, reason: "教师不存在或角色不符" });
          continue;
        }
      }
      const k = dupKey(dayOfWeek, period, subject, e.teacherId ? String(e.teacherId) : null);
      if (seen.has(k)) {
        skipped++;
        errors.push({ entry: e, reason: "该时段已有同一门课程(同科目同教师),已跳过" });
        continue;
      }
      seen.add(k);
      try {
        await prisma.timetableEntry.create({
          data: {
            classId: id,
            dayOfWeek,
            period,
            periodLabel: e.periodLabel ? String(e.periodLabel).trim() : null,
            periodTime: e.periodTime ? String(e.periodTime).trim() : null,
            subject,
            teacherId: e.teacherId ? String(e.teacherId) : null,
            room: e.room ? String(e.room).trim() : null,
            academicYear: e.academicYear ? String(e.academicYear).trim() : cls.academicYear,
            term: e.term ? String(e.term).trim() : cls.term,
          },
        });
        created++;
      } catch (err) {
        seen.delete(k);
        if (err && err.code === "P2002") {
          skipped++;
          errors.push({ entry: e, reason: "该时段已有同一门课程(同科目同教师)" });
        } else {
          skipped++;
          errors.push({ entry: e, reason: String((err && err.message) || err) });
        }
      }
    }
    ok(res, { created, skipped, errors }, mode === "replace" ? "已替换导入" : "已追加导入");
  })
);

// ============================================================
// 课程目录 + 学生选课(选修/必修)
// 权限:课程目录的维护(增删/查看/代改选课)仅 ADMIN / 教务老师(ACADEMIC) / 该班班主任;
//       学生本人只能查看 + 一次性提交本人选课。
// ============================================================

// 是否可管理(写)该班级课程目录/选课:ADMIN 任意;教务老师(ACADEMIC)跨班;TEACHER 需为班主任;其余 false
async function canManageCourses(req, classId) {
  if (req.user.role === "ADMIN") return true;
  if (req.user.teacherRole === "ACADEMIC") return true; // 教务老师跨班管理课程目录/选课
  if (req.user.role !== "TEACHER") return false;
  const cls = await prisma.class.findUnique({ where: { id: classId }, select: { headTeacherId: true } });
  if (!cls) return false;
  return cls.headTeacherId === req.user.id;
}

// GET /api/academics/course-classes —— 班主任/管理员:可管理课程的班级列表
router.get(
  "/course-classes",
  requireAuth,
  asyncHandler(async (req, res) => {
    let classes;
    if (req.user.role === "ADMIN") {
      classes = await prisma.class.findMany({ orderBy: [{ academicYear: "desc" }, { name: "asc" }] });
    } else if (req.user.role === "TEACHER") {
      classes = await prisma.class.findMany({
        where: { headTeacherId: req.user.id },
        orderBy: [{ academicYear: "desc" }, { name: "asc" }],
      });
    } else {
      return ok(res, { classes: [] });
    }
    ok(res, {
      classes: classes.map((c) => ({
        id: c.id,
        name: c.name,
        grade: c.grade,
        academicYear: c.academicYear,
        term: c.term,
      })),
    });
  })
);

// GET /api/academics/classes/:id/courses
// 返回:课程目录 + 该班课表出现但未入目录的科目(便于教师一键添加)
router.get(
  "/classes/:id/courses",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!(await canManageCourses(req, id))) return fail(res, 403, "无权管理该班级课程");
    const cls = await prisma.class.findUnique({ where: { id } });
    if (!cls) return fail(res, 404, "班级不存在");
    const academicYear = (req.query.academicYear || cls.academicYear).toString().trim();
    const term = (req.query.term || cls.term).toString().trim();
    const courses = await prisma.course.findMany({
      where: { classId: id, academicYear, term },
      orderBy: { name: "asc" },
    });
    const entries = await prisma.timetableEntry.findMany({
      where: { classId: id, academicYear, term },
      select: { subject: true },
    });
    const timetableSubjects = Array.from(new Set(entries.map((e) => e.subject))).sort();
    const cataloged = new Set(courses.map((c) => c.name));
    const availableSubjects = timetableSubjects.filter((s) => !cataloged.has(s));
    ok(res, { courses, availableSubjects, academicYear, term });
  })
);

// POST /api/academics/classes/:id/courses —— 新增/更新课程(按唯一键 upsert)
// body: { name, type: "REQUIRED"|"ELECTIVE", academicYear?, term? }
router.post(
  "/classes/:id/courses",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!(await canManageCourses(req, id))) return fail(res, 403, "无权管理该班级课程");
    const cls = await prisma.class.findUnique({ where: { id } });
    if (!cls) return fail(res, 404, "班级不存在");
    const { name, type, academicYear, term } = req.body || {};
    const subject = (name || "").toString().trim();
    if (!subject) return fail(res, 400, "课程名称(name)不能为空");
    const ctype = type === "REQUIRED" ? "REQUIRED" : "ELECTIVE";
    const ay = (academicYear || cls.academicYear).toString().trim();
    const tm = (term || cls.term).toString().trim();
    const course = await prisma.course.upsert({
      where: { classId_academicYear_term_name: { classId: id, academicYear: ay, term: tm, name: subject } },
      update: { type: ctype },
      create: { classId: id, academicYear: ay, term: tm, name: subject, type: ctype },
    });
    ok(res, { course }, "已保存课程");
  })
);

// DELETE /api/academics/classes/:id/courses/:courseId
router.delete(
  "/classes/:id/courses/:courseId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id, courseId } = req.params;
    if (!(await canManageCourses(req, id))) return fail(res, 403, "无权管理该班级课程");
    const existing = await prisma.course.findUnique({ where: { id: courseId } });
    if (!existing || existing.classId !== id) return fail(res, 404, "课程不存在");
    await prisma.course.delete({ where: { id: courseId } });
    ok(res, { ok: true }, "已删除");
  })
);

// 取学生「当前应选课班级」:优先取有课程目录的班级归属,否则取第一个归属
async function resolveStudentSelectionClass(studentId) {
  const memberships = await prisma.classMembership.findMany({
    where: { studentId },
    include: { class: true },
  });
  if (!memberships.length) return null;
  for (const m of memberships) {
    const cnt = await prisma.course.count({
      where: { classId: m.classId, academicYear: m.class.academicYear, term: m.class.term },
    });
    if (cnt > 0) return m.class;
  }
  return memberships[0].class;
}

// GET /api/academics/me/course-selection —— 学生:本人可选项的目录 + 当前选择
router.get(
  "/me/course-selection",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user.role !== "STUDENT") return fail(res, 403, "仅学生可访问");
    const cls = await resolveStudentSelectionClass(req.user.id);
    if (!cls) return fail(res, 404, "未找到所在班级");
    const courses = await prisma.course.findMany({
      where: { classId: cls.id, academicYear: cls.academicYear, term: cls.term },
      orderBy: { name: "asc" },
    });
    const sel = await prisma.studentCourseSelection.findUnique({
      where: {
        studentId_classId_academicYear_term: {
          studentId: req.user.id,
          classId: cls.id,
          academicYear: cls.academicYear,
          term: cls.term,
        },
      },
    });
    const required = courses.filter((c) => c.type === "REQUIRED").map((c) => c.name);
    let selected = [];
    if (sel) {
      try {
        selected = JSON.parse(sel.selectedCourseIds || "[]");
      } catch {
        selected = [];
      }
    }
    if (!Array.isArray(selected)) selected = [];
    ok(res, {
      class: { id: cls.id, name: cls.name, academicYear: cls.academicYear, term: cls.term },
      courses,
      requiredCourses: required,
      selection: sel ? { selectedCourseIds: selected, submittedAt: sel.submittedAt } : null,
    });
  })
);

// POST /api/academics/me/course-selection —— 学生:一次性提交选课(提交后锁定)
// body: { selectedCourseIds: string[] }  (仅选修中被勾选的科目)
router.post(
  "/me/course-selection",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user.role !== "STUDENT") return fail(res, 403, "仅学生可访问");
    const cls = await resolveStudentSelectionClass(req.user.id);
    if (!cls) return fail(res, 404, "未找到所在班级");
    const { selectedCourseIds } = req.body || {};
    if (!Array.isArray(selectedCourseIds)) return fail(res, 400, "selectedCourseIds 必须为数组");
    const courses = await prisma.course.findMany({
      where: { classId: cls.id, academicYear: cls.academicYear, term: cls.term },
    });
    const electiveNames = new Set(courses.filter((c) => c.type === "ELECTIVE").map((c) => c.name));
    const validSelected = selectedCourseIds
      .map((x) => String(x).trim())
      .filter((x) => electiveNames.has(x));
    const existing = await prisma.studentCourseSelection.findUnique({
      where: {
        studentId_classId_academicYear_term: {
          studentId: req.user.id,
          classId: cls.id,
          academicYear: cls.academicYear,
          term: cls.term,
        },
      },
    });
    if (existing && existing.submittedAt)
      return fail(res, 403, "选课已提交,不可自行修改(如需调整请联系班主任)");
    const selection = await prisma.studentCourseSelection.upsert({
      where: {
        studentId_classId_academicYear_term: {
          studentId: req.user.id,
          classId: cls.id,
          academicYear: cls.academicYear,
          term: cls.term,
        },
      },
      update: { selectedCourseIds: JSON.stringify(validSelected), submittedAt: new Date() },
      create: {
        studentId: req.user.id,
        classId: cls.id,
        academicYear: cls.academicYear,
        term: cls.term,
        selectedCourseIds: JSON.stringify(validSelected),
        submittedAt: new Date(),
      },
    });
    ok(res, { selection: { selectedCourseIds: validSelected, submittedAt: selection.submittedAt } }, "选课已提交");
  })
);

// GET /api/academics/classes/:id/course-selection —— 班主任/管理员:列出该班学生的选课状态
router.get(
  "/classes/:id/course-selection",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!(await canManageCourses(req, id))) return fail(res, 403, "无权管理该班级课程");
    const cls = await prisma.class.findUnique({ where: { id } });
    if (!cls) return fail(res, 404, "班级不存在");
    const courses = await prisma.course.findMany({
      where: { classId: id, academicYear: cls.academicYear, term: cls.term },
      orderBy: { name: "asc" },
    });
    const members = await prisma.classMembership.findMany({
      where: { classId: id },
      include: { student: { select: { id: true, name: true, studentNo: true } } },
    });
    const selections = await prisma.studentCourseSelection.findMany({
      where: { classId: id, academicYear: cls.academicYear, term: cls.term },
    });
    const selByStudent = {};
    for (const s of selections) selByStudent[s.studentId] = s;
    const required = courses.filter((c) => c.type === "REQUIRED").map((c) => c.name);
    const students = members.map((m) => {
      const s = selByStudent[m.studentId];
      let selected = [];
      if (s) {
        try {
          selected = JSON.parse(s.selectedCourseIds || "[]");
        } catch {
          selected = [];
        }
      }
      if (!Array.isArray(selected)) selected = [];
      return {
        student: m.student,
        requiredCourses: required,
        selectedCourseIds: selected,
        submittedAt: s ? s.submittedAt : null,
        isSubmitted: !!(s && s.submittedAt),
      };
    });
    ok(res, {
      class: { id: cls.id, name: cls.name, academicYear: cls.academicYear, term: cls.term },
      courses,
      requiredCourses: required,
      students,
    });
  })
);

// PUT /api/academics/classes/:id/students/:studentId/course-selection —— 班主任/管理员:代学生调整选课(强制,不受锁定限制)
// body: { selectedCourseIds: string[] }
router.put(
  "/classes/:id/students/:studentId/course-selection",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id, studentId } = req.params;
    if (!(await canManageCourses(req, id))) return fail(res, 403, "无权管理该班级课程");
    const cls = await prisma.class.findUnique({ where: { id } });
    if (!cls) return fail(res, 404, "班级不存在");
    const { selectedCourseIds } = req.body || {};
    if (!Array.isArray(selectedCourseIds)) return fail(res, 400, "selectedCourseIds 必须为数组");
    const courses = await prisma.course.findMany({
      where: { classId: id, academicYear: cls.academicYear, term: cls.term },
    });
    const electiveNames = new Set(courses.filter((c) => c.type === "ELECTIVE").map((c) => c.name));
    const validSelected = selectedCourseIds
      .map((x) => String(x).trim())
      .filter((x) => electiveNames.has(x));
    const selection = await prisma.studentCourseSelection.upsert({
      where: {
        studentId_classId_academicYear_term: {
          studentId,
          classId: id,
          academicYear: cls.academicYear,
          term: cls.term,
        },
      },
      update: { selectedCourseIds: JSON.stringify(validSelected), submittedAt: new Date() },
      create: {
        studentId,
        classId: id,
        academicYear: cls.academicYear,
        term: cls.term,
        selectedCourseIds: JSON.stringify(validSelected),
        submittedAt: new Date(),
      },
    });
    ok(res, { selection: { selectedCourseIds: validSelected, submittedAt: selection.submittedAt } }, "已更新该学生选课");
  })
);

export default router;
