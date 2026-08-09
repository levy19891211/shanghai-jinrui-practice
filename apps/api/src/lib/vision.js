// 视觉大模型客户端(OpenAI 兼容的多模态 chat completions)。
// 用于 PDF 批量导入:把栅格化后的试卷页面图片交给视觉模型,由其读取渲染后的数学公式,
// 输出结构化的选择题 JSON(题干/选项/答案/解析都带规范 LaTeX)。
//
// 环境变量:
//   VISION_API_KEY  (必填) 视觉模型 API Key
//   VISION_BASE_URL (可选) 默认通义千问 DashScope 兼容端点 https://dashscope.aliyuncs.com/compatible-mode/v1
//   VISION_MODEL    (可选) 默认 qwen2.5-vl-72b-instruct
//
// 注:deepseek-chat 是纯文本模型,看不了图;PDF 导入必须配一个视觉模型。
const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DEFAULT_MODEL = "qwen2.5-vl-72b-instruct";

export function isVisionConfigured() {
  return !!process.env.VISION_API_KEY;
}

function baseUrl() {
  return (process.env.VISION_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}
function model() {
  return process.env.VISION_MODEL || DEFAULT_MODEL;
}

const SYSTEM_PROMPT = `你是一个考试题库录入助手。用户会给你一份数学入学考试试卷(一页或多页图片,已按页面顺序给出),可能还附上每页提取的纯文本(仅供参考,数学公式以图片渲染为准)。

请从中提取每一道选择题,严格按以下 JSON 数组格式输出。不要输出任何额外说明、不要使用 markdown 代码围栏,只输出可直接解析的 JSON 数组:

[
  {
    "subject": "TMUA 或 ESAT 或 学科名",
    "paper": "试卷名/场次(可选,没有则空字符串)",
    "topic": "知识点,优先用英文 A Level 术语(如 Differentiation / Trigonometry / Sequences and Series / Integration / Algebra and Functions);也可用中文关键词",
    "difficulty": 1到5的整数(可选,默认3),
    "type": "SINGLE_CHOICE 或 MULTIPLE_CHOICE 或 TRUE_FALSE",
    "stem": "题干全文。所有数学用 LaTeX 书写:行内公式用 $...$,独立成行的公式用 $$...$$。务必让每个定界符成对闭合。",
    "options": ["选项正文","选项正文","选项正文","选项正文"(至少2个,最多8个)],
    "answer": "正确答案。可写选项字母(A-H),也可写与选项文本完全一致的文本;多选题写字母如 \\"A, C\\"",
    "solution": "解题步骤/解析(可选,没有则空字符串)。数学同样用 LaTeX。",
    "source": "PDF 导入"
  }
]

重要规则:
- 数学符号必须写成规范 LaTeX:例如 \\log 不要写成 log,\\sin \\cos \\tan \\lim \\frac \\sqrt \\leq \\geq \\times \\cdot \\neq 等;上标用 ^,下标用 _。
- 每个公式定界符必须成对:开 $ 必有闭 $,开 $$ 必有闭 $$。绝不要在公式中间出现孤立的 $。
- **公式定界符选择(关键,防止显示错乱)**:
  - **短公式 / 简单等式 / 单变量赋值 / 短不等式 / 短函数定义**  → 一律用**行内** `$...$`,例如 `$x_1 = 7$`、`$a+b=c$`、`$f(x) = 2x+1$`、`$p < x < q$`;
  - **多行 / 分式 / 积分 / 求和 / 极限 / 矩阵 / 复杂表达式** 才用独立 `$$...$$`,例如 `$$\\int_0^1 f(x)\\,dx$$`;像 `x_1 = 7`、`x_{n+1} = \\frac{...}{...}` 属于「短公式」,**禁止用 $$...$$**;
  - **严禁**出现 `$$x_1 = 7$x_{n+1} = ...$$` 这类「块级与行内混用」或「半边定界符」——开 `$$` 必须等距配对闭合 `$$`,开 `$` 必须等距配对闭合 `$`;**任何公式要么完整 `$...$` 要么完整 `$$...$$`**。
- 题干与选项拆开,不要把选项混进题干;保留选项原始字母顺序 A、B、C、D。
- **options 数组里只放选项正文(数学公式、表达式、文本等),绝对不要包含选项字母前缀(不要写 "A 1/25" 或 "A. 1/25" 这种)**。选项的 A./B./C. 标签由系统自动添加。
- **单位与普通文本不要用 $...$ 包裹**:mol、g、cm、cm³、min、s、V、J、K 等单位,以及 "2.0 mol"、"1 × 10⁶ g" 这类数字+单位,直接写成普通文本;只有真正的数学表达式(分数、根号、等式、指数、下标、化学式如 $\\mathrm{C_3H_7OH}$)才用 $...$。这样题干字体才稳定统一。
- 不要使用 \\text{}、\\emph{}、\\textit{}、\\textbf{}、\\mathit{} 等字体控制命令;化学式统一用 $\\mathrm{...}$ 形式。
- 答案(answer)必须从试卷图片中明确给出的答案 key、答案页或解析中读取,不要自行计算;如果图片中没有任何答案/解析信息,answer 填空字符串,不要猜。
- **答案页识别(关键)**:许多试卷的最后几页会单独列出答案表,常见两种格式——
  1. **表格形式**(如 NSAA / A-Level 附录答案):每行形如 Q21 A、22. B、Question 23 C,或带学科列 Q21 A PHYS。**忽略学科列(若有),只取字母列**作为该题答案;
  2. **逐题列答案**(部分试卷直接接在题目页下方):按题号取字母。
  请逐行扫描答案页/表格,把每个题号对应的字母填到对应题的 answer 字段。**题号 Q21 应对应第 21 题**(不是 PDF 文件序号)。多选题写字母如 "A, C"。
- 只提取选择题;非选择题(简答/证明/填空)若无法用选项表示则跳过。
- 如果某页是说明/封面/空白,不要生成题目。
- 确保输出的 JSON 可被直接解析(不要省略逗号或引号)。`;

// 从模型输出里尽量稳健地取出 JSON 数组
export function parseJsonArray(text) {
  let s = String(text || "").trim();
  s = s.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try {
    const v = JSON.parse(s);
    if (Array.isArray(v)) return v;
    if (v && Array.isArray(v.questions)) return v.questions;
    if (v && Array.isArray(v.data)) return v.data;
  } catch {
    /* ignore */
  }
  return [];
}

export async function extractQuestionsFromPdfPages(pages, { maxPagesPerCall } = {}) {
  // 每次调用的页数:页太多会让模型丢题/截断。默认 4 页,可用 VISION_MAX_PAGES 调整。
  const perCall = Math.max(1, Math.min(16, Number(maxPagesPerCall) || Number(process.env.VISION_MAX_PAGES) || 4));
  if (!isVisionConfigured()) throw new Error("VISION_NOT_CONFIGURED");
  const chunks = [];
  for (let i = 0; i < pages.length; i += perCall) {
    chunks.push(pages.slice(i, i + perCall));
  }
  const all = [];
  for (const chunk of chunks) {
    const content = [
      {
        type: "text",
        text: "请从以下页面的试卷图片中提取所有选择题,严格按系统提示要求的 JSON 数组格式输出。",
      },
    ];
    let textHint = "";
    chunk.forEach((p, idx) => {
      content.push({ type: "image_url", image_url: { url: `data:image/png;base64,${p.image}` } });
      if (p.text) textHint += `\n[第 ${idx + 1} 页纯文本参考]\n${p.text}\n`;
    });
    if (textHint) {
      content.push({
        type: "text",
        text: "各页纯文本(公式可能不准,仅用于辅助判断题号与结构,数学以图片为准):" + textHint,
      });
    }

    const resp = await fetch(`${baseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.VISION_API_KEY}`,
      },
      body: JSON.stringify({
        model: model(),
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content },
        ],
        temperature: 0.1,
        max_tokens: 16000,
      }),
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`视觉模型请求失败 ${resp.status}: ${t.slice(0, 300)}`);
    }
    const json = await resp.json();
    const text = json?.choices?.[0]?.message?.content || "";
    all.push(...parseJsonArray(text));
  }
  return all;
}

// ——— 独立答案文件解析(题目 PDF 与答案 PDF 分开导入时使用) ———
const ANSWER_PROMPT = `你是一个考试答案页识别助手。用户会给你一份考试的答案页/答案表图片(可能是表格形式,如 "Q21 A"、"21. B"、"Question 23 C",有时还带学科列 "Q21 A PHYS")。
请逐行提取每一题的题号与答案,严格按以下 JSON 数组格式输出,不要输出任何额外说明、不要使用 markdown 代码围栏,只输出可直接解析的 JSON 数组:

[
  {"question": 21, "answer": "G"},
  {"question": 22, "answer": "F"}
]

规则:
- question 为题号(忽略 Q/Question 前缀,如 Q21 → 21;带零补位如 021 也归一为 21)。
- answer 为答案字母(A-H)或选项文本;多选题写字母如 "A, C";无法识别的行跳过。
- 若表格带学科列(如 "Q21 A PHYS" / "Q21 A Maths"),忽略学科列,只取字母列。
- 若某页不是答案表或没有可识别答案,输出 []。
- 确保输出的 JSON 可被直接解析。`;

export async function extractAnswersFromPdfPages(pages, { maxPagesPerCall } = {}) {
  const perCall = Math.max(1, Math.min(16, Number(maxPagesPerCall) || Number(process.env.VISION_MAX_PAGES) || 4));
  if (!isVisionConfigured()) throw new Error("VISION_NOT_CONFIGURED");
  const chunks = [];
  for (let i = 0; i < pages.length; i += perCall) {
    chunks.push(pages.slice(i, i + perCall));
  }
  const all = [];
  for (const chunk of chunks) {
    const content = [
      { type: "text", text: "请从以下图片中识别答案表/答案页,严格按系统提示要求的 JSON 数组格式输出题号与答案。" },
    ];
    let textHint = "";
    chunk.forEach((p, idx) => {
      content.push({ type: "image_url", image_url: { url: `data:image/png;base64,${p.image}` } });
      if (p.text) textHint += `\n[第 ${idx + 1} 页纯文本参考]\n${p.text}\n`;
    });
    if (textHint) {
      content.push({ type: "text", text: "各页纯文本(仅供参考,以图片为准):" + textHint });
    }
    const resp = await fetch(`${baseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.VISION_API_KEY}`,
      },
      body: JSON.stringify({
        model: model(),
        messages: [
          { role: "system", content: ANSWER_PROMPT },
          { role: "user", content },
        ],
        temperature: 0.1,
        max_tokens: 8000,
      }),
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`视觉模型请求失败 ${resp.status}: ${t.slice(0, 300)}`);
    }
    const json = await resp.json();
    const text = json?.choices?.[0]?.message?.content || "";
    all.push(...parseJsonArray(text));
  }
  return all;
}
