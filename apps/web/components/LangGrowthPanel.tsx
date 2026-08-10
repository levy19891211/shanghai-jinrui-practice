"use client";
// 个人空间 - 语言成长界面:成长图谱 / 成长教练 / 成就&高光 / 听说读写四板块学情分析 / 语言作业 / 动态记录
import { useMemo, useState } from "react";
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
const SKILL_ICON: Record<string, string> = { LISTENING: "🎧", READING: "📖", WRITING: "✍️", SPEAKING: "🗣️", FULL: "🎯" };
const SKILL_COLOR: Record<string, string> = {
  LISTENING: "#1f6fb2", READING: "#2e6f40", WRITING: "#b8860b", SPEAKING: "#7a3b8f", FULL: "#a14a3a",
};

type Milestone = { id: string; title: string; desc: string; date: string; icon: string; highlight: boolean };

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
  const [hlOpen, setHlOpen] = useState(true);

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

  // 各技能聚合(正确率 / band)
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

  // 听说读写(+全真连考)四板块学情分析
  const skillCards = useMemo(
    () =>
      ["LISTENING", "READING", "WRITING", "SPEAKING", "FULL"].map((skill) => {
        const list = done
          .filter((s) => s.skill === skill)
          .slice()
          .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
        const stat = bySkill.find((b) => b.skill === skill);
        const trend = list.slice(-8).map((s) => (s.total ? Math.round((s.correctCount! / s.total) * 100) : null));
        let advice: string;
        if (!stat || stat.sessions === 0) advice = "还没有练习记录,从一次练习开始积累。";
        else if (stat.rate == null) advice = "已有练习,等待教师评分后查看正确率。";
        else if (stat.rate >= 85) advice = "掌握良好,继续保持,可挑战更高目标。";
        else if (stat.rate >= 70) advice = "表现稳定,建议逐步提高练习难度。";
        else advice = "正确率偏低,建议专项强化并复盘错题。";
        if (stat?.avgBand != null && stat.avgBand >= 7) advice = `平均 ${stat.avgBand} Band,已进入高分区间,继续保持。`;
        else if (stat?.avgBand != null && stat.avgBand < 6) advice = `平均 ${stat.avgBand} Band,建议以 6.0 为近期目标逐项突破。`;
        return { skill, label: SKILL_LABEL[skill] || skill, icon: SKILL_ICON[skill] || "📘", stat, trend, advice };
      }),
    [done, bySkill],
  );

  // 成长教练:规则生成的鼓励 + 建议
  const coach = useMemo(() => {
    if (done.length === 0) return null;
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const recent = done.slice().reverse().slice(0, 5).filter((s) => s.total).map((s) => (s.correctCount! / s.total!) * 100);
    const earlier = done.slice().reverse().slice(5, 10).filter((s) => s.total).map((s) => (s.correctCount! / s.total!) * 100);
    let encouragement: string;
    if (recent.length >= 3 && earlier.length >= 3 && avg(recent) > avg(earlier) + 5) {
      encouragement = `最近 ${recent.length} 次正确率 ${Math.round(avg(recent))}%,状态明显提升,保持这个节奏!`;
    } else if (overview.avgBand != null && overview.avgBand >= 7) {
      encouragement = `平均 ${overview.avgBand} 分的表现很棒,已接近目标分数,继续打磨薄弱板块即可。`;
    } else {
      encouragement = `已累计 ${overview.count} 次语言练习,平均正确率 ${overview.rate == null ? "—" : overview.rate + "%"}。坚持练习、及时复盘错题,分数一定会稳步上升。`;
    }
    const suggestions: string[] = [];
    for (const s of bySkill) {
      if (s.rate != null && s.rate < 70) suggestions.push(`${s.label}正确率 ${s.rate}%,建议专项强化,并回看该板块错题。`);
    }
    for (const sk of ["LISTENING", "READING", "WRITING", "SPEAKING"]) {
      const x = bySkill.find((b) => b.skill === sk);
      if (!x) suggestions.push(`${SKILL_LABEL[sk]}还没有练习记录,建议开始第一次${SKILL_LABEL[sk]}练习。`);
      else if (x.sessions < 3) suggestions.push(`${x.label}只练习了 ${x.sessions} 次,建议增加频次形成习惯。`);
    }
    if (overview.avgBand != null && overview.avgBand < 6) suggestions.push("当前平均 Band 低于 6.0,建议以 6.0 为近期目标,按听说读写逐项突破。");
    const full = bySkill.find((b) => b.skill === "FULL");
    if (!full || full.sessions === 0) suggestions.push("建议定期参加全真连考模考,熟悉真实考试节奏。");
    if (suggestions.length > 4) suggestions.length = 4;
    return { encouragement, suggestions };
  }, [done, bySkill, overview]);

  // 成就 & 高光时刻:从每次语言练习/模考中识别里程碑
  const milestones = useMemo<Milestone[]>(() => {
    const sorted = done.slice().sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
    const ms: Milestone[] = [];
    const reachedBand = new Set<number>();
    const skillFirst = new Set<string>();
    const skillQualified = new Set<string>();
    let bestBand: number | null = null;
    let examFirst = false;
    let rate80 = false;
    sorted.forEach((s, i) => {
      const rate = s.total ? Math.round((s.correctCount! / s.total) * 100) : null;
      const date = s.startedAt;
      const skillLabel = SKILL_LABEL[s.skill] || s.skill || "语言";
      if (i === 0) ms.push({ id: "first", title: "首次语言练习", desc: `完成了第一次${skillLabel}练习,成长从这里开始。`, date, icon: "🎉", highlight: false });
      if (s.mode === "EXAM" && !examFirst) {
        examFirst = true;
        ms.push({ id: "exam1", title: "首次模拟考", desc: `第一次参加语言模拟考(${skillLabel})。`, date, icon: "📝", highlight: false });
      }
      if (!skillFirst.has(s.skill)) {
        skillFirst.add(s.skill);
        ms.push({ id: `sk_${s.skill}`, title: `开启${skillLabel}`, desc: `第一次进行${skillLabel}练习。`, date, icon: "📚", highlight: false });
      }
      if (rate != null && rate >= 80 && !rate80) {
        rate80 = true;
        ms.push({ id: "r80", title: "正确率突破 80%", desc: `在${skillLabel}中达到 ${rate}% 的正确率。`, date, icon: "🚀", highlight: true });
      }
      if (s.band != null) {
        for (const t of [6, 6.5, 7, 7.5, 8]) {
          if (s.band >= t && !reachedBand.has(t)) {
            reachedBand.add(t);
            ms.push({ id: `band${t}`, title: `Band ${t} 达成`, desc: `估分达到 ${t},离目标更近一步。`, date, icon: "🏅", highlight: t >= 7 });
          }
        }
        if (bestBand != null && s.band > bestBand) {
          ms.push({ id: `up_${s.id}`, title: "Band 提升", desc: `Band 从 ${bestBand} 提升到 ${s.band}。`, date, icon: "📈", highlight: false });
        }
        bestBand = bestBand == null ? s.band : Math.max(bestBand, s.band);
      }
      if (rate != null && rate >= 70 && !skillQualified.has(s.skill)) {
        skillQualified.add(s.skill);
        ms.push({ id: `sq_${s.skill}`, title: `${skillLabel}正确率达标`, desc: `${skillLabel}正确率达到 ${rate}%。`, date, icon: "🎯", highlight: false });
      }
    });
    for (const c of [10, 20, 30, 50]) {
      if (sorted.length >= c) ms.push({ id: `n${c}`, title: `累计 ${c} 次语言练习`, desc: `已累计完成 ${c} 次语言练习。`, date: sorted[c - 1].startedAt, icon: "🏆", highlight: false });
    }
    return ms;
  }, [done]);
  const highlightMs = milestones.filter((m) => m.highlight);
  const otherMs = milestones.filter((m) => !m.highlight);

  // 动态记录(时间线,倒序)
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

      {/* 成长图谱 */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700">成长图谱</h2>
          <span className="text-xs text-slate-400">
            {done.length} 次练习 · 峰值 {Math.max(...rateTrend.map((p) => p.rate ?? 0), 0)}%
          </span>
        </div>
        <p className="mt-1 text-xs text-slate-400">正确率成长轨迹：每次语言练习/模考的正确率变化（最近 20 次）</p>
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

      {/* 听说读写四板块学情分析 */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-700">听说读写 · 板块学情分析</h2>
        <p className="mt-0.5 text-xs text-slate-400">按听力 / 阅读 / 写作 / 口语 / 全真连考 分别分析掌握情况与建议</p>

        {/* 正确率对比 */}
        <div className="mt-3 h-44">
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

        {/* 四板块卡片 */}
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {skillCards.map((c) => (
            <div key={c.skill} className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <span className="text-base">{c.icon}</span>
                  {c.label}
                </p>
                {c.stat && c.stat.sessions > 0 ? (
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200">{c.stat.sessions} 次</span>
                ) : (
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-300 ring-1 ring-slate-100">未开始</span>
                )}
              </div>

              <div className="mt-2 flex items-baseline gap-3">
                <p className={`text-lg font-bold ${c.stat && c.stat.rate != null && c.stat.rate >= 70 ? "text-emerald-600" : "text-slate-800"}`}>
                  {c.stat && c.stat.rate != null ? `${c.stat.rate}%` : "—"}
                  {c.stat && c.stat.rate != null && <span className="text-xs font-medium text-slate-400"> 正确率</span>}
                </p>
                {c.stat?.avgBand != null && (
                  <p className="text-sm font-semibold text-amber-600">平均 {c.stat.avgBand} Band</p>
                )}
              </div>

              {/* 迷你趋势(最近 8 次) */}
              <div className="mt-2 flex h-10 items-end gap-1">
                {c.trend.length === 0 ? (
                  <span className="text-[11px] text-slate-300">暂无数据</span>
                ) : (
                  c.trend.map((r, i) => (
                    <div key={i} className="flex flex-1 flex-col items-center gap-0.5">
                      <span className="text-[9px] text-slate-400">{r == null ? "·" : r}</span>
                      <div
                        className={`w-full rounded-t ${r == null ? "bg-slate-100" : r >= 70 ? "bg-emerald-400" : r >= 40 ? "bg-amber-400" : "bg-rose-400"}`}
                        style={{ height: r == null ? 4 : Math.max(6, (r / 100) * 28) }}
                      />
                    </div>
                  ))
                )}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-500">{c.advice}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 成长教练 */}
      {coach && (
        <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-indigo-700">💡 成长教练</h2>
          {coach.encouragement && <p className="mt-2 text-sm leading-relaxed text-slate-700">{coach.encouragement}</p>}
          {coach.suggestions.length > 0 && (
            <ul className="mt-3 space-y-2">
              {coach.suggestions.map((sg, i) => (
                <li key={i} className="flex items-start gap-2 rounded-xl bg-white/70 px-3 py-2 text-sm text-slate-700">
                  <span className="mt-0.5 shrink-0 font-bold text-indigo-500">✓</span>
                  <span>{sg}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 成就 & 高光时刻 */}
      {milestones.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700">成就 & 高光时刻 ({milestones.length})</h2>
          <p className="mt-1 text-xs text-slate-400">每一个值得记住的节点,都在这里留痕。</p>

          {highlightMs.length > 0 && (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setHlOpen((o) => !o)}
                className="flex w-full items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-left transition hover:bg-amber-100/60"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-amber-700">🌟 高光时刻 ({highlightMs.length})</span>
                <span className="text-xs text-amber-600">{hlOpen ? "收起 ▲" : "展开 ▼"}</span>
              </button>
              {hlOpen && (
                <div className="mt-3 space-y-3">
                  {highlightMs.map((m) => (
                    <div key={m.id} className="relative rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
                      <div className="flex items-center justify-between gap-2">
                        <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-700">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-[11px] text-white">{m.icon}</span>
                          {m.title}
                        </p>
                        <span className="shrink-0 text-xs text-slate-400">{new Date(m.date).toLocaleDateString("zh-CN")}</span>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-slate-500">{m.desc}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {otherMs.length > 0 && (
            <ol className="relative mt-4 space-y-4 border-l-2 border-indigo-100 pl-5">
              {otherMs.map((m) => (
                <li key={m.id} className="relative">
                  <span className="absolute -left-[27px] top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-[11px] text-indigo-600">{m.icon}</span>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-800">{m.title}</p>
                      <span className="shrink-0 text-xs text-slate-400">{new Date(m.date).toLocaleDateString("zh-CN")}</span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">{m.desc}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
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
