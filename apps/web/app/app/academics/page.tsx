"use client";

import { useEffect, useState } from "react";
import { api, getUser } from "@/lib/api";
import { StudentAnalytics } from "@/components/AcademicAnalytics";
import StudentCourseSelection from "@/components/StudentCourseSelection";
import StudentScoresByCourse from "@/components/StudentScoresByCourse";
import GpaReportView from "@/components/GpaReportView";

interface Cls { id: string; name: string; grade?: string | null; academicYear: string; term: string; }
interface ExamScore { id: string; className: string; classId: string; subject: string; title: string; type: string; examDate: string; totalScore: number; score: { score: number; rankInClass: number | null; comment: string | null } | null; }
interface Feedback { id: string; content: string; subject?: string | null; visibility: string; status: string; createdAt: string; teacher: { id: string; name: string } | null; }
interface TimetableItem { id: string; dayOfWeek: number; period: number; periodLabel?: string | null; periodTime?: string | null; subject: string; teacher: { id: string; name: string } | null; room?: string | null; academicYear: string; term: string; }

// 连堂课跨行合并:同一天、相邻节次且「科目+教师+教室」集合完全相同 → 合并为一个跨行大格(rowSpan)
// 中间若有空节次则断开(不跨空节误合并)。teacherId 为空时回退到 teacher.id 进行匹配。
function columnSpanRuns(itemsByPeriod: Record<number, TimetableItem[]>, maxPeriod: number) {
  const sig: Record<number, string> = {};
  const itemsAt: Record<number, TimetableItem[]> = {};
  for (let p = 1; p <= maxPeriod; p++) {
    const arr = itemsByPeriod[p] || [];
    itemsAt[p] = arr;
    sig[p] = arr.map((it) => `${it.subject}|${it.teacher?.id ?? ""}|${it.room || ""}`).sort().join("::");
  }
  const runs: Record<number, { len: number; items: TimetableItem[] }> = {};
  const covered: Record<number, boolean> = {};
  for (let p = 1; p <= maxPeriod; p++) {
    if (covered[p]) continue;
    const k = sig[p];
    if (k === "") { runs[p] = { len: 1, items: [] }; continue; }
    let len = 1;
    while (p + len <= maxPeriod && sig[p + len] === k) len++;
    runs[p] = { len, items: itemsAt[p] };
    for (let q = p + 1; q < p + len; q++) covered[q] = true;
  }
  return { runs, covered };
}
interface CourseItem { name: string; type: "REQUIRED" | "ELECTIVE" | "UNKNOWN"; }
interface AssignmentItem {
  id: string;
  title: string;
  subject: string | null;
  dueAt: string | null;
  status: "PENDING" | "SUBMITTED" | "EXPIRED";
  submittedAt: string | null;
  lateSubmit: boolean;
  note: string | null;
}
interface Records {
  classes: Cls[];
  exams: ExamScore[];
  feedbacks: Feedback[];
  courses?: CourseItem[];
  assignments?: AssignmentItem[];
  timetable: TimetableItem[];
}

const DAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

// 课表配色:按去重科目排序序号、以黄金角(约137.5°)步进旋转色相生成浅底/深字,
// 科目数量不限且不同序号色相必不同(不会因调色板循环而撞色,如17门科目);
// 同一科目永远同色;同时间多课(分层走班)大格以第一门课的颜色为准。
const FALLBACK_COLOR = { bg: "#eef2ff", text: "#4338ca" }; // 查表失败兜底
function subjectColorByIndex(i: number): { bg: string; text: string } {
  const h = Math.round((i * 137.508) % 360);
  return { bg: `hsl(${h}, 65%, 93%)`, text: `hsl(${h}, 70%, 28%)` };
}
function buildSubjectColorMap(subjects: string[]): Map<string, { bg: string; text: string }> {
  const distinct = Array.from(new Set(subjects)).sort();
  const m = new Map<string, { bg: string; text: string }>();
  distinct.forEach((s, i) => m.set(s, subjectColorByIndex(i)));
  return m;
}

export default function StudentAcademicsPage() {
  const [records, setRecords] = useState<Records | null>(null);
  const [tab, setTab] = useState<"scores" | "feedback" | "timetable" | "analytics" | "selection" | "gpa">("timetable");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const me = getUser();

  useEffect(() => {
    api
      .get<{ records: Records }>("/academics/me/records")
      .then((d) =>
        setRecords(
          d.records ?? { classes: [], exams: [], feedbacks: [], timetable: [] }
        )
      )
      .catch((e) => setError(e.message || "加载失败"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-slate-500">加载中…</p>;
  if (error) return <p className="text-red-500">{error}</p>;
  if (!records) return null;

  const timetableGrid = (() => {
    const maxPeriod = records.timetable.reduce((m, t) => Math.max(m, t.period), 0);
    // 同一时段可能有多条(分层走班),用数组避免互相覆盖
    const grid: Record<number, Record<number, TimetableItem[]>> = {};
    records.timetable.forEach((t) => {
      grid[t.dayOfWeek] = grid[t.dayOfWeek] || {};
      (grid[t.dayOfWeek][t.period] = grid[t.dayOfWeek][t.period] || []).push(t);
    });
    const periodMeta: Record<number, { label?: string | null; time?: string | null }> = {};
    records.timetable.forEach((t) => { if (!periodMeta[t.period] && (t.periodLabel || t.periodTime)) periodMeta[t.period] = { label: t.periodLabel, time: t.periodTime }; });
    const spanByDay: Record<number, { runs: Record<number, { len: number; items: TimetableItem[] }>; covered: Record<number, boolean> }> = {};
    for (let d = 1; d <= 7; d++) spanByDay[d] = columnSpanRuns(grid[d] || {}, maxPeriod);
    return { maxPeriod, grid, periodMeta, spanByDay };
  })();
  // 科目配色映射:基于当前课表去重科目,保证不同科目不同色(数量<=调色板)
  const subjectColorMap = buildSubjectColorMap(records.timetable.map((t) => t.subject));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-800">课程中心</h1>

      {/* 班级概览 */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {records.classes.length === 0 && <p className="text-slate-500">你当前未加入任何班级。</p>}
        {records.classes.map((c) => (
          <div key={c.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-base font-semibold text-slate-800">{c.name}</div>
            <div className="mt-1 text-sm text-slate-500">
              {c.grade || "—"} · {c.academicYear} {c.term}
            </div>
          </div>
        ))}
      </section>

      {/* Tab 切换 */}
      <div className="flex gap-2 border-b border-slate-200">
        {[
          { k: "scores", label: "成绩与排名" },
          { k: "feedback", label: "教师反馈" },
          { k: "timetable", label: "课程表" },
          { k: "selection", label: "选课" },
          { k: "gpa", label: "各学期成绩" },
          { k: "analytics", label: "学情统计" },
        ].map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k as typeof tab)}
            className={`px-4 py-2 text-sm ${tab === t.k ? "border-b-2 border-indigo-500 font-medium text-indigo-600" : "text-slate-500 hover:text-slate-700"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "scores" && <StudentScoresByCourse records={records} />}

      {tab === "feedback" && (
        <section className="space-y-3">
          {records.feedbacks.length === 0 && <p className="text-slate-500">暂无教师反馈。</p>}
          {records.feedbacks.map((f) => (
            <div key={f.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-1 flex items-center gap-2 text-xs text-slate-400">
                <span>{(f.teacher?.name) || "老师"}</span>
                {f.subject && <span className="rounded bg-slate-100 px-1.5 py-0.5">{f.subject}</span>}
                <span>{new Date(f.createdAt).toLocaleDateString()}</span>
              </div>
              <p className="whitespace-pre-wrap text-sm text-slate-700">{f.content}</p>
            </div>
          ))}
        </section>
      )}

      {tab === "timetable" && (
        <section className="overflow-x-auto rounded-lg border border-slate-200 bg-white p-2">
          {records.timetable.length === 0 ? (
            <p className="p-4 text-slate-500">暂无课程表。</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="px-2 py-2 text-left">节次</th>
                  {DAYS.map((d) => <th key={d} className="px-2 py-2 text-center">{d}</th>)}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: timetableGrid.maxPeriod }, (_, i) => i + 1).map((p) => (
                  <tr key={p} className="border-t border-slate-100">
                    <td className="whitespace-nowrap px-2 py-2 text-slate-500">
                      <div>{timetableGrid.periodMeta[p]?.label || `第 ${p} 节`}</div>
                      {timetableGrid.periodMeta[p]?.time && <div className="text-[10px] text-slate-400">{timetableGrid.periodMeta[p].time}</div>}
                    </td>
                    {DAYS.map((_, di) => {
                      const d = di + 1;
                      const span = timetableGrid.spanByDay[d];
                      if (span.covered[p]) return null;
                      const run = span.runs[p];
                      if (!run || run.items.length === 0) return <td key={di} className="px-2 py-2 align-top" />;
                      // 同一 run 内多科(分层走班)合并为一张卡片,每科单列一行。
                      // 撑满方案:td 设 relative,卡片层 absolute inset 铺满整个跨行单元格;
                      // 另留一份 invisible 占位副本参与行高计算,防止内容被裁切。
                      const teachersLabel = Array.from(new Set(run.items.map((it) => it.teacher?.name).filter(Boolean))).join(" / ") || "—";
                      const roomsLabel = Array.from(new Set(run.items.map((it) => it.room).filter(Boolean))).join(" / ");
                    // 同时间多课(分层走班)大格以第一门课颜色为准
                    const color = subjectColorMap.get(run.items[0]?.subject || "—") || FALLBACK_COLOR;
                      const cardInner = (
                        <>
                          {run.items.map((item) => (
                            <div key={item.id} className="font-medium" style={{ color: color.text }}>{item.subject}</div>
                          ))}
                          <div className="mt-0.5 text-xs text-slate-500">{teachersLabel}</div>
                          {roomsLabel && <div className="text-xs text-slate-400">{roomsLabel}</div>}
                        </>
                      );
                      return (
                        <td key={di} rowSpan={run.len} className="relative px-1 py-1 align-top">
                          <div className="invisible flex flex-col gap-1" aria-hidden="true">
                            <div className="rounded px-1.5 py-2 text-center" style={{ backgroundColor: color.bg }}>{cardInner}</div>
                          </div>
                          <div className="absolute inset-1 flex flex-col items-stretch gap-1">
                            <div className="flex flex-1 flex-col items-center justify-center rounded px-1.5 py-2 text-center" style={{ backgroundColor: color.bg }}>{cardInner}</div>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {tab === "selection" && <StudentCourseSelection />}

      {tab === "gpa" && me && <GpaReportView studentId={me.id} showPrint={false} />}

      {tab === "analytics" && me && <StudentAnalytics studentId={me.id} />}
    </div>
  );
}
