# API 契约文档 — 金瑞升学金鹰系统(TMUA / ESAT)

> 本文件是前后端对齐的**唯一依据**。任何接口变更必须先更新此处,再实现代码。
> 契约演进:基础地址 `/api`(开发环境前端代理到 `http://localhost:4000`)。

## 约定

- 数据格式:`JSON`;鉴权:`Authorization: Bearer <token>`(注册/登录后返回 JWT)
- 统一响应结构:

```json
{ "code": 0, "message": "ok", "data": {} }
```

| code | 含义 |
|------|------|
| 0 | 成功 |
| 400 | 参数错误 |
| 401 | 未认证 / token 无效 |
| 403 | 无权限(角色不符) |
| 404 | 资源不存在 |
| 500 | 服务器内部错误 |

## 枚举值

- `subject`: `TMUA` | `ESAT`
- `role`: `STUDENT` | `TEACHER` | `ADMIN`
- `mode`: `PRACTICE` | `EXAM`
- `status`: `DRAFT` | `PUBLISHED` | `ARCHIVED`
- `type`: `SINGLE_CHOICE` | `MULTIPLE_CHOICE` | `NUMERIC`
- 判分规则:答对 +1,答错 0 分(不扣分)

## 一、认证

### 1.1 注册 `POST /api/auth/register`

```json
{ "email": "stu@example.com", "password": "123456", "name": "张三" }
```

> 公开注册仅创建学生账号(STUDENT);老师/管理员账号由管理员创建。

返回 `data`: `{ token, user: { id, email, name, role } }`

### 1.2 登录 `POST /api/auth/login`

```json
{ "email": "stu@example.com", "password": "123456" }
```

返回同上。

### 1.3 当前用户 `GET /api/auth/me`(需认证)

返回 `data`: `{ id, email, name, role, targetUniversity }`

## 二、题库(老师可写,学生可读已发布题目)

### 2.1 题目列表 `GET /api/questions?subject=&topic=&difficulty=&status=PUBLISHED`

学生默认只看 `PUBLISHED`;老师可传 `status` 看全部。分页:`page`/`pageSize`。
返回 `data`: `{ list: [...], total }`(列表不返回 `answer`/`solution`,详见 2.3)

### 2.2 题目详情 `GET /api/questions/:id`

学生仅可查看已发布题目;老师任意。返回 `data`: Question 全量(含 `answer`/`solution`)。

### 2.3 创建题目 `POST /api/questions`(需老师/管理员)

```json
{
  "subject": "TMUA", "paper": "Paper 1", "topic": "代数",
  "difficulty": 3, "type": "SINGLE_CHOICE",
  "stem": "题干(支持 LaTeX)", "options": ["A", "B", "C", "D", "E"],
  "answer": "A", "solution": "解析",
  "source": "TMUA 2022 Paper 1", "status": "PUBLISHED"
}
```

### 2.4 更新题目 `PUT /api/questions/:id`(需老师/管理员)

### 2.5 删除题目 `DELETE /api/questions/:id`(需管理员)

### 2.6 批量导入 `POST /api/questions/import`(需老师/管理员)

支持两种格式(任选其一):
- `items`:JSON 数组 `[{ subject, paper, topic, difficulty, type, stem, options[], answer, solution, source, status }]`
- `csv`:CSV 文本(首行为表头,列顺序 `subject,paper,topic,difficulty,type,stem,options(分号分隔),answer,solution,source,status`)

返回 `data`: `{ imported, failed, errors: [{ row, reason }] }`

## 三、试卷与组卷

### 3.0 组卷 `POST /api/papers/generate`(需老师/管理员)

```json
{ "title": "TMUA 代数专项", "subject": "TMUA", "mode": "PRACTICE", "durationMin": 40,
  "topics": ["代数"], "difficulties": [2,3], "count": 10 }
```

按条件随机抽题生成试卷。返回 `data`: `{ id, title, subject, mode, durationMin, questionCount }`

### 3.0.1 试卷列表 `GET /api/papers`(需认证)

### 3.0.2 试卷详情 `GET /api/papers/:id`(需认证,题目不含答案)

## 三、答题会话


### 3.1 创建会话 `POST /api/sessions`(需学生)

```json
{ "mode": "PRACTICE" | "EXAM", "paperId": "可选", "questionIds": ["可选"], "durationMin": 40 }
```

- `EXAM` 模式(模拟考)必须指定 `durationMin`(分钟),超时后后端拒绝继续作答
- 后端按规则组卷(未指定则从已发布题目中随机抽取,`limit` 控制题量)
- 返回 `data`: `{ sessionId, mode, durationMin, questions: [不含答案] }`

### 3.2 保存单题作答 `POST /api/sessions/:id/answer`

```json
{ "questionId": "q1", "selected": "B", "timeSpent": 42 }
```

实时保存(草稿态),不判分。可重复提交覆盖。

### 3.3 提交判分 `POST /api/sessions/:id/submit`

对全部已作答题目判分,记录成绩、写错题本。超时提交也允许(带 `timedOut: true` 标记)。返回 `data`:

```json
{
  "score": 12, "total": 20, "correctCount": 12, "timedOut": false,
  "details": [{ "questionId": "q1", "selected": "B", "isCorrect": false }]
}
```

### 3.4 会话详情 `GET /api/sessions/:id`

含逐题对错与解析(仅本人或老师)。

### 3.5 上报分段停留 `POST /api/sessions/:id/visits`

用于记录**「一题多段」**:学生在同一道题上分多次进入停留(想了几分钟没作答 → 离开 →
过一阵子又回到这道题再作答),每一次停留单独成段上报。仅本人可写;已交卷的会话拒绝写入。

```json
{ "questionId": "q1", "visits": [[1758600000, 42], [1758600300, 18]] }
```

- `visits`:数组,每项为 `[startEpochSec, durationSec]`
  - `startEpochSec` —— 该段的**开始时刻**(Unix **秒**;前端以服务端校准时钟 `serverNow()` 为准)
  - `durationSec` —— 该段停留秒数(整数,`>= 0`;前端丢弃 `< 2` 秒的毛刺段)
- **全量覆盖**语义:服务端用本次提交的数组**整体替换**该题已有的 `visits`(不是追加)。
  前端持有该题的完整分段列表,重复提交同一份数据结果一致(幂等)。
- **只写 `visits`**:不触碰 `selected` / `isCorrect` / `timeSpent`。
  若该题尚无作答记录,会为其**新建一条**(`selected`/`isCorrect`/`timeSpent` 保持 `null`),
  因此**不影响「未作答」判定**(仍以 `timeSpent == null` 为准,见 6.2)。
- 上限:单题最多保留 `200` 段,超出时**保留最晚的 200 段**并在响应中回 `truncated: true`;
  单次请求 `visits.length > 1000` 视为异常载荷,返回 `400`。
- 考试超时后**仍允许**上报(属埋点数据而非作答),但会话一旦 `submittedAt` 非空即拒绝。

返回 `data`: `{ questionId, segments, truncated }`(`segments` = 落库后的段数)

## 四、成绩与错题本

### 4.1 我的成绩历史 `GET /api/me/sessions?mode=`

返回 `data`: `{ list: [{ sessionId, mode, score, total, correctCount, submittedAt }] }`

### 4.2 我的错题本 `GET /api/me/wrongbook`

返回 `data`: `{ list: [{ questionId, topic, wrongCount, mastered, stem }] }`

### 4.3 标记掌握 `POST /api/me/wrongbook/:questionId/master`

### 4.4 我的掌握度 `GET /api/me/stats`

返回 `data`: `{ byTopic: [{ topic, attempts, correctRate }] }`

## 五、老师学情(需老师/管理员)

### 5.1 学生列表与成绩概览 `GET /api/teacher/students?search=`

返回 `data`: `{ list: [{ id, name, email, sessionCount, avgRate, lastSession }] }`(按平均正确率降序)

### 5.2 学生详情 `GET /api/teacher/students/:id/stats`

返回 `data`: `{ student, sessions: [...], byTopic: [{ topic, attempts, correctRate }] }`

### 5.3 班级学情总览 `GET /api/teacher/stats/overview`

返回 `data`: `{ students, sessions, totalAnswered, byTopic: [按正确率升序,薄弱在前] }`

## 六、考试管理与考情分析(需老师,且仅本人创建的考试)

### 6.1 考试考情总览 `GET /api/exams/:id/analysis`

返回 `data`: 该场考试的整体统计(参考人数、得分分布、逐题正确率等)。

### 6.2 单个学生考情明细 `GET /api/exams/:id/student/:studentId`

用于教师端「考试管理 → 考情分析 → 查看明细」弹窗。

返回 `data`:

```jsonc
{
  "student": {
    "studentId": "cuid",
    "name": "张三",
    "email": "a@b.com",
    "score": 14,              // 可与 null
    "total": 20,
    "correctCount": 14,
    "startedAt": "2026-09-23T01:00:00.000Z",   // 会话开考墙钟时间
    "submittedAt": "2026-09-23T02:00:00.000Z"  // 交卷墙钟时间(可能为 null)
  },
  "perQuestion": [
    {
      "index": 1,             // 题号,从 1 起,按试卷 questionIds 顺序
      "questionId": "cuid",
      "timeSpent": 42,        // 该题累计停留秒数;未作答为 null
      "isCorrect": true,      // 未判分/未作答为 null
      "selected": "B",        // 学生所选选项文本;未作答为 null
      "answeredAt": "2026-09-23T01:12:30.000Z", // ★ 该题「首次保存作答」的服务端时刻(ISO 8601);无记录为 null
      "visits": [             // ★ 该题的分段停留(一题多段);无采集数据为 null
        { "start": "2026-09-23T01:08:00.000Z", "end": "2026-09-23T01:08:42.000Z", "seconds": 42 },
        { "start": "2026-09-23T01:13:00.000Z", "end": "2026-09-23T01:13:18.000Z", "seconds": 18 }
      ],
      "topic": "代数",
      "difficulty": 3
    }
  ],
  "wrongQuestions": [
    {
      "index": 3, "questionId": "cuid", "stem": "...", "options": ["..."],
      "answer": "...", "solution": "...", "topic": "...", "difficulty": 3,
      "selected": "A", "timeSpent": 55
    }
  ]
}
```

**`answeredAt` 字段语义(2026-09-23 新增,向后兼容)**

- 取自 `AnswerRecord.createdAt`,即该题**首次保存作答**的服务端时刻。
  依据:`POST /api/sessions/:id/answer` 使用 `upsert`,仅 `create` 分支写入 `createdAt`,
  学生后续修改答案走 `update` 分支,**不会刷新** `createdAt`。
- 交卷时后端对**未作答**题 `createMany` 补记录(见 `sessions.js` 提交逻辑),
  这类记录的 `answeredAt` 等于交卷时刻且 `timeSpent` 为 `null` ⇒ 前端应以
  **`timeSpent == null` 判定「未作答」**,不要把其 `answeredAt` 当作真实作答时刻。
- 配合 `timeSpent` 可近似还原每题作答区间:
  `区间 ≈ [answeredAt − timeSpent, answeredAt]`,再按 `startedAt` 左夹紧。
- 若考试中途触发暂停(`POST /api/sessions/:id/pause`),墙钟跨度
  `submittedAt − startedAt` 会包含离线时长,时间轴出现空白属预期。

**`visits` 字段语义(2026-09-23 新增,向后兼容)**

- 取自 `AnswerRecord.visits`(JSON `[[startEpochSec, durSec], ...]`,由
  `POST /api/sessions/:id/visits` 写入),此处换算为 ISO 8601。
- 每项表示学生**一次进入该题的连续停留**:`start` 为进入时刻、`end = start + seconds`、
  `seconds` 为该段停留秒数。同一题出现多段 = 学生中途离开过又回来。
- **同题多段之间可能夹着别的题**:时间分配甘特图按**全局时间段**铺轴
  (各段按开始时刻排序、首尾相接填满整轴),因此同一题的多段会落在**同一行不同 x 位置**,
  与其它题的段交错出现 —— 这正是「一题多段」要表达的形态。
- 回看/暂停/切后台期间的时间**不计入** `seconds`(前端在页面隐藏时即结束当前段)。
- **向后兼容**:2026-09-23 之前采集的老会话 `visits` 为 `null`,前端回退到
  `区间 ≈ [answeredAt − timeSpent, answeredAt]` 合成**单段**(渲染结果与旧版一致)。
- ⚠️ `visits` 各段之和与 `timeSpent` **允许有差异**,原因有三,均属预期而非缺陷:
  ① 丢弃 < 2 秒的毛刺段(误触切换/开发模式双挂载);② 以服务端校准时钟分段;
  ③ **会话跨版本或跨标签页** —— 分段采集自本版上线(2026-09-23)起,
  若同一会话此前曾在旧版前端或另一个标签页作答过,那部分停留不会出现在 `visits` 里
  (前端 `sessionStorage` 未保留即无法还原)。
  ⇒ 需要「该题净停留总时长」时**一律以 `timeSpent` 为准**;`visits` 只表达「停留落点分布」,
  前端渲染也以 `visits` 优先(有分段即不再用 `timeSpent` 合成),故二者不一致时不会画出矛盾图形。
- ⚠️ `visits` 的段 `start` **可能落在会话墙钟区间 `[startedAt, submittedAt]` 之外**:
  不限时的练习会话可长期挂着,学生隔天回来继续作答即属正常(实测存在相差数小时的段)。
  时间分配甘特图的横轴 = **各段时长首尾相接的累计轴**(与 `startedAt/submittedAt` 解耦),
  故区间外的段仍能正确落位;`startedAt` 仅用于悬停提示里的「开考后 x 分」。

---

## 变更记录

| 日期 | 变更 | 提出方 |
|------|------|--------|
| 2026-08-07 | 建立刷题系统完整契约(认证/题库/会话/成绩/学情) | WB |
| 2026-09-23 | 补录考试管理/考情分析契约;`GET /api/exams/:id/student/:studentId` 的 `perQuestion[]` 新增 `answeredAt`(ISO 8601,该题首次作答时刻),用于考情明细的时间分配甘特图 | WB |
| 2026-09-23 | 新增 `POST /api/sessions/:id/visits`(分段停留上报,回答「一题多段」);`AnswerRecord` 新增 `visits` 字段;`perQuestion[]` 新增 `visits: [{start,end,seconds}]｜null`。老会话无 `visits`,前端回退单段渲染 | WB |
| 2026-09-24 | 补充 `visits` 的两条真实世界口径:① 与 `timeSpent` 的差异还可能来自**会话跨版本/跨标签页**(采集自上线起)⇒ 净停留总时长一律以 `timeSpent` 为准,渲染以 `visits` 优先;② 段 `start` 可能落在会话墙钟区间外(不限时练习会话长期挂着),甘特图横轴为「各段首尾相接的累计轴」故不受影响 | WB |
