"use client";
// 个人空间 - 语言成长界面:语言学习成长动态记录(轨迹/技能/动态时间线/语言作业)
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

export type LangSession = {
  id: string;
  examType: string;
  skill: string;
  mode: string;
  score: number | null;
  total: number | null;
  correctCount: number | null;
  band: number | null;
  startedAt: string;
  submittedAt: string | null;
  paper: { title: string } | null;
};

export type LangAssignment = {
  id: string;
  title: string;
  note: string | null;
  mode: string;
  dueAt: string | null;
  status: string;
  submittedAt: string | null;
  isLanguage?: boolean;
  paper: {
    title: string; examType?: string | null; skill?: string | null; mode?: string; durationMin?: number | null;
  } | null;
};

const EXAM_LABEL: Record<string, string> = { IELTS: "雅思", TOEFL: "托福", KET_PET: "剑桥KET/PET", OTHER: "其他语言" };
const SKILL_LABEL: Record<string, string> = { LISTENING: "听力", READING: "阅读", WRITING: "写作", SPEAKING: "口语", FULL: "全真连考" };
const SKILL_COLOR: Record<string, string> = {
  LISTENING: "#1f6fb2", READING: "#2e6f40", WRITING: "#b8860b", SPEAKING: "#7a3b8f", FULL: "#a14a3a",
};

export default function LangGrowthPanel({
  sessions,
  assignments,
  onStart,
}: {
  sessions: LangSession[];
  assignments: LangAssignment[];
  onStart: (a: LangAssignment) => void;
}) {
  const router = useRouter();

  // 已提交的语言练习/模考(有成绩)
  const done = useMemo(() => sessions.filter((s) => s.submittedAt), [sessions]);

  // 概览统计
  const overview = useMemo(() => {
    let correct = 0, total = 0, bandSum = 0, bandCount = 0, mock = 0;
    for (const s of done) {
      if (s.correctCount != null && s.total) { correct += s.correctCount; total += s.total; }
      if (s.band != null) { bandSum += s.band; bandCount += 1; }
      if (s.mode === "EXAM") mock += 1;
    }
    return {
      count: done.length,
      rate: total ? Math.round((correct / total) * 100) : null,
      avgBand: bandCount ? +(bandSum / bandCount).toFixed(1) : null,
      mock,
    };
  }, [done]);

  // 正确率成长轨迹(最近 20 次,按时间正序)
  const rateTrend = useMemo(
    () =>
      done
        .slice()
        .reverse()
        .slice(-20)
        .reverse()
        .map((s, i) => ({
          name: `${i + 1}`,
          rate: s.total ? Math.round((s.correctCount! / s.total) * 100) : null,
          mode: s.mode === "EXAM" ? "模考" : "练习",
          skill: SKILL_LABEL[s.skill] || s.skill,
          title: s.paper?.title || `${EXAM_LABEL[s.examType] || s.examType || "语言"}·${SKILL_LABEL[s.skill] || s.skill || "练习"}`,
          band: s.band,
        })),
    [done],
  );

  // Band 成长轨迹(有 band 的会话)
  const bandTrend = useMemo(
    () =>
      done
        .filter((s) => s.band != null)
        .slice()
        .reverse()
        .slice(-20)
        .reverse()
        .map((s, i) => ({
          name: `${i + 1}`,
          band: s.band,
          skill: SKILL_LABEL[s.skill] || s.skill,
          title: s.paper?.title || `${EXAM_LABEL[s.examType] || s.examType || "语言"}·${SKILL_LABEL[s.skill] || s.skill || "练习"}`,
        })),
    [done],
  );

  // 各技能掌握(正确率 / band)
  const bySkill = useMemo(() => {
    const map = new Map<string, { skill: string; sessions: number; correct: number; total: number; bandSum: number; bandCount: number }>();
    for (const s of done) {
      const cur = map.get(s.skill) || { skill: s.skill, sessions: 0, correct: 0, total: 0, bandSum: 0, bandCount: 0 };
      cur.sessions += 1;
      if (s.correctCount != null && s.total) { cur.correct += s.correctCount; cur.total += s.total; }
      if (s.band != null) { cur.bandSum += s.band; cur.bandCount += 1; }
      map.set(s.skill, cur);
    }
    return Array.from(map.values())
      .map((x) => ({
        skill: x.skill,
        label: SKILL_LABEL[x.skill] || x.skill,
        sessions: x.sessions,
        rate: x.total ? Math.round((x.correct / x.total) * 100) : null,
        avgBand: x.bandCount ? +(x.bandSum / x.bandCount).toFixed(1) : null,
      }))
      .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));
  }, [done]);

  // 动态记录(时间线,倒序):每次语言练习/模考的成绩
  const timeline = useMemo(
    () =>
      done
        .slice()
        .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
        .map((s) => ({
          ...s,
          rate: s.total ? Math.round((s.correctCount! / s.total) * 100) : null,
          examLabel: EXAM_LABEL[s.examType] || s.examType || "语言",
          skillLabel: SKILL_LABEL[s.skill] || s.skill || "练习",
        })),
    [done],
  );

  const pending = assignments.filter((a) => a.status === "PENDING" || a.status === "IN_PROGRESS");
  const past = assignments.filter((a) => !pending.includes(a));

  const fmtTime = (s?: string | null) => {
    if (!s) return "";
    const d = new Date(s);
    return d.toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  if (done.length === 0 && assignments.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
        <p className="text-4xl">🗣️</p>
        <p className="mt-3 text-sm font-medium text-slate-700">还没有语言学习记录</p>
        <p className="mt-1 text-xs text-slate-400">去做一次雅思/托福听力、阅读、写作或口语练习，这里就会记录你的成长轨迹。</p>
        <button
          onClick={() => router.push("/app/language")}
          className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
        >
          去语言学习 →
        </button>
      </div>
    );
  }

  const overviewCards = [
    { label: "累计练习", value: `${overview.count}`, unit: "次", color: "text-indigo-600", bg: "bg-indigo-50" },
    { label: "平均正确率", value: overview.rate == null ? "—" : `${overview.rate}%`, unit: "", color: "text-emerald-600", bg: "bg-emerald-50" },
    { label: "平均 Band", value: overview.avgBand == null ? "—" : `${overview.avgBand}`, unit: "", color: "text-amber-600", bg: "bg-amber-50" },
    { label: "模考次数", value: `${overview.mock}`, unit: "次", color: "text-rose-600", bg: "bg-rose-50" },
  ];

  return (
    <div className="space-y-6">
      {/* 概览卡 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {overviewCards.map((c) => (
          <div key={c.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500">{c.label}</p>
            <p className={`mt-1 text-xl font-bold ${c.color}`}>
              {c.value}
              {c.unit && <span className="ml-0.5 text-xs font-medium text-slate-400">{c.unit}</span>}
            </p>
          </div>
        ))}
      </div>

      {/* 成长轨迹 */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">正确率成长轨迹</h2>
            <p className="mt-0.5 text-xs text-slate-400">每次语言练习/模考的正确率变化（最近 20 次）</p>
          </div>
        </div>
        <div className="mt-3 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rateTrend} margin={{ top: 8, right: 12, bottom: 0, left: -14 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
              <Tooltip
                formatter={(v: number) => [`${v}%`, "正确率"]}
                labelFormatter={(l, payload) => {
                  const p = payload?.[0]?.payload;
                  return p ? `${p.title} · ${p.skill} · ${p.mode}` : `第 ${l} 次`;
                }}
              />
              <Line type="monotone" dataKey="rate" name="正确率" stroke="#4f46e5" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
        {bandTrend.length > 0 && (
          <>
            <div className="mt-5 border-t border-slate-100 pt-4">
              <h2 className="text-sm font-semibold text-slate-700">Band 成长轨迹</h2>
              <p className="mt-0.5 text-xs text-slate-400">带估分（Band）的语言练习/模考走势</p>
            </div>
            <div className="mt-3 h-52">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={bandTrend} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 9]} tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(v: number) => [`${v} Band`, "Band"]}
                    labelFormatter={(l, payload) => {
                      const p = payload?.[0]?.payload;
                      return p ? `${p.title} · ${p.skill}` : `第 ${l} 次`;
                    }}
                  />
                  <Line type="monotone" dataKey="band" name="Band" stroke="#b8860b" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </div>

      {/* 各技能掌握 */}
      {bySkill.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700">各技能掌握情况</h2>
          <p className="mt-0.5 text-xs text-slate-400">按听力 / 阅读 / 写作 / 口语 / 全真连考 聚合</p>
          <div className="mt-3 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bySkill} margin={{ top: 8, right: 12, bottom: 0, left: -14 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(v: number) => [`${v}%`, "正确率"]}
                  labelFormatter={(l) => `${l}`}
                />
                <Bar dataKey="rate" name="正确率" radius={[6, 6, 0, 0]}>
                  {bySkill.map((e) => (
                    <Cell key={e.skill} fill={SKILL_COLOR[e.skill] || "#94a3b8"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {bySkill.map((s) => (
              <div key={s.skill} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: SKILL_COLOR[s.skill] || "#94a3b8" }} />
                  {s.label}
                </p>
                <p className="mt-1 text-sm font-bold text-slate-800">{s.rate == null ? "—" : `${s.rate}%`}</p>
                <p className="text-[11px] text-slate-400">
                  {s.sessions} 次{s.avgBand != null ? ` · 平均 ${s.avgBand} Band` : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 我的语言作业 */}
      {assignments.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700">我的语言作业（{pending.length} 项待完成）</h2>
          <div className="mt-3 space-y-2">
            {pending.map((a) => (
              <button
                key={a.id}
                onClick={() => onStart(a)}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-white p-3 text-left transition hover:border-indigo-300 hover:bg-indigo-50/40"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{a.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {a.paper?.title}
                    {a.paper?.examType ? ` · ${EXAM_LABEL[a.paper.examType] || a.paper.examType}` : ""}
                    {a.paper?.skill ? ` · ${SKILL_LABEL[a.paper.skill] || a.paper.skill}` : ""}
                    {a.dueAt ? ` · 截止 ${fmtTime(a.dueAt)}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-medium text-indigo-600">{a.status === "IN_PROGRESS" ? "继续作答 →" : "开始作答 →"}</span>
              </button>
            ))}
            {past.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-600">{a.title}</p>
                  <p className="mt-0.5 text-xs text-slate-400">已完成</p>
                </div>
                <span className="shrink-0 rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">✓ 已提交</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 动态记录(时间线) */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-700">学习动态记录</h2>
        <p className="mt-0.5 text-xs text-slate-400">按时间倒序，每一次语言练习 / 模考 / 估分都在这里留下成长足迹</p>
        <div className="mt-4 space-y-0">
          {timeline.map((s, idx) => (
            <div key={s.id} className="relative flex gap-3 pb-5 last:pb-0">
              {/* 时间轴 */}
              <div className="flex flex-col items-center">
                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-white" style={{ background: s.band != null && s.band >= 7 ? "#059669" : SKILL_COLOR[s.skill] || "#94a3b8" }} />
                {idx < timeline.length - 1 && <span className="mt-1 w-px flex-1 bg-slate-200" />}
              </div>
              <div className="min-w-0 flex-1 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200">{fmtTime(s.startedAt)}</span>
                  <span className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-white" style={{ background: SKILL_COLOR[s.skill] || "#666" }}>
                    {s.examLabel}·{s.skillLabel}
                  </span>
                  <span className="rounded bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200">{s.mode === "EXAM" ? "模考" : "练习"}</span>
                  {s.band != null && (
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${s.band >= 7 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                      {s.band} Band
                    </span>
                  )}
                </div>
                <p className="mt-1.5 truncate text-sm font-medium text-slate-700">{s.paper?.title || `${s.examLabel} · ${s.skillLabel}`}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  正确率 <b className="text-slate-700">{s.rate == null ? "—" : `${s.rate}%`}</b>
                  {s.correctCount != null && s.total ? `（${s.correctCount}/${s.total} 题）` : ""}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
