# TASKS.md — 任务清单与分工看板

> 每个任务标注负责人:`[WB]` = WorkBuddy,`[VC]` = Vibe Coding 工具,`[BOTH]` = 双方协作。
> 任务状态:`[ ]` 待办,`[x]` 完成,`[!]` 阻塞。

## 阶段一:项目初始化 ✅

- [x] `[BOTH]` 建立 monorepo 骨架(npm workspaces + 目录结构)
- [x] `[BOTH]` 编写 AGENTS.md 协作约定
- [x] `[BOTH]` 初始化 Git 仓库
- [ ] `[BOTH]` 推送到远程仓库(GitHub / Gitee),双方 clone

## 阶段二:系统设计与架构 ✅(文档已落档)

- [x] `[BOTH]` 确定业务:TMUA / ESAT 在线刷题系统(学生刷题 + 考试数据 + 老师题库)
- [x] `[BOTH]` docs/ARCHITECTURE.md 工程架构文档
- [x] `[BOTH]` docs/API.md 完整接口契约(认证/题库/会话/成绩/学情)
- [x] `[WB]` 数据模型 prisma/schema.prisma(User/Question/Paper/Session/AnswerRecord/WrongBook)
- [x] `[BOTH]` 题库来源确定:官方真题(UAT-UK esat-tmua.ac.uk),PDF 需结构化录入

## 阶段三:M1 基础闭环(后端 WorkBuddy 进行中)

- [x] `[WB]` Express 服务 + 健康检查接口 `GET /api/health`
- [x] `[WB]` 数据库接入:SQLite + Prisma(schema 已定)
- [ ] `[WB]` 认证 API:注册 / 登录 / 当前用户(JWT + bcrypt)
- [ ] `[WB]` 题库 API:题目 CRUD + 筛选 + 分页
- [ ] `[WB]` 判分引擎 + 会话 API:创建/作答/提交/详情
- [ ] `[WB]` 成绩与错题本 API:历史 / 错题 / 掌握度
- [ ] `[WB]` 种子数据脚本(官方真题示例题目 + 演示账号)
- [ ] `[WB]` 自动化测试(认证、判分)

## 阶段四:M1 前端 ✅(WorkBuddy 先行实现,VC 工具可在此基础上优化)

- [x] `[VC]` 初始化 Next.js 项目(TypeScript + Tailwind + ESLint)+ `/api` 代理
- [x] `[VC]` 登录 / 注册页面
- [x] `[VC]` 刷题页(练习模式):题目展示、选项作答、即时对错与解析
- [x] `[VC]` 题库管理页(老师):题目列表、新增/编辑/删除
- [x] `[BOTH]` 联调:注册 → 刷题 → 提交判分 → 看成绩

## 阶段五:M2 考试模式(基础已完成,图表待办)

- [x] `[VC]` 限时模拟考界面(倒计时、答题卡、防刷新丢进度)
- [x] `[WB]` 模考交卷判分(超时自动提交,timedOut 标记)
- [ ] `[VC]` 成绩历史与趋势图(建议 Recharts 折线图:按时间展示分数/正确率变化)

## 阶段六:M3 学情分析

- [x] `[VC]` 错题本页面(按知识点分组、掌握标记)
- [ ] `[VC]` 知识点掌握度雷达图(Recharts RadarChart,数据源 `/me/stats`)
- [ ] `[WB]` 老师学情统计 API(班级/个人成绩、按知识点聚合)
- [ ] `[VC]` 老师学情报表页(学生列表、个人详情、班级正确率排行)

## 阶段七:M4 题库增强(真题录入进行中)

- [x] `[WB]` 官方真题 PDF 存档(assets/papers/tmua/ 27 份 + 资料 3 份)
- [x] `[BOTH]` TMUA 真题 PDF 结构化录入实验(2016-2023 正卷为字体乱码需 OCR;早期样卷可提取)
- [x] `[WB]` 真题录入:TMUA Specimen 2017 Paper 1(20 题)+ Paper 2(17 题)+ **图形题 3 题(Q4 卡片 / Q7 函数图 / Q10 对数图)**,共 **40 道官方真题**入库(题库 50)
- [x] `[WB]` **前端图片支持**:`RichText` 组件解析 `![alt](url)`(题干/选项嵌图)、老师编辑/批量导入提示支持
- [x] `[WB]` 图形题图片素材生成:11 张(matplotlib,Q4 卡片 1 + Q7 四选项 + Q10 六选项)
- [x] `[WB]` 批量导入 API(Excel / CSV / JSON)
- [x] `[WB]` 组卷功能(按知识点/难度/数量生成试卷)
- [x] `[VC]` 导入与组卷界面(WorkBuddy 代做,详见 commit 987feec)
- [x] `[WB]` **ESAT 物理 补充习题(186 题)导入部署**:`extra question.pdf` → `bank_esat_physics_supplement.json`(186 题 / 57 带图);矢量图元隔离裁剪 57 张 PNG 入服务器 `/var/www/uploads/`;`import_esat_physics_supplement.mjs` 入库,Questions=`PENDING_REVIEW`(学生不可见)、Paper=`DRAFT`(不可作答)、`topicIds` 按物理 19 知识点名解析 cuid;答案留空(占位 options[0])待老师后台补全(用户决策"先导入,答案留空待补");DB 复核 0 异常、`/uploads/*.png` 公网可达
- [x] `[WB]` **公式显示异常修复(186 题)**:诊断 PDF 纯文本提取导致 186/186 题无数学定界、上下标/单位/希腊字母损坏;改用 `pymupdf` 从源 PDF 整题渲染为高清 PNG,**每道题以单图呈现**(含题干+图表+所有选项),自动处理跨页题与页码裁剪;Options 置为 `["A","B",...]` 字母值,与前端 MC 字母按钮兼容、 grading 以 letter 比较;重新上传 186 张图覆盖 `/var/www/uploads/`,DB 复核 stem 全为图片、`options` 长度 4/5、answer∈options、0 异常
- [ ] `[WB]` 2016-2023 正卷录入(需 OCR 或人工,公式校对成本高,建议优先用批量导入接口)

## 阶段八:质量与交付

- [ ] `[BOTH]` 代码审查(互相审查 PR)
- [ ] `[WB]` 自动化测试完善
- [ ] `[VC]` 视觉走查与体验优化
- [ ] `[BOTH]` 部署上线(生产切 PostgreSQL)

---

## 进行中

- [x] `[BOTH]` **考情明细「时间分配甘特图」**（用户 2026-09-23 需求：查看明细里每个学生的时间统计表下方，加一个像甘特图一样记录整场考试时间分配、能看出"哪段时间在做哪道题"的统计图）— **V2.4.87 已上线；V2.4.88 改口径；V2.4.89「一题多段」**
  - `[WB]` `apps/api/src/routes/exams.js`：`GET /:id/student/:studentId` 的 `perQuestion[]` 新增 `answeredAt`（该题首次作答时刻，ISO 8601）；契约同步 `docs/API.md` §6.2（纯新增字段，向后兼容）
  - `[WB]` 新增 `apps/web/components/ExamTimeGantt.tsx`（纯手写 SVG，零新依赖）；`StudentExamDetail.tsx` 折线图下方接入
  - 说明：**本轮由 WB 代改 `apps/web/` 两个文件**（VC 所有权），未触碰其它前端文件；若 VC 同期在改同一文件请先沟通。
  - [x] `[WB]` **V2.4.88 改口径**（用户 2026-09-23：「请将中途退出/暂停造成的空白消除掉 保证显示的所有都是连续的」）：横轴由墙钟改为**累计作答时间轴**（各题 `timeSpent` 按首次作答先后首尾相接、整段剔除空白）⇒ 条带连续无缝、长度即真实停留，原「左端夹紧 + 斜纹压缩」机制整体删除。**仅改 `apps/web/components/{ExamTimeGantt,StudentExamDetail}.tsx`，api 未动**（`answeredAt` 字段继续沿用）。验证：7 场景离线 harness + 像素级测量 `maxGapPx=0 / mergedSegments=1`；上线四道关（md5 三处对齐 / grep 计数 / 构建指纹 / **实抓运行中进程的 served chunk**）全绿，web pid 2580817→2581665。
  - [x] `[WB]` **V2.4.89「一题多段」**（用户 2026-09-23：「如果学生在一道题上思考了几分钟没有作答、过了一段时间又回到这道题，图上应该有两段时间条」；范围限定：「过去的反推不出分段就算了 请后续学生所做的题目成'一题多段'的形式」）：因 `timeSpent` 是**累计标量**、`createdAt` 是**首次保存时刻** ⇒ 同一题的多次停留已被加总，**分段数学上无法反推**，故本特性**必须新增采集端**而非只改渲染。
    - `[WB]` 自有目录：`schema.prisma` 的 `AnswerRecord` 新增 `visits String?`（JSON `[[startEpochSec,durSec],…]`）；`sessions.js` 新增 `POST /api/sessions/:id/visits`（**整份数组覆盖、幂等**；⭐**只写 `visits`，绝不触碰 `selected/isCorrect/timeSpent`** ⇒ 保住全站「未作答」哨兵，且这类记录被既有查询自然过滤、各处统计不可见）；`exams.js` 的 `perQuestion[]` 新增 `visits`。
    - `[WB 代改 apps/web/]`（VC 所有权，**只动 3 个文件**）：`app/app/practice/[id]/page.tsx` 采集（切题 / `visibilitychange` / `pagehide` / SPA 卸载 / 交卷前结算 + 服务端时钟校准 + 毛刺 `MIN_VISIT_SEC=2` + `sessionStorage` 防丢 + 交卷先 await 作答再发分段）；`components/ExamTimeGantt.tsx` 渲染（同题多段 ⇒ 同行多条条带 + 同题相邻段白线 `data-split`；老数据回退合成单段）；`components/StudentExamDetail.tsx` 图注补「共 N 段（M 题回看过）」。若 VC 同期在改这 3 个文件请先沟通。
    - 验证：离线 harness（合成 7 场景 + **线上真实响应 47 段 / 13 多段题**、逐段 `from/to/seg/segTotal` 精确对齐）+ **本地真实浏览器 E2E 14 项 FAILS=0**（副本库快照 + 本地 api/web，零生产风险）+ 路由负向探针 5 组 + 线上体检（232 行 `visits` / **26% 真多段** / 0 毛刺 / 0 同题重叠 / `score === correctCount` 0 违规）。上线四道关全绿：api pid **2580296→2585221**、web pid **2581665→2585688**，BUILD_ID `_GIGIBPcsgyrE2XMTrYiO`。真实世界边界（段起点可落在会话墙钟区间外、`Σ段时长 ≠ timeSpent`）已作为口径补进 `docs/API.md`。

- [ ] `[BOTH]` 推送到远程仓库(等待用户提供远程地址)
- [x] `[WB]` M1 后端:数据库接入(SQLite + Prisma schema 已落地)
- [ ] `[WB]` M1 后端:认证与题库 API(下一步)
