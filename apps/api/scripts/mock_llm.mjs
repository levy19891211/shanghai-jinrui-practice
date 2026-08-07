// 本地 mock OpenAI 兼容服务,仅用于端到端验证 /questions/:id/fix 的 happy path。
// 收到请求后,根据 user 里的「当前题目」把答案改成最后一个选项(模拟"答案算错已修正"),并补全解析。
import http from "node:http";

const server = http.createServer((req, res) => {
  if (req.method !== "POST") {
    res.writeHead(404).end();
    return;
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let user = "";
    try {
      user = JSON.parse(body).messages?.find((m) => m.role === "user")?.content || "";
    } catch {}
    // 粗略解析当前选项与答案
    const optLines = [...user.matchAll(/^[A-H]\.\s(.+)$/gm)].map((m) => m[1]);
    const ansMatch = user.match(/答案:(.+)/);
    const curAns = ansMatch ? ansMatch[1].trim() : optLines[0] || "x=2";
    const fixedAns = optLines.length ? optLines[optLines.length - 1] : curAns;
    const reply = JSON.stringify({
      stem: (user.match(/题干:(.+)/) || [, "求 $2x+4=10$ 的解"])[1].trim(),
      options: optLines.length ? optLines : ["x=2", "x=3"],
      answer: fixedAns,
      solution: "## 解题步骤\n由方程解得结果。\n## 考查知识点\n一元一次方程。\n## 易错点提醒\n移项注意符号。",
      changes: [{ field: "answer", reason: "退回原因指出答案错误,mock 已修正为末项" }],
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: "```json\n" + reply + "\n```" } }] }));
  });
});

server.listen(9099, () => console.log("mock llm on :9099"));
