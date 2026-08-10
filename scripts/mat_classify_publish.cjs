const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

// 标准数学知识点（subject=数学，取自 KnowledgePoint 表）
const STD = [
  'Geometry', 'Graphs', 'Logic and Proof', 'Numbers and Sets', 'Algebra and Functions',
  'Quadratics', 'Coordinate Geometry', 'Sequences and Series', 'Binomial Expansion',
  'Exponentials and Logarithms', 'Trigonometry', 'Differentiation', 'Integration',
  'Numerical Methods', 'Vectors', 'Statistics', 'Probability'
];

// 现有 topic -> 标准名 的归一化映射
const MAP = {
  'Algebra and Functions': 'Algebra and Functions',
  'Trigonometry': 'Trigonometry',
  'Coordinate Geometry': 'Coordinate Geometry',
  'Exponential and Logarithmic Functions': 'Exponentials and Logarithms',
  'Integration': 'Integration',
  'Logarithms': 'Exponentials and Logarithms',
  'Inequalities and Sequences': 'Sequences and Series',
  'Differentiation': 'Differentiation',
  'Polynomials and Remainder Theorem': 'Algebra and Functions',
  'Exponential Equations': 'Exponentials and Logarithms',
  'Number Theory / Digit Sum': 'Numbers and Sets',
  'Integration / Calculus': 'Integration',
  'Coordinate Geometry / Circles': 'Coordinate Geometry',
  'Sequences and Series': 'Sequences and Series',
  'Polynomials': 'Algebra and Functions',
  'Algebra and Diophantine Equations': 'Numbers and Sets',
  'Graphs': 'Graphs',
  'Algebra and Inequalities': 'Algebra and Functions',
  'Integration and Differentiation': 'Integration',
  'Exponential Functions and Inequalities': 'Exponentials and Logarithms',
  'Logarithms and Exponents': 'Exponentials and Logarithms',
  'Trigonometric Equations': 'Trigonometry',
  'Number Theory': 'Numbers and Sets',
  'Integration and Trigonometry': 'Integration',
  'Geometry / Circles and Triangles': 'Geometry',
  'Algebra and Functions / Quadratic Equations': 'Quadratics',
  'Trigonometry / Graph Transformations': 'Trigonometry',
  'Calculus / Differentiation': 'Differentiation',
  'Differentiation / Polynomials': 'Differentiation',
  'Logarithms / Algebra and Functions': 'Exponentials and Logarithms',
  'Polynomials / Sequences and Series': 'Algebra and Functions',
  'Integration / Coordinate Geometry': 'Integration',
  'Sequences and Series / Functions': 'Sequences and Series',
  'Integration / Floor Function': 'Integration',
  'Exponentials and Logarithms': 'Exponentials and Logarithms',
  'Functions and Compositions': 'Algebra and Functions',
  'Binomial Expansion': 'Binomial Expansion',
  'Calculus': 'Differentiation',
  'Integration and Area': 'Integration',
  'Geometry': 'Geometry',
  'Trigonometry, Series': 'Trigonometry',
  'Geometry, Regular Polygons': 'Geometry',
  'Calculus, Tangents': 'Differentiation',
  'Integration, Area between curves': 'Integration',
  'Probability and Vectors': 'Probability',
  'Probability': 'Probability',
  'Quadratic Equations': 'Quadratics'
};

// 用题干关键词细化"模糊题"（topic 含 and / / , 或 Calculus）的主知识点
function refineByStem(stem, fallback) {
  const s = String(stem || '').toLowerCase();
  const has = (re) => re.test(s);
  // 优先级判定
  if (has(/\\int|integral|integrate|area (under|between)|anti-?derivative/)) return 'Integration';
  if (has(/differentiat|derivative|tangent|gradient|dy\/dx|d\/dx|stationary point|normal to/)) return 'Differentiation';
  if (has(/\\sin|\\cos|\\tan|trig|sec |cosec|cot /)) return 'Trigonometry';
  if (has(/\\log|\\ln|exponential|e\^|e\^\{/)) return 'Exponentials and Logarithms';
  if (has(/sequence|series|arithmetic (sequence|series)|geometric (sequence|series)|sum to|recurrence|term of/)) return 'Sequences and Series';
  if (has(/circle|parabola|ellipse|hyperbola|coordinate|perpendicular|gradient of line|straight line/)) return 'Coordinate Geometry';
  if (has(/probability|random|dice|chance|fair coin|balls? (are|is) drawn/)) return 'Probability';
  if (has(/vector/)) return 'Vectors';
  if (has(/quadratic|x\^2|root[s]? of|discriminant/)) return 'Quadratics';
  if (has(/binomial/)) return 'Binomial Expansion';
  if (has(/polygon|triangle|angle|sphere|cone|cylinder|regular/)) return 'Geometry';
  if (has(/graph|sketch|asymptote|curve sketch|intersect/)) return 'Graphs';
  if (has(/digit|prime|integer|divisib|remainder|modulo|gcd|lcm|congruen/)) return 'Numbers and Sets';
  return fallback;
}

function classify(q) {
  const raw = (q.topic || '').trim();
  let primary = MAP[raw];
  const ids = [];
  if (primary) {
    ids.push(primary);
  } else {
    // 未命中映射：尝试按分隔符拆分，分别映射
    const parts = raw.split(/\s*(?:\/|,|and)\s*/i).map((x) => x.trim()).filter(Boolean);
    let found = false;
    for (const part of parts) {
      const m = MAP[part] || MAP[part.replace(/\/$/, '')];
      if (m && !ids.includes(m)) { ids.push(m); found = true; }
    }
    primary = ids[0] || null;
    if (!found) primary = null;
  }
  // 模糊题（含 and / / , 或 Calculus）用 stem 细化主知识点
  if (/and|\/|,|calculus/i.test(raw)) {
    const refined = refineByStem(q.stem, primary || 'Algebra and Functions');
    if (refined && !ids.includes(refined)) ids.unshift(refined); // 主放最前
    primary = refined;
  }
  if (!primary) primary = refineByStem(q.stem, 'Algebra and Functions');
  if (!ids.includes(primary)) ids.unshift(primary);
  // 仅保留标准库内的
  const valid = ids.filter((x) => STD.includes(x));
  const finalPrimary = valid[0] || 'Algebra and Functions';
  return { primary: finalPrimary, ids: valid };
}

(async () => {
  const DRY = process.env.DRY === '1';
  const kps = await p.knowledgePoint.findMany({ where: { subject: '数学' }, select: { id: true, name: true } });
  const kpByName = {};
  kps.forEach((k) => { kpByName[k.name] = k.id; });
  const missing = STD.filter((n) => !kpByName[n]);
  if (missing.length) { console.log('WARN 知识点库缺少标准知识点:', missing.join(', ')); }

  const all = await p.question.findMany({
    where: { sourceType: 'MAT' },
    select: { id: true, topic: true, stem: true, status: true }
  });
  console.log('TOTAL MAT:', all.length);

  const dist = {};
  let updated = 0;
  for (const q of all) {
    const { primary, ids } = classify(q);
    dist[primary] = (dist[primary] || 0) + 1;
    const topicIds = JSON.stringify(ids.map((n) => kpByName[n]).filter(Boolean));
    const newStatus = 'PUBLISHED';
    if (!DRY) {
      await p.question.update({
        where: { id: q.id },
        data: { topic: primary, topicIds, status: newStatus }
      });
    }
    updated++;
  }
  console.log('UPDATED:', updated);
  console.log('NEW TOPIC DISTRIBUTION:', JSON.stringify(dist, null, 2));
  await p.$disconnect();
})();
