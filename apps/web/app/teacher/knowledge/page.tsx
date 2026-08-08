"use client";

import { useCallback, useEffect, useState } from "react";
import { api, getUser } from "@/lib/api";

interface KnowledgePoint {
  id: string;
  subject: string;
  name: string;
  sortOrder: number;
  questionCount: number;
  createdAt: string;
}

const SUBJECTS = ["数学", "物理", "化学", "生物"];
const SUBJECT_COLOR: Record<string, string> = {
  数学: "bg-indigo-50 text-indigo-600",
  物理: "bg-emerald-50 text-emerald-600",
  化学: "bg-amber-50 text-amber-600",
  生物: "bg-rose-50 text-rose-600",
};

export default function KnowledgePage() {
  const user = getUser();
  const [subject, setSubject] = useState("数学");
  const [list, setList] = useState<KnowledgePoint[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  // 行内编辑状态
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ list: KnowledgePoint[] }>(`/knowledge-points?subject=${encodeURIComponent(subject)}`);
      setList(d.list || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    }
  }, [subject]);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    const n = name.trim();
    if (!n) return setError("请输入知识点名称");
    setBusy(true);
    setError("");
    try {
      const r = await api.post<{ id: string }>("/knowledge-points", { subject, name: n });
      setMessage(r ? "已添加" : "");
      setName("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "添加失败");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(kp: KnowledgePoint) {
    const n = editName.trim();
    if (!n) return setError("名称不能为空");
    setBusy(true);
    setError("");
    try {
      await api.put(`/knowledge-points/${kp.id}`, { name: n });
      setEditingId(null);
      setMessage("已更新");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新失败");
    } finally {
      setBusy(false);
    }
  }

  async function remove(kp: KnowledgePoint) {
    if (!window.confirm(`删除知识点「${kp.name}」?${kp.questionCount ? `\n将同时从 ${kp.questionCount} 道题中移除该标签。` : ""}`)) return;
    setError("");
    try {
      await api.del(`/knowledge-points/${kp.id}`);
      setMessage("已删除");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">知识点管理</h1>
          <p className="mt-1 text-sm text-slate-500">
            维护数学/物理/化学/生物四门学科的知识点标签。导入的题目会自动匹配归类,匹配不到的留空由老师在此补充。
          </p>
        </div>
      </div>

      {message && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-600">{message}</p>}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      {/* 学科切换 */}
      <div className="flex gap-2">
        {SUBJECTS.map((s) => (
          <button
            key={s}
            onClick={() => { setSubject(s); setMessage(""); setError(""); }}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${subject === s ? "bg-indigo-600 text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-50"}`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* 新增 */}
      <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder={`新增「${subject}」知识点,如:二次函数、牛顿定律…`}
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
        />
        <button onClick={add} disabled={busy || !name.trim()} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {busy ? "添加中..." : "+ 添加"}
        </button>
      </div>

      {/* 列表 */}
      {list.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          暂无「{subject}」知识点,请在上方添加
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-400">
              <tr>
                <th className="px-4 py-3 font-normal">知识点名称</th>
                <th className="px-4 py-3 font-normal">关联题目</th>
                <th className="px-4 py-3 font-normal">操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((kp) => (
                <tr key={kp.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    {editingId === kp.id ? (
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && saveEdit(kp)}
                        autoFocus
                        className="w-56 rounded-lg border border-indigo-400 px-3 py-1.5 text-sm outline-none"
                      />
                    ) : (
                      <span className="inline-flex items-center gap-2">
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${SUBJECT_COLOR[kp.subject] || "bg-slate-100 text-slate-600"}`}>{kp.subject}</span>
                        <span className="font-medium text-slate-700">{kp.name}</span>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded px-2 py-0.5 text-xs ${kp.questionCount > 0 ? "bg-indigo-50 text-indigo-600" : "bg-slate-100 text-slate-400"}`}>
                      {kp.questionCount} 题
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {editingId === kp.id ? (
                      <>
                        <button onClick={() => saveEdit(kp)} disabled={busy} className="font-medium text-emerald-600 hover:underline disabled:opacity-50">保存</button>
                        <button onClick={() => setEditingId(null)} className="ml-3 text-slate-500 hover:underline">取消</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => { setEditingId(kp.id); setEditName(kp.name); }} className="font-medium text-indigo-600 hover:underline">编辑</button>
                        <button onClick={() => remove(kp)} className="ml-3 text-red-500 hover:underline">删除</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-400">老师身份: {user?.name}</p>
    </div>
  );
}
