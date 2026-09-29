# 版本历史

## V2.4.120 (2026-09-29) — 班级「考试与成绩」改为只读:按课程查看 / 按学生查看两个子模块
- 需求：班级管理模块下的「考试与成绩」不允许编辑，只能查看「本班涉及的全部课程里本班学生的成绩」以及「本班每个学生各课程的成绩」，并拆成「按课程查看」「按学生查看」两个子模块。
- 前端 `apps/web/app/teacher/academics/page.tsx`（`ExamsTab` 整体重写）：
  - **删除写操作**：移除「新建考试」按钮与 `CreateExam`、`ScoreEntry` 两个录入组件（原先每行是 `<input>`，现在全部是纯文本）。同步删掉已无人引用的 `ExamItem` / `ScoreRow` 类型。
  - 顶部加琥珀色**只读提示条**；子模块用分段控件切换「按课程查看 / 按学生查看」，右侧显示课程/考试/学生/成绩条数汇总。
  - **按课程查看**：左栏课程列表（带「N 场 / 暂无」徽章）→ 右栏「学生 × 考试」成绩矩阵；单元格显示 得分/满分 + 班级排名，缺考显示 `—`；表尾给出每场考试的 **已录/参考、平均分、中位数、最高/最低**；学生行末给出**平均得分率**。点考试列标题可展开该场「本场考试学情」（复用只读的 `ExamAnalytics`）。
  - **按学生查看**：左栏学生列表（支持按姓名/学号搜索，带「N 条」徽章）→ 右栏该生跨课程明细（课程 / 考试（含类型·日期）/ 得分/满分 / 得分率 / 排名 / 评语），顶部 4 张概览卡（覆盖课程、有成绩考试、全部考试、平均得分率）。
- 后端 `apps/api/src/routes/academics.js`：
  - 新增只读接口 **`GET /api/academics/classes/:id/gradebook`**：一次返回 `class / courses / students / scores`（扁平结构，前端透视成两个视图）。课程范围 = **班级课程目录(`Course.name`) ∪ 课表科目(`TimetableEntry.subject`) ∪ 已建考试科目(`Exam.subject`)** 三源并集去重，「有考试」的课程排前，其余按中文自然序；学生按学号自然序。作用域沿用考试/成绩口径（需可见该班；学科老师非班主任仅本人任教科目，课程与考试一并收窄）。**零写入。**
  - 顺手修掉一个潜在崩溃：`GET /exams` 里 `const exams` 后面又被 `exams = exams.filter(...)` 重新赋值（学科老师作用域过滤分支），教师角色一拉考试列表就抛 `Assignment to constant variable`；改为 `let exams`。
- **作用域收紧（安全）**：全仓 `visibleClassIds` 的既有惯例是 `if (ids.length && !ids.includes(id)) 403` —— 当用户可见班级集合为**空数组**时整条件短路，等于「不过滤」。因此**零班级归属的学生/家长可直接读任意班级的完整成绩册**（同理未任教任何班的老师）。新接口 `gradebook` 改为**严格判断** `if (!ids.includes(id)) 403`。其余老接口沿用旧惯例未动，见下方待办。
- 说明：成绩录入的**后端写接口保留**（`POST /exams`、`PUT /exams/:id`、`PUT /exams/:id/scores`），只是班级管理页不再提供入口；如需恢复入口，前端组件可从 git 历史取回。
- 验证：`node --check` + `tsc --noEmit` 通过；离线渲染自检（真实 Tailwind CSS + Playwright，桌面 1440px / 窄屏 900px 两档）两视图均**无横向溢出、无断词**；线上接口级 E2E **30 PASS / 0 FAIL、零残留**（含课程三源并集与库内对账、新增考试→出现→删除→零残留、权限 401/403、以及教师拉考试列表不再 500 的回归）；`build` 30/30；pm2 重启 api+web；新增文案全部落在新产物 chunk，顶栏徽章 `v2.4.120`。

## V2.4.119 (2026-09-29) — 组课「课程块卡片」开设年级徽章固定单行,不再折行挤压教师行
- 需求：组课模块的课程块卡片里，多个「开设年级」徽章被换行拆散（如 3 个年级时高一在第一行、高二/高三被挤到第二行），把任课教师顶到第三行，观感凌乱。要求开设年级全部排在同一行、保持排版美观。
- 前端 `apps/web/components/TeacherScheduling.tsx`（`GroupView` 课程块卡片）：内容区由「一行 flex-wrap 塞科目+周课时+年级徽章」重构为**三行固定结构**：
  1. 第 1 行：科目（`truncate`，过长省略）+ 周课时徽章（`shrink-0`）；
  2. 第 2 行：**开设年级徽章独立成行**，`flex flex-nowrap` 强制单行 + 各徽章 `shrink-0 whitespace-nowrap`；若年级极多则容器 `overflow-x-auto` 横向滚动（配 `[scrollbar-width:none]` 与 `[&::-webkit-scrollbar]:hidden` 隐藏滚动条），**既不折行也不裁切**；年级为空时显示「跨年级通用」；行上带 `title` 悬浮显示完整年级串；
  3. 第 3 行：任课教师 · 教室 · 使用次数（保持原有 flex-wrap）。
- 纯样式/结构改动，无接口、无 DB/schema、无数据迁移。
- 验证：`tsc --noEmit` 通过；**离线渲染自检**（Tailwind CLI 生成真实 CSS + Playwright 逐卡片量测徽章 `offsetTop`）——旧结构 3/4 年级时徽章跨 2 行（复现缺陷），新结构 3/4/6 个年级徽章 `top` 唯一即**全部同一行**、且无需横向滚动（6 个年级在 385px 卡宽内仍单行容纳）；线上产物与接口回归见工作日志。

## V2.4.118 (2026-09-29) — 删除班级「课程表」下的批量导入(Excel/CSV)功能
- 需求：班级管理 →「课程表」子页里的「批量导入课表(Excel/CSV)」整块功能下线。
- 前端 `apps/web/app/teacher/academics/page.tsx`：删除 `TimetableImport` 组件（含文件选择、导入方式(追加/替换)、确认导入、校验预览表与格式说明，共 201 行）及其渲染调用；移除 `import * as XLSX from "xlsx"`（该页已无 XLSX 用法）；顶部提示语「本页保留单条增删改与整表导入」改为「本页保留单条增删改」。**「新增课表条目」单条增删改、课表网格(含分层走班多课并列/连堂课跨行合并)渲染全部保留**。
- 后端 `apps/api/src/routes/academics.js`：删除 `POST /api/academics/classes/:id/timetable/import`（85 行，含 `mode:"replace"` 整表清空 + 应用层去重 + 逐条 create + errors 汇总）。避免留下「UI 已不可见但仍可被直接调用整表清空」的写接口。
- 保留不动：`TimetableEntry` 的 `periodLabel`/`periodTime` 字段与前端读取（历史导入数据仍能正确显示节次名/时间，缺失时回退「第 N 节」）；`apps/web` 的 `xlsx` 依赖声明保留（仅本页用过，删声明会与 lockfile 失配，无体积影响——Next 只打包实际 import）。**无 DB / schema 变更、无数据迁移。**
- 验证：`node --check academics.js` 通过；`tsc --noEmit` 通过；全仓 grep `timetable/import|批量导入课表|TimetableImport` 零命中；线上同参 E2E 见工作日志。

## V2.4.117 (2026-09-29) — 班级列表按年级从低到高自动排序
- 需求：教务管理「全部班级」左栏此前按班级名字符串排序,出现「高一2 → 高一3 → 高一4 → 高三1 → 高二2」这类反直觉顺序(字符串比较下「高三 < 高二」);要求自动按年级从低到高排序。
- 新增共享工具 `apps/api/src/lib/grade-order.js`：`cmpGrade` / `sortClassesByGrade` / `termSortKey`。规则:① 学段递增 小学 < 初中 < 高中;② 段内年级序号递增 高一 < 高二 < 高三;③ 衔接年级 `Pre高一`/`预高一` 排在对应年级**之前**(故 Pre高一 位于高一之前、全部年级最前);④ 纯数字年级按国内口径折算(1-6→小学段,7-9→初中段,10-12→高中段);⑤ 无法识别的年级一律置后;⑥ 班级名用 `numeric` 自然序,保证「高一2班」在「高一10班」之前;⑦ 空年级字段回退用班级名推断年级,避免脏数据打乱整表。
- 后端 `academics.js`：`GET /api/academics/classes`(全部班级/我的任教班级)与 `GET /api/academics/course-classes` 结果统一走 `sortClassesByGrade`(学年新→旧 → 年级低→高 → 班级名自然序 → 学期)。
- 后端 `scheduling.js`：`GET /api/scheduling/classes` 同步走 `sortClassesByGrade`;`sortGrades`(gradeOptions 展示顺序)改用 `cmpGrade` 兜底,初一/初二/初三 等非高中年级也能按学段语义排在 Pre高一 之前,未知年级不再乱序。
- 后端 `flexible.js`：`GET /api/flexible/my-classes`(我的教学班)同步按「年级低→高 → 科目 → 层级」排序。
- 无 DB / schema 变更;全部为只读接口的展示顺序调整。验证：`node --check` 四个文件通过;排序单测(16 组年级 + 11 个班级用例)与线上接口 E2E 见工作日志。

## V2.4.116 (2026-09-29) — 班级「任课教师」改为只读(来自排课课表) + 排课「一键冲突检查」
- 需求：① 班级管理下的「任课教师」不可编辑,完全按「排课管理 → 排课」课表里已确认的课程列出对应课程与对应老师；② 排课模块新增一键「冲突检查」,检出教师冲突(同一时间同一老师有 ≥2 门课)与教室冲突(同一时间同一教室被 ≥2 个课程块占用)并列出全部冲突。
- 后端 - 任课教师(`academics.js`)：新增 `GET /api/academics/classes/:id/subject-teachers`(**只读**)。以该班课表条目 `TimetableEntry`(科目/教师已快照)为唯一数据源,按科目聚合出「任课教师(含各自课时数)/课表课时/教室」,未指定教师单独归并。附 `summary{subjects,teachers,entries}`。权限同班级详情(requireAuth + 可见性校验)。
- 后端 - 冲突检查(`scheduling.js`)：新增 `GET /api/scheduling/conflicts?academicYear=&term=`(**只读**)。扫描课表条目,按 `学年+学期+星期+节次` 分组(跨学期不误判),教师维度按 `teacherId`、教室维度按 `room` 聚合,≥2 条即判为冲突;返回 `teacherConflicts[]`/`roomConflicts[]` 明细(含班级/科目/教师/教室)与 `summary`。同格「选课走班」不判冲突,仅同教师或同教室才算。
- 前端 - `academics/page.tsx`：`TeachersTab` 删除「添加任教/移除」表单,改为拉新接口的只读表格(课程/任课教师·各带课时/课表课时/教室)+「只读,来源排课管理」提示条 + 「前往排课管理 →」按钮;`ClassPanel` 改传 `onGoScheduling`。
- 前端 - `TeacherScheduling.tsx`(排课)：工具栏新增「⚠ 冲突检查」按钮,点击调用 `/scheduling/conflicts`(带当前班级学年/学期),弹出结果弹窗 —— 无冲突显示 ✅ 与扫描条目数,有冲突则分「① 教师冲突 / ② 教室冲突」两区逐条列出(星期/节次/教师或教室 + 涉及班级·科目·教室)。
- 无 DB / schema 变更;两接口均只读。验证：`tsc --noEmit` 通过;`node --check` 两端路由文件通过;接口级 E2E + 产物核对见工作日志。

## V2.4.115 (2026-09-29) — 年级新增「Pre高一」衔接年级
- 需求：在现有 高一/高二/高三 之外新增「Pre高一」,作为高一前的衔接年级,用于课程管理与组课的课程块年级选择。
- 课程管理（`TeacherSchoolCourses.tsx`）：`GRADE_OPTIONS` 增加 "Pre高一" 并置于最前（衔接年级排在 高一 之前）；适用年级复选框、年级筛选下拉、卡片年级徽章均同步覆盖。
- 组课（`scheduling.js`）：新增 `BASE_GRADE_OPTIONS = ["Pre高一", "高一", "高二", "高三"]`；GET `/scheduling/classes` 与 `/scheduling/blocks` 返回的 `gradeOptions` 改为「基础年级范围 + 实际班级年级」并集,确保 Pre高一 始终可选；原「无班级时兜底 初一/初二/初三/高一/高二/高三」已不再需要（基础范围已含 高一/高二/高三,实际班级年级会并入）。课程块保存的 `normalizeGrades` 不设年级白名单,Pre高一 可正常入库。
- 纯选项扩充,无 DB schema 变更、无破坏性操作。验证：`tsc` 通过；`next build` 成功；后端 API `gradeOptions` 回读含 Pre高一。

## V2.4.114 (2026-09-29) — 组课「开设年级」改多选,支持跨年级课程块
- 需求：组课的「开设年级」从单选下拉改为多选,同一课程块可跨年级开设。
- 数据模型：`CourseBlock.grade`(单值) → `grades`(逗号串多选),与课程管理 `SchoolCourse.grades` 同一约定;**全不勾 = 全年级通用**(所有年级的排课池都显示,卡片标「跨年级通用」)。历史数据的年级值已迁移。
- 后端（`scheduling.js`）：GET `/blocks?grade=` 与 GET `/board` 课程块池改「包含」语义的应用层过滤(未选年级=通用恒命中);建块/编辑接受 `grades`(数组或逗号串)并归一化(去重/截断/上限 6 个),兼容旧单值 `grade` 字段;查重收敛为「科目+教师+学年+学期」,不再受年级维度影响。
- 前端（`TeacherScheduling.tsx`）：开设年级下拉 → 整行复选胶囊(可多选);选中科目自动带入课程库勾选的开设年级(可增删);列表卡片显示年级徽章;按主年级(第一个勾选,未勾归「全年级」)分组;删除确认文案同步。
- 迁移前数据库三重备份;E2E 接口级验证;`tsc` 通过;`next build` 成功。

## V2.4.113 (2026-09-29) — 组课「科目」改为取自课程管理课程库 + 新建课程块表单排版重排
- 需求：① 「新建课程块」里的科目只能选择「课程管理」模块里存在的课程，且信息要同步；② 该表单排版美化。
- 科目数据源改造（`TeacherScheduling.tsx` 组课）：删掉硬编码学科清单 `SUBJECT_OPTIONS`，科目下拉改为拉取 `/api/academics/school-courses` **在开设**的课程名（按课程库排序）。同步机制：组件挂载拉取一次 + **每次打开新建/编辑表单都重新拉取**（课程管理里刚建的课立即可选，无需刷新页面）；编辑旧课程块时若其科目已从课程库停用/改名，自动补进选项避免显示丢失。
- 信息联动（仅新建态）：选中科目后自动带入该课程的**参考周课时数**；课程库适用年级只勾了一个时自动带入**开设年级**；科目下方展示「参考 X 课时/周 · 适用年级」提示；课程库为空时表单顶部出现琥珀色提示「请先到课程管理新建课程」。
- 排版重排：表单由 flex-wrap 挤在一行改为响应式网格（`grid-cols-2 / sm:grid-cols-3 / lg:grid-cols-6` 六字段等宽对齐、去固定宽度），底部独立操作栏（左提示、右 取消/保存），卡片白底 shadow 统一观感。
- 纯前端改动，无接口、无 DB 变更。验证：`tsc --noEmit` 通过；`next build` `Compiled successfully`；产物核对最新 chunk。

## V2.4.112 (2026-09-29) — 课程管理列表排版居中对齐
- 需求：课程管理列表「排版没有居中对齐」。像素级核查确认原排版为「表头与单元格同侧对齐」（类别/类型/适用年级左对齐、参考周课时数右对齐、状态居中），观感上短内容贴边、散落不齐。
- 调整 `TeacherSchoolCourses.tsx` 表格对齐：**类别 / 类型 / 适用年级 / 参考周课时数 / 状态** 五列的表头与单元格统一改为水平居中（徽章类单元格补 `inline-block` 保证居中生效）；课程名称保持左对齐（长文本 + 备注内联）、操作列保持右对齐（符合全站表格惯例）。
- 纯样式改动，无接口、无 DB 变更。验证：`tsc --noEmit` 通过；`next build` `Compiled successfully`；产物核对最新 chunk。
- 部署：scp 4 文件（组件 + CHANGELOG + VERSION + version.ts）双端 md5 对齐；`pm2 restart web`。

## V2.4.111 (2026-09-29) — 课程管理表单精简：删学科/任课教师，适用年级改多选，周课时改参考值
- 需求：① 课程管理的操作权限向教务老师开放；② 删去「学科」「任课教师」字段；③ 适用年级改为多选；④ 「周课时」改为「参考周课时数」。
- 权限核实：教务老师（teacherRole=ACADEMIC）的写权限在 V2.4.110 即已开放（后端 `isAcademicAdmin` 放行 POST/PUT/DELETE，前端 `canManage` 显示新建/编辑/停用/删除），本次以接口级 E2E 实证（教务老师建/改/删通过、普通教师 403）。若教务老师界面仍显示只读，重新登录即可刷新本地缓存的用户信息。
- 数据：`SchoolCourse` 迁移 —— **删除** `subject`、`teacherName` 列；`grade`(单值) 改为 `grades`(逗号分隔多选，空=全年级通用)；唯一键 `@@unique([name, grade])` 收敛为 `name` 单列唯一（一门课一条记录、可覆盖多个年级）。既有 1 条记录（A Level 进阶数学）的年级值已保留迁移到 `grades`。属**破坏性列变更**，已按规程三重备份后执行。
- 后端：`normalizeSchoolCourse` 删 subject/teacherName 白名单项（旧客户端多传字段自动丢弃）、`grade` 单值校验改为 `grades` 多值归一化（数组或逗号串 → 去重逗号串，≤6 个）；GET 过滤 `grade` 精确匹配改为 `grades contains` 子串匹配；查重从「name+grade」改为「name 单列」（POST/PUT 409 文案同步）。
- 前端 `TeacherSchoolCourses.tsx`：表格删「学科」「任课教师」两列，「周课时」表头改「参考周课时数」，适用年级渲染为多枚年级徽章（空=全年级）；弹窗删「学科」「任课教师」输入框，适用年级改为 高一/高二/高三 复选框多选（都不勾选=全年级通用），「周课时」标签改「参考周课时数」（占位提示"参考值,可留空"）；搜索框占位改为「课程名称 / 备注」；年级筛选对「全年级通用」课程恒命中。
- 验证：`tsc --noEmit` 通过；`prisma validate` 通过；接口级 E2E 全部通过且零残留；`next build` `Compiled successfully`；产物核对最新 chunk 含新表头、旧字段串计 0。
- 部署：DB 三重备份（md5 见工作日志）；`prisma db push --accept-data-loss` + `prisma generate`；`pm2 restart api+web`。

## V2.4.110 (2026-09-29) — 「课程管理」独立成模块；原「课程管理」更名为「班级管理」
- 需求：教务管理里的「课程管理」实际管的是**班级**，名不副实；需另建一个真正的课程管理模块，用于新建和维护学校开设的所有课程。
- 前端：`app/teacher/academics/page.tsx` 原 Tab 文案改为「班级管理」（key 仍为 `course`，列表/内容/权限完全不变），新增「课程管理」Tab（key=`catalog`，支持 `?tab=catalog` 直达）；新增组件 `components/TeacherSchoolCourses.tsx`（课程库表格 + 搜索/类别/年级/类型/状态筛选 + 新建·编辑弹窗 + 停用/启用 + 删除二次确认），样式统一接入 `globals.css` 的 `.ui-input` / `.ui-select`（不再手写局部 class 串）。
- 后端：`routes/academics.js` 新增课程库 CRUD —— `GET/POST/PUT/DELETE /api/academics/school-courses`。读：ADMIN/TEACHER，其余 403；写：仅 `isAcademicAdmin`（管理员或教务老师）。校验：name 必填(≤80)、type 仅 REQUIRED|ELECTIVE、category 白名单、weeklyHours 0~60 可空、同名+同年级 409、不存在 404。
- 数据：新增 `SchoolCourse` 模型（**附加式**迁移，不触碰既有 `Course`(班级课程目录) 与 `GpaCourse`(GPA 课程体系)）。字段 name/subject/category/type/grade/weeklyHours/teacherName/sortOrder/active/note + 时间戳；唯一键 `(name, grade)`；索引 `(active, sortOrder)`。任课教师存姓名字符串（可录外聘），不建 FK 以免人员变动耦合。
- **修复（E2E 首轮抓到）**：后端 `normalizeSchoolCourse` 把未传的 `weeklyHours` 交给 `Number()` 得 `NaN` 而误判 400 —— 即「新建课程时不填周课时会失败」。已改为 `undefined / null / ""` 一律视为不设周课时。
- **修复（实拍截图时发现）**：前端版本徽章漂移 —— `apps/web/lib/version.ts` 硬编码 `v2.4.105`，V2.4.106~109 连续四次发布均漏改，顶栏一直显示旧版本。已同步至 `v2.4.110`，并在文件内注明「三处同步」发布纪律。
- 验证：`tsc --noEmit` 通过；双端 md5 一致（schema `52e34e69…`、academics.js `45160ebd…`、page.tsx `88a75816…`、TeacherSchoolCourses.tsx `4f6b15af…`）；`prisma validate` + `db push`（新表 13 字段 + 2 索引；既有数据完好：6 班级 / 10 课程 / 40 用户）；`next build` 30/30 `Compiled successfully`；`pm2 restart api+web` 后新接口无 token 401、页面 200；**接口级 E2E 30/30 通过、零残留**（越权 401/403、重复 409、非法入参 400、部分更新不误伤其它字段、搜索+年级过滤）；线上真实页面实拍截图（浏览器内拦截接口喂演示数据，**未注入任何真实凭据**）。
- 部署：DB 三重备份（服务器备份目录 + 服务器 `.bak` + 本地下载，md5 均 `5a4ad2fa…`）。
- 未决（待拍板）：课程库当前是「全校主数据」，**不含学年维度**；若需按学年分别维护开设课程，可加 `openYear` 字段（属附加式改动）。

## V2.4.109 (2026-09-29) — 「新建教师」弹窗两个下拉框视觉美化（统一到全局 ui-input/ui-select 范式）
- 需求：新建/编辑教师弹窗中「角色」「状态」两个下拉露出系统原生灰底样式，与同一表单的输入框观感不一致。
- 根因：`TeacherTeachersManage.tsx` 用了组件内局部 `input` 字符串（未含 `bg-white`、未加 `appearance-none`），是全站少数未接入 `globals.css` 全局范式（`.ui-input` / `.ui-select`，已有 33+ 处使用）的遗漏点。
- 实现：输入框改用 `ui-input`；两个下拉改用 `ui-input ui-select`，并补 `pr-9`（自绘 chevron 留白）、`cursor-pointer`、`hover:border-slate-400`、focus ring、`disabled:`（浅灰底 + 灰字 + not-allowed）、`[&>option]:text-[13px]`（下拉列表字号收紧）。
- 验证：`tsc --noEmit` 通过；双端 md5 一致（`ff5e43d5…`）；`next build` 30/30 `Compiled successfully`；`pm2 restart web` 后 `/teacher/academics` → 200；最新 chunk 含新 class 串。
- 部署：仅前端组件改动，无 DB/schema 变更，无备份需求。
- 备注：附离线前后对照图 `preview_select_before_after.png`（link 真实编译 CSS 渲染，非手绘 mock）。

## V2.4.108 (2026-09-29) — 修复 TMUA Paper 1 模考16 的 5 道缺陷题（答案键错 + 废题）
- 二次校验:重新从线上库拉取原文逐题复算,确认 5 处缺陷;5 题历史作答记录(AnswerRecord)均为 0,改键/改选项对判分零副作用。Paper 2 模考16 全 20 题正确,不动。
- Q2 答案键错:`531441` → `729`(解析误写 N=531441d²/400;实际 N=729d/20,最小 d=20 ⇒ N=729);解析同步修正。
- Q4 答案键错:`(π−2)/(4−π)` → `(4−π)/(π−2)`(原存为正确答案的倒数);解析末行同步修正。
- Q12 答案键错:`8` → `3`(解析 2A−B=8 求和有误;正确 ∫₀^{7/2}f=∫₀^{3/2}f=A−B=5−2=3);解析同步修正。
- Q8 废题:真值 `8√2/3` 不在原选项 → 重设选项为 4√2/3, 8/3, **8√2/3**, 4√2, 16√2/3;答案键更新为 `8√2/3`(保留 5 项,不机械截尾)。
- Q14 废题:真值 `20/3` 不在原选项 → 重设选项为 10/3, **20/3**, 10, 40/3, 20;答案键更新为 `20/3`;删去解析中「保留原始答案 3√20」的误导性注释。
- 写库:纵深防御(服务器双备份 + 本地下载 → 前置断言 → 幂等更新 → 回读校验 answer∈options),5/5 PASS,FAIL_COUNT=0;复跑全部幂等跳过。
- 同步派生资产 `scripts/bank_tmua_p1_mock16_v2.json` 同 5 处(防重新导入回退);该文件首次纳入版本管理。
- 卷状态保持 READY(修复后缺陷率归零,无需下架)。

## V2.4.107 (2026-09-29) — 教务老师获得「教师管理」权限（不能设置/管理管理员）
- 需求:截图所示「教务管理」下的「教师管理」子模块,对教务老师(teacherRole=ACADEMIC)开放,但不得设置或管理管理员账号。
- 后端:teacher-admin.js 路由由 `requireRole("ADMIN")` 改为 `isTeacherAdmin`(ADMIN 或 ACADEMIC 可访问);PUT 编辑接口禁止教务老师操作 ADMIN 账号、禁止修改任何账号角色(含设为管理员);DELETE 删除接口禁止教务老师删除管理员账号。
- 前端:academics/page.tsx 的「教师管理」Tab 对 ACADEMIC 开放(含 ?tab=teachers 直达);TeacherTeachersManage.tsx 编辑弹窗隐藏「管理员」角色选项、ADMIN 账号行的编辑/删除按钮对教务老师禁用。
- 验证:tsc 闸门通过;双端 md5 一致;next build 30/30 Compiled successfully;pm2 重启 web+api 后 /teacher/academics→200、无 token 访问教师管理→401;接口级 E2E 8/8 通过(教务老师可列/建/改普通教师、禁止改/删管理员与设管理员;普通教师 403;零残留)。

## V2.4.106 (2026-09-28) — 教务老师获得建立班级/新建课程/管理任课教师权限

- 需求：教务老师(teacherRole=ACADEMIC)需具备建立班级、新建课程、指派/移除任课教师的教务管理权限；同时保持破坏性操作(删除班级、班级成员管理、分班/录取、GPA、我的班级等)仍仅管理员可执行。
- 后端改动(apps/api/src/routes/academics.js)：
  - 新增 `isAcademicAdmin(user)` 判定(`role===ADMIN || teacherRole===ACADEMIC`)，作为跨班教务管理的总开关。
  - `POST /api/academics/classes`：由 `requireRole("ADMIN")` 改为 `requireAuth` + 行内 `isAcademicAdmin` 校验，管理员或教务老师均可建班。
  - `PUT /api/academics/classes/:id`：放行 `isAcademicAdmin || canManageClass`。
  - `POST/DELETE /api/academics/classes/:id/teachers`：放行 `isAcademicAdmin || canManageClass`，教务老师可跨班指派/移除任课教师。
  - `canManageCourses`：新增 `teacherRole===ACADEMIC` 分支，教务老师可跨班维护课程目录/选课。
  - 保持 `DELETE /classes/:id`、`/students` 成员管理、分班/录取、GPA 等仍为 `requireRole("ADMIN")` 或班主任作用域，未下放给教务老师(纵深防御)。
- 前端改动(apps/web/app/teacher/academics/page.tsx)：`canManage = role===ADMIN || teacherRole===ACADEMIC`；新建班级按钮、全部班级视图、任课教师 Tab、新建课程入口均对教务老师开放；普通教师不显示教务提示、仅见任教班级。
- 验证：服务端 E2E 脚本 8/8 PASS —— 教务老师建班/加任课教师/建课均 200；普通教师建班 403；无 token 401；教务老师删班 403(仍仅管理员)；脚本自清理零残留。

## V2.4.105 (2026-09-28) — 修复「教务老师」角色徽章无颜色（Tailwind content 漏扫 components/）

- 现象：教师管理列表中「任课教师」(靛蓝)、「管理员」(琥珀)、「助教老师」(紫) 徽章均有色，唯「教务老师」显示为裸文本。
- 根因：`apps/web/tailwind.config.ts` 的 `content` 只配了 `./app/**`，未含 `./components/**`。`bg-sky-100 text-sky-700` 仅出现在 `components/TeacherTeachersManage.tsx` 的 `TEACHER_ROLE_BADGE` 映射里 → Tailwind 从未扫描到 → 生产 CSS 无 `.bg-sky-100/.text-sky-700` 规则 → JS 输出类名但无样式。
- 为何其它角色正常：`bg-violet-100`(助教)、amber/indigo 等恰好也在 `app/**` 下出现过，被顺带扫入；`bg-sky-100` 全项目仅存在于 components/，故唯一中招。
- 系统性影响（同为隐患）：所有「仅被 components/ 使用」的 Tailwind 类此前都不会生成 CSS（如 GPA 等级徽章色、选课类型「选修」sky 色）。本次修复后这些样式将开始生效。
- 修复：content 增加 `./components/**/*.{ts,tsx}`，全量重建 CSS。

## V2.4.104 (2026-09-28) — 管理员/教务老师可设置班级班主任

- 需求：管理员（ADMIN）和教务老师（TEACHER + teacherRole=ACADEMIC）可以给班级设置班主任。
- 后端（`apps/api/src/routes/academics.js`）：
  - 新增判定 `canSetHomeroom(user)` = `role===ADMIN || teacherRole===ACADEMIC`。
  - 新增专用接口 `PUT /api/academics/classes/:id/head-teacher`：仅上述两角色可调；`headTeacherId` 校验必须是 TEACHER/ADMIN；传空即移除班主任。
  - 采用「专用接口 + 最小权限」而非放开既有 `POST/PUT /classes`（仍限 ADMIN），避免把班级 CRUD/删除连带开放给教务老师。
- 前端（`apps/web/app/teacher/academics/page.tsx`）：
  - 新增组件 `HeadTeacherSetter`：班级面板标题行「班主任」处展示姓名；对可设置角色显示「设置/更换」按钮，点击展开教师下拉（含「不设置」选项）+ 保存/取消；无权限者（学科教师）仅看名字。
  - 复用既有 `GET /api/academics/teachers`（返回全部 TEACHER+ADMIN）。
- 验证：待部署后冒烟。

## V2.4.103 (2026-09-27) — 右上角「修改信息」与用户名左边缘严格对齐

- 需求：V2.4.102 排版仍不齐——按钮自带 `px-1` 内边距，使「修改信息」文字比上方用户名右缩 4px。
- 修复（3 个 layout 各一行）：按钮改 `-ml-1 px-1`，负左边距抵消内边距，文字左边缘与用户名严格对齐（hover 背景仍完整覆盖文字）。

## V2.4.102 (2026-09-27) — 右上角排版对齐 + 学生/家长端接入「修改信息」

- 需求：① V2.4.101 的两行排版不整齐（「退出」垂直居中悬在两行中间）；② 学生/家长端右上角也加入「修改信息」入口。
- 前端（3 个 layout，`ProfileDialog` 角色无关直接复用）：
  - 教师端/学生端/家长端统一为两行对齐结构：第一行 `用户名(角色) | 退出`，第二行「修改信息」小字靛蓝按钮与用户名左对齐。
  - `app/app/layout.tsx`（学生端）、`app/parent/layout.tsx`（家长端）：接入 `ProfileDialog`（`profileOpen` 状态 + 弹窗渲染 + 保存后同步本地缓存显示名），走既有 `PUT /api/auth/profile`（改密需验旧密码，所有角色可用）。

## V2.4.101 (2026-09-27) — 移除背景音乐功能 + 「修改信息」移至用户名下方

- 需求：① 删去背景音乐功能（含教师端/学生端 header 播放控件与全部音频资源）；② 右上角「修改信息」按钮改放到用户名下方。
- 前端：
  - 删除 `components/BgmPlayer.tsx`、`components/BgmProvider.tsx`，`app/layout.tsx` 去掉 `BgmProvider` 包裹，`app/teacher/layout.tsx` 与 `app/app/layout.tsx` 移除 `<BgmPlayer />` 及其 import。
  - 删除 `public/audio/`（ambient1-3.wav + bgm.wav，约 14.5MB）。
  - 教师端右上角改为两行结构：第一行用户名（含角色），第二行「修改信息」小字按钮；「退出」与分隔线保持右侧不变。
  - 学生端 header 同步简化为 版本号 + 用户名 + 退出 一行。

## V2.4.100 (2026-09-27) — 教师默认密码 Jinrui@2026 + 右上角「修改信息」（可改密码）

- 需求：① 新建教师账号默认密码 `Jinrui@2026`；② 教师端右上角新增「修改信息」入口，里面可以修改密码。
- 后端：
  - `teacher-admin.js` 新建教师密码改为**可省略**，留空即用默认密码 `Jinrui@2026`（自定义密码仍须 ≥6 位）；创建成功消息明确告知初始密码，响应带 `defaultPassword` 标记。
  - `auth.js` 新增 **`PUT /api/auth/profile`**（所有已登录角色可用）：修改姓名直接生效；修改密码必须携带旧密码且 bcrypt 比对通过，新密码 ≥6 位。
- 前端：
  - 新增组件 `components/ProfileDialog.tsx`：修改姓名 + 旧密码/新密码/确认新密码三栏，改完同步本地缓存用户信息（右上角显示名即时更新）。
  - `app/teacher/layout.tsx` 右上角用户名旁新增「修改信息」按钮（靛蓝色，与「退出」以分隔线区隔）。
  - `TeacherTeachersManage.tsx` 新建教师密码框改为可留空，placeholder 与下方提示说明默认密码；教师首次登录后可在右上角自行改密。

## V2.4.99 (2026-09-27) — 排课交互：已排课程「拖出课表即删除」（无二次确认）

- 需求：已经排进课表的课程条目，拖拽到课表网格外松手即视为删除，不需要二次询问确认。
- 前端（`apps/web/components/TeacherScheduling.tsx`）：
  - 已排条目卡片新增 `onDragEnd`：拖拽结束时若未落到任何课表格子（`dragRef` 仍持有该条目 = 拖到了网格外），直接调用删除接口并刷新，不弹确认。
  - 拖拽期间底部出现全局提示条：「拖到课表外松手 = 删除「科目」（移回原格或格子内松手则取消）」，让该手势可被感知。
  - 拖回自己原来所在的格子视为取消，不触发走班/替换选择卡、不落库。
  - 课程块池卡片补 `onDragEnd` 清理拖拽状态，避免陈旧 `dragRef` 污染条目删除判定。
  - 操作提示文案补充「已排课程拖出课表松手即删除」（红色强调）。
- 保留原 hover ✕ 移除按钮作为备选路径；本次纯前端改动，无 DB / 后端变更。

## V2.4.98 (2026-09-27) — 排课页布局调整：课程块池改为「一行四个小格子」

- 需求：课程块池原是左侧 300px 窄栏里的一列长卡，在小屏下会整行铺开显得空旷；用户要求改成一行放四个的小格子。
- 前端（`apps/web/components/TeacherScheduling.tsx`，纯 UI）：排课页由「左池 + 右课表」双栏改为**上下结构** —— 上方课程块池以网格铺开（`grid-cols-2 / md:3 / lg:4`，宽屏一行四个），卡片改为紧凑小格（科目色条 + 科目 + 已排/需 + 教师·教室 + 细进度条，「已排满」徽章缩为「满」）；下方课表网格占满整行，可视列宽更大。操作提示同步由「拖拽左侧」改为「拖拽上方」。

## V2.4.97 (2026-09-27) — 排课管理 UX 打磨：组课卡片操作常显 + 课程块池版式重排

- 需求：①「组课」里已建好的课程块要能直接编辑/删除（原按钮 hover 才浮现，等于看不见）；②「排课」左侧课程块池卡片排版太松散，重排。
- 前端（`apps/web/components/TeacherScheduling.tsx`，纯 UI，无接口/结构变更）：
  - **组课卡片**：「编辑 / 删除」由 hover 浮现（`opacity-0 group-hover:opacity-100`）改为**常显**，加边框描边样式（编辑 hover 变靛蓝、删除 hover 变红），可发现性不再依赖鼠标悬停。
  - **课程块池卡片重排**：小色块方块 → **左侧科目色条**（与组课卡片同一视觉语言）；「已排满 / 超 N」徽章从第二行上移到**标题行**（科目名旁）；教师·教室合并为一行；进度条保留在底部。信息层级：科目 → 教师 → 进度，扫读路径更短。
  - 课程块池标题补课程块数量（「课程块池 · N 个」）。

## V2.4.96 (2026-09-27) — 排课管理支持「同一格多课程」= 选课走班（并修复组课指定教师误报）

- 需求：排课网格里**同一个格子允许放多门课程** —— 这是「选课走班 / 分层走班」的正常形态（同一时段全班学生分流到不同课堂），此前被当作"同格冲突"标红提示，语义不对。
- 后端（`apps/api`）：
  - **`TimetableEntry` 唯一键放宽**：`[classId, dayOfWeek, period, subject, academicYear, term]` → **`[classId, dayOfWeek, period, subject, teacherId, academicYear, term]`**，从而放开「同科目 + 不同教师」的分层走班（英语 A 层王老师 / B 层李老师同一时段并存）；同时补 `@@index([classId, academicYear, term])`。**纯结构变更，不改任何数据行**。
  - `scheduling.js`：`POST /place`、`POST /move` 引入 **`mode: "append" | "replace"`**（旧 `replace: true` 兼容等价于 `replace`）：
    - `append` = **加入选课走班**：保留该格已有课程，追加一门，返回 `cellSize`（该格现有课程数）；
    - `replace` = 覆盖该格；
    - **未声明 `mode` 且目标格已有课程 → 409**，`data` 带 `conflict`（占用课程）+ `incoming`（待放入课程）+ `options`（append/replace 两个选项及后果说明），不允许静默覆盖。
  - **走班组两条硬约束**（`appendGuard`，命中返回 409 + 具体原因）：① 同一课程块不得在同格重复；② 同一位教师不得在同格并行两门课。
  - `GET /board` 统计口径修正：`stats.conflicts`（同格冲突，告警语义）→ **`stats.electiveCells`（走班时段数）+ `stats.electiveCourses`（走班课程数）**（信息语义）。
  - **缺陷修复**：`TEACHER_SELECT` 漏选 `role` 字段，导致 `findTeacher` 里 `t.role !== "TEACHER"` 恒真 —— **在「组课」里指定任课教师会误报「教师不存在或角色不符」**（V2.4.95 的 E2E 因未传教师而漏过）。现已一并修好。
  - `academics.js`：唯一键含 `teacherId` 后，SQLite 下 `teacherId` 为 NULL 不参与唯一性判断，故在**手动新增课表条目**与**课表批量导入**两条路径补应用层去重（只挡「同科目 + 同教师(含均未指定)」的完全重复；不同课程 / 不同教师允许并存），保持原有幂等语义不回退。
- 前端（`apps/web`）：
  - 落点冲突弹窗由「确认替换吗」升级为**三选一选择卡**：列出该时段现有课程（科目色标签），并用文字写明两种后果 —— **「加入选课走班」**（保留原课程，作为同时段并行第 N 门）/ **「替换该时段」**（清空该格只留新的）/ 取消（Esc）。
  - 走班格视觉**去告警化**：红色角标 → **紫色胶囊 `走班 N`**；格子底色 `border-violet-200 bg-violet-50/40`；`title` 提示「同一时段并行开设 N 门课程，学生按选课/分层分流到不同课堂」；格内多张卡片纵向堆叠、行高自适应。
  - 统计条「同格冲突」→ **「走班时段」**（紫色，信息性），右侧补「走班课程 N 门」；顶部与提示条补「同一格放多门课程即为「选课走班」」的说明。
  - 若放入的课程块已在该格，前端直接拦下提示「已在此格，无需重复添加」，不弹选择卡。
- 验证（本地隔离空库端到端，**33/33 通过**，跑完零残留）：
  - 权限：无 token 401 / 学生 403 / 教务 200（组课建块 ×6 全部成功，含同科目两位教师）。
  - 空格排入 `cellSize=1`；同格再排（无 mode）**409 且携 conflict + options[append,replace]**；`append` 后 `cellSize=2`、`board` 该格 2 条、`electiveCells=1`、`electiveCourses=2`。
  - 走班约束：同格重复同一课程块 409；同格同教师并行 409（原因文案正确）。
  - 分层走班：同科目 + 不同教师（英语 A/B 层）同格并存 **200**。
  - `replace` 覆盖 `replaced=2` 且格子归 1；`move` 到已占用格（无 mode）409 → `append` 并入后 `cellSize=2`、`electiveCells` 仍为 1。
  - 导入路径：同格不同课程并入 + 完全重复跳过（`created=2 / skipped=1`）；手动新增同科目同教师重复 409、同格不同课程 200。
  - 逐条移除后课表归零。
  - 本地 `tsc --noEmit` 通过；`scheduling.js` / `academics.js` 模块导入检查通过；`prisma validate` 通过。
- 设计文档：`docs/SCHEDULING_DESIGN.md` 同步升级为 V2.4.96（新增「一格 ≠ 一门课」概念说明、落点协议 JSON 示例、走班格排版规范、6.3 落点抉择章节改写、边界表与后续可选项更新）。
- 部署：`prisma db push`（唯一键放宽，不动数据行）+ `pm2 restart api web`；DB 部署前备份。

## V2.4.95 (2026-09-27) — 新增「排课管理」：组课（课程块）+ 拖拽排课

- 需求：管理员 / 教务老师在「教务管理」下新增「排课管理」，分两个子模块 ——
  **① 组课**：把「所开设课程 + 教师」绑定成一个课程块，可设预计每周课时数与开设年级；
  **② 排课**：选定班级后，把课程块拖进课表 slot，可删除已排课程块，也可替换成其他课程块。
- 后端（`apps/api`）：
  - 模型：新增 `CourseBlock`（科目 + 任课教师 + 预计每周课时数 + 开设年级 + 建议教室 + 备注 + 排序）；`TimetableEntry` 增加可空 `courseBlockId`（`onDelete: SetNull` ⇒ 删除课程块不会连带删掉已排课表，因为 subject/teacherId/room 已快照在条目上）；`User` 增加 `courseBlocksTaught` 反向关系。**纯增量迁移**，既有数据零改动。
  - 新增 `src/routes/scheduling.js`，挂载 `/api/scheduling`，**整体前置「仅 ADMIN 或 teacherRole=ACADEMIC」**：
    - 元数据：`GET /classes`（全部班级 + 年级/学年/学期选项，教务可遍历全校班级，不受"任教班级"限制）
    - 组课：`GET /blocks`、`POST /blocks`、`PUT /blocks/:id`、`DELETE /blocks/:id`
    - 排课：`GET /board`（一次返回课程块池含 `placed`/`cells`、课表条目、节次行头元数据、统计）、`POST /place`（支持 `replace` 覆盖）、`POST /move`、`DELETE /entries/:id`
  - 关键不变量：① 一个 slot（班级 × 星期 × 节次 × 学年 × 学期）**最多放一个课程块**（DB 唯一键含 subject 挡不住"同格不同科目"，故在接口层保证）；拖到已占用格且不带 `replace` → **409 + 冲突详情**；② 同「科目 + 教师 + 年级 + 学年学期」的课程块唯一；③ 节次行头（`periodLabel`/`periodTime`）从同节次既有条目继承，与网格导入的课表行头保持一致。
- 前端（`apps/web`）：新增 `components/TeacherScheduling.tsx`，顶部 pill 切换两个子模块：
  - **组课**：学年/学期/年级筛选 + 「共 N 个课程块 · 合计 M 课时/周」统计；课程块卡片（科目色条、`N 课时/周` 徽章、教师/教室/备注、hover 编辑/删除）；新建/编辑内联表单（科目/教师/每周课时/开设年级/教室/备注）；按年级分组并显示每组小计。
  - **排课**：班级选择 + 显示节次（自动/6/8/10/12）+ 工作日/含周末开关 + 刷新；统计条（需排课时/已排课时/待排/超出计划/同格冲突）；左侧**课程块池**（`已排 n / 需 w` + 进度条 + 排满置灰沉底 + 超出标红）；右侧**课表网格**（行 = 节次含时间段，列 = 星期）。
  - 三种操作方式：**拖拽**（池 → 格；已排格也可拖到其他格 = 移动）、**点击两步**（先点课程块再点格子）、**hover 操作**（✕ 移除 / ⇄ 替换，替换态下点池中任意块即完成替换）；占用冲突弹**自绘确认卡**（列出占用课程，非原生 confirm）；`Esc` 取消当前选择；同格多条时显示红色角标计数。
  - 接入 `app/teacher/academics` 子模块 Tab「排课管理」（仅教务/管理员可见），支持 `?tab=scheduling` 直达；班级面板「课程表」Tab 顶部加引导条，一键跳转排课管理。
- 验证：
  - 本地 `tsc` 通过；`scheduling.js` 模块导入检查通过。
  - `prisma db push` 成功：`CourseBlock` 表已建、`TimetableEntry.courseBlockId` 已加、`courseBlock` 0 行（纯增量）。
  - **服务器端到端 17/17 通过**（自清理脚本，跑完零残留）：无 token 401 / 普通教师 403 / 学生 403；班级元数据 200；建块 200；重复块 409；`board` 200 且统计字段齐备；空格排入 200；同格重复排课 409 且带 `conflict` 详情；`replace` 覆盖成功；`move` 移动成功；移除后 `placed` 归零；删除课程块成功；终态无残留课程块/课表条目。
  - `next build` 编译成功（30/30 静态页）；`pm2 restart api/web`。
- 部署：`prisma db push` + `pm2 restart api web`。DB 部署前已备份至 `backups/db_before_scheduling_20260927-113431`。
- 观察项（待拍板）：生产某班级课表存在 **23 处「同格多条」**（历史网格导入 / 分层遗留），排课网格已用红色角标标出、可逐格删除；如需**批量清理工具**（保留一条 / 按规则合并）需另做。

## V2.4.94 (2026-09-27) — 班级面板下线「教师反馈」「家长审批」两个子模块入口

- 需求：教师端「教务管理 → 班级管理」班级面板 Tab 栏删除「教师反馈」与「家长审批」两项。
- 实现：
  - `apps/web/app/teacher/academics/page.tsx`：`ADMIN_TABS` 移除 `feedback`/`parents`，`TEACHER_TABS` 移除 `feedback`；`ClassPanel` 中对应渲染分支同步移除。
  - `FeedbackTab` / `ParentsTab` 组件代码保留在文件内（未删除，便于按需恢复）；因不再被引用，已被打包器 tree-shake，不进入产物。
  - `apps/web/app/parent/page.tsx`：删除指向已下线入口的提示文案（原「请联系班主任在『教务管理 → 家长审批』中通过您的申请」），改为提示核对注册时的「学号 + 姓名」。
- 影响面（已知并接受）：
  - 教师端不再有新建「教师反馈」的入口；学生端 / 家长端的「教师反馈」展示 Tab 保留，仅展示历史数据。
  - 家长关联的 PENDING 审批暂无前台入口；「学号 + 姓名」精确匹配的家长注册仍自动 `VERIFIED`。
- 验证：`tsc` 通过；`next build` 编译成功（30/30 静态页）；`/teacher/academics`、`/parent` 均返回 200；新产物 chunk 中「家长审批」0 命中、「教师反馈」0 命中（仅学生端/家长端展示 Tab 保留该词）。
- 部署：`npm run build` + `pm2 restart web`。
- 附带修复：服务器 `CHANGELOG.md` 曾被前一步的 `awk` 去重命令误清空（仅剩 3 条），已用本地全量历史恢复，并将本次会话的教务系列条目重排版本号以避免与考试系列（V2.4.86–89 甘特图/考情）编号冲突。

## V2.4.93 (2026-09-27) — 走班(分层/选课)教务：模型 + 分班工作台 + 我的教学班

- 需求：支持分层走班与选课走班。行政班（归属）与教学班（上课/录分）解耦；「同科目分层班强制同一时段」做成结构不变量。
- 后端新增（`apps/api/prisma` + `src/routes/flexible.js`，挂载 `/api/flexible`）：
  - 模型：`TimeBlock`（走班时段块）、`TeachingClass`（教学班，多教师 `TeachingClassTeacher`）、`Enrollment`（走班分配，每科每生至多一条）、`EnrollmentLog`（调剂审计）、`PlacementRun`（分班方案 DRAFT/PUBLISHED/REVOKED）、`ElectiveWish`（选课志愿）。
  - `Exam` 增加可空 `teachingClassId`（与旧 `classId` 共存，不破坏既有成绩）；迁移为纯增量 `db push`，已有数据零改动。
  - 接口：时段块 CRUD、教师列表、依据考试列表、分班方案 草稿/自动预分（按成绩排名，可解释）/人工调剂（草稿态直接改、已发布态写日志）/发布（跑检查清单后生成教学班 + 名单）/撤回、我的教学班（按任教关系过滤）、教学班名册、建考核、按名册录分（校验 + 自动重算班内排名）。
  - 权限：分班/时段块仅教务（`ACADEMIC`）或管理员；录分仅任教该教学班的科任（职责分离）。
- 前端（`apps/web`）：新增 `components/TeacherPlacementWorkbench.tsx`（分班工作台 + 时段块管理）、`components/TeacherMyClasses.tsx`（我的教学班 + 成绩登记）；接入 `app/teacher/academics` 两个新 Tab「分层/选课分班」（教务/管理员）、「我的教学班」（全员）。
- 验证：`prisma db push` 成功（7 张新表已建，Prisma Client 重生成）；`tsc` 通过；`next build` 编译成功（30/30 静态页）；`/api/flexible/blocks` 返回 401（路由挂载 + 鉴权正常）；`/teacher/academics` 返回 200。部署前 DB 已备份至 `backups/db_before_flexible_20260927-091405`。
- 部署：`db push` + `pm2 restart api/web`。
- 设计文档：`docs/FLEXIBLE_SCHEDULING_DESIGN.md`。

## V2.4.92 (2026-09-26) — 知识点管理/原创题审核整合为「教学管理」子模块

- 需求：顶部导航「知识点管理」「原创题审核」收编为「教学管理」(`/teacher/students`) 下的子模块 Tab，与其余六个子模块（学情统计/作业分发/考试管理/学生讲评请求/分组管理/注册审核）并列。
- 实现：
  - 新增 `components/TeacherKnowledgeManage.tsx`（`KnowledgeManageView`，自原 `app/teacher/knowledge/page.tsx` 抽出：学科切换、知识点增删改、逐题打标签）。
  - 新增 `components/TeacherStudentQuestionsManage.tsx`（`StudentQuestionsManageView`，自原 `app/teacher/student-questions/page.tsx` 抽出：待审核/已入库/已驳回、单题与批量通过/驳回）。
  - 两个原页面改为纯转发（`export { default } from` 组件），保留路由兼容。
  - `app/teacher/students/page.tsx`：tab 联合类型扩展 `knowledge | origq`，新增两个 Tab 按钮与内容分支。
  - `app/teacher/layout.tsx`：移除顶部导航中的「知识点管理」「原创题审核」两项。
- 验证：`tsc` 通过；`next build` 编译成功（30/30 静态页）；`/teacher/students`、`/teacher/knowledge`、`/teacher/student-questions` 均返回 200；bundle 含两个子模块内容，导航项已移除。
- 部署：`npm run build` + `pm2 restart web`。

## V2.4.91 (2026-09-26) — GPA 管理下拉菜单样式美化

- 问题：GPA 管理页（成绩登记/课程与权重/成绩单）中的原生下拉框未套用统一组件样式，macOS 下显示系统默认微调箭头、视觉突兀。
- 修复：
  - `components/TeacherGpaManage.tsx`：本地 `input` 类升级为 `ui-input` 同款圆角/聚焦环样式；8 处 `select` 统一追加 `ui-select`（appearance-none + 自定义下拉箭头 + indigo focus ring + bg-white + px-3 py-2）。
  - `components/GpaReportView.tsx`：成绩单学年切换下拉同步升级为同款样式（学生/家长端也受益）。
- 验证：`tsc` 通过；`next build` 编译成功（30/30 静态页）；`ui-select` 已确认存在于服务端产物；`/teacher/academics`、`/app/gpa` 均返回 200。
- 部署：`npm run build` + `pm2 restart web`。

## V2.4.90 (2026-09-26) — 教师管理整合为「教务管理」子模块（管理员端）

- 需求：管理员端「教师管理」从独立导航项收编为「教务管理」下的第三个子模块（与「课程管理」「GPA管理」并列）。
- 实现：
  - 新增 `components/TeacherTeachersManage.tsx`（`TeacherManageView`，从 `app/teacher/teachers/page.tsx` 抽出：新建/编辑/删除教师、可见学科与题源权限设置、角色与状态管理）。
  - `app/teacher/teachers/page.tsx` 改为纯转发（`export { default } from "@/components/TeacherTeachersManage"`），保留路由兼容。
  - `app/teacher/academics/page.tsx` 子模块 Tab 增加「教师管理」（仅 `isAdmin` 可见），支持 `?tab=teachers` 直达；`sub` 状态类型扩展为 `course|gpa|teachers`。
  - `app/teacher/layout.tsx` 移除仅管理员可见的独立「教师管理」导航项。
- 验证：`tsc` 通过；`next build` 编译成功（30/30 静态页）；`/teacher/academics`、`/teacher/teachers` 均返回 200；bundle 含教师管理组件、独立导航注释已移除。
- 部署：`npm run build` + `pm2 restart web`。

## 教师端「教务管理」整合 GPA 子模块 (2026-09-26)

- 「教务管理」(` /teacher/academics`) 改为容器页,顶部子模块 Tab:**课程管理**(原教务管理全部内容)+ **GPA管理**(原 GPA 管理页)。
- 顶部导航删除独立「GPA管理」入口;GPA 组件抽离为 `components/TeacherGpaManage.tsx`(命名导出 `GpaManageView`),`/teacher/gpa` 路由保留并转发默认导出,支持 `/teacher/academics?tab=gpa` 直达。
- 踩坑:Next.js `page.tsx` 不允许命名导出组件(`"GpaManageView" is not a valid Page export field`),组件必须放 components 下、页面文件只留 default 导出。

## 学生端移除打印成绩单按钮 (2026-09-26)

- `GpaReportView` 新增 `showPrint` prop(默认 true):打印按钮 + 提示文案包在 `{showPrint && ...}`。
- 学生端两处(课程中心 gpa tab / `/app/gpa`)传 `showPrint={false}`;家长端与教师端保留打印。

## 成绩单打印修复 + 官方 logo/水印 (2026-09-26)

- **打印修复(根因:时序竞态 → 改为 Portal 常驻副本)**:旧逻辑在按钮 onClick 里 `setShowTranscript` 后 `setTimeout(window.print,350)`,因 A4 预览依赖 `data` 渲染、DOM 更新与 `window.print()` 之间存在竞态,常「点了没反应/打印空白」。现改为:成绩单副本经 React Portal 常驻挂在 `document.body` 直下的 `#print-portal`(屏幕上 `display:none`,打印时显示并隐藏 body 其余子节点,见 `GpaPrintStyle`),按钮直接同步 `window.print()`,无任何竞态;内容走正常文档流,多页分页正确,且不受任何祖先 `overflow/position/transform` 影响。
- **官方 logo/水印**:用 `金瑞logo.ai`(PDF 型 Illustrator 文件)经 PyMuPDF 提取为纯矢量 SVG(无字体依赖、透明底、`viewBox` 完整)+ 高清 PNG,置于 `public/transcript/jinrui-logo.svg|png`。`TranscriptReport` 页眉与居中水印均改用该官方 logo(替换原手绘盾形占位),水印 `opacity=0.07` 仅显 logo 形状不显底框。
- 部署:4 文件 scp+md5 对齐(`TranscriptReport.tsx`/`GpaReportView.tsx`/logo svg/png)→ `npm run build` OK → `pm2 restart web`。冒烟 `/app` `/app/academics` `/teacher/gpa` 全 200;logo 资产 `200 image/svg+xml|image/png`;`print-portal`/`jinrui-logo` 字符串进 chunks。

## 学生端 GPA 观看入口调整 + 打印修复 (2026-09-26)

- **入口调整**：学生端顶部导航删除独立的「成绩单」；「查看各学期成绩(GPA 过程性考核 + 综合评定 + 可打印成绩单)」改为放在**课程中心**内的一个 Tab（与成绩与排名/教师反馈/课程表/选课/学情统计并列），由 `/app/academics?tab=各学期成绩` 承载，复用 `GpaReportView`。`/app/gpa` 页面保留但不再从导航进入。
- **打印修复（学生端不能打印成绩单）**：原逻辑在 `onClick` 内 `setShowTranscript(true)` 后直接 `setTimeout(()=>window.print(), 350)`，但 `TranscriptReport` 依赖 `data` 渲染、`showTranscript` 的 DOM 更新与 `window.print()` 存在时序竞态，常导致「点了没反应 / 打印空白」。改为：点击时置 `pendingPrint`，由 `useEffect([pendingPrint, showTranscript])` 在成绩单 A4 预览真正渲染完成（150ms）后再调用 `window.print()`，确保 `#transcript-print` 已在 DOM。打印 CSS（`GpaPrintStyle`：`body * { visibility:hidden }` + `#transcript-print` 可见）维持不变。
- **部署**：3 文件 scp+md5 对齐（`GpaReportView.tsx`/`app/app/academics/page.tsx`/`app/app/layout.tsx`）→ `npm run build` OK → `pm2 restart web`。冒烟 `/app /app/academics /app/gpa` 全 200；产物校验：课程中心 chunk 含「各学期成绩」、学生导航 layout chunk 已无「成绩单」。
- ⚠️ 提醒：浏览器硬刷新后查看。

## GPA 管理功能上线 + 笔试练习页修复 (2026-09-26)
- **新功能 GPA 管理**：过程性考核成绩登记（期末/期中/平时，按 学生×课程×学季×考核组件 存储）、课程与权重配置 CRUD、综合评定算法（按权重加权，缺项按剩余权重归一化，等级映射 A≥90/B≥80/C≥70/D≥60/E）、学年综合评定（各学季综合得分算术平均）、按样张复刻的正式成绩单（`TranscriptReport.tsx`：模块分组 × 四学季明细三行表头）。
  - 后端：`apps/api/prisma/schema.prisma` 新增 `GpaCourse`/`GpaScore`/（学生档案复用 User 字段）3 张表；`apps/api/src/routes/gpa.js` 挂载 `/api/gpa`（meta/classes/roster/课程 CRUD/scores 读+批量 upsert/report 聚合）。`prisma db push` 纯增量，DB 快照备份在前。
  - 前端：教师端 `/teacher/gpa`（成绩登记/课程配置/成绩单开具三 Tab）；学生端 `/app/gpa`「成绩单」页（GpaReportView 过程性明细 + 综合评定 + 打印）；家长端新增「成绩单」Tab；三端导航同步。
  - E2E（9 项全过）：建课→名册→批量登记（92/85/88）→ 综合评定 **89.1 → B**（与手算一致）→ 成绩单聚合完整 → 学生越权访问他人 403 / 查本人 200 → 测试课程级联清理。
- **Bug 修复（笔试练习打开显示选课页）**：根因为服务器 `apps/web/app/app/page.tsx` 残留旧版「选课直达路由」，历次 surgical 部署漏传此文件。已重新 scp（md5 对齐）+ 构建，产物 chunk 验证含 试卷/组卷/知识点/错题 字符串、`StudentCourseSelection` 不在 `/app` 产物中；`/app/course-selection` 直达路由保留可用。
- **部署**：12 文件 scp+md5 对齐 → `prisma db push`（102ms）+ Prisma Client 重生成 → `pm2 restart api`（health 200，`/api/gpa/*` 未登录 401 鉴权生效）→ `npm run build`（经 4 轮修复：家长端 tab 联合类型补 `"gpa"`、`comprehensive()` 元组类型标注、`Set` 展开改 `Array.from`、`TranscriptReport` 补 `Fragment` 导入）→ `pm2 restart web`。冒烟 7 路由全 200。
- ⚠️ 提醒：浏览器需**硬刷新**（Cmd+Shift+R）以加载新构建产物。

## 系统改名 (2026-09-26) — 品牌名称由「金瑞升学金鹰系统」统一改为「金瑞高中综合管理系统」
- **改动**：全站系统名称（含三端布局页眉、登录页标题、根 metadata 的 `title`/`description`、练习页页眉、预览页、README、docs、API/schema 注释、PPT 介绍 deck 页脚/封面）由「**金瑞升学金鹰系统**」统一改为「**金瑞高中综合管理系统**」。
- **规则**：
  - 带端后缀的保持后缀：学生端/老师端/家长端 → `金瑞高中综合管理系统 · 学生端/老师端/家长端`（本次三端原后缀一致，仅换前缀）。
  - 根 `description` 由 `金瑞升学 · TMUA / ESAT 在线刷题、模拟考与学情分析平台` 同步改为 `金瑞高中综合管理系统 · TMUA / ESAT 在线刷题、模拟考与学情分析平台`。
  - PPT deck（`jr-eagle-ppt`）中「金瑞金鹰系统」「金瑞金鹰 · 让成长有迹可循」「金瑞升学 · 金鹰系统」三种旧写法一并归一为「金瑞高中综合管理系统」。
- **历史快照不碰**：`_gantt_*`、`scripts/_schema_tmp.prisma` 属历史/临时快照，保留原样；CHANGELOG 历史条目（含 V2.3.33 的改名记录）原样保留，仅新增本条。
- **部署**：前端 6 个 tsx/ts 布局与 1 个静态 html 已 scp 至 `8.219.151.140` 并 `npm run build` + `pm2 restart web`；`apps/api/prisma/schema.prisma` 仅改首行注释，无 schema 变更、无需迁移。

## 数据修正 (2026-09-24) — ESAT Physics 模考11 修复落库（6 题 / 12 字段 + 1 条判分记录文本规范化）
- 触发：用户「**请修复 ESAT Physics 模考11中的问题**」（承接同卷核验报告 §七 分级处置 P0/P1/P2）。**已写生产库。**
- **改动清单**（Q13 超纲按用户选定**方案 B：退回考纲内**处置）：
  - **Q15（P0 答案键错）**：`answer` **C 图 → B 图**（`6236522e…png` → `c0252bab…png`）；`solution` 重写（移除首行错误标注「正确答案：选项 C」，改为「斜率递增 ⇒ 下凸 ⇒ B」并附求导论证）。全库 `AnswerRecord` = **0** ⇒ **零重判**。
  - **Q13（P1 超纲歧义 → 方案 B）**：`stem` 慢电子速度 $1.20\times10^8\to1.20\times10^6\ \mathrm{m/s}$；5 个选项整体缩放到 $10^6$ 量级；`answer` **D（$1.97\times10^8$）→ B（$2.40\times10^6$）**；`solution` 改为纯 $p=mv$ 推导。⇒ 彻底回到 ESAT 物理考纲（P3.6 仅定义 $p=mv$，无相对论）。
  - **Q21（P0 结构 + P1 解析）**：`stem` 补齐未闭合的 `$`（`$3.0\times10^8\ \mathrm{m\,s^{-1}}$`，原先吞掉 Table 2 图导致**题目不可做**）+ 单位改 `\mathrm{}` + 图片前后补空行；`solution` 按 Table 2 **真实数据**（$1.0\times10^{-4}/10^{-2}/10^{-1}$ m 与 $5.0\times10^{-7}/5\times10^{-1}/1.0\times10^{3}$ m）整体重写（原解析用了题面**不存在**的波长，靠假矛盾推真结论）。
  - **Q14（P1 解析硬缺陷）**：`solution` 按**读图确认的真实拓扑**（电池→左 1R→(1R ∥ 2R)→右 1R，伏特表跨下支路右侧电阻）重写 ⇒ $3.0+2.0+3.0=8.0$ V；删除「选项中没有该值 / 说明原题可能要求…」两处答案反推话术。
  - **Q18（P1 解析硬缺陷）**：`solution` 末句「因此选 B」→ 按 $\varphi_Y=\theta$ 推出**顺时针 $45°-\theta$（E）**，附 $\theta=30°$ 校验与干扰项排除。
  - **Q06（P2 版式）**：`options` 断字修复 `conserva- tion`→`conservation`、`conser- vation`→`conservation`（A/B/C）+ `speed$u$`→`speed $u$`。
- **判分记录**：`AnswerRecord cmuck3pg30108o71k5zlmbk5r`（Q13，会话**未交卷**）`selected` 由 $2.40\times10^8$ **文本规范化**为 $2.40\times10^6$（学生所选同为选项 B，仅文本随题干缩放更新）⇒ 规范化后恰等于新答案；`isCorrect` 保持 `NULL` **未动**。**判分一致性复扫：写前/写后均 126 条（错判对 95 / 对判错 31），未新增任何不一致。**
- **纵深防御五段式**：① 双重备份（服务器 `dev.db.bak-prephys11fix-20260924-1852` md5 `283767dbec8931b455b7a6ae51042adc` + 本地 `dev_fresh.db` 同 md5）② 写前**重拉**服务器库做新鲜度守卫（md5 与 18:32 快照一致、无 `-wal`/`-journal` 残留）③ 快照守卫 `target=0 apply=12 unexpected=0` + 写前自检 `SELF_CHECK_OK`（答案∈选项且唯一、选项无重复、`$` 全配对）④ 单事务写入 ⑤ 三重核验：**全表逐行 diff**（`Question` 改 6 行、`AnswerRecord` 改 1 行，新增 0 / 删除 0，其余 22 表逐字节一致）＋**服务器写后库 ↔ 本地独立重放副本 0 差异**＋结构门禁复跑（`GATE_A=0 / GATE_D=0 / ANS_NOT_IN_OPTIONS=0 / UNCLOSED_$=0 / HYPHEN=0`，`ANN_HEAD` 6→5）。
- **幂等实测**：本地副本预演后复跑、服务器端复跑均返回 `ALREADY_TARGET`（环境重放已生效，未二次写入）。
- **派生资产回写**：`bank_esat_physics_supplement{,_latex,_img}.json` 共 5 处字段（备份 `*.pre-phys11fix-<md5[:8]>`）。其中纯文本版只修断字（不引入 `$` 定界符）、latex 版按库内原文整段同步 `options`、img 版因选项为占位字母只同步 letter 型 `answer` + `solution`。
- ⭐ **本轮新规则（已写回技能）**：**当答案键改动伴随「选项文本」改动（如数值缩放）时，必须显式把历史 `AnswerRecord.selected` 的文本同步为新选项文本**，否则同一选项的学生会在交卷时被判错 —— 这是「改键四步」的显式例外条款（本次仅 1 条未交卷记录，`isCorrect` 无结论可改，故为纯文本规范化）。
- ⭐ **前端渲染约束（新发现）**：`apps/web/lib/rich.tsx` **只识别** `![alt](url)` / `$$…$$` / `$…$`，**不解析 Markdown**（无粗体、无列表）；学生端 5 个调用点全部 `renderRich(solution, { smart: false })` ⇒ 新撰写的解析**禁用 `**` 与行首 `- `**（会字面显示），本轮 5 段新解析已改为叙述体。
- 报告：`scripts/REPORT_ESAT_Physics_模考11_核验报告.md` 新增 **§十 实施记录**（含改动清单表、五段式证据、新规则、待拍板、复现命令）。脚本：`scripts/_phys11_fix/{build_patch.py,new_texts.py,apply_phys11.py,sync_bank_phys11.py,katex_check.mjs}`。
- **仍待拍板**：① Q11/Q16/Q23/Q24/Q25 的 5 处解析首行标注（与库存答案自洽，属「全库 72 处」版式政策子集）；② 5 处 EN/EM DASH（合法用法）；③ 7 处 `NONASCII_MATH` 假阳性（⇒ 门禁脚本需做 `$$` 感知）；④ 门禁脚本需扩展扫描 `options`（Q06 断字即人工发现、门禁漏报）；⑤ 库内存量解析的 `**…**` 版式问题；⑥ **全库 126 条判分污染**仍待立项（最高优先级）。

## 核验 (2026-09-24) — ESAT Physics 模考12 逐题核验（27 题：**27/27 全对，0 缺陷**）+ ⭐**证伪「继承补充题库错答」假设**
- 指令：承接模考11 核验，同系列推进「逐题核验 ESAT Physics 模考12」（Paper `cmto9sarg8svzlntpuxypyh2`，mock/AUTO_SET/READY，27 题）。**只核验，未写库（本轮零改动）。**
- 方法：四道门禁（A 0 / B 0 / C 0 / **D 权威口径 0**）+ 结构体检 + **逐题独立重算**（先主 agent 手算，再由 **4 个独立子代理并行盲算**，题面均已剔除 answer/solution 防污染）+ **4 道配图题 12 张图逐张实看** + 曲线题**像素级弦偏差法** + KaTeX 渲染冒烟（310 公式）+ **题源答案键横向比对** + 跨卷复用与判分影响面扫描。
- **① 答案键：27/27 全部正确**（主 agent 手算与 4 子代理盲算**完全一致**）⇒ 0 废题、0 超纲（逐题比对 ESAT 物理 P1–P7 考纲）、0 解析硬缺陷（无与答案键相悖、无幻觉数值、无拓扑反推）。
- **② 4 道配图题逐张实看定案**：`Q06`（钢球在甘油中下落的 a–t 图，5 图选项）弦偏差法读数 **D rel=−0.1906（初始最陡、渐近趋 0）正确**，A 直线/C 水平线/B 斜率递增(+0.1524)/E 方向相反均错 ⇒ 与库 **D** 一致；`Q14`（二极管 I–V）读图 **(1.2 V, 8.0 mA) 恰落网格交点** ⇒ $R=(6.0-1.2)/0.008=600\ \Omega$ ⇒ 库 **F** 一致（稳健区间 593–607 Ω，答案不变）；`Q16`（竖直上抛 $E_k$–$s$）标准 V 形 ⇒ 库 **C** 一致；`Q19`（电磁波 P/Q 对比表）逐行抄录 A–H，**真空同速 ⇒ 速度比 1.0、频率比 1.0×10⁻⁸、P 微波 / Q X 射线** ⇒ 库 **A** 一致。库内选项图片与题干选项**一一对应、无错位**。
- **③ 四道门禁命中 = 0**；门禁输出中的 13 处非零标记**全部核实为假阳性或纯版式**：7 处 `NONASCII_MATH`（因解析大量使用 `$$...$$` 显示定界符，旧正则 `\$([^$]+)\$` 误判 ⇒ **门禁脚本需升级为 `$$` 感知**）、4 处 `ANN_HEAD` 首行标注（与库存答案**全自洽**，并入既有「72 处首行标注」批次）、3 处 EN DASH（纯排版）。另发现**门禁漏报**：Q06/Q16 的图在**选项**里而门禁只扫 stem/solution ⇒ **门禁脚本需扩展扫描 `options`**。
- ⭐ **④ 本轮最高价值结论 —— 证伪「模考12 继承补充题库错答」假设**：模考12 含 **11 道补充习题库来源题**（Q03/Q06/Q09/Q11/Q15/Q16/Q17/Q20/Q23/Q24/Q25），库内答案与卷内答案**完全一致**且重算**全部正确**。上一轮把 `Supplement_Q094`（→本卷 Q20）与 `Supplement_Q108`（→本卷 Q15）列为「疑似继承错答」，本轮逐条核实**两题入库时答案键均正确**（Q20 = 1.0×10¹⁵ Hz 的 B；Q15 = 48 W 的 D）⇒ 假设**被证伪**。同时 F1 指纹（`answer == options[0]`）本卷仅命中 Q079/Q23（A）且为**真阳性正确题**，证明该指纹是**下界指标、存在假阳性**。
- **⑤ 判分影响面**：27 题全库 `AnswerRecord` = **17 条**，`isCorrect` 与现行答案**零不一致**；因答案无需修改 ⇒ **零重判**。**跨卷复用**：27 题另被 **7 套卷**引用（补充习题 11 / 物理碗 2013-2017 5 / 物理碗 2021-2025 4 / NSAA Physics 2023 3 / 2019 2 / 2021 1 / 2018 1），因答案全对 ⇒ **无连带污染**。
- **⑥ KaTeX 微弱项**：310 个公式 `katex-error=0`，唯 **Q03 题干 `$Ω$` 用 U+2126 OHM SIGN**（同卷 Q14 用规范 U+03A9「Ω」），KaTeX 报 `Unrecognized Unicode character` 并降级为 `<mtext>`（能显示但缺字符度量）⇒ 建议改 `\Omega`。
- **与前序卷对照**：模考11 的 Q15 病灶（碳丝灯泡 I–V 误用 NTC）**未在模考12 复现**；模考12 未出现「题源键被机械填充」的继承问题。**全库最新一套物理模考在此维度上免于前序卷的病灶。**
- 报告：`scripts/REPORT_ESAT_Physics_模考12_核验报告.md`（过 `_md_lint.py` 0 违规）。脚本：`scripts/_phys12/{dump_phys12.py,gates.py,curve_shape2.py,katex_check.mjs,clean.json}`；快照 `scripts/_phys12/dev.db`（18.1 MB，md5 `283767dbec8931b455b7a6ae51042adc`）。
- **待拍板（纯版式，本轮零改动）**：P12-1 Q03 U+2126→`\Omega`（并全库扫描 U+2126）；P12-2 4 处首行标注并入既有批次；P12-3 3 处 EN DASH；P12-4 Q19 选项文本「A. A」冗余。

## 核验 (2026-09-24) — ESAT Physics 模考11 逐题核验（27 题：26 对 / **1 错答 Q15**）+ ⭐**全库 126 条「改键未重判」判分污染**
- 指令：「逐题校验 ESAT Physics 模考11」（Paper `cmtv39af4zdpqkhizxslmbxk`，mock/AUTO_SET/READY）。**只核验，未写库。**
- 方法：四门禁（A 0 / **D 权威口径 0** / C 0）+ **逐题独立重算**（题面剔除 answer/solution）+ **7 题 17 张配图本轮全部实看原图**（图片通道已可用）+ I–V 曲线**像素级弦偏差法** + **题源答案键横向比对**。
- **① 答案键确证错 1 题 — Q15（碳丝灯泡 I–V）**：库存 **C（过原点直线＝欧姆）** → 应为 **B（下凸／斜率递增）**。三证：物理（碳丝 NTC ⇒ $R\downarrow$ ⇒ $I$ 增长快于正比）、**逐张读图**（B=下凸、C=直线、A/E=下降、D=上凸）、`curve_shape2.py` 弦偏差（**B rel=−0.1128 下凸 / C rel=0.0 直线**）。且**解析自身**写着「斜率递增…——**正确答案：选项 C**」＝解析与落款互斥。**三源三方互异**（库 C / 补习题源 A / `_latex` 源 A / 正确 B），已用 `opt_crops_final3/extra_q107_opt_{A..E}.png` 证实源与库选项**同序**（排除「选项重排」辩护）。
- **② 超纲歧义 1 题 — Q13（相对论动量）**：经典 $p=mv$ ⇒ 2.40×10⁸（**B**）；相对论 $p=\gamma mv$ ⇒ 1.97×10⁸（**D＝库存**）。核对 `esat_physics_syllabus.md`：**P3.6 只定义 $p=mv$，全卷无相对论条目**，题干亦未声明 ⇒ 双重可解、学生按考纲作答会被判错。建议改数值（1.20×10⁸→1.20×10⁶）退回考纲内。
- **③ 解析硬缺陷 3 题（答案键对，四门禁均抓不到）**：`Q14` 解析按「左2+中1+右3」**错误拓扑**算出 11.0 V，再以「选项中没有该值…说明原题可能要求左侧两个电阻的总电压」**反推**选 E（正解确为 8.0 V＝$3.0+2.0+3.0$，读图证实拓扑为 电池→R→(R∥2R)→R）；`Q18` 解析末句写「**因此选 B**」而库存答案是 **E**（重算 $\varphi_Y=\theta$ ⇒ 顺时针 $45°-\theta$，$\theta=30°$ 反证 E 唯一）；`Q21` 解析**整套数值编造**（用 2 m/0.2 m/0.02 m 等题面不存在的波长），靠假矛盾推出真结论 E（正确：波3=3 kHz 可听、波4=6×10¹⁴ Hz 可见；Table 2 实为 10⁻⁴/10⁻²/10⁻¹ m 与 5×10⁻⁷/5×10⁻¹/10³ m）。
- **④ 结构/版式**：**Q21 题干 `$` 未闭合**（会吞掉紧随的 Table 2 图 ⇒ 题目不可做，必修）；Q06 选项断字 `conserva- tion`／`conser- vation` + `speed$u$` 缺空格；6 处首行标注 `**正确答案：选项X**`（与库存答案**全自洽**，纯版式）；EM DASH ×1 / EN DASH ×4；7 处 `NONASCII_MATH` 判为脚本假阳性（希腊字母/`Ω` 合法）。
- **⑤ 题源横向比对（补习题 10 道）**：**5 道题源键本身错**（Q11/Q15/Q16/Q23/Q25，多为题源机械取 `options[0]`）；其中 **4 道入库时被改对**，**仅 Q15 改错**。⇒ 导入流程**具备纠错能力**但存在人工/机械误改，建议对所有「库答案 ≠ 题源答案」的题做专项复核。
- ⭐ **⑥ 本轮最高价值发现 — 全库判分一致性扫描（`scripts/_phys11/audit_isCorrect.py`，只读）**：`AnswerRecord.isCorrect` 与**现行** `Question.answer` 不一致 **126 条**＝**错判对 95（学生被多给分）+ 对判错 31（被少给分）**，横跨 **22 卷 / 48 个会话**。重灾区：`TMUA P1 逻辑推理专练 20 题 A`（48）、`TMUA Paper 2 模考15`（23）、`MAT 2007-2023`（9）。
  - **实证样本（与模考11 同源题 Q18）**：`NSAA Physics 2023` 3 条记录——选 B 判**对**（08-10）、**选 E（＝现行正确答案）却被判错**（08-17）、选 A 判错（09-02）⇒ 证明该题答案键曾 **B→E 修订而未回扫历史判分**。
  - 风险：`isCorrect` 是错题本 / 知识点掌握度 / 学情分析 / 教师端错因的**唯一数据源**，95 条错判对还会抬高 `correctCount`/`score`。
  - 整改建议（**单独立项**）：① 以现行 `answer` 重判受影响记录 → ② 同步回填 `Session.correctCount`/`score`（守 `score===correctCount`，跑 `audit_session_invariant.py`）→ ③ 在「改答案」后台动作里**强制追加幂等重判**，并把本扫描做成常驻巡检。**需双重备份 + 显式确认方可动生产库。**
- **影响面**：Q15 全库 `AnswerRecord`＝**0 条** ⇒ 改键 **C→B 零重判**；模考11 自身仅 1 个**未交卷**会话（23 条记录 `isCorrect` 全 `None`），当前无学生成绩受损。
- 报告：`scripts/REPORT_ESAT_Physics_模考11_核验报告.md`（过 `_md_lint.py` 0 违规）。脚本：`scripts/_phys11/{dump_phys11.py,gates.py,curve_shape2.py,audit_isCorrect.py}`。
- **待拍板**：① Q15 改键 C→B（建议立即）；② Q21 `$` 闭合（建议立即）；③ Q13 超纲处置；④ Q14/Q18/Q21 解析重写；⑤ **全库 126 条判分污染是否立项清洗**（最高优先级）；⑥ Q06 断字等版式项。

## 数据修正 (2026-09-24) — ESAT 物理「补充习题」库**残留错答补修 2 题**（Q028/Q029）+ 门禁 D 权威口径全库归零
- 来源：上一条修复收尾后，用**门禁 D 权威口径**（含新增近义变体子句）对**未核的 147 题**做只读残留量化，发现仍命中 **2 题**（不在上轮 30 题名单内）。
- **两题均为确证错答（独立复算）**：
  - `Q028`（匀速列车内悬挂物）：库存 D → **E**。匀速 ⇒ 惯性系、物体不受水平附加力 ⇒ 仍在标记正上方；A/C/D 均预设列车有加速度。
  - `Q029`（哪对力**不是**牛三作用-反作用对）：库存 D（电子–质子库仑引力，实为**有效**对）→ **E**（向心力与重力**都作用在卫星上**，不成对）。
  - 两题解析**自身就写着**「题库所录答案为…**建议核对**」= 缺陷指纹；已同步删除尾注并改写为完整推导。
- **连带清理（仅限答案键耦合项）**：`Q029` 选项 E 尾部页码残留 `…the weight of the satellite **9**` → 已清（它将成为答案键文本，不清则答案键自身是坏串）。同类但**非**答案耦合的 `Q076` C「 27」/`Q084` C「 30」**未动**，与 `Q041` 缺 `P:` 前缀合并待拍板。
- **影响面**：两题仅在「ESAT 物理 补充习题」卷（CUSTOM/READY），**不在模考10/11/12 任何一卷**；`AnswerRecord`/`WrongBook`/`FavoriteQuestion`/`ReviewRequest` **全 0** ⇒ **零重判**。
- 落库五段式：① 双重备份（服务器 `dev.db.bak-prefollowup-20260924-1226` + 写入器快照 `dev.db.bak-prepatch-004c544555d4`）② 对**重新拉取**的服务器最新库逐条守卫 5/5 `APPLY`、`unexpected=0`（**未沿用旧副本**——服务器在 12:25→12:35 活跃增长约 16 KB）③ 单事务写入 `WROTE 5 rows` ④ 读回复核位次均 E ⑤ **全表逐行 diff：`Question` 改动 2 行 / 新增 0 / 删除 0**，其余差异全为线上业务写入（`AnswerRecord` +88、`AssignmentStudent` +16 等）。
- **幂等守卫再次实测有效**：环境重放命令，第二次返回 `target=5 apply=0` ⇒ `ALREADY_TARGET` **拒写**。
- **门禁 D 权威口径全库归零**（修复前：已修组 30 + 未核组 2）。但 ⚠️ **归零 ≠ 残余错答为零**：机械填充指纹 F1（`answer == options[0]`）在未核 145 题中仍占 **25.5%**，与抽样探针 3/12 ≈ 25% 高度吻合 ⇒ **点估计未核题中可能仍有 30~37 道错答**，正则手段已用尽，只能靠独立重算清除。
- 派生资产：`bank_esat_physics_supplement{,_latex,_img}.json` 再次回写（原件存 `*.orig-backup-followup`）；其中 `_latex.json`/`_supplement.json` 额外同步 `options`（完整选项文本），`_img.json` 因选项为占位字母故只同步 letter 型 `answer`。
- 报告：`scripts/REPORT_ESAT_Physics_模考10_核验报告.md` **§十二**（新增）。至此补充习题库累计修复 **41 题**。

## 数据修正 (2026-09-24) — ESAT 物理「补充习题」库答案键系统性错误修复（39 题 / 39 行）+ 门禁 D 召回率发现
- 来源：应「逐题核验 ESAT Physics 模考10」（27 题，结论 24 对 / **3 错答** / 0 废题）之后执行「**请修复**」。
- **根因（不在渲染层、不在答案录入，在题源库生成阶段）**：`bank_esat_physics_supplement_latex.json` 的 `answer` 字段**绝大多数逐字等于 `options[0]`**（机械取首项）；`bank_esat_physics_supplement_img.json` 的 `answer` **恒为 `A`**（186/186）；`bank_esat_physics_supplement.json` 混杂 `(A)`×37 与乱码（`A x T`、`kg s^{-1} 4200×8 6.7×109`）。⇒ 该库答案键**在生成阶段即损坏**，下游（补充习题卷 + 模考10/11/12）忠实继承。
- **本轮修复（写入生产库 `Question` 表 39 行：`answer`×33 / `solution`×36 / `stem`×7）**：
  - **P0/P1-A 答案键修正 30 题**（门禁 D 扩充名单）：**30/30 原答案全部有误**（零假阳性）。含模考10 的 Q09/Q11/Q20、模考11 的 Q09/Q20、模考12 的 Q15/Q20。典型：`Q008` force→**charge**（SI 基本单位数）、`Q061` 625→**25**（漏开平方）、`Q083` ×60→**÷60**（单位换算差 3600×）、`Q092` 紫外→**红外**（10¹³ Hz ⇒ λ=30 µm）、`Q108` 6.0 W→**48 W**（R∝I 时 P∝I³）、`Q110` R/2→**R**、`Q125` 6000μ₀→**zero**（反向等大抵消）、`Q153` 17→**35**（核子数=质量数）、`Q170` ln(τ/2)→**τ**。
  - **P0/P1-B 解析重写 30 题**：删除「依给定答案 / 按题给答案 / 疑为答案录入有误…」等**自相矛盾尾注**，改写为正确推导（否则修完答案后尾注会与新答案打架）。
  - **P0-C 断字/连字修复 7 处 `stem`**：`electromag- netic`→`electromagnetic`、`char- acteristics`、`state- ments`、`dis- charge`、`resis- tance`、`current- voltage`、`eﬀiciency`(U+FB00→ff)。
  - **P2 解析首行 `**正确答案：选项 X**` 剥离 3 处**（模考10 Q16/Q23/Q25）。
  - **P1-新 探针新发现错答 3 题**：`Q023` 17→**22 m/s**（$v^2=10^2+2(1.6)(120)$，漏初速度）、`Q034` E→**D**（非弹性碰撞中**动量守恒成立**）、`Q148` A→**B**（$N_s/N_p=V_s/V_p=I_p/I_s$，电流比写反）。三者均在线上卷（模考12 Q09 / 模考11 Q06）。
- **⚠️ 本轮最高价值发现 —— 门禁 D 是「下界」而非「全集」**：对「未被门禁 D 命中、且不依赖配图」的 74 题**均匀抽 12 题独立重算**，得 **3 题确证错答（≈25%）**，其中 `Q148` 的解析**已完整推导出正确答案**却把 `answer` 写成另一个选项（通篇无「给定答案」字样，任何正则都抓不到）、`Q023` 用的是同款话术的**近义变体**（「疑为答案录入有误，建议核对」）。⇒ **「解析自承」只是缺陷子集**；凡遇「题源库答案键被机械填充损坏」，必须再跑一步**抽样普查探针**（抽题时输出**不得含 `answer`/`solution`**，防子代理污染），并在报告中标注「剩余 N 题未核，估算残留 M 道」。已把扩充正则（11→30 召回）与这条铁律写回 `paper-quality-audit` 技能。
- 复核（**四路独立**）：主核验 + **3 个子代理并行独立重算**（28 道纯文本题，输入不含答案/解析）⇒ **28/28 与主核验完全一致**；2 道配图题（`Q069` 五图阴影面积量纲、`Q114` 二极管伏安图读数）由主核验**逐张读图/程序化读数**判定（Q069：E「引力场强度×时间=m/s」非能量；Q114：$V=I_g\!\cdot\!100\,\Omega=0.8$ V ⇒ 导通二极管 6 mA ⇒ 总电流 14 mA）。
- 落库五段式：① 双重备份（服务器 `dev.db.bak-prephys10supp-20260924-102602`，md5 与当时库一致；本地拉回 `dev_pre.db`）② 快照守卫逐条比对 `old`，`unexpected=0` ③ 单事务写入（`apply_patch.py`）④ 读回复核 `VERIFIED_OK` ⑤ **全表逐行 diff（36 张表）：`Question` 改动 39 行 / 新增 0 / 删除 0，其余 35 张表零差异**。
- **幂等守卫实测有效**：远程命令因环境重放被执行两次，第二次报 `ALREADY_TARGET` 并**拒写**（未重复应用）—— 与技能中「拒用 `--dry-run`、改用状态守卫」的结论一致。
- 判分影响：30 题范围内 `AnswerRecord` **仅 2 条**（`Q008` selected=`charge`、`Q096` selected=`radio`），**均为未交卷会话**（`submittedAt/correctCount/score` 皆 `NULL`）⇒ **零重判**；两条所选文本恰为修正后的正确答案。`WrongBook`/`FavoriteQuestion`/`ReviewRequest` 命中 **0**。
- 门禁复核（生产库实跑）：模考10/11/12 与补充习题库的**门禁 A=0、C=0、D=0（原 3/2/2/30）**、断字 **0**。
- 派生资产：`bank_esat_physics_supplement{,_latex,_img}.json` 回写（35/38/34 处，原件存 `*.orig-backup`），防止将来重导入冲掉修复。
- 观察项（**未修，待拍板**）：① 补充习题库**剩余 147 题未经独立重算**（含 82 道配图题），按 25% 抽样命中率粗估**可能仍有数十道错答**，且已被多套模考复用 —— 建议立项**全库普查**；② 库内尚有 **76 处**解析首行 `**正确答案：选项 X**`（经核**全部与库存答案自洽**，属版式决策，未擅改）；③ `topic` 元数据重映射（如 Q088/Q093/Q100/Q153 标注与实际考点不符，改 `topic` 需同步 `topicIds`）；④ **`Q041` 选项文本丢失首位 `P:` 标签**（现为 `moving left; Q: …; R: …`），按项目约定「只改 `answer` 不动选项文本」未动；⑤ Q04 `pond`/`lake` 混用。
- 报告：`scripts/REPORT_ESAT_Physics_模考10_核验报告.md`（403 行，§八 实施记录 / §九 门禁召回率发现 / §十 待拍板 / §十一 复现命令）。

## 数据修正 (2026-09-24) — ESAT 数学1/数学2 模考22 导入期符号丢失修复（根号/下标/求和号/绝对值竖线，21 题、23 字段、70 处）
- 来源：应「逐题核验 ESAT 数学1 模考22 与数学2 模考22」时的**连带发现**——两卷答案键 **54/54 全对、零废题**（不需下架、不需重判），但源卷 KaTeX→LaTeX 转换在**成批静默丢符号**，产出「**合法 LaTeX 但数学含义错**」的算式。**这类损坏 KaTeX 严格模式零报错**（`\frac{415}{2}` 是合法 LaTeX），故既有渲染门禁（#33）完全抓不到；本库 `answer` 存完整选项文本，**纯重算答案也查不出**——必须靠「源↔库结构计数比对」才能发现。
- 四类损坏（源卷 `ESAT 数学 1 + 数学 2 · Set 2（27 + 27 题）.html` 为唯一真值）：
  - **① 根号被整体删除**（25 处 / 6 题）：`\sqrt{15}`→`15`、`\sqrt3`→`3`、`\sqrt m`→`m`；最重 M1 Q26 一题丢 10 处（`\frac{7\sqrt2}{2\sqrt2-1}`→`\frac{72}{22-1}`），并产出 `\sin60°=\frac{3}{2}`、`h=\frac32 s` 这类**数学上错误**的算式；M2 Q19/Q25 则丢了积分上下限的根号（`\int_{0}^{\sqrt m}`→`\int_{0}^{m}`）。
  - **② 单下标被整体转成上标**（40 处 / 12 题）：`S_n`→`Sⁿ`、`V_X`→`V^X`、`V_c`→`V^c`、`t_1`→`t¹`、`u_0`→`u⁰`（M2 Q26 一题 11 处）、`\log_2`→`log²`（**对数底数变「对数平方」**）。
  - **③ `\sum`/`\int` 被删只剩悬空上下限**（4 处）：`$\sum_{n=2}^{20}$`→`$_{n=2}^{20}$`（M2 Q04 三处、M2 Q27 一处）。
  - **④ 绝对值竖线被删**（2 处，与 ① 同机制——裸 `|` 紧邻高内容时被 KaTeX 画成 SVG 分隔符，与根号一起被导入器整块删除）：M2 Q23 解析 `=|-\frac{4}{3}|=\frac{4}{3}`→`=-\frac{4}{3}=\frac{4}{3}`（**断言 −4/3=4/3，数学上为假**）、M2 Q27 解析 `|\frac{k}{6}|<1`→`\frac{k}{6}<1`。注意同句的 `\mid r\mid`/`\mid k\mid` 是文本字形故幸存，**只丢紧邻分式的那一对**——这也解释了早期「剥 HTML 标签」统计法的假阴性。
  - **其中 4 处落在题干（M2 Q16 `\log^2`→`\log_2`、M2 Q24 `y^k`→`y_k`），学生看到的题意已被改变（P0）**。
- 根因（在**导入器**，不在渲染层）：当年走的 `scripts/html_to_bank_esat_set2_v2.py` 是「**抽纯文本 + 启发式重新包 `$...$`**」的**降级流水线**，不是真正的 KaTeX→LaTeX 逆向转换 —— ① 所有用 SVG 绘制的 KaTeX 原子（根号、紧邻分式的裸 `|` 分隔符）被 `re.sub(r'<svg...')` **整块删除**；② `msupsub` 一律无脑写成 `^{...}`，**不区分 `vlist-s`(下标) 与 `vlist-t2`(上标)**；③ `\sum`/`\int` 等大运算符原子无对应分支，直接丢字。
- 修复方式（**只改文本层，判分零风险**）：以源卷 KaTeX span 经权威转换器 `katex2latex.py` 逆向得的 LaTeX 为真值，**声明式 patch 表 + 全量守卫**（任一 `old` 缺失或计数不符 ⇒ 整体中止，不写半条）+ **单事务**写入 + 写后复核，脚本 `scripts/patch_esat22_math.py`。共 **40 条 patch / 70 处替换 / 23 个字段 / 21 题**（P0 题干 12 处、P1 根号+求和号 16 处、P1b 竖线 2 处、P2 下标上标 40 处）。**仅改 `stem`/`solution`，绝不触碰 `answer`/`options`** ⇒ 无需重判任何 AnswerRecord / Session。分两轮落库，**第二轮顺带验证了幂等**（已修的 38 条自动跳过，只写新增 2 条）。
- 验收（七条全绿）：
  - ① **守卫**：40 条 patch 全部命中且计数精确（0 错误）；服务器预演的 before→after 字段 md5 与本地副本**逐条一致** ⇒ 服务器内容与验证副本同源；上库前另做一次**快照新鲜度检查**（导出后 DB 又被学生作答写入过）⇒ 两卷题面**零漂移**才动手。
  - ② **全表 diff**（`scripts/_db_full_diff.py`，24 张表逐行 md5 比对）：仅 `Question` 表 **21 行**变动（23 字段），**新增 0 / 删除 0**；`Session`/`Paper`/`ReviewRequest`/`WrongBook` 等全部逐字节一致。（唯一一处 `AnswerRecord` 新增经核验属 **TMUA 2020 Paper 2 的实时作答**，与本次无关。）
  - ③ **结构计数审计归零**：根号净丢失 M1 15→**0** / M2 10→**0**；绝对值竖线真缺陷 2→**0**；上下标缺位 13 题→**只剩 2 处已确认假阳性**（M2 Q06/Q15 是导入期**整题替换**题，源↔库本就不同题，须先排除否则会报一堆「丢失」——本轮踩过）；运算符只剩 2 处已知非缺陷（M1 Q25 箭头被改写为文字、M2 Q15 步骤2 本就是不定积分写法不带上限）。
  - ④ **渲染门禁**（新脚本 `scripts/verify_esat22_render.mjs`，前端同源 latexify + KaTeX `throwOnError`）：1425 个数学段，修复前后均 **0 失败 / 0 未闭合**，**段数不变**（只改内容未增删段）。
  - ⑤ **端到端等价性**：从线上库重新导出两卷，与本地已验证快照**逐字段完全一致**。
  - ⑥ **人工目视 + 数学自洽**：M2 Q16 修复后题意自洽（`u+v=3, uv=2 ⇒ x=2,4 ⇒ 和=6` 与答案 `6` 一致）；M2 Q24 题干 `y_k` 可解析；M1 Q26 有理化得 `4+\sqrt2` 与答案一致；M2 Q25 面积积分得 `a=2` 与答案一致。
  - ⑦ **派生资产对齐**：`scripts/bank_esat_m1_mock22.json`（8 字段）+ `bank_esat_m2_mock22.json`（16 字段）回写后与线上库比对**零偏差**。
- 上线数据：落库前 `dev.db` md5 `8f9d6f00111d4fa16b31133a76bcd091` → 落库后 `b06f2e79f4d5f626ece2252bfb5f53d6`；服务器备份 `apps/api/prisma/dev.db.bak-pre-esat22fix-20260924` + 本地双重备份 `scripts/_esat22fix/dev.db.pre`。**api/web 均未重启**（纯数据层，Prisma 每次查询直读 SQLite），无需 build；学生端硬刷新即见修复。
- 登记：`docs/MATH_RENDERING_BUGS.md` 新增 **#34**（源卷 KaTeX→LaTeX 导入期静默丢符号）+ 预防规则 #34（**「源↔库结构计数双向门禁」**，含四个计数项与三个判据坑）+ #34 回归样本与专用审计命令。
- 方法沉淀：`paper-quality-audit` 技能补入「源↔库结构差异审计」（模板脚本 `scripts/structure_audit_template.py`）。
- 观察项（**未修，待拍板**）：① **同一导入器产出的其它 ESAT 卷可能同样带病**（当年 Set2 用 `html_to_bank_esat_set2_v2.py`，同族脚本还有 `html_to_bank_esat_set2/3.py`、`_hardmock1/2` 等）——建议对全库 ESAT/TMUA 卷跑一遍结构计数审计再定；② 超纲项：**M1 Q10**（数列题，M1 不含数列；与当年已被整题替换的 Q25 同因，属漏网）、**M2 Q27**（含概率，M2 不含统计概率）、M1 Q02/Q16 解析引用正弦/余弦定理、M1 Q03 用倍角公式、M2 Q04 引用「曲棍球棒恒等式」；③ 解析文字瑕疵：**M1 Q13 末句「选项 D 也是 √60，两者等价」是源卷自带的幻觉**（D 实为 `2\sqrt{10}≈6.32`，答案 `2\sqrt{15}≈7.75`，并不等价）、M2 Q14 用 `g''>0` 判极小、M1 Q22 排除理由措辞错乱；④ `sin60°` 未写 `\sin`（渲染层 latexify 会补，**显示正常**，仅不规范）；⑤ M1 Q23 选项 A `(6x−8)/(4x+6)` 与答案数值等价（未约尽，靠题干 "complete simplification" 区分）。

## V2.4.89 (2026-09-24) — 「一题多段」：分段停留采集（`visits`）+ 甘特图同一行多条时间条
- 需求（用户原话）：「目前每一题都是显示一段时间条 我希望的是 如果学生在一道题上思考了几分钟 没有作答 过了一段时间又回到这道题 花了一些时间作答后 图上应该有两段时间条」；范围限定：「过去的反推不出分段就算了 请后续学生所做的题目成"一题多段"的形式」。
- **为何必须先动采集端（关键，非显而易见）**：`timeSpent` 是**累计标量**、`createdAt` 是**首次保存时刻**，同一题的多次停留已被加总成一维 ⇒ **信息有损，数学上无法反推分段**。所以不是"只改渲染"，必须新增「每次进入/离开题目」的分段记录；历史会话**不追**，老数据走向后兼容回退。
- 数据模型：`apps/api/prisma/schema.prisma` 的 `AnswerRecord` 新增 `visits String?`（JSON `[[startEpochSec, durSec], ...]`）。迁移后 16,359 行数据完整。
- API：`apps/api/src/routes/sessions.js` 新增 `POST /api/sessions/:id/visits` —— 鉴权 → 会话归属 → 已交卷拒绝(400) → 题目归属校验 → `upsert` **整份数组覆盖**（非追加 ⇒ 重复提交结果一致、幂等）→ **只写 `visits`**（绝不触碰 `selected/isCorrect/timeSpent`，从而保住全站依赖的 `timeSpent == null`「未作答」哨兵；只写新字段的记录天然被既有统计查询过滤，不可见）。上限：单题 `MAX_SEGMENTS_PER_QUESTION = 200`（超出保留最晚 200 段 + `truncated`）、单请求 `MAX_SEGMENTS_PER_REQUEST = 1000`（超出 400）；`parseVisits` 严格校验，空数组存 `null`。
- 导出：`apps/api/src/routes/exams.js` 的 `GET /:id/student/:studentId` 的 `perQuestion[]` 新增 `visits: [{start,end,seconds}] | null`（`toVisits()` 解析，纯新增字段，向后兼容）。
- 采集：`apps/web/app/app/practice/[id]/page.tsx` —— `visitsRef` / `visitStartRef`；切题、`visibilitychange`、`pagehide`、SPA 卸载、交卷前均**结算当前段**；上报带 `keepalive: true`；`sessionStorage`（`TIMING_KEY(id)`）持久化 `visitsRef` 防刷新丢失；服务端时钟校准 `serverNow()`（加载会话时以 `d.serverTime` 锚定，并**平移进行中段的起点**）；毛刺过滤 `MIN_VISIT_SEC = 2`；交卷时**先串行 `await` 全部作答上报、再发分段上报**（避免 `upsert` 竞态）。
- 渲染：`apps/web/components/ExamTimeGantt.tsx` —— 同一题按 `visits` 展开为**多条条带**，落在同一行的不同 x 位置（允许与其他题的条带交错）；同题相邻两段之间画白色细线（`data-split`）标记"离开又回来"；无 `visits` 的老数据**回退** `[answeredAt − timeSpent, answeredAt]` 合成单段（渲染与 V2.4.88 逐像素一致，回退段带 `synthesized` 标记）；已有分段数据的题**不再**走合成分支（`taken > 0 continue` 守卫）。横轴仍为「各段首尾相接的累计轴」⇒ 整体连续性不变量不变。`StudentExamDetail.tsx` 图注新增「共 N 段（M 题回看过）」。
- **验证（四条线全绿）**：
  - ① 离线渲染 harness：`_gantt_check/harness.tsx`（合成 7 场景）ALL_OK；新增 **`harness_online.tsx`（线上真实响应）** ⇒ `ONLINE_RENDER ALL_OK` —— 条带(rect) **47 == 期望段数 47**、多段题数 **13**、`data-split` **2 == 期望 2**、逐段 `q/seg/segTotal/from/to` **精确对齐**、首条起点 0 且 `maxGap = 0s`、并集右端 `reach = 2024 == Σ段时长 2024`；像素级 `mergedSegments:1 / maxGapPx:0 / overflow:[]`。
  - ② 本地真实浏览器端到端（**零生产风险**：`sqlite3` 在线 backup API 抓生产库一致性快照 → 副本库 + 本地 API:4000 + 本地 web:3000 + playwright）**14 项断言 FAILS=0**；关键证据：`timeSpent=9` 恰等于两段 `4s+5s`，全局交错 `Q1seg1 < Q2seg1 < Q1seg2`（同一题两段真的分开了），`selected=null` 的题 `timeSpent` 仍为 `null`（哨兵未被污染）。
  - ③ 路由负向分支探针（Python 自签 HS256 JWT 直打线上）：无 token → 401、bogus 会话 → 404、已交卷 → 400、`visits` 非数组 → 400、缺 `questionId` → 400、题目不属本会话 → 400、越权 → 404 ⇒ **FAILS=0**。
  - ④ 线上真实数据体检（232 行有 `visits` / 14 会话 / 148 题）：段数分布 `{1:164, 2:38, 3:19, 4:7, 5:4}`（**26% 真多段**）、段时长 min/max = 2/498s、JSON 解析失败 0、负时长 0、毛刺段(<2s) 0、同题内重叠 0、`Session.score != correctCount` **0 行**、未作答哨兵完好（9 行 `selected=null` 且 `timeSpent` 全 `null`）。
- **上线四道关全绿**：① 三处 md5 逐一对齐（本地 = 上传件 = 就位件）② grep 计数（新文案命中 / 旧文案 0）③ 构建指纹 BUILD_ID → **`_GIGIBPcsgyrE2XMTrYiO`**，`grep -rl 'data-split' apps/web/.next/static/chunks/` 命中 `473-87352816274ebf5a.js` ④ **实抓运行中进程服务的 chunk**（`/_next/static/chunks/473-….js` HTTP 200 且含新串）。api pid **2580296 → 2585221**、web pid **2581665 → 2585688**。覆盖前均先拉回服务器原件 `diff`，确认只差自己的预期改动（线上无第三方改动）。
- **真实世界边界（非缺陷，已写进契约）**：体检发现 ① 10 行段的 `start` 落在会话墙钟区间 `[startedAt, submittedAt]` 之外（最多差数小时 —— 不限时练习会话学生隔天回来续做属正常）；② 8 行 `Σ段时长 ≠ timeSpent`（会话跨版本 / 跨标签页，旧版前端那部分停留从未被采集）。已核对渲染端**不依赖** `startedAt/submittedAt`（横轴 = Σ段时长），并把两条口径补进 `docs/API.md`（另注：需「该题净停留总时长」时一律以 `timeSpent` 为准，`visits` 只表达停留落点分布）。
- 验收截图：`_gantt_check/g4_online.png`（线上真实数据；肉眼可见第 9 题一绿一红两段、第 12 题两条远隔绿条、第 13/14/16 题右侧回看短条）。
- 观察项（未拍板，沿用 V2.4.87）：`apps/web/components/` 下仅 7 个文件纳入 git，`ExamTimeGantt.tsx` / `StudentExamDetail.tsx` 等**仍未受版本控制**（改动无法 diff / 回滚）。

## V2.4.88 (2026-09-23) — 时间分配甘特图改口径：消除空白，横轴改为「累计作答时间轴」（连续无缝）
- 需求（用户原话）：「请将中途退出/暂停造成的空白消除掉 保证显示的所有都是连续的」。
- 根因（先算清真实数据才敢动）：真实样本（ESAT 数学1 模考8 / renjunyu / 27 题）考试跨度 1903s、Σ`timeSpent` = 1902s，但按旧口径算出的**作答区间并集只有 1593s**（缺口 310s）。原因是 `timeSpent` 为**累计**停留——学生回看会把时长累加到同一题，以「首次作答时刻」为锚反推区间会**同时制造重叠与空隙**（Σ停留 1902 > 并集 1593，309s 被重复计入）。故旧图的空白既来自真实闲置，也来自「左端夹紧」这个补丁本身 ⇒ **不能再以墙钟为横轴**。
- 前端口径 v2（`apps/web/components/ExamTimeGantt.tsx` **重写**）：横轴改为**累计作答时间轴**——把各题 `timeSpent` 按「首次作答时刻」先后**首尾相接**铺满整条轴，中途退出/暂停等空白**整体剔除**。
  - 条带**严格连续无缝**（相邻条带共用同一坐标换算 ⇒ 前一条右端恒等于后一条左端），**不存在任何空白列**；
  - 条带长度 = 该题**真实**累计停留；原「夹紧 + 斜纹」补偿机制及 `gantt-capped` pattern 整体删除，V2.4.87 遗留的「13/27 条带被压缩」问题一并消失；
  - 长时间暂停不再被挤成左侧一小撮（合成场景：跨度 3:00:00、作答 12:08 ⇒ 铺满整宽并标注「已剔除空白 167分52秒」）。
  - 代价与补偿：横轴刻度含义由「开考后」变为「累计作答」⇒ 轴线左上角加「累计作答」字样、右下角同时给「考试跨度」作对照、悬停提示保留「首次作答：开考后 X」，信息不丢。
  - 其他：新增 `data-bar`/`data-from`/`data-to` 数据属性（供离线验收精确断言）；`blankSec = max(0, 跨度 − 累计作答)` 仅在 ≥5s 时展示；新增 `MIN_BAR_W` 保底宽度。
- 前端文案：`StudentExamDetail.tsx` 副标题改为「每道题占一条横向条带，按作答先后连续铺满整条时间轴（按对错着色）」。
- 验证：`tsc --noEmit -p apps/web/tsconfig.json` 退出码 0；离线 harness **7 场景**（full / **paused（新增，本轮正主）** / nostart / single / dirty / empty / zero）**ALL_OK**；真实数据 harness 最大空隙 = **0s**、并集右端 = 1902 = Σ累计停留；像素级测量（720px 真实宽度，4 场景）`mergedSegments=1 / maxGapPx=0 / overflowing=[] / overlapRatio=1`。
  - ⚠️ 断言口径同步升级：「连续无空隙」类断言**不能用「按左端排序 → 比较相邻」**（零时长题的保底宽度会造出同起点并列的退化区间 ⇒ 假报断点/假重叠），改为**一维区间并集（reach 推进）**；DOM 侧同样对 `[left,right]` 做区间合并。
- 部署（web-only，api 未动）：覆盖前先拉回服务器原件 `diff`（`StudentExamDetail.tsx` **只差副标题一行**，证明线上无第三方改动）；三道关全绿 —— ① md5 三处对齐（`b2323e8a…` / `09333285…`）② grep 计数（新文案 ≥1、旧 `gantt-capped` = 0）③ 构建指纹 BUILD_ID `-XiZ92yf…` → **`qV-89luF6VGN98ISzofIlc`**，chunk 含新文案 =1、旧文案 =0；**④ 从运行中的 web 进程实抓 `/_next/static/chunks/473-8e13aa5007d9452c.js`（HTTP 200 / 45521 bytes）**，新文案 =1、「已剔除空白」=1、旧文案与旧斜纹 id 均 =0。web pid **2580817 → 2581665**（uptime 归零），api pid 2580296 未动；冒烟 `web_root=307 / web_login=200 / api_health=200`；备份 `/root/backups/gantt2-20260923-130406/`。
- 交付物/验收截图：`_gantt_check/g2_real.png`（真实数据）、`g2_full.png`（含空白场景）、`g2_paused.png`（长暂停场景）、`g2_nostart.png`；验证脚本 `_gantt_check/{harness,harness_real}.tsx` + `{shot,measure}.mjs`。
- 观察项（未拍板）：① `apps/web/components/` 下仅 7 个文件纳入 git，`StudentExamDetail.tsx` / `ExamTimeGantt.tsx` / `QuestionStatsTable.tsx` 等**未受版本控制**；② 累计作答轴按「首次作答时刻」排序定位条带，若后端另存「每题最后保存时刻」（`lastSavedAt` / `@updatedAt`）可进一步精确还原跨题穿插的真实区间。

## V2.4.87 (2026-09-23) — 考情明细新增「整场考试时间分配」甘特图
- 需求（用户原话）：「在考试管理的考情分析里的查看明细部分，每个学生的时间统计表下面再加一个统计图：像甘特图一样记录学生整个考试时间里的时间分配情况，哪段时间在做哪道题都能清晰显示出来」。
- 口径推导（关键，非显而易见）：`AnswerRecord.createdAt` = 该题**首次保存作答**的服务端时刻（`POST /sessions/:id/answer` 用 `upsert`，仅 create 分支写 `createdAt`，改答案走 update 分支不刷新）；`AnswerRecord.timeSpent` = 该题**累计停留秒数**。故 **单题作答区间 ≈ [answeredAt − timeSpent, answeredAt]**，配合 `Session.startedAt/submittedAt` 即可还原整场时间分配。
- 后端：`apps/api/src/routes/exams.js` 的 `GET /:id/student/:studentId` 中 `answerRecord` 查询补 `select createdAt`；`perQuestion[]` 新增 `answeredAt`（ISO 8601，无记录为 null）。纯新增字段，向后兼容。契约已同步 `docs/API.md` §6.2。
- 前端：新增独立组件 `apps/web/components/ExamTimeGantt.tsx`（纯手写内联 SVG，**零新依赖**）；`StudentExamDetail.tsx` 在原「每道题做题用时」折线图下方接入。横轴＝开考→交卷，纵轴＝题号（与折线图同序），每条带按对错着色（绿=答对／红=答错／灰=未判分）。
- 边界处理：
  - 未作答题（交卷时 `createMany` 补记录，`timeSpent=null`）→ 不绘条带，行内标注「未作答」。
  - 学生跨题回看导致停留时段重叠 → 按 `answeredAt` 升序排布并把左端夹紧到上一次作答时刻，条带叠**斜纹**表示「显示长度被压缩」（悬停可看真实累计停留）；保证任意两题不同时占用同一时段。
  - `startedAt/submittedAt` 缺失 → 回退用条带极值作横轴；`timeSpent` 早于开考等脏数据 → 左端夹到开考时刻；零时长题 → 保底 1.6 单位可见宽度。
- 验证：`tsc --noEmit` 通过；离线渲染 harness（`react-dom/server` + playwright）5 个场景 + 1 条断言全绿（无 NaN／负宽）；用**线上真实数据**（ESAT 数学1 模考8 / 学生 renjunyu / 27 题）渲染复核，横竖无溢出；带鉴权直打线上接口 `answeredAt` 字段核验 PASS（27/27 题同时具备 `answeredAt` 与 `timeSpent`）。
- 部署：api `cp + pm2 restart api --update-env`（pid 2553391→2580296）；web `npm run build + pm2 restart web`（pid 2554859→2580817，BUILD_ID 含新 chunk 指纹 `gantt-capped`）；三处 md5 与本地一致、grep 计数复核通过、公网 `login=200 / api/health=200`。
- 观察项（未拍板）：① `apps/web/components/StudentExamDetail.tsx` 等组件**未被 git 跟踪**（仅 7 个组件在版本控制内），建议择期 `git add` 收敛；② 真实数据中出现 13/27 条带被压缩，反映学生跨题回看频繁，若要更精确还原可考虑后端另存「每题最后保存时刻」。

## V2.4.86 (2026-09-19) — 考情表悬停弹卡改为屏幕正中央
- 需求:悬停弹卡从「贴题号下方」改为**屏幕正中央**,确保大部分内容可见且不被遮挡。
- 实现:`QuestionStatsTable.tsx` 弹卡定位改为 `top:50% + transform:translateY(-50%)` 垂直居中、水平居中夹在视口内;`max-h` 70vh→80vh 留出更多正文;`z-50`→`z-[1000]` 防止被页面 sticky 头部遮挡;`shadow-xl`→`shadow-2xl` 更醒目。
- 部署:web `npm run build` + `pm2 restart web`(pid 2406901),api 在线(2405866)。

## V2.4.85 (2026-09-19) — 考试管理「每题整体考情」题号悬停弹出题目内容
- 需求：教学管理 → 考试管理 → 某场考试考情页,「每题整体考情」表中鼠标放在**题号**上弹出该题内容卡片(题干+选项,高亮正确答案),移开即消失。
- 实现:
  - 后端 `exams.js` `analyzeExam` 的 `perQuestion` 增加 `stem/options/answer`(仅教师/管理员鉴权接口);`parseOptions` 提升为模块级与单生明细路由共用。
  - 前端新增共享组件 `QuestionStatsTable.tsx`(表格 + 悬停弹卡),`ExamAnalysisView.tsx` 与 `ExamsPanel.tsx` 两处重复表格统一替换。弹卡用 `position:fixed` 贴题号下方、水平夹在视口内,`renderRich` 渲染数学公式,正确答案高亮并标注;120ms 延迟消隐防止跨间隙闪烁;`max-h-[70vh]` 内滚动防长题干溢出。
- 部署:api `pm2 restart api`;web `npm run build` + `pm2 restart web`。

## 数据修正 (2026-09-19) — 模考20 Q11/Q17 答案键修正后的历史作答重判
- 背景:Q17 答案键 E→D 纠错上线后,已有作答记录的 `isCorrect` 仍按旧键存储;陈泓宇(mokuai EXAM session `cmu75irtv0…`)Q11/Q17 两条记录 `selected` 均与新键一致但 `isCorrect=0`。
- 处理:定向重判(仅限本线程校验过的 Q11/Q17 两题;全库扫描出的 788 条「陈旧」多为图片/LaTeX/多陈述答案被离线匹配器误判,已排除不动)。线上核验:两记录 `isCorrect` 已 =1,session `correctCount=score=14/20`,重判状态正确。
- 纵深防御写库脚本 `_db_recon/rescore_q11_q17.py`(双备份+md5 断言+键守卫+幂等+复核),备份 `/root/dbbackups/dev.db.pre-rescore-q11q17-20260919_215755`。

## 数据修正 (2026-09-19) — TMUA P2 模考20 第11题 答案键核对（H→D 实为线上已正确，仅同步本地陈旧副本）
- 来源：用户反馈「第11题好像也有问题」。核验后学生判断正确——正确键是 D（"I and II only"），H（"All three"）错。
- 题面：Portia 三盒逻辑题，三个子问各给结论，判断 I(i答Gold)/II(ii答Lead)/III(iii答Gold) 哪些必真。
- 数学核验（self-referential 真值枚举）：
  - (i) 奖品盒 = Gold（Silver 含奖品时 Lead 消息自相矛盾，仅 Gold 自洽）→ I 真。
  - (ii) 应选 Lead（Gold/Silver 含奖品均致 Lead 消息自相矛盾，仅 Lead 自洽）→ II 真。
  - (iii) 应选 **Lead 非 Gold**：匕首在 Lead 时 G假 S真，L="至多1真" 自相矛盾（L真则共2真⇒假、L假则共1真⇒真，皆矛盾）→ Lead 不自洽排除；自洽情形仅 {Gold,Silver}，故 Lead 恒空、选 Lead 保证安全 → (iii) 答 Lead → **III 假**（原解析漏算 L 自身为真值，误判 Lead 情形"1 真"自洽并错答 Gold）。
  - 正确组合 = I 真 + II 真 + III 假 = "I and II only" = 选项 D。
- **关键发现**：重拉线上库核验，Q11 的 `answer` 早已 = `"I and II only"`（D）、解析 (iii) 段**已正确**（Lead 排除、答 Lead、结论 D），`updatedAt=1788316734777` 与导入时间一致——即**线上生产库本来就是对的**。错的只是本地陈旧副本：`scripts/tmua_p2_mock20_full.json` 与 `scripts/dump_tmua_p2_mock20.txt` 仍写着 H。
- 处理：写库脚本守卫正确识别「answer 已是 D」并跳过（未改动线上库，零风险）。仅把本地 `source JSON` + `dump` 同步为线上正确版本（KEY=D、(iii)=Lead、结论 D），防未来重部署回退。无需 build/重启。

## 数据修正 (2026-09-19) — TMUA P2 模考20 第17题 答案键纠错（E→D）
- 来源：学生反馈「第17题应该选 D」。核验后学生正确。
- 题面：`(n-2)!/(n-2k)! = k!·2^(k-1)`，判断 I(k=2 无解)/II(k=3 唯一解 n=7)/III(k≥4 无解)。
- 数学核验：I 真（k=2: n²−5n+2=0, Δ=17 非平方，无整数解）；II **假**（k=3 方程唯一解是 n=6=24，n=7 得 120≠24，并非 n=7）；III 真（k≥4: LHS 最小 (2k−2)! 远超 k!·2^(k−1) 且随 n 单调增，无解）。正确组合 = I 真 + III 真 = "I and III only" = 选项 D。
- 原错误：答案键误标 E("I and II only")，且解析结论自相矛盾写「答案为 E — I and III only」（E 实为 "I and II only"）。
- 修复：answer `"I and II only"`→`"I and III only"`（选项 D）；解析结论 `答案为 E`→`答案为 D`。纵深防御写库（备份 `/root/dbbackups/dev.db.pre-q17fix-20260919_213419` + md5 一致 → 守卫当前为错误态 → 单事务 UPDATE → 重拉库核验）已上线。同步更新源题库 `scripts/tmua_p2_mock20_full.json`。
- 纯数据层修正，无需 build/重启。学生端刷新即见新键与解析。

## V2.4.84 (2026-09-19) — 速度分公式：中位 ≤ 考试基准封顶 80（不再满分）
- 现象：沿用 V2.4.83 的 `normSpeed`（中位 ≤ 考试基准即 100 满分），因全班 EXAM 每题中位 `min=20/median=68/max=215` 普遍快于 TMUA 180s 基准，约 78% 学生速度分仍 = 100，区分度不足。
- 修复：将速度满分锚点从 100 改为 80 —— `score = clamp(0..80, 80×baseline/median)`。即「中位 ≤ 基准 → 80 分」；「中位 > 基准」按 80×基准/中位 从 80 往下扣（最低 0）。后端 `teacher.js` 的 `speedScore` 与前端 `normSpeed` 兜底同步修改。
- 验证（镜像库离线复算 + 线上签名 JWT 直打）：
  - 离线：有速度分 32 人，新公式 `min=25/median=80/max=80`，=80 占比 78.1%（即原封顶 100 那批，现为 80），慢段 7 人 <80；classBaseline≈75。
  - 线上：袁盛康（median 150≤180）→ 80；刘子瑶（median 215>180）→ 67；classBaseline.speedScore = 76（原 95）。`/api/health` ok。

## 数据修正 (2026-09-19) — TMUA P2 模考20 第10题 LaTeX 显示缺陷
- 现象：用户反馈「TMUA Paper 2 模考20 第10题显示有问题」。
- 根因（数据层坏 LaTeX，非渲染层）：四个选项与解析存在① 函数名 `cos`/`sin` 落在 `$...$` 外（文本字体）而变量在数学（斜体）→ 字体不统一；② `$a^{ln b}$` 的 `ln` 未用 `\ln`；③ 文本/数学混排并夹 Unicode `−`/`≤`/`≥`/`θ`；④ **解析 `$2^{\ln 2}=e^{(\ln 2)^2} \> 1$` 中的 `\>` 是 KaTeX 未定义控制序列 → 该段数学渲染失败**（回退原文/红框）。
- 修复：重写该题四选项与解析，统一进数学模式并规范命令（`$\cos(\sin\theta)=\sin(\cos\theta)$`、`a^{\ln b}`、`|P(x)-\cos x|\le10^{-6}`、`x^{-4}\ge5`），删 `\>`→`>`；同步更新源题库 `scripts/tmua_p2_mock20_full.json` 防回归。**纵深防御写库**（双备份 `/root/dbbackups/dev.db.pre-q10fix-20260919_084743`+`.copy2`、md5 一致 → 字段守卫 → 单事务 UPDATE → post-diff 复核）部署线上 PUBLISHED 试卷。
- 验证：重拉线上库直检 Q10 —— 四选项/解析/answer 均为规范 LaTeX，无 `\>`、无 Unicode `−/≤/≥/θ`、文本模式无裸 `cos(`/`sin(`；本地 `fix_q10_mock20.py` 内容校验同过。
- 登记：`docs/MATH_RENDERING_BUGS.md` 新增 **#33**（数据坏 LaTeX）+ 预防规则 #33 + #33 回归样本（题目数据入库前须过 KaTeX 严格校验、禁 `\>` 等未定义命令与 `$...$` 外裸函数名）。
- 备注：本次为**数据层**修正，未改渲染层/业务代码，无需 `npm run build`/重启；但常规发布窗口应跑 `npm run verify:math` 全库回归确认无连带。

## V2.4.83 (2026-09-19) — 修复「速度」维度被 PRACTICE 占位计时污染（袁盛康异常快）
- 现象：用户反馈「袁盛康速度为什么这么快」。诊断其 speedScore=100，但 EX 模式每题中位 150s（正常），真正异常来自一个 169 题的 MAT **PRACTICE 练习 session（`submittedAt=null` 未交卷）**——前端在 PRACTICE 模式**未采集每题真实用时**，107 题 `timeSpent` 全记成占位值 1 秒，把整体 PRACTICE 中位拉到 1s，`normSpeed=100×180/1` 饱和满分。
- 根因：V2.4.82 改用 PRACTICE 中位作主口径，但 **PRACTICE 计时系统性不可靠**（全库「PRACTICE 中位 ≤3s 且 ≥10 题」的异常 session 共 3 个，涉及 3 名学生），且算法对坏数据零鲁棒性（中位=1 即饱和）。
- 修复（`teacher.js` `matrixOf` 的 `speedScore`）：主口径**切到 EXAM 每题中位**（`timeSpent` 真实可靠）；仅当无 EXAM 数据时回退 PRACTICE 中位，且对 PRACTICE 中位 ≤3s 的占位计时**整段排除**（置 `null`，不参与评分）。前端 `sSpeed/cSpeed` 已优先取后端 `speedScore`，无需改 web。
- 验证：手签 JWT 直打 `/api/teacher/stats/students-matrix` — 袁盛康 `speedScore=100` 基于 EXAM 547 题中位 150s（真快非假象）；PRACTICE 有效中位 108s（脏 session 已排除）；`classBaseline.speedScore=95`（恢复区分度）；`/api/health` ok（api pid 2366515）。
- 待拍板（未动）：`normSpeed` 在 `median≤基准` 时直接 clamp 100，全班 EXAM 中位 `min=20/median=68/max=215`，致 78% 学生速度分仍=100（比 TMUA 180s 基准快），属公式饱和层问题，与数据源无关，需另议。

## V2.4.82 (2026-09-19) — 修复学情分析「速度」班级均值恒为 100
- 现象：学生详情页「维度排行/能力雷达」的速度维度班级均值恒为 100（满分），不可解释。
- 根因：班级基线 `classBaseline.speed` = **全班池化练习中位**（实测 59–60s，混入 ESAT/MAT 快刷题），前端再按考试基准归一 `100×基准/中位`。池化中位远低于考试基准（≈125s），比值 >100 被 clamp 饱和 → 班级均值恒 100；32 名学生中 15 人个人得分同样饱和。
- 修复：
  - 后端 `teacher.js` `matrixOf` 新增 `speedScore`（与前端 normSpeed 同式：练习中位按考试基准折算，clamp 0–100；无练习数据 → `null`）；`classBaseline.speedScore` = **逐生 speedScore 均值**（剔除无数据学生，实测 94），不再「池化中位再归一」。
  - 前端 `students/[id]/page.tsx` 维度排行/雷达的本人与班级速度分优先取后端 `speedScore`（旧响应结构自动回退旧式），并注释禁用「池化中位再归一」口径。
- 验证：手签 JWT 直打 `/api/teacher/stats/students-matrix`，`classBaseline.speedScore=94`，逐生得分正常（如 81s/基准80→99、188.5s/基准180→95）；`tsc --noEmit` 通过；`npm run build` 成功；`/api/health` ok（api pid 2364922 / web pid 2365754）。

## V2.4.81 (2026-08-25) — 模拟考中途退出计时暂停/续时
- 需求：学生端模考试卷点开后中途退出（关标签、切后台、SPA 路由跳走），计时应暂停；再次打开时从剩余时间继续，退出/离线期间的时长不计入。
- 根因（旧实现为墙钟 no-op）：`POST /api/sessions/:id/pause` 把 `deadlineAt` 改写为 `now + remaining`，而 `remaining = 原 deadline − now`，代数上 `now + remaining = 原 deadline`，等于没冻结，重新打开仍按原绝对截止时间算，离线时间被照常扣除；且 SPA 路由跳转（`router.push`）不触发 `pagehide`/`visibilitychange`，暂停从未在「返回首页/后退」时触发。
- 修复：
  - 后端 `pause` 改为清空 `deadlineAt`、仅存 `pausedRemaining`（真冻结）；新增 `POST /api/sessions/:id/resume` 重建绝对截止时间为 `now + remaining`；`deadlineOf` 在 `deadlineAt` 为空但 `pausedRemaining` 有值时按 `now + 剩余` 推算（避免按 startedAt 全时长误判超时）。`POST /sessions` 创建 EXAM 时一并初始化 `pausedRemaining`。
  - 前端：重新打开检测到 `pausedRemaining` 即从 `now + 剩余` 重建截止时间并调用 `resume`；`visibilitychange` 隐藏→暂停、回到前台→恢复；新增卸载副作用兜底 SPA 路由跳走；倒计时在 `pausedRef` 为真时停止 tick，避免后台误触发自动交卷。

## V2.4.80 (2026-08-25) — 修复学生端 TMUA/ESAT 随机组卷题库为空
- 根因：学生端「科目」下拉选择 TMUA/ESAT 时，后端 `/api/sessions`、`/api/papers/student` 直接按 `subject = "TMUA"` 查询，但规范数据库存储为 `subject = "数学"/"物理"` + `sourceType = "TMUA"/"ESAT"`，导致匹配不到题目。
- 修复：新增 `apps/api/src/lib/subject-filter.js`，统一把 TMUA/ESAT 映射为 `sourceType + 兼容 subject` 的 Prisma where；并同步应用到会话组卷、学生自建卷、题库列表查询。

## V2.4.79 (2026-08-24) — 试卷管理新增 TMUA/ESAT 题源筛选
- 教师端「试卷管理」顶部筛选栏新增「题源筛选」:点选多选 TMUA / ESAT,仅显示 sourceType 匹配的试卷;未设置题源的试卷不受影响,可正常显示。

## V2.4.78 (2026-08-24) — 修复 \text{} 内单位被 latexify 误转导致公式裸显
- 根因：`latexify` 在转换简单分式时未保护 `\text{...}` 文本参数，导致 `$18\text{ km/h}$` 中的 `m/h` 被转成 `\frac{m}{h}`，生成的 `\text{ k\frac{m}{h}}` 在 KaTeX text 模式下非法，渲染失败并回退为裸露 LaTeX 源码。
- 修复：`latexify` 先保护 `\text/\mathrm/\operatorname/...` 等文本参数块，转换完成后再原样恢复，确保单位、文字说明不被破坏；同时保留对普通文本中 `x^2`、`3/4` 等 casual math 的自动转换能力。

## V2.4.77 (2026-08-21) — 修复模考末尾无法点击选项
- 根因：`practice/[id]` 答题页用**两套独立时钟**——倒计时 `remaining` 靠 `setTimeout` 每秒自减（显示用），而选项 `disabled` 判定 `expired` 用绝对时间戳 `deadline`。学生切后台时 `setTimeout` 被浏览器节流、`/pause` 只改服务端 `deadlineAt` 未回写本地 `deadline`，两套时钟错位 → `expired` 提前为真、选项被禁用，但倒计时仍显示"还有时间"，表现为"最后 1 分钟点不了选项"。
- 修复：统一以服务端 `deadline` 为唯一时钟，每帧由真实时间推导 `remaining`；`/pause` 暂停时同步回写本地 `deadline`；从后台切回立即按 `deadline` 重新对齐剩余秒数；`expired` 改为 `remaining<=0` 判定，与显示严格同拍；修正头部"限时 X 分钟"重复累加的倒计时计算。

## V2.4.76 (2026-08-12) — 学生注册账号审核流程
- User 模型新增 `status`(PENDING/APPROVED/REJECTED)、`reviewNote`、`reviewedBy`、`reviewedAt` 字段。
- 注册不再直接签发 token:账号进入 PENDING 待审核,需教师审核通过(`APPROVED`)后才能登录使用系统;登录与 `requireAuth` 中间件均对未通过审核的 STUDENT 拦截。
- 教师端「教学管理」新增「注册审核」Tab:展示待审核学生,支持单条/批量「通过」「拒绝」(拒绝=删除账号,邮箱释放可重注册),并显示待审数量角标。
- `GET /teacher/students` 支持 `?status=` 过滤(默认 APPROVED);作业分发/考试分发仅可向已通过审核的学生布置。
- 存量学生账号通过一次性脚本刷为 APPROVED,演示账号直接置 APPROVED。

## V2.4.75 (2026-08-12) — 题库管理页支持点选翻页
- 教师端「题库管理」(`/teacher`) 接入后端 `/questions` 分页(每页 50 题)。
- 列表下方新增分页控件:首页/上一页/页码窗口(±2,两端 … 省略)/下一页/末页;切换筛选、搜索、排序或学科 Tab 时自动回到第 1 页。
- 删除/审核导致题数减少、页码越界时自动回退到最后一页,避免整页空白。

## V2.4.74 (2026-08-11) — 修复 SMC 导入报错：paperFromFilename 常量赋值
- `import-pdf.js` 修复 `paperFromFilename` 中 `const f` 被重新赋值的运行时报错。

## V2.4.73 (2026-08-11) — 修复 SMC PDF 导入失败：视觉模型选项识别 + 前端超时
- `vision.js` 提示词增加 SMC/短选项卷横向选项识别规则,避免只返回 A/B/C/D/E 字母。
- `import-pdf.js` 对 SMC 单页识别(`maxPagesPerCall=1`)、放宽纯字母选项过滤(保留待审),卷名清洗去掉"相关真题"。
- 教师端导入轮询超时从 5 分钟延长至 15 分钟。

## V2.4.72 (2026-08-11) — 支持 SMC 题源导入 + 清理 SMC 脏数据

- **核心修复**:SMC(Senior Maths Challenge)之前不在题源白名单,导致导入后题目 `subject="SMC"`(非法科目)、`sourceType` 全空、卷名带"题目1"——在题库按"SMC 题源"筛选找不到,表现为"导入失败"。
- import-pdf.js:把 SMC 纳入 `SOURCE_TYPE_NAMES` / `sourceTypeFromFilename` / `MATH_SOURCE_TYPES`;文件名 `SMC_*.pdf` 可识别题源;导入后 `sourceType=SMC`、`subject` 自动兜底"数学"。
- `paperFromFilename`:剥离"题目N"分卷序号,避免同一套真题被拆成多卷、卷名带奇怪序号。
- questions.js / me.js:单题图片识别与批量导入的题源归一正则加入 SMC;knowledgeSubjectsFor 加 `SMC→数学`。
- 前端:题源预设(DEFAULT_SOURCE_TYPES)与教师组卷题源下拉加入 SMC。
- **数据清理**:删除本次错误导入的 111 条 `subject="SMC"` 脏题及其生成的空卷(清理前已备份)。

## V2.4.71 (2026-08-11) — 教师端学情统计:查看每个学生的做题情况(考试 + 练习)
- 教师端「教学管理 → 学情统计」点击学生进入详情页,新增"做题情况(考试 + 练习)"表,覆盖需求:来源(试卷名/科目/题源)、类型(模拟考/练习 + 作业/自主标签)、完成时间、完成用时、得分、正确率。
- 后端 `GET /teacher/students/:id/stats` 的 session 返回扩展:`paper`(title/subject/sourceType/mode)、`assignmentId`(区分作业 vs 自主练习),并新增计算字段 `durationSec`(完成用时 = submittedAt−startedAt)、`status`(DONE/IN_PROGRESS)。
- 前端补全:完成时间改用 `submittedAt`(原误用 startedAt);完成用时格式化"X分Y秒"(进行中会话显示"进行中");按 mode 提供全部/模拟考/自主练习筛选。
- 说明:本期聚焦学科(Session)做题情况;语言(雅思等)做题明细暂无教师查学生接口,留待后续补充。

## V2.4.70 (2026-08-11) — 防线一:数据安全(自动备份 + 恢复演练 + 部署先备份)
- 新增 `scripts/backup_db.cjs`:每日热备 SQLite(先 `wal_checkpoint(TRUNCATE)` 合并 WAL 再复制主库,在线一致性快照、无需停服);多版本保留 daily(最近7)/ weekly(每周一保留4)/ monthly(每月1号保留3),写入 `/root/backups` 并记 `backup.log`。预留 `BACKUP_RCLONE` 环境变量支持异地同步(配了 rclone 远程即自动上传)。
- 新增 `scripts/restore_db.sh`:恢复演练,把备份还原到临时库并校验核心表(User/Question/Session/LanguagePaper/FavoriteQuestion/WrongBook)行数,不覆盖生产。
- 新增 `scripts/deploy.sh`:固化部署流程,**部署前先备份数据库**再 pull/build/restart,满足"更新维护中不丢数据"。
- 服务器注册 crontab 每日 03:17 自动备份。
- 整站数据(用户/题库/试卷/作答/错题/收藏)现具备每日多版本备份与可演练恢复能力。

## V2.4.69 (2026-08-11) — 修复语言学习页试卷卡片高度不统一
- 问题:`grid gap-3 md:grid-cols-2` 默认行高由内容决定,标题行数不同会导致同一行左右两张卡片高度不一致(截图所示)。
- 修复:grid 加 `auto-rows-fr`,卡片按钮加 `h-full`,使同一行轨道高度取最高卡片,所有卡片填满轨道,边框对齐。

## V2.4.68 (2026-08-11) — 学生端语言学习按听说读写分类展示
- 语言学习页 `/app/language` 由「考试类型 + 技能」两个下拉筛选、默认平铺列表,改为以听说读写(听力/阅读/写作/口语)四大分类区块为主导航展示;全真连考(FULL)单独成块。
- 每个分类区块标题带数量徽标,区块内列出该 skill 的试卷卡片;顶部保留「考试类型」筛选作为辅助过滤。
- 试卷卡片去掉冗余的 skill 标签(区块已标明),保留考试类型 + 原版/组卷标识。

## V2.4.67 (2026-08-11) — 修复笔试练习点击卷子报 "Application error" 客户端崩溃
- 根因:答题页 `app/practice/[id]/page.tsx` 的 `detailItems`(useMemo) 被放在 `if (loading) return` 提前 return 之后,违反 React Hooks 规则。首屏 loading=true 提前返回(少调用一次 hook),useEffect 拿到数据后 loading=false 二次渲染多调用一次 useMemo,触发 "Rendered more hooks than during the previous render" 崩溃。该 useMemo 在 V2.4.61(交卷错题回顾)引入,故每次打开答题页必崩。
- 修复:将 `detailItems` 的 useMemo 移到所有提前 return 之前,保证每次渲染 hook 调用顺序一致。

## V2.4.66 (2026-08-11) — 题库编辑题源支持自定义输入
- 题库编辑(题目弹窗 QuestionEditModal 与老师题库页内联编辑)的「题源(考试类型)」由固定下拉改为可输入输入框 + datalist 提示,老师可自由输入任意题源(如以前缺失的 MAT / 新题源)。
- 新增后端接口 GET /api/questions/source-types 返回题库中已存在的题源(去重),前端 datalist 合并预设(TMUA/ESAT/NSAA/MAT/BMAT/STEP/PAT/ENGAA)自动补全,历史导入题源也会出现在候选里。

## V2.4.65 (2026-08-10) — 修复 MAT 选项正文首字母 A/C 被视觉模型误删
- 根因:vision.js prompt 要求 options 去掉选项标号前缀,但模型过度清洗,把题干中图形编号 A/B/C/D 也当标号删了;导致选项 A/C 首字母丢失,answer 也随之错误。
- 修复:细化 SYSTEM_PROMPT,明确只去掉 "A."/"A)"/"A " 标准标号,不要删除正文本身开头的单个字母 A/B/C/D;并给出 "A and D..." 示例。
- 数据修复:题目 id `cmsnb84ej006cbicc15dn5mie`(MAT curve sketch)options 与 answer 已回填正确值;扫描同卷/同批其他 MAT 题未发现同类问题。

## V2.4.64 (2026-08-10) — 修复 MAT 批量导入后学科(subject)为空导致试卷不可见
- 根因:PDF 导入时视觉模型把 MAT 题的 subject 误读成题源词(归到 sourceType),学科 subject 因此为空;`unifyFileMeta` 仅对 TMUA 兜底为"数学",MAT/BMAT/STEP/PAT/ENGAA 无兜底,导致题与试卷 subject 为空。
- 后果:老师端试卷列表按 subject 过滤,MAT 卷(subject 空)不出现在"数学"分类下,看似"导入失败"。
- 修复:`import-pdf.js` 给纯数学类题源(TMUA/MAT/STEP/BMAT/PAT/ENGAA)统一兜底 subject="数学";`questions.js` 导入行补同等兜底(覆盖粘贴导入路径)。
- 数据回填:已导入的 168 道 MAT 题与「MAT 2007 2023 MC Questions」卷 subject 回填为"数学",并修正该卷 sourceKey。

## V2.4.63 (2026-08-10) — 修复「我的作业」紧急区与待完成区重复
- 紧急区(24 小时内截止)已单独成区展示;笔试/语言「待完成」区改为只展示**非紧急**作业,剔除已出现在紧急区的作业,避免重复出现。
- 删除不再使用的 subjectUrgent / langUrgent 派生变量。

## V2.4.62 (2026-08-10) — 优化「我的作业」布局顺序
- 待完成作业(笔试 + 语言)统一前置,所有「往期表现」表格统一后置。
- 原布局为笔试(待完成+往期)/ 语言(待完成+往期)交错;现改为「待完成区」与「往期表现区」两大块,层级更清晰。

## V2.4.61 (2026-08-10) — 修复交卷错题回顾/逐题可能出现的重复题目
- 前端成绩页按 questionId 去重 detail.details(错题回顾与逐题统一去重,杜绝同一题重复渲染)
- 后端笔试 submit:questionIds 去重后再补齐未答/判分;GET /sessions/:id 按 questionId 去重记录
- 后端语言 submit/GET 详情同样按 questionId 去重(防御性)

## V2.4.60 (2026-08-10) — 「我的作业」按笔试/语言分区展示 + 语言作业从语言成长移回

- 用户放弃弹层/展开方案,要求恢复**最早的长条状**(竖列小圆点),并整体缩小。
- 实现:去掉 color/size 展开面板与遮罩;颜色改为**工具栏内单列常驻竖条**(12 色小圆点 h-5 w-5,点选即用);粗细改为**单列 3 档预览线**(细/中/粗);工具栏固定窄宽(~58px),居中高度按竖条工具栏估算。
- 全部 flex 纵向排列,无 grid/无弹出层,在目标设备上必然正常渲染。

## V2.4.50 (2026-08-10) — 内嵌面板改用 flex-wrap(iPad grid-cols 不生效)

- V2.4.49 内嵌面板里又用了 `grid grid-cols-4`,触发与早期相同的 iPad Safari grid 渲染坑——色块未按 4 列展开。改为已验证的 **`flex flex-wrap gap-1.5`**;粗细预设也改 `flex gap-1 + flex-1`。
- 教训:**确认 iPad Safari 不支持 grid-cols-* 时,该设备全部布局用 flex/flex-wrap,不要再用 grid。**

## V2.4.49 (2026-08-10) — 颜色/粗细改为工具栏内展开(彻底抛弃弹出层)

- 该设备上颜色弹窗(独立层/absolute/Portal/fixed 多种方案)反复异常。这次走最稳方案:**颜色和粗细直接展开在工具栏内部**(纯 flex 流式),彻底没有弹出层。
- 工具栏宽度自适应:关闭 ~58px,展开颜色 ~174px、展开粗细 ~204px;展开时自动左移 `Math.min(tpos.x, innerWidth - width - 8)` 避免右侧出屏。
- 移除:Portal/use/position state、按钮 refs、两个 layoutEffect 与createPortal 调用。

## V2.4.48 (2026-08-10) — 学生题目收藏 + 我的原创题 + 教师原创题审核

- **题目收藏**:做题页每题右上角「☆ 收藏/★ 已收藏」;学生端新增「⭐ 题目收藏」页(`/app/favorites`),收藏题含答案/解析供查阅,可移除收藏。新表 `FavoriteQuestion`。
- **我的原创题**:学生端新增「✏️ 我的原创题」页(`/app/my-questions`,与题目收藏并列入口卡片):
  - 新建题目表单(科目/知识点/难度/题干/选项/答案/解析),题干框**直接粘贴截图**走图片识别自动预填(`POST /me/questions/import-image`);
  - 草稿(DRAFT)→ 勾选**批量提交审核**(PENDING_REVIEW)→ 老师通过(PUBLISHED 入库)/驳回(REJECTED 带原因);可编辑/删除草稿。
- **学生原创题审核**(教师端新页面 `/teacher/student-questions` + 导航):列表标注**出题学生姓名/邮箱**(题源=「学生原创题」,永久标记),三态 Tab(待审核/已入库/已驳回),支持**批量通过入库 / 批量驳回(原因)**,单题通过/驳回,可展开答案与解析。
- 后端:`me.js` 收藏 CRUD + 原创题 CRUD/图片识别/批量提交;`teacher.js` 审核列表/单题与批量通过驳回。
- 需 `prisma db push`(新表 FavoriteQuestion)+ `prisma generate`。

## V2.4.47 (2026-08-10) — 弹窗改用 React Portal 挂到 document.body(彻底脱离 toolbar)

- 弹窗改用 `createPortal` 挂到 `document.body` 上,直接用按钮 `getBoundingClientRect()` 计算 viewport 像素位置(fixed+inline left/top),**完全脱离** toolbar 的 backdrop-filter 包含块与 stacking context,iOS Safari 上宽度/位置渲染异常被绕开。
- 颜色 `width:160`、粗细 `width:192`,换边阈值 240(按钮 r.left<240 则显示在按钮右侧,否则左侧)。

## V2.4.46 (2026-08-10) — 弹窗宽度用内联 style 写死(绕过 iOS backdrop-filter 渲染坑)

- 上一版颜色弹窗仍窄只显 1 色圈:iPad Safari 上 `backdrop-filter` 创建包含块导致 absolute 子元素 width 被压成内容宽度。
- 修复:颜色/粗细弹窗宽度改为 **内联 `style={{ width: 160/192 }}`** 直接写死像素值,绕过 Tailwind 编译与 iOS 渲染坑,稳态 4×3 显示;两侧换边阈值统一为 240。

## V2.4.45 (2026-08-10) — 颜色弹窗改用 flex-wrap 强制 4×3 布局

- 上一版 `grid grid-cols-4` 在某些环境未生效导致一列竖排,改为 **`flex flex-wrap gap-1.5`** + 固定 28px 色圈,自动每行 4 个、共 3 行,与 grid 无关更稳;弹窗加宽到 `w-40`、色圈加大到 28px,更舒展易点。

## V2.4.44 (2026-08-10) — 修复颜色/粗细弹窗显示错位

- 修复弹窗显示问题:
  - **颜色网格溢出错位**:4 个 28px 色圈+间距=130px 超出弹窗内容宽 128px,改为 24px 色圈+4px 间距(108px 正好放下);
  - **定位更稳**:去掉 `-translate-y-1/2` 变换(与 backdrop-blur 叠加在 iOS 易渲染异常),改为顶对齐;
  - **弹窗智能换边**:工具栏在屏幕左侧时弹窗自动显示在工具栏右侧,不再出屏;
  - 弹窗去掉毛玻璃(纯白底),避免 iOS backdrop-filter 渲染问题。

## V2.4.43 (2026-08-10) — 颜色弹窗改小(四列一行共三行小圆点)

- 颜色弹窗收窄为**小长方形**:每行 4 个小色圈、共 3 行(12 色),色圈与间距缩小,标题更精简。

## V2.4.42 (2026-08-10) — 书写板颜色/粗细改为弹窗选择

- **颜色**:工具栏改为醒目「调色板」图标按钮(角上带当前色小圆点),点击弹出**小窗口选色**——12 色 4×3 网格,选中色描边+对勾,点外部关闭;
- **粗细**:改为醒目「笔尖线」图标按钮(图标线条粗细即当前笔尖粗细),点击弹出**小拖动条**(滑块 1–14px,步进 0.5)+ 实时粗细预览线 + 细/中/粗快捷按钮;
- 工具栏更精简(颜色/粗细不再常驻,点开即选),默认居中估算高度同步调整。

## V2.4.41 (2026-08-10) — 修复 iPad 书写时屏幕被拖动(滚动)

- 根因:触屏书写时,浏览器把手指拖动当成滚动/拉动(部分 iOS Safari 对 `touch-action` 支持不稳定)。
- 修复(多重防护):
  - 画布内联 `touch-action: none` + `user-select: none` + 禁止触摸呼出菜单,容器与工具栏同样 `touch-action: none`;
  - 书写打开期间锁定文档级 `overscroll-behavior: none`(防回弹/下拉刷新);
  - 原生**非被动** `touchstart/touchmove` 拦截 preventDefault 兜底,彻底阻止页面滚动(仅作用于画布,浏览模式下画布事件穿透,页面仍可正常滚动)。

## V2.4.40 (2026-08-10) — 画笔轻点穿透点击 + 颜色/粗细重新设计

- **画笔/橡皮模式下轻点仍可点击**:按下先记录起点不书写,移动超过阈值(5px)才落笔;轻点(无拖动)自动把点击**转发给下层元素**(选答案、切题、点题号照常可用),拖动书写互不干扰;
- **颜色更多更清晰**:8 色 2×4 网格(黑/深灰/蓝/绿/红/橙/紫/粉),选中色带描边+白色对勾;
- **粗细更直观**:用「预览线」表示笔触(细/中/粗 三条由细到粗的线),选中高亮。
- 保留:完全透明、可拖动工具栏、浏览穿透、不保存、不判分。

## V2.4.39 (2026-08-10) — 修复书写板崩溃 + 工具栏可拖动/右侧居中

- **修复 "Application error" 客户端异常**(写一会后崩溃):重写书写板健壮性——
  - `setPointerCapture` 异常捕获、`pointercancel` 兜底,绘制不再因指针异常崩溃;
  - 画布 resize 只监听打开/窗口变化,**不再随每次笔画重建**(原先 redraw 随 strokes 变化导致 effect 连锁);
  - stroke 用 ref 同步,`redraw` 稳定;坐标/画布/上下文全量 null 防御。
- **工具栏改为可拖动**:固定定位,顶部把手(三点)按住可拖到任意位置,默认**右侧垂直居中**;不再依赖绝对定位,避免出现到屏幕左侧的问题。
- 保留:完全透明、右侧竖排精致工具栏、👁 浏览穿透、不保存、不判分。

## V2.4.38 (2026-08-10) — 批注层完全透明 + 工具栏精致化

- 按需求优化书写板体验:
  - **书写板完全透明**:不再有半透明白色纸面,题目完全清晰,笔迹直接写在题上;
  - **工具栏精致竖排右侧**:白色玻璃质感(毛玻璃+柔和阴影+圆角),使用 **SVG 线性图标**(浏览/画笔/橡皮/撤销/清空/收起)替代 emoji,颜色圆点带选中描边,笔触用大小圆点直观表示;
  - 保留「👁 浏览」点击穿透、不保存、不参与判分。

## V2.4.37 (2026-08-10) — 书写板改为半透明批注层(叠题+右侧竖排工具栏+浏览穿透)

- 按需求重做书写板交互:
  - **半透明纸面叠在题目上方直接批注**(不再全屏白纸挡住题目);
  - **工具栏竖排在屏幕右侧**(上→下:👆浏览 / ✏️画笔 / 🧽橡皮 / 四色 / 粗细 / ↩️撤销 / 🗑️清空 / ✕收起);
  - **「👆 浏览」模式**:整层点击穿透,可正常答题、切题、点题号,不影响做题界面其他任何功能;书写/橡皮模式才捕获笔迹;
  - **不保存**:收起即清空,每次打开为空白批注纸;
  - 批注时禁 ←/→ 切题,浏览模式下恢复。
- 更新 `components/ScratchPad.tsx` 与做题页集成。

## V2.4.36 (2026-08-10) — 学生做题界面新增手写书写板(类似 Notability)

- 做题页新增右下角浮动「✍️ 书写」按钮,点击打开**全屏手写草稿纸**(Canvas 画布,半透明纸面):
  - 工具栏:画笔 / 橡皮 / 黑蓝红绿四色 / 粗细(细中粗) / 撤销上一步 / 清空全部 / ✕ 收起;
  - 书写不参与判分;「✕ 收起」可查看题目,再次打开草稿保留;
  - 草稿按会话存 sessionStorage,切题/刷新不丢失;
  - 书写板打开时禁用 ←→ 键切题,防止误操作。
- 新增可复用组件 `components/ScratchPad.tsx`(pointer 事件手写,DPR 高清适配)。

## V2.4.35 (2026-08-10) — 试卷库套卷可收藏到「我的试卷」

- 学生端试卷库每张卡片新增「**＋ 加入我的试卷**」按钮：把套卷收藏到「我的试卷」生成个人副本(origin=STUDENT)，同一套卷每人只能收藏一次(显示「✓ 已收藏」)；「我的试卷」里的收藏卷带「收藏」标记，可开始/删除。
- 后端:新增 `POST /api/papers/mine/collect`(校验卷可作答、非学生卷、防重复，sourceKey=`collect:<paperId>:<studentId>` 作唯一键);`GET /papers/mine` 返回 `collectedFrom`(原卷 id)。

## V2.4.34 (2026-08-10) — 错题组卷支持按知识点多选

- 学生组卷弹窗「错题组卷」新增**按知识点筛选(可多选)**：错题本知识点以彩色标签展示(含各知识点错题数),可多选/清空,只从所选知识点的错题中组卷;不选则全部错题。
- 后端:新增 `GET /api/me/wrongbook/topics`(错题本知识点汇总);`POST /papers/student` 错题组卷支持 `topics[]` 过滤(匹配题的主知识点或 topicIds 关联知识点名)。

## V2.4.33 (2026-08-10) — 学生自建试卷(我的试卷):随机组卷 / 错题组卷

- 学生端首页新增「**我的试卷(仅自己可见)**」区块 + 「+ 组卷」弹窗:
  - **随机组卷**:按 科目/知识点/难度/题量 从题库已发布题目随机抽取;
  - **错题组卷**:从自己的错题本(已发布题目)中组卷,支持按科目筛选与题量(含「全部错题」);
  - 支持 练习 / 模拟考(自定义时长) 两种模式,生成后存到「我的试卷」,可随时开始、删除。
- 数据:Paper 新增 `createdBy`(学生自建卷 origin=STUDENT);共享卷库(教师/学生)排除学生自建卷;
  - `GET /api/papers/mine`、`POST /api/papers/student`、`DELETE /api/papers/mine/:id`;
  - 启动试卷时校验:学生自建卷仅创建者本人可作答,普通卷需 READY。
- 需 `prisma db push` + `prisma generate`(部署脚本已含)。验证:tsc/node --check 通过;部署后学生端出现「我的试卷」。

## V2.4.32 (2026-08-10) — 学生端模拟考时长可自由输入

- 学生端「笔试练习 → 模拟考(随机组卷)」的时长从下拉(25/40/60 分钟)改为**自由输入数字**(分钟),后端本就支持任意正整数;未填时长时提示"请填写时长"。

## V2.4.31 (2026-08-10) — 考情分析改点选考试卡片

- 考情分析的考试选择从下拉框改为**点选卡片**：每张卡片显示考试名称、**发布时间**（默认按从近到远排序）、**参考人数**(已交/应考)、**平均成绩**(平均正确率)，选中卡片高亮「查看中」。
- 后端 `GET /api/exams` 列表补充每场考试的平均正确率/平均分（基于已提交会话汇总）。

## V2.4.30 (2026-08-10) — 考试管理并入「教学管理」成为子模块

- 教师端顶层导航移除「考试管理」;考试管理改为**教学管理(原学生管理)下的第三个子模块**,与「学情统计 / 作业分发」同级并列。
- 考试管理内容抽为可复用组件 `components/ExamsPanel.tsx`(内部仍分「考试安排 / 考情分析」);教学管理页新增「考试管理」Tab;`/teacher/exams` 保留为薄包装页。

## V2.4.29 (2026-08-10) — 教师端「学生管理」更名「教学管理」

- 教师端大模块导航「学生管理」→「教学管理」(路由 `/teacher/students` 不变),页面标题同步更新。

## V2.4.28 (2026-08-10) — 新增考试管理模块(考试安排 + 考情分析)

- **考试管理**(导航新增,独立于学生管理):复用 `Assignment`(mode=EXAM),学生端入口与模考计时不变。
  - **考试安排**:新建考试(仅可选「可作答 READY」考卷 + 勾选考生 + 名称/备注/DDL)、考试列表(完成进度)、删除。
  - **考情分析**:选择考试后展示——整体概览(考生数/已交/平均正确率)、每考生考试结果(得分/正确率/状态/起止时间)、每题整体考情(题号/知识点/难度/作答/答对/正确率)、**给老师的建议**(规则自动生成:薄弱知识点/低正确率题目/落后学生;另有「AI 生成教学建议」按钮,基于 LLM 输出)。
- **学生管理**:原「作业/考试分发」改为**「作业分发」**,仅展示与布置练习(PRACTICE),考试相关操作收口到考试管理;后端 `GET /teacher/assignments` 支持 `?mode=` 过滤,`POST` 尊重显式 mode。
- 后端:`app.js` 挂载 `/api/exams`;`routes/exams.js`(列表/安排/删除/考情分析/AI 建议)。
- 验证:`node --check` / `tsc --noEmit` 通过;部署后教师端出现「考试管理」入口。

## V2.4.27 (2026-08-10) — 修复导入题目丢失题源标签(TMUA/ESAT/NSAA)

- **根因**:`finalizeRow` 透传字段里没有 `sourceType`,导致所有 PDF/Excel/Word 导入的题目在收尾步骤丢掉题源标签(JSON 粘贴导入不走 finalizeRow,所以有标签)。
- **修复**:
  - `finalizeRow` 补上 `sourceType` 透传;
  - Excel 字段别名增加「题源 / sourceType」;
  - `importRows` 把 `subject=TMUA` 等题源词自动归到 `sourceType`,科目落为中文(数学)。
- **存量数据**:`fix_sourcetype.cjs` 按 `paper/source/subject` 文本推导回填——题目 **295 条**(TMUA 276 / NSAA 19)、试卷 **16 张**。
- 验证:`node --check` 通过;线上题库管理列表的 TMUA/NSAA 标签已恢复。

## V2.4.26 (2026-08-10) — 题库管理新增「图片识别录入」单题

- 在题库管理「+ 新建题目」旁新增独立的 **「📷 图片识别」** 入口(绿色描边按钮,与手工新建明显区分)。
- 弹窗提供**详细使用提示**(粘贴/上传单题图片 → 可选科目辅助 → 开始识别 → 打开编辑窗核对 → 保存入库)。
- 后端新增 `POST /api/questions/import-image`(需视觉模型):base64 图片 → 视觉模型识别单题 → 科目/选项清洗、答案字母→选项文本对齐(`alignAnswerToOptions`),返回题目字段。
- 识别成功后预填「新建题目」表单(默认待审核),核对后点保存即入库;未配置视觉模型时给出明确提示。
- 验证:`node --check` / `tsc --noEmit` 通过;部署后题库管理出现「图片识别」按钮,接口返回识别结果。

## V2.4.25 (2026-08-10) — 编辑本题改为试卷页原地弹窗(不再跳转)

- 试卷组卷 → 查看套题的浏览窗口里,点「编辑本题」不再跳转题库管理页,而是**直接在当前窗口弹出题目编辑弹窗**。
- 新增可复用组件 `components/QuestionEditModal.tsx`(题干/选项/答案/解析/科目/题源/套题名/知识点多选/难度/状态,支持图片上传与截图粘贴);保存后刷新本地试卷详情。
- 编辑弹窗按题目 id 拉取该题(`GET /questions/:id`)填充,不受题库分页影响。
- 验证:`tsc --noEmit` 通过;部署后点「编辑本题」原地弹窗、保存后窗口内即时更新。

## V2.4.24 (2026-08-10) — 试卷详情:点选项直接改答案(带美观二次确认) + 编辑本题跳转修复

- 试卷组卷 → 查看套题的题目浏览窗口里,每道题的选项行现在**可点击**:点击某选项即弹出「修改本题答案」确认弹窗(居中卡片、渐变标题、展示题干/新答案/原答案),确认后调用 `PUT /questions/:id { answer }` 把该选项设为答案,即时生效并刷新高亮。
- **修复**:点「编辑本题」跳转题库管理后编辑弹窗未自动打开——根因是题库列表分页(`pageSize=50`),目标题不在前 50 条时 `list.find` 失败。现改为:列表未命中时按 id 调用 `GET /questions/:id` 直接拉取并打开编辑弹窗。
- 验证:`tsc --noEmit` 通过;部署后点选项可弹确认框改答案,点「编辑本题」一定打开编辑弹窗。

## V2.4.23 (2026-08-10) — 试卷组卷详情:每题「编辑本题」+ 直接点选改难度

- 试卷组卷 → 点某套卷子的「查看」,弹出的题目浏览窗口里,每道题右侧操作列(自上而下):
  1. **移出本卷**(原有);
  2. **编辑本题**:点击跳转「题库管理」并自动打开该题的完整编辑弹窗(`/teacher?edit=<id>`,复用题干/选项/答案/解析/难度表单);
  3. **1–5 星难度点选**:点击某颗星立即把该题难度改成对应星级(调 `PUT /questions/:id { difficulty }`,即时生效并刷新)。
- 验证:`tsc --noEmit` 通过;部署后试卷详情每题的「移出本卷」下方出现「编辑本题」与星级控件。

## V2.4.22 (2026-08-10) — 题库题目删除功能(教师可用)

- 后端 `DELETE /api/questions/:id` 由「仅 ADMIN」放开为「**教师/管理员**」;删除时**联动清理**该题的作答记录(AnswerRecord)、错题本条目(WrongBook),并从所有试卷的 `questionIds` 中移除该题引用,最后物理删除并重算受影响试卷状态,避免 FK 报错与悬空引用。
- 前端「题库管理」列表的删除按钮对**教师/管理员**均可见;确认弹窗说明将一并删除作答记录与错题本数据。
- 验证:`node --check` 与 `tsc --noEmit` 通过;部署后教师角色可删除题目。

## V2.4.21 (2026-08-10) — 题库导入修复:答案与选项对齐 + 漏题检测增强

**问题1:导入的题目答案经常错误**
- 根因:入库时选项经过 `cleanUnits`/`cleanOptionPrefix` 清洗,但 `answer` 没有同样清洗,导致 `answer` 与选项文本不一致(如 `$20\,\mathrm{J}$` vs `20 J`、`m\,s^{-1}` vs `m s⁻¹`),而判分是 `a===s` 全等比对,必然判错;另有一部分答案仍存成字母 A-H。
- 修复:`parse-import-file.js` 新增 `looseNorm` + `alignAnswerToOptions`;`importRows` 入库前把 answer 与清洗后的选项**强制对齐**(字母→选项文本、多选字母映射、LaTeX/单位/前缀差异→选项精确文本、无法对齐置空交教师审核),并让选项存储走同一套清洗。
- 存量数据:`repair_answers.cjs` 全量对齐(修复 22 题,含 TMUA 2021 P1 全部 20 个字母答案;清空 2 题交审核)。

**问题2:20 题只识别出 15 题**
- 根因:视觉模型偶发漏题/并题(把一页多题的选项合并进一行,NSAA 出现 24 选项的假行);此前仅打日志,未向用户外显。
- 修复:`parsePdf` 返回 `{rows, meta}` 并**剔除疑似并题/选项提取失败的行**(选项>8 或纯字母选项);导入结果消息新增**漏题预警**(题目页数/答案文件题数 vs 识别题数交叉校验、并题跳过计数),教师可立即看到"疑似漏题,建议核对原卷重导";`vision.js` 提示词增加"一页多题必须逐题输出、严禁合并选项、不要漏题"规则。
- 注意:NSAA Physics 2020 已导入的 15 题无法自动补回丢失的 5 题,需教师重传该 PDF 重新导入。

- 验证:4 个 api 文件 `node --check` 通过;存量答案对齐后 NSAA noMatch 由 4→0。

## V2.4.20 (2026-08-10) — 学生端模块重命名:刷题练习 → 笔试练习

- 学生端顶部导航「刷题练习」改为「笔试练习」(`apps/web/app/app/layout.tsx` 导航标签,路由 `/app` 不变),与「语言学习 / 冒险模式 / 面试练习」并列。
- 教师端「刷题次数」统计与平台 SEO 描述等非模块名文案保持不变。
- 验证:`tsc --noEmit` 通过;部署后学生端导航显示「笔试练习」,登录页版本 v2.4.20。

## V2.4.19 (2026-08-10) — 学情分析四项体验改进

- 成长图谱·正确率变化轨迹:新增**图例**,标明每条折线的含义(总体正确率 + 各科正确率,均为累计值),悬停提示也带上线名。
- 成就&高光时刻:**高光时刻改为可折叠**,点击「🌟 高光时刻 (N)」按钮展开/收起,普通成就保持时间轴展示。
- 难度表现(1–5 星):固定展示 1–5 星全部难度,**即使没有作答也显示 0%** 柱,不再缺项;数据为空时也完整呈现五个星级。
- 知识点掌握度雷达图:**放大**到 380px 高度、轴标签字号 13、外圈 80%,并限制展示练习最多的前 10 个知识点,保证每个项目清晰可读。
- 验证:`tsc --noEmit` 通过;部署后 `/app/space` 学情分析页各项生效。

## V2.4.18 (2026-08-10) — 学情分析新增「成长图谱」(阶段性表现变化 + 成就高光 + 成长教练)

- 学情分析板块新增**成长图谱**,把分散的练习/模考/冒险/错题数据串成一条可视化的成长主线:
  1. **正确率变化轨迹**(成长折线图):基于 `answerRecord.createdAt` 按周(跨度≤12 周)/月分桶,绘制**累计正确率**随时间变化的折线——总体一条粗线 + 各科目一条细线,直观看到每个阶段的进步。
  2. **成就 & 高光时刻时间轴**:从真实数据派生每一个值得记住的节点——学习启程、首战模考、满分一战、正确率突破 60/70/80/90%、学科突破(累计≥80%)、知识点逆袭(早期<50%→近 30 天≥75%)、冒险通关、连击大师(最高连击≥10)、攻克首道错题、连续打卡(≥3 天)、按时交作业;高光节点用金色高亮。
  3. **成长教练**:结合整体趋势(上升/回落/高位/平稳)、正确率与近期高光,生成**鼓励语**;并基于薄弱知识点、高难度短板、模考 vs 练习差距、模考次数、冒险进度、打卡节奏等给出最多 4 条**针对性建议**。
- 后端:新增 `GET /api/me/growth`(挂载于 `/api/me`,单次查询 answerRecord/session/roguelikeRun/wrongBook/assignmentStudent 五类数据,纯计算、无新表、无迁移,成就/高光由数据**实时派生**);`app.js` 注册 `growthRouter`。
- 前端:`lib/types.ts` 增加 `GrowthData/GrowthPoint/Milestone/Coach` 类型;`app/space/page.tsx` 学情分析 Tab 顶部新增成长图谱板块(复用 recharts 折线图 + 时间轴 + 渐变教练卡),空数据与无作答场景均已兜底。
- 验证:`tsc --noEmit` 通过;部署后 `/me/growth` 返回 points/milestones/coach/summary。

## V2.4.17 (2026-08-09) — 个人空间「薄弱知识点」升级为「学情分析」(多维学业表现)

- 顶部 Tab「薄弱知识点」(🎯) 改为「学情分析」(📊),从单一知识点维度扩展为**多维度学业表现分析**。
- 后端 `GET /me/stats` 扩展聚合维度:在 `answerRecord` 查询中 `include` 题目的 `subject`/`difficulty` 与所属 `session.mode`,新增 `bySubject`(按科目正确率)、`byMode`(练习/模考正确率)、`byDifficulty`(1–5 星难度正确率)、`overallRate`(总体正确率)、`correctAnswered`;前端 `StatsData` 类型同步扩展。
- 学情分析页内容:
  1. 总览指标卡(总答题数 / 总体正确率 / 覆盖学科数 / 薄弱知识点数);
  2. 学科表现(各科目正确率横向条形,红/黄/绿分级);
  3. 练习 vs 模考对比 + 难度表现(1–5 星柱状图,分级着色);
  4. 知识点掌握度雷达图(保留,≥3 个知识点时显示);
  5. 薄弱知识点列表(按正确率升序,可一键"针对练习",保留);
  6. 语言学习表现(前端从已有 `langSessions` 按技能聚合平均 Band / 正确率)。
- 验证:`tsc --noEmit` 通过;部署后 `/me/stats` 返回多维度字段、`/app/space` 可达。

## V2.4.16 (2026-08-09) — 修复 PDF 双文件导入答案存成字母(无法判分) + Bug 库登记

- **核心 Bug(#30)**:PDF 双文件导入(题目+答案)写入的答案存成原始字母(A-H),未映射成选项文本,导致判分 `a===s` 全等比对永远失败、教师审题看到的是字母而非选项;且按位置匹配答案易整体错位。
  - `questions.js` 双文件匹配改为**按题号(优先 qno,无则退回位置)**并调用 `mapAnswerToOptionText` 把字母→选项文本;答案**越界防护**(字母超出选项数)清空交教师审核。
  - `vision.js`/`import-pdf.js` 透传 `qno`(题目提取带题号),答案按号匹配。
  - 一次性脚本修正全库 `PDF 导入` 的字母答案(映射回选项文本/越界清空),物理等学科 60+ 题全部修复。
  - 已登记 `docs/MATH_RENDERING_BUGS.md` #30 + 预防规则 #30。

## V2.4.15 (2026-08-09) — 待完成作业:DDL 排序 + 24h 紧急区 + 倒计时

- 「我的作业」待完成区改造:
  - 默认按 DDL 由近到远排序(无限时排最后)。
  - 新增「紧急 · 24 小时内截止」独立区块(红色标题 + 计时图标),仅含 24h 内未过期作业;其余作业留在「待完成作业」区。
  - DDL 显示更醒目:改为彩色徽章(限时·rose 底 / 已过期·红底 / 不限时·灰底),不再挤在灰色小字里。
  - 24h 内作业卡片走红色紧急样式,徽章内显示**实时倒计时**(每秒刷新:`剩 X 时 Y 分 Z 秒`,跨天显示 `剩 X 天`);存在此类作业时才启动 1s 定时器,无则不打扰。

## V2.4.14 (2026-08-09) — 个人空间 Tab 按钮等宽

- 个人空间顶部四个 Tab 按钮（我的作业/成绩历史/薄弱知识点/错题本）改为网格布局,统一等宽:容器 `grid grid-cols-2 sm:grid-cols-4`,每个按钮 `w-full justify-center`,移动端两列、桌面端四列,视觉更整齐。

## V2.4.13 (2026-08-09) — 个人空间 UI 优化:作业卡片与 Tab 按钮美化

- 个人空间「我的作业」待完成/进行中卡片改为刷题练习同款风格:整张卡片可点击开卷,右侧显示「开始作答 →」/「继续作答 →」箭头,悬停高亮;已过期/已提交卡片不可点击、置灰展示。去掉原来笨重的全宽靛蓝按钮。
- 顶部四个 Tab 按钮(我的作业/成绩历史/薄弱知识点/错题本)放大并美化:加图标、加大内边距与字号、选中态加阴影、未选中态加浅边框,视觉更协调统一。

## V2.4.12 (2026-08-09) — 学生端布局重构:新增「个人空间」聚合页

- 新增学生端「个人空间」(`/app/space`),置于导航最左侧,聚合四类内容:
  1. 我的作业(待完成/进行中可直接开卷,含学科与语言作业;往期作业表现含成绩);
  2. 成绩历史(学科会话 + 语言会话合并展示,含成绩趋势折线图);
  3. 薄弱知识点(按正确率升序,正确率<70% 标红,可一键"针对练习";含掌握度雷达图);
  4. 错题本(待掌握/已掌握分组,解析可折叠,可标记掌握,按学科筛选)。
- 刷题练习(`/app`)移除「我的作业」区块(已迁至个人空间);"最近成绩"的"查看全部"改链到 `/app/space`。
- 语言学习(`/app/language`)移除「待完成作业」与「成绩历史」内联区块,仅保留语言试卷库;作业与成绩统一在个人空间查看。
- 删除独立的「成绩历史」(`/app/sessions`)与「错题本」(`/app/wrongbook`)页面,其功能并入个人空间;导航栏相应移除这两个入口。

## V2.4.11 (2026-08-09) — 修复不同套题导入被错误合并成一张卷

- 根因:批量导入按 `subject::paper::source`(sourceKey)分组自动成卷。`source` 恒为"PDF 导入";`paper` 由 `paperFromFilename` + 视觉模型推断,而 `paperFromFilename` 仅对文件名含 `ESAT/TMUA + 年份 + Paper N` 返回卷名,否则返回空 → 物理等非此类 PDF 的 `paper` 回落成泛化值(如"PART B Physics"),导致每批物理题三元组完全相同,`syncAutoPaperSets` 把多套题全并成一张卷。且前端导入请求未传 `paperTitle`,后端即便收到也只改显示标题、不参与分组。
- 修复后端 `import-pdf.js` `paperFromFilename`:非 ESAT/TMUA 文件名时回落到文件名本身(去扩展名/分隔符),保证不同文件名各自成卷、同名文件仍按 sourceKey 合并(dedup)。
- 导入路由(`/import-file`、`/import-pdf`)新增:老师填写的 `paperTitle`(套题名称)优先覆盖本批题目的 `paper`,作为分组与成卷依据,使显式命名可强制分卷。
- 前端教师端批量导入弹窗(上传文件 / PDF 双文件 两种模式)新增「套题名称」输入框,提交时随 `paperTitle` 传给后端,并附分卷说明。
- 数据修正:将此前误合并的一张 60 题物理卷按导入时间拆回 3 张独立卷(各 20 题,分别对应 02:09 / 13:41 / 13:55 三个导入批次;该卷未被任何作业/会话引用,可安全拆分)。

## V2.4.10 (2026-08-09) — 我的作业页语言作业开卷分流修复

- 根因:「刷题练习 / 我的作业」页对所有作业(含语言作业)统一调用学科开卷接口 `POST /api/sessions`,而该接口只认 `assignment.paper`(学科卷)。语言作业仅有 `languagePaperId`、`paper` 为 null,后端抛 404「作业对应的试卷不存在」。语言学习板块因调用正确的 `/language/sessions` 故能正常开卷。
- 后端 `GET /me/assignments` 现对语言作业额外 `include languagePaper`,返回 `isLanguage` 标识,并把语言卷 title/mode/durationMin/examType/skill 映射进 `paper` 字段(列表正确显示卷名 + "语言"标签)。
- 前端 `/app/page.tsx` `startAssignment` 分流:语言作业走 `POST /language/sessions` 并存 `lang-session-{id}`、跳 `/app/language/practice/:id`;学科作业维持原 `POST /sessions` 路径。

## V2.4.9 (2026-08-09) — 修复语言作业开卷报"试卷不存在" + 防删除孤儿作业

- 学生端打开教师布置的语言作业(`POST /language/sessions` 带 assignmentId)时,若该作业关联的试卷状态不是 READY 会被拦下报"作业对应试卷不可用/不存在"。现在放宽:只要作业关联的试卷存在即可开卷(作业本身即开放许可),不再要求试卷处于 READY 库状态。
- 修复孤儿作业根因:`DELETE /language/papers/:id` 原来只把已开会话的 paperId 置空,却没有处理引用该卷的「作业分发」。删除被布置过的试卷会让 assignment.languagePaperId 指向已删试卷,学生再点该作业即报"试卷不存在"。现改为:若仍有作业/考试引用该卷,直接拒绝删除并提示先撤回作业,杜绝孤儿作业。
- 已核验:服务端现存的 2 条语言作业(【样题】雅思阅读模考 Sample、雅思阅读模拟1)均关联存在的 READY 试卷,开卷逻辑可正常返回题目。

## V2.4.8 (2026-08-09) — 修复语言组卷"管理"按钮无反应(改为打开编辑弹窗)

- 语言学习 / 语言组卷 列表卡片的「管理」按钮原本 onClick 仅清空 assignPaperId,不打开任何弹窗,表现为"点击无反应"。
- 改为:点击「管理」拉取该卷详情(GET /language/papers/:id 取题目顺序与 segments),打开「编辑语言卷」弹窗,预填考试类型/技能/卷名/模式/时长/来源/类型/已选题目/分段配置,保存走 PUT /language/papers/:id(后端已存在该接口)。
- `PaperForm` 新增可选 `initial` 参数,兼容"新建"与"编辑"两种模式,标题随模式切换(语言组卷 / 编辑语言卷)。

## V2.4.7 (2026-08-09) — 学生端语言页"开始练习"改整卡按钮 + 筛选改点选

- 学生端 `/app/language` 试卷库卡片改为整卡可点按钮(与刷题练习一致:左侧标题/标签,右侧"开始练习 →");取消卡片内独立的丑按钮。
- 顶端"考试类型/技能"筛选由下拉选框(Select)改为点选按钮 chip(选中靛蓝、未选灰底),与刷题练习试卷库筛选风格统一。
- 待完成作业"开始作答"按钮补 "→" 对齐风格。

## V2.4.6 (2026-08-09) — 语言模块下拉框统一样式
### 优化
- 新增通用下拉组件 `components/Select.tsx`,替换语言学习模块全部原生 `<select>`:
  - 收起态外观与表单输入框统一(`rounded-lg border-slate-200` + 右侧箭头)
  - 展开面板与「填选窗口」弹窗统一(`rounded-2xl bg-white shadow-xl`),含选中勾选标记、hover 高亮、外部点击/Esc 关闭
- 覆盖:教师端(题目/篇章/组卷/作业分发表单、状态筛选)、学生端(考试类型/技能筛选)

## V2.4.5 (2026-08-09) — 修复选项中 "I only" / "I and II only" 首字母 I 被吞
### 修复
- **根因**:后端 `cleanOptionPrefix` 把大写 `I` 当成选项前缀(如 `I.` 或 `I `),导致 "I only" → "only"、"I and II only" → "and II only"。
- **解决**:把 `I/i` 从可清洗的前缀字母中排除(`[A-HJ-Za-hj-z]`),并批量修正数据库中已损坏的选项文本。
- **影响范围**:普通学科题库(question 表),不影响语言学习模块。

## V2.4.4 (2026-08-09) — 语言题库点选式筛选(考试类型 + 技能)
### 新增
- **点选式筛选**:教师端语言题库顶部新增两组 Chip 点选筛选
  - 考试类型:雅思 / 托福 / 剑桥KET/PET / 其他语言
  - 技能:阅读 / 听力 / 写作 / 口语
  - 默认点选「雅思 + 阅读」,单选切换即时刷新列表
- **技能自适应视图**:选「阅读」→ 阅读篇章卡片视图(整篇通过/退回/编辑/删除/展开题目);选「听力/写作/口语」→ 该技能题目列表(通过/退回/编辑/删除),并提供「+ 新增X题目」入口(新建时自动带入当前点选的考试类型与技能)
- 搜索框占位与右侧计数随技能切换(篇章 N 篇 / X N 题)

### 修复
- 组卷弹窗改用不受题库筛选影响的全部阅读篇章,避免题库切到非雅思时组卷看不到篇章分组

## V2.4.3 (2026-08-09) — 语言题库彻底篇章化:移除逐题视图
### 变更
- **移除「逐题视图」**:教师端语言题库不再有「逐题视图 / 阅读篇章视图」切换,题库固定为阅读篇章卡片视图
- 一并移除逐题视图配套入口:顶部「+ 新增题目」「+ 新增材料」按钮、技能筛选下拉、逐题列表的通过/退回/编辑/删除
- 删除已无用的「新增材料弹窗」组件(MaterialModal)
- 筛选栏保留「考试类型 / 状态 / 搜索(篇章标题·正文)」,右侧新增篇章数量统计
- 单题编辑仍可用:展开篇章后点小题的「单题编辑」进入
- 后端接口未改动;听力/写作/口语题目数据保持原样,仅题库页不再提供逐题浏览入口

## V2.4.2 (2026-08-09) — 雅思阅读「篇章化」:一篇文章 + 绑定题目为一个整体单元
### 新增
- **阅读篇章视图**(教师端语言题库):技能选「阅读」自动切换为篇章卡片视图,每篇显示标题、题数、题型分布、审核状态,可展开查看全部小题;支持「整篇通过 / 整篇退回 / 编辑整篇 / 删除整篇」
- **新建阅读篇章**:一个弹窗内左侧写文章正文、右侧动态增删绑定题目(判断/填空/单选/多选/配对/段落标题),一次性提交为整体单元
- **导入阅读篇章(PDF)**:上传阅读试卷 PDF → 视觉模型按「文章 + 其题目」抽取成草稿 → 教师逐篇确认后入库(任务式进度条,不阻塞)
- **组卷按篇章选择**:阅读组卷时按篇章分组,一键「选整篇」带入该篇全部题目
- 后端新增 `/api/language/passages` 系列接口(列表/详情/创建/更新/整篇审核/整篇删除/PDF 导入 + 进度轮询),`vision.js` 新增雅思阅读专用抽取 `extractReadingPassagesFromPdfPages`

### 修复
- 教师端语言页「+ 新增题目 / + 新增材料 / + 新建语言卷」按钮点击无反应(对应弹窗组件未被渲染,V2.4.0 遗留)
- 语言组卷选「全真连考(L+R+W)」时选题区只显示阅读题(技能过滤未排除 FULL 模式)
- 组卷选题改用独立的「全部已发布题」数据源,不再受题库页筛选条件影响

### 说明
- **未改动数据库 schema**:篇章仍以 `LanguageMaterial`(文章)+ `LanguageQuestion.materialId`(绑定)存储,已有阅读题自动归入对应篇章卡片,无需重导
- 听力/写作/口语保持原有逐题录入方式不变;学生端练习/模考页无需改动

## V2.4.1 (2026-08-09) — 方向A:雅思机考体验优化(语言练习/模考)
### 新增
- **音量控制**:听力音频增加音量滑块,设置记忆于 sessionStorage;EXAM 模式下音频仅可播放一次(播完自动禁用,贴合雅思机考规则)
- **阅读高亮**:阅读题型材料区新增「高亮选中」按钮,用 `<mark>` 包裹选区(仅视觉、不持久化),便于机考划线定位
- **计时器升级**:剩余 <5 分钟变红、<60 秒闪烁;分段模式(全真连考)顶部新增多段进度条,切换段带 0.5s 过渡动画
- **题目标记 Flag**:每题可标记(★),题号导航显示已标记圆点;新增「未作答 / 已标记」筛选快速跳转
- **自动保存心跳**:本地即时更新,每 2s 防抖批量回传后端;从本地缓存恢复进度时显示「📥 已从本地恢复上次作答进度」提示;顶栏实时显示保存状态
- **后端**:GET /api/language/sessions/:id 新增 `allowReplay` 字段(mode !== EXAM 为 true),供前端判断音频可重播
### 不变
- 未改动任何数据库 schema 与现有学科题库/功能,纯前端体验增强

## V2.4.0 (2026-08-09) — 语言学习模块(雅思在线练习/模考 + 其他语言)
### 新增
- 独立语言数据表(LanguageQuestion/Material/Paper/Session/AnswerRecord/WrongBook),与学科题库完全隔离,不影响现有数据与功能
- 教师端「语言学习」大模块:语言题库(听力/阅读/写作/口语,音频上传,PDF视觉模型复用,审核流)、语言组卷(技能专项卷 + 全真连考卷 L+R+W 2h45m)、写作/口语批改台(4维度 Band + 评语)、语言作业分发(复用 Assignment)
- 学生端「语言学习」:分技能练习(听力播放器/阅读分屏高亮/写作字数统计/口语录音)、全真模考(分段倒计时自动切段自动交卷)、Band 成绩报告、语言错题本、我的语言作业
- 雅思机考对齐:40题听力/40题阅读客观题自动判分 + 官方换算表折算 Band;写作/口语教师人工批改
- Assignment 加 languagePaperId 可空字段;删除学生级联删除语言数据

## V2.3.33 (2026-08-09) — 系统重命名为「金瑞升学金鹰系统」
- **改动**:全站品牌名称由「上海金瑞学校 附加笔试刷题系统」统一改为「**金瑞升学金鹰系统**」:
  - 前端用户可见:登录页标题/副标题、浏览器 tab 标题(metadata)、学生端头部、老师端头部、答题页成绩报告与作答页标题;
  - 文档:apps/web/README.md、docs/DEPLOY.md、API.md、ARCHITECTURE.md、TEST_CASES.md、VC_HANDOFF.md、MATH_RENDERING_BUGS.md、schema 注释、graphics-preview.html 等 15 处文件。
- **验证**:tsc 通过;源码全量 grep 无旧名残留(.next 构建产物随重新 build 自动更新)。

## V2.3.32 (2026-08-09) — PDF 导入丢题修复(视觉模型漏题重试 + 预警)
- **问题**:导入 2022 TMUA Paper 2 时只收到 16 题,缺 4 道(Q7-Q10)。核对该 PDF(首页写明 20 questions)与官方答案页,确认缺失的正是 PDF 第 9-12 页的 Q7/Q8/Q9/Q10——这 4 页恰好构成视觉模型单批(每 4 页)调用,该批被模型漏提取且无重试机制。
- **修复**:
  1. **补题**:已按官方原卷补入缺失的 Q7-Q10 四题(Q7 立方数证明/E、Q8 等差数列/C、Q9 k 值/A、Q10 量词/G),插入卷中 Q1-Q6 之后,卷题数 16→20,recalc 后 DRAFT(新题待审核)。
  2. **防复发**(`vision.js`):`extractQuestionsFromPdfPages` 重构为逐批调用 + **最多 3 次重试**(空结果重试;请求异常退避重试;3 次仍失败才抛错)。
  3. **丢题预警**(`import-pdf.js`):`parsePdf` 对比题目页数与提取题数,差距过大时打日志警告。
- **验证**:node --check 通过;库中 16 题答案与官方 Paper 2 答案列逐一核对一致。

## V2.3.31 (2026-08-09) — 错题本解析可折叠(默认收起,点击展开)
- **功能**:学生端错题本每题解析改为**可折叠**——默认收起,点击「查看解析」展开,再点「收起解析」隐藏。无解析的题点按钮显示「暂无解析」提示。
- **实现**:`app/wrongbook/page.tsx` 加 `openSolutions` Set state(记录已展开的 questionId),解析块包成带箭头图标的可点击按钮(旋转 90° 指示展开态)。已掌握/待掌握两区共用同一套折叠逻辑。
- **验证**:tsc 通过。

## V2.3.30 (2026-08-09) — 教师端学生管理大模块(删除学生 + 作业/考试分发)
- **功能**:
  1. **删除学生**:学生成绩概览每行加「删除」按钮,级联删除该学生全部数据(会话/作答记录/错题本/爬塔/作业目标/账号)。
  2. **作业/考试分发**:教师端「学生管理」新增子 Tab「作业/考试分发」——从**试卷库选卷** + **勾选学生**(支持全选/搜索) + 设定**DDL**(可选) + 布置;作业列表看完成统计(已交/进行中/未交),详情看每生状态,可删除作业。
  3. **学生端「我的作业」**:学生首页展示教师布置的作业卡片(名称/试卷/DDL/备注/状态),点击开始(EXAM 限时,时长跟随试卷),提交后自动回写「已交」;过期作业自动标「已过期」。
- **实现**:
  - schema 新增 `Assignment`(作业)、`AssignmentStudent`(分发目标+状态)模型,`Session.assignmentId` 关联;
  - `teacher.js`:DELETE /students/:id(级联删除)、GET/POST/DELETE/GET:id /assignments;
  - `sessions.js`:POST /sessions 支持 assignmentId(作业决定试卷/时长/DDL,校验归属+DDL,标记进行中),submit 时回写 SUBMITTED;
  - `me.js`:GET /me/assignments(待完成+已完成,DDL 过期自动 EXPIRED);
  - 教师端 students/page.tsx 重构为子 Tab(学情统计/作业分发);学生端 app/page.tsx 加「我的作业」区块。
- **验证**:schema validate + db push + generate 通过;tsc 通过;node --check 通过。

## V2.3.29 (2026-08-09) — 学生端新增「试卷库」(对齐教师端筛选/排序)
- **功能**:学生端首页新增**试卷库**区块——与教师端试卷管理一致,支持:
  - 学科筛选(全部/数学/物理/化学/生物);
  - 套题类型筛选(全部/原版套题/组卷套题,卡片上显示「原版/组卷」标签);
  - 排序(最新优先/名称 A→Z/Z→A 自然序);
  - 点击试卷卡片**直接开始**(PRACTICE 卷练习 / EXAM 卷模考,时长跟随试卷)。
- **实现**:
  - 后端 `GET /papers` 学生端返回补充 `kind`/`origin`/`source` 字段;
  - 前端 `app/page.tsx`:papers state 扩字段、`libPapers` useMemo 筛选排序、`startPaper` 开卷函数、试卷库 UI(卡片网格 + 筛选 Tab + 排序下拉)。
- **验证**:tsc 通过;node --check 通过。

## V2.3.28 (2026-08-09) — 试卷管理分类筛选新增「套题类型」(原版套题 / 组卷套题)
- **功能**:试卷管理学科筛选旁新增**套题类型 Tab**:全部套题 / **原版套题** / **组卷套题**。
  - **原版套题**(OFFICIAL):导入的官方原版套题(PDF 导入的 TMUA/ESAT 真题等);
  - **组卷套题**(CUSTOM):手动组卷生成的题目、或导入的自编套题(JSON/CSV 粘贴)。
- **实现**:
  - `schema.prisma` Paper 新增 `kind` 字段(`OFFICIAL`/`CUSTOM`,默认 CUSTOM),db push + prisma generate;
  - 打标:手动组卷(generate)→ CUSTOM;PDF 双文件导入 → OFFICIAL;JSON/CSV 粘贴导入 → CUSTOM;上传文件导入 → 按 source 自动判断(isOfficialSource:真题/PDF 导入/Official 等为 OFFICIAL);
  - 存量回填:origin=MANUAL → CUSTOM;AUTO_SET 按 source 判定(11 张官方卷全部 → OFFICIAL);
  - 后端 `GET /papers` 支持 `?kind=` 过滤,响应带 `kind` 字段;
  - 前端 `papers/page.tsx` 加 `kindFilter` state + 套题类型 Tab,与学科 Tab、状态 Tab、排序叠加生效。
- **验证**:db push + generate 成功;11 张存量卷回填正确;tsc 通过;api node --check 通过。

## V2.3.27 (2026-08-09) — 批量导入可撤销/删除已选文件
- **功能**:批量导入面板中三种文件选择都支持**撤销/删除已选文件**:
  - 「上传文件」模式(.xlsx/.xls/.docx/.pdf):已选文件后显示「撤销」按钮;
  - 「PDF 双文件」模式:题目文件、答案文件各显示「删除」按钮。
- **实现**:点击撤销/删除会清空对应 state(`importFileName`/`pdfFileName`/`pdfAnsFileName`)并重置 `<input type=file>` 的 value(`ref.current.value = ""`),保证再次选择同一文件时 onChange 仍会触发。
- **验证**:tsc 通过。

## V2.3.26 (2026-08-09) — 试卷管理列表排序(名称字母/数字序 + 时间)
- **功能**:试卷管理列表右上角新增**排序下拉**:最新优先(默认)/ 名称 A→Z / 名称 Z→A。
- **实现**:纯前端——`papers/page.tsx` 新增 `sortBy` state;名称排序用 `localeCompare({numeric:true, sensitivity:'base'})`,让 "TMUA 2018 Paper 1" 排在 "TMUA 2022 Paper 1" 前(数字自然序,不是字典序);与学科 Tab/状态 Tab 可叠加。
- **验证**:tsc 通过;名称自然序本地测试通过(2017→2018→2019→2020→2022 顺序正确)。

## V2.3.25 (2026-08-09) — 导入时自动识别罗马数字序号(I/II/III)并分行
- **需求**:题干中 I/II/III 等其实是序号(对应 1/2/3),后跟的公式应分行显示——这是 TMUA/ESAT 等试卷的典型排版。视觉模型常把它们挤成一行(`I $a$ II $b$ III $c$`),导致题干阅读困难。
- **实现**(双保险):
  1. `vision.js` SYSTEM_PROMPT 新增「**罗马数字序号识别**」规则:明确 I/II/III/IV/V 是列表序号而非变量/数学符号;序号项必须**每个独立一行**、序号与公式间用空格;严禁多个序号项挤同一行(已避反引号陷阱)。
  2. `text-clean.js` 新增 `splitRomanNumeralItems`:导入清洗兜底——检测 `$...$` 公式间连续出现的 ≥2 个罗马序号,把「公式闭合$ + 空格 + 序号」前的空白改换行。接入 `normalizeNewlines`,所有导入路径(JSON/CSV/文件/PDF)入库时自动生效。
- **验证**:8 用例测试通过(挤一行→拆3行;已分行/单序号/变量$I$/无公式/序号后普通文字→均不误伤);node --check 通过。

## V2.3.24 (2026-08-09) — 修复题干/解析多公式挤同一行(white-space: pre-wrap)
- **问题**:2022 TMUA 第 10 题等含多个独立公式 + I/II/III 罗马数字标号的题目,题干里 `\n` 换行符在渲染时被 HTML 折叠为单个空格——3 个公式挤在同一行,序号贴在一起不易阅读。
- **根因**:`rich.tsx` text 包裹层用 `<span>{text}</span>`,默认 `white-space: normal` 折叠换行;数据本身正确(每个公式独立一行),是渲染层问题。
- **修复**:`rich.tsx` 三处 `<span>` 加 `whitespace-pre-wrap` 类(L110/L111 渲染 text token + L267 smartMath flushText),保留 `\n` 换行。对短文本(无 `\n`)无影响。
- **验证**:tsc 通过、Q10 stem tokenize 输出确认每个公式独立为 math token。

## V2.3.23 (2026-08-09) — 批量导入进度条(任务式导入)
- **功能**:批量导入(JSON/CSV/上传文件/PDF 双文件)改为**任务式**——提交后返回 taskId,后端后台逐步执行并上报进度,前端**实时进度条**(百分比 + 阶段文案:准备/解析/入库/组卷)。
- **实现**:
  - 后端新增 `lib/import-task.js`(内存任务表,TTL 30 分钟自动清理);`/import`、`/import-file`、`/import-pdf` 改为立即返回 `{ taskId }`,后台执行 `runImportTask`,逐阶段 `updateImportTask` 上报进度;新增 `GET /questions/import-task/:taskId` 轮询接口。
  - `importRows` 增加可选 `onProgress` 回调,逐行导入按 5 条粒度上报。
  - 前端 `teacher/page.tsx`:三个导入函数改为提交 → `pollImportTask`(每 1.2s 轮询,5 分钟超时兜底)→ 进度条 UI(蓝=进行中/绿=完成/红=失败)+ 阶段文案;关闭/完成时清理定时器。
- **验证**:`import-task` 模块单测 PASS(running/done/error/notfound);tsc 通过;node --check 通过。

## V2.3.22 (2026-08-09) — 试卷管理按学科筛选
- **功能**:试卷管理页新增**学科 Tab 筛选**(全部/数学/物理/化学/生物,与题库的学科 Tab 一致),点击即过滤出该学科下的试卷。
- **实现**:后端 `GET /api/papers` 支持 `?subject=` 过滤(仅老师/管理员;学生端只看已开放卷不受影响);前端 `papers/page.tsx` 加 `subjectFilter` state + 学科 Tab,与状态 Tab(全部/可作答/待审核/套题自动卷/已下架)可叠加使用。
- **验证**:tsc 通过、node --check 通过。

## V2.3.21 (2026-08-09) — 修复 pmatrix 公式被误判为文本外露 + 53 题 answer 存选项内容改字母
- **问题1(题干显示)**:2020 TMUA Q10 题干中 `$\begin{pmatrix} 3 \\ -5 \end{pmatrix}$` 以 **LaTeX 源码原样外露**(`\begin{pmatrix}...\end{pmatrix}` 字样可见)。根因:`looksLikeTextInDollars` 把 `begin`/`end`/`pmatrix` 当普通英文单词(≥2 个),把整个 `$...$` 误判为"数据残留文本"退回文本。
- **修复1**:`rich.tsx` `looksLikeTextInDollars` 先剔除 LaTeX 命令(`\begin` 等 `\\[a-zA-Z]+`)与环境名(`{pmatrix}` 等 `{[a-zA-Z]+}`)再统计英文词——`\begin{pmatrix}` 不再被误判。8 用例验证 PASS(含 pmatrix/frac/sqrt/化学式/英文句子/零散 $)。
- **问题2(判分铁律)**:全库扫描发现 **53 题 answer 存了"选项完整内容"而非字母**(TMUA 2019 10 题、TMUA 2018 Q4、TMUA 2020 Q10、PART B Physics 11 题)。`grading.js` 判分 `a === s` 学生选字母永远判错。
- **修复2**:写脚本对 `SINGLE_CHOICE` 且 answer 精确匹配 options 某一项的题,统一改为对应字母(A-H)。53 题全部修复,0 跳过。
- **沉淀**:Bug 库 #27 登记;pmatrix 类 LaTeX 环境命令误判 + answer 数据存选项内容两类问题入预防规则。

## V2.3.20 (2026-08-09) — 修复 5 题「$$/$ 配对错位」(同卷内两个公式挤一行)
- **问题**:2018 Q3/Q4 (用户截图题)、2017 两题、2019 一题,stem 里两个公式被挤在同一行,中间公式没被 `$$`/`$` 包裹(裸 LaTeX),尾随 `$$\n` 是孤儿块级。tokenize 正则 `\$\$([\s\S]+?)\$\$` non-greedy 把所有后续内容吞进一个超长块级公式 → KaTeX 报「Unexpected char」 → fallback 输出整段 LaTeX 源码。
- **修复**:5 题 stem 全部手动重写,每个公式独立一行 + 完整 `$$...$$` 包裹。最终全库扫描:`$$` 配对错 0 题、`$` 配对错 0 题。
- **沉淀**:Bug 库 #26 增加「两公式挤一行」条目 + 预防规则;同时验证 Q12 当前 stem 已分裂 3 积分行(此前 V2.3.18 已修,Q12 不再是问题源)。

## V2.3.19 (2026-08-09) — 修复 AI 英文解析格式/公式显示错乱
- **问题**:AI 生成英文解析后,`## Solution Steps`、`- ` 列表、`**bold**` 等 Markdown 标记**原样显示**(渲染层不解析 Markdown),且英文正文段落被 smartMath 误判成数学斜体,公式显示也偶有 `\text{}`、`\(...\)` 等不兼容格式。
- **根因**:① V2.3.17 解析 prompt 要求用「Markdown headings ##」组织,但 `renderRich` 不解析 Markdown;② `renderRich` 默认对非公式文本走 smartMath(为题干设计),英文长段落误判斜体。
- **修复**:
  1. `rich.tsx`:`renderRich` 新增 `opts.smart=false` 参数——非公式文本原样输出;题干/选项仍 smartMath;4 处解析渲染(审核弹窗/练习页/错题本)传 `{smart:false}`;
  2. `questions.js` 两处解析 prompt 改为「plain text + 简单换行分段,禁止 ##/- /**,公式只用 $...$/$$...$$,禁止 \\( \\[ \\text \\begin \\\\」;
  3. 一次性脚本清洗存量解析的 `##`(标题)/行首 `- `(列表)/`**` 标记;
  4. Bug 库登记 #26(解析渲染与 prompt 规范)。
- **验证**:实际调用 LLM 生成英文解析确认输出结构;tsc + node --check 通过。

## V2.3.18 (2026-08-09) — 修复 2017 第 11 题公式混用 + 视觉模型 prompt 强化
- **问题**:2017 第 11 题(cmsladx3n000a88r5027kxs8g)题干渲染为 `$$x_1 = 7$$` 居中独占一行,紧跟的 `x_{n+1} = \frac{23x_n - 53}{5x_n + 1}` 完全是裸 LaTeX 源码不渲染,末尾 `$$\n` 是孤儿 display math → 整段排版错乱。
- **根因**:视觉模型对短公式习惯用 `$$...$$` 块级,但紧跟的下一行公式忘了加 `$` 包裹直接裸写,又用 `$$\n` 试图开新块级却没闭合;`vision.js` 原有 prompt 第 46 行只笼统说「`$` 必有 `$$` 闭合」过于抽象,模型没遵守。
- **修复**:
  1. 一次性 UPDATE 该题 stem(裸 `x_{n+1} = ...` 加 `$...$` 包裹、`$$x_1 = 7$$` 改 `$x_1 = 7$`、删孤儿 `$$\n`);
  2. `vision.js` SYSTEM_PROMPT 新增「**公式定界符选择(关键,防止显示错乱)**」:短公式一律 `$...$` 行内、复杂表达式才 `$$...$$`、严禁块级与行内混用/半边定界符;
  3. `docs/MATH_RENDERING_BUGS.md` 登记 #25 + 新增预防规则 #25(公式定界符二选一)。
- 排查过程:`findUnique({ where: { id: "cmsladx3n000" } })` 报 NOT FOUND 但 `findFirst({ where: { stem: { contains } } })` 能找到——**根因**是 cuid 是 25 字符,前 12 字符恰好是 `cmsladx3n000` 误导判断,实际 id 是 `cmsladx3n000a88r5027kxs8g`(用 stem 包含 + update 是更稳的定位方式)。

## V2.3.17 (2026-08-09) — 按卷审核显示当前卷名 + AI 生成解析统一英文
- **按卷审核卷名显示**(`teacher/page.tsx`):审核弹窗顶部原先显示题目自己的 `paper` 字段(源卷名,如「PART B Physics」),当卷名被改过(如「ESAT Physics 1」)或题目跨卷引用(如 E2E 卷引用了 TMUA 2021 的题)时会让人误以为「显示的不是本卷的题」。修复:按卷审核(paperId 模式)时,弹窗顶部改为显示**当前卷名**(📄 徽章,悬停可见题目源卷),与页面顶部「正在按试卷审核:『卷名』」横幅一致。
- **AI 生成解析统一英文**(`questions.js`):`tryGenerateSolution`(自动补解析/一键修正补解析)与「AI 生成解析」按钮的 system prompt 全部改为英文——三段式 Markdown 标题改为 `## Solution Steps / ## Knowledge Points Tested / ## Common Pitfalls`,user prompt 的字段标签与指令同步英文化,并明确「Write the entire explanation in English」。
- 排查结论:后端 paperId 过滤(按卷只查卷内题)与数据(4 卷 questionIds 均干净,唯一交叉为 E2E 卷引用 TMUA 2021 第 1 题)经验证无误,「显示别的卷的题」实为**卷名与题目 paper 字段不一致**造成的观感问题,本次已在显示层消除。

## V2.3.16 (2026-08-09) — 答案显示修复：字母→完整选项内容自动翻译
- **问题**:题库里很多题的 `answer` 字段存的是字母(如 "B"),选项高亮逻辑 `opt === q.answer` 把完整选项内容("72 cm s⁻¹")与字母比较,**永远不匹配 → 不高亮**,用户以为"有答案但没显示"。
- **根因(关键)**:数据存字母是**对的**——判分引擎 `grading.js` 用严格相等 `a === s` 比对学生作答(学生选字母),若存完整内容学生选 "B" 永远判错。问题在**前端显示**没把字母翻译成完整内容。
- **修复**:
  - 新增 `apps/web/lib/answer.ts`:`letterToOption(answer, options)` 把字母/多选(A, C / A C / A、C)/完整文本转成对应完整选项内容;`isAnswerOption(opt, answer, options)` 选项高亮判定(支持字母存数据 + 完整文本存数据两种历史情况);
  - `teacher/page.tsx` 审核弹窗与 `papers/page.tsx` 详情抽屉:选项高亮改用 `isAnswerOption`;题干下方追加「**答案:完整内容**」展示行(转换后内容若与原字段不同,会在括号里附「(原字段:B)」便于核对数据)。
- **未动数据** —— 不改 answer 字段、不改判分逻辑,纯前端显示优化。
- **验证**:tsc 通过;13 用例单测全过(单字母/小写/多选 3 种分隔符/完整文本/越界等)。

## V2.3.15 (2026-08-09) — 批量导入新增「PDF 双文件」：题目文件 + 可选答案文件
- **需求**:批量导入部分把 PDF 导入独立出来,可同时导入两个文件——题目文件(必填)+ 答案文件(可选)。
- **后端**:
  - `vision.js` 新增 `extractAnswersFromPdfPages`(专用答案识别 prompt:题号+字母,忽略学科列);
  - `import-pdf.js` 新增 `parseAnswerPdf`:栅格化答案 PDF → 视觉模型提取 [{question, answer}] → 按题号升序去重;
  - `questions.js` 新增 `POST /import-pdf`:接收题目文件(base64)+ 可选答案文件,题目走 parsePdf,答案按**题号升序与题目入库顺序一一对应**填入 answer;无答案文件则答案留空(缺答案禁发布铁律仍生效)。
- **前端**(`teacher/page.tsx`):导入面板新增「PDF 双文件」标签页——题目文件选择(必填)+ 答案文件选择(可选,带格式提示)+「上传并导入」按钮;导入结果含「答案文件匹配 N 题」报告。
- **验证**:tsc 通过、三处 node --check 通过;修复了 V2.3.14 prompt 中反引号导致模板字符串语法错误的问题。

## V2.3.14 (2026-08-09) — 修复 PDF 答案页漏读(答案表识别 prompt)
- **问题**:NSAA 物理卷导入后 9/20 题缺答案。答案页(最后那张 `Q21 G PHYS` 表格)视觉模型看到了,但 prompt 只笼统说「从答案页读取」,模型没把学科列当作干扰、没把字母列对应到题号。
- **修复**(`vision.js` SYSTEM_PROMPT):在答案规则处明确补充「**答案页识别**」格式说明——
  - 表格形式(如 NSAA / A-Level 附录答案):`Q21 A`、`22. B`、`Question 23 C`,若带学科列 `Q21 A PHYS` 则**忽略学科列,只取字母**;
  - 逐题列出(部分试卷直接附在题目页下方):按题号取字母;
  - 题号 Q21 对应**第 21 题**,不是 PDF 文件序号;多选题写 "A, C"。
- **已入库补救**:已临时写一次性脚本 `/tmp/fill_nsaa_answers.cjs`,用户填答案对照表后跑(只补缺答案题,已有答案不动)。
- **后续 PDF 导入**:新 prompt 生效后,答案表会**自动被读取**,不再需要手动补救。

## V2.3.13 (2026-08-09) — 添加试题弹窗只显示题干，不再显示选项
- **需求**:添加试题弹窗中的题目不显示选项,只要题干。
- **前端**(`teacher/papers/page.tsx`):移除题目卡片中的 A/B/C/D 选项渲染区块,保留完整题干(含科目/题源/状态/知识点徽章),卡片更紧凑。纯前端改动,tsc 通过。

## V2.3.12 (2026-08-09) — 手动组卷支持题源多选 + 修复限时输入 0 删不掉
- **需求**:手动组卷可选题源(可多选);限时输入框第一个数字 0 无法删除的 bug。
- **题源多选**(`papers.js` POST /generate + `teacher/papers/page.tsx`):
  - 生成面板新增「题源(可多选)」chips(TMUA/ESAT/NSAA,不选=全部),与科目/知识点/难度筛选叠加;
  - 后端 `where.sourceType = { in: [...] }` 过滤;生成卷的 sourceType 只在单选一个题源时写入(多选/不选留空,可在详情设置里改);
  - 顺带把生成面板科目选项从旧的 TMUA/ESAT 修正为四科(数学/物理/化学/生物,V2.3.8 语义)。
- **限时输入 bug**:根因是 `type=number` 受控 `Number(e.target.value)`——删空时 `Number("")=0` 又写回输入框,0 永远删不掉。修复:改 `type=text inputMode=numeric` + 字符串受控 + 过滤非数字字符(组卷表单的限时/数量 + 详情设置的限时统一处理)。
- **验证**:tsc 通过、node --check 通过。

## V2.3.11 (2026-08-09) — 添加试题弹窗增强：完整题干 + 知识点筛选
- **需求**:试卷管理「添加试题」弹窗中,题目显示完整美观的题干,并支持按知识点筛选。
- **前端**(`teacher/papers/page.tsx`,后端零改动):
  - 题目卡片**完整显示题干**(移除 2 行截断),题干置于浅灰圆角区块,并完整列出 A/B/C/D 选项——老师选题时能看清整道题;
  - 弹窗顶部新增**知识点下拉**(按本卷科目从 `/knowledge-points?subject=` 预载),选中后以 `knowledgePointId` 参数重新拉取 `GET /api/questions`(后端 buildWhere 既有 topicIds contains 筛选),与关键词搜索叠加使用;
  - 列表高度提高到 max-h-[30rem],弹窗整体可滚动。
- **验证**:tsc 通过;知识点/题目接口筛选均为既有能力,无后端改动。

## V2.3.10 (2026-08-09) — 题库缺答案/缺解析标签 + 缺答案禁发布铁律
- **需求**:题库所有题目在状态列按情况显示「缺答案」「缺解析」标签;缺答案的题一定不能发布。
- **后端**(`questions.js`):
  - `POST /:id/review` approve 时校验 `answer` 非空,缺答案返回 400「该题缺少答案,不能发布」——PDF 导入允许 answer 暂缺(等老师补),但补全前永远无法通过审核;
  - `PUT /:id` 编辑时若答案被清空且题处于(或将被置为)PUBLISHED,同样拒绝——防止已发布题被改成缺答案;
  - 单题 POST 本就要求 answer 必填,无缺口。
- **前端**(`teacher/page.tsx`):新增 `questionIssues(q)`(缺答案=answer 空/缺解析=solution 空);列表状态列与审核弹窗顶部显示红色「缺答案」+ 橙色「缺解析」标签;审核弹窗「通过审核并发布」按钮在缺答案时禁用并显示「缺答案,不能发布」,`doReview("approve")` 前端也提前拦截。
- **基线**:生产 60 题中缺答案 9 题(全部 PDF 导入、待审核,发布前必被拦截)、缺解析 22 题、已发布题缺答案 0。tsc 通过、api 语法检查通过。

## V2.3.9 (2026-08-09) — 试卷管理「添加试题」：从题库选题加入卷子
- **功能**:试卷管理 → 查看详情抽屉 → 卷内题目区新增「+ 添加试题」按钮,弹出选题弹窗。
- **选题范围**:按本卷的科目(subject)与题源(sourceType)过滤题库(`GET /api/questions` 的 subject/sourceType 双筛选,复用 V2.3.8 能力),**自动排除已在卷内的题**;弹窗内支持题干关键词搜索;展示每题的科目/题源/状态/知识点/难度与题干预览(renderRich),可多选。
- **提交**:合并「现有卷内 ids + 勾选 ids」后 PATCH `/papers/:id`(questionIds 全量替换,既有能力),后端自动重算卷就绪度——添加的题若未审核发布,整卷回落 DRAFT。
- **纯前端改动**(`teacher/papers/page.tsx`),后端零改动;tsc 通过。

## V2.3.8 (2026-08-09) — 科目与题源分离：新增 sourceType 字段
- **需求**:题库每道题 + 试卷管理每套卷,都要独立显示「题源/试卷类型」(TMUA/ESAT/NSAA,后续可扩展),把**科目**(数学/物理/化学/生物)与**题源**(TMUA/ESAT...)区分开。
- **数据模型**(`schema.prisma`):`Question.sourceType` / `Paper.sourceType`(String?,题源/试卷类型,可扩展)。subject 回归纯科目语义。
- **导入链路**(`import-pdf.js`):`unifyFileMeta` 升级为**双字段统一**——subject 取 paper 组内学科多数派(视觉模型 subject 为 TMUA/ESAT 等题源词时记入题源投票,不再污染科目);sourceType 取文件名题源信号(ESAT/TMUA/NSAA/BMAT/STEP/MAT/PAT/ENGAA)→ 题源多数派;TMUA 题源且无学科信号时 subject 兜底"数学"。`sourceTypeFromFilename` 新增;空值统一置 null,绝不把题源词回退进 subject。
- **后端**:`questions.js`(PUBLIC_FIELDS/单题 POST/PUT/importRows/buildWhere 支持 sourceType,字段校验放宽为「subject 或 sourceType 至少一个」)、`papers.js`(列表/详情/PATCH/generate 支持 sourceType)、`paper-set.js`(自动组卷建卷/合并时写入 sourceType)。
- **前端**:题库管理列表「科目/题源」双徽章(科目 teal / 题源 indigo)、审核弹窗双徽章、录入表单科目下拉(4 科)+ 题源下拉(TMUA/ESAT/NSAA/无);试卷管理列表「科目/类型」双徽章、详情双徽章、试卷设置区新增题源下拉。
- **历史数据迁移**(生产):TMUA 题/卷 → subject=数学 + sourceType=TMUA(Paper.sourceKey 同步 `TMUA::`→`数学::`,避免下次导入建新卷);PART B Physics(NSAA 2023)题/卷 → sourceType=NSAA。ESAT 混合卷科目无法自动细分时留空,老师后补。
- **验证**:`unifyFileMeta` 22 用例全过(NSAA 案例/ESAT 混合卷/TMUA 文件名强信号/科目多数派/空值边界);tsc 通过。

## V2.3.7 (2026-08-09) — PDF 导入文件级统一 subject/paper，根治拆卷
- **问题**:同一份 PDF 导入后被拆成多套卷。根因是视觉模型**逐题**判断 subject,同卷内偶尔判错(如 NSAA 2023 物理卷中 4 题被判成 ESAT),而 `paper-set.js` 按 `subject::paper::source` 三元组建卷,导致一份 PDF 拆成两套独立卷。
- **修复**(`apps/api/src/lib/import-pdf.js`):`parsePdf` 中新增 `unifyFileMeta`,在视觉模型返回后对**同一份 PDF 的所有题强制统一 subject/paper**:
  - paper:文件名解析优先(如 `TMUA-2021-paper-1.pdf` → `TMUA 2021 Paper 1`)→ 文件内多数派 → 首个非空;
  - subject:文件名强信号(ESAT/TMUA/数学/物理/化学/生物,中英均可)→ 统一后 paper 组内多数派 → 文件内多数派;
  - 归一化映射(Physics→物理 等)与 `routes/questions.js` 的 `SUBJECT_NORM` 保持一致;空 subject/paper 的题会被补齐,不再因个别字段缺失被丢弃。
- **验证**:本地 16 用例全过——NSAA 场景(16 物理 + 4 误判 ESAT → 20 题统一物理/PART B Physics)、TMUA 文件名强信号、Physics/物理混拼归一、无信号多数派、空数组/全空边界。
- **效果**:以后同一份 PDF 无论视觉模型怎么逐题误判,都只会生成一套卷;真混合卷(如 ESAT 数学+物理)若文件名含 ESAT 也统一为 ESAT 一套卷(知识点归类不受影响,ESAT 池含数学+物理)。

## V2.3.6 (2026-08-09) — 试卷管理支持修改名称/科目/模式
- **功能**:试卷管理详情抽屉新增「试卷设置」区,老师可直接修改每套卷的**名称**(已有)、**科目**(TMUA/ESAT/数学/物理/化学/生物)、**模式**(练习/模拟考)与**限时**(模拟考时)。
- **后端**(`papers.js` PATCH `/papers/:id`):新增 `subject` 支持,合法科目白名单校验;改科目时**同步更新 sourceKey**(subject::paper::source),避免下次导入同套题因唯一键不一致而建新卷;与已有卷的 sourceKey 冲突时报错提示(先改名/删除冲突卷)。
- **前端**(`teacher/papers/page.tsx`):详情抽屉设置区三控件(科目 select / 模式 select / 限时 input),有改动才显示「保存设置」按钮;`saveSettings` 组装 PATCH body(title 仍走原输入框)。
- **验证**:`tsc --noEmit` 通过;`node --check` 通过。

## V2.3.5 (2026-08-09) — 「含图表」提示升级为三态:已含图 / 应配图但缺图
- **需求澄清**:「含图表」提示字段不仅要代表题目**已包含**图片,更要点出**题目应该包含图片但可能还没包含**的题,提醒老师手动去补图。
- **实现**(`teacher/page.tsx`):`containsImage` 升级为三态 `imageStatus(q)`:
  - `has` → 琥珀色「含图表」:题干/选项/解析中已内嵌 `![alt](url)` 图片;
  - `needs` → 红色「需配图」:文本引用了图表(`diagram`、`not to scale`、`shown below`、`as shown`、`illustrated`、`如图 1`、`图表` 等信号词)但**未内嵌任何图片**,提示老师进编辑手动添加截图;
  - `none` → 不显示。
- **防误报**:信号词用组合词(`the figure`/`in the figure`/`figure below`/`figure 1`)而非裸 `figure`,避免 `significant figures` 等数学术语误报;裸「图/图像/图形」不作为信号,避免「函数图像」类纯文字题误标。
- **验证**:本地 9 用例 8/9 通过(唯一 FAIL 为抽象语境 `The figure is significant`,非真实题语言);真实数据库扫描:85 题中含图 3 题、应配图缺图 2 题(`diagram not to scale` / `The diagram shows`),`significant figures` 误报已排除。`tsc --noEmit` 通过。

## V2.3.4 (2026-08-09) — 题库搜题功能
- **功能**:题库管理/审核队列页面的筛选工具栏新增**搜题框**——输入任意字段(中文/英文/公式片段)回车或点「搜索」,即返回题干中包含该字段的题目;搜索词以「」标签展示在工具栏,可一键 ✕ 清除。
- **后端**:`GET /api/questions` 的 `buildWhere` 新增 `?q=` 参数,对 `stem` 做 `contains` 搜索(SQLite LIKE,大小写不敏感),与其他筛选(状态/学科/知识点/难度/排序)可叠加。
- **验证**:`tsc --noEmit` 通过;本地验证 `sin`→5 题、`cos`→4 题、`函数`→1 题、`interval`→3 题、无匹配→0 题;大小写 `sin`/`Sin` 均命中 5 题。

## V2.3.3 (2026-08-09) — 审核队列「含图表」提示 + 编辑粘贴插入图表
- **功能 1 · 审核队列「含图表」提示**:题库管理/审核队列的状态列新增「含图表」徽标。`containsImage` 检测题干/选项/解析中内嵌的 Markdown 图片语法 `![alt](url)`,命中即显示琥珀色「含图表」标签(带 title 提示),审核时一眼识别图形题。零后端改动,复用已有数据形态。
- **功能 2 · 编辑粘贴插入图表**:题目编辑表单的题干/选项/解析三个 textarea 均支持**直接粘贴截图**——监听 `onPaste`,从剪贴板 `DataTransferItemList` 提取 `image/*` 文件,复用现有 `POST /api/uploads` 上传链路(磁盘 `/var/www/uploads` + nginx `/uploads/` alias),生成 `![图表](/uploads/xxx.png)` 插入光标处,并 `preventDefault` 防止图片被当文本粘贴。粘贴的图表经 `renderRich` 渲染链路,在题干/选项/解析、审核弹窗、学生端答题页均正常显示。
- **顺手增强**:题干 textarea 下方新增**题干预览**(实时渲染 `renderRich(stem)`),粘贴/编辑后立即看到公式与图表效果;上传逻辑重构为共用 `uploadAndInsert(file, field, ref)`(文件选择与粘贴共用)。
- **验证**:`tsc --noEmit` 通过;`containsImage` 6/6 用例(题干含图/选项含图/解析含图/纯文字题/URL 非图片语法/空题干)。
- **说明**:生产 nginx 已确认 `location /uploads/ { alias /var/www/uploads/; }` 生效(sites-enabled 软链 + `nginx -T`),上传目录由 `uploads.js` `mkdirSync(recursive)` 自动创建(root 权限)。

## V2.3.2 (2026-08-09) — 补强题库题干 `$` 字符外露修复
- **现象**:V2.3.1 上线后仍有部分题干显示 `$` 字符外露(`numbersx $.` 这类 `x` 后紧跟空格加 `$` 加 `.`)。
- **根因**:V2.3.1 新增的 `looksLikeTextInDollars` 兜底分支退回到文本 token 时仍用 `m[0]`(整段匹配,**含外层 `$` 字符**),导致被拦截 case 把 `$` 字符本身当文本渲染。任何被拦截的 `$...$`(内含 ≥2 个普通英文词)都会泄露 2 个 `$` 字符。
- **修复**(`apps/web/lib/rich.tsx` tokenize):退回文本时改用 `expr`(剥掉外层 `$`),仅把内部内容作为文本 token 推进。`$` 字符从此**不会再进入文本 token**。
- **回归**:本地构造 6 个触发 `looksLikeTextInDollars` 的样本(含典型 `$This is a regular sentence about numbers$`、中间分隔 `$sin x + 3 cos y across all real solutions$` 等),旧实现泄露 2-3 个 `$`,修复后 0 个。`verify:math` ERR 0,`tsc --noEmit` 通过。
- **Bug 库**:已登记 #24(行内公式 TOKEN_RE 退回分支的 `$` 字符必须剥掉,否则触发兜底即泄露)。
- **注意**:浏览器可能缓存 V2.3.1 的旧 rich chunk,验证时**务必硬刷新**(Cmd+Shift+R / Ctrl+Shift+R)才能看到 V2.3.2 效果。

## V2.3.1 (2026-08-09) — 修复题库题干公式分隔符 $ 外露/公式不渲染
- **现象**:题库中出现大量题干显示错乱——公式分隔符 `$` 直接外露为字符、LaTeX 命令(如 `\cos^2`)未渲染成公式,整段正文被误吞。
- **根因**:①PDF/导入数据常出现"开头 `$` 丢失、只留闭合 `$`"(如 `...cos^2 x$`)或"相邻两个块级公式 `$$...$$$$...$$`"的情况,原 `TOKEN_RE` 的 `\$([^$]+?)\$` 会把一段普通英文句子误配对进一个巨大的 `$...$` 公式;②smartMath 切词时 token 尾部残留零散 `$`,KaTeX 直接把它当字符显示或报错。
- **修复**(`apps/web/lib/rich.tsx`):
  - 新增 `looksLikeTextInDollars`:被 `$...$` 包裹的内容若含 ≥2 个普通英文单词(非 log/sin/cos/tan 等函数名白名单),判定为数据源零散 `$` 而非公式,退回为文本交 smartMath 自动识别真正的数学片段。
  - `isMathToken` 前先 `stripDollarArtifacts` 去掉 token 尾部零散 `$`(纯 `$` 串除外,避免误删货币/占位符)。
  - `smartMath` 前置清洗文本片段首尾零散 `$`;`flushMath` 渲染前把片段内残留 `$` 全部移除,避免 KaTeX 报错或 `$` 外露。
  - `isPureMath` 改用 `FUNC_NAMES` 白名单判定(与智能数学识别统一)。
- **回归**:`npm run verify:math` 通过(ERR 0);`npx tsc --noEmit` 通过;测试脚本 3 类畸形样本(孤立尾 `$`、`$$...$$$$...$$` 相邻块级、正文被吞)渲染后均无 `$` 外露、无 katex-error。
- **Bug 库**:已登记 `docs/MATH_RENDERING_BUGS.md` #23,并附回归样本与预防规则(改 TOKEN_RE/smartMath 必须同步三处)。

## V2.3.0 (2026-08-09) — 数值平衡与回归验证
- **新增离线平衡模拟器** `apps/api/scripts/balance_sim.mjs`（接入 `npm run verify:balance` 作为回归门禁）：复用真实战斗内核 `rogue-combat.js`/`rogue-skills.js`，原样复刻 `/answer`/`/tick` 结算编排，批量模拟完整对局，量化 28 个被动的强度曲线（胜率 vs 叠层），并用「弱/残酷」有胜率余量的画像做判别段（强/平均玩家胜率已触顶，无法区分）。
- **平衡修复（数值平衡）**：`p_extra_armor`(额外护甲, common) 原为 +25 固定护甲且无封顶，把每次敌人伤害都减到 ~1，使任意玩家胜率 2%→100%（必赢被动）。改为 +6/层且 `computeStats` 对 `playerArmor` 封顶 12。修复后：弱玩家 1 层叠 40%→叠 2/3 层 ~97%；残酷玩家 1 层 9%；不再是要赢按钮，仍是强力的普通防御被动（lift 均 +24%，为次强被动石化坚躯的约 1.6 倍）。
- **回归门禁**：被动表数量必须=28；强玩家基线胜率不可异常低；任一被动胜率不可为非有限/越界；新增「单 Passive 把弱玩家抬到 ≥95% 胜率」即判必赢被动回归。
- **验证**：`npm run verify:balance`(n=300) 全 PASS；强玩家基线 100%、平均 95%、弱 2.7%、残酷 0.3%；28 被动强度曲线已产出。生态跑随机三选一可通关（强 100%/平均 ~95%），无死被动（最弱被动在生态里仍有被需要）。
- **未改动的观察（待产品决策，未动数值）**：①攻击/法术/续航类被动对「挣扎型玩家」几乎无生存增益（属 win-more，仅帮助已存活者），如要兼顾弱生可后续让进攻被动附带少量生存；②平均/强玩家零被动即 ~93-100% 胜率，整体偏易，如需提高挑战可上调敌人 atk/血量或限时。

## V2.2.6 (2026-08-08) — 修复题库/练习等页面行内公式偏小
- **现象**:题库、练习、错题本等页面中,大量题目的行内公式、字母、数字(如 `$x^2 - 5x + 6 = 0$`、`$3$`)比 surrounding text 小一截;同一句话中 `$3$` 与正文 `4` 大小不一,视觉上忽大忽小/对不齐。
- **根因**:V2.2.5 修复 #21 基线对齐时,在 `apps/web/app/globals.css` 中给 `.math-inline .katex` 加了 `font-size: 1em !important`。KaTeX 数学字形本是按 1.21em 设计的,强制 1em 后公式视觉大小比正文小;且 `.math-inline` 是全局样式,所有走 `renderRich` 的页面(题库、练习、错题本、教师审核)均受影响。
- **修复**:移除 `.math-inline .katex { font-size: 1em !important }`,恢复 KaTeX 默认 1.21em;保留 `.math-inline { display:inline; vertical-align:baseline; overflow:visible }` 与内部 `.katex` 的 `display:inline; vertical-align:baseline`,继续保证基线对齐(#21)。
- **影响范围**:所有使用 `renderRich`/`smartMath` 的页面(冒险模式题干、题库、练习、错题本、教师审核弹窗)。
- **验证**:Playwright 复现题库真实题干,修复前 katex/正文字号比例 1.0(公式偏小),修复后 1.21(KaTeX 标准比例,与正文视觉大小协调);基线 deltaTop≈0 保持对齐;`tsc --noEmit` 通过;`npm run verify:math` 全题库扫描通过;登记 `docs/MATH_RENDERING_BUGS.md` #22。

## V2.2.5 (2026-08-08) — 行内公式基线再次修复
- **现象**：题干中单独的 `x` 变量和行内公式（如 `x - 3y + 1 = 0`、`3x² - 7xy = 5`）与 surrounding text 上下不齐，`x` 看起来像上标，公式整体偏高/偏低。
- **根因**：V2.2.4 的裸数字规则只解决了一部分问题；真正的 CSS 问题是 `.math-inline` 被包成 `inline-block` 并加了 `overflow-x-auto`。当 `overflow` 不为 `visible` 时，inline-block 的基线会落到块底部，导致 KaTeX 行内数学与正文基线错位，表现为 `x` 和公式上浮/下沉。
- **修复**：
  1. `apps/web/lib/rich.tsx`：行内数学包裹层只保留 `className="math-inline"`，去掉 `inline-block` / `align-baseline` / `max-w-full` / `overflow-x-auto` / `whitespace-nowrap` 等工具类。
  2. `apps/web/app/globals.css`：`.math-inline` 显式设为 `display: inline; vertical-align: baseline; overflow: visible;`，内部 `.katex` 同样 `display: inline; vertical-align: baseline;`。
- 影响范围：所有走 `renderRich` 的行内公式（题干、选项、解析）。超长行内公式暂时会自然溢出（可通过改写成 `$$...$$` 块级公式避免）。
- 验证：Playwright 复现用户截图句子，修复后 `x` 与公式均与正文基线齐平；`tsc --noEmit` 通过；`npm run verify:math` 全题库扫描 0 ERR / 9 WARN（既有 `0^\circ` 残留）；既有 130 项回归全过。

## V2.2.4 (2026-08-08) — 题干中裸数字基线偏移修复
- **根因**：`rich.tsx` 的 `smartMath` 把正文里的**裸数字**（如 "by **3** units" / "factor of **4**"）也判定为数学片段，交给 KaTeX 渲染成 `<span class="math-inline">`。KaTeX 数学字体的基线/字号与正文不同，导致这些数字微微上浮、和 surrounding text 不整齐。
- **修复**：`isMathToken` 不再把裸数字、裸运算符自动判为数学；改在 `smartMath` 里做**两阶段提升**：只有与真正数学片段（变量、函数、混合表达式等）相邻的裸数字/运算符，才被吸收进同一数学模式。这样 "by 3 units" / "factor of 4" 里的数字保持正文，"x = 3" / "x^2 + 1" 仍统一按数学渲染。
- 影响范围：题干、选项、所有走 `renderRich` 的文本。学习类题目中大量英文 prose 里的普通数字不再出现基线偏移。
- 验证：新增 `_verify_rich.mjs`（41 项断言）；静态 HTML + Playwright 新旧对比截图确认 "3"/"4" 不再上浮；`tsc --noEmit` 通过；既有 130 项回归全过。

## V2.2.3 (2026-08-08) — 冒险模式左侧题干显示不完整修复
- **根因**：App Shell 的 `<main>` 使用 `max-w-5xl`（1024px），导致冒险模式三栏布局被硬塞进 1024px 宽度；左侧题干列实际可用宽度仅约 **267px**，长题干严重换行、数学公式横向溢出，用户感觉就是"显示不完整"。
- **修复**：① 学生端 App Shell 的 header/main 从 `max-w-5xl` 放宽到 `max-w-7xl`（1280px），题干/选项列在宽屏下更充裕；② 冒险模式三栏→单栏的断点从 860px 提高到 **1100px**，中等宽度屏幕（如 1024–1280px 笔记本）直接改为「舞台在上、题干/选项全宽在下」，避免题干被挤成窄条；③ `rich.tsx` 给行内公式加 `max-w-full overflow-x-auto`，超长公式横向滚动而不溢出覆盖相邻列。
- 验证：Playwright 复现显示题干列从 267px 提升到约 340px（1280px 视口），1000px 视口正确切换为单栏全宽；`tsc --noEmit` 通过，130 项既有回归全过。

## V2.2.2 (2026-08-08) — 答题「第一次点击没反应、第二次才成功」修复
- **根因（反馈窗口无视觉反馈，导致误以为点击丢失）**：答题后前端有约 900ms 的"已作答"锁定窗口，期间选项只是整体变灰并 `disabled`，而"答对/答错"反馈横幅在左侧战斗舞台、用户在右侧选项区看不到。于是用户以为第一下点击没生效，又点了一下——这一下被 `disabled` 吞掉；等约 900ms 后新题出现，第二次点击才落到新题上生效。表现为**每题都"第一次没反应、第二次才成功"**。
- **修复**：① 服务端 `/answer` 响应新增 `correctAnswer`（正确答案文本，学习类游戏作答后回显属正常）；② 前端在**选项按钮本身**上直接着色——答对时正确项显示绿色「✓ 正确」，答错时用户所选显示红色「✗ 你的选择」、其余变灰；③ 提示语在作答后改为「已作答，换题中…」。现在第一下点击的效果立刻可见，用户不会再重复点击。
- 说明：该现象并非真正的点击丢失（无遮挡浮层、无表单提交吞事件），而是反馈窗口的可见性不足造成的误判；着色后窗口语义清晰。
- 验证：`tsc --noEmit` 通过；部署后远端 e2e 确认 `/answer` 返回 `correctAnswer` 且等于所选选项的文本。

## V2.2.1 (2026-08-08) — 冒险模式「怪物突然消失 + 完全没反应」卡死修复
- **主因（前端换题误清空战斗视图）**：答对/超时换题时调用 `applyNode({ nodeType, question })` 没有带 `combat` 字段，而 `applyCombatView` 遇到缺失字段会当成"没有战斗"直接清空敌人列表。表现为答题约 0.9 秒后**画面里的怪物整批消失**、倒计时条一并消失。
- **连锁后果（心跳自杀，从此永久停摆）**：心跳守卫写的是 `if (!combatRef.current) return`，战斗视图一被清空，每秒心跳就再也不发出去 —— 敌人不再攻击、倒计时不动、超时不判定，整局**完全没反应**。
- **修复**：① `applyCombatView` 改为只在响应"显式包含 combat 字段"时才更新，字段缺失一律保持原状，只有显式 `null`（奖励节点/停战）才清空；② 三处 `applyNode` 调用点全部补传 `combat`；③ 心跳守卫去掉 `!combatRef.current` 这条自杀分支，战斗视图丢失时**照常发心跳**由服务端回填，可自愈。
- **次因一（反馈锁泄漏，选项永久禁用）**：`submit` 在设置 `feedbackRef=true` 之后若任何一步抛异常，`catch` 只弹错误提示、不复位反馈锁，导致所有选项 `disabled` 且心跳被反馈锁拦截，整局假死。现在异常路径强制复位反馈锁，并新增 3 秒看门狗兜底自动解锁。
- **次因二（后端缺题时被看不见的敌人打死）**：题库取不到下一题时，`/answer` 与 `/tick` 只是不重置计时窗口，导致 `isTimedOut` 恒为真、每秒心跳都判超时重击，玩家在"缺题面板"界面被持续扣血直到死亡。现在取不到题一律 `items.combat = null` 停战。
- **健壮性**：`combat.enemies` 渲染前做数组校验，脏数据降级为空而不是抛异常白屏；换题定时器改为受管引用并在卸载时清理；连续 5 次心跳失败弹出网络提示，避免玩家误以为是游戏卡死。
- 回归：新增 `_verify_bug_stall.mjs`（含旧实现对照组，确保能复现原 bug）23 项断言；连同既有 4 套脚本共 **130 项全部通过**。

## V2.2 (2026-08-08)
- **冒险模式被动技能表现层**：V2.1 的被动系统此前只有后端数值、前端完全看不见，本版把它全部可视化。
- **已习得被动清单**：HUD 新增「被动 N 项 · 共 M 层」折叠面板，芯片按四棵树配色（攻击红/法术紫/防御蓝/续航绿）、稀有度分级（稀有内描边、史诗金光），可叠加被动显示 `×N` 层数；展开后每条附完整效果说明。
- **实时状态条**：由 `passiveStats` 折算出当前真正生效的效果并逐个显示图标——临时护盾（呼吸动画，显示可吸收数值）、减伤/护甲/闪避/反弹、钢铁意志剩余次数、濒死守护待发、物理/法术增伤、暴击率与暴伤倍率、破甲、吸血、冥想回蓝、生命奔流、魔力屏障、蓝焰灼烧、魔力过载（蓝量归零时变灰显示「熄火」）、魔力血祭。
- **虚空魔弹主动释放按钮**：拥有该史诗被动后 HUD 出现专属按钮，展示耗蓝与冷却剩余拍数，蓝量不足或冷却中自动置灰；释放后全场敌人跳 `🌌伤害` 飘字并闪白。
- **升级三选一改为被动卡**：卡片显示稀有度徽章、所属树、完整描述，以及「新获得 / 叠加至 N 层」；卡面按树配色，史诗卡带金色辉光。
- **战斗事件全量可视化**：新增消费 `splash`（分裂斩 `⚔`）、`spell_splash`（元素爆裂 `💥`）、`scatter`（散射 `✦`）、`burn`/`burn_apply`（灼烧 `🔥`）、`reflect`（反弹 `↩`）、`barrier`（屏障提示）、`lifesteal`/`lifeflow`（绿色回血数字）；敌人被击闪避/格挡/钢铁意志分别显示对应飘字。灼烧中的敌人挂 🔥 标记并带橙色辉光。
- **后端小补丁**：`combatView` 增加 `burning`/`burnLeft`；`extraState` 增加 `tempShield`/`voidCdUntil`/`ironWillUsed`/`deathGuardUsed`；生命奔流回血补发 `lifeflow` 事件；新增 `GET /roguelike/meta/passives` 被动图鉴接口（前端不再维护第二份技能清单，避免前后端漂移）。
- 全部新样式兼容「减少动效」开关与系统 `prefers-reduced-motion`，并做了窄屏适配。

## V2.1 (2026-08-08)
- **冒险模式「30 个被动技能系统」**：升级三选一改为提供被动技能（替换原主动技能三选一）。被动按四棵树分类——攻击类（数学/物理→物理伤害）、法术类（化学/生物→法术伤害）、防御生存类、续航恢复类；三档稀有度 common/rare/epic（抽卡权重 3:2:1），可叠加标记允许重复获得线性增强。
- **攻击类**：猛攻(物理+20%/层)、破甲打击(无视35%护甲/层)、分裂斩(近战溅射50%打前方多敌/层)、致命一击(12%暴击·170%暴伤/层)、血刃狂攻(每损失10%生命物理+8%/层)。
- **法术类**：魔力涌动(法术+22%·最大蓝+15/层)、快速咏唱(冷却-20%·蓝耗+10%/层)、法力弹散射(额外2发副弹40%)、魔力回涌(击杀回8蓝/层)、元素爆裂(法术范围爆炸50%)、蓝焰灼烧(灼烧3秒·30%法术伤害DoT)、虚空魔弹(耗30蓝穿透全场·冷却8秒，新增 `/use-passive` 手动释放)、魔力过载(法术+40%但每秒耗5蓝·蓝归零失效)。
- **防御生存类**：铁皮体魄(减伤15%/层)、额外护甲(+25护甲/层)、迅捷闪避(8%闪避/层)、钢铁意志(致命伤保留1血·一局3次)、魔力屏障(耗15蓝生成=最大蓝25%护盾·每8秒刷新)、反弹外壳(近战反弹25%伤害)、石化坚躯(减伤+30%)、濒死守护(血量<20%瞬发大额临时护盾·一局一次)。
- **续航恢复类**：强健体质(最大生命+35/层)、冥想(每战斗秒回4蓝/层)、吸血打击(物理命中吸3%转生命/层)、血食(击杀回6生命/层)、生命转换(击杀回12蓝但不再回生命)、生命奔流(每2秒回4%最大生命·受伤暂停3秒)、魔力血祭(停止自然回蓝·吸血额外回等量法力·吸血效率+50%)。
- **内核接入**：`computeStats(passives)` 纯聚合折算 phys/spell/def/sustain 四类数值；伤害按学科选物理/法术倍率（化学/生物走法术，其余走物理）；`damageEnemy` 支持破甲穿透、`damagePlayer` 接入减伤/护甲/闪避/临时护盾/钢铁意志/濒死守护、`simulate` 接入冥想回蓝/过载耗蓝/生命奔流/魔力屏障刷新/反弹/灼烧DoT。获得被动即时结算最大生命与最大蓝。后端已完成，前端被动可视化见 V2.2。

## V2.0 (2026-08-08)
- **冒险模式改为「即时制」战斗（时间流逝机制）**：把原来的回合制改成实时战斗，逼迫学生又快又准。
- **后端即时制内核**：客户端每秒发一次心跳带时间戳，服务端按「真实流逝时间（钳制 3 秒）」推进战斗节拍并结算敌人自动攻击与超时，服务端权威、防挂机偷时间与加速作弊。战斗节拍归一化——每道题固定 60 个「战斗秒」窗口（1 战斗秒 = 该题真实限时 / 60），TMUA 长题与 ESAT 短题战斗压力一致；超时判定用真实时间（切后台不能偷时间），战斗结算用节拍 + dt 钳制（切后台不会被暴毙）。
- **答题限时**：TMUA 2–5 分钟、ESAT 0.5–2 分钟、其他学科 45 秒–2.75 分钟（均随难度线性递增），Boss 题 ×1.2，测试模式固定 20 秒。超时提交一律判落空并挨 1.5 倍重击。
- **速度伤害倍率**：前 30% 限时答对 = 完美出手 ×1.5，30–60% = 迅捷出手 ×1.25，否则普通出手 ×1.0；得分同样吃倍率——又快又准才是高分。
- **多敌人**：普通节点 1–5 只敌人加权随机（多数 1–2 只），Boss 单体；答题即出手（敌人实体化有血条），答对造成伤害、答错落空且敌人立刻反击，打光全队敌人才推进层数。
- **前端实时 UI**：1 秒心跳 + 100ms 本地渲染循环；答题倒计时条（完美/迅捷/普通三档区间色块 + 标记线推进 + 实时秒数 / 当前档位提示）；多敌人同屏、各自血条 + 攻击蓄力预警环（本地按剩余时间推算、平滑不抖）；敌人命中飘字、前扑动画、受击闪白、超时红屏闪烁；完整兼容「减少动效」开关与系统 `prefers-reduced-motion`。

## V1.8.4 (2026-08-08)
- **血量数值化 + 随机伤害/回复**：起始 HP/上限 = 100（`.hud-hp` 由 100 个 pip 改为百分比血条）。答错随机扣血 12–22；答对随机回血 5–10。治疗药水(12-21/26-39)、治疗术/生命涌动(14-21/26-39)、连击回复(6-12)、奖励节点(6-12) 全部改为带随机性的数字回复；护甲生命上限 +10/+18/+28。回答后左侧反馈显示具体「受到 X 点伤害 / 回复 X 点生命」，并在 HUD 上方浮出红/绿战斗数字（减少动效时跳过）。

## V1.8.3 (2026-08-08)
- **答题版面改为整屏三栏**：按用户纠正——题干在**整个屏幕左侧（战斗画面左侧）**、选项在**整个屏幕右侧（战斗画面右侧）**，中间是战斗画面（舞台 + HUD）。`.battle-layout` 三栏网格（`1fr / 1.5fr / 1fr`，最大宽 1400px）；窄屏(≤860px)自动堆叠为「战斗画面在上、题干、选项在下」。点击选项即自动提交不变。

## V1.8.2 (2026-08-08)
- **答题版面重设计**：题干移到屏幕左侧、选项移到右侧（`.rogue-question.q-split` 两栏网格，窄屏自动上下堆叠）；**取消「提交答案」按钮，点击选项即自动提交**。答对/答错反馈显示在题干下方，作答揭示期间选项锁定防重复提交。

## V1.8.1 (2026-08-08)
- **修复测试模式不生效**：`/start` 续局时原本只看「有没有 ACTIVE 对局」、完全忽略 `test` 标志，导致用户已有进行中的普通模式冒险时，打开测试模式开关点开始仍被续上旧局（题目不变）。改为按模式匹配续局——测试模式续测试局、普通模式续普通局，两者各自保留进度、互不干扰。

## V1.8 (2026-08-08)
- **冒险模式「测试模式」**：设置页新增「🧪 测试模式」开关；开启后本次冒险所有题目固定为 `1+1=?`（选项 A=2 / B=3，答案为 A），便于快速验证 UI 与战斗流程（掉落/升级三选一/装备/技能/护盾/通关），无需依赖真实题库。
- 实现：后端 `/start` 接收 `test` 标志并存入 `run.items.test`；`pickQuestion` 在测试模式下直接返回合成固定题（`id=TEST_Q`），`/answer` 与提示路径（物品提示 / 专注技能）均走测试题，判分 `selected="2"` 判对、`"3"` 判错；前端设置页加开关、playing 阶段显示「🧪 测试」标识。

## V1.7 (2026-08-08)
- **冒险模式视觉大升级（怪物放大 + 实景环境背景）**：
  - 怪物源图放大：enemy_a~e 由 64×64 用最近邻 4× 上采样至 256×256（保持像素锐利不糊），boss2/boss3 由 24×24 升至 96×96；显示尺寸大幅提升（普通敌人 64%/360px、Boss 82%/520px），并加 `max-height:64vh` 防止溢出，保留 `image-rendering:pixelated` 复古质感。
  - 环境背景接入 AI 生成实景图：森林/海洋/山地/熔岩四张扁平矢量风格背景（1216×832）替换原纯 CSS 渐变，`zone-*` 类改为「实景图 + 色调叠加渐变」双层（保证文字可读），按关卡分区（森林≤5/海洋≤10/山地≤15/熔岩>15）。
  - 环境装饰放大：deco 由 56px/opacity 0.5 放大到 92px/0.72 并下移至 6%；移动端舞台高度与精灵/装饰尺寸同步自适应。
- 纯前端/CSS + 素材改动，无 API / 数据库变更。

## V1.6 (2026-08-08)
- **冒险模式战斗系统大升级**：
  - 舞台氛围强化：怪物改用更大精灵（64px oobi 系列按层循环）、玩家第一视角手持武器（随装备切换剑/枪/弓）、敌人攻击动画（答错前扑+震屏）、按关卡分区背景色调（森林绿/海洋蓝/山地灰/熔岩红）+ 森林/海洋/山地环境装饰素材。
  - 装备：武器(每答对加分)/护甲(+生命上限)/饰品(+蓝上限/回蓝)，可点击穿戴到身上，HUD 显示已穿戴小画面。
  - 物品：恢复/攻击(下次必中)/防御(护盾)/辅助(提示)，点击使用。
  - 技能：分级、耗蓝，攻击/恢复/防御/辅助，升级时三选一获得。
  - 蓝条：答对回蓝，技能消耗蓝量。
  - 掉落：消灭怪物随机掉落装备或物品（Boss 必掉装备）。
- 新素材（Kenney CC0）：platformer-kit / mini-dungeon / mini-forest / cube-pets 包，见 `public/images/rogue/LICENSE.txt`。
- 全部战斗状态存于 Run.items JSON，无需改数据库 schema。

## V1.5.3 (2026-08-08)
- **冒险模式布局重构(三段式游戏界面)**:顶部大舞台显示环境背景 + 第一视角敌人(Boss 大图 + 红色暗角氛围 + 名称牌,普通敌人小图),中下部 HUD 显示生命条/连对/得分/金币/装备(技能)按钮,底部为答题区。
- 修复答错震屏:此前 `key={shake}` 未挂 `shake` 类导致屏幕震动从未触发,现挂在舞台容器上并在每次答错重新触发。
- 低血量危险红边移至舞台 + HUD 生命条脉冲,移动端舞台高度/精灵尺寸自适应。

> 版本号规则：功能/修复上线即升版本号（V1.0 → V1.1 → ...）。
> 版本号同步维护三处：根目录 `VERSION` 文件、`apps/web/lib/version.ts`、本文件。
> 每次发布必须在本文件顶部追加一条记录（日期 + 版本 + 变更摘要）。

## V1.5.2 (2026-08-08)
- 「冒险模式」热修复：通关 Boss 战 500 错误（「Boss 战怎么没了」）。
  - **根因**：`/api/roguelike/:runId/answer` 中 `runOver` 被声明为 `const`，但在通关分支（第 20 层 Boss 答对后 `layer > MAX_LAYER`）执行 `runOver = true` 给常量赋值，抛出 `TypeError: Assignment to constant variable`，导致无法通关。
  - **修复**：`runOver` 改为 `let`（该分支此前一直存在，但只有真正打到通关才触发，所以选「物理」卡加载、选「数学」玩到 Boss 才暴露）。
  - 后端 `node --check` 通过；远程完整 playthrough 实测 layer 5/10/15/20 均正常生成 boss 节点，第 20 层答对可正常 `WON`。

## V1.5.1 (2026-08-08)
- 「冒险模式」热修复：卡在「加载题目中…」
  - **后端抽题增强**：`pickQuestion` 在精确难度无题时，按 ±1/±2…回退查找，最终回退到该学科全部难度；避免化学/ESAT 等题库较少时无法出题。
  - **缺题明确报错**：`/roguelike/start` 若当前学科/难度无可用题目，返回 `400` 并提示「该学科/难度暂无可用题目，请选择其他学科」；新创建的无效 run 会被自动删除。
  - **前端缺题兜底**：`playing` 状态下 question 为 null 时不再显示「加载题目中…」，改为显示「该学科/难度暂无可用题目，请更换学科或结算后重试」，并提供「返回设置」/「结算本次冒险」按钮。
  - **可放弃进行中的冒险**：setup 页「你有进行中的冒险」提示下增加「放弃当前冒险」按钮，便于用户从异常学科中恢复。
  - 前端 TS 检查通过，后端 `node --check` 通过。

## V1.5 (2026-08-08)
- 「冒险模式」Phase C 打磨：
  - **多 Boss/敌人素材**：每 5 层不同 Boss(巨眼魔像/血翼蝠王/暗影蝠王/灭世魔像)，普通敌人 3 档进阶(火焰怪→绿外星→粉外星)，横幅显示 Boss 名，Kenney CC0 素材扩展 4 张。
  - **体验设置**：setup 页「✨ 粒子特效」「🔊 音效」开关，localStorage 持久化(`rogue_fx_reduced`/`rogue_sfx_muted`)；关粒子时跳过 Canvas 爆发/横幅/幕布/金币雨/震动(纯 CSS 常驻动画经 `.fx-reduced` 容器禁用)。
  - **移动端性能**：粒子数按 `prefers-reduced-motion`(→1/4)/宽<480(→0.4)/宽<768(→0.65) 自动降级，最少 8 个保证有反馈；`@media (prefers-reduced-motion: reduce)` 全局禁用常驻动画。
  - **粒子调优**：confetti 120→100、coins 45→40、gold/red 65→60；banner 移动端字号/位置适配。
  - 零新依赖，可回滚。

## V1.4 (2026-08-08)
- 「冒险模式」Phase B 事件特效：
  - **Boss 战氛围**：红色暗角背景叠加 + 像素 Boss 头像(光晕浮动) + 「⚔ BOSS 出现了!」横幅 + 「🏆 BOSS 击破!」横幅 + 低鸣 boss_appear 音。
  - **奖励节点强化**：卡片持续金币雨(CSS emoji 双层错落) + 「🎁 奖励已领取!」横幅滑入。
  - **通关结算**：WON 时全屏彩带幕(conic-gradient 双层反向旋转) + 大横幅「🏆 通关!」 + 升调 victory 音。
  - **死亡暗幕**：DEAD 时 radial 渐变暗幕渐入。
  - **Kenney CC0 美术素材**：`boss.png`(棕色大怪物)/`enemy.png`(橙色火焰小怪) 来自 Kenney Pixel Platformer，24×24 像素 + `image-rendering: pixelated` 放大锐利，附 CC0 LICENSE。
  - 零新依赖(纯 CSS + 现有 Web Audio + Kenney 公开素材)，零侵入可回滚。

## V1.3 (2026-08-08)
- 「冒险模式」Phase A 特效：
  - **Web Audio 合成音效**（零素材）：答对叮、连击升调（combo 越高音越高）、答错、护盾、奖励金币声、Boss 低音轰鸣、死亡下行音。
  - **Canvas 粒子**：答对金色爆发、答错红色、奖励金币雨、Boss 击败彩带，DPR 自适应。
  - **氛围**：深色星空渐变背景 + 流动光；连击 ≥3 火焰跳动 + 数字脉冲；答错屏幕震动；低血量血条警示；卡片 pop-in、奖励礼物盒弹跳。
  - 零新依赖（纯 CSS keyframes + Canvas + Web Audio），可整体回滚。

## V1.2 (2026-08-08)
- 「冒险模式」二期：
  - **道具系统**：护盾(答错抵挡)/药水(回血)/跳过(直接推进)/提示(排除 2 个错误选项)；连击 3/5/10 与普通题随机掉落；`/api/roguelike/use-item` 后端权威扣减。
  - **Boss 薄弱点联动**：每 5 层 Boss，优先从学生错题本抽题，击败给金币+药水。
  - **奖励节点**：每 3 层不答题直接领奖励(金币/概率回血/药水)，`/api/roguelike/claim`。
  - **断线存档**：`/api/roguelike/active` + 进入页面提示继续上次冒险。
  - 地图节点序列 `{ answered, inventory, map }` 存入 items(兼容一期纯数组)。

## V1.1 (2026-08-08)
- 新增「冒险模式」（Roguelike 一期）：线性爬塔 + 连续正确(combo)激励 + 血量 + 结算页。
- 后端：`RoguelikeRun` 表 + `/api/roguelike` 路由（start/answer/get/quit），判分复用现有逻辑、进度后端权威计算。
- 前端：学生端新增 `/app/roguelike` 页面与导航入口；答题渲染复用 `renderRich`。
- 修复：显示类问题一批（#16-#20，详见 `docs/MATH_RENDERING_BUGS.md`）。

## V1.0 (2026-08-08)
- 初始版本基线（版本管理建立时固化）。
- 已有能力：题库管理（学科 Tab/知识点/难度筛选/排序）、知识点库（四门学科）、PDF/Excel/Word/JSON 批量导入（含自动知识点归类）、试卷管理（手动组卷/套题自动成卷/审核流程）、学生练习/模拟考（试卷时长强制、倒计时自动交卷）、错题本、成绩统计/雷达图、面试练习、学生管理。
- 修复：历史渲染 Bug #1-#15（见 `docs/MATH_RENDERING_BUGS.md`）。
