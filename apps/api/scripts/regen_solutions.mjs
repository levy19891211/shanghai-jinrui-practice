// 批量改写题目解析为「简练清晰中文版」。
// 运行(在 apps/api 目录下):
//   node scripts/regen_solutions.mjs --limit 20            # 预览前 20 道(会落库,运行前自动全量备份)
//   node scripts/regen_solutions.mjs --limit 20 --dry-run  # 只生成不落库,用于先看效果
//   node scripts/regen_solutions.mjs --all                # 全量改写所有题目
//   node scripts/regen_solutions.mjs --all --status PUBLISHED  # 只改写某状态
//   node scripts/regen_solutions.mjs --only-missing       # 只改写缺解析的题目
//   node scripts/regen_solutions.mjs --offset 20 --limit 50     # 分批
// 备份文件: /root/.cache/regen_solutions_backup_<timestamp>.json (含全部题目的 id/topic/solution)
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { chatComplete, llmConfigured } from "../src/lib/llm.js";
import fs from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();

// ---------- 参数解析 ----------
const argv = process.argv.slice(2);
function getFlag(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
function hasFlag(name) {
  return argv.includes(name);
}
const LIMIT = hasFlag("--all") ? undefined : Number(getFlag("--limit") ?? 20);
const OFFSET = Number(getFlag("--offset") ?? 0);
const DRY_RUN = hasFlag("--dry-run");
const ONLY_MISSING = hasFlag("--only-missing");
const STATUS_FILTER = getFlag("--status");
const CONCURRENCY = Math.max(1, Math.min(8, Number(getFlag("--concurrency") ?? 1)));
const DONE_FILE = getFlag("--done-file");
const RETRIES = Number(getFlag("--retries") ?? 1);
// 已完成集合(用于断点续跑)
const doneSet = new Set();
if (DONE_FILE && fs.existsSync(DONE_FILE)) {
  for (const line of fs.readFileSync(DONE_FILE, "utf8").split("\n")) {
    const id = line.trim();
    if (id) doneSet.add(id);
  }
}

// ---------- 工具 ----------
function safeParseOptions(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  return [];
}
function cleanSolution(text) {
  let t = String(text || "").trim();
  const fence = t.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i);
  if (fence) t = fence[1].trim();
  return t;
}

// ---------- 中文提示词 ----------
const SYSTEM_PROMPT = `你是一位资深的国际课程理科竞赛辅导老师，熟悉 TMUA、ESAT、MAT 等英国大学入学考试（数学/物理/化学/生物）。请为给定题目撰写**简练、清晰、易懂**的中文解析。

要求：
1. 用中文，语言精炼，直击要点，不要冗长铺垫。
2. 结构清晰：先用一句话点明思路或核心考点，再给出关键解题步骤（步骤间用换行分隔）；如确有易错点可附一句提醒，否则省略。
3. **只呈现正确的解题路径，不要展示任何错误的推导、试错过程或"先得到某值发现不对再纠正"的弯路。**
4. 公式使用 LaTeX：行内公式用 $...$，独立公式用 $$...$$；不要使用 \\(\\)、\\[\\]、\\text{}、\\begin{} 或 \\\\。保持公式简洁合法（如 $x^2-5x+6=0$、$\\frac{1}{2}$）。
5. 不要使用 Markdown 标题（##）、列表符号（-/•）、加粗（**）等语法，用自然换行即可。
6. 只输出解析正文，不要问候语，不要"解析："之类前缀。`;

function buildUserPrompt({ stem, options, answer, topic }) {
  const optText =
    Array.isArray(options) && options.length
      ? options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join("\n")
      : "(无选项 / 填空题)";
  return [
    `[科目 / 知识点] ${topic || "数学"}`,
    `[题干] ${stem}`,
    `[选项]\n${optText}`,
    `[答案] ${answer || "(见题干或解析)"}`,
    "",
    "请按系统要求撰写简练清晰的中文解析。",
  ].join("\n");
}

// ---------- 主流程 ----------
async function main() {
  if (!llmConfigured()) {
    console.error("✗ 未配置 LLM_API_KEY，无法生成解析。请在 apps/api/.env 配置后重试。");
    process.exit(1);
  }

  // 1) 全量备份当前解析
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = "/root/.cache";
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `regen_solutions_backup_${ts}.json`);
  const all = await prisma.question.findMany({ select: { id: true, subject: true, topic: true, solution: true } });
  fs.writeFileSync(backupPath, JSON.stringify(all, null, 2), "utf8");
  console.log(`✓ 已备份 ${all.length} 道题的当前解析 → ${backupPath}`);

  // 2) 选取本次要处理的题目
  const where = {};
  if (STATUS_FILTER) where.status = STATUS_FILTER;
  if (ONLY_MISSING) where.solution = null;
  const total = await prisma.question.count({ where });
  let rows = await prisma.question.findMany({
    where,
    orderBy: { createdAt: "asc" },
    skip: OFFSET,
    ...(LIMIT != null ? { take: LIMIT } : {}),
    select: { id: true, subject: true, topic: true, stem: true, options: true, answer: true, solution: true },
  });
  // 断点续跑:跳过已完成的
  const skipped = doneSet.size ? rows.filter((r) => doneSet.has(r.id)).length : 0;
  if (doneSet.size) rows = rows.filter((r) => !doneSet.has(r.id));
  console.log(
    `本次处理:选取 ${rows.length} 道 / 符合条件 ${total} 道 (offset=${OFFSET}, limit=${LIMIT ?? "ALL"}, dryRun=${DRY_RUN}, concurrency=${CONCURRENCY}, 续跑跳过 ${skipped})`
  );

  let okCount = 0;
  let failCount = 0;
  const failures = [];

  // 并发控制(简单信号量)
  let cursor = 0;
  async function worker() {
    while (cursor < rows.length) {
      const idx = cursor++;
      const q = rows[idx];
      try {
        let raw = "";
        let lastErr = null;
        for (let attempt = 0; attempt <= RETRIES; attempt++) {
          try {
            raw = await chatComplete({
              system: SYSTEM_PROMPT,
              user: buildUserPrompt({
                stem: q.stem,
                options: safeParseOptions(q.options),
                answer: q.answer,
                topic: q.topic,
              }),
              temperature: 0.2,
              maxTokens: 800,
            });
            lastErr = null;
            break;
          } catch (e) {
            lastErr = e;
            if (attempt < RETRIES) {
              await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
            }
          }
        }
        if (lastErr) throw lastErr;
        const solution = cleanSolution(raw);
        if (!solution) throw new Error("LLM 返回为空");
        if (!DRY_RUN) {
          await prisma.question.update({ where: { id: q.id }, data: { solution } });
        }
        if (DONE_FILE) fs.appendFileSync(DONE_FILE, q.id + "\n");
        okCount++;
        console.log(`\n【${idx + 1}/${rows.length}】${q.subject} / ${q.topic}\n${solution}\n${"─".repeat(60)}`);
      } catch (e) {
        failCount++;
        failures.push({ id: q.id, topic: q.topic, error: e.message });
        console.error(`\n✗【${idx + 1}/${rows.length}】${q.subject} / ${q.topic} 失败:${e.message}`);
      }
    }
  }
  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  console.log(`\n========== 完成 ==========`);
  console.log(`成功:${okCount}  失败:${failCount}${DRY_RUN ? "  (dry-run,未落库)" : ""}`);
  if (failures.length) {
    console.log("失败列表:");
    for (const f of failures) console.log(`  - ${f.id} (${f.topic}): ${f.error}`);
  }
  console.log(`备份文件:${backupPath}`);
  await prisma.$disconnect();
  process.exit(failCount > 0 && okCount === 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("脚本异常:", e);
  process.exit(1);
});
