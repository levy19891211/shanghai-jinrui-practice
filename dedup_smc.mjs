import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const DRY = process.env.DRY_RUN !== 'false'; // 默认 dry-run
console.log('MODE:', DRY ? 'DRY_RUN(不删除)' : 'REAL(执行删除)');

const PAPER = 'SMC 2015 2019';
const qs = await prisma.question.findMany({ where: { paper: PAPER }, orderBy: { createdAt: 'asc' } });

const groups = {};
for (const q of qs) {
  const key = q.stem + '||' + q.options + '||' + q.answer;
  (groups[key] = groups[key] || []).push(q);
}
const dupIds = [];
let uniqueGroups = 0;
for (const arr of Object.values(groups)) {
  uniqueGroups++;
  for (let i = 1; i < arr.length; i++) dupIds.push(arr[i].id);
}
console.log(`paper="${PAPER}" 总数:${qs.length}  唯一题组:${uniqueGroups}  待删重复:${dupIds.length}`);

const recRef = await prisma.answerRecord.count({ where: { questionId: { in: dupIds } } });
const wbRef  = await prisma.wrongBook.count({ where: { questionId: { in: dupIds } } });
const favRef = await prisma.favoriteQuestion.count({ where: { questionId: { in: dupIds } } });
console.log(`引用检查 -> AnswerRecord:${recRef}  WrongBook:${wbRef}  Favorite:${favRef}`);

if (DRY) {
  console.log('DRY_RUN 结束,样例待删 id:', dupIds.slice(0, 5));
  await prisma.$disconnect();
  process.exit(0);
}
if (recRef || wbRef || favRef) { console.log('ABORT: 待删题被引用,停止以防破坏'); process.exit(1); }

const del = await prisma.question.deleteMany({ where: { id: { in: dupIds } } });
console.log('已删除:', del.count);

const remaining = await prisma.question.findMany({ where: { paper: PAPER }, select: { id: true } });
const ids = remaining.map(r => r.id);
const p1 = await prisma.paper.findFirst({ where: { title: 'SMC 真题 1' } });
await prisma.paper.update({ where: { id: p1.id }, data: { questionIds: JSON.stringify(ids) } });
console.log('套题 "SMC 真题 1" 更新后题数:', ids.length);
await prisma.$disconnect();
