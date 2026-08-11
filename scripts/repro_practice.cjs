const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  // 1) MAT 卷信息
  const paper = await p.paper.findFirst({ where: { title: { contains: "MAT 2007" } } });
  console.log("PAPER:", paper ? `${paper.title} mode=${paper.mode} durationMin=${paper.durationMin} status=${paper.status}` : "NOT FOUND");
  if (!paper) { await p.$disconnect(); return; }

  // 2) 扫描该卷题目 options 字段是否合法(非 null、是 JSON 数组字符串)
  let ids = [];
  try { ids = JSON.parse(paper.questionIds || "[]"); } catch {}
  const qs = await p.question.findMany({ where: { id: { in: ids } }, select: { id: true, stem: true, options: true, answer: true, topic: true, difficulty: true } });
  let bad = 0;
  const samples = [];
  for (const q of qs) {
    let opts;
    try { opts = JSON.parse(q.options); } catch { opts = "PARSE_FAIL"; }
    const isArr = Array.isArray(opts);
    if (!isArr || opts.length === 0) {
      bad++;
      if (samples.length < 5) samples.push({ id: q.id, optionsType: typeof q.options, parsed: isArr ? `arr[${opts.length}]` : opts, stemHead: (q.stem || "").slice(0, 40) });
    }
  }
  console.log(`题目数=${qs.length} options 异常=${bad}`);
  samples.forEach((s) => console.log("  BAD:", JSON.stringify(s)));

  // 3) 全库扫描:options 字段为 null 或非合法 JSON 数组的题(任何试卷)
  const all = await p.question.findMany({ select: { id: true, options: true, paper: true } });
  let nullOpts = 0, parseFail = 0, emptyArr = 0, nonStr = 0;
  for (const q of all) {
    if (q.options === null || q.options === undefined) { nullOpts++; continue; }
    if (typeof q.options !== "string") { nonStr++; continue; }
    let v; try { v = JSON.parse(q.options); } catch { parseFail++; continue; }
    if (!Array.isArray(v) || v.length === 0) emptyArr++;
  }
  console.log(`全库扫描: total=${all.length} nullOpts=${nullOpts} nonStr=${nonStr} parseFail=${parseFail} emptyArr=${emptyArr}`);

  await p.$disconnect();
})();
