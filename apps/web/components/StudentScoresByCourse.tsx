"use client";

import { useState } from "react";

export interface ScoreCourse {
  name: string;
  type: "REQUIRED" | "ELECTIVE" | "UNKNOWN";
}
export interface ScoreExam {
  id: string;
  className: string;
  classId: string;
  subject: string;
  title: string;
  type: string;
  examDate: string;
  totalScore: number;
  score: { score: number; rankInClass: number | null; comment: string | null } | null;
}
export interface ScoreFeedback {
  id: string;
  content: string;
  subject?: string | null;
  visibility: string;
  status: string;
  createdAt: string;
  teacher: { id: string; name: string } | null;
}
export interface ScoreAssignment {
  id: string;
  title: string;
  subject: string | null;
  dueAt: string | null;
  status: "PENDING" | "SUBMITTED" | "EXPIRED";
  submittedAt: string | null;
  lateSubmit: boolean;
  note: string | null;
}
export interface ScoresRecords {
  exams: ScoreExam[];
  feedbacks: ScoreFeedback[];
  courses?: ScoreCourse[];
  assignments?: ScoreAssignment[];
}

const TYPES: Record<string, string> = {
  DAILY: "日常",
  MONTHLY: "月考",
  MIDTERM: "期中",
  FINAL: "期末",
  OTHER: "其他",
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "未交", cls: "bg-amber-50 text-amber-600" },
  SUBMITTED: { label: "已交", cls: "bg-emerald-50 text-emerald-600" },
  EXPIRED: { label: "逾期未交", cls: "bg-red-50 text-red-600" },
};

function Category({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <h4 className="text-sm font-semibold text-slate-700">{title}</h4>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{count}</span>
      </div>
      {count === 0 ? <p className="text-xs text-slate-400">暂无{title}。</p> : children}
    </div>
  );
}

export default function StudentScoresByCourse({ records }: { records: ScoresRecords }) {
  const courses = records.courses || [];
  const exams = records.exams || [];
  const feedbacks = records.feedbacks || [];
  const assignments = records.assignments || [];

  // 未归科数据(科目不在已选课程中)→ 合成卡片,避免考试/作业/反馈丢失
  const courseNames = new Set(courses.map((c) => c.name));
  const extraSubjects = Array.from(
    new Set([
      ...exams.map((e) => e.subject),
      ...assignments.map((a) => a.subject).filter(Boolean) as string[],
      ...feedbacks.map((f) => f.subject).filter(Boolean) as string[],
    ].filter((s): s is string => !!s && !courseNames.has(s)))
  );
  const allCourses = [
    ...courses,
    ...extraSubjects.map((s) => ({ name: s, type: "UNKNOWN" as const })),
  ];

  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (name: string) =>
    setOpen((prev) => {
      const n = new Set(prev);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });

  if (allCourses.length === 0) return <p className="text-slate-500">暂无课程成绩。</p>;

  return (
    <div className="space-y-3">
      {allCourses.map((course) => {
        const isOpen = open.has(course.name);
        const ce = exams.filter((e) => e.subject === course.name);
        const cf = feedbacks.filter((f) => f.subject === course.name);
        const ca = assignments.filter((a) => a.subject === course.name);
        const typeBadge =
          course.type === "REQUIRED" ? "必修" : course.type === "ELECTIVE" ? "选修" : "";
        return (
          <div key={course.name} className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <button
              onClick={() => toggle(course.name)}
              className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-slate-50"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-800">{course.name}</span>
                {typeBadge && (
                  <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-600">{typeBadge}</span>
                )}
                <span className="text-xs text-slate-400">
                  考试 {ce.length} · 作业 {ca.length} · 反馈 {cf.length}
                </span>
              </div>
              <span className={`text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`}>▾</span>
            </button>

            {isOpen && (
              <div className="space-y-4 border-t border-slate-100 px-4 py-3">
                {/* 考试成绩 */}
                <Category title="考试成绩" count={ce.length}>
                  <div className="overflow-x-auto rounded border border-slate-100">
                    <table className="min-w-full text-xs">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th className="px-2 py-1.5 text-left">考试</th>
                          <th className="px-2 py-1.5 text-left">类型</th>
                          <th className="px-2 py-1.5 text-left">日期</th>
                          <th className="px-2 py-1.5 text-right">得分</th>
                          <th className="px-2 py-1.5 text-right">满分</th>
                          <th className="px-2 py-1.5 text-right">班级排名</th>
                          <th className="px-2 py-1.5 text-left">评语</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ce.map((e) => (
                          <tr key={e.id} className="border-t border-slate-100">
                            <td className="px-2 py-1.5">{e.title}</td>
                            <td className="px-2 py-1.5">{TYPES[e.type] || e.type}</td>
                            <td className="px-2 py-1.5">{new Date(e.examDate).toLocaleDateString()}</td>
                            <td className="px-2 py-1.5 text-right font-semibold text-slate-800">
                              {e.score ? e.score.score : <span className="text-slate-300">—</span>}
                            </td>
                            <td className="px-2 py-1.5 text-right text-slate-500">{e.totalScore}</td>
                            <td className="px-2 py-1.5 text-right">
                              {e.score && e.score.rankInClass != null ? (
                                <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-600">第 {e.score.rankInClass} 名</span>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                            <td className="px-2 py-1.5 text-slate-600">{e.score?.comment || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Category>

                {/* 作业情况 */}
                <Category title="作业情况" count={ca.length}>
                  <ul className="space-y-2">
                    {ca.map((a) => {
                      const sm = STATUS_META[a.status] || STATUS_META.PENDING;
                      return (
                        <li key={a.id} className="rounded border border-slate-100 bg-slate-50/50 px-3 py-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-sm font-medium text-slate-800">{a.title}</span>
                            <div className="flex items-center gap-2">
                              {a.lateSubmit && a.status === "SUBMITTED" && (
                                <span className="rounded bg-orange-50 px-1.5 py-0.5 text-xs text-orange-600">补交</span>
                              )}
                              <span className={`rounded px-1.5 py-0.5 text-xs ${sm.cls}`}>{sm.label}</span>
                            </div>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
                            {a.dueAt && <span>截止：{new Date(a.dueAt).toLocaleString()}</span>}
                            {a.status === "SUBMITTED" && a.submittedAt && (
                              <span>提交：{new Date(a.submittedAt).toLocaleString()}</span>
                            )}
                            {a.note && <span className="text-slate-400">备注：{a.note}</span>}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </Category>

                {/* 课程反馈 */}
                <Category title="课程反馈" count={cf.length}>
                  <div className="space-y-2">
                    {cf.map((f) => (
                      <div key={f.id} className="rounded border border-slate-100 bg-slate-50/50 p-3">
                        <div className="mb-1 flex items-center gap-2 text-xs text-slate-400">
                          <span>{(f.teacher?.name) || "老师"}</span>
                          <span>{new Date(f.createdAt).toLocaleDateString()}</span>
                        </div>
                        <p className="whitespace-pre-wrap text-sm text-slate-700">{f.content}</p>
                      </div>
                    ))}
                  </div>
                </Category>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
