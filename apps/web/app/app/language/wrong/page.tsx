"use client";
// 学生端 · 语言错题本(V2.4.126,补 G1 断链)
// LanguageWrongBook 表此前只有写入(交卷判错时)与级联删除,没有任何读取端点、也没有前端,
// 学生"刷题→复盘"的闭环是断的。本页把它补上,并按技能/题型聚合出薄弱画像。
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

const SKILL_LABEL: Record<string, string> = { LISTENING: "听力", READING: "阅读", WRITING: "写作", SPEAKING: "口语", FULL: "全真" };
const SKILL_COLOR: Record<string, string> = {
  LISTENING: "#1f6fb2", READING: "#2e6f40", WRITING: "#b8860b", SPEAKING: "#7a3b8f", FULL: "#a14a3a",
};
const QTYPE_LABEL: Record<string, string> = {
  FILL_BLANK: "填空", SINGLE_CHOICE: "单选", MULTIPLE_CHOICE: "多选", MATCHING: "配对", HEADING: "段落标题",
  TRUE_FALSE_NG: "判断T/F/NG", YES_NO_NG: "判断Y/N/NG", TASK1: "写作Task1", TASK2: "写作Task2",
  PART1: "口语Part1", PART2: "口语Part2", PART3: "口语Part3",
};

type WrongItem = {
  questionId: string;
  wrongCount: number;
  mastered: boolean;
  updatedAt: string;
  question: {
    id: string; examType: string; skill: string; qType: string; groupTitle: string | null;
    stem: string; options: string[]; answer: string | null; solution: string | null;
    audioUrl: string | null; materialId: string | null; wordLimit: number | null; difficulty: number;
    topic: string | null; tags: string[]; sourceRef: string | null; estSec: number | null;
    material: { id: string; title: string | null } | null;
  };
};

export default function LangWrongBookPage() {
  const router = useRouter();
  const [items, setItems] = useState<WrongItem[]>([]);
  const [bySkill, setBySkill] = useState<Record<string, number>>({});
  const [byQType, setByQType] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterSkill, setFilterSkill] = useState("");
  const [filterQType, setFilterQType] = useState("");
  const [showMastered, setShowMastered] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const d = await api.get<{ total: number; pending: number; mastered: number; bySkill: Record<string, number>; byQType: Record<string, number>; items: WrongItem[] }>("/language/wrong-book");
      setItems(d.items || []);
      setBySkill(d.bySkill || {});
      setByQType(d.byQType || {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const pendingCount = useMemo(() => items.filter((x) => !x.mastered).length, [items]);

  const shown = useMemo(
    () =>
      items.filter((x) => {
        if (!showMastered && x.mastered) return false;
        if (filterSkill && x.question.skill !== filterSkill) return false;
        if (filterQType && x.question.qType !== filterQType) return false;
        return true;
      }),
    [items, showMastered, filterSkill, filterQType],
  );

  // 薄弱榜:按题型错次降序,直接告诉学生"该练哪种题型"
  const weakQTypes = useMemo(
    () => Object.entries(byQType).sort((a, b) => b[1] - a[1]).slice(0, 6),
    [byQType],
  );

  async function toggleMaster(it: WrongItem) {
    setBusyId(it.questionId);
    try {
      await api.post(`/language/wrong-book/${it.questionId}/master`, { mastered: !it.mastered });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(it: WrongItem) {
    setBusyId(it.questionId);
    try {
      await api.del(`/language/wrong-book/${it.questionId}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button onClick={() => router.push("/app/language")} className="text-sm text-slate-500 hover:text-slate-700">← 返回语言学习</button>
        <h1 className="ml-1 text-xl font-bold text-slate-800">语言错题本</h1>
        <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-600">待巩固 {pendingCount}</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">共 {items.length} 题</span>
      </div>

      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
      {loading && <p className="py-10 text-center text-slate-400">加载中...</p>}

      {!loading && items.length === 0 && (
        <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
          还没有错题记录 —— 完成一次练习后,做错的客观题会自动进到这里。
        </p>
      )}

      {!loading && items.length > 0 && (
        <div className="space-y-4">
          {/* 薄弱画像 */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-700">错因分布 · 按技能</h2>
              <div className="mt-3 space-y-2">
                {Object.entries(bySkill).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2">
                    <span className="w-10 shrink-0 text-xs text-slate-500">{SKILL_LABEL[k] || k}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full" style={{ width: `${Math.round((v / items.length) * 100)}%`, background: SKILL_COLOR[k] || "#64748b" }} />
                    </div>
                    <span className="w-8 shrink-0 text-right text-xs font-medium text-slate-600">{v}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-700">错因分布 · 按题型</h2>
              <p className="mt-1 text-xs text-slate-400">排在最前的题型就是下一步该专项突破的</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {weakQTypes.map(([k, v]) => (
                  <button
                    key={k}
                    onClick={() => setFilterQType((x) => (x === k ? "" : k))}
                    className={`rounded-lg px-2 py-1 text-xs transition ${
                      filterQType === k ? "bg-rose-600 text-white" : "bg-rose-50 text-rose-700 hover:bg-rose-100"
                    }`}
                  >
                    {QTYPE_LABEL[k] || k} · {v}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 过滤器 */}
          <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-slate-200 bg-white p-3">
            <span className="mr-1 text-xs text-slate-400">技能</span>
            {[{ v: "", l: "全部" }, ...Object.keys(bySkill).map((k) => ({ v: k, l: SKILL_LABEL[k] || k }))].map((t) => (
              <button
                key={t.v || "all"}
                onClick={() => setFilterSkill(t.v)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                  filterSkill === t.v ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {t.l}
              </button>
            ))}
            <span className="ml-3 mr-1 text-xs text-slate-400">状态</span>
            <button
              onClick={() => setShowMastered((x) => !x)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                showMastered ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {showMastered ? "含已掌握" : "仅未掌握"}
            </button>
          </div>

          {/* 列表 */}
          <div className="space-y-2">
            {shown.map((it) => {
              const open = openId === it.questionId;
              const q = it.question;
              return (
                <div key={it.questionId} className={`rounded-2xl border bg-white p-4 shadow-sm transition ${it.mastered ? "border-emerald-200 opacity-70" : "border-slate-200"}`}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-white" style={{ background: SKILL_COLOR[q.skill] || "#64748b" }}>
                      {SKILL_LABEL[q.skill] || q.skill}
                    </span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{QTYPE_LABEL[q.qType] || q.qType}</span>
                    <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[11px] font-medium text-rose-600">错 {it.wrongCount} 次</span>
                    {q.topic && <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] text-indigo-600">{q.topic}</span>}
                    {it.mastered && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">已掌握</span>}
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-slate-800">{q.stem}</p>
                  {q.groupTitle && <p className="mt-1 text-xs text-slate-400">{q.groupTitle}</p>}

                  {open && (
                    <div className="mt-3 space-y-2 rounded-xl bg-slate-50 p-3">
                      {q.options.length > 0 && (
                        <div className="space-y-1">
                          {q.options.map((o, i) => (
                            <p key={i} className="text-xs text-slate-600">{String.fromCharCode(65 + i)}. {o}</p>
                          ))}
                        </div>
                      )}
                      <p className="text-xs text-slate-600">
                        <b className="text-slate-800">正确答案:</b> {q.answer || "—"}
                      </p>
                      {q.solution && (
                        <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-600">
                          <b className="text-slate-800">解析:</b> {q.solution}
                        </p>
                      )}
                      {q.material?.title && <p className="text-xs text-slate-400">出处:{q.material.title}</p>}
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => setOpenId(open ? null : it.questionId)}
                      className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 transition hover:bg-slate-50"
                    >
                      {open ? "收起解析" : "查看解析"}
                    </button>
                    <button
                      onClick={() => toggleMaster(it)}
                      disabled={busyId === it.questionId}
                      className="rounded-lg border border-emerald-200 px-2.5 py-1 text-xs font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-60"
                    >
                      {it.mastered ? "取消掌握" : "标记已掌握"}
                    </button>
                    <button
                      onClick={() => remove(it)}
                      disabled={busyId === it.questionId}
                      className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-500 transition hover:bg-slate-50 disabled:opacity-60"
                    >
                      移出错题本
                    </button>
                  </div>
                </div>
              );
            })}
            {shown.length === 0 && (
              <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">当前筛选下没有题目</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
