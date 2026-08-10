// 给两个测试学生灌入测试作业/成绩数据(复用现有试卷,覆盖 我的作业 全部布局区域)
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

const TEACHER_ID = "cmsiqpfmm0001k09rk0fcadei";
const STUDENTS = [
  "cmsn8blrh0008afb8hmtp1ymc", // 测试学生一
  "cmsn8blxg0009afb8t79w72l1", // 测试学生二
];

// 学科卷
const P_TMUA21 = "cmsjs9jos000k1337kyka861l"; // TMUA 2021 P1 EXAM 20Q
const P_TMUA17 = "cmsladx5p000k88r56sk91pgt"; // TMUA 2017 P1 EXAM 20Q
const P_NSAA   = "cmsl5zqpi000lrrwu1mtiougv"; // NSAA Physics PRACTICE 20Q
const P_TMUA19 = "cmsjwe4j300151d4i3hdhqy7e"; // TMUA 2019 P1 EXAM 20Q

// 语言卷
const L_READ_SAMPLE = "cmslnhdwk000um224q9e3unfo"; // 雅思阅读模考 Sample READING 14Q
const L_LISTEN = "cmslq1byq000b2gd00h6kwnaa";      // 雅思听力样题 LISTENING 6Q
const L_WRITE  = "cmslq1byy000c2gd04s2rd6xm";      // 雅思写作样题 WRITING 2Q
const L_READ_E2E = "cmslm4gjs0007398kbilnkt8v";    // E2E 雅思阅读测试卷 READING 3Q

const HOUR = 3600 * 1000;
const now = Date.now();

async function paperInfo(id) {
  return p.paper.findUnique({ where: { id }, select: { title: true, questionIds: true, mode: true } });
}
async function lpInfo(id) {
  return p.languagePaper.findUnique({ where: { id }, select: { title: true, examType: true, skill: true, questionIds: true, mode: true } });
}
async function questionAnswers(ids) {
  const qs = await p.question.findMany({ where: { id: { in: ids } }, select: { id: true, answer: true, options: true } });
  return new Map(qs.map((q) => [q.id, q.answer]));
}
async function lqAnswers(ids) {
  const qs = await p.languageQuestion.findMany({ where: { id: { in: ids } }, select: { id: true, answer: true } });
  return new Map(qs.map((q) => [q.id, q.answer]));
}

// 创建一份作业 + 目标学生记录;若 sub 为真,同时生成已提交会话与作答记录
async function seedSubjectAssignment(studentId, paperId, title, mode, dueAt, submitted) {
  const paper = await paperInfo(paperId);
  const ids = JSON.parse(paper.questionIds);
  const total = ids.length;

  const assignment = await p.assignment.create({
    data: { teacherId: TEACHER_ID, paperId, title: title || paper.title, note: null, mode, dueAt, status: "ACTIVE" },
  });

  let sessionId = null;
  let submittedAt = null;
  if (submitted) {
    const correct = Math.max(1, Math.round(total * (0.6 + Math.random() * 0.25)));
    const score = correct; // 单题 1 分
    const session = await p.session.create({
      data: {
        studentId,
        paperId,
        assignmentId: assignment.id,
        mode,
        durationMin: mode === "EXAM" ? 75 : null,
        questionIds: paper.questionIds,
        score,
        total,
        correctCount: correct,
        startedAt: new Date(now - 3 * HOUR),
        submittedAt: new Date(now - 2 * HOUR),
      },
    });
    sessionId = session.id;
    submittedAt = session.submittedAt;

    const answers = await questionAnswers(ids);
    const shuffled = [...ids].sort(() => Math.random() - 0.5);
    const correctSet = new Set(shuffled.slice(0, correct));
    const recs = ids.map((qid) => {
      const isC = correctSet.has(qid);
      const ans = answers.get(qid);
      const selected = isC ? ans : (ans && ans !== "A" ? "A" : "B");
      return { sessionId: session.id, questionId: qid, selected, isCorrect: isC, timeSpent: 30 + Math.floor(Math.random() * 90) };
    });
    await p.answerRecord.createMany({ data: recs });
  }

  await p.assignmentStudent.create({
    data: {
      assignmentId: assignment.id,
      studentId,
      status: submitted ? "SUBMITTED" : "PENDING",
      sessionId,
      submittedAt,
    },
  });
}

async function seedLangAssignment(studentId, lpId, title, mode, dueAt, submitted) {
  const lp = await lpInfo(lpId);
  const ids = JSON.parse(lp.questionIds);
  const total = ids.length;

  const assignment = await p.assignment.create({
    data: { teacherId: TEACHER_ID, languagePaperId: lpId, title: title || lp.title, note: null, mode, dueAt, status: "ACTIVE" },
  });

  let sessionId = null;
  let submittedAt = null;
  if (submitted) {
    const correct = Math.max(1, Math.round(total * (0.55 + Math.random() * 0.3)));
    const score = correct;
    // 雅思客观题 Band 换算(简化):正确率 → 0-9,0.5 进制
    const rate = correct / total;
    const band = Math.min(9, Math.max(4, Math.round((4 + rate * 5) * 2) / 2));
    const session = await p.languageSession.create({
      data: {
        studentId,
        paperId: lpId,
        assignmentId: assignment.id,
        examType: lp.examType,
        skill: lp.skill,
        mode,
        durationMin: mode === "EXAM" ? 60 : null,
        score,
        total,
        correctCount: correct,
        band,
        startedAt: new Date(now - 5 * HOUR),
        submittedAt: new Date(now - 4 * HOUR),
      },
    });
    sessionId = session.id;
    submittedAt = session.submittedAt;

    const answers = await lqAnswers(ids);
    const shuffled = [...ids].sort(() => Math.random() - 0.5);
    const correctSet = new Set(shuffled.slice(0, correct));
    const recs = ids.map((qid) => {
      const isC = correctSet.has(qid);
      const ans = answers.get(qid);
      const selected = isC ? ans : (ans && ans !== "A" ? "A" : "B");
      return { sessionId: session.id, questionId: qid, selected, isCorrect: isC, timeSpent: 40 + Math.floor(Math.random() * 80) };
    });
    await p.languageAnswerRecord.createMany({ data: recs });
  }

  await p.assignmentStudent.create({
    data: {
      assignmentId: assignment.id,
      studentId,
      status: submitted ? "SUBMITTED" : "PENDING",
      sessionId,
      submittedAt,
    },
  });
}

(async () => {
  for (const sid of STUDENTS) {
    const existing = await p.assignmentStudent.count({ where: { studentId: sid } });
    if (existing > 0) {
      console.log(`学生 ${sid} 已有 ${existing} 条作业记录,跳过以免重复。`);
      continue;
    }

    // 笔试
    await seedSubjectAssignment(sid, P_TMUA21, "TMUA 2021 Paper 1(模考)", "EXAM", new Date(now + 6 * HOUR), false); // 紧急
    await seedSubjectAssignment(sid, P_TMUA17, "TMUA 2017 Paper 1", "EXAM", new Date(now + 3 * 24 * HOUR), false); // 普通待完成
    await seedSubjectAssignment(sid, P_NSAA, "NSAA 物理练习", "PRACTICE", null, true); // 往期
    await seedSubjectAssignment(sid, P_TMUA19, "TMUA 2019 Paper 1(模考)", "EXAM", null, true); // 往期

    // 语言
    await seedLangAssignment(sid, L_READ_SAMPLE, "雅思阅读模考 Sample", "PRACTICE", new Date(now + 12 * HOUR), false); // 紧急
    await seedLangAssignment(sid, L_LISTEN, "雅思听力练习", "PRACTICE", new Date(now + 2 * 24 * HOUR), false); // 普通待完成
    await seedLangAssignment(sid, L_WRITE, "雅思写作任务", "PRACTICE", null, true); // 往期
    await seedLangAssignment(sid, L_READ_E2E, "雅思阅读测试卷", "PRACTICE", null, true); // 往期

    console.log(`学生 ${sid} 已灌入 8 份作业(笔试4 + 语言4)。`);
  }
  await p.$disconnect();
  console.log("DONE");
})();
