"use client";
// 批注书写层(完全透明叠在题目上方直接手写,不遮题、不保存、不参与判分)。
// 交互:拖动=书写;轻点=穿透点击(可正常选答案/切题)。工具栏右侧竖排、可拖动、颜色/粗细更清晰。
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

type Tool = "browse" | "pen" | "eraser";

interface Stroke {
  tool: "pen" | "eraser";
  color: string;
  size: number;
  points: { x: number; y: number }[];
}

// 8 色
const COLORS = [
  { v: "#1a1a1a", label: "黑色" },
  { v: "#334155", label: "深灰" },
  { v: "#1f6fb2", label: "蓝色" },
  { v: "#2e7d32", label: "绿色" },
  { v: "#c62828", label: "红色" },
  { v: "#e65100", label: "橙色" },
  { v: "#7b1fa2", label: "紫色" },
  { v: "#ec407a", label: "粉色" },
];
const SIZES = [
  { label: "细", v: 2.5 },
  { label: "中", v: 5 },
  { label: "粗", v: 9 },
];
const DRAW_THRESHOLD = 5; // 拖动超过该距离才开始书写,否则视为轻点(穿透点击)

const TB_W = 58;
const TB_H = 600;

/* ---------- SVG 线性图标 ---------- */
function Svg({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label={title}>
      {children}
    </svg>
  );
}
const IconBrowse = () => (
  <Svg title="浏览">
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);
const IconPen = () => (
  <Svg title="画笔">
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    <path d="m15 5 4 4" />
  </Svg>
);
const IconEraser = () => (
  <Svg title="橡皮">
    <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
    <path d="M22 21H7" />
    <path d="m5 11 9 9" />
  </Svg>
);
const IconUndo = () => (
  <Svg title="撤销">
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11" />
  </Svg>
);
const IconTrash = () => (
  <Svg title="清空">
    <path d="M3 6h18" />
    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
  </Svg>
);
const IconClose = () => (
  <Svg title="收起">
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </Svg>
);

export default function ScratchPad({
  open,
  onClose,
  onInteractivityChange,
}: {
  open: boolean;
  onClose: () => void;
  onInteractivityChange?: (interactive: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const strokesRef = useRef<Stroke[]>([]);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(COLORS[0].v);
  const [sizeIdx, setSizeIdx] = useState(1);
  const drawingRef = useRef(false);
  const currentRef = useRef<Stroke | null>(null);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  // 按下起点(用于轻点→穿透点击)
  const tapStartRef = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  // 工具栏位置(可拖动)
  const [tpos, setTpos] = useState<{ x: number; y: number } | null>(null);
  const initedRef = useRef(false);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  const size = SIZES[sizeIdx].v;
  const browse = tool === "browse";

  useEffect(() => {
    strokesRef.current = strokes;
  }, [strokes]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of strokesRef.current) {
      if (s.points.length < 2) continue;
      ctx.strokeStyle = s.tool === "eraser" ? "rgba(255,255,255,0.9)" : s.color;
      ctx.lineWidth = s.tool === "eraser" ? s.size * 2.5 : s.size;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(s.points[0].x, s.points[0].y);
      for (let i = 1; i < s.points.length - 1; i++) {
        const mid = { x: (s.points[i].x + s.points[i + 1].x) / 2, y: (s.points[i].y + s.points[i + 1].y) / 2 };
        ctx.quadraticCurveTo(s.points[i].x, s.points[i].y, mid.x, mid.y);
      }
      const last = s.points[s.points.length - 1];
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    }
  }, []);
  const redrawRef = useRef(redraw);
  useEffect(() => {
    redrawRef.current = redraw;
  });

  // 画布尺寸自适应(DPR 高清);仅打开/窗口变化时重建
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
      canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redrawRef.current();
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [open]);

  // 浏览模式 ↔ 交互性同步
  useEffect(() => {
    onInteractivityChange?.(browse);
  }, [browse, onInteractivityChange]);

  // 打开:重置画笔 + 默认位置(右侧垂直居中);收起:清空草稿(不保存)
  useEffect(() => {
    if (open) {
      setTool("pen");
      if (!initedRef.current) {
        initedRef.current = true;
        setTpos({
          x: Math.max(8, window.innerWidth - TB_W - 16),
          y: Math.max(8, (window.innerHeight - TB_H) / 2),
        });
      }
    } else {
      setStrokes([]);
    }
  }, [open]);

  const pos = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: e.clientX, y: e.clientY };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const drawSegment = (from: { x: number; y: number }, to: { x: number; y: number }, s: Stroke) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = s.tool === "eraser" ? "rgba(255,255,255,0.9)" : s.color;
    ctx.lineWidth = s.tool === "eraser" ? s.size * 2.5 : s.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  };

  /* 按下:记录起点,不立即画。移动超过阈值才开始书写;否则轻点=穿透点击 */
  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (browse) return;
    e.preventDefault();
    const p = pos(e);
    tapStartRef.current = { x: p.x, y: p.y, cx: e.clientX, cy: e.clientY };
    drawingRef.current = false;
    currentRef.current = null;
    lastRef.current = null;
    try {
      canvasRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (browse) return;
    const start = tapStartRef.current;
    if (!start) return;
    const p = pos(e);
    const drawTool: "pen" | "eraser" = tool === "eraser" ? "eraser" : "pen";
    if (!drawingRef.current) {
      // 未超过阈值:轻点移动,不书写
      if (Math.hypot(p.x - start.x, p.y - start.y) < DRAW_THRESHOLD) return;
      // 超过阈值:开始一笔(从起点画起)
      drawingRef.current = true;
      currentRef.current = { tool: drawTool, color, size, points: [{ x: start.x, y: start.y }] };
      lastRef.current = { x: start.x, y: start.y };
      return;
    }
    const prev = lastRef.current;
    if (prev && currentRef.current) drawSegment(prev, p, currentRef.current);
    currentRef.current = currentRef.current
      ? { ...currentRef.current, points: [...currentRef.current.points, p] }
      : { tool: drawTool, color, size, points: [p] };
    lastRef.current = p;
  };

  /* 抬起:若画过则落笔;否则把点击转发给下层(选答案/切题仍可用) */
  const endStroke = () => {
    if (drawingRef.current && currentRef.current && currentRef.current.points.length >= 2) {
      setStrokes((prev) => [...prev, currentRef.current!]);
    } else if (!drawingRef.current && tapStartRef.current) {
      forwardClick(tapStartRef.current.cx, tapStartRef.current.cy);
    }
    tapStartRef.current = null;
    drawingRef.current = false;
    currentRef.current = null;
    lastRef.current = null;
  };

  const cancelStroke = () => {
    tapStartRef.current = null;
    drawingRef.current = false;
    currentRef.current = null;
    lastRef.current = null;
  };

  /* 轻点穿透:临时隐藏画布,找到下层元素并派发 click */
  const forwardClick = (x: number, y: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const prev = canvas.style.pointerEvents;
    canvas.style.pointerEvents = "none";
    const el = document.elementFromPoint(x, y);
    canvas.style.pointerEvents = prev;
    if (el && el !== canvas) {
      el.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y })
      );
    }
  };

  const undo = () => setStrokes((prev) => prev.slice(0, -1));
  const clear = () => setStrokes([]);

  /* ---------- 工具栏拖动 ---------- */
  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: tpos?.x ?? 0, oy: tpos?.y ?? 0 };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };
  const onDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.sx;
    const dy = e.clientY - dragRef.current.sy;
    setTpos({
      x: Math.min(Math.max(4, dragRef.current.ox + dx), Math.max(4, window.innerWidth - TB_W)),
      y: Math.min(Math.max(4, dragRef.current.oy + dy), Math.max(4, window.innerHeight - 44)),
    });
  };
  const endDrag = () => {
    dragRef.current = null;
  };

  /* ---------- 按钮样式 ---------- */
  const toolBtn = (t: Tool, title: string, icon: ReactNode) => (
    <button
      onClick={() => setTool(t)}
      title={title}
      className={`flex h-10 w-10 items-center justify-center rounded-xl transition-all ${
        tool === t ? "bg-indigo-600 text-white shadow-sm" : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
      }`}
    >
      {icon}
    </button>
  );

  const actionBtn = (title: string, icon: ReactNode, disabled: boolean, onClick: () => void) => (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 transition-all hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30"
    >
      {icon}
    </button>
  );

  const divider = <div className="my-0.5 h-px w-7 bg-slate-200" />;

  return open ? (
    <>
      {/* 完全透明的批注层:只捕获书写,不遮题目 */}
      <div className="pointer-events-none fixed inset-0 z-50">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 touch-none"
          style={{ pointerEvents: browse ? "none" : "auto" }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={endStroke}
          onPointerCancel={cancelStroke}
        />
      </div>

      {/* 工具栏:固定定位、可拖动,默认右侧垂直居中 */}
      <div
        className="pointer-events-auto fixed z-50 flex flex-col items-center gap-0.5 rounded-2xl border border-slate-200/70 bg-white/90 p-1.5 shadow-[0_10px_34px_rgba(15,23,42,0.16),0_2px_8px_rgba(15,23,42,0.08)] backdrop-blur-md"
        style={{ left: tpos?.x ?? 8, top: tpos?.y ?? 80 }}
      >
        {/* 拖动把手 */}
        <div
          onPointerDown={startDrag}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="flex h-6 w-full cursor-grab touch-none items-center justify-center gap-1 active:cursor-grabbing"
          title="按住拖动工具栏"
        >
          <span className="h-1 w-1 rounded-full bg-slate-300" />
          <span className="h-1 w-1 rounded-full bg-slate-300" />
          <span className="h-1 w-1 rounded-full bg-slate-300" />
        </div>

        {toolBtn("browse", "浏览:可正常答题/切题", <IconBrowse />)}
        {toolBtn("pen", "画笔(拖动书写,轻点可点题)", <IconPen />)}
        {toolBtn("eraser", "橡皮(拖动擦除,轻点可点题)", <IconEraser />)}
        {divider}

        {/* 颜色:2×4 网格,选中带对勾 */}
        <div className="px-0.5 py-1">
          <div className="grid grid-cols-2 gap-1.5">
            {COLORS.map((c) => {
              const active = color === c.v && tool === "pen";
              return (
                <button
                  key={c.v}
                  onClick={() => { setColor(c.v); setTool("pen"); }}
                  title={c.label}
                  className={`flex h-7 w-7 items-center justify-center rounded-full transition-transform ${
                    active ? "scale-110 ring-2 ring-indigo-500 ring-offset-1" : "hover:scale-105 hover:ring-2 hover:ring-slate-300"
                  }`}
                  style={{ background: c.v }}
                >
                  {active && <span className="text-[10px] font-bold text-white drop-shadow">✓</span>}
                </button>
              );
            })}
          </div>
        </div>
        {divider}

        {/* 粗细:预览线(粗细直观) */}
        <div className="flex flex-col items-center gap-0.5 py-1">
          {SIZES.map((s, i) => (
            <button
              key={s.label}
              onClick={() => setSizeIdx(i)}
              title={`笔触:${s.label}`}
              className={`flex h-8 w-12 items-center justify-center rounded-lg transition-colors ${
                sizeIdx === i ? "bg-indigo-50 text-indigo-600" : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              }`}
            >
              <span className="block rounded-full bg-current" style={{ width: 26, height: Math.max(2, Math.round(s.v * 0.9)) }} />
            </button>
          ))}
        </div>
        {divider}

        {actionBtn("撤销上一步", <IconUndo />, strokes.length === 0, undo)}
        {actionBtn("清空全部批注", <IconTrash />, strokes.length === 0, clear)}
        {divider}
        <button
          onClick={onClose}
          title="收起批注"
          className="flex h-10 w-10 items-center justify-center rounded-xl text-rose-500 transition-all hover:bg-rose-50"
        >
          <IconClose />
        </button>
      </div>

      <p className="pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-full bg-slate-800/60 px-4 py-1.5 text-xs text-white/90 backdrop-blur-sm">
        拖动书写 · 轻点可正常点选答案/切题 · 工具栏可拖动
      </p>
    </>
  ) : null;
}
