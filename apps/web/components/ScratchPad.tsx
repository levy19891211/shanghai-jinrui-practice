"use client";
// 批注书写层(叠在题目上方直接手写):半透明纸面,不参与判分,不保存。
// 工具栏竖排在屏幕右侧;「👆 浏览」模式下事件穿透,可正常答题/切题,不干扰做题界面的其他功能。
import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

type Tool = "browse" | "pen" | "eraser";

interface Stroke {
  tool: "pen" | "eraser";
  color: string;
  size: number;
  points: { x: number; y: number }[];
}

const COLORS = ["#1a1a1a", "#1f6fb2", "#c62828", "#2e7d32"];
const SIZES = [
  { label: "细", v: 2.5 },
  { label: "中", v: 5 },
  { label: "粗", v: 9 },
];

export default function ScratchPad({
  open,
  onClose,
  onInteractivityChange,
}: {
  open: boolean;
  onClose: () => void;
  // 浏览模式下 true(事件穿透,可答题/切题);书写/橡皮下 false
  onInteractivityChange?: (interactive: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [sizeIdx, setSizeIdx] = useState(1);
  const drawingRef = useRef(false);
  const currentRef = useRef<Stroke | null>(null);
  const lastRef = useRef<{ x: number; y: number } | null>(null);

  const size = SIZES[sizeIdx].v;
  const browse = tool === "browse";

  // 浏览模式 ↔ 交互性同步给父级(用于键盘切题等)
  useEffect(() => {
    onInteractivityChange?.(browse);
  }, [browse, onInteractivityChange]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of strokes) {
      if (s.points.length < 2) continue;
      ctx.strokeStyle = s.tool === "eraser" ? "rgba(255,255,255,0.85)" : s.color;
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
  }, [strokes]);

  // 画布尺寸自适应(DPR 高清);打开时初始化
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redraw();
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [open, redraw]);

  // 打开时重置为画笔,收起时清空草稿(不保存)
  useEffect(() => {
    if (open) {
      setTool("pen");
    } else {
      setStrokes([]);
    }
  }, [open]);

  const pos = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const drawSegment = (from: { x: number; y: number }, to: { x: number; y: number }, s: Stroke) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = s.tool === "eraser" ? "rgba(255,255,255,0.85)" : s.color;
    ctx.lineWidth = s.tool === "eraser" ? s.size * 2.5 : s.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  };

  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (browse) return;
    e.preventDefault();
    drawingRef.current = true;
    const p = pos(e);
    currentRef.current = { tool, color, size, points: [p] };
    lastRef.current = p;
    canvasRef.current?.setPointerCapture(e.pointerId);
  };

  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || !currentRef.current) return;
    const p = pos(e);
    const prev = lastRef.current;
    if (prev) drawSegment(prev, p, currentRef.current);
    currentRef.current = { ...currentRef.current, points: [...currentRef.current.points, p] };
    lastRef.current = p;
  };

  const onUp = () => {
    if (drawingRef.current && currentRef.current && currentRef.current.points.length >= 2) {
      setStrokes((prev) => [...prev, currentRef.current!]);
    }
    drawingRef.current = false;
    currentRef.current = null;
    lastRef.current = null;
  };

  const undo = () => setStrokes((prev) => prev.slice(0, -1));
  const clear = () => setStrokes([]);

  const toolBtn = (t: Tool, label: string, title: string, activeClass: string) => (
    <button
      onClick={() => setTool(t)}
      className={`flex h-10 w-10 items-center justify-center rounded-xl text-lg transition ${tool === t ? activeClass : "text-white/80 hover:bg-white/15"}`}
      title={title}
    >
      {label}
    </button>
  );

  const divider = <span className="my-1 h-px w-6 bg-white/20" />;

  return open ? (
    // 半透明纸面叠在题目上方;浏览模式下整层 pointer-events:none,点击穿透不影响答题
    <div
      className="fixed inset-0 z-50"
      style={{ background: "rgba(255,255,255,0.5)", pointerEvents: browse ? "none" : "auto" }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 touch-none"
        style={{ pointerEvents: browse ? "none" : "auto" }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />

      {/* 工具栏:右侧竖排 */}
      <div className="pointer-events-auto absolute right-3 top-1/2 z-10 flex -translate-y-1/2 flex-col items-center gap-1 rounded-2xl bg-slate-800/95 px-2 py-2.5 shadow-2xl ring-1 ring-white/10">
        {toolBtn("browse", "👆", "浏览/答题模式:可点击题目作答与切题", "bg-white/25")}
        {toolBtn("pen", "✏️", "画笔", "bg-white/25")}
        {toolBtn("eraser", "🧽", "橡皮", "bg-white/25")}
        {divider}
        {COLORS.map((c) => (
          <button
            key={c}
            onClick={() => { setColor(c); setTool("pen"); }}
            className={`flex h-7 w-7 items-center justify-center rounded-full transition ${color === c && tool === "pen" ? "ring-2 ring-white" : "hover:ring-2 hover:ring-white/60"}`}
            style={{ background: c }}
            title={c === COLORS[0] ? "黑色" : c === COLORS[1] ? "蓝色" : c === COLORS[2] ? "红色" : "绿色"}
          />
        ))}
        {divider}
        {SIZES.map((s, i) => (
          <button
            key={s.label}
            onClick={() => setSizeIdx(i)}
            className={`h-8 w-9 rounded-lg text-xs ${sizeIdx === i ? "bg-white/25 text-white" : "text-white/60 hover:text-white"}`}
            title={`笔触:${s.label}`}
          >
            {s.label}
          </button>
        ))}
        {divider}
        <button
          onClick={undo}
          disabled={strokes.length === 0}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-lg text-white/80 transition hover:bg-white/15 disabled:opacity-40"
          title="撤销上一步"
        >
          ↩️
        </button>
        <button
          onClick={clear}
          disabled={strokes.length === 0}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-lg text-white/80 transition hover:bg-white/15 disabled:opacity-40"
          title="清空全部批注"
        >
          🗑️
        </button>
        {divider}
        <button
          onClick={onClose}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-lg text-amber-300 transition hover:bg-white/15"
          title="收起批注(恢复完全答题)"
        >
          ✕
        </button>
      </div>

      <p className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-slate-800/70 px-4 py-1.5 text-xs text-white/85">
        批注不参与判分 · 点「👆」可正常答题/切题,「✕」收起
      </p>
    </div>
  ) : null;
}
