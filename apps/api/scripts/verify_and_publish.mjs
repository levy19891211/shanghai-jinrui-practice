// 逐题核验「存储答案」与「解析」是否吻合,吻合的待审核题自动发布(PUBLISHED)。
// 范围:PENDING_REVIEW 且有答案有解析的题目。
// 方式:LLM 逐题判断(准确识别"解析说答案有误"这类矛盾)。
//
// 运行(在 apps/api 目录下):
//   node scripts/verify_and_publish.mjs --limit 5 --dry-run        # 预览 5 道,不落库
//   node scripts/verify_and_publish.mjs --all                      # 全量核验并发布
//   node scripts/verify_and_publish.mjs --all --concurrency 8 --done-file /root/.cache/verify_done.txt
//   node scripts/verify_and_publish.mjs --ids-file /tmp/ids.txt --dry-run  # 按指定 id 核验
// 产出:
//   /root/.cache/verify_publish_backup_<ts>.json   运行前快照(id/status/answer/solution)
//   /root/.cache/verify_publish_report_<ts>.json   结果报告(matched/unmatched/error 与 reason)
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { chatComplete, llmConfigured } from "../src/lib/llm.js";
import { recalcPapersOfQuestion } from "../src/lib/paper-set.js";
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
const CONCURRENCY = Math.max(1, Math.min(8, Number(getFlag("--concurrency") ?? 1)));
const DONE_FILE = getFlag("--done-file");
const IDS_FILE = getFlag("--ids-file");
const RETRIES = Number(getFlag("--retries") ?? 1);

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

// 答案结构校验:choice 题的 answer 必须是合法选项(单选=选项文本;多选=token 都在选项中或整体是某选项)
function answerIsStructurallyValid(q, options) {
  const answer = String(q.answer || "").trim();
  if (!answer) return { ok: false, reason: "缺答案" };
  if (q.type === "NUMERIC") return { ok: true };
  if (!options.length) return { ok: false, reason: "无选项" };
  const trimmed = options.map((o) => String(o).trim());
  if (q.type === "MULTIPLE_CHOICE") {
    const tokens = answer.split(/[, ]+/).filter(Boolean);
    const allIn = tokens.length > 0 && tokens.every((t) => trimmed.includes(t));
    if (allIn) return { ok: true };
    return trimmed.includes(answer) ? { ok: true } : { ok: false, reason: "answer 不在选项中" };
  }
  return trimmed.includes(answer) ? { ok: true } : { ok: false, reason: "answer 不在选项中" };
}

// 从 LLM 返回中解析 JSON(容错:去代码块、取第一个 {...})
function parseMatchJson(raw) {
  let t = String(raw || "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(t.slice(start, end + 1));
    if (typeof obj === "object" && obj !== null && typeof obj.match === "boolean") {
      return { match: obj.match, reason: String(obj.reason || "") };
    }
  } catch {
    /* fallthrough */
  }
  // 兜底:没解析出 JSON 时按纯文本判断
  if (/match["\s:]+true/i.test(t)) return { match: true, reason: "(文本兜底)" };
  if (/match["\s:]+false/i.test(t)) return { match: false, reason: "(文本兜底)" };
  return null;
}

const SYSTEM_PROMPT = `你是一位严谨的理科题库审核员,负责核对一道题的「存储答案」与「解析」是否一致。

你将收到:题干、选项、存储答案、解析。请判断:解析的推理过程及最终结论,是否支持/吻合「存储答案」。

判定规则:
- 解析最终得出的正确答案(选项或数值)与「存储答案」一致 → match=true
- 解析明确指出存储答案有误、应为其他选项、或结论与存储答案矛盾 → match=false
- 解析含糊、没有明确结论、或无法据此确定答案 → match=false(宁可不发布)
- 若存储答案是字母(如 B),请对照选项判断该字母对应的选项文本是否为解析结论
- 只判断「答案是否吻合」,解析里排版/措辞小瑕疵不影响结论

只输出一行 JSON,不要 Markdown 代码块,不要任何其他文字:
{"match": true, "reason": "不超过15字的原因"}
或
{"match": false, "reason": "不超过15字的原因"}`;

function buildUserPrompt({ stem, options, answer, solution, topic }) {
  const optText =
    Array.isArray(options) && options.length
      ? options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join("\n")
      : "(无选项 / 填空题)";
  return [
    `[科目 / 知识点] ${topic || "数学"}`,
    `[题干] ${stem}`,
    `[选项]\n${optText}`,
    `[存储答案] ${answer}`,
    `[解析]\n${solution}`,
    "",
    "请只输出判定 JSON。",
  ].join("\n");
}

// ---------- 主流程 ----------
async function main() {
  if (!llmConfigured()) {
    console.error("✗ 未配置 LLM_API_KEY,无法核验。请在 apps/api/.env 配置后重试。");
    process.exit(1);
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const cacheDir = "/root/.cache";
  fs.mkdirSync(cacheDir, { recursive: true });

  // 1) 备份
  const backupPath = path.join(cacheDir, `verify_publish_backup_${ts}.json`);
  const all = await prisma.question.findMany({
    where: { status: "PENDING_REVIEW", answer: { gt: "" }, solution: { not: null } },
    select: { id: true, status: true, answer: true, solution: true },
  });
  fs.writeFileSync(backupPath, JSON.stringify(all, null, 2), "utf8");
  console.log(`✓ 已备份 ${all.length} 道待审题的 (id/status/answer/solution) → ${backupPath}`);

  // 2) 选取本次要处理的题目
  const where = { status: "PENDING_REVIEW", answer: { gt: "" }, solution: { not: null } };
  let rows;
  if (IDS_FILE) {
    const ids = fs
      .readFileSync(IDS_FILE, "utf8")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    rows = await prisma.question.findMany({
      where: { ...where, id: { in: ids } },
      select: { id: true, subject: true, topic: true, type: true, stem: true, options: true, answer: true, solution: true },
    });
    const pos = new Map(ids.map((id, i) => [id, i]));
    rows.sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0));
  } else {
    rows = await prisma.question.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip: OFFSET,
      ...(LIMIT != null ? { take: LIMIT } : {}),
      select: { id: true, subject: true, topic: true, type: true, stem: true, options: true, answer: true, solution: true },
    });
  }
  const skipped = doneSet.size ? rows.filter((r) => doneSet.has(r.id)).length : 0;
  if (doneSet.size) rows = rows.filter((r) => !doneSet.has(r.id));
  console.log(
    `本次处理:选取 ${rows.length} 道 / 待审符合条件 ${all.length} 道 (offset=${OFFSET}, limit=${LIMIT ?? "ALL"}, dryRun=${DRY_RUN}, concurrency=${CONCURRENCY}, 续跑跳过 ${skipped})`
  );

  let matched = 0;
  let unmatched = 0;
  let invalid = 0;
  let failed = 0;
  const report = { matched: [], unmatched: [], invalid: [], error: [] };

  let cursor = 0;
  async function worker() {
    while (cursor < rows.length) {
      const idx = cursor++;
      const q = rows[idx];
      const options = safeParseOptions(q.options);

      // 结构校验(保险丝):answer 不合法 → 不发布
      const v = answerIsStructurallyValid(q, options);
      if (!v.ok) {
        invalid++;
        report.invalid.push({ id: q.id, reason: v.reason, answer: q.answer });
        console.log(`✗【${idx + 1}/${rows.length}】${q.id} 结构不合法(${v.reason}),不发布`);
        if (DONE_FILE) fs.appendFileSync(DONE_FILE, q.id + "\n");
        continue;
      }

      let verdict = null;
      let lastErr = null;
      for (let attempt = 0; attempt <= RETRIES; attempt++) {
        try {
          const raw = await chatComplete({
            system: SYSTEM_PROMPT,
            user: buildUserPrompt({
              stem: q.stem,
              options,
              answer: q.answer,
              solution: q.solution,
              topic: q.topic,
            }),
            temperature: 0,
            maxTokens: 250,
          });
          verdict = parseMatchJson(raw);
          if (verdict) break;
          lastErr = new Error(`LLM 返回无法解析: ${raw.slice(0, 120)}`);
        } catch (e) {
          lastErr = e;
          if (attempt < RETRIES) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
      }
      if (!verdict) {
        failed++;
        report.error.push({ id: q.id, error: lastErr?.message || "未知" });
        console.error(`\n✗【${idx + 1}/${rows.length}】${q.id} 核验失败:${lastErr?.message}`);
        if (DONE_FILE) fs.appendFileSync(DONE_FILE, q.id + "\n");
        continue;
      }

      if (verdict.match) {
        matched++;
        report.matched.push({ id: q.id, reason: verdict.reason });
        if (!DRY_RUN) {
          await prisma.question.update({
            where: { id: q.id },
            data: { status: "PUBLISHED", reviewedAt: new Date() },
          });
          await recalcPapersOfQuestion(q.id);
        }
        console.log(`✓【${idx + 1}/${rows.length}】${q.id} 吻合 → 发布 (${verdict.reason})`);
      } else {
        unmatched++;
        report.unmatched.push({ id: q.id, reason: verdict.reason });
        console.log(`~【${idx + 1}/${rows.length}】${q.id} 不吻合 → 保持待审 (${verdict.reason})`);
      }
      if (DONE_FILE) fs.appendFileSync(DONE_FILE, q.id + "\n");
    }
  }
  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  const reportPath = path.join(cacheDir, `verify_publish_report_${ts}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log(`\n========== 完成 ==========`);
  console.log(`吻合(发布):${matched}  不吻合(保持):${unmatched}  结构不合法:${invalid}  核验失败:${failed}`);
  console.log(`报告:${reportPath}`);
  console.log(`备份:${backupPath}`);
  console.log(`汇总(不吻合原因前 30):`);
  for (const u of report.unmatched.slice(0, 30)) console.log(`  - ${u.id} ${u.reason}`);

  await prisma.$disconnect();
  process.exit(failed > 0 && matched === 0 && unmatched === 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("脚本异常:", e);
  process.exit(1);
});
