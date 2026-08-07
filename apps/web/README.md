# apps/web — 前端(Next.js)

> **负责人:Vibe Coding 工具。** 目录所有权详见根目录 `AGENTS.md`。

## 初始化(首次使用)

在 `apps/web` 目录下执行,生成完整的 Next.js 项目文件:

```bash
npx create-next-app@latest . --ts --tailwind --eslint --app
```

> 该命令会与当前 `package.json` 合并/覆盖,以生成的文件为准。完成后:
> 1. 在 `next.config.mjs` 中配置 `/api` 代理到后端 `http://localhost:4000`;
> 2. 在根目录执行 `npm install` 安装依赖;
> 3. 在根目录执行 `npm run dev:web` 启动前端。

## 代理配置示例

```js
// next.config.mjs
const nextConfig = {
  async rewrites() {
    return [
      { source: "/api/:path*", destination: "http://localhost:4000/api/:path*" }
    ];
  }
};
export default nextConfig;
```
