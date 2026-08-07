# API 契约文档 — TMUA / ESAT 刷题系统

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
{ "email": "stu@example.com", "password": "123456", "name": "张三", "role": "STUDENT" }
```

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

## 三、答题会话

### 3.1 创建会话 `POST /api/sessions`(需学生)

```json
{ "mode": "PRACTICE", "paperId": "可选", "questionIds": ["可选,自定义题目"] }
```

后端按规则组卷(未指定则从已发布题目中按知识点抽取)。返回 `data`: `{ sessionId, questions: [不含答案] }`

### 3.2 保存单题作答 `POST /api/sessions/:id/answer`

```json
{ "questionId": "q1", "selected": "B", "timeSpent": 42 }
```

实时保存(草稿态),不判分。可重复提交覆盖。

### 3.3 提交判分 `POST /api/sessions/:id/submit`

对全部已作答题目判分,记录成绩、写错题本。返回 `data`:

```json
{
  "score": 12, "total": 20, "correctCount": 12,
  "details": [{ "questionId": "q1", "selected": "B", "isCorrect": false }]
}
```

### 3.4 会话详情 `GET /api/sessions/:id`

含逐题对错与解析(仅本人或老师)。

## 四、成绩与错题本

### 4.1 我的成绩历史 `GET /api/me/sessions?mode=`

返回 `data`: `{ list: [{ sessionId, mode, score, total, correctCount, submittedAt }] }`

### 4.2 我的错题本 `GET /api/me/wrongbook`

返回 `data`: `{ list: [{ questionId, topic, wrongCount, mastered, stem }] }`

### 4.3 标记掌握 `POST /api/me/wrongbook/:questionId/master`

### 4.4 我的掌握度 `GET /api/me/stats`

返回 `data`: `{ byTopic: [{ topic, attempts, correctRate }] }`

## 五、老师学情(需老师)

### 5.1 学生成绩列表 `GET /api/teacher/students?search=`

### 5.2 某学生详情 `GET /api/teacher/students/:id/stats`

---

## 变更记录

| 日期 | 变更 | 提出方 |
|------|------|--------|
| 2026-08-07 | 建立刷题系统完整契约(认证/题库/会话/成绩/学情) | WB |
