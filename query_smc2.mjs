import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const q = await prisma.question.findMany({ where: { paper: 'SMC 2015 2019' } });
console.log('paper="SMC 2015 2019" 题数:', q.length);

// 1) 按导入时间分布
const byImport = {};
for (const x of q) { const k = String(x.importedAt||'').slice(0,19); byImport[k] = (byImport[k]||0)+1; }
console.log('\n[按 importedAt 分布]');
console.log(JSON.stringify(byImport, null, 2));

// 2) subject 分布(是否还有脏数据)
const bySubj = {};
for (const x of q) { const k = x.subject; bySubj[k] = (bySubj[k]||0)+1; }
console.log('\n[subject 分布]', JSON.stringify(bySubj));

// 3) 重复题检测(相同 stem)
const stemMap = {};
for (const x of q) { const s = x.stem||''; stemMap[s] = (stemMap[s]||0)+1; }
const dups = Object.entries(stemMap).filter(([s,c]) => c>1);
console.log('\n[重复 stem 组数]:', dups.length, ' 涉及题数:', dups.reduce((a,[,c])=>a+c,0));
for (const [s,c] of dups.slice(0,5)) console.log(`  重复 ${c} 次: ${s.slice(0,60)}...`);

// 4) Topic 分布(是否混了多知识点)
const byTopic = {};
for (const x of q) { const k = x.topic||'(空)'; byTopic[k] = (byTopic[k]||0)+1; }
console.log('\n[topic 分布]', JSON.stringify(byTopic, null, 2));
