"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// ============ 作用域钩子(前端界面裁剪) ============
export interface Scope {
  role: string;
  isAdmin: boolean;
  classIds: string[];
  classSubjects: Record<string, string[] | null>;
  subjects: string[];
}

export function useScopes(): Scope | null {
  const [scope, setScope] = useState<Scope | null>(null);
  useEffect(() => {
    api
      .get<Scope>("/academics/my-scopes")
      .then(setScope)
      .catch(() =>
        setScope({ role: "", isAdmin: false, classIds: [], classSubjects: {}, subjects: [] })
      );
  }, []);
  return scope;
}

// recharts 依赖浏览器尺寸测量,SSR 阶段渲染会报警,统一用 mounted 门控
function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

const PALETTE = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#0ea5e9", "#8b5cf6", "#ec4899", "#14b8a6"];

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-center">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-bold text-slate-800">{value}</div>
      {hint && <div className="text-[10px] text-slate-400">{hint}</div>}
    </div>
  );
}

function ChartFrame({ height = 260, children }: { height?: number; children: React.ReactNode }) {
  const mounted = useMounted();
  if (!mounted) return <div style={{ height }} className="rounded-lg border border-slate-100 bg-slate-50" />;
  return (
    <div style={{ width: "100%", height }} className="rounded-lg border border-slate-200 bg-white p-2">
      <ResponsiveContainer width="100%" height="100%">
        {children as any}
      </ResponsiveContainer>
    </div>
  );
}

// ============ 单场考试学情 ============
interface ExamAnalyticsData {
  exam: { id: string; classId: string; className: string; subject: string; title: string; type: string; examDate: string; totalScore: number };
  stats: { count: number; mean: number | null; median: number | null; std: number | null; max: number | null; min: number | null; passRate: number | null; distribution: { label: string; count: number; pct: number }[] };
  scores: { studentId: string; name: string; studentNo?: string | null; score: number; rankInClass: number | null }[];
}

export function ExamAnalytics({ examId }: { examId: string }) {
  const [data, setData] = useState<ExamAnalyticsData | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    setData(null);
    setErr("");
    api
      .get<ExamAnalyticsData>(`/academics/analytics/exam/${examId}`)
      .then(setData)
      .catch((e) => setErr(e.message || "加载失败"));
  }, [examId]);

  if (err) return <p className="text-sm text-red-500">{err}</p>;
  if (!data) return <p className="text-sm text-slate-400">加载中…</p>;
  const s = data.stats;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <StatCard label="参考人数" value={s.count} />
        <StatCard label="平均分" value={s.mean ?? "—"} />
        <StatCard label="中位数" value={s.median ?? "—"} />
        <StatCard label="标准差" value={s.std ?? "—"} hint="离散程度" />
        <StatCard label="最高分" value={s.max ?? "—"} />
        <StatCard label="最低分" value={s.min ?? "—"} />
        <StatCard label="及格率" value={s.passRate != null ? `${s.passRate}%` : "—"} />
      </div>

      <div>
        <h4 className="mb-1 text-sm font-medium text-slate-600">分数段分布</h4>
        <ChartFrame height={240}>
          <BarChart data={s.distribution}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
            <Tooltip formatter={(v: any) => [`${v} 人`, "人数"]} />
            <Bar dataKey="count" name="人数" radius={[4, 4, 0, 0]}>
              {s.distribution.map((_, i) => (
                <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
              ))}
            </Bar>
          </BarChart>
        </ChartFrame>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">姓名</th>
              <th className="px-3 py-2 text-left">学号</th>
              <th className="px-3 py-2 text-right">得分</th>
              <th className="px-3 py-2 text-right">班级排名</th>
            </tr>
          </thead>
          <tbody>
            {data.scores.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-400">暂无成绩</td></tr>
            )}
            {data.scores.map((r) => (
              <tr key={r.studentId} className="border-t border-slate-100">
                <td className="px-3 py-2">{r.name}</td>
                <td className="px-3 py-2 text-slate-500">{r.studentNo || "—"}</td>
                <td className="px-3 py-2 text-right font-semibold text-slate-800">{r.score}</td>
                <td className="px-3 py-2 text-right">
                  {r.rankInClass != null ? (
                    <span className="rounded bg-indigo-50 px-2 py-0.5 text-indigo-600">第 {r.rankInClass} 名</span>
                  ) : <span className="text-slate-300">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============ 班级学情汇总 ============
interface ClassAnalyticsData {
  classId: string;
  examCount: number;
  perExam: { id: string; subject: string; title: string; examDate: string; totalScore: number; count: number; mean: number | null; median: number | null; std: number | null; max: number | null; min: number | null; passRate: number | null }[];
  subjects: { subject: string; examCount: number; avgMean: number; avgPassRate: number }[];
}

export function ClassAnalytics({ classId }: { classId: string }) {
  const [data, setData] = useState<ClassAnalyticsData | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    setData(null);
    setErr("");
    api
      .get<ClassAnalyticsData>(`/academics/analytics/class/${classId}`)
      .then(setData)
      .catch((e) => setErr(e.message || "加载失败"));
  }, [classId]);

  if (err) return <p className="text-sm text-red-500">{err}</p>;
  if (!data) return <p className="text-sm text-slate-400">加载中…</p>;
  if (data.examCount === 0) return <p className="text-sm text-slate-400">该班级暂无考试数据。</p>;

  const trend = data.perExam.map((e) => ({
    name: `${e.subject}·${new Date(e.examDate).getMonth() + 1}/${new Date(e.examDate).getDate()}`,
    mean: e.mean ?? 0,
    passRate: e.passRate ?? 0,
  }));

  return (
    <div className="space-y-4">
      <h4 className="text-sm font-medium text-slate--600">各次考试均值趋势</h4>
      <ChartFrame height={280}>
        <LineChart data={trend}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={50} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="mean" name="平均分" stroke={PALETTE[0]} strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ChartFrame>

      <h4 className="text-sm font-medium text-slate--600">各科目汇总</h4>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">科目</th>
              <th className="px-3 py-2 text-right">考试次数</th>
              <th className="px-3 py-2 text-right">平均均分</th>
              <th className="px-3 py-2 text-right">平均及格率</th>
            </tr>
          </thead>
          <tbody>
            {data.subjects.map((s) => (
              <tr key={s.subject} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium">{s.subject}</td>
                <td className="px-3 py-2 text-right text-slate-500">{s.examCount}</td>
                <td className="px-3 py-2 text-right">{s.avgMean}</td>
                <td className="px-3 py-2 text-right">{s.avgPassRate}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="rounded-lg border border-slate-200 bg-white p-3">
        <summary className="cursor-pointer text-sm text-slate-600">展开各次考试明细</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">科目</th>
                <th className="px-3 py-2 text-left">考试</th>
                <th className="px-3 py-2 text-right">人数</th>
                <th className="px-3 py-2 text-right">均分</th>
                <th className="px-3 py-2 text-right">中位数</th>
                <th className="px-3 py-2 text-right">标准差</th>
                <th className="px-3 py-2 text-right">及格率</th>
              </tr>
            </thead>
            <tbody>
              {data.perExam.map((e) => (
                <tr key={e.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{e.subject}</td>
                  <td className="px-3 py-2">{e.title}</td>
                  <td className="px-3 py-2 text-right text-slate-500">{e.count}</td>
                  <td className="px-3 py-2 text-right">{e.mean ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{e.median ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{e.std ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{e.passRate != null ? `${e.passRate}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

// ============ 学生个人学情 ============
interface StudentAnalyticsData {
  student: { id: string; name: string; studentNo?: string | null };
  overall: { examCount: number; mean: number | null };
  subjects: {
    subject: string;
    examCount: number;
    mean: number | null;
    best: number | null;
    latest: { score: number; title: string; examDate: string } | null;
    items: { examId: string; title: string; examDate: string; totalScore: number; score: number | null; rankInClass: number | null; classMean: number | null }[];
  }[];
}

export function StudentAnalytics({ studentId }: { studentId: string }) {
  const [data, setData] = useState<StudentAnalyticsData | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    setData(null);
    setErr("");
    api
      .get<StudentAnalyticsData>(`/academics/analytics/student/${studentId}`)
      .then(setData)
      .catch((e) => setErr(e.message || "加载失败"));
  }, [studentId]);

  if (err) return <p className="text-sm text-red-500">{err}</p>;
  if (!data) return <p className="text-sm text-slate-400">加载中…</p>;
  if (data.subjects.length === 0) return <p className="text-sm text-slate-400">该学生暂无考试数据。</p>;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <StatCard label="综合平均" value={data.overall.mean ?? "—"} hint={`${data.overall.examCount} 次成绩`} />
        {data.subjects.map((s) => (
          <StatCard key={s.subject} label={s.subject} value={s.mean ?? "—"} hint={s.best != null ? `最佳 ${s.best}` : undefined} />
        ))}
      </div>

      {data.subjects.map((s) => {
        const points = s.items
          .filter((i) => i.score != null)
          .map((i) => ({
            name: `${new Date(i.examDate).getMonth() + 1}/${new Date(i.examDate).getDate()}`,
            score: i.score as number,
            classMean: i.classMean ?? 0,
          }));
        return (
          <div key={s.subject} className="rounded-lg border border-slate-200 bg-white p-3">
            <h4 className="mb-1 text-sm font-medium text-slate-700">{s.subject} · 个人得分 vs 班级均值</h4>
            {points.length === 0 ? (
              <p className="text-xs text-slate-400">无成绩</p>
            ) : (
              <ChartFrame height={220}>
                <LineChart data={points}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="score" name="我的得分" stroke={PALETTE[0]} strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="classMean" name="班级均值" stroke={PALETTE[1]} strokeDasharray="4 4" dot={false} />
                </LineChart>
              </ChartFrame>
            )}
          </div>
        );
      })}
    </div>
  );
}
