"use client";

import { useRouter } from "next/navigation";
import { clearAuth, getUser } from "@/lib/api";

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const user = getUser();

  if (!user || user.role === "STUDENT") {
    router.push("/login");
    return null;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <span className="text-sm font-bold text-indigo-600">TMUA/ESAT 刷题 · 老师端</span>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-500">{user.name}({user.role === "ADMIN" ? "管理员" : "老师"})</span>
            <button
              onClick={() => { clearAuth(); router.push("/login"); }}
              className="rounded-md px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100"
            >
              退出
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
