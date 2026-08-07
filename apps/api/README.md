# apps/api — 后端(Node + Express)

> **负责人:WorkBuddy。** 目录所有权详见根目录 `AGENTS.md`。

## 启动

```bash
# 根目录安装依赖后
npm run dev:api        # http://localhost:4000(文件变更自动重启)
```

## 约定

- 响应统一为 `{ code, message, data }`,详见根目录 `docs/API.md`。
- 新接口必须先更新 `docs/API.md` 契约,再实现代码。
