// 端到端验证 /questions/:id/fix(双模式之 AI 语义重调)。
// 依赖:本地 API(:4000) 已用 LLM_API_KEY/LLM_BASE_URL 指向 mock_llm.mjs 启动。
import { prisma } from "../src/lib/db.js";

const B = "http://localhost:4000/api";
let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fail++; console.log("  ✗", name, extra); }
}
async function call(path, opts = {}) {
  const r = await fetch(B + path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function main() {
  const t = (await call("/auth/login", { method: "POST", body: JSON.stringify({ email: "teacher@example.com", password: "123456" }) })).body.data.token;
  const AUTH = { Authorization: "Bearer " + t };

  // 造一道"答案算错"的退回题
  const uid = (await prisma.user.findFirst({ where: { role: "TEACHER" } })).id;
  const q = await prisma.question.create({
    data: { subject: "TMUA", topic: "代数", difficulty: 3, type: "SINGLE_CHOICE", stem: "求 $2x+4=10$ 的解", options: JSON.stringify(["x=2", "x=3"]), answer: "x=2", solution: "", status: "REJECTED", reviewNote: "答案选错了,正确答案应该是 x=3", source: "DBG-FIX", createdBy: uid },
  });

  console.log("[1] /fix 预览(apply=false) 应返回 AI 修正方案");
  const prev = await call(`/questions/${q.id}/fix`, { method: "POST", headers: AUTH, body: JSON.stringify({ apply: false }) });
  check("200", prev.status === 200, JSON.stringify(prev.body).slice(0, 120));
  const p = prev.body.data;
  check("返回 changes", Array.isArray(p.changes) && p.changes.length > 0, JSON.stringify(p.changes));
  check("返回 fixed.answer 为末项 x=3", p.fixed && p.fixed.answer === "x=3", JSON.stringify(p.fixed?.answer));
  check("answer ∈ options", p.fixed && p.fixed.options.includes(p.fixed.answer));
  check("healthcheck 通过(clean)", p.clean === true, JSON.stringify(p.remaining));
  check("解析已补全", p.fixed && p.fixed.solution && p.fixed.solution.length > 0);

  console.log("[2] /fix 应用(apply=true) 应落库并重新提交审核");
  const applied = await call(`/questions/${q.id}/fix`, { method: "POST", headers: AUTH, body: JSON.stringify({ apply: true, resubmit: true }) });
  check("200", applied.status === 200, JSON.stringify(applied.body).slice(0, 160));
  check("状态变 PENDING_REVIEW", applied.body.data.status === "PENDING_REVIEW", applied.body.data.status);
  check("返回 fixed.answer=x=3", applied.body.data.fixed?.answer === "x=3", JSON.stringify(applied.body.data.fixed?.answer));

  // 确认库里确实改了
  const dbq = await prisma.question.findUnique({ where: { id: q.id } });
  check("DB answer=x=3", dbq.answer === "x=3", dbq.answer);
  check("DB status=PENDING_REVIEW", dbq.status === "PENDING_REVIEW");
  check("autoFixLog 记录 action=ai-fix", JSON.parse(dbq.autoFixLog || "{}").action === "ai-fix");

  console.log("[3] health 含 llmConfigured 字段(前端据此禁用 AI 按钮)");
  const h = await call("/health");
  check("health.data.llmConfigured 为布尔", typeof h.body.data.llmConfigured === "boolean", JSON.stringify(h.body.data));

  await prisma.question.deleteMany({ where: { source: "DBG-FIX" } });
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
