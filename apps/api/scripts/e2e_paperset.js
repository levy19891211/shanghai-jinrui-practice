// 端到端自测:套题自动组卷 + 试卷管理 + 退回题一键修正
// 用法:node scripts/e2e_paperset.js   (需本地 API 运行在 4000)
const BASE = process.env.API || "http://localhost:4000/api";

let pass = 0;
let fail = 0;
function check(name, cond, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

async function call(token, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  return j;
}

async function login(email) {
  const r = await call(null, "POST", "/auth/login", { email, password: "123456" });
  if (r.code !== 0) throw new Error(`登录失败 ${email}: ${r.message}`);
  return r.data.token;
}

const TAG = `E2E-${Date.now()}`;

async function main() {
  const t = await login("teacher@example.com");
  const s = await login("stu@example.com");

  // ---------- 1. 套题批量导入 → 自动组卷 ----------
  console.log("\n[1] 套题录入自动组卷");
  const items = [1, 2, 3].map((i) => ({
    subject: "TMUA",
    paper: `${TAG} Paper 1`,
    topic: "代数",
    difficulty: 3,
    type: "SINGLE_CHOICE",
    stem: i === 2 ? "<b>解方程</b> $x^2-5x+6=0$ ,求较大根" : `第 ${i} 题:计算 $${i}+${i}$`,
    options: i === 2 ? ["2", "3", "5", "6"] : [`${i * 2}`, `${i * 2 + 1}`, `${i * 2 + 2}`, `${i * 2 + 3}`],
    answer: i === 2 ? "3" : `${i * 2}`,
    solution: "略",
    source: TAG,
  }));
  const imp = await call(t, "POST", "/questions/import", { items });
  check("导入成功 3 题", imp.data?.imported === 3, JSON.stringify(imp).slice(0, 200));
  check("自动识别为 1 套题", imp.data?.papers?.length === 1, JSON.stringify(imp.data?.papers));
  const paperId = imp.data?.papers?.[0]?.id;
  check("返回试卷 id", !!paperId);
  console.log(`    → ${imp.message}`);

  // ---------- 2. 自动成卷 ≠ 自动发布 ----------
  console.log("\n[2] 自动成卷但不自动发布");
  const tp = await call(t, "GET", "/papers");
  const mine = tp.data.list.find((p) => p.id === paperId);
  check("老师能看到该卷", !!mine);
  check("卷状态为 DRAFT(待审核完成)", mine?.status === "DRAFT", mine?.status);
  check("origin = AUTO_SET", mine?.origin === "AUTO_SET", mine?.origin);
  check("审核进度 0/3", mine?.stats?.published === 0 && mine?.stats?.total === 3, JSON.stringify(mine?.stats));
  check("3 题均为待审核", mine?.stats?.pending === 3, JSON.stringify(mine?.stats));

  const sp = await call(s, "GET", "/papers");
  check("学生看不到未审完的卷", !sp.data.list.some((p) => p.id === paperId));
  const sDetail = await call(s, "GET", `/papers/${paperId}`);
  check("学生直接访问该卷被拒绝(403)", sDetail.code === 403, `code=${sDetail.code}`);

  // ---------- 3. 试卷管理视图 ----------
  console.log("\n[3] 试卷查阅与管理");
  const mg = await call(t, "GET", `/papers/${paperId}/manage`);
  check("manage 返回 3 道题", mg.data?.questions?.length === 3, mg.data?.questions?.length);
  check("逐题带状态", mg.data?.questions?.every((q) => q.status === "PENDING_REVIEW"));
  check("选项已解析为数组", Array.isArray(mg.data?.questions?.[0]?.options));

  const rn = await call(t, "PATCH", `/papers/${paperId}`, { title: `${TAG} 改名后的卷` });
  check("改名成功", rn.code === 0 && rn.data?.title?.includes("改名后"), rn.message);

  const arch = await call(t, "PATCH", `/papers/${paperId}`, { status: "ARCHIVED" });
  check("下架成功", arch.data?.status === "ARCHIVED", arch.data?.status);
  const unarch = await call(t, "PATCH", `/papers/${paperId}`, { status: "ACTIVE" });
  check("恢复上架回到 DRAFT", unarch.data?.status === "DRAFT", unarch.data?.status);

  const byPaper = await call(t, "GET", `/questions?paperId=${paperId}&pageSize=50`);
  check("按试卷筛选题目可用", byPaper.data?.total === 3, byPaper.data?.total);
  check("老师列表返回 answer 字段", !!byPaper.data?.list?.[0]?.answer);

  // ---------- 4. 退回 + 一键修正 ----------
  console.log("\n[4] 退回题目一键自动修正");
  const dirty = byPaper.data.list.find((q) => q.stem.includes("<b>"));
  check("找到含脏 HTML 的题", !!dirty);
  const rej = await call(t, "POST", `/questions/${dirty.id}/review`, { action: "reject", note: "题干里混入了 HTML 标签,渲染异常" });
  check("驳回成功", rej.code === 0, rej.message);

  const preview = await call(t, "POST", `/questions/${dirty.id}/autofix`, { apply: false });
  check("预览返回修正方案", preview.code === 0 && preview.data.fixes.length > 0, JSON.stringify(preview.data?.fixes)?.slice(0, 200));
  check("按退回原因定向命中", preview.data?.noteMatched === true, JSON.stringify(preview.data?.targetedCodes));
  check("预览不落库(applied=false)", preview.data?.applied === false);
  console.log(`    → ${preview.message};修正项:${preview.data.fixes.map((f) => f.label).join("、")}`);

  const still = await call(t, "GET", `/questions/${dirty.id}`);
  check("dry-run 后题干未被修改", still.data?.stem?.includes("<b>"), still.data?.stem);

  const applied = await call(t, "POST", `/questions/${dirty.id}/autofix`, { apply: true, resubmit: true });
  check("落库成功", applied.data?.applied === true, applied.message);
  check("修正后重新进入待审核", applied.data?.status === "PENDING_REVIEW", applied.data?.status);
  check("修正后体检通过", applied.data?.clean === true, JSON.stringify(applied.data?.remaining));
  const after = await call(t, "GET", `/questions/${dirty.id}`);
  check("HTML 标签已清除", !/<b>/.test(after.data?.stem || ""), after.data?.stem);
  console.log(`    → ${applied.message}`);

  // 批量体检
  const batch = await call(t, "POST", "/questions/autofix/batch", { status: "REJECTED", apply: false });
  check("批量体检接口可用", batch.code === 0 || batch.message?.includes("没有符合条件"), batch.message);

  // ---------- 5. 全部审核通过 → 卷变 READY ----------
  console.log("\n[5] 逐题审核通过后整卷开放");
  const all = await call(t, "GET", `/questions?paperId=${paperId}&pageSize=50`);
  let lastMsg = "";
  for (const q of all.data.list) {
    if (q.status === "PUBLISHED") continue;
    const r = await call(t, "POST", `/questions/${q.id}/review`, { action: "approve" });
    lastMsg = r.message;
  }
  console.log(`    → ${lastMsg}`);
  const tp2 = await call(t, "GET", "/papers");
  const mine2 = tp2.data.list.find((p) => p.id === paperId);
  check("整卷转为 READY", mine2?.status === "READY", mine2?.status);
  check("审核进度 3/3", mine2?.stats?.published === 3, JSON.stringify(mine2?.stats));

  const sp2 = await call(s, "GET", "/papers");
  check("学生现在能看到该卷", sp2.data.list.some((p) => p.id === paperId));
  const sd2 = await call(s, "GET", `/papers/${paperId}`);
  check("学生可取到卷内 3 题", sd2.data?.questions?.length === 3, sd2.data?.questions?.length);
  check("学生拿不到答案字段", sd2.data?.questions?.every((q) => q.answer === undefined));

  // ---------- 6. 单题续录并入同一套 ----------
  console.log("\n[6] 单题续录自动并入同一套题");
  const one = await call(t, "POST", "/questions", {
    subject: "TMUA",
    paper: `${TAG} Paper 1`,
    topic: "代数",
    difficulty: 3,
    type: "SINGLE_CHOICE",
    stem: "第 4 题:计算 $4+4$",
    options: ["6", "7", "8", "9"],
    answer: "8",
    source: TAG,
  });
  check("单题创建成功", one.code === 0, one.message);
  const tp3 = await call(t, "GET", "/papers");
  const mine3 = tp3.data.list.find((p) => p.id === paperId);
  check("并入原卷(题数 4)", mine3?.stats?.total === 4, JSON.stringify(mine3?.stats));
  check("新题未审 → 整卷退回 DRAFT", mine3?.status === "DRAFT", mine3?.status);
  const sp3 = await call(s, "GET", "/papers");
  check("学生此时又看不到该卷", !sp3.data.list.some((p) => p.id === paperId));
  console.log(`    → ${one.message}`);

  // ---------- 7. 清理 ----------
  console.log("\n[7] 清理测试数据");
  const del = await call(t, "DELETE", `/papers/${paperId}`);
  check("删除试卷成功", del.code === 0, del.message);
  const admin = t; // 老师无删题权限,直接用 prisma 清
  void admin;

  console.log(`\n===== 通过 ${pass} 项,失败 ${fail} 项 =====`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("测试异常:", e);
  process.exit(1);
});
