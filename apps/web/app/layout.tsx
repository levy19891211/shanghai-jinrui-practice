import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TMUA / ESAT 刷题系统",
  description: "面向 TMUA 与 ESAT 的在线刷题、模拟考与学情分析平台",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
