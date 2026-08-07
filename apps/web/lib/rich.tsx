import React from "react";

// 富文本渲染:解析 Markdown 图片语法 ![alt](url),其余按文本展示
// 用于题干与选项,支持嵌入图片(如函数图形、卡片图)
const IMG_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

export function renderRich(text: string | null | undefined): React.ReactNode[] {
  if (!text) return [];
  const parts: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  IMG_RE.lastIndex = 0;
  while ((m = IMG_RE.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(<span key={key++}>{text.slice(last, m.index)}</span>);
    }
    parts.push(
      <img
        key={key++}
        src={m[2]}
        alt={m[1] || "题目图片"}
        className="mt-2 inline-block max-h-56 max-w-full rounded-lg border border-slate-200 bg-white"
      />
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    parts.push(<span key={key++}>{text.slice(last)}</span>);
  }
  return parts;
}

// 纯文本版本(用于截断展示等):去掉图片标记
export function plainText(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(IMG_RE, " [图片] ");
}
