"use client";

import { useEffect, useState } from "react";
import { api, getUser } from "@/lib/api";
import { plainText } from "@/lib/rich";
import type { Question, QuestionList } from "@/lib/types";

const STATUS_LABEL: Record<string, string> = { DRAFT: "草稿", PUBLISHED: "已发布", ARCHIVED: "已下架" };

interface FormState {
  id?: string;
  subject: string;
  paper: string;
  topic: string;
  difficulty: number;
  type: string;
  stem: string;
  optionsText: string;
  answer: string;
  solution: string;
  status: string;
}

const EMPTY: FormState = {
  subject: "TMUA", paper: "Paper 1", topic: "", difficulty: 3, type: "SINGLE_CHOICE",
  stem: "", optionsText: "", answer: "", solution: "", status: "DRAFT",
};

export default function TeacherPage() {
  const user = getUser();
  const [list, setList] = useState<Question[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importMode, setImportMode] = useState<"json" | "csv">("json");
  const [importText, setImportText] = useState("");
  const [importResult, setImportResult] = useState<{ imported: number; failed: number; errors: { row: number; reason: string }[] } | null>(null);
  const [importError, setImportError] = useState("");
  const [importing, setImporting] = useState(false);

  async function load() {
    const d = await api.get<QuestionList>(`/questions?pageSize=50${statusFilter ? `&status=${statusFilter}` : ""}`);
    setList(d.list);
    setTotal(d.total);
  }

  useEffect(() => { load().catch((e) => setError(e.message)); }, [statusFilter]);

  function openCreate() { setForm(EMPTY); setError(""); setShowForm(true); }
  function openEdit(q: Question) {
    setForm({
      id: q.id, subject: q.subject, paper: q.paper ?? "", topic: q.topic, difficulty: q.difficulty,
      type: q.type, stem: q.stem, optionsText: (q.options || []).join("\n"), answer: q.answer ?? "",
      solution: q.solution ?? "", status: q.status,
    });
    setError("");
    setShowForm(true);
  }

  async function submitForm() {
    setError("");
    const options = form.optionsText.split("\n").map((s) => s.trim()).filter(Boolean);
    if (options.length < 2) { setError("选项至少 2 个,每行一个"); return; }
    if (!form.answer) { setError("请填写正确答案(内容需与某选项一致)"); return; }
    setSaving(true);
    try {
      const payload = {
        subject: form.subject, paper: form.paper || null, topic: form.topic, difficulty: Number(form.difficulty),
        type: form.type, stem: form.stem, options, answer: form.answer, solution: form.solution || null, status: form.status,
      };
      if (form.id) {
        await api.put(`/questions/${form.id}`, payload);
        setMessage("题目已更新");
      } else {
        await api.post("/questions", payload);
        setMessage("题目已创建");
      }
      setShowForm(false);
      await load();
      setTimeout(() => setMessage(""), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function remove(q: Question) {
    if (!window.confirm(`确认删除题目「${q.stem.slice(0, 20)}...」?该操作不可恢复。`)) return;
    try {
      await api.del(`/questions/${q.id}`);
      setMessage("已删除");
      await load();
      setTimeout(() => setMessage(""), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  }

  async function doImport() {
    setImportError("");
    setImportResult(null);
    if (!importText.trim()) { setImportError("请粘贴数据"); return; }
    setImporting(true);
    try {
      const payload = importMode === "json" ? { items: JSON.parse(importText) } : { csv: importText };
      const r = await api.post<{ imported: number; failed: number; errors: { row: number; reason: string }[] }>("/questions/import", payload);
      setImportResult(r);
      setImportText("");
      await load();
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "导入失败(请检查格式)");
    } finally {
      setImporting(false);
    }
  }

  const input =
    "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">题库管理</h1>
          <p className="mt-1 text-sm text-slate-500">共 {total} 道题目</p>
        </div>
        <div className="flex items-center gap-3">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500">
            <option value="">全部状态</option>
            <option value="DRAFT">草稿</option>
            <option value="PUBLISHED">已发布</option>
            <option value="ARCHIVED">已下架</option>
          </select>
          <button onClick={openCreate} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
            + 新建题目
          </button>
          <button onClick={() => { setImportOpen(true); setImportText(""); setImportResult(null); setImportError(""); }} className="rounded-lg border border-indigo-300 px-4 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50">
            批量导入
          </button>
        </div>
      </div>

      {message && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-600">{message}</p>}
      {error && !showForm && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      {list.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">暂无题目</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-400">
              <tr>
                <th className="px-4 py-3 font-normal">科目</th>
                <th className="px-4 py-3 font-normal">知识点</th>
                <th className="px-4 py-3 font-normal">题干</th>
                <th className="px-4 py-3 font-normal">难度</th>
                <th className="px-4 py-3 font-normal">状态</th>
                <th className="px-4 py-3 font-normal">操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((q) => (
                <tr key={q.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${q.subject === "TMUA" ? "bg-indigo-50 text-indigo-600" : "bg-teal-50 text-teal-600"}`}>
                      {q.subject}
                    </span>
                  </td>
                  <td className="px-4 py-3">{q.topic}</td>
                  <td className="max-w-[280px] truncate px-4 py-3 text-slate-600">{plainText(q.stem)}</td>
                  <td className="px-4 py-3">{q.difficulty}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded px-2 py-0.5 text-xs ${q.status === "PUBLISHED" ? "bg-emerald-50 text-emerald-600" : q.status === "DRAFT" ? "bg-amber-50 text-amber-600" : "bg-slate-100 text-slate-500"}`}>
                      {STATUS_LABEL[q.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-3">
                      <button onClick={() => openEdit(q)} className="text-indigo-600 hover:underline">编辑</button>
                      {user?.role === "ADMIN" && (
                        <button onClick={() => remove(q)} className="text-red-500 hover:underline">删除</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {importOpen && (
        <div className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
          <div className="mt-10 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">批量导入题目</h2>
              <button onClick={() => setImportOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="mt-4 flex gap-2">
              {(["json", "csv"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setImportMode(m)}
                  className={`rounded-lg px-4 py-1.5 text-sm ${importMode === m ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"}`}
                >
                  {m === "json" ? "JSON 数组" : "CSV 文本"}
                </button>
              ))}
            </div>
            {importMode === "json" ? (
              <>
                <textarea
                  className={`${input} mt-3 h-48 font-mono text-xs`}
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder={'[\n  { "subject": "TMUA", "topic": "代数", "difficulty": 3, "type": "SINGLE_CHOICE", "stem": "题干...", "options": ["A", "B", "C", "D"], "answer": "A", "solution": "解析", "source": "来源", "status": "PUBLISHED" }\n]'}
                />
                <p className="mt-2 text-xs text-slate-400">字段:subject 必填,topic 必填,stem 必填,options 至少 2 个,answer 必填;其余可选</p>
              </>
            ) : (
              <>
                <textarea
                  className={`${input} mt-3 h-48 font-mono text-xs`}
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder={"subject,paper,topic,difficulty,type,stem,options(分号分隔),answer,solution,source,status\nTMUA,Paper 1,代数,3,SINGLE_CHOICE,\"题干...\",A;B;C;D,A,解析,来源,PUBLISHED"}
                />
                <p className="mt-2 text-xs text-slate-400">首行为表头;options 用分号分隔;含逗号的字段用双引号包裹</p>
              </>
            )}
            {importError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{importError}</p>}
            {importResult && (
              <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                导入完成:成功 {importResult.imported} 条,失败 {importResult.failed} 条
                {importResult.errors.length > 0 && (
                  <ul className="mt-1 list-inside list-disc text-xs">
                    {importResult.errors.map((e, i) => <li key={i}>第 {e.row} 行:{e.reason}</li>)}
                  </ul>
                )}
              </div>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setImportOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600">关闭</button>
              <button onClick={doImport} disabled={importing} className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
                {importing ? "导入中..." : "开始导入"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
          <div className="mt-10 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">{form.id ? "编辑题目" : "新建题目"}</h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm text-slate-600">科目</label>
                <select className={input} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })}>
                  <option value="TMUA">TMUA</option>
                  <option value="ESAT">ESAT</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-600">试卷/部分</label>
                <input className={input} value={form.paper} onChange={(e) => setForm({ ...form, paper: e.target.value })} placeholder="Paper 1 / Maths 1" />
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-600">知识点</label>
                <input className={input} value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} placeholder="如:代数、微积分、逻辑" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm text-slate-600">难度(1-5)</label>
                  <input className={input} type="number" min={1} max={5} value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: Number(e.target.value) })} />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-slate-600">状态</label>
                  <select className={input} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                    <option value="DRAFT">草稿</option>
                    <option value="PUBLISHED">发布</option>
                    <option value="ARCHIVED">下架</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="mt-3">
              <label className="mb-1 block text-sm text-slate-600">题干(支持公式 `$x^2$`、图片 `![说明](/images/questions/xx.png)`、LaTeX 文本)</label>
              <textarea className={`${input} h-20`} value={form.stem} onChange={(e) => setForm({ ...form, stem: e.target.value })} placeholder="输入题干... 公式用 $ 包裹,如 求 $x^2 - 5x + 6 = 0$ 的根" />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm text-slate-600">选项(每行一个,支持公式 $ 与图片)</label>
                <textarea className={`${input} h-24`} value={form.optionsText} onChange={(e) => setForm({ ...form, optionsText: e.target.value })} placeholder={"A 选项内容\nB 选项内容\n$\\sqrt{2}$ 或 ![图]( /images/questions/xx.png)"} />
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-600">正确答案</label>
                <input className={input} value={form.answer} onChange={(e) => setForm({ ...form, answer: e.target.value })} placeholder="与某选项内容一致" />
                <label className="mb-1 mt-3 block text-sm text-slate-600">解析</label>
                <textarea className={`${input} h-14`} value={form.solution} onChange={(e) => setForm({ ...form, solution: e.target.value })} placeholder="解题思路(可选)" />
              </div>
            </div>
            {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setShowForm(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600">
                取消
              </button>
              <button onClick={submitForm} disabled={saving} className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
