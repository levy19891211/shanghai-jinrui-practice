#!/bin/bash
echo "=== api-error.log lines 90-180 ==="
sed -n '90,180p' ~/.pm2/logs/api-error.log
echo ""
echo "=== MAT papers/questions in DB ==="
cd /root/shanghai-jinrui-practice/apps/api
cat > /tmp/diag_mat.cjs <<'EOF'
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const papers = await p.paper.findMany({ where: { sourceType: "MAT" }, select: { id: true, title: true, status: true, subject: true, questionIds: true } });
  const qcount = await p.question.count({ where: { sourceType: "MAT" } });
  const qcountSubj = await p.question.count({ where: { subject: "数学", sourceType: "MAT" } });
  console.log("MAT papers:", JSON.stringify(papers));
  console.log("MAT question count (sourceType):", qcount);
  console.log("math+MAT questions:", qcountSubj);
  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
EOF
node /tmp/diag_mat.cjs
rm -f /tmp/diag_mat.cjs
