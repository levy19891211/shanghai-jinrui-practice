"use client";

// 右上角「修改信息」弹窗:修改姓名 / 修改密码(改密码需验证旧密码)
// 后端:PUT /api/auth/profile —— name 直接更新;newPassword 必须携带 currentPassword 且比对通过
import { useState } from "react";
import { api, setUser, getUser } from "@/lib/api";

interface SavedUser {
  id: string;
  email: string;
  name: string;
  role: string;
  teacherRole?: string | null;
  status: string;
}

export default function ProfileDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (u: SavedUser) => void;
}) {
  // 本地缓存的用户对象由登录响应写入,实际含 email 等字段,这里按完整结构读取
  const me = getUser() as (SavedUser | null);
  const [name, setName] = useState(me?.name || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const input =
    "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const changingPassword = !!(newPassword || confirmPassword);
    if (changingPassword && !newPassword) return setError("请填写新密码");
    if (changingPassword) {
      if (newPassword.length < 6) return setError("新密码至少 6 位");
      if (newPassword !== confirmPassword) return setError("两次输入的新密码不一致");
      if (!currentPassword) return setError("修改密码需先输入旧密码");
    }
    if (!name.trim() && !changingPassword) return setError("没有需要保存的修改");
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      if (name.trim() && name.trim() !== me?.name) payload.name = name.trim();
      if (changingPassword) {
        payload.currentPassword = currentPassword;
        payload.newPassword = newPassword;
      }
      if (!Object.keys(payload).length) return setError("没有需要保存的修改");
      const r = await api.put<{ user: SavedUser }>("/auth/profile", payload);
      // 同步本地缓存的用户信息(右上角显示名等)
      setUser({ ...(getUser() || {}), ...r.user });
      onSaved(r.user);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-slate-900">修改信息</h2>
        <p className="mt-1 text-xs text-slate-400">登录名 {me?.email || "—"}（不可修改）</p>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-sm text-slate-600">姓名</label>
            <input className={input} type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="显示姓名" />
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="mb-2 text-xs font-medium text-slate-500">修改密码（不需要改就留空）</p>
            <div className="space-y-2">
              <input className={input} type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="旧密码" autoComplete="current-password" />
              <input className={input} type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="新密码（至少 6 位）" autoComplete="new-password" />
              <input className={input} type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="确认新密码" autoComplete="new-password" />
            </div>
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">取消</button>
            <button type="submit" disabled={saving} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
