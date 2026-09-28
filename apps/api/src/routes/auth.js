import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/db.js";
import { ok, fail, asyncHandler } from "../lib/res.js";
import { signToken, requireAuth } from "../middleware/auth.js";

const router = Router();

// 简单限流:同一来源 1 分钟内最多 30 次注册请求,防止学号枚举
// 优先取 x-forwarded-for(nginx 代理会写入),否则回退 req.ip
const registerAttempts = new Map(); // key: ip -> number[] (timestamps)
function registerRateLimit(req, res, next) {
  const ip = String(req.headers["x-forwarded-for"] || req.ip || "unknown")
    .split(",")[0]
    .trim();
  const now = Date.now();
  const windowMs = 60 * 1000;
  const arr = (registerAttempts.get(ip) || []).filter((t) => now - t < windowMs);
  if (arr.length >= 30) {
    return fail(res, 429, "请求过于频繁，请稍后再试");
  }
  arr.push(now);
  registerAttempts.set(ip, arr);
  next();
}

// POST /api/auth/register — 注册(支持 STUDENT / PARENT)
router.post(
  "/register",
  registerRateLimit,
  asyncHandler(async (req, res) => {
    const { email, password, name, role } = req.body || {};
    if (!email || !password || !name) return fail(res, 400, "email、password、name 必填");
    // 公开注册仅允许学生 / 家长;老师/管理员账号由管理员创建(或种子数据)
    if (role && role !== "STUDENT" && role !== "PARENT") {
      return fail(res, 400, "公开注册仅支持学生或家长账号");
    }

    const lowerEmail = String(email).toLowerCase();
    const existed = await prisma.user.findUnique({ where: { email: lowerEmail } });
    if (existed) return fail(res, 400, "该邮箱已注册");

    // ——— 家长注册:学号 + 姓名 精确匹配已审核学生 ———
    if (role === "PARENT") {
      const { studentName, studentNo, relation } = req.body || {};
      if (!studentName || !studentNo) {
        return fail(res, 400, "家长注册需提供学生姓名(studentName)与学生学号(studentNo)");
      }
      // 精确匹配:同一学号下姓名也必须一致,且学生账号须已通过审核
      const student = await prisma.user.findFirst({
        where: { role: "STUDENT", status: "APPROVED", name: studentName, studentNo },
      });
      if (student) {
        // 命中 → 自动 VERIFIED + APPROVED,直接返 token 登录
        const user = await prisma.user.create({
          data: {
            email: lowerEmail,
            passwordHash: await bcrypt.hash(password, 10),
            name,
            role: "PARENT",
            status: "APPROVED",
          },
        });
        await prisma.parentLink.create({
          data: {
            parentUserId: user.id,
            studentUserId: student.id,
            relation: relation || null,
            status: "VERIFIED",
            matchMethod: "EXACT",
            verifiedAt: new Date(),
          },
        });
        const safe = { id: user.id, email: user.email, name: user.name, role: user.role, status: user.status };
        return ok(res, { token: signToken(user), user: safe }, "家长账号已通过学号+姓名验证，注册并登录成功");
      }
      // 未精确匹配:建立 PENDING 账号,待班主任审批;若学号命中某学生则预挂一条待审关联
      const candidate = await prisma.user.findFirst({
        where: { role: "STUDENT", studentNo },
      });
      const user = await prisma.user.create({
        data: {
          email: lowerEmail,
          passwordHash: await bcrypt.hash(password, 10),
          name,
          role: "PARENT",
          status: "PENDING",
        },
      });
      if (candidate) {
        await prisma.parentLink.create({
          data: {
            parentUserId: user.id,
            studentUserId: candidate.id,
            relation: relation || null,
            status: "PENDING",
            matchMethod: "MANUAL",
          },
        });
      }
      const safe = { id: user.id, email: user.email, name: user.name, role: user.role, status: user.status };
      return ok(
        res,
        { user: safe },
        "注册成功，因学号+姓名未精确匹配，账号待班主任审核通过后登录"
      );
    }

    // ——— 学生注册:默认 PENDING,需教师审核 ———
    const user = await prisma.user.create({
      data: {
        email: lowerEmail,
        passwordHash: await bcrypt.hash(password, 10),
        name,
        role: "STUDENT",
        status: "PENDING", // 注册后默认待教师审核,审核通过前不能登录
      },
    });
    const safe = { id: user.id, email: user.email, name: user.name, role: user.role, status: user.status };
    // 注册不直接发 token,需教师审核通过后才能登录
    ok(res, { user: safe }, "注册成功，请等待教师审核通过后登录");
  })
);

// POST /api/auth/login — 登录
router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return fail(res, 400, "email、password 必填");
    const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase() } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return fail(res, 400, "邮箱或密码错误");
    }
    // 学生 / 家长账号需审核通过方可登录(家长未精确匹配学号+姓名时 status=PENDING,须班主任审批)
    if ((user.role === "STUDENT" || user.role === "PARENT") && user.status !== "APPROVED") {
      const msg =
        user.status === "PENDING"
          ? user.role === "PARENT"
            ? "家长账号待班主任审核，请审核通过后登录"
            : "账号待教师审核，请联系老师审核通过后登录"
          : "账号未通过审核，无法登录";
      return fail(res, 403, msg);
    }
    const safe = { id: user.id, email: user.email, name: user.name, role: user.role, teacherRole: user.teacherRole || null, status: user.status };
    ok(res, { token: signToken(user), user: safe }, "登录成功");
  })
);

// GET /api/auth/me — 当前用户(需认证)
router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id, email, name, role, teacherRole, targetUniversity, createdAt, status } = req.user;
    ok(res, { id, email, name, role, teacherRole: teacherRole || null, targetUniversity, createdAt, status });
  })
);

// PUT /api/auth/profile — 修改个人信息(需认证)
// body: { name?, currentPassword?, newPassword? }
//   - 姓名:直接更新
//   - 密码:必须携带 currentPassword 且比对通过;新密码至少 6 位
router.put(
  "/profile",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { name, currentPassword, newPassword } = req.body || {};
    const data = {};
    if (name !== undefined && String(name).trim()) data.name = String(name).trim();
    if (newPassword) {
      const np = String(newPassword);
      if (np.length < 6) return fail(res, 400, "新密码至少 6 位");
      if (!currentPassword || !(await bcrypt.compare(String(currentPassword), req.user.passwordHash))) {
        return fail(res, 400, "旧密码不正确");
      }
      data.passwordHash = await bcrypt.hash(np, 10);
    }
    if (!Object.keys(data).length) return fail(res, 400, "没有需要保存的修改");
    const updated = await prisma.user.update({ where: { id: req.user.id }, data });
    const safe = {
      id: updated.id, email: updated.email, name: updated.name,
      role: updated.role, teacherRole: updated.teacherRole || null, status: updated.status,
    };
    ok(res, { user: safe }, newPassword ? "已保存,密码已更新" : "已保存");
  })
);

export default router;
