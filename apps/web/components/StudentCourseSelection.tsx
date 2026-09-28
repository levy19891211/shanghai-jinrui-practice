"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

interface Cls { id: string; name: string; academicYear: string; term: string; }
interface Course { id: string; name: string; type: "REQUIRED" | "ELECTIVE"; }
interface Selection { selectedCourseIds: string[]; submittedAt: string | null; }

interface Loaded {
  class: Cls;
  courses: Course[];
  requiredCourses: string[];
  selection: Selection | null;
}

// 学生选课 UI(必修课默认计入不可取消,选修课自行勾选,提交后锁定)。
// 同时被 /app/course-selection(独立路由)与 /app/academics 的「选课」Tab 复用。
export default function StudentCourseSelection() {
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 本地勾选状态(仅选修)
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const load = () => {
    setLoading(true);
    api
      .get<Loaded>("/academics/me/course-selection")
      .then((d) => {
        setData(d);
        setError("");
        // 初始化勾选:若已提交则以已选为准(锁死);未提交则空选
        if (d.selection && d.selection.submittedAt) {
          setPicked(new Set(d.selection.selectedCourseIds || []));
        } else {
          setPicked(new Set());
        }
      })
      .catch((e) => setError(e.message || "加载失败"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const electives = useMemo(
    () => (data ? data.courses.filter((c) => c.type === "ELECTIVE") : []),
    [data]
  );
  const required = useMemo(
    () => (data ? data.courses.filter((c) => c.type === "REQUIRED") : []),
    [data]
  );

  const locked = !!(data?.selection?.submittedAt);

  const toggle = (name: string) => {
    if (locked) return;
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const submit = () => {
    if (locked) return;
    setSaving(true);
    setSaveMsg("");
    const selectedCourseIds = electives.map((e) => e.name).filter((n) => picked.has(n));
    api
      .post<{ selection: Selection }>("/academics/me/course-selection", { selectedCourseIds })
      .then((d) => {
        setData((prev) => (prev ? { ...prev, selection: d.selection } : prev));
        setPicked(new Set(d.selection.selectedCourseIds || []));
        setSaveMsg("选课已提交,提交后将无法自行修改(如需调整请联系班主任)。");
      })
      .catch((e) => setSaveMsg(e.message || "提交失败"))
      .finally(() => setSaving(false));
  };

  if (loading) return <p className="text-slate-500">加载中…</p>;
  if (error) return <p className="text-red-500">{error}</p>;
  if (!data) return null;

  // 课程目录尚未建立
  if (data.courses.length === 0) {
    return (
      <div className="space-y-6">
        <h2 className="text-lg font-semibold text-slate-800">选课</h2>
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-slate-500 shadow-sm">
          本班本学期的课程目录尚未发布,暂时无需选课。
          <br />
          发布后,必修课将自动计入你的课表,选修课由你自行勾选。
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800">选课</h2>
        {locked && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-600">
            ✓ 已提交锁定
          </span>
        )}
      </div>

      {/* 班级信息 */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-base font-semibold text-slate-800">{data.class.name}</div>
        <div className="mt-1 text-sm text-slate-500">
          {data.class.academicYear} {data.class.term}
        </div>
      </div>

      {locked && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          你已于 {new Date(data.selection!.submittedAt!).toLocaleString()} 提交选课。
          提交后无法自行修改,如需调整请联系班主任。
        </div>
      )}

      {/* 必修课(默认选中,不可取消) */}
      <section>
        <h3 className="mb-2 text-sm font-medium text-slate-600">
          必修课<span className="ml-1 text-xs font-normal text-slate-400">(默认计入,不可取消)</span>
        </h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {required.length === 0 && <p className="text-sm text-slate-400">本班无必修课。</p>}
          {required.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
            >
              <span className="flex h-4 w-4 items-center justify-center rounded border border-slate-300 bg-white">
                <span className="text-emerald-500">✓</span>
              </span>
              <span className="font-medium">{c.name}</span>
              <span className="ml-auto text-xs text-slate-400">必修</span>
            </div>
          ))}
        </div>
      </section>

      {/* 选修课(可勾选) */}
      <section>
        <h3 className="mb-2 text-sm font-medium text-slate-600">
          选修课<span className="ml-1 text-xs font-normal text-slate-400">(勾选你本学期要修读的课程)</span>
        </h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {electives.length === 0 && <p className="text-sm text-slate-400">本班无选修课。</p>}
          {electives.map((c) => {
            const on = picked.has(c.name);
            return (
              <button
                key={c.id}
                type="button"
                disabled={locked}
                onClick={() => toggle(c.name)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${
                  locked
                    ? "cursor-default border-slate-200 bg-slate-50 text-slate-500"
                    : on
                      ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span
                  className={`flex h-4 w-4 items-center justify-center rounded border ${
                    on && !locked ? "border-indigo-400 bg-indigo-500 text-white" : "border-slate-300 bg-white"
                  }`}
                >
                  {on && !locked && "✓"}
                  {on && locked && <span className="text-emerald-500">✓</span>}
                </span>
                <span className="font-medium">{c.name}</span>
                <span className="ml-auto text-xs text-slate-400">选修</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 提交 / 提示 */}
      <section className="space-y-3">
        {!locked && (
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-60"
          >
            {saving ? "提交中…" : "提交选课"}
          </button>
        )}
        {saveMsg && <p className="text-sm text-emerald-600">{saveMsg}</p>}
        {!locked && (
          <p className="text-xs text-slate-400">
            提示:提交后你的课表将只显示必修课 + 已选的选修课;提交后若需调整,请向班主任申请。
          </p>
        )}
      </section>
    </div>
  );
}
