import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/db.js";
import { ok, fail, asyncHandler } from "../lib/res.js";
import { signToken, requireAuth } from "../middleware/auth.js";

const router = Router();

// POST /api/auth/register — 注册
router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const { email, password, name, role } = req.body || {};
    if (!email || !password || !name) return fail(res, 400, "email、password、name 必填");
    // 公开注册仅允许学生账号;老师/管理员账号由管理员创建(或通过种子数据)
    if (role && role !== "STUDENT") return fail(res, 400, "公开注册仅支持学生账号");
    const existed = await prisma.user.findUnique({ where: { email: String(email).toLowerCase() } });
    if (existed) return fail(res, 400, "该邮箱已注册");

    const user = await prisma.user.create({
      data: {
        email: String(email).toLowerCase(),
        passwordHash: await bcrypt.hash(password, 10),
        name,
        role: "STUDENT",
      },
    });
    const safe = { id: user.id, email: user.email, name: user.name, role: user.role };
    ok(res, { token: signToken(user), user: safe }, "注册成功");
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
    const safe = { id: user.id, email: user.email, name: user.name, role: user.role };
    ok(res, { token: signToken(user), user: safe }, "登录成功");
  })
);

// GET /api/auth/me — 当前用户(需认证)
router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id, email, name, role, targetUniversity, createdAt } = req.user;
    ok(res, { id, email, name, role, targetUniversity, createdAt });
  })
);

export default router;
