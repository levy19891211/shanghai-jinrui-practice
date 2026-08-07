"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

interface PaperRow {
  id: string;
  title: string;
  subject: string;
  mode: string;
  durationMin: number | null;
  questionCount: number;
  createdAt: string;
}

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

  function toggleTopic(t: string) {
    setTopics((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }
  function toggleDiff(d: number) {
    setDifficulties((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
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
      setMessage(`组卷成功:「${r.title}」共 ${r.questionCount} 题`);
      setForm((f) => ({ ...f, title: "" }));
      await load();
      setTimeout(() => setMessage(""), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "组卷失败");
    } finally {
      setGenerating(false);
    }
  }

  const input =
    "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200";
  const chipBase =
    "rounded-full border px-3 py-1 text-xs transition select-none cursor-pointer";
  const chipOn = "border-indigo-500 bg-indigo-50 text-indigo-700 font-medium";
  const chipOff = "border-slate-300 bg-white text-slate-600 hover:border-slate-400";

  const noPublished = facets !== null && facets.total === 0;
  const filteredEmpty = !noPublished && available === 0;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">试卷组卷</h1>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-slate-700">生成新试卷</h2>
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
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        {message && <p className="mt-3 text-sm text-emerald-600">{message}</p>}

        <button
          onClick={generate}
          disabled={generating || available === 0}
          className="mt-4 rounded-lg bg-indigo-600 px-6 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {generating ? "组卷中..." : `生成试卷(取 ${Math.min(form.count, available)} 题)`}
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-medium text-slate-700">已有试卷({list.length})</h2>
        {list.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">还没有试卷,先生成一份吧。</p>
        ) : (
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-slate-400">
                <th className="pb-2 font-normal">名称</th>
                <th className="pb-2 font-normal">科目</th>
                <th className="pb-2 font-normal">模式</th>
                <th className="pb-2 font-normal">限时</th>
                <th className="pb-2 font-normal">题目数</th>
                <th className="pb-2 font-normal">创建时间</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} className="border-b border-slate-50">
                  <td className="py-2.5 font-medium">{p.title}</td>
                  <td className="py-2.5">{p.subject}</td>
                  <td className="py-2.5">{p.mode === "EXAM" ? "模拟考" : "练习"}</td>
                  <td className="py-2.5">{p.durationMin ? `${p.durationMin} min` : "—"}</td>
                  <td className="py-2.5">{p.questionCount}</td>
                  <td className="py-2.5 text-slate-500">{new Date(p.createdAt).toLocaleString("zh-CN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
