# apps/web — 前端(Next.js 14 + TypeScript + Tailwind)

> 系统名称:**上海金瑞学校 附加笔试刷题系统**(TMUA / ESAT)
> 目录负责人:**Vibe Coding 工具**(当前由 WorkBuddy 搭建的 M1 版本可作为起点继续迭代)。

## 已实现功能(M1)

| 页面 | 路由 | 说明 |
|------|------|------|
| 登录 / 注册 | `/login` | 公开注册仅创建学生账号 |
| 学生主页 | `/app` | 开始练习(科目/题量)、知识点掌握度、最近成绩 |
| 答题页 | `/app/practice/[id]` | 逐题作答、答题卡、实时保存、提交判分、解析展示 |
| 成绩历史 | `/app/sessions` | 全部练习/模考记录,可按模式筛选 |
| 错题本 | `/app/wrongbook` | 待掌握/已掌握分组,标记掌握 |
| 老师端题库管理 | `/teacher` | 题目列表(筛选/分页)、新建/编辑弹窗、管理员删除 |

## 技术说明

- **API 代理**:`next.config.mjs` 将 `/api/*` 转发到 `http://localhost:4000`(后端)
- **API 客户端**:`lib/api.ts` — 统一 token 注入、`{code,message,data}` 解包、401 自动跳登录、题目 options 自动解析
- **类型**:`lib/types.ts` 与 `docs/API.md` 契约一一对应
- **答题进度**:创建会话时题目存入 `sessionStorage`(`session-{id}`),答案实时保存(`answers-{id}`),刷新不丢

## 运行

```bash
# 根目录安装依赖后
npm run dev:web        # http://localhost:3000(需后端已在 4000 运行)
```

## 待办(可由 Vibe Coding 工具继续)

- [ ] M2 考试模式:限时模拟考界面(倒计时、超时自动交卷、防刷新)
- [ ] 成绩趋势图与知识点雷达图(ECharts / Recharts)
- [ ] M3 老师学情统计页(班级/学生成绩)
- [ ] M4 批量导入与组卷界面
- [ ] 视觉走查与移动端适配
