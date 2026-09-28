"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { StudentAnalytics } from "@/components/AcademicAnalytics";
import GpaReportView from "@/components/GpaReportView";

interface Child { id: string; name: string; studentNo?: string | null; relation?: string | null; }
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
interface Records { classes: Cls[]; exams: ExamScore[]; feedbacks: Feedback[]; timetable: TimetableItem[]; }

const DAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const TYPES: Record<string, string> = { DAILY: "日常", MONTHLY: "月考", MIDTERM: "期中", FINAL: "期末", OTHER: "其他" };

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

export default function ParentPage() {
  const [children, setChildren] = useState<Child[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"scores" | "feedback" | "timetable" | "gpa" | "analytics">("scores");
  const [records, setRecords] = useState<Records | null>(null);
  const [planning, setPlanning] = useState<any>(null);
  const [planningVisible, setPlanningVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [recLoading, setRecLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get<{ children: Child[] }>("/academics/children")
      .then((d) => {
        setChildren(d.children || []);
        if (d.children && d.children[0]) setSelectedId(d.children[0].id);
      })
      .catch((e) => setError(e.message || "加载失败"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedId) { setRecords(null); setPlanning(null); return; }
    setRecLoading(true);
    api
      .get<{ records: Records; planningVisible: boolean; planning: any }>(`/academics/children/${selectedId}/records`)
      .then((d) => {
        setRecords(d.records);
        setPlanningVisible(!!d.planningVisible);
        setPlanning(d.planning || null);
      })
      .catch((e) => setError(e.message || "加载孩子档案失败"))
      .finally(() => setRecLoading(false));
  }, [selectedId]);

  if (loading) return <p className="text-slate-500">加载中…</p>;
  if (error) return <p className="text-red-500">{error}</p>;

  const timetableGrid = (() => {
    if (!records) return { maxPeriod: 0, grid: {} as Record<number, Record<number, TimetableItem[]>>, periodMeta: {} as Record<number, { label?: string | null; time?: string | null }>, spanByDay: {} as Record<number, { runs: Record<number, { len: number; items: TimetableItem[] }>; covered: Record<number, boolean> }> };
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
  const subjectColorMap = buildSubjectColorMap((records?.timetable ?? []).map((t) => t.subject));

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-slate-800">孩子学情</h1>
      {children.length === 0 && <p className="text-slate-500">您当前尚未关联到任何学生。请确认注册时填写的「学号 + 姓名」与学校登记信息完全一致;若仍有问题请联系班主任核实处理。</p>}

      <div className="flex flex-wrap gap-2">
        {children.map((c) => (
          <button
            key={c.id}
            onClick={() => setSelectedId(c.id)}
            className={`rounded-lg border px-4 py-2 ${selectedId === c.id ? "border-indigo-400 bg-indigo-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
          >
            <div className="font-medium text-slate-800">{c.name}</div>
            <div className="text-xs text-slate-500">{c.studentNo || "—"}{c.relation ? ` · ${c.relation}` : ""}</div>
          </button>
        ))}
      </div>

      {recLoading && <p className="text-slate-400">加载中…</p>}
      {records && (
        <div className="space-y-4">
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {records.classes.map((c) => (
              <div key={c.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-base font-semibold text-slate-800">{c.name}</div>
                <div className="mt-1 text-sm text-slate-500">{c.grade || "—"} · {c.academicYear} {c.term}</div>
              </div>
            ))}
          </section>

          {planningVisible && planning && (
            <section className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-4">
              <h3 className="mb-2 text-sm font-medium text-indigo-700">升学规划(教师共享)</h3>
              <pre className="whitespace-pre-wrap text-xs text-slate-600">{JSON.stringify(planning, null, 2)}</pre>
            </section>
          )}

          <div className="flex gap-2 border-b border-slate-200">
            {[{ k: "scores", l: "成绩与排名" }, { k: "feedback", l: "教师反馈" }, { k: "timetable", l: "课程表" }, { k: "gpa", l: "成绩单" }, { k: "analytics", l: "学情统计" }].map((t) => (
              <button key={t.k} onClick={() => setTab(t.k as typeof tab)} className={`px-4 py-2 text-sm ${tab === t.k ? "border-b-2 border-indigo-500 font-medium text-indigo-600" : "text-slate-500 hover:text-slate-700"}`}>{t.l}</button>
            ))}
          </div>

          {tab === "scores" && (
            <section className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-slate-500"><tr>
                  <th className="px-3 py-2 text-left">班级</th><th className="px-3 py-2 text-left">科目</th><th className="px-3 py-2 text-left">考试</th>
                  <th className="px-3 py-2 text-left">类型</th><th className="px-3 py-2 text-left">日期</th><th className="px-3 py-2 text-right">得分</th>
                  <th className="px-3 py-2 text-right">满分</th><th className="px-3 py-2 text-right">班级排名</th><th className="px-3 py-2 text-left">评语</th>
                </tr></thead>
                <tbody>
                  {records.exams.length === 0 && <tr><td colSpan={9} className="px-3 py-4 text-center text-slate-400">暂无成绩记录</td></tr>}
                  {records.exams.map((e) => (
                    <tr key={e.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">{e.className}</td>
                      <td className="px-3 py-2">{e.subject}</td>
                      <td className="px-3 py-2">{e.title}</td>
                      <td className="px-3 py-2">{TYPES[e.type] || e.type}</td>
                      <td className="px-3 py-2">{new Date(e.examDate).toLocaleDateString()}</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-800">{e.score ? e.score.score : <span className="text-slate-300">—</span>}</td>
                      <td className="px-3 py-2 text-right text-slate-500">{e.totalScore}</td>
                      <td className="px-3 py-2 text-right">{e.score && e.score.rankInClass != null ? <span className="rounded bg-indigo-50 px-2 py-0.5 text-indigo-600">第 {e.score.rankInClass} 名</span> : <span className="text-slate-300">—</span>}</td>
                      <td className="px-3 py-2 text-slate-600">{e.score?.comment || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

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
              {records.timetable.length === 0 ? <p className="p-4 text-slate-500">暂无课程表。</p> : (
                <table className="min-w-full text-sm">
                  <thead className="text-slate-500"><tr><th className="px-2 py-2 text-left">节次</th>{DAYS.map((d) => <th key={d} className="px-2 py-2 text-center">{d}</th>)}</tr></thead>
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

          {tab === "analytics" && selectedId && <StudentAnalytics studentId={selectedId} />}
          {tab === "gpa" && selectedId && <GpaReportView studentId={selectedId} />}
        </div>
      )}
    </div>
  );
}
