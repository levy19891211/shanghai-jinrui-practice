"use client";

// GPA 过程性考核成绩查看(学生本人/家长/教师预览共用)
// 数据:GET /api/gpa/report/:studentId?academicYear=
// 含:按课程×学季的过程性成绩(期末/期中/平时)+ 综合评定 + 可打印成绩单(TranscriptReport)
//
// 打印机制(防「点了没反应/打印空白」):
//   成绩单副本经 React Portal 常驻挂在 document.body 直下的 #print-portal
//   (屏幕上 display:none,打印时显示并隐藏 body 其余子节点,见 GpaPrintStyle)。
//   因此点「打印」直接 window.print() 即可,无任何时序竞态;内容走正常文档流,
//   多页分页正确,且不受祖先 overflow/position/transform 影响。

import { Fragment, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import TranscriptReport, { GpaPrintStyle, SEASONS, type GpaReportData } from "./TranscriptReport";

function fmt(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const v = Math.round(n * 10) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

const LEVEL_STYLE: Record<string, string> = {
  A: "bg-emerald-100 text-emerald-700",
  B: "bg-sky-100 text-sky-700",
  C: "bg-amber-100 text-amber-700",
  D: "bg-orange-100 text-orange-700",
  E: "bg-rose-100 text-rose-700",
};

export default function GpaReportView({ studentId, showPrint = true }: { studentId: string; showPrint?: boolean }) {
  const [years, setYears] = useState<string[]>([]);
  const [year, setYear] = useState<string>("");
  const [data, setData] = useState<GpaReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Portal 只能在客户端挂载后创建(SSR 无 document)
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    api
      .get<{ academicYears: string[] }>("/gpa/meta")
      .then((d) => {
        const ys = d.academicYears || [];
        setYears(ys);
        if (ys[0]) setYear(ys[0]);
      })
      .catch(() => {}); // meta 失败不阻塞,report 会用缺省学年
  }, []);

  useEffect(() => {
    if (!studentId) return;
    setLoading(true);
    setError("");
    api
      .get<GpaReportData>(`/gpa/report/${studentId}${year ? `?academicYear=${encodeURIComponent(year)}` : ""}`)
      .then((d) => setData(d))
      .catch((e) => setError(e.message || "加载失败"))
      .finally(() => setLoading(false));
  }, [studentId, year]);

  return (
    <div className="space-y-3">
      <GpaPrintStyle />
      <div className="flex flex-wrap items-center gap-2">
        {years.length > 0 && (
          <select value={year} onChange={(e) => setYear(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 ui-select">
            {years.map((y) => (
              <option key={y} value={y}>{y} 学年</option>
            ))}
          </select>
        )}
        {showPrint && (
          <button
            onClick={() => window.print()}
            disabled={!data}
            className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            打印成绩单 / 保存 PDF
          </button>
        )}
        <button
          onClick={() => setShowPreview((v) => !v)}
          disabled={!data}
          className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {showPreview ? "收起预览" : "查看 A4 预览"}
        </button>
        {showPrint && <span className="text-xs text-slate-400">打印时自动隐藏页面其余内容,仅输出成绩单</span>}
      </div>

      {loading && <p className="text-slate-400">加载中…</p>}
      {error && <p className="text-rose-500">{error}</p>}
      {data && !data.courses.length && !loading && <p className="text-slate-400">暂无 GPA 课程与成绩数据(等待教师配置课程并登记成绩)。</p>}

      {data && data.courses.length > 0 && (
        <section className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">课程模块</th>
                <th className="px-3 py-2 text-left">课程</th>
                <th className="px-3 py-2 text-left">学季</th>
                <th className="px-3 py-2 text-right">期末</th>
                <th className="px-3 py-2 text-right">期中</th>
                <th className="px-3 py-2 text-right">平时</th>
                <th className="px-3 py-2 text-right">考核得分</th>
                <th className="px-3 py-2 text-center">评定等级</th>
              </tr>
            </thead>
            <tbody>
              {data.courses.map((c) => {
                const seasonRows = SEASONS.filter((s) => c.seasons?.[s]);
                const hasAny = seasonRows.length > 0;
                const rowSpan = hasAny ? seasonRows.length + 1 : 1;
                return (
                  <Fragment key={c.id}>
                    {!hasAny && (
                      <tr key={c.id} className="border-t border-slate-100">
                        <td className="px-3 py-2 text-slate-500">{c.module}</td>
                        <td className="px-3 py-2">{c.name}</td>
                        <td className="px-3 py-2 text-slate-300" colSpan={6}>暂无成绩</td>
                      </tr>
                    )}
                    {hasAny &&
                      seasonRows.map((s, idx) => {
                        const cell = c.seasons![s]!;
                        return (
                          <tr key={c.id + s} className="border-t border-slate-100">
                            {idx === 0 && <td className="px-3 py-2 text-slate-500 align-top" rowSpan={rowSpan}>{c.module}</td>}
                            {idx === 0 && <td className="px-3 py-2 align-top" rowSpan={rowSpan}>{c.name}</td>}
                            <td className="px-3 py-2 text-slate-400 text-xs">{s}</td>
                            <td className="px-3 py-2 text-right">{fmt(cell.final)}</td>
                            <td className="px-3 py-2 text-right">{fmt(cell.midterm)}</td>
                            <td className="px-3 py-2 text-right">{fmt(cell.regular)}</td>
                            <td className="px-3 py-2 text-right font-semibold text-slate-800">{fmt(cell.comprehensive)}</td>
                            <td className="px-3 py-2 text-center">
                              {cell.level ? (
                                <span className={`rounded px-2 py-0.5 text-xs font-semibold ${LEVEL_STYLE[cell.level] || "bg-slate-100 text-slate-600"}`}>{cell.level}</span>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    {hasAny && (
                      <tr key={c.id + "year"} className="border-t border-slate-100 bg-slate-50">
                        <td className="px-3 py-2 text-right font-medium text-slate-500" colSpan={4}>
                          学年综合评定
                          <span className="ml-1 text-xs text-slate-400">(期末{c.weights.final}%/期中{c.weights.midterm}%/平时{c.weights.regular}%)</span>
                        </td>
                        <td className="px-3 py-2 text-right font-bold text-indigo-700">{fmt(c.yearScore)}</td>
                        <td className="px-3 py-2 text-center">
                          {c.yearLevel ? (
                            <span className={`rounded px-2 py-0.5 text-xs font-semibold ${LEVEL_STYLE[c.yearLevel] || "bg-slate-100 text-slate-600"}`}>{c.yearLevel}</span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {/* 屏幕上的 A4 预览(仅查看;打印输出走下方 Portal 副本) */}
      {showPreview && data && (
        <div className="rounded-lg border border-slate-300 bg-slate-100 p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">成绩单预览(A4)</h3>
          <TranscriptReport data={data} domId="transcript-preview" />
        </div>
      )}

      {/* 打印专用副本:Portal 挂 body 直下,常驻隐藏,打印时唯一可见 */}
      {mounted && data &&
        createPortal(
          <div id="print-portal">
            <TranscriptReport data={data} domId="transcript-print" />
          </div>,
          document.body
        )}
    </div>
  );
}
