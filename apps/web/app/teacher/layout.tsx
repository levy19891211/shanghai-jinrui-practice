"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { clearAuth, getUser } from "@/lib/api";
import { APP_VERSION } from "@/lib/version";
import ProfileDialog from "@/components/ProfileDialog";

// 教师子角色称谓(与后端 TEACHER_ROLES 对齐;权限仍由 role 决定)
const TEACHER_ROLE_LABEL: Record<string, string> = {
  ACADEMIC: "教务老师",
  ASSISTANT: "助教老师",
  SUBJECT: "任课教师",
  COUNSELOR: "升学指导老师",
};

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<ReturnType<typeof getUser>>(null);
  const [ready, setReady] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

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
    { href: "/teacher/language", label: "语言学习" },
    { href: "/teacher/papers", label: "试卷组卷" },
    { href: "/teacher/students", label: "教学管理" },
    { href: "/teacher/planning", label: "升学规划" },
    { href: "/teacher/academics", label: "教务管理" },
  ];

  // 导航标签固定断行：4 字 → 2+2，5 字 → 3+2，避免浏览器随机断行（如「题库管/理」）
  const splitLabel = (label: string): [string, string] =>
    label.length >= 5 ? [label.slice(0, 3), label.slice(3)] : [label.slice(0, 2), label.slice(2)];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <span className="flex items-center gap-2">
              {/* 金瑞校 logo（彩色横版） */}
              <img src="/images/jinrui-logo-c.png" alt="上海金瑞学校" className="h-8 w-auto" />
              <span className="text-sm font-bold text-indigo-600">金瑞高中综合管理系统 · 老师端</span>
            </span>
            <nav className="flex gap-1">
              {nav.map((n) => {
                const [l1, l2] = splitLabel(n.label);
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    className={`rounded-md px-3 py-1.5 text-center text-sm leading-snug transition ${
                      pathname === n.href ? "bg-indigo-50 font-medium text-indigo-600" : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    <span className="block whitespace-nowrap">{l1}</span>
                    <span className="block whitespace-nowrap">{l2}</span>
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-300">{APP_VERSION}</span>
            <div className="flex flex-col items-start gap-0.5 leading-tight">
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-500">{user?.name}({user?.role === "ADMIN" ? "管理员" : TEACHER_ROLE_LABEL[user?.teacherRole || "SUBJECT"] || "任课教师"})</span>
                <span className="text-slate-200">|</span>
                <button
                  onClick={() => { clearAuth(); router.push("/login"); }}
                  className="rounded-md px-1 py-0.5 text-sm text-slate-500 hover:bg-slate-100"
                >
                  退出
                </button>
              </div>
              <button
                onClick={() => setProfileOpen(true)}
                className="-ml-1 rounded-md px-1 py-0.5 text-xs text-indigo-600 hover:bg-indigo-50"
                title="修改姓名 / 登录密码"
              >
                修改信息
              </button>
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>

      {/* 右上角「修改信息」弹窗:改姓名 / 改密码 */}
      {profileOpen && (
        <ProfileDialog
          onClose={() => setProfileOpen(false)}
          onSaved={(u) => setUser((prev) => (prev ? { ...prev, name: u.name } : prev))}
        />
      )}
    </div>
  );
}
