import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "上海金瑞学校 附加笔试刷题系统",
  description: "上海金瑞学校附加笔试(TMUA / ESAT)在线刷题、模拟考与学情分析平台",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
