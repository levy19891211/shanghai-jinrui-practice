"use client";

import { useEffect, useState } from "react";
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

export default function TeacherPapersPage() {
  const [list, setList] = useState<PaperRow[]>([]);
  const [form, setForm] = useState({
    title: "", subject: "TMUA", mode: "PRACTICE", durationMin: 40,
    topics: "", difficulties: "", count: 10,
  });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [generating, setGenerating] = useState(false);

  async function load() {
    const d = await api.get<{ list: PaperRow[] }>("/papers");
    setList(d.list);
  }

  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  async function generate() {
    setError("");
    setMessage("");
    if (!form.title) { setError("请填写试卷名称"); return; }
    setGenerating(true);
    try {
      const payload = {
        title: form.title,
        subject: form.subject,
        mode: form.mode,
        durationMin: form.mode === "EXAM" ? Number(form.durationMin) : undefined,
        topics: form.topics.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
        difficulties: form.difficulties.split(/[,，]/).map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n)),
        count: Number(form.count),
      };
      const r = await api.post<{ title: string; questionCount: number }>("/papers/generate", payload);
      setMessage(`组卷成功:「${r.title}」共 ${r.questionCount} 题`);
      setForm((f) => ({ ...f, title: "" }));
      await load();
      setTimeout(() => setMessage(""), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "组卷失败");
    } finally {
      setGenerating(false);
    }
  }

  const input =
    "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200";

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">试卷组卷</h1>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-medium text-slate-700">生成新试卷</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="col-span-2">
            <label className="mb-1 block text-sm text-slate-600">试卷名称</label>
            <input className={input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="如:TMUA 代数专项" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">科目</label>
            <select className={`${input} ui-select`} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })}>
              <option value="TMUA">TMUA</option>
              <option value="ESAT">ESAT</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">模式</label>
            <select className={`${input} ui-select`} value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
              <option value="PRACTICE">练习(不限时)</option>
              <option value="EXAM">模拟考(限时)</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">知识点(逗号分隔,可空)</label>
            <input className={input} value={form.topics} onChange={(e) => setForm({ ...form, topics: e.target.value })} placeholder="代数,函数,逻辑" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">难度(逗号分隔,可空)</label>
            <input className={input} value={form.difficulties} onChange={(e) => setForm({ ...form, difficulties: e.target.value })} placeholder="2,3,4" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">题目数量</label>
            <input className={input} type="number" min={1} max={50} value={form.count} onChange={(e) => setForm({ ...form, count: Number(e.target.value) })} />
          </div>
          {form.mode === "EXAM" && (
            <div>
              <label className="mb-1 block text-sm text-slate-600">限时(分钟)</label>
              <input className={input} type="number" min={1} value={form.durationMin} onChange={(e) => setForm({ ...form, durationMin: Number(e.target.value) })} />
            </div>
          )}
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        {message && <p className="mt-3 text-sm text-emerald-600">{message}</p>}
        <button onClick={generate} disabled={generating} className="mt-4 rounded-lg bg-indigo-600 px-6 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
          {generating ? "组卷中..." : "生成试卷"}
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
