// 针对「答案解析」功能的端到端自测(本地 :4000)
// 重点验证:无 LLM key 时的优雅降级 + 错题本接口字段
import { prisma } from "../src/lib/db.js";

const BASE = "http://localhost:4000/api";
const SRC = "E2E-SOL-TEST-" + Date.now();

async function call(path, opts = {}) {
  const r = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j };
}

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fail++; console.log("  ✗", name, extra); }
}

async function main() {
  // 登录 teacher
  const login = await call("/auth/login", { method: "POST", body: JSON.stringify({ email: "teacher@example.com", password: "123456" }) });
  if (login.status !== 200 || !login.body.data?.token) { console.log("登录失败", login); process.exit(1); }
  const token = login.body.data.token;
  const AUTH = { Authorization: "Bearer " + token };
  console.log("登录 teacher 成功\n");

  // 直接造一道缺解析的退回题(绕过创建接口的格式校验,聚焦 API 行为)
  const t = await prisma.user.findFirst({ where: { role: "TEACHER" } });
  const q = await prisma.question.create({
    data: {
      subject: "TMUA", topic: "自测", difficulty: 3, type: "SINGLE_CHOICE",
      stem: "自测题:求 $1+1$", options: JSON.stringify(["1", "2", "3", "4"]),
      answer: "2", solution: "", status: "REJECTED", reviewNote: "缺少解析", source: SRC,
      createdBy: t.id,
    },
  });
  const qid = q.id;
  console.log("已造测试题", qid, "\n");

  console.log("[1] generate-solution 无 LLM key 应优雅报错");
  const gen = await call(`/questions/${qid}/generate-solution`, { method: "POST", headers: AUTH, body: "{}" });
  check("返回 400", gen.status === 400, "got " + gen.status);
  check("提示未配置 LLM_API_KEY", String(gen.body.message || "").includes("LLM_API_KEY"), gen.body.message);

  console.log("\n[2] 一键修正对缺解析题(无 key)应保留 manual 标记,不强行生成");
  const af = await call(`/questions/${qid}/autofix`, { method: "POST", headers: AUTH, body: JSON.stringify({ apply: true, resubmit: true }) });
  check("autofix 成功", af.status === 200, JSON.stringify(af.body).slice(0, 120));
  const manual = af.body.data?.manual || [];
  check("manual 含 missing_solution", manual.some((m) => m.code === "missing_solution"), JSON.stringify(manual));
  const sol = af.body.data?.solution || af.body.data?.preview?.solution;
  check("未自动生成 solution(无 key)", !sol, "solution=" + JSON.stringify(sol));

  console.log("\n[3] 错题本接口应返回 solution 字段");
  const wb = await call("/me/wrongbook", { headers: AUTH });
  check("wrongbook 返回 list 数组", Array.isArray(wb.body.data?.list), JSON.stringify(wb.body).slice(0, 80));

  // 清理
  await prisma.question.deleteMany({ where: { source: SRC } });
  await prisma.$disconnect();

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
