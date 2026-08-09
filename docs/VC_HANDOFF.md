# 给 Vibe Coding 工具的交接说明

> 本文件是 **Vibe Coding 工具(Cursor 等)** 接手本项目的上手说明书。
> 请先阅读根目录 `AGENTS.md`(分工与规范)、`docs/API.md`(接口契约)、`TASKS.md`(任务看板),再开始工作。

## 1. 项目是什么

**金瑞升学金鹰系统** —— 面向 TMUA / ESAT 备考的在线刷题平台。

- **学生端**:练习/限时模拟考、自动判分、错题本、成绩历史、知识点掌握度
- **老师端**:题库管理(增删改查)、学情统计(学生成绩概览、班级薄弱知识点、学生详情)

## 2. 技术栈与目录

| 目录 | 内容 | 负责人 |
|------|------|--------|
| `apps/web/` | Next.js 14 + React 18 + TypeScript + Tailwind | **你(Vibe Coding 工具)** |
| `apps/api/` | Node + Express + Prisma(SQLite 开发 / PostgreSQL 生产) | WorkBuddy |
| `docs/` | 架构设计 + 接口契约 | 双方 |
| `assets/papers/` | 官方真题 PDF 存档 | WorkBuddy |

## 3. 快速启动

```bash
npm install                    # 根目录安装全部依赖
npm run dev:api                # 后端 http://localhost:4000(需先启动)
npm run dev:web                # 前端 http://localhost:3000
```

演示账号:学生 `stu@example.com` / 老师 `teacher@example.com`,密码均为 `123456`。

## 4. 已实现功能(直接可用)

- 登录/注册(公开注册仅学生;老师账号走 seed)
- 练习模式:随机组卷、逐题作答、答题卡、实时保存、提交判分、解析
- 模拟考模式:限时倒计时、超时自动交卷、超时禁答
- 成绩历史、错题本(掌握标记)、知识点掌握度
- 老师题库管理:列表/筛选/新建/编辑弹窗,管理员删除
- 老师学情统计:学生成绩概览、全班薄弱知识点 TOP、学生详情
- 题库:27 道(含 20 道 TMUA 官方样卷真题,来源标注清晰)

## 5. 你的待办任务(按优先级)

**P0 — 前端体验优化(M1 收尾)**
- [ ] 题目公式渲染:题库题干含 `x^2`、`√3`、`log₁₀` 等 LaTeX 风格文本,建议接入 KaTeX/MathJax 提升数学公式显示效果
- [ ] 移动端适配检查(学生可能在平板上刷题)

**P1 — 数据可视化**
- [ ] 成绩趋势折线图(Recharts,数据源 `/me/sessions`)
- [ ] 知识点掌握度雷达图(Recharts RadarChart,数据源 `/me/stats`;老师端学生详情页同款)

**P2 — 功能增强**
- [ ] 模拟考成绩报告页(每题用时、知识点分布)
- [ ] 批量导入题目的上传界面(后端 API 待 WorkBuddy 开发)
- [ ] 视觉走查:统一学生端/老师端设计风格

## 6. 协作规范(务必遵守)

1. **分支**:每个任务一个分支 `feature/<任务名>`,**不要直接改 main**
2. **契约**:接口变更前先改 `docs/API.md`,再动代码;前端只依赖契约,不猜字段
3. **目录边界**:只改 `apps/web/`;`apps/api/` 归 WorkBuddy,确需修改先沟通
4. **提交**:小步提交,`feat:`/`fix:`/`refactor:` 前缀
5. **合并**:通过 Pull Request,由另一个 AI 审查后合并
6. **数据**:学生看不到答案字段(后端已按角色过滤),不要在客户端缓存答案

## 7. 常见问题

- **页面空白**:登录态校验在客户端完成,需先登录;后端未启动时 API 会报"无法连接服务器"
- **公式显示**:当前为纯文本 `x^2` 风格,接入 KaTeX 后需保持题干格式兼容
- **数据库**:开发用 SQLite 文件 `apps/api/prisma/dev.db`,重置数据可 `npm run seed --workspace=apps/api`;真题导入 `npm run seed:official --workspace=apps/api`
