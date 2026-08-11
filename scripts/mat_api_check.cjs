const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
function loadEnv() {
  const f = path.join(__dirname, ".env");
  const txt = fs.readFileSync(f, "utf8");
  const m = {};
  for (const line of txt.split("\n")) {
    const mm = line.match(/^([A-Z0-9_]+)=(.+)$/);
    if (mm) m[mm[1]] = mm[2].trim().replace(/^["']|["']$/g, "");
  }
  return m;
}
(async () => {
  const env = loadEnv();
  const secret = env.JWT_SECRET;
  const teacher = await p.user.findFirst({ where: { email: "teacher@example.com" } });
  if (!teacher) { console.log("teacher 账户不存在"); await p.$disconnect(); return; }
  const token = jwt.sign({ sub: teacher.id, role: teacher.role, email: teacher.email }, secret, { expiresIn: "1h" });
  const url = "http://localhost:4000/api/questions?sourceType=MAT&pageSize=3";
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  console.log("HTTP", res.status);
  console.log("total:", data.total);
  for (const q of (data.list || [])) {
    console.log(`id=${q.id}  status=${q.status}  sourceType=${q.sourceType}  paper=${q.paper}`);
  }
  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
