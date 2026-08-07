# ai-co-built-app

由 **WorkBuddy + Vibe Coding 工具** 通过共享 Git 仓库协同开发的 Web 应用。

## 架构

```
apps/
├── web/    # Next.js 前端(由 Vibe Coding 工具负责)
└── api/    # Node + Express 后端(由 WorkBuddy 负责)
docs/
├── API.md  # 接口契约(前后端对齐的唯一依据)
```

## 快速开始

```bash
npm install        # 根目录安装全部依赖
npm run dev:web    # 前端 http://localhost:3000
npm run dev:api    # 后端 http://localhost:4000
```

## 协同规则

两个 AI 助手在此仓库协作,请阅读 [AGENTS.md](./AGENTS.md) 了解分工边界、分支策略与提交规范;任务看板见 [TASKS.md](./TASKS.md)。

## 分支策略

- `main`:受保护主干,只接受经 PR 审查的合并
- `feature/*`:功能分支,一人一任务一分支
