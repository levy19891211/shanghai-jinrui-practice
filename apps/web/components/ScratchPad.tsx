"use client";
// 手写书写板(类似 Notability 的草稿纸):全屏 Canvas 手写,支持画笔/橡皮/颜色/粗细/撤销/清空。
// 只作为草稿,不参与判分;strokes 按 persistKey 存 sessionStorage(可跨切题/刷新保留)。
import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

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

export default function ScratchPad({ open, onClose, persistKey }: { open: boolean; onClose: () => void; persistKey?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<Stroke[]>(() => {
    if (!persistKey) return [];
    try {
      const v = sessionStorage.getItem(`scratch-${persistKey}`);
      return v ? (JSON.parse(v) as Stroke[]) : [];
    } catch {
      return [];
    }
  });
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [sizeIdx, setSizeIdx] = useState(1);
  const drawingRef = useRef(false);
  const currentRef = useRef<Stroke | null>(null);
  const lastRef = useRef<{ x: number; y: number } | null>(null);

  const size = SIZES[sizeIdx].v;

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of strokes) {
      if (s.points.length < 2) continue;
      ctx.strokeStyle = s.tool === "eraser" ? "rgba(255,255,255,0.95)" : s.color;
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

  // 画布尺寸自适应(按 devicePixelRatio 保持清晰);打开时初始化
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

  // 持久化草稿
  useEffect(() => {
    if (!persistKey) return;
    try {
      sessionStorage.setItem(`scratch-${persistKey}`, JSON.stringify(strokes));
    } catch {
      /* ignore */
    }
  }, [strokes, persistKey]);

  const pos = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const drawSegment = (from: { x: number; y: number }, to: { x: number; y: number }, s: Stroke) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = s.tool === "eraser" ? "rgba(255,255,255,0.95)" : s.color;
    ctx.lineWidth = s.tool === "eraser" ? s.size * 2.5 : s.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  };

  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    drawingRef.current = true;
    const p = pos(e);
    const s: Stroke = { tool, color, size, points: [p] };
    currentRef.current = s;
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

  const btn =
    "flex h-9 items-center justify-center rounded-lg px-2.5 text-sm text-white/90 transition hover:bg-white/15 disabled:opacity-40";

  return open ? (
    <div className="fixed inset-0 z-50" style={{ background: "rgba(255,255,255,0.90)" }}>
      {/* 工具栏 */}
      <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-2xl bg-slate-800/95 px-3 py-2 shadow-2xl ring-1 ring-white/10">
        <button className={`${btn} ${tool === "pen" ? "bg-white/25" : ""}`} onClick={() => setTool("pen")} title="画笔">
          ✏️
        </button>
        <button className={`${btn} ${tool === "eraser" ? "bg-white/25" : ""}`} onClick={() => setTool("eraser")} title="橡皮">
          🧽
        </button>
        <span className="mx-1 h-5 w-px bg-white/20" />
        {COLORS.map((c) => (
          <button
            key={c}
            onClick={() => { setColor(c); setTool("pen"); }}
            className={`flex h-7 w-7 items-center justify-center rounded-full transition ${color === c && tool === "pen" ? "ring-2 ring-white" : "hover:ring-2 hover:ring-white/50"}`}
            style={{ background: c }}
            title={c === COLORS[0] ? "黑色" : c === COLORS[1] ? "蓝色" : c === COLORS[2] ? "红色" : "绿色"}
          />
        ))}
        <span className="mx-1 h-5 w-px bg-white/20" />
        {SIZES.map((s, i) => (
          <button
            key={s.label}
            onClick={() => setSizeIdx(i)}
            className={`h-8 rounded-lg px-2 text-xs ${sizeIdx === i ? "bg-white/25 text-white" : "text-white/60 hover:text-white"}`}
            title={`笔触:${s.label}`}
          >
            {s.label}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-white/20" />
        <button className={btn} onClick={undo} disabled={strokes.length === 0} title="撤销上一步">↩️</button>
        <button className={btn} onClick={clear} disabled={strokes.length === 0} title="清空全部">🗑️</button>
        <span className="mx-1 h-5 w-px bg-white/20" />
        <button className={`${btn} text-amber-300 hover:bg-white/15`} onClick={onClose} title="收起书写板(查看题目,草稿保留)">
          ✕ 收起
        </button>
      </div>

      {/* 画布 */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 touch-none"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />

      <p className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-slate-800/80 px-4 py-1.5 text-xs text-white/85">
        在纸上书写草稿(不参与判分) · 「✕ 收起」查看题目,再次点「✍️ 书写」可继续
      </p>
    </div>
  ) : null;
}
