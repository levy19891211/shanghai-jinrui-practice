// 雅思评分引擎(V2.4.126)
// ------------------------------------------------------------------
// 存在的唯一理由:**让 Band 只有一个来源**。
// 历史上出现过三套口径并存:
//   ① language.js 里硬编码的 LISTENING_BAND 比例查表
//   ② LangGrowthPanel.tsx 里前端自算的 estimateBand 阶梯
//   ③ teacher 侧 grade 接口里手写的 Math.round(avg*2)/2
// 三者互不相等 ⇒ 同一份作答在不同页面读出不同 Band(审查报告 G2 / H2)。
// 本模块之后,所有 Band 一律由此产出,并随 scoringVersion 落库以便追溯。
//
// 设计约束:
//   - 纯函数为主,只在需要读换算表时触碰数据库,且带兜底常量(库异常也不 500)
//   - 对既有数据零写入;所有 Rx/重算都必须由调用方显式触发
import { prisma } from "./db.js";

// 评分口径版本:任何算分逻辑变更都必须 +1,否则历史会话无法追溯
export const SCORING_VERSION = "2026.09-p1";

// 四维量表版本(写作 / 口语)
export const RUBRIC_VERSION = "ielts-4dim-v1";

export const SUBJECTIVE_QTYPES = ["TASK1", "TASK2", "PART1", "PART2", "PART3"];
export const OBJECTIVE_QTYPES = [
  "FILL_BLANK", "SINGLE_CHOICE", "MULTIPLE_CHOICE", "MATCHING",
  "HEADING", "TRUE_FALSE_NG", "YES_NO_NG",
];

// 写作四维 / 口语四维
export const WRITING_DIMS = ["TR", "CC", "LR", "GRA"];
export const SPEAKING_DIMS = ["FC", "LR", "GRA", "Pron"];
export const DIM_LABEL = {
  TR: "任务回应 Task Response", CC: "连贯衔接 Coherence & Cohesion",
  LR: "词汇资源 Lexical Resource", GRA: "语法多样与准确 Grammatical Range & Accuracy",
  FC: "流利与连贯 Fluency & Coherence", Pron: "发音 Pronunciation",
};

// 技能 → 四维维度(写作走 TR,口语走 FC,其余两项同名)
export function dimsForSkill(skill) {
  return skill === "WRITING" ? WRITING_DIMS : SPEAKING_DIMS;
}

// ——————————————————————————————————————————————
// 1. Band 换算表:可配置、听读分离、版本化
// ——————————————————————————————————————————————

// 官方 IELTS 学术类近似阈值:每项为 [最低原始分, 对应 Band],按 raw 降序排列
// 听力:40→9, 39→8.5, 37→8, 35→7.5, 32→7, 30→6.5, 26→6, 23→5.5, 18→5, 16→4.5, 13→4, 10→3.5, 8→3, 6→2.5, 4→2
const LISTENING_DEFAULT_ROWS = [
  [40, 9], [39, 8.5], [37, 8], [35, 7.5], [32, 7], [30, 6.5], [26, 6],
  [23, 5.5], [18, 5], [16, 4.5], [13, 4], [10, 3.5], [8, 3], [6, 2.5], [4, 2],
];
// 阅读:学术类容错略严,低分段门槛比听力高
const READING_DEFAULT_ROWS = [
  [40, 9], [39, 8.5], [37, 8], [35, 7.5], [32, 7], [30, 6.5], [27, 6],
  [23, 5.5], [19, 5], [15, 4.5], [13, 4], [10, 3.5], [8, 3], [6, 2.5], [4, 2],
];

const DEFAULT_MAX_RAW = 40;

function rowsToJson(pairs) {
  return JSON.stringify(pairs.map(([raw, band]) => ({ raw, band })));
}

// 幂等播种:若某 (examType, skill) 尚无任何换算表,写入官方默认表。
// 已存在则不覆盖 —— 教师改过的表不能被重启抹掉。
export async function ensureDefaultBandTables() {
  const specs = [
    { skill: "LISTENING", pairs: LISTENING_DEFAULT_ROWS, name: "官方默认表·听力" },
    { skill: "READING", pairs: READING_DEFAULT_ROWS, name: "官方默认表·阅读" },
  ];
  for (const s of specs) {
    const exists = await prisma.languageBandTable.count({
      where: { examType: "IELTS", skill: s.skill },
    });
    if (exists > 0) continue;
    await prisma.languageBandTable.create({
      data: {
        examType: "IELTS",
        skill: s.skill,
        name: s.name,
        maxRaw: DEFAULT_MAX_RAW,
        rows: rowsToJson(s.pairs),
        isDefault: true,
      },
    });
  }
}

export function parseRows(rowsStr) {
  try {
    const v = JSON.parse(rowsStr || "[]");
    if (!Array.isArray(v)) return [];
    return v
      .map((r) => ({ raw: Number(r?.raw), band: Number(r?.band) }))
      .filter((r) => Number.isFinite(r.raw) && Number.isFinite(r.band))
      .sort((a, b) => b.raw - a.raw); // 强制降序,防止教师录成升序导致"最低分反拿 9 分"
  } catch {
    return [];
  }
}

export function defaultRowsFor(skill) {
  const pairs = skill === "READING" ? READING_DEFAULT_ROWS : LISTENING_DEFAULT_ROWS;
  return pairs.map(([raw, band]) => ({ raw, band }));
}

// 查表(含兜底):取该 skill 当前生效的默认换算表
// 返回 { rows, maxRaw, source } —— source: "db" | "fallback"(库不可用时明确告知调用方)
export async function loadBandTable(examType = "IELTS", skill = "LISTENING") {
  try {
    const t = await prisma.languageBandTable.findFirst({
      where: { examType, skill, isDefault: true, effectiveFrom: { lte: new Date() } },
      orderBy: { effectiveFrom: "desc" },
    });
    const rows = t ? parseRows(t.rows) : [];
    if (rows.length) return { rows, maxRaw: t.maxRaw || DEFAULT_MAX_RAW, source: "db" };
  } catch {
    // 数据库异常:退回内置常量,保证主流程不 500(与 scheduling.js 的非学术判定同策略)
  }
  return { rows: defaultRowsFor(skill), maxRaw: DEFAULT_MAX_RAW, source: "fallback" };
}

/**
 * 原始分 → Band。
 * 关键修正(审查报告 H3):官方量表**只对 full-length(40 题)有效**,
 * 直接拿 10 题练习卷查 40 题表会系统性虚高。因此:
 *   - total === maxRaw → 直接查表,scaled = false
 *   - total !== maxRaw → 按比例折算到 maxRaw 量纲再查表,scaled = true(诚实披露)
 * 返回 { band, scaled, rawInScale }
 */
export function lookupBand(rows, raw, total, maxRaw) {
  if (!total || total <= 0) return { band: null, scaled: false, rawInScale: null };
  const scaled = Number(maxRaw) > 0 && Number(total) !== Number(maxRaw);
  const rawInScale = scaled ? Math.round((raw / total) * maxRaw) : Math.round(raw);
  for (const row of rows) {
    if (rawInScale >= row.raw) return { band: row.band, scaled, rawInScale };
  }
  // 低于最低阈值:给最低档,而不是像旧代码那样突降到 1.0
  const last = rows[rows.length - 1];
  return { band: last ? last.band : 1.0, scaled, rawInScale };
}

export async function bandFromRaw(examType, skill, raw, total) {
  const { rows, maxRaw } = await loadBandTable(examType, skill);
  return lookupBand(rows, raw, total, maxRaw);
}

// ——————————————————————————————————————————————
// 2. IELTS 官方进位规则
// ——————————————————————————————————————————————

/**
 * 平均后进位到半分:≥.25 进到下一个半分,≥.75 进到下一个整分。
 * 例:6.1→6.0 | 6.25→6.5 | 6.5→6.5 | 6.74→6.5 | 6.75→7.0 | 8.75→9.0
 * 注:Math.round(x*2)/2 与官方规则数学等价(审查报告已核对),此处保留该算式并钳位到 [0,9]。
 */
export function roundIeltsBand(x) {
  if (x === null || x === undefined || !Number.isFinite(Number(x))) return null;
  const v = Math.round(Number(x) * 2) / 2;
  return Math.min(9, Math.max(0, Math.round(v * 10) / 10));
}

// ——————————————————————————————————————————————
// 3. 主观题四维 → 单题 Band
// ——————————————————————————————————————————————

export function parseSubscores(s) {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** 四维平均 → 该题 Band(按 IELTS 半分进位)。缺维度时按已填维度平均。 */
export function bandFromSubscores(skill, obj) {
  if (!obj || typeof obj !== "object") return null;
  const dims = dimsForSkill(skill);
  const vals = dims.map((d) => Number(obj[d])).filter((v) => Number.isFinite(v) && v >= 0 && v <= 9);
  if (vals.length === 0) return null;
  const avg = vals.reduce((a, x) => a + x, 0) / vals.length;
  return roundIeltsBand(avg);
}

// ——————————————————————————————————————————————
// 4. 会话级合成
// ——————————————————————————————————————————————

export function parseSkillBands(s) {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * 由分项 skillBands 合成总分。
 * 规则:只合成**已有 band 且非 null** 的技能;任一应参与的技能仍为 null(待批改)时返回 null。
 * 这是 H1 的根治点 —— 全真卷不再把客观部分丢掉,缺分项就明说"待批改"。
 */
export function composeOverall(skillBands) {
  if (!skillBands || typeof skillBands !== "object") return { overallBand: null, missing: [] };
  const keys = Object.keys(skillBands);
  const missing = keys.filter((k) => skillBands[k] == null || skillBands[k].band == null);
  if (keys.length === 0) return { overallBand: null, missing };
  if (missing.length) return { overallBand: null, missing };
  const vals = keys.map((k) => Number(skillBands[k].band)).filter((v) => Number.isFinite(v));
  if (vals.length !== keys.length) return { overallBand: null, missing };
  const avg = vals.reduce((a, x) => a + x, 0) / vals.length;
  return { overallBand: roundIeltsBand(avg), missing: [] };
}

/** 目标分判定:返回差距最大的技能(供"S 下一步练什么"直接引用) */
export function goalGap(goalBand, skillBands) {
  const target = Number(goalBand);
  if (!Number.isFinite(target) || !skillBands) {
    return { hasGoal: false, reached: null, gap: null, weakest: null, advice: [] };
  }
  const entries = Object.entries(skillBands)
    .filter(([, v]) => v && Number.isFinite(Number(v.band)))
    .map(([k, v]) => ({ skill: k, band: Number(v.band), gap: Number(v.band) - target }));
  const { overallBand } = composeOverall(skillBands);
  const advice = [];
  let weakest = null;
  if (entries.length) {
    entries.sort((a, b) => a.gap - b.gap);
    weakest = entries[0];
    if (weakest.gap < 0) advice.push(`${SKILL_CN[weakest.skill] || weakest.skill} 距目标还差 ${Math.abs(weakest.gap).toFixed(1)} 分,优先补此项`);
  }
  if (overallBand !== null) {
    if (overallBand >= target) advice.push(`已达成目标总分 ${target}(当前 ${overallBand})`);
    else advice.push(`总分距目标还差 ${(target - overallBand).toFixed(1)} 分`);
  }
  return {
    hasGoal: true,
    reached: overallBand !== null ? overallBand >= target : null,
    gap: overallBand !== null ? Math.round((overallBand - target) * 10) / 10 : null,
    weakest: weakest && weakest.gap < 0 ? weakest : null,
    advice,
  };
}

export const SKILL_CN = {
  LISTENING: "听力", READING: "阅读", WRITING: "写作", SPEAKING: "口语", FULL: "全真",
};

// ——————————————————————————————————————————————
// 5. 对外契约(供 GET /scoring-config 与前端展示口径用)
// ——————————————————————————————————————————————

export async function scoringConfig() {
  const tables = [];
  for (const skill of ["LISTENING", "READING"]) {
    const { rows, maxRaw, source } = await loadBandTable("IELTS", skill);
    tables.push({ examType: "IELTS", skill, maxRaw, source, rows });
  }
  return {
    scoringVersion: SCORING_VERSION,
    rubricVersion: RUBRIC_VERSION,
    note: "所有 Band 由后端评分引擎产出,前端不再自行估算",
    roundRule: "四项平均后按 IELTS 规则进位到半分(.25→半分,.75→整分)",
    scaleRule: "题量不等于量表 maxRaw 时按比例折算,并在会话上标记 scaled=true",
    writingDims: WRITING_DIMS.map((d) => ({ key: d, label: DIM_LABEL[d] })),
    speakingDims: SPEAKING_DIMS.map((d) => ({ key: d, label: DIM_LABEL[d] })),
    tables,
  };
}
