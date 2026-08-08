"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, RefObject } from "react";
import { api, getUser } from "@/lib/api";
import { plainText, renderRich } from "@/lib/rich";
import type { AutoFixBatchItem, AutoFixPlan, AiFixPlan, Question, QuestionList } from "@/lib/types";

const STATUS_LABEL: Record<string, string> = { DRAFT: "草稿", PENDING_REVIEW: "待审核", PUBLISHED: "已发布", REJECTED: "已退回", ARCHIVED: "已下架" };

// 状态徽章配色
const STATUS_BADGE: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-500",
  PENDING_REVIEW: "bg-blue-50 text-blue-600",
  PUBLISHED: "bg-emerald-50 text-emerald-600",
  REJECTED: "bg-red-50 text-red-600",
  ARCHIVED: "bg-slate-100 text-slate-400",
};

// 把 ISO 时间格式化为「YYYY-MM-DD HH:mm」,用于显示导入/创建时间
function fmtTime(s?: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// topicIds 后端可能返回 JSON 字符串(如 "[...]"),统一解析为数组
function parseJsonIds(v: string | string[] | null | undefined): string[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const a = JSON.parse(v);
      return Array.isArray(a) ? a.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  }
  return [];
}

interface FormState {
  id?: string;
  subject: string;
  paper: string;
  topic: string;
  topicIds: string[]; // 关联知识点 id(多选)
  difficulty: number;
  type: string;
  stem: string;
  optionsText: string;
  answer: string;
  solution: string;
  status: string;
}

const EMPTY: FormState = {
  subject: "TMUA", paper: "Paper 1", topic: "", topicIds: [], difficulty: 3, type: "SINGLE_CHOICE",
  stem: "", optionsText: "", answer: "", solution: "", status: "DRAFT",
};

export default function TeacherPage() {
  const user = getUser();
  const [list, setList] = useState<Question[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState("");
  // 学科 tab(空 = 全部;含数学/物理/化学/生物)
  const [subjectTab, setSubjectTab] = useState("");
  // 筛选与排序:知识点 / 难度 / 排序
  const [kpFilter, setKpFilter] = useState("");
  const [diffFilter, setDiffFilter] = useState("");
  const [sortBy, setSortBy] = useState("createdAt_desc");
  const [allKps, setAllKps] = useState<{ id: string; name: string; subject: string }[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importMode, setImportMode] = useState<"json" | "csv" | "file">("json");
  const [importText, setImportText] = useState("");
  const [importResult, setImportResult] = useState<{ imported: number; failed: number; errors: { row: number; reason: string }[] } | null>(null);
  const [importError, setImportError] = useState("");
  const [importing, setImporting] = useState(false);
  // 文件批量导入(Excel/Word)
  const fileImportRef = useRef<HTMLInputElement>(null);
  const [importFileName, setImportFileName] = useState("");
  const [importUploading, setImportUploading] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewQ, setReviewQ] = useState<Question | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState("");
  // 从「试卷管理 → 去审核」跳转过来时,只看这张卷内的题
  const [paperId, setPaperId] = useState("");
  // 知识点库(按表单学科加载,供多选归类)
  const [kps, setKps] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (!showForm) return;
    // 题目学科 → 知识点学科:TMUA/ESAT 归类到数学(ESAT 主要为数学与物理,按数学加载)
    const kpSubject = form.subject === "TMUA" || form.subject === "ESAT" ? "数学" : form.subject;
    api
      .get<{ list: { id: string; name: string }[] }>(`/knowledge-points?subject=${encodeURIComponent(kpSubject)}`)
      .then((d) => setKps(d.list || []))
      .catch(() => setKps([]));
  }, [form.subject, showForm]);

  // —— 图片上传:题干 / 选项 / 解析 插入图表 ——
  const stemRef = useRef<HTMLTextAreaElement>(null);
  const optionsRef = useRef<HTMLTextAreaElement>(null);
  const solutionRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<{ field: "stem" | "optionsText" | "solution"; ref: RefObject<HTMLTextAreaElement> } | null>(null);
  const [uploading, setUploading] = useState(false);

  const openImagePicker = (field: "stem" | "optionsText" | "solution", ref: RefObject<HTMLTextAreaElement>) => {
    setUploadTarget({ field, ref });
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !uploadTarget) return;
    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      const res = await api.post<{ url: string; filename: string }>("/uploads", { filename: file.name, data: dataUrl });
      const url = res.url;
      const alt = file.name.replace(/\.[^.]+$/, "");
      const snippet = `![${alt}](${url})`;
      const ref = uploadTarget.ref;
      const cur = form[uploadTarget.field];
      const el = ref.current;
      let next = cur;
      let caret = cur.length;
      if (el) {
        const start = el.selectionStart ?? cur.length;
        const end = el.selectionEnd ?? cur.length;
        next = cur.slice(0, start) + snippet + cur.slice(end);
        caret = start + snippet.length;
      } else {
        const sep = cur && !cur.endsWith("\n") ? "\n" : "";
        next = cur + sep + snippet;
        caret = next.length;
      }
      setForm((f) => ({ ...f, [uploadTarget.field]: next }));
      requestAnimationFrame(() => {
        if (el) { el.focus(); el.selectionStart = el.selectionEnd = caret; }
      });
    } catch (err: any) {
      alert("图片上传失败:" + (err?.message || err));
    } finally {
      setUploading(false);
      setUploadTarget(null);
    }
  };
  const [paperTitle, setPaperTitle] = useState("");
  // 一键自动修正
  const [fixOpen, setFixOpen] = useState(false);
  const [fixQ, setFixQ] = useState<Question | null>(null);
  const [fixPlan, setFixPlan] = useState<AutoFixPlan | null>(null);
  const [fixLoading, setFixLoading] = useState(false);
  const [fixApplying, setFixApplying] = useState(false);
  const [fixError, setFixError] = useState("");
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchItems, setBatchItems] = useState<AutoFixBatchItem[] | null>(null);
  const [batchSummary, setBatchSummary] = useState<{ total: number; fixedCount: number; stuck: number; resubmitted: number; applied: boolean } | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchError, setBatchError] = useState("");
  const [genBusy, setGenBusy] = useState<string | null>(null);
  // AI 按退回原因语义重调(skill)
  const [aiFixOpen, setAiFixOpen] = useState(false);
  const [aiFixQ, setAiFixQ] = useState<Question | null>(null);
  const [aiFixPlan, setAiFixPlan] = useState<AiFixPlan | null>(null);
  const [aiFixLoading, setAiFixLoading] = useState(false);
  const [aiFixApplying, setAiFixApplying] = useState(false);
  const [aiFixError, setAiFixError] = useState("");
  // 服务端是否配置了 LLM(决定 AI 重调按钮是否可用)
  const [llmConfigured, setLlmConfigured] = useState<boolean>(false);

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ pageSize: "50" });
    if (statusFilter) qs.set("status", statusFilter);
    if (paperId) qs.set("paperId", paperId);
    // 学科 Tab:数学 tab 包含 TMUA(数学思维考试);其余学科各自
    if (subjectTab) {
      const subs = subjectTab === "数学" ? ["数学", "TMUA"] : [subjectTab];
      qs.set("subjects", subs.join(","));
    }
    if (kpFilter) qs.set("knowledgePointId", kpFilter);
    if (diffFilter) qs.set("difficulty", diffFilter);
    const [sort, order] = sortBy.split("_");
    if (sort === "createdAt" || sort === "difficulty") {
      qs.set("sort", sort);
      qs.set("order", order);
    }
    const d = await api.get<QuestionList>(`/questions?${qs.toString()}`);
    setList(d.list);
    setTotal(d.total);
  }, [statusFilter, paperId, subjectTab, kpFilter, diffFilter, sortBy]);

  // 加载知识点库(供筛选下拉)
  useEffect(() => {
    api
      .get<{ list: { id: string; name: string; subject: string }[] }>("/knowledge-points")
      .then((d) => setAllKps(d.list || []))
      .catch(() => setAllKps([]));
  }, []);

  // 读取 ?paperId=,进入「按试卷审核」模式
  useEffect(() => {
    const pid = new URLSearchParams(window.location.search).get("paperId");
    if (!pid) return;
    setPaperId(pid);
    api
      .get<{ title: string }>(`/papers/${pid}/manage`)
      .then((p) => setPaperTitle(p.title))
      .catch(() => setPaperTitle(""));
  }, []);

  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);

  // 探测服务端是否配置了 LLM,决定「AI 重调」按钮可用性
  useEffect(() => {
    api
      .get<{ llmConfigured: boolean }>(`/health`)
      .then((d) => setLlmConfigured(!!d.llmConfigured))
      .catch(() => setLlmConfigured(false));
  }, []);

  function exitPaperMode() {
    setPaperId("");
    setPaperTitle("");
    window.history.replaceState(null, "", "/teacher");
  }

  function openCreate() { setForm({ ...EMPTY, topicIds: [] }); setError(""); setShowForm(true); }
  function openEdit(q: Question) {
    setForm({
      id: q.id, subject: q.subject, paper: q.paper ?? "", topic: q.topic, topicIds: parseJsonIds(q.topicIds),
      difficulty: q.difficulty,
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
        subject: form.subject, paper: form.paper || null, topic: form.topic, topicIds: form.topicIds,
        difficulty: Number(form.difficulty),
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

  async function doImportFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImportError("");
    setImportResult(null);
    setImportUploading(true);
    setImportFileName(file.name);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      const r = await api.post<{ imported: number; failed: number; errors: { row: number; reason: string }[] }>(
        "/questions/import-file",
        { filename: file.name, data: dataUrl }
      );
      setImportResult(r);
      await load();
    } catch (err: any) {
      setImportError(err?.message || "导入失败(请检查文件格式/模板)");
    } finally {
      setImportUploading(false);
    }
  }

  const input =
    "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200";

  function openReview(q: Question) {
    setReviewQ(q);
    setReviewNote("");
    setReviewError("");
    setReviewOpen(true);
  }

  async function doReview(action: "approve" | "reject") {
    if (!reviewQ) return;
    setReviewing(true);
    setReviewError("");
    try {
      await api.post(`/questions/${reviewQ.id}/review`, { action, note: action === "reject" ? reviewNote : undefined });
      setReviewOpen(false);
      setMessage(action === "approve" ? "已通过审核,题目已发布" : "已驳回,题目退回修改");
      await load();
      setTimeout(() => setMessage(""), 2500);
    } catch (e) {
      setReviewError(e instanceof Error ? e.message : "审核失败");
    } finally {
      setReviewing(false);
    }
  }

  // 一键修正:先 dry-run 拿到修改方案与前后对比,老师确认后再落库
  async function openAutoFix(q: Question) {
    setFixQ(q);
    setFixPlan(null);
    setFixError("");
    setFixOpen(true);
    setFixLoading(true);
    try {
      const plan = await api.post<AutoFixPlan>(`/questions/${q.id}/autofix`, { apply: false });
      setFixPlan(plan);
    } catch (e) {
      setFixError(e instanceof Error ? e.message : "分析失败");
    } finally {
      setFixLoading(false);
    }
  }

  // AI 生成解析:调用后端 LLM 生成结构化解析草稿(步骤/考点/易错点)
  async function generateSolution(q: Question) {
    if (!window.confirm("确认使用 AI 为这道题目生成解析吗?\n生成后会进入审核队列,由你确认后发布。")) return;
    setGenBusy(q.id);
    setMessage("");
    try {
      const r = await api.post<{ id: string; solution: string; status: string }>(`/questions/${q.id}/generate-solution`, {});
      setMessage("已生成解析,题目进入审核队列,请在审核中确认后发布。");
      await load();
      setTimeout(() => setMessage(""), 4000);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "生成失败");
      setTimeout(() => setMessage(""), 5000);
    } finally {
      setGenBusy(null);
    }
  }

  async function applyAutoFix(resubmit: boolean) {
    if (!fixQ) return;
    setFixApplying(true);
    setFixError("");
    try {
      const r = await api.post<AutoFixPlan>(`/questions/${fixQ.id}/autofix`, { apply: true, resubmit });
      setFixOpen(false);
      setMessage(
        `已修正 ${r.fixes.length} 处${resubmit ? ",题目已重新提交审核" : ",未改变审核状态"}` +
          (r.remaining.length ? `;仍有 ${r.remaining.length} 项需人工确认` : "")
      );
      await load();
      setTimeout(() => setMessage(""), 4000);
    } catch (e) {
      setFixError(e instanceof Error ? e.message : "修正失败");
    } finally {
      setFixApplying(false);
    }
  }

  // AI 按退回原因语义重调(skill):先预览 LLM 给出的改写方案,老师确认后再落库
  async function openAiFix(q: Question) {
    setAiFixQ(q);
    setAiFixPlan(null);
    setAiFixError("");
    setAiFixOpen(true);
    setAiFixLoading(true);
    try {
      const plan = await api.post<AiFixPlan>(`/questions/${q.id}/fix`, { apply: false });
      setAiFixPlan(plan);
    } catch (e) {
      setAiFixError(e instanceof Error ? e.message : "AI 修正失败");
    } finally {
      setAiFixLoading(false);
    }
  }

  async function applyAiFix(resubmit: boolean) {
    if (!aiFixQ) return;
    setAiFixApplying(true);
    setAiFixError("");
    try {
      const r = await api.post<AiFixPlan>(`/questions/${aiFixQ.id}/fix`, { apply: true, resubmit });
      setAiFixOpen(false);
      setMessage(
        `已应用 AI 修正(模型 ${r.model || "LLM"})${resubmit ? ",题目已重新提交审核" : ",未改变审核状态"}` +
          (r.remaining.length ? `;仍有 ${r.remaining.length} 项需人工确认` : "")
      );
      await load();
      setTimeout(() => setMessage(""), 4000);
    } catch (e) {
      setAiFixError(e instanceof Error ? e.message : "AI 修正失败");
    } finally {
      setAiFixApplying(false);
    }
  }

  // 批量体检:默认扫描全部已退回题目
  async function runBatch(apply: boolean) {
    setBatchBusy(true);
    setBatchError("");
    try {
      const r = await api.post<{ total: number; fixedCount: number; resubmitted: number; stuck: number; applied: boolean; items: AutoFixBatchItem[] }>(
        "/questions/autofix/batch",
        { status: "REJECTED", apply, resubmit: true, onlyClean: true }
      );
      setBatchItems(r.items);
      setBatchSummary({ total: r.total, fixedCount: r.fixedCount, stuck: r.stuck, resubmitted: r.resubmitted, applied: r.applied });
      if (apply) await load();
    } catch (e) {
      setBatchError(e instanceof Error ? e.message : "批量修正失败");
    } finally {
      setBatchBusy(false);
    }
  }

  function openBatch() {
    setBatchOpen(true);
    setBatchItems(null);
    setBatchSummary(null);
    setBatchError("");
    runBatch(false);
  }

  return (
    <div className="space-y-4">
      {/* 标题行:左标题 + 右主操作 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">题库管理</h1>
          <p className="mt-1 text-sm text-slate-500">共 {total} 道题目</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setImportOpen(true); setImportText(""); setImportResult(null); setImportError(""); }}
            className="h-9 rounded-lg border border-indigo-300 px-4 text-sm font-medium text-indigo-600 hover:bg-indigo-50"
          >
            批量导入
          </button>
          <button onClick={openCreate} className="h-9 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700">
            + 新建题目
          </button>
        </div>
      </div>

      {/* 学科 Tab */}
      <div className="flex flex-wrap gap-1.5 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
        {[{ v: "", l: "全部" }, { v: "数学", l: "数学" }, { v: "物理", l: "物理" }, { v: "化学", l: "化学" }, { v: "生物", l: "生物" }].map((t) => (
          <button
            key={t.v}
            onClick={() => { setSubjectTab(t.v); setKpFilter(""); }}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${
              subjectTab === t.v ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {t.l}
          </button>
        ))}
      </div>

      {/* 筛选工具栏:统一控件高度 */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-sm outline-none focus:border-indigo-500 ui-select">
          <option value="">全部状态</option>
          <option value="DRAFT">草稿</option>
          <option value="PENDING_REVIEW">待审核</option>
          <option value="PUBLISHED">已发布</option>
          <option value="REJECTED">已退回</option>
          <option value="ARCHIVED">已下架</option>
        </select>
        <select value={kpFilter} onChange={(e) => setKpFilter(e.target.value)} className="h-9 max-w-[220px] rounded-lg border border-slate-300 bg-white px-2.5 text-sm outline-none focus:border-indigo-500 ui-select">
          <option value="">全部知识点</option>
          {(subjectTab ? allKps.filter((kp) => kp.subject === subjectTab) : allKps).map((kp) => (
            <option key={kp.id} value={kp.id}>{subjectTab ? kp.name : `[${kp.subject}] ${kp.name}`}</option>
          ))}
        </select>
        <select value={diffFilter} onChange={(e) => setDiffFilter(e.target.value)} className="h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-sm outline-none focus:border-indigo-500 ui-select">
          <option value="">全部难度</option>
          <option value="1">难度 1</option>
          <option value="2">难度 2</option>
          <option value="3">难度 3</option>
          <option value="4">难度 4</option>
          <option value="5">难度 5</option>
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-sm outline-none focus:border-indigo-500 ui-select">
          <option value="createdAt_desc">导入时间 最新在前</option>
          <option value="createdAt_asc">导入时间 最早在前</option>
          <option value="difficulty_desc">难度 高到低</option>
          <option value="difficulty_asc">难度 低到高</option>
        </select>
        <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
        <button
          onClick={() => setStatusFilter("PENDING_REVIEW")}
          className={`h-9 rounded-lg px-3.5 text-sm font-medium transition ${
            statusFilter === "PENDING_REVIEW" ? "bg-blue-600 text-white" : "border border-blue-300 text-blue-600 hover:bg-blue-50"
          }`}
        >
          审核队列
        </button>
        <button
          onClick={openBatch}
          className="h-9 rounded-lg border border-amber-300 px-3.5 text-sm font-medium text-amber-700 hover:bg-amber-50"
        >
          退回题一键修正
        </button>
      </div>

      {paperId && (
        <div className="flex items-center justify-between rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-700">
          <span>
            正在按试卷审核{paperTitle ? `:「${paperTitle}」` : ""} —— 只显示这张卷里的题目,卷内每道题通过后学生才可作答。
          </span>
          <button onClick={exitPaperMode} className="font-medium text-violet-600 hover:underline">
            退出 ✕
          </button>
        </div>
      )}

      {message && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-600">{message}</p>}
      {error && !showForm && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      {list.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">暂无题目</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          {/* min-w 保证各列不被挤压,操作列按钮不换行;超宽时容器横向滚动 */}
          <table className="w-full min-w-[1080px] text-sm">
            <thead className="bg-slate-50 text-left text-slate-400">
              <tr>
                <th className="whitespace-nowrap px-4 py-3 font-normal">科目</th>
                <th className="whitespace-nowrap px-4 py-3 font-normal">知识点</th>
                <th className="whitespace-nowrap px-4 py-3 font-normal">题干</th>
                <th className="whitespace-nowrap px-4 py-3 font-normal">难度</th>
                <th className="whitespace-nowrap px-4 py-3 font-normal">状态</th>
                <th className="whitespace-nowrap px-4 py-3 font-normal">导入时间</th>
                <th className="whitespace-nowrap px-4 py-3 font-normal">操作</th>
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
                  <td className="max-w-[200px] px-4 py-3">
                    {q.topics && q.topics.length ? (
                      <div className="flex flex-wrap gap-1">
                        {q.topics.map((t) => (
                          <span key={t} className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-600">{t}</span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-amber-500" title={q.topic ? `原识别:${q.topic}` : "导入/录入时未归类"}>待归类</span>
                    )}
                  </td>
                  <td className="max-w-[280px] px-4 py-3 text-slate-600">
                    <div className="truncate">{plainText(q.stem)}</div>
                    {q.status === "REJECTED" && q.reviewNote && (
                      <div className="mt-0.5 truncate text-xs text-red-500" title={q.reviewNote}>
                        退回:{q.reviewNote}
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">{q.difficulty}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className={`rounded px-2 py-0.5 text-xs ${STATUS_BADGE[q.status]}`}>
                      {STATUS_LABEL[q.status]}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                    <span
                      className={q.importedAt ? "font-medium text-slate-600" : "text-slate-400"}
                      title={`${q.importedAt ? "导入于" : "创建于"} ${fmtTime(q.importedAt || q.createdAt)}`}
                    >
                      {q.importedAt ? "导入 " : "创建 "}
                      {fmtTime(q.importedAt || q.createdAt)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex flex-nowrap items-center gap-x-3">
                      {(q.status === "PENDING_REVIEW" || q.status === "REJECTED") && (
                        <button onClick={() => openReview(q)} className="whitespace-nowrap font-medium text-blue-600 hover:underline">审核</button>
                      )}
                      {q.status === "REJECTED" && (
                        <button onClick={() => openAutoFix(q)} className="whitespace-nowrap font-medium text-amber-600 hover:underline">一键修正</button>
                      )}
                      {q.status === "REJECTED" && (
                        <button
                          onClick={() => openAiFix(q)}
                          disabled={!llmConfigured}
                          title={llmConfigured ? "用 AI 按退回原因语义重写题目" : "服务端未配置 LLM_API_KEY,暂不可用"}
                          className="whitespace-nowrap font-medium text-fuchsia-600 hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:no-underline"
                        >
                          AI 重调
                        </button>
                      )}
                      <button onClick={() => generateSolution(q)} disabled={genBusy === q.id} className="whitespace-nowrap font-medium text-emerald-600 hover:underline disabled:opacity-50">
                        {genBusy === q.id ? "生成中..." : "AI 生成解析"}
                      </button>
                      <button onClick={() => openEdit(q)} className="whitespace-nowrap text-indigo-600 hover:underline">编辑</button>
                      {user?.role === "ADMIN" && (
                        <button onClick={() => remove(q)} className="whitespace-nowrap text-red-500 hover:underline">删除</button>
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
              {(["json", "csv", "file"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setImportMode(m)}
                  className={`rounded-lg px-4 py-1.5 text-sm ${importMode === m ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"}`}
                >
                  {m === "json" ? "JSON 数组" : m === "csv" ? "CSV 文本" : "上传文件"}
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
            ) : importMode === "csv" ? (
              <>
                <textarea
                  className={`${input} mt-3 h-48 font-mono text-xs`}
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder={"subject,paper,topic,difficulty,type,stem,options(分号分隔),answer,solution,source,status\nTMUA,Paper 1,代数,3,SINGLE_CHOICE,\"题干...\",A;B;C;D,A,解析,来源,PUBLISHED"}
                />
                <p className="mt-2 text-xs text-slate-400">首行为表头;options 用分号分隔;含逗号的字段用双引号包裹</p>
              </>
            ) : (
              <>
                <div className="mt-3 rounded-lg border-2 border-dashed border-slate-300 px-4 py-8 text-center">
                  <input
                    ref={fileImportRef}
                    type="file"
                    accept=".xlsx,.xls,.docx,.pdf"
                    className="hidden"
                    onChange={doImportFile}
                  />
                  <button
                    type="button"
                    onClick={() => fileImportRef.current?.click()}
                    disabled={importUploading}
                    className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
                  >
                    {importUploading ? "解析中..." : "选择文件 (.xlsx / .xls / .docx / .pdf)"}
                  </button>
                  {importFileName && !importUploading && (
                    <p className="mt-3 text-xs text-slate-500">已选:{importFileName}</p>
                  )}
                </div>
                <div className="mt-3 space-y-2 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
                  <p className="font-semibold text-slate-700">Excel 列说明(首行表头,一行一题):</p>
                  <p>subject, paper, topic, difficulty, type, stem, options(分号分隔), answer, solution, source, status</p>
                  <p className="font-semibold text-slate-700">Word 模板(每题之间用单独一行的 --- 分隔):</p>
                  <pre className="overflow-x-auto rounded bg-white p-2 text-[11px] text-slate-700">{`---
Subject: TMUA
Paper: 2016 P1
Topic: 代数
Difficulty: 3
Type: SINGLE_CHOICE

题干,可含 $LaTeX$ 公式。

A. 选项一
B. 选项二
C. 选项三
D. 选项四

Answer: B

解析内容(可选)。`}</pre>
                  <p>answer 写字母(A/B/C/D)或选项文本均可,系统会自动对齐。</p>
                  <p className="mt-2 font-semibold text-slate-700">PDF 导入:</p>
                  <p>系统会把 PDF 逐页渲染成图片,交给视觉模型读取渲染后的数学公式并自动转成题目(公式不需手敲 LaTeX)。PDF 导入需在服务器配置视觉模型(VISION_API_KEY 等),未配置时会提示。</p>
                  <p className="text-amber-600">强烈建议把「试卷题目」和「答案 Key/Mark Scheme」合并成一个 PDF 后上传;这样视觉模型能同时提取正确答案和解析。如果只上传题目,答案会留空,需教师在审核页手动补充。</p>
                </div>
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
              {importMode !== "file" && (
                <button onClick={doImport} disabled={importing} className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
                  {importing ? "导入中..." : "开始导入"}
                </button>
              )}
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
                <select className={`${input} ui-select`} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })}>
                  <option value="TMUA">TMUA</option>
                  <option value="ESAT">ESAT</option>
                  <option value="数学">数学</option>
                  <option value="物理">物理</option>
                  <option value="化学">化学</option>
                  <option value="生物">生物</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-600">试卷/部分</label>
                <input className={input} value={form.paper} onChange={(e) => setForm({ ...form, paper: e.target.value })} placeholder="Paper 1 / Maths 1" />
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-sm text-slate-600">知识点(可多选,从下拉添加)</label>
                {form.topicIds.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {form.topicIds.map((id) => {
                      const kp = kps.find((k) => k.id === id);
                      if (!kp) return null;
                      return (
                        <span key={id} className="inline-flex items-center gap-1 rounded-full bg-indigo-600 px-2.5 py-1 text-xs text-white">
                          {kp.name}
                          <button
                            type="button"
                            onClick={() => setForm({ ...form, topicIds: form.topicIds.filter((x) => x !== id) })}
                            className="text-white/70 hover:text-white"
                            aria-label="移除"
                          >
                            ×
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
                <select
                  className={`${input} ui-select`}
                  value=""
                  onChange={(e) => {
                    const id = e.target.value;
                    if (id && !form.topicIds.includes(id)) setForm({ ...form, topicIds: [...form.topicIds, id] });
                    e.target.value = "";
                  }}
                >
                  <option value="">选择知识点添加…</option>
                  {kps.filter((kp) => !form.topicIds.includes(kp.id)).map((kp) => (
                    <option key={kp.id} value={kp.id}>{kp.name}</option>
                  ))}
                </select>
                {kps.length === 0 && (
                  <p className="mt-1 text-xs text-amber-500">该学科暂无知识点,请先到「知识点管理」页添加</p>
                )}
                {form.topic && !form.topicIds.length && (
                  <p className="mt-1 text-xs text-slate-400" title="题库中原有的知识点文本">原知识点「{form.topic}」— 若未选新标签将保留原值</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm text-slate-600">难度(1-5)</label>
                  <input className={input} type="number" min={1} max={5} value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: Number(e.target.value) })} />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-slate-600">状态</label>
                <select className={`${input} ui-select`} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  <option value="PENDING_REVIEW">待审核(默认)</option>
                  <option value="DRAFT">草稿(暂不提交)</option>
                  <option value="PUBLISHED">发布</option>
                  <option value="REJECTED">已退回</option>
                  <option value="ARCHIVED">下架</option>
                </select>
                </div>
              </div>
            </div>
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between">
                <label className="block text-sm text-slate-600">题干(支持公式 `$x^2$`、图片 `![说明](url)`、LaTeX 文本)</label>
                <button type="button" onClick={() => openImagePicker("stem", stemRef)} disabled={uploading} className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50">📷 上传图片</button>
              </div>
              <textarea ref={stemRef} className={`${input} h-20`} value={form.stem} onChange={(e) => setForm({ ...form, stem: e.target.value })} placeholder="输入题干... 公式用 $ 包裹,如 求 $x^2 - 5x + 6 = 0$ 的根" />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="block text-sm text-slate-600">选项(每行一个,支持公式 $ 与图片)</label>
                  <button type="button" onClick={() => openImagePicker("optionsText", optionsRef)} disabled={uploading} className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50">📷 上传</button>
                </div>
                <textarea ref={optionsRef} className={`${input} h-24`} value={form.optionsText} onChange={(e) => setForm({ ...form, optionsText: e.target.value })} placeholder={"A 选项内容\nB 选项内容\n$\\sqrt{2}$ 或 ![图](/uploads/xx.png)"} />
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-600">正确答案</label>
                <input className={input} value={form.answer} onChange={(e) => setForm({ ...form, answer: e.target.value })} placeholder="与某选项内容一致" />
                <div className="mb-1 mt-3 flex items-center justify-between">
                  <label className="block text-sm text-slate-600">解析</label>
                  <button type="button" onClick={() => openImagePicker("solution", solutionRef)} disabled={uploading} className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50">📷 上传图片</button>
                </div>
                <textarea ref={solutionRef} className={`${input} h-14`} value={form.solution} onChange={(e) => setForm({ ...form, solution: e.target.value })} placeholder="解题思路(可选,支持 ![说明](/uploads/xx.png))" />
              </div>
            </div>
            {uploading && <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-600">图片上传中…</p>}
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={handleFileChange} />
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

      {reviewOpen && reviewQ && (
        <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
          <div className="mt-10 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">题目审核 · {STATUS_LABEL[reviewQ.status]}</h2>
              <button onClick={() => setReviewOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
              <span className="rounded bg-indigo-50 px-2 py-0.5 text-indigo-600">{reviewQ.subject}</span>
              {reviewQ.paper && <span className="rounded bg-teal-50 px-2 py-0.5 text-teal-600">{reviewQ.paper}</span>}
              {reviewQ.topics && reviewQ.topics.length ? (
                reviewQ.topics.map((t) => (
                  <span key={t} className="rounded bg-indigo-50 px-2 py-0.5 text-indigo-600">{t}</span>
                ))
              ) : (
                <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-600" title={reviewQ.topic ? `原识别:${reviewQ.topic}` : ""}>待归类</span>
              )}
              <span className="rounded bg-slate-100 px-2 py-0.5">难度 {reviewQ.difficulty}</span>
              {reviewQ.source && <span className="rounded bg-slate-100 px-2 py-0.5">{reviewQ.source}</span>}
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="mb-2 text-xs font-medium text-slate-400">题干</p>
              <div className="text-sm leading-relaxed text-slate-800">{renderRich(reviewQ.stem)}</div>
              <div className="mt-3 space-y-1">
                {(reviewQ.options || []).map((opt, i) => (
                  <div key={i} className={`flex gap-2 rounded-lg px-3 py-2 text-sm ${opt === reviewQ.answer ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "text-slate-700"}`}>
                    <span className="font-medium">{String.fromCharCode(65 + i)}.</span>
                    <span className="flex-1">{renderRich(opt)}</span>
                    {opt === reviewQ.answer && <span className="text-xs font-medium text-emerald-600">✓ 正确答案</span>}
                  </div>
                ))}
              </div>
              {reviewQ.solution && (
                <div className="mt-3">
                  <p className="mb-1 text-xs font-medium text-slate-400">解析</p>
                  <div className="whitespace-pre-wrap rounded border-l-4 border-[#c9b98f] bg-[#f6f1e2] px-3 py-2 text-sm leading-relaxed text-[#3a3528]">{renderRich(reviewQ.solution)}</div>
                </div>
              )}
            </div>

            {reviewQ.reviewNote && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">历史审核意见:{reviewQ.reviewNote}</p>
            )}

            <div className="mt-4">
              <label className="mb-1 block text-sm text-slate-600">驳回意见(可选,驳回时建议填写原因)</label>
              <textarea className={`${input} h-16`} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} placeholder="如:公式渲染异常、选项与答案不匹配、题干缺失..." />
            </div>
            {reviewError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{reviewError}</p>}
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setReviewOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600">取消</button>
              {reviewQ.status === "REJECTED" && (
                <button
                  onClick={() => { setReviewOpen(false); openAutoFix(reviewQ); }}
                  className="rounded-lg border border-amber-300 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50"
                >
                  一键修正
                </button>
              )}
              {reviewQ.status === "REJECTED" && (
                <button
                  onClick={() => { setReviewOpen(false); openAiFix(reviewQ); }}
                  disabled={!llmConfigured}
                  title={llmConfigured ? "用 AI 按退回原因语义重写题目" : "服务端未配置 LLM_API_KEY,暂不可用"}
                  className="rounded-lg border border-fuchsia-300 px-4 py-2 text-sm font-medium text-fuchsia-700 hover:bg-fuchsia-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  AI 重调
                </button>
              )}
              <button onClick={() => doReview("reject")} disabled={reviewing} className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60">驳回</button>
              <button onClick={() => doReview("approve")} disabled={reviewing} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">{reviewing ? "处理中..." : "通过审核并发布"}</button>
            </div>
          </div>
        </div>
      )}

      {/* 单题一键修正:先预览方案与前后对比,确认后再落库并重新提交审核 */}
      {fixOpen && fixQ && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
          <div className="mt-10 w-full max-w-3xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">一键修正 · 根据退回原因自动差错</h2>
              <button onClick={() => setFixOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            {fixQ.reviewNote ? (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">退回原因:{fixQ.reviewNote}</p>
            ) : (
              <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">该题没有填写退回原因,将执行通用体检(与发布前校验同一套标准)。</p>
            )}

            {fixLoading && <p className="mt-4 text-sm text-slate-400">正在分析题目...</p>}
            {fixError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{fixError}</p>}

            {fixPlan && (
              <>
                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                  <span className={`rounded-full px-3 py-1 ${fixPlan.fixes.length ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                    可自动修正 {fixPlan.fixes.length} 处
                  </span>
                  {fixPlan.manual.length > 0 && (
                    <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">需人工 {fixPlan.manual.length} 处</span>
                  )}
                  {fixPlan.noteMatched && (
                    <span className="rounded-full bg-violet-50 px-3 py-1 text-violet-700">已按退回原因定向定位</span>
                  )}
                  <span className={`rounded-full px-3 py-1 ${fixPlan.clean ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                    {fixPlan.clean ? "修正后可通过体检" : `修正后仍有 ${fixPlan.remaining.length} 项问题`}
                  </span>
                </div>

                {fixPlan.fixes.length === 0 && fixPlan.manual.length === 0 && (
                  <p className="mt-4 rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-500">
                    未检出可自动修正的问题。可能是内容/学术层面的问题,请手动编辑后再提交审核。
                  </p>
                )}

                {fixPlan.fixes.length > 0 && (
                  <div className="mt-4">
                    <p className="mb-2 text-xs font-medium text-slate-400">将要执行的修改</p>
                    <div className="space-y-2">
                      {fixPlan.fixes.map((f, i) => (
                        <div key={i} className="rounded-xl border border-slate-200 p-3">
                          <div className="flex items-center gap-2 text-sm">
                            <span className="font-medium text-slate-700">{f.label}</span>
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">{f.field}</span>
                            {f.targeted && <span className="rounded bg-violet-50 px-1.5 py-0.5 text-xs text-violet-600">对应退回原因</span>}
                          </div>
                          {f.why && <p className="mt-1 text-xs text-slate-400">{f.why}</p>}
                          <div className="mt-2 grid gap-2 md:grid-cols-2">
                            <div className="rounded-lg bg-red-50 px-2 py-1.5">
                              <p className="text-[11px] text-red-400">修改前</p>
                              <p className="break-all font-mono text-xs text-red-700">{f.before || "(空)"}</p>
                            </div>
                            <div className="rounded-lg bg-emerald-50 px-2 py-1.5">
                              <p className="text-[11px] text-emerald-500">修改后</p>
                              <p className="break-all font-mono text-xs text-emerald-700">{f.after || "(空)"}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {fixPlan.manual.length > 0 && (
                  <div className="mt-4 rounded-xl bg-amber-50 p-3">
                    <p className="text-xs font-medium text-amber-700">以下问题不能自动改,需要人工确认</p>
                    <ul className="mt-1 list-inside list-disc text-xs text-amber-700">
                      {fixPlan.manual.map((m, i) => (
                        <li key={i}>
                          {m.label}
                          {m.detail ? ` —— ${m.detail}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {fixPlan.fixes.length > 0 && (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="mb-2 text-xs font-medium text-slate-400">修正后的效果预览</p>
                    <div className="text-sm leading-relaxed text-slate-800">{renderRich(fixPlan.preview.stem)}</div>
                    <div className="mt-2 space-y-1">
                      {fixPlan.preview.options.map((opt, i) => (
                        <div key={i} className={`flex gap-2 rounded px-2 py-1 text-sm ${opt === fixPlan.preview.answer ? "bg-emerald-50 text-emerald-700" : "text-slate-600"}`}>
                          <span className="font-medium">{String.fromCharCode(65 + i)}.</span>
                          <span className="flex-1">{renderRich(opt)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!fixPlan.clean && (
                  <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
                    修正后仍存在:{fixPlan.remaining.join(";")}
                  </div>
                )}
              </>
            )}

            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setFixOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600">取消</button>
              <button
                onClick={() => { setFixOpen(false); openEdit(fixQ); }}
                className="rounded-lg border border-indigo-300 px-4 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50"
              >
                手动编辑
              </button>
              <button
                onClick={() => applyAutoFix(false)}
                disabled={fixApplying || !fixPlan || fixPlan.fixes.length === 0}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 disabled:opacity-50"
              >
                只修正不提交
              </button>
              <button
                onClick={() => applyAutoFix(true)}
                disabled={fixApplying || !fixPlan || (fixPlan.fixes.length === 0 && fixPlan.clean === false)}
                className="rounded-lg bg-amber-600 px-5 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60"
              >
                {fixApplying ? "处理中..." : "修正并重新提交审核"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI 按退回原因语义重调(skill):预览 LLM 给出的改写方案,确认后再落库 */}
      {aiFixOpen && aiFixQ && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
          <div className="mt-10 w-full max-w-3xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-fuchsia-700">AI 按原因重调 · 语义重写题目</h2>
              <button onClick={() => setAiFixOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            {aiFixQ.reviewNote ? (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">退回原因:{aiFixQ.reviewNote}</p>
            ) : (
              <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">该题没有填写退回原因,AI 将按题目规范全面体检并修正。</p>
            )}

            {aiFixLoading && <p className="mt-4 text-sm text-slate-400">AI 正在分析题目并生成修正方案...</p>}
            {aiFixError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{aiFixError}</p>}

            {aiFixPlan && (
              <>
                {aiFixPlan.changes.length > 0 && (
                  <div className="mt-4 rounded-xl bg-violet-50 p-3">
                    <p className="text-xs font-medium text-violet-700">AI 修改说明(供审核对照)</p>
                    <ul className="mt-1 space-y-1">
                      {aiFixPlan.changes.map((c, i) => (
                        <li key={i} className="text-xs text-violet-700">
                          <span className="rounded bg-violet-100 px-1.5 py-0.5 font-medium">{c.field}</span> {c.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="mb-2 text-xs font-medium text-slate-400">原题目</p>
                    <p className="break-words text-sm text-slate-700">{aiFixQ.stem}</p>
                    <div className="mt-2 space-y-1">
                      {(typeof aiFixQ.options === "string" ? JSON.parse(aiFixQ.options || "[]") : aiFixQ.options || []).map((opt: string, i: number) => (
                        <div key={i} className="text-xs text-slate-600">{String.fromCharCode(65 + i)}. {opt}</div>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-slate-500">答案:{aiFixQ.answer}</p>
                  </div>
                  <div className="rounded-xl border border-fuchsia-200 bg-fuchsia-50/40 p-3">
                    <p className="mb-2 text-xs font-medium text-fuchsia-500">AI 修正后</p>
                    <p className="break-words text-sm text-slate-800">{aiFixPlan.fixed.stem}</p>
                    <div className="mt-2 space-y-1">
                      {aiFixPlan.fixed.options.map((opt, i) => (
                        <div key={i} className={`text-xs ${opt === aiFixPlan.fixed.answer ? "font-medium text-emerald-700" : "text-slate-700"}`}>{String.fromCharCode(65 + i)}. {opt}</div>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-slate-600">答案:{aiFixPlan.fixed.answer}</p>
                  </div>
                </div>

                {aiFixPlan.fixed.solution && (
                  <div className="mt-3 rounded-lg bg-[#f6f1e2] px-3 py-2 text-sm leading-relaxed text-[#3a3528]">
                    <span className="text-xs font-medium text-[#00467F]">解析: </span>{aiFixPlan.fixed.solution}
                  </div>
                )}

                {!aiFixPlan.clean && (
                  <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    体检提示:修正后仍需人工复核 —— {aiFixPlan.remaining.join(";")}
                  </div>
                )}
              </>
            )}

            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setAiFixOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600">取消</button>
              <button
                onClick={() => { setAiFixOpen(false); openEdit(aiFixQ); }}
                className="rounded-lg border border-indigo-300 px-4 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50"
              >
                手动编辑
              </button>
              <button
                onClick={() => applyAiFix(false)}
                disabled={aiFixApplying || !aiFixPlan}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 disabled:opacity-50"
              >
                只修正不提交
              </button>
              <button
                onClick={() => applyAiFix(true)}
                disabled={aiFixApplying || !aiFixPlan}
                className="rounded-lg bg-fuchsia-600 px-5 py-2 text-sm font-medium text-white hover:bg-fuchsia-700 disabled:opacity-60"
              >
                {aiFixApplying ? "处理中..." : "修正并重新提交审核"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 批量一键修正:扫描全部已退回题目 */}
      {batchOpen && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
          <div className="mt-10 w-full max-w-3xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">退回题目批量修正</h2>
              <button onClick={() => setBatchOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <p className="mt-2 text-sm text-slate-500">
              系统会逐题解析退回原因并自动差错。只有修正后能通过体检的题目才会重新提交审核,仍有问题的会留在退回列表等待人工处理。
            </p>

            {batchBusy && <p className="mt-4 text-sm text-slate-400">处理中...</p>}
            {batchError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{batchError}</p>}

            {batchSummary && (
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">扫描 {batchSummary.total} 道</span>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">
                  {batchSummary.applied ? "已修正" : "可修正"} {batchSummary.fixedCount} 道
                </span>
                {batchSummary.applied && (
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-600">重新提交审核 {batchSummary.resubmitted} 道</span>
                )}
                {batchSummary.stuck > 0 && (
                  <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">{batchSummary.stuck} 道需人工处理</span>
                )}
              </div>
            )}

            {batchItems && batchItems.length > 0 && (
              <div className="mt-4 max-h-80 space-y-2 overflow-y-auto">
                {batchItems.map((it) => (
                  <div key={it.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="flex-1 truncate text-sm text-slate-700">{plainText(it.stem)}</p>
                      <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${it.clean ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-700"}`}>
                        {it.clean ? `可修正 ${it.fixCount} 处` : "需人工"}
                      </span>
                    </div>
                    {it.reviewNote && <p className="mt-1 text-xs text-red-500">退回:{it.reviewNote}</p>}
                    {it.fixes.length > 0 && (
                      <p className="mt-1 text-xs text-slate-500">修正项:{it.fixes.map((f) => f.label).join("、")}</p>
                    )}
                    {it.remaining.length > 0 && (
                      <p className="mt-1 text-xs text-amber-700">仍存在:{it.remaining.join(";")}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
            {batchItems && batchItems.length === 0 && (
              <p className="mt-4 text-sm text-slate-400">当前没有已退回的题目。</p>
            )}

            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setBatchOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600">关闭</button>
              <button onClick={() => runBatch(false)} disabled={batchBusy} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 disabled:opacity-50">
                重新体检
              </button>
              <button
                onClick={() => runBatch(true)}
                disabled={batchBusy || !batchSummary || batchSummary.fixedCount === 0}
                className="rounded-lg bg-amber-600 px-5 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60"
              >
                {batchBusy ? "处理中..." : "全部修正并重新提交审核"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
