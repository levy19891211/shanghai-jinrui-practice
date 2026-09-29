// ============================================================
// 年级排序工具 —— 让「班级列表」按 年级从低到高 稳定排列
// ------------------------------------------------------------
// 背景:`Class.grade` 是自由文本(如「高一」「Pre高一」「初三」),
// 直接按字符串排序会出现「高三 < 高二」这类反直觉结果(见 V2.4.117 前的全部班级列表)。
//
// 排序规则(尽力而为的语义排序,任何输入都能得到稳定结果):
//   1. 学段递增:小学 < 初中 < 高中
//   2. 同段内按年级序号递增:高一 < 高二 < 高三
//   3. 衔接年级(Pre高一/预高一)排在对应年级**之前**(高一 → Pre高一 在最前)
//   4. 纯数字年级按国内常见口径折算:1-6→小学段, 7-9→初中段, 10-12→高中段
//   5. 无法识别的年级置后(不参与语义排序),保证不抛错、顺序稳定
// ============================================================

const CN_DIGIT = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const STAGE_KEYWORDS = [
  ["小学", 1],
  ["小", 1],
  ["初中", 2],
  ["初", 2],
  ["高中", 3],
  ["高", 3],
];
const CN_TERM = { 一: 1, 二: 2, 三: 3, 四: 4 };

// 解析年级文本 → { stage, num, pre } 或 null(无法识别)
function parseGrade(raw) {
  let s = String(raw == null ? "" : raw).trim().replace(/\s+/g, "");
  if (!s) return null;

  // 衔接年级前缀:Pre高一 / pre 2 / 预高一 → 视作「对应年级之前」
  let pre = false;
  const preM = s.match(/^(?:pre|预)(.*)$/i);
  if (preM) {
    pre = true;
    s = preM[1];
    if (!s) return { stage: 9, num: 0, pre }; // 只有「预」没写年级 → 归入置后段但排最前
  }

  // 中文年级:高/初/小 + 中文数字(高一、初二、小3)
  for (const [kw, stage] of STAGE_KEYWORDS) {
    if (s.startsWith(kw)) {
      const rest = s.slice(kw.length);
      const first = rest.slice(0, 1);
      const num = CN_DIGIT[first] ?? (Number(rest.match(/^\d{1,2}/)?.[0]) || null);
      return { stage, num: num == null ? 99 : num, pre }; // 只写「高中」没写序号 → 段内最后
    }
  }

  // 纯数字年级:9年级 / Grade 9 / 9 → 折算国内口径
  const d = s.match(/(\d{1,2})/);
  if (d) {
    const n = Number(d[1]);
    if (n >= 1 && n <= 6) return { stage: 1, num: n, pre };
    if (n >= 7 && n <= 9) return { stage: 2, num: n - 6, pre };
    if (n >= 10 && n <= 12) return { stage: 3, num: n - 9, pre };
    return { stage: 9, num: n, pre };
  }

  return null; // 无法识别 → 置后
}

// 年级比较器:低年级在前;Pre 前缀排在同年级之前
function cmpGrade(a, b) {
  const pa = parseGrade(a);
  const pb = parseGrade(b);
  if (!pa && !pb) return 0;
  if (!pa) return 1; // 无法识别的置后
  if (!pb) return -1;
  if (pa.stage !== pb.stage) return pa.stage - pb.stage;
  const na = pa.num - (pa.pre ? 0.5 : 0);
  const nb = pb.num - (pb.pre ? 0.5 : 0);
  if (na !== nb) return na - nb;
  if (pa.pre !== pb.pre) return pa.pre ? -1 : 1;
  return 0;
}

// 学期排序键:第一学期 < 第二学期 < …(不走拼音排序,避免「第二学期」跑到最前)
function termSortKey(term) {
  const m = String(term == null ? "" : term).match(/第?([一二三四五六])学期/);
  if (m) return CN_TERM[m[1]] ?? 99;
  return 99;
}

// 班级列表排序:学年(新→旧) → 年级(低→高) → 班级名(自然序,高一2班 在 高一10班 前) → 学期
function sortClassesByGrade(list) {
  return list.slice().sort((a, b) => {
    const ya = String(a.academicYear || "");
    const yb = String(b.academicYear || "");
    if (ya !== yb) return yb.localeCompare(ya);

    const ga = cmpGrade(a.grade || a.name, b.grade || b.name);
    if (ga !== 0) return ga;

    const na = String(a.name || "");
    const nb = String(b.name || "");
    if (na !== nb) return na.localeCompare(nb, "zh-Hans-CN", { numeric: true });

    return termSortKey(a.term) - termSortKey(b.term);
  });
}

export { parseGrade, cmpGrade, termSortKey, sortClassesByGrade };
export default sortClassesByGrade;
