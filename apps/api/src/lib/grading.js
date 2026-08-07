// 判分引擎
// 规则:答对得 1 分,答错得 0 分(TMUA/ESAT 现行规则,答错不扣分)

/**
 * 判断单题作答是否正确
 * @param {{ type: string, answer: string }} question
 * @param {string|null|undefined} selected
 * @returns {boolean}
 */
export function isAnswerCorrect(question, selected) {
  if (selected == null || selected === "") return false;
  const a = String(question.answer).trim();
  const s = String(selected).trim();
  if (question.type === "NUMERIC") {
    // 数值题:容忍 ±0.01 误差
    const na = Number(a);
    const ns = Number(s);
    if (Number.isNaN(na) || Number.isNaN(ns)) return a === s;
    return Math.abs(na - ns) <= 0.01;
  }
  if (question.type === "MULTIPLE_CHOICE") {
    // 多选:选项集合完全一致(逗号/空格分隔)
    const norm = (x) => x.split(/[, ]+/).map((v) => v.trim()).filter(Boolean).sort().join(",");
    return norm(a) === norm(s);
  }
  return a === s;
}

/**
 * 汇总判分
 * @param {Array<{ question, selected }>} answers
 * @returns {{ score: number, total: number, correctCount: number, details: Array<{questionId, selected, isCorrect}> }}
 */
export function grade(answers) {
  const details = answers.map(({ question, selected }) => ({
    questionId: question.id,
    selected: selected ?? null,
    isCorrect: isAnswerCorrect(question, selected),
  }));
  const correctCount = details.filter((d) => d.isCorrect).length;
  return {
    score: correctCount,
    total: details.length,
    correctCount,
    details,
  };
}
