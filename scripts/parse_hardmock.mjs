// 解析 "TMUA Paper X Hard Mock V2（中文解析版）" 格式 HTML -> bank JSON
// 用法: node scripts/parse_hardmock.mjs <html> <P1|P2> <SRC_PREFIX> <out.json> <title>
// 特点: 数学已为 $...$（无需转换）；meta 为 <span class="question-meta">Topics: MM5, M4 | Difficulty: d5</span>
//       solution 使用 **markdown加粗** + <br>，需转成 <b>...</b> 以符合库内约定
import fs from "node:fs";

const [, , htmlPath, kindCode, srcPrefix, outPath, titleArg] = process.argv;
if (!htmlPath || !kindCode || !srcPrefix || !outPath || !titleArg) {
  console.error("用法: node parse_hardmock.mjs <html> <P1|P2> <SRC_PREFIX> <out.json> <title>");
  process.exit(1);
}

// ---- MM/M 考纲代码 -> KnowledgePoint cuid（生产库实测）----
const KP = {
  ALG: "cmsjufgkm0000c3kl7c6k2gcc", // Algebra and Functions
  QUAD: "cmsjufgkm0001c3klb3awcpby", // Quadratics
  COORD: "cmsjufgkm0002c3kl7fpaqb71", // Coordinate Geometry
  SEQ: "cmsjufgkm0003c3klc9gs68sl", // Sequences and Series
  BINOM: "cmsjufgkm0004c3klejf1w1e7", // Binomial Expansion
  EXPLOG: "cmsjufgkm0005c3klm47guwnz", // Exponentials and Logarithms
  TRIG: "cmsjufgkm0006c3kljd48l52i", // Trigonometry
  DIFF: "cmsjufgkm0007c3kll61gocbw", // Differentiation
  INTEG: "cmsjufgkm0008c3klkoxagk5d", // Integration
  NUMM: "cmsjufgkm0009c3kl8knfdr15", // Numerical Methods
  STAT: "cmsjufgkm000bc3kl6lkk6gp1", // Statistics
  PROB: "cmsjufgkm000cc3klb33q16c2", // Probability
  GRAPH: "cmsjuluoc0005pq8kmmjysbw0", // Graphs
  GEOM: "cmsjumbbs0006pq8kkiyhzxn2", // Geometry
  NUM: "cmsjutnu10007pq8kvjd1b3lx", // Numbers and Sets
  LOGIC: "cmsjux7x00008pq8k3ubohwr6", // Logic and Proof
  COMB: "cmszor26s000rcqp21da4sfgr", // Combinatorics
};
const KP_NAME = {
  [KP.ALG]: "Algebra and Functions", [KP.QUAD]: "Quadratics",
  [KP.COORD]: "Coordinate Geometry", [KP.SEQ]: "Sequences and Series",
  [KP.BINOM]: "Binomial Expansion", [KP.EXPLOG]: "Exponentials and Logarithms",
  [KP.TRIG]: "Trigonometry", [KP.DIFF]: "Differentiation",
  [KP.INTEG]: "Integration", [KP.NUMM]: "Numerical Methods",
  [KP.STAT]: "Statistics", [KP.PROB]: "Probability", [KP.GRAPH]: "Graphs",
  [KP.GEOM]: "Geometry", [KP.NUM]: "Numbers and Sets",
  [KP.LOGIC]: "Logic and Proof", [KP.COMB]: "Combinatorics",
};
// TMUA Paper1 "MM" 考纲编码 + ESAT 风格 "M" 编码
const CODE_MAP = {
  MM1: KP.ALG, MM2: KP.SEQ, MM3: KP.COORD, MM4: KP.TRIG,
  MM5: KP.EXPLOG, MM6: KP.DIFF, MM7: KP.INTEG, MM8: KP.GRAPH,
  MM9: KP.PROB, MM10: KP.STAT,
  M1: KP.NUM, M2: KP.GEOM, M3: KP.GEOM, M4: KP.ALG,
  M5: KP.SEQ, M6: KP.DIFF, M7: KP.INTEG, M8: KP.GRAPH,
  Logic: KP.LOGIC, Prf: KP.LOGIC, Arg: KP.LOGIC, Err: KP.LOGIC,
};

const raw = fs.readFileSync(htmlPath, "utf8");

// ---------- 文本清洗工具 ----------
function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
// ⚠️ 关键：本类源文件数学区间内含**裸 <**（如 $25 < 27$，全文 0 个 &lt;）。
// 若先去 HTML 标签，正则 <[^>]+> 会把 "< 27 = 3^3$。因此 $\log_3 5 <" 整段当标签吃掉。
// 因此必须：先把 $...$ / $$...$$ 数学区间替换为占位符 -> 去标签 -> 还原数学 -> 解码实体。
function protectMath(s) {
  const store = [];
  const put = (mm) => { store.push(mm); return `\u0002${store.length - 1}\u0002`; };
  let t = String(s).replace(/\$\$([\s\S]+?)\$\$/g, (mm) => put(mm)); // display 先行
  t = t.replace(/\$([^$]+?)\$/g, (mm) => put(mm)); // 再 inline
  return { t, store };
}
function restoreMath(t, store) {
  return t.replace(/\u0002(\d+)\u0002/g, (_, i) => store[Number(i)] ?? "");
}
// 纯文本字段（题干/选项/答案）
function plain(html) {
  let t = String(html).replace(/<br\s*\/?>/gi, " ");
  const pm = protectMath(t);
  t = pm.t.replace(/<[^>]+>/g, "");
  t = restoreMath(t, pm.store);
  t = decodeEntities(t);
  return t.replace(/\s+/g, " ").trim();
}
// 解析字段：⚠️ 必须输出「纯文本 + \n 换行」，不能带任何 HTML 标签。
// 依据：前端 renderRich(solution,{smart:false}) 用 React 文本节点 + whitespace-pre-wrap 渲染，
//       <b>/<br> 会被转义显示成字面标签；换行只认 \n。全库 92% 题目遵循此约定。
function solutionText(html) {
  let t = String(html);
  t = t.replace(/[ \t]*<br\s*\/?>[ \t]*/gi, "\u0001NL\u0001"); // <br> -> 换行占位
  const pm = protectMath(t); // 保护数学，避免裸 < 被当标签吃掉
  t = pm.t.replace(/<[^>]+>/g, ""); // 去掉所有标签（含 <b>/<strong>）
  t = restoreMath(t, pm.store);
  t = decodeEntities(t);
  t = t.replace(/\*\*([^*\n]+?)\*\*/g, "$1"); // markdown 加粗 -> 纯文本（前端无法渲染）
  t = t.replace(/\u0001NL\u0001/g, "\n");
  t = t.replace(/[ \t]+/g, " ");
  t = t.replace(/\n{3,}/g, "\n\n");
  t = t.split("\n").map((l) => l.trim()).join("\n");
  return t.trim();
}

// ---------- 切分题块 ----------
const blocks = [];
const reQ = /<div class="question"[^>]*id="q(\d+)"[^>]*>/g;
const marks = [];
let m;
while ((m = reQ.exec(raw))) marks.push({ n: Number(m[1]), start: m.index });
for (let i = 0; i < marks.length; i++) {
  const end = i + 1 < marks.length ? marks[i + 1].start : raw.length;
  blocks.push({ n: marks[i].n, html: raw.slice(marks[i].start, end) });
}
if (!blocks.length) { console.error("未找到题块"); process.exit(1); }

const questions = [];
const problems = [];

for (const b of blocks) {
  const num = b.n;
  const metaM = b.html.match(/<span class="question-meta">([\s\S]*?)<\/span>/);
  const stemM = b.html.match(/<div class="stem">([\s\S]*?)<\/div>/);
  const ansM = b.html.match(/<div class="answer">([\s\S]*?)<\/div>/);
  const solM = b.html.match(/<div class="solution-content">([\s\S]*?)<\/div>/);
  const optAll = [...b.html.matchAll(/<li class="option">([\s\S]*?)<\/li>/g)].map((x) => x[1]);

  if (!stemM) { problems.push(`Q${num}: 缺 stem`); continue; }
  if (!ansM) { problems.push(`Q${num}: 缺 answer`); continue; }
  if (optAll.length < 2) { problems.push(`Q${num}: 选项不足 (${optAll.length})`); continue; }

  const stem = plain(stemM[1]);
  // 选项去 "A. " 前缀
  const options = optAll.map((o) => plain(o).replace(/^[A-H][\.、\)]\s*/, ""));
  // 答案去 "Answer:" 前缀
  let answer = plain(ansM[1]).replace(/^Answer\s*[:：]\s*/i, "").trim();
  const solution = solM ? solutionText(solM[1]) : "";

  // meta: Topics + Difficulty
  let codes = [], diff = 3;
  if (metaM) {
    const meta = plain(metaM[1]);
    const tM = meta.match(/Topics?\s*[:：]\s*([^|]+)/i);
    if (tM) codes = tM[1].split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    const dM = meta.match(/Difficulty\s*[:：]\s*d?(\d+)/i);
    if (dM) diff = Math.min(5, Math.max(1, Number(dM[1])));
  }
  const ids = [];
  for (const c of codes) {
    const key = Object.keys(CODE_MAP).find((k) => k.toLowerCase() === c.toLowerCase());
    const id = key ? CODE_MAP[key] : null;
    if (id && !ids.includes(id)) ids.push(id);
    if (!id) problems.push(`Q${num}: 未识别考点码 "${c}"`);
  }
  if (!ids.length) { ids.push(KP.ALG); problems.push(`Q${num}: 无考点码，回退 Algebra`); }

  // 答案必须精确命中某选项
  if (!options.includes(answer)) {
    // 容错：去空白后比对
    const norm = (s) => s.replace(/\s+/g, "");
    const hit = options.find((o) => norm(o) === norm(answer));
    if (hit) { answer = hit; }
    else problems.push(`Q${num}: ❌ 答案未命中选项 answer=${JSON.stringify(answer)} options=${JSON.stringify(options)}`);
  }

  questions.push({
    subject: "数学",
    sourceType: "TMUA",
    paper: kindCode,
    topic: KP_NAME[ids[0]] || "Algebra and Functions",
    topicIds: ids,
    difficulty: diff,
    type: "SINGLE_CHOICE",
    stem,
    options,
    answer,
    solution,
    source: `${srcPrefix}-Q${num}`,
  });
}

const bank = {
  paper: {
    title: titleArg,
    subject: "数学",
    sourceType: "TMUA",
    kind: "mock",
    source: srcPrefix,
    sourceKey: `数学::${kindCode}::${srcPrefix}`,
  },
  questions,
};
fs.writeFileSync(outPath, JSON.stringify(bank, null, 2), "utf8");

console.log(`✅ ${titleArg}: 解析 ${questions.length} 题 -> ${outPath}`);
console.log(`   选项数分布: ${JSON.stringify(questions.reduce((a, q) => { a[q.options.length] = (a[q.options.length] || 0) + 1; return a; }, {}))}`);
console.log(`   难度分布: ${JSON.stringify(questions.reduce((a, q) => { a[q.difficulty] = (a[q.difficulty] || 0) + 1; return a; }, {}))}`);
const tc = questions.reduce((a, q) => { a[q.topic] = (a[q.topic] || 0) + 1; return a; }, {});
console.log(`   主考点: ${Object.entries(tc).map(([k, v]) => `${k}(${v})`).join(", ")}`);
if (problems.length) {
  console.log(`\n⚠️  ${problems.length} 个问题:`);
  for (const p of problems) console.log("   - " + p);
} else {
  console.log("   ✅ 无异常：答案全部命中选项，考点码全部识别");
}
