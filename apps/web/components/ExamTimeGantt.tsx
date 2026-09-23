"use client";

import { useMemo } from "react";

/* ============================================================================
 * ExamTimeGantt —— 整场考试时间分配甘特图(支持「一题多段」)
 * ---------------------------------------------------------------------------
 * 用途:考试管理 → 考情分析 → 查看明细,在每个学生的「时间统计表」下方,
 *      用横向条带展示整场考试里「哪段时间在做哪道题」。
 *
 * 数据口径(与后端 GET /api/exams/:id/student/:studentId 的 perQuestion 对齐):
 *   visits     = 该题的分段停留 [{ start, end, seconds }]
 *                (前端每次离开题目即全量上报该题的分段,同一题多次进入 ⇒ 多段)
 *   answeredAt = 该题「首次保存作答」的服务端时刻(AnswerRecord.createdAt)
 *   timeSpent  = 该题累计停留秒数(前端切题/作答时累加,页面关闭或暂停期间不计)
 *   ⚠ 交卷时后端会为「未作答」题补建记录,这类记录 timeSpent 为 null,
 *     故一律以 timeSpent == null 判定「未作答」,不把其 answeredAt 当真实作答时刻。
 *
 * 「一题多段」:
 *   学生可能在一道题上分多次停留(想几分钟没作答 → 离开 → 过一阵子又回到这道题作答)。
 *   此时该题会画出多条条带,落在同一行的不同 x 位置,与其它题的条带交错 —— 一眼可见回看行为。
 *   若无 visits(2026-09-23 之前采集的老会话),回退为「answeredAt − timeSpent」合成单段,
 *   渲染形态与旧版一致(仍然一题一条)。
 *
 * 横轴 = **累计作答时间轴**(不是墙钟时间轴):
 *   把全部停留段按「该段开始时刻」先后顺序首尾相接铺满整条轴,
 *   中途退出 / 暂停 / 交卷前静置等「空白时段」与「回看造成的区间重叠」整体剔除。
 *   ⇒ 条带严格首尾相接、无任何空白,且每段长度 = 该段真实停留时长。
 *   代价:横轴刻度是「累计作答」而非「开考后」。故:
 *     · 右下角同时给出「考试跨度」作对照(二者差异即被剔除的空白);
 *     · 悬停提示里保留各段「开考后」的真实时刻,不丢信息。
 * 纵轴 = 题号(与上方折线图同序,便于交叉比对)。
 *
 * 纯手写内联 SVG,不引入新依赖。
 * ==========================================================================*/

const GANTT_W = 680; // viewBox 逻辑宽度(与弹窗内容宽度接近,缩放比≈1)
const GANTT_LABEL_W = 52; // 左侧「第N题」标签槽宽
const GANTT_ROW_H = 18; // 每行高度
const GANTT_TOP = 26; // 顶部时间刻度区高度
const GANTT_PAD_R = 8;
const MIN_BAR_W = 1.2; // 极短停留(几秒)的条带保底宽度,避免细到看不见
const COLOR_OK = "#10b981";
const COLOR_BAD = "#ef4444";
const COLOR_UNKNOWN = "#94a3b8";

// 该题的一次停留(与后端 perQuestion[].visits 的元素同构)
export interface GanttVisit {
  start: string;
  end: string;
  seconds: number;
}

export interface GanttQuestion {
  index: number;
  questionId: string;
  timeSpent: number | null;
  isCorrect: boolean | null;
  answeredAt: string | null;
  /** 「一题多段」分段停留;老会话(2026-09-23 之前)为 null ⇒ 回退单段渲染 */
  visits?: GanttVisit[] | null;
}

export interface ExamTimeGanttProps {
  perQuestion: GanttQuestion[];
  startedAt: string | null;
  submittedAt: string | null;
}

interface GanttSeg {
  index: number;
  segNo: number; // 该题内的第几段(从 1 起)
  segTotal: number; // 该题共几段
  from: number; // 累计作答轴起点(秒)
  to: number; // 累计作答轴终点(秒)
  durSec: number; // 该段停留秒数(= to - from)
  isCorrect: boolean | null;
  offsetSec: number | null; // 该段开始距开考的秒数(仅用于悬停提示;合成段可能为负)
  synthesized: boolean; // true = 由 answeredAt − timeSpent 合成(老会话回退)
  splitBefore: boolean; // true = 轴上前一段属于同一题(段间画一条分隔线,避免两段视觉上连成一条)
}

// 秒 → "12分30秒" / "45秒"(与 StudentExamDetail 的展示口径保持一致)
function fmtDur(sec: number | null | undefined): string {
  if (sec == null || sec < 0 || Number.isNaN(sec)) return "—";
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `${r}秒`;
  return `${m}分${r}秒`;
}

// 秒数 → "3:05" / "1:02:03"
function fmtClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  return `${m}:${String(r).padStart(2, "0")}`;
}

// 选一个「好看」的刻度步长,让总刻度数落在 4~7 之间
function ganttStep(spanSec: number): number {
  const cands = [15, 30, 60, 120, 180, 300, 600, 900, 1200, 1800, 2700, 3600, 7200];
  for (const c of cands) if (spanSec / c <= 6) return c;
  return cands[cands.length - 1];
}

function barColor(isCorrect: boolean | null): string {
  if (isCorrect === true) return COLOR_OK;
  if (isCorrect === false) return COLOR_BAD;
  return COLOR_UNKNOWN;
}

function labelOf(isCorrect: boolean | null): string {
  if (isCorrect === true) return "答对";
  if (isCorrect === false) return "答错";
  return "未判分";
}

export default function ExamTimeGantt({
  perQuestion,
  startedAt,
  submittedAt,
}: ExamTimeGanttProps) {
  // ⚠ hooks 必须在任何 early return 之前无条件调用
  const model = useMemo(() => {
    const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);

    // ① 逐题收集停留段:
    //    · 有 visits ⇒ 每次停留各成一段(一题多段;含「看了但没作答」的题)
    //    · 无 visits 但有 timeSpent + answeredAt ⇒ 回退为单段 [answeredAt − timeSpent, answeredAt]
    type RawSeg = { index: number; isCorrect: boolean | null; startMs: number; durSec: number; synthesized: boolean };
    const raws: RawSeg[] = [];
    for (const q of perQuestion) {
      const vs = Array.isArray(q.visits) ? q.visits : [];
      let taken = 0;
      for (const v of vs) {
        if (!v) continue;
        const startMs = ms(v.start);
        const secs = Number(v.seconds);
        // 与后端 POST /sessions/:id/visits 的校验口径保持一致:非法日期、非数字、负时长一律丢弃
        if (!Number.isFinite(startMs) || !Number.isFinite(secs) || secs < 0) continue;
        raws.push({
          index: q.index,
          isCorrect: q.isCorrect,
          startMs,
          durSec: Math.max(0, Math.round(secs)),
          synthesized: false,
        });
        taken += 1;
      }
      if (taken > 0) continue; // 该题已按分段停留展开,不再合成
      if (q.timeSpent == null || !q.answeredAt) continue; // 无任何停留记录
      const endMs = ms(q.answeredAt);
      if (!Number.isFinite(endMs)) continue;
      const durSec = Math.max(0, Math.round(q.timeSpent));
      raws.push({ index: q.index, isCorrect: q.isCorrect, startMs: endMs - durSec * 1000, durSec, synthesized: true });
    }
    if (raws.length === 0) return null;

    // ② 全局按「该段开始时刻」升序(同一时刻按题号) ⇒ 铺轴顺序 = 学生实际动手顺序
    raws.sort((a, b) => a.startMs - b.startMs || a.index - b.index);

    // 每题段数(供悬停显示「第 k/M 段」)
    const totalByIdx = new Map<number, number>();
    for (const r of raws) totalByIdx.set(r.index, (totalByIdx.get(r.index) || 0) + 1);

    // 开考时刻(墙钟),仅用于把「开考后 x 分」写进悬停提示
    const t0Raw = ms(startedAt);
    const t0Ms = Number.isFinite(t0Raw) ? t0Raw : null;

    // ③ 首尾相接铺满整条轴:每段的 from 恒等于上一段的 to ⇒ 无空隙、无重叠
    const segs: GanttSeg[] = [];
    const segsByIndex = new Map<number, GanttSeg[]>();
    const seenByIdx = new Map<number, number>();
    let cum = 0;
    let prevIndex: number | null = null;
    for (const r of raws) {
      const segNo = (seenByIdx.get(r.index) || 0) + 1;
      seenByIdx.set(r.index, segNo);
      const seg: GanttSeg = {
        index: r.index,
        segNo,
        segTotal: totalByIdx.get(r.index) || 1,
        from: cum,
        to: cum + r.durSec,
        durSec: r.durSec,
        isCorrect: r.isCorrect,
        offsetSec: t0Ms == null ? null : (r.startMs - t0Ms) / 1000,
        synthesized: r.synthesized,
        splitBefore: prevIndex === r.index,
      };
      segs.push(seg);
      const arr = segsByIndex.get(r.index) || [];
      arr.push(seg);
      segsByIndex.set(r.index, arr);
      cum += r.durSec;
      prevIndex = r.index;
    }
    const totalSec = cum;
    // 全零停留的极端情况:给一个 1 秒的退化定义域,避免除零
    const domain = totalSec > 0 ? totalSec : 1;

    // 考试墙钟跨度(仅用于右下角对照,不参与横轴映射)
    const s0 = ms(startedAt);
    const s1 = ms(submittedAt);
    let spanSec = 0;
    if (Number.isFinite(s0) && Number.isFinite(s1) && s1 > s0) {
      spanSec = (s1 - s0) / 1000;
    } else {
      // 缺 startedAt/submittedAt 时用停留段极值兜底
      const starts = raws.map((r) => r.startMs);
      const ends = raws.map((r) => r.startMs + r.durSec * 1000);
      if (starts.length) spanSec = Math.max(0, (Math.max(...ends) - Math.min(...starts)) / 1000);
    }

    const ticks: number[] = [];
    if (totalSec > 0) {
      const step = ganttStep(domain);
      for (let s = 0; s <= domain + 1e-6; s += step) ticks.push(Math.min(s, domain));
      if (ticks.length === 0) ticks.push(0);
      // 末刻度固定落在累计作答终点;若与上一个刻度贴得太近(不足半步),直接顶掉它,
      // 避免出现「8:00 / 8:40」这种挤在一起的标签。
      const lastTick = ticks[ticks.length - 1];
      if (domain - lastTick > step * 0.5) ticks.push(domain);
      else ticks[ticks.length - 1] = domain;
    } else {
      ticks.push(0);
    }

    return {
      segs,
      segsByIndex,
      totalSec,
      domain,
      spanSec,
      ticks,
      questionCount: totalByIdx.size, // 有停留记录的题数
      segCount: raws.length, // 停留段总数(一题多段时 > 题数)
      multiCount: Array.from(totalByIdx.values()).filter((n) => n > 1).length, // 出现多段的题数
    };
  }, [perQuestion, startedAt, submittedAt]);

  if (!model) return null;

  const { segsByIndex, totalSec, domain, spanSec, ticks, questionCount, segCount, multiCount } = model;
  const rows = perQuestion;
  const height = GANTT_TOP + rows.length * GANTT_ROW_H + 4;
  const x0 = GANTT_LABEL_W;
  const x1 = GANTT_W - GANTT_PAD_R;
  const plotW = x1 - x0;
  const xOf = (sec: number) => x0 + (sec / domain) * plotW;
  const barH = GANTT_ROW_H - 7;
  const blankSec = Math.max(0, spanSec - totalSec);

  return (
    <div>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${GANTT_W} ${height}`}
          className="h-auto w-full min-w-[420px]"
          role="img"
          aria-label="整场考试时间分配甘特图"
        >
          {/* 时间刻度 + 竖向网格 */}
          {ticks.map((s, i) => {
            const px = xOf(s);
            const isLast = i === ticks.length - 1;
            return (
              <g key={`tk-${i}`}>
                <line
                  x1={px}
                  y1={GANTT_TOP - 4}
                  x2={px}
                  y2={height - 4}
                  stroke="#eef2f7"
                  strokeWidth={1}
                />
                <text
                  x={isLast ? px - 2 : px}
                  y={GANTT_TOP - 10}
                  textAnchor={isLast ? "end" : i === 0 ? "start" : "middle"}
                  fontSize={9}
                  fill="#94a3b8"
                >
                  {fmtClock(s)}
                </text>
              </g>
            );
          })}
          {/* 刻度单位说明:横轴是累计作答时间,不是墙钟时间 */}
          <text x={2} y={GANTT_TOP - 10} fontSize={8.5} fill="#cbd5e1">
            累计作答
          </text>
          <line x1={x0} y1={GANTT_TOP - 4} x2={x0} y2={height - 4} stroke="#e2e8f0" strokeWidth={1} />

          {/* 每道题一行:该题的所有停留段都画在这一行上(一题多段 ⇒ 多条条带) */}
          {rows.map((q, i) => {
            const rowY = GANTT_TOP + i * GANTT_ROW_H;
            const rowSegs = segsByIndex.get(q.index) || [];
            return (
              <g key={q.questionId || `row-${i}`} className="group">
                <rect
                  x={0}
                  y={rowY}
                  width={GANTT_W}
                  height={GANTT_ROW_H}
                  className="fill-slate-100 opacity-0 transition-opacity group-hover:opacity-100"
                />
                <text
                  x={x0 - 6}
                  y={rowY + GANTT_ROW_H / 2 + 3.4}
                  textAnchor="end"
                  fontSize={9.5}
                  fill="#64748b"
                >
                  {`第${q.index}题`}
                </text>
                {rowSegs.length > 0 ? (
                  rowSegs.map((seg) => {
                    // 相邻段共用同一个坐标换算 ⇒ 前一段右端恒等于后一段左端,无缝拼接
                    const bx = xOf(seg.from);
                    const bw = Math.max(MIN_BAR_W, xOf(seg.to) - xOf(seg.from));
                    const tip =
                      `第 ${seg.index} 题${seg.segTotal > 1 ? `(第 ${seg.segNo}/${seg.segTotal} 段)` : ""}\n` +
                      `累计作答 ${fmtClock(seg.from)} → ${fmtClock(seg.to)}\n` +
                      `本段停留 ${fmtDur(seg.durSec)}（${labelOf(seg.isCorrect)}）` +
                      (seg.offsetSec != null && seg.offsetSec >= 0
                        ? `\n该段开始于:开考后 ${fmtClock(seg.offsetSec)}`
                        : "") +
                      (seg.synthesized ? "\n(老会话无分段数据,按累计用时合成单段)" : "");
                    return (
                      <g key={`${q.questionId || i}-${seg.segNo}`}>
                        <rect
                          data-bar={seg.index}
                          data-seg={seg.segNo}
                          data-seg-total={seg.segTotal}
                          data-from={seg.from}
                          data-to={seg.to}
                          x={bx}
                          y={rowY + 3.5}
                          width={bw}
                          height={barH}
                          rx={2}
                          fill={barColor(seg.isCorrect)}
                          fillOpacity={0.92}
                        >
                          <title>{tip}</title>
                        </rect>
                        {/* 轴上前一段属于同一题 ⇒ 在交界处画一条细线,
                            否则两段会被误读成一条(学生只是离开/暂停后直接回来、中间没做别的题的常见情形) */}
                        {seg.splitBefore && (
                          <line
                            data-split={seg.index}
                            x1={bx}
                            y1={rowY + 3.5}
                            x2={bx}
                            y2={rowY + 3.5 + barH}
                            stroke="#ffffff"
                            strokeWidth={1}
                            opacity={0.8}
                            pointerEvents="none"
                          />
                        )}
                      </g>
                    );
                  })
                ) : (
                  <text x={x0 + 4} y={rowY + GANTT_ROW_H / 2 + 3.4} fontSize={9} fill="#cbd5e1">
                    未作答
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* 图例 + 统计 */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-3 rounded-sm" style={{ background: COLOR_OK }} />
          答对
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-3 rounded-sm" style={{ background: COLOR_BAD }} />
          答错
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-3 rounded-sm" style={{ background: COLOR_UNKNOWN }} />
          未判分
        </span>
        <span className="ml-auto text-slate-400">
          {questionCount} 题有记录
          {segCount > questionCount ? ` · 共 ${segCount} 段(${multiCount} 题回看过)` : ""}
          {` · 累计作答 ${fmtDur(totalSec)} · 考试跨度 ${fmtClock(spanSec)}`}
          {blankSec >= 5 ? ` · 已剔除空白 ${fmtDur(blankSec)}` : ""}
        </span>
      </div>

      <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
        横轴为
        <span className="font-medium text-slate-500">累计作答时间</span>
        :把每次停留按开始先后首尾相接铺满整条轴,中途退出/暂停等空白时段已整体剔除,
        因此所有条带连续无空隙、长度即该段真实停留时长;纵轴为题号。
        同一题出现
        <span className="font-medium text-slate-500">多条条带</span>
        表示学生中途离开过、之后又回来做这道题(每次进入各计一段),悬停可看是第几段及其开始时刻。
      </p>
    </div>
  );
}
