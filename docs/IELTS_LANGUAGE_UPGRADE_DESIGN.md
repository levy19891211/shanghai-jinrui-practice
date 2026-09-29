# 雅思语言学习板块 · 全面升级设计方案

- **文档版本**：v1.0（Draft）
- **状态**：待评审 · **未执行**（本文件仅为方案，不含任何代码/库改动）
- **日期**：2026-09-29
- **范围**：仅 `/api/language` 命名空间 + `Language*` 数据表 + 学生端 `/app/language`、教师端 `/teacher/language`、个人空间 `LangGrowthPanel`
- **不触碰**：学科模块 `Question / Paper / Session / AnswerRecord / Assignment(学科部分)`，以及 `planning`、`academics`、`roguelike` 模块
- **关联文档**：`docs/API.md`（契约，需按本方案补齐语言章节）、`docs/ARCHITECTURE.md`、`AGENTS.md`

---

## 0. 一页摘要

**现状**：语言模块自 V2.4.0 起以独立命名空间存在（6 张表 + `/api/language`），已覆盖"听说读写客观题作答 + 听力/阅读自动判分与 Band 折算 + 写作/口语人工批改 + 作业分发 + 个人成长看板"。工程隔离干净，是很好的地基。

**问题**：现有能力只到"雅思客观题刷题器"，**离"雅思学习/教学/练习/测评"整套需求还有结构性缺口**，且存在 4 处"已在库但断链"的隐性缺陷。

**判断**：不建议推倒重来，应**在现有独立模块上做加法**（新增表 + 扩展可空字段 + 新增端点 + 新增页面），分 4 期交付。核心是补齐三件事——**①测评引擎（四维评分 + 可配 Band 换算 + 目标判定）②真实题型结构（题组指令块 + 选项池 + 听力 Part 级音频）③词汇与错题本闭环**。

**关键收益**：把"刷题"变成"学/教/练/测闭环"；把"一个 Band 数字"变成"四维诊断 + 提分动作"；把"教师逐题手工批改"变成"AI 预评 + 四维量表 + 评语库"。

---

## 1. 现状盘点

### 1.1 数据表（`apps/api/prisma/schema.prisma`）

| 表 | 行号 | 作用 | 关键字段 | 缺口 |
|---|---|---|---|---|
| `LanguageMaterial` | 369 | 材料：阅读文章 / 写作任务 / 口语提示 | title, content | 无 kind 区分、无 Task1 图表数据、无音频 |
| `LanguageQuestion` | 381 | 语言题 | examType, skill, qType, part, groupTitle, stem, options, answer, solution, audioUrl, materialId, wordLimit, difficulty, status | 无 topic/tags、无题组归属、无选项池、无题目级音频策略 |
| `LanguagePaper` | 409 | 语言卷 | questionIds, segments, mode, durationMin, kind, status | 无 Part 结构表、无音频资源、无 Band 表绑定 |
| `LanguageSession` | 430 | 会话 | score, total, correctCount, band, mode, durationMin | band 为单一值，无四维、无目标分、无技能分项 |
| `LanguageAnswerRecord` | 454 | 作答记录 | selected, isCorrect, band, feedback, audioUrl, timeSpent | band 为单一值，**无四维 subscores**（CHANGELOG 宣称的"4 维度 Band"并未落库） |
| `LanguageWrongBook` | 472 | 语言错题本 | wrongCount, mastered | **只写不读**（详见 1.5） |
| `Assignment.languagePaperId` | 296 | 语言作业关联 | 可空外键 | 复用良好 |

### 1.2 API 现状（`apps/api/src/routes/language.js`，共 1383 行）

| 分组 | 端点 | 说明 |
|---|---|---|
| 上传 | `POST /upload-audio`、`POST /upload-recording` | 教师音频 / 学生录音，落 `/var/www/uploads` |
| 题库 | `GET/POST/PUT/DELETE /questions`、`POST /questions/:id/review` | 单题 CRUD + 审核 |
| 材料 | `GET/POST/PUT/DELETE /materials` | 材料 CRUD |
| 篇章 | `GET/POST/PUT/DELETE /passages`、`/passages/:id/review`、`/passages/import`（PDF 视觉抽取） | 阅读篇章 = 文章 + 绑定题目 |
| 组卷 | `GET/POST/PUT/DELETE /papers` | 卷 CRUD |
| 会话 | `POST /sessions`、`/sessions/:id/answer`、`/answer/text`、`/submit`、`GET /sessions/:id`、`GET /sessions` | 开卷/作答/交卷/详情/历史 |
| 作业 | `GET /my-assignments` | 学生语言作业 |
| 批改 | `GET /review-pool`、`/review-pool/:sid`、`POST /review-pool/:sid/grade` | 写作/口语批改台 |
| 统计 | `GET /stats/overview` | 全局近似统计（无班级/学生切片） |

### 1.3 前端现状

| 端 | 文件 | 现状 |
|---|---|---|
| 学生 | `app/app/language/page.tsx` | 按 听说读写+全真 分块展示试卷卡片 |
| 学生 | `app/app/language/practice/[id]/page.tsx` | 计时/分段倒计时、听力音频（EXAM 一次）、阅读分屏+DOM 高亮、写作字数、口语录音、2s 自动保存、标记、导航 |
| 学生 | `components/LangGrowthPanel.tsx` | Band 轨迹/四技能柱状图/成长教练/成就/时间线 |
| 教师 | `app/teacher/language/page.tsx` | 4 Tab：语言题库（阅读篇章化）/ 语言组卷 / 批改台 / 作业分发 |

### 1.4 能力矩阵：现状 vs 雅思需求

图例：✅ 已具备　⚠️ 部分具备　❌ 缺失

| 维度 | 能力项 | 现状 | 说明 |
|---|---|---|---|
| 测评 | 客观题自动判分 | ✅ | 填空容错（多答案以竖线分隔、复数 ±s、连字符归一） |
| 测评 | Band 换算 | ⚠️ | **硬编码 12 行单表、听读共用、按比例折算到 40 题**，教师不可维护 |
| 测评 | 写作四维评分（TR/CC/LR/GRA） | ❌ | 仅单值 band |
| 测评 | 口语四维评分（FC/LR/GRA/Pron） | ❌ | 仅单值 band |
| 测评 | 总分合成（四技能 + .25/.75 进位） | ❌ | 简单算术平均 |
| 测评 | 目标分与达标判定 | ❌ | 无 |
| 题型 | 听力填空家族（表格/摘要/笔记/流程图） | ❌ | 仅 FILL_BLANK |
| 题型 | 阅读 TFNG/Heading/Matching | ⚠️ | 有，但无选项池、无指令块、无 YNNG |
| 题型 | 题组指令块（rubric + 题号段） | ❌ | 仅有 groupTitle 文本 |
| 题型 | List of Headings / Features 选项池 | ❌ | 每题重复存池 |
| 听力 | Part 级音频共享 | ❌ | 音频挂单题，同 Part 需重复挂 |
| 听力 | 审题时间 / 检查时间 | ❌ | 无 |
| 阅读 | 高亮持久化 / 笔记 / 原文定位 | ❌ | DOM mark，刷新即丢，不落库 |
| 写作 | Task1 图表（图表/流程/地图）渲染 | ❌ | 无图表数据模型 |
| 写作 | 结构提示 / 计时分配 | ⚠️ | 仅字数统计 |
| 口语 | 题卡（cue card）结构化 | ⚠️ | 仅长文本素材 |
| 口语 | Part2 准备 1min + 作答 2min 计时 | ❌ | 无 |
| 口语 | 同 Part 多题多录音 | ❌ | 单题单录音 |
| 词汇 | 生词本 / 闪卡 / SRS | ❌ | **完全缺失** |
| 错题 | 语言错题本（学生可见） | ❌ | 表存在但**无读接口、无前端** |
| 教学 | 听力/写作/口语素材导入 | ❌ | 仅"阅读篇章 PDF" |
| 教学 | AI 出题 / 改编 | ❌ | 未复用已有命题能力 |
| 教学 | 四维量表 + 评语库 + AI 预评 | ❌ | 仅单值 + 自由文本 |
| 教学 | 群体/班级学情 | ❌ | 仅全局 overview |
| 数据 | 前端/后端 Band 口径统一 | ❌ | 两套换算（见 1.5） |

### 1.5 隐性问题（本次盘点新发现，建议随升级一并修）

| # | 问题 | 证据 | 影响 |
|---|---|---|---|
| G1 | **语言错题本断链** | `LanguageWrongBook` 仅在 `submit` 写入（language.js:1060-1067）与删除处出现；**无任何 GET 端点**，前端零引用 | 学生看不到自己的语言错题，"刷题→复盘"闭环断裂 |
| G2 | **Band 换算口径双轨** | 后端 `bandOf()`（language.js:23-33，比例查表）与前端 `estimateBand()`（LangGrowthPanel.tsx:48-63，阶梯 0.9→9）算法不同 | 同一会话在列表与详情可能出现不同 Band，伤害可信度 |
| G3 | **`YES_NO_NG` 判分已支持但不可录入** | 判分/统计分支含 `YES_NO_NG`，但教师端 `QTYPES.READING` 无此项 | 阅读 YNNG 题无法通过 UI 录入 |
| G4 | **契约文档缺语言章节** | `docs/API.md` 无任何 language/雅思 命中 | 违反 `AGENTS.md`「接口变更先改 API.md」；跨 AI（Vibe Coding 侧）协作无契约可依 |
| G5 | **教师端限宽红线** | MEMORY 记录"教师端 `<main>` 锁 `max-w-5xl`，禁 `xl:`/`2xl:`" | 新增教师端页面/表格须遵守，避免布局溢出 |

---

## 2. 设计目标与范围

### 2.1 四条主线

| 主线 | 目标 |
|---|---|
| **学习** | 词汇/同义替换/题型技巧可学、可复习；练习带讲解与出处 |
| **教学** | 素材快速入库（含听力/写作/口语）、AI 预评、四维量表批改、群体学情 |
| **练习** | 分技能专项 + 全真连考还原；听力 Part 音频、阅读笔记定位、写作图表、口语题卡计时 |
| **测评** | 四维评分 + 可配 Band 换算 + 总分合成 + 目标分判定；口径唯一 |

### 2.2 范围与非目标

- **范围内**：`Language*` 表扩展/新增、`/api/language` 新端点、学生端/教师端/个人空间三处 UI、`docs/API.md` 语言章节。
- **本期不做（列为可选/后续）**：口语机器发音评测（需外部 ASR 服务）、真人 1v1、跨端实时协同、自适应组卷算法（先做规则推荐）。

### 2.3 设计原则

1. **只加不改**：新增表 + 新增**可空**字段，不改动既有列语义，存量数据零迁移风险。
2. **可回滚**：每期含独立回滚点（备份 + 表级回滚脚本 + 前端 feature flag）。
3. **契约先行**：任何端点先写 `docs/API.md` 语言章节，再实现。
4. **复用优先**：复用学科模块已验证能力——图表离线验收（`web-ui-deliver-verify`）、内容门禁、`Agent` 读图核验、作业分发（`Assignment`）。
5. **口径唯一**：Band 一律由后端"评分引擎"产出，前端不再自行估算。

---

## 3. 目标架构（五层）

```text
┌───────────────────────────────────────────────────────────────┐
│ L5 洞察层  Analytics                                          │
│   学情(生/班/题型/话题) · 错因 · 成长曲线 · 目标达成           │
├───────────────────────────────────────────────────────────────┤
│ L4 评分引擎 Scoring                                            │
│   BandTable(可配,听读分离) → 客观分→Band                       │
│   EssayScore 四维(TR/CC/LR/GRA) · SpeakingScore 四维(FC/LR/GRA/Pron) │
│   BandComposer: 技能Band → 总分Band(.25/.75进位) → 目标判定     │
├───────────────────────────────────────────────────────────────┤
│ L3 会话层 Session                                             │
│   练习/模考/作业 · 自动保存 · 分段计时 · 音频策略(ONCE)         │
├───────────────────────────────────────────────────────────────┤
│ L2 组卷层 Paper                                               │
│   LanguagePaper(Test) · Part 结构 · LanguageAudio(Part级)     │
├───────────────────────────────────────────────────────────────┤
│ L1 内容层 Content                                             │
│   Material(kind: ARTICLE/CHART/CUE_CARD/PROMPT)               │
│   Question(topic/tags) · QuestionGroup(rubric+题号段)          │
│   OptionPool(List of Headings/Features/...)                   │
└───────────────────────────────────────────────────────────────┘
```

**数据流**：内容层入库 → 组卷层拼卷（含 Part/音频）→ 会话层作答 → 评分引擎判分/批改 → 洞察层出报告与推荐 → 推荐回流到练习入口。

---

## 4. 数据模型升级（字段级清单）

> 全部为**新增**（表）或**新增可空列**（字段）。Prisma `migrate` 生成，无需回填即可上线。

### 4.1 扩展既有表

| 表 | 新增字段 | 类型 | 说明 |
|---|---|---|---|
| `LanguageQuestion` | `topic` | String? | 话题标签（教育/环境/科技/健康…），供学情切片 |
| | `tags` | String? | JSON 数组，技巧标签（paraphrase/主谓一致…） |
| | `questionGroupId` | String? | 归属题组（见 4.2） |
| | `optionPoolId` | String? | 引用选项池（见 4.3） |
| | `answerFormat` | String? | 归一化规则（ONE_WORD / NO_MORE_THAN_TWO_WORDS / A_LETTER…） |
| | `sourceRef` | String? | 原文出处句/段落（供"定位联动"） |
| | `estSec` | Int? | 建议用时（秒），支持"计时分配" |
| `LanguageMaterial` | `kind` | String? | ARTICLE / CHART / CUE_CARD / PROMPT |
| | `chartSpec` | String? | Task1 图表 JSON（type/data/labels） |
| | `audioUrl` | String? | 材料级音频（口语样例、听力场景音） |
| `LanguagePaper` | `testType` | String? | SECTIONAL / FULL / MOCK |
| | `officialRef` | String? | 官方卷出处（如 Cambridge 18 Test 2） |
| | `bandTableId` | String? | 绑定换算表版本 |
| `LanguageSession` | `skillBands` | String? | JSON：各技能 Band（全真卷分项） |
| | `overallBand` | Float? | 合成总分 Band |
| | `goalBand` | Float? | 作答时快照的目标分 |
| | `scoringVersion` | String? | 评分引擎版本（可追溯口径变更） |
| `LanguageAnswerRecord` | `subscores` | String? | JSON 四维分（写作/口语） |
| | `rubricVersion` | String? | 量表版本 |
| | `aiPreScore` | String? | JSON：AI 预评（非定分，供教师参考） |
| | `gradedBy` / `gradedAt` | String? / DateTime? | 批改人与时间（审计） |

### 4.2 新增：题组与选项池

| 新表 | 字段 | 说明 |
|---|---|---|
| `LanguageQuestionGroup` | id, materialId, instruction, fromNo, toNo, qType, optionPoolId, order | **instruction** 存整段指令（"Questions 1–7: Do the following statements agree with the claims…"），**fromNo/toNo** 存题号段；一篇文章可多组 |
| `LanguageOptionPool` | id, materialId, kind, items(JSON), usage | kind = HEADINGS / FEATURES / PEOPLE / SENTENCE_ENDINGS；items 存池内全部候选；`usage` 记录被哪些题引用，删除前校验 |

### 4.3 新增：评分引擎相关

| 新表 | 字段 | 说明 |
|---|---|---|
| `LanguageBandTable` | id, examType, skill, rows(JSON), effectiveFrom, isDefault | rows = `[{raw, band}]`，**听力与阅读分别建表**；支持"换算表随官方更新"的版本化 |
| `LanguageAudio` | id, paperId, part, url, transcript, durationSec, playPolicy | Part 级音频（10 题共享），playPolicy = ONCE / REPEATABLE |
| `LanguageGoal` | id, studentId, examType, targetBand, targetDate, updatedAt | 目标分（与升学规划模块解耦，仅语言用） |

### 4.4 新增：词汇与 SRS

| 新表 | 字段 | 说明 |
|---|---|---|
| `LanguageVocabItem` | id, studentId, word, pos, meaningZh, meaningEn, example, sourceQuestionId, sourceSessionId, tags, ease, intervalDays, dueAt, reps, lapses | 生词条目；来源可追溯到具体题/会话 |
| `LanguageVocabReview` | id, itemId, reviewedAt, grade(0-5), prevInterval, nextInterval | 复习流水，用于统计与算法调参 |
| `LanguageVocabDeck` | id, name, examType, topic, items(JSON), createdBy | 教师词表/雅思核心词库（可选，P4） |

---

## 5. API 设计（新增/变更清单）

> 命名空间仍为 `/api/language`；权限沿用 `requireAuth` + `requireRole("TEACHER","ADMIN")`。

| 分组 | 方法 路径 | 说明 | 权限 |
|---|---|---|---|
| 题组 | `GET/POST/PUT/DELETE /question-groups` | 指令块 CRUD（含题号段） | 教师 |
| 选项池 | `GET/POST/PUT/DELETE /option-pools` | List of Headings 等池 CRUD | 教师 |
| 换算表 | `GET /band-tables`、`PUT /band-tables/:id` | 查看/编辑 Band 换算表 | 教师 |
| 导入 | `POST /listening/import` | 听力 PDF→题干草稿 + 音频占位 | 教师 |
| 导入 | `POST /writing/import` | 写作题+范文导入 | 教师 |
| 导入 | `POST /speaking/import` | 口语题卡导入 | 教师 |
| AI | `POST /questions/ai-draft` | 复用命题能力生成草稿（不直接入库） | 教师 |
| 会话 | `POST /sessions/:id/note` | 阅读笔记/高亮持久化 | 学生 |
| 会话 | `POST /sessions/:id/speaking/record` | Part 内多题录音 | 学生 |
| 报告 | `GET /sessions/:id/report` | 四维报告 + 错因 + 目标差距 | 学生/教师 |
| 评分 | `POST /review-pool/:sid/grade`（**扩展**） | body 增加 `subscores`（四维），自动合成 | 教师 |
| 评分 | `POST /review-pool/:sid/ai-prescore` | 触发 AI 预评（非定分） | 教师 |
| 词表 | `GET /vocab`、`POST /vocab`、`POST /vocab/:id/review`、`GET /vocab/due` | 生词 CRUD + SRS 复习队列 | 学生 |
| 错题 | `GET /wrong-book`、`POST /wrong-book/:qid/master` | **补 G1 断链** | 学生 |
| 目标 | `GET/PUT /goals` | 目标分读写 | 学生 |
| 学情 | `GET /stats/class`、`/stats/student/:id`、`/stats/qtype-radar` | 群体/个体/题型雷达 | 教师 |
| 一致性 | `GET /scoring-config` | 返回当前评分口径与版本（前端展示用） | 全角色 |

---

## 6. 前端设计

### 6.1 学生端

| 页面 | 改动 |
|---|---|
| `/app/language`（首页） | 新增：目标分卡 + 四技能进度环 + **推荐练习**（依据薄弱技能/到期生词）+ 词汇/错题本入口 |
| `/app/language/practice/[id]` | 听力：Part 级音频条 + 审题倒计时；阅读：笔记/高亮**落库** + 点题定位原文；写作：Task1 图表渲染 + 结构提示 + 分段计时；口语：题卡结构化 + Part2 准备(1min)/作答(2min)计时 + 同 Part 多题录音 |
| `/app/language/report/[sessionId]`（新） | 四维雷达图 + 错因分布 + 目标差距 + 可执行下一步 |
| `/app/language/vocab`（新） | 生词本 + 闪卡复习（SRS 队列）+ 掌握度进度 |
| `/app/language/wrong`（新） | 语言错题本（补 G1）：按技能/题型聚合，支持"已掌握"归档 |

### 6.2 教师端

| Tab | 改动 |
|---|---|
| 语言题库 | 题组/指令块编辑器；选项池管理；听力/写作/口语导入；AI 草稿入口；补 `YES_NO_NG`（修 G3） |
| 语言组卷 | Part 结构编辑、Part 级音频绑定、Band 表绑定 |
| 批改台 | **四维打分面板**（维度滑杆 + 自动均分）+ **常用评语库**（一键套用）+ **AI 预评展示** + 批改量/时长看板 |
| 群体学情（新） | 按班/按生/按题型雷达/话题热力/目标达成率 |
| 红线 | 教师端 `<main>` 限宽 `max-w-5xl`，**禁 `xl:` / `2xl:`**（修 G5） |

### 6.3 个人空间 `LangGrowthPanel`

- 拆掉本地 `estimateBand()`（修 **G2**），改用后端 `band` / `overallBand`；
- 新增四技能雷达图、目标分参考线、词汇统计（待复习/已掌握）；
- 图表沿用 `next/dynamic({ssr:false})`（recharts 红线）。

---

## 7. 测评引擎（本方案重点）

### 7.1 Band 换算表（可配、听读分离）

- 移除硬编码 `LISTENING_BAND`，改为 `LanguageBandTable` 读表；
- 听力、阅读各一份（题量与容错曲线不同），支持多版本 + `effectiveFrom`；
- 不再"按比例折算到 40 题"，而是**按实际题数就近查表**（配套维护 20/30/40 题量表）。

### 7.2 写作四维评分

| 维度 | 含义 | 取值 |
|---|---|---|
| TR | Task Response / Task Achievement | 0–9，步长 0.5 |
| CC | Coherence & Cohesion | 同上 |
| LR | Lexical Resource | 同上 |
| GRA | Grammatical Range & Accuracy | 同上 |

写作 Band = 四维算术平均 → 就近 0.5 进位（.25 进位、.75 进整，与官方一致）。

### 7.3 口语四维评分

| 维度 | 含义 |
|---|---|
| FC | Fluency & Coherence |
| LR | Lexical Resource |
| GRA | Grammatical Range & Accuracy |
| Pron | Pronunciation |

口径同写作。

### 7.4 总分合成与目标判定

- 单技能卷：Band = 该技能 Band（客观查表 / 主观四维均分）。
- 全真卷：overall = 听/读/写/口 四项平均 → 就近 0.5（**实现雅思 .25/.75 进位规则**）。
- 目标判定：`overallBand ≥ goalBand` 判达标；否则输出"差距最多的技能 + 建议动作"。

### 7.5 双轨批改

- AI 预评：写入 `aiPreScore`，**仅供教师参考，不参与定分**（避免误判伤害信任）；
- 教师终评：写 `subscores` + `feedback`，以教师分为准；
- 主观题未批改时，`overallBand` 置空并标注"待批改"（沿用现有 `needsReview` 语义）。

### 7.6 口径一致性

- 前端**不再**自行估算；一切 Band 由评分引擎计算并随 `scoringVersion` 落库，报告页显示口径版本。

---

## 8. 词汇与 SRS 模块

- **算法**：简化 SM-2（`ease` 初始 2.5，按评分 0–5 调整 `intervalDays`，`lapses` 归零重排）。
- **生词来源**：① 会话中手动"收藏"；② 阅读/听力原文生词一键采集；③ 教师词表/雅思核心词库。
- **复习队列**：`GET /vocab/due` 返回 `dueAt <= now` 的卡片，前端闪卡正反面 + 自评。
- **与练习联动**：首页"推荐"优先推送"到期生词"与"薄弱题型"。

---

## 9. 分期实施路线图

| 期 | 主题 | 主要交付物 | 验收门禁 | 依赖 |
|---|---|---|---|---|
| **P1** | 地基与测评引擎 | 新表迁移；`band-tables`；四维 `subscores`；总分合成 + 目标；`GET /scoring-config`；补 G1 错题本接口；补 G4 契约；修 G2/G3 | `docs/API.md` 语言章节先落；`tsc --noEmit`；只读读回核对 | 无 |
| **P2** | 学练体验还原 | 听力 Part 音频 + 审题计时；阅读笔记/高亮落库 + 定位；写作 Task1 图表 + 计时；口语题卡 + 准备计时 + 多题录音 | 图表离线渲染验收（`web-ui-deliver-verify`，产物禁 `NaN/undefined`）；移动端实测 | P1 |
| **P3** | 教与测闭环 | 听力/写作/口语导入；AI 草稿；批改台四维面板 + 评语库 + AI 预评；四维报告页；群体学情 | 批改→报告端到端 E2E；限宽红线检查 | P1-P2 |
| **P4** | 词汇与智能 | 词汇 SRS；推荐引擎（薄弱+到期）；目标管理 UI；AI 预评上线 | SRS 算法单测；推荐命中率抽检 | P3 |

---

## 10. 兼容性 / 隔离 / 回滚 / 迁移

| 项 | 措施 |
|---|---|
| 隔离 | 全部改动限于 `Language*` 表与 `/api/language`；学科表零改动 |
| 迁移 | `prisma migrate` 新增表 + 新增**可空**列，存量行无需回填 |
| 回滚 | 每期前置服务器备份 + 表级回滚脚本；前端用 feature flag 灰度 |
| 门禁 | 契约先行；`tsc`；`verify:math`（若涉渲染）；离线图表验收；上线四道关（md5/grep/构建指纹/实抓 chunk） |
| 数据安全 | 破坏性操作走"双重备份 → FK 有序事务 → 孤儿校验 → 用户确认" |

---

## 11. 风险与待拍板

### 11.1 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| Band 换算表改动影响历史成绩口径 | 历史 Band 与新口径不一致 | 引入 `scoringVersion`，历史会话保留原值，报告注明版本 |
| 四维评分增加教师负担 | 批改变慢 | 评语库 + AI 预评 + 一键均分，目标"每篇 ≤90 秒" |
| 题型/题组模型变更面大 | 迁移与前端连锁 | 只加字段；题组为可选，旧数据无题组仍可跑 |
| 词汇模块是全新子系统 | 范围膨胀 | 锁定 P4，先只做"生词本 + 简单 SRS"，不铺词库运营 |

### 11.2 待用户拍板

1. **范围**：本方案 4 期是否全做，还是先做 P1（测评引擎 + 断链修复）验证效果？
2. **AI 预评**：是否引入（涉及外部模型调用与成本），还是先纯教师批改？
3. **词汇模块**：是否本期就做（P4 提前），还是先聚焦"听说读写 + 测评"？
4. **导入范围**：听力/写作/口语导入优先哪个（决定 P3 排序）？
5. **教师端页面**：群体学情是否接入 `academics` 班级维度（复用现有班级/成员表）？

---

## 附录 A：与现有系统复用清单

| 已有能力 | 复用点 |
|---|---|
| `web-ui-deliver-verify` | 四维雷达/图表离线验收 |
| `Assignment` 分发 | 语言作业（已复用，继续用） |
| `academics` 班级/成员 | 群体学情按班切片（待拍板项 5） |
| 命题/修正能力 | AI 草稿生成与题目质检 |
| 上线四道关 + 五段式改库 | 本方案全部落库动作 |

## 附录 B：术语对照

| 缩写 | 全称 | 中文 |
|---|---|---|
| TR / TA | Task Response / Achievement | 任务回应/完成度 |
| CC | Coherence & Cohesion | 连贯与衔接 |
| LR | Lexical Resource | 词汇资源 |
| GRA | Grammatical Range & Accuracy | 语法多样性与准确性 |
| FC | Fluency & Coherence | 流利与连贯 |
| Pron | Pronunciation | 发音 |
| TFNG / YNNG | True/False/Not Given · Yes/No/Not Given | 判断/是非判断 |
| SRS | Spaced Repetition System | 间隔重复 |
