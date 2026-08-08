// 预置 A Level 基础数学/物理/化学/生物的主要知识点(幂等:只新增不存在的,不覆盖老师已建的/改过的)
// 运行:npm run seed:knowledge 或 node scripts/seed_knowledge.js
import "dotenv/config";
import { prisma } from "../src/lib/db.js";

const KNOWLEDGE = {
  数学: [
    "代数与函数", "二次函数与方程", "坐标几何", "数列与级数", "二项式展开",
    "指数与对数", "三角学", "微分", "积分", "数值方法", "向量",
    "统计", "概率", "力学",
  ],
  物理: [
    "物理量与单位", "运动学", "动力学与牛顿定律", "功、能量与功率", "动量与碰撞",
    "材料与固体变形", "波的性质", "驻波与干涉", "光的衍射", "电路",
    "电场", "磁场与电磁感应", "电容", "热学", "理想气体",
    "量子物理", "粒子物理", "核物理", "天体物理",
  ],
  化学: [
    "原子结构", "化学计量学与摩尔", "化学键", "氧化还原反应", "能量学与焓变",
    "反应速率", "化学平衡", "酸碱平衡", "电化学", "周期表与周期律",
    "元素化学", "过渡金属", "有机化学基础", "烃", "卤代烃",
    "醇", "羰基化合物", "羧酸与酯", "含氮化合物", "聚合物", "分析化学",
  ],
  生物: [
    "细胞结构", "生物分子", "酶", "细胞膜与物质转运", "细胞分裂",
    "DNA与蛋白质合成", "遗传与变异", "基因工程", "生态学", "生物多样性与分类",
    "循环系统", "呼吸与气体交换", "消化系统", "神经系统", "内分泌与激素",
    "免疫系统", "植物生理", "排泄与稳态", "进化",
  ],
};

let added = 0;
for (const [subject, names] of Object.entries(KNOWLEDGE)) {
  const rows = names.map((name, i) => ({ subject, name, sortOrder: i + 1 }));
  const res = await prisma.knowledgePoint.createMany({ data: rows, skipDuplicates: true });
  added += res.count;
}
const total = await prisma.knowledgePoint.count();
console.log(`预置完成:新增 ${added} 个,跳过(已存在) ${Object.values(KNOWLEDGE).reduce((a, n) => a + n.length, 0) - added} 个,库内共 ${total} 个知识点`);
await prisma.$disconnect();
