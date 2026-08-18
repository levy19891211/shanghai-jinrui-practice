// 扫描所有已生成解析,找出含"试错/错误推导"特征短语的题目 ID,写入 /root/.cache/regen_hits.txt
// 运行:node scripts/find_rambling.mjs
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";

const p = new PrismaClient();
const pats = [
  "不在选项中", "重新理解", "不在选项", "我们先", "试一下", "发现不对", "先得到",
  "但此频率", "但此值", "然而这", "其实应该", "换一种思路", "再检查", "发现错误",
  "这条路", "此路", "不符", "与选项", "选项中没有", "选项中无",
];
const rows = await p.question.findMany({
  where: { solution: { not: null } },
  select: { id: true, solution: true },
});
const out = rows
  .filter((r) => pats.some((t) => (r.solution || "").includes(t)))
  .map((r) => r.id);
fs.writeFileSync("/root/.cache/regen_hits.txt", out.join("\n"));
console.log("HITS=" + out.length);
await p.$disconnect();
