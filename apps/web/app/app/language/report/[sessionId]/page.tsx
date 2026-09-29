"use client";
// 学生端 · 语言四维报告(V2.4.126)
// 把"一个 Band 数字"变成"看得懂的诊断":分项 Band + 四维量表 + 错因分布 + 目标差距 + 下一步动作。
// 全部数值来自后端评分引擎 GET /language/sessions/:id/report,本页不做任何换算。
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

const SKILL_LABEL: Record<string, string> = { LISTENING: "听力", READING: "阅读", WRITING: "写作", SPEAKING: "口语", FULL: "全真" };
const SKILL_COLOR: Record<string, string> = {
  LISTENING: "#1f6fb2", READING: "#2e6f40", WRITING: "#b8860b", SPEAKING: "#7a3b8f", FULL: "#a14a3a",
};
const QTYPE_LABEL: Record<string, string> = {
  FILL_BLANK: "填空", SINGLE_CHOICE: "单选", MULTIPLE_CHOICE: "多选", MATCHING: "配对", HEADING: "段落标题",
  TRUE_FALSE_NG: "判断T/F/NG", YES_NO_NG: "判断Y/N/NG", TASK1: "写作Task1", TASK2: "写作Task2",
  PART1: "口语Part1", PART2: "口语Part2", PART3: "口语Part3",
};
const DIM_LABEL: Record<string, string> = {
  TR: "任务回应 TR", CC: "连贯衔接 CC", LR: "词汇资源 LR", GRA: "语法多样与准确 GRA",
  FC: "流利与连贯 FC", Pron: "发音 Pron",
};

type Report = {
  session: {
    id: string; examType: string; skill: string; mode: string;
    startedAt: string; submittedAt: string | null;
    band: number | null; overallBand: number | null; goalBand: number | null;
    score: number | null; total: number | null; correctCount: number | null;
    scaled: boolean; scoringVersion: string | null; pending: string[];
  };
  paper: { id: string; title: string; kind: string; mode: string } | null;
  skillBands: Record<string, { band: number | null; correct?: number; total?: number; scaled?: boolean; pending?: boolean }>;
  goalAnalysis: {
    hasGoal: boolean; reached: boolean | null; gap: number | null;
    weakest: { skill: string; band: number; gap: number } | null; advice: string[];
    bands: { skill: string; cn: string; band: number | null }[];
  };
  objective: {
    questionId: string; qType: string; skill: string; topic: string | null; groupTitle: string | null;
    stem: string; selected: string | null; answer: string | null; isCorrect: boolean | null;
    solution: string | null; materialTitle: string | null;
  }[];
  subjective: {
    questionId: string; qType: string; skill: string; stem: string; wordLimit: number | null;
    selected: string | null; audioUrl: string | null; band: number | null; feedback: string | null;
    subscores: Record<string, number> | null; solution: string | null; gradedAt: string | null;
  }[];
  wrongQTypes: Record<string, number>;
  wrongSkills: Record<string, number>;
  dims: { writing: string[]; speaking: string[] };
};

const bandColor = (b: number | null) => (b == null ? "#94a3b8" : b >= 7 ? "#059669" : b >= 5.5 ? "#d97706" : "#dc2626");

// 单技能或总分雷达图(用小组件避免引入额外图表依赖带来的 SSR 风险)
function Radar({ data }: { data: { key: string; label: string; value: number }[] }) {
  const size = 220, cx = size / 2, cy = size / 2, r = 82;
  const n = data.length;
  const pt = (i: number, ratio: number) => {
    const ang = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [cx + Math.cos(ang) * r * ratio, cy + Math.sin(ang) * r * ratio];
  };
  const poly = data.map((d, i) => pt(i, Math.max(d.value, 0) / 9).join(",")).join(" ");
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto h-56 w-56">
      {[0.25, 0.5, 0.75, 1].map((g) => (
        <polygon key={g} points={data.map((_, i) => pt(i, g).join(",")).join(" ")} fill="none" stroke="#e2e8f0" strokeWidth={1} />
      ))}
      {data.map((_, i) => {
        const [x, y] = pt(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#e2e8f0" strokeWidth={1} />;
      })}
      <polygon points={poly} fill="rgba(99,102,241,0.18)" stroke="#6366f1" strokeWidth={2} />
      {data.map((d, i) => {
        const [x, y] = pt(i, Math.max(d.value, 0) / 9);
        return <circle key={i} cx={x} cy={y} r={3.5} fill="#6366f1" />;
      })}
      {data.map((d, i) => {
        const [x, y] = pt(i, 1.22);
        return (
          <text key={i} x={x} y={y} fontSize={10} textAnchor="middle" dominantBaseline="middle" fill="#64748b">
            {d.label}
          </text>
        );
      })}
    </svg>
  );
}

export default function LangReportPage({ params }: { params: { sessionId: string } }) {
  const router = useRouter();
  const [r, setR] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        setR(await api.get<Report>(`/language/sessions/${params.sessionId}/report`));
      } catch (e) {
        setError(e instanceof Error ? e.message : "加载失败");
      } finally {
        setLoading(false);
      }
    })();
  }, [params.sessionId]);

  const radar = useMemo(() => {
    if (!r) return [];
    return Object.entries(r.skillBands).map(([k, v]) => ({
      key: k, label: SKILL_LABEL[k] || k, value: Number(v?.band ?? 0),
    }));
  }, [r]);

  if (loading) return <p className="py-16 text-center text-slate-400">加载报告中...</p>;
  if (error) {
    return (
      <div className="mx-auto max-w-4xl">
        <p className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">{error}</p>
        <button onClick={() => router.push("/app/language")} className="mt-3 text-sm text-slate-500 hover:text-slate-700">← 返回语言学习</button>
      </div>
    );
  }
  if (!r) return null;

  const s = r.session;
  const wrongT = Object.entries(r.wrongQTypes).sort((a, b) => b[1] - a[1]);
  const wrongTotal = Object.values(r.wrongQTypes).reduce((a, x) => a + x, 0);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button onClick={() => router.push("/app/language")} className="text-sm text-slate-500 hover:text-slate-700">← 返回语言学习</button>
        <h1 className="ml-1 text-xl font-bold text-slate-800">四维能力报告</h1>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{SKILL_LABEL[s.skill] || s.skill} · {s.mode === "EXAM" ? "模考" : "练习"}</span>
        {s.scaled && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">专项题量已折算至 40 题量纲</span>}
      </div>

      {s.pending.length > 0 && (
        <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          以下分项仍在等待教师批改,总分暂未合成:{s.pending.map((k) => SKILL_LABEL[k] || k).join("、")}
        </p>
      )}

      <div className="space-y-4">
        {/* 总分卡 */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs text-slate-400">总体 Band</p>
              <p className="text-4xl font-bold" style={{ color: bandColor(s.overallBand ?? s.band) }}>
                {s.overallBand ?? s.band ?? "—"}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {s.correctCount != null && s.total ? `客观题答对 ${s.correctCount}/${s.total}` : "写作/口语 · 以教师评分为准"}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-400">目标分</p>
              <p className="text-2xl font-semibold text-indigo-600">{s.goalBand ?? "未设置"}</p>
              {r.goalAnalysis.hasGoal && s.overallBand != null && (
                <p className={`mt-1 text-xs font-medium ${r.goalAnalysis.reached ? "text-emerald-600" : "text-rose-600"}`}>
                  {r.goalAnalysis.reached ? "已达标 🎉" : `还差 ${Math.abs(r.goalAnalysis.gap ?? 0).toFixed(1)} 分`}
                </p>
              )}
            </div>
          </div>
          <p className="mt-3 text-[11px] text-slate-300">评分口径版本 {s.scoringVersion || "—"} · 所有分数由后端评分引擎产出</p>
        </div>

        {/* 分项雷达 + 分项条 */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-700">分项 Band</h2>
            {radar.length >= 3 ? (
              <Radar data={radar} />
            ) : (
              <p className="py-10 text-center text-xs text-slate-400">分项不足 3 项,暂不绘制雷达图</p>
            )}
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-700">逐项明细</h2>
            <div className="mt-3 space-y-3">
              {Object.entries(r.skillBands).map(([k, v]) => (
                <div key={k}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700">{SKILL_LABEL[k] || k}</span>
                    <span className="font-semibold" style={{ color: bandColor(v?.band ?? null) }}>
                      {v?.band != null ? `${v.band}` : "待批改"}
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full" style={{ width: `${((v?.band ?? 0) / 9) * 100}%`, background: SKILL_COLOR[k] || "#64748b" }} />
                  </div>
                  {v?.total ? (
                    <p className="mt-1 text-[11px] text-slate-400">
                      答对 {v.correct}/{v.total}{v.scaled ? " · 已折算" : ""}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 目标差距与建议 */}
        {r.goalAnalysis.advice.length > 0 && (
          <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-5">
            <h2 className="text-sm font-semibold text-indigo-800">下一步建议</h2>
            <ul className="mt-2 space-y-1.5">
              {r.goalAnalysis.advice.map((a, i) => (
                <li key={i} className="text-xs leading-relaxed text-indigo-900">· {a}</li>
              ))}
            </ul>
          </div>
        )}

        {/* 错因分布 */}
        {wrongTotal > 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-700">错因分布</h2>
            <p className="mt-0.5 text-xs text-slate-400">本次共错 {wrongTotal} 题,排在最前的题型优先补</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {wrongT.map(([k, v]) => (
                <span key={k} className="rounded-lg bg-rose-50 px-2 py-1 text-xs text-rose-700">
                  {QTYPE_LABEL[k] || k} · {v}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 主观题四维明细 */}
        {r.subjective.length > 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-700">写作 / 口语四维评分</h2>
            <div className="mt-3 space-y-3">
              {r.subjective.map((it) => (
                <div key={it.questionId} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-white" style={{ background: SKILL_COLOR[it.skill] || "#64748b" }}>
                      {SKILL_LABEL[it.skill] || it.skill}
                    </span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{QTYPE_LABEL[it.qType] || it.qType}</span>
                    <span className="rounded px-1.5 py-0.5 text-[11px] font-bold" style={{ color: bandColor(it.band), background: "#fff" }}>
                      {it.band != null ? `${it.band} Band` : "待批改"}
                    </span>
                    {it.wordLimit ? <span className="text-[11px] text-slate-400">要求 {it.wordLimit} 词</span> : null}
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-slate-700">{it.stem}</p>
                  {it.subscores ? (
                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                      {Object.entries(it.subscores).map(([d, v]) => (
                        <div key={d} className="flex items-center justify-between rounded-lg bg-white px-2 py-1 ring-1 ring-slate-200">
                          <span className="text-[11px] text-slate-500">{DIM_LABEL[d] || d}</span>
                          <span className="text-[11px] font-semibold text-slate-800">{v}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-[11px] text-slate-400">{it.band != null ? "教师为直接打分(未填四维)" : "尚未批改"}</p>
                  )}
                  {it.feedback && (
                    <p className="mt-2 whitespace-pre-wrap rounded-lg bg-white px-2 py-1.5 text-xs leading-relaxed text-slate-600 ring-1 ring-slate-200">
                      教师评语:{it.feedback}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 客观题明细 */}
        {r.objective.length > 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-700">逐题回顾</h2>
            <div className="mt-3 space-y-2">
              {r.objective.map((it, i) => (
                <div key={it.questionId} className={`rounded-xl border p-3 ${it.isCorrect ? "border-emerald-100 bg-emerald-50/40" : "border-rose-100 bg-rose-50/40"}`}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-medium text-slate-500">第 {i + 1} 题</span>
                    {it.topic && <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] text-indigo-600">{it.topic}</span>}
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{QTYPE_LABEL[it.qType] || it.qType}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${it.isCorrect ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
                      {it.isCorrect ? "答对" : "答错"}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-700">{it.stem}</p>
                  {!it.isCorrect && (
                    <p className="mt-1 text-[11px] text-slate-500">
                      你的答案:<b className="text-rose-600">{it.selected || "(未答)"}</b> · 正确答案:<b className="text-emerald-700">{it.answer || "—"}</b>
                    </p>
                  )}
                  {it.solution && <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-slate-500">解析:{it.solution}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => router.push("/app/language/wrong")}
            className="rounded-xl border border-indigo-200 bg-white px-3 py-2 text-xs font-medium text-indigo-600 transition hover:bg-indigo-50"
          >
            去错题本巩固 →
          </button>
        </div>
      </div>
    </div>
  );
}
