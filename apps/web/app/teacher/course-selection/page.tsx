"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { CourseSelectionClassPanel, type ManageCls } from "@/components/TeacherCourseSelection";

// 独立直达路由(保留 URL 可访问),班级列表 + 班级级选课管理面板与「教务管理 → 选课管理」Tab 共用同一组件。
export default function TeacherCourseSelectionPage() {
  const [classes, setClasses] = useState<ManageCls[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadClasses = useCallback(() => {
    setLoading(true);
    api
      .get<{ classes: ManageCls[] }>("/academics/course-classes")
      .then((d) => { setClasses(d.classes || []); setError(""); })
      .catch((e) => setError(e.message || "加载失败"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadClasses(); }, [loadClasses]);

  const selected = classes.find((c) => c.id === selectedId) || null;

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-slate-800">选课管理</h1>
      {error && <p className="text-red-500">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-2">
          <h2 className="text-sm font-medium text-slate-500">我可管理的班级</h2>
          {loading && <p className="text-slate-400">加载中…</p>}
          {!loading && classes.length === 0 && (
            <p className="text-slate-400">你当前不是任何班级的班主任,无选课管理权限。</p>
          )}
          {classes.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className={`w-full rounded-lg border p-3 text-left transition ${
                selectedId === c.id ? "border-indigo-400 bg-indigo-50" : "border-slate-200 bg-white hover:bg-slate-50"
              }`}
            >
              <div className="font-medium text-slate-800">{c.name}</div>
              <div className="mt-0.5 text-xs text-slate-500">{c.academicYear} {c.term}</div>
            </button>
          ))}
        </aside>

        <section>
          {!selected && <p className="text-slate-400">请选择一个班级进行管理。</p>}
          {selected && <CourseSelectionClassPanel key={selected.id} cls={selected} onChanged={loadClasses} />}
        </section>
      </div>
    </div>
  );
}
