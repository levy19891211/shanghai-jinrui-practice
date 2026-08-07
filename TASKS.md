# TASKS.md — 任务清单与分工看板

> 每个任务标注负责人:`[WB]` = WorkBuddy,`[VC]` = Vibe Coding 工具,`[BOTH]` = 双方协作。
> 任务状态:`[ ]` 待办,`[x]` 完成,`[!]` 阻塞。

## 阶段一:项目初始化 ✅

- [x] `[BOTH]` 建立 monorepo 骨架(npm workspaces + 目录结构)
- [x] `[BOTH]` 编写 AGENTS.md 协作约定
- [x] `[BOTH]` 初始化 Git 仓库
- [ ] `[BOTH]` 推送到远程仓库(GitHub / Gitee),双方 clone

## 阶段二:后端基础(WorkBuddy)

- [ ] `[WB]` Express 服务 + 健康检查接口 `GET /api/health`
- [ ] `[WB]` 统一响应结构与错误中间件
- [ ] `[WB]` CORS 与代理配置说明(前端 `/api` 转发)
- [ ] `[WB]` 数据库接入与迁移方案(待定:SQLite / PostgreSQL)

## 阶段三:前端基础(Vibe Coding 工具)

- [ ] `[VC]` 初始化 Next.js 项目(TypeScript + Tailwind + ESLint)
- [ ] `[VC]` 页面骨架:布局、导航、全局样式
- [ ] `[VC]` 对接健康检查接口并展示后端状态
- [ ] `[VC]` 配置 `/api` 代理到后端

## 阶段四:核心功能(双方协作)

- [ ] `[BOTH]` 确定核心业务需求,更新 docs/API.md 接口契约
- [ ] `[WB]` 按契约实现业务接口
- [ ] `[VC]` 按契约实现页面与交互
- [ ] `[BOTH]` 联调、修复问题

## 阶段五:质量与交付

- [ ] `[BOTH]` 代码审查(互相审查 PR)
- [ ] `[WB]` 自动化测试
- [ ] `[VC]` 视觉走查与体验优化
- [ ] `[BOTH]` 部署上线

---

## 进行中

- [ ] `[BOTH]` 推送到远程仓库(下一步!)
