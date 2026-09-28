"use client";

// 成绩单(按样张「上海金瑞学校高中部综合学业成绩报告」版式复刻)
// 数据来源:GET /api/gpa/report/:studentId 的返回
// 打印:宿主页面需包含 id="transcript-print" 容器与打印 CSS(见 GpaPrintStyle)

import { Fragment } from "react";
import type { ReactNode } from "react";

export interface GpaSeasonCell {
  final: number | null;
  midterm: number | null;
  regular: number | null;
  comprehensive: number | null;
  level: string | null;
}
export interface GpaCourseRow {
  id: string;
  module: string;
  name: string;
  weeklyHours: number | null;
  weights: { final: number; midterm: number; regular: number };
  seasons: Record<string, GpaSeasonCell | null>;
  yearScore: number | null;
  yearLevel: string | null;
}
export interface GpaReportData {
  student: {
    id: string;
    name: string;
    studentNo?: string | null;
    gender?: string | null;
    birthDate?: string | null;
    enrollmentDate?: string | null;
  };
  academicYear: string;
  grade: string;
  courses: GpaCourseRow[];
}

export const SEASONS = ["夏季学", "秋季学", "冬季学", "春季学"];

// 打印样式:打印内容经 React Portal 挂在 body 直下的 #print-portal(始终存在,屏幕上隐藏),
// 打印时隐藏 body 其余全部子节点、仅显示 #print-portal。
// 不再依赖 visibility/absolute 技巧:内容走正常文档流,多页分页正确,且不受任何
// 祖先 overflow/position/transform 影响(旧方案「打印空白/无反应」的根因)。
export function GpaPrintStyle() {
  return (
    <style>{`
#print-portal { display: none; }
@media print {
  body > *:not(#print-portal) { display: none !important; }
  #print-portal { display: block !important; }
  .no-print { display: none !important; }
}
@page { size: A4 portrait; margin: 10mm; }
`}</style>
  );
}

// 得分格式化:最多 1 位小数,去掉多余的 .0
function fmtScore(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "";
  const v = Math.round(n * 10) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
function fmtDate(d: string | null | undefined, withDay: boolean): string {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  const y = dt.getFullYear();
  const m = dt.getMonth() + 1;
  return withDay ? `${y}年${m}月${dt.getDate()}日` : `${y}年${m}月`;
}

// 校徽:金瑞官方 logo(矢量 SVG,自 public/transcript/jinrui-logo.svg 加载,透明底)
// 纵版组合:盾徽 + 「上海金瑞学校 JINRUI SCHOOL SHANGHAI」;页眉与水印共用
function SchoolLogo({ width = 116, opacity = 1 }: { width?: number; opacity?: number }) {
  return (
    <img
      src="/transcript/jinrui-logo.svg"
      alt="上海金瑞学校 JINRUI SCHOOL SHANGHAI"
      width={width}
      style={{ opacity, display: "block" }}
    />
  );
}

export default function TranscriptReport({ data, domId = "transcript-print" }: { data: GpaReportData; domId?: string }) {
  const { student, grade, courses } = data;

  // 模块相邻合并(rowSpan)
  const rows: { course: GpaCourseRow; moduleRowSpan: number; showModule: boolean }[] = [];
  for (let i = 0; i < courses.length; i++) {
    const c = courses[i];
    const prev = courses[i - 1];
    const showModule = !prev || prev.module !== c.module;
    if (showModule) {
      let span = 1;
      for (let j = i + 1; j < courses.length && courses[j].module === c.module; j++) span++;
      rows.push({ course: c, moduleRowSpan: span, showModule: true });
    } else {
      rows.push({ course: c, moduleRowSpan: 0, showModule: false });
    }
  }

  const infoCell = (label: string, value: ReactNode) => (
    <div className="flex items-baseline">
      <span className="shrink-0 text-[13px] tracking-wide">{label}:</span>
      <span className="ml-1 min-w-[90px] flex-1 border-b border-dotted border-slate-400 pb-0.5 text-center text-[13px]">{value || "\u00A0"}</span>
    </div>
  );

  return (
    <div
      id={domId}
      className="relative mx-auto w-full max-w-[820px] overflow-hidden bg-white px-8 py-6 text-slate-900"
      style={{ fontFamily: '"Songti SC", "STSong", "SimSun", serif' }}
    >
      {/* 水印:官方 logo 居中淡印 */}
      <div className="pointer-events-none absolute left-1/2 top-[55%] -translate-x-1/2 -translate-y-1/2">
        <SchoolLogo width={400} opacity={0.07} />
      </div>

      {/* 页眉三栏 */}
      <div className="relative flex items-start justify-between">
        <div className="w-[190px] pt-1">
          <div className="text-[13px] font-bold tracking-wide text-[#1d3d6e]">JINRUI SCHOOL SHANGHAI</div>
          <div className="mt-0.5 text-[9px] leading-[1.5] text-slate-500">
            No. 169, Jinch Road, Baoshan, Shanghai
            <br />
            200949, China
            <br />
            +86 21-6179788
            <br />
            www.jrschool.org.cn
          </div>
        </div>
        <div className="flex flex-col items-center">
          <SchoolLogo width={116} />
        </div>
        <div className="w-[190px] pt-1 text-right">
          <div className="flex items-center justify-end gap-2">
            <span className="rounded-full bg-[#0a2d6e] px-2 py-0.5 text-[10px] font-bold text-white">Pearson <span className="font-normal">Edexcel</span></span>
            <span className="text-[13px] font-bold lowercase tracking-tight text-[#3aa0d8]">cognia</span>
          </div>
          <div className="mt-1 text-[9px] leading-[1.6] text-slate-600">
            CAIE Number:CX325
            <br />
            Edexcel Number:CN662
            <br />
            Cognia Number:99598
          </div>
        </div>
      </div>

      {/* 标题(红色上下双线) */}
      <div className="relative mt-4 border-y-[3px] border-double border-[#b03a2e] py-2">
        <h1 className="text-center text-[22px] font-bold tracking-[0.12em]">上海金瑞学校高中部综合学业成绩报告</h1>
      </div>

      {/* 学生信息 */}
      <div className="relative mx-auto mt-4 grid max-w-[560px] grid-cols-2 gap-x-12 gap-y-2.5">
        {infoCell("学生姓名", student.name)}
        {infoCell("入学时间", fmtDate(student.enrollmentDate, false))}
        {infoCell("性别", student.gender)}
        {infoCell("年级", grade)}
        {infoCell("出生日期", fmtDate(student.birthDate, true))}
        {infoCell("学号", student.studentNo)}
      </div>

      {/* 成绩表标题 */}
      <div className="relative mt-5 border-y border-slate-500 py-1.5">
        <h2 className="text-center text-[15px] font-semibold tracking-wider">
          高中部{grade || ""}学业成绩情况{data.academicYear ? `（${data.academicYear}学年）` : ""}
        </h2>
      </div>

      {/* 成绩表 */}
      <table className="relative mt-2 w-full table-fixed border-collapse text-[11.5px]">
        <colgroup>
          <col className="w-[68px]" />
          <col />
          <col className="w-[46px]" />
          <col className="w-[52px]" />
          <col className="w-[52px]" />
          {SEASONS.map((s) => (
            <Fragment key={s}>
              <col className="w-[52px]" />
              <col className="w-[52px]" />
            </Fragment>
          ))}
        </colgroup>
        <thead>
          <tr className="border border-slate-400 text-center">
            <th rowSpan={3} className="border border-slate-400 px-1 py-1.5 font-medium">课程模块</th>
            <th rowSpan={3} className="border border-slate-400 px-1 py-1.5 font-medium">课程名称</th>
            <th rowSpan={3} className="border border-slate-400 px-1 py-1.5 font-medium">周课<br />时数</th>
            <th rowSpan={2} colSpan={2} className="border border-slate-400 bg-[#e3ecd8] px-1 py-1.5 font-medium">学年综合评定</th>
            <th colSpan={8} className="border border-slate-400 px-1 py-1.5 font-medium">分学季成绩明细</th>
          </tr>
          <tr className="border border-slate-400 text-center">
            {SEASONS.map((s) => (
              <th key={s} colSpan={2} className="border border-slate-400 py-1 font-medium">{s}</th>
            ))}
          </tr>
          <tr className="border border-slate-400 text-center">
            <th className="border border-slate-400 bg-[#e3ecd8] px-1 py-1 font-medium">考核<br />得分</th>
            <th className="border border-slate-400 bg-[#e3ecd8] px-1 py-1 font-medium">评定<br />等级</th>
            {SEASONS.map((s) => (
              <>
                <th key={s + "a"} className="border border-slate-400 px-1 py-1 font-medium">考核<br />得分</th>
                <th key={s + "b"} className="border border-slate-400 px-1 py-1 font-medium">评定<br />等级</th>
              </>
            ))}
          </tr>
        </thead>
        <tbody>
          {courses.length === 0 && (
            <tr>
              <td colSpan={14} className="border border-slate-400 py-6 text-center text-slate-400">暂无课程与成绩数据</td>
            </tr>
          )}
          {rows.map(({ course: c, moduleRowSpan, showModule }) => (
            <tr key={c.id} className="border border-slate-400 text-center">
              {showModule && (
                <td rowSpan={moduleRowSpan} className="border border-slate-400 px-1 py-1.5 font-medium">{c.module}</td>
              )}
              <td className="border border-slate-400 px-1 py-1.5">{c.name}</td>
              <td className="border border-slate-400 px-1 py-1.5">{c.weeklyHours == null ? "/" : fmtScore(c.weeklyHours)}</td>
              <td className="border border-slate-400 bg-[#f3f7ec] px-1 py-1.5">{fmtScore(c.yearScore)}</td>
              <td className="border border-slate-400 bg-[#f3f7ec] px-1 py-1.5">{c.yearLevel || ""}</td>
              {SEASONS.map((s) => {
                const cell = c.seasons?.[s];
                return (
                  <Fragment key={c.id + s}>
                    <td className="border border-slate-400 px-1 py-1.5">{fmtScore(cell?.comprehensive)}</td>
                    <td className="border border-slate-400 px-1 py-1.5">{cell?.level || ""}</td>
                  </Fragment>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <p className="relative mt-2 text-[9px] text-slate-400">
        注:考核得分 = 期末/期中/平时按课程权重加权(缺项按剩余权重归一);评定等级 A≥90,B≥80,C≥70,D≥60,E&lt;60;学年综合评定 = 四学季考核得分的平均值。
      </p>
    </div>
  );
}
