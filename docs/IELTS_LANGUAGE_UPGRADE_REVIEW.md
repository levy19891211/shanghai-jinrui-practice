# 雅思升级设计方案 · 审查报告与 P1 实施范围

- **审查对象**：`docs/IELTS_LANGUAGE_UPGRADE_DESIGN.md` v1.0（Draft）
- **审查方式**：逐项对照 `apps/api/src/routes/language.js`（1383 行）、`apps/api/prisma/schema.prisma`、`apps/web` 四处消费方实测核证，非纸面评阅
- **结论**：**方案整体可用、方向正确**，盘点准确度高（1.1–1.5 全部核证属实）；但有 **1 处严重缺陷被低估**、**3 处遗漏**、**2 处设计建议应反向修正**。
- **处置**：采纳并按修订版执行 **P1（地基 + 评分引擎 + 断链修复）**；P2–P4 维持原排序，待本次上线验证后推进。

---

## 一、方案盘点核验（九项逐条核证）

| # | 方案论断 | 核验结果 | 证据 |
|---|---|---|---|
| 1 | 6 张 Language* 表 + 独立命名空间 | ✅ 属实 | schema.prisma:369–484 |
| 2 | Band 换算硬编码、听读共用、折算 40 题 | ✅ 属实 | language.js:20–33 `LISTENING_BAND` + `bandOf()` |
| 3 | 无四维 subscores | ✅ 属实 | `LanguageAnswerRecord` 仅有标量 `band` |
| 4 | 错题本只写不读（G1） | ✅ 属实 | 全文件仅 3 处 `deleteMany`（级联清理）+ 1 处 `upsert`（:1062），**无任何 GET 端点**；前端零引用 |
| 5 | Band 双轨（G2） | ✅ 属实 | 后端比例查表 vs `LangGrowthPanel.tsx:48–63` 阶梯估算 |
| 6 | YES_NO_NG 支持判分但不可录入（G3） | ✅ 属实 | 后端 qType 白名单含 `YES_NO_NG`；`teacher/language/page.tsx:85` `QTYPES.READING` 无此项 |
| 7 | `docs/API.md` 无语言章节（G4） | ✅ 属实 | API.md 398 行无 language 命中 |
| 8 | 教师端限宽红线（G5） | ✅ 属实 | `teacher/layout.tsx:102` `max-w-5xl` |
| 9 | recharts 需 `ssr:false` | ✅ 属实 | recharts ^2.15.4 在依赖中，`LangGrowthPanel` 已遵循 |

**盘点可信度：9/9。** 这是本次可以直接开工的基础。

---

## 二、方案低估/遗漏的问题（本次新增发现）

### 🔴 H1｜全真卷的听力/阅读分数被 **完全丢弃**（严重，方案漏报到）

方案 §7.4 描述现状为「简单算术平均」，实际比这更糟：

```js
// language.js submit（:1046-1052）
if (objective.length && subjective.length === 0)      band = bandOf(...)   // 纯客观 → 正常
else if (objective.length && subjective.length)       band = null          // 混合卷 → 置空

// language.js grade（:1315-1318）
bandFinal = hasObjective && session.band ? (session.band + round2half) / 2 : round2half
```

关键：混合卷提交时 `session.band` **已被置为 `null`**，因此 `grade` 中的三元判断**永远走右侧**——`(session.band + …)/2` 分支是**死代码**。
⇒ **全真连考卷的最终 Band = 只有写作/口语的平均分，听力与阅读一道题都没算进去。**

这不是"算法不精致"，是**分数算错**。方案中把它归为「合成规则缺失」，优先级应当最高。**P1 必须修。**

### 🟠 H2｜`total` 含主观题 ⇒ 正确率被稀释（G2 的具体成因）

`submit` 里 `total = records.length`（含 TASK/PART），而 `score = correct`（只数客观题）。
前端 `LangGrowthPanel:86` 对无 band 的会话用 `estimateBand(correctCount, total)` —— 混合卷做了写作后，正确率分母暴涨，**读出来必然偏低**。
方案只说"两套算法不同"，未点破「同一份数据分子分母口径就不一致」。修法：新增**按技能分项**的分子分母，而不是继续修 `total`。

### 🟠 H3｜Band 换算表的**量纲前提**未被讨论（方案的实质技术缺口）

方案 §7.1 提出「不再按比例折算到 40 题，按实际题数就近查表」，方向对，但没解决核心矛盾：

> 官方 IELTS 换算表**只对 40 题的完整卷有效**。一套 10 题的专项练习卷，做对 8 题 → 折算 raw40=32 → Band 7.0。这个数字是**虚高的**，因为 8 道题没有覆盖整套卷的难度分布。

**修订**：`LanguageBandTable` 增加 **`maxRaw`**（该量表对应的满分题数，默认 40）。查表时：
- 卷题数 == `maxRaw` → 直接查表，`scaled: false`；
- 卷题数 != `maxRaw` → 按比例折算后再查表，并在会话上落 `scaled: true`，报告页显示「专项练习 10 题，已折算至 40 题量纲」。

既保留可用性，又不假装它等价于真实模考。**这是方案 §7.1 缺的一环。**

### 🟡 H4｜多选题判分对**顺序与分隔符敏感**

`isAnswerCorrect`（:63）对 `MULTIPLE_CHOICE` 走 `expect.toLowerCase() === sel.toLowerCase()`。雅思「五选二」明确允许任意顺序。若教师录入答案为 `"B,D"`，学生选答 `"D,B"` 或 `"BD"` → 判错。
现状 UI 里多选题仍是单选控件（practice 页 `LETTRS[i]` 单选），所以当前**未爆发**，但一旦启用真·多选就会错判。**顺手加固**（拆分 / 排序 / 归一），成本低。

### 🟡 H5｜批改无审计、无幂等留痕

`grade` 只写 `band/feedback`，不记批改人/时间，改分无痕。方案 §4.1 已列 `gradedBy/gradedAt` ✅，此处仅确认**必要**（尤其后续若上线 AI 预评，需要区分「教师改过」与「AI 建议」）。

### 🟡 H6｜批改台全量拉取，无分页

`GET /review-pool` 一次性 `take: 200` 且 `include records + question` 全字段。数据量上去后是慢查询。**P1 顺手**：`review-pool` 列表改为只取必要字段并按 `pendingSub > 0` 优先排序，详情接口保持原样。

### 🟡 H7｜历史会话的口径混杂（方案 §11.1 的缓释不够）

方案说「引入 `scoringVersion`，历史会话保留原值」。但同一张成长曲线图上会同时出现旧口径与新口径的 Band 点，用户无从分辨，仍会误读。
**补充**：提供**可选的重算工具** `POST /language/scoring/rescore`（ADMIN，`dryRun` 默认 true、`confirm` 必填，严格幂等）。默认**不执行**，由你决定何时对齐历史。

### 🟡 H8｜批改台的跨学生可见范围过宽

`GET /review-pool` 与 `GET /sessions/:id` 允许**任意** TEACHER/ADMIN 读取**任意学生**的语言会话。语言模块当前没有班级维度，无法套用 `visibleClassIds`（教务模块的既有收敛机制）。
**修订(实施时改了主意)**:进一步权衡后改为 `?scope=mine` **可选收窄**、默认仍是 `all`。
理由:把"学生自主练习产生的待批改"藏起来会**直接破坏现有批改工作流**(现有会话几乎都没有 assignmentId),
而同一所学校内教师本质是同事关系。宁可给出开关,也不动默认行为。

---

## 三、对方案设计的两条**反向修订**

### ❌ 修订 1：`LanguagePaper.bandTableId` 建议**不要加**

方案 §4.1 给试卷加 `bandTableId`。但 §4.3 的 `LanguageBandTable` 定位键已经是 `(examType, skill, effectiveFrom, isDefault)` —— 再加一层「试卷→指定某张表」会形成**双源真相**：同一道客观题在不同卷里落到不同量纲，历史数据再无法横向比较。
**决定**：不加 `bandTableId`。`testType` / `officialRef` 照加（纯描述字段，无害）。

### ❌ 修订 2：§7.4「实现 .25/.75 进位」是重复造轮子

现有代码 `Math.round(avg * 2) / 2` **已经等价于** IELTS 官方进位规则：
`6.25 → 6.5` ✅、`6.75 → 7.0` ✅、`6.1 → 6.0` ✅、`8.75 → 9.0` ✅。
方案把它列为"待实现"会让实施者误以为要重写。**决定**：保留现算式，移入 `lib/lang-scoring.js` 并加单测锁定语义即可，不另写一套。

### ➕ 补充：会话必须落 **分项 Band**，否则学情切片无从谈起

方案 §4.1 有 `LanguageSession.skillBands`（JSON）✅，很好。强调它是 **H1 与 H2 的共同解**：
- H1：FULL 卷不再试图把四项揉成一个数，而是 `{LISTENING: 6.5, READING: 7.0, WRITING: null(待批改)}`，全齐后再合成 `overallBand`；
- H2：每技能自带分子分母，前端不再用被污染的 `total` 估算。

---

## 四、待拍板项的裁量决定（你要求不中断，我按下述执行，均可回滚）

| 方案 §11.2 | 我的裁定 | 理由 |
|---|---|---|
| 1. 是否全做 4 期 | **先做 P1** | 评分是地基，先把"分数算对"和"口径唯一"钉死，P2–P4 才有可信底座 |
| 2. 是否引入 AI 预评 | **暂不引入** | 涉及外部模型调用与成本，且 P3 才有承载它的批改台；表结构预留 `aiPreScore` 字段不落实现 |
| 3. 词汇模块是否本期做 | **不做**，维持 P4 | 全新子系统，范围膨胀风险最高 |
| 4. 导入优先哪个技能 | **顺延到 P2/P3** | P1 专注"算分正确"，不做内容生产 |
| 5. 学情是否接班级维度 | **暂不接入** | 改用 H8 的 `Assignment.teacherId` 作用域轻量替代；语言模块目前是无班级的自由练习形态 |

**拍板请求（本次不阻塞，上线后你再定）**：
1. H8 的 `?scope=mine` 目前只是可选开关：是否要把它设为默认收窄，或改成管理员可配？
2. 7. 的重算工具，历史会话（当前数百条）要不要择机对齐到新口径？
3. 练习卷（<20 题）是否应该**干脆不显示 Band**，只显示正确率？我暂按"显示 + 标注已折算"处理。

---

## 五、P1 实施范围（本次交付）

### 后端
| 项 | 内容 |
|---|---|
| 新增 lib | `apps/api/src/lib/lang-scoring.js`：`SCORING_VERSION`、听/读分离可配换算表（自动播种官方默认表）、`bandFromRaw(maxRaw)`、`roundIeltsBand`、四维量表常量（写作 TR/CC/LR/GRA、口语 FC/LR/GRA/Pron）、`composeOverall`、`ensureDefaultBandTables()` |
| schema（纯附加） | 新表 `LanguageBandTable`、`LanguageGoal`；字段见 §5.1 |
| 修复 | H1 全真卷合成、H2 分项分子分母、H3 `maxRaw` 折算标注、H4 多选归一、H6 批改台瘦身、H7 重算工具、H8 批改作用域、G3 `YES_NO_NG` 可录入 |
| 端点 | `GET /scoring-config`、`GET/PUT /band-tables`、`POST /band-tables/reset`、`GET/PUT /goals`、`GET /wrong-book` + `POST /wrong-book/:qid/master` + `DELETE /wrong-book/:qid`、`GET /sessions/:id/report`、`POST /scoring/rescore`、`grade` 扩展四维 |

### 前端
| 文件 | 改动 |
|---|---|
| `components/LangGrowthPanel.tsx` | 删除本地 `estimateBand`（修 G2），统一读后端 `band/overallBand`；加目标分参考线；**不动版式** |
| `app/app/language/wrong/page.tsx` | **新增**错题本（补 G1） |
| `app/app/language/report/[sessionId]/page.tsx` | **新增**四维报告（雷达图 + 分项 Band + 目标差距 + 建议） |
| `app/app/language/page.tsx` | 加目标分卡 + 错题本入口 |
| `app/teacher/language/page.tsx` | 批改台四维打分面板（含自动均分/一键套用）；题型下拉补 `YES_NO_NG` |

### 文档
`docs/API.md` 补「语言学习模块」章节（评分口径 + 全部端点）。

### 明确**不做**（避免波及）
- 不动任何非 `Language*` 表与非 `/api/language` 路由；
- 不改既有任何一列的语义，全部新增可空列，存量数据零迁移；
- 不动 `Assignment` 除读取外的任何逻辑。

---

## 附：隔离与回滚

- 全部落库动作为**纯附加**（新表 + 可空列），`prisma db push` 对既有数据零写入；
- 上线前执行双备份（服务器快照 + 本地下载）；
- 前端新增页面均为独立路由，与既有路径无交叠，可整块下线；
- 版本号 V2.4.126，可整版回滚到 e829c60（V2.4.125）。
