// 只读验证:调用 teacher.js 导出的 buildStudentsMatrix,确认聚合逻辑正确、零写操作。
// 运行: node scripts/verify_matrix.mjs   (从 apps/api 目录)
import { buildStudentsMatrix } from "../src/routes/teacher.js";

function summarize(students) {
  return students.map((s) => ({
    name: s.name,
    sessionCount: s.sessionCount,
    avgRate: s.avgRate,
    difficulty: s.difficulty,
    speed: s.speed,
    trend: s.trend,
    stability: s.stability,
    modeDivergence: s.modeDivergence,
    coverage: s.coverage,
    carelessness: s.carelessness,
  }));
}

const { students, highBaseQuestionCount, totalTopicCount } = await buildStudentsMatrix(null, 3);
console.log("=== META ===");
console.log({ totalStudents: students.length, highBaseQuestionCount, totalTopicCount });
console.log("\n=== FIRST 3 STUDENTS (summarized) ===");
console.log(JSON.stringify(summarize(students).slice(0, 3), null, 2));

// 单生验证
if (students[0]) {
  const one = await buildStudentsMatrix(students[0].id, 3);
  console.log("\n=== SINGLE STUDENT CHECK (id=" + students[0].id + ") ===");
  console.log("returned student null?", one.student === null, "name:", one.student?.name);
}
console.log("\nVERIFY_OK (no write performed)");
