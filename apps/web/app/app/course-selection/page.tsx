"use client";

import StudentCourseSelection from "@/components/StudentCourseSelection";

// 独立直达路由(保留 URL 可访问),UI 与「课程中心 → 选课」Tab 共用同一组件,单一数据源。
export default function StudentCourseSelectionPage() {
  return <StudentCourseSelection />;
}
