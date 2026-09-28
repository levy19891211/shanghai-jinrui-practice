import type { Config } from "tailwindcss";

const config: Config = {
  // 必须同时扫描 components/:否则仅被组件使用的类(如教务老师徽章 bg-sky-100)
  // 不会生成 CSS,线上表现为"类名在 JS 里有、样式却是裸文本"。
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
