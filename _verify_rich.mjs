// 回归验证 rich.tsx smartMath 的裸数字/裸运算符判定规则
// 注意:这里复刻了 rich.tsx 的核心正则与两阶段提升逻辑,用于在 Node 里直接跑回归
import { readFileSync } from "fs";

const OP_TOKEN = /^[+\-*/=<>&!#%^~\u2212\u00d7\u00f7\u00b1()\[\]{}]$/;
const NUM_TOKEN = /^[\-\u2212]?\d+([.,]\d+)?%?$/;
const VAR_TOKEN = /^[a-zA-Z]$/;
const FUNC_TOKEN = /^(log|log\u2081\u2080|log\u2082|log\u2083|sin|cos|tan|ln|sec|csc|cot|exp|sqrt|sinh|cosh|tanh)$/;
const MATHY_TOKEN = /[\u221a\u03c0\u03b8\u03a3\u222b\u2264\u2265\u2248\u2260\u00d7\u00f7\u00b1^]/;
const PURE_WORD = /^[a-z]{2,}$/;
const MIXED_NUM = /^[0-9\u221a\u03c0\u03b8(\u2212][a-zA-Z0-9\u221a\u03c0\u03b8\u2212^(){}[\]/.,]*$/;
const MIXED_LET = /^[a-zA-Z][a-zA-Z0-9\u221a\u03c0\u03b8\u2212^(){}[\]/.,]*[0-9^\u221a\u03c0\u03b8()\[\]/\u2212][a-zA-Z0-9\u221a\u03c0\u03b8\u2212^(){}[\]/.,]*$/;
const HAS_UNI_SUP_SUB = /[\u2070\u00b9\u00b2\u00b3\u2074\u2075\u2076\u2077\u2078\u2079\u207b\u2080\u2081\u2082\u2083\u2084\u2085\u2086\u2087\u2088\u2089]/;
function isMixedMath(token) { return MIXED_NUM.test(token) || MIXED_LET.test(token); }
function isMathToken(token) {
  if (HAS_UNI_SUP_SUB.test(token)) return false;
  if (/^[a-z]+(\/[a-z]+)+$/.test(token)) return false;
  if (/^\(([a-z]{2,}|[IVX]+)\)$/i.test(token)) return false;
  if (/^[a-zA-Z][a-zA-Z.,;:'\-]*\)$/.test(token)) return false;
  if (/\\[a-zA-Z]+/.test(token)) return true;
  if (PURE_WORD.test(token) && !FUNC_TOKEN.test(token)) return false;
  if (FUNC_TOKEN.test(token)) return true;
  if (OP_TOKEN.test(token) || NUM_TOKEN.test(token)) return false;
  if (VAR_TOKEN.test(token) && !["a", "A", "i", "I"].includes(token)) return true;
  if (MATHY_TOKEN.test(token)) return true;
  if (isMixedMath(token)) return true;
  return false;
}

function classify(text) {
  const tokens = text.split(/(\s+)/);
  const cls = tokens.map((t) => {
    if (t.trim() === "") return "space";
    if (isMathToken(t.trim())) return "math";
    if (NUM_TOKEN.test(t.trim()) || OP_TOKEN.test(t.trim())) return "bare";
    return "text";
  });
  const prevNonSpace = (i) => { for (let j = i - 1; j >= 0; j--) if (cls[j] !== "space") return j; return -1; };
  const nextNonSpace = (i) => { for (let j = i + 1; j < tokens.length; j++) if (cls[j] !== "space") return j; return -1; };
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < tokens.length; i++) {
      if (cls[i] !== "bare") continue;
      const pi = prevNonSpace(i), ni = nextNonSpace(i);
      const leftMath = pi >= 0 && (cls[pi] === "math" || cls[pi] === "promoted");
      const rightMath = ni >= 0 && (cls[ni] === "math" || cls[ni] === "promoted");
      if (leftMath || rightMath) { cls[i] = "promoted"; changed = true; }
    }
  }
  return tokens.map((t, i) => ({ t, kind: cls[i] })).filter((x) => x.kind !== "space");
}

let pass = 0, fail = 0;
function ok(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

console.log("[rich] smartMath 分类回归");

const cases = [
  { text: "by 3 units", want: ["by:math?no", "3:math?no", "units:math?no"] },
  { text: "factor of 4 about", want: ["factor:math?no", "of:math?no", "4:math?no", "about:math?no"] },
  { text: "x = 3", want: ["x:math?yes", "=:math?yes", "3:math?yes"] },
  { text: "f(x) = 3 units", want: ["f(x):math?yes", "=:math?yes", "3:math?yes", "units:math?no"] },
  { text: "3 + 4", want: ["3:math?no", "+:math?no", "4:math?no"] },
  // 注意:"5." 因 MIXED_NUM 匹配(历史行为,含小数点/逗号的数字串)仍判为数学;此处记录现状
  { text: "The answer is 5.", want: ["The:math?no", "answer:math?no", "is:math?no", "5.:math?yes"] },
  { text: "3x^2", want: ["3x^2:math?yes"] },
  { text: "x^2 + 1", want: ["x^2:math?yes", "+:math?yes", "1:math?yes"] },
  { text: "radius of the circle is 5 cm", want: ["radius:math?no", "of:math?no", "the:math?no", "circle:math?no", "is:math?no", "5:math?no", "cm:math?no"] },
  { text: "enlarged by a scale factor of 4", want: ["enlarged:math?no", "by:math?no", "a:math?no", "scale:math?no", "factor:math?no", "of:math?no", "4:math?no"] },
];

for (const c of cases) {
  console.log(`\n句子: "${c.text}"`);
  const got = classify(c.text);
  for (const w of c.want) {
    const [tok, flag] = w.split(":");
    const expectMath = flag === "math?yes";
    const item = got.find((g) => g.t === tok);
    if (!item) { ok(`token "${tok}" 存在`, false, "(missing)"); continue; }
    const isMath = item.kind === "math" || item.kind === "promoted";
    ok(`"${tok}" ${expectMath ? "应为 math" : "应为 text"}`, isMath === expectMath, `got=${item.kind}`);
  }
}

// 额外:验证与截图复现一致的实际句子($x$-direction 这种显式数学由 TOKEN_RE 处理,这里只看 smartMath 段的裸数字)
console.log("\n[rich] 截图复现句子的关键 token");
const repro = "This circle is translated by 3 units in the negative x-direction, then reflected in the x-axis, and then enlarged by a scale factor of 4 about the centre of the resulting circle.";
const reproCls = classify(repro);
for (const it of reproCls) {
  if (it.t === "3" || it.t === "4") ok(`"${it.t}" 保持正文(未提升)`, it.kind === "text" || it.kind === "bare", `got=${it.kind}`);
  if (it.t === "x-direction" || it.t === "x-axis") ok(`"${it.t}" 无显式 $x$ 时为普通文本`, it.kind === "text", `got=${it.kind}`);
}

console.log(`\n==== 结果: ${pass} 通过, ${fail} 失败 ====`);
if (fail > 0) process.exit(1);
