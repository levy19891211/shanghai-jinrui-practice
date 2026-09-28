import { Router } from "express";
import { prisma } from "../lib/db.js";
import { ok, fail, asyncHandler } from "../lib/res.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

// ============================================================
// GPA 管理:过程性考核成绩登记 + 综合评定 + 成绩单
// 权限:教师/管理员可登记与配置;学生看自己;家长看 VERIFIED 关联的孩子
// ============================================================

const router = Router();
router.use(requireAuth);

// ——— 常量(与前端共享的字典)———
const MODULES = ["学术核心", "素养与综合", "艺术与体育", "研究与创新", "人工智能与实践"];
const SEASONS = ["夏季学", "秋季学", "冬季学", "春季学"];
const COMPONENTS = [
  { key: "FINAL", label: "期末" },
  { key: "MIDTERM", label: "期中" },
  { key: "REGULAR", label: "平时" },
];
const COMPONENT_KEYS = COMPONENTS.map((c) => c.key);

// 等级映射:A≥90 B≥80 C≥70 D≥60 其余 E
function scoreLevel(score) {
  if (score == null || Number.isNaN(score)) return null;
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "E";
}

// 综合评定:按课程权重对各考核组件加权;缺失组件按剩余权重归一化
// scores: { FINAL?: number, MIDTERM?: number, REGULAR?: number }
function comprehensive(course, comps) {
  const pairs = [
    [comps.FINAL, course.weightFinal],
    [comps.MIDTERM, course.weightMidterm],
    [comps.REGULAR, course.weightRegular],
  ].filter(([v, w]) => v != null && !Number.isNaN(v) && w > 0);
  if (!pairs.length) return null;
  const wSum = pairs.reduce((s, [, w]) => s + w, 0);
  if (wSum <= 0) return null; // 全零权重且无归一基准
  const vSum = pairs.reduce((s, [v, w]) => s + v * w, 0);
  return Math.round((vSum / wSum) * 10) / 10;
}

// 学年综合评定 = 各学季综合得分的算术平均(空学季跳过)
function yearComprehensive(seasonScores) {
  const vals = SEASONS.map((s) => seasonScores[s]?.comprehensive).filter((v) => v != null);
  if (!vals.length) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
}

const courseSelect = {
  id: true, academicYear: true, grade: true, name: true, module: true,
  weeklyHours: true, weightFinal: true, weightMidterm: true, weightRegular: true,
  sortOrder: true, active: true,
};

// ——— 字典:模块/学季/考核组件/已有学年与年级 ———
router.get(
  "/meta",
  asyncHandler(async (req, res) => {
    const rows = await prisma.gpaCourse.findMany({
      select: { academicYear: true, grade: true },
      distinct: ["academicYear", "grade"],
    });
    const years = [...new Set(rows.map((r) => r.academicYear))].sort().reverse();
    const grades = [...new Set(rows.map((r) => r.grade))];
    ok(res, { modules: MODULES, seasons: SEASONS, components: COMPONENTS, academicYears: years, grades });
  })
);

// ——— 教师端:班级列表(登记成绩时选班)———
router.get(
  "/classes",
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const classes = await prisma.class.findMany({
      select: { id: true, name: true, grade: true, academicYear: true, term: true },
      orderBy: [{ academicYear: "desc" }, { name: "asc" }],
    });
    ok(res, { classes });
  })
);

// ——— 教师端:某班学生名册(含成绩单档案字段)———
router.get(
  "/roster",
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const classId = String(req.query.classId || "");
    if (!classId) return fail(res, 400, "classId 必填");
    const memberships = await prisma.classMembership.findMany({
      where: { classId },
      include: {
        student: {
          select: { id: true, name: true, studentNo: true, gender: true, birthDate: true, enrollmentDate: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });
    ok(res, {
      students: memberships.map((m) => ({
        id: m.student.id,
        name: m.student.name,
        studentNo: m.student.studentNo,
        gender: m.student.gender,
        birthDate: m.student.birthDate,
        enrollmentDate: m.student.enrollmentDate,
      })),
    });
  })
);

// ——— 教师端:更新学生成绩单档案(性别/出生日期/入学时间/学号)———
router.put(
  "/students/:id/meta",
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { gender, birthDate, enrollmentDate, studentNo } = req.body || {};
    const data = {};
    if (gender !== undefined) data.gender = gender ? String(gender).trim() : null;
    if (birthDate !== undefined) data.birthDate = birthDate ? new Date(birthDate) : null;
    if (enrollmentDate !== undefined) data.enrollmentDate = enrollmentDate ? new Date(enrollmentDate) : null;
    if (studentNo !== undefined) data.studentNo = studentNo ? String(studentNo).trim() : null;
    if (!Object.keys(data).length) return fail(res, 400, "无可更新字段");
    try {
      const user = await prisma.user.update({ where: { id: req.params.id }, data });
      ok(res, { id: user.id, gender: user.gender, birthDate: user.birthDate, enrollmentDate: user.enrollmentDate, studentNo: user.studentNo });
    } catch {
      return fail(res, 400, studentNo ? "学号可能已被占用,更新失败" : "更新失败");
    }
  })
);

// ——— 教师端:课程配置 CRUD ———
router.get(
  "/courses",
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const academicYear = String(req.query.academicYear || "");
    const grade = String(req.query.grade || "");
    if (!academicYear || !grade) return fail(res, 400, "academicYear 与 grade 必填");
    const courses = await prisma.gpaCourse.findMany({
      where: { academicYear, grade },
      orderBy: [{ sortOrder: "asc" }, { module: "asc" }, { name: "asc" }],
      select: courseSelect,
    });
    ok(res, { courses });
  })
);

function validateCourseBody(body) {
  const { academicYear, grade, name, module } = body || {};
  if (!academicYear || !grade || !name) return "学年、年级、课程名称必填";
  if (!MODULES.includes(module)) return `课程模块非法(须为:${MODULES.join("/")})`;
  const weights = [body.weightFinal, body.weightMidterm, body.weightRegular];
  for (const w of weights) {
    if (w != null && (Number(w) < 0 || Number(w) > 100)) return "权重须在 0-100 之间";
  }
  if (body.weeklyHours != null && body.weeklyHours !== "" && Number(body.weeklyHours) < 0) return "周课时不能为负";
  return null;
}

function courseDataFrom(body) {
  return {
    academicYear: String(body.academicYear).trim(),
    grade: String(body.grade).trim(),
    name: String(body.name).trim(),
    module: String(body.module),
    weeklyHours: body.weeklyHours == null || body.weeklyHours === "" ? null : Number(body.weeklyHours),
    weightFinal: body.weightFinal == null ? 50 : Number(body.weightFinal),
    weightMidterm: body.weightMidterm == null ? 30 : Number(body.weightMidterm),
    weightRegular: body.weightRegular == null ? 20 : Number(body.weightRegular),
    sortOrder: body.sortOrder == null ? 0 : Number(body.sortOrder),
  };
}

router.post(
  "/courses",
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const err = validateCourseBody(req.body);
    if (err) return fail(res, 400, err);
    const data = courseDataFrom(req.body);
    const existed = await prisma.gpaCourse.findUnique({
      where: { academicYear_grade_name: { academicYear: data.academicYear, grade: data.grade, name: data.name } },
    });
    if (existed) return fail(res, 400, "该学年下此年级已存在同名课程");
    const course = await prisma.gpaCourse.create({ data, select: courseSelect });
    ok(res, { course }, "课程已创建");
  })
);

router.put(
  "/courses/:id",
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const course = await prisma.gpaCourse.findUnique({ where: { id: req.params.id } });
    if (!course) return fail(res, 404, "课程不存在");
    const merged = {
      academicYear: req.body.academicYear ?? course.academicYear,
      grade: req.body.grade ?? course.grade,
      name: req.body.name ?? course.name,
      module: req.body.module ?? course.module,
      weeklyHours: req.body.weeklyHours,
      weightFinal: req.body.weightFinal ?? course.weightFinal,
      weightMidterm: req.body.weightMidterm ?? course.weightMidterm,
      weightRegular: req.body.weightRegular ?? course.weightRegular,
      sortOrder: req.body.sortOrder ?? course.sortOrder,
    };
    const err = validateCourseBody(merged);
    if (err) return fail(res, 400, err);
    const data = {};
    if (req.body.name !== undefined) data.name = String(req.body.name).trim();
    if (req.body.module !== undefined) data.module = String(req.body.module);
    if (req.body.weeklyHours !== undefined) data.weeklyHours = merged.weeklyHours == null || merged.weeklyHours === "" ? null : Number(merged.weeklyHours);
    if (req.body.weightFinal !== undefined) data.weightFinal = Number(merged.weightFinal);
    if (req.body.weightMidterm !== undefined) data.weightMidterm = Number(merged.weightMidterm);
    if (req.body.weightRegular !== undefined) data.weightRegular = Number(merged.weightRegular);
    if (req.body.sortOrder !== undefined) data.sortOrder = Number(merged.sortOrder);
    if (req.body.active !== undefined) data.active = Boolean(req.body.active);
    const updated = await prisma.gpaCourse.update({ where: { id: course.id }, data, select: courseSelect });
    ok(res, { course: updated }, "课程已更新");
  })
);

router.delete(
  "/courses/:id",
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const course = await prisma.gpaCourse.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { scores: true } } },
    });
    if (!course) return fail(res, 404, "课程不存在");
    await prisma.gpaCourse.delete({ where: { id: course.id } }); // GpaScore 级联删除
    ok(res, { deleted: true, removedScores: course._count.scores }, `课程已删除(同时清除 ${course._count.scores} 条成绩)`);
  })
);

// ——— 成绩读取(登记表格用):某课程某学季某班 ———
router.get(
  "/scores",
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const courseId = String(req.query.courseId || "");
    const season = String(req.query.season || "");
    const classId = String(req.query.classId || "");
    if (!courseId || !season || !classId) return fail(res, 400, "courseId/season/classId 必填");
    if (!SEASONS.includes(season)) return fail(res, 400, "学季非法");
    const memberships = await prisma.classMembership.findMany({
      where: { classId },
      include: { student: { select: { id: true, name: true, studentNo: true } } },
      orderBy: { createdAt: "asc" },
    });
    const studentIds = memberships.map((m) => m.student.id);
    const rows = studentIds.length
      ? await prisma.gpaScore.findMany({ where: { courseId, season, studentId: { in: studentIds } } })
      : [];
    const byStudent = {};
    for (const r of rows) {
      byStudent[r.studentId] = byStudent[r.studentId] || {};
      byStudent[r.studentId][r.component] = { score: r.score, fullScore: r.fullScore, remark: r.remark };
    }
    ok(res, {
      students: memberships.map((m) => ({ id: m.student.id, name: m.student.name, studentNo: m.student.studentNo })),
      scores: byStudent, // { studentId: { FINAL: {score,fullScore,remark}, ... } }
    });
  })
);

// ——— 成绩批量登记(upsert;score=null 删除该格)———
router.put(
  "/scores/batch",
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { courseId, season, entries } = req.body || {};
    if (!courseId || !season || !Array.isArray(entries)) return fail(res, 400, "courseId/season/entries 必填");
    if (!SEASONS.includes(season)) return fail(res, 400, "学季非法");
    const course = await prisma.gpaCourse.findUnique({ where: { id: courseId } });
    if (!course) return fail(res, 404, "课程不存在");

    let saved = 0, cleared = 0;
    for (const e of entries) {
      if (!e || !e.studentId || !COMPONENT_KEYS.includes(e.component)) continue;
      const where = { courseId_studentId_season_component: { courseId, studentId: e.studentId, season, component: e.component } };
      if (e.score == null || e.score === "") {
        const r = await prisma.gpaScore.deleteMany({ where });
        cleared += r.count;
        continue;
      }
      const score = Number(e.score);
      if (Number.isNaN(score) || score < 0 || score > (e.fullScore ?? 100)) continue; // 非法分跳过
      const data = { score, fullScore: e.fullScore != null ? Number(e.fullScore) : 100, remark: e.remark ?? null, recordedBy: req.user.id };
      await prisma.gpaScore.upsert({ where, create: { courseId, studentId: e.studentId, season, component: e.component, ...data }, update: data });
      saved++;
    }
    ok(res, { saved, cleared }, `已保存 ${saved} 条,清除 ${cleared} 条`);
  })
);

// ——— 成绩单聚合(教师/学生本人/家长 VERIFIED 关联)———
// GET /api/gpa/report/:studentId?academicYear=2026-2027
router.get(
  "/report/:studentId",
  asyncHandler(async (req, res) => {
    const studentId = req.params.studentId;
    const me = req.user;
    // 权限:教师/管理员任意;学生仅本人;家长须 VERIFIED 关联
    if (me.role === "STUDENT") {
      if (me.id !== studentId) return fail(res, 403, "仅可查看本人成绩单");
    } else if (me.role === "PARENT") {
      const link = await prisma.parentLink.findUnique({
        where: { parentUserId_studentUserId: { parentUserId: me.id, studentUserId: studentId } },
      });
      if (!link || link.status !== "VERIFIED") return fail(res, 403, "无权查看该学生成绩单");
    } else if (me.role !== "TEACHER" && me.role !== "ADMIN") {
      return fail(res, 403, "无权限");
    }

    // 学生档案
    const student = await prisma.user.findUnique({
      where: { id: studentId },
      select: { id: true, name: true, studentNo: true, gender: true, birthDate: true, enrollmentDate: true },
    });
    if (!student) return fail(res, 404, "学生不存在");

    // 学年参数:缺省取课程表里最新学年
    let academicYear = String(req.query.academicYear || "");
    if (!academicYear) {
      const latest = await prisma.gpaCourse.findFirst({ orderBy: { academicYear: "desc" }, select: { academicYear: true } });
      academicYear = latest?.academicYear || "";
    }
    if (!academicYear) return ok(res, { student, academicYear: "", grade: "", courses: [] });

    // 学生年级:取该学年所在班级的 grade(取第一个非空)
    const memberships = await prisma.classMembership.findMany({
      where: { studentId },
      include: { class: { select: { grade: true, academicYear: true } } },
    });
    const grade =
      memberships.map((m) => m.class.grade).find((g) => g && g.trim()) || "";

    // 课程:该学年该年级(年级未知时取该学年全部)
    const courses = await prisma.gpaCourse.findMany({
      where: grade ? { academicYear, grade, active: true } : { academicYear, active: true },
      orderBy: [{ sortOrder: "asc" }, { module: "asc" }, { name: "asc" }],
      select: courseSelect,
    });
    const courseIds = courses.map((c) => c.id);
    const rows = courseIds.length
      ? await prisma.gpaScore.findMany({ where: { studentId, courseId: { in: courseIds } } })
      : [];

    // 组装:每门课 × 每学季 {期末/期中/平时 + 综合 + 等级} + 学年综合
    const scoreMap = {};
    for (const r of rows) {
      scoreMap[r.courseId] = scoreMap[r.courseId] || {};
      scoreMap[r.courseId][r.season] = scoreMap[r.courseId][r.season] || {};
      scoreMap[r.courseId][r.season][r.component] = r.score;
    }
    const outCourses = courses.map((c) => {
      const seasons = {};
      for (const s of SEASONS) {
        const comps = scoreMap[c.id]?.[s];
        if (!comps) { seasons[s] = null; continue; }
        const comprehensiveScore = comprehensive(c, comps);
        seasons[s] = {
          final: comps.FINAL ?? null,
          midterm: comps.MIDTERM ?? null,
          regular: comps.REGULAR ?? null,
          comprehensive: comprehensiveScore,
          level: scoreLevel(comprehensiveScore),
        };
      }
      const yearScore = yearComprehensive(seasons);
      return {
        id: c.id, module: c.module, name: c.name, weeklyHours: c.weeklyHours,
        weights: { final: c.weightFinal, midterm: c.weightMidterm, regular: c.weightRegular },
        seasons, yearScore, yearLevel: scoreLevel(yearScore),
      };
    });

    ok(res, { student, academicYear, grade, courses: outCourses });
  })
);

export default router;
