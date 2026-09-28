"use client";

// 学生端:我的成绩单(GPA 过程性考核成绩 + 可打印正式成绩单)
// 数据:GET /api/gpa/report/:studentId(学生仅能看本人)

import GpaReportView from "@/components/GpaReportView";
import { getUser } from "@/lib/api";

export default function StudentGpaPage() {
  const user = getUser();
  const studentId = user?.id || "";
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">我的成绩单</h1>
        <p className="mt-1 text-sm text-slate-500">
          这里展示你各学期、各科目的过程性考核成绩(期末 / 期中 / 平时)与综合评定。教师登记成绩后,你可随时查看,并一键打印正式成绩单。
        </p>
      </div>
      {studentId ? (
        <GpaReportView studentId={studentId} showPrint={false} />
      ) : (
        <p className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-center text-slate-400">未识别到学生身份,请重新登录后重试。</p>
      )}
    </div>
  );
}
