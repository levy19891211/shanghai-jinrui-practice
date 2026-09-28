"use client";

// 教务分班工作台(分层走班 / 选课走班)
// 权限:仅「教务老师(ACADEMIC)」或「管理员(ADMIN)」
// 数据:/api/flexible/*

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, getUser } from "@/lib/api";
import Select from "@/components/Select";

interface Tier {
  key: string;
  label: string;
  capacity?: number | string;
  teacherId?: string;
  room?: string;
  count?: number;
}
interface Candidate {
  id: string;
  name: string;
  studentNo?: string | null;
  adminClass?: string | null;
  basisScore: number | null;
  currentTier?: string | null;
  currentClassId?: string | null;
}
interface Run {
  id: string;
  subject: string;
  grade: string;
  academicYear: string;
  term: string;
  mode: string;
  status: string;
  blockId?: string | null;
  tiers: Tier[];
  draftAssign: Record<string, string>;
  basisExamId?: string | null;
  basisNote?: string | null;
}
interface Block { id: string; name: string; grade: string; academicYear: string; term: string; slots: unknown[] }
interface Teacher { id: string; name: string; role: string; teacherRole?: string | null }

const TERMS = ["第一学期", "第二学期", "全年"];
const MODES = [
  { value: "LEVEL", label: "分层走班" },
  { value: "ELECTIVE", label: "选课走班" },
];

function canManage(): boolean {
  const u = getUser();
  return !!u && (u.role === "ADMIN" || u.teacherRole === "ACADEMIC");
}

export default function TeacherPlacementWorkbench() {
  const [grade, setGrade] = useState("高一");
  const [academicYear, setAcademicYear] = useState("2026-2027");
  const [term, setTerm] = useState("第一学期");
  const [subject, setSubject] = useState("英语");
  const [mode, setMode] = useState("LEVEL");
  const [blockId, setBlockId] = useState("");
  const [basisExamId, setBasisExamId] = useState("");
  const [basisNote, setBasisNote] = useState("");

  const [tiers, setTiers] = useState<Tier[]>([
    { key: "A", label: "A层", capacity: "", teacherId: "", room: "" },
    { key: "B", label: "B层", capacity: "", teacherId: "", room: "" },
    { key: "C", label: "C层", capacity: "", teacherId: "", room: "" },
  ]);

  const [blocks, setBlocks] = useState<Block[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [basisExams, setBasisExams] = useState<{ id: string; title: string; type: string; examDate: string }[]>([]);

  const [run, setRun] = useState<Run | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [assign, setAssign] = useState<Record<string, string>>({});

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  // 时段块管理(就地创建 / 删除,供分层/选课走班选择)
  const [blockOpen, setBlockOpen] = useState(false);
  const [newBlockName, setNewBlockName] = useState("");
  const [newBlockSlots, setNewBlockSlots] = useState("");
  const [blockBusy, setBlockBusy] = useState(false);

  const refreshAux = useCallback(() => {
    api
      .get<Block[]>("/flexible/blocks?grade=" + encodeURIComponent(grade) + "&academicYear=" + encodeURIComponent(academicYear) + "&term=" + encodeURIComponent(term))
      .then(setBlocks)
      .catch(() => setBlocks([]));
    api
      .get<Teacher[]>("/flexible/teachers")
      .then(setTeachers)
      .catch(() => setTeachers([]));
    api
      .get<{ id: string; title: string; type: string; examDate: string }[]>("/flexible/basis-exams?subject=" + encodeURIComponent(subject) + "&grade=" + encodeURIComponent(grade))
      .then(setBasisExams)
      .catch(() => setBasisExams([]));
  }, [grade, academicYear, term, subject]);

  useEffect(() => { refreshAux(); }, [refreshAux]);

  const teacherOptions = useMemo(
    () => teachers.map((t) => ({ value: t.id, label: `${t.name}${t.teacherRole ? `(${t.teacherRole})` : ""}` })),
    [teachers]
  );
  const blockOptions = useMemo(
    () => blocks.map((b) => ({ value: b.id, label: b.name })),
    [blocks]
  );
  const basisExamOptions = useMemo(
    () => basisExams.map((e) => ({ value: e.id, label: `${e.title}（${e.type}·${e.examDate?.slice(0, 10) || ""}）` })),
    [basisExams]
  );

  function updateTier(i: number, patch: Partial<Tier>) {
    setTiers((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], ...patch };
      // key 默认跟随 label
      if (patch.label !== undefined && (next[i].key === "" || next[i].key === next[i].label || !patch.key)) {
        next[i].key = patch.label;
      }
      if (patch.key !== undefined) next[i].key = patch.key;
      return next;
    });
  }

  function addTier() {
    setTiers((prev) => [...prev, { key: `T${prev.length + 1}`, label: `第${prev.length + 1}层`, capacity: "", teacherId: "", room: "" }]);
  }
  function removeTier(i: number) {
    setTiers((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function createBlock() {
    if (!newBlockName.trim()) return setError("时段块名称不能为空");
    setBlockBusy(true); setError("");
    try {
      const slots = newBlockSlots
        .split(/[，,\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
      await api.post("/flexible/blocks", { grade, academicYear, term, name: newBlockName.trim(), slots });
      setNewBlockName(""); setNewBlockSlots("");
      refreshAux();
      setMsg("时段块已创建");
    } catch (e: any) {
      setError(e.message || "创建失败");
    } finally {
      setBlockBusy(false);
    }
  }
  async function deleteBlock(id: string) {
    if (!window.confirm("确认删除该时段块?(下无教学班才可删除)")) return;
    setBlockBusy(true); setError("");
    try {
      await api.del("/flexible/blocks/" + id);
      refreshAux();
      if (blockId === id) setBlockId("");
      setMsg("时段块已删除");
    } catch (e: any) {
      setError(e.message || "删除失败");
    } finally {
      setBlockBusy(false);
    }
  }

  async function saveDraft() {
    if (!canManage()) return setError("仅教务老师/管理员可执行分班");
    setLoading(true); setError(""); setMsg("");
    try {
      const cleanTiers = tiers
        .filter((t) => t.label.trim())
        .map((t) => ({
          key: (t.key || t.label).trim(),
          label: t.label.trim(),
          capacity: t.capacity ? Number(t.capacity) : null,
          teacherId: t.teacherId || null,
          room: t.room?.trim() || null,
        }));
      if (!cleanTiers.length) throw new Error("请至少配置一个层级/选修班");
      if (mode === "LEVEL" && !blockId) throw new Error("分层走班必须先选择该科目的走班时段块(保证各层同一时段)");

      const res = await api.post<Run>("/flexible/runs", {
        subject, grade, academicYear, term, mode,
        blockId: mode === "LEVEL" ? blockId : null,
        tiers: cleanTiers,
        draftAssign: assign,
        basisExamId: basisExamId || null,
        basisNote: basisNote || null,
      });
      setRun(res);
      await loadRun(res.id);
      setMsg("草稿已保存");
    } catch (e: any) {
      setError(e.message || "保存失败");
    } finally {
      setLoading(false);
    }
  }

  async function loadRun(id: string) {
    const data = await api.get<{ run: Run; candidates: Candidate[] }>("/flexible/runs/" + id);
    setRun(data.run);
    setCandidates(data.candidates);
    setAssign(data.run.draftAssign || {});
  }

  async function preview() {
    if (!run) return;
    setLoading(true); setError(""); setMsg("");
    try {
      const res = await api.post<{ assign: Record<string, string>; tiers: Tier[]; total: number }>("/flexible/runs/" + run.id + "/preview");
      setAssign(res.assign);
      setTiers((prev) =>
        prev.map((t) => {
          const found = res.tiers.find((r) => r.key === t.key || r.key === t.label);
          return found ? { ...t, count: found.count } : t;
        })
      );
      setMsg(`已按成绩排名预分,共 ${res.total} 人,可继续人工调剂`);
    } catch (e: any) {
      setError(e.message || "预分失败");
    } finally {
      setLoading(false);
    }
  }

  async function moveStudent(studentId: string, tierKey: string | "") {
    if (!run) return;
    setLoading(true); setError("");
    try {
      const res = await api.post<{ mode: string }>("/flexible/runs/" + run.id + "/adjust", {
        studentId,
        tierKey: tierKey || null,
      });
      setAssign((prev) => {
        const next = { ...prev };
        if (tierKey) next[studentId] = tierKey;
        else delete next[studentId];
        return next;
      });
      setMsg(res.mode === "PUBLISHED" ? "学期中调剂已记录(含原因日志)" : "已更新草稿分配");
    } catch (e: any) {
      setError(e.message || "调剂失败");
    } finally {
      setLoading(false);
    }
  }

  async function publish() {
    if (!run) return;
    const reason = window.prompt("发布前请填写分班说明(将记入审计):", basisNote || "学期初分班");
    if (reason === null) return;
    setLoading(true); setError(""); setMsg("");
    try {
      const res = await api.post<{ published: boolean; issues?: string[]; total: number; adjusted: number }>(
        "/flexible/runs/" + run.id + "/publish",
        { reason }
      );
      if (!res.published) {
        setError("发布被阻止,请处理以下问题:\n" + (res.issues || []).join("\n"));
        return;
      }
      await loadRun(run.id);
      setMsg(`已发布:生成教学班,${res.total} 人完成分配(变更 ${res.adjusted} 条)`);
    } catch (e: any) {
      setError(e.message || "发布失败");
    } finally {
      setLoading(false);
    }
  }

  async function revoke() {
    if (!run) return;
    if (!window.confirm("确认撤回该分班方案?撤回后教学班保留但方案回到草稿态。")) return;
    setLoading(true); setError("");
    try {
      await api.post("/flexible/runs/" + run.id + "/revoke");
      await loadRun(run.id);
      setMsg("已撤回,可重新编辑后再次发布");
    } catch (e: any) {
      setError(e.message || "撤回失败");
    } finally {
      setLoading(false);
    }
  }

  // 学生当前层级
  function tierOf(c: Candidate): string | "" {
    return assign[c.id] ?? c.currentTier ?? "";
  }

  const unassigned = candidates.filter((c) => !tierOf(c));
  const byTier = useMemo(() => {
    const m: Record<string, Candidate[]> = {};
    for (const t of tiers) m[t.key] = [];
    m["__none__"] = [];
    for (const c of candidates) {
      const k = tierOf(c);
      if (k && m[k]) m[k].push(c);
      else m["__none__"].push(c);
    }
    return m;
  }, [candidates, tiers, assign]);

  if (!canManage()) {
    return <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">分班工作台仅对教务老师/管理员开放。</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-800">分层 / 选课 分班工作台</h2>
        {run && (
          <span className={`rounded-full px-2.5 py-0.5 text-xs ${run.status === "PUBLISHED" ? "bg-emerald-100 text-emerald-700" : run.status === "REVOKED" ? "bg-slate-200 text-slate-600" : "bg-amber-100 text-amber-700"}`}>
            {run.status === "PUBLISHED" ? "已发布" : run.status === "REVOKED" ? "已撤回" : "草稿"}
          </span>
        )}
      </div>

      {error && <pre className="whitespace-pre-wrap rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</pre>}
      {msg && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{msg}</p>}

      {/* 配置 */}
      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-3">
        <Labeled label="年级">
          <input className="ui-input" value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="如 高一" />
        </Labeled>
        <Labeled label="学年">
          <input className="ui-input" value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} placeholder="如 2026-2027" />
        </Labeled>
        <Labeled label="学期">
          <Select value={term} onChange={setTerm} options={TERMS.map((t) => ({ value: t, label: t }))} />
        </Labeled>
        <Labeled label="科目">
          <input className="ui-input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="如 英语" />
        </Labeled>
        <Labeled label="模式">
          <Select value={mode} onChange={setMode} options={MODES} />
        </Labeled>
        {mode === "LEVEL" && (
          <Labeled label="走班时段块(必选)">
            <Select value={blockId} onChange={setBlockId} options={blockOptions} placeholder="选择年级走班时段块" />
          </Labeled>
        )}
        <Labeled label="依据考试(可选)">
          <Select value={basisExamId} onChange={setBasisExamId} options={basisExamOptions} placeholder="不选则按学号顺序" />
        </Labeled>
        <Labeled label="依据说明">
          <input className="ui-input" value={basisNote} onChange={(e) => setBasisNote(e.target.value)} placeholder="如 2026春期末 / 外部排名导入" />
        </Labeled>
      </div>

      {mode === "LEVEL" && !blockId && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          分层走班须先选择该科目的走班时段块:同科目所有层级将共享同一时段块,从结构上保证「分层班强制同一时段」。可在「时段块管理」中创建。
        </p>
      )}

      {/* 走班时段块管理(分层/选课走班必须绑定) */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <button
          onClick={() => setBlockOpen((v) => !v)}
          className="flex w-full items-center justify-between text-sm font-medium text-slate-700"
        >
          <span>走班时段块管理（{blocks.length}）</span>
          <span className="text-xs text-indigo-500">{blockOpen ? "收起" : "展开"}</span>
        </button>
        {blockOpen && (
          <div className="mt-3 space-y-3">
            <div className="space-y-1">
              {blocks.length === 0 && <p className="text-xs text-slate-400">本年级/学年/学期暂无时段块。</p>}
              {blocks.map((b) => (
                <div key={b.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-xs">
                  <div>
                    <span className="font-medium text-slate-700">{b.name}</span>
                    <span className="ml-2 text-slate-400">{(Array.isArray(b.slots) ? b.slots : []).join("、")}</span>
                  </div>
                  <button onClick={() => deleteBlock(b.id)} className="text-red-500 hover:bg-red-50 px-2 py-1 rounded">删除</button>
                </div>
              ))}
            </div>
            <div className="grid gap-2 md:grid-cols-[1.4fr_2fr_auto]">
              <input className="ui-input" value={newBlockName} onChange={(e) => setNewBlockName(e.target.value)} placeholder="时段块名称,如 英语分层时段" />
              <input className="ui-input" value={newBlockSlots} onChange={(e) => setNewBlockSlots(e.target.value)} placeholder="时段,逗号分隔,如 周一1-2,周三1-2" />
              <button onClick={createBlock} disabled={blockBusy} className="rounded-md bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-50">新建</button>
            </div>
          </div>
        )}
      </div>

      {/* 层级配置 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium text-slate-700">{mode === "LEVEL" ? "层级配置(A/B/C 等)" : "选修班配置"}</h3>
          <button onClick={addTier} className="rounded-md bg-slate-100 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-200">+ 添加</button>
        </div>
        <div className="space-y-2">
          {tiers.map((t, i) => (
            <div key={i} className="grid items-end gap-2 md:grid-cols-[1.2fr_1fr_1fr_1.4fr_1fr_auto]">
              <Labeled label="层级标签">
                <input className="ui-input" value={t.label} onChange={(e) => updateTier(i, { label: e.target.value })} placeholder="如 A层" />
              </Labeled>
              <Labeled label="容量">
                <input className="ui-input" type="number" value={t.capacity ?? ""} onChange={(e) => updateTier(i, { capacity: e.target.value })} placeholder="不限留空" />
              </Labeled>
              <Labeled label="教室">
                <input className="ui-input" value={t.room ?? ""} onChange={(e) => updateTier(i, { room: e.target.value })} placeholder="如 301" />
              </Labeled>
              <Labeled label="主讲教师">
                <Select value={t.teacherId ?? ""} onChange={(v) => updateTier(i, { teacherId: v })} options={teacherOptions} placeholder="选择教师" />
              </Labeled>
              <Labeled label="预分人数">
                <div className="ui-input bg-slate-50 text-slate-500">{t.count ?? "-"}</div>
              </Labeled>
              <button onClick={() => removeTier(i)} className="mb-1 rounded-md px-2 py-2 text-xs text-red-500 hover:bg-red-50">删除</button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={saveDraft} disabled={loading} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">保存草稿</button>
          <button onClick={preview} disabled={loading || !run} className="rounded-md bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-50">按成绩自动预分</button>
          {run && run.status !== "PUBLISHED" && (
            <button onClick={publish} disabled={loading} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">发布</button>
          )}
          {run && run.status === "PUBLISHED" && (
            <button onClick={revoke} disabled={loading} className="rounded-md bg-slate-400 px-3 py-1.5 text-sm text-white disabled:opacity-50">撤回</button>
          )}
        </div>
      </div>

      {/* 名单与调剂 */}
      {run && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-slate-700">学生分配({candidates.length} 人 · 未分配 {unassigned.length})</h3>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {tiers.map((t) => (
              <TierCard key={t.key} tier={t} students={byTier[t.key] || []} tiers={tiers} onMove={moveStudent} />
            ))}
            {unassigned.length > 0 && (
              <TierCard tier={{ key: "__none__", label: "未分配" }} students={byTier["__none__"]} tiers={tiers} onMove={moveStudent} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TierCard({ tier, students, tiers, onMove }: { tier: Tier; students: Candidate[]; tiers: Tier[]; onMove: (id: string, k: string | "") => void }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-slate-700">{tier.label}（{students.length}）</span>
      </div>
      <div className="max-h-72 space-y-1 overflow-auto">
        {students.length === 0 && <p className="text-xs text-slate-400">暂无学生</p>}
        {students.map((s) => (
          <div key={s.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-2 py-1.5 text-xs">
            <div className="min-w-0">
              <div className="truncate font-medium text-slate-700">{s.name}</div>
              <div className="truncate text-[11px] text-slate-400">{s.adminClass || ""}{s.basisScore != null ? ` · 依据分 ${s.basisScore}` : ""}</div>
            </div>
            <Select
              size="sm"
              value={tier.key === "__none__" ? "" : tier.key}
              onChange={(v) => onMove(s.id, v)}
              options={[{ value: "", label: "未分配" }, ...tiers.map((t) => ({ value: t.key, label: t.label }))]}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-slate-500">{label}</span>
      {children}
    </label>
  );
}
