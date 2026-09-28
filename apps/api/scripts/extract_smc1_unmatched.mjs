import fs from "node:fs";
const f = "/root/.cache/verify_publish_report_2026-08-19T00-21-04-762Z.json";
const r = JSON.parse(fs.readFileSync(f, "utf8"));
const ids = r.unmatched.map((u) => u.id);
fs.writeFileSync("/root/.cache/smc1_regen_ids.txt", ids.join("\n") + "\n");
console.log("抽取未匹配题数:", ids.length);
console.log(ids.join("\n"));
