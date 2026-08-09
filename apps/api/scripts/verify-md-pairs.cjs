// 扫描全库 stem 含奇数个 $$ 或 $ 的题,退出码 1 表示有问题
// 用法:node scripts/verify-md-pairs.cjs [--quiet]
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
const quiet = process.argv.includes("--quiet");

(async () => {
  const rows = await p.question.findMany({ select: { id: true, paper: true, stem: true } });
  const issues = [];
  for (const r of rows) {
    const stem = r.stem || "";
    const md = (stem.match(/\$\$/g) || []).length;
    const sd = (stem.match(/(?<!\$)\$(?!\$)/g) || []).length;
    if (md % 2 !== 0 || sd % 2 !== 0) {
      issues.push({ id: r.id, paper: r.paper, md, sd });
    }
  }
  if (issues.length) {
    console.error(`VERIFICATION FAILED: ${issues.length} 题 stem 含奇数个 $$ 或 $`);
    for (const x of issues) {
      console.error(`  id=${String(x.id).slice(0, 16)} paper="${x.paper}" $$=${x.md} $=${x.sd}`);
    }
    process.exit(1);
  } else {
    if (!quiet) console.log(`✓ VERIFICATION PASS: ${rows.length} 题 stem $$/$ 配对全部正确`);
    process.exit(0);
  }
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(2);
});
