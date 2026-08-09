"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { clearAuth, getUser } from "@/lib/api";
import { APP_VERSION } from "@/lib/version";

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<ReturnType<typeof getUser>>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const u = getUser();
    if (!u || u.role === "STUDENT") {
      router.replace("/login");
    } else {
      setUser(u);
      setReady(true);
    }
  }, [router]);

  if (!ready) return null;

  const nav = [
    { href: "/teacher", label: "题库管理" },
    { href: "/teacher/papers", label: "试卷组卷" },
    { href: "/teacher/students", label: "学生管理" },
    { href: "/teacher/knowledge", label: "知识点管理" },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <span className="text-sm font-bold text-indigo-600">上海金瑞学校 · 附加笔试刷题 · 老师端</span>
            <nav className="flex gap-1">
              {nav.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`rounded-md px-3 py-1.5 text-sm transition ${
                    pathname === n.href ? "bg-indigo-50 font-medium text-indigo-600" : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-300">{APP_VERSION}</span>
            <span className="text-sm text-slate-500">{user?.name}({user?.role === "ADMIN" ? "管理员" : "老师"})</span>
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
