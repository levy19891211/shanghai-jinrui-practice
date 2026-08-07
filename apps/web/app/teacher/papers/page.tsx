"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { renderRich } from "@/lib/rich";
import type { PaperManageDetail, PaperRow, PaperStats } from "@/lib/types";

interface Facets {
  subjects: { subject: string; count: number }[];
  subject: string | null;
  total: number;
  topics: { topic: string; count: number }[];
  difficulties: { difficulty: number; count: number }[];
  combos: { topic: string | null; difficulty: number | null; count: number }[];
}

const SUBJECT_OPTIONS = ["TMUA", "ESAT"];
const DIFF_LABEL: Record<number, string> = { 1: "入门", 2: "基础", 3: "中等", 4: "较难", 5: "困难" };

const PAPER_STATUS_LABEL: Record<string, string> = {
  READY: "可作答",
  DRAFT: "待审核完成",
  ARCHIVED: "已下架",
};
const PAPER_STATUS_BADGE: Record<string, string> = {
  READY: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  DRAFT: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  ARCHIVED: "bg-slate-100 text-slate-500 ring-1 ring-slate-200",
};
const Q_STATUS_LABEL: Record<string, string> = {
  DRAFT: "草稿",
  PENDING_REVIEW: "待审核",
  PUBLISHED: "已发布",
  REJECTED: "已退回",
  ARCHIVED: "已下架",
};
const Q_STATUS_BADGE: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-500",
  PENDING_REVIEW: "bg-blue-50 text-blue-600",
  PUBLISHED: "bg-emerald-50 text-emerald-600",
  REJECTED: "bg-red-50 text-red-600",
  ARCHIVED: "bg-slate-100 text-slate-400",
};

/** 审核进度条:一眼看出整卷还差多少题才能对学生开放 */
function ProgressBar({ stats }: { stats: PaperStats }) {
  const total = Math.max(1, stats.total);
  const seg = [
    { n: stats.published, cls: "bg-emerald-500", label: "已发布" },
    { n: stats.pending, cls: "bg-blue-400", label: "待审核" },
    { n: stats.rejected, cls: "bg-red-400", label: "已退回" },
    { n: stats.draft, cls: "bg-slate-300", label: "草稿" },
    { n: stats.archived + stats.missing, cls: "bg-slate-200", label: "下架/缺失" },
  ].filter((s) => s.n > 0);
  return (
    <div className="flex h-1.5 w-28 overflow-hidden rounded-full bg-slate-100">
      {seg.map((s) => (
        <div key={s.label} className={s.cls} style={{ width: `${(s.n / total) * 100}%` }} title={`${s.label} ${s.n}`} />
      ))}
    </div>
  );
}

export default function TeacherPapersPage() {
  const [list, setList] = useState<PaperRow[]>([]);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [form, setForm] = useState({
    title: "",
    subject: "TMUA",
    mode: "PRACTICE",
    durationMin: 40,
    count: 10,
  });
  const [topics, setTopics] = useState<string[]>([]);
  const [difficulties, setDifficulties] = useState<number[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [generating, setGenerating] = useState(false);
  const [showGenerator, setShowGenerator] = useState(false);
  const [filter, setFilter] = useState<"ALL" | "READY" | "DRAFT" | "ARCHIVED" | "AUTO_SET">("ALL");

  // 试卷详情抽屉
  const [detail, setDetail] = useState<PaperManageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  const load = useCallback(async () => {
    const d = await api.get<{ list: PaperRow[] }>("/papers");
    setList(d.list);
  }, []);

  const loadFacets = useCallback(async (subject: string) => {
    const d = await api.get<Facets>(`/papers/facets?subject=${encodeURIComponent(subject)}`);
    setFacets(d);
  }, []);

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  // 切换科目时重新拉取可选项,并清空已选的知识点/难度(避免残留旧科目的值导致筛不到题)
  useEffect(() => {
    setTopics([]);
    setDifficulties([]);
    loadFacets(form.subject).catch((e) => setError(e.message));
  }, [form.subject, loadFacets]);

  // 依据 combos 精确预览当前条件能匹配到多少题(与后端 where 逻辑一致)
  const available = useMemo(() => {
    if (!facets) return 0;
    return facets.combos
      .filter(
        (c) =>
          (topics.length === 0 || (c.topic !== null && topics.includes(c.topic))) &&
          (difficulties.length === 0 || (c.difficulty !== null && difficulties.includes(c.difficulty)))
      )
      .reduce((s, c) => s + c.count, 0);
  }, [facets, topics, difficulties]);

  const subjectCount = useMemo(() => {
    const m: Record<string, number> = {};
    facets?.subjects.forEach((s) => (m[s.subject] = s.count));
    return m;
  }, [facets]);

  const shown = useMemo(() => {
    if (filter === "ALL") return list;
    if (filter === "AUTO_SET") return list.filter((p) => p.origin === "AUTO_SET");
    return list.filter((p) => (p.status ?? "READY") === filter);
  }, [list, filter]);

  const counts = useMemo(() => {
    const c = { ALL: list.length, READY: 0, DRAFT: 0, ARCHIVED: 0, AUTO_SET: 0 };
    for (const p of list) {
      const s = (p.status ?? "READY") as "READY" | "DRAFT" | "ARCHIVED";
      if (c[s] !== undefined) c[s]++;
      if (p.origin === "AUTO_SET") c.AUTO_SET++;
    }
    return c;
  }, [list]);

  function toggleTopic(t: string) {
    setTopics((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }
  function toggleDiff(d: number) {
    setDifficulties((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }

  function flash(text: string) {
    setMessage(text);
    setTimeout(() => setMessage(""), 4000);
  }

  async function generate() {
    setError("");
    setMessage("");
    if (!form.title) {
      setError("请填写试卷名称");
      return;
    }
    setGenerating(true);
    try {
      const payload = {
        title: form.title,
        subject: form.subject,
        mode: form.mode,
        durationMin: form.mode === "EXAM" ? Number(form.durationMin) : undefined,
        topics,
        difficulties,
        count: Number(form.count),
      };
      const r = await api.post<{ title: string; questionCount: number }>("/papers/generate", payload);
      flash(`组卷成功:「${r.title}」共 ${r.questionCount} 题`);
      setForm((f) => ({ ...f, title: "" }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "组卷失败");
    } finally {
      setGenerating(false);
    }
  }

  async function openDetail(id: string) {
    setError("");
    setDetailLoading(true);
    try {
      const d = await api.get<PaperManageDetail>(`/papers/${id}/manage`);
      setDetail(d);
      setTitleDraft(d.title);
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取试卷失败");
    } finally {
      setDetailLoading(false);
    }
  }

  async function patchPaper(id: string, body: Record<string, unknown>, okText: string) {
    setError("");
    setDetailBusy(true);
    try {
      await api.patch(`/papers/${id}`, body);
      flash(okText);
      await load();
      if (detail?.id === id) await openDetail(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setDetailBusy(false);
    }
  }

  async function removeQuestion(qid: string) {
    if (!detail) return;
    if (!window.confirm("从本卷移除这道题?题目本身仍保留在题库中。")) return;
    const ids = detail.questions.filter((q) => q.id !== qid).map((q) => q.id);
    if (ids.length === 0) {
      setError("试卷至少要保留 1 道题;若要清空请直接删除整卷");
      return;
    }
    await patchPaper(detail.id, { questionIds: ids }, "已从本卷移除该题");
  }

  async function removePaper(p: PaperRow) {
    if (!window.confirm(`确认删除试卷「${p.title}」?卷内题目仍保留在题库中。`)) return;
    setError("");
    try {
      await api.del(`/papers/${p.id}`);
      flash("试卷已删除");
      if (detail?.id === p.id) setDetail(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  }

  function gotoReview(paperId: string) {
    window.location.href = `/teacher?paperId=${encodeURIComponent(paperId)}`;
  }

  const input =
    "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200";
  const chipBase = "rounded-full border px-3 py-1 text-xs transition select-none cursor-pointer";
  const chipOn = "border-indigo-500 bg-indigo-50 text-indigo-700 font-medium";
  const chipOff = "border-slate-300 bg-white text-slate-600 hover:border-slate-400";

  const noPublished = facets !== null && facets.total === 0;
  const filteredEmpty = !noPublished && available === 0;

  const TABS: { key: typeof filter; label: string }[] = [
    { key: "ALL", label: `全部 ${counts.ALL}` },
    { key: "READY", label: `可作答 ${counts.READY}` },
    { key: "DRAFT", label: `待审核完成 ${counts.DRAFT}` },
    { key: "AUTO_SET", label: `套题自动卷 ${counts.AUTO_SET}` },
    { key: "ARCHIVED", label: `已下架 ${counts.ARCHIVED}` },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">试卷管理</h1>
          <p className="mt-1 text-sm text-slate-500">
            套题录入会自动成卷;卷内每道题都审核通过后,试卷才会对学生开放。
          </p>
        </div>
        <button
          onClick={() => setShowGenerator((v) => !v)}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          {showGenerator ? "收起组卷面板" : "+ 手动组卷"}
        </button>
      </div>

      {message && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      {showGenerator && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-slate-700">按条件抽题生成新试卷</h2>
            {facets && (
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  available > 0 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                }`}
              >
                当前条件可用 {available} 题
              </span>
            )}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="col-span-2">
              <label className="mb-1 block text-sm text-slate-600">试卷名称</label>
              <input
                className={input}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="如:TMUA 代数专项"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-600">科目</label>
              <select
                className={`${input} ui-select`}
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
              >
                {SUBJECT_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}({subjectCount[s] ?? 0} 题可用)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-600">模式</label>
              <select
                className={`${input} ui-select`}
                value={form.mode}
                onChange={(e) => setForm({ ...form, mode: e.target.value })}
              >
                <option value="PRACTICE">练习(不限时)</option>
                <option value="EXAM">模拟考(限时)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-600">题目数量</label>
              <input
                className={input}
                type="number"
                min={1}
                max={50}
                value={form.count}
                onChange={(e) => setForm({ ...form, count: Number(e.target.value) })}
              />
            </div>
            {form.mode === "EXAM" && (
              <div>
                <label className="mb-1 block text-sm text-slate-600">限时(分钟)</label>
                <input
                  className={input}
                  type="number"
                  min={1}
                  value={form.durationMin}
                  onChange={(e) => setForm({ ...form, durationMin: Number(e.target.value) })}
                />
              </div>
            )}
          </div>

          {/* 知识点:只列出该科目已发布题目中真实存在的值,避免手填导致匹配不到 */}
          <div className="mt-5">
            <div className="mb-2 flex items-center gap-2">
              <label className="text-sm text-slate-600">知识点</label>
              <span className="text-xs text-slate-400">不选 = 全部</span>
              {topics.length > 0 && (
                <button onClick={() => setTopics([])} className="text-xs text-indigo-600 hover:underline">
                  清空({topics.length})
                </button>
              )}
            </div>
            {facets && facets.topics.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {facets.topics.map((t) => (
                  <button
                    key={t.topic}
                    onClick={() => toggleTopic(t.topic)}
                    className={`${chipBase} ${topics.includes(t.topic) ? chipOn : chipOff}`}
                  >
                    {t.topic}
                    <span className="ml-1 opacity-60">{t.count}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400">该科目暂无可选知识点</p>
            )}
          </div>

          {/* 难度 */}
          <div className="mt-4">
            <div className="mb-2 flex items-center gap-2">
              <label className="text-sm text-slate-600">难度</label>
              <span className="text-xs text-slate-400">不选 = 全部</span>
              {difficulties.length > 0 && (
                <button onClick={() => setDifficulties([])} className="text-xs text-indigo-600 hover:underline">
                  清空({difficulties.length})
                </button>
              )}
            </div>
            {facets && facets.difficulties.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {facets.difficulties.map((d) => (
                  <button
                    key={d.difficulty}
                    onClick={() => toggleDiff(d.difficulty)}
                    className={`${chipBase} ${difficulties.includes(d.difficulty) ? chipOn : chipOff}`}
                  >
                    {DIFF_LABEL[d.difficulty] ?? `难度${d.difficulty}`}
                    <span className="ml-1 opacity-60">{d.count}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400">该科目暂无可选难度</p>
            )}
          </div>

          {noPublished && (
            <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
              科目「{form.subject}」下还没有已发布的题目。请先到「题库管理」把题目审核通过并发布,或切换科目。
            </p>
          )}
          {filteredEmpty && (
            <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
              当前知识点/难度组合下没有题目,请减少筛选条件。
            </p>
          )}

          <button
            onClick={generate}
            disabled={generating || available === 0}
            className="mt-4 rounded-lg bg-indigo-600 px-6 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {generating ? "组卷中..." : `生成试卷(取 ${Math.min(form.count, available)} 题)`}
          </button>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                filter === t.key ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          <p className="mt-6 text-sm text-slate-400">
            {list.length === 0 ? "还没有试卷。可以手动组卷,或在「题库管理」按套题批量导入,系统会自动成卷。" : "该分类下暂无试卷。"}
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-slate-400">
                  <th className="pb-2 font-normal">名称</th>
                  <th className="pb-2 font-normal">科目</th>
                  <th className="pb-2 font-normal">模式</th>
                  <th className="pb-2 font-normal">题目数</th>
                  <th className="pb-2 font-normal">审核进度</th>
                  <th className="pb-2 font-normal">状态</th>
                  <th className="pb-2 font-normal">操作</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const st = (p.status ?? "READY") as string;
                  const s = p.stats;
                  const notReady = s ? s.total - s.published : 0;
                  return (
                    <tr key={p.id} className="border-b border-slate-50 align-middle">
                      <td className="py-3 pr-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{p.title}</span>
                          {p.origin === "AUTO_SET" && (
                            <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[11px] text-violet-600">套题</span>
                          )}
                        </div>
                        {p.source && <p className="mt-0.5 text-xs text-slate-400">{p.source}</p>}
                      </td>
                      <td className="py-3 pr-3">{p.subject}</td>
                      <td className="py-3 pr-3">
                        {p.mode === "EXAM" ? `模拟考 ${p.durationMin ?? "?"}min` : "练习"}
                      </td>
                      <td className="py-3 pr-3">{p.questionCount}</td>
                      <td className="py-3 pr-3">
                        {s ? (
                          <div className="flex items-center gap-2">
                            <ProgressBar stats={s} />
                            <span className="text-xs text-slate-500">
                              {s.published}/{s.total}
                            </span>
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-3 pr-3">
                        <span className={`rounded px-2 py-0.5 text-xs ${PAPER_STATUS_BADGE[st] ?? ""}`}>
                          {PAPER_STATUS_LABEL[st] ?? st}
                        </span>
                        {st === "DRAFT" && notReady > 0 && (
                          <span className="ml-1 text-xs text-slate-400">还差 {notReady} 题</span>
                        )}
                      </td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-2.5">
                          <button onClick={() => openDetail(p.id)} className="text-indigo-600 hover:underline">
                            查看
                          </button>
                          {st === "DRAFT" && (
                            <button onClick={() => gotoReview(p.id)} className="font-medium text-blue-600 hover:underline">
                              去审核
                            </button>
                          )}
                          {st === "ARCHIVED" ? (
                            <button
                              onClick={() => patchPaper(p.id, { status: "ACTIVE" }, "试卷已恢复上架")}
                              className="text-emerald-600 hover:underline"
                            >
                              上架
                            </button>
                          ) : (
                            <button
                              onClick={() => patchPaper(p.id, { status: "ARCHIVED" }, "试卷已下架,学生不再可见")}
                              className="text-slate-500 hover:underline"
                            >
                              下架
                            </button>
                          )}
                          <button onClick={() => removePaper(p)} className="text-red-500 hover:underline">
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 试卷详情抽屉:逐题查阅内容与审核状态 */}
      {(detail || detailLoading) && (
        <div className="fixed inset-0 z-30 flex justify-end bg-slate-900/40" onClick={() => setDetail(null)}>
          <div
            className="h-full w-full max-w-2xl overflow-y-auto bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {detailLoading && !detail ? (
              <p className="text-sm text-slate-400">加载中...</p>
            ) : detail ? (
              <>
                <div className="flex items-start justify-between">
                  <div className="flex-1 pr-4">
                    <div className="flex items-center gap-2">
                      <input
                        className="w-full rounded-lg border border-transparent px-2 py-1 text-lg font-bold outline-none hover:border-slate-200 focus:border-indigo-400 focus:bg-white"
                        value={titleDraft}
                        onChange={(e) => setTitleDraft(e.target.value)}
                      />
                      {titleDraft.trim() && titleDraft !== detail.title && (
                        <button
                          disabled={detailBusy}
                          onClick={() => patchPaper(detail.id, { title: titleDraft.trim() }, "试卷已改名")}
                          className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                        >
                          保存
                        </button>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <span className="rounded bg-indigo-50 px-2 py-0.5 text-indigo-600">{detail.subject}</span>
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-600">
                        {detail.mode === "EXAM" ? `模拟考 ${detail.durationMin ?? "?"} 分钟` : "练习"}
                      </span>
                      {detail.origin === "AUTO_SET" && (
                        <span className="rounded bg-violet-50 px-2 py-0.5 text-violet-600">套题自动成卷</span>
                      )}
                      <span className={`rounded px-2 py-0.5 ${PAPER_STATUS_BADGE[detail.status] ?? ""}`}>
                        {PAPER_STATUS_LABEL[detail.status] ?? detail.status}
                      </span>
                      {detail.source && <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-500">{detail.source}</span>}
                    </div>
                  </div>
                  <button onClick={() => setDetail(null)} className="text-slate-400 hover:text-slate-600">
                    ✕
                  </button>
                </div>

                <div className="mt-4 rounded-xl bg-slate-50 p-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">
                      审核进度 <b className="text-slate-800">{detail.stats.published}</b> / {detail.stats.total}
                    </span>
                    <ProgressBar stats={detail.stats} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                    <span>待审核 {detail.stats.pending}</span>
                    <span>已退回 {detail.stats.rejected}</span>
                    <span>草稿 {detail.stats.draft}</span>
                    {detail.stats.archived > 0 && <span>已下架 {detail.stats.archived}</span>}
                    {detail.stats.missing > 0 && <span className="text-red-500">题目已删除 {detail.stats.missing}</span>}
                  </div>
                  {detail.status === "DRAFT" && (
                    <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                      还有 {detail.stats.total - detail.stats.published} 道题未通过审核,学生暂时看不到这份试卷。
                      <button onClick={() => gotoReview(detail.id)} className="ml-2 font-medium text-blue-600 hover:underline">
                        去审核 →
                      </button>
                    </p>
                  )}
                  {detail.status === "READY" && (
                    <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                      整卷已通过审核,学生可以作答。
                    </p>
                  )}
                </div>

                <div className="mt-5 space-y-3">
                  {detail.questions.map((q) => (
                    <div key={q.id} className="rounded-xl border border-slate-200 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-600">
                            第 {q.index} 题
                          </span>
                          {q.missing ? (
                            <span className="rounded bg-red-50 px-2 py-0.5 text-red-600">题目已被删除</span>
                          ) : (
                            <>
                              <span className={`rounded px-2 py-0.5 ${Q_STATUS_BADGE[q.status ?? ""] ?? ""}`}>
                                {Q_STATUS_LABEL[q.status ?? ""] ?? q.status}
                              </span>
                              <span className="text-slate-400">
                                {q.topic} · 难度 {q.difficulty}
                              </span>
                            </>
                          )}
                        </div>
                        <button
                          onClick={() => removeQuestion(q.id)}
                          disabled={detailBusy}
                          className="shrink-0 text-xs text-slate-400 hover:text-red-500 disabled:opacity-50"
                        >
                          移出本卷
                        </button>
                      </div>
                      {!q.missing && (
                        <>
                          <div className="mt-2 text-sm leading-relaxed text-slate-800">{renderRich(q.stem ?? "")}</div>
                          <div className="mt-2 space-y-1">
                            {(q.options ?? []).map((opt, i) => (
                              <div
                                key={i}
                                className={`flex gap-2 rounded px-2 py-1 text-sm ${
                                  opt === q.answer ? "bg-emerald-50 text-emerald-700" : "text-slate-600"
                                }`}
                              >
                                <span className="font-medium">{String.fromCharCode(65 + i)}.</span>
                                <span className="flex-1">{renderRich(opt)}</span>
                              </div>
                            ))}
                          </div>
                          {q.status === "REJECTED" && q.reviewNote && (
                            <p className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-600">
                              退回原因:{q.reviewNote}
                            </p>
                          )}
                        </>
                      )}
                      {q.missing && (
                        <p className="mt-2 text-xs text-slate-400">
                          该题已从题库删除,建议把它移出本卷,否则试卷永远无法变为「可作答」。
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
