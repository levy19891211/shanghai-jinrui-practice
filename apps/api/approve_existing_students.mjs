// 一次性脚本:将存量 STUDENT 账号刷为 APPROVED,避免 db:push 后默认 PENDING 把他们锁在门外。
// 运行:npx prisma db:push 之后,node approve_existing_students.mjs (在 apps/api 目录)
import "dotenv/config";
import { prisma } from "./src/lib/db.js";

const r = await prisma.user.updateMany({
  where: { role: "STUDENT", status: "PENDING" },
  data: { status: "APPROVED" },
});
console.log(`已将 ${r.count} 名存量学生账号置为 APPROVED`);

const remaining = await prisma.user.count({ where: { role: "STUDENT", status: "PENDING" } });
console.log(`剩余待审核学生: ${remaining}`);
await prisma.$disconnect();
