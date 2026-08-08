// 存量题库自动归类到知识点
// 1) 清理 E2E 测试残留题(paper/source 含 "E2E")
// 2) 按 topic 内容用关键词规则 + 英文 token 匹配归类到知识点库(可多标签)
// 3) 未匹配的留白(显示"待归类"),由老师补
// 运行:npm run classify:existing 或 node scripts/classify_existing.js
import "dotenv/config";
import { prisma } from "../src/lib/db.js";

// —— 中文/关键词 → 知识点 规则(优先级从上到下;可多命中=多标签) ——
const RULES = [
  { subject: "数学", re: /二次|quadratic/, kp: "Quadratics" },
  { subject: "数学", re: /二项式|binomial/, kp: "Binomial Expansion" },
  { subject: "数学", re: /坐标|几何|geometry/, kp: "Coordinate Geometry" },
  { subject: "数学", re: /数列|级数|递推|sequence|series/, kp: "Sequences and Series" },
  { subject: "数学", re: /指数|对数|log|exponential/, kp: "Exponentials and Logarithms" },
  { subject: "数学", re: /三角|trig|sin|cos|tan/, kp: "Trigonometry" },
  { subject: "数学", re: /微分|导数|单调|differenti|gradient|normal|tangent|rate of change/, kp: "Differentiation" },
  { subject: "数学", re: /积分|integral|integration|area/, kp: "Integration" },
  { subject: "数学", re: /数值|numerical|trapezium/, kp: "Numerical Methods" },
  { subject: "数学", re: /向量|vector/, kp: "Vectors" },
  { subject: "数学", re: /概率|probability/, kp: "Probability" },
  { subject: "数学", re: /统计|statistics/, kp: "Statistics" },
  { subject: "数学", re: /代数|方程|多项式|factor|algebra/, kp: "Algebra and Functions" },
  { subject: "数学", re: /力学|mechanic/, kp: "Mechanics" },
  { subject: "物理", re: /运动|kinematic|motion/, kp: "Kinematics" },
  { subject: "物理", re: /能量|energy|work|power/, kp: "Work, Energy and Power" },
  { subject: "物理", re: /电路|circuit|current|voltage/, kp: "Electric Circuits" },
  { subject: "化学", re: /键|bonding/, kp: "Chemical Bonding" },
  { subject: "化学", re: /平衡|equilibrium/, kp: "Chemical Equilibrium" },
  { subject: "化学", re: /有机|organic|hydrocarbon/, kp: "Organic Chemistry Basics" },
  { subject: "生物", re: /细胞|cell/, kp: "Cell Structure" },
  { subject: "生物", re: /酶|enzyme/, kp: "Enzymes" },
  { subject: "生物", re: /遗传|gene|genetic/, kp: "Genetics and Variation" },
];

// token 交集兜底:英文 topic 与知识点名共享核心词则匹配(如 "Sequences & Series" ↔ "Sequences and Series")
function tokens(s) {
  return String(s || "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
}
function tokenIntersect(topic, kpName) {
  const a = tokens(topic);
  const b = tokens(kpName);
  if (!a.length || !b.length) return false;
  return a.some((t) => b.includes(t)) || b.some((t) => a.includes(t));
}

// 1) 清理测试残留
const residual = await prisma.question.deleteMany({
  where: { OR: [{ paper: { contains: "E2E" } }, { source: { contains: "E2E" } }] },
});
console.log(`[1] 清理 E2E 测试残留: ${residual.count} 题`);

// 2) 加载知识点库
const allKps = await prisma.knowledgePoint.findMany();
const kpBySubject = new Map();
for (const k of allKps) {
  if (!kpBySubject.has(k.subject)) kpBySubject.set(k.subject, []);
  kpBySubject.get(k.subject).push(k);
}

// 3) 归类
const qs = await prisma.question.findMany({ select: { id: true, subject: true, topic: true } });
let classified = 0;
let blank = 0;
const unmatched = new Map(); // topic -> 次数
const kpCount = new Map();
for (const q of qs) {
  const topic = String(q.topic || "").trim();
  if (!topic) { blank++; continue; }
  const pool = kpBySubject.get(q.subject) || [];
  const hitKps = [];
  // 规则匹配
  for (const r of RULES) {
    if (r.subject !== q.subject) continue;
    if (r.re.test(topic)) {
      const kp = pool.find((k) => k.name === r.kp);
      if (kp && !hitKps.some((h) => h.id === kp.id)) hitKps.push(kp);
    }
  }
  // token 交集兜底
  if (!hitKps.length) {
    for (const k of pool) {
      if (tokenIntersect(topic, k.name)) { hitKps.push(k); break; }
    }
  }
  if (hitKps.length) {
    const ids = hitKps.map((k) => k.id);
    await prisma.question.update({
      where: { id: q.id },
      data: { topicIds: JSON.stringify(ids), topic: hitKps[0].name },
    });
    classified++;
    for (const k of hitKps) kpCount.set(k.name, (kpCount.get(k.name) || 0) + 1);
  } else {
    blank++;
    unmatched.set(topic, (unmatched.get(topic) || 0) + 1);
  }
}

console.log(`[2] 归类结果: 共 ${qs.length} 题,自动归类 ${classified} 题,留白 ${blank} 题`);
console.log(`[3] 各知识点题数:`);
[...kpCount.entries()].sort((a, b) => b[1] - a[1]).forEach(([n, c]) => console.log(`  ${n}: ${c}`));
console.log(`[4] 未匹配留白的 topic:`);
[...unmatched.entries()].sort((a, b) => b[1] - a[1]).forEach(([t, c]) => console.log(`  ${c}× ${t}`));
await prisma.$disconnect();
